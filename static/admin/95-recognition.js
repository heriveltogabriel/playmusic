// Admin do PlayVinil — Painel de reconhecimento.
// Scripts clássicos carregados em ordem pelo admin.html; compartilham o escopo global.

// ==================== v3.9: PAINEL DE RECONHECIMENTO ====================
const RECOGNITION_STATUS_LABELS = {
  matched: 'Reconhecido',
  no_result: 'Shazam não reconheceu',
  not_found: 'Fora da coleção',
  too_quiet: 'Silêncio (sem Shazam)',
  error: 'Erro do Shazam',
  budget_exceeded: 'Limite diário',
  quota_exhausted: 'Cota esgotada',
  gap_aligned: 'Troca de faixa pela pausa',
  gap_ignored: 'Pausa ignorada',
  flip_local: 'Virada sem Shazam',
  flip_rejected: 'Virada recusada',
};

function recCell(row, text, opts = {}) {
  const cell = document.createElement(opts.head ? 'th' : 'td');
  cell.textContent = text;
  cell.style.cssText = `padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); text-align: ${opts.align || 'left'}; ${opts.head ? 'color: var(--text-muted); font-weight: 600;' : ''} white-space: nowrap;`;
  row.appendChild(cell);
  return cell;
}

function formatRecDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

async function renderRecognition() {
  const daysSelect = document.getElementById('recognition-days');
  const days = daysSelect ? daysSelect.value : '30';
  let data;
  try {
    data = await fetch(`/api/admin/recognition?days=${days}`).then((r) => r.json());
  } catch (error) {
    showToast('Não foi possível carregar o painel de reconhecimento.', 'error');
    return;
  }
  const st = data.by_status || {};
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  setText('rec-calls', data.shazam_calls);
  const usage = data.shazam_usage;
  setText('rec-calls-sub', usage && usage.keys && usage.keys.length
    ? `este mês: ${usage.month_total} de ${usage.keys.length * (usage.keys[0].limit || 500)}`
    : `nos últimos ${data.days} dias`);
  setText('rec-per-disc', data.calls_per_disc !== null && data.calls_per_disc !== undefined ? data.calls_per_disc : '—');
  setText('rec-local', data.solved_locally);
  setText('rec-local-sub', `${st.flip_local || 0} viradas · ${st.gap_aligned || 0} trocas de faixa`);
  setText('rec-match-rate', data.match_rate !== null && data.match_rate !== undefined ? `${data.match_rate}%` : '—');
  setText('rec-match-sub', `${st.matched || 0} reconhecidos · ${st.no_result || 0} sem resultado · ${st.not_found || 0} fora da coleção`);

  // Gráfico: chamadas por dia (todos os dias do período, inclusive os zerados)
  const chart = document.getElementById('rec-chart');
  const axis = document.getElementById('rec-chart-axis');
  if (chart) {
    chart.replaceChildren();
    const byDay = {};
    (data.per_day || []).forEach((d) => { byDay[d.day] = d.shazam_calls; });
    const daysList = [];
    for (let i = Number(data.days) - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
      daysList.push({ day: key, calls: byDay[key] || 0 });
    }
    const max = Math.max(1, ...daysList.map((d) => d.calls));
    daysList.forEach((d) => {
      const bar = document.createElement('div');
      bar.title = `${d.day.split('-').reverse().join('/')}: ${d.calls} chamada(s)`;
      bar.style.cssText = `flex: 1; min-width: 2px; height: ${Math.max(2, (d.calls / max) * 100)}%; background: ${d.calls ? 'var(--primary)' : 'rgba(255,255,255,0.08)'}; border-radius: 2px 2px 0 0;`;
      chart.appendChild(bar);
    });
    if (axis) {
      axis.replaceChildren();
      const first = document.createElement('span');
      first.textContent = daysList[0].day.split('-').reverse().slice(0, 2).join('/');
      const peak = document.createElement('span');
      peak.textContent = `máximo: ${max} por dia`;
      const last = document.createElement('span');
      last.textContent = 'hoje';
      axis.append(first, peak, last);
    }
  }

  // Tabela por disco
  const discs = document.getElementById('rec-discs');
  if (discs) {
    discs.replaceChildren();
    const head = document.createElement('tr');
    ['Disco', 'Shazam', 'Viradas sem Shazam', 'Trocas pela pausa', 'Pausas ignoradas', 'Última vez'].forEach((h, i) =>
      recCell(head, h, { head: true, align: i ? 'right' : 'left' }));
    discs.appendChild(head);
    if (!data.discs.length) {
      const row = document.createElement('tr');
      recCell(row, 'Nenhum disco tocado no período.');
      discs.appendChild(row);
    }
    data.discs.forEach((d) => {
      const row = document.createElement('tr');
      recCell(row, `${d.artist} — ${d.title}`).style.whiteSpace = 'normal';
      recCell(row, d.shazam_calls, { align: 'right' });
      recCell(row, d.flips_local, { align: 'right' });
      recCell(row, d.gaps_aligned, { align: 'right' });
      recCell(row, d.gaps_ignored, { align: 'right' });
      recCell(row, formatRecDate(d.last_at), { align: 'right' });
      discs.appendChild(row);
    });
  }

  // Últimos eventos
  const events = document.getElementById('rec-events');
  if (events) {
    events.replaceChildren();
    const head = document.createElement('tr');
    ['Quando', 'Evento', 'Música / disco', 'Shazam'].forEach((h) => recCell(head, h, { head: true }));
    events.appendChild(head);
    data.recent.forEach((e) => {
      const row = document.createElement('tr');
      recCell(row, formatRecDate(e.at));
      recCell(row, RECOGNITION_STATUS_LABELS[e.status] || e.status);
      const what = e.title ? `${e.title}${e.artist ? ' — ' + e.artist : ''}` : (e.release_title ? `${e.release_title}${e.track_position ? ' · ' + e.track_position : ''}` : '');
      recCell(row, what).style.whiteSpace = 'normal';
      recCell(row, e.shazam_called ? (e.shazam_key || 'sim') : '—');
      events.appendChild(row);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const daysSelect = document.getElementById('recognition-days');
  if (daysSelect) daysSelect.addEventListener('change', renderRecognition);
});
