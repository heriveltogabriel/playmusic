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
        self.favorite_threshold = 5

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
                CREATE TABLE IF NOT EXISTS recognition_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    at REAL NOT NULL,
                    status TEXT NOT NULL,
                    shazam_called INTEGER NOT NULL DEFAULT 0,
                    shazam_key TEXT,
                    title TEXT,
                    artist TEXT,
                    release_id INTEGER,
                    track_position TEXT,
                    score INTEGER,
                    rms REAL,
                    active_release_id INTEGER,
                    detail TEXT
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_recognition_events_at ON recognition_events(at)"
            )
            # v4.2: o que disparou o reconhecimento (manual, troca de faixa, pausa fora do previsto...)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(recognition_events)")}
            if "trigger" not in columns:
                connection.execute("ALTER TABLE recognition_events ADD COLUMN trigger TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS release_preferences (
                    track_key TEXT PRIMARY KEY,
                    release_id INTEGER NOT NULL,
                    chosen_at REAL NOT NULL,
                    times INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            # v4.2: diário da vitrola (cada faixa que o player acompanhou) e limpeza dos discos
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS listening_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    at REAL NOT NULL,
                    release_id INTEGER NOT NULL,
                    track_position TEXT NOT NULL,
                    track_title TEXT,
                    side TEXT,
                    duration_seconds INTEGER
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_listening_log_at ON listening_log(at)")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS release_care (
                    release_id INTEGER PRIMARY KEY,
                    cleaned_at REAL NOT NULL,
                    times_cleaned INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            # v4.2 tinha as tabelas shelves/shelf_items (prateleiras); removidas da interface na
            # v4.10. As tabelas antigas ficam no banco, sem uso, para não apagar dados.
            # v4.3: disco cadastrado no Discogs como CD/arquivo, mas que você tem em vinil
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS release_overrides (
                    release_id INTEGER PRIMARY KEY,
                    vinyl_release_id INTEGER NOT NULL,
                    chosen_at REAL NOT NULL,
                    original_json TEXT NOT NULL
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
        # Merge with existing local fields if they exist to prevent sync overwrite
        existing = self.get_release(release.release_id)
        
        synced_at = release.synced_at
        if synced_at == 0.0:
            if existing and existing.synced_at > 0.0:
                synced_at = existing.synced_at
            else:
                synced_at = time.time()
                
        import dataclasses
        release = dataclasses.replace(release, synced_at=synced_at)

        if existing:
            # Keep existing local edits if the incoming release does not specify them
            notes = release.notes if release.notes else existing.notes
            listen_dates = release.listen_dates if release.listen_dates else existing.listen_dates
            rating = release.rating if release.rating else existing.rating
            auditions = release.auditions if release.auditions else existing.auditions
            favorite = (auditions >= self.favorite_threshold)
            release = dataclasses.replace(
                release,
                notes=notes,
                favorite=favorite,
                listen_dates=listen_dates,
                rating=rating,
                auditions=auditions,
                synced_at=synced_at
            )
        else:
            favorite = (release.auditions >= self.favorite_threshold)
            release = dataclasses.replace(release, synced_at=synced_at, favorite=favorite)
            
        payload_json = json.dumps(release.to_dict(), ensure_ascii=False, sort_keys=True)
        with self._connect() as connection:
            cur = connection.execute(
                """
                UPDATE releases
                SET title = ?, artist = ?, year = ?, cover_url = ?, payload_json = ?, synced_at = ?
                WHERE release_id = ?
                """,
                (
                    release.title,
                    release.artist,
                    release.year,
                    release.cover_url,
                    payload_json,
                    synced_at,
                    release.release_id,
                ),
            )
            if cur.rowcount == 0:
                connection.execute(
                    """
                    INSERT INTO releases (
                        release_id, title, artist, year, cover_url, payload_json, synced_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        release.release_id,
                        release.title,
                        release.artist,
                        release.year,
                        release.cover_url,
                        payload_json,
                        synced_at,
                    ),
                )
            # Ensure rating and auditions are synced in release_stats table too
            cur_stats = connection.execute(
                """
                UPDATE release_stats
                SET rating = ?, auditions = ?
                WHERE release_id = ?
                """,
                (release.rating, release.auditions, release.release_id),
            )
            if cur_stats.rowcount == 0:
                connection.execute(
                    """
                    INSERT INTO release_stats (release_id, rating, auditions)
                    VALUES (?, ?, ?)
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
        release = Release.from_dict(json.loads(row["payload_json"]))
        import dataclasses
        return dataclasses.replace(release, favorite=(release.auditions >= self.favorite_threshold))

    def list_releases(self) -> list[Release]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM releases ORDER BY artist, title"
            ).fetchall()
        releases = []
        import dataclasses
        for row in rows:
            release = Release.from_dict(json.loads(row["payload_json"]))
            releases.append(dataclasses.replace(release, favorite=(release.auditions >= self.favorite_threshold)))
        return releases

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
                INSERT OR REPLACE INTO sync_metadata (key, value)
                VALUES (?, ?)
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
            cur = connection.execute(
                """
                UPDATE release_stats
                SET auditions = auditions + 1
                WHERE release_id = ?
                """,
                (release_id,),
            )
            if cur.rowcount == 0:
                connection.execute(
                    """
                    INSERT INTO release_stats (release_id, auditions)
                    VALUES (?, 1)
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
            favorite = (auditions >= self.favorite_threshold)
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
                INSERT OR IGNORE INTO release_stats (release_id, auditions)
                VALUES (?, 0)
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
                favorite=(auditions >= self.favorite_threshold)
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
            cur = connection.execute(
                """
                UPDATE release_stats
                SET rating = ?
                WHERE release_id = ?
                """,
                (rating, release_id),
            )
            if cur.rowcount == 0:
                connection.execute(
                    """
                    INSERT INTO release_stats (release_id, rating)
                    VALUES (?, ?)
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
            data["favorite"] = (row["auditions"] >= self.favorite_threshold)
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
        original_year: int | None = None,
        edition_year: int | None = None,
    ) -> Release:
        with self._connect() as connection:
            # Generate next local ID (negative values to prevent overlap with Discogs positive IDs)
            row = connection.execute("SELECT MIN(release_id) FROM releases").fetchone()
            min_id = row[0] if row[0] is not None else 0
            new_id = min_id - 1 if min_id < 0 else -1
            
            if original_year is None:
                original_year = year
            if edition_year is None:
                edition_year = year

            release = Release(
                release_id=new_id,
                title=title,
                artist=artist,
                year=original_year,
                cover_url=cover_url or "/static/playvinil-cover.svg",
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
                listen_dates=[],
                original_year=original_year,
                edition_year=edition_year,
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
        original_year: int | None = None,
        edition_year: int | None = None,
    ) -> None:
        release = self.get_release(release_id)
        if release:
            if original_year is None:
                original_year = year
            if edition_year is None:
                edition_year = year

            import dataclasses
            updated_release = dataclasses.replace(
                release,
                title=title,
                artist=artist,
                year=original_year,
                cover_url=cover_url,
                genres=genres,
                styles=styles,
                labels=labels,
                catalog_numbers=catalog_numbers,
                notes=notes,
                rating=rating,
                original_year=original_year,
                edition_year=edition_year,
            )
            self.upsert_release(updated_release)

    def delete_release(self, release_id: int) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM releases WHERE release_id = ?", (release_id,))
            connection.execute("DELETE FROM release_stats WHERE release_id = ?", (release_id,))

    def get_preferred_release(self, track_key: str) -> int | None:
        """Disco que você escolheu da última vez para esta música (coletâneas, ao vivo...)."""
        if not track_key:
            return None
        with self._connect() as connection:
            row = connection.execute(
                "SELECT release_id FROM release_preferences WHERE track_key = ?", (track_key,)
            ).fetchone()
        return int(row["release_id"]) if row else None

    def save_preferred_release(self, track_key: str, release_id: int) -> None:
        if not track_key:
            return
        with self._connect() as connection:
            cur = connection.execute(
                """
                UPDATE release_preferences
                SET release_id = ?, chosen_at = ?,
                    times = CASE WHEN release_id = ? THEN times + 1 ELSE 1 END
                WHERE track_key = ?
                """,
                (release_id, time.time(), release_id, track_key),
            )
            if cur.rowcount == 0:
                connection.execute(
                    "INSERT INTO release_preferences (track_key, release_id, chosen_at, times) VALUES (?, ?, ?, 1)",
                    (track_key, release_id, time.time()),
                )

    def log_recognition_event(self, status: str, **fields) -> None:
        """Registra cada tentativa de reconhecimento (com ou sem chamada ao Shazam)."""
        allowed = {
            "shazam_called", "shazam_key", "title", "artist", "release_id",
            "track_position", "score", "rms", "active_release_id", "detail", "trigger",
        }
        values = {k: v for k, v in fields.items() if k in allowed}
        values["shazam_called"] = 1 if values.get("shazam_called") else 0
        columns = ["at", "status", *values.keys()]
        params = [fields.get("at") or time.time(), status, *values.values()]
        with self._connect() as connection:
            connection.execute(
                f"INSERT INTO recognition_events ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                params,
            )

    def recognition_report(self, since: float, recent_limit: int = 40) -> dict:
        """Painel de reconhecimento: chamadas ao Shazam por dia e por disco, o que o detector
        de silêncio resolveu sozinho e os últimos eventos."""
        from datetime import datetime, timedelta, timezone

        brt = timezone(timedelta(hours=-3))
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT e.at, e.status, e.shazam_called, e.shazam_key, e.title, e.artist, e.trigger,
                       COALESCE(e.release_id, e.active_release_id) AS rid, e.track_position, e.score, e.detail,
                       r.title AS release_title, r.artist AS release_artist
                FROM recognition_events e
                LEFT JOIN releases r ON r.release_id = COALESCE(e.release_id, e.active_release_id)
                WHERE e.at >= ?
                ORDER BY e.at
                """,
                (since,),
            ).fetchall()

        by_status: dict[str, int] = {}
        by_trigger: dict[str, int] = {}
        per_day: dict[str, int] = {}
        per_disc: dict[int, dict] = {}
        for row in rows:
            status = row["status"]
            by_status[status] = by_status.get(status, 0) + 1
            day = datetime.fromtimestamp(row["at"], brt).strftime("%Y-%m-%d")
            per_day.setdefault(day, 0)
            if row["shazam_called"]:
                per_day[day] += 1
                trigger = row["trigger"] or "sem_registro"
                by_trigger[trigger] = by_trigger.get(trigger, 0) + 1
            if row["rid"] is not None and row["release_title"]:
                disc = per_disc.setdefault(
                    int(row["rid"]),
                    {"release_id": int(row["rid"]), "title": row["release_title"], "artist": row["release_artist"],
                     "shazam_calls": 0, "flips_local": 0, "gaps_aligned": 0, "gaps_ignored": 0, "last_at": 0.0},
                )
                disc["shazam_calls"] += 1 if row["shazam_called"] else 0
                disc["flips_local"] += 1 if status == "flip_local" else 0
                disc["gaps_aligned"] += 1 if status == "gap_aligned" else 0
                disc["gaps_ignored"] += 1 if status == "gap_ignored" else 0
                disc["last_at"] = max(disc["last_at"], float(row["at"]))

        recent = [
            {
                "at": row["at"],
                "status": row["status"],
                "shazam_called": bool(row["shazam_called"]),
                "shazam_key": row["shazam_key"],
                "title": row["title"],
                "artist": row["artist"],
                "release_title": row["release_title"],
                "track_position": row["track_position"],
                "detail": row["detail"],
                "trigger": row["trigger"],
            }
            for row in rows[-recent_limit:]
        ][::-1]

        shazam_calls = sum(1 for row in rows if row["shazam_called"])
        identified = by_status.get("matched", 0)
        attempts = identified + by_status.get("no_result", 0) + by_status.get("not_found", 0)
        discs = sorted(per_disc.values(), key=lambda d: d["last_at"], reverse=True)
        return {
            "since": since,
            "shazam_calls": shazam_calls,
            "by_status": by_status,
            "by_trigger": by_trigger,
            "per_day": [{"day": day, "shazam_calls": calls} for day, calls in sorted(per_day.items())],
            "discs": discs,
            "recent": recent,
            "match_rate": round(identified / attempts * 100) if attempts else None,
            "calls_per_disc": round(shazam_calls / len(discs), 1) if discs else None,
            "solved_locally": by_status.get("flip_local", 0) + by_status.get("gap_aligned", 0),
        }

    def recognition_stats(self, since: float) -> dict[str, int]:
        """Contagem de eventos por status desde `since` e total de chamadas ao Shazam."""
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT status, COUNT(*), SUM(shazam_called) FROM recognition_events WHERE at >= ? GROUP BY status",
                (since,),
            ).fetchall()
        stats = {row[0]: int(row[1]) for row in rows}
        stats["shazam_calls"] = sum(int(row[2] or 0) for row in rows)
        return stats

    def update_tracks(self, release_id: int, tracks: list[Track]) -> bool:
        """Substitui a tracklist de um disco preservando todos os outros campos."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM releases WHERE release_id = ?", (release_id,)
            ).fetchone()
            if row is None:
                return False
            payload = json.loads(row["payload_json"])
            payload["tracks"] = [track.to_dict() for track in tracks]
            connection.execute(
                "UPDATE releases SET payload_json = ? WHERE release_id = ?",
                (json.dumps(payload, ensure_ascii=False, sort_keys=True), release_id),
            )
        return True

    def update_track_duration(self, release_id: int, position: str, duration_seconds: int) -> bool:
        """Preenche a duração de uma faixa que ainda não tem duração. Não sobrescreve valores existentes."""
        release = self.get_release(release_id)
        if release is None:
            return False
        changed = False
        tracks = []
        for track in release.tracks:
            if track.position == position and not track.duration_seconds:
                track = Track(track.position, track.title, int(duration_seconds))
                changed = True
            tracks.append(track)
        return self.update_tracks(release_id, tracks) if changed else False

    def toggle_favorite(self, release_id: int) -> bool:
        release = self.get_release(release_id)
        if not release:
            raise ValueError(f"Release {release_id} not found")
        return release.favorite

    # ---------------- v4.2: diário da vitrola ----------------
    def log_track_play(self, at: float, release_id: int, track_position: str, track_title: str = "",
                       side: str = "", duration_seconds: int | None = None) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO listening_log (at, release_id, track_position, track_title, side, duration_seconds) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (at, release_id, track_position, track_title, side, duration_seconds),
            )

    def listening_log_since(self, since: float) -> list[dict]:
        with self._connect() as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                "SELECT at, release_id, track_position, track_title, side, duration_seconds "
                "FROM listening_log WHERE at >= ? ORDER BY at",
                (since,),
            ).fetchall()
        return [dict(row) for row in rows]

    def top_tracks(self, since: float = 0.0, limit: int = 20) -> list[dict]:
        with self._connect() as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                "SELECT release_id, track_position, MAX(track_title) AS track_title, COUNT(*) AS plays, MAX(at) AS last_at "
                "FROM listening_log WHERE at >= ? GROUP BY release_id, track_position "
                "ORDER BY plays DESC, last_at DESC LIMIT ?",
                (since, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    # ---------------- v4.2: cuidados com os discos ----------------
    def mark_cleaned(self, release_id: int, at: float) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO release_care (release_id, cleaned_at, times_cleaned) VALUES (?, ?, 1) "
                "ON CONFLICT(release_id) DO UPDATE SET cleaned_at = excluded.cleaned_at, "
                "times_cleaned = release_care.times_cleaned + 1",
                (release_id, at),
            )

    def cleaning_dates(self) -> dict[int, dict]:
        with self._connect() as connection:
            rows = connection.execute("SELECT release_id, cleaned_at, times_cleaned FROM release_care").fetchall()
        return {int(r[0]): {"cleaned_at": float(r[1]), "times_cleaned": int(r[2])} for r in rows}

    # ---------------- v4.2: prateleiras ----------------
    DEFAULT_SHELVES = (("Festa", "🎉"), ("Domingo de manhã", "☀️"), ("Emprestados", "🤝"))

    def get_override(self, release_id: int) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT vinyl_release_id, chosen_at, original_json FROM release_overrides WHERE release_id = ?",
                (release_id,),
            ).fetchone()
        if row is None:
            return None
        return {"vinyl_release_id": int(row[0]), "chosen_at": float(row[1]), "original": json.loads(row[2])}

    def list_overrides(self) -> dict[int, int]:
        with self._connect() as connection:
            rows = connection.execute("SELECT release_id, vinyl_release_id FROM release_overrides").fetchall()
        return {int(r[0]): int(r[1]) for r in rows}

    def save_override(self, release_id: int, vinyl_release_id: int, original: dict, chosen_at: float) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO release_overrides (release_id, vinyl_release_id, chosen_at, original_json) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(release_id) DO UPDATE SET "
                "vinyl_release_id = excluded.vinyl_release_id, chosen_at = excluded.chosen_at",
                (release_id, vinyl_release_id, chosen_at, json.dumps(original, ensure_ascii=False)),
            )

    def delete_override(self, release_id: int) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM release_overrides WHERE release_id = ?", (release_id,))

