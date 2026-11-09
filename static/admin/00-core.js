/**
 * PlayVinil - Catálogo
 * Core Application Logic
 */

// Intercept all fetch responses to handle 401 Unauthorized
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);
  if (response.status === 401) {
    window.location.reload();
  }
  return response;
};

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
    styles: [],
    country: '',
    format: '',
    neverHeard: false
  },
  sortBy: 'added_desc',
  
  // Timeline page state
  timelineQuery: '',
  timelineSort: 'added_desc',
  monthlyFilterStart: null,
  monthlyFilterEnd: null,

  // Favorites page state
  favoritesQuery: '',
  favoritesSortBy: 'plays_desc'
};


// ==================== INITIALIZATION ====================
// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDatabase();
  initializeMobileMenu();
  initializeViews();
  initializeSidebarFilters();
  initializeFavoritesControls();
  initializeSuggestionsControls();
  initializeDialogs();
  initializeTimelineEvents();
  initializeSettingsForm();
  initializeSecurity();
  loadAppVersion();
  
  // Set current selected agenda index to today's weekday
  state.selectedAgendaIndex = getTodayAgendaIndex();
  
  // Initialize weekly suggestions
  await loadWeeklyAgenda();
  renderWeeklyAgenda();
  renderSelectedAgendaLp();
  renderHistoryRanking();
  renderPlaysRankingPage();
  renderWeeklyHistory();
  
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
      original_year: r.original_year || r.year,
      edition_year: r.edition_year || r.year,
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
      styles: r.styles || [],
      vinyl_override_id: r.vinyl_override_id || null
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

// ==================== MOBILE DRAWER NAVIGATION ====================
function initializeMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const closeBtn = document.getElementById('sidebar-close-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  const sidebar = document.getElementById('app-sidebar');

  if (!sidebar) return;

  function openMobileMenu() {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('no-scroll');
  }

  function closeMobileMenu() {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('no-scroll');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMobileMenu();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMenu();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeMobileMenu();
    });
  }

  // Close drawer on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeMobileMenu();
    }
  });

  window.closeMobileMenu = closeMobileMenu;
  window.openMobileMenu = openMobileMenu;
}

// ==================== SIDEBAR & VIEW NAVIGATION ====================
function initializeViews() {
  const navButtons = document.querySelectorAll('.nav-btn, .nav-btn-icon');
  const views = document.querySelectorAll('.content-view');
  const viewTitle = document.getElementById('view-title');
  
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (!targetView) return;
      
      // Auto-close mobile drawer on selection
      if (typeof window.closeMobileMenu === 'function') {
        window.closeMobileMenu();
      }

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
        if (typeof renderCollectionProfile === 'function') renderCollectionProfile();
      } else if (targetView === 'ranking') {
        viewTitle.textContent = 'Ranking de Audições';
        renderPlaysRankingPage();
        renderPlayPeriodStats(); // v4.2: mais tocados, resgate da estante e gráfico ficaram aqui
  renderWeeklyHistory();
      } else if (targetView === 'timeline') {
        viewTitle.textContent = 'Linha do Tempo';
        loadTimelineListening(true); // lados e faixas atualizados a cada visita
        renderTimeline();
      } else if (targetView === 'favorites') {
        viewTitle.textContent = 'Favoritos';
        renderFavoritesGrid();
      } else if (targetView === 'care') {
        viewTitle.textContent = 'Agulha e Cuidados';
        renderCare();
      } else if (targetView === 'settings') {
        viewTitle.textContent = 'Configurações';
        loadSettingsFromServer();
        loadDevices();
        loadAlertsCard();
      }
      
      // Trigger special animations or renders
      if (targetView === 'catalog') {
        renderGrid();
      } else if (targetView === 'favorites') {
        renderFavoritesGrid();
      } else if (targetView === 'ranking') {
        renderPlaysRankingPage();
  renderWeeklyHistory();
      } else if (targetView === 'timeline') {
        renderTimeline();
      }
    });
  });
}
