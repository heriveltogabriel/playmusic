from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    discogs_user: str
    discogs_user_agent: str
    audd_api_token: str
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


def load_config() -> Config:
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
        audd_api_token=os.environ.get("AUDD_API_TOKEN", ""),
        data_dir=data_dir,
        database_path=database_path,
        static_dir=static_dir,
        host=os.environ.get("VINYL_HOST", "0.0.0.0"),
        port=int(os.environ.get("VINYL_PORT", "8080")),
        clip_seconds=int(os.environ.get("VINYL_CLIP_SECONDS", "10")),
        cert_file=_optional_path(os.environ.get("VINYL_CERT_FILE")),
        key_file=_optional_path(os.environ.get("VINYL_KEY_FILE")),
    )
