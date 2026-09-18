/* VBG – Activity (Teilnahme) */
const ActivityPage = {
  title: 'Activity',
  state: { shiftId: null },

  async render(container) {
    const isScheduler = App.user && (App.user.role === 'admin' || App.user.role === 'senior');

    let myStats = null, listData = null;
    if (isScheduler) {
      myStats = await API.get('/api/activity').catch(() => null);
      listData = await API.get('/api/admin/activity-list').catch(() => ({ shifts: [], items: [], shift_id: null }));
    } else {
      myStats = await API.get('/api/activity');
    }

    const stats = myStats || { teilgenommen: 0, nicht_teilgenommen: 0, history: [] };
    const items = listData ? listData.items || [] : [];
    const shifts = listData ? listData.shifts || [] : [];

    if (isScheduler && !this.state.shiftId && shifts.length) {
      this.state.shiftId = shifts[0].id;
      listData = await API.get('/api/admin/activity-list?shift_id=' + this.state.shiftId);
    }
    const freshItems = listData ? listData.items || [] : [];

    container.innerHTML = `
      <div class="page-head"><h1>Activity</h1><p>Teilnahmeübersicht und Dokumentation.</p></div>
      <div class="stat-grid">
        <div class="stat good">
          <div class="stat-value">${stats.teilgenommen || 0}</div>
          <div class="stat-label">Teilgenommen</div>
        </div>
        <div class="stat bad">
          <div class="stat-value">${stats.nicht_teilgenommen || 0}</div>
          <div class="stat-label">Nicht teilgenommen</div>
        </div>
      </div>

      ${isScheduler ? `
        <div class="panel">
          <div class="panel-head"><h2>Activity erfassen</h2></div>
          <p class="panel-sub">Wähle eine Shift und erfasse die Teilnahme der Besetzten mit einem Klick. Bereits erfasste Dienste werden dabei übersprungen. Einzelne Abweichungen (Fehlt/Notiz) pflegst du im Admin-Bereich unter Activity.</p>
          ${shifts.length ? `
            <div class="seg mb">
              ${shifts.map((s) => `
                <label class="seg-label" data-shift="${s.id}">
                  <input type="radio" name="activity-shift" value="${s.id}" ${s.id === this.state.shiftId ? 'checked' : ''}/>
                  <span>${esc(s.title)} · ${esc(fmtDateShort(s.date))}</span>
                </label>`).join('')}
            </div>` : '<div class="empty">Keine publizierten Shifts vorhanden.</div>'}
          ${freshItems.length ? `
            <div class="act-preview">
              ${freshItems.map((it) => `
                <div class="act-preview-item">
                  <b>${esc(it.duty_code)}</b>
                  <span class="muted-sm">${it.duty_start ? esc(fmtTime(it.duty_start)) + ' – ' + esc(fmtTime(it.duty_end)) : '–'}</span>
                  <span>${esc(userName(it) || '?')}</span>
                  ${it.activity_result ? '<span class="badge badge-green">Erfasst</span>' : '<span class="badge badge-gray">Offen</span>'}
                </div>`).join('')}
            </div>
            <button class="btn btn-primary" id="activity-bulk">Ganzen Shift als teilgenommen erfassen</button>
            <span class="muted-sm" style="margin-left:10px">${freshItems.length} bestätigte Dienste in dieser Shift</span>` : '<div class="empty">Für diese Shift gibt es keine bestätigten Dienste.</div>'}
        </div>` : ''}

      <div class="panel">
        <div class="panel-head"><h2>Activity-Historie</h2></div>
        ${stats.history && stats.history.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Shift</th><th>Dienst</th><th>Datum</th><th>Ergebnis</th><th>Hinweis</th></tr></thead>
              <tbody>
                ${stats.history.map((h) => `
                  <tr>
                    <td><b>${esc(h.shift_title)}</b></td>
                    <td>${esc(h.duty_code)}</td>
                    <td class="muted-sm">${esc(fmtDateShort(h.shift_date))}</td>
                    <td>${h.result === 'teilgenommen' ? '<span class="badge badge-green">Teilgenommen</span>' : '<span class="badge badge-red">Fehlt</span>'}</td>
                    <td class="muted-sm">${esc(h.note || '')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<div class="empty">Noch keine Activity-Einträge.</div>'}
      </div>
    `;

    container.querySelectorAll('.seg-label input[name="activity-shift"]').forEach((r) => {
      r.addEventListener('change', async () => {
        this.state.shiftId = parseInt(r.value, 10);
        App.reload();
      });
    });

    const bulkBtn = container.querySelector('#activity-bulk');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', async () => {
        if (!confirm('Den gesamten Shift für alle bestätigten Dienste als "teilgenommen" erfassen?')) return;
        try {
          const r = await API.post('/api/admin/activity/bulk', { shift_id: this.state.shiftId });
          App.toast(r.erfasst ? (r.erfasst + ' Dienste erfasst.') : 'Keine neuen Einträge – bereits erfasst.');
          App.reload();
        } catch (e) { App.toast(e.message, 'error'); }
      });
    }
  }
};