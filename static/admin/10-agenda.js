// Admin do PlayVinil — Escuta da Semana (sugestões) e histórico de audições.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

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

async function saveWeeklyAgendaToServer() {
  try {
    const ids = state.agenda.map(lp => lp.id);
    const response = await fetch('/api/admin/agenda', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids })
    });
    if (!response.ok) throw new Error('Erro ao salvar agenda no servidor');
  } catch (e) {
    console.error('Error saving weekly agenda:', e);
    showToast('Erro ao sincronizar agenda com o servidor.', 'error');
  }
}

async function loadWeeklyAgenda() {
  try {
    const response = await fetch('/api/ouvir/agenda');
    if (!response.ok) throw new Error('Falha ao obter agenda do servidor');
    const agendaData = await response.json();
    
    // Map server format to state.agenda using loaded state.lps
    state.agenda = agendaData.map(r => state.lps.find(lp => lp.id == r.id)).filter(Boolean);
    
    // Fallback if length isn't 7
    if (state.agenda.length !== 7) {
      generateWeeklyAgenda(true);
    }
  } catch (e) {
    console.error('Error loading weekly agenda from server:', e);
    generateWeeklyAgenda(false);
  }
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
  saveWeeklyAgendaToServer();
}

function renderWeeklyAgenda() {
  const container = document.getElementById('agenda-scroll-container');
  if (!container) return;

  container.innerHTML = '';

  if (state.agenda.length === 0) {
    container.innerHTML = '<p class="text-muted">Nenhuma indicação disponível.</p>';
    return;
  }

  const todayIdx = getTodayAgendaIndex(); // 0=Dom ... 6=Sáb

  // Limites da semana atual (Dom 00:00 → Sáb 23:59)
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Calcula o estado de cada slot da agenda
  let completedCount = 0;
  const cardStates = state.agenda.map((lp, index) => {
    const listenedThisWeek = Array.isArray(lp.listen_dates) && lp.listen_dates.some(ds => {
      const d = new Date(ds);
      return d >= startOfWeek && d <= endOfWeek;
    });
    if (listenedThisWeek) { completedCount++; return 'done'; }
    if (index < todayIdx) return 'missed';
    return 'pending';
  });

  // Atualiza a barra de progresso
  renderWeeklyProgressBar(completedCount, cardStates, todayIdx);

  const defaultCover = '/static/logo_lp_da_semana.png';
  container.classList.add('agenda-list');

  // Data de cada dia desta semana (para mostrar "Qui, 05/11" e quando foi ouvido)
  const dayDate = (index) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + index);
    return d;
  };
  const listenedAt = (lp) => (lp.listen_dates || [])
    .map(ds => new Date(ds))
    .filter(d => d >= startOfWeek && d <= endOfWeek)
    .sort((a, b) => b - a)[0];
  const esc = (text) => {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  };

  state.agenda.forEach((lp, index) => {
    const st = cardStates[index];
    const row = document.createElement('div');
    row.className = `agenda-row agenda-${st}${index === todayIdx ? ' today' : ''}`;
    row.dataset.index = index;
    const date = dayDate(index);
    const dateText = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    const heard = listenedAt(lp);
    let status;
    if (st === 'done') {
      status = `<span class="agenda-status done">✓ Ouvido${heard ? ' ' + heard.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : ''}</span>`;
    } else if (st === 'missed') {
      status = '<span class="agenda-status missed">Não ouvido</span>';
    } else if (index === todayIdx) {
      status = '<span class="agenda-status today">Hoje</span>';
    } else {
      status = '<span class="agenda-status pending">A ouvir</span>';
    }
    row.innerHTML = `
      <div class="agenda-row-day">
        <span class="agenda-row-dayname">${AGENDA_DAYS[index].slice(0, 3)}</span>
        <span class="agenda-row-date">${dateText}</span>
      </div>
      <img class="agenda-row-cover" src="${esc(lp.thumbnail || lp.cover_image || defaultCover)}" alt="" loading="lazy" onerror="this.onerror=null; this.src='${defaultCover}'">
      <div class="agenda-row-info">
        <div class="agenda-row-title">${esc(lp.title)}</div>
        <div class="agenda-row-artist">${esc(lp.artist)}</div>
        ${status}
      </div>
      <div class="agenda-row-actions">
        ${st === 'done' ? '' : '<button type="button" class="btn btn-primary agenda-row-listen" title="Marcar como ouvido">Ouvi</button>'}
        <button type="button" class="agenda-row-change" title="Trocar o disco deste dia" aria-label="Trocar o disco deste dia">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </div>`;

    // Tocar no disco abre a ficha; os botões fazem a ação sem abrir
    row.addEventListener('click', () => {
      state.selectedAgendaIndex = index;
      openDetailsDialog(lp.id);
    });
    const listenBtn = row.querySelector('.agenda-row-listen');
    if (listenBtn) {
      listenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedAgendaIndex = index;
        markAsListened(lp.id);
      });
    }
    row.querySelector('.agenda-row-change').addEventListener('click', (e) => {
      e.stopPropagation();
      changeSingleDayAgendaLp(index);
    });

    container.appendChild(row);
  });
}

function renderWeeklyProgressBar(completedCount, cardStates, todayIdx) {
  const countEl    = document.getElementById('weekly-progress-count');
  const messageEl  = document.getElementById('weekly-progress-message');
  if (!countEl || !messageEl) return;

  countEl.textContent = `${completedCount}/7`;

  const missedCount = cardStates.filter(s => s === 'missed').length;
  const remaining   = 6 - todayIdx;
  let msg = '', cls = '';

  if (completedCount === 7) {
    msg = '🎉 Semana perfeita! Todos os discos ouvidos!'; cls = 'msg--perfect';
  } else if (completedCount > 0 && missedCount === 0 && completedCount === todayIdx + 1) {
    msg = '🔥 Em dia! Você está acompanhando a semana!'; cls = 'msg--on-track';
  } else if (completedCount > 0 && missedCount === 0) {
    msg = `✨ ${completedCount} ouvido${completedCount > 1 ? 's' : ''}! Continue assim!`; cls = 'msg--good';
  } else if (completedCount > 0 && missedCount > 0) {
    msg = `${completedCount} ouvido${completedCount > 1 ? 's' : ''} · ${missedCount} perdido${missedCount > 1 ? 's' : ''}. Ainda há ${remaining} dia${remaining !== 1 ? 's' : ''} para recuperar!`; cls = 'msg--partial';
  } else if (completedCount === 0 && missedCount > 0) {
    msg = `Semana difícil? Ainda ${remaining} dia${remaining !== 1 ? 's' : ''} pela frente — comece hoje!`; cls = 'msg--behind';
  } else {
    msg = 'Ouça o disco de hoje e comece a semana com chave de ouro!'; cls = 'msg--start';
  }

  messageEl.textContent = msg;
  messageEl.className   = `weekly-progress-message ${cls}`;
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
    saveWeeklyAgendaToServer();
    
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
  // v4.4.1: o painel "Disco selecionado" saiu da tela; a lista dos dias mostra tudo
  if (!document.getElementById('suggested-title')) return;
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
  renderWeeklyHistory();
      
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
  renderWeeklyHistory();

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
        <img class="history-item-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
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
      } else if (state.currentView === 'favorites') {
        const card = document.querySelector(`#favorites-grid .lp-card[data-id="${id}"]`);
        if (card && !lp.favorite) {
          card.classList.add('fade-out');
          setTimeout(() => {
            renderFavoritesGrid();
          }, 300);
        } else {
          renderFavoritesGrid();
        }
      }
      showToast(lp.favorite ? 'Adicionado aos Favoritos!' : 'Removido dos Favoritos.', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erro ao favoritar disco no servidor.', 'error');
    }
  }
}
