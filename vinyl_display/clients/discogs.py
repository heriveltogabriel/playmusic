from __future__ import annotations

import json
import time
from email.message import Message
from typing import Any, Callable
from urllib.error import HTTPError
import urllib.request

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track

JsonTransport = Callable[[str, dict[str, str]], dict[str, Any]]
SleepFunc = Callable[[float], None]


def default_request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _retry_after_seconds(error: HTTPError) -> float | None:
    headers = error.headers
    if not isinstance(headers, Message):
        return None
    retry_after = headers.get("Retry-After")
    if retry_after is None:
        return None
    try:
        return max(0.0, float(retry_after))
    except ValueError:
        return None


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
        names = [
            str(artist.get("anv") or artist.get("name") or "").strip()
            for artist in artists
        ]
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
        genres=list(payload.get("genres") or []),
        styles=list(payload.get("styles") or []),
    )


class DiscogsClient:
    def __init__(
        self,
        username: str,
        user_agent: str,
        request_json: JsonTransport = default_request_json,
        api_base: str = "https://api.discogs.com",
        page_delay_seconds: float = 1.0,
        rate_limit_delay_seconds: float = 65.0,
        max_retries: int = 5,
        sleep_func: SleepFunc = time.sleep,
    ):
        self.username = username
        self.user_agent = user_agent
        self.request_json = request_json
        self.api_base = api_base.rstrip("/")
        self.page_delay_seconds = page_delay_seconds
        self.rate_limit_delay_seconds = rate_limit_delay_seconds
        self.max_retries = max_retries
        self.sleep_func = sleep_func

    @property
    def headers(self) -> dict[str, str]:
        return {"User-Agent": self.user_agent}

    def _request_json(self, url: str) -> dict[str, Any]:
        attempts = 0
        while True:
            try:
                return self.request_json(url, self.headers)
            except HTTPError as error:
                if error.code != 429 or attempts >= self.max_retries:
                    raise
                delay = _retry_after_seconds(error)
                self.sleep_func(
                    self.rate_limit_delay_seconds if delay is None else delay
                )
                attempts += 1

    def collection_release_ids(self) -> list[int]:
        release_ids: list[int] = []
        page = 1
        while True:
            url = (
                f"{self.api_base}/users/{self.username}/collection/folders/0/releases"
                f"?per_page=100&page={page}"
            )
            payload = self._request_json(url)
            release_ids.extend(int(item["id"]) for item in payload.get("releases", []))
            pagination = payload.get("pagination") or {}
            if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                break
            page += 1
            self.sleep_func(self.page_delay_seconds)
        return release_ids

    def collection_releases_meta(self) -> list[tuple[int, str | None]]:
        releases_meta: list[tuple[int, str | None]] = []
        page = 1
        while True:
            url = (
                f"{self.api_base}/users/{self.username}/collection/folders/0/releases"
                f"?per_page=100&page={page}"
            )
            payload = self._request_json(url)
            for item in payload.get("releases", []):
                releases_meta.append((int(item["id"]), item.get("date_added")))
            pagination = payload.get("pagination") or {}
            if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                break
            page += 1
            self.sleep_func(self.page_delay_seconds)
        return releases_meta

    def release_details(self, release_id: int) -> Release:
        payload = self._request_json(f"{self.api_base}/releases/{release_id}")
        release = release_from_discogs(payload)
        
        master_id = payload.get("master_id")
        if master_id:
            try:
                master_payload = self._request_json(f"{self.api_base}/masters/{master_id}")
                master_year = master_payload.get("year")
                if master_year:
                    import dataclasses
                    release = dataclasses.replace(release, year=int(master_year))
            except Exception as e:
                print(f"[DISCOGS] Error fetching master {master_id} for release {release_id}: {e}")
                
        return release

    def sync_collection(self, store: CatalogStore) -> dict[str, int]:
        added_count = 0
        updated_count = 0
        deleted_count = 0
        
        # Get existing local Discogs release IDs (positive IDs only)
        local_ids = set()
        for r in store.list_releases():
            if r.release_id > 0:
                local_ids.add(r.release_id)
                
        synced_ids = set()
        import datetime
        import dataclasses
        
        for release_id, date_added_str in self.collection_releases_meta():
            synced_ids.add(release_id)
            existing = store.get_release(release_id)
            if existing is None:
                added_count += 1
            else:
                updated_count += 1
                
            release = self.release_details(release_id)
            synced_at = 0.0
            if date_added_str:
                try:
                    val = date_added_str.replace('Z', '+00:00')
                    dt = datetime.datetime.fromisoformat(val)
                    synced_at = dt.timestamp()
                except Exception as e:
                    print(f"[DISCOGS] Error parsing date_added '{date_added_str}': {e}")
            if synced_at > 0.0:
                release = dataclasses.replace(release, synced_at=synced_at)
            store.upsert_release(release)
            self.sleep_func(self.page_delay_seconds)
            
        # Delete local Discogs releases that are no longer in the live collection
        to_delete = local_ids - synced_ids
        for release_id in to_delete:
            store.delete_release(release_id)
            deleted_count += 1
            
        total_count = len(synced_ids)
        store.set_metadata("discogs_last_sync_count", str(total_count))
        store.set_metadata("discogs_last_sync_at", str(time.time()))
        
        return {
            "count": total_count,
            "added": added_count,
            "updated": updated_count,
            "deleted": deleted_count,
        }
