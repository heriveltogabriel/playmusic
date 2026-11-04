from __future__ import annotations

import re
import time
from dataclasses import dataclass, replace, field
from typing import Any, Callable

from vinyl_display.models import Release, Track, TrackMatch


@dataclass
class ActivePlayback:
    match: TrackMatch
    started_at: float
    played_tracks: set[str] = field(default_factory=set)
    scrobbled: bool = False
    locked: bool = False
    anchored_at: float = 0.0  # última vez que o tempo foi confirmado (Shazam, pausa entre faixas ou virada)
    recognition_key: str = ""  # música reconhecida (título|artista), para lembrar o disco escolhido


# Prefixos de disco usados pelo Discogs em LPs duplos/box sets: "LP-A1", "LP1-B2", "Disc 2-C1", "1-A1"
_DISC_PREFIX_RE = re.compile(
    r"^(?:(?:LP|CD|DISC|DISCO|VINYL|DVD)\s*\d*|\d+\"?)\s*[-.:/]\s*(?=[A-Z])"
)

# Numeração de CD/disco sem lado: "CD1-1", "Disc 2-03"
_DISC_TRACK_NUMBER_RE = re.compile(r"^(?:LP|CD|DISC|DISCO|VINYL|DVD)\s*\d*\s*[-.:/]\s*\d")


def get_track_side(position: str) -> str:
    """Retorna o lado do vinil ("A", "B", "AA"...) a partir da posição da faixa no Discogs.

    Posições puramente numéricas ("1", "12", "1-3") não indicam lado e retornam "".
    """
    if not position:
        return ""
    pos = position.strip().upper()
    if pos.startswith("SIDE "):
        return pos
    if _DISC_TRACK_NUMBER_RE.match(pos):
        return ""
    pos = _DISC_PREFIX_RE.sub("", pos)
    side = ""
    for char in pos:
        if char.isalpha():
            side += char
        else:
            break
    return side


class PlaybackController:
    # Tolerância para aceitar uma pausa como início de faixa (segundos)
    BOUNDARY_TOLERANCE = 25
    # Uma pausa ainda não confirmada só conta como "perdida" depois deste atraso
    BOUNDARY_GRACE = 30
    GAP_SECONDS = 3

    def __init__(
        self,
        on_scrobble: Callable[[int], Any] | None = None,
        on_change: Callable[["PlaybackController"], Any] | None = None,
    ):
        self.on_change = on_change
        self.active: ActivePlayback | None = None
        self.status = "listening"
        self.message = ""
        self.last_recognition: dict[str, Any] | None = None
        self.on_scrobble = on_scrobble
        self.alternatives: list[TrackMatch] = []

    def _changed(self) -> None:
        if self.on_change:
            try:
                self.on_change(self)
            except Exception as error:
                print(f"[PLAYBACK] Could not persist playback state: {error}")

    def handle_match(
        self,
        match: TrackMatch,
        offset: float = 0.0,
        now: float | None = None,
        latency: float = 0.0,
        alternatives: list[TrackMatch] | None = None,
        locked: bool = False,
        recognition_key: str = "",
    ) -> None:
        now = now or time.time()
        started_at = now - offset - latency

        is_same_release = (
            self.active is not None
            and self.active.match.release.release_id == match.release.release_id
        )
        is_locked = (is_same_release and getattr(self.active, "locked", False)) or locked

        if is_locked:
            self.alternatives = []
        elif alternatives is not None:
            self.alternatives = [a for a in alternatives if a.release.release_id != match.release.release_id]

        if is_same_release and self.active is not None:
            self.active = replace(
                self.active,
                match=match,
                started_at=started_at,
                locked=is_locked,
                anchored_at=now,
                recognition_key=recognition_key or self.active.recognition_key,
            )
        else:
            self.active = ActivePlayback(
                match=match,
                started_at=started_at,
                played_tracks=set(),
                scrobbled=False,
                locked=is_locked,
                anchored_at=now,
                recognition_key=recognition_key,
            )
        self.status = "playing"
        self.message = ""
        self._changed()

    def handle_not_found(self, title: str, artist: str, now: float | None = None) -> None:
        self.last_recognition = {
            "title": title,
            "artist": artist,
            "at": now or time.time(),
        }
        if self.active is None:
            self.status = "not_found"
            self.message = (
                "Disco não encontrado na sua coleção. "
                "Cadastre no Discogs e sincronize novamente."
            )

    def set_identifying(self) -> None:
        self.status = "identifying"
        self.message = "Identificando trecho..."

    def set_listening(self) -> None:
        if self.status != "playing":
            self.status = "listening"
            self.message = ""

    def _record_played_tracks(self, now: float) -> Track | None:
        if self.active is None:
            return None
        release = self.active.match.release
        track, _, _, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        if track:
            try:
                start_index = release.tracks.index(self.active.match.track)
                end_index = release.tracks.index(track)
                for t in release.tracks[start_index:end_index + 1]:
                    self.active.played_tracks.add(t.position)
            except ValueError:
                self.active.played_tracks.add(track.position)
        return track

    def current_state(self, now: float | None = None) -> dict[str, Any]:
        now = now or time.time()
        if self.active is None:
            return {
                "status": self.status,
                "message": self.message,
                "release": None,
                "track": None,
                "next_track": None,
                "progress_seconds": None,
                "duration_seconds": None,
                "last_recognition": self.last_recognition,
                "alternatives": [],
            }

        release = self.active.match.release
        track = self._record_played_tracks(now)
        _, progress, is_side_finished, overtime = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        if len(self.active.played_tracks) > 1 and not self.active.scrobbled:
            self.active.scrobbled = True
            self._changed()
            if self.on_scrobble:
                try:
                    self.on_scrobble(release.release_id)
                except Exception as e:
                    print(f"[PLAYBACK] Error automatically registering audition for release {release.release_id}: {e}")

        next_track = self._next_track(release, track)
        extra = self._timeline_extras(now)

        if is_side_finished:
            # Se já passou o tempo limite em repouso após terminar o lado ou disco,
            # encerramos a sessão e voltamos automaticamente ao estado inicial (listening)
            flip_timeout = 300 if next_track else 180  # 5 min para virar lado, 3 min para fim do disco
            if overtime >= flip_timeout:
                self.stop()
                return self.current_state(now)

        alternatives_payload = [
            {
                "release_id": alt.release.release_id,
                "title": alt.release.title,
                "artist": alt.release.artist,
                "year": alt.release.year,
                "cover_url": alt.release.cover_url,
                "track_position": alt.track.position,
                "track_title": alt.track.title,
                "score": alt.score,
            }
            for alt in self.alternatives
        ]

        if is_side_finished:
            curr_side = get_track_side(track.position)
            if next_track:
                next_side = get_track_side(next_track.position)
                msg = f"Fim do Lado {curr_side}. Por favor, vire o disco para o Lado {next_side}!"
            else:
                msg = "Fim do disco! Por favor, recoloque o vinil ou troque de álbum."

            return {
                "status": "waiting_flip",
                "message": msg,
                "release": release.to_dict(),
                "track": track.to_dict(),
                "next_track": None if next_track is None else next_track.to_dict(),
                "progress_seconds": progress,
                "duration_seconds": track.duration_seconds or 180,
                "duration_estimated": not track.duration_seconds,
                "last_recognition": self.last_recognition,
                "alternatives": alternatives_payload,
                **extra,
            }

        return {
            "status": "playing",
            "message": "",
            "release": release.to_dict(),
            "track": track.to_dict(),
            "next_track": None if next_track is None else next_track.to_dict(),
            "progress_seconds": progress,
            "duration_seconds": track.duration_seconds or 180,
            "duration_estimated": not track.duration_seconds,
            "last_recognition": self.last_recognition,
            "alternatives": alternatives_payload,
            **extra,
        }

    def refresh_release(self, latest: Release) -> None:
        """Troca o disco ativo pela versão mais recente do banco (ex.: duração aprendida ou
        edição no admin), remapeando a faixa ativa pela posição. Sem isso a faixa antiga
        deixa de existir em release.tracks e o avanço automático para de funcionar."""
        if self.active is None or self.active.match.release.release_id != latest.release_id:
            return
        if self.active.match.release == latest:
            return
        old_track = self.active.match.track
        new_track = next((t for t in latest.tracks if t.position == old_track.position), None)
        if new_track is None:
            new_track = next((t for t in latest.tracks if t.title == old_track.title), old_track)
        self.active.match = replace(self.active.match, release=latest, track=new_track)

    def keep_current(self) -> bool:
        """'Manter este disco': trava o disco atual e esconde as alternativas."""
        if self.active is None:
            return False
        self.active.locked = True
        self.alternatives = []
        self._changed()
        return True

    def switch_release(self, release_id: int, store: Any) -> bool:
        if self.active is None:
            return False

        target_match = next((alt for alt in self.alternatives if alt.release.release_id == release_id), None)
        if target_match is None:
            target_release = store.get_release(release_id)
            if not target_release:
                return False
            curr_title = self.active.match.track.title.strip().lower()
            matching_track = next((t for t in target_release.tracks if t.title.strip().lower() == curr_title), None)
            if not matching_track and target_release.tracks:
                matching_track = target_release.tracks[0]
            target_match = TrackMatch(
                release=target_release,
                track=matching_track or self.active.match.track,
                score=100,
                reason="user switch",
            )

        # Clear alternatives so the button disappears and the album is locked
        self.alternatives = []

        self.active = replace(
            self.active,
            match=target_match,
            played_tracks={target_match.track.position},
            scrobbled=False,
            locked=True,
        )
        self._changed()
        return True

    # ------------------------------------------------------------------ v3.5
    def _side_timeline(self, release: Release, initial_track: Track) -> tuple[list[tuple[float, Track]], float]:
        """Início de cada faixa (segundos desde started_at) no lado da faixa inicial, e o fim do lado.
        Segue o mesmo modelo de _track_at_elapsed: duração do Discogs (ou 180 s) + 3 s de pausa."""
        try:
            start_index = release.tracks.index(initial_track)
        except ValueError:
            return [(0.0, initial_track)], float(initial_track.duration_seconds or 180)
        side = get_track_side(initial_track.position)
        timeline: list[tuple[float, Track]] = []
        cursor = 0.0
        for i, track in enumerate(release.tracks[start_index:]):
            track_side = get_track_side(track.position)
            if side and track_side and track_side != side:
                break
            if i > 0:
                cursor += self.GAP_SECONDS
            timeline.append((cursor, track))
            cursor += track.duration_seconds or 180
        return timeline, cursor

    def _timeline_extras(self, now: float) -> dict[str, Any]:
        """Dados para o detector de silêncio do celular decidir sem chamar o Shazam."""
        if self.active is None:
            return {}
        elapsed = now - self.active.started_at
        timeline, side_end = self._side_timeline(self.active.match.release, self.active.match.track)
        anchored_elapsed = (self.active.anchored_at or self.active.started_at) - self.active.started_at
        unconfirmed = sum(
            1 for start, _ in timeline if anchored_elapsed + 1 < start <= elapsed - self.BOUNDARY_GRACE
        )
        return {
            "side_remaining_seconds": round(max(0.0, side_end - elapsed), 1),
            "unconfirmed_boundaries": unconfirmed,
            "seconds_since_anchor": round(now - (self.active.anchored_at or self.active.started_at), 1),
        }

    def align_track_start(self, at: float, now: float | None = None) -> dict[str, Any]:
        """O celular ouviu o som voltar depois de uma pausa curta em `at`. Se isso cair perto do
        início previsto de uma faixa, reancora o tempo nessa faixa (sem chamar o Shazam)."""
        now = now or time.time()
        if self.active is None:
            return {"aligned": False, "reason": "idle"}
        elapsed = at - self.active.started_at
        timeline, _ = self._side_timeline(self.active.match.release, self.active.match.track)
        start, track = min(timeline, key=lambda item: abs(elapsed - item[0]))
        shift = elapsed - start
        if abs(shift) > self.BOUNDARY_TOLERANCE:
            return {"aligned": False, "reason": "far", "nearest": track.position, "offset": round(shift, 1)}
        self.active.started_at += shift
        self.active.anchored_at = at
        self._record_played_tracks(now)
        self._changed()
        return {"aligned": True, "track": track.position, "shift": round(shift, 1)}

    def flip_to_next_side(self, at: float, now: float | None = None) -> dict[str, Any]:
        """O celular ouviu silêncio longo e a agulha voltando no fim de um lado: segue para a
        primeira faixa do próximo lado do mesmo disco, sem chamar o Shazam."""
        now = now or time.time()
        if self.active is None:
            return {"flipped": False, "reason": "idle"}
        release = self.active.match.release
        self._record_played_tracks(now)
        current, _, _, _ = self._track_at_elapsed(
            release, self.active.match.track, int(now - self.active.started_at)
        )
        side = get_track_side(current.position)
        if not side:
            return {"flipped": False, "reason": "no_sides"}
        try:
            index = release.tracks.index(current)
        except ValueError:
            return {"flipped": False, "reason": "unknown_track"}
        first = next(
            (t for t in release.tracks[index + 1:] if get_track_side(t.position) not in ("", side)),
            None,
        )
        if first is None:
            return {"flipped": False, "reason": "last_side"}
        self.active.match = replace(self.active.match, track=first)
        self.active.started_at = at
        self.active.anchored_at = at
        self.active.played_tracks.add(first.position)
        self.alternatives = []
        self.status = "playing"
        self.message = ""
        self._changed()
        return {"flipped": True, "track": first.position}

    def snapshot(self, now: float | None = None) -> dict[str, Any] | None:
        if self.active is None:
            return None
        return {
            "release_id": self.active.match.release.release_id,
            "track_position": self.active.match.track.position,
            "score": self.active.match.score,
            "reason": self.active.match.reason,
            "started_at": self.active.started_at,
            "anchored_at": self.active.anchored_at,
            "played_tracks": sorted(self.active.played_tracks),
            "scrobbled": self.active.scrobbled,
            "locked": self.active.locked,
            "recognition_key": self.active.recognition_key,
            "saved_at": now or time.time(),
        }

    def restore(self, snapshot: dict[str, Any] | None, store: Any, now: float | None = None, max_age: float = 1800) -> bool:
        """Recoloca o disco que tocava antes de um restart, se o estado tiver menos de `max_age` s."""
        now = now or time.time()
        if not snapshot or now - float(snapshot.get("saved_at", 0)) > max_age:
            return False
        release = store.get_release(int(snapshot["release_id"]))
        if release is None:
            return False
        track = next((t for t in release.tracks if t.position == snapshot.get("track_position")), None)
        if track is None:
            return False
        match = TrackMatch(release=release, track=track, score=int(snapshot.get("score") or 100), reason=str(snapshot.get("reason") or "restored"))
        self.active = ActivePlayback(
            match=match,
            started_at=float(snapshot["started_at"]),
            played_tracks=set(snapshot.get("played_tracks") or []),
            scrobbled=bool(snapshot.get("scrobbled")),
            locked=bool(snapshot.get("locked")),
            anchored_at=float(snapshot.get("anchored_at") or snapshot["started_at"]),
            recognition_key=str(snapshot.get("recognition_key") or ""),
        )
        self.status = "playing"
        self.message = ""
        return True

    def _track_at_elapsed(
        self,
        release: Release,
        initial_track: Track,
        elapsed: int,
    ) -> tuple[Track, int, bool, int]:
        try:
            start_index = release.tracks.index(initial_track)
        except ValueError:
            return initial_track, max(0, elapsed), False, 0

        initial_side = get_track_side(initial_track.position)
        remaining = max(0, elapsed)
        last_track_of_side = initial_track
        GAP_SECONDS = 3

        for i, track in enumerate(release.tracks[start_index:]):
            track_side = get_track_side(track.position)

            # Se o lado mudou, significa que completamos todas as faixas do lado anterior
            if initial_side and track_side and track_side != initial_side:
                return last_track_of_side, last_track_of_side.duration_seconds or 180, True, remaining

            track_duration = track.duration_seconds or 180

            # Se não for a primeira faixa da iteração, existe uma pausa de 3s antes dela
            if i > 0:
                if remaining < GAP_SECONDS:
                    # Estamos na pausa de transição; mostramos a faixa anterior concluída
                    return last_track_of_side, last_track_of_side.duration_seconds or 180, False, 0
                remaining -= GAP_SECONDS

            if remaining < track_duration:
                return track, remaining, False, 0

            remaining -= track_duration
            last_track_of_side = track

        # Se completou todas as faixas e ainda sobrou tempo
        return last_track_of_side, last_track_of_side.duration_seconds or 180, True, remaining

    def _next_track(self, release: Release, track: Track) -> Track | None:
        try:
            index = release.tracks.index(track)
        except ValueError:
            return None
        next_index = index + 1
        if next_index >= len(release.tracks):
            return None
        return release.tracks[next_index]

    def skip_next(self, now: float | None = None) -> None:
        if self.active is None:
            return
        now = now or time.time()
        self._record_played_tracks(now)
        release = self.active.match.release
        current_track, _, _, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        next_track = self._next_track(release, current_track)
        if next_track is not None:
            self.active.match = replace(self.active.match, track=next_track)
            self.active.started_at = now
            self.active.anchored_at = now
            self._changed()

    def skip_prev(self, now: float | None = None) -> None:
        if self.active is None:
            return
        now = now or time.time()
        self._record_played_tracks(now)
        release = self.active.match.release
        current_track, progress, _, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )

        if progress > 3:
            self.active.started_at = now
            self.active.anchored_at = now
            self._changed()
            return

        try:
            index = release.tracks.index(current_track)
        except ValueError:
            return

        if index > 0:
            prev_track = release.tracks[index - 1]
            self.active.match = replace(self.active.match, track=prev_track)
            self.active.started_at = now
            self.active.anchored_at = now
            self._changed()

    def stop(self) -> None:
        self.active = None
        self.alternatives = []
        self.status = "listening"
        self.message = ""
        self._changed()

