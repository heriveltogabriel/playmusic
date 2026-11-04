from __future__ import annotations

import os
import json
import hashlib
import secrets
import time
from pathlib import Path

DEFAULT_PASSWORD = "admin123"
DEFAULT_ITERATIONS = 100000

class AuthManager:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.auth_file = data_dir / "auth.json"
        self.sessions_file = data_dir / "sessions.json"
        self.devices_file = data_dir / "devices.json"
        
        self.password_hash = ""
        self.password_salt = ""
        self.is_default = True
        
        self.recovery_hash = ""
        self.recovery_salt = ""
        
        self.sessions = set()  # set of active tokens
        
        # Ensure directories exist
        os.makedirs(self.data_dir, exist_ok=True)
        
        self.load()
        self.load_sessions()

    def _hash(self, password: str, salt_hex: str = None) -> tuple[str, str]:
        if salt_hex is None:
            salt = secrets.token_bytes(16)
        else:
            salt = bytes.fromhex(salt_hex)
            
        dk = hashlib.pbkdf2_hmac(
            'sha256', 
            password.encode('utf-8'), 
            salt, 
            DEFAULT_ITERATIONS
        )
        return dk.hex(), salt.hex()

    def load(self) -> None:
        if not self.auth_file.exists():
            # Create default configuration
            self.reset_to_default(save=True)
            return

        try:
            with open(self.auth_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.password_hash = data.get("password_hash", "")
            self.password_salt = data.get("password_salt", "")
            self.is_default = data.get("is_default", True)
            self.recovery_hash = data.get("recovery_hash", "")
            self.recovery_salt = data.get("recovery_salt", "")
        except Exception as e:
            print(f"[AUTH] Error loading auth file: {e}. Resetting to default.")
            self.reset_to_default(save=True)

    def save(self) -> None:
        try:
            data = {
                "password_hash": self.password_hash,
                "password_salt": self.password_salt,
                "is_default": self.is_default,
                "recovery_hash": self.recovery_hash,
                "recovery_salt": self.recovery_salt
            }
            with open(self.auth_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[AUTH] Error saving auth file: {e}")

    def load_sessions(self) -> None:
        if not self.sessions_file.exists():
            return
        try:
            with open(self.sessions_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.sessions = set(data.get("sessions", []))
        except Exception as e:
            print(f"[AUTH] Error loading sessions: {e}")
            self.sessions = set()

    def save_sessions(self) -> None:
        try:
            data = {
                "sessions": list(self.sessions)
            }
            with open(self.sessions_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[AUTH] Error saving sessions: {e}")

    def reset_to_default(self, save: bool = True) -> None:
        p_hash, p_salt = self._hash(DEFAULT_PASSWORD)
        self.password_hash = p_hash
        self.password_salt = p_salt
        self.is_default = True
        self.recovery_hash = ""
        self.recovery_salt = ""
        if save:
            self.save()
            
            # Remove recovery key text file if it exists to avoid exposing default state
            recovery_txt = self.data_dir / "recovery_key.txt"
            if recovery_txt.exists():
                try:
                    os.remove(recovery_txt)
                except Exception:
                    pass

    def verify_password(self, password: str) -> bool:
        self.load()
        if not self.password_hash or not self.password_salt:
            return False
        h, _ = self._hash(password, self.password_salt)
        return h == self.password_hash

    def verify_recovery_key(self, key: str) -> bool:
        self.load()
        if not self.recovery_hash or not self.recovery_salt:
            return False
        # Normalize recovery key input
        key_normalized = key.strip().upper().replace(" ", "")
        h, _ = self._hash(key_normalized, self.recovery_salt)
        return h == self.recovery_hash

    def setup_new_password(self, new_password: str) -> str:
        # Generate new password hash
        p_hash, p_salt = self._hash(new_password)
        self.password_hash = p_hash
        self.password_salt = p_salt
        self.is_default = False
        
        # Generate recovery key
        # VINYL-RESTORE-XXXX-XXXX where X is alphanumeric hex
        random_part1 = secrets.token_hex(2).upper()
        random_part2 = secrets.token_hex(2).upper()
        recovery_key = f"VINYL-RESTORE-{random_part1}-{random_part2}"
        
        # Hash recovery key
        r_hash, r_salt = self._hash(recovery_key, None)
        self.recovery_hash = r_hash
        self.recovery_salt = r_salt
        
        self.save()
        
        # A chave é mostrada uma única vez para o usuário guardar; o servidor só guarda o hash.
        return recovery_key

    def recover_password(self, recovery_key: str, new_password: str) -> str | None:
        if not self.verify_recovery_key(recovery_key):
            return None
            
        # Update password
        p_hash, p_salt = self._hash(new_password)
        self.password_hash = p_hash
        self.password_salt = p_salt
        self.is_default = False
        
        # Keep the same recovery key or generate a new one? 
        # Typically keep the same or update. Let's keep it but regenerate is safer.
        # Let's regenerate to ensure one-time usage safety.
        # Generate new recovery key
        random_part1 = secrets.token_hex(2).upper()
        random_part2 = secrets.token_hex(2).upper()
        new_recovery_key = f"VINYL-RESTORE-{random_part1}-{random_part2}"
        
        r_hash, r_salt = self._hash(new_recovery_key, None)
        self.recovery_hash = r_hash
        self.recovery_salt = r_salt
        
        self.save()
        
        # A chave é mostrada uma única vez para o usuário guardar; o servidor só guarda o hash.
        return new_recovery_key

    def create_session(self) -> str:
        token = secrets.token_hex(32)
        self.sessions.add(token)
        self.save_sessions()
        return token

    def validate_session(self, token: str) -> bool:
        return token in self.sessions

    def destroy_session(self, token: str) -> None:
        if token in self.sessions:
            self.sessions.remove(token)
            self.save_sessions()
            
    def is_first_access(self) -> bool:
        return self.is_default

    # ------------------------------------------------------------------ v3.6
    # Aparelhos autorizados (o celular do player, o do Ouvir...). O token vai num cookie
    # de longa duração no aparelho; aqui só fica o hash SHA-256 dele.
    def _load_devices(self) -> list[dict]:
        if not self.devices_file.exists():
            return []
        try:
            with open(self.devices_file, "r", encoding="utf-8") as f:
                return list(json.load(f).get("devices", []))
        except Exception as e:
            print(f"[AUTH] Error loading devices: {e}")
            return []

    def _save_devices(self, devices: list[dict]) -> None:
        with open(self.devices_file, "w", encoding="utf-8") as f:
            json.dump({"devices": devices}, f, indent=2)

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def authorize_device(self, label: str) -> tuple[str, str]:
        """Cria um aparelho autorizado. Devolve (id, token); o token só existe no cookie."""
        token = secrets.token_hex(32)
        device_id = secrets.token_hex(4)
        devices = self._load_devices()
        now = time.time()
        devices.append(
            {
                "id": device_id,
                "label": (label or "Aparelho").strip()[:60],
                "token_hash": self._token_hash(token),
                "created_at": now,
                "last_seen": now,
            }
        )
        self._save_devices(devices)
        return device_id, token

    def validate_device(self, token: str | None) -> dict | None:
        if not token:
            return None
        token_hash = self._token_hash(token)
        devices = self._load_devices()
        for device in devices:
            if secrets.compare_digest(device.get("token_hash", ""), token_hash):
                # Atualiza "visto por último" no máximo a cada 10 min, para não gravar a cada poll
                if time.time() - float(device.get("last_seen", 0)) > 600:
                    device["last_seen"] = time.time()
                    try:
                        self._save_devices(devices)
                    except Exception as e:
                        print(f"[AUTH] Error saving devices: {e}")
                return device
        return None

    def list_devices(self) -> list[dict]:
        return [
            {k: v for k, v in device.items() if k != "token_hash"}
            for device in self._load_devices()
        ]

    def revoke_device(self, device_id: str) -> bool:
        devices = self._load_devices()
        remaining = [d for d in devices if d.get("id") != device_id]
        if len(remaining) == len(devices):
            return False
        self._save_devices(remaining)
        return True
