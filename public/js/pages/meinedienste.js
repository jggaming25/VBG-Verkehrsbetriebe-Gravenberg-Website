/* VBG – Meine Dienste (persönlicher Dienstplan) */
const MeineDienstePage = {
  title: 'Meine Dienste',

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
      <div class="page-head"><h1>Meine Dienste</h1><p>Deine fest eingeteilten Dienste im Überblick.</p></div>
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
                    <thead><tr><th>Dienst</th><th>Art</th><th>Zeit</th><th>Status</th></tr></thead>
                    <tbody>
                      ${list.map((a) => `
                        <tr>
                          <td><b>${esc(a.code)}</b></td>
                          <td>${desc(a)}</td>
                          <td class="num">${a.start ? esc(fmtTime(a.start)) + ' – ' + esc(fmtTime(a.end)) : '–'}</td>
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