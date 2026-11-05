// Admin do PlayVinil — Perfil da coleção e "Quando você ouve" (v4.2), na tela Estatísticas.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

const PROFILE_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function profileEscape(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function profileBars(title, entries, total, onPick) {
  const box = document.createElement('div');
  box.className = 'profile-block';
  const heading = document.createElement('h4');
  heading.textContent = title;
  box.appendChild(heading);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  entries.forEach(([label, count]) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'profile-bar-row';
    row.title = onPick ? 'Ver estes discos na Minha Coleção' : '';
    const pct = total ? Math.round((count / total) * 100) : 0;
    row.innerHTML = `
      <span class="profile-bar-label">${profileEscape(label)}</span>
      <span class="profile-bar-track"><span class="profile-bar-fill" style="width:${(count / max) * 100}%"></span></span>
      <span class="profile-bar-value">${count} <small>${pct}%</small></span>`;
    if (onPick) row.addEventListener('click', () => onPick(label));
    else row.disabled = true;
    box.appendChild(row);
  });
  return box;
}

function profileCount(values) {
  const counts = new Map();
  values.forEach(v => { if (v) counts.set(v, (counts.get(v) || 0) + 1); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Abre a Minha Coleção já filtrada (usa os filtros da v4.2).
function profileOpenCatalog(apply) {
  state.filters.genres = [];
  state.filters.decade = '';
  state.filters.country = '';
  state.filters.format = '';
  state.filters.neverHeard = false;
  apply();
  if (typeof syncCatalogFilterControls === 'function') syncCatalogFilterControls();
  const nav = document.querySelector('[data-view="catalog"]');
  if (nav) nav.click();
  applyFiltersAndRender();
}

function renderCollectionProfile() {
  const container = document.getElementById('collection-profile');
  if (!container) return;
  const lps = state.lps || [];
  const total = lps.length;
  container.replaceChildren();

  container.appendChild(profileBars('Gêneros', profileCount(lps.flatMap(lp => lp.genres || [])).slice(0, 8), total,
    genre => profileOpenCatalog(() => { state.filters.genres = [genre]; })));

  const decades = profileCount(lps.map(lp => {
    const year = lp.original_year || lp.year;
    return year ? `${Math.floor(year / 10) * 10}` : '';
  })).sort((a, b) => Number(a[0]) - Number(b[0]));
  container.appendChild(profileBars('Décadas (ano original)', decades.map(([d, n]) => [decadeLabel(d), n]), total,
    label => {
      const decade = decades.find(([d]) => decadeLabel(d) === label);
      profileOpenCatalog(() => { state.filters.decade = decade ? decade[0] : ''; });
    }));

  container.appendChild(profileBars('Países da prensagem', profileCount(lps.map(lp => lp.country)).slice(0, 8), total,
    country => profileOpenCatalog(() => { state.filters.country = country; })));

  const reissues = lps.filter(lp => (lp.formats || []).includes('Reissue') ||
    (lp.edition_year && lp.original_year && lp.edition_year !== lp.original_year)).length;
  const compilations = lps.filter(lp => (lp.formats || []).includes('Compilation')).length;
  const never = lps.filter(lp => !lp.plays).length;
  const editions = profileBars('Edições e escuta', [
    ['Prensagem da época', total - reissues],
    ['Reedição', reissues],
    ['Coletânea', compilations],
    ['Nunca ouvidos', never],
  ], total, label => {
    if (label === 'Nunca ouvidos') profileOpenCatalog(() => { state.filters.neverHeard = true; });
    else if (label === 'Coletânea') profileOpenCatalog(() => { state.filters.format = 'Compilation'; });
    else if (label === 'Reedição') profileOpenCatalog(() => { state.filters.format = 'Reissue'; });
  });
  container.appendChild(editions);

  renderListeningHeatmap();
}

function renderListeningHeatmap() {
  const box = document.getElementById('listening-heatmap');
  if (!box) return;
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let total = 0;
  (state.lps || []).forEach(lp => (lp.listen_dates || []).forEach(value => {
    const date = new Date(value);
    if (isNaN(date)) return;
    grid[date.getDay()][date.getHours()] += 1;
    total += 1;
  }));
  const max = Math.max(1, ...grid.flat());
  box.replaceChildren();
  if (!total) {
    box.textContent = 'Ainda não há audições registradas.';
    return;
  }

  const table = document.createElement('div');
  table.className = 'heatmap-grid';
  table.appendChild(document.createElement('span'));
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('span');
    label.className = 'heatmap-hour';
    label.textContent = h % 3 === 0 ? `${h}h` : '';
    table.appendChild(label);
  }
  grid.forEach((hours, day) => {
    const label = document.createElement('span');
    label.className = 'heatmap-day';
    label.textContent = PROFILE_WEEKDAYS[day];
    table.appendChild(label);
    hours.forEach((count, hour) => {
      const cell = document.createElement('span');
      cell.className = 'heatmap-cell';
      const level = count ? 0.18 + 0.82 * (count / max) : 0;
      cell.style.background = count ? `rgba(230, 92, 0, ${level.toFixed(2)})` : 'rgba(255,255,255,0.04)';
      cell.title = `${PROFILE_WEEKDAYS[day]} ${hour}h: ${count} ${count === 1 ? 'audição' : 'audições'}`;
      table.appendChild(cell);
    });
  });
  box.appendChild(table);

  // Resumo em palavras: o dia e a faixa de horário preferidos.
  const byDay = grid.map(h => h.reduce((a, b) => a + b, 0));
  const bestDay = byDay.indexOf(Math.max(...byDay));
  const periods = [['de madrugada', 0, 6], ['de manhã', 6, 12], ['à tarde', 12, 18], ['à noite', 18, 24]];
  const periodTotals = periods.map(([, a, b]) => grid.reduce((sum, h) => sum + h.slice(a, b).reduce((x, y) => x + y, 0), 0));
  const bestPeriod = periods[periodTotals.indexOf(Math.max(...periodTotals))][0];
  const summary = document.createElement('p');
  summary.className = 'profile-hint';
  summary.textContent = `Você ouve mais ${bestPeriod}, e o dia campeão é ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][bestDay]}. ${total} audições no total.`;
  box.appendChild(summary);
}
