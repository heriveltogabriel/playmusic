# Vinyl Display MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Raspberry Pi server and minimalist Android PWA that recognizes vinyl playback, matches it against the user's Discogs collection, and displays the current album and track.

**Architecture:** A Python stdlib server runs on the Raspberry Pi, stores a normalized Discogs catalog in SQLite, receives microphone clips from the Android browser, calls AudD for recognition, and exposes a simple JSON API. A vanilla HTML/CSS/JS PWA runs on the OnePlus 5, captures microphone audio over HTTPS, posts short clips to the server, polls playback state, and renders the minimal display.

**Tech Stack:** Python 3.11+ stdlib, SQLite, `unittest`, vanilla HTML/CSS/JavaScript, Discogs public API, AudD API, Chrome/Android `getUserMedia` over HTTPS.

---

## Scope Check

The approved spec covers one coherent MVP: local server, Discogs sync, recognition, matching, playback state, and minimalist display. It does not need separate sub-project specs because each task below produces working software inside the same deployable app.

## File Structure

- Create `pyproject.toml`: project metadata and test command hints.
- Create `vinyl_display/__init__.py`: package marker and version.
- Create `vinyl_display/config.py`: environment-driven runtime config.
- Create `vinyl_display/models.py`: dataclasses shared by catalog, recognition, playback, and API.
- Create `vinyl_display/catalog.py`: SQLite catalog store for Discogs releases.
- Create `vinyl_display/clients/__init__.py`: client package marker.
- Create `vinyl_display/clients/discogs.py`: Discogs public API sync client.
- Create `vinyl_display/clients/audd.py`: AudD recognition client.
- Create `vinyl_display/matcher.py`: recognition-to-collection matching logic.
- Create `vinyl_display/playback.py`: playback state machine and track progress estimation.
- Create `vinyl_display/app.py`: application service layer used by the HTTP server.
- Create `vinyl_display/server.py`: stdlib HTTP server and route adapter.
- Create `static/index.html`: PWA shell.
- Create `static/styles.css`: minimalist AMOLED-friendly visual design.
- Create `static/app.js`: microphone capture, recognition posting, state polling, UI rendering.
- Create `.env.example`: documented environment variables.
- Create `README.md`: setup and local run instructions.
- Create `tests/`: standard-library unit tests for each backend component and static asset smoke tests.

## Task 1: Project Skeleton, Config, And Shared Models

**Files:**
- Create: `pyproject.toml`
- Create: `vinyl_display/__init__.py`
- Create: `vinyl_display/config.py`
- Create: `vinyl_display/models.py`
- Create: `tests/test_config_models.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_config_models.py`:

```python
import os
import tempfile
import unittest
from pathlib import Path

from vinyl_display.config import load_config
from vinyl_display.models import RecognitionResult, Release, Track


class ConfigAndModelTests(unittest.TestCase):
    def test_load_config_uses_defaults_and_env_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_env = os.environ.copy()
            try:
                os.environ.clear()
                os.environ.update({
                    "VINYL_DATA_DIR": tmp,
                    "VINYL_PORT": "8123",
                    "AUDD_API_TOKEN": "secret-token",
                })

                config = load_config()

                self.assertEqual(config.discogs_user, "heriveltogabriel")
                self.assertEqual(config.port, 8123)
                self.assertEqual(config.audd_api_token, "secret-token")
                self.assertEqual(config.database_path, Path(tmp) / "vinyl_display.sqlite3")
                self.assertEqual(config.static_dir.name, "static")
            finally:
                os.environ.clear()
                os.environ.update(old_env)

    def test_release_tracks_are_serializable(self):
        release = Release(
            release_id=14192689,
            title="Abbey Road",
            artist="The Beatles",
            year=2019,
            cover_url="https://example.test/abbey.jpg",
            country="US",
            labels=["Apple Records", "Capitol Records"],
            catalog_numbers=["B0030719-01"],
            formats=["Vinyl", "LP", "Album"],
            tracks=[
                Track(position="A1", title="Come Together", duration_seconds=261),
                Track(position="A2", title="Something", duration_seconds=183),
            ],
            discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
        )

        payload = release.to_dict()
        restored = Release.from_dict(payload)

        self.assertEqual(restored.release_id, 14192689)
        self.assertEqual(restored.tracks[0].position, "A1")
        self.assertEqual(restored.tracks[0].duration_seconds, 261)

    def test_recognition_result_normalizes_missing_fields(self):
        result = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album=None,
            provider="audd",
            confidence=0.82,
            raw={"result": {"title": "Come Together"}},
        )

        self.assertEqual(result.album_or_empty, "")
        self.assertEqual(result.display_artist, "The Beatles")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_config_models -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display'`.

- [ ] **Step 3: Create the package and config implementation**

Create `pyproject.toml`:

```toml
[project]
name = "vinyl-display"
version = "0.1.0"
description = "Local vinyl listening display for Raspberry Pi and Android"
requires-python = ">=3.11"

[tool.vinyl-display]
test-command = "python -m unittest discover -v"
```

Create `vinyl_display/__init__.py`:

```python
__version__ = "0.1.0"
```

Create `vinyl_display/config.py`:

```python
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
```

- [ ] **Step 4: Create shared dataclasses**

Create `vinyl_display/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Track:
    position: str
    title: str
    duration_seconds: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "title": self.title,
            "duration_seconds": self.duration_seconds,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Track":
        return cls(
            position=str(payload.get("position", "")),
            title=str(payload.get("title", "")),
            duration_seconds=payload.get("duration_seconds"),
        )


@dataclass(frozen=True)
class Release:
    release_id: int
    title: str
    artist: str
    year: int | None
    cover_url: str
    country: str
    labels: list[str]
    catalog_numbers: list[str]
    formats: list[str]
    tracks: list[Track]
    discogs_url: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "release_id": self.release_id,
            "title": self.title,
            "artist": self.artist,
            "year": self.year,
            "cover_url": self.cover_url,
            "country": self.country,
            "labels": self.labels,
            "catalog_numbers": self.catalog_numbers,
            "formats": self.formats,
            "tracks": [track.to_dict() for track in self.tracks],
            "discogs_url": self.discogs_url,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Release":
        return cls(
            release_id=int(payload["release_id"]),
            title=str(payload.get("title", "")),
            artist=str(payload.get("artist", "")),
            year=payload.get("year"),
            cover_url=str(payload.get("cover_url", "")),
            country=str(payload.get("country", "")),
            labels=list(payload.get("labels", [])),
            catalog_numbers=list(payload.get("catalog_numbers", [])),
            formats=list(payload.get("formats", [])),
            tracks=[Track.from_dict(track) for track in payload.get("tracks", [])],
            discogs_url=str(payload.get("discogs_url", "")),
        )


@dataclass(frozen=True)
class RecognitionResult:
    title: str
    artist: str
    album: str | None
    provider: str
    confidence: float | None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def album_or_empty(self) -> str:
        return self.album or ""

    @property
    def display_artist(self) -> str:
        return self.artist or "Artista desconhecido"


@dataclass(frozen=True)
class TrackMatch:
    release: Release
    track: Track
    score: int
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "release": self.release.to_dict(),
            "track": self.track.to_dict(),
            "score": self.score,
            "reason": self.reason,
        }
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
python -m unittest tests.test_config_models -v
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml vinyl_display/__init__.py vinyl_display/config.py vinyl_display/models.py tests/test_config_models.py
git commit -m "feat: add project config and shared models"
```

## Task 2: SQLite Catalog Store

**Files:**
- Create: `vinyl_display/catalog.py`
- Create: `tests/test_catalog.py`

- [ ] **Step 1: Write the failing catalog tests**

Create `tests/test_catalog.py`:

```python
import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track


def abbey_road() -> Release:
    return Release(
        release_id=14192689,
        title="Abbey Road",
        artist="The Beatles",
        year=2019,
        cover_url="https://example.test/cover.jpg",
        country="US",
        labels=["Apple Records"],
        catalog_numbers=["B0030719-01"],
        formats=["Vinyl", "LP"],
        tracks=[
            Track("A1", "Come Together", 261),
            Track("A2", "Something", 183),
            Track("B1", "Here Comes The Sun", 185),
        ],
        discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
    )


class CatalogStoreTests(unittest.TestCase):
    def test_upsert_and_fetch_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            store.upsert_release(abbey_road())

            release = store.get_release(14192689)

            self.assertIsNotNone(release)
            self.assertEqual(release.title, "Abbey Road")
            self.assertEqual(release.tracks[2].position, "B1")
            self.assertEqual(store.collection_count(), 1)

    def test_iter_track_candidates_returns_every_track(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            store.upsert_release(abbey_road())

            candidates = list(store.iter_track_candidates())

            self.assertEqual(len(candidates), 3)
            self.assertEqual(candidates[0][0].title, "Abbey Road")
            self.assertEqual(candidates[0][1].title, "Come Together")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_catalog -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display.catalog'`.

- [ ] **Step 3: Implement the catalog store**

Create `vinyl_display/catalog.py`:

```python
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
```

- [ ] **Step 4: Run the catalog tests**

Run:

```bash
python -m unittest tests.test_catalog -v
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full backend test suite so far**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add vinyl_display/catalog.py tests/test_catalog.py
git commit -m "feat: add sqlite catalog store"
```

## Task 3: Discogs Public Collection Sync

**Files:**
- Create: `vinyl_display/clients/__init__.py`
- Create: `vinyl_display/clients/discogs.py`
- Create: `tests/test_discogs_client.py`

- [ ] **Step 1: Write the failing Discogs client tests**

Create `tests/test_discogs_client.py`:

```python
import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import DiscogsClient, parse_duration


class FakeJsonTransport:
    def __init__(self):
        self.urls = []

    def __call__(self, url, headers):
        self.urls.append(url)
        if url.endswith("/collection/folders/0/releases?per_page=100&page=1"):
            return {
                "pagination": {"page": 1, "pages": 1, "items": 1},
                "releases": [{"id": 14192689}],
            }
        if url.endswith("/releases/14192689"):
            return {
                "id": 14192689,
                "title": "Abbey Road",
                "artists_sort": "Beatles, The",
                "artists": [{"name": "The Beatles"}],
                "year": 2019,
                "country": "US",
                "uri": "https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
                "labels": [{"name": "Apple Records", "catno": "B0030719-01"}],
                "formats": [{"name": "Vinyl", "descriptions": ["LP", "Album"]}],
                "images": [{"type": "primary", "uri": "https://example.test/cover.jpg"}],
                "tracklist": [
                    {"position": "A1", "type_": "track", "title": "Come Together", "duration": "4:21"},
                    {"position": "A2", "type_": "track", "title": "Something", "duration": "3:03"},
                    {"position": "", "type_": "heading", "title": "Side B"},
                ],
            }
        raise AssertionError(f"Unexpected URL: {url}")


class DiscogsClientTests(unittest.TestCase):
    def test_parse_duration(self):
        self.assertEqual(parse_duration("4:21"), 261)
        self.assertEqual(parse_duration("1:02:03"), 3723)
        self.assertIsNone(parse_duration(""))

    def test_sync_collection_writes_release_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            store.initialize()
            client = DiscogsClient(
                username="heriveltogabriel",
                user_agent="VinylDisplayTest/0.1",
                request_json=FakeJsonTransport(),
            )

            count = client.sync_collection(store)
            release = store.get_release(14192689)

            self.assertEqual(count, 1)
            self.assertIsNotNone(release)
            self.assertEqual(release.title, "Abbey Road")
            self.assertEqual(release.artist, "The Beatles")
            self.assertEqual(release.labels, ["Apple Records"])
            self.assertEqual(release.catalog_numbers, ["B0030719-01"])
            self.assertEqual(release.tracks[0].duration_seconds, 261)
            self.assertEqual(store.get_metadata("discogs_last_sync_count"), "1")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_discogs_client -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display.clients'`.

- [ ] **Step 3: Implement the Discogs client**

Create `vinyl_display/clients/__init__.py`:

```python
"""External API clients used by vinyl_display."""
```

Create `vinyl_display/clients/discogs.py`:

```python
from __future__ import annotations

import json
import time
import urllib.request
from typing import Any, Callable

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track

JsonTransport = Callable[[str, dict[str, str]], dict[str, Any]]


def default_request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_duration(value: str | None) -> int | None:
    if not value:
        return None
    parts = value.split(":")
    if not all(part.isdigit() for part in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


def _artist_name(payload: dict[str, Any]) -> str:
    artists = payload.get("artists") or []
    if artists:
        names = [str(artist.get("anv") or artist.get("name") or "").strip() for artist in artists]
        names = [name for name in names if name]
        if names:
            return ", ".join(names)
    return str(payload.get("artists_sort") or "").strip()


def _cover_url(payload: dict[str, Any]) -> str:
    for image in payload.get("images") or []:
        if image.get("type") == "primary" and image.get("uri"):
            return str(image["uri"])
    images = payload.get("images") or []
    if images and images[0].get("uri"):
        return str(images[0]["uri"])
    return str(payload.get("thumb") or "")


def _format_values(payload: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for item in payload.get("formats") or []:
        name = str(item.get("name") or "").strip()
        if name:
            values.append(name)
        for description in item.get("descriptions") or []:
            description = str(description).strip()
            if description and description not in values:
                values.append(description)
    return values


def release_from_discogs(payload: dict[str, Any]) -> Release:
    labels = []
    catalog_numbers = []
    for label in payload.get("labels") or []:
        name = str(label.get("name") or "").strip()
        catno = str(label.get("catno") or "").strip()
        if name:
            labels.append(name)
        if catno and catno not in catalog_numbers:
            catalog_numbers.append(catno)

    tracks = []
    for item in payload.get("tracklist") or []:
        if item.get("type_") != "track":
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        tracks.append(
            Track(
                position=str(item.get("position") or "").strip(),
                title=title,
                duration_seconds=parse_duration(item.get("duration")),
            )
        )

    return Release(
        release_id=int(payload["id"]),
        title=str(payload.get("title") or "").strip(),
        artist=_artist_name(payload),
        year=payload.get("year"),
        cover_url=_cover_url(payload),
        country=str(payload.get("country") or "").strip(),
        labels=labels,
        catalog_numbers=catalog_numbers,
        formats=_format_values(payload),
        tracks=tracks,
        discogs_url=str(payload.get("uri") or ""),
    )


class DiscogsClient:
    def __init__(
        self,
        username: str,
        user_agent: str,
        request_json: JsonTransport = default_request_json,
        api_base: str = "https://api.discogs.com",
        page_delay_seconds: float = 1.0,
    ):
        self.username = username
        self.user_agent = user_agent
        self.request_json = request_json
        self.api_base = api_base.rstrip("/")
        self.page_delay_seconds = page_delay_seconds

    @property
    def headers(self) -> dict[str, str]:
        return {"User-Agent": self.user_agent}

    def collection_release_ids(self) -> list[int]:
        release_ids: list[int] = []
        page = 1
        while True:
            url = (
                f"{self.api_base}/users/{self.username}/collection/folders/0/releases"
                f"?per_page=100&page={page}"
            )
            payload = self.request_json(url, self.headers)
            release_ids.extend(int(item["id"]) for item in payload.get("releases", []))
            pagination = payload.get("pagination") or {}
            if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                break
            page += 1
            time.sleep(self.page_delay_seconds)
        return release_ids

    def release_details(self, release_id: int) -> Release:
        payload = self.request_json(f"{self.api_base}/releases/{release_id}", self.headers)
        return release_from_discogs(payload)

    def sync_collection(self, store: CatalogStore) -> int:
        count = 0
        for release_id in self.collection_release_ids():
            store.upsert_release(self.release_details(release_id))
            count += 1
            time.sleep(self.page_delay_seconds)
        store.set_metadata("discogs_last_sync_count", str(count))
        store.set_metadata("discogs_last_sync_at", str(time.time()))
        return count
```

- [ ] **Step 4: Run the Discogs tests**

Run:

```bash
python -m unittest tests.test_discogs_client -v
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add vinyl_display/clients/__init__.py vinyl_display/clients/discogs.py tests/test_discogs_client.py
git commit -m "feat: sync public discogs collection"
```

## Task 4: AudD Client And Collection Matcher

**Files:**
- Create: `vinyl_display/clients/audd.py`
- Create: `vinyl_display/matcher.py`
- Create: `tests/test_recognition_matching.py`

- [ ] **Step 1: Write failing tests for AudD parsing and matching**

Create `tests/test_recognition_matching.py`:

```python
import tempfile
import unittest
from pathlib import Path

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import parse_audd_response
from vinyl_display.matcher import CollectionMatcher, normalize_text
from vinyl_display.models import RecognitionResult, Release, Track


def make_store() -> CatalogStore:
    tmp = tempfile.TemporaryDirectory()
    store = CatalogStore(Path(tmp.name) / "catalog.sqlite3")
    store._tmp = tmp
    store.initialize()
    store.upsert_release(
        Release(
            release_id=14192689,
            title="Abbey Road",
            artist="The Beatles",
            year=2019,
            cover_url="https://example.test/cover.jpg",
            country="US",
            labels=["Apple Records"],
            catalog_numbers=["B0030719-01"],
            formats=["Vinyl", "LP"],
            tracks=[
                Track("A1", "Come Together", 261),
                Track("A2", "Something", 183),
            ],
            discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
        )
    )
    return store


class RecognitionMatchingTests(unittest.TestCase):
    def test_parse_audd_response(self):
        result = parse_audd_response({
            "status": "success",
            "result": {
                "title": "Come Together",
                "artist": "The Beatles",
                "album": "Abbey Road",
                "score": 92,
            },
        })

        self.assertIsNotNone(result)
        self.assertEqual(result.title, "Come Together")
        self.assertEqual(result.artist, "The Beatles")
        self.assertEqual(result.album, "Abbey Road")
        self.assertEqual(result.provider, "audd")

    def test_normalize_text_removes_case_and_punctuation_noise(self):
        self.assertEqual(normalize_text("  Come Together! "), "come together")
        self.assertEqual(normalize_text("Beatles, The"), "beatles the")

    def test_matcher_finds_track_in_collection(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="audd",
            confidence=0.92,
        )

        match = matcher.match(recognition)

        self.assertIsNotNone(match)
        self.assertEqual(match.release.release_id, 14192689)
        self.assertEqual(match.track.position, "A1")
        self.assertGreaterEqual(match.score, 90)

    def test_matcher_rejects_track_outside_collection(self):
        store = make_store()
        matcher = CollectionMatcher(store)
        recognition = RecognitionResult(
            title="A Song Not In The Collection",
            artist="Unknown Artist",
            album=None,
            provider="audd",
            confidence=0.9,
        )

        self.assertIsNone(matcher.match(recognition))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_recognition_matching -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display.clients.audd'`.

- [ ] **Step 3: Implement AudD response parsing and HTTP client**

Create `vinyl_display/clients/audd.py`:

```python
from __future__ import annotations

import json
import mimetypes
import uuid
import urllib.request
from typing import Any

from vinyl_display.models import RecognitionResult


def parse_audd_response(payload: dict[str, Any]) -> RecognitionResult | None:
    result = payload.get("result")
    if not isinstance(result, dict):
        return None

    title = str(result.get("title") or "").strip()
    artist = str(result.get("artist") or "").strip()
    album = str(result.get("album") or "").strip() or None
    if not title or not artist:
        return None

    score = result.get("score")
    confidence = None
    if isinstance(score, (int, float)):
        confidence = float(score) / 100 if score > 1 else float(score)

    return RecognitionResult(
        title=title,
        artist=artist,
        album=album,
        provider="audd",
        confidence=confidence,
        raw=payload,
    )


def _multipart_body(fields: dict[str, str], file_field: str, filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----vinyl-display-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(value.encode())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(
        (
            f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
    )
    chunks.append(data)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


class AudDClient:
    def __init__(self, api_token: str, api_url: str = "https://api.audd.io/"):
        self.api_token = api_token
        self.api_url = api_url

    def recognize(self, audio_bytes: bytes, filename: str = "clip.webm") -> RecognitionResult | None:
        if not self.api_token:
            raise RuntimeError("AUDD_API_TOKEN is required for recognition")

        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        body, request_content_type = _multipart_body(
            fields={"api_token": self.api_token, "return": "apple_music,spotify"},
            file_field="file",
            filename=filename,
            content_type=content_type,
            data=audio_bytes,
        )
        request = urllib.request.Request(
            self.api_url,
            data=body,
            headers={"Content-Type": request_content_type},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return parse_audd_response(payload)
```

- [ ] **Step 4: Implement the matcher**

Create `vinyl_display/matcher.py`:

```python
from __future__ import annotations

import re
import unicodedata

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import RecognitionResult, TrackMatch


def normalize_text(value: str | None) -> str:
    value = value or ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = re.sub(r"[^a-zA-Z0-9]+", " ", ascii_text)
    return " ".join(ascii_text.lower().split())


def _contains_or_equals(left: str, right: str) -> bool:
    return bool(left and right and (left == right or left in right or right in left))


class CollectionMatcher:
    def __init__(self, store: CatalogStore, minimum_score: int = 70):
        self.store = store
        self.minimum_score = minimum_score

    def match(self, recognition: RecognitionResult) -> TrackMatch | None:
        recognized_title = normalize_text(recognition.title)
        recognized_artist = normalize_text(recognition.artist)
        recognized_album = normalize_text(recognition.album)

        best: TrackMatch | None = None
        for release, track in self.store.iter_track_candidates():
            score = 0
            reasons = []

            track_title = normalize_text(track.title)
            release_artist = normalize_text(release.artist)
            release_title = normalize_text(release.title)

            if track_title == recognized_title:
                score += 70
                reasons.append("track title exact")
            elif _contains_or_equals(track_title, recognized_title):
                score += 45
                reasons.append("track title partial")

            if _contains_or_equals(release_artist, recognized_artist):
                score += 20
                reasons.append("artist match")

            if recognized_album and _contains_or_equals(release_title, recognized_album):
                score += 10
                reasons.append("album match")

            if score >= self.minimum_score and (best is None or score > best.score):
                best = TrackMatch(
                    release=release,
                    track=track,
                    score=score,
                    reason=", ".join(reasons),
                )

        return best
```

- [ ] **Step 5: Run recognition and matching tests**

Run:

```bash
python -m unittest tests.test_recognition_matching -v
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add vinyl_display/clients/audd.py vinyl_display/matcher.py tests/test_recognition_matching.py
git commit -m "feat: add audd recognition and collection matching"
```

## Task 5: Playback State Machine

**Files:**
- Create: `vinyl_display/playback.py`
- Create: `tests/test_playback.py`

- [ ] **Step 1: Write failing playback tests**

Create `tests/test_playback.py`:

```python
import unittest

from vinyl_display.models import Release, Track, TrackMatch
from vinyl_display.playback import PlaybackController


def match_at_a1() -> TrackMatch:
    release = Release(
        release_id=14192689,
        title="Abbey Road",
        artist="The Beatles",
        year=2019,
        cover_url="https://example.test/cover.jpg",
        country="US",
        labels=["Apple Records"],
        catalog_numbers=["B0030719-01"],
        formats=["Vinyl", "LP"],
        tracks=[
            Track("A1", "Come Together", 261),
            Track("A2", "Something", 183),
            Track("B1", "Here Comes The Sun", 185),
        ],
        discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
    )
    return TrackMatch(release=release, track=release.tracks[0], score=100, reason="test")


class PlaybackControllerTests(unittest.TestCase):
    def test_starts_in_listening_state(self):
        controller = PlaybackController()
        state = controller.current_state(now=1000)

        self.assertEqual(state["status"], "listening")

    def test_handle_match_sets_playing_state(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        state = controller.current_state(now=1042)

        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(state["progress_seconds"], 42)
        self.assertEqual(state["duration_seconds"], 261)
        self.assertEqual(state["next_track"]["title"], "Something")

    def test_progress_advances_to_next_track_by_duration(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        state = controller.current_state(now=1000 + 270)

        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 9)

    def test_not_found_message(self):
        controller = PlaybackController()
        controller.handle_not_found(now=1000, title="Unknown Song", artist="Unknown Artist")

        state = controller.current_state(now=1001)

        self.assertEqual(state["status"], "not_found")
        self.assertIn("Disco não encontrado", state["message"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_playback -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display.playback'`.

- [ ] **Step 3: Implement playback state**

Create `vinyl_display/playback.py`:

```python
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from vinyl_display.models import Release, Track, TrackMatch


@dataclass
class ActivePlayback:
    match: TrackMatch
    started_at: float


class PlaybackController:
    def __init__(self):
        self.active: ActivePlayback | None = None
        self.status = "listening"
        self.message = ""
        self.last_recognition: dict[str, Any] | None = None

    def handle_match(self, match: TrackMatch, now: float | None = None) -> None:
        self.active = ActivePlayback(match=match, started_at=now or time.time())
        self.status = "playing"
        self.message = ""

    def handle_not_found(self, title: str, artist: str, now: float | None = None) -> None:
        self.active = None
        self.status = "not_found"
        self.message = (
            "Disco não encontrado na sua coleção. "
            "Cadastre no Discogs e sincronize novamente."
        )
        self.last_recognition = {
            "title": title,
            "artist": artist,
            "at": now or time.time(),
        }

    def set_identifying(self) -> None:
        self.status = "identifying"
        self.message = "Identificando trecho..."

    def set_listening(self) -> None:
        if self.status != "playing":
            self.status = "listening"
            self.message = ""

    def current_state(self, now: float | None = None) -> dict[str, Any]:
        now = now or time.time()
        if self.active is None:
            return {
                "status": self.status,
                "message": self.message,
                "release": None,
                "track": None,
                "next_track": None,
                "progress_seconds": None,
                "duration_seconds": None,
                "last_recognition": self.last_recognition,
            }

        release = self.active.match.release
        track, progress = self._track_at_elapsed(release, self.active.match.track, int(now - self.active.started_at))
        next_track = self._next_track(release, track)

        return {
            "status": "playing",
            "message": "",
            "release": release.to_dict(),
            "track": track.to_dict(),
            "next_track": None if next_track is None else next_track.to_dict(),
            "progress_seconds": progress,
            "duration_seconds": track.duration_seconds,
            "last_recognition": self.last_recognition,
        }

    def _track_at_elapsed(self, release: Release, initial_track: Track, elapsed: int) -> tuple[Track, int]:
        try:
            start_index = release.tracks.index(initial_track)
        except ValueError:
            return initial_track, max(0, elapsed)

        remaining = max(0, elapsed)
        for track in release.tracks[start_index:]:
            if track.duration_seconds is None:
                return track, remaining
            if remaining < track.duration_seconds:
                return track, remaining
            remaining -= track.duration_seconds
        return release.tracks[-1], release.tracks[-1].duration_seconds or remaining

    def _next_track(self, release: Release, track: Track) -> Track | None:
        try:
            index = release.tracks.index(track)
        except ValueError:
            return None
        next_index = index + 1
        if next_index >= len(release.tracks):
            return None
        return release.tracks[next_index]
```

- [ ] **Step 4: Run playback tests**

Run:

```bash
python -m unittest tests.test_playback -v
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add vinyl_display/playback.py tests/test_playback.py
git commit -m "feat: add playback state machine"
```

## Task 6: Application Service And HTTP API

**Files:**
- Create: `vinyl_display/app.py`
- Create: `vinyl_display/server.py`
- Create: `tests/test_app_service.py`

- [ ] **Step 1: Write failing app service tests**

Create `tests/test_app_service.py`:

```python
import tempfile
import unittest
from pathlib import Path

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.models import RecognitionResult, Release, Track


class FakeDiscogsClient:
    def sync_collection(self, store):
        store.upsert_release(
            Release(
                release_id=14192689,
                title="Abbey Road",
                artist="The Beatles",
                year=2019,
                cover_url="https://example.test/cover.jpg",
                country="US",
                labels=["Apple Records"],
                catalog_numbers=["B0030719-01"],
                formats=["Vinyl", "LP"],
                tracks=[Track("A1", "Come Together", 261)],
                discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
            )
        )
        return 1


class FakeAudDClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        self.audio_bytes = audio_bytes
        self.filename = filename
        return RecognitionResult(
            title="Come Together",
            artist="The Beatles",
            album="Abbey Road",
            provider="audd",
            confidence=0.92,
        )


class EmptyAudDClient:
    def recognize(self, audio_bytes, filename="clip.webm"):
        return RecognitionResult(
            title="Outside Song",
            artist="Outside Artist",
            album=None,
            provider="audd",
            confidence=0.9,
        )


class AppServiceTests(unittest.TestCase):
    def test_sync_collection_returns_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeAudDClient())

            response = app.sync_collection()

            self.assertEqual(response["count"], 1)
            self.assertEqual(response["status"], "ok")

    def test_recognize_audio_sets_playing_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), FakeAudDClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")
            state = app.state()

            self.assertEqual(response["status"], "matched")
            self.assertEqual(state["status"], "playing")
            self.assertEqual(state["track"]["title"], "Come Together")

    def test_recognize_audio_not_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = CatalogStore(Path(tmp) / "catalog.sqlite3")
            app = VinylDisplayApp(store, FakeDiscogsClient(), EmptyAudDClient())
            app.sync_collection()

            response = app.recognize_audio(b"audio-data", filename="clip.webm")

            self.assertEqual(response["status"], "not_found")
            self.assertIn("Disco não encontrado", app.state()["message"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_app_service -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'vinyl_display.app'`.

- [ ] **Step 3: Implement the app service**

Create `vinyl_display/app.py`:

```python
from __future__ import annotations

from typing import Any

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import AudDClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.matcher import CollectionMatcher
from vinyl_display.playback import PlaybackController


class VinylDisplayApp:
    def __init__(self, store: CatalogStore, discogs_client: DiscogsClient, audd_client: AudDClient):
        self.store = store
        self.discogs_client = discogs_client
        self.audd_client = audd_client
        self.matcher = CollectionMatcher(store)
        self.playback = PlaybackController()
        self.store.initialize()

    def state(self) -> dict[str, Any]:
        state = self.playback.current_state()
        state["collection_count"] = self.store.collection_count()
        state["last_sync_at"] = self.store.get_metadata("discogs_last_sync_at")
        return state

    def sync_collection(self) -> dict[str, Any]:
        count = self.discogs_client.sync_collection(self.store)
        return {"status": "ok", "count": count}

    def recognize_audio(self, audio_bytes: bytes, filename: str = "clip.webm") -> dict[str, Any]:
        self.playback.set_identifying()
        recognition = self.audd_client.recognize(audio_bytes, filename=filename)
        if recognition is None:
            self.playback.set_listening()
            return {"status": "no_result"}

        match = self.matcher.match(recognition)
        if match is None:
            self.playback.handle_not_found(title=recognition.title, artist=recognition.artist)
            return {
                "status": "not_found",
                "recognition": {
                    "title": recognition.title,
                    "artist": recognition.artist,
                    "album": recognition.album,
                    "provider": recognition.provider,
                    "confidence": recognition.confidence,
                },
            }

        self.playback.handle_match(match)
        return {
            "status": "matched",
            "match": match.to_dict(),
            "recognition": {
                "title": recognition.title,
                "artist": recognition.artist,
                "album": recognition.album,
                "provider": recognition.provider,
                "confidence": recognition.confidence,
            },
        }
```

- [ ] **Step 4: Implement the HTTP route adapter**

Create `vinyl_display/server.py`:

```python
from __future__ import annotations

import json
import mimetypes
import ssl
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.audd import AudDClient
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.config import Config, load_config


def build_app(config: Config) -> VinylDisplayApp:
    store = CatalogStore(config.database_path)
    discogs = DiscogsClient(config.discogs_user, config.discogs_user_agent)
    audd = AudDClient(config.audd_api_token)
    return VinylDisplayApp(store, discogs, audd)


class VinylRequestHandler(SimpleHTTPRequestHandler):
    app: VinylDisplayApp
    static_dir: Path

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json({"status": "ok"})
            return
        if path == "/api/state":
            self._json(self.app.state())
            return
        if path == "/":
            self._send_static("index.html")
            return
        if path.startswith("/static/"):
            self._send_static(path.removeprefix("/static/"))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/sync":
            self._json(self.app.sync_collection())
            return
        if path == "/api/recognize":
            length = int(self.headers.get("Content-Length", "0"))
            audio_bytes = self.rfile.read(length)
            filename = self.headers.get("X-Clip-Filename", "clip.webm")
            self._json(self.app.recognize_audio(audio_bytes, filename=filename))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _send_static(self, relative_path: str) -> None:
        target = (self.static_dir / relative_path).resolve()
        static_root = self.static_dir.resolve()
        if static_root not in target.parents and target != static_root:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(config: Config | None = None) -> None:
    config = config or load_config()
    app = build_app(config)

    class Handler(VinylRequestHandler):
        pass

    Handler.app = app
    Handler.static_dir = config.static_dir

    server = ThreadingHTTPServer((config.host, config.port), Handler)
    if config.cert_file and config.key_file:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(config.cert_file, config.key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    scheme = "https" if config.cert_file and config.key_file else "http"
    print(f"Serving Vinyl Display at {scheme}://{config.host}:{config.port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
```

- [ ] **Step 5: Run app service tests**

Run:

```bash
python -m unittest tests.test_app_service -v
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 18 tests.

- [ ] **Step 7: Commit**

```bash
git add vinyl_display/app.py vinyl_display/server.py tests/test_app_service.py
git commit -m "feat: add vinyl display api service"
```

## Task 7: Minimalist PWA Frontend

**Files:**
- Create: `static/index.html`
- Create: `static/styles.css`
- Create: `static/app.js`
- Create: `tests/test_static_assets.py`

- [ ] **Step 1: Write static asset smoke tests**

Create `tests/test_static_assets.py`:

```python
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticAssetTests(unittest.TestCase):
    def test_index_contains_required_mount_points(self):
        html = (ROOT / "static" / "index.html").read_text()

        self.assertIn('id="album-cover"', html)
        self.assertIn('id="track-title"', html)
        self.assertIn('id="artist-name"', html)
        self.assertIn('id="sync-button"', html)

    def test_app_uses_microphone_and_media_recorder(self):
        js = (ROOT / "static" / "app.js").read_text()

        self.assertIn("navigator.mediaDevices.getUserMedia", js)
        self.assertIn("MediaRecorder", js)
        self.assertIn("/api/recognize", js)
        self.assertIn("/api/state", js)

    def test_css_is_amoled_friendly_and_has_no_negative_letter_spacing(self):
        css = (ROOT / "static" / "styles.css").read_text()

        self.assertIn("background: #050505", css)
        self.assertNotIn("letter-spacing: -", css)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_static_assets -v
```

Expected: FAIL with missing `static/index.html`.

- [ ] **Step 3: Create the HTML shell**

Create `static/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#050505">
    <title>Vinyl Display</title>
    <link rel="stylesheet" href="/static/styles.css">
  </head>
  <body>
    <main class="screen" aria-live="polite">
      <section class="cover-panel">
        <div id="album-cover" class="cover-placeholder">
          <span id="cover-initials">VINYL</span>
        </div>
      </section>

      <section class="now-playing">
        <p id="status-label" class="status-label">Ouvindo</p>
        <h1 id="track-title">Aguardando música</h1>
        <p id="artist-name" class="artist-name">Coloque um disco para tocar</p>
        <p id="album-line" class="album-line">Coleção Discogs sincronizada localmente</p>
        <div class="progress-track" aria-hidden="true">
          <div id="progress-fill" class="progress-fill"></div>
        </div>
        <p id="next-track" class="next-track"></p>
      </section>

      <nav class="controls" aria-label="Controles">
        <button id="sync-button" type="button">Sincronizar</button>
        <button id="retry-button" type="button">Identificar</button>
      </nav>
    </main>

    <script src="/static/app.js" defer></script>
  </body>
</html>
```

- [ ] **Step 4: Create the minimalist CSS**

Create `static/styles.css`:

```css
:root {
  color-scheme: dark;
  --bg: #050505;
  --panel: #101010;
  --text: #f4f1ea;
  --muted: #a9a199;
  --soft: #6f6860;
  --accent: #d8b46a;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  background: #050505;
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  overflow: hidden;
}

button {
  min-height: 44px;
  border: 1px solid rgba(244, 241, 234, 0.14);
  border-radius: 8px;
  background: rgba(244, 241, 234, 0.06);
  color: var(--text);
  font: inherit;
  padding: 0 16px;
}

.screen {
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 48vw) 1fr;
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
  padding: clamp(20px, 5vh, 56px) clamp(24px, 6vw, 72px);
}

.cover-panel {
  width: 100%;
  aspect-ratio: 1;
}

.cover-placeholder,
.cover-image {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  background: var(--panel);
  object-fit: cover;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.cover-placeholder {
  display: grid;
  place-items: center;
  color: var(--soft);
  font-size: clamp(28px, 6vw, 72px);
  font-weight: 700;
}

.now-playing {
  min-width: 0;
}

.status-label {
  margin: 0 0 18px;
  color: var(--accent);
  font-size: clamp(13px, 1.7vw, 18px);
  text-transform: uppercase;
}

h1 {
  margin: 0;
  max-width: 12ch;
  font-size: clamp(42px, 8vw, 112px);
  line-height: 0.95;
  font-weight: 760;
  letter-spacing: 0;
}

.artist-name {
  margin: 22px 0 0;
  color: var(--text);
  font-size: clamp(22px, 3vw, 42px);
}

.album-line,
.next-track {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: clamp(14px, 1.8vw, 22px);
}

.progress-track {
  width: min(520px, 100%);
  height: 3px;
  margin-top: 30px;
  background: rgba(244, 241, 234, 0.14);
  overflow: hidden;
}

.progress-fill {
  width: 0%;
  height: 100%;
  background: var(--accent);
  transition: width 600ms ease;
}

.controls {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  gap: 10px;
  opacity: 0.18;
  transition: opacity 160ms ease;
}

.controls:focus-within,
.controls:hover {
  opacity: 1;
}

@media (orientation: portrait) {
  .screen {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(240px, 56vh) 1fr;
  }

  .cover-panel {
    max-height: 56vh;
    justify-self: center;
  }

  h1 {
    max-width: 14ch;
    font-size: clamp(38px, 12vw, 88px);
  }
}
```

- [ ] **Step 5: Create frontend microphone and state logic**

Create `static/app.js`:

```javascript
const elements = {
  albumCover: document.querySelector("#album-cover"),
  coverInitials: document.querySelector("#cover-initials"),
  statusLabel: document.querySelector("#status-label"),
  trackTitle: document.querySelector("#track-title"),
  artistName: document.querySelector("#artist-name"),
  albumLine: document.querySelector("#album-line"),
  progressFill: document.querySelector("#progress-fill"),
  nextTrack: document.querySelector("#next-track"),
  syncButton: document.querySelector("#sync-button"),
  retryButton: document.querySelector("#retry-button"),
};

let mediaStream = null;
let recording = false;
let lastRecognitionAt = 0;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, Math.floor(seconds % 60));
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function setCover(release) {
  if (!release || !release.cover_url) {
    elements.albumCover.className = "cover-placeholder";
    elements.albumCover.innerHTML = '<span id="cover-initials">VINYL</span>';
    return;
  }

  elements.albumCover.className = "";
  elements.albumCover.innerHTML = `<img class="cover-image" alt="Capa de ${release.title}" src="${release.cover_url}">`;
}

function renderState(state) {
  elements.statusLabel.textContent = labelForStatus(state.status);

  if (state.status === "playing" && state.release && state.track) {
    const release = state.release;
    const track = state.track;
    const progress = state.progress_seconds || 0;
    const duration = state.duration_seconds || 0;
    const pct = duration > 0 ? Math.min(100, Math.round((progress / duration) * 100)) : 0;

    setCover(release);
    elements.trackTitle.textContent = track.title;
    elements.artistName.textContent = release.artist;
    elements.albumLine.textContent = `${release.title} · ${track.position || "Faixa"} · ${formatTime(progress)} / ${formatTime(duration)}`;
    elements.progressFill.style.width = `${pct}%`;
    elements.nextTrack.textContent = state.next_track ? `Próxima: ${state.next_track.title}` : "";
    return;
  }

  setCover(null);
  elements.progressFill.style.width = "0%";
  elements.nextTrack.textContent = "";

  if (state.status === "not_found") {
    elements.trackTitle.textContent = "Não encontrado";
    elements.artistName.textContent = state.message;
    elements.albumLine.textContent = state.last_recognition
      ? `${state.last_recognition.title} · ${state.last_recognition.artist}`
      : "Cadastre no Discogs e sincronize novamente";
    return;
  }

  if (state.status === "identifying") {
    elements.trackTitle.textContent = "Identificando";
    elements.artistName.textContent = "Ouvindo um trecho do disco";
    elements.albumLine.textContent = "Aguarde alguns segundos";
    return;
  }

  elements.trackTitle.textContent = "Aguardando música";
  elements.artistName.textContent = "Coloque um disco para tocar";
  elements.albumLine.textContent = `${state.collection_count || 0} discos sincronizados`;
}

function labelForStatus(status) {
  const labels = {
    listening: "Ouvindo",
    identifying: "Identificando",
    playing: "Tocando",
    not_found: "Não encontrado",
    syncing: "Sincronizando",
    offline: "Offline",
  };
  return labels[status] || "Ouvindo";
}

async function pollState() {
  try {
    renderState(await fetchJson("/api/state"));
  } catch (error) {
    elements.statusLabel.textContent = "Offline";
    elements.trackTitle.textContent = "Sem conexão";
    elements.artistName.textContent = "Raspberry Pi indisponível";
  }
}

async function startMicrophone() {
  if (!window.isSecureContext) {
    elements.trackTitle.textContent = "HTTPS necessário";
    elements.artistName.textContent = "Abra esta página em HTTPS para liberar o microfone";
    return;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => {
      const normalized = (value - 128) / 128;
      return sum + normalized * normalized;
    }, 0) / samples.length);

    const enoughTimePassed = Date.now() - lastRecognitionAt > 45000;
    if (rms > 0.035 && enoughTimePassed && !recording) {
      recordClip();
    }
  }, 1000);
}

function recordClip() {
  if (!mediaStream || recording) return;
  recording = true;
  lastRecognitionAt = Date.now();

  const recorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm" });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    try {
      await fetchJson("/api/recognize", {
        method: "POST",
        headers: { "X-Clip-Filename": "clip.webm" },
        body: blob,
      });
      await pollState();
    } finally {
      recording = false;
    }
  };
  recorder.start();
  window.setTimeout(() => recorder.stop(), 10000);
}

elements.syncButton.addEventListener("click", async () => {
  elements.statusLabel.textContent = "Sincronizando";
  await fetchJson("/api/sync", { method: "POST" });
  await pollState();
});

elements.retryButton.addEventListener("click", () => {
  recordClip();
});

pollState();
setInterval(pollState, 2000);
startMicrophone().catch((error) => {
  elements.trackTitle.textContent = "Microfone bloqueado";
  elements.artistName.textContent = error.message;
});
```

- [ ] **Step 6: Run static asset tests**

Run:

```bash
python -m unittest tests.test_static_assets -v
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 21 tests.

- [ ] **Step 8: Commit**

```bash
git add static/index.html static/styles.css static/app.js tests/test_static_assets.py
git commit -m "feat: add minimalist vinyl display pwa"
```

## Task 8: Runtime Configuration And Documentation

**Files:**
- Create: `.env.example`
- Create: `README.md`
- Create: `tests/test_documentation.py`

- [ ] **Step 1: Write documentation smoke tests**

Create `tests/test_documentation.py`:

```python
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DocumentationTests(unittest.TestCase):
    def test_env_example_documents_required_values(self):
        env = (ROOT / ".env.example").read_text()

        self.assertIn("AUDD_API_TOKEN=", env)
        self.assertIn("DISCOGS_USER=heriveltogabriel", env)
        self.assertIn("VINYL_CERT_FILE=", env)
        self.assertIn("VINYL_KEY_FILE=", env)

    def test_readme_includes_run_and_sync_commands(self):
        readme = (ROOT / "README.md").read_text()

        self.assertIn("python -m vinyl_display.server", readme)
        self.assertIn("POST /api/sync", readme)
        self.assertIn("https://", readme)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
python -m unittest tests.test_documentation -v
```

Expected: FAIL with missing `.env.example` or `README.md`.

- [ ] **Step 3: Add `.env.example`**

Create `.env.example`:

```bash
DISCOGS_USER=heriveltogabriel
DISCOGS_USER_AGENT=VinylDisplayMVP/0.1 +local
AUDD_API_TOKEN=
VINYL_DATA_DIR=data
VINYL_DATABASE_PATH=data/vinyl_display.sqlite3
VINYL_STATIC_DIR=static
VINYL_HOST=0.0.0.0
VINYL_PORT=8080
VINYL_CLIP_SECONDS=10
VINYL_CERT_FILE=
VINYL_KEY_FILE=
```

- [ ] **Step 4: Add `README.md`**

Create `README.md`:

````markdown
# Vinyl Display

Minimalist vinyl now-playing display for a Raspberry Pi server and an Android phone.

## What It Does

- Syncs the public Discogs collection for `heriveltogabriel`.
- Serves a local PWA for the OnePlus 5.
- Captures short microphone clips from the browser.
- Sends clips to AudD for recognition.
- Matches recognized tracks only against the local Discogs catalog.
- Shows a not-found message when the record is not in the collection.

## Configuration

Copy `.env.example` values into your shell environment before running the server.

Required for recognition:

```bash
export AUDD_API_TOKEN="your-token"
```

Required for Android microphone capture in Chrome:

```bash
export VINYL_CERT_FILE="/path/to/local-cert.pem"
export VINYL_KEY_FILE="/path/to/local-key.pem"
```

The browser microphone API requires a secure context. On the Raspberry Pi, run this app through HTTPS using a local certificate that the Android device trusts.

## Run

```bash
python -m vinyl_display.server
```

Open the Android phone at:

```text
https://raspberrypi.local:8080
```

## Sync Collection

The server exposes:

```text
POST /api/sync
```

From another machine on the same network:

```bash
curl -X POST https://raspberrypi.local:8080/api/sync
```

## Useful API Endpoints

```text
GET  /api/health
GET  /api/state
POST /api/sync
POST /api/recognize
```

## Tests

```bash
python -m unittest discover -v
```
````

- [ ] **Step 5: Run documentation tests**

Run:

```bash
python -m unittest tests.test_documentation -v
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Run all tests**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 23 tests.

- [ ] **Step 7: Commit**

```bash
git add .env.example README.md tests/test_documentation.py
git commit -m "docs: add vinyl display setup guide"
```

## Task 9: Local Smoke Validation

**Files:**
- Modify: no source files unless a smoke issue exposes a bug.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
python -m unittest discover -v
```

Expected: PASS, 23 tests.

- [ ] **Step 2: Start the server without HTTPS for backend smoke testing**

Run:

```bash
VINYL_PORT=8080 python -m vinyl_display.server
```

Expected: terminal prints `Serving Vinyl Display at http://0.0.0.0:8080`.

- [ ] **Step 3: Check health in a second terminal**

Run:

```bash
curl -s http://127.0.0.1:8080/api/health
```

Expected:

```json
{"status": "ok"}
```

- [ ] **Step 4: Check initial state**

Run:

```bash
curl -s http://127.0.0.1:8080/api/state
```

Expected: JSON with `"status": "listening"` and `"collection_count": 0` before sync.

- [ ] **Step 5: Stop the local server**

Press `Ctrl-C` in the server terminal.

Expected: server exits cleanly.

- [ ] **Step 6: Commit smoke fixes if any were needed**

If source files changed during smoke validation:

```bash
git add vinyl_display static tests README.md .env.example
git commit -m "fix: address local smoke validation issues"
```

If no source files changed, skip this commit.

## Final Verification

- [ ] `python -m unittest discover -v` passes.
- [ ] `python -m vinyl_display.server` starts.
- [ ] `GET /api/health` returns `{"status": "ok"}`.
- [ ] `GET /api/state` returns valid JSON.
- [ ] Frontend loads from `/`.
- [ ] Android microphone capture is documented as requiring HTTPS.
- [ ] Discogs collection is the only catalog source.
- [ ] Not-found behavior tells the user to register the record in Discogs and sync again.
