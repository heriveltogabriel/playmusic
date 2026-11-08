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
async function proximoLado() {
  if (!discoAtual || ladosDoDisco.length < 2) return;
  const i = ladosDoDisco.indexOf(ladoAtual);
  ladoAtual = ladosDoDisco[(i + 1) % ladosDoDisco.length];
  mostrarLado();
  try {
    await pedir("/api/playback/start_manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: discoAtual, side: ladoAtual }),
    });
  } catch (e) { /* a tela segue igual */ }
}

function abrirPalco(release, lado) {
  const capa = release.cover_url || "/static/playvinil-cover.svg";
  $("capa").src = capa;
  $("rotulo").style.backgroundImage = `url("${capa}")`;
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
  manterAcesa();
  alternar();
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
    window.location.href = "./";
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

let ultimoToque = 0;
let toqueSimples = null;
function toque() {
  const agora = Date.now();
  if (agora - ultimoToque < 400) {
    clearTimeout(toqueSimples);
    ultimoToque = 0;
    proximoLado();
    return;
  }
  ultimoToque = agora;
  toqueSimples = setTimeout(() => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, 420);
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
