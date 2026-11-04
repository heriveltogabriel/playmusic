import re
import unittest
from pathlib import Path

from vinyl_display.routes import ADMIN, DEVICE, PUBLIC, access_for

SERVER = (Path(__file__).resolve().parent.parent / "vinyl_display" / "server.py").read_text(encoding="utf-8")


def handler_routes(method):
    """Caminhos /api citados dentro de do_GET ou do_POST."""
    start = SERVER.index(f"    def do_{method}(self)")
    nxt = SERVER.find("\n    def ", start + 10)
    body = SERVER[start: nxt if nxt != -1 else len(SERVER)]
    return set(re.findall(r'"(/api/[a-z_/]+)"', body))


class RouteTableTests(unittest.TestCase):
    def test_expected_levels(self):
        cases = {
            ("GET", "/api/state"): PUBLIC,
            ("GET", "/api/health"): PUBLIC,
            ("GET", "/api/ouvir/sides/123"): PUBLIC,
            ("GET", "/api/config"): ADMIN,
            ("GET", "/api/admin/stats"): ADMIN,
            ("POST", "/api/auth/login"): PUBLIC,
            ("POST", "/api/auth/change_password"): ADMIN,
            ("POST", "/api/player/heartbeat"): PUBLIC,
            ("POST", "/api/recognize"): DEVICE,
            ("POST", "/api/playback/start_manual"): DEVICE,
            ("POST", "/api/ouvir/releases/5/listen"): DEVICE,
            ("POST", "/api/admin/releases/5/listen"): ADMIN,
            ("POST", "/api/sync"): ADMIN,
            ("POST", "/api/config"): ADMIN,
            ("GET", "/admin"): PUBLIC,
            ("GET", "/static/app.js"): PUBLIC,
        }
        for (method, path), level in cases.items():
            self.assertEqual(access_for(method, path), level, f"{method} {path}")

    def test_unknown_api_routes_are_closed(self):
        self.assertEqual(access_for("GET", "/api/nova_rota"), ADMIN)
        self.assertEqual(access_for("POST", "/api/state"), ADMIN)
        self.assertEqual(access_for("POST", "/api/ouvir/releases/5/delete"), ADMIN)

    def test_every_admin_or_auth_route_in_server_is_protected(self):
        for method in ("GET", "POST"):
            for path in handler_routes(method):
                level = access_for(method, path.rstrip("/") or path)
                if path.startswith(("/api/admin", "/api/config", "/api/sync", "/api/auth/change_password")):
                    self.assertEqual(level, ADMIN, f"{method} {path}")
                if path.startswith(("/api/recognize", "/api/playback/")):
                    self.assertEqual(level, DEVICE, f"{method} {path}")

    def test_old_inline_gates_are_gone(self):
        self.assertNotIn('path.startswith("/api/admin/") or path == "/api/config"', SERVER)
        self.assertIn('self._check_access("GET", path)', SERVER)
        self.assertIn('self._check_access("POST", path)', SERVER)


if __name__ == "__main__":
    unittest.main()
