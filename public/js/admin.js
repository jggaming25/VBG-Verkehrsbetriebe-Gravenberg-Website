/* VBG – Kontoübersicht / Rollenverwaltung + Admin-Bereich (Meldungen, Verwarnungen) */
VBG.admin = (function () {
  let users = [];
  let reports = [];
  let warnings = [];

  function setBadge(n) {
    const b = document.getElementById('admin-badge');
    if (!b) return;
    const count = n || 0;
    b.classList.toggle('hidden', !count);
    b.textContent = count > 99 ? '99+' : count;
  }

  /* ------------------------------ Kontoübersicht (Rollentabelle) ------------------------------ */

  async function load() {
    const wrap = document.getElementById('account-overview');
    if (!VBG.isStaff(VBG.state.user.role)) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const data = await API.get('/api/users');
    users = data.users || [];
    render();
  }

  function render() {
    const tbody = document.getElementById('users-tbody');
    const q = (document.getElementById('user-search').value || '').toLowerCase().trim();
    let list = users;
    if (q) list = list.filter((u) => (u.username + ' ' + u.email).toLowerCase().includes(q));
    const canEdit = VBG.state.user.role === 'inhaber';

    tbody.innerHTML = list.map((u) => {
      const roleOption = (r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(VBG.labels.roles[r])}</option>`;
      const roleCell = canEdit
        ? `<select class="role-select" data-rolefor="${u.id}">${['besucher', 'bearbeiter', 'inhaber'].map(roleOption).join('')}</select>`
        : `<span class="role-badge role-${esc(u.role)}">${esc(VBG.labels.roles[u.role])}</span>`;
      return `<tr>
        <td><div class="user-cell">${avatarHtml({ username: u.username, avatar: u.avatar })}<b>${esc(u.username)}</b></div></td>
        <td class="muted">${esc(u.email)}</td>
        <td>${roleCell}</td>
        <td>${u.verified ? '<span class="verified">✓ verifiziert</span>' : '<span class="muted">− nicht verifiziert</span>'}</td>
        <td class="muted">${esc(fmtDateISO(u.created_at))}</td>
      </tr>`;
    }).join('');
    if (!list.length) tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center">Keine Spieler gefunden.</td></tr>';
  }

  async function changeRole(userId, role) {
    try {
      await API.put('/api/users/' + userId + '/role', { role });
      toast('Rolle aktualisiert.', 'ok');
      load();
    } catch (err) {
      toast(err.message, 'err');
      render();
    }
  }

  /* ------------------------------ Admin-Bereich (Meldungen & Verwarnungen) ------------------------------ */

  async function loadAdmin() {
    if (!VBG.state || !VBG.state.user || !VBG.isStaff(VBG.state.user.role)) return;
    const [reportsData, warningsData, usersData] = await Promise.all([
      API.get('/api/reports'),
      API.get('/api/warnings'),
      API.get('/api/users')
    ]);
    reports = reportsData.reports || [];
    warnings = warningsData.warnings || [];
    users = usersData.users || [];
    setBadge(reportsData.openCount || 0);
    renderWarnUsers();
    renderReports();
    renderWarnings();
  }

  function renderWarnUsers() {
    const sel = document.getElementById('warn-user');
    if (!sel) return;
    const me = VBG.state.user && VBG.state.user.id;
    sel.innerHTML = '<option value="">– Spieler wählen –</option>' +
      users
        .filter((u) => u.id !== me)
        .map((u) => `<option value="${u.id}">${esc(u.username)} (${esc(VBG.labels.roles[u.role] || u.role)})</option>`)
        .join('');
  }

  function short(text, n) {
    const s = String(text == null ? '' : text);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function reportHtml(r) {
    const ctx = [];
    if (r.message_text) ctx.push(`Nachricht: „${esc(short(r.message_text, 180))}”`);
    if (r.ticket_subject) ctx.push(`Ticket: ${esc(r.ticket_subject)}`);
    const actions = r.status === 'offen'
      ? `<div class="report-actions">
          <button class="btn btn-sm btn-ghost" data-resolve-report="${r.id}">Als erledigt markieren</button>
          <button class="btn btn-sm btn-danger" data-warn-report="${r.id}">⚠️ Verwarnen</button>
        </div>`
      : '';
    return `<div class="report-item ${r.status === 'offen' ? 'open' : ''}">
      <div class="report-body">
        <div class="report-top">
          <span class="report-from">${avatarHtml({ username: r.reported_name })} ${esc(r.reported_name)}</span>
          <span class="report-arrow">→</span>
          <span class="report-reason">${esc(r.reason)}</span>
          <span class="badge ${r.status === 'offen' ? 'badge-p-hoch' : ''}">${r.status === 'offen' ? '🟡 offen' : '✅ erledigt'}</span>
        </div>
        ${ctx.length ? `<div class="report-ctx">${ctx.join(' · ')}</div>` : ''}
        <div class="report-meta">Gemeldet von ${esc(r.reporter_name)} · ${esc(fmtDateTime(r.created_at))}</div>
      </div>
      ${actions}
    </div>`;
  }

  function renderReports() {
    const wrap = document.getElementById('admin-reports');
    const sub = document.getElementById('admin-reports-sub');
    const open = reports.filter((r) => r.status === 'offen').length;
    sub.textContent = reports.length
      ? `${reports.length} Meldung(en) insgesamt · ${open} offen – offene stehen oben.`
      : 'Alle Meldungen bearbeitet.';
    wrap.innerHTML = reports.length
      ? reports.map(reportHtml).join('')
      : `<div class="empty-state"><div class="big">🛡️</div><p>Keine Meldungen vorhanden.</p><p class="muted">Gemeldete Nachrichten erscheinen hier.</p></div>`;
  }

  function warningHtml(w) {
    return `<div class="warn-item">
      <span class="warn-ic">⚠️</span>
      <div>
        <div><b>${esc(w.user_name)}</b> wurde von <span class="muted">${esc(w.by_name)}</span> verwarnt</div>
        <div class="warn-reason">${esc(short(w.reason, 300))}</div>
        <div class="report-meta">${esc(fmtDateTime(w.created_at))}</div>
      </div>
    </div>`;
  }

  function renderWarnings() {
    const wrap = document.getElementById('admin-warnings');
    wrap.innerHTML = warnings.length
      ? warnings.map(warningHtml).join('')
      : `<div class="empty-state"><div class="big">📜</div><p>Noch keine Verwarnungen ausgesprochen.</p></div>`;
  }

  async function resolveReport(id) {
    try {
      await API.post('/api/reports/' + id + '/resolve');
      toast('Meldung als erledigt markiert.', 'ok');
      loadAdmin();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function warnFromReport(id) {
    try {
      await API.post('/api/reports/' + id + '/warn');
      toast('Spieler verwarnt – Meldung erledigt.', 'ok');
      loadAdmin();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function submitWarn(e) {
    e.preventDefault();
    const userId = document.getElementById('warn-user').value;
    const reason = document.getElementById('warn-reason').value.trim();
    if (!userId) { toast('Bitte einen Spieler wählen.', 'err'); return; }
    if (!reason) { toast('Bitte einen Grund angeben.', 'err'); return; }
    const btn = document.getElementById('warn-form').querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await API.post('/api/users/' + userId + '/warn', { reason });
      toast('Verwarnung erteilt.', 'ok');
      document.getElementById('warn-reason').value = '';
      loadAdmin();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    document.getElementById('users-tbody').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-rolefor]');
      if (sel) changeRole(Number(sel.dataset.rolefor), sel.value);
    });
    document.getElementById('user-search').addEventListener('input', render);
    document.getElementById('admin-reports').addEventListener('click', (e) => {
      const res = e.target.closest('[data-resolve-report]');
      if (res) { e.stopPropagation(); resolveReport(Number(res.dataset.resolveReport)); return; }
      const warn = e.target.closest('[data-warn-report]');
      if (warn) { e.stopPropagation(); warnFromReport(Number(warn.dataset.warnReport)); return; }
    });
    document.getElementById('warn-form').addEventListener('submit', submitWarn);
  }

  return { bind, load, render, loadAdmin };
})();