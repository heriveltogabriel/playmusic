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
