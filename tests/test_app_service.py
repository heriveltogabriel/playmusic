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
        return {
            "count": 1,
            "added": 1,
            "updated": 0,
            "deleted": 0,
        }


class FailingDiscogsClient:
    def sync_collection(self, store):
        raise RuntimeError("Discogs unavailable")


class FakeShazamClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        self.audio_bytes = audio_bytes
        self.filename = filename
        return RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="shazam",
            confidence=0.92,
        )


class EmptyShazamClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        return RecognitionResult(
            title="Outside Song",
            artist="Outside Artist",
            album=None,
            provider="shazam",
            confidence=0.9,
        )


class FailingShazamClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        raise RuntimeError("RAPIDAPI_SHAZAM_KEY is required for Shazam recognition")


class AppServiceTests(unittest.TestCase):
    def test_sync_collection_returns_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeShazamClient())

            response = app.sync_collection()

            self.assertEqual(response["count"], 1)
            self.assertEqual(response["status"], "ok")

    def test_sync_collection_returns_structured_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FailingDiscogsClient(), FakeShazamClient())

            response = app.sync_collection()

            self.assertEqual(response["status"], "error")
            self.assertEqual(response["collection_count"], 0)
            self.assertIn("Discogs unavailable", response["message"])

    def test_recognize_audio_sets_playing_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeShazamClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")
            state = app.state()

            self.assertEqual(response["status"], "matched")
            self.assertEqual(state["status"], "playing")
            self.assertEqual(state["track"]["title"], "Come Together")

    def test_recognize_audio_not_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), EmptyShazamClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")

            self.assertEqual(response["status"], "not_found")
            self.assertIn("Disco não encontrado", app.state()["message"])

    def test_recognize_audio_returns_to_listening_when_provider_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FailingShazamClient())

            response = app.recognize_audio(b"audio-data", filename="clip.webm")
            state = app.state()

            self.assertEqual(response["status"], "recognition_unavailable")
            self.assertEqual(state["status"], "listening")
            self.assertIn("RAPIDAPI_SHAZAM_KEY", response["message"])

    def test_recognize_audio_too_quiet_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeShazamClient())
            app.sync_collection()

            response = app.recognize_audio(b"\x00\x00\x00\x00\x00\x00\x00\x00", filename="clip.webm")
            state = app.state()

            self.assertEqual(response["status"], "no_result")
            self.assertEqual(response["message"], "Áudio muito silencioso")
            self.assertEqual(state["status"], "listening")

    def test_increment_and_decrement_release_auditions(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeShazamClient())
            app.sync_collection()

            incremented = app.increment_release_auditions(14192689)
            decremented = app.decrement_release_auditions(14192689)
            decremented_again = app.decrement_release_auditions(14192689)

            self.assertEqual(incremented, {"status": "ok", "auditions": 1})
            self.assertEqual(decremented, {"status": "ok", "auditions": 0})
            self.assertEqual(decremented_again, {"status": "ok", "auditions": 0})

    def test_weekly_agenda_generation_and_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeShazamClient())
            
            # Populate with 10 releases
            for i in range(10):
                store.add_manual_release(
                    title=f"LP {i}",
                    artist="Artist",
                    year=2020 + i,
                    cover_url=""
                )
                
            agenda1 = app.get_weekly_agenda()
            self.assertEqual(len(agenda1), 7)
            
            # Fetching again should return the exact same LPs in the same order
            agenda2 = app.get_weekly_agenda()
            self.assertEqual([r["release_id"] for r in agenda1], [r["release_id"] for r in agenda2])
            
            # If one is deleted, it should automatically regenerate a new healthy one
            deleted_id = agenda1[0]["release_id"]
            app.delete_release(deleted_id)
            
            agenda3 = app.get_weekly_agenda()
            self.assertEqual(len(agenda3), 7)
            self.assertNotIn(deleted_id, [r["release_id"] for r in agenda3])



if __name__ == "__main__":
    unittest.main()
