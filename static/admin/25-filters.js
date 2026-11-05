// Admin do PlayVinil — Filtros da Minha Coleção (v4.2): gênero, década, país, formato,
// nunca ouvidos, favoritos e modo grade/lista.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// Formatos que todo disco tem não servem de filtro.
const CF_IGNORED_FORMATS = new Set(['Vinyl', 'LP', 'Album']);
const CF_VIEW_KEY = 'catalogViewMode';

function cfCount(values) {
  const counts = new Map();
  values.forEach(v => { if (v) counts.set(v, (counts.get(v) || 0) + 1); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function cfFillSelect(select, entries, current, label) {
  if (!select) return;
  const first = select.options[0];
  select.replaceChildren(first);
  entries.forEach(([value, count]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${label ? label(value) : value} (${count})`;
    select.appendChild(option);
  });
  select.value = current || '';
}

function populateCatalogFilters() {
  const lps = state.lps || [];
  cfFillSelect(document.getElementById('cf-genre'), cfCount(lps.flatMap(lp => lp.genres || [])), state.filters.genres[0]);
  const decades = cfCount(lps.map(lp => {
    const year = lp.original_year || lp.year;
    return year ? String(Math.floor(year / 10) * 10) : '';
  })).sort((a, b) => Number(a[0]) - Number(b[0]));
  cfFillSelect(document.getElementById('cf-decade'), decades, state.filters.decade, d => `Anos ${d.slice(2)} (${d})`);
  cfFillSelect(document.getElementById('cf-country'), cfCount(lps.map(lp => lp.country)), state.filters.country);
  cfFillSelect(
    document.getElementById('cf-format'),
    cfCount(lps.flatMap(lp => (lp.formats || []).filter(f => !CF_IGNORED_FORMATS.has(f)))).filter(([, n]) => n >= 2),
    state.filters.format
  );
  const never = lps.filter(lp => !lp.plays).length;
  const neverCount = document.getElementById('cf-never-count');
  if (neverCount) neverCount.textContent = never ? String(never) : '';
}

function syncCatalogFilterControls() {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
  set('cf-genre', state.filters.genres[0]);
  set('cf-decade', state.filters.decade);
  set('cf-country', state.filters.country);
  set('cf-format', state.filters.format);
  const toggle = (id, on) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  toggle('cf-never', state.filters.neverHeard);
  toggle('cf-fav', state.filters.starredOnly);
}

function setCatalogViewMode(mode) {
  const grid = document.getElementById('lp-grid');
  if (grid) grid.classList.toggle('lp-list', mode === 'list');
  document.getElementById('cf-view-grid')?.classList.toggle('active', mode !== 'list');
  document.getElementById('cf-view-list')?.classList.toggle('active', mode === 'list');
  try { localStorage.setItem(CF_VIEW_KEY, mode); } catch (e) { /* sem armazenamento: só não lembra */ }
}

function setupCatalogFilters() {
  const on = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  on('cf-genre', 'change', e => {
    state.filters.genres = e.target.value ? [e.target.value] : [];
    applyFiltersAndRender();
  });
  on('cf-decade', 'change', e => { state.filters.decade = e.target.value; applyFiltersAndRender(); });
  on('cf-country', 'change', e => { state.filters.country = e.target.value; applyFiltersAndRender(); });
  on('cf-format', 'change', e => { state.filters.format = e.target.value; applyFiltersAndRender(); });
  on('cf-never', 'click', () => {
    state.filters.neverHeard = !state.filters.neverHeard;
    syncCatalogFilterControls();
    applyFiltersAndRender();
  });
  on('cf-fav', 'click', () => {
    state.filters.starredOnly = !state.filters.starredOnly;
    syncCatalogFilterControls();
    applyFiltersAndRender();
  });
  on('cf-clear', 'click', () => resetAllFilters());
  on('cf-view-grid', 'click', () => setCatalogViewMode('grid'));
  on('cf-view-list', 'click', () => setCatalogViewMode('list'));

  let saved = 'grid';
  try { saved = localStorage.getItem(CF_VIEW_KEY) || 'grid'; } catch (e) { /* padrão: grade */ }
  setCatalogViewMode(saved);

  // A coleção chega depois do carregamento: preenche os filtros quando ela estiver pronta.
  let tries = 0;
  const wait = setInterval(() => {
    tries += 1;
    if ((state.lps && state.lps.length) || tries > 40) {
      clearInterval(wait);
      populateCatalogFilters();
      syncCatalogFilterControls();
    }
  }, 250);
}

document.addEventListener('DOMContentLoaded', setupCatalogFilters);
