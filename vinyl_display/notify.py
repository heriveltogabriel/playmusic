"""Alertas do PlayVinil por Telegram e/ou ntfy.

Configuração (.env ou Configurações do admin):
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   -> mensagem no Telegram
    NTFY_TOPIC (e NTFY_SERVER, padrão https://ntfy.sh) -> notificação no app ntfy

Uso em scripts (ex.: backup):
    python3.9 -m vinyl_display.notify --key backup_failed --cooldown 72000 "Backup falhou"
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, Callable

from datetime import datetime, timedelta, timezone

ALERTS_METADATA_KEY = "alerts_state"
_BRT = timezone(timedelta(hours=-3))


def _minutes(value: str | None) -> int | None:
    try:
        hours, minutes = str(value or "").strip().split(":")
        return int(hours) * 60 + int(minutes)
    except ValueError:
        return None


def in_quiet_hours(now: float, start: str | None, end: str | None) -> bool:
    """Horário de silêncio (Brasília). Aceita faixas que passam da meia-noite (23:00-08:00).
    Vazio ou inválido = sem horário de silêncio."""
    start_m, end_m = _minutes(start), _minutes(end)
    if start_m is None or end_m is None or start_m == end_m:
        return False
    local = datetime.fromtimestamp(now, _BRT)
    current = local.hour * 60 + local.minute
    if start_m < end_m:
        return start_m <= current < end_m
    return current >= start_m or current < end_m
PREFIX = "🎵 PlayVinil"


def _default_post(url: str, data: bytes, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8") or "{}"
    try:
        return json.loads(body)
    except ValueError:
        return {}


def _default_get(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


class Notifier:
    def __init__(
        self,
        telegram_bot_token: str = "",
        telegram_chat_id: str = "",
        ntfy_topic: str = "",
        ntfy_server: str = "https://ntfy.sh",
        post: Callable[[str, bytes, dict[str, str]], dict[str, Any]] | None = None,
        get: Callable[[str], dict[str, Any]] | None = None,
    ):
        self.telegram_bot_token = (telegram_bot_token or "").strip()
        self.telegram_chat_id = str(telegram_chat_id or "").strip()
        self.ntfy_topic = (ntfy_topic or "").strip()
        self.ntfy_server = (ntfy_server or "https://ntfy.sh").rstrip("/")
        self.post = post or _default_post
        self.get = get or _default_get

    @classmethod
    def from_config(cls, config: Any) -> "Notifier":
        return cls(
            getattr(config, "telegram_bot_token", ""),
            getattr(config, "telegram_chat_id", ""),
            getattr(config, "ntfy_topic", ""),
            getattr(config, "ntfy_server", "https://ntfy.sh"),
        )

    @property
    def channels(self) -> list[str]:
        channels = []
        if self.telegram_bot_token and self.telegram_chat_id:
            channels.append("telegram")
        if self.ntfy_topic:
            channels.append("ntfy")
        return channels

    @property
    def enabled(self) -> bool:
        return bool(self.channels)

    def reply_telegram(self, text: str) -> bool:
        """Resposta a um comando do bot: só no Telegram e sem o cabeçalho dos alertas."""
        if "telegram" not in self.channels:
            return False
        url = f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage"
        payload = json.dumps({"chat_id": self.telegram_chat_id, "text": text}).encode("utf-8")
        return bool(self.post(url, payload, {"Content-Type": "application/json"}).get("ok", True))

    def send(self, text: str, title: str = PREFIX, silent: bool = False) -> list[str]:
        """Envia por todos os canais configurados. Devolve os canais que funcionaram.
        silent=True: chega sem som (Telegram disable_notification, ntfy prioridade baixa)."""
        sent = []
        if "telegram" in self.channels:
            try:
                url = f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage"
                payload = json.dumps(
                    {"chat_id": self.telegram_chat_id, "text": f"{title}\n{text}", "disable_notification": silent}
                ).encode("utf-8")
                result = self.post(url, payload, {"Content-Type": "application/json"})
                if result.get("ok", True):
                    sent.append("telegram")
                else:
                    print(f"[ALERT] Telegram refused message: {result.get('description')}")
            except Exception as error:
                print(f"[ALERT] Telegram failed: {error}")
        if "ntfy" in self.channels:
            try:
                url = f"{self.ntfy_server}/{urllib.parse.quote(self.ntfy_topic)}"
                headers = {
                    "Title": title.encode("ascii", "ignore").decode().strip() or "PlayVinil",
                    "Tags": "musical_note",
                    "Priority": "2" if silent else "3",
                }
                self.post(url, text.encode("utf-8"), headers)
                sent.append("ntfy")
            except Exception as error:
                print(f"[ALERT] ntfy failed: {error}")
        return sent

    def telegram_chats(self) -> list[dict[str, Any]]:
        """Conversas que mandaram mensagem ao bot (para descobrir o chat id depois do /start)."""
        if not self.telegram_bot_token:
            return []
        payload = self.get(f"https://api.telegram.org/bot{self.telegram_bot_token}/getUpdates")
        chats: dict[str, dict[str, Any]] = {}
        for update in payload.get("result") or []:
            message = update.get("message") or update.get("my_chat_member") or {}
            chat = message.get("chat") or {}
            if chat.get("id") is None:
                continue
            name = chat.get("title") or " ".join(
                part for part in (chat.get("first_name"), chat.get("last_name")) if part
            ) or chat.get("username") or str(chat["id"])
            chats[str(chat["id"])] = {"id": str(chat["id"]), "name": name, "username": chat.get("username") or ""}
        return list(chats.values())


class AlertManager:
    """Evita repetir o mesmo alerta: cada chave tem um intervalo mínimo entre envios."""

    def __init__(
        self,
        store: Any,
        notifier: Notifier,
        clock: Callable[[], float] = time.time,
        quiet_start: str | None = None,
        quiet_end: str | None = None,
    ):
        self.store = store
        self.notifier = notifier
        self.clock = clock
        self.quiet_start = quiet_start
        self.quiet_end = quiet_end

    @classmethod
    def from_config(cls, store: Any, config: Any, notifier: "Notifier | None" = None) -> "AlertManager":
        return cls(
            store,
            notifier or Notifier.from_config(config),
            quiet_start=getattr(config, "alert_quiet_start", None),
            quiet_end=getattr(config, "alert_quiet_end", None),
        )

    def quiet_now(self) -> bool:
        return in_quiet_hours(self.clock(), self.quiet_start, self.quiet_end)

    def _state(self) -> dict[str, Any]:
        raw = self.store.get_metadata(ALERTS_METADATA_KEY) if self.store else None
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            return {}

    def _save(self, state: dict[str, Any]) -> None:
        if self.store:
            self.store.set_metadata(ALERTS_METADATA_KEY, json.dumps(state, sort_keys=True))

    def is_active(self, key: str) -> bool:
        return bool(self._state().get(key, {}).get("active"))

    def raise_alert(
        self, key: str, text: str, cooldown: float = 6 * 3600, hold_in_quiet_hours: bool = False
    ) -> bool:
        """Envia o alerta se ainda não foi enviado dentro do intervalo. Marca como ativo.

        No horário de silêncio: com hold_in_quiet_hours o alerta espera (nada é enviado nem
        marcado, e ele sai quando o silêncio acabar se o problema continuar); sem, chega sem som."""
        state = self._state()
        entry = state.get(key) or {}
        now = self.clock()
        if entry.get("active") and now - float(entry.get("sent_at", 0)) < cooldown:
            return False
        if not self.notifier.enabled:
            # Sem Telegram/ntfy configurado: só registra no log, sem marcar como avisado,
            # para não bloquear o aviso real depois que você configurar um canal.
            print(f"[ALERT] {key} (sem canal configurado): {text}")
            return False
        quiet = self.quiet_now()
        if quiet and hold_in_quiet_hours:
            return False
        sent = self.notifier.send(text, silent=quiet) if self.notifier.enabled else []
        state[key] = {"active": True, "sent_at": now, "channels": sent}
        self._save(state)
        print(f"[ALERT] {key}: {text} -> {sent or 'nenhum canal configurado'}")
        return bool(sent)

    def resolve(self, key: str, text: str | None = None) -> bool:
        """Marca o alerta como resolvido; se ele tinha sido avisado, avisa que voltou ao normal."""
        state = self._state()
        entry = state.get(key) or {}
        if not entry.get("active"):
            return False
        state[key] = {"active": False, "resolved_at": self.clock()}
        self._save(state)
        if text and entry.get("channels") and self.notifier.enabled:
            self.notifier.send(text, silent=self.quiet_now())
        return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Envia um alerta do PlayVinil (Telegram/ntfy).")
    parser.add_argument("message")
    parser.add_argument("--key", help="chave para não repetir o mesmo alerta")
    parser.add_argument("--cooldown", type=float, default=6 * 3600)
    args = parser.parse_args(argv)

    from vinyl_display.catalog import CatalogStore
    from vinyl_display.config import load_config

    config = load_config()
    notifier = Notifier.from_config(config)
    if not notifier.enabled:
        print("Nenhum canal de alerta configurado (TELEGRAM_* ou NTFY_TOPIC).")
        return 1
    if args.key:
        store = CatalogStore(config.database_path)
        store.initialize()
        AlertManager.from_config(store, config, notifier).raise_alert(args.key, args.message, cooldown=args.cooldown)
        return 0
    quiet = in_quiet_hours(time.time(), config.alert_quiet_start, config.alert_quiet_end)
    return 0 if notifier.send(args.message, silent=quiet) else 1


if __name__ == "__main__":
    sys.exit(main())
