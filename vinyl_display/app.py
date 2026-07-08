from __future__ import annotations

from typing import Any

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.shazam import ShazamClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.matcher import CollectionMatcher
from vinyl_display.playback import PlaybackController


class VinylDisplayApp:
    def __init__(
        self,
        store: CatalogStore,
        discogs_client: DiscogsClient,
        shazam_client: ShazamClient | Any,
        config: Any = None,
    ):
        self.store = store
        self.store.favorite_threshold = config.favorite_threshold if config else 5
        self.discogs_client = discogs_client
        self.shazam_client = shazam_client
        self.config = config
        self.matcher = CollectionMatcher(store)
        self.playback = PlaybackController(on_scrobble=self.store.increment_auditions)
        self.store.initialize()

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
                if isinstance(orig_val, float):
                    new_fields[field_name] = float(v)
                elif isinstance(orig_val, int):
                    new_fields[field_name] = int(v)
                else:
                    new_fields[field_name] = v
        self.config = dataclasses.replace(self.config, **new_fields)
        
        # Re-initialize clients
        self.discogs_client = DiscogsClient(self.config.discogs_user, self.config.discogs_user_agent)
        self.shazam_client = ShazamClient(self.config.rapidapi_shazam_key, self.config.rapidapi_shazam_host)
        self.store.favorite_threshold = self.config.favorite_threshold
        print("[SERVER] Hot-swapped config to use Shazam for music recognition.")

    def state(self) -> dict[str, Any]:
        state = self.playback.current_state()
        if state.get("release"):
            release_id = state["release"]["release_id"]
            latest_release = self.store.get_release(release_id)
            if latest_release:
                state["release"] = latest_release.to_dict()
                if self.playback.active and self.playback.active.match.release.release_id == release_id:
                    import dataclasses
                    self.playback.active.match = dataclasses.replace(
                        self.playback.active.match,
                        release=latest_release
                    )
        state["collection_count"] = self.store.collection_count()
        state["last_sync_at"] = self.store.get_metadata("discogs_last_sync_at")
        state["lyrics_latency_offset"] = self.config.lyrics_latency_offset if self.config else 1.3
        
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
    ) -> dict[str, Any]:
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
        if rms < 0.015:
            self.playback.set_listening()
            print("[RECOGNIZE] Audio volume is too low, skipping recognition.")
            return {"status": "no_result", "message": "Áudio muito silencioso"}
        try:
            recognition = self.shazam_client.recognize(audio_bytes, filename=filename)
        except Exception as error:
            self.playback.set_listening()
            print(f"[RECOGNIZE] Recognition client raised exception: {error}")
            return {
                "status": "recognition_unavailable",
                "message": str(error),
            }
        if recognition is None:
            self.playback.set_listening()
            print("[RECOGNIZE] Recognition returned no result (music not recognized).")
            return {"status": "no_result"}

        print(f"[RECOGNIZE] Recognized: '{recognition.title}' by '{recognition.artist}' (album: '{recognition.album or ''}', confidence: {recognition.confidence})")
        active_release_id = None
        if self.playback.active and self.playback.active.match:
            active_release_id = self.playback.active.match.release.release_id

        match = self.matcher.match(recognition, active_release_id=active_release_id)
        recognition_payload = {
            "title": recognition.title,
            "artist": recognition.artist,
            "album": recognition.album,
            "provider": recognition.provider,
            "confidence": recognition.confidence,
        }
        offset = 0.0
        if recognition.raw and "matches" in recognition.raw:
            matches = recognition.raw["matches"]
            if matches and isinstance(matches, list) and len(matches) > 0:
                offset = float(matches[0].get("offset", 0.0))

        if match is None:
            self.playback.handle_not_found(
                title=recognition.title,
                artist=recognition.artist,
            )
            print(f"[RECOGNIZE] Track not found in local Discogs collection database.")
            return {
                "status": "not_found",
                "recognition": recognition_payload,
            }

        self.playback.handle_match(match, offset=offset)
        print(f"[RECOGNIZE] Match found in local collection! release: '{match.release.title}', track: '{match.track.title}' (score: {match.score}, reason: {match.reason}, offset: {offset}s)")
        return {
            "status": "matched",
            "match": match.to_dict(),
            "recognition": recognition_payload,
        }

    def list_admin_releases(self) -> list[dict[str, Any]]:
        releases = self.store.list_releases_with_stats()
        return [r.to_dict() for r in releases]

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

