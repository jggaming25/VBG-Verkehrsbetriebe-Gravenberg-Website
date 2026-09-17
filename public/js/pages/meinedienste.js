/* VBG – Meine Dienste (persönlicher Dienstplan mit einzelnen Fahrten) */
const MeineDienstePage = {
  title: 'Meine Dienste',

  linieLabel(l) {
    const s = String(l || '');
    return /^\d+$/.test(s) ? 'L' + s : s;
  },

  fahrtenHtml(fahrten) {
    const list = fahrten || [];
    if (!list.length) return '';
    return `<details class="mine-fahrten"><summary>${list.length} Fahrten ansehen</summary><div class="mine-trips">
      ${list.map((f) => `<div class="mine-trip">
        <span class="plan-fahrt-zeit">${f.start ? esc(fmtTime(f.start)) + '–' + esc(fmtTime(f.end)) : '–'}</span>
        <span class="plan-fahrt-badge" style="--lc:${f.color ? esc(f.color) : '#555'}">${esc(this.linieLabel(f.linie))}</span>
        <span class="plan-fahrt-richt ${String(f.richtung) === 'zurück' ? 'zurueck' : ''}">${String(f.richtung) === 'zurück' ? '←' : '→'}</span>
        <span class="plan-fahrt-strecke"><span class="muted">${esc(f.von)}</span> → <span class="muted">${esc(f.nach)}</span></span>
      </div>`).join('')}
    </div></details>`;
  },

  async render(container) {
    const data = await API.get('/api/meine-dienste');
    const assignments = data.assignments || [];
    const byShift = {};
    for (const a of assignments) {
      (byShift[a.shift_id] = byShift[a.shift_id] || []).push(a);
    }

    const desc = (a) => {
      if (a.type === 'bus') return '🚌 ' + (a.linie || a.code);
      if (a.type === 'wechsel') return '🔄 Linienwechsel ' + (a.wechsel_from_name || '?') + ' → ' + (a.wechsel_to_name || '?');
      return '🛍️ ' + (a.standort || 'Kundenservice-Strafe');
    };

    container.innerHTML = `
      <div class="page-head"><h1>Meine Dienste</h1><p>Deine fest eingeteilten Dienste im Überblick – mit allen einzelnen Fahrten.</p></div>
      ${Object.keys(byShift).length
        ? Object.keys(byShift).sort((x, y) => (byShift[y][0].shift_date || '').localeCompare(byShift[x][0].shift_date || '')).map((sid) => {
            const list = byShift[sid].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
            const first = list[0];
            return `
              <div class="panel">
                <div class="panel-head">
                  <h2>${esc(first.shift_title)}</h2>
                  <span class="muted-sm">${esc(fmtDate(first.shift_date))}</span>
                </div>
                <div class="table-wrap">
                  <table class="table">
                    <thead><tr><th>Dienst</th><th>Art</th><th>Zeit</th><th>Fahrten</th><th>Status</th></tr></thead>
                    <tbody>
                      ${list.map((a) => `
                        <tr>
                          <td><b>${esc(a.code)}</b></td>
                          <td>${desc(a)}</td>
                          <td class="num">${a.start ? esc(fmtTime(a.start)) + ' – ' + esc(fmtTime(a.end)) : '–'}</td>
                          <td>${a.type === 'bus' ? this.fahrtenHtml(a.fahrten) : '<span class="muted">–</span>'}</td>
                          <td>${a.kind === 'reserve'
                            ? '<span class="badge badge-blue">Reserve</span>'
                            : '<span class="badge badge-green">Bestätigt</span>'}</td>
                        </tr>`).join('')}
                    </tbody>
                  </table>
                </div>
                <div class="activity-body" data-activity-shift="${esc(sid)}"></div>
              </div>`;
          }).join('')
        : '<div class="empty">Dir wurde bisher kein Dienst zugeteilt.</div>'}
    `;
    await this.renderActivity(container);
  },

  async renderActivity(container) {
    const frames = Array.from(container.querySelectorAll('[data-activity-shift]'));
    await Promise.all(frames.map(async (frame) => {
      const shiftId = frame.dataset.activityShift;
      let st;
      try {
        st = await API.get('/api/activity-status?shift_id=' + shiftId);
      } catch (e) {
        frame.innerHTML = '<div class="empty">Activity-Status nicht abrufbar: ' + esc(e.message) + '</div>';
        return;
      }
      if (!st.ok || st.noDuty) {
        frame.innerHTML = `
          <div class="activity-card">
            <h3>Activity</h3>
            <p class="muted">Nach <b>60 % deiner reinen Fahrtzeit</b> kannst du dich für die Activity anmelden.</p>
            <div class="empty">Kein bestätigter Haupt-Dienst in dieser Shift.</div>
          </div>`;
        return;
      }
      if (st.windowClosed) {
        frame.innerHTML = `
          <div class="activity-card">
            <h3>Activity</h3>
            <p class="muted">Die Activity-Anmeldung ist nur bis 60 Minuten nach Dienstende einsehbar.</p>
          </div>`;
        return;
      }
      const dr = st.driving || {};
      const unlockStr = dr.atIso ? new Date(dr.atIso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr' : '';
      frame.innerHTML = `
        <div class="activity-card">
          <h3>Activity</h3>
          <p class="muted">Nach <b>60 % deiner reinen Fahrtzeit</b> kannst du dich für die Activity anmelden. Sichtbar ist diese Anmeldung nur bis 60 Minuten nach Dienstende.</p>
          <div class="activity-actions">
            ${st.signed
              ? '<span class="badge badge-green">Für die Activity angemeldet</span>'
              : dr.reached
                ? '<button class="btn btn-primary" data-act-sign>Für Activity anmelden</button>'
                : `<button class="btn btn-primary" disabled>Für Activity anmelden</button><span class="muted act-lock">Freigabe ab <b>${esc(unlockStr || '60 % Fahrtzeit')}</b></span>`}
          </div>
        </div>`;
      const btn = frame.querySelector('[data-act-sign]');
      if (btn && st.duty) {
        btn.addEventListener('click', async () => {
          try {
            await API.post('/api/activity/sign', { duty_id: st.duty.id });
            App.toast('Für die Activity angemeldet.');
            App.reload();
          } catch (e) { App.toast(e.message, 'error'); }
        });
      }
    }));
  }
};
