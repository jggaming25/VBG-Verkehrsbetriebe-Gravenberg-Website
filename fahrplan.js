/* Fahrplan-Modul: liest fahrplaene/fahrplan.json, berechnet den Kalendertyp für einen Tag
 * (Werktag / Wochenende / Feiertag / Ferien) und baut daraus den Dienstplan für eine Shift.
 *
 * Dienstplan-Regeln (Fahrplanblatt):
 *   - Eine Fahrt = eine einzelne Fahrtstrecke (z. B. Kurs 1 Linie 19 von Stümp → ZOB).
 *   - Ein Dienst = bis zu MAX_FAHRTEN Fahrten, davon höchstens MAX_SELBE_LINIE in Folge auf
 *     derselben Linie (danach Linienwechsel, wenn eine andere Linie frei ist).
 */
const path = require('path');
const fs = require('fs');

const JSON_PATH = path.join(__dirname, 'fahrplaene', 'fahrplan.json');

const MAX_FAHRTEN = 9;
const MAX_SELBE_LINIE = 5;

let cached = null;
function getFahrplan() {
  if (!cached) {
    cached = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  }
  return cached;
}

function getLine(short) {
  const fp = getFahrplan();
  return (fp.lines || []).find((l) => (l.short || l.line) === String(short)) || null;
}

function toYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Kalendertyp für einen Tag: werktag | wochenende | feiertag | ferien */
function getKalenderTyp(dateStr) {
  const fp = getFahrplan();
  if ((fp.feiertage || []).some((f) => f.datum === dateStr)) return 'feiertag';
  if ((fp.ferien_sh || []).some((f) => dateStr >= f.von && dateStr <= f.bis)) return 'ferien';
  if ((fp.ferien_st || []).some((f) => dateStr >= f.von && dateStr <= f.bis)) return 'ferien';
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return dow >= 1 && dow <= 5 ? 'werktag' : 'wochenende';
}

function isWeKalender(typ) {
  return typ !== 'werktag';
}

function toMinutes(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/* Erzeugt alle Fahrten einer Linie im Zeitfenster [startMin, endMin] des Shifts.
 * Fahrten-Objekt: { t (Minuten ab Mitternacht von Tag 0), day, richtung, von, nach, dauer }.
 * Über-Mitternachts-Linien (N1) erzeugen Fahrten an Tag 0 (bis 24h) und Tag 1 (ab 0h). */
function tripTimesForLine(line, startMin, endMin) {
  const von = line.betrieb_von_wd;
  const bis = line.betrieb_bis_wd;
  const night = von > bis;
  // Offset der ersten Fahrt des ersten Kurses öffnet das Nachtfenster (z. B. N1 hin :20).
  const firstOffset = (line.kurse && line.kurse[0] && line.kurse[0].faehrt && line.kurse[0].faehrt[0]) ? line.kurse[0].faehrt[0].offset : 20;
  const trips = [];
  const beideTage = night ? 2 : 1;
  for (let day = 0; day < beideTage; day++) {
    const hStart = day === 0 ? von : 0;
    const hEnd = day === 0 ? (night ? 24 : bis + 1) : bis + 1;
    const base = day * 1440;
    for (let h = hStart; h < hEnd; h++) {
      for (const kurs of line.kurse || []) {
        for (const f of kurs.faehrt || []) {
          if (night && day === 0 && f.offset < firstOffset) continue;
          const t = base + h * 60 + f.offset;
          if (night && day === 0 && t < von * 60) continue;
          trips.push({ day, t, kurs: kurs.kurs, richtung: f.richtung, von: f.von, nach: f.nach, dauer: f.dauer });
        }
      }
    }
  }
  const s = startMin, e = endMin;
  const normal = s === null || e === null || s <= e;
  return trips.filter((x) => {
    const t = x.t;
    if (normal) {
      if (x.day > 0) return false;
      return t >= (s == null ? 0 : s) && t <= (e == null ? 1439 : e);
    }
    if (x.day === 0) return t >= s;
    return t - 1440 <= e;
  });
}

/* Aus allen Linien erweiterte, zeitlich sortierte Fahrtliste. */
function expandShiftTrips(linien, dateStr, startMin, endMin) {
  const fp = getFahrplan();
  const kalTyp = getKalenderTyp(dateStr);
  const out = [];
  for (const short of linien) {
    const line = getLine(short);
    if (!line) continue;
    // Betriebszeiten nach Kalendertyp
    const von = isWeKalender(kalTyp) ? line.betrieb_von_we : line.betrieb_von_wd;
    const bis = isWeKalender(kalTyp) ? line.betrieb_bis_we : line.betrieb_bis_wd;
    const trips = tripTimesForLine({ ...line, betrieb_von_wd: von, betrieb_bis_wd: bis }, startMin, endMin);
    for (const x of trips) {
      out.push({
        line: (line.short || line.line),
        lineName: line.name,
        color: line.color || '',
        kurs: x.kurs,
        day: x.day,
        start: x.t,
        dauer: x.dauer,
        end: x.t + x.dauer,
        richtung: x.richtung,
        von: x.von,
        nach: x.nach,
        kalTop: kalTyp
      });
    }
  }
  return out.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.start - b.start));
}

function fmtMin(t) {
  const day = Math.floor(t / 1440);
  const m = t % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return (day > 0 ? 'Tag ' + (day + 1) + ' ' : '') + hh + ':' + mm;
}

/* Greedy-Schichtplanung: Fahrten werden chronologisch auf offene Dienste verteilt.
 *  - Ein Dienst nimmt maximal MAX_FAHRTEN Fahrten auf.
 *  - Höchstens MAX_SELBE_LINIE Fahrten in Folge derselben Linie; danach wird eine andere
 *    Linie bevorzugt (Linienwechsel). Ist keine andere Linie im Zeitfenster frei, wird die
 *    gleiche gefahren (notwendig, damit alle Fahrten besetzt sind).
 *  - Anschluss-Regel: Der nächste Fahrtstart darf nicht vor dem Ende der letzten Fahrt liegen.
 *    Bei gleichem Start ist eine Übernahme nur am selben Ort (von == letztes nach) möglich –
 *    so bleiben Fahrzeuge, nicht imaginäre Standorte, die Basis.
 * Rückgabe: Array von Diensten { code, linie (dominante Linie), start, end, note, farbe, fahrten }.
 */
function buildDienstplan(trips) {
  const dienste = [];

  // Gibt es im restlichen Zeitfenster überhaupt eine Fahrt einer anderen Linie?
  const hatAndereLinie = (d, trip) =>
    trips.some((o) => o.start >= d.lastEnd && o.line !== d.lastLine && o.start !== trip.start);

  const kannAnschliessen = (d, trip) => {
    if (d.lastEnd > trip.start) return false;
    if (d.count >= MAX_FAHRTEN) return false;
    if (d.lastEnd < trip.start) return true;
    return d.lastNach === trip.von;
  };

  for (const trip of trips) {
    const cand = dienste.filter((d) =>
      kannAnschliessen(d, trip) &&
      (d.lastLine !== trip.line || d.consec < MAX_SELBE_LINIE || !hatAndereLinie(d, trip))
    );
    let pick = null;
    if (cand.some((d) => d.kursKey === trip.line + ':' + trip.kurs)) {
      pick = cand.filter((d) => d.kursKey === trip.line + ':' + trip.kurs).sort((a, b) => b.lastEnd - a.lastEnd)[0];
    } else if (cand.length) {
      pick = cand.sort((a, b) => b.lastEnd - a.lastEnd)[0];
    }
    if (!pick) {
      pick = {
        code: 'D' + (dienste.length + 1),
        trips: [],
        count: 0,
        lastLine: null,
        lastKurs: null,
        kursKey: '',
        lastNach: '',
        consec: 0,
        lastEnd: -9999,
        lineCounts: {}
      };
      dienste.push(pick);
    }
    pick.trips.push(trip);
    pick.count++;
    pick.lastEnd = trip.end;
    pick.lastNach = trip.nach;
    pick.lineCounts[trip.line] = (pick.lineCounts[trip.line] || 0) + 1;
    if (pick.lastLine === trip.line) pick.consec++;
    else pick.consec = 1;
    pick.lastLine = trip.line;
    pick.lastKurs = trip.kurs;
    pick.kursKey = trip.line + ':' + trip.kurs;
  }

  const result = dienste.map((d) => {
    const sorted = d.trips.slice().sort((a, b) => (a.day !== b.day ? a.day - b.day : a.start - b.start));
    let mainLine = null, best = 0;
    for (const k of Object.keys(d.lineCounts)) {
      if (d.lineCounts[k] > best) { best = d.lineCounts[k]; mainLine = k; }
    }
    const start = sorted[0];
    const ende = sorted[sorted.length - 1];
    // Linien, die im Dienst vorkommen (für Anzeige)
    const linien = Object.keys(d.lineCounts);
    const noteLines = sorted.map((x) =>
      '  ' + fmtMin(x.start) + ' Uhr · L' + x.line + ' Kurs ' + x.kurs + ' · ' + x.richtung +
      ' von ' + x.von + ' nach ' + x.nach);
    return {
      code: d.code,
      linie: mainLine,
      linien,
      linieName: start.lineName,
      color: start.color || '',
      start: fmtMin(start.start),
      end: fmtMin(ende.end),
      startAbs: start.start,
      endAbs: ende.end,
      fahrten: sorted.map((x) => ({
        zeit: fmtMin(x.start),
        ende: fmtMin(x.end),
        linie: x.line,
        kurs: x.kurs,
        richtung: x.richtung,
        von: x.von,
        nach: x.nach
      })),
      note: 'Dienst ' + d.code + ' (max. ' + MAX_FAHRTEN + ' Fahrten, max. ' + MAX_SELBE_LINIE + ' auf derselben Linie):\n' + noteLines.join('\n')
    };
  });
  return result;
}

module.exports = {
  JSON_PATH,
  MAX_FAHRTEN,
  MAX_SELBE_LINIE,
  getFahrplan,
  getLine,
  getKalenderTyp,
  toMinutes,
  expandShiftTrips,
  buildDienstplan
};