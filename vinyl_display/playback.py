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

    def handle_match(self, match: TrackMatch, offset: float = 0.0, now: float | None = None) -> None:
        now = now or time.time()
        if self.active is not None and self.active.match.release.release_id == match.release.release_id:
            self.active = replace(
                self.active,
                match=match,
                started_at=now - offset
            )
        else:
            self.active = ActivePlayback(
                match=match,
                started_at=now - offset,
                played_tracks=set(),
                scrobbled=False
            )
        self.status = "playing"
        self.message = ""

    def handle_not_found(self, title: str, artist: str, now: float | None = None) -> None:
        self.active = None
        self.status = "not_found"
        self.message = (
            "Disco não encontrado na sua coleção. "
            "Cadastre no Discogs e sincronize novamente."
        )
        self.last_recognition = {
            "title": title,
            "artist": artist,
            "at": now or time.time(),
        }

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
        }

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

        for track in release.tracks[start_index:]:
            track_side = get_track_side(track.position)

            # Se o lado mudou, significa que completamos todas as faixas do lado anterior
            if initial_side and track_side and track_side != initial_side:
                return last_track_of_side, last_track_of_side.duration_seconds or 180, True

            track_duration = track.duration_seconds or 180

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
            curr_side = get_track_side(current_track.position)
            next_side = get_track_side(next_track.position)
            if curr_side and next_side and curr_side != next_side:
                self.active.match = replace(self.active.match, track=next_track)
                self.active.started_at = now
            else:
                try:
                    start_index = release.tracks.index(self.active.match.track)
                    next_index = release.tracks.index(next_track)
                    elapsed_needed = 0
                    for track in release.tracks[start_index:next_index]:
                        elapsed_needed += track.duration_seconds or 180
                    self.active.started_at = now - elapsed_needed
                except ValueError:
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
            try:
                start_index = release.tracks.index(self.active.match.track)
                curr_index = release.tracks.index(current_track)
                elapsed_needed = 0
                for track in release.tracks[start_index:curr_index]:
                    elapsed_needed += track.duration_seconds or 180
                self.active.started_at = now - elapsed_needed
            except ValueError:
                self.active.started_at = now
            return

        try:
            index = release.tracks.index(current_track)
        except ValueError:
            return

        if index > 0:
            prev_track = release.tracks[index - 1]
            curr_side = get_track_side(current_track.position)
            prev_side = get_track_side(prev_track.position)
            if curr_side and prev_side and curr_side != prev_side:
                self.active.match = replace(self.active.match, track=prev_track)
                self.active.started_at = now
            else:
                try:
                    start_index = release.tracks.index(self.active.match.track)
                    prev_index = index - 1
                    elapsed_needed = 0
                    for track in release.tracks[start_index:prev_index]:
                        elapsed_needed += track.duration_seconds or 180
                    self.active.started_at = now - elapsed_needed
                except ValueError:
                    self.active.match = replace(self.active.match, track=prev_track)
                    self.active.started_at = now
