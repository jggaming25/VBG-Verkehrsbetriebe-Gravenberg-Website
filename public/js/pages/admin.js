/* VBG – Admin-Bereich */
const AdminPage = {
  title: 'Admin',
  sub: 'users',

  subs: [
    ['users', 'Nutzer'],
    ['shifts', 'Shifts'],
    ['dienste', 'Dienste'],
    ['linien', 'Linien'],
    ['standorte', 'Standorte'],
    ['hinweise', 'Hinweise'],
    ['meldung', 'Meldung & Regeln']
  ],

  async render(container) {
    container.innerHTML = `
      <div class="page-head"><h1>Admin</h1><p>Verwaltung von Nutzern, Shifts, Diensten und Inhalten.</p></div>
      <div class="subnav">
        ${this.subs.map(([key, label]) => `<button class="chip${this.sub === key ? ' active' : ''}" data-sub="${key}">${label}</button>`).join('')}
      </div>
      <div id="admin-body"></div>
    `;
    container.querySelectorAll('[data-sub]').forEach((b) => {
      b.addEventListener('click', () => {
        this.sub = b.dataset.sub;
        this.render(container);
      });
    });
    await this.renderSub(container.querySelector('#admin-body'));
  },

  async renderSub(body) {
    try {
      if (this.sub === 'users') return await this.usersView(body);
      if (this.sub === 'shifts') return await this.shiftsView(body);
      if (this.sub === 'dienste') return await this.diensteView(body);
      if (this.sub === 'linien') return await this.linienView(body);
      if (this.sub === 'standorte') return await this.standorteView(body);
      if (this.sub === 'hinweise') return await this.newsView(body);
      if (this.sub === 'meldung') return await this.meldungView(body);
    } catch (e) {
      body.innerHTML = '<div class="empty">Fehler: ' + esc(e.message) + '</div>';
    }
  },

  /* ------------------------------ NUTZER ------------------------------ */
  async usersView(body) {
    const [usersRes, linienRes] = await Promise.all([API.get('/api/admin/users'), API.get('/api/admin/linien')]);
    const users = usersRes.users || [];
    const linien = linienRes.linien || [];

    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Nutzer erstellen</h2></div>
        <form class="form-grid" id="create-user-form">
          <label class="field"><span class="field-label">Benutzername</span><input class="input" id="u-name" placeholder="z. B. max.mustermann" required/></label>
          <label class="field"><span class="field-label">Anzeigename</span><input class="input" id="u-display" placeholder="optional"/></label>
          <label class="field"><span class="field-label">Rolle</span>
            <select class="input" id="u-role">
              <option value="busfahrer">Busfahrer</option>
              <option value="senior">Senior Busfahrer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label class="field"><span class="field-label">Einmal-Passwort <span class="field-hint">leer = automatisch</span></span><input class="input" id="u-pw" placeholder="automatisch erzeugen"/></label>
          <div class="field" style="grid-column:1/-1"><span class="field-label">Lizenzen</span>
            <div class="seg">
              ${linien.filter((l) => l.active).map((l) => `<label class="seg-label"><input type="checkbox" name="u-lic" value="${l.id}"/><span>${esc(l.name)}</span></label>`).join('')}
            </div>
          </div>
          <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Nutzer anlegen</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Nutzer</h2><span class="muted-sm">${users.length} Konten</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nutzer</th><th>Rolle</th><th>Lizenzen</th><th>Offene Strafzeit</th><th>Offene Inactivity</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${users.map((u) => `
                <tr data-uid="${u.id}">
                  <td><b>${esc(u.display_name || u.username)}</b> <span class="muted-sm">@${esc(u.username)}</span></td>
                  <td>${esc(roleLabel(u.role))}</td>
                  <td class="muted-sm">${esc(u.license_names || '–')}</td>
                  <td class="num">${u.open_hours ? u.open_hours + ' h' : '–'}</td>
                  <td class="num">${u.open_inactivity ? '<span class="badge badge-amber">' + u.open_inactivity + '</span>' : '–'}</td>
                  <td>${u.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-red">Gesperrt</span>'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-edit="${u.id}">Bearbeiten</button>
                    <button class="btn btn-ghost btn-xs" data-resetpw="${u.id}">Passwort</button>
                    <button class="btn btn-danger btn-xs" data-del="${u.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="user-edit-slot"></div>
    `;

    body.querySelector('#create-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        username: body.querySelector('#u-name').value,
        display_name: body.querySelector('#u-display').value,
        role: body.querySelector('#u-role').value,
        password: body.querySelector('#u-pw').value,
        licenses: Array.from(body.querySelectorAll('input[name="u-lic"]:checked')).map((c) => parseInt(c.value, 10))
      };
      try {
        const r = await API.post('/api/admin/users', payload);
        const pw = prompt('Konto "' + r.username + '" angelegt.\nEinmal-Passwort für den Nutzer:\n\n' + r.one_time_password + '\n\nBitte notieren und sicher übermitteln.', '');
        if (pw !== null) {
          App.toast('Konto angelegt.');
          App.reload();
        }
      } catch (err) { App.toast(err.message, 'error'); }
    });

    body.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', async () => {
        const u = users.find((x) => x.id === parseInt(b.dataset.edit, 10));
        const slot = body.querySelector('#user-edit-slot');
        slot.innerHTML = `
          <div class="panel">
            <div class="panel-head"><h2>Bearbeiten: ${esc(u.username)}</h2><button class="icon-btn" data-close-edit>✕</button></div>
            <form id="edit-user-form" class="form-grid">
              <label class="field"><span class="field-label">Anzeigename</span><input class="input" id="eu-display" value="${esc(u.display_name || u.username)}"/></label>
              <label class="field"><span class="field-label">Rolle</span>
                <select class="input" id="eu-role">
                  <option value="busfahrer" ${u.role === 'busfahrer' ? 'selected' : ''}>Busfahrer</option>
                  <option value="senior" ${u.role === 'senior' ? 'selected' : ''}>Senior Busfahrer</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </label>
              <div class="field" style="grid-column:1/-1"><span class="field-label">Lizenzen</span>
                <div class="seg">
                  ${linien.filter((l) => l.active).map((l) => `<label class="seg-label"><input type="checkbox" name="eu-lic" value="${l.id}" ${(u.licenses || []).includes(l.id) ? 'checked' : ''}/><span>${esc(l.name)}</span></label>`).join('')}
                </div>
              </div>
              <div class="field" style="grid-column:1/-1">
                <label class="check-line"><input type="checkbox" id="eu-active" ${u.active ? 'checked' : ''}/><span>Konto aktiv</span></label>
              </div>
              <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Speichern</button></div>
            </form>
          </div>`;
        slot.querySelector('[data-close-edit]').addEventListener('click', () => { slot.innerHTML = ''; });
        slot.querySelector('#edit-user-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await API.put('/api/admin/users/' + u.id, {
              display_name: slot.querySelector('#eu-display').value,
              role: slot.querySelector('#eu-role').value,
              active: slot.querySelector('#eu-active').checked,
              licenses: Array.from(slot.querySelectorAll('input[name="eu-lic"]:checked')).map((c) => parseInt(c.value, 10))
            });
            App.toast('Gespeichert.');
            App.reload();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    });

    body.querySelectorAll('[data-resetpw]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Passwort zurücksetzen? Der Nutzer muss beim nächsten Login ein neues festlegen.')) return;
        try {
          const r = await API.post('/api/admin/users/' + b.dataset.resetpw + '/reset-password', {});
          prompt('Neues Einmal-Passwort:', r.one_time_password || '');
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Nutzer wirklich löschen? Alle Daten des Nutzers werden entfernt.')) return;
        try {
          await API.del('/api/admin/users/' + b.dataset.del);
          App.toast('Gelöscht.');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ SHIFTS ------------------------------ */
  async shiftsView(body) {
    const data = await API.get('/api/admin/shifts');
    const shifts = data.shifts || [];
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Shift erstellen</h2></div>
        <form class="form-grid" id="create-shift-form">
          <label class="field"><span class="field-label">Titel</span><input class="input" id="s-title" placeholder="z. B. Werktag-Vormittag" required/></label>
          <label class="field"><span class="field-label">Datum</span><input class="input" type="date" id="s-date" required/></label>
          <label class="field"><span class="field-label">Beginn</span><input class="input" type="time" id="s-start" required/></label>
          <label class="field"><span class="field-label">Ende</span><input class="input" type="time" id="s-end"/></label>
          <label class="field"><span class="field-label">Status</span>
            <select class="input" id="s-status"><option value="draft">Entwurf</option><option value="published">Veröffentlicht</option></select>
          </label>
          <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Shift anlegen</button></div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Shifts</h2><span class="muted-sm">${shifts.length}</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Titel</th><th>Datum</th><th>Zeit</th><th>Status</th><th>Sign-Up</th><th></th></tr></thead>
            <tbody>
              ${shifts.map((s) => `
                <tr>
                  <td><b>${esc(s.title)}</b></td>
                  <td>${esc(fmtDate(s.date))}</td>
                  <td class="num">${esc(fmtTime(s.time_start))} – ${esc(fmtTime(s.time_end))}</td>
                  <td>${s.status === 'published' ? '<span class="badge badge-green">Veröffentlicht</span>' : '<span class="badge badge-gray">Entwurf</span>'}</td>
                  <td>${s.signup_state === 'offen' ? '<span class="badge badge-green">offen</span>' : s.signup_state === 'geschlossen' ? '<span class="badge badge-amber">geschlossen</span>' : s.signup_state === 'vorbei' ? '<span class="badge badge-gray">vorbei</span>' : '—'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-toggle="${s.id}">${s.status === 'published' ? 'Entwurf' : 'Veröffentlichen'}</button>
                    <button class="btn btn-ghost btn-xs" data-copy="${s.id}" title="Shift samt Diensten duplizieren">Duplizieren</button>
                    <button class="btn btn-danger btn-xs" data-del="${s.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    body.querySelector('#create-shift-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/shifts', {
          title: body.querySelector('#s-title').value,
          date: body.querySelector('#s-date').value,
          time_start: body.querySelector('#s-start').value,
          time_end: body.querySelector('#s-end').value,
          status: body.querySelector('#s-status').value
        });
        App.toast('Shift angelegt. Füge jetzt die Dienste hinzu.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });

    body.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', async () => {
        const s = shifts.find((x) => x.id === parseInt(b.dataset.toggle, 10));
        try {
          await API.put('/api/admin/shifts/' + s.id, {
            title: s.title, description: s.description, date: s.date, time_start: s.time_start, time_end: s.time_end,
            host_id: s.host_id, status: s.status === 'published' ? 'draft' : 'published'
          });
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await API.post('/api/admin/shifts/' + b.dataset.copy + '/duplicate');
          App.toast('Duplikat erstellt.');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Shift wirklich löschen? Alle Dienste und Anmeldungen werden entfernt.')) return;
        try {
          await API.del('/api/admin/shifts/' + b.dataset.del);
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ DIENSTE ------------------------------ */
  async diensteView(body) {
    const data = await API.get('/api/admin/dutys');
    const shifts = data.shifts || [];
    const linien = data.linien || [];
    const standorte = data.standorte || [];
    const usage = {};
    for (const a of data.assignments || []) usage[a.duty_id] = true;
    const persistedShift = parseInt(localStorage.getItem('vbg_admin_shift') || '0', 10);
    const currentShift = shifts.find((s) => s.id === persistedShift) || shifts[0];
    const filtered = currentShift ? (data.duties || []).filter((d) => d.shift_id === currentShift.id) : [];

    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Shift wählen</h2></div>
        <div class="seg mb">
          ${shifts.map((s) => `
            <label class="seg-label" data-shift="${s.id}">
              <input type="radio" name="ad-shift" value="${s.id}" ${currentShift && s.id === currentShift.id ? 'checked' : ''}/>
              <span>${esc(s.title)} · ${esc(fmtDate(s.date))}</span>
            </label>`).join('')}
        </div>
        <form class="form-grid" id="create-duty-form">
          <label class="field"><span class="field-label">Code</span><input class="input" id="d-code" placeholder="z. B. B19-1"/></label>
          <label class="field"><span class="field-label">Typ</span>
            <select class="input" id="d-type">
              <option value="bus">Busdienst</option>
              <option value="wechsel">Linienwechsel</option>
              <option value="strafe">Kundenservice Strafe</option>
            </select>
          </label>
          <div class="field busf"><span class="field-label">Linie</span>
            <select class="input" id="d-linie"><option value="">–</option>${linien.filter((l) => l.active).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </div>
          <div class="field busf" style="display:none"><span class="field-label">Fahrzeug</span><input class="input" id="d-fahrzeug" placeholder="z. B. BUS 001"/></div>
          <div class="field wechself" style="display:none"><span class="field-label">Von Linie</span>
            <select class="input" id="d-wfrom"><option value="">–</option>${linien.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </div>
          <div class="field wechself" style="display:none"><span class="field-label">Zu Linie</span>
            <select class="input" id="d-wto"><option value="">–</option>${linien.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </div>
          <div class="field strafef" style="display:none"><span class="field-label">Standort</span>
            <select class="input" id="d-standort"><option value="">–</option>${standorte.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          </div>
          <label class="field"><span class="field-label">Beginn</span><input class="input" type="datetime-local" id="d-start"/></label>
          <label class="field"><span class="field-label">Ende</span><input class="input" type="datetime-local" id="d-end"/></label>
          <label class="field"><span class="field-label">Erforderliche Lizenz</span>
            <select class="input" id="d-license"><option value="">Keine</option>${linien.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </label>
          <label class="field" style="grid-column:1/-1"><span class="field-label">Notiz</span><input class="input" id="d-note"/></label>
          <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Dienst anlegen</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Dienste ${currentShift ? '· ' + esc(currentShift.title) : ''}</h2><span class="muted-sm">${filtered.length}</span></div>
        ${filtered.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Code</th><th>Typ</th><th>Linie / Wechsel / Standort</th><th>Zeit</th><th>Fahrzeug</th><th>Lizenz</th><th>Besetzt</th><th></th></tr></thead>
              <tbody>
                ${filtered.sort((a, b) => (a.start || '').localeCompare(b.start || '')).map((d) => `
                  <tr data-duid="${d.id}" data-duty="${JSON.stringify({ id: d.id, code: d.code, type: d.type, linie_id: d.linie_id, wechsel_from: d.wechsel_from, wechsel_to: d.wechsel_to, standort_id: d.standort_id, fahrzeug: d.fahrzeug, start: d.start, end: d.end, license_id: d.license_id, note: d.note })}">
                    <td><b>${esc(d.code)}</b></td>
                    <td>${esc(VBG.dutyTypes[d.type] || d.type)}</td>
                    <td class="muted-sm">${d.type === 'bus' ? esc(d.linie || '–') : d.type === 'wechsel' ? esc(d.wechsel_from_name) + ' → ' + esc(d.wechsel_to_name) : esc(d.standort || '–')}</td>
                    <td class="num">${d.start ? esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) : '–'}</td>
                    <td>${esc(d.fahrzeug || '–')}</td>
                    <td>${esc(d.license || '–')}</td>
                    <td>${usage[d.id] ? '<span class="badge badge-green">Ja</span>' : '<span class="badge badge-gray">Nein</span>'}</td>
                    <td style="white-space:nowrap">
                      <button class="btn btn-ghost btn-xs" data-editdut="${d.id}">Bearbeiten</button>
                      <button class="btn btn-danger btn-xs" data-deldut="${d.id}">Löschen</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Keine Dienste in diesem Shift. Lege oben Dienste an, damit der Tag abgedeckt ist.</div>'}
      </div>
      <div id="duty-edit-slot"></div>
    `;

    const typeSel = body.querySelector('#d-type');
    const toggleTypeFields = () => {
      const t = typeSel.value;
      body.querySelectorAll('.busf, .wechself, .strafef').forEach((el) => { el.style.display = 'none'; });
      if (t === 'bus') body.querySelectorAll('.busf').forEach((el) => { el.style.display = ''; });
      if (t === 'wechsel') body.querySelectorAll('.wechself').forEach((el) => { el.style.display = ''; });
      if (t === 'strafe') body.querySelectorAll('.strafef').forEach((el) => { el.style.display = ''; });
    };
    typeSel.addEventListener('change', toggleTypeFields);

    body.querySelectorAll('.seg-label input[name="ad-shift"]').forEach((r) => {
      r.addEventListener('change', () => {
        localStorage.setItem('vbg_admin_shift', String(r.value));
        App.reload();
      });
    });

    body.querySelector('#create-duty-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = typeSel.value;
      const payload = {
        shift_id: currentShift.id,
        code: body.querySelector('#d-code').value || (t === 'bus' ? 'B' + Date.now() : t === 'wechsel' ? 'W' + Date.now() : 'KS' + Date.now()),
        type: t,
        linie_id: body.querySelector('#d-linie').value || null,
        wechsel_from: body.querySelector('#d-wfrom').value || null,
        wechsel_to: body.querySelector('#d-wto').value || null,
        standort_id: body.querySelector('#d-standort').value || null,
        fahrzeug: body.querySelector('#d-fahrzeug').value,
        start: body.querySelector('#d-start').value,
        end: body.querySelector('#d-end').value,
        license_id: body.querySelector('#d-license').value || null,
        note: body.querySelector('#d-note').value
      };
      try {
        await API.post('/api/admin/dutys', payload);
        App.toast('Dienst angelegt.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });

    const fillEdit = (d, containerEl) => {
      const t = d.type;
      containerEl.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h2>Dienst bearbeiten: ${esc(d.code)}</h2><button class="icon-btn" data-close-edit>✕</button></div>
          <form class="form-grid" id="edit-duty-form">
            <label class="field"><span class="field-label">Code</span><input class="input" id="ed-code" value="${esc(d.code)}"/></label>
            <label class="field"><span class="field-label">Typ</span>
              <select class="input" id="ed-type">
                <option value="bus" ${t === 'bus' ? 'selected' : ''}>Busdienst</option>
                <option value="wechsel" ${t === 'wechsel' ? 'selected' : ''}>Linienwechsel</option>
                <option value="strafe" ${t === 'strafe' ? 'selected' : ''}>Kundenservice Strafe</option>
              </select>
            </label>
            <label class="field"><span class="field-label">Linie</span><select class="input" id="ed-linie"><option value="">–</option>${linien.map((l) => `<option value="${l.id}" ${l.id === d.linie_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Fahrzeug</span><input class="input" id="ed-fahrzeug" value="${esc(d.fahrzeug || '')}"/></label>
            <label class="field"><span class="field-label">Wechsel von</span><select class="input" id="ed-wfrom"><option value="">–</option>${linien.map((l) => `<option value="${l.id}" ${l.id === d.wechsel_from ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Wechsel zu</span><select class="input" id="ed-wto"><option value="">–</option>${linien.map((l) => `<option value="${l.id}" ${l.id === d.wechsel_to ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Standort</span><select class="input" id="ed-standort"><option value="">–</option>${standorte.map((s) => `<option value="${s.id}" ${s.id === d.standort_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Beginn</span><input class="input" type="datetime-local" id="ed-start" value="${esc(d.start || '')}"/></label>
            <label class="field"><span class="field-label">Ende</span><input class="input" type="datetime-local" id="ed-end" value="${esc(d.end || '')}"/></label>
            <label class="field"><span class="field-label">Lizenz</span><select class="input" id="ed-license"><option value="">Keine</option>${linien.map((l) => `<option value="${l.id}" ${l.id === d.license_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
            <label class="field" style="grid-column:1/-1"><span class="field-label">Notiz</span><input class="input" id="ed-note" value="${esc(d.note || '')}"/></label>
            <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Speichern</button></div>
          </form>
        </div>`;
      containerEl.querySelector('[data-close-edit]').addEventListener('click', () => { containerEl.innerHTML = ''; });
      containerEl.querySelector('#edit-duty-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (sel) => sel.value || null;
        const payload = {
          shift_id: d.shift_id,
          code: containerEl.querySelector('#ed-code').value,
          type: containerEl.querySelector('#ed-type').value,
          linie_id: val(containerEl.querySelector('#ed-linie')),
          wechsel_from: val(containerEl.querySelector('#ed-wfrom')),
          wechsel_to: val(containerEl.querySelector('#ed-wto')),
          standort_id: val(containerEl.querySelector('#ed-standort')),
          fahrzeug: containerEl.querySelector('#ed-fahrzeug').value,
          start: containerEl.querySelector('#ed-start').value,
          end: containerEl.querySelector('#ed-end').value,
          license_id: val(containerEl.querySelector('#ed-license')),
          note: containerEl.querySelector('#ed-note').value
        };
        try {
          await API.put('/api/admin/dutys/' + d.id, payload);
          App.toast('Gespeichert.');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    };

    body.querySelectorAll('[data-editdut]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = body.querySelector(`tr[data-duid="${b.dataset.editdut}"]`);
        const d = JSON.parse(row.dataset.duty);
        d.shift_id = currentShift.id;
        fillEdit(d, body.querySelector('#duty-edit-slot'));
      });
    });

    body.querySelectorAll('[data-deldut]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Dienst wirklich löschen?')) return;
        try {
          await API.del('/api/admin/dutys/' + b.dataset.deldut);
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ LINIEN ------------------------------ */
  async linienView(body) {
    const data = await API.get('/api/admin/linien');
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Linie / Lizenz hinzufügen</h2></div>
        <form class="form-row" id="linie-form">
          <label class="field"><span class="field-label">Name</span><input class="input" id="l-name" placeholder="z. B. Linie 19" required/></label>
          <label class="field"><span class="field-label">Kürzel</span><input class="input" id="l-short" placeholder="z. B. 19"/></label>
          <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" type="submit">Hinzufügen</button></div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Lizenzen / Linien</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Kürzel</th><th>Aktiv</th><th></th></tr></thead>
            <tbody>
              ${(data.linien || []).map((l) => `
                <tr>
                  <td><b>${esc(l.name)}</b></td>
                  <td>${esc(l.short || '–')}</td>
                  <td>${l.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Inaktiv</span>'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-toggle-linie="${l.id}">${l.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn btn-danger btn-xs" data-del-linie="${l.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    body.querySelector('#linie-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/linien', { name: body.querySelector('#l-name').value, short: body.querySelector('#l-short').value });
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });
    body.querySelectorAll('[data-toggle-linie]').forEach((b) => {
      b.addEventListener('click', async () => {
        const l = (data.linien || []).find((x) => x.id === parseInt(b.dataset.toggleLinie, 10));
        try {
          await API.put('/api/admin/linien/' + l.id, { name: l.name, short: l.short, active: l.active ? 0 : 1 });
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
    body.querySelectorAll('[data-del-linie]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Linie wirklich löschen?')) return;
        try {
          await API.del('/api/admin/linien/' + b.dataset.delLinie);
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ STANDORTE ------------------------------ */
  async standorteView(body) {
    const data = await API.get('/api/admin/standorte');
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Standort hinzufügen</h2></div>
        <form class="form-row" id="standort-form">
          <label class="field"><span class="field-label">Name</span><input class="input" id="st-name" placeholder="z. B. Gravenberg ZOB" required/></label>
          <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" type="submit">Hinzufügen</button></div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Standorte</h2><span class="muted-sm">für den Kundenservice Strafe</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Aktiv</th><th></th></tr></thead>
            <tbody>
              ${(data.standorte || []).map((s) => `
                <tr>
                  <td><b>${esc(s.name)}</b></td>
                  <td>${s.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Inaktiv</span>'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-toggle-st="${s.id}">${s.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn btn-danger btn-xs" data-del-st="${s.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    body.querySelector('#standort-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/standorte', { name: body.querySelector('#st-name').value });
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });
    body.querySelectorAll('[data-toggle-st]').forEach((b) => {
      b.addEventListener('click', async () => {
        const s = (data.standorte || []).find((x) => x.id === parseInt(b.dataset.toggleSt, 10));
        try {
          await API.put('/api/admin/standorte/' + s.id, { name: s.name, active: s.active ? 0 : 1 });
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
    body.querySelectorAll('[data-del-st]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Standort wirklich löschen?')) return;
        try {
          await API.del('/api/admin/standorte/' + b.dataset.delSt);
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ HINWEISE (NEWS) ------------------------------ */
  async newsView(body) {
    const data = await API.get('/api/admin/news');
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Hinweis erstellen</h2></div>
        <form id="news-form">
          <label class="field"><span class="field-label">Titel</span><input class="input" id="n-title" required/></label>
          <label class="field"><span class="field-label">Text</span><textarea class="input" id="n-body" required></textarea></label>
          <label class="check-line"><input type="checkbox" id="n-pinned"/><span>Anpinnen</span></label>
          <label class="check-line"><input type="checkbox" id="n-active" checked/><span>Aktiv (auf der Startseite sichtbar)</span></label>
          <button class="btn btn-primary" type="submit">Veröffentlichen</button>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Hinweise</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Titel</th><th>Erstellt</th><th>Autor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${(data.news || []).map((n) => `
                <tr>
                  <td><b>${esc(n.title)}</b>${n.pinned ? ' <span class="badge badge-green">Pin</span>' : ''}</td>
                  <td class="muted-sm">${esc(fmtDate(n.created_at))}</td>
                  <td class="muted-sm">${esc(n.author || '')}</td>
                  <td>${n.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Inaktiv</span>'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-editnews="${n.id}">Bearbeiten</button>
                    <button class="btn btn-danger btn-xs" data-delnews="${n.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="news-edit-slot"></div>
    `;

    body.querySelector('#news-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/news', {
          title: body.querySelector('#n-title').value,
          body: body.querySelector('#n-body').value,
          pinned: body.querySelector('#n-pinned').checked,
          active: body.querySelector('#n-active').checked
        });
        App.toast('Hinweis veröffentlicht.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });

    body.querySelectorAll('[data-editnews]').forEach((b) => {
      b.addEventListener('click', () => {
        const n = (data.news || []).find((x) => x.id === parseInt(b.dataset.editnews, 10));
        const slot = body.querySelector('#news-edit-slot');
        slot.innerHTML = `
          <div class="panel">
            <div class="panel-head"><h2>Hinweis bearbeiten</h2><button class="icon-btn" data-close-edit>✕</button></div>
            <form id="edit-news-form">
              <label class="field"><span class="field-label">Titel</span><input class="input" id="en-title" value="${esc(n.title)}"/></label>
              <label class="field"><span class="field-label">Text</span><textarea class="input" id="en-body">${esc(n.body)}</textarea></label>
              <label class="check-line"><input type="checkbox" id="en-pinned" ${n.pinned ? 'checked' : ''}/><span>Anpinnen</span></label>
              <label class="check-line"><input type="checkbox" id="en-active" ${n.active ? 'checked' : ''}/><span>Aktiv</span></label>
              <button class="btn btn-primary" type="submit">Speichern</button>
            </form>
          </div>`;
        slot.querySelector('[data-close-edit]').addEventListener('click', () => { slot.innerHTML = ''; });
        slot.querySelector('#edit-news-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await API.put('/api/admin/news/' + n.id, {
              title: slot.querySelector('#en-title').value,
              body: slot.querySelector('#en-body').value,
              pinned: slot.querySelector('#en-pinned').checked,
              active: slot.querySelector('#en-active').checked
            });
            App.toast('Gespeichert.');
            App.reload();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    });

    body.querySelectorAll('[data-delnews]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Hinweis löschen?')) return;
        try {
          await API.del('/api/admin/news/' + b.dataset.delnews);
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });
  },

  /* ------------------------------ MELDUNG & REGELN ------------------------------ */
  async meldungView(body) {
    const data = await API.get('/api/admin/settings');
    const s = data.settings || {};
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Meldung (Banner)</h2></div>
        <p class="panel-sub">Wird als gelbes Banner oben auf der Seite angezeigt (z. B. für Wartungsarbeiten).</p>
        <form id="meldung-form">
          <label class="field"><span class="field-label">Meldungstext</span><textarea class="input" id="meld-text">${esc(s.meldung_text || '')}</textarea></label>
          <label class="check-line"><input type="checkbox" id="meld-active" ${s.meldung_active ? 'checked' : ''}/><span>Meldung anzeigen</span></label>
          <button class="btn btn-primary" type="submit">Meldung speichern</button>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Regeln</h2></div>
        <form class="form-grid" id="rules-form">
          <label class="field"><span class="field-label">Sign-Up schließt (Minuten vor Shiftbeginn)</span><input class="input" type="number" id="r-close" min="1" value="${esc(s.signup_close_minutes)}"/></label>
          <label class="field"><span class="field-label">Dienstbeginn (Minuten vor Shiftstart)</span><input class="input" type="number" id="r-start" min="0" value="${esc(s.staff_start_minutes)}"/></label>
          <label class="field"><span class="field-label">Max. Duty-Wünsche bei der Anmeldung</span><input class="input" type="number" id="r-wishes" min="1" max="10" value="${esc(s.max_duty_wishes)}"/></label>
          <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost" type="submit">Speichern</button></div>
        </form>
      </div>
    `;
    body.querySelector('#meldung-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/meldung', {
          text: body.querySelector('#meld-text').value,
          active: body.querySelector('#meld-active').checked
        });
        App.toast('Meldung gespeichert.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });
    body.querySelector('#rules-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/settings', {
          signup_close_minutes: parseInt(body.querySelector('#r-close').value, 10),
          staff_start_minutes: parseInt(body.querySelector('#r-start').value, 10),
          max_duty_wishes: parseInt(body.querySelector('#r-wishes').value, 10)
        });
        App.toast('Regeln gespeichert.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });
  }
};