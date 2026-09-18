/* VBG Verwalter – App-Shell: Session, Routing, Theme, Login */
(function () {
  const PAGES = {
    start: StartPage,
    anmeldung: AnmeldungPage,
    dienstplan: DienstplanPage,
    meinedienste: MeineDienstePage,
    activity: ActivityPage,
    inactivity: InactivityPage,
    strafe: StrafePage,
    profil: ProfilPage,
    admin: AdminPage
  };

  const App = {
    user: null,
    settings: { meldung_active: false, meldung_text: '' },
    checkAuth: null,
    notifyTimer: null,
    notifySeen: null,

    init() {
      this.bindShell();
      this.loadSession();
    },

    bindShell() {
      document.getElementById('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.doLogin(); });
      document.getElementById('pw-form').addEventListener('submit', (e) => { e.preventDefault(); this.setFirstPassword(); });
      document.getElementById('pw-logout').addEventListener('click', () => this.doLogout());

      document.getElementById('theme-toggle').addEventListener('click', () => {
        const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = cur;
        localStorage.setItem('vbg_theme', cur);
        if (App.user && App.user.theme === 'auto') {
          API.post('/api/profile', { display_name: App.user.display_name, theme: 'auto' }).catch(() => {});
        }
      });

      document.getElementById('user-chip').addEventListener('click', () => { location.hash = '#/profil'; });
      document.getElementById('btn-logout-side').addEventListener('click', () => this.doLogout());
      document.getElementById('sidebar-open').addEventListener('click', () => this.openSidebar(true));
      document.getElementById('sidebar-close').addEventListener('click', () => this.openSidebar(false));
      document.getElementById('sidebar-overlay').addEventListener('click', () => this.openSidebar(false));

      document.getElementById('notify-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNotifications();
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.notify-btn-wrap')) this.closeNotifications();
      });

      document.getElementById('image-view-close').addEventListener('click', () => this.closeImage());
      document.getElementById('image-view').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeImage(); });

      window.addEventListener('hashchange', () => this.route());
      window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled rejection:', e.reason);
        const m = (e.reason && e.reason.message) || 'Ein unerwarteter Fehler ist aufgetreten. Bitte neu laden.';
        try { App.toast(m, 'error'); } catch (_) { /* Shell noch nicht bereit */ }
      });
    },

    openSidebar(open) {
      document.getElementById('sidebar').classList.toggle('open', open);
      document.getElementById('sidebar-overlay').classList.toggle('show', open);
    },

    async loadSession() {
      try {
        const data = await API.get('/api/session');
        API.csrf = data.csrf;
        this.applySettings(data.settings);
        if (data.user) {
          this.user = data.user;
          this.applyTheme();
          if (data.user.must_change_password) {
            this.showPwScreen();
          } else {
            this.showApp();
          }
        } else {
          this.showLogin();
        }
      } catch (e) {
        this.showLogin();
      }
    },

    applySettings(s) {
      if (!s) return;
      this.settings = { ...this.settings, ...s };
      const bar = document.getElementById('notices-bar');
      if (s.meldung_active && s.meldung_text) {
        bar.textContent = s.meldung_text;
        bar.classList.remove('hidden');
      } else {
        bar.classList.add('hidden');
      }
    },

    applyTheme() {
      const stored = localStorage.getItem('vbg_theme');
      const prefs = window.matchMedia ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : 'light';
      const theme = stored || (this.user.theme === 'auto' ? prefs : this.user.theme) || 'light';
      document.documentElement.dataset.theme = theme;
    },

    showLogin() {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('pw-screen').classList.add('hidden');
      document.getElementById('app').classList.add('hidden');
    },

    showPwScreen() {
      document.getElementById('pw-screen').classList.remove('hidden');
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app').classList.add('hidden');
    },

    showApp() {
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('pw-screen').classList.add('hidden');
      this.buildNav();
      this.updateChips();
      this.route();
      this.startNotifyPolling();
    },

    async doLogin() {
      const errorEl = document.getElementById('login-error');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      errorEl.classList.add('hidden');
      const btn = document.querySelector('#login-form .btn');
      btn.disabled = true;
      try {
        const data = await API.post('/api/auth/login', { username, password });
        API.csrf = data.csrf;
        this.applySettings(data.settings);
        this.user = data.user;
        this.applyTheme();
        document.getElementById('login-password').value = '';
        if (data.user.must_change_password) {
          this.showPwScreen();
        } else {
          this.showApp();
        }
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    },

    async setFirstPassword() {
      const errorEl = document.getElementById('pw-error');
      const nw = document.getElementById('pw-new').value;
      const rp = document.getElementById('pw-new-repeat').value;
      errorEl.classList.add('hidden');
      if (nw !== rp) {
        errorEl.textContent = 'Die Passwörter stimmen nicht überein.';
        errorEl.classList.remove('hidden');
        return;
      }
      const btn = document.querySelector('#pw-form .btn');
      btn.disabled = true;
      try {
        await API.post('/api/password/first', { new_password: nw, new_password_repeat: rp });
        this.user.must_change_password = false;
        this.showApp();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    },

    async doLogout() {
      try { await API.post('/api/auth/logout'); } catch (e) { /* egal */ }
      document.cookie = 'vbg_sid=; Path=/; Max-Age=0';
      this.stopNotifyPolling();
      this.notifySeen = null;
      this.closeNotifications();
      this.renderNotifyBadge(0);
      this.user = null;
      this.showLogin();
    },

    startNotifyPolling() {
      if (this.notifyTimer) clearInterval(this.notifyTimer);
      this.pollNotifications();
      this.notifyTimer = setInterval(() => this.pollNotifications(), 60000);
    },

    stopNotifyPolling() {
      if (this.notifyTimer) { clearInterval(this.notifyTimer); this.notifyTimer = null; }
    },

    async pollNotifications() {
      if (!this.user || !this.user.notifications) return;
      try {
        const data = await API.get('/api/notifications');
        const unseen = data.unseen || 0;
        if (this.notifySeen !== null && unseen > this.notifySeen) {
          this.toast(`Du hast ${unseen - this.notifySeen} neue Benachrichtigung(en).`, 'info');
        }
        this.notifySeen = unseen;
        this.renderNotifyBadge(unseen);
      } catch (e) { /* Polling darf nie stören */ }
    },

    renderNotifyBadge(n) {
      const b = document.getElementById('notify-badge');
      if (!b) return;
      b.textContent = n > 99 ? '99+' : String(n);
      b.classList.toggle('hidden', n <= 0);
    },

    async toggleNotifications() {
      const panel = document.getElementById('notify-panel');
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { this.closeNotifications(); return; }
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="empty" style="padding:18px">Lädt …</div>';
      try {
        const data = await API.get('/api/notifications');
        const items = data.notifications || [];
        panel.innerHTML = `
          <div class="notify-panel-head"><b>Benachrichtigungen</b>
            ${items.length ? `<button class="btn btn-ghost btn-xs" id="notify-readall">Alle als gelesen</button>` : ''}
          </div>
          ${items.length ? items.map((n) => `
            <div class="notify-item${n.seen ? '' : ' unseen'}">
              <div class="n-title">${esc(n.title)} <span class="n-typ">${esc(n.type || '')}</span></div>
              ${n.body ? `<div class="n-body">${esc(n.body)}</div>` : ''}
              <div class="n-time">${esc(fmtDateTime(n.created_at))}</div>
            </div>`).join('') : '<div class="empty" style="padding:18px">Keine Benachrichtigungen.</div>'}
        `;
        const readBtn = panel.querySelector('#notify-readall');
        if (readBtn) {
          readBtn.addEventListener('click', async () => {
            try {
              await API.post('/api/notifications/read', {});
              this.notifySeen = 0;
              this.renderNotifyBadge(0);
              panel.innerHTML = '<div class="empty" style="padding:18px">Alle als gelesen markiert.</div>';
            } catch (e) { this.toast(e.message, 'error'); }
          });
        }
      } catch (e) {
        panel.innerHTML = '<div class="empty" style="padding:18px">Fehler: ' + esc(e.message) + '</div>';
      }
    },

    closeNotifications() {
      const panel = document.getElementById('notify-panel');
      if (panel) panel.classList.add('hidden');
    },

    buildNav() {
      const nav = document.getElementById('sidebar-nav');
      const items = VBG.nav.filter((n) => !n.adminOnly || (this.user && this.user.role === 'admin'));
      nav.innerHTML = items.map((n) => `
        <button class="sidebar-link" data-route="${n.route}">
          ${n.icon}<span>${esc(n.label)}</span>
        </button>`).join('');
      nav.querySelectorAll('.sidebar-link').forEach((b) => {
        b.addEventListener('click', () => {
          location.hash = '#/' + b.dataset.route;
          this.openSidebar(false);
        });
      });
    },

    updateChips() {
      const u = this.user;
      const name = u.display_name || u.username;
      document.getElementById('user-name').textContent = name;
      document.getElementById('user-role').textContent = roleLabel(u.role);
      document.getElementById('user-avatar').innerHTML = u.avatar
        ? `<img src="${esc(u.avatar)}" alt=""/>`
        : esc(name.trim().charAt(0).toUpperCase() || '?');
      document.getElementById('sidebar-user').innerHTML = `
        ${avatarHtml(u)}
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">${esc(name)}</span>
          <span class="sidebar-user-role">${esc(roleLabel(u.role))}</span>
        </div>`;
    },

    route() {
      if (!this.user) return;
      const hash = location.hash.replace(/^#\/?/, '');
      const routeName = hash.split('?')[0] || 'start';
      const Page = PAGES[routeName];
      const container = document.getElementById('page');
      document.getElementById('topbar-title').textContent = Page ? Page.title : 'Start';
      const target = Page || StartPage;
      document.querySelectorAll('.sidebar-link').forEach((b) => {
        b.classList.toggle('active', b.dataset.route === routeName);
      });
      container.innerHTML = '<div class="empty">Lädt …</div>';
      Promise.resolve(target.render(container, this))
        .catch((e) => {
          container.innerHTML = '<div class="empty">Fehler beim Laden: ' + esc(e.message || 'Unbekannt') + '</div>';
        });
    },

    reload() {
      this.route();
    },

    toast(msg, type) {
      const wrap = document.getElementById('toast-wrap');
      const el = document.createElement('div');
      el.className = 'toast' + (type === 'error' ? ' error' : '');
      el.textContent = msg;
      wrap.appendChild(el);
      setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 260);
      }, 4200);
    },

    openImage(src) {
      document.getElementById('image-view-img').src = src;
      document.getElementById('image-view').classList.remove('hidden');
    },
    closeImage() {
      document.getElementById('image-view').classList.add('hidden');
      document.getElementById('image-view-img').src = '';
    }
  };

  window.App = App;

  App.checkAuth = function () {
    return !!App.user;
  };

  document.addEventListener('DOMContentLoaded', () => App.init());
})();