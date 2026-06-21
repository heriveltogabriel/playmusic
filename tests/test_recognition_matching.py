import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
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
    def test_normalize_text_removes_case_and_punctuation_noise(self):
        self.assertEqual(normalize_text("  Come Together! "), "come together")
        self.assertEqual(normalize_text("Beatles, The"), "beatles the")
        self.assertEqual(normalize_text("See the Sky About to Rain (2003 Remaster)"), "see the sky about to rain")
        self.assertEqual(normalize_text("Come Together - Remastered 2009"), "come together")
        self.assertEqual(normalize_text("Vida Louca Vida (Ao Vivo)"), "vida louca vida")
        self.assertEqual(normalize_text("O Tempo Não Para - Acústico"), "o tempo nao para")

    def test_matcher_finds_track_in_collection(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="shazam",
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
            provider="shazam",
            confidence=0.9,
        )

        self.assertIsNone(matcher.match(recognition))

    def test_active_album_boost(self):
        # Create a store with two releases that share a track
        tmp = tempfile.TemporaryDirectory()
        store = CatalogStore(Path(tmp.name) / "catalog.sqlite3")
        store._tmp = tmp
        store.initialize()
        
        # Release 1: Studio Album
        store.upsert_release(
            Release(
                release_id=1,
                title="Abbey Road",
                artist="The Beatles",
                year=1969,
                cover_url="https://example.test/cover.jpg",
                country="UK",
                labels=["Apple"],
                catalog_numbers=["1"],
                formats=["Vinyl"],
                tracks=[Track("A1", "Come Together", 261)],
                discogs_url="url1",
            )
        )
        
        # Release 2: Compilation Album
        store.upsert_release(
            Release(
                release_id=2,
                title="The Beatles 1967-1970",
                artist="The Beatles",
                year=1973,
                cover_url="https://example.test/cover.jpg",
                country="UK",
                labels=["Apple"],
                catalog_numbers=["2"],
                formats=["Vinyl"],
                tracks=[Track("A1", "Come Together", 261)],
                discogs_url="url2",
            )
        )
        
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album=None,
            provider="shazam",
            confidence=0.9,
        )
        
        # When active album is 2, it should match release 2
        match = matcher.match(recognition, active_release_id=2)
        self.assertEqual(match.release.release_id, 2)
        self.assertIn("active album boost", match.reason)
        
        # When active album is 1, it should match release 1
        match = matcher.match(recognition, active_release_id=1)
        self.assertEqual(match.release.release_id, 1)
        self.assertIn("active album boost", match.reason)

    def test_side_start_boost(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        
        # Match A1 (Come Together) - which is first track of side A
        recognition = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album=None,
            provider="shazam",
            confidence=0.9,
        )
        match = matcher.match(recognition)
        self.assertIsNotNone(match)
        self.assertIn("side start boost", match.reason)


if __name__ == "__main__":
    unittest.main()
