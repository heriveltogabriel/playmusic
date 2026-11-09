"""v4.12: tela de escolha (/herivelto) e Modo Gravação só no servidor do Herivelto (SITE_PESSOAL=1).
No servidor do Bruno o player abre direto e essas páginas não existem."""
import dataclasses
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from vinyl_display.auth import AuthManager
from vinyl_display.config import load_config
from vinyl_display.server import VinylRequestHandler
from tests.test_v36_compilations_devices import make_app

ROOT = Path(__file__).resolve().parent.parent


class SitePessoalTests(unittest.TestCase):
    def start(self, pessoal):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        os.environ.update({"VINYL_DISABLE_DOTENV": "1", "VINYL_DATA_DIR": tmp.name,
                           "VINYL_DATABASE_PATH": str(Path(tmp.name) / "c.sqlite3"),
                           "VINYL_ENV_FILE": str(Path(tmp.name) / ".env")})
        app, _ = make_app(tmp.name)
        app.config = dataclasses.replace(load_config(), site_pessoal=pessoal)

        class Handler(VinylRequestHandler):
            pass

        Handler.app, Handler.auth, Handler.static_dir = app, AuthManager(Path(tmp.name)), ROOT / "static"
        Handler.log_message = lambda *a, **k: None
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return app, f"http://127.0.0.1:{server.server_address[1]}"

    def status(self, url):
        try:
            with urllib.request.urlopen(url) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_servidor_do_bruno_sem_tela_de_escolha_nem_gravacao(self):
        app, base = self.start(False)
        self.assertEqual(self.status(base + "/"), 200)
        self.assertEqual(self.status(base + "/gravar"), 404)
        self.assertEqual(self.status(base + "/herivelto"), 404)
        self.assertFalse(app.state()["modo_gravacao"])

    def test_servidor_do_herivelto_com_as_duas(self):
        app, base = self.start(True)
        self.assertEqual(self.status(base + "/gravar"), 200)
        self.assertEqual(self.status(base + "/herivelto"), 200)
        self.assertTrue(app.state()["modo_gravacao"])

    def test_link_do_player_comeca_escondido(self):
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="pick-gravar" class="pick-gravar hidden"', html)
        js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('linkGravar.classList.toggle("hidden", !state.modo_gravacao)', js)
