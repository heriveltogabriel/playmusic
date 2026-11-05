// Admin do PlayVinil — Artistas (v4.2): lista de artistas e a página de cada um, com os seus
// discos, o que você mais ouve e a discografia do Discogs mostrando o que falta.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// Mesmas regras de agrupamento das Estatísticas (Neil Young & Crazy Horse → Neil Young...)
const ARTIST_RULES = [
  { pattern: /neil young/i, canonical: 'Neil Young' },
  { pattern: /rita lee/i, canonical: 'Rita Lee' },
  { pattern: /lobão/i, canonical: 'Lobão' },
  { pattern: /caetano veloso/i, canonical: 'Caetano Veloso' },
  { pattern: /paul mccartney/i, canonical: 'Paul McCartney' },
  { pattern: /kid abelha/i, canonical: 'Kid Abelha' },
  { pattern: /chico science/i, canonical: 'Chico Science & Nação Zumbi' },
  { pattern: /maria bethania|maria bethânia/i, canonical: 'Maria Bethânia' },
  { pattern: /^marina$|^marina lima$/i, canonical: 'Marina Lima' },
];
const ARTIST_DEFAULT_COVER = '/static/logo_lp_da_semana.png';
let artistOnlyMissing = false;
let artistShowAll = false; // singles e compactos ficam escondidos por padrão
let artistOnlyVinyl = true; // a coleção é de vinil: por padrão só o que saiu em vinil
let artistCurrent = null;

function artistEsc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function canonicalArtist(name) {
  const cleaned = String(name || '').replace(/\s\(\d+\)/g, '').replace(/\*/g, '').trim();
  const rule = ARTIST_RULES.find(r => r.pattern.test(cleaned));
  return rule ? rule.canonical : cleaned;
}

function artistGroups() {
  const groups = new Map();
  (state.lps || []).forEach(lp => {
    const name = canonicalArtist(lp.artist);
    if (!name || /^various$/i.test(name)) return;
    if (!groups.has(name)) groups.set(name, { name, lps: [], plays: 0, last: 0 });
    const group = groups.get(name);
    group.lps.push(lp);
    group.plays += lp.plays || 0;
    group.last = Math.max(group.last, typeof lastListenTs === 'function' ? lastListenTs(lp) : 0);
  });
  return [...groups.values()];
}

function renderArtistsIndex() {
  const index = document.getElementById('artists-index');
  const page = document.getElementById('artist-page');
  if (index) index.style.display = '';
  if (page) page.style.display = 'none';
  artistCurrent = null;
  const grid = document.getElementById('artists-grid');
  if (!grid) return;
  const query = ((document.getElementById('artists-search') || {}).value || '').trim().toLowerCase();
  const sort = (document.getElementById('artists-sort') || {}).value || 'discs';
  let groups = artistGroups();
  if (query) groups = groups.filter(g => g.name.toLowerCase().includes(query));
  groups.sort((a, b) => {
    if (sort === 'plays') return b.plays - a.plays || b.lps.length - a.lps.length;
    if (sort === 'recent') return b.last - a.last;
    if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
    return b.lps.length - a.lps.length || b.plays - a.plays;
  });
  const count = document.getElementById('artists-count');
  if (count) count.textContent = groups.length;
  grid.replaceChildren();
  groups.forEach(group => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'artist-card';
    const covers = group.lps.slice(0, 4).map(lp =>
      `<img src="${artistEsc(lp.cover_image || ARTIST_DEFAULT_COVER)}" alt="" loading="lazy" onerror="this.src='${ARTIST_DEFAULT_COVER}'">`).join('');
    card.innerHTML = `
      <div class="artist-mosaic n${Math.min(4, group.lps.length)}">${covers}</div>
      <div class="artist-card-name">${artistEsc(group.name)}</div>
      <div class="artist-card-sub">${group.lps.length} ${group.lps.length === 1 ? 'disco' : 'discos'} · ${group.plays} ${group.plays === 1 ? 'audição' : 'audições'}</div>`;
    card.addEventListener('click', () => openArtistPage(group.name));
    grid.appendChild(card);
  });
}

function openArtistForLp(lp) {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const nav = document.querySelector('[data-view="artists"]');
  if (nav) nav.click();
  openArtistPage(canonicalArtist(lp.artist));
}

function artistDuration(seconds) {
  const hours = seconds / 3600;
  return hours >= 1 ? `${hours.toFixed(1).replace('.', ',')} h` : `${Math.round(seconds / 60)} min`;
}

async function openArtistPage(name, refresh = false) {
  const group = artistGroups().find(g => g.name === name);
  const index = document.getElementById('artists-index');
  const page = document.getElementById('artist-page');
  if (!group || !page) return;
  artistCurrent = name;
  if (index) index.style.display = 'none';
  page.style.display = '';
  window.scrollTo(0, 0);

  const lps = [...group.lps].sort((a, b) => (a.original_year || a.year || 9999) - (b.original_year || b.year || 9999));
  const totalSeconds = lps.reduce((sum, lp) => {
    const disc = (lp.tracks || []).reduce((s, t) => s + (t.duration_seconds || 0), 0) || 2400;
    return sum + disc * (lp.plays || 0);
  }, 0);
  const lastTs = group.last;
  const years = lps.map(lp => lp.original_year || lp.year).filter(Boolean);
  const neverHeard = lps.filter(lp => !lp.plays).length;

  page.innerHTML = `
    <button type="button" class="cf-link artist-back">← Todos os artistas</button>
    <div class="artist-header">
      <div class="artist-mosaic big n${Math.min(4, lps.length)}">${lps.slice(0, 4).map(lp => `<img src="${artistEsc(lp.cover_image || ARTIST_DEFAULT_COVER)}" alt="" onerror="this.src='${ARTIST_DEFAULT_COVER}'">`).join('')}</div>
      <div class="artist-header-info">
        <h2 class="artist-name">${artistEsc(name)}</h2>
        <div class="artist-chips">
          <span>${lps.length} ${lps.length === 1 ? 'disco' : 'discos'}</span>
          <span>${group.plays} ${group.plays === 1 ? 'audição' : 'audições'}</span>
          <span>~${artistDuration(totalSeconds)} ouvidas</span>
          ${years.length ? `<span>${Math.min(...years)}${Math.max(...years) !== Math.min(...years) ? '–' + Math.max(...years) : ''}</span>` : ''}
          ${neverHeard ? `<span class="artist-chip-warn">${neverHeard} nunca ${neverHeard === 1 ? 'ouvido' : 'ouvidos'}</span>` : ''}
          <span>${lastTs ? 'última audição ' + new Date(lastTs).toLocaleDateString('pt-BR') : 'nunca ouvido'}</span>
        </div>
        <p id="artist-profile" class="artist-profile"></p>
      </div>
    </div>

    <div class="stats-section-card span-full artist-section">
      <h3>Seus discos</h3>
      <div class="artist-discs">${lps.map(lp => `
        <button type="button" class="artist-disc" data-id="${lp.id}">
          <img src="${artistEsc(lp.cover_image || ARTIST_DEFAULT_COVER)}" alt="" loading="lazy" onerror="this.src='${ARTIST_DEFAULT_COVER}'">
          <span class="artist-disc-title">${artistEsc(lp.title)}</span>
          <span class="artist-disc-sub">${lp.original_year || lp.year || ''} · ${lp.plays || 0} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
        </button>`).join('')}
      </div>
    </div>

    <div class="stats-section-card span-full artist-section">
      <h3>O que você mais ouve</h3>
      <div id="artist-top-tracks"><p class="profile-hint">Carregando…</p></div>
    </div>

    <div class="stats-section-card span-full artist-section">
      <div class="artist-disco-head">
        <h3>Discografia no Discogs</h3>
        <span id="artist-disco-summary" class="profile-hint"></span>
        <span class="cf-view-toggle-spacer"></span>
        <button type="button" id="artist-only-vinyl" class="cf-chip ${artistOnlyVinyl ? 'active' : ''}">Só em vinil</button>
        <button type="button" id="artist-only-missing" class="cf-chip ${artistOnlyMissing ? 'active' : ''}">Só os que faltam</button>
        <button type="button" id="artist-show-all" class="cf-chip ${artistShowAll ? 'active' : ''}">Singles e compactos</button>
        <button type="button" id="artist-refresh" class="cf-link">Atualizar do Discogs</button>
      </div>
      <div id="artist-discography"><p class="profile-hint">Buscando no Discogs…</p></div>
    </div>`;

  page.querySelector('.artist-back').addEventListener('click', renderArtistsIndex);
  page.querySelectorAll('.artist-disc').forEach(btn => btn.addEventListener('click', () => openDetailsDialog(Number(btn.dataset.id))));
  page.querySelector('#artist-only-missing').addEventListener('click', (event) => {
    artistOnlyMissing = !artistOnlyMissing;
    event.target.classList.toggle('active', artistOnlyMissing);
    renderArtistDiscography(page._discography);
  });
  page.querySelector('#artist-only-vinyl').addEventListener('click', (event) => {
    artistOnlyVinyl = !artistOnlyVinyl;
    event.target.classList.toggle('active', artistOnlyVinyl);
    renderArtistDiscography(page._discography);
  });
  page.querySelector('#artist-show-all').addEventListener('click', (event) => {
    artistShowAll = !artistShowAll;
    event.target.classList.toggle('active', artistShowAll);
    renderArtistDiscography(page._discography);
  });
  page.querySelector('#artist-refresh').addEventListener('click', () => openArtistPage(name, true));

  let data;
  try {
    const ids = lps.map(lp => lp.id).join(',');
    data = await fetch(`/api/admin/artist?release_ids=${ids}${refresh ? '&refresh=1' : ''}`).then(r => r.json());
  } catch (error) {
    data = null;
  }
  if (artistCurrent !== name) return; // trocou de artista enquanto carregava

  const top = document.getElementById('artist-top-tracks');
  const listening = data && data.listening;
  if (top) {
    if (!listening || !listening.top_tracks.length) {
      top.innerHTML = '<p class="profile-hint">As faixas aparecem aqui conforme o player acompanha os discos (o registro faixa a faixa começou na versão 4.2).</p>';
    } else {
      const byId = new Map(lps.map(lp => [lp.id, lp]));
      top.innerHTML = listening.top_tracks.map((t, i) => {
        const lp = byId.get(t.release_id);
        return `<div class="diary-top-row"><span class="diary-top-rank">${i + 1}</span>
          <div class="diary-disc-info"><div class="diary-disc-title">${artistEsc(t.position)} · ${artistEsc(t.title)}</div>
          <div class="diary-disc-artist">${artistEsc(lp ? lp.title : '')}</div></div>
          <span class="diary-top-plays">${t.plays}×</span></div>`;
      }).join('');
    }
  }

  const disco = data && data.discography;
  page._discography = disco;
  const profile = document.getElementById('artist-profile');
  const bioText = disco && disco.status === 'ok' ? (disco.artist.bio || disco.artist.profile || '') : '';
  if (profile && bioText) {
    profile.textContent = bioText;
    // Texto longo: mostra o começo e um "ler mais"
    if (bioText.length > 320) {
      profile.classList.add('clamped');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cf-link artist-profile-more';
      more.textContent = 'ler mais';
      more.addEventListener('click', () => {
        const clamped = profile.classList.toggle('clamped');
        more.textContent = clamped ? 'ler mais' : 'ler menos';
      });
      profile.after(more);
    }
    // De onde veio o texto (a Wikipédia pede o crédito com link)
    if (disco.artist.bio_source) {
      const source = document.createElement('div');
      source.className = 'artist-profile-source';
      const link = document.createElement('a');
      link.href = disco.artist.bio_url || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = disco.artist.bio_source;
      source.append('Fonte: ', link, disco.artist.bio_lang === 'en' ? ' (em inglês: não há página na Wikipédia em português)' : '');
      (profile.nextElementSibling && profile.nextElementSibling.classList.contains('artist-profile-more')
        ? profile.nextElementSibling : profile).after(source);
    }
  }
  renderArtistDiscography(disco);
}

function renderArtistDiscography(disco) {
  const box = document.getElementById('artist-discography');
  const summary = document.getElementById('artist-disco-summary');
  if (!box) return;
  if (!disco || disco.status !== 'ok') {
    box.innerHTML = `<p class="profile-hint">${artistEsc((disco && disco.message) || 'Não foi possível consultar o Discogs agora.')}</p>`;
    if (summary) summary.textContent = '';
    return;
  }
  let works = artistShowAll ? disco.works : disco.works.filter(w => w.album);
  if (artistOnlyVinyl) works = works.filter(w => w.vinyl !== false);
  if (summary) {
    // A conta é sempre sobre a lista que está na tela (vinil, singles), para bater com os ✓
    const when = new Date(disco.fetched_at * 1000).toLocaleDateString('pt-BR');
    const owned = works.filter(w => w.owned_release_ids.length).length;
    const kind = `${artistShowAll ? 'discos' : 'álbuns'}${artistOnlyVinyl ? ' em vinil' : ''}`;
    const partial = artistOnlyVinyl && disco.vinyl_total !== null && !disco.vinyl_complete ? ' (lista de vinil parcial: artista com muitas prensagens)' : '';
    summary.textContent = `você tem ${owned} de ${works.length} ${kind}${partial} · Discogs de ${when}${disco.stale ? ' (sem atualizar)' : ''}`;
  }
  if (artistOnlyMissing) works = works.filter(w => !w.owned_release_ids.length);
  if (!works.length) {
    box.innerHTML = `<p class="profile-hint">${artistOnlyMissing ? 'Você tem todos. 🎉' : 'O Discogs não lista discos deste artista.'}</p>`;
    return;
  }
  box.innerHTML = '<div class="artist-works">' + works.map(w => {
    const owned = w.owned_release_ids.length > 0;
    return `<a class="artist-work ${owned ? 'owned' : 'missing'}" href="${artistEsc(w.url)}" target="_blank" rel="noopener noreferrer"
        ${owned ? `data-owned="${w.owned_release_ids[0]}"` : ''}>
      <img class="artist-work-cover" src="${artistEsc(w.thumb || ARTIST_DEFAULT_COVER)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='${ARTIST_DEFAULT_COVER}'">
      <span class="artist-work-year">${w.year || '—'}</span>
      <span class="artist-work-title">${artistEsc(w.title)}</span>
      <span class="artist-work-mark">${owned ? '✓ na coleção' : (w.vinyl ? 'falta · tem em vinil' : (w.vinyl === false ? 'falta · só CD/digital' : 'falta'))}</span>
    </a>`;
  }).join('') + '</div>';
  // Disco que você tem abre a ficha em vez do Discogs
  box.querySelectorAll('.artist-work.owned').forEach(link => link.addEventListener('click', (event) => {
    event.preventDefault();
    openDetailsDialog(Number(link.dataset.owned));
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('artists-search');
  if (search) search.addEventListener('input', renderArtistsIndex);
  const sort = document.getElementById('artists-sort');
  if (sort) sort.addEventListener('change', renderArtistsIndex);
});
