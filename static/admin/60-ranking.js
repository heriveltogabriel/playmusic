// Admin do PlayVinil — Ranking de audições.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== RANKING DE AUDIÇÕES PAGE ====================
function renderPlaysRankingPage() {
  const podiumContainer = document.getElementById('ranking-podium');
  const emptyState = document.getElementById('ranking-empty-state');
  const listSection = document.getElementById('ranking-list-section');
  const playsChartContainer = document.getElementById('plays-chart-container');
  
  if (!podiumContainer || !emptyState || !listSection || !playsChartContainer) return;

  // Calcular estatísticas: semana, mês, todos (soma dos ouvidos)
  const now = new Date();
  
  // Semana calendário: inicia no domingo (00:00:00.000) e vai até o sábado (23:59:59.999)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  
  // Mês calendário: do dia 1 do mês atual às 00:00:00
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  
  let weekCount = 0;
  let monthCount = 0;
  let totalCount = 0;
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  const weekdayPlays = [[], [], [], [], [], [], []];
  
  state.lps.forEach(lp => {
    if (lp.listen_dates && Array.isArray(lp.listen_dates)) {
      lp.listen_dates.forEach(dateStr => {
        try {
          const d = new Date(dateStr);
          const t = d.getTime();
          if (!isNaN(t)) {
            totalCount++;
            if (t >= startOfWeek.getTime() && t <= endOfWeek.getTime()) {
              // Só conta na semana se também estiver no mês corrente
              if (t >= startOfMonth.getTime()) {
                weekCount++;
              }
              const wDayIndex = d.getDay();
              if (wDayIndex >= 0 && wDayIndex < 7) {
                weekdayCounts[wDayIndex]++;
                weekdayPlays[wDayIndex].push({ lp, dateStr });
              }
            }
            if (t >= startOfMonth.getTime()) {
              monthCount++;
            }
          }
        } catch (e) {
          console.error("Erro ao converter data de audição:", dateStr, e);
        }
      });
    }
  });
  
  const statWeekEl = document.getElementById('ranking-stat-week');
  const statMonthEl = document.getElementById('ranking-stat-month');
  const statTotalEl = document.getElementById('ranking-stat-total');
  
  if (statWeekEl) statWeekEl.textContent = weekCount;
  if (statMonthEl) statMonthEl.textContent = monthCount;
  if (statTotalEl) statTotalEl.textContent = totalCount;

  // Renderizar a régua semanal por dia
  const activityGridEl = document.getElementById('weekly-activity-grid');
  if (activityGridEl) {
    activityGridEl.innerHTML = '';
    const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const todayIndex = now.getDay();
    
    dayLabels.forEach((label, idx) => {
      const card = document.createElement('div');
      card.className = 'weekly-day-card';
      if (idx === todayIndex) {
        card.classList.add('active-today');
      }
      
      const count = weekdayCounts[idx];
      if (count > 0) {
        card.classList.add('has-plays');
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
          openWeeklyPlaysDialog(label, weekdayPlays[idx]);
        });
      }
      
      card.innerHTML = `
        <span class="weekly-day-label">${label}</span>
        <span class="weekly-day-value">${count}</span>
      `;
      activityGridEl.appendChild(card);
    });
  }
  
  // Sort LPs by latest audition date descending
  const getLatestListenDate = (lp) => {
    if (!lp.listen_dates || lp.listen_dates.length === 0) return "";
    const dates = Array.isArray(lp.listen_dates) ? lp.listen_dates : [lp.listen_dates];
    return dates[dates.length - 1] || "";
  };

  const sorted = state.lps
    .filter(lp => lp.plays > 0)
    .sort((a, b) => {
      if (b.plays !== a.plays) {
        return b.plays - a.plays;
      }
      const dateA = getLatestListenDate(a);
      const dateB = getLatestListenDate(b);
      if (dateA && dateB) {
        return dateB.localeCompare(dateA);
      }
      if (dateA) return -1;
      if (dateB) return 1;
      return a.title.localeCompare(b.title);
    });
    
  if (sorted.length === 0) {
    podiumContainer.innerHTML = '';
    podiumContainer.style.display = 'none';
    listSection.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';
  podiumContainer.style.display = 'flex';
  podiumContainer.innerHTML = '';
  
  // 1. Render Podium (Silver - Gold - Bronze)
  const renderPodiumStep = (lp, rank, positionClass, crownEmoji) => {
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    
    if (!lp) {
      // Empty slot placeholder
      return `
        <div class="podium-step ${positionClass} empty">
          <div class="podium-cover-wrapper">
            <div class="podium-crown" style="opacity: 0.2;">👑</div>
            <div class="podium-cover" style="background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; box-shadow: none;">
              <svg viewBox="0 0 24 24" width="36" height="36" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" fill="none">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <span class="podium-badge">#${rank}</span>
          </div>
          <div class="podium-column">
            <div class="podium-info">
              <div class="podium-title" style="color: var(--text-muted); font-style: italic;">Espaço Vazio</div>
              <div class="podium-artist" style="color: var(--text-muted);">-</div>
              <div class="podium-plays" style="color: var(--text-muted);">0 audições</div>
            </div>
          </div>
        </div>
      `;
    }
    
    const latestDate = getLatestListenDate(lp);
    let dateStr = "";
    if (latestDate) {
      const d = new Date(latestDate);
      if (!isNaN(d.getTime())) {
        const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
        const wDay = weekdays[d.getDay()];
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        dateStr = `${wDay} ${day}/${month} ${hours}:${minutes}`;
      }
    }

    return `
      <div class="podium-step ${positionClass}" data-lp-id="${lp.id}">
        <div class="podium-cover-wrapper">
          <div class="podium-crown">${crownEmoji}</div>
          <img class="podium-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
          <span class="podium-badge">#${rank}</span>
        </div>
        <div class="podium-column">
          <div class="podium-info">
            <div class="podium-title" title="${lp.title}">${lp.title}</div>
            <div class="podium-artist" title="${lp.artist}">${lp.artist}</div>
            <div class="podium-plays" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
              <span style="font-weight: 600;">${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
              ${dateStr ? `<span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal; margin-top: 1px;">última: ${dateStr}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  };
  
  // Athletic layout: Silver (2nd) - Gold (1st) - Bronze (3rd)
  const silverHtml = renderPodiumStep(sorted[1], 2, 'silver', '🥈');
  const goldHtml = renderPodiumStep(sorted[0], 1, 'gold', '👑');
  const bronzeHtml = renderPodiumStep(sorted[2], 3, 'bronze', '🥉');
  
  podiumContainer.innerHTML = silverHtml + goldHtml + bronzeHtml;
  
  // Add click listeners to active steps
  podiumContainer.querySelectorAll('.podium-step:not(.empty)').forEach(step => {
    step.addEventListener('click', () => {
      const lpId = step.dataset.lpId;
      if (lpId) {
        openDetailsDialog(lpId);
      }
    });
  });
  
  // 2. Render full plays chart below the podium
  listSection.style.display = 'block';
  renderPlaysChart();
  setupPlaysHistoryFilters();
  renderPlaysHistory();
}

function openWeeklyPlaysDialog(dayName, plays) {
  const dialog = document.getElementById('weekly-plays-dialog');
  const titleEl = document.getElementById('weekly-plays-title');
  const listEl = document.getElementById('weekly-plays-list');
  
  if (!dialog || !titleEl || !listEl) return;
  
  titleEl.textContent = `Discos ouvidos: ${dayName}`;
  listEl.innerHTML = '';
  
  if (!plays || plays.length === 0) {
    listEl.innerHTML = '<div class="text-muted italic" style="padding: 12px; text-align: center;">Nenhuma audição registrada neste dia.</div>';
    dialog.showModal();
    return;
  }
  
  // Ordena do horário mais recente para o mais antigo (maior hora para menor)
  const sortedPlays = [...plays].sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
  
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  
  sortedPlays.forEach(play => {
    const lp = play.lp;
    const d = new Date(play.dateStr);
    let timeStr = "";
    if (!isNaN(d.getTime())) {
      timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');
    }
    
    const item = document.createElement('div');
    item.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: background 0.2s; border-radius: 8px; margin-bottom: 4px;';
    
    item.addEventListener('mouseenter', () => {
      item.style.background = 'rgba(255, 255, 255, 0.04)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    
    item.innerHTML = `
      <img src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
        <span style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${lp.title}">${lp.title}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${lp.artist}">${lp.artist}</span>
      </div>
      <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
        <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">${timeStr}</span>
        <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Audição</span>
      </div>
    `;
    
    item.addEventListener('click', () => {
      dialog.close();
      openDetailsDialog(lp.id);
    });
    
    listEl.appendChild(item);
  });
  
  dialog.showModal();
}
