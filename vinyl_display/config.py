from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    discogs_user: str
    discogs_user_agent: str
    discogs_token: str
    rapidapi_shazam_key: str
    rapidapi_shazam_host: str
    data_dir: Path
    database_path: Path
    static_dir: Path
    host: str
    port: int
    clip_seconds: int
    cert_file: Path | None
    key_file: Path | None



def _optional_path(value: str | None) -> Path | None:
    return Path(value).expanduser() if value else None


def _parse_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value.split(" #", 1)[0].strip()


def _load_dotenv() -> None:
    if os.environ.get("VINYL_DISABLE_DOTENV") == "1":
        return

    env_path = Path(os.environ.get("VINYL_ENV_FILE", ".env")).expanduser()
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()

        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, _parse_env_value(value))


def load_config() -> Config:
    _load_dotenv()

    data_dir = Path(os.environ.get("VINYL_DATA_DIR", "data")).expanduser()
    static_dir = Path(os.environ.get("VINYL_STATIC_DIR", "static")).expanduser()
    database_path = Path(
        os.environ.get("VINYL_DATABASE_PATH", str(data_dir / "vinyl_display.sqlite3"))
    ).expanduser()

    return Config(
        discogs_user=os.environ.get("DISCOGS_USER", "heriveltogabriel"),
        discogs_user_agent=os.environ.get(
            "DISCOGS_USER_AGENT",
            "VinylDisplayMVP/0.1 +https://localhost",
        ),
        discogs_token=os.environ.get("DISCOGS_TOKEN", ""),
        rapidapi_shazam_key=os.environ.get("RAPIDAPI_SHAZAM_KEY", ""),
        rapidapi_shazam_host=os.environ.get(
            "RAPIDAPI_SHAZAM_HOST", "shazam-core.p.rapidapi.com"
        ),
        data_dir=data_dir,
        database_path=database_path,
        static_dir=static_dir,
        host=os.environ.get("VINYL_HOST", "0.0.0.0"),
        port=int(os.environ.get("VINYL_PORT", "8080")),
        clip_seconds=int(os.environ.get("VINYL_CLIP_SECONDS", "10")),
        cert_file=_optional_path(os.environ.get("VINYL_CERT_FILE")),
        key_file=_optional_path(os.environ.get("VINYL_KEY_FILE")),
    )


def update_dotenv(updates: dict[str, str]) -> None:
    env_path = Path(os.environ.get("VINYL_ENV_FILE", ".env")).expanduser()
    lines = []
    existing_keys = set()
    
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                parsed_line = stripped
                if parsed_line.startswith("export "):
                    parsed_line = parsed_line[len("export ") :].strip()
                key, val = parsed_line.split("=", 1)
                key = key.strip()
                if key in updates:
                    lines.append(f"{key}={updates[key]}")
                    existing_keys.add(key)
                    continue
            lines.append(line)
            
    # Add new keys that were not in .env before
    for key, val in updates.items():
        if key not in existing_keys:
            lines.append(f"{key}={val}")
            
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    
    # Update os.environ
    for key, val in updates.items():
        os.environ[key] = val
