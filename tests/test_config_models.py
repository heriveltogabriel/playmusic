import os
import tempfile
import unittest
from pathlib import Path

from vinyl_display.config import load_config
from vinyl_display.models import RecognitionResult, Release, Track


class ConfigAndModelTests(unittest.TestCase):
    def test_load_config_uses_defaults_and_env_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_env = os.environ.copy()
            try:
                os.environ.clear()
                os.environ.update({
                    "VINYL_DATA_DIR": tmp,
                    "VINYL_PORT": "8123",
                    "AUDD_API_TOKEN": "secret-token",
                })

                config = load_config()

                self.assertEqual(config.discogs_user, "heriveltogabriel")
                self.assertEqual(config.port, 8123)
                self.assertEqual(config.audd_api_token, "secret-token")
                self.assertEqual(config.database_path, Path(tmp) / "vinyl_display.sqlite3")
                self.assertEqual(config.static_dir.name, "static")
            finally:
                os.environ.clear()
                os.environ.update(old_env)

    def test_release_tracks_are_serializable(self):
        release = Release(
            release_id=14192689,
            title="Abbey Road",
            artist="The Beatles",
            year=2019,
            cover_url="https://example.test/abbey.jpg",
            country="US",
            labels=["Apple Records", "Capitol Records"],
            catalog_numbers=["B0030719-01"],
            formats=["Vinyl", "LP", "Album"],
            tracks=[
                Track(position="A1", title="Come Together", duration_seconds=261),
                Track(position="A2", title="Something", duration_seconds=183),
            ],
            discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
        )

        payload = release.to_dict()
        restored = Release.from_dict(payload)

        self.assertEqual(restored.release_id, 14192689)
        self.assertEqual(restored.tracks[0].position, "A1")
        self.assertEqual(restored.tracks[0].duration_seconds, 261)

    def test_recognition_result_normalizes_missing_fields(self):
        result = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album=None,
            provider="audd",
            confidence=0.82,
            raw={"result": {"title": "Come Together"}},
        )

        self.assertEqual(result.album_or_empty, "")
        self.assertEqual(result.display_artist, "The Beatles")


if __name__ == "__main__":
    unittest.main()
