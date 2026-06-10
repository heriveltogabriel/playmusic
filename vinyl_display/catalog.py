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
                CREATE TABLE IF NOT EXISTS release_stats (
                    release_id INTEGER PRIMARY KEY,
                    rating INTEGER DEFAULT 0,
                    auditions INTEGER DEFAULT 0,
                    FOREIGN KEY(release_id) REFERENCES releases(release_id) ON DELETE CASCADE
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

    def increment_auditions(self, release_id: int) -> int:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO release_stats (release_id, auditions)
                VALUES (?, 1)
                ON CONFLICT(release_id) DO UPDATE SET
                    auditions = auditions + 1
                """,
                (release_id,),
            )
            row = connection.execute(
                "SELECT auditions FROM release_stats WHERE release_id = ?",
                (release_id,),
            ).fetchone()
        return int(row["auditions"]) if row else 1

    def update_rating(self, release_id: int, rating: int) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO release_stats (release_id, rating)
                VALUES (?, ?)
                ON CONFLICT(release_id) DO UPDATE SET
                    rating = excluded.rating
                """,
                (release_id, rating),
            )

    def list_releases_with_stats(self) -> list[Release]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT r.payload_json, r.synced_at, COALESCE(s.rating, 0) as rating, COALESCE(s.auditions, 0) as auditions
                FROM releases r
                LEFT JOIN release_stats s ON r.release_id = s.release_id
                ORDER BY r.artist, r.title
                """
            ).fetchall()
        
        releases = []
        for row in rows:
            data = json.loads(row["payload_json"])
            data["rating"] = row["rating"]
            data["auditions"] = row["auditions"]
            data["synced_at"] = row["synced_at"]
            releases.append(Release.from_dict(data))
        return releases

    def add_manual_release(self, title: str, artist: str, year: int | None, cover_url: str) -> Release:
        with self._connect() as connection:
            # Generate next local ID (negative values to prevent overlap with Discogs positive IDs)
            row = connection.execute("SELECT MIN(release_id) FROM releases").fetchone()
            min_id = row[0] if row[0] is not None else 0
            new_id = min_id - 1 if min_id < 0 else -1
            
            release = Release(
                release_id=new_id,
                title=title,
                artist=artist,
                year=year,
                cover_url=cover_url or "/static/logo_lp_da_semana.png",
                country="Local",
                labels=["Self-Released"],
                catalog_numbers=["LOCAL"],
                formats=["Vinyl"],
                tracks=[],
                discogs_url="",
                rating=0,
                auditions=0
            )
            
            # Save using standard upsert
            self.upsert_release(release)
            return release
