document.addEventListener("DOMContentLoaded", () => {
  // Application State
  let releases = [];
  let stats = null;
  let activeTab = "collection";
  let searchText = "";
  let sortOption = "recent";

  // Elements cache
  const elements = {
    pageTitle: document.getElementById("page-title"),
    addLpButton: document.getElementById("add-lp-button"),
    filtersPanel: document.getElementById("filters-panel"),
    filterDisplayText: document.getElementById("filter-display-text"),
    searchInput: document.getElementById("search-input"),
    sortSelect: document.getElementById("sort-select"),
    gridView: document.getElementById("grid-view"),
    statsView: document.getElementById("stats-view"),
    suggestionView: document.getElementById("suggestion-view"),
    albumGrid: document.getElementById("album-grid"),
    totalLpsLabel: document.getElementById("total-lps-label"),
    
    // Stats elements
    statTotalLps: document.getElementById("stat-total-lps"),
    statTotalListens: document.getElementById("stat-total-listens"),
    statMostListened: document.getElementById("stat-most-listened"),
    statTopRated: document.getElementById("stat-top-rated"),
    
    // Suggestion element
    suggestionCardTarget: document.getElementById("suggestion-card-target"),
    
    // Modal elements
    addLpModal: document.getElementById("add-lp-modal"),
    closeModalBtn: document.getElementById("close-modal-btn"),
    addLpForm: document.getElementById("add-lp-form"),
    cancelLpBtn: document.getElementById("cancel-lp-btn"),
    
    // Toast
    toast: document.getElementById("toast"),
    
    // Menu items
    menuItems: document.querySelectorAll(".menu-item")
  };

  // 1. Initial Data Fetch
  async function loadAllData() {
    try {
      const [releasesResponse, statsResponse] = await Promise.all([
        fetch("/api/admin/releases"),
        fetch("/api/admin/stats")
      ]);

      if (!releasesResponse.ok || !statsResponse.ok) {
        throw new Error("Falha ao recuperar dados do catálogo");
      }

      releases = await releasesResponse.json();
      stats = await statsResponse.json();
      
      updateSidebarTotal();
      renderCurrentTab();
    } catch (error) {
      console.error(error);
      showToast("Erro ao carregar dados. Verifique a conexão com o servidor.", "error");
    }
  }

  function updateSidebarTotal() {
    elements.totalLpsLabel.textContent = `TOTAL: ${releases.length} LPS`;
  }

  // 2. Tab Navigation logic
  elements.menuItems.forEach(item => {
    item.addEventListener("click", () => {
      elements.menuItems.forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      
      activeTab = item.dataset.tab;
      renderCurrentTab();
    });
  });

  function renderCurrentTab() {
    // Hide all view panels
    elements.gridView.classList.remove("active");
    elements.statsView.classList.remove("active");
    elements.suggestionView.classList.remove("active");
    
    // Reset specific subheaders
    elements.filtersPanel.style.display = "none";
    elements.addLpButton.style.display = "none";

    if (activeTab === "collection") {
      elements.pageTitle.textContent = "Minha Coleção";
      elements.filtersPanel.style.display = "flex";
      elements.addLpButton.style.display = "flex";
      elements.gridView.classList.add("active");
      
      // Reset sort options for collection
      elements.sortSelect.disabled = false;
      renderAlbumGrid();
    } else if (activeTab === "ranking") {
      elements.pageTitle.textContent = "Ranking de Audições";
      elements.filtersPanel.style.display = "flex";
      elements.gridView.classList.add("active");
      
      // Lock sort to auditions descending for ranking view
      sortOption = "auditions";
      elements.sortSelect.value = "auditions";
      elements.sortSelect.disabled = true;
      renderAlbumGrid();
    } else if (activeTab === "stats") {
      elements.pageTitle.textContent = "Estatísticas da Coleção";
      elements.statsView.classList.add("active");
      renderStatsTab();
    } else if (activeTab === "suggestion") {
      elements.pageTitle.textContent = "Sugestão da Semana";
      elements.suggestionView.classList.add("active");
      renderSuggestionTab();
    }
  }

  // 3. Grid Rendering with Filtering and Sorting
  function renderAlbumGrid() {
    elements.albumGrid.replaceChildren();

    // Filtering
    let filtered = releases.filter(r => {
      const term = searchText.toLowerCase().trim();
      if (!term) return true;
      return (
        r.title.toLowerCase().includes(term) ||
        r.artist.toLowerCase().includes(term) ||
        (r.year && r.year.toString().includes(term))
      );
    });

    // Sorting
    filtered.sort((a, b) => {
      if (sortOption === "recent") {
        // Releases are naturally ordered by insert or ID on server
        // Negative IDs are manually added, positive are synced from Discogs.
        // We will sort descending by release_id to show newest additions first
        return b.release_id - a.release_id;
      }
      if (sortOption === "artist") {
        return a.artist.localeCompare(b.artist);
      }
      if (sortOption === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortOption === "year") {
        const yA = a.year || 0;
        const yB = b.year || 0;
        return yB - yA; // Newer first
      }
      if (sortOption === "rating") {
        return (b.rating || 0) - (a.rating || 0); // Highest rated first
      }
      if (sortOption === "auditions") {
        return (b.auditions || 0) - (a.auditions || 0); // Most listened first
      }
      return 0;
    });

    elements.filterDisplayText.textContent = `Exibindo ${filtered.length} de ${releases.length} discos`;

    if (filtered.length === 0) {
      const emptyMsg = document.createElement("p");
      emptyMsg.className = "empty-grid-msg";
      emptyMsg.textContent = "Nenhum disco encontrado.";
      elements.albumGrid.appendChild(emptyMsg);
      return;
    }

    filtered.forEach(album => {
      const card = createAlbumCard(album);
      elements.albumGrid.appendChild(card);
    });
  }

  function createAlbumCard(album) {
    const card = document.createElement("div");
    card.className = "album-card";
    
    // Cover Image
    const coverWrapper = document.createElement("div");
    coverWrapper.className = "card-cover-wrapper";
    const img = document.createElement("img");
    img.src = album.cover_url || "/static/logo_lp_da_semana.png";
    img.alt = `Capa de ${album.title}`;
    img.className = "card-cover";
    coverWrapper.appendChild(img);
    card.appendChild(coverWrapper);

    // Metadata details
    const details = document.createElement("div");
    details.className = "card-details";
    
    const title = document.createElement("h4");
    title.className = "card-title";
    title.textContent = album.title;
    details.appendChild(title);

    const artist = document.createElement("p");
    artist.className = "card-artist";
    artist.textContent = album.artist;
    details.appendChild(artist);

    // Year and Ratings
    const metaRow = document.createElement("div");
    metaRow.className = "card-meta-row";
    
    const year = document.createElement("span");
    year.className = "card-year";
    year.textContent = album.year || "N/A";
    metaRow.appendChild(year);

    // Rating stars container
    const starsContainer = document.createElement("div");
    starsContainer.className = "stars-container";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = `star-icon ${i <= (album.rating || 0) ? "filled" : ""}`;
      star.textContent = i <= (album.rating || 0) ? "★" : "☆";
      star.dataset.value = i;
      star.addEventListener("click", () => handleRate(album.release_id, i));
      starsContainer.appendChild(star);
    }
    metaRow.appendChild(starsContainer);
    details.appendChild(metaRow);

    // Auditions count and +Ouvir button
    const actionsRow = document.createElement("div");
    actionsRow.className = "card-actions-row";

    const listenCount = document.createElement("span");
    listenCount.className = "listen-count";
    listenCount.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="headphone-icon">
        <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.22 19.58 10.57 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 15c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>
      </svg>
      ${album.auditions || 0} ${album.auditions === 1 ? "audição" : "audições"}
    `;
    actionsRow.appendChild(listenCount);

    const btnOuvir = document.createElement("button");
    btnOuvir.className = "btn-listen";
    btnOuvir.type = "button";
    btnOuvir.textContent = "+ Ouvir";
    btnOuvir.addEventListener("click", () => handleListen(album.release_id, album.title));
    actionsRow.appendChild(btnOuvir);

    details.appendChild(actionsRow);
    card.appendChild(details);

    return card;
  }

  // 4. Handle Rating updates
  async function handleRate(releaseId, ratingVal) {
    try {
      const response = await fetch(`/api/admin/releases/${releaseId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: ratingVal })
      });

      if (!response.ok) {
        throw new Error("Erro ao salvar avaliação");
      }

      // Update locally
      const album = releases.find(r => r.release_id === releaseId);
      if (album) {
        album.rating = ratingVal;
      }
      
      // Update statistics internally too
      await refreshStatsOnly();
      
      // Re-render
      renderAlbumGrid();
      showToast("Avaliação atualizada!", "success");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível salvar a avaliação.", "error");
    }
  }

  // 5. Handle Audition increments
  async function handleListen(releaseId, albumTitle) {
    try {
      const response = await fetch(`/api/admin/releases/${releaseId}/listen`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("Erro ao registrar audição");
      }

      const data = await response.json();
      
      // Update locally
      const album = releases.find(r => r.release_id === releaseId);
      if (album) {
        album.auditions = data.auditions;
      }

      await refreshStatsOnly();
      renderAlbumGrid();
      showToast(`Audição registrada para "${albumTitle}"!`, "success");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível registrar a audição.", "error");
    }
  }

  async function refreshStatsOnly() {
    try {
      const statsResponse = await fetch("/api/admin/stats");
      if (statsResponse.ok) {
        stats = await statsResponse.json();
      }
    } catch (e) {
      console.error("Erro ao atualizar estatísticas em segundo plano", e);
    }
  }

  // 6. Statistics rendering
  function renderStatsTab() {
    if (!stats) return;

    elements.statTotalLps.textContent = stats.total_releases;
    elements.statTotalListens.textContent = stats.total_auditions;

    // Render most listened meta
    elements.statMostListened.replaceChildren();
    if (stats.top_listened) {
      const img = document.createElement("img");
      img.src = stats.top_listened.cover_url || "/static/logo_lp_da_semana.png";
      img.className = "stat-cover-thumb";
      elements.statMostListened.appendChild(img);

      const info = document.createElement("div");
      info.className = "stat-info-right";
      info.innerHTML = `
        <strong>${stats.top_listened.title}</strong>
        <span>${stats.top_listened.artist}</span>
        <span class="highlight-stat-lbl">${stats.top_listened.auditions} audições</span>
      `;
      elements.statMostListened.appendChild(info);
    } else {
      elements.statMostListened.innerHTML = '<p class="meta-placeholder">Nenhum disco ouvido ainda</p>';
    }

    // Render top rated meta
    elements.statTopRated.replaceChildren();
    if (stats.top_rated) {
      const img = document.createElement("img");
      img.src = stats.top_rated.cover_url || "/static/logo_lp_da_semana.png";
      img.className = "stat-cover-thumb";
      elements.statTopRated.appendChild(img);

      const info = document.createElement("div");
      info.className = "stat-info-right";
      info.innerHTML = `
        <strong>${stats.top_rated.title}</strong>
        <span>${stats.top_rated.artist}</span>
        <span class="highlight-stat-lbl">${"★".repeat(stats.top_rated.rating)}${"☆".repeat(5 - stats.top_rated.rating)}</span>
      `;
      elements.statTopRated.appendChild(info);
    } else {
      elements.statTopRated.innerHTML = '<p class="meta-placeholder">Nenhum disco avaliado ainda</p>';
    }
  }

  // 7. Suggestion rendering
  function renderSuggestionTab() {
    elements.suggestionCardTarget.replaceChildren();
    if (!stats || !stats.suggestion) {
      elements.suggestionCardTarget.innerHTML = '<p class="meta-placeholder">Nenhum disco na coleção para sugerir</p>';
      return;
    }

    const album = stats.suggestion;
    
    // We render a beautiful showcase for the suggestion
    const container = document.createElement("div");
    container.className = "suggestion-showcase";
    
    const cover = document.createElement("img");
    cover.src = album.cover_url || "/static/logo_lp_da_semana.png";
    cover.className = "suggestion-cover";
    container.appendChild(cover);
    
    const details = document.createElement("div");
    details.className = "suggestion-details";
    details.innerHTML = `
      <h3>${album.title}</h3>
      <p class="sug-artist">${album.artist}</p>
      <div class="sug-meta">
        <span>Ano: <strong>${album.year || "N/A"}</strong></span>
        <span>Gênero/Formato: <strong>${album.formats.join(", ") || "Vinyl"}</strong></span>
      </div>
      <div class="sug-stats">
        <span>Ouvido: <strong>${album.auditions || 0} vezes</strong></span>
        <span class="sug-rating-stars">${"★".repeat(album.rating || 0)}${"☆".repeat(5 - (album.rating || 0))}</span>
      </div>
    `;

    const btnOuvir = document.createElement("button");
    btnOuvir.className = "btn-primary btn-sug-listen";
    btnOuvir.textContent = "Ouvir este disco agora";
    btnOuvir.addEventListener("click", () => handleListen(album.release_id, album.title));
    details.appendChild(btnOuvir);

    container.appendChild(details);
    elements.suggestionCardTarget.appendChild(container);
  }

  // 8. Search & Sort events
  elements.searchInput.addEventListener("input", (e) => {
    searchText = e.target.value;
    renderAlbumGrid();
  });

  elements.sortSelect.addEventListener("change", (e) => {
    sortOption = e.target.value;
    renderAlbumGrid();
  });

  // 9. Add LP Modal handling
  elements.addLpButton.addEventListener("click", () => {
    elements.addLpModal.classList.remove("hidden");
    elements.addLpModal.setAttribute("aria-hidden", "false");
    document.getElementById("lp-title").focus();
  });

  function closeModal() {
    elements.addLpModal.classList.add("hidden");
    elements.addLpModal.setAttribute("aria-hidden", "true");
    elements.addLpForm.reset();
  }

  elements.closeModalBtn.addEventListener("click", closeModal);
  elements.cancelLpBtn.addEventListener("click", closeModal);

  // Close modal when clicking outside contents
  elements.addLpModal.addEventListener("click", (e) => {
    if (e.target === elements.addLpModal) {
      closeModal();
    }
  });

  // Handle Form submit (manual LP add)
  elements.addLpForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const title = document.getElementById("lp-title").value.trim();
    const artist = document.getElementById("lp-artist").value.trim();
    const year = document.getElementById("lp-year").value;
    const coverUrl = document.getElementById("lp-cover").value.trim();

    try {
      const response = await fetch("/api/admin/releases/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          artist,
          year: year ? parseInt(year) : null,
          cover_url: coverUrl
        })
      });

      if (!response.ok) {
        throw new Error("Erro ao salvar o LP");
      }

      showToast(`"${title}" adicionado à coleção!`, "success");
      closeModal();
      
      // Reload everything
      await loadAllData();
    } catch (err) {
      console.error(err);
      showToast("Não foi possível salvar o LP. Tente novamente.", "error");
    }
  });

  // 10. Toast Feedback utility
  let toastTimeout = null;
  function showToast(message, type = "success") {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type}`;
    elements.toast.classList.remove("hidden");
    
    toastTimeout = setTimeout(() => {
      elements.toast.classList.add("hidden");
    }, 3000);
  }

  // Initialize page
  loadAllData();
});
