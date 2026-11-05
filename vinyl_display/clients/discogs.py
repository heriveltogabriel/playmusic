from __future__ import annotations

import json
import time
from email.message import Message
from typing import Any, Callable
from urllib.error import HTTPError
import urllib.request

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import Release, Track
from vinyl_display.tracklist import infer_vinyl_sides

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

    edition_year = payload.get("year")
    try:
        edition_year = int(edition_year) if edition_year else None
    except ValueError:
        edition_year = None
    original_year = edition_year

    return Release(
        release_id=int(payload["id"]),
        title=str(payload.get("title") or "").strip(),
        artist=_artist_name(payload),
        year=original_year,
        cover_url=_cover_url(payload),
        country=str(payload.get("country") or "").strip(),
        labels=labels,
        catalog_numbers=catalog_numbers,
        formats=_format_values(payload),
        tracks=infer_vinyl_sides(tracks, _format_values(payload)),
        discogs_url=str(payload.get("uri") or ""),
        genres=list(payload.get("genres") or []),
        styles=list(payload.get("styles") or []),
        original_year=original_year,
        edition_year=edition_year,
    )


def _search_prefix(value: str) -> str:
    """"Legião Urbana - Dois" → "legiao urbana dois" (para conferir o artista da busca)."""
    import unicodedata

    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii").lower()
    value = value.replace("*", "")
    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())


class DiscogsClient:
    def __init__(
        self,
        username: str,
        user_agent: str,
        token: str = "",
        request_json: JsonTransport = default_request_json,
        api_base: str = "https://api.discogs.com",
        page_delay_seconds: float = 1.0,
        rate_limit_delay_seconds: float = 65.0,
        max_retries: int = 5,
        sleep_func: SleepFunc = time.sleep,
    ):
        self.username = username
        self.user_agent = user_agent
        self.token = token
        self.request_json = request_json
        self.api_base = api_base.rstrip("/")
        self.page_delay_seconds = page_delay_seconds
        self.rate_limit_delay_seconds = rate_limit_delay_seconds
        self.max_retries = max_retries
        self.sleep_func = sleep_func

    @property
    def headers(self) -> dict[str, str]:
        headers = {"User-Agent": self.user_agent}
        if getattr(self, "token", None):
            headers["Authorization"] = f"Discogs token={self.token}"
        return headers

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

    def collection_releases_meta(self) -> list[tuple[int, str | None, str]]:
        releases_meta: list[tuple[int, str | None, str]] = []
        page = 1
        while True:
            url = (
                f"{self.api_base}/users/{self.username}/collection/folders/0/releases"
                f"?per_page=100&page={page}"
            )
            payload = self._request_json(url)
            for item in payload.get("releases", []):
                notes_list = item.get("notes") or []
                note_val = ""
                for n in notes_list:
                    if n.get("field_id") == 3:
                        note_val = n.get("value", "")
                        break
                if not note_val:
                    for n in notes_list:
                        if n.get("value"):
                            note_val = n.get("value")
                            break
                releases_meta.append((int(item["id"]), item.get("date_added"), note_val))
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
                    orig_yr = int(master_year)
                    release = dataclasses.replace(
                        release,
                        year=orig_yr,
                        original_year=orig_yr
                    )
            except Exception as e:
                print(f"[DISCOGS] Error fetching master {master_id} for release {release_id}: {e}")
                
        return release

    # ---------------- v4.2: página do artista ----------------
    def release_artist(self, release_id: int) -> dict[str, Any] | None:
        """Primeiro artista creditado num lançamento: {"id", "name"}."""
        payload = self._request_json(f"{self.api_base}/releases/{release_id}")
        for artist in payload.get("artists") or []:
            if artist.get("id"):
                return {"id": int(artist["id"]), "name": str(artist.get("name") or "")}
        return None

    def artist_profile(self, artist_id: int) -> dict[str, Any]:
        payload = self._request_json(f"{self.api_base}/artists/{artist_id}")
        return {
            "id": artist_id,
            "name": str(payload.get("name") or ""),
            "profile": str(payload.get("profile") or ""),
            "uri": str(payload.get("uri") or ""),
        }

    def artist_album_master_ids(self, artist_name: str, max_pages: int = 3) -> set[int]:
        """Masters em formato Álbum (LP, CD...) do artista, pela busca do Discogs. A lista
        de lançamentos do artista mistura compactos e singles; a busca separa os álbuns."""
        import urllib.parse

        prefix = _search_prefix(artist_name)
        ids: set[int] = set()
        page = 1
        while page <= max_pages:
            query = urllib.parse.urlencode(
                {"type": "master", "artist": artist_name, "format": "Album", "per_page": 100, "page": page}
            )
            payload = self._request_json(f"{self.api_base}/database/search?{query}")
            for item in payload.get("results") or []:
                if _search_prefix(str(item.get("title") or "")).startswith(prefix) and item.get("id"):
                    ids.add(int(item["id"]))
            pagination = payload.get("pagination") or {}
            if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                break
            page += 1
            self.sleep_func(self.page_delay_seconds)
        return ids

    def artist_vinyl_master_ids(self, artist_name: str, max_pages: int = 10) -> tuple[set[int], bool]:
        """Obras (masters) do artista que têm pelo menos uma edição em vinil, inclusive
        reedições. Junta a busca de masters em vinil com os lançamentos em vinil (que trazem
        o master). Devolve (ids, completo); artistas com milhares de prensagens param em
        max_pages páginas."""
        import urllib.parse

        prefix = _search_prefix(artist_name)

        def same_artist(item: dict[str, Any]) -> bool:
            return _search_prefix(str(item.get("title") or "")).startswith(prefix)

        ids: set[int] = set()
        query = urllib.parse.urlencode({"type": "master", "artist": artist_name, "format": "Vinyl", "per_page": 100})
        for item in (self._request_json(f"{self.api_base}/database/search?{query}").get("results") or []):
            if same_artist(item) and item.get("id"):
                ids.add(int(item["id"]))
        complete = True
        page = 1
        while True:
            query = urllib.parse.urlencode(
                {"type": "release", "artist": artist_name, "format": "Vinyl", "per_page": 100, "page": page}
            )
            payload = self._request_json(f"{self.api_base}/database/search?{query}")
            for item in payload.get("results") or []:
                if same_artist(item) and item.get("master_id"):
                    ids.add(int(item["master_id"]))
            pagination = payload.get("pagination") or {}
            pages = int(pagination.get("pages", page))
            if page >= pages:
                break
            if page >= max_pages:
                complete = False
                break
            page += 1
            self.sleep_func(self.page_delay_seconds)
        return ids, complete

    def artist_main_releases(self, artist_id: int, max_pages: int = 4) -> list[dict[str, Any]]:
        """Discografia principal do artista (role Main), mais antigos primeiro."""
        items: list[dict[str, Any]] = []
        page = 1
        while page <= max_pages:
            payload = self._request_json(
                f"{self.api_base}/artists/{artist_id}/releases?sort=year&sort_order=asc&per_page=100&page={page}"
            )
            for item in payload.get("releases") or []:
                if str(item.get("role") or "") != "Main":
                    continue
                items.append({
                    "id": int(item.get("id") or 0),
                    "type": str(item.get("type") or ""),
                    "main_release": item.get("main_release"),
                    "title": str(item.get("title") or ""),
                    "year": int(item.get("year") or 0) or None,
                    "format": str(item.get("format") or ""),
                    "thumb": str(item.get("thumb") or ""),
                })
            pagination = payload.get("pagination") or {}
            if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                break
            page += 1
            self.sleep_func(self.page_delay_seconds)
        return items

    # ---------------- v4.3: trocar pela edição em vinil ----------------
    def vinyl_versions(self, release_id: int) -> dict[str, Any]:
        """Edições em vinil da mesma obra de um disco da coleção (pelo master). Sem master,
        procura lançamentos em vinil com o mesmo artista e título."""
        import urllib.parse

        payload = self._request_json(f"{self.api_base}/releases/{release_id}")
        master_id = payload.get("master_id")
        title = str(payload.get("title") or "")
        artist = _artist_name(payload)
        versions: list[dict[str, Any]] = []
        if master_id:
            page = 1
            while page <= 3:
                data = self._request_json(
                    f"{self.api_base}/masters/{master_id}/versions?format=Vinyl&per_page=100&page={page}"
                )
                for item in data.get("versions") or []:
                    versions.append({
                        "id": int(item.get("id") or 0),
                        "title": str(item.get("title") or ""),
                        "format": str(item.get("format") or ""),
                        "label": str(item.get("label") or ""),
                        "catno": str(item.get("catno") or ""),
                        "country": str(item.get("country") or ""),
                        "year": "" if str(item.get("released") or "0")[:4] in ("0", "") else str(item.get("released"))[:4],
                        "thumb": str(item.get("thumb") or ""),
                    })
                pagination = data.get("pagination") or {}
                if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
                    break
                page += 1
                self.sleep_func(self.page_delay_seconds)
        else:
            query = urllib.parse.urlencode(
                {"type": "release", "format": "Vinyl", "artist": artist, "release_title": title, "per_page": 50}
            )
            data = self._request_json(f"{self.api_base}/database/search?{query}")
            for item in data.get("results") or []:
                versions.append({
                    "id": int(item.get("id") or 0),
                    "title": str(item.get("title") or "").split(" - ", 1)[-1],
                    "format": ", ".join(item.get("format") or []),
                    "label": ", ".join((item.get("label") or [])[:2]),
                    "catno": str(item.get("catno") or ""),
                    "country": str(item.get("country") or ""),
                    "year": str(item.get("year") or ""),
                    "thumb": str(item.get("thumb") or ""),
                })
        # Prensagens do Brasil primeiro (a coleção é daqui), depois as mais antigas
        versions = [v for v in versions if v["id"]]
        versions.sort(key=lambda v: (v["country"] != "Brazil", v["year"] or "9999", v["label"]))
        return {"master_id": master_id, "title": title, "artist": artist, "versions": versions}

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
        
        for release_id, date_added_str, note_val in self.collection_releases_meta():
            synced_ids.add(release_id)
            existing = store.get_release(release_id)
            if existing is None:
                added_count += 1
                release = self.release_details(release_id)
                need_sleep = True
            else:
                updated_count += 1
                release = existing
                need_sleep = False
                
            synced_at = 0.0
            if date_added_str:
                try:
                    val = date_added_str.replace('Z', '+00:00')
                    dt = datetime.datetime.fromisoformat(val)
                    synced_at = dt.timestamp()
                except Exception as e:
                    print(f"[DISCOGS] Error parsing date_added '{date_added_str}': {e}")
            
            updates = {}
            if synced_at > 0.0:
                updates["synced_at"] = synced_at
            if note_val:
                updates["notes"] = note_val
            if updates:
                release = dataclasses.replace(release, **updates)
            store.upsert_release(release)
            if need_sleep:
                self.sleep_func(self.page_delay_seconds)
            
        # Delete local Discogs releases that are no longer in the live collection
        to_delete = local_ids - synced_ids
        for release_id in to_delete:
            store.delete_release(release_id)
            deleted_count += 1
            
        total_count = len(synced_ids)
        store.set_metadata("discogs_last_sync_count", str(total_count))
        store.set_metadata("discogs_last_sync_at", str(time.time()))
        store.set_metadata("discogs_last_sync_added", str(added_count))
        store.set_metadata("discogs_last_sync_updated", str(updated_count))
        store.set_metadata("discogs_last_sync_deleted", str(deleted_count))
        
        return {
            "count": total_count,
            "added": added_count,
            "updated": updated_count,
            "deleted": deleted_count,
        }
