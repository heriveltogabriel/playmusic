from __future__ import annotations

import time
from dataclasses import dataclass, replace, field
from typing import Any, Callable

from vinyl_display.models import Release, Track, TrackMatch


@dataclass
class ActivePlayback:
    match: TrackMatch
    started_at: float
    played_tracks: set[str] = field(default_factory=set)
    scrobbled: bool = False
    locked: bool = False


def get_track_side(position: str) -> str:
    if not position:
        return ""
    pos = position.strip().upper()
    if pos.startswith("SIDE "):
        return pos
    side = ""
    for char in pos:
        if char.isalpha():
            side += char
        else:
            break
    return side


class PlaybackController:
    def __init__(self, on_scrobble: Callable[[int], Any] | None = None):
        self.active: ActivePlayback | None = None
        self.status = "listening"
        self.message = ""
        self.last_recognition: dict[str, Any] | None = None
        self.on_scrobble = on_scrobble
        self.alternatives: list[TrackMatch] = []

    def handle_match(
        self,
        match: TrackMatch,
        offset: float = 0.0,
        now: float | None = None,
        latency: float = 0.0,
        alternatives: list[TrackMatch] | None = None,
    ) -> None:
        now = now or time.time()
        started_at = now - offset - latency

        is_same_release = (
            self.active is not None
            and self.active.match.release.release_id == match.release.release_id
        )
        is_locked = is_same_release and getattr(self.active, "locked", False)

        if is_locked:
            self.alternatives = []
        elif alternatives is not None:
            self.alternatives = [a for a in alternatives if a.release.release_id != match.release.release_id]

        if is_same_release and self.active is not None:
            self.active = replace(
                self.active,
                match=match,
                started_at=started_at,
                locked=is_locked,
            )
        else:
            self.active = ActivePlayback(
                match=match,
                started_at=started_at,
                played_tracks=set(),
                scrobbled=False,
                locked=False,
            )
        self.status = "playing"
        self.message = ""

    def handle_not_found(self, title: str, artist: str, now: float | None = None) -> None:
        self.last_recognition = {
            "title": title,
            "artist": artist,
            "at": now or time.time(),
        }
        if self.active is None:
            self.status = "not_found"
            self.message = (
                "Disco não encontrado na sua coleção. "
                "Cadastre no Discogs e sincronize novamente."
            )

    def set_identifying(self) -> None:
        self.status = "identifying"
        self.message = "Identificando trecho..."

    def set_listening(self) -> None:
        if self.status != "playing":
            self.status = "listening"
            self.message = ""

    def _record_played_tracks(self, now: float) -> Track | None:
        if self.active is None:
            return None
        release = self.active.match.release
        track, _, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        if track:
            try:
                start_index = release.tracks.index(self.active.match.track)
                end_index = release.tracks.index(track)
                for t in release.tracks[start_index:end_index + 1]:
                    self.active.played_tracks.add(t.position)
            except ValueError:
                self.active.played_tracks.add(track.position)
        return track

    def current_state(self, now: float | None = None) -> dict[str, Any]:
        now = now or time.time()
        if self.active is None:
            return {
                "status": self.status,
                "message": self.message,
                "release": None,
                "track": None,
                "next_track": None,
                "progress_seconds": None,
                "duration_seconds": None,
                "last_recognition": self.last_recognition,
                "alternatives": [],
            }

        release = self.active.match.release
        track = self._record_played_tracks(now)
        _, progress, is_side_finished = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        if len(self.active.played_tracks) > 1 and not self.active.scrobbled:
            self.active.scrobbled = True
            if self.on_scrobble:
                try:
                    self.on_scrobble(release.release_id)
                except Exception as e:
                    print(f"[PLAYBACK] Error automatically registering audition for release {release.release_id}: {e}")

        next_track = self._next_track(release, track)
        alternatives_payload = [
            {
                "release_id": alt.release.release_id,
                "title": alt.release.title,
                "artist": alt.release.artist,
                "year": alt.release.year,
                "cover_url": alt.release.cover_url,
                "track_position": alt.track.position,
                "track_title": alt.track.title,
                "score": alt.score,
            }
            for alt in self.alternatives
        ]

        if is_side_finished:
            curr_side = get_track_side(track.position)
            if next_track:
                next_side = get_track_side(next_track.position)
                msg = f"Fim do Lado {curr_side}. Por favor, vire o disco para o Lado {next_side}!"
            else:
                msg = "Fim do disco! Por favor, recoloque o vinil ou troque de álbum."

            return {
                "status": "waiting_flip",
                "message": msg,
                "release": release.to_dict(),
                "track": track.to_dict(),
                "next_track": None if next_track is None else next_track.to_dict(),
                "progress_seconds": progress,
                "duration_seconds": track.duration_seconds or 180,
                "last_recognition": self.last_recognition,
                "alternatives": alternatives_payload,
            }

        return {
            "status": "playing",
            "message": "",
            "release": release.to_dict(),
            "track": track.to_dict(),
            "next_track": None if next_track is None else next_track.to_dict(),
            "progress_seconds": progress,
            "duration_seconds": track.duration_seconds or 180,
            "last_recognition": self.last_recognition,
            "alternatives": alternatives_payload,
        }

    def switch_release(self, release_id: int, store: Any) -> bool:
        if self.active is None:
            return False

        target_match = next((alt for alt in self.alternatives if alt.release.release_id == release_id), None)
        if target_match is None:
            target_release = store.get_release(release_id)
            if not target_release:
                return False
            curr_title = self.active.match.track.title.strip().lower()
            matching_track = next((t for t in target_release.tracks if t.title.strip().lower() == curr_title), None)
            if not matching_track and target_release.tracks:
                matching_track = target_release.tracks[0]
            target_match = TrackMatch(
                release=target_release,
                track=matching_track or self.active.match.track,
                score=100,
                reason="user switch",
            )

        # Clear alternatives so the button disappears and the album is locked
        self.alternatives = []

        self.active = replace(
            self.active,
            match=target_match,
            played_tracks={target_match.track.position},
            scrobbled=False,
            locked=True,
        )
        return True

    def _track_at_elapsed(
        self,
        release: Release,
        initial_track: Track,
        elapsed: int,
    ) -> tuple[Track, int, bool]:
        try:
            start_index = release.tracks.index(initial_track)
        except ValueError:
            return initial_track, max(0, elapsed), False

        initial_side = get_track_side(initial_track.position)
        remaining = max(0, elapsed)
        last_track_of_side = initial_track
        GAP_SECONDS = 3

        for i, track in enumerate(release.tracks[start_index:]):
            track_side = get_track_side(track.position)

            # Se o lado mudou, significa que completamos todas as faixas do lado anterior
            if initial_side and track_side and track_side != initial_side:
                return last_track_of_side, last_track_of_side.duration_seconds or 180, True

            track_duration = track.duration_seconds or 180

            # Se não for a primeira faixa da iteração, existe uma pausa de 10s antes dela
            if i > 0:
                if remaining < GAP_SECONDS:
                    # Estamos na pausa de transição; mostramos a faixa anterior concluída
                    return last_track_of_side, last_track_of_side.duration_seconds or 180, False
                remaining -= GAP_SECONDS

            if remaining < track_duration:
                return track, remaining, False

            remaining -= track_duration
            last_track_of_side = track

        # Se completou todas as faixas e ainda sobrou tempo
        return last_track_of_side, last_track_of_side.duration_seconds or 180, True

    def _next_track(self, release: Release, track: Track) -> Track | None:
        try:
            index = release.tracks.index(track)
        except ValueError:
            return None
        next_index = index + 1
        if next_index >= len(release.tracks):
            return None
        return release.tracks[next_index]

    def skip_next(self, now: float | None = None) -> None:
        if self.active is None:
            return
        now = now or time.time()
        self._record_played_tracks(now)
        release = self.active.match.release
        current_track, _, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        next_track = self._next_track(release, current_track)
        if next_track is not None:
            self.active.match = replace(self.active.match, track=next_track)
            self.active.started_at = now

    def skip_prev(self, now: float | None = None) -> None:
        if self.active is None:
            return
        now = now or time.time()
        self._record_played_tracks(now)
        release = self.active.match.release
        current_track, progress, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )

        if progress > 3:
            self.active.started_at = now
            return

        try:
            index = release.tracks.index(current_track)
        except ValueError:
            return

        if index > 0:
            prev_track = release.tracks[index - 1]
            self.active.match = replace(self.active.match, track=prev_track)
            self.active.started_at = now
