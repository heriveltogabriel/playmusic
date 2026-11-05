import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from tests.test_v36_compilations_devices import FixedShazam, make_app

LOUD = b"\x00\x40" * 4000
ROOT = Path(__file__).resolve().parent.parent
APP_JS = (ROOT / "static" / "app.js").read_text(encoding="utf-8")


class RecentMatchGuardTests(unittest.TestCase):
    def test_automatic_call_right_after_match_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            shazam = MagicMock(wraps=FixedShazam())
            app, store = make_app(tmp, shazam)
            self.assertEqual(app.recognize_audio(LOUD, trigger="ocioso")["status"], "matched")
            skipped = app.recognize_audio(LOUD, trigger="pausa_fora")
            self.assertEqual(skipped["status"], "skipped_recent")
            self.assertEqual(shazam.recognize.call_count, 1)
            # o botão manual sempre chama
            self.assertEqual(app.recognize_audio(LOUD, trigger="manual")["status"], "matched")
            self.assertEqual(shazam.recognize.call_count, 2)
            # passados 2 minutos, o automático volta a valer
            app._last_match_at = time.time() - 121
            self.assertEqual(app.recognize_audio(LOUD, trigger="pausa_fora")["status"], "matched")

    def test_trigger_is_recorded_and_counted(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.recognize_audio(LOUD, trigger="ocioso")
            app.recognize_audio(LOUD, trigger="deriva")
            report = store.recognition_report(since=0)
            self.assertEqual(report["by_trigger"], {"ocioso": 1})
            self.assertEqual(report["by_status"].get("skipped_recent"), 1)
            self.assertEqual(report["recent"][-1]["trigger"], "ocioso")

    def test_without_trigger_old_clients_still_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            self.assertEqual(app.recognize_audio(LOUD)["status"], "matched")
            self.assertEqual(app.recognize_audio(LOUD)["status"], "matched")


class PlayerSavingsTests(unittest.TestCase):
    def test_player_sends_reason_and_checks_once_per_track(self):
        self.assertIn('"X-Recognize-Reason": reasonForServer', APP_JS)
        self.assertIn("if (playingKey !== farGapTrackKey)", APP_JS)
        self.assertIn("unknownDurationCheckedKey", APP_JS)
        self.assertIn('response.status === "skipped_recent"', APP_JS)


if __name__ == "__main__":
    unittest.main()
