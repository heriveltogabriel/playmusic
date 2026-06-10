from __future__ import annotations

import re
import unicodedata

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import RecognitionResult, TrackMatch


def normalize_text(value: str | None) -> str:
    value = value or ""
    # Normalize unicode and strip accents/diacritics first
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")

    # Remove terms like (Remaster), [Live], (Ao Vivo), (Acústico)
    ascii_text = re.sub(
        r"\s*[\(\[][^\]\)]*?(remaster|live|mono|stereo|single|version|edit|mix|remix|digitally|ao vivo|acustico|unplugged)[^\]\)]*?[\)\]]",
        "",
        ascii_text,
        flags=re.IGNORECASE,
    )
    # Remove trailing terms after a hyphen
    ascii_text = re.sub(
        r"\s*-\s*.*?(remaster|live|mono|stereo|single|version|edit|mix|remix|ao vivo|acustico|unplugged).*$",
        "",
        ascii_text,
        flags=re.IGNORECASE,
    )
    # Keep alphanumeric characters and spaces
    ascii_text = re.sub(r"[^a-zA-Z0-9]+", " ", ascii_text)
    return " ".join(ascii_text.lower().split())


def _contains_or_equals(left: str, right: str) -> bool:
    return bool(left and right and (left == right or left in right or right in left))


class CollectionMatcher:
    def __init__(self, store: CatalogStore, minimum_score: int = 70):
        self.store = store
        self.minimum_score = minimum_score

    def match(self, recognition: RecognitionResult) -> TrackMatch | None:
        recognized_title = normalize_text(recognition.title)
        recognized_artist = normalize_text(recognition.artist)
        recognized_album = normalize_text(recognition.album)

        best: TrackMatch | None = None
        for release, track in self.store.iter_track_candidates():
            score = 0
            reasons = []

            track_title = normalize_text(track.title)
            release_artist = normalize_text(release.artist)
            release_title = normalize_text(release.title)

            if track_title == recognized_title:
                score += 70
                reasons.append("track title exact")
            elif _contains_or_equals(track_title, recognized_title):
                score += 45
                reasons.append("track title partial")

            if _contains_or_equals(release_artist, recognized_artist):
                score += 20
                reasons.append("artist match")

            if recognized_album and _contains_or_equals(release_title, recognized_album):
                score += 10
                reasons.append("album match")

            if score >= self.minimum_score and (best is None or score > best.score):
                best = TrackMatch(
                    release=release,
                    track=track,
                    score=score,
                    reason=", ".join(reasons),
                )

        return best
