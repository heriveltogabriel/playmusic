from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from vinyl_display.models import RecognitionResult

_BRT = timezone(timedelta(hours=-3))
USAGE_METADATA_KEY = "shazam_usage"
DEFAULT_MONTHLY_LIMIT = 500


class ShazamBudgetExceeded(RuntimeError):
    """O orçamento diário de chamadas foi atingido (proteção contra gasto acidental)."""


class ShazamQuotaExhausted(RuntimeError):
    """Todas as chaves configuradas atingiram a cota mensal."""


def parse_api_keys(value: str | list[str] | None) -> list[str]:
    """Aceita uma chave ou várias separadas por vírgula, ponto e vírgula, espaço ou quebra de linha."""
    if isinstance(value, (list, tuple)):
        items = list(value)
    else:
        items = re.split(r"[,;\s]+", value or "")
    keys: list[str] = []
    for item in items:
        item = item.strip()
        if item and item not in keys:
            keys.append(item)
    return keys


def key_label(key: str) -> str:
    """Identificação segura da chave para logs e admin: só os 4 últimos caracteres."""
    return f"…{key[-4:]}" if key else "?"


def _is_quota_error(code: int, message: str) -> bool:
    text = message.lower()
    return code == 429 and ("quota" in text or "monthly" in text or "exceeded" in text)


class ShazamUsage:
    """Contador de chamadas do Shazam guardado em sync_metadata (JSON).

    Formato: {"month": "2026-11", "keys": {"…ab12": {"calls": 3, "exhausted": false}},
              "days": {"2026-11-04": 3}, "history": {"2026-10": 812}}
    O mês e o dia seguem o horário de Brasília, como o resto do app.
    """

    def __init__(self, store: Any, clock: Callable[[], datetime] | None = None):
        self.store = store
        self.clock = clock or (lambda: datetime.now(_BRT))

    def _today(self) -> str:
        return self.clock().strftime("%Y-%m-%d")

    def _month(self) -> str:
        return self.clock().strftime("%Y-%m")

    def _load(self) -> dict[str, Any]:
        raw = self.store.get_metadata(USAGE_METADATA_KEY) if self.store else None
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            data = {}
        month = self._month()
        if data.get("month") != month:
            # Virou o mês: guarda o total do mês anterior e zera contadores e cotas
            history = data.get("history") or {}
            if data.get("month"):
                history[data["month"]] = sum(k.get("calls", 0) for k in (data.get("keys") or {}).values())
            data = {"month": month, "keys": {}, "days": {}, "history": dict(sorted(history.items())[-12:])}
        data.setdefault("keys", {})
        data.setdefault("days", {})
        data.setdefault("history", {})
        return data

    def _save(self, data: dict[str, Any]) -> None:
        if self.store:
            self.store.set_metadata(USAGE_METADATA_KEY, json.dumps(data, sort_keys=True))

    def record_call(self, key: str) -> None:
        data = self._load()
        entry = data["keys"].setdefault(key_label(key), {"calls": 0, "exhausted": False})
        entry["calls"] = int(entry.get("calls", 0)) + 1
        today = self._today()
        data["days"][today] = int(data["days"].get(today, 0)) + 1
        data["days"] = dict(sorted(data["days"].items())[-40:])
        self._save(data)

    def mark_exhausted(self, key: str) -> None:
        data = self._load()
        entry = data["keys"].setdefault(key_label(key), {"calls": 0, "exhausted": False})
        entry["exhausted"] = True
        self._save(data)

    def is_exhausted(self, key: str) -> bool:
        return bool(self._load()["keys"].get(key_label(key), {}).get("exhausted"))

    def calls_today(self) -> int:
        return int(self._load()["days"].get(self._today(), 0))

    def summary(self, keys: list[str], monthly_limit: int, daily_budget: int) -> dict[str, Any]:
        data = self._load()
        rows = []
        for key in keys:
            entry = data["keys"].get(key_label(key), {})
            rows.append(
                {
                    "key": key_label(key),
                    "calls": int(entry.get("calls", 0)),
                    "limit": monthly_limit,
                    "exhausted": bool(entry.get("exhausted")),
                }
            )
        return {
            "month": data["month"],
            "keys": rows,
            "month_total": sum(r["calls"] for r in rows),
            "today": int(data["days"].get(self._today(), 0)),
            "daily_budget": daily_budget,
            "history": data["history"],
        }


class ShazamClient:
    def __init__(
        self,
        api_key: str | list[str] = "",
        api_host: str = "shazam-core.p.rapidapi.com",
        usage: ShazamUsage | None = None,
        daily_budget: int = 0,
        monthly_limit: int = DEFAULT_MONTHLY_LIMIT,
    ):
        self.api_keys = parse_api_keys(api_key)
        self.api_host = api_host
        self.usage = usage
        self.daily_budget = int(daily_budget or 0)
        self.monthly_limit = int(monthly_limit or DEFAULT_MONTHLY_LIMIT)
        self.last_key_label: str | None = None

    # Compatibilidade com código que lia uma única chave
    @property
    def api_key(self) -> str:
        return self.api_keys[0] if self.api_keys else ""

    def usage_summary(self) -> dict[str, Any] | None:
        if not self.usage:
            return None
        return self.usage.summary(self.api_keys, self.monthly_limit, self.daily_budget)

    def _available_keys(self) -> list[str]:
        if not self.usage:
            return list(self.api_keys)
        return [k for k in self.api_keys if not self.usage.is_exhausted(k)]

    def recognize(
        self, audio_bytes: bytes, filename: str = "clip.raw"
    ) -> RecognitionResult | None:
        if not self.api_keys:
            raise RuntimeError("RAPIDAPI_SHAZAM_KEY is required for Shazam recognition")
        if self.usage and self.daily_budget and self.usage.calls_today() >= self.daily_budget:
            raise ShazamBudgetExceeded(
                f"Orçamento diário de {self.daily_budget} chamadas ao Shazam atingido"
            )

        self.last_key_label = None
        keys = self._available_keys()
        if not keys:
            raise ShazamQuotaExhausted("Todas as chaves do Shazam atingiram a cota mensal")

        # Shazam Core API expects base64 encoded raw PCM data (44100Hz, mono, signed 16-bit PCM little-endian)
        base64_data = base64.b64encode(audio_bytes).decode("utf-8")

        last_quota_error: Exception | None = None
        for key in keys:
            try:
                payload = self._request_with_host_fallback(key, base64_data)
            except ShazamQuotaExhausted as error:
                last_quota_error = error
                print(f"[SHAZAM] Key {key_label(key)} reached its monthly quota; trying next key.")
                if self.usage:
                    self.usage.mark_exhausted(key)
                continue
            if self.usage:
                self.usage.record_call(key)
            self.last_key_label = key_label(key)
            return self._parse(payload)

        raise ShazamQuotaExhausted(
            "Todas as chaves do Shazam atingiram a cota mensal"
        ) from last_quota_error

    def _request_with_host_fallback(self, key: str, base64_data: str) -> dict[str, Any]:
        hosts_to_try = [self.api_host]
        alternative_host = (
            "shazam.p.rapidapi.com" if "shazam-core" in self.api_host else "shazam-core.p.rapidapi.com"
        )
        hosts_to_try.append(alternative_host)

        last_error: Exception | None = None
        for host in hosts_to_try:
            if "shazam-core" in host:
                url = f"https://{host}/v1/tracks/recognize"
            else:
                url = f"https://{host}/songs/v2/detect"

            request = urllib.request.Request(
                url,
                data=base64_data.encode("utf-8"),
                headers={
                    "X-RapidAPI-Key": key,
                    "X-RapidAPI-Host": host,
                    "Content-Type": "text/plain",
                },
                method="POST",
            )

            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if host != self.api_host:
                    print(f"[SHAZAM] Host auto-switched to {host} because it was successful.")
                    self.api_host = host
                return payload
            except urllib.error.HTTPError as e:
                try:
                    err_body = e.read().decode("utf-8")
                    err_json = json.loads(err_body)
                    err_msg = err_json.get("message") or err_json.get("error") or str(e)
                except Exception:
                    err_msg = str(e)

                if _is_quota_error(e.code, err_msg):
                    raise ShazamQuotaExhausted(f"RapidAPI Shazam HTTP error {e.code}: {err_msg}")
                # If this host returns 403 (not subscribed), try the other host
                if e.code == 403 and "not subscribed" in err_msg.lower():
                    last_error = RuntimeError(f"RapidAPI Shazam HTTP error {e.code}: {err_msg}")
                    print(f"[SHAZAM] Host {host} returned 403 (not subscribed). Trying alternative {alternative_host}...")
                    continue
                raise RuntimeError(f"RapidAPI Shazam HTTP error {e.code}: {err_msg}")
            except Exception as e:
                raise RuntimeError(f"RapidAPI Shazam connection error: {e}")

        if last_error:
            raise last_error
        raise RuntimeError("Failed to recognize audio with all hosts.")

    @staticmethod
    def _parse(payload: dict[str, Any]) -> RecognitionResult | None:
        print(f"[SHAZAM] Raw response payload: {json.dumps(payload)}")
        track = payload.get("track")
        if not track:
            return None

        title = str(track.get("title") or "").strip()
        artist = str(track.get("subtitle") or "").strip()

        album = None
        for sec in track.get("sections") or []:
            if sec.get("type") == "SONG":
                for meta in sec.get("metadata") or []:
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
