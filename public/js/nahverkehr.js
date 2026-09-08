/* VBG – Nahverkehr: Fahrplan-Abfahrtstafel, Ankünfte, Verbindungssuche, Anschlussanfragen */
VBG.nahverkehr = (function () {
  let stops = [];
  let lines = [];
  let kind = 'abfahrt';
  let lastDirect = [];
  let lastTransfers = [];
  let lastFrom = '';
  let lastTo = '';
  let lastTime = '';
  let savedList = [];

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
    lastFrom = fromName; lastTo = toName; lastTime = time;
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

  function saveBtn(kind, idx) {
    if (!VBG.state || !VBG.state.user) return '';
    return `<div class="conn-save-row"><button class="btn btn-sm btn-ghost" data-saveconn="${kind}:${idx}" title="Verbindung speichern (max. 3, wird nach Fahrtende automatisch entfernt)">💾 Speichern</button></div>`;
  }

  function renderSearch(data) {
    lastDirect = data.direct || [];
    lastTransfers = data.transfers || [];
    lastFrom = data.from || lastFrom;
    lastTo = data.to || lastTo;
    const wrap = $id('search-results');
    const blocks = [];
    if (!data.direct.length && !data.transfers.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🔎</div><p>Keine Verbindung gefunden.</p></div>`;
      return;
    }
    if (data.direct.length) {
      blocks.push(`<div class="conn-result"><h3>🚌 Direktverbindungen</h3>${data.direct.map((x, i) => searchLeg(x) + saveBtn('d', i)).join('')}</div>`);
    }
    if (data.transfers.length) {
      blocks.push(`<div class="conn-result"><h3>🔁 Mit Umstieg</h3>${data.transfers.map((x, i) => `
        <div class="conn-transfer${x.official ? ' conn-official' : ''}">
          ${x.official ? '<span class="badge badge-conn">gesichert</span>' : ''}
          ${searchLeg(x.leg1)}
          <div class="conn-wait">🚏 Umstieg in <b>${esc(x.via)}</b> · <b>${x.waitMin} Min.</b> Wartezeit</div>
          ${searchLeg(x.leg2)}
          ${saveBtn('t', i)}
        </div>`).join('')}</div>`);
    }
    wrap.innerHTML = blocks.join('');
  }

  /* ------------------------------ Gespeicherte Verbindungen ------------------------------ */

  function fahrtEndeISO(time) {
    const [h, m] = String(time).split(':').map(Number);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const p = (t) => Number((parts.find((x) => x.type === t) || {}).value || 0);
    let d = new Date(Date.UTC(p('year'), p('month') - 1, p('day'), h, m));
    if (d.getTime() < Date.now()) d = new Date(d.getTime() + 86400000);
    return d.toISOString();
  }

  function connLabel(kind, res) {
    if (kind === 'd') {
      return `L${res.line} ${res.dep.time} ${res.dep.stop} → ${res.arr.time} ${res.arr.stop}`;
    }
    return `L${res.leg1.line} ${res.leg1.dep.time} ${res.leg1.dep.stop} → Umstieg (${res.waitMin} Min.) → L${res.leg2.line} ${res.leg2.arr.time} ${res.leg2.arr.stop}`;
  }

  async function saveConn(key) {
    const [kind, idx] = key.split(':');
    const res = kind === 'd' ? lastDirect[Number(idx)] : lastTransfers[Number(idx)];
    if (!res) return;
    const legs = kind === 'd' ? [res] : [res.leg1, res.leg2];
    const until = fahrtEndeISO(legs[legs.length - 1].arr.time);
    const data = { kind, res, from: lastFrom, to: lastTo };
    try {
      const r = await API.post('/api/saved-connections', { label: connLabel(kind, res), data, until });
      savedList = savedList.concat([{ id: r.id }]);
      toast('Verbindung gespeichert (max. 3).', 'ok');
      loadSaved();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function loadSaved() {
    const wrap = $id('saved-conns');
    if (!VBG.state || !VBG.state.user) { wrap.innerHTML = ''; wrap.classList.remove('saved-visible'); return; }
    try {
      const data = await API.get('/api/saved-connections');
      savedList = data.connections || [];
      if (!savedList.length) { wrap.innerHTML = ''; wrap.classList.remove('saved-visible'); return; }
      wrap.classList.add('saved-visible');
      wrap.innerHTML = `<div class="saved-head"><h3>💾 Gespeicherte Verbindungen</h3><span class="muted">${savedList.length}/3 · werden nach Fahrtende entfernt</span></div>` +
        savedList.map((c) => `
          <div class="saved-conn">
            <button class="saved-main" data-viewconn="${c.id}">
              <span class="saved-label">${esc(c.label)}</span>
              ${c.until ? `<span class="saved-until">✖ ab ${esc(fmtDateTime(c.until))}</span>` : ''}
            </button>
            <button class="btn btn-sm btn-danger" data-delsaved="${c.id}" title="Entfernen">✕</button>
          </div>`).join('');
    } catch (e) { /* optionale Zusatzfunktion */ }
  }

  function showSaved(id) {
    const c = savedList.find((x) => Number(x.id) === Number(id));
    if (!c || !c.data || !c.data.res) return;
    const d = c.data;
    const data = { from: d.from || '', to: d.to || '', direct: d.kind === 'd' ? [d.res] : [], transfers: d.kind === 't' ? [d.res] : [] };
    renderSearch(data);
    const el = $id('search-results');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteSaved(id) {
    try {
      await API.del('/api/saved-connections/' + id);
      toast('Verbindung entfernt.', 'ok');
      loadSaved();
    } catch (e) { toast(e.message, 'err'); }
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
    $id('search-results').addEventListener('click', (e) => {
      const s = e.target.closest('[data-saveconn]');
      if (s) saveConn(s.dataset.saveconn);
    });
    $id('saved-conns').addEventListener('click', (e) => {
      const del = e.target.closest('[data-delsaved]');
      if (del) { deleteSaved(Number(del.dataset.delsaved)); return; }
      const v = e.target.closest('[data-viewconn]');
      if (v) showSaved(Number(v.dataset.viewconn));
    });
    window.showTabNahverkehr = showTabNahverkehr;
  }

  async function load() {
    await loadMeta();
    await loadBoard();
    await loadSaved();
  }

  return { bind, load, search, loadBoard };
})();