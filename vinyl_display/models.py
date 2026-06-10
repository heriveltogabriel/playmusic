from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Track:
    position: str
    title: str
    duration_seconds: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "title": self.title,
            "duration_seconds": self.duration_seconds,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Track":
        return cls(
            position=str(payload.get("position", "")),
            title=str(payload.get("title", "")),
            duration_seconds=payload.get("duration_seconds"),
        )


@dataclass(frozen=True)
class Release:
    release_id: int
    title: str
    artist: str
    year: int | None
    cover_url: str
    country: str
    labels: list[str]
    catalog_numbers: list[str]
    formats: list[str]
    tracks: list[Track]
    discogs_url: str
    rating: int = 0
    auditions: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "release_id": self.release_id,
            "title": self.title,
            "artist": self.artist,
            "year": self.year,
            "cover_url": self.cover_url,
            "country": self.country,
            "labels": self.labels,
            "catalog_numbers": self.catalog_numbers,
            "formats": self.formats,
            "tracks": [track.to_dict() for track in self.tracks],
            "discogs_url": self.discogs_url,
            "rating": self.rating,
            "auditions": self.auditions,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Release":
        return cls(
            release_id=int(payload["release_id"]),
            title=str(payload.get("title", "")),
            artist=str(payload.get("artist", "")),
            year=payload.get("year"),
            cover_url=str(payload.get("cover_url", "")),
            country=str(payload.get("country", "")),
            labels=list(payload.get("labels", [])),
            catalog_numbers=list(payload.get("catalog_numbers", [])),
            formats=list(payload.get("formats", [])),
            tracks=[Track.from_dict(track) for track in payload.get("tracks", [])],
            discogs_url=str(payload.get("discogs_url", "")),
            rating=int(payload.get("rating", 0)),
            auditions=int(payload.get("auditions", 0)),
        )


@dataclass(frozen=True)
class RecognitionResult:
    title: str
    artist: str
    album: str | None
    provider: str
    confidence: float | None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def album_or_empty(self) -> str:
        return self.album or ""

    @property
    def display_artist(self) -> str:
        return self.artist or "Artista desconhecido"


@dataclass(frozen=True)
class TrackMatch:
    release: Release
    track: Track
    score: int
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "release": self.release.to_dict(),
            "track": self.track.to_dict(),
            "score": self.score,
            "reason": self.reason,
        }
