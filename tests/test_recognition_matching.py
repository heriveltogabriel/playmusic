import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import parse_audd_response
from vinyl_display.matcher import CollectionMatcher, normalize_text
from vinyl_display.models import RecognitionResult, Release, Track


def make_store() -> CatalogStore:
    tmp = tempfile.TemporaryDirectory()
    store = CatalogStore(Path(tmp.name) / "catalog.sqlite3")
    store._tmp = tmp
    store.initialize()
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
            tracks=[
                Track("A1", "Come Together", 261),
                Track("A2", "Something", 183),
            ],
            discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
        )
    )
    return store


class RecognitionMatchingTests(unittest.TestCase):
    def test_parse_audd_response(self):
        result = parse_audd_response(
            {
                "status": "success",
                "result": {
                    "title": "Come Together",
                    "artist": "The Beatles",
                    "album": "Abbey Road",
                    "score": 92,
                },
            }
        )

        self.assertIsNotNone(result)
        self.assertEqual(result.title, "Come Together")
        self.assertEqual(result.artist, "The Beatles")
        self.assertEqual(result.album, "Abbey Road")
        self.assertEqual(result.provider, "audd")

    def test_normalize_text_removes_case_and_punctuation_noise(self):
        self.assertEqual(normalize_text("  Come Together! "), "come together")
        self.assertEqual(normalize_text("Beatles, The"), "beatles the")

    def test_matcher_finds_track_in_collection(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="audd",
            confidence=0.92,
        )

        match = matcher.match(recognition)

        self.assertIsNotNone(match)
        self.assertEqual(match.release.release_id, 14192689)
        self.assertEqual(match.track.position, "A1")
        self.assertGreaterEqual(match.score, 90)

    def test_matcher_rejects_track_outside_collection(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="A Song Not In The Collection",
            artist="Unknown Artist",
            album=None,
            provider="audd",
            confidence=0.9,
        )

        self.assertIsNone(matcher.match(recognition))


if __name__ == "__main__":
    unittest.main()
