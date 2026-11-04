"""Sincroniza a coleção do Discogs direto no banco, sem passar pelo servidor HTTP.

Feito para o cron (não precisa de login nem de HTTPS):
    0 4 * * * cd /home/opc/vinyl_display && /usr/bin/python3.9 -m vinyl_display.sync >> /home/opc/discogs-sync.log 2>&1

Sai com código 1 se o sync falhar, para o cron/alertas perceberem.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any, Callable

from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.config import Config, load_config


def run_sync(
    config: Config | None = None,
    client_factory: Callable[[Config], Any] | None = None,
) -> dict[str, Any]:
    config = config or load_config()
    store = CatalogStore(config.database_path)
    store.favorite_threshold = config.favorite_threshold
    store.initialize()
    client = (client_factory or _discogs_client)(config)
    started = time.time()
    try:
        result = client.sync_collection(store)
    except Exception as error:
        store.set_metadata("discogs_last_sync_error", f"{time.strftime('%Y-%m-%d %H:%M:%S')} {error}")
        return {"status": "error", "message": str(error), "seconds": round(time.time() - started, 1)}
    store.set_metadata("discogs_last_sync_error", "")
    return {"status": "ok", **result, "seconds": round(time.time() - started, 1)}


def _discogs_client(config: Config) -> DiscogsClient:
    return DiscogsClient(config.discogs_user, config.discogs_user_agent, token=config.discogs_token)


def main() -> int:
    result = run_sync()
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {json.dumps(result, ensure_ascii=False)}", flush=True)
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
