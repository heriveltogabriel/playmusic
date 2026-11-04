#!/usr/bin/env python3
"""Preenche durações de faixas ausentes no catálogo usando o MusicBrainz.

Também corrige vinis cuja tracklist do Discogs só tem números ("1", "2"...),
trocando por posições com lado (A1, B1...) — pelo MusicBrainz quando disponível,
senão dividindo o disco ao meio.

Só preenche o que está faltando: durações vindas do Discogs nunca são sobrescritas.

Uso (na raiz do projeto):
    python3 scripts/fill_missing_durations.py            # simulação, não grava nada
    python3 scripts/fill_missing_durations.py --apply    # faz backup do banco e grava
"""
from __future__ import annotations

import argparse
import dataclasses
import re
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vinyl_display.catalog import CatalogStore  # noqa: E402
from vinyl_display.clients.musicbrainz import MusicBrainzClient  # noqa: E402
from vinyl_display.config import load_config  # noqa: E402
from vinyl_display.models import Release, Track  # noqa: E402
from vinyl_display.tracklist import has_numeric_positions, infer_vinyl_sides, is_vinyl  # noqa: E402

_SIDE_POSITION_RE = re.compile(r"^[A-Z]{1,2}\d+$")


def clean_artist(artist: str) -> str:
    # Discogs desambigua homônimos com "(2)", "(3)" e marca variações de nome com "*"
    artist = re.sub(r"\s*\(\d+\)", "", artist or "")
    return artist.replace("*", "").strip()


def needs_work(release: Release) -> bool:
    missing = any(not t.duration_seconds for t in release.tracks)
    numeric_vinyl = is_vinyl(release.formats) and has_numeric_positions(release.tracks)
    return bool(release.tracks) and (missing or numeric_vinyl)


def improve_tracks(release: Release, mb: MusicBrainzClient) -> tuple[list[Track], str]:
    tracks = list(release.tracks)
    source = "-"
    mb_tracks = None
    try:
        mb_tracks = mb.release_tracklist(
            clean_artist(release.artist), release.title, [t.title for t in tracks]
        )
    except Exception as error:  # rede/limite de requisições: segue sem MusicBrainz
        print(f"    ! MusicBrainz falhou: {error}")

    if mb_tracks:
        source = "musicbrainz"
        use_mb_positions = (
            is_vinyl(release.formats)
            and has_numeric_positions(tracks)
            and all(_SIDE_POSITION_RE.match(m["number"].upper()) for m in mb_tracks)
        )
        tracks = [
            dataclasses.replace(
                track,
                position=mb["number"].upper() if use_mb_positions else track.position,
                duration_seconds=track.duration_seconds or mb["length"],
            )
            for track, mb in zip(tracks, mb_tracks)
        ]

    inferred = infer_vinyl_sides(tracks, release.formats)
    if inferred != tracks:
        tracks = inferred
        source = source + "+lados" if source != "-" else "lados"
    return tracks, source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="grava no banco (padrão: só simula)")
    parser.add_argument("--db", help="caminho do banco (padrão: o do .env)")
    parser.add_argument("--limit", type=int, default=0, help="processa no máximo N discos")
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else load_config().database_path
    store = CatalogStore(db_path)
    store.initialize()
    pending = [r for r in store.list_releases() if needs_work(r)]
    if args.limit:
        pending = pending[: args.limit]
    print(f"Banco: {db_path}\n{len(pending)} disco(s) com faixas sem duração ou sem lado\n")

    if args.apply and pending:
        backup = db_path.with_name(f"{db_path.stem}.antes-duracoes-{time.strftime('%Y%m%d-%H%M%S')}{db_path.suffix}")
        shutil.copy2(db_path, backup)
        print(f"Backup: {backup}\n")

    mb = MusicBrainzClient()
    filled_total = changed_releases = 0
    for release in pending:
        before_missing = sum(1 for t in release.tracks if not t.duration_seconds)
        tracks, source = improve_tracks(release, mb)
        after_missing = sum(1 for t in tracks if not t.duration_seconds)
        positions_changed = [t.position for t in tracks] != [t.position for t in release.tracks]
        filled = before_missing - after_missing
        status = "ok" if (filled or positions_changed) else "sem dados"
        print(
            f"[{status:9}] {release.artist} - {release.title}: "
            f"{filled}/{before_missing} durações preenchidas"
            f"{', lados: ' + ' '.join(t.position for t in tracks) if positions_changed else ''}"
            f" ({source})"
        )
        if filled or positions_changed:
            changed_releases += 1
            filled_total += filled
            if args.apply:
                store.update_tracks(release.release_id, tracks)

    print(
        f"\n{changed_releases} disco(s) melhorados, {filled_total} durações preenchidas"
        + ("" if args.apply else "  (simulação — rode com --apply para gravar)")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
