// ==================== STATE MANAGEMENT ====================
const state = {
  releases: [],
  filtered: []
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  loadCollection();
  setupEventListeners();
});

// ==================== DATA LOADING ====================
async function loadCollection() {
  const grid = document.getElementById('ouvir-grid');
  
  try {
    const response = await fetch('/api/ouvir/releases');
    if (!response.ok) throw new Error('Falha ao obter catálogo do servidor');
    
    const data = await response.json();
    
    // Sort alphabetically by artist, then by title
    state.releases = data.sort((a, b) => {
      const artA = (a.artist || '').toLowerCase();
      const artB = (b.artist || '').toLowerCase();
      if (artA !== artB) return artA.localeCompare(artB);
      return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
    });
    
    state.filtered = [...state.releases];
    renderCollection();
    
  } catch (error) {
    console.error('Error loading collection:', error);
    grid.replaceChildren();
    
    const errorEl = document.createElement('div');
    errorEl.className = 'loading-state';
    errorEl.style.color = '#ff453a';
    
    const msg = document.createElement('p');
    msg.textContent = 'Erro ao carregar coleção. Tente novamente mais tarde.';
    errorEl.appendChild(msg);
    
    grid.appendChild(errorEl);
    showToast('Não foi possível carregar a coleção.', 'error');
  }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search-btn');
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
    filterCollection(query);
  });
  
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchInput.focus();
    filterCollection('');
  });
}

// ==================== SEARCH FILTERING ====================
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accentuation
    .trim();
}

function filterCollection(query) {
  const normalizedQuery = normalizeText(query);
  
  if (!normalizedQuery) {
    state.filtered = [...state.releases];
  } else {
    state.filtered = state.releases.filter(lp => {
      const title = normalizeText(lp.title);
      const artist = normalizeText(lp.artist);
      const year = String(lp.year || '');
      return title.includes(normalizedQuery) || artist.includes(normalizedQuery) || year.includes(normalizedQuery);
    });
  }
  
  renderCollection();
}

// ==================== UI RENDERING ====================
function renderCollection() {
  const grid = document.getElementById('ouvir-grid');
  const emptyState = document.getElementById('empty-state');
  
  grid.replaceChildren();
  
  if (state.filtered.length === 0) {
    emptyState.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }
  
  emptyState.style.display = 'none';
  grid.style.display = 'flex';
  
  // Use DocumentFragment for performant DOM updates
  const fragment = document.createDocumentFragment();
  const defaultCover = 'https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop';
  
  state.filtered.forEach(lp => {
    const card = document.createElement('div');
    card.className = 'lp-card';
    card.dataset.id = lp.id;
    
    // Cover image container
    const coverWrapper = document.createElement('div');
    coverWrapper.className = 'lp-cover-wrapper';
    
    const coverImg = document.createElement('img');
    coverImg.className = 'lp-cover';
    coverImg.src = lp.cover_url || defaultCover;
    coverImg.alt = lp.title;
    coverImg.loading = 'lazy';
    
    // Simple image error fallback to default cover
    coverImg.addEventListener('error', () => {
      coverImg.src = defaultCover;
    });
    
    coverWrapper.appendChild(coverImg);
    card.appendChild(coverWrapper);
    
    // Info container
    const info = document.createElement('div');
    info.className = 'lp-info';
    
    const title = document.createElement('div');
    title.className = 'lp-title';
    title.textContent = lp.title;
    info.appendChild(title);
    
    const artist = document.createElement('div');
    artist.className = 'lp-artist';
    artist.textContent = lp.artist;
    info.appendChild(artist);
    
    const meta = document.createElement('div');
    meta.className = 'lp-meta';
    
    if (lp.year) {
      const yearSpan = document.createElement('span');
      yearSpan.textContent = lp.year;
      meta.appendChild(yearSpan);
      
      const dot = document.createTextNode(' • ');
      meta.appendChild(dot);
    }
    
    const playsBadge = document.createElement('span');
    playsBadge.className = 'lp-plays-badge';
    playsBadge.id = `plays-count-${lp.id}`;
    
    const headphoneIcon = document.createTextNode('🎧 ');
    playsBadge.appendChild(headphoneIcon);
    
    const playsNum = document.createElement('span');
    playsNum.className = 'plays-num-val';
    playsNum.textContent = `${lp.plays || 0} ${lp.plays === 1 ? 'audição' : 'audições'}`;
    playsBadge.appendChild(playsNum);
    
    meta.appendChild(playsBadge);
    info.appendChild(meta);
    card.appendChild(info);
    
    // "Ouvi" action button
    const btn = document.createElement('button');
    btn.className = 'listen-btn';
    btn.textContent = 'Ouvi';
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      registerAudition(lp, btn);
    });
    
    card.appendChild(btn);
    fragment.appendChild(card);
  });
  
  grid.appendChild(fragment);
}

// ==================== AUDITION ACTION ====================
async function registerAudition(lp, buttonEl) {
  // Disable button to prevent multiple requests
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
    
    // Find index in global state and update it too
    const matchGlobal = state.releases.find(item => item.id === lp.id);
    if (matchGlobal) matchGlobal.plays = newCount;
    
    // Update UI value immediately
    const playsCountEl = document.getElementById(`plays-count-${lp.id}`);
    if (playsCountEl) {
      const valSpan = playsCountEl.querySelector('.plays-num-val');
      if (valSpan) {
        valSpan.textContent = `${newCount} ${newCount === 1 ? 'audição' : 'audições'}`;
      }
    }
    
    showToast(`"${lp.title}" marcado como ouvido! Total: ${newCount}`, 'success');
    
  } catch (error) {
    console.error('Error registering audition:', error);
    showToast(`Falha ao registrar audição para "${lp.title}".`, 'error');
  } finally {
    // Re-enable button
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
