import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticAssetTests(unittest.TestCase):
    def test_index_contains_required_mount_points(self):
        html = (ROOT / "static" / "index.html").read_text()

        self.assertIn('id="album-cover"', html)
        self.assertIn('id="track-title"', html)
        self.assertIn('id="artist-name"', html)
        self.assertIn('id="sync-button"', html)

    def test_app_uses_microphone_and_media_recorder(self):
        js = (ROOT / "static" / "app.js").read_text()

        self.assertIn("navigator.mediaDevices.getUserMedia", js)
        self.assertIn("MediaRecorder", js)
        self.assertIn("/api/recognize", js)
        self.assertIn("/api/state", js)
        self.assertIn("MediaRecorder.isTypeSupported", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn("Permissão do microfone negada", js)

    def test_css_is_amoled_friendly_and_has_no_negative_letter_spacing(self):
        css = (ROOT / "static" / "styles.css").read_text()

        self.assertIn("background: #050505", css)
        self.assertNotIn("letter-spacing: -", css)
        self.assertNotIn("font-size: clamp", css)
        font_size_declarations = re.findall(r"font-size:[^;]+;", css)
        self.assertFalse(
            [declaration for declaration in font_size_declarations if "vw" in declaration],
        )


if __name__ == "__main__":
    unittest.main()
