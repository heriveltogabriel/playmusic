"""Diário da vitrola e cuidados (v4.2).

Diário: cada faixa que o player acompanhou vira uma linha em `listening_log`; faixas
separadas por mais de SESSION_GAP viram sessões diferentes. Dias anteriores ao registro
de faixas aparecem pelas audições do disco (sem faixas).

Cuidados: horas de agulha estimadas pelas audições (cada audição conta o disco inteiro) e
limpeza de cada disco (audições desde a última limpeza).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from vinyl_display.playback import get_track_side

BRT = timezone(timedelta(hours=-3))
SESSION_GAP = 45 * 60
DEFAULT_DISC_SECONDS = 40 * 60
NEEDLE_KEY = "needle_state"
DEFAULT_NEEDLE_LIFE_HOURS = 1000


def _iso_to_ts(value: str) -> float | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, BRT).strftime("%Y-%m-%d")


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


# ---------------------------------------------------------------- diário
def build_diary(store: Any, days: int = 30, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    since = now - days * 86400
    releases = {r.release_id: r for r in store.list_releases_with_stats()}
    log = store.listening_log_since(since)

    sessions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for row in log:
        if current is None or row["at"] - current["_last"] > SESSION_GAP:
            current = {"start": row["at"], "_last": row["at"], "end": row["at"], "discs": [], "_by_id": {},
                       "tracks": 0, "seconds": 0}
            sessions.append(current)
        current["_last"] = row["at"]
        duration = int(row["duration_seconds"] or 0)
        current["end"] = max(current["end"], row["at"] + duration)
        current["tracks"] += 1
        current["seconds"] += duration
        disc = current["_by_id"].get(row["release_id"])
        if disc is None:
            release = releases.get(row["release_id"])
            disc = (_release_brief(release) if release else
                    {"release_id": row["release_id"], "title": "Disco removido", "artist": "", "cover_url": ""})
            disc.update({"sides": [], "tracks": []})
            current["_by_id"][row["release_id"]] = disc
            current["discs"].append(disc)
        side = row["side"] or get_track_side(row["track_position"])
        if side and side not in disc["sides"]:
            disc["sides"].append(side)
        disc["tracks"].append({"position": row["track_position"], "title": row["track_title"] or "", "at": row["at"]})

    logged_days = set()
    for session in sessions:
        session.pop("_last", None)
        session.pop("_by_id", None)
        session["day"] = _day(session["start"])
        session["kind"] = "tracks"
        logged_days.add(session["day"])

    # Dias sem faixas registradas: usa as audições marcadas (player ou "Ouvi").
    by_day: dict[str, dict[str, Any]] = {}
    for release in releases.values():
        for value in release.listen_dates or []:
            ts = _iso_to_ts(value)
            if ts is None or ts < since:
                continue
            day = _day(ts)
            if day in logged_days:
                continue
            entry = by_day.setdefault(day, {"day": day, "kind": "auditions", "start": ts, "end": ts,
                                            "discs": [], "tracks": 0, "seconds": 0})
            entry["start"] = min(entry["start"], ts)
            entry["end"] = max(entry["end"], ts)
            entry["seconds"] += disc_seconds(release)
            entry["discs"].append({**_release_brief(release), "sides": [], "tracks": [], "at": ts})
    for entry in by_day.values():
        entry["discs"].sort(key=lambda d: d["at"])
    sessions.extend(by_day.values())
    sessions.sort(key=lambda s: s["start"], reverse=True)

    top = []
    for row in store.top_tracks(since=0.0, limit=20):
        release = releases.get(row["release_id"])
        top.append({
            **(_release_brief(release) if release else {"release_id": row["release_id"], "title": "", "artist": "", "cover_url": ""}),
            "position": row["track_position"],
            "track_title": row["track_title"] or "",
            "plays": row["plays"],
            "last_at": row["last_at"],
        })

    first_log = store.listening_log_since(0.0)[:1]
    return {
        "days": days,
        "sessions": sessions,
        "top_tracks": top,
        "totals": {
            "sessions": len(sessions),
            "discs": sum(len(s["discs"]) for s in sessions),
            "hours": round(sum(s["seconds"] for s in sessions) / 3600, 1),
        },
        "tracks_since": first_log[0]["at"] if first_log else None,
    }


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
