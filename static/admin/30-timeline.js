// Admin do PlayVinil — Linha do tempo.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

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
  let currentDetails = null;
  let currentItemsContainer = null;
  let isFirstGroup = true;
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
      
      currentDetails = document.createElement('details');
      currentDetails.className = 'timeline-group-details';
      if (isFirstGroup) {
        currentDetails.open = true;
        isFirstGroup = false;
      }
      
      const summary = document.createElement('summary');
      summary.className = 'timeline-group-header';
      
      const count = groupCounts[groupTitle] || 0;
      const countText = `${count} ${count === 1 ? 'Disco' : 'Discos'}`;
      summary.innerHTML = `
        <span class="timeline-group-title">${groupTitle} - ${countText}</span>
        <button class="timeline-scroll-top-btn" title="Voltar ao topo" style="
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 0.8rem;
          margin-left: 8px;
          padding: 2px 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s ease, transform 0.2s ease;
        ">
          ▲
        </button>
      `;
      
      const scrollTopBtn = summary.querySelector('.timeline-scroll-top-btn');
      if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const topSection = document.getElementById('view-timeline');
          if (topSection) {
            topSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        scrollTopBtn.addEventListener('mouseenter', () => {
          scrollTopBtn.style.color = 'var(--primary)';
          scrollTopBtn.style.transform = 'translateY(-2px)';
        });
        scrollTopBtn.addEventListener('mouseleave', () => {
          scrollTopBtn.style.color = 'var(--text-muted)';
          scrollTopBtn.style.transform = 'translateY(0)';
        });
      }
      
      currentDetails.appendChild(summary);
      
      currentItemsContainer = document.createElement('div');
      currentItemsContainer.className = 'timeline-group-items';
      currentDetails.appendChild(currentItemsContainer);
      
      container.appendChild(currentDetails);
    }
    
    // Draw timeline item card
    const itemDiv = document.createElement('div');
    itemDiv.className = 'timeline-item';
    
    // Format friendly date
    let friendlyDate = 'N/A';
    if (lp.date_added) {
      const d = new Date(lp.date_added);
      const day = d.getDate();
      const month = MONTHS_PT[d.getMonth()].toUpperCase();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      friendlyDate = `ADICIONADO EM ${day} DE ${month} ÀS ${hours}:${minutes}`;
    }
    
    itemDiv.innerHTML = `
      <div class="timeline-card" data-id="${lp.id}">
        <img class="timeline-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" onerror="this.onerror=null; this.src='${defaultCover}'">
        <div class="timeline-content-body">
          <div class="timeline-title-row">
            <span class="timeline-title">${lp.title}</span>
            <span class="timeline-artist">- ${lp.artist}</span>
          </div>
          <div class="timeline-date">${friendlyDate}</div>
          ${lp.notes ? `<div class="timeline-origin" title="De onde veio (notas do Discogs)">🛒 ${timelineEscape(lp.notes)}</div>` : ''}
        </div>
        <div class="timeline-play-count">${lp.plays || 0} ${lp.plays === 1 ? 'audição' : 'audições'}</div>
      </div>
    `;
    
    // Bind open details modal on card click
    const cardEl = itemDiv.querySelector('.timeline-card');
    cardEl.addEventListener('click', (e) => {
      openDetailsDialog(lp.id);
    });
    
    if (currentItemsContainer) {
      currentItemsContainer.appendChild(itemDiv);
    }
  });

  renderTimelineStats();
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
        <button class="lp-card-fav-btn ${lp.favorite ? 'active' : ''}" title="${lp.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" data-id="${lp.id}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="${lp.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
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
          <span class="lp-card-year">
            ${lp.original_year > 0 ? (lp.edition_year > 0 && lp.edition_year !== lp.original_year ? `${lp.original_year} <span style="font-size: 0.8em; opacity: 0.75; font-weight: normal;">(Ed. ${lp.edition_year})</span>` : lp.original_year) : 'N/A'}
          </span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openDetailsDialog(lp.id);
    });

    // Bind click event to favorite button
    const favBtn = card.querySelector('.lp-card-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent opening details dialog
        toggleFavoriteState(lp.id);
      });
    }
    
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

function initializeFavoritesControls() {
  const searchInput = document.getElementById('favorites-search-input');
  const clearSearchBtn = document.getElementById('clear-favorites-search-btn');
  const sortSelect = document.getElementById('favorites-sort-select');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.favoritesQuery = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = e.target.value.length > 0 ? 'flex' : 'none';
      }
      renderFavoritesGrid();
    });
  }
  
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.favoritesQuery = '';
      clearSearchBtn.style.display = 'none';
      renderFavoritesGrid();
    });
  }
  
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.favoritesSortBy = e.target.value;
      renderFavoritesGrid();
    });
  }
}

function renderFavoritesGrid() {
  const grid = document.getElementById('favorites-grid');
  const emptyState = document.getElementById('favorites-empty-state');
  const filteredCountElem = document.getElementById('favorites-filtered-count');
  
  if (!grid) return;
  
  grid.innerHTML = '';
  
  // v4.2: Prateleiras — Favoritos ou a prateleira escolhida
  let favorites = (typeof currentShelfLps === 'function')
    ? currentShelfLps()
    : state.lps.filter(lp => lp.favorite === true);
  
  // Apply search query
  if (state.favoritesQuery) {
    const query = state.favoritesQuery.toLowerCase().trim();
    favorites = favorites.filter(lp => 
      (lp.title && lp.title.toLowerCase().includes(query)) ||
      (lp.artist && lp.artist.toLowerCase().includes(query))
    );
  }
  
  // Apply sorting
  favorites.sort((a, b) => {
    if (state.favoritesSortBy === 'added_desc') {
      return new Date(b.date_added) - new Date(a.date_added);
    }
    if (state.favoritesSortBy === 'added_asc') {
      return new Date(a.date_added) - new Date(b.date_added);
    }
    if (state.favoritesSortBy === 'year_desc') {
      return (b.original_year || b.year) - (a.original_year || a.year);
    }
    if (state.favoritesSortBy === 'year_asc') {
      return (a.original_year || a.year) - (b.original_year || b.year);
    }
    if (state.favoritesSortBy === 'title_asc') {
      return (a.title || '').localeCompare(b.title || '');
    }
    if (state.favoritesSortBy === 'artist_asc') {
      return (a.artist || '').localeCompare(b.artist || '');
    }
    if (state.favoritesSortBy === 'rating_desc') {
      return (b.rating || 0) - (a.rating || 0);
    }
    if (state.favoritesSortBy === 'plays_desc') {
      return (b.plays || 0) - (a.plays || 0) || lastListenTs(b) - lastListenTs(a);
    }
    if (state.favoritesSortBy === 'listened_desc') {
      return lastListenTs(b) - lastListenTs(a);
    }
    if (state.favoritesSortBy === 'listened_asc') {
      // Nunca ouvidos primeiro, depois os parados há mais tempo
      return lastListenTs(a) - lastListenTs(b);
    }
    if (state.favoritesSortBy === 'shelf_added_desc' && typeof shelfAddedAt === 'function') {
      return shelfAddedAt(b) - shelfAddedAt(a);
    }
    return 0;
  });
  
  if (filteredCountElem) {
    filteredCountElem.textContent = favorites.length;
  }
  
  if (favorites.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  
  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  
  favorites.forEach(lp => {
    const card = document.createElement('div');
    card.classList.add('lp-card');
    card.dataset.id = lp.id;
    
    const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
    
    card.innerHTML = `
      <div class="lp-card-cover-wrapper">
        <img class="lp-card-cover" src="${lp.thumbnail || lp.cover_image || defaultCover}" alt="${lp.title}" loading="lazy" onerror="this.src='${defaultCover}'">
        <button class="lp-card-fav-btn ${lp.favorite ? 'active' : ''}" title="${lp.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" data-id="${lp.id}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="${lp.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
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
        <div class="lp-card-last-listen">${lastListenLabel(lp)}</div>
        ${typeof shelfNoteHtml === 'function' ? shelfNoteHtml(lp) : ''}

        <div class="lp-card-footer">
          <span class="lp-card-year">
            ${lp.original_year > 0 ? (lp.edition_year > 0 && lp.edition_year !== lp.original_year ? `${lp.original_year} <span style="font-size: 0.8em; opacity: 0.75; font-weight: normal;">(Ed. ${lp.edition_year})</span>` : lp.original_year) : 'N/A'}
          </span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openDetailsDialog(lp.id);
    });

    // Bind click event to favorite button
    const favBtn = card.querySelector('.lp-card-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent opening details dialog
        toggleFavoriteState(lp.id);
      });
    }
    
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


// ==================== v4.2: ORIGEM E ATALHOS DE PERÍODO ====================
function timelineEscape(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function setTimelinePeriod(months) {
  const now = new Date();
  const end = now.getFullYear() * 12 + now.getMonth();
  if (months === 'all') {
    const start = document.getElementById('monthly-filter-start');
    const first = start && start.options.length ? parseInt(start.options[0].value, 10) : end;
    state.monthlyFilterStart = first;
  } else {
    state.monthlyFilterStart = end - (parseInt(months, 10) - 1);
  }
  state.monthlyFilterEnd = end;
  document.querySelectorAll('#timeline-period-pills .stats-period-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.months === String(months));
  });
  renderTimelineStats();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#timeline-period-pills .stats-period-pill').forEach(pill => {
    pill.addEventListener('click', () => setTimelinePeriod(pill.dataset.months));
  });
});


// v4.2: última audição, para ordenar e mostrar nas Prateleiras
function lastListenTs(lp) {
  const dates = lp.listen_dates || [];
  if (!dates.length) return 0;
  return Math.max(...dates.map(d => new Date(d).getTime() || 0));
}

function lastListenLabel(lp) {
  const ts = lastListenTs(lp);
  if (!ts) return 'nunca ouvido';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'ouvido hoje';
  if (days === 1) return 'ouvido ontem';
  if (days < 60) return `ouvido há ${days} dias`;
  return `ouvido em ${new Date(ts).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`;
}
