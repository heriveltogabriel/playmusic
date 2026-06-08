import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import DiscogsClient, parse_duration


class FakeJsonTransport:
    def __init__(self):
        self.urls = []

    def __call__(self, url, headers):
        self.urls.append(url)
        if url.endswith("/collection/folders/0/releases?per_page=100&page=1"):
            return {
                "pagination": {"page": 1, "pages": 1, "items": 1},
                "releases": [{"id": 14192689}],
            }
        if url.endswith("/releases/14192689"):
            return {
                "id": 14192689,
                "title": "Abbey Road",
                "artists_sort": "Beatles, The",
                "artists": [{"name": "The Beatles"}],
                "year": 2019,
                "country": "US",
                "uri": "https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
                "labels": [{"name": "Apple Records", "catno": "B0030719-01"}],
                "formats": [{"name": "Vinyl", "descriptions": ["LP", "Album"]}],
                "images": [{"type": "primary", "uri": "https://example.test/cover.jpg"}],
                "tracklist": [
                    {
                        "position": "A1",
                        "type_": "track",
                        "title": "Come Together",
                        "duration": "4:21",
                    },
                    {
                        "position": "A2",
                        "type_": "track",
                        "title": "Something",
                        "duration": "3:03",
                    },
                    {"position": "", "type_": "heading", "title": "Side B"},
                ],
            }
        raise AssertionError(f"Unexpected URL: {url}")


class DiscogsClientTests(unittest.TestCase):
    def test_parse_duration(self):
        self.assertEqual(parse_duration("4:21"), 261)
        self.assertEqual(parse_duration("1:02:03"), 3723)
        self.assertIsNone(parse_duration(""))

    def test_sync_collection_writes_release_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            client = DiscogsClient(
                username="heriveltogabriel",
                user_agent="VinylDisplayTest/0.1",
                request_json=FakeJsonTransport(),
            )

            count = client.sync_collection(store)
            release = store.get_release(14192689)

            self.assertEqual(count, 1)
            self.assertIsNotNone(release)
            self.assertEqual(release.title, "Abbey Road")
            self.assertEqual(release.artist, "The Beatles")
            self.assertEqual(release.labels, ["Apple Records"])
            self.assertEqual(release.catalog_numbers, ["B0030719-01"])
            self.assertEqual(release.tracks[0].duration_seconds, 261)
            self.assertEqual(store.get_metadata("discogs_last_sync_count"), "1")


if __name__ == "__main__":
    unittest.main()
