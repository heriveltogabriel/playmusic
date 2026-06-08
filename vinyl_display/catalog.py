from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Iterator

from vinyl_display.models import Release, Track


class CatalogStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS releases (
                    release_id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    year INTEGER,
                    cover_url TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    synced_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sync_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )

    def upsert_release(self, release: Release) -> None:
        payload_json = json.dumps(release.to_dict(), ensure_ascii=False, sort_keys=True)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO releases (
                    release_id, title, artist, year, cover_url, payload_json, synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(release_id) DO UPDATE SET
                    title = excluded.title,
                    artist = excluded.artist,
                    year = excluded.year,
                    cover_url = excluded.cover_url,
                    payload_json = excluded.payload_json,
                    synced_at = excluded.synced_at
                """,
                (
                    release.release_id,
                    release.title,
                    release.artist,
                    release.year,
                    release.cover_url,
                    payload_json,
                    time.time(),
                ),
            )

    def get_release(self, release_id: int) -> Release | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM releases WHERE release_id = ?",
                (release_id,),
            ).fetchone()
        if row is None:
            return None
        return Release.from_dict(json.loads(row["payload_json"]))

    def list_releases(self) -> list[Release]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM releases ORDER BY artist, title"
            ).fetchall()
        return [Release.from_dict(json.loads(row["payload_json"])) for row in rows]

    def iter_track_candidates(self) -> Iterator[tuple[Release, Track]]:
        for release in self.list_releases():
            for track in release.tracks:
                yield release, track

    def collection_count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM releases").fetchone()
        return int(row["count"])

    def set_metadata(self, key: str, value: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO sync_metadata (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def get_metadata(self, key: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM sync_metadata WHERE key = ?",
                (key,),
            ).fetchone()
        return None if row is None else str(row["value"])
