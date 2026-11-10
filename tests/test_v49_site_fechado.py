"""v4.9.0: site fechado (SITE_FECHADO=1) — tudo exige login; player e gravação também abrem
em aparelho autorizado; limite de tentativas de senha."""
import dataclasses
import json
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
from vinyl_display.limite import LimiteTentativas
from vinyl_display.routes import ADMIN, DEVICE, PUBLIC, access_for
from vinyl_display.server import LIMITE_SENHA, VinylRequestHandler
from tests.test_v36_compilations_devices import make_app

ROOT = Path(__file__).resolve().parent.parent


class SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


ABRIR = urllib.request.build_opener(SemRedirecionar)


class TabelaFechadaTests(unittest.TestCase):
    def test_niveis(self):
        casos = {
            ("GET", "/login"): PUBLIC,
            ("GET", "/static/login.css"): PUBLIC,
            ("GET", "/static/app.js"): PUBLIC,
            ("GET", "/api/health"): PUBLIC,
            ("POST", "/api/auth/login"): PUBLIC,
            ("GET", "/"): DEVICE,
            ("GET", "/gravar"): DEVICE,
            ("GET", "/api/state"): DEVICE,
            ("POST", "/api/recognize"): DEVICE,
            ("POST", "/api/playback/start_manual"): DEVICE,
            ("GET", "/herivelto"): ADMIN,
            ("GET", "/admin"): ADMIN,
            ("GET", "/ouvir"): ADMIN,
            ("GET", "/agenda"): ADMIN,
            ("GET", "/api/admin/stats"): ADMIN,
            ("GET", "/qualquer/coisa"): ADMIN,
            ("POST", "/api/auth/change_password"): ADMIN,
        }
        for (metodo, caminho), nivel in casos.items():
            self.assertEqual(access_for(metodo, caminho, fechado=True), nivel, f"{metodo} {caminho}")

    def test_site_aberto_continua_igual(self):
        self.assertEqual(access_for("GET", "/ouvir"), PUBLIC)
        self.assertEqual(access_for("GET", "/api/state"), PUBLIC)


class LimiteTests(unittest.TestCase):
    def test_bloqueia_depois_de_cinco_e_dobra(self):
        lim = LimiteTentativas()
        for _ in range(4):
            lim.errou("1.2.3.4", agora=1000)
        self.assertEqual(lim.espera("1.2.3.4", agora=1000), 0)
        lim.errou("1.2.3.4", agora=1000)
        self.assertEqual(lim.espera("1.2.3.4", agora=1000), 60)
        lim.errou("1.2.3.4", agora=1061)
        self.assertEqual(lim.espera("1.2.3.4", agora=1061), 120)
        self.assertEqual(lim.espera("5.6.7.8", agora=1061), 0)
        lim.acertou("1.2.3.4")
        self.assertEqual(lim.espera("1.2.3.4", agora=1061), 0)


class HttpSiteFechadoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ.update({"VINYL_DISABLE_DOTENV": "1", "VINYL_DATA_DIR": self.tmp.name,
                           "VINYL_DATABASE_PATH": str(Path(self.tmp.name) / "c.sqlite3"),
                           "VINYL_ENV_FILE": str(Path(self.tmp.name) / ".env")})
        self.app, _ = make_app(self.tmp.name)
        self.app.config = dataclasses.replace(load_config(), site_fechado=True, site_pessoal=True)
        self.auth = AuthManager(Path(self.tmp.name))
        self.auth.setup_new_password("senha-certa")
        LIMITE_SENHA._ips.clear()

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
        LIMITE_SENHA._ips.clear()
        self.tmp.cleanup()

    def get(self, path, cookie=None, headers=None):
        req = urllib.request.Request(self.base + path)
        if cookie:
            req.add_header("Cookie", cookie)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with ABRIR.open(req) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def post(self, path, payload, headers=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(payload).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with ABRIR.open(req) as r:
                return r.status, r.headers, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, e.headers, json.loads(e.read() or b"{}")

    def test_paginas_mandam_para_o_login(self):
        status, headers, _ = self.get("/herivelto")
        self.assertEqual((status, headers["Location"]), (302, "/login?next=/"))
        status, headers, _ = self.get("/", headers={"X-Forwarded-Prefix": "/vinyl"})
        self.assertEqual((status, headers["Location"]), (302, "/login?next=/vinyl/"))
        status, headers, _ = self.get("/agenda")
        self.assertEqual((status, headers["Location"]), (302, "/login?next=/agenda"))
        self.assertEqual(self.get("/api/admin/stats")[0], 401)
        self.assertEqual(self.get("/api/state")[0], 401)
        status, _, corpo = self.get("/login")
        self.assertEqual(status, 200)
        self.assertIn(b"/api/auth/login", corpo)

    def test_login_unico_abre_tudo(self):
        status, headers, corpo = self.post("/api/auth/login", {"password": "senha-certa"})
        self.assertEqual(status, 200)
        sessao = headers["Set-Cookie"].split(";")[0]
        for caminho in ("/herivelto", "/admin", "/", "/gravar", "/api/admin/stats", "/api/state"):
            self.assertEqual(self.get(caminho, cookie=sessao)[0], 200, caminho)
        status, headers, _ = self.get("/login?next=/agenda", cookie=sessao)
        self.assertEqual((status, headers["Location"]), (302, "/agenda"))
        status, headers, _ = self.get("/login?next=//outro.site", cookie=sessao)
        self.assertEqual(headers["Location"], "/")

    def test_checagem_de_login_para_o_nginx(self):
        # v4.12.1: o nginx usa /api/auth/check (auth_request) para proteger o Investify
        self.assertEqual(self.get("/api/auth/check")[0], 401)
        status, headers, _ = self.post("/api/auth/login", {"password": "senha-certa"})
        sessao = headers["Set-Cookie"].split(";")[0]
        self.assertEqual(self.get("/api/auth/check", cookie=sessao)[0], 204)

    def test_aparelho_autorizado_so_abre_player_e_gravacao(self):
        token = self.auth.authorize_device("Vitrola") if hasattr(self.auth, "authorize_device") else None
        if token is None:
            sessao = "session_token=" + self.auth.create_session()
            req = urllib.request.Request(self.base + "/api/admin/devices/authorize", data=b'{"label": "Vitrola"}', method="POST")
            req.add_header("Cookie", sessao)
            with ABRIR.open(req) as r:
                aparelho = r.headers["Set-Cookie"].split(";")[0]
        else:
            aparelho = f"{VinylRequestHandler.DEVICE_COOKIE}={token if isinstance(token, str) else token[1]}"
        for caminho in ("/", "/gravar", "/api/state", "/api/ouvir/releases"):
            self.assertEqual(self.get(caminho, cookie=aparelho)[0], 200, caminho)
        for caminho in ("/herivelto", "/admin", "/agenda"):
            self.assertEqual(self.get(caminho, cookie=aparelho)[0], 302, caminho)
        self.assertEqual(self.get("/api/admin/stats", cookie=aparelho)[0], 401)

    def test_bloqueio_de_tentativas(self):
        ip = {"X-Real-IP": "9.9.9.9"}
        for _ in range(5):
            self.assertEqual(self.post("/api/auth/login", {"password": "errada"}, ip)[0], 401)
        status, _, corpo = self.post("/api/auth/login", {"password": "senha-certa"}, ip)
        self.assertEqual(status, 429)
        self.assertIn("Muitas tentativas", corpo["error"])
        self.assertEqual(self.post("/api/auth/login", {"password": "senha-certa"}, {"X-Real-IP": "8.8.8.8"})[0], 200)

    def test_chave_de_recuperacao_maior(self):
        chave = self.auth.setup_new_password("outra-senha")
        self.assertRegex(chave, r"^VINYL-RESTORE-([A-Z2-9]{5}-){3}[A-Z2-9]{5}$")
