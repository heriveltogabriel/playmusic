// Admin do PlayVinil — Edição em vinil (v4.3): disco cadastrado no Discogs como CD ou arquivo,
// mas que você tem em vinil. O PlayVinil passa a usar os dados da prensagem em vinil (faixas
// com lados, durações, capa, selo) sem mexer no Discogs: data de cadastro e audições ficam.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

function veEsc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function veIsVinyl(lp) {
  return (lp.formats || []).some(f => /vinyl|LP/i.test(f));
}

function renderDetailsEdition(lp) {
  const box = document.getElementById('details-edition');
  if (!box) return;
  box.replaceChildren();
  const overridden = !!lp.vinyl_override_id;
  const vinyl = veIsVinyl(lp);
  if (!overridden && vinyl) {
    // Disco já em vinil: só um atalho discreto para trocar de prensagem
    box.innerHTML = '<button type="button" class="cf-link ve-switch">Trocar prensagem…</button>';
  } else if (overridden) {
    box.innerHTML = `
      <div class="ve-note ok">💿 Usando a prensagem em vinil escolhida aqui. No Discogs o item continua como estava.</div>
      <div class="ve-actions">
        <button type="button" class="cf-link ve-switch">Trocar prensagem…</button>
        <button type="button" class="cf-link ve-undo">Voltar à edição do Discogs</button>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="ve-note warn">No Discogs este disco está como <strong>${veEsc((lp.formats || []).slice(0, 2).join(', ') || 'outro formato')}</strong>.
        Sem lados A/B, o player não sabe quando virar o disco.</div>
      <div class="ve-actions"><button type="button" class="btn btn-primary ve-switch">Usar a edição em vinil</button></div>`;
  }
  const switchBtn = box.querySelector('.ve-switch');
  if (switchBtn) switchBtn.addEventListener('click', () => openVinylVersions(lp));
  const undoBtn = box.querySelector('.ve-undo');
  if (undoBtn) undoBtn.addEventListener('click', () => applyVinylVersion(lp, null));
}

function veDialog() {
  let dialog = document.getElementById('vinyl-versions-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'vinyl-versions-dialog';
    dialog.className = 've-dialog';
    dialog.innerHTML = `
      <div class="ve-dialog-head">
        <h3>Escolha a sua prensagem em vinil</h3>
        <button type="button" class="btn-popup-close-icon ve-close" aria-label="Fechar">&times;</button>
      </div>
      <p class="profile-hint ve-dialog-hint"></p>
      <input type="search" class="ve-filter" placeholder="Filtrar por país, selo, ano ou número de catálogo..." autocomplete="off">
      <div class="ve-list"></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.ve-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }
  return dialog;
}

async function openVinylVersions(lp) {
  const dialog = veDialog();
  const list = dialog.querySelector('.ve-list');
  const hint = dialog.querySelector('.ve-dialog-hint');
  const filter = dialog.querySelector('.ve-filter');
  filter.value = '';
  hint.textContent = `${lp.artist} — ${lp.title}`;
  list.innerHTML = '<p class="profile-hint">Buscando as edições em vinil no Discogs…</p>';
  if (!dialog.open) dialog.showModal();

  let data;
  try {
    data = await fetch(`/api/admin/releases/${lp.id}/vinyl_versions`).then(r => r.json());
  } catch (error) {
    data = { status: 'error', message: 'Não foi possível consultar o Discogs agora.' };
  }
  if (data.status !== 'ok') {
    list.innerHTML = `<p class="profile-hint">${veEsc(data.message)}</p>`;
    return;
  }
  if (!data.versions.length) {
    list.innerHTML = '<p class="profile-hint">O Discogs não tem edição em vinil deste disco.</p>';
    return;
  }
  hint.textContent = `${lp.artist} — ${lp.title} · ${data.versions.length} ${data.versions.length === 1 ? 'edição' : 'edições'} em vinil (Brasil primeiro). Confira o número de catálogo na capa ou no selo do disco.`;
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = data.versions.filter(v => !q || `${v.country} ${v.label} ${v.catno} ${v.year} ${v.format} ${v.title}`.toLowerCase().includes(q));
    list.innerHTML = rows.map(v => `
      <div class="ve-row ${data.chosen === v.id ? 'chosen' : ''}">
        <img src="${veEsc(v.thumb || '/static/playvinil-cover.svg')}" alt="" loading="lazy" onerror="this.onerror=null; this.src='/static/playvinil-cover.svg'">
        <div class="ve-row-info">
          <div class="ve-row-title">${veEsc(v.label || 'Selo não informado')} · ${veEsc(v.catno || 's/ nº')}</div>
          <div class="ve-row-sub">${veEsc(v.country || '?')} · ${veEsc(v.year || 'ano ?')} · ${veEsc(v.format)}</div>
        </div>
        <a class="cf-link" href="https://www.discogs.com/release/${v.id}" target="_blank" rel="noopener noreferrer">ver</a>
        <button type="button" class="btn ${data.chosen === v.id ? 'btn-secondary' : 'btn-primary'} ve-use" data-id="${v.id}">${data.chosen === v.id ? 'Em uso' : 'Usar esta'}</button>
      </div>`).join('') || '<p class="profile-hint">Nenhuma edição com esse filtro.</p>';
    list.querySelectorAll('.ve-use').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Aplicando…';
      const ok = await applyVinylVersion(lp, Number(btn.dataset.id));
      if (ok) dialog.close(); else { btn.disabled = false; btn.textContent = 'Usar esta'; }
    }));
  };
  filter.oninput = render;
  render();
}

async function applyVinylVersion(lp, vinylReleaseId) {
  let data;
  try {
    data = await fetch(`/api/admin/releases/${lp.id}/use_version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vinyl_release_id: vinylReleaseId }),
    }).then(r => r.json());
  } catch (error) {
    data = { status: 'error', message: 'Falha de rede.' };
  }
  if (data.status !== 'ok') {
    showToast(data.message || 'Não foi possível trocar a edição.', 'error');
    return false;
  }
  // Recarrega a coleção para a ficha, a grade e o player verem a edição nova
  await loadDatabase();
  applyFiltersAndRender();
  const fresh = state.lps.find(item => item.id === lp.id);
  if (fresh) openDetailsDialog(fresh.id);
  showToast(vinylReleaseId ? 'Agora o PlayVinil usa a edição em vinil deste disco.' : 'Voltou para a edição do Discogs.', 'success');
  return true;
}
