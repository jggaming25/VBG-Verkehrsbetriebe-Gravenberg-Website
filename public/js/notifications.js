/* VBG – Benachrichtigungsbox (Tickets, Anschlussanfragen, Team-Nachrichten) */
VBG.notifications = (function () {
  let items = [];
  let open = false;

  function $id(i) { return document.getElementById(i); }

  async function refresh() {
    if (!VBG.state || !VBG.state.user) { setBadge(0); return; }
    try {
      const data = await API.get('/api/notifications');
      items = data.notifications || [];
      setBadge(data.unread || 0);
      if (open) renderList();
    } catch (e) { /* offline – stumm ignorieren */ }
  }

  function setBadge(n) {
    const b = $id('notif-badge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n);
  }

  function renderList() {
    const box = $id('notif-list');
    if (!items.length) {
      box.innerHTML = '<div class="notif-empty">Keine Benachrichtigungen. 💤</div>';
      return;
    }
    box.innerHTML = items.map((n) => `
      <button class="notif-item${n.read ? ' read' : ''}" data-notifid="${n.id}">
        <div class="notif-title">${esc(n.title)}</div>
        ${n.message ? `<div class="notif-msg">${esc(n.message)}</div>` : ''}
        <div class="notif-time">${esc(fmtDateTime(n.created_at))}</div>
      </button>`).join('');
  }

  async function markRead(id) {
    const n = items.find((x) => Number(x.id) === Number(id));
    if (n && n.read) return;
    try { await API.post('/api/notifications/read', { ids: [Number(id)] }); } catch (e) { /* optional */ }
    if (n) { n.read = 1; renderList(); setBadge(items.reduce((c, x) => c + (x.read ? 0 : 1), 0)); }
  }

  async function clearAll() {
    if (!items.length) { close(); return; }
    try {
      await API.del('/api/notifications');
      items = [];
      setBadge(0);
      renderList();
      toast('Benachrichtigungen geleert.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function toggle() {
    open = !open;
    $id('notif-box').classList.toggle('hidden', !open);
    if (open) refresh();
  }

  function close() {
    open = false;
    $id('notif-box').classList.add('hidden');
  }

  function bind() {
    $id('btn-notif').addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    $id('notif-list').addEventListener('click', (e) => {
      const it = e.target.closest('[data-notifid]');
      if (it) markRead(it.dataset.notifid);
    });
    $id('notif-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      clearAll();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notif-wrap')) close();
    });
  }

  return { bind, refresh, close };
})();