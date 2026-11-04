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

_COMPILED = [(method, re.compile(pattern + r"/?"), level) for method, pattern, level in ROUTES]


def access_for(method: str, path: str) -> str:
    """Nível exigido para `method path`. Fora de /api/ (páginas e /static) é público;
    a própria página do admin decide se mostra o login."""
    if not path.startswith("/api/"):
        return PUBLIC
    for route_method, pattern, level in _COMPILED:
        if route_method == method and pattern.fullmatch(path):
            return level
    return ADMIN
