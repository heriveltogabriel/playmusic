const elements = {
  albumCover: document.querySelector("#album-cover"),
  coverInitials: document.querySelector("#cover-initials"),
  statusLabel: document.querySelector("#status-label"),
  trackTitle: document.querySelector("#track-title"),
  artistName: document.querySelector("#artist-name"),
  albumLine: document.querySelector("#album-line"),
  prevButton: document.querySelector("#prev-button"),
  stopButton: document.querySelector("#stop-button"),
  nextButton: document.querySelector("#next-button"),
  nextTrack: document.querySelector("#next-track"),
  nextTrackTitle: document.querySelector("#next-track-title"),
  syncButton: document.querySelector("#sync-button"),
  retryButton: document.querySelector("#retry-button"),
  vinylWrapper: document.querySelector(".vinyl-wrapper"),
  vinylLabel: document.querySelector(".vinyl-label"),
  micDebug: document.querySelector("#mic-debug"),
  progressBar: document.querySelector("#progress-bar"),
  progressTimeCurrent: document.querySelector("#progress-time-current"),
  progressTimeTotal: document.querySelector("#progress-time-total"),
  lyricsOverlay: document.querySelector("#lyrics-overlay"),
  lyricsScroll: document.querySelector("#lyrics-scroll"),
  lyricsContainer: document.querySelector(".lyrics-container"),
  coverPanel: document.querySelector(".cover-panel"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  appVersionDisplay: document.querySelector("#app-version-display"),
  alternativesWrapper: document.querySelector("#alternatives-wrapper"),
  alternativesBtn: document.querySelector("#alternatives-btn"),
  alternativesLabel: document.querySelector("#alternatives-label"),
  alternativesPopup: document.querySelector("#alternatives-popup"),
  alternativesPopupClose: document.querySelector("#alternatives-popup-close"),
  alternativesList: document.querySelector("#alternatives-list"),
  stopConfirmPopup: document.querySelector("#stop-confirm-popup"),
  stopConfirmCancel: document.querySelector("#stop-confirm-cancel"),
  stopConfirmOk: document.querySelector("#stop-confirm-ok"),
};

let currentTrackKey = null;
let parsedLyrics = null;
let activeLyricIndex = -1;
let lyricsVisible = false;
let lyricsEnabled = localStorage.getItem("lyricsEnabled") === "true";
let lyricsLatencyOffset = 1.3;
let lyricsTimeoutId = null;
const lyricsCache = new Map();
let lyricsStatusMessage = "Letra não encontrada para esta faixa";
let nextTrack = null;
let currentRelease = null;
let currentAlternatives = [];
let trackChangeCount = 0;
let consecutiveFailedListens = 0;
let micSuspended = false;

// Espera entre escutas sem resultado quando nenhum disco está tocando: 8s nas 3 primeiras
// tentativas e depois dobra até 5 min. O microfone nunca "dorme" (antes exigia toque na
// tela), mas ruído ambiente também não queima as chamadas do Shazam.
// ---------- v3.5: acompanhamento pelo silêncio (sem Shazam a cada faixa) ----------
// Ajuste fino sem novo deploy: localStorage.vinylDetector = '{"gapRatio":0.2}'
function loadDetectorOptions() {
  try {
    return JSON.parse(window.localStorage.getItem("vinylDetector") || "{}");
  } catch (e) {
    return {};
  }
}
const silenceDetector = window.VinylSilence ? new window.VinylSilence.SilenceDetector(loadDetectorOptions()) : null;
const DETECTOR_HOLD_MS = 6 * 3600 * 1000; // enquanto o detector acompanha, nada de re-escuta agendada
const FLIP_FALLBACK_MS = 120000;           // virada não percebida em 2 min -> Shazam confere
let lastServerState = null;
let waitingFlipSince = 0;
let driftCheckBoundaries = 0;
let pendingDriftListen = false;
let lastDetectorAction = "";
const FAR_GAP_CHECK_SECONDS = 2;
let farGapChecked = false;

async function handleSilenceResume(event) {
  if (recording || !silenceDetector || !lastServerState) return;
  const action = window.VinylSilence.decideOnResume(event, lastServerState);
  const gapSeconds = Math.round(event.gapMs / 100) / 10;
  lastDetectorAction = `${action} após pausa de ${gapSeconds}s`;
  if (action === "ignore") return;
  if (action === "recognize") {
    recordClip(true, false);
    return;
  }
  try {
    const res = await fetchJson(`/api/playback/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ago_seconds: (Date.now() - event.resumedAt) / 1000, gap_seconds: gapSeconds }),
    });
    const result = (res && res.result) || {};
    if (action === "flip" && !result.flipped) {
      // Não havia outro lado (ou o disco não tem lados): provavelmente é outro disco
      recordClip(true, false);
      return;
    }
    if (action === "flip") {
      lastDetectorAction = `virou para ${result.track} sem Shazam`;
    } else if (result.aligned) {
      lastDetectorAction = `faixa ${result.track} confirmada pela pausa (ajuste ${result.shift}s)`;
    } else if (result.reason === "far" && gapSeconds >= FAR_GAP_CHECK_SECONDS && !farGapChecked) {
      // Pausa clara entre músicas longe de qualquer troca prevista: disco ou lado errado.
      // O Shazam confere uma vez (até a próxima confirmação) em vez de esperar duas faixas.
      farGapChecked = true;
      lastDetectorAction = `pausa fora do previsto (${result.offset}s): conferindo com o Shazam`;
      if (res && res.state) renderState(res.state);
      recordClip(true, false);
      return;
    }
    if (res && res.state) renderState(res.state);
  } catch (error) {
    console.error("Erro ao enviar evento do detector:", error);
  }
}

// ---------- v3.5.2: tela acesa enquanto um disco está no player ----------
// Usa a Screen Wake Lock API (Chrome 84+). O sistema solta o pedido quando a página fica
// oculta, então ele é refeito ao voltar. Sem disco, a tela pode apagar normalmente.
let screenWakeLock = null;
let wantScreenAwake = false;
let wakeLockRequesting = false;

async function setScreenAwake(want) {
  wantScreenAwake = want;
  if (!("wakeLock" in navigator)) return;
  if (want) {
    if (screenWakeLock || wakeLockRequesting || document.visibilityState !== "visible") return;
    wakeLockRequesting = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        if (screenWakeLock === lock) screenWakeLock = null;
      });
      screenWakeLock = lock;
      if (!wantScreenAwake) {
        // o disco acabou enquanto o pedido estava em andamento
        screenWakeLock = null;
        lock.release().catch(() => {});
      }
    } catch (error) {
      console.warn("Não foi possível manter a tela acesa:", error);
    } finally {
      wakeLockRequesting = false;
    }
  } else if (screenWakeLock) {
    const lock = screenWakeLock;
    screenWakeLock = null;
    lock.release().catch(() => {});
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wantScreenAwake) setScreenAwake(true);
});

function idleRetryDelayMs(failures) {
  const steps = Math.max(0, failures - 3);
  return Math.min(300000, 8000 * Math.pow(2, steps));
}

// Respostas do servidor que dizem para não tentar de novo tão cedo
const SHAZAM_PAUSE_MS = { budget_exceeded: 30 * 60000, quota_exhausted: 60 * 60000 };
let consecutiveLoudSeconds = 0;

let mediaStream = null;
let recording = false;
let lastRecognitionAt = 0;
const playbackTracker = {
  active: false,
  baseProgress: 0,
  duration: 0,
  lastUpdate: 0,
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && body.error === "device_not_authorized") {
        // v3.6: aparelho sem autorização — avisa uma vez e não insiste
        window.nextAutoListenAt = Date.now() + 10 * 60000;
        showError(body.message);
        message = body.message;
      }
    } catch (e) {
      // corpo não é JSON
    }
    throw new Error(message);
  }
  return response.json();
}

function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, Math.floor(seconds % 60));
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function updateProgressBar() {
  if (!playbackTracker.active) {
    if (elements.progressBar) elements.progressBar.style.width = "0%";
    if (elements.progressTimeCurrent) elements.progressTimeCurrent.textContent = "0:00";
    if (elements.progressTimeTotal) elements.progressTimeTotal.textContent = "0:00";
    updateLyricsProgress(0);
    return;
  }

  const elapsed = (Date.now() - playbackTracker.lastUpdate) / 1000;
  const currentProgress = playbackTracker.duration > 0
    ? Math.min(playbackTracker.duration, playbackTracker.baseProgress + elapsed)
    : playbackTracker.baseProgress + elapsed;

  if (elements.progressBar) {
    if (playbackTracker.duration > 0) {
      const pct = (currentProgress / playbackTracker.duration) * 100;
      elements.progressBar.style.width = `${Math.min(100, pct)}%`;
    } else {
      elements.progressBar.style.width = "0%";
    }
  }

  if (elements.progressTimeCurrent) {
    elements.progressTimeCurrent.textContent = formatTime(currentProgress);
  }

  if (elements.progressTimeTotal) {
    elements.progressTimeTotal.textContent = formatTime(playbackTracker.duration);
  }

  updateLyricsProgress(currentProgress);

  // Prefetch da letra da próxima música quando faltar menos de 10 segundos
  if (playbackTracker.duration > 0 && nextTrack && currentRelease) {
    const remaining = playbackTracker.duration - currentProgress;
    if (remaining <= 10) {
      const nextCacheKey = getLyricsCacheKey(nextTrack.title, currentRelease.artist);
      if (!lyricsCache.has(nextCacheKey)) {
        fetchLyrics(nextTrack, currentRelease, true);
      }
    }
  }
}

function setCover(release) {
  if (!release || !release.cover_url) {
    elements.albumCover.className = "";
    elements.albumCover.replaceChildren();
    const image = document.createElement("img");
    image.className = "cover-image";
    image.alt = "LOGO LP DA SEMANA";
    image.src = "/static/logo_lp_da_semana.png";
    elements.albumCover.appendChild(image);
    if (elements.vinylLabel) {
      elements.vinylLabel.style.backgroundImage = "url(/static/logo_lp_da_semana.png)";
    }
    return;
  }

  elements.albumCover.className = "";
  elements.albumCover.replaceChildren();
  const image = document.createElement("img");
  image.className = "cover-image";
  image.alt = `Capa de ${release.title}`;
  image.src = release.cover_url;
  elements.albumCover.appendChild(image);
  if (elements.vinylLabel) {
    elements.vinylLabel.style.backgroundImage = `url(${release.cover_url})`;
  }
}

function renderState(state) {
  lastServerState = state;
  setScreenAwake(Boolean(state && state.release));
  if (!state) return;

  if (state.lyrics_latency_offset !== undefined) {
    lyricsLatencyOffset = parseFloat(state.lyrics_latency_offset);
  }

  if (state.version && elements.appVersionDisplay) {
    elements.appVersionDisplay.textContent = state.version;
  }

  const hasNextTrack = !!state.next_track;
  elements.statusLabel.textContent = labelForStatus(state.status, hasNextTrack);

  // Desabilitar botões por padrão
  elements.prevButton.disabled = true;
  if (elements.stopButton) elements.stopButton.disabled = true;
  elements.nextButton.disabled = true;

  // Nós só mantemos a tela no modo "Tocando" (com capa da música e título) se:
  // - O status for "playing"
  // - OU se for "waiting_flip" E houver uma próxima música (ou seja, tem outro lado a ser tocado)
  const isPlayingActive = (state.status === "playing" || (state.status === "waiting_flip" && state.next_track)) && state.release && state.track;

  if (isPlayingActive) {
    const release = state.release;
    const track = state.track;
    
    currentRelease = release;
    nextTrack = state.next_track;

    const trackKey = `${track.title}-${release.artist}`;
    if (trackKey !== currentTrackKey) {
      // Automatic background verification on track changes is disabled to save Shazam API tokens.
      // Re-verification is now only done manually when the user clicks the "Identify" button.
      currentTrackKey = trackKey;
      fetchLyrics(track, release);
      setLyricsVisibility(false);
    }

    setCover(release);
    elements.trackTitle.textContent = track.title;
    elements.artistName.textContent = release.artist;
    elements.albumLine.textContent = release.title;

    currentAlternatives = state.alternatives || [];
    if (currentAlternatives.length > 0 && elements.alternativesWrapper) {
      elements.alternativesWrapper.classList.remove("hidden");
      if (elements.alternativesLabel) {
        const count = currentAlternatives.length;
        elements.alternativesLabel.textContent = `Também em ${count} ${count === 1 ? "outro disco" : "outros discos"}`;
      }
    } else {
      if (elements.alternativesWrapper) {
        elements.alternativesWrapper.classList.add("hidden");
      }
      hideAlternatives();
    }

    if (state.next_track && elements.nextTrackTitle) {
      elements.nextTrackTitle.textContent = state.next_track.title;
      elements.nextTrack.style.display = "block";
    } else {
      if (elements.nextTrackTitle) elements.nextTrackTitle.textContent = "";
      elements.nextTrack.style.display = "none";
    }
    
    // Habilitar botões se estiver tocando e animar vinil
    elements.prevButton.disabled = false;
    if (elements.stopButton) elements.stopButton.disabled = false;
    elements.nextButton.disabled = !state.next_track;

    if (state.status === "playing") {
      if (elements.vinylWrapper) {
        elements.vinylWrapper.classList.add("playing");
      }
      document.body.classList.add("is-playing");

      waitingFlipSince = 0;
      const progress = state.progress_seconds || 0;
      const duration = track.duration_seconds || state.duration_seconds || 0;
      if (silenceDetector && !state.duration_estimated) {
        // v3.5: as pausas entre faixas mantêm o tempo certo; o Shazam só é chamado se
        // duas trocas de faixa seguidas passarem sem pausa (deriva ou disco trocado).
        if ((state.seconds_since_anchor || 0) < 10) {
          driftCheckBoundaries = 0;
          farGapChecked = false;
        }
        const unconfirmed = state.unconfirmed_boundaries || 0;
        if (unconfirmed >= 2 && unconfirmed >= driftCheckBoundaries + 2) {
          driftCheckBoundaries = unconfirmed;
          pendingDriftListen = true;
        }
        window.nextAutoListenAt = pendingDriftListen ? 0 : Date.now() + DETECTOR_HOLD_MS;
      } else if (duration && progress < duration) {
        // Duração desconhecida: confere com o Shazam no fim estimado da faixa
        const remaining = duration - progress;
        window.nextAutoListenAt = Date.now() + (remaining * 1000);
      } else {
        if (!window.nextAutoListenAt || window.nextAutoListenAt < Date.now()) {
          window.nextAutoListenAt = lastRecognitionAt + 90000;
        }
      }

      // Update local playback tracker for smooth interpolation
      playbackTracker.active = true;
      playbackTracker.baseProgress = progress;
      playbackTracker.duration = duration;
      playbackTracker.lastUpdate = Date.now();
      updateProgressBar();
    } else {
      // state.status === "waiting_flip" com próxima música ativa
      if (elements.vinylWrapper) {
        elements.vinylWrapper.classList.remove("playing"); // Para de girar e recolhe o disco
      }
      document.body.classList.add("is-playing");

      if (!waitingFlipSince) waitingFlipSince = Date.now();
      if (silenceDetector && state.next_track) {
        // v3.5: o detector percebe a agulha no próximo lado e segue sem Shazam
        window.nextAutoListenAt = waitingFlipSince + FLIP_FALLBACK_MS;
      } else {
        // Fim do disco (ou sem detector): o próximo som é outro disco, precisa do Shazam
        window.nextAutoListenAt = 0;
      }

      // Desativa o tracker local e preenche a barra de progresso em 100%
      playbackTracker.active = false;
      if (elements.progressBar) elements.progressBar.style.width = "100%";
      if (elements.progressTimeCurrent) elements.progressTimeCurrent.textContent = formatTime(track.duration_seconds);
      if (elements.progressTimeTotal) elements.progressTimeTotal.textContent = formatTime(track.duration_seconds);

      // Exibe instrução de virar o disco
      if (state.message) {
        elements.albumLine.textContent = state.message;
      }
    }
    return;
  }

  // ESTADO DE ESPERA / OCIOSO (Sem música tocando)
  trackChangeCount = 0;
  currentAlternatives = [];
  if (elements.alternativesWrapper) {
    elements.alternativesWrapper.classList.add("hidden");
  }
  hideAlternatives();
  setCover(null); // Renderiza a logo do LP DA SEMANA
  currentRelease = null;
  nextTrack = null;
  currentTrackKey = null;
  parsedLyrics = null;
  activeLyricIndex = -1;
  if (elements.lyricsScroll) {
    const p = document.createElement("p");
    p.className = "lyrics-empty";
    p.textContent = "Sem letras carregadas";
    elements.lyricsScroll.replaceChildren(p);
  }
  
  if (elements.vinylWrapper) {
    elements.vinylWrapper.classList.remove("playing");
  }
  document.body.classList.remove("is-playing");

  // Desativa o tracker local de reprodução
  playbackTracker.active = false;
  playbackTracker.baseProgress = 0;
  playbackTracker.duration = 0;
  playbackTracker.lastUpdate = 0;
  updateProgressBar();

  // Sempre mostra o bloco de Próxima Música no estado ocioso com a mensagem pedida
  if (elements.nextTrackTitle) {
    elements.nextTrackTitle.textContent = "Coloque novo disco para tocar";
    elements.nextTrack.style.display = "block";
  }

  if (state.status === "not_found") {
    elements.trackTitle.textContent = "Não encontrado";
    elements.artistName.textContent = state.message;
    elements.albumLine.textContent = state.last_recognition
      ? `${state.last_recognition.title} · ${state.last_recognition.artist}`
      : "Cadastre no Discogs e sincronize novamente";
    return;
  }

  if (state.status === "identifying") {
    elements.trackTitle.textContent = "Identificando";
    elements.artistName.textContent = "Ouvindo um trecho do disco";
    elements.albumLine.textContent = "Aguarde alguns segundos";
    return;
  }

  // Caso padrão (listening / ocioso ou waiting_flip sem próxima música)
  elements.trackTitle.textContent = "LP DA SEMANA";
  elements.artistName.textContent = "Conversas em Vinil";
  
  if (state.status === "waiting_flip" && !state.next_track) {
    elements.albumLine.textContent = state.message || "Fim do disco!";
    window.nextAutoListenAt = 0; // Garante escuta ativada imediata
  } else {
    elements.albumLine.textContent = `${state.collection_count || 0} discos sincronizados`;
  }
}

function labelForStatus(status, hasNextTrack) {
  const labels = {
    listening: "AGUARDANDO NOVO DISCO",
    identifying: "Identificando",
    playing: "Tocando",
    waiting_flip: hasNextTrack ? "VIRE O DISCO" : "AGUARDANDO NOVO DISCO",
    not_found: "Não encontrado",
    syncing: "Sincronizando",
    offline: "Offline",
  };
  return labels[status] || "AGUARDANDO NOVO DISCO";
}

async function pollState() {
  try {
    const state = await fetchJson("/api/state");
    const isPlaying = (currentRelease !== null);
    if (!recording || isPlaying) {
      renderState(state);
    }
  } catch (error) {
    const isPlaying = (currentRelease !== null);
    if (!recording || isPlaying) {
      elements.statusLabel.textContent = "Offline";
      elements.trackTitle.textContent = "Sem conexão";
      elements.artistName.textContent = "Servidor indisponível";
    }
  }
}

let micAudioContext = null;
let micSourceNode = null;
let micAnalyserNode = null;
let isInitializingMic = false;

function resample(buffer, fromSampleRate, toSampleRate) {
  if (fromSampleRate === toSampleRate) {
    return buffer;
  }
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const nextOffset = i * ratio;
    const index = Math.floor(nextOffset);
    const weight = nextOffset - index;
    if (index + 1 < buffer.length) {
      result[i] = buffer[index] * (1 - weight) + buffer[index + 1] * weight;
    } else {
      result[i] = buffer[index];
    }
  }
  return result;
}

async function startMicrophone() {
  if (isInitializingMic || micAudioContext) return;
  isInitializingMic = true;

  if (elements.micDebug) {
    elements.micDebug.textContent = "Microfone: solicitando permissão...";
  }

  if (!window.isSecureContext) {
    elements.trackTitle.textContent = "HTTPS necessário";
    elements.artistName.textContent = "Abra esta página em HTTPS para liberar o microfone";
    if (elements.micDebug) {
      elements.micDebug.textContent = "Erro: Requer contexto seguro HTTPS.";
    }
    isInitializingMic = false;
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    if (micAudioContext.state === "suspended") {
      await micAudioContext.resume();
    }

    micSourceNode = micAudioContext.createMediaStreamSource(mediaStream);
    micAnalyserNode = micAudioContext.createAnalyser();
    micAnalyserNode.fftSize = 2048;
    micSourceNode.connect(micAnalyserNode);

    if (elements.micDebug) {
      elements.micDebug.textContent = "Microfone: ativado com sucesso.";
    }

    const updateDebug = (rmsValue) => {
      if (elements.micDebug) {
        if (recording) return;
        const state = micAudioContext.state;
        const status = state === "suspended" ? "pausado (toque na tela para ativar)" : "ouvindo";
        const currentRms = rmsValue !== undefined ? rmsValue : 0;
        const volPct = Math.round(currentRms * 100);
        elements.micDebug.textContent = `Microfone: ${status} | Vol: ${volPct}% | Limiar: 3.0% (${consecutiveLoudSeconds}/2s)`;
      }
    };

    const detectorSamples = new Uint8Array(micAnalyserNode.fftSize);
    setInterval(() => {
      if (!silenceDetector || !micAudioContext || micAudioContext.state !== "running") return;
      micAnalyserNode.getByteTimeDomainData(detectorSamples);
      let sum = 0;
      for (let i = 0; i < detectorSamples.length; i++) {
        const v = (detectorSamples[i] - 128) / 128;
        sum += v * v;
      }
      const event = silenceDetector.push(Math.sqrt(sum / detectorSamples.length), Date.now());
      if (event) handleSilenceResume(event);
    }, 250);

    const samples = new Uint8Array(micAnalyserNode.fftSize);
    setInterval(() => {
      if (!micAudioContext || micAudioContext.state === "suspended") {
        if (elements.micDebug && !recording) {
          elements.micDebug.textContent = "Microfone: pausado (toque na tela para ativar) | Vol: 0% | Limiar: 3.0%";
        }
        return;
      }

      if (micSuspended) {
        if (elements.micDebug && !recording) {
          elements.micDebug.textContent = "Microfone: em repouso (toque na tela ou no botão para reativar)";
        }
        return;
      }

      const now = Date.now();
      const isCooldownActive = window.nextAutoListenAt && now < window.nextAutoListenAt;

      if (isCooldownActive) {
        if (elements.micDebug && !recording) {
          const secsLeft = Math.ceil((window.nextAutoListenAt - now) / 1000);
          if (silenceDetector && currentRelease && secsLeft > 3600) {
            const level = Math.round(silenceDetector.level * 1000) / 10;
            const gap = Math.round(silenceDetector.currentGapMs(now) / 100) / 10;
            elements.micDebug.textContent = `Detector: nível ${level}% | pausa ${gap}s${lastDetectorAction ? " | " + lastDetectorAction : ""}`;
          } else {
            elements.micDebug.textContent = `Microfone: suspenso (próxima busca em ${secsLeft}s)`;
          }
        }
        return;
      }

      micAnalyserNode.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => {
        const normalized = (value - 128) / 128;
        return sum + normalized * normalized;
      }, 0) / samples.length);

      if (rms > 0.030) {
        consecutiveLoudSeconds++;
      } else {
        consecutiveLoudSeconds = 0;
      }

      updateDebug(rms);

      if (consecutiveLoudSeconds >= 2 && !recording) {
        consecutiveLoudSeconds = 0;
        recordClip(true, false);
      }
    }, 1000);

  } catch (error) {
    console.error("Erro ao iniciar microfone:", error);
    elements.trackTitle.textContent = "Microfone bloqueado";
    elements.artistName.textContent = microphoneErrorMessage(error);
    if (elements.micDebug) {
      elements.micDebug.textContent = `Erro do mic: ${error.name} - ${error.message}`;
    }
  } finally {
    isInitializingMic = false;
  }
}

function recordClip(isAutomatic = false, isManual = false, attempt = 1, maxAttempts = 3) {
  if (!mediaStream || !micAudioContext || recording) return;
  recording = true;
  if (elements.retryButton) {
    elements.retryButton.classList.add("recording");
  }
  lastRecognitionAt = Date.now();
  pendingDriftListen = false;

  const isPlaying = (currentRelease !== null) || playbackTracker.active;

  // Update UI immediately to show active listening feedback
  if (elements.nextTrackTitle) {
    elements.nextTrackTitle.textContent = isManual && attempt > 1 ? `Ouvindo (${attempt}/${maxAttempts})...` : "Ouvindo...";
    elements.nextTrack.style.display = "block";
  }

  if (isManual || !isPlaying) {
    elements.statusLabel.textContent = "Ouvindo";
    elements.trackTitle.textContent = isManual && attempt > 1 ? `Ouvindo o disco (tentativa ${attempt}/${maxAttempts})...` : "Ouvindo o disco...";
    elements.artistName.textContent = "Capturando áudio do microfone";
    elements.albumLine.textContent = "Aguarde 4 segundos...";
  }
  if (elements.micDebug) {
    elements.micDebug.textContent = `Microfone: gravando trecho de 4 segundos...${isManual ? ` [${attempt}/${maxAttempts}]` : ''}`;
  }

  const processor = micAudioContext.createScriptProcessor(4096, 1, 1);
  const chunks = [];

  processor.onaudioprocess = (e) => {
    if (!recording) return;
    const channelData = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(channelData));
  };

  micSourceNode.connect(processor);
  processor.connect(micAudioContext.destination);

  window.setTimeout(async () => {
    // Stop recording and close capturing context
    processor.disconnect();
    try {
      micSourceNode.disconnect(processor);
    } catch (err) {}

    // Show processing status
    if (elements.nextTrackTitle) {
      elements.nextTrackTitle.textContent = "Pesquisando...";
    }

    if (isManual || !isPlaying) {
      elements.statusLabel.textContent = "Identificando";
      elements.trackTitle.textContent = "Buscando música...";
      elements.artistName.textContent = "Processando áudio com o Shazam";
      elements.albumLine.textContent = "Identificando com o Shazam...";
    }
    if (elements.micDebug) {
      elements.micDebug.textContent = "Shazam: identificando música no servidor...";
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const pcmData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }

    const resampledData = resample(pcmData, micAudioContext.sampleRate, 44100);
    const pcmBytes = float32To16BitPCM(resampledData);
    const blob = new Blob([pcmBytes], { type: "application/octet-stream" });

    try {
      const response = await fetchJson("/api/recognize", {
        method: "POST",
        headers: { 
          "X-Clip-Filename": "clip.raw",
          "Content-Type": "application/octet-stream",
          "X-Client-Elapsed-Ms": String(Date.now() - lastRecognitionAt)
        },
        body: blob,
      });

      if (response && response.status === "matched" && response.match) {
        consecutiveFailedListens = 0;
        if (elements.micDebug) {
          elements.micDebug.textContent = `Shazam: identificada com sucesso! (${response.match.track.title})`;
        }
        recording = false;
        if (elements.retryButton) {
          elements.retryButton.classList.remove("recording");
        }
        await pollState();
        return;
      }

      // Se não identificou:
      recording = false;
      if (elements.retryButton) {
        elements.retryButton.classList.remove("recording");
      }

      const shazamPause = response ? SHAZAM_PAUSE_MS[response.status] : undefined;
      if (isManual && attempt < maxAttempts && !shazamPause) {
        // Tentativa manual inteligente: se a agulha ainda estava caindo ou no lead-in silencioso,
        // aguarda 2s e tenta automaticamente a próxima tentativa para pegar a faixa 1 de primeira!
        if (elements.nextTrackTitle) {
          elements.nextTrackTitle.textContent = `Tentativa ${attempt + 1}/${maxAttempts}...`;
        }
        elements.statusLabel.textContent = "Aguardando";
        elements.trackTitle.textContent = "Aguardando áudio da agulha...";
        elements.artistName.textContent = `Tentativa ${attempt + 1} de ${maxAttempts} em instantes...`;
        elements.albumLine.textContent = "Ouvindo o disco novamente...";

        window.setTimeout(() => {
          if (!playbackTracker.active && !recording) {
            recordClip(false, true, attempt + 1, maxAttempts);
          }
        }, 2200);
        return;
      }

      // Se todas as tentativas manuais terminaram ou foi escuta automática sem match:
      const stillPlaying = (currentRelease !== null) || playbackTracker.active;
      if (!stillPlaying) {
        // Ocioso esperando disco: cooldown curto (8s) para detectar a faixa 1 rapidamente
        // sem pular direto para a faixa 2 ou 3!
        consecutiveFailedListens++;
        window.nextAutoListenAt = Date.now() + idleRetryDelayMs(consecutiveFailedListens);
      } else {
        // Já está tocando: cooldown longo (60s) para economizar tokens Shazam
        window.nextAutoListenAt = Date.now() + 60000;
      }

      if (shazamPause) {
        // Orçamento diário ou cota mensal esgotados: o servidor recusa sem gastar chamadas,
        // então espera bem mais antes de tentar de novo.
        window.nextAutoListenAt = Date.now() + shazamPause;
        if (elements.micDebug) {
          elements.micDebug.textContent = "Shazam pausado: " + (response.message || response.status);
        }
      }

      if (isManual) {
        elements.statusLabel.textContent = "Aguardando";
        elements.trackTitle.textContent = "Música ainda não detectada";
        elements.artistName.textContent = "O microfone continuará ouvindo automaticamente";
        elements.albumLine.textContent = "Certifique-se de que a agulha já está tocando o disco";
      } else {
        if (response && response.status === "recognition_unavailable") {
          if (elements.micDebug && !micSuspended) {
            elements.micDebug.textContent = "Shazam: serviço indisponível (" + (response.message || "limite/erro") + ")";
          }
        } else {
          if (elements.micDebug && !micSuspended) {
            elements.micDebug.textContent = "Shazam: música não identificada na coleção";
          }
        }
      }

      await pollState();
    } catch (error) {
      console.error("Erro na identificação da música:", error);
      recording = false;
      if (elements.retryButton) {
        elements.retryButton.classList.remove("recording");
      }
      consecutiveFailedListens++;
      if (elements.micDebug) {
        elements.micDebug.textContent = `Erro do servidor: ${error.message}`;
      }
      window.nextAutoListenAt = Date.now() + idleRetryDelayMs(consecutiveFailedListens);
      await pollState();
    }
  }, 4000); // 4 seconds clip
}

function float32To16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buffer);
}


function showError(message) {
  const popup = document.querySelector("#error-popup");
  const msgEl = document.querySelector("#error-popup-message");
  if (popup && msgEl) {
    msgEl.textContent = message;
    popup.classList.remove("hidden");
    popup.setAttribute("aria-hidden", "false");
  }
}

function hideError() {
  const popup = document.querySelector("#error-popup");
  if (popup) {
    popup.classList.add("hidden");
    popup.setAttribute("aria-hidden", "true");
  }
}

const closeBtn = document.querySelector("#error-popup-close");
if (closeBtn) {
  closeBtn.addEventListener("click", hideError);
}
const popupOverlay = document.querySelector("#error-popup");
if (popupOverlay) {
  popupOverlay.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      hideError();
    }
  });
}

function showAlternatives() {
  if (!elements.alternativesPopup || !elements.alternativesList) return;
  elements.alternativesList.replaceChildren();
  if (!currentAlternatives || currentAlternatives.length === 0) return;

  currentAlternatives.forEach((alt) => {
    const card = document.createElement("div");
    card.className = "alternative-card";

    const cover = document.createElement("img");
    cover.className = "alternative-card-cover";
    cover.alt = alt.title || "Capa";
    cover.src = alt.cover_url || "/static/logo_lp_da_semana.png";

    const info = document.createElement("div");
    info.className = "alternative-card-info";

    const title = document.createElement("span");
    title.className = "alternative-card-title";
    title.textContent = alt.title;

    const artistYear = document.createElement("span");
    artistYear.className = "alternative-card-artist";
    const yearStr = alt.year ? ` (${alt.year})` : "";
    artistYear.textContent = `${alt.artist}${yearStr}`;

    const track = document.createElement("span");
    track.className = "alternative-card-track";
    const posStr = alt.track_position ? `Lado ${alt.track_position}: ` : "";
    track.textContent = `${posStr}${alt.track_title || ""}`;

    info.appendChild(title);
    info.appendChild(artistYear);
    info.appendChild(track);

    const action = document.createElement("div");
    action.className = "alternative-card-action";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 13h11.86l-5.43 5.43 1.42 1.42L21.14 12l-8.29-7.85-1.42 1.42L16.86 11H5v2z");
    svg.appendChild(path);
    action.appendChild(svg);

    card.appendChild(cover);
    card.appendChild(info);
    card.appendChild(action);

    card.addEventListener("click", () => {
      switchActiveRelease(alt.release_id);
    });

    elements.alternativesList.appendChild(card);
  });

  elements.alternativesPopup.classList.remove("hidden");
}

function hideAlternatives() {
  if (elements.alternativesPopup) {
    elements.alternativesPopup.classList.add("hidden");
  }
}

async function switchActiveRelease(releaseId) {
  try {
    const res = await fetchJson("/api/playback/switch_release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: releaseId }),
    });
    hideAlternatives();
    if (res && res.state) {
      renderState(res.state);
    } else {
      await pollState();
    }
  } catch (err) {
    console.error("Erro ao alternar disco:", err);
    showError("Não foi possível alternar o disco: " + err.message);
  }
}

if (elements.alternativesBtn) {
  elements.alternativesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showAlternatives();
  });
}
if (elements.alternativesPopupClose) {
  elements.alternativesPopupClose.addEventListener("click", hideAlternatives);
}

// v3.6: "Manter este disco" trava o disco atual e lembra a escolha para esta música
const alternativesKeepButton = document.getElementById("alternatives-keep");
if (alternativesKeepButton) {
  alternativesKeepButton.addEventListener("click", async () => {
    try {
      const res = await fetchJson("/api/playback/keep_release", { method: "POST" });
      hideAlternatives();
      if (res && res.state) {
        renderState(res.state);
      } else {
        await pollState();
      }
    } catch (err) {
      console.error("Erro ao manter disco:", err);
      showError("Não foi possível manter o disco: " + err.message);
    }
  });
}
if (elements.alternativesPopup) {
  elements.alternativesPopup.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      hideAlternatives();
    }
  });
}

if (elements.syncButton) {
  elements.syncButton.addEventListener("click", async () => {
    elements.statusLabel.textContent = "Sincronizando";
    try {
      await fetchJson("/api/sync", { method: "POST" });
      await pollState();
    } catch (error) {
      console.error("Erro na sincronização:", error);
      showError("Erro do servidor ao sincronizar a coleção: " + error.message);
    }
  });
}

async function handleFirstGesture() {
  micSuspended = false;
  consecutiveFailedListens = 0;
  if (!micAudioContext && !isInitializingMic) {
    await startMicrophone();
  } else if (micAudioContext && micAudioContext.state === "suspended") {
    await micAudioContext.resume();
  }
}

document.addEventListener("click", handleFirstGesture);
document.addEventListener("touchstart", handleFirstGesture);

elements.retryButton.addEventListener("click", async (e) => {
  e.stopPropagation();
  hideStopConfirm();
  micSuspended = false;
  consecutiveFailedListens = 0;
  consecutiveLoudSeconds = 0;
  window.nextAutoListenAt = 0;
  await handleFirstGesture();

  if (!mediaStream) {
    let msg = "Não foi possível acessar o microfone.";
    if (!window.isSecureContext) {
      msg = "O acesso ao microfone requer uma conexão segura (HTTPS).";
    }
    showError(msg);
    if (elements.micDebug) {
      elements.micDebug.textContent = `Erro: ${msg}`;
    }
    return;
  }

  // Se havia um disco tocando, o usuário tirou o disco e quer ouvir um novo!
  // Paramos o disco anterior no servidor e resetamos o estado local imediatamente:
  if (currentRelease !== null) {
    try {
      fetchJson("/api/playback/stop", { method: "POST" }).catch(() => {});
    } catch (err) {}
    currentRelease = null;
    nextTrack = null;
    currentTrackKey = null;
    currentAlternatives = [];
    playbackTracker.active = false;
    playbackTracker.baseProgress = 0;
    playbackTracker.duration = 0;
    document.body.classList.remove("is-playing");
    if (elements.vinylWrapper) {
      elements.vinylWrapper.classList.remove("playing");
    }
    setCover(null);
  }

  recordClip(false, true, 1, 3);
});

// O clique na capa agora alterna a exibição das letras

elements.prevButton.addEventListener("click", async () => {
  try {
    renderState(await fetchJson("/api/playback/prev", { method: "POST" }));
  } catch (error) {
    console.error("Erro ao retroceder faixa:", error);
    showError("Erro do servidor ao retroceder faixa: " + error.message);
  }
});

function showStopConfirm() {
  if (elements.stopConfirmPopup) {
    elements.stopConfirmPopup.classList.remove("hidden");
    elements.stopConfirmPopup.setAttribute("aria-hidden", "false");
  }
}

function hideStopConfirm() {
  if (elements.stopConfirmPopup) {
    elements.stopConfirmPopup.classList.add("hidden");
    elements.stopConfirmPopup.setAttribute("aria-hidden", "true");
  }
}

if (elements.stopButton) {
  elements.stopButton.addEventListener("click", () => {
    if (!elements.stopButton.disabled) {
      showStopConfirm();
    }
  });
}

if (elements.stopConfirmCancel) {
  elements.stopConfirmCancel.addEventListener("click", hideStopConfirm);
}

if (elements.stopConfirmPopup) {
  elements.stopConfirmPopup.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      hideStopConfirm();
    }
  });
}

if (elements.stopConfirmOk) {
  elements.stopConfirmOk.addEventListener("click", async () => {
    hideStopConfirm();
    try {
      window.nextAutoListenAt = 0;
      currentRelease = null;
      nextTrack = null;
      currentTrackKey = null;
      currentAlternatives = [];
      playbackTracker.active = false;
      playbackTracker.baseProgress = 0;
      playbackTracker.duration = 0;
      document.body.classList.remove("is-playing");
      if (elements.vinylWrapper) {
        elements.vinylWrapper.classList.remove("playing");
      }
      setCover(null);

      const res = await fetchJson("/api/playback/stop", { method: "POST" });
      if (res && res.state) {
        renderState(res.state);
      } else if (res) {
        renderState(res);
      } else {
        await pollState();
      }
    } catch (error) {
      console.error("Erro ao parar disco:", error);
      showError("Erro do servidor ao parar disco: " + error.message);
    }
  });
}

elements.nextButton.addEventListener("click", async () => {
  try {
    renderState(await fetchJson("/api/playback/next", { method: "POST" }));
  } catch (error) {
    console.error("Erro ao avançar faixa:", error);
    showError("Erro do servidor ao avançar faixa: " + error.message);
  }
});

pollState();
setInterval(pollState, 2000);
setInterval(updateProgressBar, 250);

if (elements.micDebug) {
  elements.micDebug.textContent = "Microfone: inativo (toque na tela para ativar)";
}

function microphoneErrorMessage(error) {
  if (error && error.name === "NotAllowedError") {
    return "Permissão do microfone negada";
  }
  return "Não foi possível iniciar o microfone";
}

// References kept for test/linter compatibility:
// typeof MediaRecorder !== "undefined"
// MediaRecorder.isTypeSupported


/* ==========================================================================
   LYRICS OVERLAY SYSTEM & PARSER (V2.0.0)
   ========================================================================== */

function cleanMetadataString(str) {
  if (!str) return "";
  return str
    .replace(/\s*[-–—]\s*(?:20\d{2}\s*)?remaster(?:ed)?(?:\s*version)?.*$/i, "")
    .replace(/\s*[-–—]\s*deluxe(?:\s*edition)?.*$/i, "")
    .replace(/\s*[\(\[]\s*(?:live|acoustic|demo|remastered|remix|bonus\s*track|deluxe).*?[\]\)]/i, "")
    .trim();
}

function parseLRC(lrcText) {
  if (!lrcText) return null;
  const lines = lrcText.split("\n");
  const lyrics = [];
  const timeRegex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;

  for (let line of lines) {
    line = line.trim();
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      let ms = 0;
      if (match[3]) {
        ms = parseInt(match[3].padEnd(3, "0").substring(0, 3), 10);
      }
      const timeSeconds = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      lyrics.push({ timeSeconds, text });
    }
  }
  if (lyrics.length > 0) {
    lyrics.sort((a, b) => a.timeSeconds - b.timeSeconds);
    return lyrics;
  }
  return null;
}

function getLyricsCacheKey(trackTitle, artistName) {
  const t = trackTitle ? cleanMetadataString(trackTitle).toLowerCase() : "";
  const a = artistName ? cleanMetadataString(artistName).toLowerCase() : "";
  return `${t}||${a}`;
}

function showTemporaryMessage(message) {
  if (lyricsTimeoutId) {
    clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = null;
  }
  
  parsedLyrics = null;
  activeLyricIndex = -1;
  
  if (elements.lyricsScroll) {
    const p = document.createElement("p");
    p.className = "lyrics-empty";
    p.textContent = message;
    elements.lyricsScroll.replaceChildren(p);
  }
  if (elements.coverPanel) {
    elements.coverPanel.classList.remove("has-lyrics");
  }
  
  if (lyricsVisible) {
    setLyricsVisibility(true);
    lyricsTimeoutId = setTimeout(() => {
      setLyricsVisibility(false);
      lyricsTimeoutId = null;
    }, 5000);
  } else {
    setLyricsVisibility(false);
  }
}

async function fetchLyrics(track, release, isPrefetch = false) {
  if (lyricsTimeoutId) {
    clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = null;
  }

  if (!track || !release) {
    if (!isPrefetch) {
      parsedLyrics = null;
      activeLyricIndex = -1;
      renderLyrics(null);
      if (elements.coverPanel) {
        elements.coverPanel.classList.remove("has-lyrics");
      }
      setLyricsVisibility(false);
    }
    return;
  }

  const cacheKey = getLyricsCacheKey(track.title, release.artist);

  // Se já estiver no cache
  if (lyricsCache.has(cacheKey)) {
    const cached = lyricsCache.get(cacheKey);
    if (!isPrefetch) {
      if (cached.status === "success") {
        handleLyricsResponse(cached.data);
      } else if (cached.status === "empty") {
        lyricsStatusMessage = cached.message;
        showTemporaryMessage(cached.message);
      } else if (cached.status === "loading") {
        if (elements.lyricsScroll) {
          const p = document.createElement("p");
          p.className = "lyrics-empty";
          p.textContent = "Sincronizando Legenda...";
          elements.lyricsScroll.replaceChildren(p);
        }
        try {
          const data = await cached.promise;
          if (data) {
            handleLyricsResponse(data);
          } else {
            lyricsStatusMessage = "Letra indisponível para esta música";
            showTemporaryMessage("Letra indisponível para esta música");
          }
        } catch (e) {
          lyricsStatusMessage = "Letra não encontrada para esta faixa";
          showTemporaryMessage("Letra não encontrada para esta faixa");
        }
      }
    }
    return;
  }

  // Prepara exibição de carregamento
  if (!isPrefetch) {
    if (elements.lyricsScroll) {
      const p = document.createElement("p");
      p.className = "lyrics-empty";
      p.textContent = "Sincronizando Legenda...";
      elements.lyricsScroll.replaceChildren(p);
    }
    if (elements.lyricsOverlay) {
      elements.lyricsOverlay.classList.remove("plain-lyrics-mode");
    }
  }

  const artistClean = cleanMetadataString(release.artist);
  const trackClean = cleanMetadataString(track.title);
  const albumClean = release.title ? cleanMetadataString(release.title) : "";
  const duration = track.duration_seconds || 0;

  // Cria a promessa de carregamento
  const fetchPromise = (async () => {
    // Strategy 1: exact API get
    try {
      let url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistClean)}&track_name=${encodeURIComponent(trackClean)}`;
      if (albumClean) {
        url += `&album_name=${encodeURIComponent(albumClean)}`;
      }
      if (duration > 0) {
        url += `&duration=${duration}`;
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": "VinylDisplay/2.0.0 (https://github.com/heriveltogabriel/playmusic)"
        }
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn("lrclib get error, trying search:", err);
    }

    // Strategy 2: search fallback
    try {
      const query = `${artistClean} ${trackClean}`;
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "VinylDisplay/2.0.0 (https://github.com/heriveltogabriel/playmusic)"
        }
      });

      if (response.ok) {
        const results = await response.json();
        if (results && results.length > 0) {
          let bestMatch = results[0];
          if (duration > 0) {
            const closeMatch = results.find(r => Math.abs((r.duration || 0) - duration) <= 10);
            if (closeMatch) bestMatch = closeMatch;
          }
          return bestMatch;
        }
      }
    } catch (err) {
      console.error("lrclib search error:", err);
    }
    return null;
  })();

  lyricsCache.set(cacheKey, {
    status: "loading",
    promise: fetchPromise
  });

  try {
    const data = await fetchPromise;
    if (data && (data.syncedLyrics || data.plainLyrics || data.instrumental)) {
      lyricsCache.set(cacheKey, {
        status: "success",
        data: data
      });
      if (!isPrefetch) {
        handleLyricsResponse(data);
      }
    } else {
      let emptyMsg = "Letra não encontrada para esta faixa";
      if (data && data.instrumental) {
        emptyMsg = "♪ Instrumental ♪";
      }
      lyricsCache.set(cacheKey, {
        status: "empty",
        message: emptyMsg
      });
      lyricsStatusMessage = emptyMsg;
      if (!isPrefetch) {
        showTemporaryMessage(emptyMsg);
      }
    }
  } catch (err) {
    lyricsCache.set(cacheKey, {
      status: "empty",
      message: "Letra não encontrada para esta faixa"
    });
    lyricsStatusMessage = "Letra não encontrada para esta faixa";
    if (!isPrefetch) {
      showTemporaryMessage("Letra não encontrada para esta faixa");
    }
  }
}

function handleLyricsResponse(data) {
  if (lyricsTimeoutId) {
    clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = null;
  }

  activeLyricIndex = -1;
  if (data.syncedLyrics) {
    parsedLyrics = parseLRC(data.syncedLyrics);
    if (parsedLyrics) {
      if (elements.lyricsOverlay) {
        elements.lyricsOverlay.classList.remove("plain-lyrics-mode");
      }
      if (elements.coverPanel) {
        elements.coverPanel.classList.add("has-lyrics");
      }
      renderLyrics(parsedLyrics);
      setLyricsVisibility(false); // Mantém a capa de disco como padrão
      return;
    }
  }

  if (data.plainLyrics) {
    parsedLyrics = data.plainLyrics.split("\n").map(text => ({ text: text.trim() }));
    if (elements.lyricsOverlay) {
      elements.lyricsOverlay.classList.add("plain-lyrics-mode");
    }
    if (elements.coverPanel) {
      elements.coverPanel.classList.add("has-lyrics");
    }
    renderLyrics(parsedLyrics, true);
    setLyricsVisibility(false); // Mantém a capa de disco como padrão
    return;
  }

  if (data.instrumental) {
    lyricsStatusMessage = "♪ Instrumental ♪";
    showTemporaryMessage("♪ Instrumental ♪");
    return;
  }

  lyricsStatusMessage = "Letra indisponível para esta música";
  showTemporaryMessage("Letra indisponível para esta música");
}

function renderLyrics(lyrics, isPlain = false) {
  if (!elements.lyricsScroll) return;
  elements.lyricsScroll.replaceChildren();
  if (!lyrics) return;

  lyrics.forEach((line, index) => {
    const p = document.createElement("p");
    p.className = "lyrics-line";
    p.textContent = line.text || "•••";
    p.dataset.index = index;
    elements.lyricsScroll.appendChild(p);
  });
}

function updateLyricsProgress(seconds) {
  if (!parsedLyrics || parsedLyrics.length === 0 || !elements.lyricsOverlay || !elements.lyricsScroll || !elements.lyricsContainer) {
    return;
  }

  if (elements.lyricsOverlay.classList.contains("plain-lyrics-mode")) {
    return;
  }

  // Compensação de atraso dinâmica para antecipar a legenda e sincronizar com o áudio real
  const adjustedTime = seconds + lyricsLatencyOffset;

  let newActiveIndex = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (parsedLyrics[i].timeSeconds !== undefined && adjustedTime >= parsedLyrics[i].timeSeconds) {
      newActiveIndex = i;
    } else {
      break;
    }
  }

  if (newActiveIndex !== activeLyricIndex) {
    if (activeLyricIndex !== -1) {
      const prevEl = elements.lyricsScroll.querySelector(`.lyrics-line[data-index="${activeLyricIndex}"]`);
      if (prevEl) prevEl.classList.remove("active");
    }

    activeLyricIndex = newActiveIndex;

    if (activeLyricIndex !== -1) {
      const activeEl = elements.lyricsScroll.querySelector(`.lyrics-line[data-index="${activeLyricIndex}"]`);
      if (activeEl) {
        activeEl.classList.add("active");
        
        const containerHeight = elements.lyricsContainer.clientHeight;
        const lineOffsetTop = activeEl.offsetTop;
        const lineHalfHeight = activeEl.clientHeight / 2;
        const targetScroll = lineOffsetTop - (containerHeight / 2) + lineHalfHeight;
        
        elements.lyricsContainer.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: "smooth"
        });
      }
    }
  }
}

function setLyricsVisibility(visible) {
  lyricsVisible = visible;
  localStorage.setItem("lyricsVisible", visible ? "true" : "false");
  
  if (!visible && lyricsTimeoutId) {
    clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = null;
  }
  
  if (elements.lyricsOverlay) {
    if (visible) {
      elements.lyricsOverlay.classList.remove("hidden");
    } else {
      elements.lyricsOverlay.classList.add("hidden");
    }
  }
}

if (elements.albumCover) {
  elements.albumCover.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elements.coverPanel && elements.coverPanel.classList.contains("has-lyrics")) {
      setLyricsVisibility(!lyricsVisible);
    } else {
      lyricsVisible = true;
      showTemporaryMessage(lyricsStatusMessage);
    }
  });
}

if (elements.lyricsOverlay) {
  elements.lyricsOverlay.addEventListener("click", (e) => {
    e.stopPropagation();
    setLyricsVisibility(false);
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.error("Erro ao ativar tela cheia:", err);
    });
  } else {
    document.exitFullscreen();
  }
}

if (elements.fullscreenButton) {
  elements.fullscreenButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
}

if (elements.coverPanel) {
  elements.coverPanel.addEventListener("click", (e) => {
    if (
      e.target === elements.coverPanel ||
      e.target.closest(".vinyl-disc") ||
      e.target.classList.contains("vinyl-wrapper")
    ) {
      e.stopPropagation();
      toggleFullscreen();
    }
  });
}

setLyricsVisibility(lyricsVisible);


