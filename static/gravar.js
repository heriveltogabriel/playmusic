// v4.5.6: Modo gravação. Tela parada para os vídeos do LP da Semana: escolhe o disco,
// registra a escuta (como o "escolher à mão" do player) e alterna entre a capa do disco e
// a marca do canal. Sem microfone, sem Shazam, sem faixa nem tempo na tela.
"use strict";

const TEMPO_CAPA_MS = 40000;
const TEMPO_MARCA_MS = 15000;

const $ = (id) => document.getElementById(id);
const escolha = $("escolha");
const palco = $("palco");
const lista = $("lista");
const busca = $("busca");
const lados = $("lados");
const usarAtual = $("usar-atual");
let discos = [];

async function pedir(url, opcoes) {
  const resposta = await fetch(url, Object.assign({ credentials: "same-origin" }, opcoes || {}));
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.json();
}

function normalizar(texto) {
  return (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function desenharLista() {
  const q = normalizar(busca.value);
  const itens = (q ? discos.filter((d) => normalizar(`${d.title} ${d.artist}`).includes(q)) : discos).slice(0, 60);
  lista.replaceChildren();
  itens.forEach((disco) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "item";
    const img = document.createElement("img");
    img.src = disco.cover_url || "/static/playvinil-cover.svg";
    img.alt = "";
    img.loading = "lazy";
    const titulo = document.createElement("span");
    titulo.className = "item-titulo";
    titulo.textContent = disco.title;
    const artista = document.createElement("span");
    artista.className = "item-artista";
    artista.textContent = disco.artist;
    botao.append(img, titulo, artista);
    botao.addEventListener("click", () => mostrarLados(disco));
    lista.appendChild(botao);
  });
}

async function mostrarLados(disco) {
  const info = await pedir(`/api/ouvir/sides/${disco.id}`);
  lista.classList.add("hidden");
  busca.classList.add("hidden");
  usarAtual.classList.add("hidden");
  lados.classList.remove("hidden");
  lados.replaceChildren();
  const titulo = document.createElement("div");
  titulo.className = "lados-titulo";
  titulo.textContent = `${disco.artist} — ${disco.title}: qual lado vai começar?`;
  const botoes = document.createElement("div");
  botoes.className = "lados-botoes";
  (info.sides.length ? info.sides : [{ side: "" }]).forEach((lado, i) => {
    const b = document.createElement("button");
    b.type = "button";
    if (i === 0) b.className = "principal";
    b.textContent = lado.side ? `Lado ${lado.side}` : "Começar";
    b.addEventListener("click", () => comecar(disco.id, lado.side || ""));
    botoes.appendChild(b);
  });
  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.textContent = "Voltar";
  voltar.addEventListener("click", () => {
    lados.classList.add("hidden");
    lista.classList.remove("hidden");
    busca.classList.remove("hidden");
    if (usarAtual.dataset.ok) usarAtual.classList.remove("hidden");
  });
  botoes.appendChild(voltar);
  lados.append(titulo, botoes);
}

async function comecar(releaseId, lado) {
  let estado = null;
  try {
    const res = await pedir("/api/playback/start_manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: releaseId, side: lado }),
    });
    estado = res && res.state;
  } catch (erro) {
    // sem permissão de aparelho, por exemplo: a tela funciona igual, só não registra a escuta
    console.warn("Não deu para registrar a escuta:", erro);
  }
  const release = (estado && estado.release) || discos.find((d) => d.id === releaseId) || {};
  abrirPalco(release, lado || ladoDoEstado(estado));
}

function ladoDoEstado(estado) {
  const pos = estado && estado.track && estado.track.position ? String(estado.track.position) : "";
  const m = pos.toUpperCase().match(/^([A-Z]{1,2})\d/);
  return m ? m[1] : "";
}

// ---------- lado do disco ----------
let discoAtual = null;
let ladosDoDisco = [];
let ladoAtual = "";
function mostrarLado() {
  $("lado").textContent = ladoAtual ? `Lado ${ladoAtual}` : "";
}

// "LP DA SEMANA · VEM OUVIR COMIGO" ocupa a mesma largura do nome da banda; o álbum e o
// lado ficam alinhados à direita dessa largura
function larguraTexto(el) {
  const faixa = document.createRange();
  faixa.selectNodeContents(el);
  return faixa.getBoundingClientRect().width;
}
function ajustarTextos() {
  const banda = $("banda");
  const rotulo = $("rotulo-canal");
  const bloco = $("bloco");
  if (!banda.firstChild) return;
  bloco.style.width = "";
  rotulo.style.fontSize = "";
  // largura do bloco: o maior entre o nome da banda e o do álbum (numa linha), sem passar da
  // coluna; o rótulo laranja ocupa essa largura toda
  const album = $("album");
  album.style.whiteSpace = "nowrap";
  const sec = banda.parentElement.parentElement;
  const est = getComputedStyle(sec);
  const coluna = sec.clientWidth - parseFloat(est.paddingLeft) - parseFloat(est.paddingRight) - 8;
  const largura = Math.min(Math.max(larguraTexto(banda), larguraTexto(album)), coluna);
  album.style.whiteSpace = "";
  // a largura visível das letras (sem o espaçamento que sobra depois da última) igual à da banda
  let tamanho = parseFloat(getComputedStyle(rotulo).fontSize);
  for (let i = 0; i < 4; i++) {
    const visivel = larguraTexto(rotulo) - 0.15 * tamanho;
    if (visivel <= 0) break;
    tamanho = Math.min(80, tamanho * (largura / visivel));
    rotulo.style.fontSize = `${tamanho}px`;
  }
  // garantia: nunca passa da largura (arredondamentos de fonte)
  for (let i = 0; i < 6 && larguraTexto(rotulo) - 0.15 * tamanho > largura + 0.5; i++) {
    tamanho *= 0.98;
    rotulo.style.fontSize = `${tamanho}px`;
  }
  bloco.style.width = `${largura}px`;
}
window.addEventListener("resize", () => { if (!palco.classList.contains("hidden")) ajustarTextos(); });
async function mudarLado(passo) {
  if (!discoAtual || ladosDoDisco.length < 2) return;
  const i = Math.max(0, ladosDoDisco.indexOf(ladoAtual));
  const novo = ladosDoDisco[(i + passo + ladosDoDisco.length) % ladosDoDisco.length];
  ladoAtual = novo;
  mostrarLado();
  try {
    const res = await pedir("/api/playback/start_manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: discoAtual, side: novo }),
    });
    if (res && res.state) estadoServidor = res.state;
  } catch (e) { /* a tela segue igual */ }
}

function abrirPalco(release, lado) {
  const capa = release.cover_url || "/static/playvinil-cover.svg";
  $("capa").src = capa;
  $("rotulo").style.backgroundImage = `url("${capa}")`;
  $("rotulo-marca").style.backgroundImage = `url("${capa}")`;
  $("banda").textContent = release.artist || "";
  $("album").textContent = release.title || "";
  discoAtual = release.release_id || release.id || null;
  ladoAtual = lado || "";
  mostrarLado();
  if (discoAtual) {
    pedir(`/api/ouvir/sides/${discoAtual}`)
      .then((info) => { ladosDoDisco = (info.sides || []).map((x) => x.side).filter(Boolean); })
      .catch(() => {});
  }
  escolha.classList.add("hidden");
  palco.classList.remove("hidden");
  document.body.classList.remove("escolhendo");
  document.body.classList.add("is-playing");
  ajustarEscala();
  ajustarTextos();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarTextos);
  manterAcesa();
  alternar();
  mostrarBotoes();
  ligarOuvido();
  atualizarEstado();
  setInterval(atualizarEstado, 10000);
  setTimeout(() => $("dica").classList.add("some"), 6000);
}

// ---------- alternância das duas telas ----------
let temporizador = null;
function alternar() {
  const capa = $("tela-capa");
  const marca = $("tela-marca");
  const mostrarCapa = () => {
    capa.classList.add("visivel");
    marca.classList.remove("visivel");
    temporizador = setTimeout(mostrarMarca, TEMPO_CAPA_MS);
  };
  const mostrarMarca = () => {
    marca.classList.add("visivel");
    capa.classList.remove("visivel");
    temporizador = setTimeout(mostrarCapa, TEMPO_MARCA_MS);
  };
  clearTimeout(temporizador);
  mostrarCapa();
}

// ---------- palco de 1280x720 cabendo em qualquer tela ----------
function ajustarEscala() {
  const escala = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  $("stage").style.transform = `translate(-50%, -50%) scale(${escala})`;
}
window.addEventListener("resize", ajustarEscala);

// ---------- tela sempre acesa ----------
let trava = null;
async function manterAcesa() {
  try {
    if ("wakeLock" in navigator && !trava && document.visibilityState === "visible") {
      trava = await navigator.wakeLock.request("screen");
      trava.addEventListener("release", () => { trava = null; });
    }
  } catch (e) { /* sem suporte: segue sem */ }
}
document.addEventListener("visibilitychange", () => {
  if (!palco.classList.contains("hidden")) manterAcesa();
});

// ---------- toque: tela cheia; segurar 2 s: sair ----------
let segurando = null;
palco.addEventListener("pointerdown", () => {
  segurando = setTimeout(() => {
    segurando = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.location.href = "/";
  }, 2000);
});
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  palco.addEventListener(ev, () => {
    if (segurando) {
      clearTimeout(segurando);
      segurando = null;
      if (ev === "pointerup") toque();
    }
  })
);

function toque() {
  mostrarBotoes();
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// botões de lado: aparecem ao tocar e somem depois de 5 s (não ficam no vídeo)
let botoesTimer = null;
function mostrarBotoes() {
  const itens = [$("lado-botoes"), $("voltar-palco")];
  itens.forEach((el) => el.classList.remove("some"));
  clearTimeout(botoesTimer);
  botoesTimer = setTimeout(() => itens.forEach((el) => el.classList.add("some")), 5000);
}
["pointerdown", "pointerup"].forEach((ev) => $("voltar-palco").addEventListener(ev, (e) => e.stopPropagation()));
["lado-anterior", "lado-proximo"].forEach((id, n) => {
  $(id).addEventListener("pointerdown", (e) => e.stopPropagation());
  $(id).addEventListener("pointerup", (e) => e.stopPropagation());
  $(id).addEventListener("click", (e) => {
    e.stopPropagation();
    mostrarBotoes();
    mudarLado(n === 0 ? -1 : 1);
  });
});

// ---------- virada automática pelo silêncio (microfone só mede o volume, sem Shazam) ----------
let estadoServidor = null;
let detector = null;
async function ligarOuvido() {
  if (detector || !window.VinylSilence || !navigator.mediaDevices) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") await ctx.resume();
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analisador);
    detector = new window.VinylSilence.SilenceDetector();
    const amostras = new Uint8Array(analisador.fftSize);
    setInterval(() => {
      if (ctx.state !== "running") { ctx.resume().catch(() => {}); return; }
      analisador.getByteTimeDomainData(amostras);
      let soma = 0;
      for (let i = 0; i < amostras.length; i++) { const v = (amostras[i] - 128) / 128; soma += v * v; }
      const ev = detector.push(Math.sqrt(soma / amostras.length), Date.now());
      if (ev) somVoltou(ev);
    }, 250);
  } catch (e) {
    console.warn("Sem microfone: a virada fica pelos botões.", e);
  }
}

async function atualizarEstado() {
  try {
    estadoServidor = await pedir("/api/state");
    const lado = ladoDoEstado(estadoServidor);
    if (lado && estadoServidor.status === "playing" && lado !== ladoAtual) {
      ladoAtual = lado;
      mostrarLado();
    }
  } catch (e) { /* sem rede: tenta de novo */ }
}

async function somVoltou(ev) {
  if (!estadoServidor) return;
  // só a virada interessa aqui: pausas entre faixas e trechos baixos são ignorados
  const acao = window.VinylSilence.decideOnResume(ev, estadoServidor);
  if (acao !== "flip") return;
  try {
    const res = await pedir("/api/playback/flip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ago_seconds: (Date.now() - ev.resumedAt) / 1000, gap_seconds: Math.round(ev.gapMs / 100) / 10 }),
    });
    if (res && res.state) {
      estadoServidor = res.state;
      const lado = ladoDoEstado(res.state);
      if (lado) { ladoAtual = lado; mostrarLado(); }
    }
  } catch (e) { /* segue: os botões corrigem */ }
}

// ícones oficiais (YouTube, Instagram): enquanto o arquivo não existir, o espaço some
document.querySelectorAll(".icone-oficial").forEach((img) => {
  img.addEventListener("error", () => { img.parentElement.classList.add("hidden"); });
  if (img.complete && img.naturalWidth === 0) img.parentElement.classList.add("hidden");
});

// ---------- início ----------
async function iniciar() {
  try {
    discos = await pedir("/api/ouvir/releases");
    discos.sort((a, b) => (b.synced_at || 0) - (a.synced_at || 0));
  } catch (e) {
    discos = [];
  }
  desenharLista();
  try {
    const estado = await pedir("/api/state");
    if (estado && estado.release) {
      usarAtual.textContent = `Usar o disco que está tocando: ${estado.release.artist} — ${estado.release.title}`;
      usarAtual.dataset.ok = "1";
      usarAtual.classList.remove("hidden");
      usarAtual.addEventListener("click", () => abrirPalco(estado.release, ladoDoEstado(estado)));
    }
  } catch (e) { /* sem estado: só a lista */ }
}
busca.addEventListener("input", desenharLista);
iniciar();
