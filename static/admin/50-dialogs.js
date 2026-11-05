// Admin do PlayVinil — Diálogos, formulário do LP e avisos (toast).
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== DIALOGS & FORM MANAGEMENT ====================
const LP_FORM_EDITABLE_FIELD_IDS = [
  'form-cover-url',
  'form-title',
  'form-year',
  'form-edition-year',
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
  const weeklyPlaysDialog = document.getElementById('weekly-plays-dialog');
  const lpForm = document.getElementById('lp-entry-form');
  const addBtn = document.getElementById('add-lp-btn');
  
  // Bind close buttons in dialogs
  document.querySelectorAll('[data-dialog-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailDialog.close();
      formDialog.close();
      if (artistAlbumsDialog) artistAlbumsDialog.close();
      if (weeklyPlaysDialog) weeklyPlaysDialog.close();
    });
  });
  
  // Global backdrop click to close
  window.addEventListener('click', (e) => {
    if (e.target === detailDialog) detailDialog.close();
    if (e.target === formDialog) formDialog.close();
    if (e.target === artistAlbumsDialog) artistAlbumsDialog.close();
    if (e.target === weeklyPlaysDialog) weeklyPlaysDialog.close();
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
            <img class="discogs-result-thumb" src="${thumb}" alt="Capa" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1539628390771-e231e2879708?q=80&w=200&auto=format&fit=crop'">
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
            const itemYear = item.year && !isNaN(item.year) ? item.year : '';
            document.getElementById('form-year').value = itemYear;
            document.getElementById('form-edition-year').value = itemYear;
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
  // v4.2: o nome do artista abre a página dele
  const detailsArtistEl = document.getElementById('details-artist');
  if (detailsArtistEl && typeof openArtistForLp === 'function') {
    detailsArtistEl.classList.add('details-artist-link');
    detailsArtistEl.title = 'Ver a página do artista';
    detailsArtistEl.onclick = () => openArtistForLp(lp);
  }
  document.getElementById('details-year').textContent = lp.original_year > 0 ? lp.original_year : 'Ano Desconhecido';
  
  const editionYearContainer = document.getElementById('details-edition-year-container');
  const editionYearEl = document.getElementById('details-edition-year');
  if (editionYearContainer && editionYearEl) {
    if (lp.edition_year > 0 && lp.edition_year !== lp.original_year) {
      editionYearEl.textContent = lp.edition_year;
      editionYearContainer.style.display = 'block';
    } else {
      editionYearContainer.style.display = 'none';
    }
  }
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
  
  // Auditions history list
  const detailsHistory = document.getElementById('details-auditions-history');
  if (detailsHistory) {
    if (lp.listen_dates && lp.listen_dates.length > 0) {
      // Sort dates descending (newest first)
      const sortedDates = [...lp.listen_dates].sort((a, b) => new Date(b) - new Date(a));
      detailsHistory.innerHTML = sortedDates.map((dateStr, idx) => {
        const d = new Date(dateStr);
        const formatted = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div style="display: flex; justify-content: space-between; color: var(--text-primary); padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); font-family: monospace;">
          <span style="color: var(--primary); font-weight: 600;">#${sortedDates.length - idx}</span>
          <span>${formatted}</span>
        </div>`;
      }).join('');
    } else {
      detailsHistory.innerHTML = '<span class="text-muted" style="font-style: italic; padding: 4px;">Nenhuma audição registrada.</span>';
    }
  }

  // Tracklist
  renderDetailsTracklist(lp);

  // Interactive stars
  renderDetailsStars(lp);
  if (typeof renderDetailsShelves === 'function') renderDetailsShelves(lp);
  
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
  // v4.2: avaliação por estrelas saiu do admin (quase não era usada)
  const container = document.getElementById('details-rating-stars');
  if (!container) return;
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

function renderDetailsTracklist(lp) {
  const container = document.getElementById('details-tracklist');
  const countEl = document.getElementById('details-tracklist-count');
  if (!container) return;

  container.innerHTML = '';
  const tracks = (lp && Array.isArray(lp.tracks)) ? lp.tracks : [];

  if (countEl) {
    if (tracks.length > 0) {
      countEl.textContent = `${tracks.length} ${tracks.length === 1 ? 'faixa' : 'faixas'}`;
      countEl.style.display = 'inline-block';
    } else {
      countEl.textContent = '';
      countEl.style.display = 'none';
    }
  }

  if (tracks.length === 0) {
    container.innerHTML = '<span class="text-muted" style="font-style: italic; padding: 6px 8px; font-size: 0.82rem;">Nenhuma faixa cadastrada.</span>';
    return;
  }

  tracks.forEach((track, idx) => {
    const item = document.createElement('div');
    item.className = 'details-track-item';

    const pos = document.createElement('span');
    pos.className = 'details-track-pos';
    pos.textContent = track.position || String(idx + 1);

    const name = document.createElement('span');
    name.className = 'details-track-name';
    name.textContent = track.title || 'Sem título';
    name.title = track.title || '';

    item.appendChild(pos);
    item.appendChild(name);

    if (track.duration_seconds && !isNaN(track.duration_seconds) && track.duration_seconds > 0) {
      const dur = document.createElement('span');
      dur.className = 'details-track-duration';
      const m = Math.floor(track.duration_seconds / 60);
      const s = Math.floor(track.duration_seconds % 60);
      dur.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      item.appendChild(dur);
    }

    container.appendChild(item);
  });
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
    document.getElementById('form-year').value = lp.original_year > 0 ? lp.original_year : '';
    document.getElementById('form-edition-year').value = lp.edition_year > 0 ? lp.edition_year : '';
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
  if (!container) return;
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
  const editionYearVal = document.getElementById('form-edition-year').value;
  const edition_year = editionYearVal ? parseInt(editionYearVal) : null;
  const original_year = year;
  
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
  // Sem estrelas: mantém a nota e o favorito que o disco já tinha.
  const existingLp = idInput ? state.lps.find(item => item.id == idInput) : null;
  const rating = existingLp ? (existingLp.rating || 0) : 0;
  const favorite = existingLp ? !!existingLp.favorite : false;
  
  const payload = {
    title,
    artist,
    year,
    original_year,
    edition_year,
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
