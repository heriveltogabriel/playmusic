import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track, TrackMatch
from vinyl_display.playback import PlaybackController

ROOT = Path(__file__).resolve().parent.parent


def lp(release_id=7):
    return Release(
        release_id=release_id, title="Disco", artist="Artista", year=1977, cover_url="", country="",
        labels=[], catalog_numbers=[], formats=["Vinyl", "LP"], discogs_url="",
        tracks=[Track("A1", "Um", 200), Track("A2", "Dois", 100), Track("B1", "Tres", 150), Track("B2", "Quatro", 120)],
    )


def playing(now=1000.0, release=None):
    release = release or lp()
    controller = PlaybackController()
    controller.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=now)
    return controller, release


class TimelineExtrasTests(unittest.TestCase):
    def test_side_remaining_and_unconfirmed_boundaries(self):
        c, _ = playing()
        state = c.current_state(now=1000 + 50)
        self.assertEqual(state["side_remaining_seconds"], 253.0)  # 200 + 3 + 100 - 50
        self.assertEqual(state["unconfirmed_boundaries"], 0)
        # A2 começa em 203 s; 30 s depois ainda sem pausa -> 1 troca não confirmada
        self.assertEqual(c.current_state(now=1000 + 240)["unconfirmed_boundaries"], 1)


class AlignTests(unittest.TestCase):
    def test_gap_near_track_start_realigns_clock(self):
        c, _ = playing()
        # A2 deveria começar em 203 s, mas o som voltou em 210 s (Discogs errou 7 s)
        result = c.align_track_start(at=1000 + 210, now=1000 + 212)
        self.assertEqual(result, {"aligned": True, "track": "A2", "shift": 7.0})
        state = c.current_state(now=1000 + 212)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 2)
        self.assertEqual(state["unconfirmed_boundaries"], 0)

    def test_quiet_passage_far_from_boundary_is_ignored(self):
        c, _ = playing()
        result = c.align_track_start(at=1000 + 120, now=1000 + 121)
        self.assertFalse(result["aligned"])
        self.assertEqual(c.current_state(now=1000 + 121)["progress_seconds"], 121)


class FlipTests(unittest.TestCase):
    def test_flip_goes_to_first_track_of_next_side(self):
        c, _ = playing()
        state = c.current_state(now=1000 + 320)  # lado A acabou em 303 s
        self.assertEqual(state["status"], "waiting_flip")
        result = c.flip_to_next_side(at=1000 + 340, now=1000 + 345)
        self.assertEqual(result, {"flipped": True, "track": "B1"})
        state = c.current_state(now=1000 + 345)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "B1")
        self.assertEqual(state["progress_seconds"], 5)

    def test_flip_after_last_side_is_rejected(self):
        release = lp()
        c = PlaybackController()
        c.handle_match(TrackMatch(release, release.tracks[2], 100, "t"), now=1000)
        self.assertEqual(c.flip_to_next_side(at=1300, now=1300)["reason"], "last_side")

    def test_flip_counts_side_a_as_played_for_audition(self):
        scrobbled = []
        release = lp()
        c = PlaybackController(on_scrobble=scrobbled.append)
        c.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=1000)
        c.flip_to_next_side(at=1000 + 320, now=1000 + 320)
        c.current_state(now=1000 + 330)
        self.assertEqual(scrobbled, [7])


class PersistenceTests(unittest.TestCase):
    def test_restart_restores_active_playback(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "c.sqlite3")
            store.initialize()
            release = lp()
            store.upsert_release(release)
            app = VinylDisplayApp(store, None, MagicMock(), musicbrainz_client=MagicMock())
            import time
            now = time.time()
            app.playback.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=now - 210)
            app.playback.align_track_start(at=now - 3, now=now)
            saved = json.loads(store.get_metadata("active_playback"))
            self.assertEqual(saved["track_position"], "A1")

            reborn = VinylDisplayApp(store, None, MagicMock(), musicbrainz_client=MagicMock())
            state = reborn.state()
            self.assertEqual(state["status"], "playing")
            self.assertEqual(state["track"]["position"], "A2")

            reborn.stop_playback()
            self.assertEqual(store.get_metadata("active_playback"), "")
            self.assertIsNone(VinylDisplayApp(store, None, MagicMock(), musicbrainz_client=MagicMock()).playback.active)

    def test_old_snapshot_is_not_restored(self):
        c = PlaybackController()
        store = MagicMock()
        store.get_release.return_value = lp()
        snap = {"release_id": 7, "track_position": "A1", "started_at": 0, "saved_at": 0}
        self.assertFalse(c.restore(snap, store, now=10_000))


class AppEventTests(unittest.TestCase):
    def test_boundary_and_flip_are_logged_without_shazam(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "c.sqlite3")
            store.initialize()
            release = lp()
            store.upsert_release(release)
            shazam = MagicMock()
            app = VinylDisplayApp(store, None, shazam, musicbrainz_client=MagicMock())
            import time
            app.playback.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=time.time() - 330)
            out = app.playback_flip(ago_seconds=2, gap_seconds=14)
            self.assertTrue(out["result"]["flipped"])
            self.assertEqual(out["state"]["track"]["position"], "B1")
            app.playback_boundary(ago_seconds=1, gap_seconds=2)
            stats = store.recognition_stats(since=0)
            self.assertEqual(stats.get("flip_local"), 1)
            self.assertEqual(stats["shazam_calls"], 0)
            shazam.recognize.assert_not_called()


@unittest.skipUnless(shutil.which("node"), "node não instalado")
class SilenceDetectorJsTests(unittest.TestCase):
    def run_js(self, code):
        script = f"const m = require({json.dumps(str(ROOT / 'static' / 'silence-detector.js'))});\n{code}"
        out = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_detects_track_gap_and_side_end_but_not_needle_click(self):
        events = self.run_js("""
const d = new m.SilenceDetector(); let t = 0; const ev = [];
const feed = (rms, ms) => { for (let i = 0; i < ms; i += 250) { const e = d.push(rms, t); if (e) ev.push(e.gapMs); t += 250; } };
feed(0.12, 20000); feed(0.008, 2500); feed(0.13, 3000);
feed(0.12, 5000); feed(0.3, 250); feed(0.12, 5000);
feed(0.004, 12000); feed(0.2, 500); feed(0.003, 4000); feed(0.11, 4000);
console.log(JSON.stringify(ev));""")
        self.assertEqual(events, [2500, 16500])

    def test_soft_intro_marks_the_real_start_and_fires_once(self):
        # Ex.: "Every Little Thing She Does Is Magic" começa com piano baixo por ~20 s
        events = self.run_js("""
const d = new m.SilenceDetector(); let t = 0; const ev = [];
const feed = (rms, ms) => { for (let i = 0; i < ms; i += 250) { const e = d.push(rms, t); if (e) ev.push([e.gapMs, e.resumedAt]); t += 250; } };
feed(0.12, 20000); feed(0.004, 10000); feed(0.02, 20000); feed(0.12, 60000); feed(0.006, 2500); feed(0.12, 3000);
console.log(JSON.stringify(ev));""")
        self.assertEqual(events, [[10000, 30000], [2500, 112500]])

    def test_quiet_passage_is_not_a_gap(self):
        events = self.run_js("""
const d = new m.SilenceDetector(); let t = 0; const ev = [];
const feed = (rms, ms) => { for (let i = 0; i < ms; i += 250) { const e = d.push(rms, t); if (e) ev.push(e.gapMs); t += 250; } };
feed(0.12, 20000); feed(0.045, 8000); feed(0.12, 5000);
console.log(JSON.stringify(ev));""")
        self.assertEqual(events, [])

    def test_decisions(self):
        decisions = self.run_js("""
const s = (o) => Object.assign({release: {}}, o);
console.log(JSON.stringify([
  m.decideOnResume({gapMs: 2500}, s({status: 'playing', side_remaining_seconds: 600})),
  m.decideOnResume({gapMs: 16000}, s({status: 'playing', side_remaining_seconds: 40})),
  m.decideOnResume({gapMs: 16000}, s({status: 'playing', side_remaining_seconds: 600})),
  m.decideOnResume({gapMs: 9000}, s({status: 'waiting_flip', next_track: {}})),
  m.decideOnResume({gapMs: 9000}, s({status: 'waiting_flip', next_track: null})),
  m.decideOnResume({gapMs: 1000}, null),
]));""")
        self.assertEqual(decisions, ["boundary", "flip", "recognize", "flip", "recognize", "ignore"])


class StaticV352Tests(unittest.TestCase):
    def test_screen_stays_awake_only_with_a_record_loaded(self):
        app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn('navigator.wakeLock.request("screen")', app_js)
        self.assertIn("setScreenAwake(Boolean(state && state.release))", app_js)
        self.assertIn('document.addEventListener("visibilitychange"', app_js)


class StaticV35Tests(unittest.TestCase):
    def test_player_loads_detector_before_app(self):
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertLess(html.index("silence-detector.js"), html.index("/static/app.js"))
        app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("/api/playback/${action}", app_js)


if __name__ == "__main__":
    unittest.main()
