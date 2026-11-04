/*
 * Detector de silêncio do PlayVinil (v3.5).
 *
 * Recebe o volume (RMS) do microfone a cada ~250 ms e avisa quando o som VOLTA depois de
 * uma pausa, dizendo quanto tempo durou a pausa. Com isso o player:
 *   - confirma a troca de faixa (pausa curta, 1-4 s) sem chamar o Shazam;
 *   - percebe a virada de lado (pausa longa + agulha) sem chamar o Shazam.
 *
 * O limiar se adapta ao volume da música que está tocando: "silêncio" é ficar bem abaixo
 * do nível recente da música, e não um valor fixo — o chiado do vinil e o volume da sala
 * mudam de disco para disco.
 */
(function (root) {
  "use strict";

  const DEFAULTS = {
    floor: 0.004,          // abaixo disso é silêncio sempre
    gapRatio: 0.25,        // silêncio = abaixo de 25% do nível da música
    resumeRatio: 0.45,     // som voltou = acima de 45% do nível da música
    minGapMs: 900,         // pausa mais curta que conta
    resumeSustainMs: 1500, // som precisa durar isso para valer (ignora estalos da agulha)
    onsetOverSilence: 2.5, // v3.6: início = som 2,5x acima do silêncio medido na pausa (pega intros suaves)
    levelAlpha: 0.03,      // velocidade com que o nível da música se adapta
    initialLevel: 0.05,
  };

  class SilenceDetector {
    constructor(options) {
      this.opts = Object.assign({}, DEFAULTS, options || {});
      this.level = this.opts.initialLevel;
      this.state = "sound";      // "sound" | "gap"
      this.quietSince = null;    // início do silêncio candidato
      this.gapStartedAt = null;  // início do silêncio confirmado
      this.loudSince = null;     // início do som candidato (dentro de uma pausa)
      this.lastRms = 0;
      this.silenceSum = 0;       // nível médio do silêncio durante a pausa atual
      this.silenceCount = 0;
    }

    thresholds() {
      return {
        quiet: Math.max(this.opts.floor, this.level * this.opts.gapRatio),
        loud: Math.max(this.opts.floor * 2, this.level * this.opts.resumeRatio),
      };
    }

    /** Alimenta uma amostra. Devolve {type:'resume', gapMs, resumedAt} quando o som volta. */
    push(rms, nowMs) {
      this.lastRms = rms;
      const { quiet, loud } = this.thresholds();

      if (this.state === "sound") {
        if (rms >= loud) {
          // só música atualiza o nível de referência
          this.level += (rms - this.level) * this.opts.levelAlpha;
        }
        if (rms < quiet) {
          if (this.quietSince === null) this.quietSince = nowMs;
          if (nowMs - this.quietSince >= this.opts.minGapMs) {
            this.state = "gap";
            this.gapStartedAt = this.quietSince;
            this.loudSince = null;
            this.silenceSum = rms;
            this.silenceCount = 1;
          }
        } else {
          this.quietSince = null;
        }
        return null;
      }

      // state === "gap"
      // O som "voltou" quando sobe bem acima do silêncio medido nesta pausa — e não só quando
      // chega perto do volume da música anterior. Assim uma introdução suave (piano, violão)
      // marca o início certo da faixa em vez de esperar a parte alta, 20 s depois.
      const onset = this.onsetThreshold(loud);
      if (rms >= onset) {
        if (this.loudSince === null) {
          this.loudSince = nowMs;
          this.onsetSum = 0;
          this.onsetCount = 0;
        }
        this.onsetSum += rms;
        this.onsetCount += 1;
        if (nowMs - this.loudSince >= this.opts.resumeSustainMs) {
          const event = {
            type: "resume",
            gapMs: this.loudSince - this.gapStartedAt,
            resumedAt: this.loudSince,
          };
          // A referência passa a ser o volume deste começo (uma intro suave não pode virar
          // "silêncio" de novo); depois ela sobe sozinha conforme a música cresce.
          this.level = Math.max(this.opts.floor * 2, this.onsetSum / this.onsetCount);
          this.state = "sound";
          this.quietSince = null;
          this.gapStartedAt = null;
          this.loudSince = null;
          return event;
        }
      } else {
        this.loudSince = null;
        this.silenceSum += rms;
        this.silenceCount += 1;
      }
      return null;
    }

    /** Limiar de "som voltou" durante uma pausa. */
    onsetThreshold(loud) {
      const silence = this.silenceCount ? this.silenceSum / this.silenceCount : this.opts.floor;
      const overSilence = Math.max(this.opts.floor * 2, silence * this.opts.onsetOverSilence);
      return Math.min(loud, overSilence);
    }

    /** Duração do silêncio atual (0 se está tocando). */
    currentGapMs(nowMs) {
      return this.state === "gap" && this.gapStartedAt !== null ? nowMs - this.gapStartedAt : 0;
    }

    reset() {
      this.state = "sound";
      this.quietSince = null;
      this.gapStartedAt = null;
      this.loudSince = null;
      this.silenceSum = 0;
      this.silenceCount = 0;
    }
  }

  /**
   * Decide o que fazer quando o som volta, a partir do último estado do servidor.
   * Devolve "boundary" (alinhar faixa), "flip" (próximo lado), "recognize" (chamar Shazam)
   * ou "ignore".
   */
  function decideOnResume(event, state, opts) {
    const o = Object.assign({ longGapMs: 6000, flipGapMs: 2500, nearSideEndSeconds: 75 }, opts || {});
    if (!state || !state.release) return "ignore";
    if (state.status === "waiting_flip") {
      if (event.gapMs < o.flipGapMs) return "ignore";
      return state.next_track ? "flip" : "recognize"; // fim do disco + som = outro disco
    }
    if (state.status !== "playing") return "ignore";
    if (event.gapMs >= o.longGapMs) {
      const sideLeft = typeof state.side_remaining_seconds === "number" ? state.side_remaining_seconds : Infinity;
      return sideLeft <= o.nearSideEndSeconds ? "flip" : "recognize";
    }
    return "boundary";
  }

  const api = { SilenceDetector, decideOnResume, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.VinylSilence = api;
  }
})(typeof window !== "undefined" ? window : this);
