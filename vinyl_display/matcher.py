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
    # v4.5.6: partes de uma faixa: "(Parts I-V)", "(Pts. 1-5)", "(Part Two)", ", Pts. 1-7"
    ascii_text = re.sub(r"\s*[\(\[]\s*(parts?|pts?)\b\.?[^\]\)]*[\)\]]", "", ascii_text, flags=re.IGNORECASE)
    ascii_text = re.sub(r"\s*[,:-]\s*(parts?|pts?)\b\.?\s*[\w\s\-&]*$", "", ascii_text, flags=re.IGNORECASE)
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


def preference_key(title: str | None, artist: str | None) -> str:
    """Chave estável de uma música reconhecida, para lembrar o disco escolhido."""
    title_key = normalize_text(title)
    if not title_key:
        return ""
    return f"{title_key}|{normalize_text(artist)}"


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

    def match_all(
        self,
        recognition: RecognitionResult,
        active_release_id: int | None = None,
        preferred_release_id: int | None = None,
    ) -> list[TrackMatch]:
        recognized_title = normalize_text(recognition.title)
        recognized_artist = normalize_text(recognition.artist)
        recognized_album = normalize_text(recognition.album)

        matches_by_release: dict[int, TrackMatch] = {}
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

            # Disco escolhido por você da última vez que esta música tocou
            if preferred_release_id is not None and release.release_id == preferred_release_id and score >= self.minimum_score:
                score += 40
                reasons.append("preferred release")

            # Side Start Boost: Extra weight if matching the beginning of a side/album
            if is_first_track_of_side(release, track):
                score += 15
                reasons.append("side start boost")

            if score >= self.minimum_score:
                candidate = TrackMatch(
                    release=release,
                    track=track,
                    score=score,
                    reason=", ".join(reasons),
                )
                prev = matches_by_release.get(release.release_id)
                if prev is None or candidate.score > prev.score:
                    matches_by_release[release.release_id] = candidate

        # Sort matches by score descending
        # v4.5.6: empate de pontos: fica à frente o disco com menos faixas (o álbum original
        # antes de ao vivo, coletânea ou caixa, como Wish You Were Here antes do Pulse)
        return sorted(matches_by_release.values(), key=lambda m: (-m.score, len(m.release.tracks)))

    def match(
        self,
        recognition: RecognitionResult,
        active_release_id: int | None = None,
        preferred_release_id: int | None = None,
    ) -> TrackMatch | None:
        matches = self.match_all(
            recognition, active_release_id=active_release_id, preferred_release_id=preferred_release_id
        )
        return matches[0] if matches else None
