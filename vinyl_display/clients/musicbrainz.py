from __future__ import annotations

import json
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

DEFAULT_USER_AGENT = "VinylDisplay/3.3 ( https://github.com/heriveltogabriel/playmusic )"
API_BASE = "https://musicbrainz.org/ws/2"


def _default_request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:  # ISRC/lançamento inexistente no MusicBrainz
            return {}
        raise


def _norm(value: str | None) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())


def _lucene_escape(value: str) -> str:
    special = '+-&|!(){}[]^"~*?:\\/'
    return "".join("\\" + ch if ch in special else ch for ch in value)


def _titles_match(left: str, right: str) -> bool:
    a, b = _norm(left), _norm(right)
    return bool(a and b and (a == b or a in b or b in a))


class MusicBrainzClient:
    """Cliente mínimo da API pública do MusicBrainz para obter durações de faixas.

    O MusicBrainz exige User-Agent identificável e no máximo 1 requisição por segundo.
    """

    def __init__(
        self,
        user_agent: str = DEFAULT_USER_AGENT,
        request_json: Callable[[str, dict[str, str]], dict[str, Any]] | None = None,
        min_interval_seconds: float = 1.1,
        sleep_func: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        max_retries: int = 2,
    ):
        self.user_agent = user_agent
        self.request_json = request_json or _default_request_json
        self.min_interval_seconds = min_interval_seconds
        self.sleep_func = sleep_func
        self.clock = clock
        self.max_retries = max_retries
        self._last_request_at: float | None = None

    def _get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        if self._last_request_at is not None:
            wait = self.min_interval_seconds - (self.clock() - self._last_request_at)
            if wait > 0:
                self.sleep_func(wait)
        params = {**params, "fmt": "json"}
        url = f"{API_BASE}/{path}?{urllib.parse.urlencode(params)}"
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        for attempt in range(self.max_retries + 1):
            try:
                return self.request_json(url, headers)
            except urllib.error.HTTPError as error:
                # 503 é a resposta do MusicBrainz quando excedemos o limite de requisições
                if error.code != 503 or attempt >= self.max_retries:
                    raise
                self.sleep_func(2.0 * (attempt + 1))
            finally:
                self._last_request_at = self.clock()
        return {}

    def recording_length_by_isrc(self, isrc: str) -> int | None:
        """Duração (segundos) da gravação identificada pelo ISRC, ou None."""
        isrc = (isrc or "").strip().upper()
        if not isrc:
            return None
        payload = self._get(f"isrc/{urllib.parse.quote(isrc)}", {})
        lengths = sorted(
            int(rec["length"]) for rec in payload.get("recordings") or [] if rec.get("length")
        )
        if not lengths:
            return None
        return round(lengths[len(lengths) // 2] / 1000)

    def recording_length_by_title(self, artist: str, title: str) -> int | None:
        """Duração (segundos) de uma música procurada por título e artista: mediana das
        gravações com o mesmo título. Ignora ao vivo, demo e remix quando o título pedido
        não é dessas versões. Usado quando o disco inteiro não bate com nenhum lançamento."""
        wanted = _norm(title)
        if not wanted or not artist:
            return None
        query = f'recording:"{_lucene_escape(title)}" AND artist:"{_lucene_escape(artist)}"'
        payload = self._get("recording", {"query": query, "limit": "25"})
        skip = [w for w in ("live", "demo", "remix", "ao vivo", "instrumental") if w not in wanted]
        lengths = []
        for rec in payload.get("recordings") or []:
            if int(rec.get("score", 0)) < 90 or not rec.get("length"):
                continue
            got = _norm(rec.get("title"))
            disambiguation = _norm(rec.get("disambiguation"))
            if got != wanted or any(w in disambiguation or w in got for w in skip):
                continue
            lengths.append(int(rec["length"]))
        if len(lengths) < 2:
            return None  # uma gravação só é pouco para confiar
        lengths.sort()
        return round(lengths[len(lengths) // 2] / 1000)

    def release_tracklist(
        self, artist: str, title: str, track_titles: list[str]
    ) -> list[dict[str, Any]] | None:
        """Procura um lançamento com a mesma lista de faixas e devolve
        [{"number": "A1", "title": ..., "length": segundos | None}, ...] na mesma ordem.

        Dá preferência a edições em vinil. Retorna None se nenhum lançamento bater.
        """
        query = f'release:"{_lucene_escape(title)}" AND artist:"{_lucene_escape(artist)}"'
        search = self._get("release", {"query": query, "limit": "25"})

        candidates = []
        for rel in search.get("releases") or []:
            if int(rel.get("score", 0)) < 80:
                continue
            if int(rel.get("track-count") or 0) != len(track_titles):
                continue
            is_vinyl = any("vinyl" in _norm(m.get("format")) for m in rel.get("media") or [])
            candidates.append((0 if is_vinyl else 1, -int(rel.get("score", 0)), rel["id"]))
        candidates.sort()

        for _, _, release_id in candidates[:4]:
            detail = self._get(f"release/{release_id}", {"inc": "recordings"})
            tracks = []
            for medium in detail.get("media") or []:
                for track in medium.get("tracks") or []:
                    length = track.get("length") or (track.get("recording") or {}).get("length")
                    tracks.append(
                        {
                            "number": str(track.get("number") or ""),
                            "title": str(track.get("title") or ""),
                            "length": round(int(length) / 1000) if length else None,
                        }
                    )
            if len(tracks) != len(track_titles):
                continue
            # Exige que pelo menos 80% dos títulos batam, na mesma ordem
            same = sum(1 for want, got in zip(track_titles, tracks) if _titles_match(want, got["title"]))
            if same >= max(1, round(len(track_titles) * 0.8)):
                return tracks
        return None
