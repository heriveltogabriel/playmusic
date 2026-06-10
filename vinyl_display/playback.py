from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from vinyl_display.models import Release, Track, TrackMatch


@dataclass
class ActivePlayback:
    match: TrackMatch
    started_at: float


class PlaybackController:
    def __init__(self):
        self.active: ActivePlayback | None = None
        self.status = "listening"
        self.message = ""
        self.last_recognition: dict[str, Any] | None = None

    def handle_match(self, match: TrackMatch, offset: float = 0.0, now: float | None = None) -> None:
        self.active = ActivePlayback(match=match, started_at=(now or time.time()) - offset)
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
        track, progress = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        next_track = self._next_track(release, track)

        return {
            "status": "playing",
            "message": "",
            "release": release.to_dict(),
            "track": track.to_dict(),
            "next_track": None if next_track is None else next_track.to_dict(),
            "progress_seconds": progress,
            "duration_seconds": track.duration_seconds,
            "last_recognition": self.last_recognition,
        }

    def _track_at_elapsed(
        self,
        release: Release,
        initial_track: Track,
        elapsed: int,
    ) -> tuple[Track, int]:
        try:
            start_index = release.tracks.index(initial_track)
        except ValueError:
            return initial_track, max(0, elapsed)

        remaining = max(0, elapsed)
        for track in release.tracks[start_index:]:
            if track.duration_seconds is None:
                return track, remaining
            if remaining < track.duration_seconds:
                return track, remaining
            remaining -= track.duration_seconds
        return release.tracks[-1], release.tracks[-1].duration_seconds or remaining

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
        release = self.active.match.release
        current_track, _ = self._track_at_elapsed(
            release,
            self.active.match.track,
            int(now - self.active.started_at),
        )
        next_track = self._next_track(release, current_track)
        if next_track is not None:
            try:
                start_index = release.tracks.index(self.active.match.track)
                next_index = release.tracks.index(next_track)
                elapsed_needed = 0
                for track in release.tracks[start_index:next_index]:
                    elapsed_needed += track.duration_seconds or 0
                self.active.started_at = now - elapsed_needed
            except ValueError:
                self.active.match.track = next_track
                self.active.started_at = now

    def skip_prev(self, now: float | None = None) -> None:
        if self.active is None:
            return
        now = now or time.time()
        release = self.active.match.release
        current_track, progress = self._track_at_elapsed(
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
                    elapsed_needed += track.duration_seconds or 0
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
            try:
                start_index = release.tracks.index(self.active.match.track)
                prev_index = index - 1
                elapsed_needed = 0
                for track in release.tracks[start_index:prev_index]:
                    elapsed_needed += track.duration_seconds or 0
                self.active.started_at = now - elapsed_needed
            except ValueError:
                self.active.match.track = prev_track
                self.active.started_at = now
