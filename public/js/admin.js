/* VBG – Admin-Bereich: Meldungs-Banner verwalten + Kontoübersicht/Rollenverwaltung */
VBG.admin = (function () {
  let users = [];
  let notifyTarget = { id: null, name: '' };

  /* ------------------------------ Nahverkehr Steuerung ------------------------------ */

  function fillSelect(sel, items) {
    sel.innerHTML = items.map((it) => `<option value="${String(it.value)}">${it.label}</option>`).join('');
  }

  async function loadSteuerung() {
    if (!VBG.isOwner(VBG.state.user.role)) return;
    try {
      const reqs = await API.get('/api/nahverkehr/requests');
      const conns = await API.get('/api/nahverkehr/connections');
      renderRequests(reqs.requests || []);
      renderConns(conns.connections || []);
      loadWindow();
      loadTrips();
    } catch (e) {
      toast('Nahverkehr-Steuerung: ' + e.message, 'err');
    }
  }

  /* ------------------------------ Fahrten-Zeitraum (Betriebszeiten) ------------------------------ */

  async function loadWindow() {
    const status = document.getElementById('win-status');
    try {
      const data = await API.get('/api/nahverkehr/window');
      document.getElementById('win-from').value = data.from || '';
      document.getElementById('win-to').value = data.to || '';
      renderWindowStatus(data.from, data.to);
    } catch (e) {
      if (status) status.textContent = 'Zeitfenster konnte nicht geladen werden.';
    }
  }

  function renderWindowStatus(from, to) {
    const status = document.getElementById('win-status');
    if (!status) return;
    status.textContent = from && to
      ? `Aktiver Betriebszeitraum: ${from} – ${to} Uhr (nur Fahrten, die in diesem Zeitraum starten, sind aktiv).`
      : 'Standard: alle Fahrten aktiv (kein Zeitraum gesetzt).';
  }

  async function setWindow() {
    const from = document.getElementById('win-from').value;
    const to = document.getElementById('win-to').value;
    if (!from || !to) { toast('Bitte beide Uhrzeiten angeben.', 'err'); return; }
    try {
      const data = await API.put('/api/nahverkehr/window', { from, to });
      toast(`Zeitraum ${data.from} – ${data.to} Uhr aktiviert.`, 'ok');
      renderWindowStatus(data.from, data.to);
      loadTrips();
      if (VBG.nahverkehr && VBG.nahverkehr.loadBoard) VBG.nahverkehr.loadBoard();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function clearWindow() {
    try {
      const data = await API.del('/api/nahverkehr/window');
      toast('Zeitraum aufgehoben – alle Fahrten aktiv.', 'ok');
      renderWindowStatus(data.from, data.to);
      loadTrips();
      if (VBG.nahverkehr && VBG.nahverkehr.loadBoard) VBG.nahverkehr.loadBoard();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ------------------------------ Fahrtliste (aktive Fahrten) ------------------------------ */

  let allTrips = [];
  let openTripId = null;

  async function loadTrips() {
    try {
      const data = await API.get('/api/nahverkehr/trips');
      allTrips = data.trips || [];
      const lineSel = document.getElementById('trip-line-filter');
      const lines = [...new Set(allTrips.map((t) => t.line))].sort();
      fillSelect(lineSel, [''].concat(lines).map((l) => ({ value: l, label: l ? 'Linie ' + l : 'Alle Linien' })));
      renderTrips();
    } catch (e) { toast(e.message, 'err'); }
  }

  function filteredTrips() {
    const q = (document.getElementById('trip-filter').value || '').toLowerCase().trim();
    const line = document.getElementById('trip-line-filter').value;
    return allTrips.filter((t) => {
      if (line && t.line !== line) return false;
      if (!q) return true;
      return (t.line + ' ' + t.course + ' ' + t.direction + ' ' + t.start + ' ' + t.end + ' ' + t.dest).toLowerCase().includes(q);
    });
  }

  function renderTrips() {
    const wrap = document.getElementById('trip-list');
    const list = filteredTrips();
    if (!list.length) {
      wrap.innerHTML = '<p class="muted">Keine Fahrten gefunden.</p>';
      return;
    }
    wrap.innerHTML = list.map((t) => {
      const dir = t.direction === 'hin' ? '→' : '←';
      const cls = t.cancelled ? 'cancelled' : '';
      const shown = openTripId === t.id;
      return `<div class="trip-row ${cls}">
        <div class="trip-row-main">
          <div class="trip-row-info">
            <span class="bl-chip" style="--bl:${esc(t.color || '#2e9e5b')}">L${esc(t.line)}</span>
            <b>${esc(t.course)}</b>
            <span class="muted">${dir} ${esc(t.start)} – ${esc(t.dest)}</span>
            ${t.cancelled ? '<span class="badge badge-p-hoch">🚫 ausgefallen</span>' : ''}
          </div>
          <div class="req-actions">
            <button class="btn btn-sm ${t.cancelled ? 'btn-ghost' : 'btn-danger'}" data-trip-toggle="${t.id}" data-cancelled="${t.cancelled ? '1' : '0'}">${t.cancelled ? '✅ Wieder fahren' : '🚫 Fahrt fällt aus'}</button>
            <button class="btn btn-sm btn-primary" data-trip-detail="${t.id}">${shown ? 'Detail schließen' : 'Detail'}</button>
          </div>
        </div>
        ${shown ? `<div class="trip-detail" data-trip-detailbox="${t.id}"><p class="muted">Lade Halte …</p></div>` : ''}
      </div>`;
    }).join('');
    if (openTripId) renderTripDetail(openTripId, 'load');
  }

  async function renderTripDetail(id, state) {
    const box = document.querySelector(`[data-trip-detailbox="${id}"]`);
    if (!box) return;
    if (state === 'load') {
      box.innerHTML = '<p class="muted">Lade Halte …</p>';
      try {
        const t = await API.get('/api/nahverkehr/trips/' + id);
        if (openTripId !== Number(id)) return;
        box.innerHTML = `<div class="trip-meta">${t.stops.length} Halte · Bus: ${esc(fmtBus(t.bus))}</div>
          <div class="stop-list">${t.stops.map((s) => `
            <div class="stop-item${s.cancelled ? ' cancelled' : ''}">
              <div class="stop-no">${s.seq + 1}</div>
              <div class="stop-main"><b>${esc(s.stop)}</b><div class="report-meta">an ${esc(s.arr)} · ab ${esc(s.dep)}</div></div>
              <button class="btn btn-sm ${s.cancelled ? 'btn-ghost' : 'btn-danger'}" data-stopid="${s.stopId}" data-trip="${t.id}" data-cancelled="${s.cancelled ? '1' : '0'}">${s.cancelled ? '✅ Teil wieder' : '🚫 Halt ausfallen'}</button>
            </div>`).join('')}</div>`;
        box.querySelectorAll('[data-stopid]').forEach((b) => b.addEventListener('click', () => toggleStop(b)));
      } catch (e) { box.innerHTML = '<p class="muted">Halte konnten nicht geladen werden.</p>'; }
      return;
    }
    const t = allTrips.find((x) => x.id === Number(id));
    if (t) {
      const dir = t.direction === 'hin' ? '→' : '←';
      box.innerHTML = `<div class="trip-meta">Fahrt L${esc(t.line)} Kurs ${esc(t.course)} ${dir} ${esc(t.start)} – ${esc(t.dest)}</div>
        <div class="stop-list"><p class="muted">Keine Details geladen.</p></div>`;
    }
  }

  function fmtBus(b) { return b || 'Solo'; }

  function toggleTripRow(id, cancelled) {
    if (cancelled) restoreTripById(id); else cancelTripId(id);
  }

  async function cancelTripId(id) {
    if (!confirm('Diese Fahrt wirklich ausfallen lassen? Sie erscheint dann nicht mehr in der Abfahrtstafel.')) return;
    try {
      await API.post('/api/nahverkehr/trips/' + id + '/cancel');
      toast('Fahrt ausgesetzt.', 'ok');
      loadSteuerung();
    } catch (e) { toast(e.message, 'err'); }
  }

async function restoreTripById(id) {
    try {
      await API.del('/api/nahverkehr/trips/' + id + '/cancel');
      toast('Fahrt fährt wieder.', 'ok');
      loadSteuerung();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function restoreStop(tripId, stopId) {
    try {
      await API.del(`/api/nahverkehr/trips/${tripId}/stop-cancel?stopId=${stopId}`);
      toast('Halt wieder bedient.', 'ok');
      loadSteuerung();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function toggleStop(btn) {
    const tripId = Number(btn.dataset.trip);
    const stopId = Number(btn.dataset.stopid);
    const cancelled = btn.dataset.cancelled === '1';
    try {
      if (cancelled) {
        await API.del(`/api/nahverkehr/trips/${tripId}/stop-cancel?stopId=${stopId}`);
      } else {
        await API.post(`/api/nahverkehr/trips/${tripId}/stop-cancel`, { stopId });
      }
      toast(cancelled ? 'Halt wird wieder bedient.' : 'Halt ausgesetzt.', 'ok');
      loadSteuerung();
      renderTripDetail(tripId, 'load');
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
      // Feste Inhaber-Konten (OWNER_EMAILS) und das eigene Konto sind über die UI geschützt.
      const canAct = canEdit && u.id !== me && u.owner_email !== 1;
      const status = u.blocked ? '<span class="badge badge-p-hoch">⛔ Gesperrt</span>' : (u.verified ? '<span class="verified">✓ verifiziert</span>' : '<span class="muted">− nicht verifiziert</span>');
      return `<tr>
        <td><div class="user-cell">${avatarHtml({ username: u.username, avatar: u.avatar })}<b>${esc(u.username)}</b></div></td>
        <td class="muted">${esc(u.email)}</td>
        <td>${roleCell}</td>
        <td>${status}</td>
        <td class="muted">${esc(fmtDateISO(u.created_at))}</td>
        <td class="user-actions">
          ${canEdit ? `
            <button class="btn btn-sm btn-ghost" data-notifyfor="${u.id}" title="Benachrichtigung senden">📨</button>
            <button class="btn btn-sm btn-ghost" data-logsfor="${u.id}" title="Aktivitäts-Logs ansehen (letzte 10 Tage)">📜</button>` : ''}
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

  /* ------------------------------ Acc-Logs & Team-Benachrichtigung ------------------------------ */

  async function openLogs(userId, username) {
    document.getElementById('logs-target').textContent = `Aktivitäten von ${username} · letzte 10 Tage`;
    const body = document.getElementById('logs-body');
    body.innerHTML = '<p class="muted">Logs werden geladen …</p>';
    openModal('modal-logs');
    try {
      const data = await API.get('/api/admin/users/' + userId + '/logs');
      body.innerHTML = data.logs.length
        ? data.logs.map((l) => `
            <div class="log-item">
              <div class="log-action">${esc(l.action)}</div>
              ${l.detail ? `<div class="log-detail">${esc(l.detail)}</div>` : ''}
              <div class="log-time">${esc(fmtDateTime(l.created_at))}</div>
            </div>`).join('')
        : '<div class="empty-state"><div class="big">📭</div><p>Keine Aktivitäten in den letzten 10 Tagen.</p></div>';
    } catch (e) {
      body.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  function openNotify(userId, username) {
    notifyTarget = { id: userId, name: username };
    document.getElementById('notify-target').textContent = 'An: ' + username;
    document.getElementById('notify-text').value = '';
    openModal('modal-notify');
    setTimeout(() => document.getElementById('notify-text').focus(), 60);
  }

  async function sendNotify() {
    const text = document.getElementById('notify-text').value.trim();
    if (!text) { toast('Bitte eine Nachricht angeben.', 'err'); return; }
    try {
      await API.post('/api/admin/users/' + notifyTarget.id + '/notify', { message: text });
      toast('Benachrichtigung an ' + notifyTarget.name + ' gesendet.', 'ok');
      closeModal('modal-notify');
      if (VBG.notifications) VBG.notifications.refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
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
      if (d) { removeUser(Number(d.dataset.delfor), d.closest('tr').querySelector('b').textContent); return; }
      const n = e.target.closest('[data-notifyfor]');
      if (n) { const tr = n.closest('tr'); openNotify(Number(n.dataset.notifyfor), tr.querySelector('b').textContent); return; }
      const l = e.target.closest('[data-logsfor]');
      if (l) { const tr = l.closest('tr'); openLogs(Number(l.dataset.logsfor), tr.querySelector('b').textContent); }
    });
    document.getElementById('notify-send').addEventListener('click', sendNotify);
    document.getElementById('user-search').addEventListener('input', render);
    document.getElementById('notice-form').addEventListener('submit', submitNotice);
    document.getElementById('win-set').addEventListener('click', setWindow);
    document.getElementById('win-clear').addEventListener('click', clearWindow);
    document.getElementById('trip-filter').addEventListener('input', renderTrips);
    document.getElementById('trip-line-filter').addEventListener('change', renderTrips);
    document.getElementById('trip-list').addEventListener('click', (e) => {
      const t = e.target.closest('[data-trip-toggle]');
      if (t) { toggleTripRow(Number(t.dataset.tripToggle), t.dataset.cancelled === '1'); return; }
      const d = e.target.closest('[data-trip-detail]');
      if (d) {
        const id = Number(d.dataset.tripDetail);
        openTripId = openTripId === id ? null : id;
        renderTrips();
        return;
      }
    });
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