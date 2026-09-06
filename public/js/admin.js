/* VBG – Admin-Bereich: Meldungs-Banner verwalten + Kontoübersicht/Rollenverwaltung */
VBG.admin = (function () {
  let users = [];
  let nvLines = [];
  let nvCourses = [];
  let nvActive = { line: null, course: null };

  /* ------------------------------ Nahverkehr Steuerung ------------------------------ */

  function fillSelect(sel, items) {
    sel.innerHTML = items.map((it) => `<option value="${String(it.value)}">${it.label}</option>`).join('');
  }

  function nvLineOptions(sel) {
    fillSelect(sel, nvLines.map((l) => ({ value: l.line, label: 'Linie ' + l.line + ' – ' + l.name.split('·')[0] })));
  }

  function nvCourseOptions(sel) {
    const line = sel.dataset.forline ? document.getElementById(sel.dataset.forline).value : null;
    const kurse = nvLines.find((l) => l.line === line)?.kurse || [];
    fillSelect(sel, kurse.map((k) => ({ value: String(k.course), label: 'Kurs ' + k.course + ' (' + k.bus + ')' })));
  }

  async function loadSteuerung() {
    if (!VBG.isOwner(VBG.state.user.role)) return;
    try {
      const meta = await API.get('/api/nahverkehr/meta');
      nvLines = meta.lines || [];
      const active = await API.get('/api/nahverkehr/active');
      nvActive = { line: active.line, course: active.course };
      const cancels = await API.get('/api/nahverkehr/cancellations');
      const reqs = await API.get('/api/nahverkehr/requests');
      const conns = await API.get('/api/nahverkehr/connections');
      nvLineOptions(document.getElementById('act-line'));
      nvLineOptions(document.getElementById('cancel-line'));
      if (nvActive.line) document.getElementById('act-line').value = nvActive.line;
      if (nvActive.course) {
        nvCourseOptions(document.getElementById('act-course'));
        document.getElementById('act-course').value = String(nvActive.course);
      } else {
        nvCourseOptions(document.getElementById('act-course'));
      }
      nvCourseOptions(document.getElementById('cancel-course'));
      renderActive();
      renderCancels(cancels.cancellations || []);
      renderRequests(reqs.requests || []);
      renderConns(conns.connections || []);
    } catch (e) {
      toast('Nahverkehr-Steuerung: ' + e.message, 'err');
    }
  }

  function renderActive() {
    const status = document.getElementById('act-status');
    document.getElementById('act-clear').disabled = !nvActive.line;
    status.textContent = nvActive.line
      ? `Aktiver Kurs: Linie ${nvActive.line} · Kurs ${nvActive.course} (alle Kurse ansonsten aktiv)`
      : 'Standard: alle Kurse aktiv.';
  }

  async function setActive() {
    const line = document.getElementById('act-line').value;
    const course = Number(document.getElementById('act-course').value);
    if (!line || !course) return;
    try {
      const data = await API.put('/api/nahverkehr/active', { line, course });
      nvActive = { line: data.line, course: data.course };
      toast(`Aktiver Kurs: Linie ${line} · Kurs ${course}`, 'ok');
      renderActive();
      VBG.nahverkehr.loadBoard();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function clearActive() {
    try {
      await API.put('/api/nahverkehr/active', {});
      nvActive = { line: null, course: null };
      toast('Aktiver Kurs deaktiviert.', 'ok');
      renderActive();
      VBG.nahverkehr.loadBoard();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderCancels(list) {
    const wrap = document.getElementById('cancel-list');
    const map = {};
    for (const c of list) map[c.line + '|' + c.course] = (map[c.line + '|' + c.course] || 0) + 1;
    const keys = Object.keys(map);
    wrap.innerHTML = keys.length
      ? keys.map((k) => {
        const [line, course] = k.split('|');
        return `<span class="chip chip-cancel">🚫 L${line} Kurs ${course}</span>`;
      }).join('')
      : '<p class="muted">Keine Ausfälle.</p>';
  }

  async function cancelKurs() {
    const line = document.getElementById('cancel-line').value;
    const course = Number(document.getElementById('cancel-course').value);
    if (!line || !course) return;
    if (!confirm(`Kurs ${course} der Linie ${line} wirklich ausfallen lassen? Alle Fahrten dieses Kurses werden ausgesetzt.`)) return;
    try {
      const data = await API.post('/api/nahverkehr/cancel-kurs', { line, course });
      toast(`${data.count} Fahrten ausgesetzt.`, 'ok');
      loadSteuerung();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function restoreKurs() {
    const line = document.getElementById('cancel-line').value;
    const course = Number(document.getElementById('cancel-course').value);
    if (!line || !course) return;
    try {
      await API.del(`/api/nahverkehr/cancel-kurs?line=${encodeURIComponent(line)}&course=${course}`);
      toast('Kurs wieder aktiv.', 'ok');
      loadSteuerung();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderRequests(list) {
    const wrap = document.getElementById('req-list');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="big">🚏</div><p>Keine Anfragen.</p></div>';
      return;
    }
    wrap.innerHTML = list.map((r) => {
      const s = r.waitMin == null ? '' : (r.waitMin >= 0 ? ` · warte <b>${r.waitMin} Min.</b>` : ` · ⚠️ zu spät (${-r.waitMin} Min.)`);
      const actions = r.status === 'offen'
        ? `<button class="btn btn-sm btn-primary" data-acc="${r.id}">✅ Bestätigen</button>
           <button class="btn btn-sm btn-ghost" data-dec="${r.id}">Ablehnen</button>`
        : (r.status === 'angenommen' ? '<span class="badge badge-p-niedrig">angenommen</span>' : '<span class="muted">abgelehnt</span>');
      return `<div class="req-item">
        <div>
          <div><b>${esc(r.username)}</b> · ${esc(r.stop)}</div>
          <div class="report-meta">L${r.from.line} → L${r.to.line} (Kurs ${r.to.course})${s}</div>
        </div>
        <div class="req-actions">${actions}<button class="btn btn-sm btn-danger" data-delreq="${r.id}" title="Löschen">🗑️</button></div>
      </div>`;
    }).join('');
  }

  async function acceptRequest(id) {
    try { await API.post(`/api/nahverkehr/requests/${id}/accept`); toast('Anschluss bestätigt.', 'ok'); loadSteuerung(); } catch (e) { toast(e.message, 'err'); }
  }
  async function declineRequest(id) {
    try { await API.post(`/api/nahverkehr/requests/${id}/decline`); toast('Anfrage abgelehnt.', 'ok'); loadSteuerung(); } catch (e) { toast(e.message, 'err'); }
  }
  async function deleteRequest(id) {
    try { await API.del(`/api/nahverkehr/requests/${id}`); toast('Anfrage entfernt.', 'ok'); loadSteuerung(); } catch (e) { toast(e.message, 'err'); }
  }

  function renderConns(list) {
    const wrap = document.getElementById('conn-list');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="big">🔗</div><p>Keine Verbindungen angelegt.</p></div>';
      return;
    }
    wrap.innerHTML = list.map((c) => `
      <div class="req-item">
        <div>
          <div><span class="bl-chip" style="--bl:${c.a.color}">L${c.a.line}</span> → <span class="bl-chip" style="--bl:${c.b.color}">L${c.b.line}</span> <span class="muted">an ${esc(c.stop)}</span></div>
          <div class="report-meta">Anschluss von L${c.a.line} (Kurs) auf L${c.b.line} · ${c.created_by ? 'von ' + esc(c.created_by) : ''}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-delconn="${c.id}">✕</button>
      </div>`).join('');
  }

  async function deleteConnection(id) {
    if (!confirm('Verbindung wirklich entfernen?')) return;
    try { await API.del('/api/nahverkehr/connections/' + id); toast('Verbindung entfernt.', 'ok'); loadSteuerung(); } catch (e) { toast(e.message, 'err'); }
  }

  /* ------------------------------ Kontoübersicht (Rollentabelle) ------------------------------ */

  async function load() {
    const data = await API.get('/api/users');
    users = data.users || [];
    render();
    loadNotices();
    loadSteuerung();
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
    document.getElementById('act-line').addEventListener('change', () => nvCourseOptions(document.getElementById('act-course')));
    document.getElementById('cancel-line').addEventListener('change', () => nvCourseOptions(document.getElementById('cancel-course')));
    document.getElementById('act-set').addEventListener('click', setActive);
    document.getElementById('act-clear').addEventListener('click', clearActive);
    document.getElementById('cancel-set').addEventListener('click', cancelKurs);
    document.getElementById('cancel-restore').addEventListener('click', restoreKurs);
    document.getElementById('req-list').addEventListener('click', (e) => {
      const a = e.target.closest('[data-acc]');
      if (a) { acceptRequest(a.dataset.acc); return; }
      const d = e.target.closest('[data-dec]');
      if (d) { declineRequest(d.dataset.dec); return; }
      const r = e.target.closest('[data-delreq]');
      if (r) deleteRequest(r.dataset.delreq);
    });
    document.getElementById('conn-list').addEventListener('click', (e) => {
      const c = e.target.closest('[data-delconn]');
      if (c) deleteConnection(Number(c.dataset.delconn));
    });
    loadNotices();
  }

  return { bind, load, render };
})();