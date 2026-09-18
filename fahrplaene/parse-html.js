/* Fahrplan-Parser: liest die lokalen HTML-Fahrpläne ('<Linie> Kurs <N>.html', Google-Tabellen-Exporte)
 * und überführt die darin enthaltenen ÖPNV-Fahrten idempotent in fahrplan.json-kompatible Kurse.
 *
 * Format A (Dienstplan-Export): Blöcke 'ÖPNV Fahrt' gefolgt von Kopfzeile und 'Haltestelle'-Tabelle.
 *   Kurs-Datei = ein Umlauf; darin können mehrere Fahrten hintereinander liegen.
 *   Kopf-Zellen z. B.: [19, 1, 'XX:00 / SV', 'XX:15 / GVZ'] bzw. N1: [1, 'GVZ', 'SK'].
 *   Pro Fahrt werden von/nach (aus Haltestellenfolge), Offset (Abfahrt ab xx:00) und
 *   Dauer (Ankunft der letzten Haltestelle - Abfahrt der ersten) bestimmt.
 * Format B ('Fahrgastinformationen') wird bewusst übersprungen (z. B. L19 Kurs 5/6): dort bleiben
 * die bisher in fahrplan.json hinterlegten Umläufe unverändert erhalten, damit nichts kaputtgeht.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FP_PATH = path.join(DIR, 'fahrplan.json');

const HEADER_WORDS = new Set(['Art', 'Linie', 'Kurs', 'Start', 'Ziel', 'Bemerkungen', 'Leerfahrt', 'Haltestelle']);
const STOP_BREAK = new Set(['Art', 'ÖPNV Fahrt', 'Leerfahrt', 'Haltestelle', 'Wiederholend']);

function readCells(filePath) {
  const s = fs.readFileSync(filePath, 'utf8');
  return [...s.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
  );
}

function parseTime(c) {
  const m = String(c || '').trim().toLowerCase().match(/^(?:(\d{1,2})|xx):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[2], 10) + parseInt(m[1] || '0', 10) * 60;
}

/* Nächste "echte" Inhaltszelle ab Index i (überspringt Leerspalten und reine Header-Wörter). */
function nextCell(cells, i) {
  let j = i + 1;
  while (j < cells.length) {
    const c = cells[j];
    if (c && !HEADER_WORDS.has(c)) return { value: c, index: j };
    j++;
  }
  return { value: '', index: -1 };
}

/* Rollt die Zellen über einen 'ÖPNV Fahrt'-Block zur Endposition zurück. */
function findBlockEnd(cells, from) {
  let j = from;
  while (j < cells.length && cells[j] !== 'ÖPNV Fahrt' && cells[j] !== 'Leerfahrt') j++;
  return j;
}

/* Liest alle 'ÖPNV Fahrt'-Blöcke einer Format-A-Datei. Kopf + Haltestellenreihen je Fahrt. */
function parseFormatA(cells) {
  const blocks = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 'ÖPNV Fahrt') continue;
    const head = [];
    let j = i + 1;
    while (j < cells.length && cells[j] !== 'Haltestelle' && cells[j] !== 'ÖPNV Fahrt') {
      if (cells[j]) head.push(cells[j]);
      j++;
    }
    const stops = [];
    if (cells[j] === 'Haltestelle') {
      let k = j + 1;
      while (k < cells.length) {
        while (k < cells.length && !cells[k]) k++;
        const name = cells[k];
        if (!name || STOP_BREAK.has(name)) break;
        const an = parseTime(cells[k + 1]);
        const ab = parseTime(cells[k + 2]);
        if (an === null && ab === null) {
          k++;
          continue;
        }
        stops.push({ name, an, ab });
        k += 4;
      }
      j = k;
    }
    if (stops.length) blocks.push({ head, stops });
    if (j > i) i = j - 1;
  }
  return blocks;
}

/* Liest Kopf-Felder (Fahrzeug, Ausrücken) und Leerfahrt-Strecke einer Datei. */
function parseHeader(cells) {
  const out = { fahrzeug: '', ausruecken: '', leerfahrt_von: '', leerfahrt_nach: '' };
  const fzIdx = cells.indexOf('Fahrzeug');
  if (fzIdx >= 0) out.fahrzeug = String(cells[fzIdx + 1] || '');
  const ausIdx = cells.indexOf('Ausrücken');
  if (ausIdx >= 0) out.ausruecken = String(cells[ausIdx + 1] || '');
  const ldIdx = cells.indexOf('Leerfahrt');
  if (ldIdx >= 0) {
    const von = nextCell(cells, ldIdx);
    out.leerfahrt_von = von.value;
    if (von.index >= 0) {
      const nach = nextCell(cells, von.index);
      out.leerfahrt_nach = nach.value;
    }
  }
  return out;
}

/* Baut aus den Zellen die Kursnummer anhand des Dateinamens ('19 Kurs 2.html' -> kurs 2). */
function kursFromFile(name) {
  const m = String(name).match(/Kurs\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/* Normalisiert die Zeiten eines Blocks (XX:00 = :60 nach einem Rollover über Mitternacht). */
function normalizeTimes(stops) {
  let prev = -Infinity;
  for (const st of stops) {
    for (const k of ['an', 'ab']) {
      const v = st[k];
      if (v === null) continue;
      let w = v;
      if (w < prev) w += 60;
      st[k] = w;
      prev = w;
    }
  }
}

/* Baut aus den Blöcken eines Umlaufs die Trips (von/nach/offset/dauer/richtung). */
function tripsFor(blocks, hinVor, hinCode) {
  const trips = [];
  for (const bl of blocks) {
    const first = bl.stops[0];
    const last = bl.stops[bl.stops.length - 1];
    normalizeTimes(bl.stops);
    const t1 = first.ab !== null ? first.ab : first.an;
    const t2 = last.an !== null ? last.an : last.ab;
    if (t1 === null || t2 === null || t2 <= t1) continue;
    const startCode = (String(bl.head[2] || '').split('/').pop() || '').trim();
    let richtung = 'hin';
    if (hinCode && startCode) richtung = startCode === hinCode ? 'hin' : 'zurück';
    else richtung = hinVor && first.name === hinVor ? 'hin' : 'zurück';
    trips.push({
      richtung, von: first.name, nach: last.name, offset: t1, dauer: t2 - t1
    });
  }
  return trips;
}

/* Zentrale Parse-Funktion über alle HTML-Dateien im Fahrplan-Ordner. */
function parseHtmlKurse() {
  const files = fs.readdirSync(DIR).filter((f) => /\.html$/i.test(f));
  const groups = new Map(); // lineShort -> [{ kurs, header, blocks, fileName }]
  for (const f of files) {
    const lineShort = String(f).replace(/Kurs\s+\d+\.html$/i, '').replace(/^L\.?\s*/i, '').trim();
    const kurs = kursFromFile(f);
    if (!lineShort || kurs === null) continue;
    const cells = readCells(path.join(DIR, f));
    const header = parseHeader(cells);
    const blocks = parseFormatA(cells);
    const holder = groups.get(lineShort) || [];
    holder.push({ kurs, header, blocks, fileName: f });
    groups.set(lineShort, holder);
  }
  const res = new Map();
  for (const [short, holder] of groups) {
    holder.sort((a, b) => a.kurs - b.kurs);
    const anchor = holder.find((h) => h.blocks.length && h.blocks[0].stops.length);
    let hinVor = null, hinCode = '';
    if (anchor) {
      hinVor = anchor.blocks[0].stops[0].name;
      const h = anchor.blocks[0].head;
      if (h && h.length >= 3) hinCode = String(h[2] || '').split('/').pop().trim();
    }
    const kurses = holder.map((h) => ({ kurs: h.kurs, header: h.header, trips: tripsFor(h.blocks, hinVor, hinCode) }));
    res.set(short, kurses);
  }
  return res;
}

/* Schreibt die geparsten Kurse idempotent in fahrplan.json zurück.
 * - Format-A-Kurse werden ersetzt (echte Zeiten aus den HTMLs).
 * - Kurs-Dateien ohne ÖPNV-Fahrten (Format B) behalten ihre bisherigen Umläufe.
 * - Linien, für die keine HTMLs vorliegen, bleiben unangetastet.
 * Rückgabe: { changed, lines } mit Log-Zusammenfassung. */
function syncKurseFromHtml() {
  let fp;
  try {
    fp = JSON.parse(fs.readFileSync(FP_PATH, 'utf8'));
  } catch (e) {
    throw new Error('fahrplan.json nicht lesbar: ' + e.message);
  }
  const groups = parseHtmlKurse();
  let changed = 0;
  const lines = [];
  for (const [short, kurses] of groups) {
    if (!kurses.some((k) => k.trips.length)) continue;
    const line = (fp.lines || []).find((l) => String(l.short || l.line) === String(short));
    if (!line) continue;
    const prev = line.kurse || [];
    const next = prev.map((k) => ({ ...k }));
    let lineChanged = false;
    const kursSet = new Set(prev.map((k) => k.kurs));
    for (const k of kurses) {
      const entry = {
        kurs: k.kurs,
        fahrzeug: k.header.fahrzeug || '',
        ausruecken: k.header.ausruecken || '',
        leerfahrt_von: k.header.leerfahrt_von || '',
        leerfahrt_nach: k.header.leerfahrt_nach || '',
        faehrt: k.trips
      };
      if (!k.trips.length) continue; /* Format B (oder leere Datei): Bestand bleibt unangetastet */
      const oldIdx = next.findIndex((x) => x.kurs === k.kurs);
      if (oldIdx >= 0) {
        const old = next[oldIdx];
        const same = JSON.stringify(old.faehrt || []) === JSON.stringify(k.trips);
        if (!same) {
          next[oldIdx] = { ...old, ...entry, faehrt: k.trips, kurs: k.kurs };
          lineChanged = true;
        }
      } else {
        next.push(entry);
        kursSet.add(k.kurs);
        lineChanged = true;
      }
    }
    if (lineChanged) {
      line.kurse = next;
      changed++;
      lines.push(short + ": Kurs " + [...kursSet].sort((a, b) => a - b).join(','));
    }
  }
  if (changed) {
    const bak = FP_PATH + '.bak';
    try { fs.writeFileSync(bak, fs.readFileSync(FP_PATH)); } catch (e) { /* Backup übersprungen */ }
    fs.writeFileSync(FP_PATH, JSON.stringify(fp, null, 2));
  }
  return { changed, lines };
}

module.exports = { parseHtmlKurse, syncKurseFromHtml };
void parseHtmlKurse;