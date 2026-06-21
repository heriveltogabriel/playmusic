from __future__ import annotations

import re
import unicodedata

from vinyl_display.catalog import CatalogStore
from vinyl_display.models import RecognitionResult, TrackMatch, Track, Release
from vinyl_display.playback import get_track_side


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


def is_first_track_of_side(release: Release, track: Track) -> bool:
    if not release.tracks:
        return False
    # The absolute first track is always the first track of its side
    if release.tracks[0] == track:
        return True
    try:
        idx = release.tracks.index(track)
        if idx > 0:
            prev_track = release.tracks[idx - 1]
            prev_side = get_track_side(prev_track.position)
            curr_side = get_track_side(track.position)
            if prev_side != curr_side:
                return True
    except ValueError:
        pass
    return False


class CollectionMatcher:
    def __init__(self, store: CatalogStore, minimum_score: int = 70):
        self.store = store
        self.minimum_score = minimum_score

    def match(
        self,
        recognition: RecognitionResult,
        active_release_id: int | None = None,
    ) -> TrackMatch | None:
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

            # Active Album Boost: Prioritize remaining/matching on the currently active album
            if active_release_id is not None and release.release_id == active_release_id:
                score += 25
                reasons.append("active album boost")

            # Side Start Boost: Extra weight if matching the beginning of a side/album
            if is_first_track_of_side(release, track):
                score += 15
                reasons.append("side start boost")

            if score >= self.minimum_score and (best is None or score > best.score):
                best = TrackMatch(
                    release=release,
                    track=track,
                    score=score,
                    reason=", ".join(reasons),
                )

        return best
