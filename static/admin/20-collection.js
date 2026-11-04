// Admin do PlayVinil — Brilho da capa, busca, filtros e grade da coleção.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

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
