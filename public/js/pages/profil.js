/* VBG – Profilverwaltung */
const ProfilPage = {
  title: 'Profil',

  countries: [
    ['', 'Keine Angabe'], ['de', '🇩🇪 Deutschland'], ['at', '🇦🇹 Österreich'], ['ch', '🇨🇭 Schweiz'],
    ['gb', '🇬🇧 Vereinigtes Königreich'], ['us', '🇺🇸 USA'], ['fr', '🇫🇷 Frankreich'],
    ['nl', '🇳🇱 Niederlande'], ['be', '🇧🇪 Belgien'], ['pl', '🇵🇱 Polen'], ['dk', '🇩🇰 Dänemark'],
    ['se', '🇸🇪 Schweden'], ['no', '🇳🇴 Norwegen'], ['es', '🇪🇸 Spanien'], ['it', '🇮🇹 Italien'],
    ['gr', '🇬🇷 Griechenland'], ['tr', '🇹🇷 Türkei'], ['ro', '🇷🇴 Rumänien'], ['ru', '🇷🇺 Russland'],
    ['ua', '🇺🇦 Ukraine'], ['cz', '🇨🇿 Tschechien'], ['sk', '🇸🇰 Slowakei'], ['hu', '🇭🇺 Ungarn'],
    ['pt', '🇵🇹 Portugal']
  ],

  async render(container) {
    const u = App.user;
    const country = this.countries.find((c) => c[0] === u.country_code);

    container.innerHTML = `
      <div class="page-head"><h1>Profilverwaltung</h1><p>Deine persönlichen Daten und Einstellungen.</p></div>

      <div class="panel">
        <div class="panel-head"><h2>${avatarHtml(u, 'avatar-xl')}</h2></div>
        <div class="kv">
          <dt>Benutzername</dt><dd>${esc(u.username)}</dd>
          <dt>Anzeigename</dt><dd>${esc(u.display_name || u.username)}</dd>
          <dt>Rolle</dt><dd>${esc(roleLabel(u.role))}</dd>
          <dt>Eintritt</dt><dd>${esc(fmtDate(u.created_at))}</dd>
          <dt>Herkunftsland</dt><dd>${country ? country[1] : 'Keine Angabe'}</dd>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Profil</h2></div>
        <p class="panel-sub">Deinen Anzeigenamen kannst du selbst ändern. Für Shifts und den Dienstplan wird dein Benutzername verwendet.</p>
        <form id="profile-form">
          <label class="field">
            <span class="field-label">Anzeigename</span>
            <input class="input" id="pf-display" value="${esc(u.display_name || u.username)}" maxlength="40"/>
          </label>
          <div class="field">
            <span class="field-label">Profilbild</span>
            <div class="avatar-upload">
              <div id="pf-avatar-preview">${avatarHtml(u, 'avatar-xl')}</div>
              <div>
                <input class="input" type="file" id="pf-avatar" accept="image/jpeg,image/png,image/webp"/>
                <span class="field-hint">JPG, PNG oder WEBP · maximal 5 MB</span>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" type="submit">Profil speichern</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Sprache &amp; Herkunft</h2></div>
        <p class="panel-sub">Die Flagge wird an deinem Profil angezeigt.</p>
        <form id="pref-form">
          <label class="field">
            <span class="field-label">Herkunftsland</span>
            <select class="input" id="pf-country">
              ${this.countries.map((c) => `<option value="${c[0]}" ${c[0] === u.country_code ? 'selected' : ''}>${c[1]}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-primary btn-sm" type="submit">Sprache &amp; Herkunft speichern</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Darstellung</h2></div>
        <form id="theme-form">
          <div class="seg">
            <label class="seg-label"><input type="radio" name="theme" value="light" ${u.theme === 'light' ? 'checked' : ''}/><span>☀️ Heller Modus</span></label>
            <label class="seg-label"><input type="radio" name="theme" value="dark" ${u.theme === 'dark' ? 'checked' : ''}/><span>🌙 Dunkler Modus</span></label>
            <label class="seg-label"><input type="radio" name="theme" value="auto" ${u.theme === 'auto' ? 'checked' : ''}/><span>⚙️ Automatisch</span></label>
          </div>
          <button class="btn btn-ghost btn-sm mt" type="submit">Darstellung speichern</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Benachrichtigungen</h2></div>
        <p class="panel-sub">Erhalte in der App Hinweise zu neuen Einteilungen, Strafzeiten, Activity-Einträgen und deiner Anmeldung.</p>
        <form id="notify-form">
          <label class="check-line">
            <input type="checkbox" id="nf-enabled" ${u.notifications ? 'checked' : ''}/>
            <span>Benachrichtigungen empfangen</span>
          </label>
          <button class="btn btn-ghost btn-sm mt" type="submit">Speichern</button>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Passwort ändern</h2></div>
        <form id="pw-form">
          <div class="form-row">
            <label class="field"><span class="field-label">Aktuelles Passwort</span><input class="input" type="password" id="pw-current" autocomplete="current-password" required/></label>
          </div>
          <div class="form-row">
            <label class="field"><span class="field-label">Neues Passwort</span><input class="input" type="password" id="pw-new" autocomplete="new-password" minlength="6" required/></label>
            <label class="field"><span class="field-label">Wiederholen</span><input class="input" type="password" id="pw-new2" autocomplete="new-password" minlength="6" required/></label>
          </div>
          <button class="btn btn-danger" type="submit">Passwort ändern</button>
        </form>
      </div>
    `;

    const fileInput = container.querySelector('#pf-avatar');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { App.toast('Bild ist größer als 5 MB.', 'error'); return; }
      try {
        const dataUrl = await fileToDataURL(file, 512);
        if (dataUrl) container.querySelector('#pf-avatar-preview').innerHTML = `<img class="avatar avatar-xl" src="${dataUrl}" alt="" style="border-radius:20px"/>`;
      } catch (e) { App.toast(e.message, 'error'); }
    });

    container.querySelector('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const avatar = fileInput.files[0] ? await fileToDataURL(fileInput.files[0], 512) : u.avatar;
        const data = await API.post('/api/profile', { display_name: container.querySelector('#pf-display').value, avatar: avatar || '' });
        App.user = data.user;
        App.updateChips();
        App.toast('Profil gespeichert.');
      } catch (err) { App.toast(err.message, 'error'); }
    });

    container.querySelector('#pref-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await API.post('/api/profile', { display_name: App.user.display_name, country_code: container.querySelector('#pf-country').value });
        App.user = data.user;
        App.toast('Einstellungen gespeichert.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });

    container.querySelector('#theme-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const theme = container.querySelector('input[name="theme"]:checked').value;
      try {
        const data = await API.post('/api/profile', { display_name: App.user.display_name, theme });
        App.user = data.user;
        App.applyTheme();
        App.toast('Darstellung gespeichert.');
      } catch (err) { App.toast(err.message, 'error'); }
    });

    container.querySelector('#notify-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await API.post('/api/profile', {
          display_name: App.user.display_name,
          country_code: App.user.country_code || '',
          language: App.user.language || 'de',
          theme: App.user.theme || 'auto',
          notifications: container.querySelector('#nf-enabled').checked
        });
        App.user = data.user;
        App.toast('Benachrichtigungen gespeichert.');
        if (!data.user.notifications) App.renderNotifyBadge(0);
      } catch (err) { App.toast(err.message, 'error'); }
    });

    container.querySelector('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = container.querySelector('#pw-new').value;
      const b = container.querySelector('#pw-new2').value;
      if (a !== b) { App.toast('Die Passwörter stimmen nicht überein.', 'error'); return; }
      try {
        await API.post('/api/password', {
          current_password: container.querySelector('#pw-current').value,
          new_password: a,
          new_password_repeat: b
        });
        App.toast('Passwort geändert.');
        container.querySelector('#pw-current').value = '';
        container.querySelector('#pw-new').value = '';
        container.querySelector('#pw-new2').value = '';
      } catch (err) { App.toast(err.message, 'error'); }
    });
  }
};