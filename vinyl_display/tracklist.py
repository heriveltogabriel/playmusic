from __future__ import annotations

import dataclasses
import math
import re

from vinyl_display.models import Track

_NUMERIC_POSITION_RE = re.compile(r"^\d+$")
# Acima disso um único LP de 2 lados é improvável (provavelmente LP duplo): não arriscamos.
MAX_SINGLE_LP_SECONDS = 65 * 60
MAX_SINGLE_LP_TRACKS_WITHOUT_DURATION = 16


def is_vinyl(formats: list[str]) -> bool:
    lowered = {f.strip().lower() for f in formats or []}
    return "vinyl" in lowered or "lp" in lowered


def has_numeric_positions(tracks: list[Track]) -> bool:
    return bool(tracks) and all(_NUMERIC_POSITION_RE.match((t.position or "").strip()) for t in tracks)


def infer_vinyl_sides(tracks: list[Track], formats: list[str]) -> list[Track]:
    """Para vinil cuja tracklist do Discogs usa só números ("1", "2"...), divide as
    faixas em Lado A / Lado B para que o player saiba quando pedir para virar o disco.

    Com todas as durações conhecidas, o corte é onde os dois lados ficam mais equilibrados;
    sem durações, metade das faixas (arredondando para cima no Lado A).
    Retorna a lista original quando não há o que inferir com segurança.
    """
    if len(tracks) < 2 or not is_vinyl(formats) or not has_numeric_positions(tracks):
        return tracks

    durations = [t.duration_seconds for t in tracks]
    if all(durations):
        total = sum(durations)
        if total > MAX_SINGLE_LP_SECONDS:
            return tracks
        best_split, best_diff, running = 1, math.inf, 0
        for k in range(1, len(tracks)):
            running += durations[k - 1]
            diff = abs(running - (total - running))
            if diff < best_diff:
                best_split, best_diff = k, diff
        split = best_split
    else:
        if len(tracks) > MAX_SINGLE_LP_TRACKS_WITHOUT_DURATION:
            return tracks
        split = math.ceil(len(tracks) / 2)

    result = []
    for i, track in enumerate(tracks):
        side, number = ("A", i + 1) if i < split else ("B", i - split + 1)
        result.append(dataclasses.replace(track, position=f"{side}{number}"))
    return result
