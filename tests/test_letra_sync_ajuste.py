import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")
ADMIN = (ROOT / "static" / "admin.html").read_text(encoding="utf-8")


class LyricsSyncAdjustTests(unittest.TestCase):
    def test_back_to_synced_overlay(self):
        self.assertNotIn("lyrics-reader", JS)
        self.assertIn('activeEl.classList.add("active")', JS)

    def test_adjust_controls_and_per_song_offset(self):
        self.assertIn("lyricsLatencyOffset + lyricsTrackOffset", JS)
        self.assertIn('[["-0.5", "−0,5 s"', JS)
        self.assertIn('["0.5", "+0,5 s"', JS)
        self.assertIn("saveLyricsOffset(lyricsTrackKey, lyricsTrackOffset)", JS)
        self.assertIn(".lyrics-sync-bar", CSS)

    def test_global_offset_setting_is_back(self):
        self.assertNotIn('data-settings-tab="oculto"', ADMIN)


if __name__ == "__main__":
    unittest.main()
