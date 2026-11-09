from __future__ import annotations

import time

from typing import Any

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.shazam import (
    ShazamBudgetExceeded,
    ShazamClient,
    ShazamQuotaExhausted,
    ShazamUsage,
)
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.clients.musicbrainz import MusicBrainzClient
from vinyl_display.matcher import CollectionMatcher, preference_key
from vinyl_display.notify import AlertManager, Notifier
from vinyl_display.playback import PlaybackController


def json_detail(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, sort_keys=True)[:300]


class VinylDisplayApp:
    def __init__(
        self,
        store: CatalogStore,
        discogs_client: DiscogsClient,
        shazam_client: ShazamClient | Any,
        config: Any = None,
        musicbrainz_client: MusicBrainzClient | Any = None,
        run_in_background: Any = None,
    ):
        self.store = store
        self.musicbrainz_client = musicbrainz_client or MusicBrainzClient()
        self._run_in_background = run_in_background or self._start_daemon_thread
        self._duration_lookups_in_flight: set[tuple[int, str]] = set()
        self.store.favorite_threshold = config.favorite_threshold if config else 5
        self.discogs_client = discogs_client
        self.shazam_client = shazam_client
        self.config = config
        self.matcher = CollectionMatcher(store)
        self.playback = PlaybackController(
            on_scrobble=self._auto_scrobble,
            on_change=self._save_playback,
        )
        self.store.initialize()
        self._restore_playback()
        self.notifier = Notifier.from_config(config) if config else Notifier()
        self.alerts = AlertManager.from_config(self.store, self.config, self.notifier)

    @staticmethod
    def make_shazam_client(store: CatalogStore, config: Any) -> ShazamClient:
        """Cliente do Shazam com rodízio de chaves, contador mensal e orçamento diário."""
        return ShazamClient(
            config.rapidapi_shazam_key,
            config.rapidapi_shazam_host,
            usage=ShazamUsage(store),
            daily_budget=getattr(config, "shazam_daily_budget", 0),
            monthly_limit=getattr(config, "shazam_monthly_limit", 500),
        )

    def shazam_usage(self) -> dict[str, Any] | None:
        summary = getattr(self.shazam_client, "usage_summary", None)
        return summary() if callable(summary) else None

    # ------------------------------------------------------------------ v3.7
    HEARTBEAT_METADATA_KEY = "player_heartbeat"

    def record_heartbeat(self, payload: dict[str, Any], user_agent: str = "") -> dict[str, Any]:
        """O celular do player avisa a cada minuto que está vivo (e como está o microfone)."""
        import json
        import time

        heartbeat = {
            "at": time.time(),
            "audio": str(payload.get("audio") or "unknown")[:20],
            "visible": bool(payload.get("visible", True)),
            "version": str(payload.get("version") or "")[:20],
            "status": str(payload.get("status") or "")[:20],
            "uptime": int(payload.get("uptime") or 0),
            "user_agent": (user_agent or "")[:160],
        }
        self.store.set_metadata(self.HEARTBEAT_METADATA_KEY, json.dumps(heartbeat))
        return {"status": "ok"}

    def player_status(self, now: float | None = None) -> dict[str, Any]:
        import json
        import time

        now = now or time.time()
        raw = self.store.get_metadata(self.HEARTBEAT_METADATA_KEY)
        try:
            heartbeat = json.loads(raw) if raw else None
        except ValueError:
            heartbeat = None
        if not heartbeat:
            return {"seen": False, "online": False}
        age = now - float(heartbeat.get("at", 0))
        limit = 60 * int(getattr(self.config, "player_offline_minutes", 10) or 10)
        return {
            **heartbeat,
            "seen": True,
            "seconds_ago": int(age),
            "online": age <= limit,
        }

    def run_watchdog(self, now: float | None = None) -> None:
        """Roda a cada minuto: player fora do ar, resumo da semana, escuta do dia e cota do Shazam."""
        import time
        from datetime import datetime, timedelta, timezone

        now = now or time.time()
        status = self.player_status(now)
        if status.get("seen"):
            if not status["online"]:
                last = datetime.fromtimestamp(status["at"], timezone(timedelta(hours=-3))).strftime("%H:%M")
                self.alerts.raise_alert(
                    "player_offline", hold_in_quiet_hours=True, text=(
                    f"O player está sem sinal há {status['seconds_ago'] // 60} min (último contato às {last}). "
                    "Confira se o celular está ligado, no carregador e no Wi-Fi."),
                )
            else:
                self.alerts.resolve("player_offline", "✅ O player voltou a responder.")
        # v4.11: o aviso de microfone pausado saiu a pedido; limpa sem mandar mensagem um que
        # tenha ficado marcado como ativo
        self.alerts.resolve("player_needs_tap")

        try:
            from vinyl_display.assistant import maybe_send_weekly_summary

            maybe_send_weekly_summary(self, now)
        except Exception as error:
            print(f"[WATCHDOG] weekly summary failed: {error}")

        try:
            from vinyl_display.assistant import maybe_send_daily_pick

            maybe_send_daily_pick(self, now)
        except Exception as error:
            print(f"[WATCHDOG] daily pick failed: {error}")

        usage = self.shazam_usage()
        if usage and usage.get("keys"):
            month = usage.get("month", "")
            keys = usage["keys"]
            for key in keys:
                label = key["key"]
                pct = (key["calls"] / key["limit"] * 100) if key.get("limit") else 0
                if key.get("exhausted"):
                    self.alerts.raise_alert(
                        f"shazam_exhausted_{month}_{label}",
                        f"A chave {label} do Shazam esgotou a cota de {month}. O servidor já passou para a próxima.",
                        cooldown=40 * 86400,
                    )
                elif pct >= 80:
                    self.alerts.raise_alert(
                        f"shazam_80_{month}_{label}",
                        f"A chave {label} do Shazam já usou {key['calls']} de {key['limit']} chamadas em {month}.",
                        cooldown=40 * 86400,
                    )
            if all(k.get("exhausted") for k in keys):
                self.alerts.raise_alert(
                    f"shazam_all_exhausted_{month}",
                    "Todas as chaves do Shazam esgotaram a cota do mês: o player não reconhece discos novos até o mês virar.",
                    cooldown=40 * 86400,
                )

    PLAYBACK_METADATA_KEY = "active_playback"

    def _save_playback(self, playback: PlaybackController) -> None:
        import json

        snapshot = playback.snapshot()
        self.store.set_metadata(self.PLAYBACK_METADATA_KEY, json.dumps(snapshot) if snapshot else "")

    def _restore_playback(self) -> None:
        """Depois de um restart ou deploy, volta ao disco que estava tocando (até 30 min)."""
        import json

        raw = self.store.get_metadata(self.PLAYBACK_METADATA_KEY)
        if not raw:
            return
        try:
            restored = self.playback.restore(json.loads(raw), self.store)
        except Exception as error:
            print(f"[PLAYBACK] Could not restore playback state: {error}")
            return
        if restored:
            print(f"[PLAYBACK] Restored active playback: {self.playback.active.match.release.title} / {self.playback.active.match.track.position}")

    def playback_boundary(self, ago_seconds: float, gap_seconds: float | None = None) -> dict[str, Any]:
        """Pausa curta ouvida pelo celular: tenta alinhar o tempo ao início de uma faixa."""
        import time

        now = time.time()
        at = now - max(0.0, min(float(ago_seconds or 0), 30.0))
        active_id = self.playback.active.match.release.release_id if self.playback.active else None
        result = self.playback.align_track_start(at, now=now)
        self._log_event(
            "gap_aligned" if result.get("aligned") else "gap_ignored",
            active_release_id=active_id,
            track_position=result.get("track") or result.get("nearest"),
            detail=json_detail({"gap_seconds": gap_seconds, **result}),
        )
        return {"status": "ok", "result": result, "state": self.state()}

    def playback_flip(self, ago_seconds: float, gap_seconds: float | None = None) -> dict[str, Any]:
        """Silêncio longo e agulha voltando no fim de um lado: vai para o próximo lado sem Shazam."""
        import time

        now = time.time()
        at = now - max(0.0, min(float(ago_seconds or 0), 30.0))
        active_id = self.playback.active.match.release.release_id if self.playback.active else None
        result = self.playback.flip_to_next_side(at, now=now)
        self._log_event(
            "flip_local" if result.get("flipped") else "flip_rejected",
            active_release_id=active_id,
            track_position=result.get("track"),
            detail=json_detail({"gap_seconds": gap_seconds, **result}),
        )
        return {"status": "ok", "result": result, "state": self.state()}

    # Reconhecimento automático logo depois de o Shazam confirmar o disco tocando é
    # desperdício: o servidor recusa sem chamar o Shazam (o botão manual sempre passa).
    RECENT_MATCH_GUARD_SECONDS = 120
    MANUAL_TRIGGERS = {"manual"}

    def _log_event(self, status: str, **fields: Any) -> None:
        if status == "matched":
            self._last_match_at = time.time()
        trigger = getattr(self, "_current_trigger", None)
        if trigger and "trigger" not in fields:
            fields["trigger"] = trigger
        try:
            self.store.log_recognition_event(status, **fields)
        except Exception as error:  # o registro nunca pode derrubar o reconhecimento
            print(f"[RECOGNIZE] Could not log recognition event: {error}")

    def update_config(self, updates: dict[str, str]) -> None:
        import dataclasses
        from vinyl_display.config import update_dotenv
        
        # Write to .env and update os.environ
        update_dotenv(updates)
        
        # Build new config dataclass
        new_fields = {}
        for k, v in updates.items():
            field_name = k.lower()
            if hasattr(self.config, field_name):
                orig_val = getattr(self.config, field_name)
                if isinstance(orig_val, bool):
                    new_fields[field_name] = str(v).strip().lower() in {"1", "true", "sim", "yes"}
                elif isinstance(orig_val, float):
                    new_fields[field_name] = float(v)
                elif isinstance(orig_val, int):
                    new_fields[field_name] = int(v)
                else:
                    new_fields[field_name] = v
        self.config = dataclasses.replace(self.config, **new_fields)
        
        # Re-initialize clients
        self.discogs_client = DiscogsClient(
            self.config.discogs_user,
            self.config.discogs_user_agent,
            token=self.config.discogs_token,
        )
        self.shazam_client = self.make_shazam_client(self.store, self.config)
        self.store.favorite_threshold = self.config.favorite_threshold
        self.notifier = Notifier.from_config(self.config)
        self.alerts = AlertManager.from_config(self.store, self.config, self.notifier)
        print("[SERVER] Hot-swapped config to use Shazam for music recognition.")

    def state(self) -> dict[str, Any]:
        # Atualiza o disco ativo com a versão do banco ANTES de calcular o estado, para que
        # durações aprendidas e edições do admin já valham neste mesmo poll.
        if self.playback.active is not None:
            latest_release = self.store.get_release(self.playback.active.match.release.release_id)
            if latest_release:
                self.playback.refresh_release(latest_release)
        state = self.playback.current_state()
        self._log_track_change(state)
        state["collection_count"] = self.store.collection_count()
        state["last_sync_at"] = self.store.get_metadata("discogs_last_sync_at")
        state["lyrics_latency_offset"] = self.config.lyrics_latency_offset if self.config else 1.3
        state["collection_name"] = getattr(self.config, "collection_name", "") if self.config else ""
        
        # Get version
        version_str = "1.0.0"
        try:
            from pathlib import Path
            version_path = Path(__file__).parent.parent / "version.txt"
            if version_path.exists():
                version_str = version_path.read_text(encoding="utf-8").strip()
        except:
            pass
        state["version"] = version_str
        
        return state

    # Mesmo disco voltando ao prato dentro desta janela conta como a mesma audição
    # (trocar de lado/disco fora de ordem, parar e retomar, reconhecer de novo).
    AUDITION_MERGE_EXTRA_SECONDS = 30 * 60
    AUDITION_MERGE_MIN_SECONDS = 60 * 60

    def _audition_window(self, release: Any) -> int:
        from vinyl_display.journal import disc_seconds

        return max(disc_seconds(release), self.AUDITION_MERGE_MIN_SECONDS) + self.AUDITION_MERGE_EXTRA_SECONDS

    def _auto_scrobble(self, release_id: int, now: float | None = None) -> bool:
        """Audição marcada pelo player. Não conta de novo o mesmo disco se a última audição
        dele foi há menos que a duração do disco (mínimo 1 h) + 30 min."""
        from vinyl_display.journal import _iso_to_ts

        now = now or time.time()
        release = self.store.get_release(release_id)
        if release is None:
            return False
        stamps = [ts for ts in (_iso_to_ts(v) for v in (release.listen_dates or [])) if ts]
        last = max(stamps) if stamps else None
        if last is not None and now - last < self._audition_window(release):
            self._log_event("audition_merged", release_id=release_id,
                            detail=f'{{"since_last_seconds": {int(now - last)}}}')
            return False
        self.store.increment_auditions(release_id)
        self._log_event("audition_auto", release_id=release_id)
        return True

    def _log_track_change(self, state: dict[str, Any]) -> None:
        """Diário da vitrola: grava cada faixa nova que o player passa a acompanhar."""
        if state.get("status") != "playing" or not state.get("release") or not state.get("track"):
            return
        release, track = state["release"], state["track"]
        key = (release.get("release_id"), track.get("position"), int(self.playback.active.started_at) if self.playback.active else 0)
        if getattr(self, "_last_logged_track", None) == key:
            return
        previous = getattr(self, "_last_logged_track", None)
        self._last_logged_track = key
        # Mesma faixa depois de um restart/realinhamento do tempo: não conta de novo.
        if previous and previous[:2] == key[:2]:
            return
        try:
            from vinyl_display.playback import get_track_side

            self.store.log_track_play(
                at=time.time() - float(state.get("progress_seconds") or 0),
                release_id=int(release.get("release_id")),
                track_position=str(track.get("position") or ""),
                track_title=str(track.get("title") or ""),
                side=get_track_side(str(track.get("position") or "")),
                duration_seconds=track.get("duration_seconds"),
            )
        except Exception as error:  # o diário nunca derruba o player
            print(f"[DIARY] Could not log track: {error}")

    # ---------------- v4.3: edição em vinil ----------------
    EDITION_FIELDS = ("tracks", "formats", "labels", "catalog_numbers", "country", "cover_url",
                      "discogs_url", "edition_year")

    def vinyl_versions(self, release_id: int) -> dict[str, Any]:
        if self.discogs_client is None:
            return {"status": "error", "message": "Discogs não configurado."}
        override = self.store.get_override(release_id)
        try:
            data = self.discogs_client.vinyl_versions(release_id)
        except Exception as error:
            return {"status": "error", "message": f"Discogs indisponível: {error}"}
        return {"status": "ok", "chosen": override["vinyl_release_id"] if override else None, **data}

    def use_vinyl_version(self, release_id: int, vinyl_release_id: int | None) -> dict[str, Any]:
        """Passa a usar os dados de uma prensagem em vinil (faixas com lados, durações, capa,
        selo) sem mexer no item do Discogs: data de cadastro, audições, notas e prateleiras
        continuam do item original. vinyl_release_id=None volta para a edição do Discogs."""
        import dataclasses

        from vinyl_display.models import Track

        existing = self.store.get_release(release_id)
        if existing is None:
            return {"status": "error", "message": "Disco não encontrado."}
        override = self.store.get_override(release_id)

        if vinyl_release_id is None:
            if not override:
                return {"status": "ok", "release": existing.to_dict()}
            original = override["original"]
            restored = dataclasses.replace(
                existing,
                **{k: v for k, v in original.items() if k != "tracks"},
                tracks=[Track.from_dict(t) for t in original.get("tracks") or []],
            )
            self.store.upsert_release(restored)
            self.store.delete_override(release_id)
            return {"status": "ok", "release": self.store.get_release(release_id).to_dict()}

        if self.discogs_client is None:
            return {"status": "error", "message": "Discogs não configurado."}
        try:
            vinyl = self.discogs_client.release_details(int(vinyl_release_id))
        except Exception as error:
            return {"status": "error", "message": f"Discogs indisponível: {error}"}
        if not vinyl.tracks:
            return {"status": "error", "message": "Essa edição não tem lista de faixas no Discogs."}

        # Guarda a edição original só na primeira troca (para poder desfazer)
        original = override["original"] if override else {
            field: ([t.to_dict() for t in existing.tracks] if field == "tracks" else getattr(existing, field))
            for field in self.EDITION_FIELDS
        }
        # Durações que o player já aprendeu valem para a mesma música na edição nova
        learned = {self._title_key(t.title): t.duration_seconds for t in existing.tracks if t.duration_seconds}
        tracks = [
            t if t.duration_seconds else dataclasses.replace(t, duration_seconds=learned.get(self._title_key(t.title)))
            for t in vinyl.tracks
        ]
        updated = dataclasses.replace(
            existing,
            tracks=tracks,
            formats=vinyl.formats,
            labels=vinyl.labels or existing.labels,
            catalog_numbers=vinyl.catalog_numbers or existing.catalog_numbers,
            country=vinyl.country or existing.country,
            cover_url=vinyl.cover_url or existing.cover_url,
            discogs_url=vinyl.discogs_url or existing.discogs_url,
            edition_year=vinyl.edition_year or existing.edition_year,
        )
        self.store.upsert_release(updated)
        self.store.save_override(release_id, int(vinyl_release_id), original, time.time())
        return {"status": "ok", "release": self.store.get_release(release_id).to_dict()}

    @staticmethod
    def _title_key(title: str) -> str:
        import unicodedata

        value = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode("ascii").lower()
        return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())

    def listening_by_release(self) -> dict[int, dict[str, Any]]:
        from vinyl_display.journal import listening_by_release

        return listening_by_release(self.store)

    def care(self) -> dict[str, Any]:
        from vinyl_display.journal import build_care

        return build_care(self.store)

    def sync_collection(self) -> dict[str, Any]:
        try:
            res = self.discogs_client.sync_collection(self.store)
        except Exception as error:
            return {
                "status": "error",
                "message": str(error),
                "collection_count": self.store.collection_count(),
            }
        return {
            "status": "ok",
            "count": res["count"],
            "added": res["added"],
            "updated": res["updated"],
            "deleted": res["deleted"],
        }

    def recognize_audio(
        self,
        audio_bytes: bytes,
        filename: str = "clip.webm",
        client_elapsed_seconds: float | None = None,
        trigger: str | None = None,
    ) -> dict[str, Any]:
        self._current_trigger = (trigger or "")[:32] or None
        try:
            return self._recognize_audio(audio_bytes, filename, client_elapsed_seconds)
        finally:
            self._current_trigger = None

    def _recognize_audio(
        self,
        audio_bytes: bytes,
        filename: str,
        client_elapsed_seconds: float | None,
    ) -> dict[str, Any]:
        import time
        server_receive_time = time.time()
        trigger = self._current_trigger
        last_match = getattr(self, "_last_match_at", 0.0)
        if (
            trigger
            and trigger not in self.MANUAL_TRIGGERS
            and self.playback.active is not None
            and server_receive_time - last_match < self.RECENT_MATCH_GUARD_SECONDS
        ):
            active_id = self.playback.active.match.release.release_id
            self._log_event("skipped_recent", active_release_id=active_id,
                            detail=f'{{"since_match_seconds": {int(server_receive_time - last_match)}}}')
            return {"status": "skipped_recent", "message": "O Shazam acabou de confirmar este disco.", "state": self.state()}
        self.playback.set_identifying()
        import struct
        import math
        rms = 0.0
        if len(audio_bytes) >= 2:
            count = len(audio_bytes) // 2
            try:
                shorts = struct.unpack(f"<{count}h", audio_bytes[:count*2])
                sum_squares = sum((s / 32768.0) ** 2 for s in shorts)
                rms = math.sqrt(sum_squares / count)
            except Exception as e:
                print(f"[RECOGNIZE] Error calculating RMS: {e}")
        print(f"[RECOGNIZE] Received audio data: {len(audio_bytes)} bytes, filename: {filename}, RMS Volume: {rms:.5f}")
        active_before = self.playback.active.match.release.release_id if self.playback.active else None
        if rms < 0.015:
            self.playback.set_listening()
            print("[RECOGNIZE] Audio volume is too low, skipping recognition.")
            self._log_event("too_quiet", rms=rms, active_release_id=active_before)
            return {"status": "no_result", "message": "Áudio muito silencioso"}
        try:
            recognition = self.shazam_client.recognize(audio_bytes, filename=filename)
        except ShazamBudgetExceeded as error:
            self.playback.set_listening()
            print(f"[RECOGNIZE] {error}")
            self._log_event("budget_exceeded", rms=rms, active_release_id=active_before, detail=str(error))
            return {"status": "budget_exceeded", "message": str(error)}
        except ShazamQuotaExhausted as error:
            self.playback.set_listening()
            print(f"[RECOGNIZE] {error}")
            self._log_event("quota_exhausted", rms=rms, active_release_id=active_before, detail=str(error))
            return {"status": "quota_exhausted", "message": str(error)}
        except Exception as error:
            self.playback.set_listening()
            print(f"[RECOGNIZE] Recognition client raised exception: {error}")
            self._log_event("error", shazam_called=True, rms=rms, active_release_id=active_before, detail=str(error)[:300])
            return {
                "status": "recognition_unavailable",
                "message": str(error),
            }
        shazam_key = getattr(self.shazam_client, "last_key_label", None)
        if recognition is None:
            self.playback.set_listening()
            print("[RECOGNIZE] Recognition returned no result (music not recognized).")
            self._log_event("no_result", shazam_called=True, shazam_key=shazam_key, rms=rms, active_release_id=active_before)
            return {"status": "no_result"}

        print(f"[RECOGNIZE] Recognized: '{recognition.title}' by '{recognition.artist}' (album: '{recognition.album or ''}', confidence: {recognition.confidence})")
        active_release_id = None
        is_locked = False
        if self.playback.active and self.playback.active.match:
            active_release_id = self.playback.active.match.release.release_id
            is_locked = getattr(self.playback.active, "locked", False)

        track_key = preference_key(recognition.title, recognition.artist)
        preferred_release_id = self.store.get_preferred_release(track_key)
        matches = self.matcher.match_all(
            recognition,
            active_release_id=active_release_id,
            preferred_release_id=preferred_release_id,
        )
        if is_locked and active_release_id:
            locked_match = next((m for m in matches if m.release.release_id == active_release_id), None)
            if locked_match is not None:
                match = locked_match
                alternatives = []
            else:
                match = matches[0] if matches else None
                alternatives = matches[1:] if len(matches) > 1 else []
        else:
            match = matches[0] if matches else None
            alternatives = matches[1:] if len(matches) > 1 else []
        recognition_payload = {
            "title": recognition.title,
            "artist": recognition.artist,
            "album": recognition.album,
            "provider": recognition.provider,
            "confidence": recognition.confidence,
        }
        offset = 0.0
        if recognition.raw and "matches" in recognition.raw:
            matches_raw = recognition.raw["matches"]
            if matches_raw and isinstance(matches_raw, list) and len(matches_raw) > 0:
                offset = float(matches_raw[0].get("offset", 0.0))

        if match is None:
            self.playback.handle_not_found(
                title=recognition.title,
                artist=recognition.artist,
            )
            print(f"[RECOGNIZE] Track not found in local Discogs collection database.")
            self._log_event(
                "not_found", shazam_called=True, shazam_key=shazam_key, rms=rms,
                title=recognition.title, artist=recognition.artist, active_release_id=active_before,
            )
            return {
                "status": "not_found",
                "recognition": recognition_payload,
            }

        import time
        now_recon = time.time()
        latency = 0.0
        if client_elapsed_seconds is not None:
            # Add an extra 4.0 seconds constant adjustment to align the player perfectly with the physical turntable
            latency = client_elapsed_seconds + (now_recon - server_receive_time) + 4.0
            print(f"[RECOGNIZE] Latency compensation: client_elapsed={client_elapsed_seconds:.2f}s, server_processing={now_recon - server_receive_time:.2f}s, total_latency={latency:.2f}s (including 4.0s constant offset)")
        
        # Só sugere outros discos que têm exatamente a mesma faixa (sem "Help" x "Help Me Rhonda")
        alternatives = [alt for alt in alternatives if "track title exact" in alt.reason]
        use_preference = preferred_release_id is not None and match.release.release_id == preferred_release_id
        self.playback.handle_match(
            match,
            offset=offset,
            latency=latency,
            alternatives=alternatives,
            locked=use_preference,
            recognition_key=track_key,
        )
        self._learn_missing_duration(match, recognition)
        self._log_event(
            "matched", shazam_called=True, shazam_key=shazam_key, rms=rms,
            title=recognition.title, artist=recognition.artist,
            release_id=match.release.release_id, track_position=match.track.position,
            score=match.score, active_release_id=active_before,
        )
        print(f"[RECOGNIZE] Match found in local collection! release: '{match.release.title}', track: '{match.track.title}' (score: {match.score}, reason: {match.reason}, offset: {offset}s, latency_compensated: {latency:.2f}s, alternatives: {len(alternatives)})")
        return {
            "status": "matched",
            "match": match.to_dict(),
            "recognition": recognition_payload,
        }

    @staticmethod
    def _start_daemon_thread(target: Any) -> None:
        import threading

        threading.Thread(target=target, daemon=True).start()

    def _learn_missing_duration(self, match: Any, recognition: Any) -> None:
        """Se a faixa reconhecida não tem duração no Discogs, busca pelo ISRC (que o Shazam
        devolve) no MusicBrainz em segundo plano e grava no catálogo para as próximas vezes."""
        if match.track.duration_seconds:
            return
        isrc = str(((recognition.raw or {}).get("track") or {}).get("isrc") or "").strip()
        if not isrc:
            return
        key = (match.release.release_id, match.track.position)
        if key in self._duration_lookups_in_flight:
            return
        self._duration_lookups_in_flight.add(key)

        def lookup() -> None:
            try:
                seconds = self.musicbrainz_client.recording_length_by_isrc(isrc)
                if seconds and 20 <= seconds <= 30 * 60:
                    if self.store.update_track_duration(key[0], key[1], seconds):
                        print(f"[DURATION] Learned {seconds}s for release {key[0]} track {key[1]} via ISRC {isrc}")
                else:
                    print(f"[DURATION] No usable MusicBrainz duration for ISRC {isrc}")
            except Exception as error:
                print(f"[DURATION] Lookup failed for ISRC {isrc}: {error}")
            finally:
                self._duration_lookups_in_flight.discard(key)

        self._run_in_background(lookup)

    def list_admin_releases(self) -> list[dict[str, Any]]:
        releases = self.store.list_releases_with_stats()
        overrides = self.store.list_overrides()
        result = []
        for r in releases:
            item = r.to_dict()
            if r.release_id in overrides:
                item["vinyl_override_id"] = overrides[r.release_id]  # v4.3: edição em vinil escolhida aqui
            result.append(item)
        return result

    def _generate_and_save_weekly_agenda(self) -> list[int]:
        releases = self.store.list_releases_with_stats()
        if not releases:
            return []
        
        # Prioritize unplayed (auditions == 0)
        unplayed = [r for r in releases if r.auditions == 0]
        played = sorted([r for r in releases if r.auditions > 0], key=lambda x: x.auditions)
        
        import random
        pool = list(unplayed)
        random.shuffle(pool)
        
        if len(pool) < 7:
            remaining_count = 7 - len(pool)
            low_played = played[:remaining_count * 4]
            random.shuffle(low_played)
            pool.extend(low_played[:remaining_count])
            
        # De-duplicate
        unique_pool = []
        seen_ids = set()
        for r in pool:
            if r.release_id not in seen_ids:
                unique_pool.append(r)
                seen_ids.add(r.release_id)
                
        # Fill up if collection is very small
        if len(unique_pool) < 7:
            while len(unique_pool) < 7 and releases:
                random_r = random.choice(releases)
                unique_pool.append(random_r)
                
        agenda_releases = unique_pool[:7]
        agenda_ids = [r.release_id for r in agenda_releases]
        
        import json
        self.store.set_metadata("weekly_agenda_ids", json.dumps(agenda_ids))
        return agenda_ids

    def get_weekly_agenda(self) -> list[dict[str, Any]]:
        from datetime import datetime, timedelta, timezone
        import json
        
        # Brasilia Time (UTC-3)
        tz_brt = timezone(timedelta(hours=-3))
        now = datetime.now(tz_brt)
        # Sunday is the start of the week: (weekday + 1) % 7 calculates days since Sunday
        days_since_sunday = (now.weekday() + 1) % 7
        start_of_week = now - timedelta(days=days_since_sunday)
        current_week_key = start_of_week.strftime("%Y-%m-%d")

        saved_week_key = self.store.get_metadata("weekly_agenda_week_key")
        saved_ids_str = self.store.get_metadata("weekly_agenda_ids")
        
        agenda_ids = []
        if saved_ids_str:
            try:
                agenda_ids = json.loads(saved_ids_str)
            except Exception:
                pass
                
        # If the week changed, or if there's no valid agenda, generate a new one
        if saved_week_key != current_week_key or not agenda_ids or len(agenda_ids) != 7 or not isinstance(agenda_ids, list):
            agenda_ids = self._generate_and_save_weekly_agenda()
            self.store.set_metadata("weekly_agenda_week_key", current_week_key)
            
            # Save the automatically generated agenda to historical_agendas so it shows in history
            hist_str = self.store.get_metadata("historical_agendas")
            historical = {}
            if hist_str:
                try:
                    historical = json.loads(hist_str)
                except Exception:
                    pass
            historical[current_week_key] = agenda_ids
            self.store.set_metadata("historical_agendas", json.dumps(historical))
            
        all_releases = {r.release_id: r for r in self.store.list_releases_with_stats()}
        
        # If any of the IDs are not found in current releases (e.g. deleted), regenerate to keep it healthy
        if any(aid not in all_releases for aid in agenda_ids):
            agenda_ids = self._generate_and_save_weekly_agenda()
            self.store.set_metadata("weekly_agenda_week_key", current_week_key)
            
            hist_str = self.store.get_metadata("historical_agendas")
            historical = {}
            if hist_str:
                try:
                    historical = json.loads(hist_str)
                except Exception:
                    pass
            historical[current_week_key] = agenda_ids
            self.store.set_metadata("historical_agendas", json.dumps(historical))
            
        agenda_releases = []
        for aid in agenda_ids:
            r = all_releases.get(aid)
            if r:
                agenda_releases.append(r.to_dict())
                
        return agenda_releases

    def get_listening_history(self) -> list[dict[str, Any]]:
        """Build a visual history of past weekly agendas with listening progress."""
        import json
        from datetime import datetime, timedelta, timezone
        
        hist_str = self.store.get_metadata("historical_agendas")
        if not hist_str:
            return []
        
        try:
            historical = json.loads(hist_str)
        except Exception:
            return []
        
        if not historical:
            return []
        
        all_releases = {r.release_id: r for r in self.store.list_releases_with_stats()}
        
        # Current week key (to tag the active week) in Brasilia timezone (UTC-3)
        tz_brt = timezone(timedelta(hours=-3))
        now = datetime.now(tz_brt)
        days_since_sunday = (now.weekday() + 1) % 7
        current_week_start = now - timedelta(days=days_since_sunday)
        current_week_key = current_week_start.strftime("%Y-%m-%d")
        
        result = []
        for week_key, ids in sorted(historical.items(), reverse=True):
            try:
                week_start = datetime.strptime(week_key, "%Y-%m-%d")
            except ValueError:
                continue
            
            week_end = week_start + timedelta(days=6)
            week_start_str = week_start.strftime("%Y-%m-%d")
            week_end_str = week_end.strftime("%Y-%m-%d")
            
            releases_data = []
            listened_count = 0
            
            for rid in ids:
                release = all_releases.get(rid)
                if not release:
                    releases_data.append({
                        "id": rid,
                        "title": "Removido",
                        "artist": "",
                        "cover_url": "",
                        "listened": False,
                    })
                    continue
                
                # Check if any listen_date falls within this week's range
                listened = False
                if release.listen_dates:
                    for ld in release.listen_dates:
                        try:
                            # listen_dates are ISO format: "2026-07-01T12:34:56.789Z"
                            listen_date = ld[:10]  # extract YYYY-MM-DD
                            if week_start_str <= listen_date <= week_end_str:
                                listened = True
                                break
                        except (ValueError, IndexError):
                            continue
                
                if listened:
                    listened_count += 1
                
                releases_data.append({
                    "id": release.release_id,
                    "title": release.title,
                    "artist": release.artist,
                    "cover_url": release.cover_url,
                    "listened": listened,
                })
            
            result.append({
                "week_key": week_key,
                "week_start": week_start.strftime("%d %b"),
                "week_end": week_end.strftime("%d %b"),
                "is_current": week_key == current_week_key,
                "releases": releases_data,
                "listened_count": listened_count,
                "total": len(ids),
            })
        
        return result



    def add_manual_release(
        self,
        title: str,
        artist: str,
        year: int | None,
        cover_url: str,
        labels: list[str] = None,
        catalog_numbers: list[str] = None,
        genres: list[str] = None,
        styles: list[str] = None,
        notes: str = "",
        rating: int = 0,
        favorite: bool = False,
        original_year: int | None = None,
        edition_year: int | None = None,
    ) -> dict[str, Any]:
        release = self.store.add_manual_release(
            title=title,
            artist=artist,
            year=year,
            cover_url=cover_url,
            labels=labels,
            catalog_numbers=catalog_numbers,
            genres=genres,
            styles=styles,
            notes=notes,
            rating=rating,
            favorite=favorite,
            original_year=original_year,
            edition_year=edition_year,
        )
        return {"status": "ok", "release": release.to_dict()}

    def update_release_rating(self, release_id: int, rating: int) -> dict[str, Any]:
        self.store.update_rating(release_id, rating)
        return {"status": "ok"}

    def increment_release_auditions(self, release_id: int) -> dict[str, Any]:
        count = self.store.increment_auditions(release_id)
        return {"status": "ok", "auditions": count}

    def decrement_release_auditions(self, release_id: int) -> dict[str, Any]:
        count = self.store.decrement_auditions(release_id)
        return {"status": "ok", "auditions": count}

    def update_release_details(
        self,
        release_id: int,
        title: str,
        artist: str,
        year: int | None,
        cover_url: str,
        genres: list[str],
        styles: list[str],
        labels: list[str],
        catalog_numbers: list[str],
        notes: str,
        rating: int,
        original_year: int | None = None,
        edition_year: int | None = None,
    ) -> dict[str, Any]:
        self.store.update_release_details(
            release_id=release_id,
            title=title,
            artist=artist,
            year=year,
            cover_url=cover_url,
            genres=genres,
            styles=styles,
            labels=labels,
            catalog_numbers=catalog_numbers,
            notes=notes,
            rating=rating,
            original_year=original_year,
            edition_year=edition_year,
        )
        return {"status": "ok"}

    def delete_release(self, release_id: int) -> dict[str, Any]:
        self.store.delete_release(release_id)
        return {"status": "ok"}

    def toggle_favorite(self, release_id: int) -> dict[str, Any]:
        favorite = self.store.toggle_favorite(release_id)
        return {"status": "ok", "favorite": favorite}

    def switch_playback_release(self, release_id: int) -> dict[str, Any]:
        previous = self.playback.active
        old_release_id = previous.match.release.release_id if previous else None
        already_counted = bool(previous and previous.scrobbled)
        track_key = previous.recognition_key if previous else ""
        success = self.playback.switch_release(release_id, self.store)
        if not success:
            return {"status": "error", "message": "Não foi possível alternar o disco ativo"}
        # A audição já contada vai junto para o disco certo
        if already_counted and old_release_id is not None and old_release_id != release_id:
            self.store.decrement_auditions(old_release_id)
            self.store.increment_auditions(release_id)
            self.playback.active.scrobbled = True
        self.playback.active.recognition_key = track_key
        self.store.save_preferred_release(track_key, release_id)
        self._save_playback(self.playback)
        return {"status": "ok", "state": self.state()}

    def release_sides(self, release_id: int) -> dict[str, Any] | None:
        """Lados do disco com a primeira faixa de cada um (para escolher o disco à mão)."""
        from vinyl_display.playback import get_track_side

        release = self.store.get_release(release_id)
        if release is None:
            return None
        sides: list[dict[str, Any]] = []
        seen: set[str] = set()
        for track in release.tracks:
            side = get_track_side(track.position)
            if side and side not in seen:
                seen.add(side)
                sides.append({"side": side, "position": track.position, "title": track.title})
        if not sides and release.tracks:
            first = release.tracks[0]
            sides.append({"side": "", "position": first.position, "title": first.title})
        return {"release_id": release.release_id, "title": release.title, "artist": release.artist, "sides": sides}

    def start_manual_playback(self, release_id: int, side: str = "") -> dict[str, Any]:
        """Plano B sem Shazam: você escolhe o disco e o lado; o tempo começa agora (a agulha
        acabou de descer) e o detector de silêncio acompanha faixas e viradas a partir daí."""
        import time

        from vinyl_display.models import TrackMatch
        from vinyl_display.playback import get_track_side

        release = self.store.get_release(release_id)
        if release is None or not release.tracks:
            return {"status": "error", "message": "Disco não encontrado ou sem faixas."}
        track = next((t for t in release.tracks if side and get_track_side(t.position) == side), release.tracks[0])
        now = time.time()
        self.playback.handle_match(
            TrackMatch(release=release, track=track, score=100, reason="manual"),
            now=now,
            alternatives=[],
            locked=True,
        )
        self._log_event("manual_start", release_id=release.release_id, track_position=track.position)
        return {"status": "ok", "state": self.state()}

    def keep_playback_release(self) -> dict[str, Any]:
        """'Manter este disco': trava e lembra a escolha para a próxima vez."""
        if not self.playback.keep_current():
            return {"status": "error", "message": "Nenhum disco tocando"}
        active = self.playback.active
        self.store.save_preferred_release(active.recognition_key, active.match.release.release_id)
        return {"status": "ok", "state": self.state()}

    def stop_playback(self) -> dict[str, Any]:
        self.playback.stop()
        return {"status": "ok", "state": self.state()}


