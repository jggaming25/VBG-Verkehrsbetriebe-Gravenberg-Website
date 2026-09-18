/* VBG – Kundenservice Strafe */
const StrafePage = {
  title: 'Kundenservice Strafe',

  async render(container) {
    const data = await API.get('/api/strafe');
    const offen = data.offen || [];
    const verlauf = data.verlauf || [];

    container.innerHTML = `
      <div class="page-head"><h1>Kundenservice Strafe</h1><p>Offene Strafzeiten und ${esc(data.name)}-Einbindungen. Verwaltung über den Admin-Bereich.</p></div>
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
  }
};
