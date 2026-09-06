/* VBG – Nahverkehr: Fahrplan-Abfahrtstafel, Ankünfte, Verbindungssuche, Anschlussanfragen */
VBG.nahverkehr = (function () {
  let stops = [];
  let lines = [];
  let kind = 'abfahrt';

  function $id(id) { return document.getElementById(id); }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function fillSelect(sel, items, selected) {
    sel.innerHTML = items.map((it) => `<option value="${esc(it.value)}">${esc(it.label)}</option>`).join('');
    if (selected) sel.value = selected;
  }

  async function loadMeta() {
    const data = await API.get('/api/nahverkehr/meta');
    stops = data.stops || [];
    lines = data.lines || [];
    const stopOptions = () => stops.map((s) => ({ value: String(s.id), label: '🚏 ' + s.name }));
    const lastStop = Number(localStorage.getItem('vbg-nv-stop')) || null;
    fillSelect($id('board-stop'), stopOptions(), lastStop || String((stops.find((s) => s.name === 'Gravenberg ZOB') || stops[0] || {}).id));
    fillSelect($id('search-from'), stopOptions(), lastStop || String((stops.find((s) => s.name === 'Gravenberg ZOB') || stops[0] || {}).id));
    fillSelect($id('search-to'), stopOptions(), String((stops.find((s) => s.name === 'Neuenburg Schule') || stops[0] || {}).id));
    if (!$id('search-time').value) $id('search-time').value = timeNow();
  }

  function timeNow(minOffset) {
    const d = new Date(Date.now() + (minOffset || 0));
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  async function loadBoard() {
    const stop = $id('board-stop').value;
    if (!stop) return;
    localStorage.setItem('vbg-nv-stop', stop);
    const btn = $id('board-refresh');
    btn.disabled = true;
    try {
      const data = await API.get(`/api/nahverkehr/departures?stop=${encodeURIComponent(stop)}&kind=${kind}&limit=24`);
      renderBoard(data);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function dirLabel(row) {
    const arrow = row.direction === 'hin' ? '→' : '←';
    return `${arrow} ${row.dest}`;
  }

  function renderBoard(data) {
    $id('board-info').textContent = `${data.stop} · ${data.kind === 'abfahrt' ? 'Abfahrt' : 'Ankunft'} · ${data.rows.length} Verbindungen`;
    const wrap = $id('board-list');
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🚌</div><p>Keine nächsten ${data.kind === 'abfahrt' ? 'Abfahrten' : 'Ankünfte'} an dieser Haltestelle.</p></div>`;
      return;
    }
    wrap.innerHTML = `<table class="board-table">
      <thead><tr><th>Zeit</th><th>Linie</th><th>Richtung</th><th>Kurs</th><th>Bus</th><th></th></tr></thead>
      <tbody>${data.rows.map(boardRow).join('')}</tbody>
    </table>`;
  }

  function boardRow(r) {
    const time = r.kind === 'abfahrt' ? r.dep : r.arr;
    const badges = [];
    if (r.active) badges.push('<span class="badge badge-activekur">⭐ Aktiver Kurs</span>');
    if (r.bus === 'Gelenk') badges.push('<span class="badge">Gelenk</span>');
    if (r.connWait) badges.push(`<span class="badge badge-conn">⏳ wartet auf L${r.connWait.line} (${r.connWait.waitMin} Min.)</span>`);
    if (r.connAfter) badges.push(`<span class="badge badge-conn">🔗 Anschluss → L${r.connAfter.line} in ${r.connAfter.waitMin} Min.</span>`);
    if (r.isStart) badges.push('<span class="badge muted">Start</span>');
    if (r.isEnd) badges.push('<span class="badge muted">Endstation</span>');
    const login = !VBG.state.user
      ? ''
      : `<button class="btn btn-sm btn-ghost conn-request" data-trip="${r.tripId}" data-stop="${esc(r.lineName)}" data-line="${r.line}" title="Anschlussanfrage">🚏</button>`;
    return `<tr class="board-row${r.active ? ' row-active' : ''}">
      <td class="board-time"><b>${time}</b></td>
      <td><span class="bl-chip" style="--bl:${esc(r.color)}">L${r.line}</span></td>
      <td><span class="dir">${dirLabel(r)}</span></td>
      <td>Kurs ${r.course}</td>
      <td class="muted">${r.bus}</td>
      <td class="board-badges"><div class="badge-row">${badges.join('')}</div>${login}</td>
    </tr>`;
  }

  async function search() {
    const from = $id('search-from');
    const to = $id('search-to');
    const time = $id('search-time').value || timeNow();
    const fromName = from.options[from.selectedIndex] ? from.options[from.selectedIndex].text.replace(/^🚏 /, '') : '';
    const toName = to.options[to.selectedIndex] ? to.options[to.selectedIndex].text.replace(/^🚏 /, '') : '';
    if (!fromName || !toName) return;
    const btn = $id('search-run');
    btn.disabled = true;
    try {
      const data = await API.get(`/api/nahverkehr/search?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}&time=${encodeURIComponent(time)}`);
      renderSearch(data);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function searchLeg(leg) {
    return `<div class="conn-leg">
      <span class="bl-chip" style="--bl:#2e9e5b">L${leg.line}</span>
      <span>${leg.dep.time} ${esc(leg.dep.stop)}</span>
      <span class="muted">→</span>
      <span>${leg.arr.time} ${esc(leg.arr.stop)}</span>
      <span class="muted">${leg.direction === 'hin' ? 'hin' : 'zurück'} · Kurs ${leg.course}</span>
    </div>`;
  }

  function renderSearch(data) {
    const wrap = $id('search-results');
    const blocks = [];
    if (!data.direct.length && !data.transfers.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🔎</div><p>Keine Verbindung gefunden.</p></div>`;
      return;
    }
    if (data.direct.length) {
      blocks.push(`<div class="conn-result"><h3>🚌 Direktverbindungen</h3>${data.direct.map(searchLeg).join('')}</div>`);
    }
    if (data.transfers.length) {
      blocks.push(`<div class="conn-result"><h3>🔁 Mit Umstieg</h3>${data.transfers.map((x) => `
        <div class="conn-transfer${x.official ? ' conn-official' : ''}">
          ${x.official ? '<span class="badge badge-conn">gesichert</span>' : ''}
          ${searchLeg(x.leg1)}
          <div class="conn-wait">🚏 Umstieg in <b>${esc(x.via)}</b> · <b>${x.waitMin} Min.</b> Wartezeit</div>
          ${searchLeg(x.leg2)}
        </div>`).join('')}</div>`);
    }
    wrap.innerHTML = blocks.join('');
  }

  function showTabNahverkehr() {
    document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
    document.getElementById('tab-nahverkehr').classList.remove('hidden');
    document.getElementById('tab-nahverkehr').classList.add('active');
    document.querySelectorAll('.nav-link').forEach((n) => n.classList.toggle('active', n.dataset.tab === 'nahverkehr'));
  }

  async function requestConnection(tripId, line) {
    const other = lines.filter((l) => l.line !== line && l.kurse.length).map((l) => l.line);
    if (!other.length) { toast('Kein passender Anschluss möglich.', 'err'); return; }
    const target = await askConnectionLine(tripId, line, other);
    if (!target) return;
    const stopEl = $id('board-stop');
    const stopName = stopEl.options[stopEl.selectedIndex] ? stopEl.options[stopEl.selectedIndex].text.replace(/^🚏 /, '') : '';
    try {
      const data = await API.post('/api/nahverkehr/requests', { stop: stopName, toTripId: tripId, fromLine: target });
      toast(`Anschlussanfrage gestellt (von Linie ${data.fromLine} → L${line}). Die Leitstelle prüft das.`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function askConnectionLine(tripId, toLine, lines) {
    return new Promise((resolve) => {
      const li = lines.join(', ');
      const div = document.createElement('div');
      div.className = 'modal-ask';
      div.innerHTML = `<div class="modal">
          <div class="modal-backdrop"></div>
          <div class="modal-card">
            <div class="modal-head"><h2>🚏 Anschlussanfrage</h2><p class="muted">Mit welcher Linie kommt die Person an, um auf Linie ${toLine} zu warten?</p></div>
            <div class="row gap line-pick">${lines.map((l) => `<button class="btn btn-ghost pick-line" data-line="${l}" type="button">Linie ${l}</button>`).join('')}</div>
            <button class="btn btn-ghost btn-full mt" data-cancel type="button">Abbrechen</button>
          </div>
        </div>`;
      document.body.appendChild(div);
      div.querySelector('.modal-backdrop').addEventListener('click', () => { div.remove(); resolve(null); });
      div.querySelector('[data-cancel]').addEventListener('click', () => { div.remove(); resolve(null); });
      div.querySelectorAll('.pick-line').forEach((b) => b.addEventListener('click', () => { const v = b.dataset.line; div.remove(); resolve(v); }));
    });
  }

  function bind() {
    $id('board-stop').addEventListener('change', () => { loadBoard(); if ($id('tab-nahverkehr').classList.contains('active')) search(); });
    $id('board-refresh').addEventListener('click', loadBoard);
    $id('board-kind').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-boardkind]');
      if (!chip) return;
      kind = chip.dataset.boardkind;
      document.querySelectorAll('#board-kind .chip').forEach((c) => c.classList.toggle('active', c.dataset.boardkind === kind));
      loadBoard();
    });
    $id('search-run').addEventListener('click', search);
    $id('board-list').addEventListener('click', (e) => {
      const b = e.target.closest('.conn-request');
      if (b) requestConnection(Number(b.dataset.trip), b.dataset.line);
    });
    window.showTabNahverkehr = showTabNahverkehr;
  }

  async function load() {
    await loadMeta();
    await loadBoard();
  }

  return { bind, load, search, loadBoard };
})();