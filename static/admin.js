/**
 * LP da Semana - Catálogo
 * Core Application Logic
 */

// ==================== STATE MANAGEMENT ====================
const state = {
  lps: [],
  filteredLps: [],
  selectedLp: null,
  currentView: 'catalog', // 'catalog' (Minha Coleção), 'player', 'stats'
  
  // Weekly Suggestions state
  agenda: [], // 7 LPs representing Monday to Sunday
  selectedAgendaIndex: 0, // Index currently selected (0-6)
  
  // Active Filters & Sort
  filters: {
    search: '',
    decade: '',
    starredOnly: false,
    genres: [],
    styles: []
  },
  sortBy: 'added_desc',
  
  // Timeline page state
  timelineQuery: '',
  timelineSort: 'added_desc'
};

// ==================== INITIALIZATION ====================
// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDatabase();
  initializeViews();
  initializeSidebarFilters();
  initializeSuggestionsControls();
  initializeDialogs();
  initializeTimelineEvents();
  initializeSettingsForm();
  
  // Set current selected agenda index to today's weekday
  state.selectedAgendaIndex = getTodayAgendaIndex();
  
  // Initialize weekly suggestions
  generateWeeklyAgenda(false);
  renderWeeklyAgenda();
  renderSelectedAgendaLp();
  renderHistoryRanking();
  renderPlaysRankingPage();
  
  // Initial render
  applyFiltersAndRender();
  
  showToast('Catálogo inicializado com sucesso!', 'success');
});

// Load data from backend API
async function loadDatabase() {
  try {
    const response = await fetch('/api/admin/releases');
    const dbReleases = await response.json();
    
    // Map backend release models to frontend format
    state.lps = dbReleases.map(r => ({
      id: r.release_id,
      title: r.title,
      artist: r.artist,
      year: r.year,
      cover_image: r.cover_url,
      thumbnail: r.cover_url,
      country: r.country,
      labels: r.labels || [],
      catalog_number: (r.catalog_numbers && r.catalog_numbers[0]) || 'LOCAL',
      formats: r.formats || [],
      tracks: r.tracks || [],
      discogs_url: r.discogs_url || '',
      rating: r.rating || 0,
      favorite: r.favorite || false,
      notes: r.notes || '',
      listen_dates: r.listen_dates || [],
      plays: r.auditions || 0,
      date_added: r.synced_at ? new Date(r.synced_at * 1000).toISOString() : new Date().toISOString(),
      genres: r.genres || [],
      styles: r.styles || []
    }));

    // Clean suffixes and perform basic normalization
    state.lps.forEach(lp => {
      if (lp.artist) {
        lp.artist = lp.artist.replace(/\s\(\d+\)/g, '');
        if (lp.artist.toLowerCase().includes('neil young &')) {
          lp.artist = 'Neil Young';
        }
      }
      if (lp.labels) {
        lp.labels = lp.labels.map(l => l.replace(/\s\(\d+\)/g, ''));
      }
      if (lp.styles) {
        lp.styles = lp.styles.map(s => s.replace(/\s\(\d+\)/g, ''));
      }
      lp.plays = lp.listen_dates.length;
    });

  } catch (error) {
    console.error('Error loading database from server:', error);
    showToast('Erro ao carregar banco de dados do servidor.', 'error');
    state.lps = [];
  }
}

function saveDatabase() {
  // Backend SQLite is the single source of truth.
}

// ==================== SIDEBAR & VIEW NAVIGATION ====================
function initializeViews() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.content-view');
  const viewTitle = document.getElementById('view-title');
  
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      
      // Update sidebar active button
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update view panels visibility
      views.forEach(view => {
        view.classList.remove('active');
        if (view.id === `view-${targetView}`) {
          view.classList.add('active');
        }
      });
      
      // Update header title
      state.currentView = targetView;
      
      const addLpBtn = document.getElementById('add-lp-btn');
      if (addLpBtn) {
        addLpBtn.style.display = (targetView === 'catalog') ? 'inline-flex' : 'none';
      }
      
      if (targetView === 'player') {
        viewTitle.textContent = 'Escuta da Semana';
      } else if (targetView === 'catalog') {
        viewTitle.textContent = 'Minha Coleção';
      } else if (targetView === 'stats') {
        viewTitle.textContent = 'Estatísticas';
        renderStats();
      } else if (targetView === 'ranking') {
        viewTitle.textContent = 'Ranking de Audições';
        renderPlaysRankingPage();
      } else if (targetView === 'timeline') {
        viewTitle.textContent = 'Linha do Tempo';
        renderTimeline();
      } else if (targetView === 'settings') {
        viewTitle.textContent = 'Configurações';
        loadSettingsFromServer();
      }
      
      // Trigger special animations or renders
      if (targetView === 'catalog') {
        renderGrid();
      } else if (targetView === 'ranking') {
        renderPlaysRankingPage();
      } else if (targetView === 'timeline') {
        renderTimeline();
      }
    });
  });
}

// ==================== SUGGESTIONS (AGENDA) & LISTENING HISTORY LOGIC ====================
const AGENDA_DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function initializeSuggestionsControls() {
  const shuffleBtn = document.getElementById('shuffle-agenda-btn');
  const markListenedBtn = document.getElementById('mark-listened-btn');
  const detailsBtn = document.getElementById('suggested-details-btn');
  const favBtn = document.getElementById('suggested-favorite-btn');
  const notesTextarea = document.getElementById('suggested-notes');
  
  // Shuffle weekly agenda
  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', () => {
      generateWeeklyAgenda(true);
      renderWeeklyAgenda();
      renderSelectedAgendaLp();
      showToast('Nova agenda da semana sorteada!', 'success');
    });
  }
  
  // Mark currently selected day's suggested LP as listened
  if (markListenedBtn) {
    markListenedBtn.addEventListener('click', () => {
      const activeLp = state.agenda[state.selectedAgendaIndex];
      if (activeLp) {
        markAsListened(activeLp.id);
      }
    });
  }
  
  // Open details
  if (detailsBtn) {
    detailsBtn.addEventListener('click', () => {
      const activeLp = state.agenda[state.selectedAgendaIndex];
      if (activeLp) {
        openDetailsDialog(activeLp.id);
      }
    });
  }
  
  // Favorite toggle
  if (favBtn) {
    favBtn.addEventListener('click', () => {
      const activeLp = state.agenda[state.selectedAgendaIndex];
      if (activeLp) {
        toggleFavoriteState(activeLp.id);
      }
    });
  }
  
  // Auto-save notes
  if (notesTextarea) {
    const notesStatus = document.getElementById('suggested-notes-status');
    let notesTimeout;
    
    notesTextarea.addEventListener('input', () => {
      if (notesStatus) notesStatus.textContent = 'Digitando...';
      clearTimeout(notesTimeout);
      
      notesTimeout = setTimeout(() => {
        saveSuggestedNotes();
      }, 1000);
    });
  }
}

async function saveSuggestedNotes() {
  const activeLp = state.agenda[state.selectedAgendaIndex];
  if (!activeLp) return;
  
  const textarea = document.getElementById('suggested-notes');
  const notesStatus = document.getElementById('suggested-notes-status');
  if (!textarea) return;
  
  const text = textarea.value;
  const targetLp = state.lps.find(lp => lp.id === activeLp.id);
  
  if (targetLp) {
    targetLp.notes = text;
    activeLp.notes = text;
    
    if (notesStatus) notesStatus.textContent = 'Salvando...';
    
    try {
      const response = await fetch(`/api/admin/releases/${targetLp.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: targetLp.title,
          artist: targetLp.artist,
          year: targetLp.year,
          cover_url: targetLp.cover_image,
          labels: targetLp.labels,
          catalog_numbers: targetLp.catalog_number ? [targetLp.catalog_number] : [],
          genres: targetLp.genres,
          styles: targetLp.styles,
          notes: targetLp.notes,
          rating: targetLp.rating
        })
      });
      if (!response.ok) throw new Error('Erro ao salvar notas.');
      if (notesStatus) notesStatus.textContent = 'Salvo automaticamente';
    } catch (e) {
      console.error(e);
      if (notesStatus) notesStatus.textContent = 'Erro ao salvar!';
    }
  }
}

function updateSuggestedFavoriteBtn() {
  const btn = document.getElementById('suggested-favorite-btn');
  if (!btn) return;
  
  const activeLp = state.agenda[state.selectedAgendaIndex];
  const isFav = activeLp && activeLp.favorite;
  const icon = btn.querySelector('.star-icon');
  
  if (isFav) {
    btn.classList.add('active');
    if (icon) {
      icon.setAttribute('fill', 'var(--star-gold)');
      icon.style.stroke = 'var(--star-gold)';
    }
  } else {
    btn.classList.remove('active');
    if (icon) {
      icon.setAttribute('fill', 'none');
      icon.style.stroke = 'currentColor';
    }
  }
}

function updateDetailsFavoriteBtn(lp) {
  const btn = document.getElementById('details-favorite-btn');
  const label = document.getElementById('details-favorite-label');
  if (!btn || !label || !lp) return;

  const icon = btn.querySelector('.star-icon');
  btn.classList.toggle('active', lp.favorite);
  btn.setAttribute('aria-pressed', lp.favorite ? 'true' : 'false');
  btn.title = lp.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
  label.textContent = lp.favorite ? 'Favorito' : 'Favoritar';

  if (icon) {
    icon.setAttribute('fill', lp.favorite ? 'var(--star-gold)' : 'none');
    icon.style.stroke = lp.favorite ? 'var(--star-gold)' : 'currentColor';
  }
}

function updateDetailsAuditionControls(lp) {
  const countEl = document.getElementById('details-plays-count');
  const decrementBtn = document.getElementById('details-unlisten-btn');
  if (!lp) return;

  const plays = Math.max(0, Number(lp.plays) || 0);
  if (countEl) {
    countEl.textContent = plays;
  }
  if (decrementBtn) {
    decrementBtn.disabled = plays <= 0;
    decrementBtn.title = plays <= 0 ? 'Nenhuma audição para remover' : 'Remover audição';
  }
}

function getTodayAgendaIndex() {
  return new Date().getDay(); // 0-6 (0 is Sunday, 1 is Monday, ..., 6 is Saturday)
}

function generateWeeklyAgenda(forceNew = false) {
  if (state.lps.length === 0) {
    state.agenda = [];
    return;
  }
  
  const savedAgendaIdsStr = localStorage.getItem('lpweek_daily_agenda_ids');
  
  if (!forceNew && savedAgendaIdsStr) {
    try {
      const ids = JSON.parse(savedAgendaIdsStr);
      const agendaLps = ids.map(id => state.lps.find(lp => lp.id == id)).filter(Boolean);
      
      if (agendaLps.length === 7) {
        state.agenda = agendaLps;
        return;
      }
    } catch (e) {
      console.error('Error parsing agenda ids', e);
    }
  }
  
  // Prioritize unplayed (plays === 0)
  const unplayed = state.lps.filter(lp => !lp.plays || lp.plays === 0);
  const played = state.lps.filter(lp => lp.plays > 0).sort((a, b) => a.plays - b.plays);
  
  let pool = [...unplayed];
  // Shuffle unplayed pool
  pool.sort(() => Math.random() - 0.5);
  
  // If pool has less than 7, add played items starting from those with fewest plays
  if (pool.length < 7) {
    const remainingCount = 7 - pool.length;
    // We get a subset of played LPs with low plays, shuffle them
    const lowPlayed = played.slice(0, remainingCount * 4);
    lowPlayed.sort(() => Math.random() - 0.5);
    pool = pool.concat(lowPlayed.slice(0, remainingCount));
  }
  
  // Ensure we have unique LPs in pool if collection size is >= 7
  const uniquePool = [];
  const seenIds = new Set();
  for (const lp of pool) {
    if (!seenIds.has(lp.id)) {
      uniquePool.push(lp);
      seenIds.add(lp.id);
    }
  }
  
  // If collection size is less than 7, fill with duplicates as fallback
  if (uniquePool.length < 7 && state.lps.length > 0) {
    while (uniquePool.length < 7) {
      const randomLp = state.lps[Math.floor(Math.random() * state.lps.length)];
      uniquePool.push(randomLp);
    }
  }
  
  state.agenda = uniquePool.slice(0, 7);
  
  // Save to localStorage
  localStorage.setItem('lpweek_daily_agenda_ids', JSON.stringify(state.agenda.map(lp => lp.id)));
}

function renderWeeklyAgenda() {
  const container = document.getElementById('agenda-scroll-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (state.agenda.length === 0) {
    container.innerHTML = '<p class="text-muted">Nenhuma indicação disponível.</p>';
    return;
  }
  
  const todayIdx = getTodayAgendaIndex();
  
  state.agenda.forEach((lp, index) => {
    const card = document.createElement('div');
    card.classList.add('agenda-day-card');
    if (index === todayIdx) {
      card.classList.add('today');
    }
    if (index === state.selectedAgendaIndex) {
      card.classList.add('active');
    }
    card.dataset.index = index;
    
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    const hasBeenPlayed = lp.plays && lp.plays > 0;
    
    card.innerHTML = `
      <button class="agenda-day-change-btn" title="Mudar sugestão deste dia">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
      <div class="agenda-day-name">${AGENDA_DAYS[index]}</div>
      <img class="agenda-day-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
      <div class="agenda-day-title" title="${lp.title}">${lp.title}</div>
      <div class="agenda-day-artist" title="${lp.artist}">${lp.artist}</div>
      ${hasBeenPlayed ? `<div class="agenda-day-status-badge" title="Já escutado">✓</div>` : ''}
    `;
    
    card.addEventListener('click', () => {
      state.selectedAgendaIndex = index;
      // Re-render agenda cards to update active styling
      renderWeeklyAgenda();
      renderSelectedAgendaLp();
    });
    
    const changeBtn = card.querySelector('.agenda-day-change-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        changeSingleDayAgendaLp(index);
      });
    }
    
    container.appendChild(card);
  });
}

function changeSingleDayAgendaLp(dayIndex) {
  if (state.lps.length === 0) return;
  
  // Find LPs already listed in the weekly agenda
  const currentAgendaIds = state.agenda.map(lp => lp.id);
  
  // Try to find LPs with 0 plays not in current agenda
  const availableUnplayed = state.lps.filter(lp => (!lp.plays || lp.plays === 0) && !currentAgendaIds.includes(lp.id));
  
  let selectedLp = null;
  
  if (availableUnplayed.length > 0) {
    selectedLp = availableUnplayed[Math.floor(Math.random() * availableUnplayed.length)];
  } else {
    // Pick least listened to LP not in agenda
    const availablePlayed = state.lps
      .filter(lp => !currentAgendaIds.includes(lp.id))
      .sort((a, b) => (a.plays || 0) - (b.plays || 0));
      
    if (availablePlayed.length > 0) {
      const topFew = availablePlayed.slice(0, Math.min(5, availablePlayed.length));
      selectedLp = topFew[Math.floor(Math.random() * topFew.length)];
    }
  }
  
  // Fallback: pick any random LP from collection (not the current day's LP)
  if (!selectedLp) {
    const collectionLps = state.lps.filter(lp => state.agenda[dayIndex]?.id !== lp.id);
    if (collectionLps.length > 0) {
      selectedLp = collectionLps[Math.floor(Math.random() * collectionLps.length)];
    }
  }
  
  if (selectedLp) {
    state.agenda[dayIndex] = selectedLp;
    localStorage.setItem('lpweek_daily_agenda_ids', JSON.stringify(state.agenda.map(lp => lp.id)));
    
    renderWeeklyAgenda();
    if (state.selectedAgendaIndex === dayIndex) {
      renderSelectedAgendaLp();
    }
    
    showToast(`Sugestão de ${AGENDA_DAYS[dayIndex]} alterada com sucesso!`, 'success');
  } else {
    showToast('Sem outros LPs disponíveis para troca.', 'error');
  }
}

function renderSelectedAgendaLp() {
  const lp = state.agenda[state.selectedAgendaIndex];
  const dayLabel = document.getElementById('featured-day-label');
  const reasonEl = document.getElementById('suggested-reason');
  
  if (dayLabel) {
    const todayIdx = getTodayAgendaIndex();
    const dayName = AGENDA_DAYS[state.selectedAgendaIndex];
    const isWeekend = dayName === 'Domingo' || dayName === 'Sábado';
    const dayText = isWeekend ? dayName : `${dayName}-feira`;
    
    if (state.selectedAgendaIndex === todayIdx) {
      dayLabel.textContent = `Sugestão de Hoje (${dayText})`;
    } else {
      dayLabel.textContent = `Sugestão de ${dayText}`;
    }
  }
  
  if (!lp) {
    document.getElementById('suggested-title').textContent = 'Nenhum LP sugerido';
    document.getElementById('suggested-artist').textContent = '';
    document.getElementById('suggested-year').textContent = '';
    document.getElementById('suggested-label').textContent = '';
    document.getElementById('suggested-genres').innerHTML = '';
    document.getElementById('suggested-plays-count').textContent = '0';
    document.getElementById('suggested-cover-img').src = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=300&auto=format&fit=crop';
    if (reasonEl) reasonEl.textContent = 'Sem sugestão disponível para este dia.';
    
    const textarea = document.getElementById('suggested-notes');
    if (textarea) textarea.value = '';
    
    const historyDatesCont = document.getElementById('suggested-history-dates');
    if (historyDatesCont) historyDatesCont.innerHTML = '<span class="text-muted">Nenhum histórico</span>';
    return;
  }
  
  document.getElementById('suggested-title').textContent = lp.title;
  document.getElementById('suggested-artist').textContent = lp.artist;
  document.getElementById('suggested-year').textContent = lp.year > 0 ? lp.year : 'N/A';
  document.getElementById('suggested-label').textContent = lp.labels.join(', ') || 'N/A';
  document.getElementById('suggested-plays-count').textContent = lp.plays || 0;
  if (reasonEl) reasonEl.textContent = getSuggestionReason(lp);
  
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=300&auto=format&fit=crop';
  const coverImg = document.getElementById('suggested-cover-img');
  coverImg.src = lp.cover_image || lp.thumbnail || defaultCover;
  
  // Update notes textarea
  const textarea = document.getElementById('suggested-notes');
  if (textarea) {
    textarea.value = lp.notes || '';
    const notesStatus = document.getElementById('suggested-notes-status');
    if (notesStatus) notesStatus.textContent = 'Salvo automaticamente';
  }
  
  // Setup genres and styles tags list
  const genresCont = document.getElementById('suggested-genres');
  if (genresCont) {
    genresCont.innerHTML = lp.genres.map(g => `<span class="tag-bubble">${g}</span>`).join('') || '<span class="text-muted">Nenhum</span>';
  }
  
  // Render play history timestamps
  const historyDatesCont = document.getElementById('suggested-history-dates');
  if (historyDatesCont) {
    if (lp.listen_dates && lp.listen_dates.length > 0) {
      // Sort most recent first
      const sortedDates = [...lp.listen_dates].sort((a, b) => new Date(b) - new Date(a));
      historyDatesCont.innerHTML = sortedDates.map(dateStr => {
        const d = new Date(dateStr);
        const dateFormatted = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeFormatted = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="scrobble-history-item">Escutado em ${dateFormatted} às ${timeFormatted}</div>`;
      }).join('');
    } else {
      historyDatesCont.innerHTML = '<div class="text-muted italic" style="font-size: 0.75rem;">Nenhuma audição registrada para este LP.</div>';
    }
  }
  
  updateSuggestedFavoriteBtn();
  updateAmbientGlow(lp.cover_image || lp.thumbnail);
}

function getSuggestionReason(lp) {
  const plays = Number(lp.plays) || 0;
  const addedDate = lp.date_added ? new Date(lp.date_added) : null;
  const addedYear = addedDate && !Number.isNaN(addedDate.getTime()) ? addedDate.getFullYear() : null;
  const genre = (lp.genres && lp.genres[0]) || (lp.styles && lp.styles[0]) || '';

  if (plays === 0) {
    return `Ainda sem audições${addedYear ? ` · na coleção desde ${addedYear}` : ''}${genre ? ` · ${genre}` : ''}.`;
  }
  if (plays === 1) {
    return `Ouvido uma vez · bom candidato para revisitar${genre ? ` · ${genre}` : ''}.`;
  }
  return `Pouco ouvido · ${plays} audições${genre ? ` · ${genre}` : ''}.`;
}

async function markAsListened(id) {
  const lp = state.lps.find(item => item.id == id);
  if (lp) {
    try {
      const response = await fetch(`/api/admin/releases/${id}/listen`, { method: 'POST' });
      if (!response.ok) throw new Error('Erro no servidor');
      const data = await response.json();
      
      if (!lp.listen_dates) {
        lp.listen_dates = [];
      }
      const nowStr = new Date().toISOString();
      lp.listen_dates.push(nowStr);
      lp.plays = data.auditions;
      
      // Update agenda item copies if they match
      state.agenda.forEach((item, idx) => {
        if (item.id == id) {
          item.listen_dates = lp.listen_dates;
          item.plays = lp.plays;
        }
      });
      
      // Re-render suggestions & agenda
      renderWeeklyAgenda();
      renderSelectedAgendaLp();
      
      // Update details modal play count if open
      const detailsPlaysCount = document.getElementById('details-plays-count');
      if (detailsPlaysCount) {
        detailsPlaysCount.textContent = lp.plays;
      }
      updateDetailsAuditionControls(lp);
      
      // Rerender history ranking and plays ranking page
      renderHistoryRanking();
      renderPlaysRankingPage();
      
      if (state.currentView === 'catalog') {
        renderGrid();
      } else if (state.currentView === 'stats') {
        renderStats();
      } else if (state.currentView === 'timeline') {
        renderTimeline();
      }
      
      const d = new Date(nowStr);
      const timeFormatted = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      showToast(`"${lp.title}" marcado como ouvido às ${timeFormatted}! Total: ${lp.plays}`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao registrar audição no servidor.', 'error');
    }
  }
}

async function unmarkAsListened(id) {
  const lp = state.lps.find(item => item.id == id);
  if (!lp) return;

  if ((lp.plays || 0) <= 0) {
    showToast('Este LP ainda não tem audições para remover.', 'error');
    updateDetailsAuditionControls(lp);
    return;
  }

  try {
    const response = await fetch(`/api/admin/releases/${id}/unlisten`, { method: 'POST' });
    if (!response.ok) throw new Error('Erro no servidor');
    const data = await response.json();

    if (!lp.listen_dates) {
      lp.listen_dates = [];
    }
    if (lp.listen_dates.length > 0) {
      lp.listen_dates.pop();
    }
    lp.plays = data.auditions;

    state.agenda.forEach(item => {
      if (item.id == id) {
        item.listen_dates = lp.listen_dates;
        item.plays = lp.plays;
      }
    });

    renderWeeklyAgenda();
    renderSelectedAgendaLp();
    updateDetailsAuditionControls(lp);
    renderHistoryRanking();
    renderPlaysRankingPage();

    if (state.currentView === 'catalog') {
      renderGrid();
    } else if (state.currentView === 'stats') {
      renderStats();
    } else if (state.currentView === 'timeline') {
      renderTimeline();
    }

    showToast(`Audição removida de "${lp.title}". Total: ${lp.plays}`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Erro ao remover audição no servidor.', 'error');
  }
}

function renderHistoryRanking() {
  const container = document.getElementById('history-ranking-container');
  const emptyState = document.getElementById('history-empty-state');
  if (!container || !emptyState) return;
  
  const sorted = state.lps
    .filter(lp => lp.plays > 0)
    .sort((a, b) => {
      if (b.plays !== a.plays) {
        return b.plays - a.plays;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, 10);
    
  if (sorted.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  container.style.display = 'flex';
  emptyState.style.display = 'none';
  container.innerHTML = '';
  
  sorted.forEach((lp, index) => {
    const item = document.createElement('div');
    item.classList.add('history-ranking-item');
    item.dataset.id = lp.id;
    
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    
    item.innerHTML = `
      <div class="history-item-left">
        <span class="history-rank-badge">#${index + 1}</span>
        <img class="history-item-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
        <div class="history-item-details">
          <div class="history-item-title" title="${lp.title}">${lp.title}</div>
          <div class="history-item-artist" title="${lp.artist}">${lp.artist}</div>
        </div>
      </div>
      <span class="history-plays-badge">${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
    `;
    
    item.addEventListener('click', () => {
      openDetailsDialog(lp.id);
    });
    
    container.appendChild(item);
  });
}

async function rateLp(id, rating) {
  const lp = state.lps.find(item => item.id == id);
  if (lp) {
    try {
      const response = await fetch(`/api/admin/releases/${id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: rating })
      });
      if (!response.ok) throw new Error('Erro no servidor');
      
      lp.rating = rating;
      if (rating >= 4) lp.favorite = true;
      if (rating <= 2) lp.favorite = false;
      
      state.agenda.forEach(item => {
        if (item.id == id) {
          item.rating = rating;
          item.favorite = lp.favorite;
        }
      });
      
      renderWeeklyAgenda();
      renderSelectedAgendaLp();
      
      if (state.currentView === 'catalog') {
        renderGrid();
      }
      showToast(`Nota ${rating}/5 salva!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao atualizar nota no servidor.', 'error');
    }
  }
}

async function toggleFavoriteState(id) {
  const lp = state.lps.find(item => item.id == id);
  if (lp) {
    try {
      const response = await fetch(`/api/admin/releases/${id}/favorite`, { method: 'POST' });
      if (!response.ok) throw new Error('Erro no servidor');
      const data = await response.json();
      
      lp.favorite = data.favorite;
      
      state.agenda.forEach(item => {
        if (item.id == id) {
          item.favorite = lp.favorite;
        }
      });
      
      renderWeeklyAgenda();
      renderSelectedAgendaLp();
      updateStarredCounter();
      updateDetailsFavoriteBtn(lp);
      
      if (state.currentView === 'catalog') {
        renderGrid();
      }
      showToast(lp.favorite ? 'Adicionado aos Favoritos!' : 'Removido dos Favoritos.', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao favoritar disco no servidor.', 'error');
    }
  }
}

// ==================== CANVAS DYNAMIC COLOR GLOW ====================
function updateAmbientGlow(imageUrl) {
  const ambientGlow = document.getElementById('ambient-glow');
  const fallbackColor = 'rgba(230, 92, 0, 0.08)';
  
  if (!imageUrl) {
    ambientGlow.style.background = `radial-gradient(circle at 70% 30%, ${fallbackColor} 0%, rgba(12, 12, 12, 0) 60%)`;
    return;
  }
  
  const img = new Image();
  img.crossOrigin = "Anonymous";
  
  img.onload = () => {
    try {
      const canvas = document.getElementById('color-thief-canvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 50, 50);
      ctx.drawImage(img, 0, 0, 50, 50);
      
      const imgData = ctx.getImageData(0, 0, 50, 50).data;
      
      // Calculate average color
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        // Skip extreme dark/white pixels
        const brightness = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
        if (brightness > 15 && brightness < 240) {
          r += imgData[i];
          g += imgData[i+1];
          b += imgData[i+2];
          count++;
        }
      }
      
      if (count > 0) {
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        
        // Push colors towards saturation for nice glowing effect
        const max = Math.max(r, g, b);
        if (max > 0) {
          r = Math.min(255, Math.round(r * (255 / max) * 0.8));
          g = Math.min(255, Math.round(g * (255 / max) * 0.8));
          b = Math.min(255, Math.round(b * (255 / max) * 0.8));
        }
        
        ambientGlow.style.background = `radial-gradient(circle at 65% 35%, rgba(${r}, ${g}, ${b}, 0.14) 0%, rgba(12, 12, 12, 0) 65%)`;
      } else {
        throw new Error("Too dark or too light");
      }
    } catch (e) {
      // Fallback: Generate a nice deterministic color based on the title string
      const activeLp = state.agenda[state.selectedAgendaIndex];
      const stringColor = hashStringToColor(activeLp ? activeLp.title : 'LP da Semana');
      ambientGlow.style.background = `radial-gradient(circle at 65% 35%, ${stringColor} 0%, rgba(12, 12, 12, 0) 65%)`;
    }
  };
  
  img.onerror = () => {
    const activeLp = state.agenda[state.selectedAgendaIndex];
    const stringColor = hashStringToColor(activeLp ? activeLp.title : 'LP da Semana');
    ambientGlow.style.background = `radial-gradient(circle at 65% 35%, ${stringColor} 0%, rgba(12, 12, 12, 0) 65%)`;
  };
  
  img.src = imageUrl;
}

// Generate an HSL color based on string hashing (avoiding pure CORS block errors visually)
function hashStringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsla(${hue}, 80%, 40%, 0.12)`;
}

// ==================== SEARCH, FILTERS & RENDER SYSTEM ====================
function initializeSidebarFilters() {
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const catalogSearchInput = document.getElementById('catalog-search-input');
  const clearCatalogSearchBtn = document.getElementById('clear-catalog-search-btn');
  const starredFilterBtn = document.getElementById('filter-starred');
  const decadeSelect = document.getElementById('filter-decade');
  const resetFiltersBtn = document.getElementById('reset-filters');
  
  // Sync both inputs
  const handleSearchUpdate = (val) => {
    state.filters.search = val;
    
    if (searchInput) searchInput.value = val;
    if (catalogSearchInput) catalogSearchInput.value = val;
    
    const showClear = val.length > 0;
    if (clearSearchBtn) clearSearchBtn.style.display = showClear ? 'flex' : 'none';
    if (clearCatalogSearchBtn) clearCatalogSearchBtn.style.display = showClear ? 'flex' : 'none';
    
    applyFiltersAndRender();
  };
  
  // Real-time search (Sidebar)
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handleSearchUpdate(e.target.value);
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      handleSearchUpdate('');
    });
  }
  
  // Real-time search (Catalog Toolbar)
  if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', (e) => {
      handleSearchUpdate(e.target.value);
    });
  }
  
  if (clearCatalogSearchBtn) {
    clearCatalogSearchBtn.addEventListener('click', () => {
      handleSearchUpdate('');
    });
  }
  
  // Starred toggle filter
  if (starredFilterBtn) {
    starredFilterBtn.addEventListener('click', () => {
      state.filters.starredOnly = !state.filters.starredOnly;
      starredFilterBtn.classList.toggle('active', state.filters.starredOnly);
      applyFiltersAndRender();
    });
  }
  
  // Decade filter
  if (decadeSelect) {
    decadeSelect.addEventListener('change', (e) => {
      state.filters.decade = e.target.value;
      applyFiltersAndRender();
    });
  }
  
  // Reset all filters button
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      resetAllFilters();
    });
  }
  
  // Also hook search options to sorting change
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFiltersAndRender();
    });
  }
  
  const emptyResetBtn = document.getElementById('empty-reset-btn');
  if (emptyResetBtn) {
    emptyResetBtn.addEventListener('click', resetAllFilters);
  }
}

function resetAllFilters() {
  state.filters.search = '';
  state.filters.decade = '';
  state.filters.starredOnly = false;
  state.filters.genres = [];
  state.filters.styles = [];
  
  // Reset UI elements
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const clearSearchBtn = document.getElementById('clear-search-btn');
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  
  const catalogSearchInput = document.getElementById('catalog-search-input');
  if (catalogSearchInput) catalogSearchInput.value = '';
  const clearCatalogSearchBtn = document.getElementById('clear-catalog-search-btn');
  if (clearCatalogSearchBtn) clearCatalogSearchBtn.style.display = 'none';
  
  const starredFilterBtn = document.getElementById('filter-starred');
  if (starredFilterBtn) starredFilterBtn.classList.remove('active');
  const decadeSelect = document.getElementById('filter-decade');
  if (decadeSelect) decadeSelect.value = '';
  
  // Deselect filter tags
  document.querySelectorAll('.filter-item').forEach(item => item.classList.remove('active'));
  
  applyFiltersAndRender();
  showToast('Todos os filtros limpos.', 'success');
}

// Compute active filters and render views
function applyFiltersAndRender() {
  let filtered = [...state.lps];
  
  // 1. Filter by Search Query
  const normalizedSearch = state.filters.search.trim().toLowerCase();
  if (normalizedSearch) {
    const q = normalizedSearch;
    filtered = filtered.filter(lp => {
      return lp.title.toLowerCase().includes(q) || 
             lp.artist.toLowerCase().includes(q) ||
             lp.genres.some(g => g.toLowerCase().includes(q)) ||
             lp.styles.some(s => s.toLowerCase().includes(q)) ||
             lp.labels.some(l => l.toLowerCase().includes(q)) ||
             (lp.catalog_number && lp.catalog_number.toLowerCase().includes(q));
    });
  }
  
  // 2. Filter by Starred/Favorites
  if (state.filters.starredOnly) {
    filtered = filtered.filter(lp => lp.favorite === true);
  }
  
  // 3. Filter by Decade
  if (state.filters.decade) {
    const startYear = parseInt(state.filters.decade);
    filtered = filtered.filter(lp => {
      if (lp.year === 0) return false;
      return lp.year >= startYear && lp.year < (startYear + 10);
    });
  }
  
  // 4. Filter by selected Genres
  if (state.filters.genres.length > 0) {
    filtered = filtered.filter(lp => {
      return state.filters.genres.every(genre => lp.genres.includes(genre));
    });
  }
  
  // 5. Filter by selected Styles
  if (state.filters.styles.length > 0) {
    filtered = filtered.filter(lp => {
      return state.filters.styles.every(style => lp.styles.includes(style));
    });
  }
  
  // Update state with filtered list
  state.filteredLps = filtered;
  
  // Sort list
  sortFilteredLps();
  
  // Update stats counters
  updateStarredCounter();
  document.getElementById('total-catalog-count').textContent = state.lps.length;
  document.getElementById('filtered-count').textContent = state.filteredLps.length;
  document.getElementById('total-count').textContent = state.lps.length;
  
  // Render sidebar categories (genres, styles list with updated counts)
  renderSidebarFiltersList();
  
  // Render active filters indicator tags
  renderActiveFiltersBar();
  
  // Render active view panels
  if (state.currentView === 'catalog') {
    renderGrid();
  } else if (state.currentView === 'timeline') {
    renderTimeline();
  }
}

function sortFilteredLps() {
  const sort = state.sortBy;
  state.filteredLps.sort((a, b) => {
    if (sort === 'added_desc') {
      return new Date(b.date_added || 0) - new Date(a.date_added || 0);
    } else if (sort === 'added_asc') {
      return new Date(a.date_added || 0) - new Date(b.date_added || 0);
    } else if (sort === 'year_desc') {
      return (b.year || 0) - (a.year || 0);
    } else if (sort === 'year_asc') {
      // Put LPs with year 0 at the bottom
      const yA = a.year || 9999;
      const yB = b.year || 9999;
      return yA - yB;
    } else if (sort === 'title_asc') {
      return a.title.localeCompare(b.title);
    } else if (sort === 'artist_asc') {
      const cmp = a.artist.localeCompare(b.artist);
      if (cmp !== 0) return cmp;
      const yA = a.year || 9999;
      const yB = b.year || 9999;
      if (yA !== yB) return yA - yB;
      return a.title.localeCompare(b.title);
    } else if (sort === 'rating_desc') {
      return (b.rating || 0) - (a.rating || 0);
    }
    return 0;
  });
}

function updateStarredCounter() {
  const elem = document.getElementById('starred-count');
  if (elem) {
    const starredCount = state.lps.filter(lp => lp.favorite).length;
    elem.textContent = starredCount;
  }
}

// Generate tags lists inside sidebar
function renderSidebarFiltersList() {
  const genresCont = document.getElementById('genres-list');
  const stylesCont = document.getElementById('styles-list');
  if (!genresCont || !stylesCont) return;
  
  // Count distributions
  const genreCounts = {};
  const styleCounts = {};
  
  state.lps.forEach(lp => {
    lp.genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
    lp.styles.forEach(s => { styleCounts[s] = (styleCounts[s] || 0) + 1; });
  });
  
  // Sort genres by frequency
  const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  const sortedStyles = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]);
  
  // Render Genres List
  genresCont.innerHTML = sortedGenres.map(([genre, count]) => {
    const isActive = state.filters.genres.includes(genre);
    return `
      <div class="filter-item ${isActive ? 'active' : ''}" data-type="genre" data-value="${genre}">
        <span>${genre}</span>
        <span class="filter-count">${count}</span>
      </div>
    `;
  }).join('');
  
  // Render Styles List
  stylesCont.innerHTML = sortedStyles.map(([style, count]) => {
    const isActive = state.filters.styles.includes(style);
    return `
      <div class="filter-item ${isActive ? 'active' : ''}" data-type="style" data-value="${style}">
        <span>${style}</span>
        <span class="filter-count">${count}</span>
      </div>
    `;
  }).join('');
  
  // Add Event listeners to category items
  document.querySelectorAll('.filter-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      const value = item.dataset.value;
      
      if (type === 'genre') {
        const idx = state.filters.genres.indexOf(value);
        if (idx > -1) {
          state.filters.genres.splice(idx, 1);
        } else {
          state.filters.genres.push(value);
        }
      } else if (type === 'style') {
        const idx = state.filters.styles.indexOf(value);
        if (idx > -1) {
          state.filters.styles.splice(idx, 1);
        } else {
          state.filters.styles.push(value);
        }
      }
      
      applyFiltersAndRender();
    });
  });
}

// Render active filter tags in header
function renderActiveFiltersBar() {
  const bar = document.getElementById('active-filters-bar');
  const tagsCont = document.getElementById('active-filters-tags');
  tagsCont.innerHTML = '';
  
  const tags = [];
  
  if (state.filters.starredOnly) {
    tags.push({ label: '★ Favoritos', type: 'starred' });
  }
  if (state.filters.decade) {
    tags.push({ label: `Década: ${state.filters.decade}s`, type: 'decade' });
  }
  state.filters.genres.forEach(g => {
    tags.push({ label: g, type: 'genre', val: g });
  });
  state.filters.styles.forEach(s => {
    tags.push({ label: s, type: 'style', val: s });
  });
  
  if (tags.length > 0) {
    bar.style.display = 'flex';
    tags.forEach(t => {
      const tagDiv = document.createElement('div');
      tagDiv.classList.add('filter-tag');
      tagDiv.innerHTML = `
        <span>${t.label}</span>
        <button class="filter-tag-remove">&times;</button>
      `;
      
      tagDiv.querySelector('.filter-tag-remove').addEventListener('click', () => {
        removeFilterTag(t);
      });
      
      tagsCont.appendChild(tagDiv);
    });
  } else {
    bar.style.display = 'none';
  }
}

function removeFilterTag(tag) {
  if (tag.type === 'starred') {
    state.filters.starredOnly = false;
    document.getElementById('filter-starred').classList.remove('active');
  } else if (tag.type === 'decade') {
    state.filters.decade = '';
    document.getElementById('filter-decade').value = '';
  } else if (tag.type === 'genre') {
    const idx = state.filters.genres.indexOf(tag.val);
    if (idx > -1) state.filters.genres.splice(idx, 1);
  } else if (tag.type === 'style') {
    const idx = state.filters.styles.indexOf(tag.val);
    if (idx > -1) state.filters.styles.splice(idx, 1);
  }
  
  applyFiltersAndRender();
}

// ==================== TIMELINE VIEW LOGIC ====================
function initializeTimelineEvents() {
  const searchInput = document.getElementById('timeline-search-input');
  const sortSelect = document.getElementById('timeline-sort-select');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.timelineQuery = e.target.value.trim().toLowerCase();
      renderTimeline();
    });
  }
  
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.timelineSort = e.target.value;
      renderTimeline();
    });
  }
}

function renderTimeline() {
  const container = document.getElementById('timeline-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // 1. Filter LPs
  let filtered = [...state.lps];
  if (state.timelineQuery) {
    const q = state.timelineQuery.toLowerCase();
    filtered = filtered.filter(lp => {
      return lp.title.toLowerCase().includes(q) || 
             lp.artist.toLowerCase().includes(q) ||
             (lp.genres && lp.genres.some(g => g.toLowerCase().includes(q))) ||
             (lp.styles && lp.styles.some(s => s.toLowerCase().includes(q))) ||
             (lp.labels && lp.labels.some(l => l.toLowerCase().includes(q)));
    });
  }
  
  // 2. Sort LPs
  const sort = state.timelineSort;
  filtered.sort((a, b) => {
    if (sort === 'added_desc') {
      return new Date(b.date_added || 0) - new Date(a.date_added || 0);
    } else if (sort === 'added_asc') {
      return new Date(a.date_added || 0) - new Date(b.date_added || 0);
    } else if (sort === 'release_desc') {
      return (b.year || 0) - (a.year || 0);
    } else if (sort === 'release_asc') {
      const yA = a.year || 9999;
      const yB = b.year || 9999;
      return yA - yB;
    }
    return 0;
  });
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align: center; padding: 40px 0;">Nenhum LP encontrado para os filtros ativos.</p>';
    return;
  }
  
  // 3. Group and render
  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  
  // Pre-calculate count of items in each group
  const groupCounts = {};
  filtered.forEach(lp => {
    let groupTitle = '';
    if (sort.startsWith('added')) {
      const date = new Date(lp.date_added || Date.now());
      const monthName = MONTHS_PT[date.getMonth()];
      const year = date.getFullYear();
      groupTitle = `${monthName} de ${year}`;
    } else {
      if (lp.year && lp.year > 0) {
        const decade = Math.floor(lp.year / 10) * 10;
        groupTitle = `Década de ${decade}`;
      } else {
        groupTitle = 'Lançamento Desconhecido';
      }
    }
    groupCounts[groupTitle] = (groupCounts[groupTitle] || 0) + 1;
  });
  
  let currentGroup = '';
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  
  filtered.forEach(lp => {
    // Determine the group header title
    let groupTitle = '';
    
    if (sort.startsWith('added')) {
      // Group by Month and Year of addition
      const date = new Date(lp.date_added || Date.now());
      const monthName = MONTHS_PT[date.getMonth()];
      const year = date.getFullYear();
      groupTitle = `${monthName} de ${year}`;
    } else {
      // Group by Release Decade
      if (lp.year && lp.year > 0) {
        const decade = Math.floor(lp.year / 10) * 10;
        groupTitle = `Década de ${decade}`;
      } else {
        groupTitle = 'Lançamento Desconhecido';
      }
    }
    
    // Draw group header if it changed
    if (groupTitle !== currentGroup) {
      currentGroup = groupTitle;
      const headerDiv = document.createElement('div');
      headerDiv.className = 'timeline-group-header';
      const count = groupCounts[groupTitle] || 0;
      const countText = `${count} ${count === 1 ? 'Disco' : 'Discos'}`;
      headerDiv.innerHTML = `<span class="timeline-group-title">${groupTitle} - ${countText}</span>`;
      container.appendChild(headerDiv);
    }
    
    // Draw timeline item card
    const itemDiv = document.createElement('div');
    itemDiv.className = 'timeline-item';
    
    // Format friendly date
    let friendlyDate = 'N/A';
    if (lp.date_added) {
      const d = new Date(lp.date_added);
      const day = d.getDate();
      const month = MONTHS_PT[d.getMonth()].toLowerCase();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      friendlyDate = `Adicionado em ${day} de ${month} às ${hours}:${minutes}`;
    }
    
    itemDiv.innerHTML = `
      <div class="timeline-card" data-id="${lp.id}">
        <img class="timeline-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
        <div class="timeline-content-body">
          <div class="timeline-date">${friendlyDate}</div>
          <div class="timeline-title">${lp.title}</div>
          <div class="timeline-artist">${lp.artist}</div>
          <div class="timeline-meta">
            ${lp.year > 0 ? `<span class="timeline-badge">${lp.year}</span>` : ''}
            ${lp.labels && lp.labels.length > 0 ? `<span class="timeline-badge">${lp.labels[0]}</span>` : ''}
            <span class="timeline-badge">🎧 ${lp.plays || 0} audições</span>
          </div>
        </div>
      </div>
    `;
    
    // Bind open details modal on card click
    const cardEl = itemDiv.querySelector('.timeline-card');
    cardEl.addEventListener('click', (e) => {
      openDetailsDialog(lp.id);
    });
    
    container.appendChild(itemDiv);
  });
}

// Renders the main catalog grid
function renderGrid() {
  const grid = document.getElementById('lp-grid');
  const emptyState = document.getElementById('empty-state');
  
  grid.innerHTML = '';
  
  if (state.filteredLps.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  grid.style.display = 'grid';
  emptyState.style.display = 'none';
  
  state.filteredLps.forEach(lp => {
    const card = document.createElement('div');
    card.classList.add('lp-card');
    card.dataset.id = lp.id;
    
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    
    card.innerHTML = `
      <div class="lp-card-cover-wrapper">
        <img class="lp-card-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" loading="lazy" onerror="this.src='${defaultCover}'">
        ${lp.favorite ? `
          <div class="lp-card-starred-badge" title="Favoritado">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </div>
        ` : ''}
      </div>
      <div class="lp-card-info">
        <h4 class="lp-card-title" title="${lp.title}">${lp.title}</h4>
        <p class="lp-card-artist" title="${lp.artist}">${lp.artist}</p>
        
        <!-- Plays and Scrobble Row -->
        <div class="lp-card-plays-row">
          <span class="lp-card-plays-count">🎧 ${lp.plays || 0} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
          <button class="lp-card-scrobble-btn" title="Registrar audição agora" data-id="${lp.id}">
            + Ouvir
          </button>
        </div>

        <div class="lp-card-footer">
          <span class="lp-card-year">${lp.year > 0 ? lp.year : 'N/A'}</span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openDetailsDialog(lp.id);
    });
    
    // Bind click event to scrobble button
    const scrobbleBtn = card.querySelector('.lp-card-scrobble-btn');
    if (scrobbleBtn) {
      scrobbleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent opening details dialog
        markAsListened(lp.id);
      });
    }
    
    grid.appendChild(card);
  });
}

function renderStarsString(rating) {
  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    const isFilled = i <= rating;
    starsHtml += `
      <svg class="star ${isFilled ? 'filled' : ''}" viewBox="0 0 24 24" width="10" height="10">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    `;
  }
  return starsHtml;
}

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

  const sortedLpsByPlays = [...state.lps]
    .filter(lp => lp.plays > 0)
    .sort((a, b) => {
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

    const labelName = `#${idx + 1} - ${lp.title} - ${lp.artist}`;
    const labelVal = `${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'}`;

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
      <img class="addition-thumb" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
      <div class="addition-details">
        <div class="addition-title">${lp.title}</div>
        <div class="addition-artist">${lp.artist}</div>
      </div>
      <div class="addition-time">${formattedDate}</div>
    `;
    additionsCont.appendChild(div);
  });

  renderTimelineStats();
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
        <img class="history-item-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
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
  
  // 1. Get last 12 months (order: newest/current month first, oldest last)
  const today = new Date();
  const last12 = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    last12.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: `${MONTHS_PT[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(-2)}`,
      key: `${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`,
      count: 0
    });
  }

  // 2. Count additions in the last 12 months
  const startTime = new Date(today.getFullYear(), today.getMonth() - 11, 1).getTime();
  let totalAdded = 0;

  state.lps.forEach(lp => {
    if (!lp.date_added) return;
    const addedTime = new Date(lp.date_added).getTime();
    if (addedTime >= startTime) {
      totalAdded++;
      const lpDate = new Date(lp.date_added);
      const lpYear = lpDate.getFullYear();
      const lpMonth = lpDate.getMonth();
      
      const match = last12.find(m => m.year === lpYear && m.month === lpMonth);
      if (match) {
        match.count++;
      }
    }
  });

  // 3. Find most active month
  let mostActiveMonth = null;
  let maxCount = 0;
  last12.forEach(m => {
    if (m.count > maxCount) {
      maxCount = m.count;
      mostActiveMonth = m;
    }
  });

  // 4. Update indicators
  const totalEl = document.getElementById('timeline-stat-total');
  const averageEl = document.getElementById('timeline-stat-average');
  const chartContainer = document.getElementById('timeline-monthly-chart');
  const mostActiveValEl = document.getElementById('timeline-stat-most-active');
  const mostActiveDescEl = document.getElementById('timeline-stat-most-active-count');
  if (!totalEl || !averageEl || !chartContainer || !mostActiveValEl || !mostActiveDescEl) return;

  totalEl.textContent = totalAdded;
  
  if (mostActiveMonth && maxCount > 0) {
    mostActiveValEl.textContent = mostActiveMonth.label;
    mostActiveDescEl.textContent = `${maxCount} ${maxCount === 1 ? 'disco' : 'discos'}`;
  } else {
    mostActiveValEl.textContent = '-';
    mostActiveDescEl.textContent = '0 discos';
  }

  const average = (totalAdded / 12).toFixed(1);
  averageEl.textContent = average.replace('.', ',');

  // 5. Render Monthly Chart
  chartContainer.innerHTML = '';

  const maxVal = Math.max(...last12.map(m => m.count), 1);

  last12.forEach(m => {
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
    
    // Trigger animation in next frame
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = barRow.querySelector('.chart-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      }, 50);
    });
  });
}

// ==================== DIALOGS & FORM MANAGEMENT ====================
const LP_FORM_EDITABLE_FIELD_IDS = [
  'form-cover-url',
  'form-title',
  'form-year',
  'form-artist',
  'form-label',
  'form-catno',
  'form-notes'
];

function setLpFormFieldsLocked(locked) {
  LP_FORM_EDITABLE_FIELD_IDS.forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.readOnly = locked;
      field.classList.toggle('readonly-field', locked);
    }
  });

  const stars = document.getElementById('form-rating-stars');
  if (stars) {
    stars.dataset.readonly = locked ? 'true' : 'false';
    stars.classList.toggle('readonly-stars', locked);
  }

  const submitBtn = document.getElementById('form-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = locked;
  }
}

function initializeDialogs() {
  const detailDialog = document.getElementById('lp-details-dialog');
  const formDialog = document.getElementById('lp-form-dialog');
  const artistAlbumsDialog = document.getElementById('artist-albums-dialog');
  const lpForm = document.getElementById('lp-entry-form');
  const addBtn = document.getElementById('add-lp-btn');
  
  // Bind close buttons in dialogs
  document.querySelectorAll('[data-dialog-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailDialog.close();
      formDialog.close();
      if (artistAlbumsDialog) artistAlbumsDialog.close();
    });
  });
  
  // Global backdrop click to close
  window.addEventListener('click', (e) => {
    if (e.target === detailDialog) detailDialog.close();
    if (e.target === formDialog) formDialog.close();
    if (e.target === artistAlbumsDialog) artistAlbumsDialog.close();
  });
  
  // Add LP button click
  addBtn.addEventListener('click', () => {
    openFormDialog();
  });
  
  // Image preview in Form
  const coverUrlInput = document.getElementById('form-cover-url');
  const coverPreview = document.getElementById('form-cover-preview');
  
  coverUrlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
      coverPreview.src = url;
    } else {
      coverPreview.removeAttribute('src');
    }
  });
  
  // Form submission
  lpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFormEntry();
  });

  // Discogs API Search Logic
  const discogsSearchInput = document.getElementById('discogs-search-input');
  const discogsSearchBtn = document.getElementById('discogs-search-btn');
  const discogsSearchResults = document.getElementById('discogs-search-results');

  // Search button click
  if (discogsSearchBtn && discogsSearchInput && discogsSearchResults) {
    discogsSearchBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const query = discogsSearchInput.value.trim();

      if (!query) {
        showToast('Digite um termo de busca!', 'error');
        return;
      }

      discogsSearchBtn.disabled = true;
      discogsSearchBtn.textContent = 'Buscando...';
      discogsSearchResults.innerHTML = '<p class="text-muted" style="font-size: 0.8rem; padding: 12px; text-align: center;">Buscando LPs...</p>';
      discogsSearchResults.style.display = 'block';

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Erro ao realizar busca.');
        }

        const results = data.results || [];
        discogsSearchResults.innerHTML = '';

        if (results.length === 0) {
          discogsSearchResults.innerHTML = '<p class="text-muted" style="font-size: 0.8rem; padding: 12px; text-align: center;">Nenhum LP encontrado.</p>';
          return;
        }

        results.forEach(item => {
          // Discogs usually returns title in format "Artist - Title"
          const parts = item.title.split(' - ');
          let artist = 'Desconhecido';
          let title = item.title;
          if (parts.length > 1) {
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          }

          // Clean artist/label numeric suffixes like "Pink Floyd (2)"
          artist = artist.replace(/\s\(\d+\)/g, '');

          const label = item.label ? item.label[0] : 'N/A';
          const catno = item.catno || 'N/A';
          const year = item.year || 'N/A';
          const thumb = item.thumb || 'placeholder.png';
          
          const resultItem = document.createElement('div');
          resultItem.className = 'discogs-result-item';
          resultItem.innerHTML = `
            <img class="discogs-result-thumb" src="${thumb}" alt="Capa" onerror="this.src='placeholder.png'">
            <div class="discogs-result-info">
              <div class="discogs-result-title" title="${title}">${title}</div>
              <div class="discogs-result-artist" title="${artist}">${artist}</div>
              <div class="discogs-result-meta">Gravadora: ${label} | Catálogo: ${catno} | Ano: ${year}</div>
            </div>
          `;

          // When result item is clicked, autofill form
          resultItem.addEventListener('click', () => {
            document.getElementById('form-title').value = title;
            document.getElementById('form-artist').value = artist;
            document.getElementById('form-year').value = item.year && !isNaN(item.year) ? item.year : '';
            document.getElementById('form-label').value = label.replace(/\s\(\d+\)/g, '');
            document.getElementById('form-catno').value = catno;
            
            // Map genres and styles
            const formEl = document.getElementById('lp-entry-form');
            if (formEl) {
              formEl.dataset.genres = item.genre ? item.genre.join(', ') : '';
              formEl.dataset.styles = item.style ? item.style.join(', ') : '';
            }

            // Fill cover url and preview
            const coverUrl = item.cover_image || item.thumb || '';
            document.getElementById('form-cover-url').value = coverUrl;
            
            const coverPreview = document.getElementById('form-cover-preview');
            if (coverUrl) {
              coverPreview.src = coverUrl;
            } else {
              coverPreview.removeAttribute('src');
            }

            // Collapse search results
            discogsSearchResults.style.display = 'none';
            setLpFormFieldsLocked(false);
            showToast('Dados do LP preenchidos!', 'success');
          });

          discogsSearchResults.appendChild(resultItem);
        });
      } catch (err) {
        showToast(err.message, 'error');
        discogsSearchResults.innerHTML = `<p class="text-danger" style="font-size: 0.8rem; padding: 12px; text-align: center;">Erro: ${err.message}</p>`;
      } finally {
        discogsSearchBtn.disabled = false;
        discogsSearchBtn.textContent = 'Buscar';
      }
    });

    // Support search by pressing Enter in input
    discogsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        discogsSearchBtn.click();
      }
    });
  }
}

function openDetailsDialog(id) {
  const lp = state.lps.find(item => item.id == id);
  if (!lp) return;
  
  const dialog = document.getElementById('lp-details-dialog');
  
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  document.getElementById('details-cover').src = lp.cover_image || lp.thumbnail || defaultCover;
  document.getElementById('details-title').textContent = lp.title;
  document.getElementById('details-artist').textContent = lp.artist;
  document.getElementById('details-year').textContent = lp.year > 0 ? lp.year : 'Ano Desconhecido';
  document.getElementById('details-label-name').textContent = lp.labels.join(', ') || 'N/A';
  document.getElementById('details-catno').textContent = lp.catalog_number || 'N/A';
  
  // Formatting date added
  let addedDate = 'N/A';
  if (lp.date_added) {
    const d = new Date(lp.date_added);
    addedDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  document.getElementById('details-date').textContent = addedDate;
  
  // Genre and style tags
  const detailsGenres = document.getElementById('details-genres');
  const detailsStyles = document.getElementById('details-styles');
  detailsGenres.innerHTML = lp.genres.map(g => `<span class="tag-bubble">${g}</span>`).join('') || '<span class="text-muted">Nenhum</span>';
  detailsStyles.innerHTML = lp.styles.map(s => `<span class="tag-bubble">${s}</span>`).join('') || '<span class="text-muted">Nenhum</span>';
  
  // Details note text
  document.getElementById('details-notes-text').textContent = lp.notes || '';
  
  // Interactive stars
  renderDetailsStars(lp);
  
  // Details Action Buttons
  const markListenedBtn = document.getElementById('details-mark-listened');
  const unlistenBtn = document.getElementById('details-unlisten-btn');
  const favoriteBtn = document.getElementById('details-favorite-btn');
  const editBtn = document.getElementById('details-edit-btn');
  const deleteBtn = document.getElementById('details-delete-btn');
  
  // Update play count on the button
  const detailsPlaysCount = document.getElementById('details-plays-count');
  if (detailsPlaysCount) {
    detailsPlaysCount.textContent = lp.plays || 0;
  }
  
  // Re-bind actions to exact LP id
  if (markListenedBtn) {
    markListenedBtn.onclick = () => {
      markAsListened(lp.id);
    };
  }
  if (unlistenBtn) {
    unlistenBtn.onclick = () => {
      unmarkAsListened(lp.id);
    };
  }
  updateDetailsAuditionControls(lp);

  updateDetailsFavoriteBtn(lp);
  if (favoriteBtn) {
    favoriteBtn.onclick = () => {
      toggleFavoriteState(lp.id);
    };
  }
  
  editBtn.onclick = () => {
    dialog.close();
    openFormDialog(lp.id);
  };
  
  deleteBtn.onclick = () => {
    if (confirm(`Tem certeza que deseja excluir "${lp.title}" da sua coleção?`)) {
      deleteLpEntry(lp.id);
      dialog.close();
    }
  };
  
  dialog.showModal();
}

function renderDetailsStars(lp) {
  const container = document.getElementById('details-rating-stars');
  container.innerHTML = '';
  
  for (let i = 1; i <= 5; i++) {
    const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starSvg.setAttribute('viewBox', '0 0 24 24');
    starSvg.setAttribute('width', '24');
    starSvg.setAttribute('height', '24');
    starSvg.classList.add('star');
    if (i <= lp.rating) {
      starSvg.classList.add('filled');
    }
    
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
    starSvg.appendChild(poly);
    
    starSvg.addEventListener('click', () => {
      rateLp(lp.id, i);
      renderDetailsStars(lp);
    });
    container.appendChild(starSvg);
  }
}

function openFormDialog(editId = null) {
  const dialog = document.getElementById('lp-form-dialog');
  const formTitle = document.getElementById('form-dialog-title');
  const submitBtn = document.getElementById('form-submit-btn');
  const lpForm = document.getElementById('lp-entry-form');
  
  lpForm.reset();
  lpForm.dataset.genres = '';
  lpForm.dataset.styles = '';
  document.getElementById('form-lp-id').value = '';
  document.getElementById('form-cover-preview').removeAttribute('src');
  
  const searchSection = document.getElementById('discogs-search-section');
  const dividerText = document.getElementById('form-divider-text');
  
  if (searchSection && dividerText) {
    if (editId) {
      searchSection.style.display = 'none';
      dividerText.style.display = 'none';
    } else {
      searchSection.style.display = 'block';
      dividerText.style.display = 'block';
      
      // Reset search fields
      document.getElementById('discogs-search-input').value = '';
      const resultsCont = document.getElementById('discogs-search-results');
      resultsCont.innerHTML = '';
      resultsCont.style.display = 'none';
    }
  }
  
  let ratingVal = 0;
  
  if (editId) {
    // Edit mode
    const lp = state.lps.find(item => item.id == editId);
    if (!lp) return;
    
    formTitle.textContent = `Editar LP: ${lp.title}`;
    submitBtn.textContent = 'Salvar Alterações';
    
    document.getElementById('form-lp-id').value = lp.id;
    document.getElementById('form-title').value = lp.title;
    document.getElementById('form-artist').value = lp.artist;
    document.getElementById('form-year').value = lp.year > 0 ? lp.year : '';
    document.getElementById('form-label').value = lp.labels.join(', ');
    document.getElementById('form-catno').value = lp.catalog_number;
    lpForm.dataset.genres = lp.genres ? lp.genres.join(', ') : '';
    lpForm.dataset.styles = lp.styles ? lp.styles.join(', ') : '';
    document.getElementById('form-cover-url').value = lp.cover_image;
    document.getElementById('form-notes').value = lp.notes;
    
    const coverPreview = document.getElementById('form-cover-preview');
    if (lp.cover_image) {
      coverPreview.src = lp.cover_image;
    }
    
    ratingVal = lp.rating;
  } else {
    // Add mode
    formTitle.textContent = 'Adicionar Novo LP';
    submitBtn.textContent = 'Adicionar LP';
  }
  
  // Interactive stars in form
  renderFormStars(ratingVal);
  setLpFormFieldsLocked(!editId);
  
  dialog.showModal();
}

function renderFormStars(rating) {
  const container = document.getElementById('form-rating-stars');
  container.innerHTML = '';
  
  // Track selected rating locally in form
  container.dataset.rating = rating;
  
  for (let i = 1; i <= 5; i++) {
    const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starSvg.setAttribute('viewBox', '0 0 24 24');
    starSvg.setAttribute('width', '24');
    starSvg.setAttribute('height', '24');
    starSvg.classList.add('star');
    if (i <= rating) {
      starSvg.classList.add('filled');
    }
    
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
    starSvg.appendChild(poly);
    
    starSvg.addEventListener('click', () => {
      if (container.dataset.readonly === 'true') return;
      container.dataset.rating = i;
      // Re-fill stars locally
      const allStars = container.querySelectorAll('.star');
      allStars.forEach((s, idx) => {
        s.classList.toggle('filled', idx < i);
      });
    });
    container.appendChild(starSvg);
  }
}

async function saveFormEntry() {
  const idInput = document.getElementById('form-lp-id').value;
  if (!idInput && document.getElementById('form-submit-btn').disabled) {
    showToast('Busque um disco no Discogs e selecione um resultado antes de salvar.', 'error');
    return;
  }

  const title = document.getElementById('form-title').value.trim();
  const artist = document.getElementById('form-artist').value.trim();
  const yearVal = document.getElementById('form-year').value;
  const year = yearVal ? parseInt(yearVal) : null;
  
  const labelsStr = document.getElementById('form-label').value;
  const labels = labelsStr ? labelsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  
  const catno = document.getElementById('form-catno').value.trim();
  
  const lpForm = document.getElementById('lp-entry-form');
  const genresStr = lpForm ? (lpForm.dataset.genres || '') : '';
  const genres = genresStr ? genresStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  
  const stylesStr = lpForm ? (lpForm.dataset.styles || '') : '';
  const styles = stylesStr ? stylesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  
  const coverImage = document.getElementById('form-cover-url').value.trim();
  const notes = document.getElementById('form-notes').value.trim();
  const rating = parseInt(document.getElementById('form-rating-stars').dataset.rating || 0);
  const favorite = rating >= 4;
  
  const payload = {
    title,
    artist,
    year,
    cover_url: coverImage,
    labels,
    catalog_numbers: catno ? [catno] : [],
    genres,
    styles,
    notes,
    rating,
    favorite
  };
  
  if (idInput) {
    // EDIT
    try {
      const response = await fetch(`/api/admin/releases/${idInput}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Erro ao salvar alterações no LP.');
      
      const lp = state.lps.find(item => item.id == idInput);
      if (lp) {
        lp.title = title;
        lp.artist = artist;
        lp.year = year;
        lp.labels = labels;
        lp.catalog_number = catno;
        lp.genres = genres;
        lp.styles = styles;
        lp.cover_image = coverImage;
        lp.thumbnail = coverImage;
        lp.notes = notes;
        lp.rating = rating;
        lp.favorite = favorite;
        
        // Update agenda copy if it matches
        state.agenda.forEach((item, idx) => {
          if (item.id == idInput) {
            state.agenda[idx] = lp;
          }
        });
        renderWeeklyAgenda();
        renderSelectedAgendaLp();
        renderHistoryRanking();
        
        showToast('LP atualizado com sucesso!', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro ao atualizar LP no servidor.', 'error');
    }
  } else {
    // ADD NEW
    try {
      const response = await fetch('/api/admin/releases/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Erro ao adicionar LP.');
      const data = await response.json();
      
      const newLp = {
        id: data.release.release_id,
        title,
        artist,
        year,
        cover_image: coverImage || data.release.cover_url,
        thumbnail: coverImage || data.release.cover_url,
        genres: genres.length > 0 ? genres : (data.release.genres || ['Rock']),
        styles: styles.length > 0 ? styles : (data.release.styles || []),
        labels: labels.length > 0 ? labels : (data.release.labels || ['Independente']),
        catalog_number: catno,
        date_added: new Date().toISOString(),
        rating,
        favorite,
        notes,
        plays: 0,
        listen_dates: []
      };
      
      state.lps.unshift(newLp);
      
      if (state.agenda.length === 0) {
        generateWeeklyAgenda(false);
        renderWeeklyAgenda();
        renderSelectedAgendaLp();
      }
      renderHistoryRanking();
      
      showToast('Álbum adicionado ao catálogo!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao adicionar LP no servidor.', 'error');
    }
  }
  
  applyFiltersAndRender();
  document.getElementById('lp-form-dialog').close();
}

async function deleteLpEntry(id) {
  const index = state.lps.findIndex(lp => lp.id == id);
  if (index > -1) {
    const deletedTitle = state.lps[index].title;
    try {
      const response = await fetch(`/api/admin/releases/${id}/delete`, { method: 'POST' });
      if (!response.ok) throw new Error('Erro ao excluir LP.');
      
      state.lps.splice(index, 1);
      
      // If the deleted LP was part of the agenda, regenerate agenda
      const isPart = state.agenda.some(item => item.id == id);
      if (isPart) {
        generateWeeklyAgenda(true);
        renderWeeklyAgenda();
        renderSelectedAgendaLp();
      }
      renderHistoryRanking();
      
      applyFiltersAndRender();
      showToast(`"${deletedTitle}" excluído.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao excluir LP no servidor.', 'error');
    }
  }
}

// ==================== TOAST MESSAGES ====================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.classList.add('toast', type);
  
  // SVG Icon based on type
  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--success)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
  } else if (type === 'error') {
    iconHtml = `
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--danger)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
  }
  
  toast.innerHTML = `
    ${iconHtml}
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Animate slide-out and remove toast
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease-in forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

// Inline inject keyframe for toast-out if needed (avoiding CSS bloating)
const style = document.createElement('style');
style.textContent = `
  @keyframes toast-out {
    to {
      transform: translateY(20px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// ==================== RANKING DE AUDIÇÕES PAGE ====================
function renderPlaysRankingPage() {
  const podiumContainer = document.getElementById('ranking-podium');
  const emptyState = document.getElementById('ranking-empty-state');
  const listSection = document.getElementById('ranking-list-section');
  const playsChartContainer = document.getElementById('plays-chart-container');
  
  if (!podiumContainer || !emptyState || !listSection || !playsChartContainer) return;
  
  // Sort LPs by play count descending, and title A-Z if plays are equal
  const sorted = state.lps
    .filter(lp => lp.plays > 0)
    .sort((a, b) => {
      if (b.plays !== a.plays) {
        return b.plays - a.plays;
      }
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
    
    return `
      <div class="podium-step ${positionClass}" data-lp-id="${lp.id}">
        <div class="podium-cover-wrapper">
          <div class="podium-crown">${crownEmoji}</div>
          <img class="podium-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.src='${defaultCover}'">
          <span class="podium-badge">#${rank}</span>
        </div>
        <div class="podium-column">
          <div class="podium-info">
            <div class="podium-title" title="${lp.title}">${lp.title}</div>
            <div class="podium-artist" title="${lp.artist}">${lp.artist}</div>
            <div class="podium-plays">
              <span>${lp.plays} ${lp.plays === 1 ? 'audição' : 'audições'}</span>
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
}

// ==================== SETTINGS SCREEN LOGIC ====================
function updateSyncStatusUI(config) {
  const container = document.getElementById('last-sync-status-container');
  if (!container) return;
  
  if (config.last_sync_at) {
    container.style.display = 'block';
    const dt = new Date(parseFloat(config.last_sync_at) * 1000);
    const dateFormatted = dt.toLocaleDateString('pt-BR');
    const timeFormatted = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    document.getElementById('last-sync-time').textContent = `${dateFormatted} às ${timeFormatted}`;
    document.getElementById('last-sync-total').textContent = config.last_sync_count || '0';
    document.getElementById('last-sync-added').textContent = config.last_sync_added || '0';
    document.getElementById('last-sync-updated').textContent = config.last_sync_updated || '0';
    document.getElementById('last-sync-deleted').textContent = config.last_sync_deleted || '0';
  } else {
    container.style.display = 'none';
  }
}

async function loadSettingsFromServer() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Não foi possível carregar as configurações do servidor.');
    
    const config = await response.json();
    
    document.getElementById('setting-discogs-user').value = config.discogs_user || '';
    document.getElementById('setting-discogs-user-agent').value = config.discogs_user_agent || '';
    
    document.getElementById('setting-discogs-token').value = config.discogs_token || '';
    
    document.getElementById('setting-shazam-key').value = config.rapidapi_shazam_key || '';
    document.getElementById('setting-shazam-host').value = config.rapidapi_shazam_host || '';
    
    updateSyncStatusUI(config);
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast(error.message, 'error');
  }
}

function initializeSettingsForm() {
  const form = document.getElementById('settings-form');
  const syncBtn = document.getElementById('admin-sync-btn');
  
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const originalText = syncBtn.innerHTML;
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="sync-icon-svg spinning" style="transition: transform 0.3s ease;">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        <span>Sincronizando...</span>
      `;
      
      try {
        const response = await fetch('/api/sync', { method: 'POST' });
        if (!response.ok) throw new Error('Falha ao iniciar sincronização.');
        const data = await response.json();
        
        if (data.status === 'ok') {
          let summary = `Sincronização concluída com sucesso!<br>`;
          summary += `• <b>Total no Discogs:</b> ${data.count} LPs<br>`;
          summary += `• <b>Adicionados:</b> ${data.added} novos<br>`;
          summary += `• <b>Atualizados:</b> ${data.updated} existentes<br>`;
          summary += `• <b>Removidos:</b> ${data.deleted} removidos`;
          showToast(summary, 'success');
          
          updateSyncStatusUI({
            last_sync_at: (Date.now() / 1000).toString(),
            last_sync_count: data.count,
            last_sync_added: data.added,
            last_sync_updated: data.updated,
            last_sync_deleted: data.deleted
          });
          
          await loadDatabase();
          applyFiltersAndRender();
        } else {
          showToast(`Erro na sincronização: ${data.message || 'Erro desconhecido'}`, 'error');
        }
      } catch (error) {
        console.error('Error syncing collection:', error);
        showToast(`Erro do servidor ao sincronizar: ${error.message}`, 'error');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
      }
    });
  }

  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const discogs_user = document.getElementById('setting-discogs-user').value.trim();
    const discogs_user_agent = document.getElementById('setting-discogs-user-agent').value.trim();
    const discogs_token = document.getElementById('setting-discogs-token').value.trim();
    const rapidapi_shazam_key = document.getElementById('setting-shazam-key').value.trim();
    const rapidapi_shazam_host = document.getElementById('setting-shazam-host').value.trim();
    
    const payload = {
      discogs_user,
      discogs_user_agent,
      discogs_token,
      rapidapi_shazam_key,
      rapidapi_shazam_host
    };
    
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('Falha ao salvar as configurações.');
      
      showToast('Configurações salvas com sucesso!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showToast(error.message, 'error');
    }
  });
}
