// Admin do PlayVinil — Prateleiras (v4.2): Favoritos + listas criadas por você.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

const SHELF_FAVORITES = 'fav';
let shelves = [];
let activeShelf = SHELF_FAVORITES;
let shelfDeleteArmed = null;

function shelfEsc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

async function shelfPost(action, payload) {
  const response = await fetch(`/api/admin/shelves/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  shelves = data.shelves || [];
  return data;
}

async function loadShelves() {
  try {
    const data = await fetch('/api/admin/shelves').then(r => r.json());
    shelves = data.shelves || [];
  } catch (error) {
    shelves = [];
  }
  if (activeShelf !== SHELF_FAVORITES && !shelves.some(s => s.id === activeShelf)) {
    activeShelf = SHELF_FAVORITES;
  }
  renderShelfBar();
  renderFavoritesGrid();
}

function activeShelfData() {
  return shelves.find(s => s.id === activeShelf) || null;
}

function currentShelfLps() {
  if (activeShelf === SHELF_FAVORITES) return state.lps.filter(lp => lp.favorite === true);
  const shelf = activeShelfData();
  if (!shelf) return [];
  const ids = new Set(shelf.items.map(i => i.release_id));
  return state.lps.filter(lp => ids.has(lp.id));
}

function shelfItem(lp) {
  const shelf = activeShelfData();
  return shelf ? shelf.items.find(i => i.release_id === lp.id) : null;
}

function shelfAddedAt(lp) {
  const item = shelfItem(lp);
  return item ? item.added_at : 0;
}

function shelfNoteHtml(lp) {
  const item = shelfItem(lp);
  return item && item.note ? `<div class="lp-card-shelf-note">📝 ${shelfEsc(item.note)}</div>` : '';
}

function renderShelfBar() {
  const bar = document.getElementById('shelf-bar');
  if (!bar) return;
  bar.replaceChildren();
  const favCount = state.lps.filter(lp => lp.favorite).length;
  const chips = [{ id: SHELF_FAVORITES, label: `★ Favoritos`, count: favCount }]
    .concat(shelves.map(s => ({ id: s.id, label: `${s.emoji ? s.emoji + ' ' : ''}${s.name}`, count: s.items.length })));
  chips.forEach(chip => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shelf-chip' + (chip.id === activeShelf ? ' active' : '');
    button.innerHTML = `${shelfEsc(chip.label)} <span class="shelf-chip-count">${chip.count}</span>`;
    button.addEventListener('click', () => {
      activeShelf = chip.id;
      renderShelfBar();
      renderFavoritesGrid();
    });
    bar.appendChild(button);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'shelf-chip shelf-chip-add';
  add.textContent = '+ Nova prateleira';
  add.addEventListener('click', () => showShelfForm(null));
  bar.appendChild(add);
  renderShelfActions();
  updateShelfTexts();
}

function updateShelfTexts() {
  const shelf = activeShelfData();
  const title = document.getElementById('favorites-empty-title');
  const text = document.getElementById('favorites-empty-text');
  if (title && text) {
    if (shelf) {
      title.textContent = 'Prateleira vazia';
      text.textContent = 'Abra a ficha de um disco e marque esta prateleira para ele aparecer aqui.';
    } else {
      title.textContent = 'Nenhum disco favoritado';
      text.textContent = 'Toque na estrela dos discos na coleção para eles aparecerem aqui.';
    }
  }
}

function renderShelfActions() {
  const box = document.getElementById('shelf-actions');
  if (!box) return;
  box.replaceChildren();
  const shelf = activeShelfData();
  if (!shelf) return;
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'cf-link';
  rename.textContent = 'Renomear';
  rename.addEventListener('click', () => showShelfForm(shelf));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'cf-link shelf-delete';
  remove.textContent = 'Apagar prateleira';
  remove.addEventListener('click', async () => {
    // Dois toques: os discos não são apagados, só a prateleira.
    if (!shelfDeleteArmed) {
      remove.textContent = `Confirmar: apagar "${shelf.name}"?`;
      shelfDeleteArmed = setTimeout(() => { shelfDeleteArmed = null; renderShelfActions(); }, 4000);
      return;
    }
    clearTimeout(shelfDeleteArmed);
    shelfDeleteArmed = null;
    try {
      await shelfPost('delete', { id: shelf.id });
      activeShelf = SHELF_FAVORITES;
      showToast('Prateleira apagada. Os discos continuam na coleção.', 'success');
      renderShelfBar();
      renderFavoritesGrid();
    } catch (error) {
      showToast('Não foi possível apagar a prateleira.', 'error');
    }
  });
  box.append(rename, remove);
}

function showShelfForm(shelf) {
  const box = document.getElementById('shelf-actions');
  if (!box) return;
  box.replaceChildren();
  const form = document.createElement('form');
  form.className = 'shelf-form';
  form.innerHTML = `
    <input name="emoji" class="shelf-form-emoji" maxlength="4" placeholder="🎵" value="${shelfEsc(shelf ? shelf.emoji : '')}" aria-label="Emoji">
    <input name="name" class="shelf-form-name" maxlength="60" placeholder="Nome da prateleira" value="${shelfEsc(shelf ? shelf.name : '')}" required aria-label="Nome">
    <button type="submit" class="btn btn-primary">${shelf ? 'Salvar' : 'Criar'}</button>
    <button type="button" class="cf-link shelf-form-cancel">Cancelar</button>`;
  form.querySelector('.shelf-form-cancel').addEventListener('click', renderShelfActions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const emoji = form.elements.emoji.value.trim();
    if (!name) return;
    try {
      if (shelf) {
        await shelfPost('update', { id: shelf.id, name, emoji });
      } else {
        await shelfPost('create', { name, emoji });
        activeShelf = shelves[shelves.length - 1] ? shelves[shelves.length - 1].id : SHELF_FAVORITES;
      }
      renderShelfBar();
      renderFavoritesGrid();
    } catch (error) {
      showToast('Não foi possível salvar a prateleira.', 'error');
    }
  });
  box.appendChild(form);
  form.elements.name.focus();
}

// Ficha do disco: marcar em quais prateleiras ele está (e uma nota, ex.: com quem está emprestado)
async function renderDetailsShelves(lp) {
  const box = document.getElementById('details-shelves');
  if (!box) return;
  if (!shelves.length) {
    try {
      shelves = (await fetch('/api/admin/shelves').then(r => r.json())).shelves || [];
    } catch (error) {
      shelves = [];
    }
  }
  box.replaceChildren();
  if (!shelves.length) {
    box.innerHTML = '<span class="details-shelves-empty">Crie prateleiras na tela Prateleiras.</span>';
    return;
  }
  shelves.forEach(shelf => {
    const item = shelf.items.find(i => i.release_id === lp.id);
    const wrap = document.createElement('div');
    wrap.className = 'details-shelf';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'shelf-chip' + (item ? ' active' : '');
    chip.textContent = `${shelf.emoji ? shelf.emoji + ' ' : ''}${shelf.name}`;
    chip.addEventListener('click', async () => {
      try {
        await shelfPost('item', { shelf_id: shelf.id, release_id: lp.id, present: !item });
        renderDetailsShelves(lp);
        if (state.currentView === 'favorites') { renderShelfBar(); renderFavoritesGrid(); }
      } catch (error) {
        showToast('Não foi possível atualizar a prateleira.', 'error');
      }
    });
    wrap.appendChild(chip);
    if (item) {
      const note = document.createElement('input');
      note.className = 'details-shelf-note';
      note.maxLength = 120;
      note.placeholder = 'nota (ex.: com quem está)';
      note.value = item.note || '';
      note.addEventListener('change', async () => {
        try {
          await shelfPost('item', { shelf_id: shelf.id, release_id: lp.id, present: true, note: note.value });
          if (state.currentView === 'favorites') renderFavoritesGrid();
        } catch (error) {
          showToast('Não foi possível salvar a nota.', 'error');
        }
      });
      wrap.appendChild(note);
    }
    box.appendChild(wrap);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const sort = document.getElementById('favorites-sort-select');
  if (sort) sort.value = state.favoritesSortBy;
});
