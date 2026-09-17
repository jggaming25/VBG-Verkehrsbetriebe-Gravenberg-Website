/* VBG – Kundenservice Strafe */
const StrafePage = {
  title: 'Kundenservice Strafe',

  async render(container) {
    const data = await API.get('/api/strafe');
    const isAdmin = App.user.role === 'admin';
    const canManage = data.canManage;
    const offen = data.offen || [];
    const verlauf = data.verlauf || [];

    container.innerHTML = `
      <div class="page-head"><h1>Kundenservice Strafe</h1><p>Offene Strafzeiten und ${esc(data.name)}-Einbindungen.</p></div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-value">${(data.open_hours || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h</div>
          <div class="stat-label">Offene Strafzeit</div>
        </div>
        <div class="stat">
          <div class="stat-value">${(data.schwelle || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h</div>
          <div class="stat-label">Schwelle für ${esc(data.name)}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>${esc(data.name)}</h2></div>
        <p class="panel-sub">Ab ${(data.schwelle || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stunden offener Strafzeit wird automatisch eine ${esc(data.name)}-Zuweisung über ${(data.dauer || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stunden erstellt. Anmeldung ist auch freiwillig über die Personalanmeldung möglich, sofern offene Dienste vorhanden sind.</p>
      </div>

      ${canManage ? `
        <div class="panel">
          <div class="panel-head"><h2>Leitung</h2></div>
          <form id="strafe-add-form" class="mb">
            <div class="form-row">
              <label class="field"><span class="field-label">Nutzer</span>
                <select class="input" id="strafe-user" required><option value="">– wählen –</option>
                  ${data.users.map((u) => `<option value="${u.id}">${esc(u.display_name || u.username)}</option>`).join('')}
                </select>
              </label>
              <label class="field"><span class="field-label">Stunden</span>
                <input class="input" type="number" id="strafe-hours" step="0.5" min="0.5" max="120" value="1.5" required/>
              </label>
            </div>
            <label class="field"><span class="field-label">Grund</span>
              <textarea class="input" id="strafe-reason" placeholder="z. B. unentschuldigtes Fehlen, Verspätung …"></textarea>
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" type="submit" data-action="add">Geben</button>
              <button class="btn btn-danger btn-sm" type="submit" data-action="subtract">Abziehen</button>
            </div>
          </form>
          <div class="form-row">
            <label class="field" style="margin-bottom:0">
              <span class="field-label">Strafe-Dienste generieren in</span>
              <select class="input" id="strafe-target-shift">
                ${data.shifts.map((s) => `<option value="${s.id}">${esc(s.title)} · ${esc(fmtDate(s.date))} ${esc(fmtTime(s.time_start))}</option>`).join('')}
              </select>
            </label>
            <div class="field" style="margin-bottom:0;display:flex;align-items:flex-end">
              <button class="btn btn-soft" id="strafe-generate">Automatisch erstellen</button>
            </div>
          </div>
          ${isAdmin ? `
            <hr style="border:0;border-top:1px solid var(--border);margin:16px 0"/>
            <h3 style="font-size:.95rem;margin-bottom:8px">Konfiguration</h3>
            <form id="strafe-config-form" class="form-row">
              <label class="field"><span class="field-label">Schwelle (h)</span>
                <input class="input" type="number" id="cfg-schwelle" step="0.5" min="0.5" value="${esc(data.schwelle)}"/>
              </label>
              <label class="field"><span class="field-label">Dauer (h)</span>
                <input class="input" type="number" id="cfg-dauer" step="0.5" min="0.5" value="${esc(data.dauer)}"/>
              </label>
              <label class="field"><span class="field-label">Name</span>
                <input class="input" type="text" id="cfg-name" value="${esc(data.name)}"/>
              </label>
              <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost" type="submit">Konfiguration speichern</button></div>
            </form>` : ''}
        </div>` : ''}

      <div class="panel">
        <div class="panel-head"><h2>Offene Strafzeiten und Gründe</h2></div>
        ${offen.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Offen (h)</th><th>Grund</th><th>Eingetragen</th></tr></thead>
              <tbody>
                ${offen.map((e) => `
                  <tr>
                    <td class="num"><b>${Math.round((e.hours - e.covered) * 10) / 10} h</b></td>
                    <td>${esc(e.reason || '–')}</td>
                    <td class="muted-sm">${esc(fmtDate(e.created_at))}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Keine offene Strafzeit vorhanden.</div>'}
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Verlauf</h2></div>
        ${verlauf.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Dienst</th><th>Standort</th><th>Grund</th><th>Dauer</th><th>Status</th></tr></thead>
              <tbody>
                ${verlauf.map((v) => `
                  <tr>
                    <td><b>${esc(v.code)}</b></td>
                    <td>${esc(v.standort || '–')}</td>
                    <td class="muted-sm">${esc(v.grund || '')}</td>
                    <td class="num">${v.start ? Math.round(((new Date(v.end + ':00') - new Date(v.start + ':00')) / 3600000) * 10) / 10 + ' h' : '–'}</td>
                    <td>
                      ${v.status === 'bestaetigt'
                        ? '<span class="badge badge-green">Zugewiesen</span>'
                        : '<span class="badge badge-amber">Abgeschlossen</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Noch keine Einträge.</div>'}
      </div>
    `;

    if (canManage) {
      let adjustAction = 'add';
      container.querySelectorAll('#strafe-add-form button[type="submit"]').forEach((b) => {
        b.addEventListener('click', () => { adjustAction = b.dataset.action; });
      });
      container.querySelector('#strafe-add-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await API.post('/api/admin/strafe-adjust', {
            user_id: parseInt(container.querySelector('#strafe-user').value, 10),
            hours: parseFloat(container.querySelector('#strafe-hours').value),
            reason: container.querySelector('#strafe-reason').value,
            action: adjustAction
          });
          App.toast(adjustAction === 'subtract' ? `${r.changed_hours || 0} h abgezogen.` : 'Strafzeit erfasst.');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });

      container.querySelector('#strafe-generate').addEventListener('click', async () => {
        const shiftId = parseInt(container.querySelector('#strafe-target-shift').value, 10);
        try {
          const r = await API.post('/api/admin/strafe-generate', { shift_id: shiftId });
          App.toast(r.created > 0 ? r.created + ' Strafe-Dienst(e) erstellt.' : 'Keine neuen Einträge (keine offenen Strafzeiten über der Schwelle).');
          App.reload();
        } catch (err) { App.toast(err.message, 'error'); }
      });

      if (isAdmin) {
        container.querySelector('#strafe-config-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await API.post('/api/admin/strafe-config', {
              schwelle_hours: parseFloat(container.querySelector('#cfg-schwelle').value),
              dauer_hours: parseFloat(container.querySelector('#cfg-dauer').value),
              name: container.querySelector('#cfg-name').value
            });
            App.toast('Konfiguration gespeichert.');
            App.reload();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      }
    }
  }
};
