import os
import tempfile
import unittest
from pathlib import Path

from vinyl_display.auth import AuthManager, DEFAULT_PASSWORD


class AuthManagerTests(unittest.TestCase):
    def test_default_initialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            auth = AuthManager(tmp_path)
            
            # Should have created data/auth.json with default state
            self.assertTrue(auth.auth_file.exists())
            self.assertTrue(auth.is_first_access())
            self.assertTrue(auth.verify_password(DEFAULT_PASSWORD))
            self.assertFalse(auth.verify_password("wrongpassword"))

    def test_setup_new_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            auth = AuthManager(tmp_path)
            
            recovery_key = auth.setup_new_password("mysupersecretpassword")
            
            self.assertFalse(auth.is_first_access())
            self.assertTrue(auth.verify_password("mysupersecretpassword"))
            self.assertFalse(auth.verify_password(DEFAULT_PASSWORD))
            
            # Recovery key check
            self.assertTrue(recovery_key.startswith("VINYL-RESTORE-"))
            self.assertTrue(auth.verify_recovery_key(recovery_key))
            self.assertFalse(auth.verify_recovery_key("VINYL-RESTORE-WRONG-KEYY"))
            
            # Verify recovery_key.txt backup was written
            backup_file = tmp_path / "recovery_key.txt"
            self.assertTrue(backup_file.exists())
            self.assertEqual(backup_file.read_text(encoding="utf-8").strip(), recovery_key)

    def test_recover_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            auth = AuthManager(tmp_path)
            
            # Setup
            orig_recovery_key = auth.setup_new_password("firstpassword")
            
            # Recovery
            new_recovery_key = auth.recover_password(orig_recovery_key, "recoveredpassword")
            
            # Check key returned is new recovery key
            self.assertIsNotNone(new_recovery_key)
            self.assertNotEqual(new_recovery_key, orig_recovery_key)
            
            # Check password was updated
            self.assertTrue(auth.verify_password("recoveredpassword"))
            self.assertFalse(auth.verify_password("firstpassword"))
            
            # Check recovery key rotation
            self.assertFalse(auth.verify_recovery_key(orig_recovery_key))
            self.assertTrue(auth.verify_recovery_key(new_recovery_key))
            
            # Check recovery key backup file was updated
            backup_file = tmp_path / "recovery_key.txt"
            self.assertEqual(backup_file.read_text(encoding="utf-8").strip(), new_recovery_key)

    def test_session_management(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            auth = AuthManager(tmp_path)
            
            token1 = auth.create_session()
            token2 = auth.create_session()
            
            self.assertTrue(auth.validate_session(token1))
            self.assertTrue(auth.validate_session(token2))
            self.assertFalse(auth.validate_session("invalidtoken"))
            
            # Persistent check (load sessions from file)
            auth2 = AuthManager(tmp_path)
            self.assertTrue(auth2.validate_session(token1))
            
            # Destroy session
            auth.destroy_session(token1)
            self.assertFalse(auth.validate_session(token1))
            self.assertTrue(auth.validate_session(token2))
            
            # Reload verify destroyed
            auth3 = AuthManager(tmp_path)
            self.assertFalse(auth3.validate_session(token1))
            self.assertTrue(auth3.validate_session(token2))

    def test_reset_to_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            auth = AuthManager(tmp_path)
            
            # Alter state
            auth.setup_new_password("differentpassword")
            self.assertFalse(auth.is_first_access())
            
            # Reset
            auth.reset_to_default(save=True)
            self.assertTrue(auth.is_first_access())
            self.assertTrue(auth.verify_password(DEFAULT_PASSWORD))
            self.assertFalse(auth.verify_password("differentpassword"))
            
            # Recovery key text file should be removed
            backup_file = tmp_path / "recovery_key.txt"
            self.assertFalse(backup_file.exists())


if __name__ == "__main__":
    unittest.main()
