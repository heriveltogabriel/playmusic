import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

from tests.test_v36_compilations_devices import FixedShazam, make_app
from vinyl_display.assistant import (
    HELP, OFFSET_KEY, TelegramCommands, daily_pick_text, maybe_send_daily_pick, maybe_send_weekly_summary,
)
from vinyl_display.models import Track
from vinyl_display.notify import Notifier

BRT = timezone(timedelta(hours=-3))


class Transport:
    def __init__(self):
        self.posts = []

    def post(self, url, data, headers):
        self.posts.append((url, data, headers))
        return {"ok": True}

    def get(self, url):
        return {"result": []}

    def texts(self):
        return [json.loads(p[1])["text"] for p in self.posts]


def with_bot(app):
    t = Transport()
    app.notifier = Notifier(post=t.post, get=t.get, telegram_bot_token="T", telegram_chat_id="42")
    return t


class ManualStartTests(unittest.TestCase):
    def test_sides_and_start_without_shazam(self):
        with tempfile.TemporaryDirectory() as tmp:
            shazam = MagicMock(wraps=FixedShazam())
            app, store = make_app(tmp, shazam)
            sides = app.release_sides(1)
            self.assertEqual([s["side"] for s in sides["sides"]], ["A", "B"])
            self.assertIsNone(app.release_sides(999))

            result = app.start_manual_playback(1, "B")
            self.assertEqual(result["status"], "ok")
            state = app.state()
            self.assertEqual(state["track"]["position"], "B1")
            self.assertLess(state["progress_seconds"], 3)
            self.assertTrue(app.playback.active.locked)
            shazam.recognize.assert_not_called()
            self.assertEqual(store.recognition_report(since=0)["by_status"].get("manual_start"), 1)

    def test_unknown_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            self.assertEqual(app.start_manual_playback(999)["status"], "error")


class TelegramCommandTests(unittest.TestCase):
    def test_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            with_bot(app)
            bot = TelegramCommands(app, request_json=lambda url, timeout: {})
            self.assertIn("Nada tocando", bot.answer("/tocando"))
            app.start_manual_playback(1, "A")
            now = bot.answer("/tocando@PlayVinilBot")
            self.assertIn("A1 · Que País É Este", now)
            self.assertIn("Próxima: A2", now)
            self.assertEqual(bot.answer("oi"), HELP)
            self.assertIn("Coleção", bot.answer("/status"))

    def test_poll_only_answers_configured_chat_and_moves_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            t = with_bot(app)
            urls = []

            def fake(url, timeout):
                urls.append(url)
                return {"result": [
                    {"update_id": 10, "message": {"chat": {"id": 99}, "text": "/status"}},
                    {"update_id": 11, "message": {"chat": {"id": 42}, "text": "/ajuda"}},
                ]}

            handled = TelegramCommands(app, request_json=fake).poll_once(wait_seconds=1)
            self.assertEqual(handled, 1)
            self.assertEqual(store.get_metadata(OFFSET_KEY), "12")
            self.assertIn("offset=0", urls[0])
            self.assertEqual(t.texts(), [HELP])
            self.assertEqual(json.loads(t.posts[0][1])["chat_id"], "42")

    def test_without_bot_does_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            app.notifier = Notifier()
            called = []
            self.assertEqual(TelegramCommands(app, request_json=lambda u, t: called.append(u)).poll_once(), 0)
            self.assertEqual(called, [])


class WeeklySummaryTests(unittest.TestCase):
    def test_sunday_after_ten_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            t = with_bot(app)
            saturday = datetime(2026, 11, 7, 12, 0, tzinfo=BRT).timestamp()
            sunday_early = datetime(2026, 11, 8, 9, 0, tzinfo=BRT).timestamp()
            sunday = datetime(2026, 11, 8, 10, 30, tzinfo=BRT).timestamp()
            self.assertFalse(maybe_send_weekly_summary(app, saturday))
            self.assertFalse(maybe_send_weekly_summary(app, sunday_early))
            self.assertTrue(maybe_send_weekly_summary(app, sunday))
            self.assertFalse(maybe_send_weekly_summary(app, sunday + 3600))
            self.assertIn("Resumo da semana", t.texts()[0])
            self.assertEqual(len(t.posts), 1)


class DailyPickTests(unittest.TestCase):
    def test_every_day_after_ten_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            t = with_bot(app)
            monday_early = datetime(2026, 11, 9, 9, 0, tzinfo=BRT).timestamp()
            monday = datetime(2026, 11, 9, 10, 30, tzinfo=BRT).timestamp()
            tuesday = datetime(2026, 11, 10, 11, 0, tzinfo=BRT).timestamp()
            self.assertFalse(maybe_send_daily_pick(app, monday_early))
            self.assertTrue(maybe_send_daily_pick(app, monday))
            self.assertFalse(maybe_send_daily_pick(app, monday + 3600))
            self.assertTrue(maybe_send_daily_pick(app, tuesday))
            self.assertEqual(len(t.posts), 2)
            self.assertIn("Escuta de hoje · Segunda, 09/11", t.texts()[0])
            self.assertIn("Escuta de hoje · Terça, 10/11", t.texts()[1])

    def test_text_names_the_disc_of_the_day(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            agenda = app.get_weekly_agenda()
            wednesday = datetime(2026, 11, 11, 12, 0, tzinfo=BRT).timestamp()
            text = daily_pick_text(app, wednesday)
            self.assertIn(agenda[3]["title"], text)
            self.assertIn("Quarta", text)

    def test_hoje_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            self.assertIn("Escuta de hoje", TelegramCommands(app).answer("/hoje"))
            self.assertIn("/hoje", HELP)


class RecognitionReportTests(unittest.TestCase):
    def test_counts_calls_and_local_solutions(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.recognize_audio(b"\x00\x40" * 4000)
            store.log_recognition_event("flip_local", release_id=1)
            store.log_recognition_event("boundary_aligned", release_id=1)
            report = store.recognition_report(since=time.time() - 3600)
            self.assertEqual(report["shazam_calls"], 1)
            self.assertGreaterEqual(report["solved_locally"], 1)
            self.assertTrue(report["discs"])
            self.assertTrue(report["recent"])


if __name__ == "__main__":
    unittest.main()
