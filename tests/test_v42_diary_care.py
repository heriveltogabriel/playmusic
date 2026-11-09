import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

from tests.test_v36_compilations_devices import make_app
from vinyl_display.journal import build_care, listening_by_release, replace_needle, update_needle
from vinyl_display.routes import ADMIN, access_for

BRT = timezone(timedelta(hours=-3))


class ListeningTests(unittest.TestCase):
    def test_track_changes_become_a_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.start_manual_playback(1, "A")
            app.state()
            app.state()  # mesma faixa: não repete
            store_rows = store.listening_log_since(0)
            self.assertEqual([r["track_position"] for r in store_rows], ["A1"])
            # avança 200 s: entra a A2
            app.playback.active.started_at -= 200
            app.state()
            positions = [r["track_position"] for r in store.listening_log_since(0)]
            self.assertEqual(sorted(positions), ["A1", "A2"])
            disc = listening_by_release(store)[1]
            self.assertEqual(disc["sides"], ["A"])
            self.assertEqual([t["position"] for t in disc["tracks"]], ["A1", "A2"])
            self.assertEqual(disc["tracks"][0]["plays"], 1)

    def test_sides_and_tracks_by_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            now = time.time()
            store.log_track_play(now - 7200, 1, "A1", "Que País É Este", "A", 180)
            store.log_track_play(now - 3600, 1, "A1", "Que País É Este", "A", 180)
            store.log_track_play(now - 60, 1, "B10", "Faroeste Caboclo", "B", 540)
            store.log_track_play(now - 30, 1, "B2", "Angra dos Reis", "B", 200)
            disc = listening_by_release(store)[1]
            self.assertEqual(disc["sides"], ["A", "B"])
            self.assertEqual([t["position"] for t in disc["tracks"]], ["A1", "B2", "B10"])
            self.assertEqual(disc["tracks"][0]["plays"], 2)
            self.assertAlmostEqual(disc["last_at"], now - 30)

    def test_endpoints_are_admin(self):
        for path in ("/api/admin/listening", "/api/admin/care"):
            self.assertEqual(access_for("GET", path), ADMIN)
        for path in ("/api/admin/care/needle", "/api/admin/care/needle/replace", "/api/admin/care/cleaned"):
            self.assertEqual(access_for("POST", path), ADMIN)


class CareTests(unittest.TestCase):
    def test_needle_hours_and_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            store.increment_auditions(1)  # disco 1: 180+300+540 s
            store.increment_auditions(1)
            care = build_care(store)
            self.assertAlmostEqual(care["needle"]["hours_used"], round(2 * 1020 / 3600, 1))
            self.assertEqual(care["needle"]["life_hours"], 1000)
            update_needle(store, {"model": "AT-VM95E", "life_hours": "800"})
            replace_needle(store, now=time.time() + 1)
            care = build_care(store)
            self.assertEqual(care["needle"]["hours_used"], 0)
            self.assertEqual(care["needle"]["model"], "AT-VM95E")
            self.assertEqual(care["needle"]["life_hours"], 800)
            self.assertEqual(care["needle"]["history"][0]["hours"], round(2 * 1020 / 3600, 1))

    def test_cleaning_resets_plays_since_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            store.increment_auditions(2)
            first = {d["release_id"]: d for d in build_care(store)["discs"]}
            self.assertEqual(first[2]["plays_since_clean"], 1)
            store.mark_cleaned(2, time.time() + 1)
            after = {d["release_id"]: d for d in build_care(store)["discs"]}
            self.assertEqual(after[2]["plays_since_clean"], 0)
            self.assertEqual(after[2]["times_cleaned"], 1)
            store.mark_cleaned(2, time.time() + 2)
            self.assertEqual(store.cleaning_dates()[2]["times_cleaned"], 2)


if __name__ == "__main__":
    unittest.main()


class AuditionMergeTests(unittest.TestCase):
    def test_same_disc_back_on_the_platter_counts_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            now = time.time()
            self.assertTrue(app._auto_scrobble(1, now=now))
            # 35 min depois (lado/disco fora de ordem): mesma audição
            self.assertFalse(app._auto_scrobble(1, now=now + 35 * 60))
            self.assertEqual(len(store.get_release(1).listen_dates), 1)
            # outro disco não é afetado
            self.assertTrue(app._auto_scrobble(2, now=now + 36 * 60))
            # depois da janela (disco curto: 1 h + 30 min), conta de novo
            self.assertTrue(app._auto_scrobble(1, now=now + 2 * 3600))
            self.assertEqual(len(store.get_release(1).listen_dates), 2)
            report = store.recognition_report(since=0)
            self.assertEqual(report["by_status"].get("audition_merged"), 1)

    def test_player_flow_out_of_order_sides(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.start_manual_playback(1, "A")
            app.playback.active.started_at -= 400   # A1 inteira + parte da A2: conta a audição
            app.state()
            self.assertEqual(len(store.get_release(1).listen_dates), 1)
            app.stop_playback()                     # parou, voltou para a tela inicial
            app.start_manual_playback(1, "A")       # e pôs o disco de novo, fora de ordem
            app.playback.active.started_at -= 400
            app.state()
            self.assertEqual(len(store.get_release(1).listen_dates), 1)
