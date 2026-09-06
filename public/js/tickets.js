/* VBG – Ticketsystem (Discord-like) */
VBG.tickets = (function () {
  let tickets = [];
  let currentTicket = null;
  let currentMessages = [];
  let pendingAttachment = null;
  let pendingReport = null;
  let currentSub = null;
  const filters = { status: 'alle', q: '' };

  const ticketNr = (t) => 'VBG-' + String(t.id).padStart(4, '0');

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

  function dueDateText(t) {
    if (!t.due_date) return '';
    const d = new Date(t.due_date + 'T00:00:00');
    if (isNaN(d)) return t.due_date;
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });
  }

  function ticketItem(t) {
    const staff = VBG.isStaff(VBG.state.user.role);
    const due = t.due_date
      ? `<span class="${!staff && t.status !== 'geschlossen' && new Date(t.due_date + 'T23:59:59') < new Date() ? 'due-overdue' : ''}">📅 ${esc(dueDateText(t))}</span>`
      : '';
    return `<button class="ticket-item" data-ticket="${t.id}">
      <div class="ticket-ic">${catIcon(t.category)}</div>
      <div class="ticket-info">
        <b>${esc(t.subject)}</b>
        <div class="ticket-sub">
          <span class="ticket-nr">${ticketNr(t)}</span>
          <span>${esc(fmtDateTime(t.created_at))}</span>
          ${staff ? `<span>von ${esc(t.user_name)}</span>` : ''}
          ${t.assignee_name ? `<span>👤 ${esc(t.assignee_name)}</span>` : ''}
          ${due}
        </div>
      </div>
      <div class="ticket-badges">${prioBadge(t.priority)}${statusBadge(t.status)}</div>
    </button>`;
  }

  function filteredTickets() {
    const q = filters.q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filters.status !== 'alle' && t.status !== filters.status) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        ticketNr(t).toLowerCase().includes(q) ||
        String(t.id).includes(q) ||
        (t.user_name || '').toLowerCase().includes(q)
      );
    });
  }

  function myTickets() {
    const me = VBG.state.user && VBG.state.user.id;
    return tickets.filter((t) => t.user_id === me);
  }

  async function load() {
    const data = await API.get('/api/tickets');
    tickets = data.tickets || [];
    const staff = VBG.isStaff(VBG.state.user.role);
    const dashChip = document.querySelector('#tickets-subnav .chip[data-ticketsub="dashboard"]');
    if (dashChip) dashChip.classList.toggle('hidden', !staff);
    document.getElementById('tickets-subline').textContent = staff
      ? `${tickets.length} Ticket(s) insgesamt · ${data.openCount} offen – übernimm ein Ticket!`
      : (data.openCount ? `${data.openCount} offene(s) Ticket(s) · unser Team meldet sich.` : 'Erstelle ein Ticket – unser Team kümmert sich.');
    if (!currentSub) currentSub = staff ? 'dashboard' : 'create';
    showSub(currentSub);
    render();
  }

  function showSub(name) {
    currentSub = name;
    document.querySelectorAll('#tickets-subnav .chip').forEach((c) => c.classList.toggle('active', c.dataset.ticketsub === name));
    const staff = VBG.isStaff(VBG.state.user.role);
    document.getElementById('tickets-dashboard').classList.toggle('hidden', !staff || name !== 'dashboard');
    document.getElementById('tickets-create').classList.toggle('hidden', name !== 'create');
    if (name === 'dashboard') render();
    if (name === 'create') renderMyTickets();
  }

  function render() {
    const view = document.getElementById('tickets-view');
    document.getElementById('ticket-chat').classList.add('hidden');
    if (!currentSub) return;

    document.querySelectorAll('#ticket-filters .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.filter === filters.status);
    });

    const list = filteredTickets();
    const hasFilter = filters.status !== 'alle' || filters.q.trim();
    view.innerHTML = '';
    if (!list.length) {
      view.innerHTML = hasFilter
        ? `<div class="empty-state"><div class="big">🔎</div><p>Keine Treffer für die aktuelle Filter-/Sucheinstellung.</p></div>`
        : `<div class="empty-state"><div class="big">🎫</div><p>Noch keine Tickets vorhanden.</p><p class="muted">Lege das erste an – unser Team antwortet schnell.</p></div>`;
      return;
    }
    view.innerHTML = `<div class="ticket-list">${list.map(ticketItem).join('')}</div>`;
  }

  function renderMyTickets() {
    const list = myTickets();
    document.getElementById('my-tickets-sub').textContent = list.length + ' Ticket(s) insgesamt';
    const wrap = document.getElementById('my-tickets-list');
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🎫</div><p>Noch keine eigenen Tickets.</p><p class="muted">Sobald du ein Ticket erstellst, findest du es hier.</p></div>`;
      return;
    }
    wrap.innerHTML = `<div class="ticket-list">${list.map(ticketItem).join('')}</div>`;
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
          ${isMine ? '' : `<span class="msg-report" title="Nachricht melden" data-reportmsg="${m.id}" data-reportuser="${m.user_id}" data-reportname="${esc(m.username)}">⚑</span>`}
        </div>
        ${m.message ? `<p>${esc(m.message)}</p>` : ''}
        ${m.attachment ? `<a href="${m.attachment}" target="_blank" rel="noopener"><img class="msg-img" src="${m.attachment}" alt="Anhang"/></a>` : ''}
      </div>
    </div>`;
  }

  function canEdit() {
    return !!(VBG.state.user && VBG.isStaff(VBG.state.user.role));
  }

  function renderComposer() {
    const closed = currentTicket && currentTicket.status === 'geschlossen';
    document.getElementById('chat-text').disabled = !!closed;
    document.getElementById('chat-send').disabled = !!closed || !!pendingAttachment;
    document.getElementById('chat-attach').disabled = !!closed;
    document.getElementById('chat-text').placeholder = closed ? 'Ticket geschlossen.' : 'Nachricht schreiben …';
  }

  function renderAttachmentPreview() {
    const box = document.getElementById('chat-attach-preview');
    if (!pendingAttachment) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<img src="${pendingAttachment}" alt="Anhang"/><button class="attach-remove" type="button" title="Entfernen">✕</button>`;
    box.querySelector('.attach-remove').addEventListener('click', (e) => { e.stopPropagation(); pendingAttachment = null; renderAttachmentPreview(); renderComposer(); });
  }

  function showTicketsTab() {
    document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
    document.getElementById('tab-tickets').classList.remove('hidden');
    document.getElementById('tab-tickets').classList.add('active');
    document.querySelectorAll('.nav-link').forEach((n) => n.classList.toggle('active', n.dataset.tab === 'tickets'));
  }

  function openTicketFlow(id) {
    showTicketsTab();
    document.getElementById('tickets-dashboard').classList.add('hidden');
    document.getElementById('tickets-create').classList.add('hidden');
    document.getElementById('ticket-chat').classList.remove('hidden');
    openTicket(id);
  }

  async function openTicket(id) {
    currentTicket = null;
    const data = await API.get(`/api/tickets/${id}/messages`);
    currentTicket = data.ticket;
    currentMessages = data.messages || [];

    document.getElementById('chat-subject').textContent = currentTicket.subject;
    const staff = VBG.isStaff(VBG.state.user.role);
    const metaParts = [
      ticketNr(currentTicket),
      catIcon(currentTicket.category) + ' ' + (VBG.labels.categories[currentTicket.category] || currentTicket.category),
      prioBadge(currentTicket.priority).replace(/<[^>]+>/g, ''),
      staff ? ('von ' + currentTicket.user_name) : null,
      currentTicket.assignee_name ? ('👤 ' + currentTicket.assignee_name) : null,
      currentTicket.due_date ? ('📅 bis ' + dueDateText(currentTicket)) : null
    ].filter(Boolean);
    document.getElementById('chat-meta').innerHTML = metaParts.join('  ·  ');

    const actions = document.getElementById('chat-actions');
    actions.innerHTML = '';

    if (canEdit() && currentTicket.status !== 'geschlossen') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-ghost';
      btn.textContent = '✏️ Bearbeiten';
      btn.addEventListener('click', openEditModal);
      actions.appendChild(btn);
    }

    if (staff && currentTicket.status !== 'geschlossen') {
      const mine = currentTicket.assignee_id === VBG.state.user.id;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm ' + (mine ? 'btn-ghost' : 'btn-primary');
      btn.innerHTML = mine ? 'Abgeben' : 'Übernehmen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/${mine ? 'unclaim' : 'claim'}`); toast(mine ? 'Ticket abgegeben.' : 'Ticket übernommen!', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    }
    if (currentTicket.status !== 'geschlossen' && staff) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-danger';
      btn.textContent = 'Schließen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/close`); toast('Ticket geschlossen.', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    } else if (currentTicket.status === 'geschlossen' && staff) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-ghost';
      btn.textContent = 'Wieder öffnen';
      btn.addEventListener('click', async () => { try { await API.post(`/api/tickets/${currentTicket.id}/reopen`); toast('Ticket wieder geöffnet.', 'ok'); refreshFlow(); } catch (e2) { toast(e2.message, 'err'); } });
      actions.appendChild(btn);
    }

    renderMessages();
    renderComposer();
    document.getElementById('chat-text').focus();
  }

  function renderMessages() {
    const wrap = document.getElementById('chat-messages');
    wrap.innerHTML = currentMessages.map(messageHtml).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function refreshFlow() {
    const id = currentTicket && currentTicket.id;
    try {
      await load();
      if (id) {
        const data = await API.get(`/api/tickets/${id}/messages`);
        currentTicket = data.ticket;
        currentMessages = data.messages || [];
        renderMessages();
        renderComposer();
        document.getElementById('chat-subject').textContent = currentTicket.subject;
        showTicketsTab();
        document.getElementById('tickets-dashboard').classList.add('hidden');
        document.getElementById('tickets-create').classList.add('hidden');
        document.getElementById('ticket-chat').classList.remove('hidden');
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  function backToList() {
    document.getElementById('ticket-chat').classList.add('hidden');
    load();
  }

  function openEditModal() {
    if (!currentTicket) return;
    document.getElementById('edit-ticket-subject').value = currentTicket.subject || '';
    document.getElementById('edit-ticket-category').value = currentTicket.category || 'frage';
    document.getElementById('edit-ticket-priority').value = currentTicket.priority || 'normal';
    document.getElementById('edit-ticket-due').value = currentTicket.due_date || '';
    document.getElementById('edit-ticket-desc').value = currentTicket.description || '';
    openModal('modal-edit-ticket');
  }

  async function submitEdit(e) {
    e.preventDefault();
    const body = {
      subject: document.getElementById('edit-ticket-subject').value.trim(),
      category: document.getElementById('edit-ticket-category').value,
      priority: document.getElementById('edit-ticket-priority').value,
      description: document.getElementById('edit-ticket-desc').value.trim(),
      due_date: document.getElementById('edit-ticket-due').value || null
    };
    const btn = document.getElementById('ticket-edit-form').querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await API.put(`/api/tickets/${currentTicket.id}`, body);
      toast('Ticket gespeichert.', 'ok');
      closeModal('modal-edit-ticket');
      currentTicket = data.ticket;
      currentMessages = data.messages || [];
      renderMessages();
      renderComposer();
      document.getElementById('chat-subject').textContent = currentTicket.subject;
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function sendMessage() {
    if (!currentTicket) return;
    if (currentTicket.status === 'geschlossen') { toast('Das Ticket ist geschlossen.', 'err'); return; }
    const text = document.getElementById('chat-text').value.trim();
    if (!text && !pendingAttachment) return;
    const attachment = pendingAttachment;
    pendingAttachment = null;
    renderAttachmentPreview();
    document.getElementById('chat-text').value = '';
    try {
      const btn = document.getElementById('chat-send');
      btn.disabled = true;
      const data = await API.post(`/api/tickets/${currentTicket.id}/messages`, { message: text, attachment });
      currentTicket = data.ticket;
      currentMessages = data.messages || [];
      renderMessages();
    } catch (e) {
      toast(e.message, 'err');
      pendingAttachment = attachment;
      renderAttachmentPreview();
    } finally {
      renderComposer();
    }
  }

  function resetNewForm() {
    document.getElementById('ticket-subject').value = '';
    document.getElementById('ticket-category').value = 'frage';
    document.getElementById('ticket-priority').value = 'normal';
    document.getElementById('ticket-desc').value = '';
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
      resetNewForm();
      await VBG.notifyNewTicket(subject, data.id, priority);
      openTicketFlow(data.id);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function onSwitchToCreate() {
    resetNewForm();
    if (currentSub !== 'create') showSub('create');
  }

  function openReport(messageId, userId, name) {
    if (!currentTicket) { toast('Bitte zuerst ein Ticket öffnen.', 'err'); return; }
    pendingReport = { ticket_id: currentTicket.id, message_id: messageId, reported_user_id: userId };
    document.getElementById('report-target-text').textContent = 'Meldung an das Team senden – Nachricht von ' + name + '.';
    document.getElementById('report-form').reset();
    openModal('modal-report');
  }

  async function submitReport(e) {
    e.preventDefault();
    if (!pendingReport) { toast('Bitte zuerst eine Nachricht auswählen.', 'err'); return; }
    const reason = document.getElementById('report-reason').value;
    if (!reason) { toast('Bitte einen Grund wählen.', 'err'); return; }
    const details = document.getElementById('report-details').value.trim();
    const btn = document.getElementById('report-form').querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await API.post('/api/reports', { ...pendingReport, reason, details });
      toast('Danke! Deine Meldung wurde an das Team gesendet.', 'ok');
      closeModal('modal-report');
      pendingReport = null;
      if (VBG.state.user && VBG.isStaff(VBG.state.user.role)) VBG.admin.loadAdmin().catch(() => {});
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function onFilePicked() {
    const input = document.getElementById('chat-file');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('Bild größer als 8 MB.', 'err'); return; }
    try {
      pendingAttachment = await fileToDataURL(file, 1200);
      renderAttachmentPreview();
      renderComposer();
    } catch (err) { toast(err.message, 'err'); }
  }

  function bind() {
    document.querySelector('#tickets-subnav').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-ticketsub]');
      if (!chip) return;
      if (chip.dataset.ticketsub === 'create') onSwitchToCreate();
      else showSub('dashboard');
    });
    document.getElementById('tickets-view').addEventListener('click', (e) => {
      const item = e.target.closest('[data-ticket]');
      if (item) openTicketFlow(Number(item.dataset.ticket));
    });
    document.getElementById('my-tickets-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-ticket]');
      if (item) openTicketFlow(Number(item.dataset.ticket));
    });
    document.getElementById('ticket-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      filters.status = chip.dataset.filter;
      render();
    });
    document.getElementById('ticket-search').addEventListener('input', (e) => {
      filters.q = e.target.value;
      render();
    });
    document.getElementById('ticket-form').addEventListener('submit', submitNew);
    document.getElementById('ticket-edit-form').addEventListener('submit', submitEdit);
    document.getElementById('report-form').addEventListener('submit', submitReport);
    document.getElementById('chat-send').addEventListener('click', sendMessage);
    document.getElementById('chat-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('chat-attach').addEventListener('click', () => document.getElementById('chat-file').click());
    document.getElementById('chat-file').addEventListener('change', onFilePicked);
    document.getElementById('chat-back').addEventListener('click', backToList);
    document.getElementById('chat-messages').addEventListener('click', (e) => {
      const rep = e.target.closest('.msg-report');
      if (rep) {
        e.stopPropagation();
        openReport(Number(rep.dataset.reportmsg), Number(rep.dataset.reportuser), rep.dataset.reportname);
        return;
      }
      const imgLink = e.target.closest('a[href^="data:image"]');
      if (imgLink) openImageView(imgLink.href);
    });
  }

  return { bind, load, render, backToList };
})();