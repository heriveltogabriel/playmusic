// Admin do PlayVinil — Diário da Vitrola e Agulha e Cuidados (v4.2).
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

const DIARY_WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIARY_DEFAULT_COVER = '/static/logo_lp_da_semana.png';

function dcEsc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function dcTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dcDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dcDayTitle(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const label = same(date, today) ? 'Hoje' : same(date, yesterday) ? 'Ontem' : DIARY_WEEKDAYS[date.getDay()];
  return `${label}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

function dcDuration(seconds) {
  const minutes = Math.round((seconds || 0) / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

async function dcFetch(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ==================== DIÁRIO DA VITROLA ====================
async function renderDiary() {
  const list = document.getElementById('diary-list');
  if (!list) return;
  const days = (document.getElementById('diary-days') || {}).value || '30';
  let data;
  try {
    data = await dcFetch(`/api/admin/diary?days=${days}`);
  } catch (error) {
    showToast('Não foi possível carregar o diário.', 'error');
    return;
  }
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('diary-sessions', data.totals.sessions);
  set('diary-discs', data.totals.discs);
  set('diary-hours', String(data.totals.hours).replace('.', ','));
  set('diary-since', data.tracks_since ? `desde ${dcDate(data.tracks_since)}` : 'a partir de hoje');

  list.replaceChildren();
  if (!data.sessions.length) {
    list.innerHTML = '<p class="profile-hint">Nenhuma audição neste período.</p>';
  }
  let lastDay = '';
  data.sessions.forEach(session => {
    if (session.day !== lastDay) {
      lastDay = session.day;
      const header = document.createElement('h4');
      header.className = 'diary-day';
      header.textContent = dcDayTitle(session.day);
      list.appendChild(header);
    }
    const card = document.createElement('div');
    card.className = 'diary-session';
    const when = session.kind === 'tracks'
      ? `${dcTime(session.start)} – ${dcTime(session.end)} · ${dcDuration(session.end - session.start)} · ${session.tracks} ${session.tracks === 1 ? 'faixa' : 'faixas'}`
      : `${session.discs.length} ${session.discs.length === 1 ? 'disco' : 'discos'} · audições marcadas`;
    card.innerHTML = `<div class="diary-session-when">${dcEsc(when)}</div>`;
    session.discs.forEach(disc => {
      const row = document.createElement('div');
      row.className = 'diary-disc';
      const sides = disc.sides && disc.sides.length ? `Lado ${disc.sides.join(' · ')}` : (disc.at ? `às ${dcTime(disc.at)}` : '');
      row.innerHTML = `
        <img src="${dcEsc(disc.cover_url || DIARY_DEFAULT_COVER)}" alt="" loading="lazy" onerror="this.src='${DIARY_DEFAULT_COVER}'">
        <div class="diary-disc-info">
          <div class="diary-disc-title">${dcEsc(disc.title)}</div>
          <div class="diary-disc-artist">${dcEsc(disc.artist)}${sides ? ` · <span class="diary-sides">${dcEsc(sides)}</span>` : ''}</div>
        </div>`;
      if (disc.tracks && disc.tracks.length) {
        const details = document.createElement('details');
        details.className = 'diary-tracks';
        details.innerHTML = `<summary>${disc.tracks.length} ${disc.tracks.length === 1 ? 'faixa' : 'faixas'}</summary>` +
          '<ol>' + disc.tracks.map(t => `<li><span>${dcEsc(t.position)}</span> ${dcEsc(t.title)} <small>${dcTime(t.at)}</small></li>`).join('') + '</ol>';
        row.querySelector('.diary-disc-info').appendChild(details);
      }
      row.querySelector('img').addEventListener('click', () => {
        if (typeof openDetailsDialog === 'function') openDetailsDialog(disc.release_id);
      });
      card.appendChild(row);
    });
    list.appendChild(card);
  });

  const top = document.getElementById('diary-top');
  if (top) {
    top.replaceChildren();
    if (!data.top_tracks.length) {
      top.innerHTML = '<p class="profile-hint">Ainda sem faixas registradas. O diário começa a contar a partir desta versão, sempre que o player acompanhar um disco.</p>';
    }
    data.top_tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'diary-top-row';
      row.innerHTML = `
        <span class="diary-top-rank">${index + 1}</span>
        <img src="${dcEsc(track.cover_url || DIARY_DEFAULT_COVER)}" alt="" loading="lazy" onerror="this.src='${DIARY_DEFAULT_COVER}'">
        <div class="diary-disc-info">
          <div class="diary-disc-title">${dcEsc(track.position)} · ${dcEsc(track.track_title)}</div>
          <div class="diary-disc-artist">${dcEsc(track.artist)} — ${dcEsc(track.title)}</div>
        </div>
        <span class="diary-top-plays">${track.plays}×</span>`;
      top.appendChild(row);
    });
  }
}

// ==================== AGULHA E CUIDADOS ====================
let careData = null;
let needleReplaceArmed = null;

async function renderCare(data) {
  if (!data) {
    try {
      data = await dcFetch('/api/admin/care');
    } catch (error) {
      showToast('Não foi possível carregar os cuidados.', 'error');
      return;
    }
  }
  careData = data;
  const needle = data.needle;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('needle-hours', String(needle.hours_used).replace('.', ','));
  set('needle-life', needle.life_hours);
  const bar = document.getElementById('needle-bar');
  if (bar) {
    bar.style.width = `${needle.percent}%`;
    bar.classList.toggle('warn', needle.percent >= 80);
  }
  const parts = [];
  if (needle.model) parts.push(needle.model);
  parts.push(needle.installed_at ? `instalada em ${dcDate(needle.installed_at)}` :
    needle.counting_from ? `contando desde o primeiro registro (${dcDate(needle.counting_from)})` : 'sem audições ainda');
  if (needle.hours_per_week) parts.push(`~${String(needle.hours_per_week).replace('.', ',')} h por semana`);
  if (needle.weeks_left !== null && needle.weeks_left !== undefined) {
    parts.push(needle.weeks_left <= 0 ? 'hora de trocar' : `troca em ~${needle.weeks_left} semanas nesse ritmo`);
  }
  set('needle-summary', `${parts.join(' · ')}. ${data.estimate_note}`);

  const form = {
    model: document.getElementById('needle-model'),
    life: document.getElementById('needle-life-input'),
    installed: document.getElementById('needle-installed'),
  };
  if (form.model && document.activeElement !== form.model) form.model.value = needle.model || '';
  if (form.life && document.activeElement !== form.life) form.life.value = needle.life_hours;
  if (form.installed && document.activeElement !== form.installed) {
    form.installed.value = needle.installed_at ? new Date(needle.installed_at * 1000).toISOString().slice(0, 10) : '';
  }

  const history = document.getElementById('needle-history');
  if (history) {
    history.innerHTML = needle.history && needle.history.length
      ? '<h4>Agulhas anteriores</h4>' + needle.history.map(h =>
          `<div class="care-history-row">${dcEsc(h.model || 'Agulha')} · ${h.installed_at ? dcDate(h.installed_at) : 'início'} → ${dcDate(h.removed_at)} · ${String(h.hours).replace('.', ',')} h</div>`).join('')
      : '';
  }
  renderCareList();
}

function renderCareList() {
  const list = document.getElementById('care-list');
  if (!list || !careData) return;
  const query = ((document.getElementById('care-search') || {}).value || '').trim().toLowerCase();
  const hint = document.getElementById('care-clean-hint');
  if (hint) {
    hint.textContent = `Discos com mais audições desde a última limpeza aparecem primeiro. ${careData.never_cleaned} de ${careData.discs.length} ainda sem limpeza registrada.`;
  }
  let discs = careData.discs;
  if (query) {
    discs = discs.filter(d => `${d.title} ${d.artist}`.toLowerCase().includes(query)).slice(0, 30);
  } else {
    discs = discs.filter(d => d.plays_since_clean > 0).slice(0, 20);
  }
  list.replaceChildren();
  if (!discs.length) {
    list.innerHTML = `<p class="profile-hint">${query ? 'Nenhum disco encontrado.' : 'Tudo limpo por aqui. 👌'}</p>`;
    return;
  }
  discs.forEach(disc => {
    const row = document.createElement('div');
    row.className = 'care-row';
    const status = disc.cleaned_at
      ? `limpo em ${dcDate(disc.cleaned_at)} · ${disc.plays_since_clean} ${disc.plays_since_clean === 1 ? 'audição' : 'audições'} depois`
      : `nunca limpo · ${disc.plays} ${disc.plays === 1 ? 'audição' : 'audições'}`;
    row.innerHTML = `
      <img src="${dcEsc(disc.cover_url || DIARY_DEFAULT_COVER)}" alt="" loading="lazy" onerror="this.src='${DIARY_DEFAULT_COVER}'">
      <div class="diary-disc-info">
        <div class="diary-disc-title">${dcEsc(disc.title)}</div>
        <div class="diary-disc-artist">${dcEsc(disc.artist)} · ${dcEsc(status)}</div>
      </div>
      <button type="button" class="btn btn-secondary care-clean-btn">Limpei</button>`;
    row.querySelector('.care-clean-btn').addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        const data = await dcFetch('/api/admin/care/cleaned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ release_id: disc.release_id }),
        });
        showToast(`"${disc.title}" marcado como limpo.`, 'success');
        renderCare(data);
      } catch (error) {
        event.target.disabled = false;
        showToast('Não foi possível salvar a limpeza.', 'error');
      }
    });
    list.appendChild(row);
  });
}

function setupCare() {
  const days = document.getElementById('diary-days');
  if (days) days.addEventListener('change', renderDiary);
  const search = document.getElementById('care-search');
  if (search) search.addEventListener('input', renderCareList);

  const form = document.getElementById('needle-form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const installed = document.getElementById('needle-installed').value;
      const payload = {
        model: document.getElementById('needle-model').value,
        life_hours: document.getElementById('needle-life-input').value,
        installed_at: installed ? new Date(`${installed}T12:00:00`).getTime() / 1000 : '',
      };
      try {
        const data = await dcFetch('/api/admin/care/needle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Agulha salva.', 'success');
        renderCare(data);
      } catch (error) {
        showToast('Não foi possível salvar a agulha.', 'error');
      }
    });
  }

  const replace = document.getElementById('needle-replace');
  if (replace) {
    replace.addEventListener('click', async () => {
      // Dois toques: o primeiro pede confirmação, para não zerar o contador sem querer.
      if (!needleReplaceArmed) {
        replace.textContent = 'Confirmar troca?';
        needleReplaceArmed = setTimeout(() => {
          replace.textContent = 'Troquei a agulha';
          needleReplaceArmed = null;
        }, 4000);
        return;
      }
      clearTimeout(needleReplaceArmed);
      needleReplaceArmed = null;
      replace.textContent = 'Troquei a agulha';
      try {
        const data = await dcFetch('/api/admin/care/needle/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: document.getElementById('needle-model').value }),
        });
        showToast('Agulha nova registrada. O contador recomeçou.', 'success');
        renderCare(data);
      } catch (error) {
        showToast('Não foi possível registrar a troca.', 'error');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', setupCare);
