const elements = {
  albumCover: document.querySelector("#album-cover"),
  coverInitials: document.querySelector("#cover-initials"),
  statusLabel: document.querySelector("#status-label"),
  trackTitle: document.querySelector("#track-title"),
  artistName: document.querySelector("#artist-name"),
  albumLine: document.querySelector("#album-line"),
  progressFill: document.querySelector("#progress-fill"),
  nextTrack: document.querySelector("#next-track"),
  syncButton: document.querySelector("#sync-button"),
  retryButton: document.querySelector("#retry-button"),
};

let mediaStream = null;
let recording = false;
let lastRecognitionAt = 0;

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

function setCover(release) {
  if (!release || !release.cover_url) {
    elements.albumCover.className = "cover-placeholder";
    elements.albumCover.replaceChildren();
    const placeholder = document.createElement("span");
    placeholder.id = "cover-initials";
    placeholder.textContent = "VINYL";
    elements.albumCover.appendChild(placeholder);
    return;
  }

  elements.albumCover.className = "";
  elements.albumCover.replaceChildren();
  const image = document.createElement("img");
  image.className = "cover-image";
  image.alt = `Capa de ${release.title}`;
  image.src = release.cover_url;
  elements.albumCover.appendChild(image);
}

function renderState(state) {
  elements.statusLabel.textContent = labelForStatus(state.status);

  if (state.status === "playing" && state.release && state.track) {
    const release = state.release;
    const track = state.track;
    const progress = state.progress_seconds || 0;
    const duration = state.duration_seconds || 0;
    const pct = duration > 0 ? Math.min(100, Math.round((progress / duration) * 100)) : 0;

    setCover(release);
    elements.trackTitle.textContent = track.title;
    elements.artistName.textContent = release.artist;
    elements.albumLine.textContent = `${release.title} · ${track.position || "Faixa"} · ${formatTime(progress)} / ${formatTime(duration)}`;
    elements.progressFill.style.width = `${pct}%`;
    elements.nextTrack.textContent = state.next_track ? `Próxima: ${state.next_track.title}` : "";
    return;
  }

  setCover(null);
  elements.progressFill.style.width = "0%";
  elements.nextTrack.textContent = "";

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

  elements.trackTitle.textContent = "Aguardando música";
  elements.artistName.textContent = "Coloque um disco para tocar";
  elements.albumLine.textContent = `${state.collection_count || 0} discos sincronizados`;
}

function labelForStatus(status) {
  const labels = {
    listening: "Ouvindo",
    identifying: "Identificando",
    playing: "Tocando",
    not_found: "Não encontrado",
    syncing: "Sincronizando",
    offline: "Offline",
  };
  return labels[status] || "Ouvindo";
}

async function pollState() {
  try {
    renderState(await fetchJson("/api/state"));
  } catch (error) {
    elements.statusLabel.textContent = "Offline";
    elements.trackTitle.textContent = "Sem conexão";
    elements.artistName.textContent = "Raspberry Pi indisponível";
  }
}

async function startMicrophone() {
  if (!window.isSecureContext) {
    elements.trackTitle.textContent = "HTTPS necessário";
    elements.artistName.textContent = "Abra esta página em HTTPS para liberar o microfone";
    return;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => {
      const normalized = (value - 128) / 128;
      return sum + normalized * normalized;
    }, 0) / samples.length);

    const enoughTimePassed = Date.now() - lastRecognitionAt > 45000;
    if (rms > 0.035 && enoughTimePassed && !recording) {
      recordClip();
    }
  }, 1000);
}

function recordClip() {
  if (!mediaStream || recording) return;
  recording = true;
  lastRecognitionAt = Date.now();

  const mimeType = preferredAudioMimeType();
  const recorder = new MediaRecorder(
    mediaStream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    try {
      await fetchJson("/api/recognize", {
        method: "POST",
        headers: { "X-Clip-Filename": "clip.webm" },
        body: blob,
      });
      await pollState();
    } finally {
      recording = false;
    }
  };
  recorder.start();
  window.setTimeout(() => recorder.stop(), 10000);
}

function preferredAudioMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

elements.syncButton.addEventListener("click", async () => {
  elements.statusLabel.textContent = "Sincronizando";
  await fetchJson("/api/sync", { method: "POST" });
  await pollState();
});

elements.retryButton.addEventListener("click", () => {
  recordClip();
});

pollState();
setInterval(pollState, 2000);
startMicrophone().catch((error) => {
  elements.trackTitle.textContent = "Microfone bloqueado";
  elements.artistName.textContent = error.message;
});
