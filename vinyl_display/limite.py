"""Limite de tentativas de senha (v4.9.0).

Depois de LIVRES erros seguidos do mesmo IP, o login e a recuperação ficam bloqueados para
esse IP por um tempo que dobra a cada novo erro (1 min, 2 min, 4 min... até 1 h). Um acerto
zera a conta. Fica só na memória: um restart do serviço libera todo mundo.
"""
from __future__ import annotations

import threading
import time

LIVRES = 5
BASE_S = 60
MAX_S = 3600
ESQUECE_S = 24 * 3600


class LimiteTentativas:
    def __init__(self) -> None:
        self._ips: dict[str, tuple[int, float, float]] = {}  # ip -> (erros, bloqueado_ate, ultimo_erro)
        self._trava = threading.Lock()

    def espera(self, ip: str, agora: float | None = None) -> int:
        """Segundos que faltam para esse IP poder tentar de novo (0 = pode)."""
        agora = time.time() if agora is None else agora
        with self._trava:
            erros, ate, _ = self._ips.get(ip, (0, 0.0, 0.0))
        return max(0, int(round(ate - agora)))

    def errou(self, ip: str, agora: float | None = None) -> None:
        agora = time.time() if agora is None else agora
        with self._trava:
            for outro, (_, _, ultimo) in list(self._ips.items()):
                if agora - ultimo > ESQUECE_S:
                    del self._ips[outro]
            erros, ate, _ = self._ips.get(ip, (0, 0.0, 0.0))
            erros += 1
            if erros >= LIVRES:
                ate = agora + min(MAX_S, BASE_S * 2 ** (erros - LIVRES))
            self._ips[ip] = (erros, ate, agora)

    def acertou(self, ip: str) -> None:
        with self._trava:
            self._ips.pop(ip, None)


def texto_espera(segundos: int) -> str:
    if segundos < 60:
        return f"{segundos} s"
    minutos = (segundos + 59) // 60
    return f"{minutos} min"
