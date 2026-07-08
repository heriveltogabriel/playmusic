// ==================== STATE MANAGEMENT ====================
const state = {
  releases: [],
  agenda: [] // Array of 7 LP objects representing Domingo to Sábado
};

const AGENDA_DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  loadAgendaData();
});

// ==================== DATA LOADING ====================
async function loadAgendaData() {
  const grid = document.getElementById('agenda-grid');
  
  try {
    const response = await fetch('/api/ouvir/agenda');
    if (!response.ok) throw new Error('Falha ao obter agenda do servidor');
    
    state.agenda = await response.json();
    
    renderAgenda();
    
  } catch (error) {
    console.error('Error loading agenda data:', error);
    grid.replaceChildren();
    
    const errorEl = document.createElement('div');
    errorEl.className = 'loading-state';
    errorEl.style.color = '#ff453a';
    
    const msg = document.createElement('p');
    msg.textContent = 'Erro ao carregar agenda. Tente novamente mais tarde.';
    errorEl.appendChild(msg);
    
    grid.appendChild(errorEl);
    showToast('Não foi possível carregar a agenda.', 'error');
  }
}


// ==================== RENDERING ====================
function renderAgenda() {
  const grid = document.getElementById('agenda-grid');
  grid.replaceChildren();
  
  if (state.agenda.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'loading-state';
    empty.innerHTML = '<p>Nenhum LP na sua coleção para montar a agenda.</p>';
    grid.appendChild(empty);
    return;
  }
  
  const todayIdx = new Date().getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  
  const fragment = document.createDocumentFragment();
  
  state.agenda.forEach((lp, index) => {
    const card = document.createElement('div');
    card.className = 'agenda-card';
    if (index === todayIdx) {
      card.classList.add('today');
    }
    card.dataset.id = lp.id;
    card.dataset.index = index;
    
    // Cover image
    const coverWrapper = document.createElement('div');
    coverWrapper.className = 'lp-cover-wrapper';
    
    const coverImg = document.createElement('img');
    coverImg.className = 'lp-cover';
    coverImg.src = lp.cover_url || defaultCover;
    coverImg.alt = lp.title;
    coverImg.loading = 'lazy';
    
    coverImg.addEventListener('error', () => {
      coverImg.src = defaultCover;
    });
    
    coverWrapper.appendChild(coverImg);
    card.appendChild(coverWrapper);
    
    // Info block
    const info = document.createElement('div');
    info.className = 'lp-info';
    
    // Day Name header
    const dayHeader = document.createElement('div');
    dayHeader.className = 'agenda-day-name';
    dayHeader.textContent = AGENDA_DAYS[index];
    
    if (index === todayIdx) {
      const todayBadge = document.createElement('span');
      todayBadge.className = 'today-badge';
      todayBadge.textContent = 'HOJE';
      dayHeader.appendChild(todayBadge);
    }
    info.appendChild(dayHeader);
    
    // Title
    const title = document.createElement('div');
    title.className = 'lp-title';
    title.textContent = lp.title;
    info.appendChild(title);
    
    // Artist
    const artist = document.createElement('div');
    artist.className = 'lp-artist';
    artist.textContent = lp.artist;
    info.appendChild(artist);
    
    // Meta (plays)
    const meta = document.createElement('div');
    meta.className = 'lp-meta';
    
    const playsBadge = document.createElement('span');
    playsBadge.className = 'lp-plays-badge';
    playsBadge.id = `plays-count-${lp.id}`;
    playsBadge.appendChild(document.createTextNode('🎧 '));
    
    const playsNum = document.createElement('span');
    playsNum.className = 'plays-num-val';
    playsNum.textContent = `${lp.plays || 0} ${lp.plays === 1 ? 'audição' : 'audições'}`;
    playsBadge.appendChild(playsNum);
    
    meta.appendChild(playsBadge);
    info.appendChild(meta);
    card.appendChild(info);
    
    // Action / Status Area
    const actionArea = document.createElement('div');
    actionArea.className = 'agenda-action-area';
    actionArea.id = `action-area-${index}`;
    
    const hasBeenPlayed = lp.plays && lp.plays > 0;
    
    if (hasBeenPlayed) {
      const check = document.createElement('div');
      check.className = 'listened-check';
      check.textContent = '✓';
      check.title = 'Já escutado';
      actionArea.appendChild(check);
    } else {
      const btn = document.createElement('button');
      btn.className = 'listen-btn';
      btn.textContent = 'Ouvi';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        registerAgendaAudition(lp, index, btn);
      });
      actionArea.appendChild(btn);
    }
    
    card.appendChild(actionArea);
    fragment.appendChild(card);
  });
  
  grid.appendChild(fragment);
}

// ==================== AUDITION ACTION ====================
async function registerAgendaAudition(lp, dayIndex, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.style.opacity = '0.6';
  
  try {
    const response = await fetch(`/api/ouvir/releases/${lp.id}/listen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error('Erro ao registrar audição');
    
    const result = await response.json();
    const newCount = result.auditions !== undefined ? result.auditions : (lp.plays + 1);
    
    // Update local state
    lp.plays = newCount;
    
    // Update matching LP in state.releases (if loaded)
    if (state.releases && state.releases.length > 0) {
      const matchGlobal = state.releases.find(item => item.id === lp.id);
      if (matchGlobal) matchGlobal.plays = newCount;
    }
    
    // Update UI value immediately
    const playsCountEl = document.getElementById(`plays-count-${lp.id}`);
    if (playsCountEl) {
      const valSpan = playsCountEl.querySelector('.plays-num-val');
      if (valSpan) {
        valSpan.textContent = `${newCount} ${newCount === 1 ? 'audição' : 'audições'}`;
      }
    }
    
    // Replace action button with checkmark
    const actionArea = document.getElementById(`action-area-${dayIndex}`);
    if (actionArea) {
      actionArea.replaceChildren();
      const check = document.createElement('div');
      check.className = 'listened-check';
      check.textContent = '✓';
      check.title = 'Já escutado';
      actionArea.appendChild(check);
    }
    
    showToast(`"${lp.title}" marcado como ouvido! Total: ${newCount}`, 'success');
    
  } catch (error) {
    console.error('Error registering agenda audition:', error);
    showToast(`Falha ao registrar audição para "${lp.title}".`, 'error');
    buttonEl.disabled = false;
    buttonEl.style.opacity = '1';
  }
}

// ==================== TOAST NOTIFICATION SYSTEM ====================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // Icon
  const icon = document.createElement('div');
  icon.className = 'toast-icon';
  if (type === 'success') {
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#30d158" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#ff453a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  }
  toast.appendChild(icon);
  
  // Message
  const text = document.createElement('div');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);
  
  container.appendChild(toast);
  
  // Auto-destroy after 3 seconds
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
}

// ==================== WEEKLY LINE CHART PLOTTING ====================
function renderWeeklyLineChart(history) {
  const chartWrapper = document.querySelector('.history-chart-wrapper');
  const svg = document.getElementById('weekly-line-chart');
  const tooltip = document.getElementById('chart-tooltip');
  
  if (!svg || !history || history.length === 0) {
    if (chartWrapper) chartWrapper.style.display = 'none';
    return;
  }
  
  if (chartWrapper) chartWrapper.style.display = '';
  
  // Show last 6 weeks, ordered from oldest to newest (left to right)
  const chartWeeks = history.slice(0, 6).reverse();
  const N = chartWeeks.length;
  
  svg.replaceChildren();
  
  // SVG size parameters (viewBox="0 0 500 180")
  const width = 500;
  const height = 180;
  const paddingLeft = 55; // room for label like "7 LPs (100%)"
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 30;
  
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
  const points = chartWeeks.map((week, idx) => {
    const x = N > 1 ? paddingLeft + (idx * (chartWidth / (N - 1))) : paddingLeft + (chartWidth / 2);
    const pct = week.total > 0 ? week.listened_count / week.total : 0;
    const y = paddingTop + chartHeight - (pct * chartHeight);
    return { x, y, week, pct };
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
    // X label
    const labelX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    labelX.setAttribute('x', pt.x);
    labelX.setAttribute('y', height - 10);
    labelX.setAttribute('text-anchor', 'middle');
    labelX.setAttribute('class', 'chart-axis-text');
    labelX.textContent = pt.week.week_start;
    svg.appendChild(labelX);
    
    // Point Group
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Halo (behind)
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('cx', pt.x);
    halo.setAttribute('cy', pt.y);
    halo.setAttribute('r', 8);
    halo.setAttribute('class', 'chart-point-halo');
    g.appendChild(halo);
    
    // Center circle
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    center.setAttribute('cx', pt.x);
    center.setAttribute('cy', pt.y);
    center.setAttribute('r', 4);
    center.setAttribute('class', 'chart-point-center');
    g.appendChild(center);
    
    // Interactive trigger circle
    const trigger = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    trigger.setAttribute('cx', pt.x);
    trigger.setAttribute('cy', pt.y);
    trigger.setAttribute('r', 16);
    trigger.setAttribute('fill', 'transparent');
    trigger.setAttribute('opacity', '0');
    trigger.setAttribute('class', 'chart-point-trigger');
    
    // Hover events for tooltip
    const showTooltip = () => {
      tooltip.innerHTML = `
        <div class="chart-tooltip-week">Semana de ${pt.week.week_start} – ${pt.week.week_end}</div>
        <div>Ouvidos: <span class="chart-tooltip-score">${pt.week.listened_count} de ${pt.week.total} LPs</span> (${Math.round(pt.pct * 100)}%)</div>
      `;
      
      const svgRect = svg.getBoundingClientRect();
      const xPct = (pt.x / width) * 100;
      const yPct = (pt.y / height) * 100;
      
      tooltip.style.left = `${xPct}%`;
      tooltip.style.top = `${yPct}%`;
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translate(-50%, -120%) scale(1)';
    };
    
    const hideTooltip = () => {
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

