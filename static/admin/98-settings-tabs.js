// Admin do PlayVinil — Configurações em abas e a aba Sistema (v4.2).
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

const SETTINGS_TAB_KEY = 'settingsTab';
const SETTINGS_FORM_TABS = new Set(['colecao', 'apis']);

function sysEsc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function sysAgo(ts) {
  if (!ts) return 'nunca';
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (seconds < 90) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

function sysWhen(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sysBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

function showSettingsTab(tab) {
  document.querySelectorAll('#settings-tabs .settings-tab').forEach(btn => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#view-settings [data-settings-tab]').forEach(el => {
    const owner = el.dataset.settingsTab;
    const visible = owner === tab || (owner === 'form' && SETTINGS_FORM_TABS.has(tab));
    el.classList.toggle('settings-tab-hidden', !visible);
  });
  try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch (e) { /* sem armazenamento: só não lembra */ }
  if (tab === 'sistema') renderSystemCard();
}

async function renderSystemCard() {
  const grid = document.getElementById('system-grid');
  if (!grid) return;
  let data;
  try {
    const response = await fetch('/api/admin/system');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    grid.innerHTML = '<p class="settings-card-desc">Não foi possível carregar o status agora.</p>';
    return;
  }

  const tiles = [];
  const tile = (label, value, sub, tone) => tiles.push(
    `<div class="system-tile ${tone || ''}"><div class="system-label">${sysEsc(label)}</div>` +
    `<div class="system-value">${value}</div>${sub ? `<div class="system-sub">${sub}</div>` : ''}</div>`
  );

  tile('Versão', sysEsc(data.version), `${data.collection_count} discos no catálogo`);

  const player = data.player || {};
  if (!player.seen) {
    tile('Player', 'Sem sinal ainda', 'abra o player no celular', 'warn');
  } else {
    const mic = { running: 'microfone ouvindo', suspended: 'microfone pausado', none: 'microfone desligado' }[player.audio] || '';
    tile('Player', player.online ? 'Online' : 'Fora do ar',
      `${sysAgo(Date.now() / 1000 - player.seconds_ago)}${mic ? ' · ' + mic : ''}${player.version ? ' · versão ' + sysEsc(player.version) : ''}`,
      player.online ? 'ok' : 'bad');
  }

  const sync = data.sync || {};
  const syncAge = sync.at ? Date.now() / 1000 - sync.at : null;
  tile('Último sync do Discogs', sync.at ? sysAgo(sync.at) : 'nunca',
    sync.error ? `falhou: ${sysEsc(sync.error)}` : (sync.at ? `${sysWhen(sync.at)} · ${sync.count ?? '?'} discos (+${sync.added ?? 0} / −${sync.deleted ?? 0})` : 'roda todo dia às 04:00'),
    sync.error ? 'bad' : (syncAge !== null && syncAge > 36 * 3600 ? 'warn' : 'ok'));

  const backup = data.backup;
  const backupAge = backup ? Date.now() / 1000 - backup.at : null;
  tile('Último backup', backup ? sysAgo(backup.at) : 'nenhum encontrado',
    backup ? `${sysWhen(backup.at)} · ${sysBytes(backup.size_bytes)} · ${backup.uploaded ? 'enviado ao OCI' : 'cópia local'}` : 'roda todo dia às 03:00',
    !backup ? 'warn' : (backupAge > 36 * 3600 ? 'warn' : 'ok'));

  const shazam = data.shazam;
  if (shazam && shazam.keys && shazam.keys.length) {
    const limit = shazam.keys.reduce((sum, k) => sum + (k.limit || 0), 0);
    const used = shazam.keys.reduce((sum, k) => sum + (k.calls || 0), 0);
    tile('Shazam no mês', `${used} de ${limit}`, `${shazam.keys.length} ${shazam.keys.length === 1 ? 'chave' : 'chaves'} · hoje ${shazam.today || 0}`,
      limit && used / limit > 0.8 ? 'warn' : 'ok');
  } else {
    tile('Shazam no mês', 'sem chave', 'configure na aba APIs', 'warn');
  }

  const alerts = data.alerts || {};
  const channels = [alerts.telegram ? 'Telegram' : '', alerts.ntfy ? 'ntfy' : ''].filter(Boolean);
  tile('Alertas', channels.length ? channels.join(' e ') : 'desligados', channels.length ? 'avisos e resumo semanal' : 'configure na aba Player e alertas',
    channels.length ? 'ok' : 'warn');

  tile('Banco de dados', sysBytes(data.database_bytes), data.disk ? `${sysBytes(data.disk.free_bytes)} livres no disco` : '');

  grid.innerHTML = tiles.join('');
}

function setupSettingsTabs() {
  const tabs = document.getElementById('settings-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener('click', () => showSettingsTab(btn.dataset.tab)));
  const refresh = document.getElementById('system-refresh');
  if (refresh) refresh.addEventListener('click', renderSystemCard);
  let saved = 'sistema';
  try { saved = localStorage.getItem(SETTINGS_TAB_KEY) || 'sistema'; } catch (e) { /* padrão */ }
  if (!tabs.querySelector(`[data-tab="${saved}"]`)) saved = 'sistema';
  showSettingsTab(saved);
  // Ao abrir Configurações pelo menu, a aba Sistema já vem atualizada.
  const nav = document.querySelector('[data-view="settings"]');
  if (nav) nav.addEventListener('click', () => {
    const active = tabs.querySelector('.settings-tab.active');
    if (active && active.dataset.tab === 'sistema') renderSystemCard();
  });
}

document.addEventListener('DOMContentLoaded', setupSettingsTabs);


// v4.5: nome da coleção embaixo de "PlayVinil" no menu (e no título da aba)
async function loadBrand() {
  try {
    const data = await fetch('/api/state').then(r => r.json());
    const name = (data && data.collection_name) || '';
    const el = document.getElementById('logo-collection');
    if (el) el.textContent = name;
    document.title = name ? `PlayVinil · ${name}` : 'PlayVinil · Catálogo';
  } catch (e) {
    // sem nome: fica só "PlayVinil"
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBrand();
  const form = document.getElementById('settings-form');
  if (form) form.addEventListener('submit', () => setTimeout(loadBrand, 1500));
});
