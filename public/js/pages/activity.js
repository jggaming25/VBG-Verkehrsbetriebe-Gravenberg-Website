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
          <p class="panel-sub">Wähle eine Shift, um die Teilnahme der Besetzten zu markieren. Bei Nichterscheinen kann automatisch eine Strafzeit erfasst werden.</p>
          ${shifts.length ? `
            <div class="seg mb">
              ${shifts.map((s) => `
                <label class="seg-label" data-shift="${s.id}">
                  <input type="radio" name="activity-shift" value="${s.id}" ${s.id === this.state.shiftId ? 'checked' : ''}/>
                  <span>${esc(s.title)} · ${esc(fmtDate(s.date))}</span>
                </label>`).join('')}
            </div>
            ${freshItems.length ? `
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Dienst</th><th>Zeit</th><th>Fahrer</th><th>Status</th><th>Auto-Strafe</th><th>Notiz</th><th></th></tr></thead>
                  <tbody>
                    ${freshItems.map((it) => `
                      <tr data-aid="${it.assignment_id}" data-duty="${it.duty_id}" data-uid="${it.user_id}">
                        <td><b>${esc(it.duty_code)}</b></td>
                        <td class="muted-sm">${it.duty_start ? esc(fmtTime(it.duty_start)) + ' – ' + esc(fmtTime(it.duty_end)) : '–'}</td>
                        <td>${esc(it.display_name || it.username)}</td>
                        <td>
                          ${it.activity_result === 'teilgenommen' ? '<span class="badge badge-green">Teilgenommen</span>'
                            : it.activity_result === 'nicht_teilgenommen' ? '<span class="badge badge-red">Fehlt</span>'
                            : '<span class="badge badge-gray">Noch nicht erfasst</span>'}
                        </td>
                        <td>
                          <label class="check-line" style="padding:0;margin:0">
                            <input type="checkbox" data-auto="${it.duty_id}_${it.user_id}" ${it.activity_result ? '' : 'checked'}/>
                          </label>
                        </td>
                        <td><input class="input" data-note="${it.assignment_id}" value="${esc(it.activity_note || '')}" style="width:140px;padding:5px 8px;font-size:.8rem"/></td>
                        <td style="white-space:nowrap">
                          <button class="btn btn-soft btn-xs" data-result="${it.duty_id}_${it.user_id}_teilgenommen">Teilgenommen</button>
                          <button class="btn btn-danger btn-xs" data-result="${it.duty_id}_${it.user_id}_nicht">Fehlt</button>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>` : '<div class="empty">Für diese Shift gibt es keine bestätigten Dienste.</div>'}
          ` : '<div class="empty">Keine publizierten Shifts vorhanden.</div>'}
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
                    <td class="muted-sm">${esc(fmtDate(h.shift_date))}</td>
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

    if (isScheduler) {
      container.querySelectorAll('[data-result]').forEach((b) => {
        b.addEventListener('click', async () => {
          const [du, uid, res] = b.dataset.result.split('_');
          const dutyId = parseInt(du, 10);
          const userId = parseInt(uid, 10);
          const note = (container.querySelector(`input[data-note="${b.closest('tr').dataset.aid}"]`) || {}).value || '';
          const autoCheck = container.querySelector(`input[data-auto="${dutyId}_${userId}"]`);
          const autoStrafe = autoCheck ? autoCheck.checked : false;
          const result = res === 'teilgenommen' ? 'teilgenommen' : 'nicht_teilgenommen';
          try {
            await API.post('/api/admin/activity', {
              duty_id: dutyId,
              user_id: userId,
              result,
              note,
              auto_strafe: autoStrafe
            });
            App.toast('Activity gespeichert.');
            App.reload();
          } catch (e) { App.toast(e.message, 'error'); }
        });
      });
    }
  }
};