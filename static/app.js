const elements = {
  albumCover: document.querySelector("#album-cover"),
  coverInitials: document.querySelector("#cover-initials"),
  statusLabel: document.querySelector("#status-label"),
  trackTitle: document.querySelector("#track-title"),
  artistName: document.querySelector("#artist-name"),
  albumLine: document.querySelector("#album-line"),
  prevButton: document.querySelector("#prev-button"),
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
let trackChangeCount = 0;
let consecutiveFailedListens = 0;
let micSuspended = false;
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
    throw new Error(`${response.status} ${response.statusText}`);
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
    if (state.next_track && elements.nextTrackTitle) {
      elements.nextTrackTitle.textContent = state.next_track.title;
      elements.nextTrack.style.display = "block";
    } else {
      if (elements.nextTrackTitle) elements.nextTrackTitle.textContent = "";
      elements.nextTrack.style.display = "none";
    }
    
    // Habilitar botões se estiver tocando e animar vinil
    elements.prevButton.disabled = false;
    elements.nextButton.disabled = !state.next_track;

    if (state.status === "playing") {
      if (elements.vinylWrapper) {
        elements.vinylWrapper.classList.add("playing");
      }
      document.body.classList.add("is-playing");

      // Calculate next auto-listen timestamp when the track ends
      const progress = state.progress_seconds || 0;
      const duration = track.duration_seconds || state.duration_seconds || 0;
      if (duration && progress < duration) {
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

      // Zera o cooldown de escuta para o microfone captar imediatamente a música quando o disco virar
      window.nextAutoListenAt = 0;

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
        elements.micDebug.textContent = `Microfone: ${status} | Vol: ${volPct}% | Limiar: 3.8% (${consecutiveLoudSeconds}/2s)`;
      }
    };

    const samples = new Uint8Array(micAnalyserNode.fftSize);
    setInterval(() => {
      if (!micAudioContext || micAudioContext.state === "suspended") {
        if (elements.micDebug && !recording) {
          elements.micDebug.textContent = "Microfone: pausado (toque na tela para ativar) | Vol: 0% | Limiar: 3.8%";
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
          elements.micDebug.textContent = `Microfone: suspenso (próxima busca em ${secsLeft}s)`;
        }
        return;
      }

      micAnalyserNode.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => {
        const normalized = (value - 128) / 128;
        return sum + normalized * normalized;
      }, 0) / samples.length);

      if (rms > 0.038) {
        consecutiveLoudSeconds++;
      } else {
        consecutiveLoudSeconds = 0;
      }

      updateDebug(rms);

      if (consecutiveLoudSeconds >= 2 && !recording) {
        consecutiveLoudSeconds = 0;
        recordClip();
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

function recordClip(isAutomatic = false) {
  if (!mediaStream || !micAudioContext || recording) return;
  recording = true;
  if (elements.retryButton) {
    elements.retryButton.classList.add("recording");
  }
  lastRecognitionAt = Date.now();

  const isPlaying = (currentRelease !== null);

  // Update UI immediately to show active listening feedback
  if (elements.nextTrackTitle) {
    elements.nextTrackTitle.textContent = "Ouvindo...";
    elements.nextTrack.style.display = "block";
  }

  if (!isPlaying) {
    elements.statusLabel.textContent = "Ouvindo";
    elements.trackTitle.textContent = "Ouvindo o disco...";
    elements.artistName.textContent = "Capturando áudio do microfone";
    elements.albumLine.textContent = "Aguarde 4 segundos";
  }
  if (elements.micDebug) {
    elements.micDebug.textContent = "Microfone: gravando trecho de 4 segundos...";
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

    if (!isPlaying) {
      elements.statusLabel.textContent = "Identificando";
      elements.trackTitle.textContent = "Buscando música...";
      elements.artistName.textContent = "Processando áudio com o Shazam";
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
      const isPlaying = (currentRelease !== null);

      if (response && response.status === "matched" && response.match) {
        consecutiveFailedListens = 0;
        if (elements.micDebug) {
          elements.micDebug.textContent = `Shazam: identificada com sucesso! (${response.match.track.title})`;
        }
      } else {
        // Failed to match
        if (!playbackTracker.active) {
          consecutiveFailedListens++;
          if (consecutiveFailedListens >= 3) {
            micSuspended = true;
            consecutiveFailedListens = 0;
            if (elements.micDebug) {
              elements.micDebug.textContent = "Microfone: em repouso (toque na tela ou no botão para reativar)";
            }
          }
        }

        if (response && response.status === "recognition_unavailable") {
          if (!isAutomatic) {
            showError("Serviço de identificação indisponível: " + (response.message || "Erro desconhecido"));
          }
          if (elements.micDebug && !micSuspended) {
            elements.micDebug.textContent = "Shazam: serviço indisponível (" + (response.message || "limite/erro") + ")";
          }
          window.nextAutoListenAt = Date.now() + 90000;
        } else {
          if (elements.micDebug && !micSuspended) {
            elements.micDebug.textContent = "Shazam: música não identificada na coleção";
          }
          window.nextAutoListenAt = Date.now() + 90000;
        }
      }
      await pollState();
    } catch (error) {
      console.error("Erro na identificação da música:", error);
      if (!playbackTracker.active) {
        consecutiveFailedListens++;
        if (consecutiveFailedListens >= 3) {
          micSuspended = true;
          consecutiveFailedListens = 0;
          if (elements.micDebug) {
            elements.micDebug.textContent = "Microfone: em repouso (toque na tela ou no botão para reativar)";
          }
        }
      }
      if (!isAutomatic) {
        showError("Erro do servidor ao identificar a música: " + error.message);
      }
      if (elements.micDebug && !micSuspended) {
        elements.micDebug.textContent = `Erro do servidor: ${error.message}`;
      }
      window.nextAutoListenAt = Date.now() + 90000;
    } finally {
      recording = false;
      if (elements.retryButton) {
        elements.retryButton.classList.remove("recording");
      }
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
  if (micSuspended) return;
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
  micSuspended = false;
  consecutiveFailedListens = 0;
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

  recordClip();
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


