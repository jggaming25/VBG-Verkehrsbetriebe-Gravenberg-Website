/* VBG – Ticketsystem (Discord-like) */
VBG.tickets = (function () {
  let tickets = [];
  let currentTicket = null;
  let currentMessages = [];

  function catIcon(c) {
    const icons = { frage: '❓', problem: '⚠️', vorschlag: '💡', bewerbung: '📝', sonstiges: '📦' };
    return icons[c] || '📋';
  }

  function statusBadge(status) {
    return `<span class="badge badge-status-${esc(status)}">${esc(VBG.labels.status[status] || status)}</span>`;
  }

  function prioBadge(p) {
    return `<span class="badge badge-p-${esc(p)}">${esc(VBG.labels.priorities[p] || p)}</span>`;
  }

  function ticketItem(t) {
    const staff = VBG.isStaff(VBG.state.user.role);
    return `<button class="ticket-item" data-ticket="${t.id}">
      <div class="ticket-ic">${catIcon(t.category)}</div>
      <div class="ticket-info">
        <b>${esc(t.subject)}</b>
        <div class="ticket-sub">
          ${staff ? `<span>von ${esc(t.user_name)}</span>` : ''}
          <span>${esc(fmtDateTime(t.created_at))}</span>
          ${t.assignee_name ? `<span>👤 ${esc(t.assignee_name)}</span>` : ''}
        </div>
      </div>
      <div class="ticket-badges">${prioBadge(t.priority)}${statusBadge(t.status)}</div>
    </button>`;
  }

  async function load() {
    const data = await API.get('/api/tickets');
    tickets = data.tickets || [];
    const sub = document.getElementById('tickets-subline');
    const staff = VBG.isStaff(VBG.state.user.role);
    sub.textContent = staff
      ? `${tickets.length} Ticket(s) insgesamt · ${data.openCount} offen – übernimm ein Ticket!`
      : (data.openCount ? `${data.openCount} offene(s) Ticket(s) · unser Team meldet sich.` : 'Erstelle ein Ticket – unser Team kümmert sich.');
    render();
  }

  function render() {
    const view = document.getElementById('tickets-view');
    view.classList.remove('hidden');
    document.getElementById('ticket-chat').classList.add('hidden');
    currentTicket = null;

    if (!tickets.length) {
      view.innerHTML = `<div class="empty-state"><div class="big">🎫</div><p>Noch keine Tickets vorhanden.</p><p class="muted">Lege das erste an – unser Team antwortet schnell.</p></div>`;
      return;
    }
    view.innerHTML = `<div class="ticket-list">${tickets.map(ticketItem).join('')}</div>`;
  }

  function messageHtml(m) {
    if (m.is_system) {
      return `<div class="msg-system">— ${esc(m.message)} · ${esc(fmtDateTime(m.created_at)).replace(', ', ' ')} —</div>`;
    }
    const isMine = VBG.state.user && VBG.state.user.id === m.user_id;
    const isStaffMsg = VBG.isStaff(m.role);
    const cls = isMine ? 'msg-mine' : (isStaffMsg ? 'msg-staff' : 'msg-user');
    return `<div class="msg ${cls}">
      ${avatarHtml({ username: m.username, avatar: m.avatar })}
      <div class="msg-body">
        <div class="msg-top">
          <b>${esc(m.username)}</b>
          ${isStaffMsg ? `<span class="msg-role role-badge role-${esc(m.role)}">${esc(VBG.labels.roles[m.role] || m.role)}</span>` : ''}
          <span class="msg-time">${esc(fmtDateTime(m.created_at)).replace(', ', ' · ')}</span>
        </div>
        <p>${esc(m.message)}</p>
      </div>
    </div>`;
  }

  async function openTicket(id) {
    currentTicket = null;
    const data = await API.get(`/api/tickets/${id}/messages`);
    currentTicket = data.ticket;
    currentMessages = data.messages || [];

    document.getElementById('chat-subject').textContent = currentTicket.subject;
    const staff = VBG.isStaff(VBG.state.user.role);
    const metaParts = [
      catIcon(currentTicket.category) + ' ' + (VBG.labels.categories[currentTicket.category] || currentTicket.category),
      '#' + currentTicket.id,
      staff ? ('von ' + currentTicket.user_name) : null,
      currentTicket.assignee_name ? ('👤 ' + currentTicket.assignee_name) : null
    ].filter(Boolean);
    document.getElementById('chat-meta').textContent = metaParts.join('  ·  ');

    const actions = document.getElementById('chat-actions');
    actions.innerHTML = '';
    const isOwner = currentTicket.user_id === VBG.state.user.id;

    if (staff && currentTicket.status !== 'geschlossen') {
      const mine = currentTicket.assignee_id === VBG.state.user.id;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm ' + (mine ? 'btn-ghost' : 'btn-primary');
      btn.innerHTML = mine ? 'Abgeben' : 'Übernehmen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/${mine ? 'unclaim' : 'claim'}`); toast(mine ? 'Ticket abgegeben.' : 'Ticket übernommen!', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    }
    if (currentTicket.status !== 'geschlossen' && (isOwner || staff)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-danger';
      btn.textContent = 'Schließen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/close`); toast('Ticket geschlossen.', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    } else if (currentTicket.status === 'geschlossen' && (isOwner || staff)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-ghost';
      btn.textContent = 'Wieder öffnen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/reopen`); toast('Ticket wieder geöffnet.', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    }

    renderMessages();
    document.getElementById('tickets-view').classList.add('hidden');
    document.getElementById('ticket-chat').classList.remove('hidden');
    document.getElementById('chat-text').focus();
  }

  function renderMessages() {
    const wrap = document.getElementById('chat-messages');
    wrap.innerHTML = currentMessages.map(messageHtml).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function refreshFlow() {
    try {
      await load();
      if (currentTicket) {
        const data = await API.get(`/api/tickets/${currentTicket.id}/messages`);
        currentTicket = data.ticket;
        currentMessages = data.messages || [];
        renderMessages();
        document.getElementById('chat-subject').textContent = currentTicket.subject;
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  async function sendMessage() {
    if (!currentTicket) return;
    if (currentTicket.status === 'geschlossen') { toast('Das Ticket ist geschlossen.', 'err'); return; }
    const text = document.getElementById('chat-text').value.trim();
    if (!text) return;
    document.getElementById('chat-text').value = '';
    try {
      const btn = document.getElementById('chat-send');
      btn.disabled = true;
      const data = await API.post(`/api/tickets/${currentTicket.id}/messages`, { message: text });
      currentTicket = data.ticket;
      currentMessages = data.messages || [];
      renderMessages();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      document.getElementById('chat-send').disabled = false;
    }
  }

  async function openNew() {
    document.getElementById('ticket-subject').value = '';
    document.getElementById('ticket-desc').value = '';
    openModal('modal-ticket');
  }

  async function submitNew(e) {
    e.preventDefault();
    const subject = document.getElementById('ticket-subject').value.trim();
    const category = document.getElementById('ticket-category').value;
    const priority = document.getElementById('ticket-priority').value;
    const description = document.getElementById('ticket-desc').value.trim();
    if (!subject) { toast('Bitte ein Thema angeben.', 'err'); return; }
    const btn = document.getElementById('ticket-form').querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await API.post('/api/tickets', { subject, category, description, priority });
      toast('Ticket erstellt! Unser Team kümmert sich.', 'ok');
      closeModal('modal-ticket');
      await load();
      await VBG.notifyNewTicket(subject, data.id, priority);
      openTicket(data.id);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    document.getElementById('tickets-view').addEventListener('click', (e) => {
      const item = e.target.closest('[data-ticket]');
      if (item) openTicket(Number(item.dataset.ticket));
    });
    document.getElementById('btn-new-ticket').addEventListener('click', openNew);
    document.getElementById('ticket-form').addEventListener('submit', submitNew);
    document.getElementById('chat-send').addEventListener('click', sendMessage);
    document.getElementById('chat-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('chat-back').addEventListener('click', () => { document.getElementById('ticket-chat').classList.add('hidden'); document.getElementById('tickets-view').classList.remove('hidden'); load(); });
  }

  return { bind, load, render };
})();