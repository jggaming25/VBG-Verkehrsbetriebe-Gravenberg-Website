/* VBG – Admin-Bereich */
const AdminPage = {
  title: 'Admin',
  sub: 'users',

  subs: [
    ['users', 'Nutzer'],
    ['shifts', 'Shifts'],
    ['dienste', 'Dienste'],
    ['activity', 'Activity'],
    ['linien', 'Linien'],
    ['standorte', 'Standorte'],
    ['fahrzeuge', 'Fahrzeugplan'],
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
      if (this.sub === 'activity') return await this.activityAllView(body);
      if (this.sub === 'linien') return await this.linienView(body);
      if (this.sub === 'standorte') return await this.standorteView(body);
      if (this.sub === 'fahrzeuge') return await this.fahrzeugeView(body);
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
    const [data, linienData] = await Promise.all([API.get('/api/admin/shifts'), API.get('/api/admin/linien')]);
    const shifts = data.shifts || [];
    const linien = linienData.linien || [];
    const lineOptions = linien.filter((l) => l.active && l.short);
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Shift erstellen</h2></div>
        <form class="form-grid" id="create-shift-form">
          <label class="field"><span class="field-label">Titel</span><input class="input" id="s-title" placeholder="z. B. Werktag-Vormittag" required/></label>
          <label class="field"><span class="field-label">Datum</span><input class="input" type="date" id="s-date" required/></label>
          <label class="field"><span class="field-label">Beginn</span><input class="input" type="time" id="s-start" required/></label>
          <label class="field"><span class="field-label">Ende</span><input class="input" type="time" id="s-end"/></label>
          <label class="field"><span class="field-label">Betriebszeit von (optional)</span><input class="input" type="time" id="s-bvon" title="Eingrenzung der Fahrplan-Zeiten (sonst Beginn/Ende)"/></label>
          <label class="field"><span class="field-label">Betriebszeit bis (optional)</span><input class="input" type="time" id="s-bbis" title="Eingrenzung der Fahrplan-Zeiten (sonst Beginn/Ende)"/></label>
          <label class="field"><span class="field-label">Status</span>
            <select class="input" id="s-status"><option value="draft">Entwurf</option><option value="published">Veröffentlicht</option></select>
          </label>
          <div class="field" style="grid-column:1/-1"><span class="field-label">Details</span>
            <textarea class="input" id="s-desc" rows="3" placeholder="Beschreibung / Hinweise zum Tag"></textarea>
          </div>
          <div class="field" style="grid-column:1/-1"><span class="field-label">Linien an diesem Tag</span>
            <div class="chips">
              ${lineOptions.map((l) => `
                <label class="chip chip-toggle">
                  <input type="checkbox" value="${esc(l.short)}" data-check-line/> ${esc(l.short)}
                </label>`).join('')}
            </div>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="row-check"><input type="checkbox" id="s-auto"/> Dienste automatisch generieren (alle Fahrten besetzen)</label>
          </div>
          <div class="field" style="grid-column:1/-1"><span class="muted-sm" id="s-preview"></span></div>
          <div class="field" style="grid-column:1/-1;display:flex;gap:8px">
            <button class="btn btn-ghost" type="button" id="s-preview-btn">Dienste-Vorschau</button>
            <button class="btn btn-primary" type="submit">Shift anlegen</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Shifts</h2><span class="muted-sm">${shifts.length}</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Titel</th><th>Datum</th><th>Zeit</th><th>Linien</th><th>Status</th><th>Sign-Up</th><th></th></tr></thead>
            <tbody>
              ${shifts.map((s) => `
                <tr>
                  <td><b>${esc(s.title)}</b>${s.description ? `<div class="muted-sm">${esc(s.description).slice(0, 80)}</div>` : ''}</td>
                  <td>${esc(fmtDate(s.date))}</td>
                  <td class="num">${esc(fmtTime(s.time_start))} – ${esc(fmtTime(s.time_end))}</td>
                  <td>${(s.linien || []).length ? (s.linien || []).map((l) => `<span class="badge">${esc(l)}</span>`).join(' ') : (s.auto_dienste ? '<span class="badge badge-gray">?</span>' : '—')}</td>
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

    const checkedLines = () => Array.from(body.querySelectorAll('[data-check-line]')).filter((c) => c.checked).map((c) => c.value);

    body.querySelector('#s-preview-btn').addEventListener('click', async () => {
      const draft = {
        linien: checkedLines(),
        betrieb_von: body.querySelector('#s-bvon').value,
        betrieb_bis: body.querySelector('#s-bbis').value,
        date: body.querySelector('#s-date').value
      };
      if (!draft.date || !draft.linien.length) { body.querySelector('#s-preview').textContent = 'Bitte Datum und mindestens eine Linie wählen.'; return; }
      body.querySelector('#s-preview').textContent = 'Vorschau wird berechnet…';
      try {
        const r = await API.post('/api/preview/dienste', draft);
        body.querySelector('#s-preview').textContent = `${r.fahrten} Fahrten – ${r.dienste.length} vorgeschlagene Dienste bewertet.`;
      } catch (err) { body.querySelector('#s-preview').textContent = 'Fehler: ' + err.message; }
    });

    body.querySelector('#create-shift-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          title: body.querySelector('#s-title').value,
          description: body.querySelector('#s-desc').value,
          date: body.querySelector('#s-date').value,
          time_start: body.querySelector('#s-start').value,
          time_end: body.querySelector('#s-end').value,
          betrieb_von: body.querySelector('#s-bvon').value,
          betrieb_bis: body.querySelector('#s-bbis').value,
          status: body.querySelector('#s-status').value,
          linien: checkedLines(),
          auto_generate: body.querySelector('#s-auto').checked
        };
        const r = await API.post('/api/admin/shifts', payload);
        App.toast(r.generated ? `Shift angelegt: ${r.generated} Dienste automatisch erzeugt.` : 'Shift angelegt. Füge jetzt die Dienste hinzu.');
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
        <div class="panel-head"><h2>Dienste ${currentShift ? '· ' + esc(currentShift.title) : ''}</h2><span class="muted-sm">${filtered.length}</span>
          ${currentShift ? `<button class="btn btn-ghost btn-xs" id="gen-duties" ${currentShift.linien && currentShift.linien.length ? '' : 'disabled title="Für diese Shift sind keine Linien ausgewählt"'} title="Dienste aus dem Fahrplan neu erzeugen">Dienste generieren</button>` : ''}
        </div>
        ${filtered.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Code</th><th>Typ</th><th>Linie / Wechsel / Standort · Fahrten</th><th>Zeit</th><th>Fahrzeug</th><th>Lizenz</th><th>Besetzt</th><th></th></tr></thead>
              <tbody>
                ${filtered.sort((a, b) => (a.start || '').localeCompare(b.start || '')).map((d) => `
                  <tr data-duid="${d.id}" data-duty="${JSON.stringify({ id: d.id, code: d.code, type: d.type, linie_id: d.linie_id, wechsel_from: d.wechsel_from, wechsel_to: d.wechsel_to, standort_id: d.standort_id, fahrzeug: d.fahrzeug, start: d.start, end: d.end, license_id: d.license_id, note: d.note })}">
                    <td><b>${esc(d.code)}</b></td>
                    <td>${esc(VBG.dutyTypes[d.type] || d.type)}</td>
                    <td class="muted-sm">
                      ${d.type === 'bus' ? esc(d.linie || '–') : d.type === 'wechsel' ? esc(d.wechsel_from_name) + ' → ' + esc(d.wechsel_to_name) : esc(d.standort || '–')}
                      ${d.type === 'bus' && (d.fahrten || []).length ? `<div class="trip-list">${d.fahrten.map((f) => {
                        return `<div class="trip-mini"><span class="trip-time">${esc(fmtTime(f.start))}–${esc(fmtTime(f.end))}</span> <span class="plan-fahrt-badge" style="--lc:${f.color ? esc(f.color) : '#555'}">${esc(/^\d+$/.test(String(f.linie || '')) ? 'L' + f.linie : f.linie)}</span> ${String(f.richtung) === 'zurück' ? '←' : '→'} · ${esc(f.von)} → ${esc(f.nach)}</div>`;
                      }).join('')}</div>` : ''}
                    </td>
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

    const genBtn = body.querySelector('#gen-duties');
    if (genBtn) {
      genBtn.addEventListener('click', async () => {
        const existing = filtered.length;
        const msg = existing > 0
          ? `Es existieren bereits ${existing} Dienste. Neu generieren ersetzt sie (Zuordnungen werden mit entfernt). Fortfahren?`
          : 'Dienste automatisch aus dem Fahrplan erzeugen?';
        if (!confirm(msg)) return;
        try {
          const r = await API.post('/api/admin/shifts/' + currentShift.id + '/generate' + (existing ? '?replace=1' : ''), {});
          App.toast(r.generated + ' Dienste aus ' + r.fahrten + ' Fahrten erzeugt.');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    }
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

  /* ------------------------------ ACTIVITY (Admin) ------------------------------ */
  async activityAllView(body) {
    const data = await API.get('/api/admin/activity-all');
    const shifts = data.shifts || [];
    const allItems = data.items || [];
    const perShift = data.perShift || [];
    const totals = data.totals || {};

    const fShift = parseInt(localStorage.getItem('vbg_admin_act_shift') || '0', 10) || 0;
    const fUser = parseInt(localStorage.getItem('vbg_admin_act_user') || '0', 10) || 0;
    const items = allItems.filter((i) => (!fShift || i.shift_id === fShift) && (!fUser || i.user_id === fUser));
    const userIds = [...new Set(allItems.map((i) => i.user_id))];

    body.innerHTML = `
      <div class="stat-grid">
        <div class="stat ${totals.teil ? 'good' : ''}"><div class="stat-value">${totals.teil}</div><div class="stat-label">Teilgenommen</div></div>
        <div class="stat ${totals.fehlt ? 'bad' : ''}"><div class="stat-value">${totals.fehlt}</div><div class="stat-label">Fehlt</div></div>
        <div class="stat"><div class="stat-value">${totals.offen}</div><div class="stat-label">Noch offen</div></div>
        <div class="stat ${totals.quote >= 80 ? 'good' : ''}"><div class="stat-value">${totals.quote} %</div><div class="stat-label">Gesamt-Teilnahmequote</div></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Statistik pro Shift</h2><span class="muted-sm">${totals.gesamt || 0} bestätigte Einteilungen gesamt</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Shift</th><th>Datum</th><th>Eingeteilt</th><th>Teilgenommen</th><th>Fehlt</th><th>Offen</th><th>Quote</th></tr></thead>
            <tbody>
              ${perShift.length ? perShift.map((p) => `<tr>
                <td><b>${esc(p.title)}</b></td>
                <td class="muted-sm">${esc(fmtDate(p.date))}</td>
                <td class="num">${p.gesamt}</td>
                <td class="num good-c">${p.teil}</td>
                <td class="num bad-c">${p.fehlt}</td>
                <td class="num">${p.offen}</td>
                <td><span class="badge ${p.quote >= 80 ? 'badge-green' : p.quote > 0 ? 'badge-amber' : 'badge-gray'}">${p.quote} %</span></td>
              </tr>`).join('') : '<tr><td colspan="7" class="muted">Noch keine bestätigten Einteilungen.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Activity aller Personen</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select class="input" id="act-fshift" style="max-width:240px">
              <option value="0">Alle Shifts</option>
              ${shifts.map((s) => `<option value="${s.id}" ${fShift === s.id ? 'selected' : ''}>${esc(s.title)} · ${esc(s.date)}</option>`).join('')}
            </select>
            <select class="input" id="act-fuser" style="max-width:240px">
              <option value="0">Alle Personen</option>
              ${userIds.map((uid) => { const u = allItems.find((i) => i.user_id === uid); return `<option value="${uid}" ${fUser === uid ? 'selected' : ''}>${esc((u && (u.display_name || u.username)) || uid)}</option>`; }).join('')}
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Fahrer</th><th>Shift</th><th>Dienst</th><th>Zeit</th><th>Status</th><th>Notiz</th><th></th></tr></thead>
            <tbody>
              ${items.length ? items.map((it) => `
                <tr data-aid="${it.assignment_id}" data-duty="${it.duty_id}" data-uid="${it.user_id}">
                  <td><b>${esc(it.display_name || it.username)}</b></td>
                  <td class="muted-sm">${esc(it.shift_title)}<br/><span class="muted">${esc(fmtDate(it.shift_date))}</span></td>
                  <td><b>${esc(it.duty_code)}</b></td>
                  <td class="num muted-sm">${it.duty_start ? esc(fmtTime(it.duty_start)) + ' – ' + esc(fmtTime(it.duty_end)) : '–'}</td>
                  <td>${it.activity_result === 'teilgenommen' ? '<span class="badge badge-green">Teilgenommen</span>'
                    : it.activity_result === 'nicht_teilgenommen' ? '<span class="badge badge-red">Fehlt</span>'
                    : '<span class="badge badge-gray">Noch nicht erfasst</span>'}${it.activity_at ? `<div class="muted" style="font-size:.7rem">${esc(fmtDateTime(it.activity_at))}</div>` : ''}</td>
                  <td><input class="input" data-note="${it.assignment_id}" value="${esc(it.activity_note || '')}" placeholder="Notiz" style="min-width:120px;padding:5px 8px;font-size:.8rem"/></td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-soft btn-xs" data-result="teilgenommen">Teilgenommen</button>
                    <button class="btn btn-danger btn-xs" data-result="nicht_teilgenommen">Fehlt</button>
                  </td>
                </tr>`).join('') : '<tr><td colspan="7" class="muted">Keine Einträge für diesen Filter.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    body.querySelector('#act-fshift').addEventListener('change', (e) => {
      localStorage.setItem('vbg_admin_act_shift', String(e.target.value));
      App.reload();
    });
    body.querySelector('#act-fuser').addEventListener('change', (e) => {
      localStorage.setItem('vbg_admin_act_user', String(e.target.value));
      App.reload();
    });
    body.querySelectorAll('[data-result]').forEach((b) => {
      b.addEventListener('click', async () => {
        const tr = b.closest('tr');
        const payload = {
          assignment_id: parseInt(tr.dataset.aid, 10),
          duty_id: parseInt(tr.dataset.duty, 10),
          user_id: parseInt(tr.dataset.uid, 10),
          result: b.dataset.result,
          note: ((tr.querySelector('[data-note]') || {}).value || '').trim()
        };
        try {
          await API.post('/api/admin/activity', payload);
          App.toast(b.dataset.result === 'teilgenommen' ? 'Als teilgenommen markiert.' : 'Als fehlend markiert.');
          App.reload();
        } catch (e) { App.toast(e.message, 'error'); }
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

  /* ------------------------------ FAHRZEUGPLAN ------------------------------ */
  async fahrzeugeView(body) {
    const data = await API.get('/api/admin/fahrzeuge');
    const fahrzeuge = data.fahrzeuge || [];
    const typLabel = { solo: 'Solo', gelenk: 'Gelenk', gelenk_solo: 'Gelenk/Solo', fahrschule: 'Fahrschule' };
    const statusBadge = {
      einsatzbereit: '<span class="badge badge-green">Einsatzbereit</span>',
      nicht_einsatzbereit: '<span class="badge badge-amber">Nicht einsatzbereit</span>',
      sonderfahrzeug: '<span class="badge badge-gray">Sonderfahrzeug</span>',
      fahrschule: '<span class="badge badge-gray">Fahrschule</span>'
    };
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>Fahrzeug hinzufügen</h2></div>
        <form class="form-grid" id="fz-form">
          <label class="field"><span class="field-label">Wagennummer</span><input class="input" id="fz-wnr" placeholder="z. B. 1101" required/></label>
          <label class="field"><span class="field-label">Kennzeichen</span><input class="input" id="fz-kz" placeholder="z. B. GV-VB 1101"/></label>
          <label class="field"><span class="field-label">Typ</span>
            <select class="input" id="fz-typ"><option value="solo">Solo</option><option value="gelenk">Gelenk</option><option value="gelenk_solo">Gelenk/Solo</option><option value="fahrschule">Fahrschule</option></select>
          </label>
          <label class="field"><span class="field-label">Modell</span><input class="input" id="fz-modell" placeholder="z. B. MAN A37"/></label>
          <label class="field"><span class="field-label">Status</span>
            <select class="input" id="fz-status">
              <option value="einsatzbereit">Einsatzbereit</option>
              <option value="nicht_einsatzbereit">Nicht einsatzbereit</option>
              <option value="sonderfahrzeug">Sonderfahrzeug</option>
              <option value="fahrschule">Fahrschule</option>
            </select>
          </label>
          <label class="field"><span class="field-label">Bestand seit</span><input class="input" id="fz-seit" placeholder="01.09.2026"/></label>
          <label class="field"><span class="field-label">Bestand bis</span><input class="input" id="fz-bis" placeholder="optional"/></label>
          <label class="field" style="grid-column:1/-1"><span class="field-label">Bemerkung</span><input class="input" id="fz-rem" placeholder="optional"/></label>
          <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Fahrzeug hinzufügen</button></div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Fahrzeugplan</h2><span class="muted-sm">${fahrzeuge.length} Fahrzeuge</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nr.</th><th>Kennzeichen</th><th>Typ</th><th>Modell</th><th>Status</th><th>Bestand</th><th>Bemerkung</th><th></th></tr></thead>
            <tbody>
              ${fahrzeuge.map((f) => `
                <tr>
                  <td><b>${esc(f.wagennummer)}</b></td>
                  <td>${esc(f.kennzeichen || '–')}</td>
                  <td>${esc(typLabel[f.typ] || f.typ)}</td>
                  <td>${esc(f.modell || '–')}</td>
                  <td>${statusBadge[f.status] || '<span class="badge badge-gray">' + esc(f.status || '') + '</span>'}</td>
                  <td>${esc(f.bestand_seit || '–')}${f.bestand_bis ? ' → ' + esc(f.bestand_bis) : ''}</td>
                  <td class="muted-sm">${esc(f.bemerkung || '')}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-editfz="${f.id}">Bearbeiten</button>
                    <button class="btn btn-danger btn-xs" data-delfz="${f.id}">Löschen</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="fz-edit-slot"></div>
    `;

    const readForm = () => ({
      wagennummer: body.querySelector('#fz-wnr').value,
      kennzeichen: body.querySelector('#fz-kz').value,
      typ: body.querySelector('#fz-typ').value,
      modell: body.querySelector('#fz-modell').value,
      bestand_seit: body.querySelector('#fz-seit').value,
      bestand_bis: body.querySelector('#fz-bis').value,
      status: body.querySelector('#fz-status').value,
      bemerkung: body.querySelector('#fz-rem').value
    });

    body.querySelector('#fz-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/admin/fahrzeuge', readForm());
        App.toast('Fahrzeug hinzugefügt.');
        App.reload();
      } catch (err) { App.toast(err.message, 'error'); }
    });

    body.querySelectorAll('[data-editfz]').forEach((b) => {
      b.addEventListener('click', () => {
        const f = fahrzeuge.find((x) => x.id === parseInt(b.dataset.editfz, 10));
        const slot = body.querySelector('#fz-edit-slot');
        slot.innerHTML = `
          <div class="panel">
            <div class="panel-head"><h2>Fahrzeug bearbeiten: ${esc(f.wagennummer)}</h2><button class="icon-btn" data-close-fz>✕</button></div>
            <form class="form-grid" id="fz-edit-form">
              <label class="field"><span class="field-label">Wagennummer</span><input class="input" id="efz-wnr" value="${esc(f.wagennummer)}"/></label>
              <label class="field"><span class="field-label">Kennzeichen</span><input class="input" id="efz-kz" value="${esc(f.kennzeichen || '')}"/></label>
              <label class="field"><span class="field-label">Typ</span>
                <select class="input" id="efz-typ">
                  <option value="solo" ${f.typ === 'solo' ? 'selected' : ''}>Solo</option>
                  <option value="gelenk" ${f.typ === 'gelenk' ? 'selected' : ''}>Gelenk</option>
                  <option value="gelenk_solo" ${f.typ === 'gelenk_solo' ? 'selected' : ''}>Gelenk/Solo</option>
                  <option value="fahrschule" ${f.typ === 'fahrschule' ? 'selected' : ''}>Fahrschule</option>
                </select>
              </label>
              <label class="field"><span class="field-label">Modell</span><input class="input" id="efz-modell" value="${esc(f.modell || '')}"/></label>
              <label class="field"><span class="field-label">Status</span>
                <select class="input" id="efz-status">
                  <option value="einsatzbereit" ${f.status === 'einsatzbereit' ? 'selected' : ''}>Einsatzbereit</option>
                  <option value="nicht_einsatzbereit" ${f.status === 'nicht_einsatzbereit' ? 'selected' : ''}>Nicht einsatzbereit</option>
                  <option value="sonderfahrzeug" ${f.status === 'sonderfahrzeug' ? 'selected' : ''}>Sonderfahrzeug</option>
                  <option value="fahrschule" ${f.status === 'fahrschule' ? 'selected' : ''}>Fahrschule</option>
                </select>
              </label>
              <label class="field"><span class="field-label">Bestand seit</span><input class="input" id="efz-seit" value="${esc(f.bestand_seit || '')}"/></label>
              <label class="field"><span class="field-label">Bestand bis</span><input class="input" id="efz-bis" value="${esc(f.bestand_bis || '')}"/></label>
              <label class="field"><span class="field-label">Bemerkung</span><input class="input" id="efz-rem" value="${esc(f.bemerkung || '')}"/></label>
              <div class="field" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Speichern</button></div>
            </form>
          </div>`;
        slot.querySelector('[data-close-fz]').addEventListener('click', () => { slot.innerHTML = ''; });
        slot.querySelector('#fz-edit-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const val = (id) => slot.querySelector(id).value;
          try {
            await API.put('/api/admin/fahrzeuge/' + f.id, {
              wagennummer: val('#efz-wnr'), kennzeichen: val('#efz-kz'), typ: val('#efz-typ'),
              modell: val('#efz-modell'), bestand_seit: val('#efz-seit'), bestand_bis: val('#efz-bis'),
              status: val('#efz-status'), bemerkung: val('#efz-rem')
            });
            App.toast('Gespeichert.');
            App.reload();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    });

    body.querySelectorAll('[data-delfz]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Fahrzeug wirklich löschen?')) return;
        try {
          await API.del('/api/admin/fahrzeuge/' + b.dataset.delfz);
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