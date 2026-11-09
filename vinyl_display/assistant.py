"""Conversa com o bot do Telegram e resumo semanal (v3.9).

Comandos (só respondem ao chat configurado em TELEGRAM_CHAT_ID):
    /tocando  o disco e a faixa que estão tocando
    /hoje     a escuta do dia (o disco de hoje na Escuta da Semana)
    /semana   a Escuta da Semana, com o que já foi ouvido
    /status   player, microfone, Shazam e último sync
    /ajuda    esta lista
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

_BRT = timezone(timedelta(hours=-3))
OFFSET_KEY = "telegram_update_offset"
WEEKLY_KEY = "weekly_summary_sent_week"
DAILY_KEY = "daily_pick_sent_day"
WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

HELP = (
    "Comandos do PlayVinil:\n"
    "/tocando — o que está tocando agora\n"
    "/hoje — a escuta de hoje\n"
    "/semana — a Escuta da Semana\n"
    "/status — player, microfone, Shazam e sync\n"
    "/ajuda — esta lista"
)


def _fmt_time(seconds: Any) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 60}:{seconds % 60:02d}"


def now_playing_text(app: Any) -> str:
    state = app.state()
    release, track = state.get("release"), state.get("track")
    if not release or not track:
        return "Nada tocando agora. 🎧"
    lines = [
        f"▶️ {track.get('position', '')} · {track.get('title', '')}",
        f"{release.get('artist', '')} — {release.get('title', '')}",
    ]
    if state.get("status") == "waiting_flip":
        lines.append(state.get("message") or "Esperando virar o disco.")
    else:
        lines.append(f"{_fmt_time(state.get('progress_seconds'))} de {_fmt_time(state.get('duration_seconds'))}")
        nxt = state.get("next_track")
        if nxt:
            lines.append(f"Próxima: {nxt.get('position', '')} · {nxt.get('title', '')}")
    return "\n".join(lines)


def week_text(app: Any) -> str:
    history = app.get_listening_history()
    current = next((week for week in history if week.get("is_current")), None)
    if not current:
        agenda = app.get_weekly_agenda()
        items = [f"• {r['artist']} — {r['title']}" for r in agenda]
        return "Escuta da Semana:\n" + "\n".join(items) if items else "Ainda não há Escuta da Semana."
    lines = [f"Escuta da Semana ({current['listened_count']} de {current['total']} ouvidos):"]
    for release in current["releases"]:
        mark = "✅" if release.get("listened") else "⬜"
        lines.append(f"{mark} {release.get('artist', '')} — {release.get('title', '')}")
    return "\n".join(lines)


def status_text(app: Any) -> str:
    lines = []
    player = app.player_status()
    if not player.get("seen"):
        lines.append("📱 Player: ainda sem sinal.")
    else:
        mic = {"running": "microfone ouvindo", "suspended": "microfone pausado", "none": "microfone desligado"}.get(
            player.get("audio"), f"microfone: {player.get('audio')}"
        )
        icon = "🟢" if player.get("online") else "🔴"
        lines.append(f"📱 {icon} Player visto há {player.get('seconds_ago', 0)} s · {mic} · versão {player.get('version') or '?'}")
    usage = app.shazam_usage()
    if usage and usage.get("keys"):
        keys = ", ".join(
            f"{k['key']} {k['calls']}/{k['limit']}{' (esgotada)' if k.get('exhausted') else ''}" for k in usage["keys"]
        )
        lines.append(f"🎵 Shazam em {usage['month']}: {keys} · hoje {usage.get('today', 0)}")
    last_sync = app.store.get_metadata("discogs_last_sync_at")
    if last_sync:
        when = datetime.fromtimestamp(float(last_sync), _BRT).strftime("%d/%m %H:%M")
        error = app.store.get_metadata("discogs_last_sync_error")
        lines.append(f"🔄 Último sync: {when}" + (f" (falhou: {error})" if error else ""))
    lines.append(f"💿 Coleção: {app.store.collection_count()} discos")
    return "\n".join(lines)


def weekly_summary_text(app: Any, now: float | None = None) -> str:
    """Resumo enviado no domingo: a semana que passou e a agenda nova."""
    now = now or time.time()
    history = app.get_listening_history()
    today = datetime.fromtimestamp(now, _BRT).date()
    days_since_sunday = (today.weekday() + 1) % 7
    this_week = today - timedelta(days=days_since_sunday)
    last_week_key = (this_week - timedelta(days=7)).strftime("%Y-%m-%d")
    last_week = next((week for week in history if week.get("week_key") == last_week_key), None)

    start = datetime.combine(this_week - timedelta(days=7), datetime.min.time(), _BRT)
    end = start + timedelta(days=7)
    listened = []
    for release in app.store.list_releases_with_stats():
        for date in release.listen_dates or []:
            try:
                when = datetime.fromisoformat(date.replace("Z", "+00:00"))
            except ValueError:
                continue
            if start <= when < end:
                listened.append(release)
    unique = {r.release_id: r for r in listened}

    lines = [f"📅 Resumo da semana ({start.strftime('%d/%m')} a {(end - timedelta(days=1)).strftime('%d/%m')})"]
    lines.append(f"Você ouviu {len(listened)} vez(es) {len(unique)} disco(s).")
    for release in list(unique.values())[:8]:
        lines.append(f"• {release.artist} — {release.title}")
    if len(unique) > 8:
        lines.append(f"… e mais {len(unique) - 8}")
    if last_week:
        lines.append(f"Escuta da Semana: {last_week['listened_count']} de {last_week['total']} ouvidos.")
    report = app.store.recognition_report(since=start.timestamp())
    lines.append(f"Shazam: {report['shazam_calls']} chamadas; {report['solved_locally']} trocas resolvidas sem Shazam.")
    lines.append("")
    lines.append(week_text(app).replace("Escuta da Semana", "Nova Escuta da Semana", 1))
    return "\n".join(lines)


def _send_after(app: Any) -> tuple[int, int]:
    """Hora das mensagens do dia: 5 min depois do fim do não perturbe (padrão 10:00)."""
    end = str(getattr(app.config, "alert_quiet_end", "") or "10:00") if getattr(app, "config", None) else "10:00"
    try:
        hour, minute = (int(x) for x in end.split(":", 1))
    except ValueError:
        hour, minute = 10, 0
    total = hour * 60 + minute + 5
    return (total // 60) % 24, total % 60


def daily_pick_text(app: Any, now: float | None = None) -> str:
    """v4.11: o disco do dia na Escuta da Semana (domingo = 1º da lista ... sábado = 7º)."""
    now = now or time.time()
    local = datetime.fromtimestamp(now, _BRT)
    index = (local.weekday() + 1) % 7  # dias desde domingo
    agenda = app.get_weekly_agenda()
    if len(agenda) <= index:
        return "Ainda não há Escuta da Semana para hoje."
    pick = agenda[index]
    header = f"🎧 Escuta de hoje · {WEEKDAYS[index]}, {local.strftime('%d/%m')}"
    title = f"{pick.get('artist', '')} — {pick.get('title', '')}"
    year = pick.get("original_year") or pick.get("year")
    if year:
        title += f" ({year})"
    lines = [header, title]

    dates = []
    for value in pick.get("listen_dates") or []:
        try:
            dates.append(datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(_BRT))
        except ValueError:
            continue
    plays = max(int(pick.get("auditions") or 0), len(dates))
    if not plays:
        lines.append("Você ainda não ouviu esse disco. 🆕")
    elif dates:
        last = max(dates)
        lines.append(f"Ouvido {plays} {'vez' if plays == 1 else 'vezes'} · a última em {last.strftime('%d/%m/%Y')}")
    else:
        lines.append(f"Ouvido {plays} {'vez' if plays == 1 else 'vezes'}")

    current = next((week for week in app.get_listening_history() if week.get("is_current")), None)
    if current:
        lines.append(f"Semana: {current['listened_count']} de {current['total']} ouvidos até agora.")
    return "\n".join(lines)


def maybe_send_daily_pick(app: Any, now: float | None = None) -> bool:
    """Todo dia depois do não perturbe, uma vez por dia (no domingo, depois do resumo da semana)."""
    now = now or time.time()
    local = datetime.fromtimestamp(now, _BRT)
    if (local.hour, local.minute) < _send_after(app):
        return False
    day_key = local.strftime("%Y-%m-%d")
    if app.store.get_metadata(DAILY_KEY) == day_key or not app.notifier.enabled:
        return False
    app.store.set_metadata(DAILY_KEY, day_key)
    return bool(app.notifier.send(daily_pick_text(app, now)))


def maybe_send_weekly_summary(app: Any, now: float | None = None) -> bool:
    """Domingo a partir das 10:05 (fim do não perturbe), uma vez por semana."""
    now = now or time.time()
    local = datetime.fromtimestamp(now, _BRT)
    if local.weekday() != 6 or (local.hour, local.minute) < (10, 5):
        return False
    week_key = local.strftime("%Y-%m-%d")
    if app.store.get_metadata(WEEKLY_KEY) == week_key or not app.notifier.enabled:
        return False
    app.store.set_metadata(WEEKLY_KEY, week_key)
    return bool(app.notifier.send(weekly_summary_text(app, now)))


class TelegramCommands:
    """Lê as mensagens mandadas ao bot (long polling) e responde aos comandos."""

    def __init__(self, app: Any, request_json: Callable[[str, float], dict[str, Any]] | None = None):
        self.app = app
        self.request_json = request_json or self._request_json

    @staticmethod
    def _request_json(url: str, timeout: float) -> dict[str, Any]:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8") or "{}")

    def answer(self, text: str) -> str:
        command = (text or "").strip().split()[0].split("@")[0].lower() if text and text.strip() else ""
        if command in ("/tocando", "/agora", "/now"):
            return now_playing_text(self.app)
        if command in ("/hoje", "/dia"):
            return daily_pick_text(self.app)
        if command in ("/semana", "/agenda"):
            return week_text(self.app)
        if command == "/status":
            return status_text(self.app)
        return HELP

    def poll_once(self, wait_seconds: int = 50) -> int:
        notifier = self.app.notifier
        token, chat_id = notifier.telegram_bot_token, notifier.telegram_chat_id
        if not token or not chat_id:
            return 0
        offset = self.app.store.get_metadata(OFFSET_KEY) or "0"
        query = urllib.parse.urlencode({"offset": offset, "timeout": wait_seconds, "allowed_updates": '["message"]'})
        payload = self.request_json(f"https://api.telegram.org/bot{token}/getUpdates?{query}", wait_seconds + 10)
        handled = 0
        for update in payload.get("result") or []:
            self.app.store.set_metadata(OFFSET_KEY, str(int(update["update_id"]) + 1))
            message = update.get("message") or {}
            if str((message.get("chat") or {}).get("id")) != str(chat_id):
                continue  # só responde a você
            notifier.reply_telegram(self.answer(message.get("text") or ""))
            handled += 1
        return handled

    def run_forever(self) -> None:
        while True:
            try:
                if not self.app.notifier.telegram_bot_token or not self.app.notifier.telegram_chat_id:
                    time.sleep(60)
                    continue
                self.poll_once()
            except Exception as error:
                message = str(error)
                token = self.app.notifier.telegram_bot_token
                print(f"[TELEGRAM] {message.replace(token, '***') if token else message}")
                time.sleep(30)
