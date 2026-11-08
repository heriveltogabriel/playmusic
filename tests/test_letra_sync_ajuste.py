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


class BrandTests(unittest.TestCase):
    def test_old_brand_is_gone_from_app_screens(self):
        for name in ("index.html", "admin.html", "ouvir.html", "app.js", "manifest.json"):
            text = (ROOT / "static" / name).read_text(encoding="utf-8")
            self.assertNotIn("LP da Semana", text, name)
            self.assertNotIn("LP DA SEMANA", text, name)
            self.assertNotIn("Conversas em Vinil", text, name)
        self.assertTrue((ROOT / "static" / "playvinil-cover.svg").exists())
        self.assertTrue((ROOT / "static" / "playvinil-icon.png").exists())

    def test_collection_name_config(self):
        import os
        from unittest import mock

        from vinyl_display.config import load_config

        with mock.patch.dict(os.environ, {"VINYL_DISABLE_DOTENV": "1", "COLLECTION_NAME": " Discoteca do Herivelto "}):
            self.assertEqual(load_config().collection_name, "Discoteca do Herivelto")


class MicSensitivityTests(unittest.TestCase):
    def test_idle_listen_requires_steady_sound_and_backs_off(self):
        js = (Path(__file__).resolve().parent.parent / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("STEADY_MIN_RATIO = 0.85", js)
        self.assertIn("steadyRatio() >= STEADY_MIN_RATIO", js)
        self.assertIn("LOUD_SECONDS_NEEDED = 4", js)
        self.assertIn("30000 * Math.pow(2, steps)", js)


class ModoGravacaoTests(unittest.TestCase):
    def test_recording_page_exists_and_never_calls_shazam(self):
        root = Path(__file__).resolve().parent.parent
        html = (root / "static" / "gravar.html").read_text(encoding="utf-8")
        js = (root / "static" / "gravar.js").read_text(encoding="utf-8")
        self.assertIn("Inscreva-se no canal", html)
        self.assertIn("@lpdasemana", html)
        self.assertIn("LP DA SEMANA", html)
        self.assertNotIn("/api/recognize", js)  # microfone só mede o volume para a virada
        self.assertIn("/api/playback/flip", js)
        self.assertIn("/api/playback/start_manual", js)
        self.assertNotIn("gravar-button", (root / "static" / "index.html").read_text(encoding="utf-8"))
        self.assertIn("/vinyl/gravar", (root / "static" / "herivelto.html").read_text(encoding="utf-8"))
        server = (root / "vinyl_display" / "server.py").read_text(encoding="utf-8")
        self.assertIn('self._send_static("gravar.html")', server)
