// Admin do PlayVinil — Aparelhos autorizados, player e alertas.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== v3.6: APARELHOS AUTORIZADOS ====================
function formatDeviceDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadDevices() {
  const list = document.getElementById('devices-list');
  if (!list) return;
  try {
    const res = await fetch('/api/admin/devices');
    if (!res.ok) throw new Error('Não foi possível carregar os aparelhos.');
    const data = await res.json();

    const thisBox = document.getElementById('devices-this');
    const authorizeBtn = document.getElementById('device-authorize-btn');
    const labelInput = document.getElementById('device-label');
    if (thisBox) {
      thisBox.textContent = data.this_device
        ? 'Este aparelho já está autorizado.'
        : 'Este aparelho ainda não está autorizado.';
    }
    if (authorizeBtn) authorizeBtn.style.display = data.this_device ? 'none' : '';
    if (labelInput) labelInput.parentElement.style.display = data.this_device ? 'none' : '';

    list.replaceChildren();
    if (!data.devices.length) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'Nenhum aparelho autorizado ainda.';
      list.appendChild(empty);
    }
    data.devices.forEach((device) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;';
      const info = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = device.label + (device.id === data.this_device ? ' (este)' : '');
      const meta = document.createElement('div');
      meta.style.color = 'var(--text-muted)';
      meta.style.fontSize = '0.78rem';
      meta.textContent = `Autorizado em ${formatDeviceDate(device.created_at)} · visto ${formatDeviceDate(device.last_seen)}`;
      info.appendChild(name);
      info.appendChild(meta);
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'btn';
      revoke.textContent = 'Revogar';
      revoke.addEventListener('click', async () => {
        if (!confirm(`Revogar o acesso de "${device.label}"?`)) return;
        await fetch('/api/admin/devices/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: device.id }),
        });
        loadDevices();
      });
      row.appendChild(info);
      row.appendChild(revoke);
      list.appendChild(row);
    });

    const toggle = document.getElementById('device-require-toggle');
    const hint = document.getElementById('device-require-hint');
    if (toggle) toggle.checked = !!data.require_device_token;
    if (hint) {
      hint.textContent = data.require_device_token
        ? 'Ativo: aparelhos sem autorização não usam o Shazam nem registram audições.'
        : (data.devices.length
          ? 'Desligado: qualquer aparelho com o endereço ainda pode usar o player. Ative depois de autorizar o celular do player.'
          : 'Autorize o celular do player antes de ativar, senão ele deixa de reconhecer os discos.');
    }
  } catch (error) {
    console.error('Error loading devices:', error);
    showToast(error.message, 'error');
  }
}

function setupDevicesCard() {
  const authorizeBtn = document.getElementById('device-authorize-btn');
  if (authorizeBtn) {
    authorizeBtn.addEventListener('click', async () => {
      const labelInput = document.getElementById('device-label');
      const label = (labelInput && labelInput.value.trim()) || (/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Celular' : 'Computador');
      const res = await fetch('/api/admin/devices/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (res.ok) {
        showToast('Aparelho autorizado!', 'success');
      } else {
        showToast('Não foi possível autorizar o aparelho.', 'error');
      }
      loadDevices();
    });
  }
  const toggle = document.getElementById('device-require-toggle');
  if (toggle) {
    toggle.addEventListener('change', async () => {
      if (toggle.checked && !confirm('Só aparelhos autorizados vão conseguir usar o player e o Ouvir. O celular do player já está autorizado?')) {
        toggle.checked = false;
        return;
      }
      const res = await fetch('/api/admin/devices/require', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: toggle.checked }),
      });
      showToast(res.ok ? 'Configuração salva.' : 'Falha ao salvar.', res.ok ? 'success' : 'error');
      loadDevices();
    });
  }
}

document.addEventListener('DOMContentLoaded', setupDevicesCard);


// ==================== v3.7: PLAYER E ALERTAS ====================
function describeAgo(seconds) {
  if (seconds < 90) return `há ${seconds} s`;
  if (seconds < 5400) return `há ${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `há ${Math.round(seconds / 3600)} h`;
  return `há ${Math.round(seconds / 86400)} dias`;
}

async function loadPlayerStatus() {
  const box = document.getElementById('player-status');
  if (!box) return;
  try {
    const st = await fetch('/api/admin/player_status').then((r) => r.json());
    if (!st.seen) {
      box.textContent = 'O player ainda não mandou sinal. Recarregue a página dele no celular.';
      return;
    }
    const audio = { running: 'microfone ouvindo', suspended: 'microfone pausado (precisa de um toque na tela)', none: 'microfone desligado' }[st.audio] || `microfone: ${st.audio}`;
    const state = st.online ? '🟢 Player online' : '🔴 Player sem sinal';
    box.textContent = `${state} · visto ${describeAgo(st.seconds_ago)} · ${audio}${st.version ? ' · versão ' + st.version : ''}`;
  } catch (error) {
    box.textContent = 'Não foi possível ler o status do player.';
  }
}

async function loadAlertsCard() {
  loadPlayerStatus();
  try {
    const config = await fetch('/api/config').then((r) => r.json());
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('alert-telegram-token', config.telegram_bot_token);
    set('alert-telegram-chat', config.telegram_chat_id);
    set('alert-ntfy-topic', config.ntfy_topic);
    set('alert-quiet-start', config.alert_quiet_start);
    set('alert-quiet-end', config.alert_quiet_end);
  } catch (error) {
    console.error('Error loading alert settings:', error);
  }
}

async function saveAlertSettings() {
  // Reenvia as configurações atuais junto, porque /api/config grava o conjunto completo
  const config = await fetch('/api/config').then((r) => r.json());
  const payload = {
    discogs_user: config.discogs_user || '',
    discogs_user_agent: config.discogs_user_agent || '',
    discogs_token: config.discogs_token || '',
    rapidapi_shazam_key: config.rapidapi_shazam_key || '',
    rapidapi_shazam_host: config.rapidapi_shazam_host || '',
    lyrics_latency_offset: config.lyrics_latency_offset,
    favorite_threshold: config.favorite_threshold,
    shazam_daily_budget: config.shazam_daily_budget,
    telegram_bot_token: document.getElementById('alert-telegram-token').value.trim(),
    telegram_chat_id: document.getElementById('alert-telegram-chat').value.trim(),
    ntfy_topic: document.getElementById('alert-ntfy-topic').value.trim(),
    alert_quiet_start: document.getElementById('alert-quiet-start').value.trim(),
    alert_quiet_end: document.getElementById('alert-quiet-end').value.trim(),
  };
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Falha ao salvar os alertas.');
}

function setupAlertsCard() {
  const save = document.getElementById('alert-save');
  if (save) {
    save.addEventListener('click', async () => {
      try {
        await saveAlertSettings();
        showToast('Alertas salvos!', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }
  const test = document.getElementById('alert-test');
  if (test) {
    test.addEventListener('click', async () => {
      try {
        await saveAlertSettings();
        const res = await fetch('/api/admin/alerts/test', { method: 'POST' }).then((r) => r.json());
        showToast(res.status === 'ok' ? `Teste enviado (${res.channels.join(' e ')}).` : res.message, res.status === 'ok' ? 'success' : 'error');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }
  const detect = document.getElementById('alert-telegram-detect');
  if (detect) {
    detect.addEventListener('click', async () => {
      const token = document.getElementById('alert-telegram-token').value.trim();
      if (!token) {
        showToast('Cole o token do bot primeiro.', 'error');
        return;
      }
      const res = await fetch('/api/admin/alerts/telegram_chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then((r) => r.json());
      if (res.status !== 'ok') {
        showToast(res.message || 'Falha ao consultar o Telegram.', 'error');
        return;
      }
      if (!res.chats.length) {
        showToast('Nenhuma conversa encontrada. Mande /start para o seu bot no Telegram e tente de novo.', 'error');
        return;
      }
      const chat = res.chats[res.chats.length - 1];
      document.getElementById('alert-telegram-chat').value = chat.id;
      showToast(`Chat encontrado: ${chat.name}. Agora salve e envie um teste.`, 'success');
    });
  }
}

document.addEventListener('DOMContentLoaded', setupAlertsCard);
