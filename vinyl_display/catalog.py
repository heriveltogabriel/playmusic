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
        synced_time = release.synced_at or time.time()
        if release.synced_at == 0.0:
            import dataclasses
            release = dataclasses.replace(release, synced_at=synced_time)
            
        # Merge with existing local fields if they exist to prevent sync overwrite
        existing = self.get_release(release.release_id)
        if existing:
            import dataclasses
            # Keep existing local edits if the incoming release does not specify them
            notes = release.notes if release.notes else existing.notes
            favorite = release.favorite if release.favorite else existing.favorite
            listen_dates = release.listen_dates if release.listen_dates else existing.listen_dates
            rating = release.rating if release.rating else existing.rating
            auditions = release.auditions if release.auditions else existing.auditions
            release = dataclasses.replace(
                release,
                notes=notes,
                favorite=favorite,
                listen_dates=listen_dates,
                rating=rating,
                auditions=auditions
            )
            
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
                    synced_time,
                ),
            )
            # Ensure rating and auditions are synced in release_stats table too
            connection.execute(
                """
                INSERT INTO release_stats (release_id, rating, auditions)
                VALUES (?, ?, ?)
                ON CONFLICT(release_id) DO UPDATE SET
                    rating = excluded.rating,
                    auditions = excluded.auditions
                """,
                (release.release_id, release.rating, release.auditions),
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
        import datetime
        now_str = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        
        # 1. Update release_stats table
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
            auditions = int(row["auditions"]) if row else 1

        # 2. Update release payload
        release = self.get_release(release_id)
        if release:
            import dataclasses
            # Make sure listen_dates is a list (could be missing/None)
            listen_dates = list(release.listen_dates) if release.listen_dates is not None else []
            listen_dates.append(now_str)
            favorite = release.favorite
            if auditions >= 20:
                favorite = True
            updated_release = dataclasses.replace(
                release,
                auditions=auditions,
                listen_dates=listen_dates,
                favorite=favorite
            )
            self.upsert_release(updated_release)
            
        return auditions

    def decrement_auditions(self, release_id: int) -> int:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO release_stats (release_id, auditions)
                VALUES (?, 0)
                ON CONFLICT(release_id) DO NOTHING
                """,
                (release_id,),
            )
            connection.execute(
                """
                UPDATE release_stats
                SET auditions = CASE
                    WHEN auditions > 0 THEN auditions - 1
                    ELSE 0
                END
                WHERE release_id = ?
                """,
                (release_id,),
            )
            row = connection.execute(
                "SELECT auditions FROM release_stats WHERE release_id = ?",
                (release_id,),
            ).fetchone()
            auditions = int(row["auditions"]) if row else 0

        release = self.get_release(release_id)
        if release:
            import dataclasses
            listen_dates = list(release.listen_dates) if release.listen_dates is not None else []
            if listen_dates:
                listen_dates.pop()
            updated_release = dataclasses.replace(
                release,
                auditions=auditions,
                listen_dates=listen_dates,
            )
            payload_json = json.dumps(updated_release.to_dict(), ensure_ascii=False, sort_keys=True)
            with self._connect() as connection:
                connection.execute(
                    "UPDATE releases SET payload_json = ? WHERE release_id = ?",
                    (payload_json, release_id),
                )

        return auditions

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
        release = self.get_release(release_id)
        if release:
            import dataclasses
            updated_release = dataclasses.replace(release, rating=rating)
            self.upsert_release(updated_release)

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

    def add_manual_release(
        self,
        title: str,
        artist: str,
        year: int | None,
        cover_url: str,
        labels: list[str] = None,
        catalog_numbers: list[str] = None,
        genres: list[str] = None,
        styles: list[str] = None,
        notes: str = "",
        rating: int = 0,
        favorite: bool = False,
    ) -> Release:
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
                labels=labels if labels is not None else ["Self-Released"],
                catalog_numbers=catalog_numbers if catalog_numbers is not None else ["LOCAL"],
                formats=["Vinyl"],
                tracks=[],
                discogs_url="",
                rating=rating,
                auditions=0,
                genres=genres if genres is not None else [],
                styles=styles if styles is not None else [],
                notes=notes,
                favorite=favorite,
                listen_dates=[]
            )
            
            # Save using standard upsert
            self.upsert_release(release)
            return release

    def update_release_details(
        self,
        release_id: int,
        title: str,
        artist: str,
        year: int | None,
        cover_url: str,
        genres: list[str],
        styles: list[str],
        labels: list[str],
        catalog_numbers: list[str],
        notes: str,
        rating: int,
    ) -> None:
        release = self.get_release(release_id)
        if release:
            import dataclasses
            updated_release = dataclasses.replace(
                release,
                title=title,
                artist=artist,
                year=year,
                cover_url=cover_url,
                genres=genres,
                styles=styles,
                labels=labels,
                catalog_numbers=catalog_numbers,
                notes=notes,
                rating=rating,
            )
            self.upsert_release(updated_release)

    def delete_release(self, release_id: int) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM releases WHERE release_id = ?", (release_id,))
            connection.execute("DELETE FROM release_stats WHERE release_id = ?", (release_id,))

    def toggle_favorite(self, release_id: int) -> bool:
        release = self.get_release(release_id)
        if not release:
            raise ValueError(f"Release {release_id} not found")
        import dataclasses
        new_fav = not release.favorite
        updated_release = dataclasses.replace(release, favorite=new_fav)
        self.upsert_release(updated_release)
        return new_fav
