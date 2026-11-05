"""Página do artista (v4.2): seus discos, faixas mais tocadas e a discografia do Discogs
com o que falta na coleção. A discografia fica guardada por 30 dias para não repetir
chamadas ao Discogs a cada visita."""
from __future__ import annotations

import json
import re
import time
import unicodedata
from typing import Any

CACHE_SECONDS = 30 * 86400
_PARENS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
_DISCOGS_MARKUP = re.compile(r"\[(?:a|l|m|r)=?([^\]]*)\]")


def norm_title(value: str) -> str:
    value = _PARENS.sub("", value or "")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())


def clean_profile(text: str, limit: int = 900) -> str:
    """Tira a marcação do Discogs ([a=Fulano], [url=...]texto[/url], [b]...) do perfil."""
    text = re.sub(r"\[url=[^\]]*\]", "", text or "")
    text = re.sub(r"\[/?(?:b|i|u|url)\]", "", text)
    def _name(match: re.Match) -> str:
        value = match.group(1).split("|")[-1]
        return "" if value.isdigit() else value  # [a12345] é só o código do artista

    text = _DISCOGS_MARKUP.sub(_name, text)
    text = re.sub(r"\s+\n", "\n", text).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def _owned_matches(entry_title: str, owned: list[tuple[int, str]]) -> list[int]:
    wanted = norm_title(entry_title)
    if not wanted:
        return []
    hits = []
    for release_id, title in owned:
        mine = norm_title(title)
        if mine == wanted or (len(wanted) > 5 and len(mine) > 5 and (wanted in mine or mine in wanted)):
            hits.append(release_id)
    return hits


def discography(app: Any, release_ids: list[int], refresh: bool = False, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    store = app.store
    owned_releases = [r for r in (store.get_release(rid) for rid in release_ids) if r is not None]
    if not owned_releases:
        return {"status": "error", "message": "Nenhum disco desse artista na coleção."}
    client = getattr(app, "discogs_client", None)

    # Artista do Discogs a partir de um disco seu (guardado por disco)
    artist = None
    for release in owned_releases:
        raw = store.get_metadata(f"release_artist:{release.release_id}")
        if raw:
            artist = json.loads(raw)
            break
    if artist is None:
        if client is None:
            return {"status": "error", "message": "Discogs não configurado."}
        try:
            artist = client.release_artist(owned_releases[0].release_id)
        except Exception as error:
            return {"status": "error", "message": f"Discogs indisponível: {error}"}
        if not artist:
            return {"status": "error", "message": "O Discogs não informa o artista deste disco."}
        store.set_metadata(f"release_artist:{owned_releases[0].release_id}", json.dumps(artist))

    cache_key = f"artist_discography:{artist['id']}"
    cached = None
    raw = store.get_metadata(cache_key)
    if raw and not refresh:
        try:
            cached = json.loads(raw)
        except ValueError:
            cached = None
    if not cached or now - float(cached.get("fetched_at", 0)) > CACHE_SECONDS:
        if client is None:
            return {"status": "error", "message": "Discogs não configurado."}
        try:
            profile = client.artist_profile(artist["id"])
            items = client.artist_main_releases(artist["id"])
        except Exception as error:
            if cached:
                cached["stale"] = True
            else:
                return {"status": "error", "message": f"Discogs indisponível: {error}"}
        else:
            # Um item por obra: o "master" junta as edições; lançamento solto só se não tiver master
            masters = [i for i in items if i["type"] == "master"]
            singles = [i for i in items if i["type"] != "master"]
            master_titles = {norm_title(m["title"]) for m in masters}
            works = masters + [i for i in singles if norm_title(i["title"]) not in master_titles]
            works.sort(key=lambda w: (w["year"] or 9999, w["title"]))
            cached = {
                "fetched_at": now,
                "artist": {"id": artist["id"], "name": profile["name"] or artist["name"],
                           "profile": clean_profile(profile["profile"]), "uri": profile["uri"]},
                "works": works,
            }
            store.set_metadata(cache_key, json.dumps(cached, ensure_ascii=False))

    # A coleção inteira entra na conferência: um disco seu pode estar creditado diferente
    all_owned = [(r.release_id, r.title) for r in store.list_releases()]
    mine_first = [(r.release_id, r.title) for r in owned_releases]
    works = []
    for work in cached["works"]:
        owned_ids = _owned_matches(work["title"], mine_first) or (
            _owned_matches(work["title"], all_owned) if len(norm_title(work["title"])) > 8 else []
        )
        url = f"https://www.discogs.com/{'master' if work['type'] == 'master' else 'release'}/{work['id']}"
        works.append({**work, "owned_release_ids": owned_ids, "url": url})
    owned_count = sum(1 for w in works if w["owned_release_ids"])
    return {
        "status": "ok",
        "artist": cached["artist"],
        "works": works,
        "owned_count": owned_count,
        "total": len(works),
        "fetched_at": cached["fetched_at"],
        "stale": bool(cached.get("stale")),
    }


def artist_listening(store: Any, release_ids: list[int]) -> dict[str, Any]:
    """Faixas mais tocadas e tempo de escuta só dos discos deste artista."""
    wanted = set(release_ids)
    rows = [r for r in store.listening_log_since(0.0) if r["release_id"] in wanted]
    counts: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["release_id"], row["track_position"])
        entry = counts.setdefault(key, {"release_id": row["release_id"], "position": row["track_position"],
                                        "title": row["track_title"] or "", "plays": 0, "last_at": 0})
        entry["plays"] += 1
        entry["last_at"] = max(entry["last_at"], row["at"])
    top = sorted(counts.values(), key=lambda e: (-e["plays"], -e["last_at"]))[:10]
    return {"top_tracks": top, "logged_seconds": sum(int(r["duration_seconds"] or 0) for r in rows)}
