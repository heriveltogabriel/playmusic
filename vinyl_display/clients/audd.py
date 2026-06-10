from __future__ import annotations

import json
import mimetypes
import urllib.request
import uuid
from typing import Any

from vinyl_display.models import RecognitionResult


def parse_audd_response(payload: dict[str, Any]) -> RecognitionResult | None:
    result = payload.get("result")
    if not isinstance(result, dict):
        return None

    title = str(result.get("title") or "").strip()
    artist = str(result.get("artist") or "").strip()
    album = str(result.get("album") or "").strip() or None
    if not title or not artist:
        return None

    score = result.get("score")
    confidence = None
    if isinstance(score, (int, float)):
        confidence = float(score) / 100 if score > 1 else float(score)

    return RecognitionResult(
        title=title,
        artist=artist,
        album=album,
        provider="audd",
        confidence=confidence,
        raw=payload,
    )


def _multipart_body(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    content_type: str,
    data: bytes,
) -> tuple[bytes, str]:
    boundary = f"----vinyl-display-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(value.encode())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(
        (
            f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
    )
    chunks.append(data)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


class AudDClient:
    def __init__(self, api_token: str, api_url: str = "https://api.audd.io/"):
        self.api_token = api_token
        self.api_url = api_url

    def recognize(
        self, audio_bytes: bytes, filename: str = "clip.webm"
    ) -> RecognitionResult | None:
        if not self.api_token:
            raise RuntimeError("AUDD_API_TOKEN is required for recognition")

        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        body, request_content_type = _multipart_body(
            fields={"api_token": self.api_token, "return": "apple_music,spotify"},
            file_field="file",
            filename=filename,
            content_type=content_type,
            data=audio_bytes,
        )
        request = urllib.request.Request(
            self.api_url,
            data=body,
            headers={"Content-Type": request_content_type},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("status") == "error":
            error_info = payload.get("error", {})
            error_msg = error_info.get("error_message", "Unknown AudD error")
            error_code = error_info.get("error_code", "Unknown code")
            raise RuntimeError(f"AudD API error {error_code}: {error_msg}")
        return parse_audd_response(payload)

