from __future__ import annotations

import base64
import json
import urllib.request
from typing import Any

from vinyl_display.models import RecognitionResult


class ShazamClient:
    def __init__(self, api_key: str, api_host: str = "shazam-core.p.rapidapi.com"):
        self.api_key = api_key
        self.api_host = api_host

    def recognize(
        self, audio_bytes: bytes, filename: str = "clip.raw"
    ) -> RecognitionResult | None:
        if not self.api_key:
            raise RuntimeError("RAPIDAPI_SHAZAM_KEY is required for Shazam recognition")

        # Shazam Core API expects base64 encoded raw PCM data (44100Hz, mono, signed 16-bit PCM little-endian)
        base64_data = base64.b64encode(audio_bytes).decode("utf-8")

        if "shazam-core" in self.api_host:
            url = f"https://{self.api_host}/v1/tracks/recognize"
        else:
            url = f"https://{self.api_host}/songs/v2/detect"

        request = urllib.request.Request(
            url,
            data=base64_data.encode("utf-8"),
            headers={
                "X-RapidAPI-Key": self.api_key,
                "X-RapidAPI-Host": self.api_host,
                "Content-Type": "text/plain",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # Try to read the error body
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                err_msg = err_json.get("message") or err_json.get("error") or str(e)
            except Exception:
                err_msg = str(e)
            raise RuntimeError(f"RapidAPI Shazam HTTP error {e.code}: {err_msg}")
        except Exception as e:
            raise RuntimeError(f"RapidAPI Shazam connection error: {e}")

        # Parse Shazam response
        # Sometimes if not found, it returns empty dict or has no track
        print(f"[SHAZAM] Raw response payload: {json.dumps(payload)}")
        track = payload.get("track")
        if not track:
            return None

        title = str(track.get("title") or "").strip()
        artist = str(track.get("subtitle") or "").strip()
        
        # Shazam doesn't have a direct album field in track root, but let's check sections or metadata
        album = None
        sections = track.get("sections") or []
        for sec in sections:
            if sec.get("type") == "SONG":
                metadata = sec.get("metadata") or []
                for meta in metadata:
                    if meta.get("title") == "Album":
                        album = str(meta.get("text") or "").strip()

        if not title or not artist:
            return None

        return RecognitionResult(
            title=title,
            artist=artist,
            album=album,
            provider="shazam",
            confidence=1.0,
            raw=payload,
        )
