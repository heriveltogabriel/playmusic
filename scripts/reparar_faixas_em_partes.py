#!/usr/bin/env python3
"""Recupera faixas divididas em partes que o sync antigo descartava (v4.5.6).

No Discogs, faixas como "Shine On You Crazy Diamond (Parts I-V)" vêm como um "índice"
com as partes A1..A5 dentro. Até a 4.5.5 essas partes eram ignoradas e a faixa sumia do
disco (o Wish You Were Here ficava só com 3 faixas). Este script busca cada disco no
Discogs de novo e INSERE as faixas que faltam, sem mexer nas que já existem (durações
preenchidas à mão ou pelo MusicBrainz continuam). Discos com edição trocada
(release_overrides) ficam de fora.

Uso (na raiz do projeto):
    python3 scripts/reparar_faixas_em_partes.py            # simulação
    python3 scripts/reparar_faixas_em_partes.py --apply    # grava
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vinyl_display.catalog import CatalogStore  # noqa: E402
from vinyl_display.clients.discogs import DiscogsClient, release_from_discogs  # noqa: E402
from vinyl_display.config import load_config  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--only", type=int, default=0, help="só este release_id")
    args = parser.parse_args()

    config = load_config()
    store = CatalogStore(config.database_path)
    store.initialize()
    client = DiscogsClient(config.discogs_user, config.discogs_user_agent, token=config.discogs_token)
    with sqlite3.connect(config.database_path) as conn:
        overridden = {row[0] for row in conn.execute("SELECT release_id FROM release_overrides")}

    releases = [r for r in store.list_releases() if r.release_id > 0 and r.release_id not in overridden]
    if args.only:
        releases = [r for r in releases if r.release_id == args.only]
    fixed = 0
    for i, release in enumerate(releases, 1):
        try:
            payload = client._request_json(f"https://api.discogs.com/releases/{release.release_id}")
        except Exception as error:  # rede/limite: segue para o próximo
            print(f"[{i}/{len(releases)}] {release.release_id} erro: {error}", flush=True)
            time.sleep(3)
            continue
        if not any(item.get("type_") == "index" for item in payload.get("tracklist") or []):
            time.sleep(1.1)
            continue
        fresh = release_from_discogs(payload)
        have = {t.position for t in release.tracks}
        missing = [t for t in fresh.tracks if t.position not in have]
        if missing:
            order = {t.position: n for n, t in enumerate(fresh.tracks)}
            merged = sorted(release.tracks + missing, key=lambda t: order.get(t.position, 10_000))
            fixed += 1
            print(f"[{i}/{len(releases)}] {release.artist} - {release.title}: +" +
                  ", ".join(f"{t.position} {t.title}" for t in missing), flush=True)
            if args.apply:
                store.update_tracks(release.release_id, merged)
        time.sleep(1.1)
    print(f"{'Gravado' if args.apply else 'Simulação'}: {fixed} disco(s) com faixas recuperadas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
