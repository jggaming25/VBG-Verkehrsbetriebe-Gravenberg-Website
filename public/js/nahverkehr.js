/* VBG – Nahverkehr: Fahrplan-Abfahrtstafel, Ankünfte, Verbindungssuche, Anschlussanfragen */
VBG.nahverkehr = (function () {
  let stops = [];
  let lines = [];
  let kind = 'abfahrt';

  function $id(id) { return document.getElementById(id); }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function fillSelect(sel, items, selected) {
    sel.innerHTML = '<option value="">🚏 Haltestelle wählen …</option>' + items.map((it) => `<option value="${esc(it.value)}">${esc(it.label)}</option>`).join('');
    if (selected) sel.value = selected;
  }

  async function loadMeta() {
    const data = await API.get('/api/nahverkehr/meta');
    stops = data.stops || [];
    lines = data.lines || [];
    const stopOptions = () => stops.map((s) => ({ value: String(s.id), label: '🚏 ' + s.name }));
    fillSelect($id('board-stop'), stopOptions());
    fillSelect($id('search-from'), stopOptions());
    fillSelect($id('search-to'), stopOptions());
  }

  function timeNow(minOffset) {
    const d = new Date(Date.now() + (minOffset || 0));
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  async function loadBoard() {
    const stop = $id('board-stop').value;
    if (!stop) return;
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
      <thead><tr><th>Ankunft</th><th>Abfahrt</th><th>Linie</th><th>Richtung</th><th>Kurs</th><th>Bus</th><th></th></tr></thead>
      <tbody>${data.rows.map(boardRow).join('')}</tbody>
    </table>`;
  }

  function boardRow(r) {
    const badges = [];
    if (r.active) badges.push('<span class="badge badge-activekur">⭐ Aktiver Kurs</span>');
    if (r.bus === 'Gelenk') badges.push('<span class="badge">Gelenk</span>');
    if (r.connWait) badges.push(`<span class="badge badge-conn">⏳ wartet auf L${r.connWait.line} (${r.connWait.waitMin} Min.)</span>`);
    if (r.connAfter) badges.push(`<span class="badge badge-conn">🔗 Anschluss → L${r.connAfter.line} in ${r.connAfter.waitMin} Min.</span>`);
    if (r.isStart) badges.push('<span class="badge muted">Start</span>');
    if (r.isEnd) badges.push('<span class="badge muted">Endstation</span>');
    const canReq = r.connWait && Number(r.connWait.waitMin) < 2;
    const login = !VBG.state.user || !canReq
      ? ''
      : `<button class="btn btn-sm btn-ghost conn-request" data-trip="${r.tripId}" data-stop="${esc(r.lineName)}" data-line="${r.line}" data-fline="${r.connWait.line}" title="Anschlussanfrage (Umstieg &lt; 2 Min.)">🚏</button>`;
    const arr = r.isStart ? '<span class="muted">-</span>' : (kind === 'ankunft' ? `<b>${r.arr}</b>` : r.arr);
    const dep = r.isEnd ? '<span class="muted">-</span>' : (kind === 'abfahrt' ? `<b>${r.dep}</b>` : r.dep);
    return `<tr class="board-row${r.tracked ? ' row-active' : ''}">
      <td class="board-time">${arr}</td>
      <td class="board-time">${dep}</td>
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
    if (!from.value || !to.value) return;
    const fromName = from.options[from.selectedIndex].text.replace(/^🚏 /, '');
    const toName = to.options[to.selectedIndex].text.replace(/^🚏 /, '');
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

  async function requestConnection(tripId, line, fromLine) {
    const stopEl = $id('board-stop');
    const stopName = stopEl.options[stopEl.selectedIndex] ? stopEl.options[stopEl.selectedIndex].text.replace(/^🚏 /, '') : '';
    try {
      const data = await API.post('/api/nahverkehr/requests', { stop: stopName, toTripId: tripId, fromLine });
      toast(`Anschlussanfrage gestellt (von Linie ${data.fromLine} → L${line}). Die Leitstelle prüft das.`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function bind() {
    $id('board-stop').addEventListener('change', loadBoard);
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
      if (b) requestConnection(Number(b.dataset.trip), b.dataset.line, b.dataset.fline);
    });
    window.showTabNahverkehr = showTabNahverkehr;
  }

  async function load() {
    await loadMeta();
    await loadBoard();
  }

  return { bind, load, search, loadBoard };
})();