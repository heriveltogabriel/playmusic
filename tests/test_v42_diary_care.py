import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

from tests.test_v36_compilations_devices import make_app
from vinyl_display.journal import build_care, build_diary, replace_needle, update_needle
from vinyl_display.routes import ADMIN, access_for

BRT = timezone(timedelta(hours=-3))


class DiaryTests(unittest.TestCase):
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
            diary = build_diary(store, days=7)
            session = diary["sessions"][0]
            self.assertEqual(session["kind"], "tracks")
            self.assertEqual(session["discs"][0]["sides"], ["A"])
            self.assertEqual(len(session["discs"][0]["tracks"]), 2)
            self.assertEqual(diary["top_tracks"][0]["plays"], 1)

    def test_gap_splits_sessions_and_old_days_use_auditions(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            now = time.time()
            store.log_track_play(now - 7200, 1, "A1", "Que País É Este", "A", 180)
            store.log_track_play(now - 60, 2, "A1", "Será", "A", 150)
            old = datetime.now(timezone.utc) - timedelta(days=3)
            store.increment_auditions(3)
            from dataclasses import replace

            release = store.get_release(3)
            store.upsert_release(replace(release, listen_dates=[old.isoformat().replace("+00:00", "Z")]))
            diary = build_diary(store, days=30, now=now)
            kinds = [s["kind"] for s in diary["sessions"]]
            self.assertEqual(kinds.count("tracks"), 2)
            self.assertIn("auditions", kinds)

    def test_endpoints_are_admin(self):
        for path in ("/api/admin/diary", "/api/admin/care"):
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
