/* VBG – App-Steuerung: Theme, Tabs, Auth, Konto, E-Mails */
(function () {
  const state = (VBG.state = { user: null, authMode: 'login' });

  const $ = (id) => document.getElementById(id);
  const TABS = ['start', 'shifts', 'netzplan', 'linien', 'tickets', 'admin', 'account'];

  /* ------------------------------ Toasts / Modals ------------------------------ */

  function toast(msg, type) {
    const wrap = $('toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3400);
    setTimeout(() => el.remove(), 3800);
  }

  function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeModal(id) { $(id).classList.add('hidden'); document.body.style.overflow = ''; }
  function closeAllModals() { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); document.body.style.overflow = ''; }

  window.toast = toast;
  window.openModal = openModal;
  window.closeModal = closeModal;

  /* ------------------------------ Theme ------------------------------ */

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('vbg-theme', t);
  }
  function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

  /* ------------------------------ Tabs ------------------------------ */

  function showTab(name) {
    $('tickets-dropdown').classList.add('hidden');
    if (name === 'tickets' && !state.user) { toast('Bitte erst anmelden oder registrieren.', 'err'); openModal('modal-auth'); return; }
    if (name === 'admin' && !state.user) { toast('Bitte erst anmelden oder registrieren.', 'err'); openModal('modal-auth'); return; }
    if (name === 'admin' && !VBG.isStaff(state.user.role)) { toast('Keine Berechtigung für den Admin-Bereich.', 'err'); return; }
    if (name === 'account' && !state.user) { openModal('modal-auth'); return; }
    TABS.forEach((t) => {
      $('tab-' + t).classList.toggle('active', t === name);
    });
    document.querySelectorAll('.nav-link[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'shifts') VBG.shifts.load().catch((e) => toast(e.message, 'err'));
    if (name === 'tickets') VBG.tickets.load().catch((e) => toast(e.message, 'err'));
    if (name === 'account') renderAccount();
    if (name === 'admin') VBG.admin.load().catch((e) => toast(e.message, 'err'));
  }
  window.showTab = showTab;

  function openTickets(sub) {
    if (!state.user) { toast('Bitte erst anmelden oder registrieren.', 'err'); openModal('modal-auth'); return; }
    if (sub === 'dashboard' && !VBG.isStaff(state.user.role)) { toast('Keine Berechtigung für das Ticket-Dashboard.', 'err'); return; }
    state.ticketsTarget = sub;
    showTab('tickets');
  }
  VBG.openTickets = openTickets;

  /* ------------------------------ Auth UI ------------------------------ */

  function setAuthMode(mode) {
    state.authMode = mode;
    $('auth-title').textContent = mode === 'login' ? 'Willkommen zurück' : 'Konto erstellen';
    $('auth-subline').textContent = mode === 'login' ? 'Melde dich an oder nutze Discord.' : 'Registriere dich in Sekunden.';
    $('auth-username-field').classList.toggle('hidden', mode === 'login');
    $('auth-username').required = mode === 'register';
    $('auth-password').minLength = mode === 'register' ? 6 : 0;
    $('auth-password').placeholder = mode === 'register' ? 'Mindestens 6 Zeichen' : '••••••••';
    $('auth-submit').textContent = mode === 'login' ? 'Anmelden' : 'Registrieren';
    $('auth-switch-text').textContent = mode === 'login' ? 'Noch kein Konto?' : 'Schon registriert?';
    $('auth-toggle').textContent = mode === 'login' ? 'Registrieren' : 'Anmelden';
  }

  async function submitAuth(e) {
    e.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const username = $('auth-username').value.trim();
    const btn = $('auth-submit');
    btn.disabled = true;
    try {
      if (state.authMode === 'login') {
        const data = await API.post('/api/login', { email, password });
        state.user = data.user;
        toast('Willkommen zurück, ' + data.user.username + '!', 'ok');
        closeModal('modal-auth');
        afterLogin();
      } else {
        const data = await API.post('/api/register', { email, password, username });
        state.user = data.user;
        closeModal('modal-auth');
        afterLogin();
        if (data.verifyCode) {
          const sent = await sendVerifyEmail(data.user.email, data.user.username, data.verifyCode);
          toast(
            sent
              ? 'Konto erstellt! Verifizierungs-Code wurde per E-Mail gesendet.'
              : 'Konto erstellt! Dein Verifizierungs-Code: ' + data.verifyCode,
            'ok'
          );
        } else {
          toast('Konto erstellt – als Inhaber bestätigt!', 'ok');
        }
        renderAccount();
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------ Account ------------------------------ */

  function renderAccount() {
    if (!state.user) return;
    const u = state.user;
    $('profile-name').textContent = u.username;
    $('profile-email').textContent = u.email;
    $('profile-created').textContent = fmtDateISO(u.created_at ? u.created_at.slice(0, 10) : null);
    $('profile-role').className = 'role-badge role-' + u.role;
    $('profile-role').textContent = VBG.labels.roles[u.role];
    $('profile-provider').textContent = u.avatar ? 'Discord' : 'E-Mail';

    const av = $('profile-avatar');
    if (u.avatar) { av.src = u.avatar; av.style.display = ''; }
    else { av.src = ''; av.style.display = 'none'; }

    $('profile-verified').textContent = u.verified ? '✓ Verifiziert' : '✗ Nicht verifiziert';
    $('profile-verified').className = 'verified' + (u.verified ? '' : ' muted');
    $('verify-banner').classList.toggle('hidden', !!u.verified);
    renderDiscordRoles(u.discord_roles || []);
  }

  function renderDiscordRoles(roles) {
    const wrap = $('profile-discord-roles');
    if (!roles || !roles.length) {
      wrap.innerHTML = '<p class="muted">Keine Discord-Rollen verknüpft.</p>';
      return;
    }
    wrap.innerHTML = '<h3 class="roles-title">🎖️ Discord-Rollen</h3>' + roles.map((r) => {
      const label = VBG.discordRoles[r] || r;
      return `<span class="discord-role-chip">${label}</span>`;
    }).join('');
  }

  async function verifyCode() {
    const code = $('verify-code').value.trim();
    if (!code) { toast('Bitte Code eingeben.', 'err'); return; }
    try {
      await API.post('/api/verify', { code });
      state.user.verified = 1;
      toast('E-Mail verifiziert!', 'ok');
      renderAccount();
      updateAuthUI();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function resendCode() {
    try {
      const data = await API.post('/api/verify/resend');
      const sent = await sendVerifyEmail(state.user.email, state.user.username, data.verifyCode);
      toast(sent ? 'Code erneut gesendet.' : 'Dein neuer Code: ' + data.verifyCode, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function logout() {
    try { await API.post('/api/logout'); } catch (e) { /* ignoriere */ }
    state.user = null;
    updateAuthUI();
    toast('Abgemeldet.', 'ok');
    showTab('start');
  }

  /* ------------------------------ UI-State nach Login ------------------------------ */

  function afterLogin() {
    updateAuthUI();
    showTab('account');
  }

  function updateAuthUI() {
    const logged = !!state.user;
    const staff = logged && VBG.isStaff(state.user.role);
    $('auth-buttons').classList.toggle('hidden', logged);
    $('user-chip').classList.toggle('hidden', !logged);
    $('nav-tickets-wrap').classList.toggle('hidden', !logged);
    $('dd-tickets-dashboard').classList.toggle('hidden', !staff);
    $('nav-admin').classList.toggle('hidden', !staff);
    $('nav-account').classList.toggle('hidden', !logged);
    if (logged) {
      $('user-name').textContent = state.user.username;
      const chipAv = $('user-avatar');
      if (state.user.avatar) { chipAv.src = state.user.avatar; chipAv.style.display = ''; }
      else { chipAv.src = ''; chipAv.style.display = 'none'; }
      $('btn-hero-ticket').textContent = 'Support-Ticket';
    } else {
      $('btn-hero-ticket').textContent = 'Anmelden & Support-Ticket';
    }
  }

  /* ------------------------------ Meldungen (Banner) ------------------------------ */

  async function loadNotices() {
    const wrap = $('notices-bar');
    try {
      const { notices } = await API.get('/api/notices');
      if (!notices.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
      wrap.innerHTML = notices.map((n) => `
        <div class="notice-item">
          <span class="notice-icon">⚠️</span>
          <span class="notice-text">${esc(n.text)}</span>
          ${VBG.isOwner(state.user && state.user.role) ? `<button class="notice-del icon-btn" data-delnotice="${n.id}" title="Meldung löschen">✕</button>` : ''}
        </div>`).join('');
      wrap.classList.remove('hidden');
      wrap.querySelectorAll('[data-delnotice]').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await API.del('/api/notices/' + b.dataset.delnotice);
            toast('Meldung gelöscht.', 'ok');
            loadNotices();
          } catch (err) { toast(err.message, 'err'); }
        });
      });
    } catch (e) {
      wrap.classList.add('hidden');
    }
  }
  VBG.loadNotices = loadNotices;

  /* ------------------------------ E-Mail (EmailJS) ------------------------------ */

  function emailJSReady() {
    return VBG.emailjs.publicKey && VBG.emailjs.serviceId && (VBG.emailjs.verifyTemplateId || VBG.emailjs.ticketTemplateId);
  }

  async function sendVerifyEmail(to, username, code) {
    if (!emailJSReady()) return false;
    const { publicKey, serviceId, verifyTemplateId } = VBG.emailjs;
    try {
      await emailjs.send(serviceId, verifyTemplateId, { to_email: to, username, verification_code: code }, { publicKey });
      return true;
    } catch (e) { console.error('EmailJS verify', e); return false; }
  }

  async function notifyNewTicket(subject, id, priority) {
    if (!VBG.emailjs.publicKey || !VBG.emailjs.serviceId || !VBG.emailjs.ticketTemplateId) return;
    try {
      const { emails } = await API.get('/api/staff-emails');
      for (const to of emails) {
        emailjs.send(VBG.emailjs.serviceId, VBG.emailjs.ticketTemplateId, { to_email: to, ticket_subject: subject, ticket_id: id, priority, from_username: state.user.username }, { publicKey: VBG.emailjs.publicKey }).catch((e) => console.error('EmailJS notify', e));
      }
    } catch (e) { /* Benachrichtigung ist optional */ }
  }
  VBG.notifyNewTicket = notifyNewTicket;

  /* ------------------------------ Landing-Galerie ------------------------------ */

  async function loadGallery() {
    const wrap = $('gallery-grid');
    try {
      const { images } = await API.get('/api/images');
      const rest = images.filter((f) => f !== 'Bild1.png');
      wrap.innerHTML = rest.slice(0, 12).map((f) =>
        `<button class="gallery-item" data-viewimage="/IMGs/${encodeURIComponent(f)}"><img src="/IMGs/${encodeURIComponent(f)}" alt="Impression" loading="lazy"/></button>`
      ).join('');
    } catch (e) {
      wrap.innerHTML = '';
    }
  }

  /* ------------------------------ Bild-Modal ------------------------------ */

  function openImageView(src) {
    $('image-view').src = src;
    openModal('modal-image');
  }
  window.openImageView = openImageView;

  /* ------------------------------ Events ------------------------------ */

  function bind() {
    // Navigation + Tabs
    document.querySelectorAll('[data-tab]').forEach((el) => {
      el.addEventListener('click', () => showTab(el.dataset.tab));
    });

    // Tickets-Dropdown (Hover)
    const ddWrap = $('nav-tickets-wrap');
    const ddMenu = $('tickets-dropdown');
    function ddOpen() {
      if (ddWrap.classList.contains('hidden')) return;
      ddMenu.classList.remove('hidden');
    }
    function ddClose() { ddMenu.classList.add('hidden'); }
    ddWrap.addEventListener('mouseenter', ddOpen);
    ddWrap.addEventListener('mouseleave', ddClose);
    $('nav-tickets').addEventListener('click', (e) => { e.stopPropagation(); showTab('tickets'); });
    $('dd-tickets-dashboard').addEventListener('click', () => { ddClose(); openTickets('dashboard'); });
    $('dd-tickets-create').addEventListener('click', () => { ddClose(); openTickets('create'); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#nav-tickets-wrap')) ddClose(); });

    // Theme
    $('theme-toggle').addEventListener('click', toggleTheme);

    // Auth
    $('btn-open-auth').addEventListener('click', () => { setAuthMode('login'); openModal('modal-auth'); });
    $('auth-toggle').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'register' : 'login'));
    $('auth-form').addEventListener('submit', submitAuth);
    $('btn-discord-auth').addEventListener('click', () => { window.location = '/api/auth/discord'; });
    $('btn-logout').addEventListener('click', logout);
    $('btn-verify').addEventListener('click', verifyCode);
    $('btn-resend-code').addEventListener('click', resendCode);

    // Verifizierung per Enter
    $('verify-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });

    // Modal schließen
    document.querySelectorAll('.modal [data-close]').forEach((b) => b.addEventListener('click', () => closeAllModals()));
    document.querySelectorAll('.modal .modal-backdrop').forEach((bd) => bd.addEventListener('click', closeAllModals));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

    // Bild ansehen
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-viewimage]');
      if (t) openImageView(t.dataset.viewimage);
    });

    VBG.shifts.bind();
    VBG.tickets.bind();
    VBG.admin.bind();
  }

  function init() {
    const saved = localStorage.getItem('vbg-theme') || 'light';
    applyTheme(saved);

    if (emailJSReady() && window.emailjs) {
      emailjs.init({ publicKey: VBG.emailjs.publicKey });
    }

    const params = new URLSearchParams(location.search);
    const authErr = params.get('auth_error');
    if (authErr) { toast(authErr, 'err'); history.replaceState(null, '', location.pathname); }

    $('footer-year').textContent = new Date().getFullYear();
    $('shift-date').value = new Date().toISOString().slice(0, 10);

    bind();
    loadGallery();
    loadNotices();

    API.get('/api/me')
      .then((data) => {
        state.user = data.user;
        updateAuthUI();
        if (state.user) { VBG.shifts.load().catch(() => {}); loadNotices(); }
      })
      .catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();