from __future__ import annotations

from typing import Any

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import AudDClient
from vinyl_display.clients.shazam import ShazamClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.matcher import CollectionMatcher
from vinyl_display.playback import PlaybackController


class VinylDisplayApp:
    def __init__(
        self,
        store: CatalogStore,
        discogs_client: DiscogsClient,
        audd_client: AudDClient | ShazamClient | Any,
    ):
        self.store = store
        self.discogs_client = discogs_client
        self.audd_client = audd_client
        self.matcher = CollectionMatcher(store)
        self.playback = PlaybackController()
        self.store.initialize()

    def state(self) -> dict[str, Any]:
        state = self.playback.current_state()
        state["collection_count"] = self.store.collection_count()
        state["last_sync_at"] = self.store.get_metadata("discogs_last_sync_at")
        return state

    def sync_collection(self) -> dict[str, Any]:
        try:
            count = self.discogs_client.sync_collection(self.store)
        except Exception as error:
            return {
                "status": "error",
                "message": str(error),
                "collection_count": self.store.collection_count(),
            }
        return {"status": "ok", "count": count}

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
        try:
            recognition = self.audd_client.recognize(audio_bytes, filename=filename)
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
        match = self.matcher.match(recognition)
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
        )
        return {"status": "ok", "release": release.to_dict()}

    def update_release_rating(self, release_id: int, rating: int) -> dict[str, Any]:
        self.store.update_rating(release_id, rating)
        return {"status": "ok"}

    def increment_release_auditions(self, release_id: int) -> dict[str, Any]:
        count = self.store.increment_auditions(release_id)
        return {"status": "ok", "auditions": count}

    def update_release_details(
        self,
        release_id: int,
        title: str,
        artist: str,
        year: int | None,
        genres: list[str],
        styles: list[str],
        labels: list[str],
        catalog_numbers: list[str],
        notes: str,
        rating: int,
    ) -> dict[str, Any]:
        self.store.update_release_details(
            release_id=release_id,
            title=title,
            artist=artist,
            year=year,
            genres=genres,
            styles=styles,
            labels=labels,
            catalog_numbers=catalog_numbers,
            notes=notes,
            rating=rating,
        )
        return {"status": "ok"}

    def delete_release(self, release_id: int) -> dict[str, Any]:
        self.store.delete_release(release_id)
        return {"status": "ok"}

    def toggle_favorite(self, release_id: int) -> dict[str, Any]:
        favorite = self.store.toggle_favorite(release_id)
        return {"status": "ok", "favorite": favorite}


