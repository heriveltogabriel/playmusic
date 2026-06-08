import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track


def abbey_road() -> Release:
    return Release(
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
            Track("B1", "Here Comes The Sun", 185),
        ],
        discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
    )


class CatalogStoreTests(unittest.TestCase):
    def test_upsert_and_fetch_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            store.upsert_release(abbey_road())

            release = store.get_release(14192689)

            self.assertIsNotNone(release)
            self.assertEqual(release.title, "Abbey Road")
            self.assertEqual(release.tracks[2].position, "B1")
            self.assertEqual(store.collection_count(), 1)

    def test_iter_track_candidates_returns_every_track(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            store.upsert_release(abbey_road())

            candidates = list(store.iter_track_candidates())

            self.assertEqual(len(candidates), 3)
            self.assertEqual(candidates[0][0].title, "Abbey Road")
            self.assertEqual(candidates[0][1].title, "Come Together")


if __name__ == "__main__":
    unittest.main()
