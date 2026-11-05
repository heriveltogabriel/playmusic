"""Aba Sistema das Configurações (v4.2): versão, sync, backup, player e Shazam num lugar só."""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parent.parent


def backup_dirs() -> list[Path]:
    """Onde os backups diários ficam: o do OCI (servidor principal) e o local (Bruno)."""
    dirs = []
    if os.environ.get("BACKUP_ROOT"):
        dirs.append(Path(os.environ["BACKUP_ROOT"]))
    dirs += [PROJECT_DIR / "backups" / "oci", Path.home() / "vinyl_backups"]
    return dirs


def last_backup(dirs: list[Path] | None = None) -> dict[str, Any] | None:
    newest = None
    for folder in dirs or backup_dirs():
        try:
            for path in folder.glob("playmusic-backup-*.tgz"):
                stat = path.stat()
                if newest is None or stat.st_mtime > newest[1].st_mtime:
                    newest = (path, stat)
        except OSError:
            continue
    if newest is None:
        return None
    path, stat = newest
    return {"file": path.name, "at": stat.st_mtime, "size_bytes": stat.st_size,
            "uploaded": "oci" in path.parts}


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def build_system_status(app: Any, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    store = app.store
    version = "?"
    try:
        version = (PROJECT_DIR / "version.txt").read_text(encoding="utf-8").strip()
    except OSError:
        pass

    def meta_int(key: str) -> int | None:
        value = store.get_metadata(key)
        return int(value) if value and value.isdigit() else None

    db_path = Path(store.database_path)
    try:
        disk = shutil.disk_usage(db_path.parent)
        disk_info = {"free_bytes": disk.free, "total_bytes": disk.total}
    except OSError:
        disk_info = None
    backup = last_backup()
    notifier = getattr(app, "notifier", None)
    return {
        "version": version,
        "now": now,
        "sync": {
            "at": _float(store.get_metadata("discogs_last_sync_at")),
            "count": meta_int("discogs_last_sync_count"),
            "added": meta_int("discogs_last_sync_added"),
            "updated": meta_int("discogs_last_sync_updated"),
            "deleted": meta_int("discogs_last_sync_deleted"),
            "error": store.get_metadata("discogs_last_sync_error") or "",
        },
        "backup": backup,
        "player": app.player_status(now),
        "shazam": app.shazam_usage(),
        "alerts": {
            "telegram": bool(notifier and getattr(notifier, "telegram_bot_token", "") and getattr(notifier, "telegram_chat_id", "")),
            "ntfy": bool(notifier and getattr(notifier, "ntfy_topic", "")),
        },
        "collection_count": store.collection_count(),
        "database_bytes": db_path.stat().st_size if db_path.exists() else None,
        "disk": disk_info,
    }
