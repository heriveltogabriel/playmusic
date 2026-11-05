// Admin do PlayVinil — Histórico de audições e gráficos semanais.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== PLAYS HISTORY TIMELINE ====================

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function setupPlaysHistoryFilters() {
  const startSelect = document.getElementById('plays-history-filter-start');
  const endSelect = document.getElementById('plays-history-filter-end');
  if (!startSelect || !endSelect) return;

  // Extract all listen dates and addition dates to find the absolute oldest date in the collection
  let oldestDate = new Date();
  state.lps.forEach(lp => {
    // Check when it was added
    if (lp.date_added) {
      const added = new Date(lp.date_added);
      if (!isNaN(added) && added < oldestDate) oldestDate = added;
    }
    // Check when it was listened to
    if (lp.listen_dates && lp.listen_dates.length > 0) {
      lp.listen_dates.forEach(dStr => {
        const d = new Date(dStr);
        if (!isNaN(d) && d < oldestDate) oldestDate = d;
      });
    }
  });

  const today = new Date();
  const chronological = [];
  let current = new Date(oldestDate.getFullYear(), oldestDate.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 1);
  
  while (current <= end) {
    chronological.push({
      year: current.getFullYear(),
      month: current.getMonth(),
      label: `${MONTHS_PT[current.getMonth()]} de ${current.getFullYear()}`,
    });
    current.setMonth(current.getMonth() + 1);
  }

  // Populate
  startSelect.innerHTML = '';
  endSelect.innerHTML = '';

  chronological.forEach(m => {
    const val = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
    const optS = document.createElement('option');
    optS.value = val;
    optS.textContent = m.label;
    startSelect.appendChild(optS);

    const optE = document.createElement('option');
    optE.value = val;
    optE.textContent = m.label;
    endSelect.appendChild(optE);
  });

  // Default: last 12 months (or less if history is shorter)
  const defaultStartIdx = Math.max(0, chronological.length - 12);
  if (chronological.length > 0) {
    const startM = chronological[defaultStartIdx];
    const endM = chronological[chronological.length - 1];
    startSelect.value = `${startM.year}-${String(startM.month + 1).padStart(2, '0')}`;
    endSelect.value = `${endM.year}-${String(endM.month + 1).padStart(2, '0')}`;
  }

  startSelect.addEventListener('change', renderPlaysHistory);
  endSelect.addEventListener('change', renderPlaysHistory);

  // v4.4.4: atalhos de período no lugar das duas listas de meses (abre em "1 ano", o padrão acima)
  document.querySelectorAll('#plays-history-pills .stats-period-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.months === '12');
    if (pill.dataset.bound) return;
    pill.dataset.bound = '1';
    pill.addEventListener('click', () => {
      const options = [...startSelect.options];
      if (!options.length) return;
      const months = pill.dataset.months;
      const startIdx = months === 'all' ? 0 : Math.max(0, options.length - parseInt(months, 10));
      startSelect.value = options[startIdx].value;
      endSelect.value = options[options.length - 1].value;
      document.querySelectorAll('#plays-history-pills .stats-period-pill').forEach(p => p.classList.toggle('active', p === pill));
      renderPlaysHistory();
    });
  });
}

function getWeekStartEnd(dateObj) {
  const d = new Date(dateObj);
  const day = d.getDay(); // 0 is Sunday
  const diff = d.getDate() - day; // adjust to Sunday
  
  const start = new Date(d.setDate(diff));
  start.setHours(0,0,0,0);
  
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23,59,59,999);
  
  return { start, end };
}

function formatWeekLabel(start, end) {
  const sDay = String(start.getDate()).padStart(2, '0');
  const sMo = String(start.getMonth() + 1).padStart(2, '0');
  const eDay = String(end.getDate()).padStart(2, '0');
  const eMo = String(end.getMonth() + 1).padStart(2, '0');
  return `SEMANA DE ${sDay}/${sMo} A ${eDay}/${eMo}`;
}

function renderPlaysHistory() {
  const container = document.getElementById('plays-history-container');
  if (!container) return;

  const startSelect = document.getElementById('plays-history-filter-start');
  const endSelect = document.getElementById('plays-history-filter-end');
  
  // Extract all listen dates from all LPs
  const allPlays = [];
  state.lps.forEach(lp => {
    if (lp.listen_dates && lp.listen_dates.length > 0) {
      lp.listen_dates.forEach(dStr => {
        const d = new Date(dStr);
        if (!isNaN(d)) {
          allPlays.push({
            dateObj: d,
            lp: lp
          });
        }
      });
    }
  });

  // Filter by date dropdowns
  let startMonthStr = startSelect ? startSelect.value : null;
  let endMonthStr = endSelect ? endSelect.value : null;

  let filteredPlays = allPlays;
  if (startMonthStr && endMonthStr) {
    const [sY, sM] = startMonthStr.split('-').map(Number);
    const [eY, eM] = endMonthStr.split('-').map(Number);
    
    const filterStart = new Date(sY, sM - 1, 1, 0, 0, 0);
    const filterEnd = new Date(eY, eM, 0, 23, 59, 59); // last day of end month

    filteredPlays = allPlays.filter(p => p.dateObj >= filterStart && p.dateObj <= filterEnd);
  }

  // Sort descending
  filteredPlays.sort((a, b) => b.dateObj - a.dateObj);

  if (filteredPlays.length === 0) {
    container.innerHTML = '<div class="text-muted" style="text-align: center; padding: 40px 0;">Nenhuma audição no período selecionado.</div>';
    return;
  }

  // Group by Month -> Week
  // Structure: { "2026-06": { label: "JUNHO DE 2026", totalPlays: 0, weeks: { "weekKey": { label: "SEMANA...", plays: [], totalPlays: 0 } } } }
  
  const grouped = {};
  const monthOrder = []; // maintain descending order

  filteredPlays.forEach(play => {
    const d = play.dateObj;
    const mKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    
    if (!grouped[mKey]) {
      grouped[mKey] = {
        label: `${MONTHS_PT[d.getMonth()].toUpperCase()} DE ${d.getFullYear()}`,
        totalPlays: 0,
        weeks: {},
        weekOrder: []
      };
      monthOrder.push(mKey);
    }
    
    grouped[mKey].totalPlays++;
    
    const { start, end } = getWeekStartEnd(d);
    const wKey = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    
    if (!grouped[mKey].weeks[wKey]) {
      grouped[mKey].weeks[wKey] = {
        label: formatWeekLabel(start, end),
        totalPlays: 0,
        plays: []
      };
      grouped[mKey].weekOrder.push(wKey);
    }
    
    grouped[mKey].weeks[wKey].totalPlays++;
    grouped[mKey].weeks[wKey].plays.push(play);
  });

  container.innerHTML = '';
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

  let isFirstMonth = true;

  monthOrder.forEach(mKey => {
    const monthData = grouped[mKey];
    
    const monthDetails = document.createElement('details');
    monthDetails.className = 'history-month-group';
    if (isFirstMonth) {
      monthDetails.open = true;
    }

    const monthSummary = document.createElement('summary');
    monthSummary.className = 'history-month-summary';
    monthSummary.innerHTML = `${monthData.label} - ${monthData.totalPlays} AUDIÇÕES`;
    monthDetails.appendChild(monthSummary);

    let isFirstWeek = true;

    monthData.weekOrder.forEach(wKey => {
      const weekData = monthData.weeks[wKey];
      
      const weekDetails = document.createElement('details');
      weekDetails.className = 'history-week-group';
      // Open the most recent week of the most recent month
      if (isFirstMonth && isFirstWeek) {
        weekDetails.open = true;
      }

      const weekSummary = document.createElement('summary');
      weekSummary.className = 'history-week-summary';
      weekSummary.innerHTML = `${weekData.label} - ${weekData.totalPlays} AUDIÇÕES`;
      weekDetails.appendChild(weekSummary);

      const playsList = document.createElement('div');
      playsList.className = 'history-plays-list';

      const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
      const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

      weekData.plays.forEach(play => {
        const lp = play.lp;
        const d = play.dateObj;
        
        const playItem = document.createElement('div');
        playItem.className = 'history-play-item';
        
        const wDay = weekdays[d.getDay()];
        const hrs = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');

        playItem.innerHTML = `
          <img class="history-play-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
          <div class="history-play-details">
            <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
              <span class="history-play-title">${lp.title}</span>
              <span class="history-play-artist">- ${lp.artist}</span>
            </div>
            <div class="history-play-meta" style="display: flex; align-items: center; gap: 5px;">
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" style="opacity: 0.7; flex-shrink: 0;">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
              </svg>
              <span>ouvido na ${wDay} às ${hrs}:${mins}</span>
            </div>
          </div>
          <div class="history-play-count">1 audição</div>
        `;

        playsList.appendChild(playItem);
      });

      weekDetails.appendChild(playsList);
      monthDetails.appendChild(weekDetails);

      isFirstWeek = false;
    });

    container.appendChild(monthDetails);
    isFirstMonth = false;
  });

}

// ==================== HISTÓRICO SEMANAL (GRÁFICO) ====================

// ==================== HISTÓRICO SEMANAL (AGENDAS) ====================
async function renderWeeklyHistory() {
  const chartContainer = document.getElementById('weekly-history-chart');
  const listContainer = document.getElementById('weekly-history-list');
  if (!chartContainer || !listContainer) return;
  
  if (state.lps.length === 0) {
    chartContainer.innerHTML = '';
    listContainer.innerHTML = '';
    return;
  }

  // 1. Obter agendas históricas do backend
  let historicalAgendas = {};
  try {
    const response = await fetch('/api/admin/historical_agendas');
    if (response.ok) {
      historicalAgendas = await response.json();
    }
  } catch (e) {
    console.error('Erro ao buscar histórico de agendas', e);
  }

  // Setup filter change listener once
  const filterSelect = document.getElementById('weekly-history-filter');
  if (filterSelect && !filterSelect.dataset.listenerAdded) {
    filterSelect.addEventListener('change', () => {
      renderWeeklyHistory();
    });
    filterSelect.dataset.listenerAdded = 'true';
  }
  
  const filterValue = filterSelect ? filterSelect.value : '6';
  const sortedWeekKeys = Object.keys(historicalAgendas).sort();
  
  // Filter based on selected timeframe
  let recentWeekKeys = sortedWeekKeys;
  if (filterValue !== 'all') {
    const monthsLimit = parseInt(filterValue, 10);
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsLimit);
    cutoffDate.setHours(0, 0, 0, 0);
    
    recentWeekKeys = sortedWeekKeys.filter(weekKeyStr => {
      const parts = weekKeyStr.split('-');
      const weekStartDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      return weekStartDate >= cutoffDate;
    });
  }
  
  if (recentWeekKeys.length === 0) {
    chartContainer.innerHTML = '<p class="text-muted" style="margin-left:10px;">O histórico está vazio para o período selecionado.</p>';
    listContainer.innerHTML = '';
    return;
  }

  chartContainer.innerHTML = '';
  listContainer.innerHTML = '';

  const now = new Date();
  const currentWeekStart = new Date(now);
  currentWeekStart.setDate(now.getDate() - now.getDay());
  currentWeekStart.setHours(0, 0, 0, 0);
  
  const yyyy = currentWeekStart.getFullYear();
  const mm = (currentWeekStart.getMonth() + 1).toString().padStart(2, '0');
  const dd = currentWeekStart.getDate().toString().padStart(2, '0');
  const currentWeekKey = `${yyyy}-${mm}-${dd}`;
  
  // Array com dados processados para o gráfico e os cards
  const weeksData = [];

  recentWeekKeys.forEach(weekKeyStr => {
    const parts = weekKeyStr.split('-');
    const startDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    
    const lpIds = historicalAgendas[weekKeyStr];
    
    // Associar os IDs aos LPs do state.lps e verificar quem foi ouvido na semana
    let listenedCount = 0;
    const lpsData = lpIds.map(id => {
      const lp = state.lps.find(l => l.id == id);
      if (!lp) return null;
      
      const wasListened = Array.isArray(lp.listen_dates) && lp.listen_dates.some(ds => {
        const d = new Date(ds);
        return d >= startDate && d <= endDate;
      });
      
      if (wasListened) listenedCount++;
      
      return { lp, wasListened };
    }).filter(Boolean);
    
    weeksData.push({
      key: weekKeyStr,
      startDate,
      endDate,
      lpsData,
      listenedCount,
      totalCount: lpIds.length // should be 7
    });
  });

  // 2. Montar Gráfico de Linhas SVG
  renderWeeklyHistorySvg(chartContainer, weeksData);

  // 3. Montar a lista de cards (do mais novo para o mais antigo)
  const reversedWeeks = [...weeksData].reverse();
  
  reversedWeeks.forEach(wd => {
    const isCurrentWeek = wd.key === currentWeekKey;
    // v4.4.1: a semana atual já aparece na lista de cima; aqui ficam só as anteriores
    if (isCurrentWeek) return;
    const fmt = d => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    const rangeText = `${fmt(wd.startDate)} a ${fmt(wd.endDate)}`;
    const titleText = isCurrentWeek ? `Esta Semana (${rangeText})` : `Semana de ${rangeText}`;
    
    const details = document.createElement('details');
    details.className = 'weekly-history-details';
    if (isCurrentWeek) details.open = true;
    
    const isPerfect = wd.listenedCount === 7;
    const medalHtml = isPerfect ? `<span class="perfect-week-medal-admin" title="Semana Perfeita! 🎉" style="margin-left: 8px; filter: drop-shadow(0 0 4px rgba(230, 92, 0, 0.4)); font-size: 1.1rem; vertical-align: middle;">🏆</span>` : '';
    
    const summary = document.createElement('summary');
    summary.className = 'weekly-history-summary';
    summary.innerHTML = `
      <div class="weekly-history-summary-left">
        <span class="weekly-history-summary-title">${titleText}</span>
        ${medalHtml}
      </div>
      <div class="weekly-history-summary-right">
        <span class="weekly-history-summary-count">${wd.listenedCount} de 7 ouvidos</span>
      </div>
    `;
    details.appendChild(summary);
    
    // v4.4.1: dentro de cada semana, a mesma lista de dias da Escuta da Semana
    const playsList = document.createElement('div');
    playsList.className = 'weekly-history-plays-list agenda-list';
    const esc = (text) => {
      const div = document.createElement('div');
      div.textContent = text == null ? '' : String(text);
      return div.innerHTML;
    };
    const defaultCover = '/static/playvinil-cover.svg';

    wd.lpsData.forEach((item, dayIndex) => {
      const lp = item.lp;
      const date = new Date(wd.startDate);
      date.setDate(wd.startDate.getDate() + dayIndex);
      const row = document.createElement('div');
      row.className = `agenda-row ${item.wasListened ? 'agenda-done' : 'agenda-missed'}`;
      row.innerHTML = `
        <div class="agenda-row-day">
          <span class="agenda-row-dayname">${AGENDA_DAYS[dayIndex].slice(0, 3)}</span>
          <span class="agenda-row-date">${fmt(date)}</span>
        </div>
        <img class="agenda-row-cover" src="${esc(lp.thumbnail || lp.cover_image || defaultCover)}" alt="" loading="lazy" onerror="this.onerror=null; this.src='${defaultCover}'">
        <div class="agenda-row-info">
          <div class="agenda-row-title">${esc(lp.title)}</div>
          <div class="agenda-row-artist">${esc(lp.artist)}</div>
          <span class="agenda-status ${item.wasListened ? 'done' : 'missed'}">${item.wasListened ? '✓ Ouvido' : 'Não ouvido'}</span>
        </div>`;
      if (lp.id) row.addEventListener('click', () => openDetailsDialog(lp.id));
      playsList.appendChild(row);
    });

    details.appendChild(playsList);
    listContainer.appendChild(details);
  });
}

// ==================== WEEKLY HISTORY SVG LINE CHART ====================
function renderWeeklyHistorySvg(svg, weeksData) {
  const tooltip = document.getElementById('chart-tooltip');
  const N = weeksData.length;
  
  svg.replaceChildren();
  
  // SVG size parameters (viewBox="0 0 1000 200")
  const width = 1000;
  const height = 200;
  const paddingLeft = 60;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 35;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  // Create definitions (gradients)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  
  // Line Gradient
  const lineGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  lineGrad.setAttribute('id', 'chart-line-grad');
  lineGrad.setAttribute('x1', '0%');
  lineGrad.setAttribute('y1', '0%');
  lineGrad.setAttribute('x2', '100%');
  lineGrad.setAttribute('y2', '0%');
  
  const lineStop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  lineStop1.setAttribute('offset', '0%');
  lineStop1.setAttribute('stop-color', '#e65c00'); // var(--primary)
  
  const lineStop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  lineStop2.setAttribute('offset', '100%');
  lineStop2.setAttribute('stop-color', '#ff751a'); // var(--primary-hover)
  
  lineGrad.appendChild(lineStop1);
  lineGrad.appendChild(lineStop2);
  defs.appendChild(lineGrad);
  
  // Area Gradient
  const areaGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  areaGrad.setAttribute('id', 'chart-area-grad');
  areaGrad.setAttribute('x1', '0%');
  areaGrad.setAttribute('y1', '0%');
  areaGrad.setAttribute('x2', '0%');
  areaGrad.setAttribute('y2', '100%');
  
  const areaStop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  areaStop1.setAttribute('offset', '0%');
  areaStop1.setAttribute('stop-color', '#e65c00');
  areaStop1.setAttribute('stop-opacity', '0.22');
  
  const areaStop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  areaStop2.setAttribute('offset', '100%');
  areaStop2.setAttribute('stop-color', '#e65c00');
  areaStop2.setAttribute('stop-opacity', '0.00');
  
  areaGrad.appendChild(areaStop1);
  areaGrad.appendChild(areaStop2);
  defs.appendChild(areaGrad);
  
  svg.appendChild(defs);
  
  // Reference Y values: 0%, 50% (3.5 LPs), 100% (7 LPs)
  const yValues = [
    { val: 0, pct: 0, label: '0 LPs' },
    { val: 3.5, pct: 0.5, label: '50%' },
    { val: 7, pct: 1.0, label: '7 LPs' }
  ];
  
  // 1. Draw horizontal grid lines and Y axis labels
  yValues.forEach(item => {
    const y = paddingTop + chartHeight - (item.pct * chartHeight);
    
    // Grid line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', paddingLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width - paddingRight);
    line.setAttribute('y2', y);
    line.setAttribute('class', item.pct === 0 ? 'chart-grid-line' : 'chart-grid-line-dashed');
    svg.appendChild(line);
    
    // Y label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', paddingLeft - 8);
    text.setAttribute('y', y + 3.5);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'chart-axis-text');
    text.textContent = item.label;
    svg.appendChild(text);
  });
  
  // 2. Map data points
  const points = weeksData.map((wd, idx) => {
    const x = N > 1 ? paddingLeft + (idx * (chartWidth / (N - 1))) : paddingLeft + (chartWidth / 2);
    const pct = wd.listenedCount / 7;
    const y = paddingTop + chartHeight - (pct * chartHeight);
    return { x, y, wd, pct };
  });
  
  // 3. Draw area and line paths (only if N > 1 to form a line)
  if (N > 1) {
    let pathD = `M ${points[0].x} ${points[0].y}`;
    let areaD = `M ${points[0].x} ${paddingTop + chartHeight} L ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < N; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
      areaD += ` L ${points[i].x} ${points[i].y}`;
    }
    
    areaD += ` L ${points[N - 1].x} ${paddingTop + chartHeight} Z`;
    
    // Draw area first
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', areaD);
    areaPath.setAttribute('fill', 'url(#chart-area-grad)');
    svg.appendChild(areaPath);
    
    // Draw line glow
    const lineGlow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lineGlow.setAttribute('d', pathD);
    lineGlow.setAttribute('class', 'chart-line-glow');
    svg.appendChild(lineGlow);
    
    // Draw line main
    const lineMain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lineMain.setAttribute('d', pathD);
    lineMain.setAttribute('stroke', 'url(#chart-line-grad)');
    lineMain.setAttribute('class', 'chart-line-main');
    svg.appendChild(lineMain);
  }
  
  // 4. Draw X-axis labels and data points
  points.forEach((pt, idx) => {
    const startDay = pt.wd.startDate.getDate().toString().padStart(2, '0');
    const startMonth = (pt.wd.startDate.getMonth() + 1).toString().padStart(2, '0');
    const label = `${startDay}/${startMonth}`;
    
    // X label
    const labelX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    labelX.setAttribute('x', pt.x);
    labelX.setAttribute('y', height - 10);
    labelX.setAttribute('text-anchor', 'middle');
    labelX.setAttribute('class', 'chart-axis-text');
    labelX.textContent = label;
    svg.appendChild(labelX);
    
    // Point Group
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Halo
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('cx', pt.x);
    halo.setAttribute('cy', pt.y);
    halo.setAttribute('r', 8);
    halo.setAttribute('class', 'chart-point-halo');
    g.appendChild(halo);
    
    // Center
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    center.setAttribute('cx', pt.x);
    center.setAttribute('cy', pt.y);
    center.setAttribute('r', 4);
    center.setAttribute('class', 'chart-point-center');
    g.appendChild(center);
    
    // Trigger
    const trigger = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    trigger.setAttribute('cx', pt.x);
    trigger.setAttribute('cy', pt.y);
    trigger.setAttribute('r', 16);
    trigger.setAttribute('fill', 'transparent');
    trigger.setAttribute('opacity', '0');
    trigger.setAttribute('class', 'chart-point-trigger');
    
    // Hover events for tooltip
    const showTooltip = () => {
      if (!tooltip) return;
      const endDay = pt.wd.endDate.getDate().toString().padStart(2, '0');
      const endMonth = (pt.wd.endDate.getMonth() + 1).toString().padStart(2, '0');
      
      tooltip.innerHTML = `
        <div class="chart-tooltip-week">Semana de ${label} a ${endDay}/${endMonth}</div>
        <div>Ouvidos: <span class="chart-tooltip-score">${pt.wd.listenedCount} de 7 LPs</span> (${Math.round(pt.pct * 100)}%)</div>
      `;
      
      const xPct = (pt.x / width) * 100;
      const yPct = (pt.y / height) * 100;
      
      tooltip.style.left = `${xPct}%`;
      tooltip.style.top = `${yPct}%`;
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translate(-50%, -120%) scale(1)';
    };
    
    const hideTooltip = () => {
      if (!tooltip) return;
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'translate(-50%, -120%) scale(0.95)';
    };
    
    trigger.addEventListener('pointerenter', showTooltip);
    trigger.addEventListener('pointerleave', hideTooltip);
    trigger.addEventListener('touchstart', (e) => {
      e.preventDefault();
      showTooltip();
    }, { passive: false });
    
    document.addEventListener('touchstart', (e) => {
      if (e.target !== trigger) {
        hideTooltip();
      }
    });
    
    g.appendChild(trigger);
    svg.appendChild(g);
  });
}
