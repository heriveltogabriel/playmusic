"""Lados e faixas ouvidos (v4.10, no lugar do Diário da Vitrola) e cuidados (v4.2).

Cada faixa que o player acompanha vira uma linha em `listening_log`; a Linha do Tempo do
admin mostra, por disco, os lados ouvidos e essas faixas.

Cuidados: horas de agulha estimadas pelas audições (cada audição conta o disco inteiro) e
limpeza de cada disco (audições desde a última limpeza).
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any

from vinyl_display.playback import get_track_side

DEFAULT_DISC_SECONDS = 40 * 60
NEEDLE_KEY = "needle_state"
DEFAULT_NEEDLE_LIFE_HOURS = 1000


def _iso_to_ts(value: str) -> float | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def disc_seconds(release: Any) -> int:
    total = sum(int(t.duration_seconds or 0) for t in release.tracks)
    return total or DEFAULT_DISC_SECONDS


def _release_brief(release: Any) -> dict[str, Any]:
    return {
        "release_id": release.release_id,
        "title": release.title,
        "artist": release.artist,
        "cover_url": release.cover_url,
    }


# ---------------------------------------------------------------- lados e faixas
def listening_by_release(store: Any) -> dict[int, dict[str, Any]]:
    """v4.10: para a Linha do Tempo — por disco, os lados já ouvidos e as faixas que o player
    acompanhou (com quantas vezes e a última vez). Substitui o antigo Diário da Vitrola."""
    discs: dict[int, dict[str, Any]] = {}
    for row in store.listening_log_since(0.0):
        disc = discs.setdefault(int(row["release_id"]), {"sides": [], "tracks": {}, "last_at": 0.0})
        side = row["side"] or get_track_side(row["track_position"])
        if side and side not in disc["sides"]:
            disc["sides"].append(side)
        position = row["track_position"] or ""
        track = disc["tracks"].setdefault(position, {"position": position, "title": "", "plays": 0, "last_at": 0.0})
        track["plays"] += 1
        track["title"] = row["track_title"] or track["title"]
        track["last_at"] = max(track["last_at"], row["at"])
        disc["last_at"] = max(disc["last_at"], row["at"])
    result: dict[int, dict[str, Any]] = {}
    for release_id, disc in discs.items():
        result[release_id] = {
            "sides": sorted(disc["sides"]),
            "tracks": sorted(disc["tracks"].values(), key=lambda t: _position_key(t["position"])),
            "last_at": disc["last_at"],
        }
    return result


def _position_key(position: str) -> tuple:
    """A1, A2, ..., A10, B1: lado pela letra e faixa pelo número."""
    letters = "".join(ch for ch in position if ch.isalpha())
    digits = "".join(ch for ch in position if ch.isdigit())
    return (letters, int(digits) if digits else 0, position)


# ---------------------------------------------------------------- cuidados
def _needle_state(store: Any) -> dict[str, Any]:
    raw = store.get_metadata(NEEDLE_KEY)
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        data = {}
    data.setdefault("life_hours", DEFAULT_NEEDLE_LIFE_HOURS)
    data.setdefault("model", "")
    data.setdefault("installed_at", None)
    data.setdefault("history", [])
    return data


def _hours_between(releases: list[Any], start: float | None, end: float | None = None) -> float:
    seconds = 0
    for release in releases:
        for value in release.listen_dates or []:
            ts = _iso_to_ts(value)
            if ts is None or (start and ts < start) or (end and ts >= end):
                continue
            seconds += disc_seconds(release)
    return round(seconds / 3600, 1)


def build_care(store: Any, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    releases = store.list_releases_with_stats()
    needle = _needle_state(store)
    first_listen = min(
        (ts for r in releases for ts in (_iso_to_ts(v) for v in (r.listen_dates or [])) if ts),
        default=None,
    )
    installed_at = needle["installed_at"]
    hours = _hours_between(releases, installed_at)
    life = float(needle["life_hours"] or DEFAULT_NEEDLE_LIFE_HOURS)
    week_ago_hours = _hours_between(releases, max(installed_at or 0, now - 28 * 86400))
    per_week = round(week_ago_hours / 4, 1)
    remaining = max(0.0, life - hours)
    weeks_left = round(remaining / per_week) if per_week > 0 else None

    cleaned = store.cleaning_dates()
    discs = []
    for release in releases:
        listens = sorted(ts for ts in (_iso_to_ts(v) for v in (release.listen_dates or [])) if ts)
        care = cleaned.get(release.release_id)
        cleaned_at = care["cleaned_at"] if care else None
        since_clean = sum(1 for ts in listens if not cleaned_at or ts > cleaned_at)
        discs.append({
            **_release_brief(release),
            "plays": len(listens),
            "plays_since_clean": since_clean,
            "cleaned_at": cleaned_at,
            "times_cleaned": care["times_cleaned"] if care else 0,
            "last_played": listens[-1] if listens else None,
        })
    discs.sort(key=lambda d: (-d["plays_since_clean"], -(d["last_played"] or 0)))

    return {
        "needle": {
            "model": needle["model"],
            "installed_at": installed_at,
            "counting_from": installed_at or first_listen,
            "life_hours": life,
            "hours_used": hours,
            "percent": round(min(100.0, hours / life * 100), 1) if life else 0,
            "hours_per_week": per_week,
            "weeks_left": weeks_left,
            "history": needle["history"],
        },
        "discs": discs,
        "never_cleaned": sum(1 for d in discs if not d["cleaned_at"]),
        "estimate_note": "Cada audição conta o disco inteiro (ou 40 min quando faltam as durações).",
    }


def update_needle(store: Any, payload: dict[str, Any]) -> dict[str, Any]:
    needle = _needle_state(store)
    if "model" in payload:
        needle["model"] = str(payload.get("model") or "")[:80]
    if payload.get("life_hours") not in (None, ""):
        needle["life_hours"] = max(50, min(5000, int(float(payload["life_hours"]))))
    if "installed_at" in payload:
        value = payload.get("installed_at")
        needle["installed_at"] = float(value) if value not in (None, "") else None
    store.set_metadata(NEEDLE_KEY, json.dumps(needle))
    return needle


def replace_needle(store: Any, model: str = "", now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    needle = _needle_state(store)
    releases = store.list_releases_with_stats()
    needle["history"].insert(0, {
        "model": needle["model"],
        "installed_at": needle["installed_at"],
        "removed_at": now,
        "hours": _hours_between(releases, needle["installed_at"], now),
    })
    needle["history"] = needle["history"][:10]
    needle["installed_at"] = now
    if model:
        needle["model"] = model[:80]
    store.set_metadata(NEEDLE_KEY, json.dumps(needle))
    return needle
