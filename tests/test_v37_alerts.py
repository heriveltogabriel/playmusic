import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.notify import AlertManager, Notifier, in_quiet_hours

ROOT = Path(__file__).resolve().parent.parent


class FakeTransport:
    def __init__(self, ok=True):
        self.posts = []
        self.ok = ok

    def post(self, url, data, headers):
        self.posts.append((url, data, headers))
        return {"ok": self.ok}

    def get(self, url):
        return {"result": [
            {"message": {"chat": {"id": 111, "first_name": "Herivelto", "username": "heri"}}},
            {"message": {"chat": {"id": 111, "first_name": "Herivelto"}}},
        ]}


def notifier(transport, **kw):
    return Notifier(post=transport.post, get=transport.get, **kw)


class NotifierTests(unittest.TestCase):
    def test_telegram_and_ntfy(self):
        t = FakeTransport()
        n = notifier(t, telegram_bot_token="TOKEN", telegram_chat_id="111", ntfy_topic="playvinil-x")
        self.assertEqual(n.send("Oi"), ["telegram", "ntfy"])
        tg_url, tg_body, _ = t.posts[0]
        self.assertIn("/botTOKEN/sendMessage", tg_url)
        self.assertEqual(json.loads(tg_body)["chat_id"], "111")
        self.assertEqual(t.posts[1][0], "https://ntfy.sh/playvinil-x")

    def test_disabled_without_channels(self):
        self.assertFalse(Notifier().enabled)
        self.assertEqual(Notifier().send("x"), [])

    def test_detects_chat_after_start(self):
        chats = notifier(FakeTransport(), telegram_bot_token="T").telegram_chats()
        self.assertEqual(chats, [{"id": "111", "name": "Herivelto", "username": ""}])


class AlertManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = CatalogStore(Path(self.tmp.name) / "c.sqlite3")
        self.store.initialize()
        self.t = FakeTransport()
        self.now = [1000.0]
        self.alerts = AlertManager(self.store, notifier(self.t, ntfy_topic="x"), clock=lambda: self.now[0])

    def tearDown(self):
        self.tmp.cleanup()

    def test_without_channels_nothing_is_marked(self):
        alerts = AlertManager(self.store, Notifier())
        self.assertFalse(alerts.raise_alert("player_offline", "caiu"))
        self.assertFalse(alerts.is_active("player_offline"))

    def test_cooldown_and_resolution(self):
        self.assertTrue(self.alerts.raise_alert("k", "caiu", cooldown=3600))
        self.assertFalse(self.alerts.raise_alert("k", "caiu", cooldown=3600))  # repetido: não envia
        self.now[0] += 3601
        self.assertTrue(self.alerts.raise_alert("k", "caiu", cooldown=3600))
        self.assertTrue(self.alerts.resolve("k", "voltou"))
        self.assertFalse(self.alerts.resolve("k", "voltou"))
        self.assertEqual([p[1].decode() for p in self.t.posts], ["caiu", "caiu", "voltou"])


class WatchdogTests(unittest.TestCase):
    def make_app(self, tmp):
        store = CatalogStore(Path(tmp) / "c.sqlite3")
        store.initialize()
        config = MagicMock(player_offline_minutes=10, favorite_threshold=3, shazam_daily_budget=0,
                           shazam_monthly_limit=500, rapidapi_shazam_key="", rapidapi_shazam_host="h",
                           telegram_bot_token="", telegram_chat_id="", ntfy_topic="", ntfy_server="https://ntfy.sh",
                           alert_quiet_start="", alert_quiet_end="")
        app = VinylDisplayApp(store, None, MagicMock(usage_summary=lambda: None), config=config, musicbrainz_client=MagicMock())
        self.t = FakeTransport()
        app.notifier = notifier(self.t, telegram_bot_token="T", telegram_chat_id="1")
        app.alerts = AlertManager(store, app.notifier)  # sem silêncio: os testes rodam a qualquer hora
        return app

    def texts(self):
        return [json.loads(p[1])["text"] for p in self.t.posts]

    def test_offline_then_back_online(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            import time
            app.record_heartbeat({"audio": "running", "version": "3.7.0"})
            hb = json.loads(app.store.get_metadata("player_heartbeat"))
            app.run_watchdog(now=hb["at"] + 60)
            self.assertEqual(self.t.posts, [])
            app.run_watchdog(now=hb["at"] + 11 * 60)
            self.assertIn("sem sinal há 11 min", self.texts()[-1])
            app.run_watchdog(now=hb["at"] + 12 * 60)  # não repete
            self.assertEqual(len(self.t.posts), 1)
            app.record_heartbeat({"audio": "running"})
            app.run_watchdog(now=time.time())
            self.assertIn("voltou a responder", self.texts()[-1])

    def test_microphone_paused_needs_tap(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            app.record_heartbeat({"audio": "suspended"})
            at = json.loads(app.store.get_metadata("player_heartbeat"))["at"]
            app.run_watchdog(now=at + 30)
            app.run_watchdog(now=at + 30 + 301)
            self.assertIn("Toque uma vez na tela", self.texts()[-1])

    def test_shazam_quota_alerts_once_per_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            usage = {"month": "2026-11", "keys": [{"key": "…aaaa", "calls": 410, "limit": 500, "exhausted": False},
                                                   {"key": "…bbbb", "calls": 0, "limit": 500, "exhausted": True}]}
            app.shazam_client = MagicMock(usage_summary=lambda: usage)
            app.run_watchdog()
            app.run_watchdog()
            texts = self.texts()
            self.assertEqual(len(texts), 2)
            self.assertTrue(any("…aaaa" in t and "410 de 500" in t for t in texts))
            self.assertTrue(any("…bbbb" in t and "esgotou" in t for t in texts))


def brt(hour, minute=0):
    from datetime import datetime, timedelta, timezone
    return datetime(2026, 11, 4, hour, minute, tzinfo=timezone(timedelta(hours=-3))).timestamp()


class QuietHoursTests(unittest.TestCase):
    def test_overnight_window(self):
        self.assertTrue(in_quiet_hours(brt(22, 0), "22:00", "10:00"))
        self.assertTrue(in_quiet_hours(brt(3, 30), "22:00", "10:00"))
        self.assertTrue(in_quiet_hours(brt(9, 59), "22:00", "10:00"))
        self.assertFalse(in_quiet_hours(brt(10, 0), "22:00", "10:00"))
        self.assertFalse(in_quiet_hours(brt(15, 0), "22:00", "10:00"))
        self.assertFalse(in_quiet_hours(brt(3, 0), "", ""))  # desligado

    def test_player_alerts_wait_and_others_arrive_silently(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "c.sqlite3")
            store.initialize()
            t = FakeTransport()
            now = [brt(2, 0)]
            alerts = AlertManager(store, notifier(t, telegram_bot_token="T", telegram_chat_id="1"),
                                  clock=lambda: now[0], quiet_start="22:00", quiet_end="10:00")
            self.assertFalse(alerts.raise_alert("player_offline", "caiu", hold_in_quiet_hours=True))
            self.assertTrue(alerts.raise_alert("sync_failed", "sync falhou"))
            self.assertEqual(len(t.posts), 1)
            self.assertTrue(json.loads(t.posts[0][1])["disable_notification"])
            now[0] = brt(10, 1)  # acabou o silêncio e o player continua fora
            self.assertTrue(alerts.raise_alert("player_offline", "caiu", hold_in_quiet_hours=True))
            self.assertFalse(json.loads(t.posts[-1][1])["disable_notification"])


class SyncAlertTests(unittest.TestCase):
    def test_sync_failure_alerts_and_recovery(self):
        from vinyl_display import sync

        with tempfile.TemporaryDirectory() as tmp:
            config = MagicMock(database_path=Path(tmp) / "c.sqlite3", favorite_threshold=3,
                               telegram_bot_token="T", telegram_chat_id="1", ntfy_topic="", ntfy_server="",
                               alert_quiet_start="", alert_quiet_end="")
            CatalogStore(config.database_path).initialize()
            t = FakeTransport()
            original = Notifier.from_config
            Notifier.from_config = classmethod(lambda cls, c: notifier(t, telegram_bot_token="T", telegram_chat_id="1"))
            try:
                sync.notify_result({"status": "error", "message": "Discogs 503"}, config)
                sync.notify_result({"status": "error", "message": "Discogs 503"}, config)
                sync.notify_result({"status": "ok", "count": 290}, config)
            finally:
                Notifier.from_config = original
            texts = [json.loads(p[1])["text"] for p in t.posts]
            self.assertEqual(len(texts), 2)
            self.assertIn("Discogs 503", texts[0])
            self.assertIn("voltou a funcionar", texts[1])


class StaticV37Tests(unittest.TestCase):
    def test_player_sends_heartbeat_and_reloads_only_when_idle(self):
        app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('"/api/player/heartbeat"', app_js)
        self.assertIn("state.version !== pageVersion && !state.release && !recording", app_js)
        admin = (ROOT / "static" / "admin.html").read_text(encoding="utf-8")
        self.assertIn('id="alerts-card"', admin)
        admin_js = (ROOT / "static" / "admin.js").read_text(encoding="utf-8")
        self.assertNotIn("telegram_chats?token=", admin_js)  # token nunca na URL

    def test_backup_script_alerts_on_failure(self):
        sh = (ROOT / "scripts" / "backup_oci.sh").read_text(encoding="utf-8")
        self.assertIn("vinyl_display.notify --key backup_failed", sh)


if __name__ == "__main__":
    unittest.main()
