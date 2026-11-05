import os
import tempfile
import time
import unittest
from pathlib import Path

from tests.test_v36_compilations_devices import make_app
from vinyl_display.routes import ADMIN, access_for
from vinyl_display.system_status import build_system_status, last_backup


class SystemStatusTests(unittest.TestCase):
    def test_status_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            store.set_metadata("discogs_last_sync_at", str(time.time() - 3600))
            store.set_metadata("discogs_last_sync_count", "3")
            app.record_heartbeat({"audio": "running", "version": "4.2.0"})
            status = build_system_status(app)
            self.assertEqual(status["sync"]["count"], 3)
            self.assertTrue(status["player"]["online"])
            self.assertEqual(status["collection_count"], 3)
            self.assertIn("version", status)

    def test_last_backup_picks_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "oci"
            folder.mkdir()
            old = folder / "playmusic-backup-20261101-030000.tgz"
            new = folder / "playmusic-backup-20261105-030000.tgz"
            old.write_bytes(b"a")
            new.write_bytes(b"bb")
            os.utime(old, (time.time() - 86400 * 4, time.time() - 86400 * 4))
            info = last_backup([folder, Path(tmp) / "nada"])
            self.assertEqual(info["file"], new.name)
            self.assertEqual(info["size_bytes"], 2)
            self.assertTrue(info["uploaded"])
            self.assertIsNone(last_backup([Path(tmp) / "nada"]))

    def test_route_is_admin(self):
        self.assertEqual(access_for("GET", "/api/admin/system"), ADMIN)


if __name__ == "__main__":
    unittest.main()
