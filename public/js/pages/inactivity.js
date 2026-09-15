/* VBG – Staff Inactivity (Abwesenheit) */
const InactivityPage = {
  title: 'Inactivity',

  statusBadge(s) {
    return s === 'genehmigt' ? '<span class="badge badge-green">Genehmigt</span>'
      : s === 'abgelehnt' ? '<span class="badge badge-red">Abgelehnt</span>'
      : '<span class="badge badge-amber">Offen</span>';
  },

  async render(container) {
    const data = await API.get('/api/inactivity');
    const mine = data.mine || [];
    const open = data.open || [];
    const canManage = data.canManage;

    container.innerHTML = `
      <div class="page-head"><h1>Staff Inactivity</h1><p>Abwesenheit beantragen und verwalten.</p></div>

      <div class="panel">
        <div class="panel-head"><h2>Abwesenheit beantragen</h2></div>
        <p class="panel-sub">Ein Zeitraum darf maximal einen Monat (31 Tage) sein. Der Antrag wird erst nach Annahme durch die Leitung wirksam.</p>
        <form id="inactivity-form">
          <div class="form-row">
            <label class="field"><span class="field-label">Von</span><input class="input" type="date" id="inact-start" required/></label>
            <label class="field"><span class="field-label">Bis</span><input class="input" type="date" id="inact-end" required/></label>
          </div>
          <label class="field"><span class="field-label">Grund / Hinweis</span><textarea class="input" id="inact-reason" placeholder="Warum bist du abwesend?"></textarea></label>
          <button class="btn btn-primary" type="submit">Inactivity beantragen</button>
        </form>
      </div>

      ${canManage ? `
        <div class="panel">
          <div class="panel-head"><h2>Offene Anträge</h2>${open.length ? `<span class="badge badge-amber">${open.length} offen</span>` : ''}</div>
          ${open.length ? `
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Nutzer</th><th>Zeitraum</th><th>Grund</th><th>Eingereicht</th><th></th></tr></thead>
                <tbody>
                  ${open.map((r) => `
                    <tr>
                      <td><b>${esc(r.display_name || r.username)}</b></td>
                      <td class="muted-sm">${esc(fmtDate(r.start_date))} – ${esc(fmtDate(r.end_date))}</td>
                      <td class="muted-sm">${esc(r.reason || '')}</td>
                      <td class="muted-sm">${esc(fmtDateTime(r.created_at))}</td>
                      <td style="white-space:nowrap">
                        <button class="btn btn-soft btn-xs" data-decide="${r.id}_genehmigt">Genehmigen</button>
                        <button class="btn btn-danger btn-xs" data-decide="${r.id}_abgelehnt">Ablehnen</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>` : '<div class="empty">Keine offenen Anträge.</div>'}
        </div>` : ''}

      <div class="panel">
        <div class="panel-head"><h2>Meine Inactivity</h2></div>
        ${mine.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Zeitraum</th><th>Grund</th><th>Status</th><th>Entscheidung</th></tr></thead>
              <tbody>
                ${mine.map((r) => `
                  <tr>
                    <td>${esc(fmtDate(r.start_date))} – ${esc(fmtDate(r.end_date))}</td>
                    <td class="muted-sm">${esc(r.reason || '')}</td>
                    <td>${this.statusBadge(r.status)}</td>
                    <td class="muted-sm">${esc(r.decision_note || '')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Keine Einträge.</div>'}
      </div>
    `;

    container.querySelector('#inactivity-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        start_date: container.querySelector('#inact-start').value,
        end_date: container.querySelector('#inact-end').value,
        reason: container.querySelector('#inact-reason').value
      };
      try {
        await API.post('/api/inactivity', payload);
        App.toast('Antrag eingereicht.');
        App.reload();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });

    if (canManage) {
      container.querySelectorAll('[data-decide]').forEach((b) => {
        b.addEventListener('click', async () => {
          const [id, action] = b.dataset.decide.split('_');
          const note = prompt(action === 'genehmigt' ? 'Anmerkung (optional):' : 'Ablehnungsgrund (optional):', '');
          if (note === null) return;
          try {
            await API.post('/api/admin/inactivity/' + id, { action, note });
            App.toast('Entscheidung gespeichert.');
            App.reload();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    }
  }
};