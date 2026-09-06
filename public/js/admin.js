/* VBG – Admin-Bereich: Meldungs-Banner verwalten + Kontoübersicht/Rollenverwaltung */
VBG.admin = (function () {
  let users = [];

  /* ------------------------------ Kontoübersicht (Rollentabelle) ------------------------------ */

  async function load() {
    const data = await API.get('/api/users');
    users = data.users || [];
    render();
    loadNotices();
  }

  function render() {
    const tbody = document.getElementById('users-tbody');
    const q = (document.getElementById('user-search').value || '').toLowerCase().trim();
    let list = users;
    if (q) list = list.filter((u) => (u.username + ' ' + u.email).toLowerCase().includes(q));
    const canEdit = VBG.state.user.role === 'inhaber';
    const me = VBG.state.user.id;

    tbody.innerHTML = list.map((u) => {
      const roleOption = (r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(VBG.labels.roles[r])}</option>`;
      const roleCell = canEdit
        ? `<select class="role-select" data-rolefor="${u.id}">${['besucher', 'bearbeiter', 'inhaber'].map(roleOption).join('')}</select>`
        : `<span class="role-badge role-${esc(u.role)}">${esc(VBG.labels.roles[u.role])}</span>`;
      // Inhaber können einander nicht sperren/löschen – auch sich selbst nicht über die UI.
      const canAct = canEdit && u.role !== 'inhaber' && u.id !== me;
      const status = u.blocked ? '<span class="badge badge-p-hoch">⛔ Gesperrt</span>' : (u.verified ? '<span class="verified">✓ verifiziert</span>' : '<span class="muted">− nicht verifiziert</span>');
      return `<tr>
        <td><div class="user-cell">${avatarHtml({ username: u.username, avatar: u.avatar })}<b>${esc(u.username)}</b></div></td>
        <td class="muted">${esc(u.email)}</td>
        <td>${roleCell}</td>
        <td>${status}</td>
        <td class="muted">${esc(fmtDateISO(u.created_at))}</td>
        <td class="user-actions">
          ${canAct ? `
            <button class="btn btn-sm ${u.blocked ? 'btn-ghost' : 'btn-danger'}" data-blockfor="${u.id}" data-block="${u.blocked ? '0' : '1'}">${u.blocked ? '✅ Entsperren' : '⛔ Sperren'}</button>
            <button class="btn btn-sm btn-danger" data-delfor="${u.id}" title="Konto löschen">🗑️</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    if (!list.length) tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center">Keine Spieler gefunden.</td></tr>';
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

  async function blockUser(userId, blocked) {
    try {
      await API.put('/api/users/' + userId + '/block', { blocked });
      toast(blocked ? 'Konto gesperrt.' : 'Konto entsperrt.', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function removeUser(userId, username) {
    if (!confirm(`Konto "${username}" wirklich löschen? Alle zugehörigen Daten werden entfernt.`)) return;
    try {
      await API.del('/api/users/' + userId);
      toast('Konto gelöscht.', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ------------------------------ Meldungen (Banner) ------------------------------ */

  async function loadNotices() {
    if (!VBG.isOwner(VBG.state.user.role)) return;
    const wrap = document.getElementById('admin-notices');
    try {
      const { notices } = await API.get('/api/notices');
      wrap.innerHTML = notices.length
        ? notices.map((n) => `
          <div class="notice-item">
            <div>
              <div class="notice-text">${esc(n.text)}</div>
              <div class="report-meta">${esc(n.created_by || 'Team')} · ${esc(fmtDateTime(n.created_at))}</div>
            </div>
            <button class="btn btn-sm btn-danger" data-delnotice="${n.id}">Löschen</button>
          </div>`).join('')
        : '<div class="empty-state"><div class="big">⚠️</div><p>Noch keine Meldungen erstellt.</p></div>';
      wrap.querySelectorAll('[data-delnotice]').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await API.del('/api/notices/' + b.dataset.delnotice);
            toast('Meldung gelöscht.', 'ok');
            loadNotices();
            VBG.loadNotices();
          } catch (err) { toast(err.message, 'err'); }
        });
      });
    } catch (err) {
      wrap.innerHTML = '<p class="muted">Meldungen konnten nicht geladen werden.</p>';
    }
  }

  async function submitNotice(e) {
    e.preventDefault();
    const input = document.getElementById('notice-text');
    const text = input.value.trim();
    if (!text) { toast('Bitte einen Meldungstext angeben.', 'err'); return; }
    try {
      await API.post('/api/notices', { text });
      input.value = '';
      toast('Meldung veröffentlicht.', 'ok');
      loadNotices();
      VBG.loadNotices();
    } catch (err) { toast(err.message, 'err'); }
  }

  function bind() {
    document.getElementById('users-tbody').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-rolefor]');
      if (sel) changeRole(Number(sel.dataset.rolefor), sel.value);
    });
    document.getElementById('users-tbody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-blockfor]');
      if (b) { blockUser(Number(b.dataset.blockfor), b.dataset.block === '1'); return; }
      const d = e.target.closest('[data-delfor]');
      if (d) { removeUser(Number(d.dataset.delfor), d.closest('tr').querySelector('b').textContent); }
    });
    document.getElementById('user-search').addEventListener('input', render);
    document.getElementById('notice-form').addEventListener('submit', submitNotice);
    loadNotices();
  }

  return { bind, load, render };
})();