import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")


class LyricsReaderTests(unittest.TestCase):
    def test_reader_is_full_screen_and_plain(self):
        self.assertIn('elements.lyricsOverlay.classList.add("lyrics-reader")', JS)
        self.assertIn("document.body.appendChild(elements.lyricsOverlay)", JS)
        self.assertIn(".lyrics-overlay.lyrics-reader {", CSS)
        self.assertNotIn('activeEl.classList.add("active")', JS)  # sem destacar verso

    def test_only_lyrics_with_matching_duration(self):
        self.assertIn("const LYRICS_DURATION_TOLERANCE = 8;", JS)
        self.assertIn("<= LYRICS_DURATION_TOLERANCE) || null", JS)
        self.assertNotIn("let bestMatch = results[0];", JS)

    def test_touch_pauses_auto_scroll(self):
        self.assertIn("readerPausedUntil = Date.now() + READER_PAUSE_AFTER_TOUCH_MS", JS)


if __name__ == "__main__":
    unittest.main()
