// Admin do PlayVinil — Configurações.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== SETTINGS SCREEN LOGIC ====================
function updateSyncStatusUI(config) {
  const container = document.getElementById('last-sync-status-container');
  if (!container) return;
  
  if (config.last_sync_at) {
    container.style.display = 'block';
    const dt = new Date(parseFloat(config.last_sync_at) * 1000);
    const dateFormatted = dt.toLocaleDateString('pt-BR');
    const timeFormatted = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    document.getElementById('last-sync-time').textContent = `${dateFormatted} às ${timeFormatted}`;
    document.getElementById('last-sync-total').textContent = config.last_sync_count || '0';
    document.getElementById('last-sync-added').textContent = config.last_sync_added || '0';
    document.getElementById('last-sync-updated').textContent = config.last_sync_updated || '0';
    document.getElementById('last-sync-deleted').textContent = config.last_sync_deleted || '0';
    let errorLine = document.getElementById('last-sync-error');
    if (!errorLine) {
      errorLine = document.createElement('div');
      errorLine.id = 'last-sync-error';
      errorLine.style.cssText = 'margin-top: 8px; font-size: 0.8rem; color: var(--primary);';
      container.appendChild(errorLine);
    }
    errorLine.textContent = config.last_sync_error ? `Último sync automático falhou: ${config.last_sync_error}` : '';
  } else {
    container.style.display = 'none';
  }
}

// Uso do Shazam no mês: uma linha por chave (só os 4 últimos caracteres aparecem)
function renderShazamUsage(usage) {
  const box = document.getElementById('shazam-usage');
  if (!box) return;
  box.replaceChildren();
  if (!usage || !usage.keys || usage.keys.length === 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.cssText += 'margin-top: 12px; padding: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 0.8rem; line-height: 1.5;';

  const title = document.createElement('b');
  title.style.display = 'block';
  title.style.marginBottom = '6px';
  const [year, month] = (usage.month || '').split('-');
  title.textContent = `Uso do Shazam em ${month}/${year}`;
  box.appendChild(title);

  usage.keys.forEach((k) => {
    const line = document.createElement('div');
    const pct = k.limit ? Math.round((k.calls / k.limit) * 100) : 0;
    const status = k.exhausted ? ' — cota esgotada' : (pct >= 80 ? ' — perto do limite' : '');
    line.textContent = `Chave ${k.key}: ${k.calls} de ${k.limit} (${pct}%)${status}`;
    if (k.exhausted || pct >= 80) line.style.color = 'var(--primary)';
    box.appendChild(line);
  });

  const today = document.createElement('div');
  today.style.marginTop = '6px';
  today.style.color = 'var(--text-muted)';
  today.textContent = usage.daily_budget
    ? `Hoje: ${usage.today} de ${usage.daily_budget} chamadas permitidas`
    : `Hoje: ${usage.today} chamadas (sem limite diário)`;
  box.appendChild(today);
}

async function loadSettingsFromServer() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Não foi possível carregar as configurações do servidor.');
    
    const config = await response.json();
    
    document.getElementById('setting-discogs-user').value = config.discogs_user || '';
    document.getElementById('setting-discogs-user-agent').value = config.discogs_user_agent || '';
    
    document.getElementById('setting-discogs-token').value = config.discogs_token || '';
    
    document.getElementById('setting-shazam-key').value = config.rapidapi_shazam_key || '';
    document.getElementById('setting-shazam-host').value = config.rapidapi_shazam_host || '';
    const budgetInput = document.getElementById('setting-shazam-budget');
    if (budgetInput && config.shazam_daily_budget !== undefined) budgetInput.value = config.shazam_daily_budget;
    renderShazamUsage(config.shazam_usage);
    
    document.getElementById('setting-lyrics-latency').value = config.lyrics_latency_offset !== undefined ? config.lyrics_latency_offset : 1.3;
    document.getElementById('setting-favorite-threshold').value = config.favorite_threshold !== undefined ? config.favorite_threshold : 5;
    const collectionInput = document.getElementById('setting-collection-name');
    if (collectionInput) collectionInput.value = config.collection_name || '';
    
    updateSyncStatusUI(config);
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast(error.message, 'error');
  }
}

function initializeSettingsForm() {
  const form = document.getElementById('settings-form');
  const syncBtn = document.getElementById('admin-sync-btn');
  
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const originalText = syncBtn.innerHTML;
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="sync-icon-svg spinning" style="transition: transform 0.3s ease;">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        <span>Sincronizando...</span>
      `;
      
      try {
        const response = await fetch('/api/sync', { method: 'POST' });
        if (!response.ok) throw new Error('Falha ao iniciar sincronização.');
        const data = await response.json();
        
        if (data.status === 'ok') {
          let summary = `Sincronização concluída com sucesso!<br>`;
          summary += `• <b>Total no Discogs:</b> ${data.count} LPs<br>`;
          summary += `• <b>Adicionados:</b> ${data.added} novos<br>`;
          summary += `• <b>Atualizados:</b> ${data.updated} existentes<br>`;
          summary += `• <b>Removidos:</b> ${data.deleted} removidos`;
          showToast(summary, 'success');
          
          updateSyncStatusUI({
            last_sync_at: (Date.now() / 1000).toString(),
            last_sync_count: data.count,
            last_sync_added: data.added,
            last_sync_updated: data.updated,
            last_sync_deleted: data.deleted
          });
          
          await loadDatabase();
          applyFiltersAndRender();
        } else {
          showToast(`Erro na sincronização: ${data.message || 'Erro desconhecido'}`, 'error');
        }
      } catch (error) {
        console.error('Error syncing collection:', error);
        showToast(`Erro do servidor ao sincronizar: ${error.message}`, 'error');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
      }
    });
  }

  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const discogs_user = document.getElementById('setting-discogs-user').value.trim();
    const discogs_user_agent = document.getElementById('setting-discogs-user-agent').value.trim();
    const discogs_token = document.getElementById('setting-discogs-token').value.trim();
    const rapidapi_shazam_key = document.getElementById('setting-shazam-key').value.trim();
    const rapidapi_shazam_host = document.getElementById('setting-shazam-host').value.trim();
    const lyrics_latency_offset = parseFloat(document.getElementById('setting-lyrics-latency').value) || 1.3;
    const favorite_threshold = parseInt(document.getElementById('setting-favorite-threshold').value) || 5;
    const collectionInput = document.getElementById('setting-collection-name');
    const collection_name = collectionInput ? collectionInput.value.trim() : undefined;
    const budgetInput = document.getElementById('setting-shazam-budget');
    const shazam_daily_budget = budgetInput ? Math.max(0, parseInt(budgetInput.value) || 0) : 60;
    
    const payload = {
      shazam_daily_budget,
      discogs_user,
      discogs_user_agent,
      discogs_token,
      rapidapi_shazam_key,
      rapidapi_shazam_host,
      lyrics_latency_offset,
      favorite_threshold,
      ...(collection_name !== undefined ? { collection_name } : {})
    };
    
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('Falha ao salvar as configurações.');
      
      showToast('Configurações salvas com sucesso!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showToast(error.message, 'error');
    }
  });
}

async function loadAppVersion() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      if (config.version) {
        const display = document.getElementById('app-version-display');
        if (display) {
          display.textContent = `v${config.version}`;
        }
      }
    }
  } catch (error) {
    console.error('Error loading version:', error);
  }
}

function initializeSecurity() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Deseja realmente sair do painel administrativo?')) {
        try {
          const res = await fetch('/api/auth/logout', { method: 'POST' });
          if (res.ok) {
            window.location.reload();
          } else {
            showToast('Erro ao efetuar logout.', 'error');
          }
        } catch (err) {
          console.error(err);
          showToast('Erro de rede ao efetuar logout.', 'error');
        }
      }
    });
  }

  const changePwdForm = document.getElementById('change-password-form');
  if (changePwdForm) {
    changePwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const currentPwd = document.getElementById('change-pwd-current').value;
      const newPwd = document.getElementById('change-pwd-new').value;
      const confirmPwd = document.getElementById('change-pwd-confirm').value;

      if (newPwd.length < 6) {
        showToast('A nova senha deve ter pelo menos 6 caracteres.', 'error');
        return;
      }

      if (newPwd !== confirmPwd) {
        showToast('As senhas novas não coincidem.', 'error');
        return;
      }

      const submitBtn = document.getElementById('change-password-btn');
      const origText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Alterando...';

      try {
        const res = await fetch('/api/auth/change_password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_password: currentPwd, new_password: newPwd })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          showToast('Senha alterada com sucesso!', 'success');
          changePwdForm.reset();
          
          // Display the new recovery key in the dialog modal
          const newKeyValSpan = document.getElementById('security-new-key-val');
          if (newKeyValSpan) {
            newKeyValSpan.textContent = data.recovery_key;
          }
          
          const keyDialog = document.getElementById('security-key-dialog');
          if (keyDialog) {
            keyDialog.showModal();
          }
        } else {
          showToast(data.error || 'Erro ao alterar a senha.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Erro de conexão com o servidor.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    });
  }
}

// Global functions for the recovery key modal in admin settings
window.copySecurityKey = function() {
  const span = document.getElementById('security-new-key-val');
  if (span) {
    navigator.clipboard.writeText(span.textContent).then(() => {
      showToast('Chave de recuperação copiada para a área de transferência!', 'success');
    }).catch(() => {
      showToast('Falha ao copiar. Por favor, selecione e copie manualmente.', 'error');
    });
  }
};

window.downloadSecurityKey = function() {
  const span = document.getElementById('security-new-key-val');
  if (span) {
    const text = span.textContent;
    const content = `NOVA CHAVE DE RECUPERAÇÃO DO VINYL DISPLAY\n=========================================\n\nChave: ${text}\n\nGuarde esta chave em local seguro. Ela permite redefinir a senha do painel de administração em caso de perda.\nGerado em: ${new Date().toLocaleString('pt-BR')}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vinyl_display_recovery_key.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Download do arquivo de chave iniciado!', 'success');
  }
};
