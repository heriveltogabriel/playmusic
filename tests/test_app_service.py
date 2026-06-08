import tempfile
import unittest
from pathlib import Path

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.models import RecognitionResult, Release, Track


class FakeDiscogsClient:
    def sync_collection(self, store):
        store.upsert_release(
            Release(
                release_id=14192689,
                title="Abbey Road",
                artist="The Beatles",
                year=2019,
                cover_url="https://example.test/cover.jpg",
                country="US",
                labels=["Apple Records"],
                catalog_numbers=["B0030719-01"],
                formats=["Vinyl", "LP"],
                tracks=[Track("A1", "Come Together", 261)],
                discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
            )
        )
        return 1


class FakeAudDClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        self.audio_bytes = audio_bytes
        self.filename = filename
        return RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="audd",
            confidence=0.92,
        )


class EmptyAudDClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        return RecognitionResult(
            title="Outside Song",
            artist="Outside Artist",
            album=None,
            provider="audd",
            confidence=0.9,
        )


class AppServiceTests(unittest.TestCase):
    def test_sync_collection_returns_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeAudDClient())

            response = app.sync_collection()

            self.assertEqual(response["count"], 1)
            self.assertEqual(response["status"], "ok")

    def test_recognize_audio_sets_playing_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeAudDClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")
            state = app.state()

            self.assertEqual(response["status"], "matched")
            self.assertEqual(state["status"], "playing")
            self.assertEqual(state["track"]["title"], "Come Together")

    def test_recognize_audio_not_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), EmptyAudDClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")

            self.assertEqual(response["status"], "not_found")
            self.assertIn("Disco não encontrado", app.state()["message"])


if __name__ == "__main__":
    unittest.main()
