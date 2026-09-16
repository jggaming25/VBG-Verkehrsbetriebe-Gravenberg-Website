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
        <span class="plan-fahrt-kurs">Kurs ${esc(f.kurs)}</span>
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
              </div>`;
          }).join('')
        : '<div class="empty">Dir wurde bisher kein Dienst zugeteilt.</div>'}
    `;
  }
};