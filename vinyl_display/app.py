from __future__ import annotations

from typing import Any

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import AudDClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.matcher import CollectionMatcher
from vinyl_display.playback import PlaybackController


class VinylDisplayApp:
    def __init__(
        self,
        store: CatalogStore,
        discogs_client: DiscogsClient,
        audd_client: AudDClient,
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
        try:
            recognition = self.audd_client.recognize(audio_bytes, filename=filename)
        except Exception as error:
            self.playback.set_listening()
            return {
                "status": "recognition_unavailable",
                "message": str(error),
            }
        if recognition is None:
            self.playback.set_listening()
            return {"status": "no_result"}

        match = self.matcher.match(recognition)
        recognition_payload = {
            "title": recognition.title,
            "artist": recognition.artist,
            "album": recognition.album,
            "provider": recognition.provider,
            "confidence": recognition.confidence,
        }
        if match is None:
            self.playback.handle_not_found(
                title=recognition.title,
                artist=recognition.artist,
            )
            return {
                "status": "not_found",
                "recognition": recognition_payload,
            }

        self.playback.handle_match(match)
        return {
            "status": "matched",
            "match": match.to_dict(),
            "recognition": recognition_payload,
        }
