import io
import json
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.shazam import (
    ShazamBudgetExceeded,
    ShazamClient,
    ShazamQuotaExhausted,
    ShazamUsage,
    key_label,
    parse_api_keys,
)
from vinyl_display.config import load_config
from vinyl_display.models import Release, Track
from vinyl_display.server import VinylRequestHandler
from vinyl_display.sync import run_sync

BRT = timezone(timedelta(hours=-3))
LOUD_PCM = b"\x00\x40" * 4000
STATIC = Path(__file__).resolve().parent.parent / "static"


def ok_response(payload):
    response = MagicMock()
    response.read.return_value = json.dumps(payload).encode("utf-8")
    cm = MagicMock()
    cm.__enter__.return_value = response
    return cm


def quota_error():
    body = io.BytesIO(json.dumps({"message": "You have exceeded the MONTHLY quota for Requests on your current plan, BASIC."}).encode())
    return urllib.error.HTTPError("https://x", 429, "Too Many Requests", {}, body)


TRACK_PAYLOAD = {"track": {"title": "Come Together", "subtitle": "The Beatles", "isrc": "GBAYE0601690"},
                 "matches": [{"offset": 12.0}]}


class Clock:
    def __init__(self, dt):
        self.dt = dt

    def __call__(self):
        return self.dt


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = CatalogStore(Path(self.tmp.name) / "c.sqlite3")
        self.store.initialize()

    def tearDown(self):
        self.tmp.cleanup()


class ParseKeysTests(unittest.TestCase):
    def test_accepts_comma_space_and_newline_and_dedupes(self):
        self.assertEqual(parse_api_keys(" k1, k2\nk3 ;k1 "), ["k1", "k2", "k3"])
        self.assertEqual(parse_api_keys(""), [])

    def test_label_shows_only_last_four(self):
        self.assertEqual(key_label("abcdef123456"), "…3456")


class KeyRotationTests(StoreTestCase):
    @patch("urllib.request.urlopen")
    def test_switches_to_next_key_when_quota_ends_and_remembers(self, urlopen):
        urlopen.side_effect = [quota_error(), ok_response(TRACK_PAYLOAD), ok_response(TRACK_PAYLOAD)]
        usage = ShazamUsage(self.store)
        client = ShazamClient("key-AAAA,key-BBBB", usage=usage)

        self.assertEqual(client.recognize(b"pcm").title, "Come Together")
        self.assertEqual(urlopen.call_args_list[1].args[0].headers["X-rapidapi-key"], "key-BBBB")
        self.assertEqual(client.last_key_label, "…BBBB")
        self.assertTrue(usage.is_exhausted("key-AAAA"))

        client.recognize(b"pcm")  # não tenta mais a chave esgotada
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(urlopen.call_args_list[2].args[0].headers["X-rapidapi-key"], "key-BBBB")
        summary = client.usage_summary()
        self.assertEqual([(k["key"], k["calls"], k["exhausted"]) for k in summary["keys"]],
                         [("…AAAA", 0, True), ("…BBBB", 2, False)])
        self.assertEqual(summary["today"], 2)

    @patch("urllib.request.urlopen")
    def test_all_keys_exhausted_raises(self, urlopen):
        urlopen.side_effect = [quota_error(), quota_error()]
        client = ShazamClient(["k1", "k2"], usage=ShazamUsage(self.store))
        with self.assertRaises(ShazamQuotaExhausted):
            client.recognize(b"pcm")
        with self.assertRaises(ShazamQuotaExhausted):  # sem chamar a API de novo
            client.recognize(b"pcm")
        self.assertEqual(urlopen.call_count, 2)

    def test_new_month_resets_quota_and_keeps_history(self):
        clock = Clock(datetime(2026, 11, 30, 22, 0, tzinfo=BRT))
        usage = ShazamUsage(self.store, clock=clock)
        usage.record_call("k1")
        usage.record_call("k1")
        usage.mark_exhausted("k1")
        clock.dt = datetime(2026, 12, 1, 8, 0, tzinfo=BRT)
        self.assertFalse(usage.is_exhausted("k1"))
        summary = usage.summary(["k1"], 500, 60)
        self.assertEqual(summary["month"], "2026-12")
        self.assertEqual(summary["keys"][0]["calls"], 0)
        self.assertEqual(summary["history"], {"2026-11": 2})

    @patch("urllib.request.urlopen")
    def test_daily_budget_blocks_without_calling_api(self, urlopen):
        usage = ShazamUsage(self.store)
        for _ in range(3):
            usage.record_call("k1")
        client = ShazamClient("k1", usage=usage, daily_budget=3)
        with self.assertRaises(ShazamBudgetExceeded):
            client.recognize(b"pcm")
        urlopen.assert_not_called()


class RecognitionEventsTests(StoreTestCase):
    def make_app(self, shazam):
        self.store.upsert_release(Release(
            release_id=1, title="Abbey Road", artist="The Beatles", year=1969, cover_url="", country="",
            labels=[], catalog_numbers=[], formats=["Vinyl"], tracks=[Track("A1", "Come Together", 259)], discogs_url="",
        ))
        return VinylDisplayApp(self.store, None, shazam, musicbrainz_client=MagicMock(), run_in_background=lambda fn: None)

    @patch("urllib.request.urlopen")
    def test_events_and_stats_for_quiet_matched_and_budget(self, urlopen):
        urlopen.return_value = ok_response(TRACK_PAYLOAD)
        shazam = ShazamClient("key-1234", usage=ShazamUsage(self.store), daily_budget=1)
        app = self.make_app(shazam)

        self.assertEqual(app.recognize_audio(b"\x00\x00" * 4000)["status"], "no_result")  # silêncio
        self.assertEqual(app.recognize_audio(LOUD_PCM)["status"], "matched")
        self.assertEqual(app.recognize_audio(LOUD_PCM)["status"], "budget_exceeded")
        self.assertEqual(urlopen.call_count, 1)

        stats = self.store.recognition_stats(since=0)
        self.assertEqual(stats["too_quiet"], 1)
        self.assertEqual(stats["matched"], 1)
        self.assertEqual(stats["budget_exceeded"], 1)
        self.assertEqual(stats["shazam_calls"], 1)
        self.assertEqual(app.shazam_usage()["keys"][0]["calls"], 1)


class SyncCliTests(StoreTestCase):
    def config(self):
        import os
        os.environ["VINYL_DISABLE_DOTENV"] = "1"
        os.environ["VINYL_DATABASE_PATH"] = str(Path(self.tmp.name) / "c.sqlite3")
        try:
            return load_config()
        finally:
            del os.environ["VINYL_DATABASE_PATH"]

    def test_success_and_failure_are_recorded(self):
        ok = MagicMock()
        ok.sync_collection.return_value = {"count": 3, "added": 1, "updated": 2, "deleted": 0}
        result = run_sync(self.config(), client_factory=lambda c: ok)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["added"], 1)
        self.assertEqual(self.store.get_metadata("discogs_last_sync_error"), "")

        bad = MagicMock()
        bad.sync_collection.side_effect = RuntimeError("Discogs 503")
        result = run_sync(self.config(), client_factory=lambda c: bad)
        self.assertEqual(result["status"], "error")
        self.assertIn("Discogs 503", self.store.get_metadata("discogs_last_sync_error"))


class SecureCookieTests(unittest.TestCase):
    def handler(self, headers):
        h = VinylRequestHandler.__new__(VinylRequestHandler)
        h.headers = headers
        h.connection = object()
        return h

    def test_secure_only_behind_https(self):
        self.assertEqual(self.handler({"X-Forwarded-Proto": "https"})._secure_flag(), "; Secure")
        self.assertEqual(self.handler({})._secure_flag(), "")


class StaticV34Tests(unittest.TestCase):
    def test_microphone_never_goes_to_sleep(self):
        app_js = (STATIC / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("micSuspended = true", app_js)
        self.assertIn("idleRetryDelayMs", app_js)
        self.assertIn("budget_exceeded", app_js)

    def test_admin_no_longer_posts_debug_dom(self):
        self.assertNotIn("/api/debug/dom", (STATIC / "admin.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
