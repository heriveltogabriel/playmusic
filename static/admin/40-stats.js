// Admin do PlayVinil — Estatísticas.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== STATS COMPILER ====================
function playsToProgressPercent(plays) {
  const count = Number(plays) || 0;
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.min(Math.round(count), 100);
}

function renderPlaysChart() {
  const playsCont = document.getElementById('plays-chart-container');
  if (!playsCont) return;

  const getLatestListenDate = (lp) => {
    if (!lp.listen_dates || lp.listen_dates.length === 0) return "";
    const dates = Array.isArray(lp.listen_dates) ? lp.listen_dates : [lp.listen_dates];
    return dates[dates.length - 1] || "";
  };

  const sortedLpsByPlays = [...state.lps]
    .filter(lp => lp.plays > 0)
    .sort((a, b) => {
      const dateA = getLatestListenDate(a);
      const dateB = getLatestListenDate(b);
      if (dateA && dateB) {
        return dateB.localeCompare(dateA);
      }
      if (dateA) return -1;
      if (dateB) return 1;
      if (b.plays !== a.plays) {
        return b.plays - a.plays;
      }
      return a.title.localeCompare(b.title);
    });

  playsCont.innerHTML = '';

  if (sortedLpsByPlays.length === 0) {
    playsCont.innerHTML = '<div class="text-muted italic" style="font-size: 0.8rem; padding: 8px 0;">Nenhum disco ouvido ainda.</div>';
    return;
  }

  sortedLpsByPlays.forEach((lp, idx) => {
    const pct = playsToProgressPercent(lp.plays);
    const barRow = document.createElement('div');
    barRow.classList.add('chart-bar-row');

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

    const labelName = `#${idx + 1} - ${lp.title} - ${lp.artist}`;
    const labelVal = `${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'} ${dateStr ? `• última: ${dateStr}` : ''}`;

    barRow.innerHTML = `
      <div class="chart-bar-labels">
        <span class="chart-label-name" title="${labelName}">${labelName}</span>
        <span class="chart-label-val">${labelVal}</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: 0%"></div>
      </div>
    `;

    barRow.addEventListener('click', () => {
      openDetailsDialog(lp.id);
    });

    playsCont.appendChild(barRow);

    setTimeout(() => {
      const fillElement = barRow.querySelector('.chart-bar-fill');
      if (fillElement) fillElement.style.width = `${pct}%`;
    }, 100);
  });
}

function renderStats() {
  const totalLps = state.lps.length;
  
  const bandsToNotSplit = [
    "Echo & The Bunnymen", 
    "Secos & Molhados", 
    "Crosby, Stills, Nash & Young"
  ];

  const backingBands = [
    'crazy horse', 'crazy horses', 'tutti frutti', 'os presidentes', 'os ronaldos',
    'os abóboras selvagens', 'a outra banda da terra', 'the bluenotes', 'falange moulin rouge'
  ];

  const consolidationRules = [
    { pattern: /neil young/i, canonical: 'Neil Young' },
    { pattern: /rita lee/i, canonical: 'Rita Lee' },
    { pattern: /lobão/i, canonical: 'Lobão' },
    { pattern: /caetano veloso/i, canonical: 'Caetano Veloso' },
    { pattern: /paul mccartney/i, canonical: 'Paul McCartney' },
    { pattern: /kid abelha/i, canonical: 'Kid Abelha' },
    { pattern: /chico science/i, canonical: 'Chico Science & Nação Zumbi' },
    { pattern: /maria bethania|maria bethânia/i, canonical: 'Maria Bethânia' },
    { pattern: /^marina$|^marina lima$/i, canonical: 'Marina Lima' }
  ];

  function getCanonicalArtist(artistName) {
    let cleaned = artistName.replace(/\s\(\d+\)/g, '').trim();
    for (const rule of consolidationRules) {
      if (rule.pattern.test(cleaned)) {
        return rule.canonical;
      }
    }
    return cleaned;
  }
  
  // Calculate distinct individual artists (excluding specific group splits)
  const distinctArtistsSet = new Set();
  state.lps.forEach(lp => {
    if (bandsToNotSplit.includes(lp.artist)) {
      const canonical = getCanonicalArtist(lp.artist);
      distinctArtistsSet.add(canonical);
    } else {
      const individualArtists = lp.artist.split(/\s*(?:&|,|\/|\b(?:and|e|with|com)\b)\s*/i);
      individualArtists.forEach(art => {
        const cleanedName = art.replace(/\s\(\d+\)/g, '').trim();
        if (cleanedName) {
          const lowerName = cleanedName.toLowerCase();
          if (backingBands.includes(lowerName)) {
            return;
          }
          const canonical = getCanonicalArtist(cleanedName);
          distinctArtistsSet.add(canonical);
        }
      });
    }
  });
  
  const listenedLps = state.lps.filter(lp => (Number(lp.plays) || 0) > 0).length;
  const listenedPercent = totalLps > 0 ? Math.round((listenedLps / totalLps) * 100) : 0;
  const totalPlays = state.lps.reduce((acc, lp) => acc + (Number(lp.plays) || 0), 0);
    
  // Inject values
  document.getElementById('stat-total-lps').textContent = totalLps;
  document.getElementById('stat-total-artists').textContent = distinctArtistsSet.size;
  document.getElementById('stat-listened-percent').textContent = `${listenedPercent}%`;
  const listenedFractionEl = document.getElementById('stat-listened-fraction');
  if (listenedFractionEl) {
    listenedFractionEl.textContent = `${listenedLps} de ${totalLps} LPs`;
  }
  document.getElementById('stat-total-plays').textContent = totalPlays;
  
  // 1. Genres Stats Bar Chart
  const genresCont = document.getElementById('genres-chart-container');
  if (genresCont) {
    const genreCounts = {};
    state.lps.forEach(lp => {
      lp.genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
    });
    const allGenresSorted = Object.entries(genreCounts).sort((a,b) => b[1] - a[1]);
    const genresSorted = allGenresSorted.slice(0, 5);
    
    // Ensure "Jazz" is included if it exists in the collection and is not already in the top 5
    const hasJazz = genresSorted.some(([name]) => name.toLowerCase() === 'jazz');
    if (!hasJazz) {
      const jazzEntry = allGenresSorted.find(([name]) => name.toLowerCase() === 'jazz');
      if (jazzEntry) {
        genresSorted.push(jazzEntry);
      }
    }
    
    genresCont.innerHTML = '';
    
    genresSorted.forEach(([name, count]) => {
      const pct = totalLps > 0 ? Math.round((count / totalLps) * 100) : 0;
      const barRow = document.createElement('div');
      barRow.classList.add('chart-bar-row');
      barRow.innerHTML = `
        <div class="chart-bar-labels">
          <span class="chart-label-name">${name}</span>
          <span class="chart-label-val">${count} (${pct}%)</span>
        </div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width: 0%"></div>
        </div>
      `;
      genresCont.appendChild(barRow);
      
      // Trigger transition delay
      setTimeout(() => {
        barRow.querySelector('.chart-bar-fill').style.width = `${pct}%`;
      }, 100);
    });
  }
  
  // 2. Top Artists ranking (splitting collaborative artists except specific band names)
  const artistCounts = {};
  state.lps.forEach(lp => {
    if (bandsToNotSplit.includes(lp.artist)) {
      const canonical = getCanonicalArtist(lp.artist);
      artistCounts[canonical] = (artistCounts[canonical] || 0) + 1;
    } else {
      const individualArtists = lp.artist.split(/\s*(?:&|,|\/|\b(?:and|e|with|com)\b)\s*/i);
      individualArtists.forEach(art => {
        const cleanedName = art.replace(/\s\(\d+\)/g, '').trim();
        if (cleanedName) {
          const lowerName = cleanedName.toLowerCase();
          if (backingBands.includes(lowerName)) {
            return;
          }
          const canonical = getCanonicalArtist(cleanedName);
          artistCounts[canonical] = (artistCounts[canonical] || 0) + 1;
        }
      });
    }
  });
  const artistsSorted = Object.entries(artistCounts).sort((a,b) => b[1] - a[1]).slice(0, 10);
  
  const artistsCont = document.getElementById('artists-ranking-container');
  artistsCont.innerHTML = '';
  
  artistsSorted.forEach(([name, count], index) => {
    const rankRow = document.createElement('div');
    rankRow.classList.add('ranking-item');
    rankRow.innerHTML = `
      <div class="ranking-item-left">
        <span class="ranking-badge">#${index+1}</span>
        <span class="ranking-name">${name}</span>
      </div>
      <span class="ranking-count">${count} LPs</span>
    `;
    
    rankRow.addEventListener('click', () => {
      const artistLps = state.lps.filter(lp => {
        if (bandsToNotSplit.includes(lp.artist)) {
          return getCanonicalArtist(lp.artist) === name;
        }
        const individualArtists = lp.artist.split(/\s*(?:&|,|\/|\b(?:and|e|with|com)\b)\s*/i);
        return individualArtists.some(art => {
          const cleanedName = art.replace(/\s\(\d+\)/g, '').trim();
          if (cleanedName) {
            const lowerName = cleanedName.toLowerCase();
            if (backingBands.includes(lowerName)) {
              return false;
            }
            return getCanonicalArtist(cleanedName) === name;
          }
          return false;
        });
      });
      openArtistAlbumsDialog(name, artistLps);
    });
    
    artistsCont.appendChild(rankRow);
  });
  
  // 4. Recent Additions ranking list
  const recentSorted = [...state.lps]
    .sort((a,b) => new Date(b.date_added || 0) - new Date(a.date_added || 0))
    .slice(0, 7);
    
  const additionsCont = document.getElementById('recent-additions-container');
  additionsCont.innerHTML = '';
  
  recentSorted.forEach(lp => {
    const div = document.createElement('div');
    div.classList.add('addition-item');
    
    // Formatting date
    let formattedDate = 'Data desconhecida';
    if (lp.date_added) {
      const d = new Date(lp.date_added);
      formattedDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    
    div.innerHTML = `
      <img class="addition-thumb" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
      <div class="addition-details">
        <div class="addition-title">${lp.title}</div>
        <div class="addition-artist">${lp.artist}</div>
      </div>
      <div class="addition-time">${formattedDate}</div>
    `;
    additionsCont.appendChild(div);
  });

  renderTimelineStats();
  renderPlayPeriodStats();
}

function openArtistAlbumsDialog(artistName, lps) {
  const dialog = document.getElementById('artist-albums-dialog');
  const title = document.getElementById('artist-albums-title');
  const listCont = document.getElementById('artist-albums-list');
  
  if (!dialog || !title || !listCont) return;
  
  title.textContent = `Álbuns de ${artistName}`;
  listCont.innerHTML = '';
  
  const sortedLps = [...lps].sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    return yearB - yearA;
  });
  
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  
  sortedLps.forEach(lp => {
    const item = document.createElement('div');
    item.classList.add('history-ranking-item');
    item.style.cursor = 'pointer';
    
    item.innerHTML = `
      <div class="history-item-left">
        <img class="history-item-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
        <div class="history-item-details">
          <div class="history-item-title" title="${lp.title}">${lp.title}</div>
          <div class="history-item-artist" title="${lp.artist}">${lp.artist}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;">
        <span class="history-plays-badge">${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
        ${lp.year ? `<span style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--text-muted);">${lp.year}</span>` : ''}
      </div>
    `;
    
    item.addEventListener('click', () => {
      dialog.close();
      openDetailsDialog(lp.id);
    });
    
    listCont.appendChild(item);
  });
  
  dialog.showModal();
}

// ==================== TIMELINE STATISTICS ====================
function renderTimelineStats() {
  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  
  const today = new Date();
  
  // Find the oldest LP addition date to define the full available range
  let oldestDate = new Date(); // default to today
  state.lps.forEach(lp => {
    if (!lp.date_added) return;
    const d = new Date(lp.date_added);
    if (d < oldestDate) {
      oldestDate = d;
    }
  });

  // Construct all months from oldest LP date to today (chronological order: oldest to newest)
  const chronological = [];
  let current = new Date(oldestDate.getFullYear(), oldestDate.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 1);
  
  while (current <= end) {
    chronological.push({
      year: current.getFullYear(),
      month: current.getMonth(),
      label: `${MONTHS_PT[current.getMonth()].slice(0, 3)}/${String(current.getFullYear()).slice(-2)}`,
      key: `${MONTHS_PT[current.getMonth()]} de ${current.getFullYear()}`,
      count: 0
    });
    current.setMonth(current.getMonth() + 1);
  }

  // Define default values (last 6 months or less if history is shorter)
  const newestMonth = chronological[chronological.length - 1];
  const defaultStartIndex = Math.max(0, chronological.length - 6);
  const defaultStartMonth = chronological[defaultStartIndex];
  
  const defaultStartVal = defaultStartMonth.year * 12 + defaultStartMonth.month;
  const defaultEndVal = newestMonth.year * 12 + newestMonth.month;

  // Populate filter dropdowns if not populated yet
  const startSelect = document.getElementById('monthly-filter-start');
  const endSelect = document.getElementById('monthly-filter-end');
  
  if (startSelect && endSelect) {
    if (startSelect.options.length === 0) {
      chronological.forEach(m => {
        const val = m.year * 12 + m.month;
        
        const optStart = document.createElement('option');
        optStart.value = val;
        optStart.textContent = m.label;
        startSelect.appendChild(optStart);
        
        const optEnd = document.createElement('option');
        optEnd.value = val;
        optEnd.textContent = m.label;
        endSelect.appendChild(optEnd);
      });
      
      if (state.monthlyFilterStart === null) {
        state.monthlyFilterStart = defaultStartVal;
      }
      if (state.monthlyFilterEnd === null) {
        state.monthlyFilterEnd = defaultEndVal;
      }
      
      startSelect.value = state.monthlyFilterStart;
      endSelect.value = state.monthlyFilterEnd;
      
      // Event listeners
      startSelect.addEventListener('change', () => {
        let startVal = parseInt(startSelect.value, 10);
        let endVal = parseInt(endSelect.value, 10);
        if (startVal > endVal) {
          endSelect.value = startSelect.value;
          endVal = startVal;
        }
        state.monthlyFilterStart = startVal;
        state.monthlyFilterEnd = endVal;
        renderTimelineStats();
      });
      
      endSelect.addEventListener('change', () => {
        let startVal = parseInt(startSelect.value, 10);
        let endVal = parseInt(endSelect.value, 10);
        if (startVal > endVal) {
          startSelect.value = endSelect.value;
          startVal = endVal;
        }
        state.monthlyFilterStart = startVal;
        state.monthlyFilterEnd = endVal;
        renderTimelineStats();
      });
    } else {
      if (state.monthlyFilterStart !== null) {
        startSelect.value = state.monthlyFilterStart;
      }
      if (state.monthlyFilterEnd !== null) {
        endSelect.value = state.monthlyFilterEnd;
      }
    }
  }

  // Count additions for all months in the range
  state.lps.forEach(lp => {
    if (!lp.date_added) return;
    const lpDate = new Date(lp.date_added);
    const lpYear = lpDate.getFullYear();
    const lpMonth = lpDate.getMonth();
    
    const match = chronological.find(m => m.year === lpYear && m.month === lpMonth);
    if (match) {
      match.count++;
    }
  });

  // Filter months based on range selection
  let filteredMonths = chronological;
  if (state.monthlyFilterStart !== null && state.monthlyFilterEnd !== null) {
    filteredMonths = chronological.filter(m => {
      const val = m.year * 12 + m.month;
      return val >= state.monthlyFilterStart && val <= state.monthlyFilterEnd;
    });
  }

  // Recalculate indicators based on filtered range
  let totalAdded = 0;
  filteredMonths.forEach(m => {
    totalAdded += m.count;
  });

  // Find most active month in the filtered range
  let mostActiveMonth = null;
  let maxCount = 0;
  filteredMonths.forEach(m => {
    if (m.count > maxCount) {
      maxCount = m.count;
      mostActiveMonth = m;
    }
  });

  // Update indicators
  const totalEl = document.getElementById('timeline-stat-total');
  const totalLabelEl = document.getElementById('timeline-stat-total-label');
  const averageEl = document.getElementById('timeline-stat-average');
  const chartContainer = document.getElementById('timeline-monthly-chart');
  const mostActiveValEl = document.getElementById('timeline-stat-most-active');
  const mostActiveDescEl = document.getElementById('timeline-stat-most-active-count');
  if (!totalEl || !averageEl || !chartContainer || !mostActiveValEl || !mostActiveDescEl) return;

  totalEl.textContent = totalAdded;
  
  const numMonths = filteredMonths.length || 1;
  if (totalLabelEl) {
    totalLabelEl.textContent = `Total adicionado (${numMonths} ${numMonths === 1 ? 'mês' : 'meses'})`;
  }

  if (mostActiveMonth && maxCount > 0) {
    mostActiveValEl.textContent = mostActiveMonth.label;
    mostActiveDescEl.textContent = `${maxCount} ${maxCount === 1 ? 'disco' : 'discos'}`;
  } else {
    mostActiveValEl.textContent = '-';
    mostActiveDescEl.textContent = '0 discos';
  }

  const average = (totalAdded / numMonths).toFixed(1);
  averageEl.textContent = average.replace('.', ',');

  // Render Monthly Chart (newest month first at the top of the chart)
  chartContainer.innerHTML = '';

  const maxVal = Math.max(...filteredMonths.map(m => m.count), 1);
  const chartMonths = [...filteredMonths].reverse();

  chartMonths.forEach(m => {
    const barRow = document.createElement('div');
    barRow.className = 'chart-bar-row';
    
    const pct = (m.count / maxVal) * 100;
    
    barRow.innerHTML = `
      <div class="chart-bar-labels">
        <span class="chart-label-name">${m.key}</span>
        <span class="chart-label-val">${m.count} ${m.count === 1 ? 'disco' : 'discos'}</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: 0%"></div>
      </div>
    `;
    
    chartContainer.appendChild(barRow);
    
    // Add click navigation to timeline month header
    const groupId = 'timeline-group-' + m.key.replace(/\s+/g, '-').toLowerCase();
    barRow.style.cursor = 'pointer';
    barRow.addEventListener('click', () => {
      const target = document.getElementById(groupId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    
    // Trigger animation in next frame
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = barRow.querySelector('.chart-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      }, 50);
    });
  });
}

function renderPlayPeriodStats() {
  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const now = new Date();

  // 1. Define time intervals
  // Current Week (Sunday to Saturday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Current Month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Last 6 Months (current month is index 0)
  const last6Months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6Months.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: `${MONTHS_PT[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(-2)}`,
      key: `${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`,
      count: 0
    });
  }

  // 2. Process data
  let weeklyPlaysCount = 0;
  let monthlyPlaysCount = 0;
  const weeklyLpsMap = new Map(); // lpId -> { lp, count, latestDate }
  const monthlyLpsMap = new Map(); // lpId -> { lp, count, latestDate }

  const getLatestListenDate = (lp) => {
    if (!lp.listen_dates || lp.listen_dates.length === 0) return "";
    const dates = Array.isArray(lp.listen_dates) ? lp.listen_dates : [lp.listen_dates];
    return dates[dates.length - 1] || "";
  };

  state.lps.forEach(lp => {
    if (!lp.listen_dates || !Array.isArray(lp.listen_dates)) return;

    lp.listen_dates.forEach(dateStr => {
      try {
        const d = new Date(dateStr);
        const t = d.getTime();
        if (isNaN(t)) return;

        // Check if falls in current week
        if (t >= startOfWeek.getTime() && t <= endOfWeek.getTime()) {
          weeklyPlaysCount++;
          if (!weeklyLpsMap.has(lp.id)) {
            weeklyLpsMap.set(lp.id, { lp, count: 0, latestDate: "" });
          }
          const data = weeklyLpsMap.get(lp.id);
          data.count++;
          if (!data.latestDate || dateStr > data.latestDate) {
            data.latestDate = dateStr;
          }
        }

        // Check if falls in current month
        if (t >= startOfMonth.getTime() && t <= endOfMonth.getTime()) {
          monthlyPlaysCount++;
          if (!monthlyLpsMap.has(lp.id)) {
            monthlyLpsMap.set(lp.id, { lp, count: 0, latestDate: "" });
          }
          const data = monthlyLpsMap.get(lp.id);
          data.count++;
          if (!data.latestDate || dateStr > data.latestDate) {
            data.latestDate = dateStr;
          }
        }

        // Check last 6 months for chart
        last6Months.forEach(m => {
          const mStart = new Date(m.year, m.month, 1, 0, 0, 0, 0).getTime();
          const mEnd = new Date(m.year, m.month + 1, 0, 23, 59, 59, 999).getTime();
          if (t >= mStart && t <= mEnd) {
            m.count++;
          }
        });

      } catch (e) {
        console.error("Erro ao computar período de audição:", dateStr, e);
      }
    });
  });

  // 3. Update Mini Cards
  const statWeeklyLpsEl = document.getElementById('stat-weekly-lps');
  const statWeeklyPlaysEl = document.getElementById('stat-weekly-plays');
  const statMonthlyLpsEl = document.getElementById('stat-monthly-lps');
  const statMonthlyPlaysEl = document.getElementById('stat-monthly-plays');

  if (statWeeklyLpsEl) statWeeklyLpsEl.textContent = weeklyLpsMap.size;
  if (statWeeklyPlaysEl) statWeeklyPlaysEl.textContent = weeklyPlaysCount;
  if (statMonthlyLpsEl) statMonthlyLpsEl.textContent = monthlyLpsMap.size;
  if (statMonthlyPlaysEl) statMonthlyPlaysEl.textContent = monthlyPlaysCount;

  // 4. Render Unified Top Ranking (Week / Month / All-time)
  state.activeTopPeriod = state.activeTopPeriod || 'week';

  const renderTopRanking = () => {
    const topContainer = document.getElementById('top-ranking-container');
    if (!topContainer) return;
    topContainer.innerHTML = '';

    let items = [];
    let emptyMsg = '';

    if (state.activeTopPeriod === 'week') {
      items = Array.from(weeklyLpsMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
        return a.lp.title.localeCompare(b.lp.title);
      }).slice(0, 5);
      emptyMsg = 'Nenhum LP ouvido nesta semana.';
    } else if (state.activeTopPeriod === 'month') {
      items = Array.from(monthlyLpsMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
        return a.lp.title.localeCompare(b.lp.title);
      }).slice(0, 5);
      emptyMsg = 'Nenhum LP ouvido este mês.';
    } else {
      // 'all'
      items = [...state.lps]
        .filter(lp => (Number(lp.plays) || 0) > 0)
        .sort((a, b) => {
          const diff = (Number(b.plays) || 0) - (Number(a.plays) || 0);
          if (diff !== 0) return diff;
          const aLatest = getLatestListenDate(a);
          const bLatest = getLatestListenDate(b);
          if (aLatest && bLatest) return bLatest.localeCompare(aLatest);
          return a.title.localeCompare(b.title);
        })
        .slice(0, 5)
        .map(lp => ({ lp, count: Number(lp.plays) || 0 }));
      emptyMsg = 'Nenhum LP com audições registradas.';
    }

    if (items.length === 0) {
      topContainer.innerHTML = `<div class="text-muted italic" style="font-size: 0.8rem; padding: 12px 0;">${emptyMsg}</div>`;
    } else {
      const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
      items.forEach((item, index) => {
        const lp = item.lp;
        const div = document.createElement('div');
        div.className = 'ranking-item';
        div.innerHTML = `
          <div class="ranking-item-left" style="gap: 8px; flex: 1; min-width: 0; display: flex; align-items: center;">
            <span class="ranking-badge">#${index+1}</span>
            <img class="addition-thumb" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;">
            <div class="addition-details">
              <div class="addition-title" style="font-size: 0.85rem; font-weight: 600;">${lp.title}</div>
              <div class="addition-artist" style="font-size: 0.75rem;">${lp.artist}</div>
            </div>
          </div>
          <span class="ranking-count">${item.count} ${item.count === 1 ? 'play' : 'plays'}</span>
        `;
        div.addEventListener('click', () => openDetailsDialog(lp.id));
        topContainer.appendChild(div);
      });
    }
  };

  state._renderTopRanking = renderTopRanking;

  const pillsContainer = document.getElementById('top-lps-period-pills');
  if (pillsContainer) {
    if (!pillsContainer.dataset.listenerAttached) {
      pillsContainer.dataset.listenerAttached = 'true';
      pillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.stats-period-pill');
        if (!btn) return;
        const period = btn.getAttribute('data-period');
        if (!period || period === state.activeTopPeriod) return;
        state.activeTopPeriod = period;
        pillsContainer.querySelectorAll('.stats-period-pill').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-period') === period);
        });
        if (typeof state._renderTopRanking === 'function') {
          state._renderTopRanking();
        }
      });
    }
    pillsContainer.querySelectorAll('.stats-period-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-period') === state.activeTopPeriod);
    });
  }

  renderTopRanking();

  // 5. Render Shelf Rescue ("💎 Resgate da Estante")
  const forgottenContainer = document.getElementById('forgotten-ranking-container');
  if (forgottenContainer) {
    forgottenContainer.innerHTML = '';

    const getLatestListenTimestamp = (lp) => {
      if (!lp.listen_dates || lp.listen_dates.length === 0) return 0;
      const dates = Array.isArray(lp.listen_dates) ? lp.listen_dates : [lp.listen_dates];
      let maxT = 0;
      for (const d of dates) {
        const t = new Date(d).getTime();
        if (!isNaN(t) && t > maxT) maxT = t;
      }
      return maxT;
    };

    // Unplayed LPs (0 plays)
    const unplayedLps = state.lps.filter(lp => (Number(lp.plays) || 0) === 0);
    // Sort unplayed by date_added / synced_at ascending (oldest first, waiting the longest)
    unplayedLps.sort((a, b) => {
      const aDate = a.date_added ? new Date(a.date_added).getTime() : 0;
      const bDate = b.date_added ? new Date(b.date_added).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a.title.localeCompare(b.title);
    });

    let forgottenList = [];
    if (unplayedLps.length >= 5) {
      forgottenList = unplayedLps.slice(0, 5).map(lp => ({ lp, isUnplayed: true }));
    } else {
      forgottenList = unplayedLps.map(lp => ({ lp, isUnplayed: true }));
      // Complete remaining slots with played LPs sorted by oldest listen timestamp
      const playedLps = state.lps.filter(lp => (Number(lp.plays) || 0) > 0);
      playedLps.sort((a, b) => {
        const aLast = getLatestListenTimestamp(a);
        const bLast = getLatestListenTimestamp(b);
        if (aLast !== bLast) return aLast - bLast;
        return a.title.localeCompare(b.title);
      });
      const remainingNeeded = 5 - forgottenList.length;
      const filler = playedLps.slice(0, remainingNeeded).map(lp => ({
        lp,
        isUnplayed: false,
        lastListenTime: getLatestListenTimestamp(lp)
      }));
      forgottenList = forgottenList.concat(filler);
    }

    if (forgottenList.length === 0) {
      forgottenContainer.innerHTML = '<div class="text-muted italic" style="font-size: 0.8rem; padding: 12px 0;">Nenhum disco encontrado na coleção.</div>';
    } else {
      const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
      const nowTime = now.getTime();
      forgottenList.forEach((item, index) => {
        const lp = item.lp;
        const div = document.createElement('div');
        div.className = 'ranking-item';

        let badgeHtml = '';
        if (item.isUnplayed) {
          badgeHtml = '<span class="ranking-badge-unplayed">Nunca ouvido</span>';
        } else {
          const diffDays = Math.max(0, Math.floor((nowTime - item.lastListenTime) / (1000 * 60 * 60 * 24)));
          let timeText = '';
          if (diffDays === 0) {
            timeText = 'hoje';
          } else if (diffDays >= 60) {
            const months = Math.floor(diffDays / 30);
            timeText = `há ${months} meses`;
          } else {
            timeText = `há ${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}`;
          }
          badgeHtml = `<span class="ranking-badge-dormant">${timeText}</span>`;
        }

        div.innerHTML = `
          <div class="ranking-item-left" style="gap: 8px; flex: 1; min-width: 0; display: flex; align-items: center;">
            <span class="ranking-badge">#${index+1}</span>
            <img class="addition-thumb" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;">
            <div class="addition-details">
              <div class="addition-title" style="font-size: 0.85rem; font-weight: 600;">${lp.title}</div>
              <div class="addition-artist" style="font-size: 0.75rem;">${lp.artist}</div>
            </div>
          </div>
          ${badgeHtml}
        `;
        div.addEventListener('click', () => openDetailsDialog(lp.id));
        forgottenContainer.appendChild(div);
      });
    }
  }

  // 6. Render Monthly Listening Chart (last 6 months, oldest first for chart flow)
  const listeningChartContainer = document.getElementById('listening-monthly-chart');
  if (listeningChartContainer) {
    listeningChartContainer.innerHTML = '';
    const maxVal = Math.max(...last6Months.map(m => m.count), 1);

    last6Months.forEach(m => {
      const barRow = document.createElement('div');
      barRow.className = 'chart-bar-row';
      const pct = (m.count / maxVal) * 100;

      barRow.innerHTML = `
        <div class="chart-bar-labels">
          <span class="chart-label-name">${m.key}</span>
          <span class="chart-label-val">${m.count} ${m.count === 1 ? 'audição' : 'audições'}</span>
        </div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width: 0%"></div>
        </div>
      `;
      listeningChartContainer.appendChild(barRow);

      requestAnimationFrame(() => {
        setTimeout(() => {
          const fill = barRow.querySelector('.chart-bar-fill');
          if (fill) fill.style.width = `${pct}%`;
        }, 50);
      });
    });
  }
}
