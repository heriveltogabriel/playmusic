"""v4.13: menos chamadas ao Shazam no player.
- lado/disco novo: espera a música firmar e, depois de tentativa sem resultado, espera crescente;
- "pausa fora do previsto": uma conferência por lado, não por faixa."""
import unittest
from pathlib import Path

APP = (Path(__file__).resolve().parent.parent / "static" / "app.js").read_text(encoding="utf-8")


class ShazamMenosTests(unittest.TestCase):
    def test_lado_novo_nao_chama_na_hora(self):
        self.assertIn('requestNewSide("lado_novo")', APP)
        self.assertIn('requestNewSide("virada_sem_lado")', APP)
        self.assertNotIn('listenFor("lado_novo")', APP)
        self.assertIn("if (steadyRatio() < STEADY_MIN_RATIO) return;", APP)
        self.assertIn("checkPendingNewSide();", APP)

    def test_espera_crescente_depois_de_falha(self):
        self.assertIn("return Math.min(480000, 30000 * Math.pow(2, Math.max(0, failures - 1)));", APP)
        self.assertIn("newSideResult(reasonForServer, false);", APP)
        self.assertIn("newSideResult(reasonForServer, true);", APP)
        self.assertIn('if (reason === "fim_do_disco" && Date.now() < newSideBlockedUntil) return;', APP)

    def test_pausa_fora_uma_vez_por_lado(self):
        self.assertIn('const sideKey = `${release.release_id}|${String(track.position || "").replace(/[^A-Za-z]/g, "").toUpperCase()}`;', APP)
