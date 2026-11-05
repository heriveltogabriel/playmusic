import tempfile
import unittest

from tests.test_v36_compilations_devices import make_app
from vinyl_display.artist import artist_listening, clean_profile, discography, norm_title
from vinyl_display.routes import ADMIN, access_for


class FakeDiscogs:
    def __init__(self):
        self.calls = []

    def release_artist(self, release_id):
        self.calls.append(("release_artist", release_id))
        return {"id": 77, "name": "Legião Urbana"}

    def artist_profile(self, artist_id):
        self.calls.append(("artist_profile", artist_id))
        return {"id": artist_id, "name": "Legião Urbana", "profile": "Banda de [a=Renato Russo] e [url=http://x]amigos[/url].", "uri": "u"}

    def artist_main_releases(self, artist_id):
        self.calls.append(("artist_main_releases", artist_id))
        return [
            {"id": 3, "type": "master", "title": "Dois", "year": 1986, "format": "", "thumb": "", "main_release": 30},
            {"id": 1, "type": "master", "title": "Que País É Este 1978/1987", "year": 1987, "format": "", "thumb": "", "main_release": 10},
            {"id": 9, "type": "release", "title": "Dois", "year": 1986, "format": "", "thumb": "", "main_release": None},
            {"id": 2, "type": "master", "title": "Mais Do Mesmo", "year": 1998, "format": "", "thumb": "", "main_release": 20},
        ]


class ArtistTests(unittest.TestCase):
    def test_discography_marks_owned_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.discogs_client = FakeDiscogs()
            result = discography(app, [1, 2])
            self.assertEqual(result["status"], "ok")
            self.assertEqual([w["title"] for w in result["works"]], ["Dois", "Que País É Este 1978/1987", "Mais Do Mesmo"])
            owned = {w["title"]: w["owned_release_ids"] for w in result["works"]}
            self.assertEqual(owned["Que País É Este 1978/1987"], [1])
            self.assertEqual(owned["Mais Do Mesmo"], [2])
            self.assertEqual(owned["Dois"], [])
            self.assertEqual((result["owned_count"], result["total"]), (2, 3))
            self.assertEqual(result["artist"]["profile"], "Banda de Renato Russo e amigos.")
            self.assertTrue(result["works"][0]["url"].endswith("/master/3"))
            calls = len(app.discogs_client.calls)
            discography(app, [1, 2])  # segunda visita: do cache
            self.assertEqual(len(app.discogs_client.calls), calls)

    def test_errors_without_discogs(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            app.discogs_client = None
            self.assertEqual(discography(app, [1])["status"], "error")
            self.assertEqual(discography(app, [])["status"], "error")

    def test_listening_only_for_artist_discs(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            store.log_track_play(100, 1, "A1", "Que País É Este", "A", 180)
            store.log_track_play(200, 1, "A1", "Que País É Este", "A", 180)
            store.log_track_play(300, 3, "A1", "Outro", "A", 200)
            result = artist_listening(store, [1, 2])
            self.assertEqual(result["top_tracks"][0]["plays"], 2)
            self.assertEqual(result["logged_seconds"], 360)

    def test_helpers_and_route(self):
        self.assertEqual(norm_title("Dois (Remastered)"), "dois")
        self.assertTrue(clean_profile("x " * 1000).endswith("…"))
        self.assertEqual(access_for("GET", "/api/admin/artist"), ADMIN)


if __name__ == "__main__":
    unittest.main()
