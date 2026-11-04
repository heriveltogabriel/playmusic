import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock

from vinyl_display.app import VinylDisplayApp
from vinyl_display.auth import AuthManager
from vinyl_display.catalog import CatalogStore
from vinyl_display.config import load_config
from vinyl_display.models import RecognitionResult, Release, Track
from vinyl_display.server import VinylRequestHandler

LOUD_PCM = b"\x00\x40" * 4000
ROOT = Path(__file__).resolve().parent.parent


def release(release_id, title, artist, tracks):
    return Release(
        release_id=release_id, title=title, artist=artist, year=1990, cover_url="", country="",
        labels=[], catalog_numbers=[], formats=["Vinyl", "LP"], tracks=tracks, discogs_url="",
    )


class FixedShazam:
    def __init__(self, title="Faroeste Caboclo", artist="Legião Urbana"):
        self.title, self.artist = title, artist

    def recognize(self, audio_bytes, filename="clip.raw"):
        return RecognitionResult(self.title, self.artist, None, "shazam", 1.0, raw={"matches": [{"offset": 5.0}]})


def make_app(tmp, shazam=None):
    store = CatalogStore(Path(tmp) / "c.sqlite3")
    store.initialize()
    store.upsert_release(release(1, "Que País É Este", "Legião Urbana", [
        Track("A1", "Que País É Este", 180), Track("A2", "Conexão Amazônica", 300), Track("B1", "Faroeste Caboclo", 540)]))
    store.upsert_release(release(2, "Mais do Mesmo", "Legião Urbana", [
        Track("A1", "Será", 150), Track("B1", "Índios", 260), Track("B2", "Faroeste Caboclo", 540)]))
    store.upsert_release(release(3, "Faroeste", "Outro Artista", [Track("A1", "Faroeste Caboclo Remix Longo", 200)]))
    app = VinylDisplayApp(store, None, shazam or FixedShazam(), musicbrainz_client=MagicMock(), run_in_background=lambda fn: None)
    return app, store


class PreferenceTests(unittest.TestCase):
    def test_choice_is_remembered_and_locks_next_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            first = app.recognize_audio(LOUD_PCM)
            self.assertEqual(first["match"]["release"]["release_id"], 1)  # lado B1 + começo de lado
            alt_ids = [a["release_id"] for a in app.state()["alternatives"]]
            self.assertEqual(alt_ids, [2])  # o disco 3 só tem título parcial: não é sugerido

            app.switch_playback_release(2)
            app.stop_playback()

            again = app.recognize_audio(LOUD_PCM)
            self.assertEqual(again["match"]["release"]["release_id"], 2)
            self.assertIn("preferred release", again["match"]["reason"])
            self.assertTrue(app.playback.active.locked)

    def test_keep_release_locks_and_remembers(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.recognize_audio(LOUD_PCM)
            out = app.keep_playback_release()
            self.assertEqual(out["state"]["alternatives"], [])
            self.assertTrue(app.playback.active.locked)
            self.assertEqual(store.get_preferred_release("faroeste caboclo|legiao urbana"), 1)

    def test_audition_moves_to_chosen_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.recognize_audio(LOUD_PCM)
            app.playback.active.scrobbled = True
            store.increment_auditions(1)  # o player já tinha contado a audição no disco 1
            app.switch_playback_release(2)
            self.assertEqual(store.get_release(1).auditions, 0)
            self.assertEqual(store.get_release(2).auditions, 1)
            self.assertTrue(app.playback.active.scrobbled)


class DeviceAuthTests(unittest.TestCase):
    def test_authorize_validate_revoke_and_only_hash_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthManager(Path(tmp))
            device_id, token = auth.authorize_device("Celular do toca-discos")
            self.assertEqual(auth.validate_device(token)["id"], device_id)
            self.assertIsNone(auth.validate_device("outro"))
            self.assertNotIn(token, (Path(tmp) / "devices.json").read_text())
            self.assertEqual([d["label"] for d in auth.list_devices()], ["Celular do toca-discos"])
            self.assertNotIn("token_hash", auth.list_devices()[0])
            self.assertTrue(auth.revoke_device(device_id))
            self.assertIsNone(auth.validate_device(token))


class HttpDeviceRequirementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ.update({"VINYL_DISABLE_DOTENV": "1", "VINYL_DATA_DIR": self.tmp.name,
                           "VINYL_DATABASE_PATH": str(Path(self.tmp.name) / "c.sqlite3"),
                           "VINYL_ENV_FILE": str(Path(self.tmp.name) / ".env")})
        self.config = load_config()
        self.app, _ = make_app(self.tmp.name)
        self.app.config = self.config
        self.auth = AuthManager(Path(self.tmp.name))

        class Handler(VinylRequestHandler):
            pass

        Handler.app, Handler.auth, Handler.static_dir = self.app, self.auth, ROOT / "static"
        Handler.log_message = lambda *a, **k: None
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        for key in ("VINYL_DATA_DIR", "VINYL_DATABASE_PATH", "VINYL_ENV_FILE"):
            os.environ.pop(key, None)
        self.tmp.cleanup()

    def post(self, path, body=b"", cookie=None):
        req = urllib.request.Request(self.base + path, data=body, method="POST")
        if cookie:
            req.add_header("Cookie", cookie)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.headers, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, e.headers, json.loads(e.read() or b"{}")

    def test_routes_open_until_requirement_is_enabled(self):
        status, _, body = self.post("/api/recognize", LOUD_PCM)
        self.assertEqual((status, body["status"]), (200, "matched"))

        self.app.update_config({"REQUIRE_DEVICE_TOKEN": "1"})
        self.app.shazam_client = FixedShazam()  # update_config recria o cliente real a partir do .env de teste
        status, _, body = self.post("/api/recognize", LOUD_PCM)
        self.assertEqual((status, body["error"]), (401, "device_not_authorized"))
        self.assertEqual(self.post("/api/ouvir/releases/1/listen")[0], 401)
        self.assertEqual(self.post("/api/playback/next")[0], 401)

        # Aparelho autorizado pelo admin (login) recebe o cookie e passa a funcionar
        session = self.auth.create_session()
        status, headers, _ = self.post("/api/admin/devices/authorize", json.dumps({"label": "Player"}).encode(),
                                       cookie=f"session_token={session}")
        self.assertEqual(status, 200)
        device_cookie = headers["Set-Cookie"].split(";")[0]
        self.assertTrue(device_cookie.startswith("vinyl_device="))
        status, _, body = self.post("/api/recognize", LOUD_PCM, cookie=device_cookie)
        self.assertEqual((status, body["status"]), (200, "matched"))
        self.assertEqual(self.post("/api/ouvir/releases/1/listen", cookie=device_cookie)[0], 200)

        # Revogado, deixa de funcionar
        device_id = self.auth.list_devices()[0]["id"]
        self.post("/api/admin/devices/revoke", json.dumps({"id": device_id}).encode(), cookie=f"session_token={session}")
        self.assertEqual(self.post("/api/recognize", LOUD_PCM, cookie=device_cookie)[0], 401)

    def test_device_admin_routes_require_login(self):
        self.assertEqual(self.post("/api/admin/devices/authorize", b"{}")[0], 401)
        self.assertEqual(self.post("/api/admin/devices/require", b'{"enabled": true}')[0], 401)


class LongTitleLayoutTests(unittest.TestCase):
    def test_title_is_clamped_and_scaled(self):
        css = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("-webkit-line-clamp: 2", css)
        self.assertEqual(css.count("var(--title-scale, 1)"), 4)
        self.assertIn("#track-title.title-xlong", css)
        app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function fitTrackTitle()", app_js)


class StaticV36Tests(unittest.TestCase):
    def test_keep_button_and_devices_card_exist(self):
        index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="alternatives-keep"', index)
        admin = (ROOT / "static" / "admin.html").read_text(encoding="utf-8")
        self.assertIn('id="devices-card"', admin)
        self.assertIn('id="device-require-toggle"', admin)


if __name__ == "__main__":
    unittest.main()
