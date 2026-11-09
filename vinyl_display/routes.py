"""Quem pode chamar cada rota da API (v4.0).

Toda a regra de acesso fica declarada aqui, num só lugar, em vez de espalhada
pelos `if` do servidor. Rota da API que não estiver na tabela é tratada como
admin: esquecer de declarar uma rota nova a deixa fechada, nunca aberta.

Níveis:
    public  qualquer um (player, Ouvir, Agenda, login)
    device  player autorizado (quando "Exigir aparelho autorizado" está ligado)
    admin   sessão do admin
"""
from __future__ import annotations

import re

PUBLIC, DEVICE, ADMIN = "public", "device", "admin"

# (método, padrão do caminho, nível). O primeiro que casar vale.
ROUTES: list[tuple[str, str, str]] = [
    ("GET", r"/api/health", PUBLIC),
    ("GET", r"/api/state", PUBLIC),
    ("GET", r"/api/search", PUBLIC),
    ("GET", r"/api/ouvir/releases", PUBLIC),
    ("GET", r"/api/ouvir/agenda", PUBLIC),
    ("GET", r"/api/ouvir/history", PUBLIC),
    ("GET", r"/api/ouvir/sides/\d+", PUBLIC),
    ("GET", r"/api/config", ADMIN),
    ("GET", r"/api/admin/.*", ADMIN),
    ("POST", r"/api/auth/(login|setup|recover|logout)", PUBLIC),
    ("POST", r"/api/auth/change_password", ADMIN),
    ("POST", r"/api/player/heartbeat", PUBLIC),
    ("POST", r"/api/recognize", DEVICE),
    ("POST", r"/api/playback/[a-z_]+", DEVICE),
    ("POST", r"/api/ouvir/releases/\d+/(listen|unlisten)", DEVICE),
    ("POST", r"/api/sync", ADMIN),
    ("POST", r"/api/config", ADMIN),
    ("POST", r"/api/admin/.*", ADMIN),
]

# Site fechado (v4.9.0, SITE_FECHADO=1): tudo exige login, inclusive as páginas. Só ficam
# abertos o login e o que a tela de login precisa; o player e a gravação também abrem nos
# aparelhos autorizados, sem senha. O que não estiver aqui é admin (login).
CLOSED_ROUTES: list[tuple[str, str, str]] = [
    ("GET", r"/login", PUBLIC),
    ("GET", r"/static/.+", PUBLIC),
    ("GET", r"/(favicon\.ico|apple-touch-icon(-precomposed)?\.png)", PUBLIC),
    ("GET", r"/api/health", PUBLIC),
    ("POST", r"/api/auth/(login|setup|recover|logout)", PUBLIC),
    # player (/vinyl/) e modo gravação, e o que eles chamam
    ("GET", r"/", DEVICE),
    ("GET", r"/gravar", DEVICE),
    ("GET", r"/api/state", DEVICE),
    ("GET", r"/api/search", DEVICE),
    ("GET", r"/api/ouvir/releases", DEVICE),
    ("GET", r"/api/ouvir/agenda", DEVICE),
    ("GET", r"/api/ouvir/sides/\d+", DEVICE),
    ("POST", r"/api/player/heartbeat", DEVICE),
    ("POST", r"/api/recognize", DEVICE),
    ("POST", r"/api/playback/[a-z_]+", DEVICE),
    ("POST", r"/api/ouvir/releases/\d+/(listen|unlisten)", DEVICE),
]

_COMPILED = [(method, re.compile(pattern + r"/?"), level) for method, pattern, level in ROUTES]
_CLOSED = [(method, re.compile(pattern + r"/?"), level) for method, pattern, level in CLOSED_ROUTES]


def access_for(method: str, path: str, fechado: bool = False) -> str:
    """Nível exigido para `method path`. Com o site aberto, fora de /api/ (páginas e /static)
    é público e a própria página do admin decide se mostra o login. Com o site fechado, vale
    a tabela CLOSED_ROUTES e todo o resto exige login."""
    if fechado:
        for route_method, pattern, level in _CLOSED:
            if route_method == method and pattern.fullmatch(path):
                return level
        return ADMIN
    if not path.startswith("/api/"):
        return PUBLIC
    for route_method, pattern, level in _COMPILED:
        if route_method == method and pattern.fullmatch(path):
            return level
    return ADMIN
