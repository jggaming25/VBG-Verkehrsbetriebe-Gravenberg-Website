const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const url = process.env.TURSO_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient({ url, authToken });

async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return { lastRowId: Number(res.lastInsertRowid), rowsAffected: res.rowsAffected };
}

async function transaction(work) {
  const tx = await client.transaction('write');
  const t = {
    run: async (sql, args = []) => {
      const res = await tx.execute({ sql, args });
      return { lastRowId: Number(res.lastInsertRowid), rowsAffected: res.rowsAffected };
    },
    get: async (sql, args = []) => (await tx.execute({ sql, args })).rows[0] || null,
    all: async (sql, args = []) => (await tx.execute({ sql, args })).rows
  };
  try {
    await work(t);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function tableInfo(table) {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows;
}

async function addColumn(table, column, def) {
  const cols = await tableInfo(table);
  if (!cols.some((c) => c.name === column)) {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      console.log(`[migration] Spalte ${table}.${column} hinzugefügt`);
    } catch (e) {
      console.log(`[migration] Spalte ${table}.${column} ignorieren: ${e.message}`);
    }
  }
}

const DROP_TABLES = [
  'sessions', 'activity', 'inactivity', 'strafzeiten', 'assignments', 'signups',
  'dutys', 'fahrten', 'shifts', 'news', 'linien', 'standorte', 'settings', 'users',
  'tickets', 'ticket_messages', 'connections', 'messages', 'avatar_cache',
  'fahrtausfaelle', 'notifications', 'announcements', 'fahrplan_cache', 'channels'
];

async function dropAll() {
  try { await client.execute(`PRAGMA foreign_keys = OFF`); } catch (e) { /* ignorieren */ }
  for (const t of DROP_TABLES) {
    try { await client.execute(`DROP TABLE IF EXISTS ${t}`); } catch (e) { console.log('[migration] Drop ignoriert: ' + e.message); }
  }
  try { await client.execute(`PRAGMA foreign_keys = ON`); } catch (e) { /* ignorieren */ }
}

async function initOnce() {
  await client.execute(`PRAGMA foreign_keys = ON`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'busfahrer',
      licenses TEXT NOT NULL DEFAULT '',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      avatar TEXT,
      country_code TEXT DEFAULT '',
      language TEXT DEFAULT 'de',
      theme TEXT DEFAULT 'auto',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS linien (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    )
  `);

  await addColumn('linien', 'farbe', 'TEXT');
  await addColumn('linien', 'fahrzeugtyp', 'TEXT');
  await addColumn('linien', 'betrieb_von_wd', 'INTEGER');
  await addColumn('linien', 'betrieb_bis_wd', 'INTEGER');
  await addColumn('linien', 'betrieb_von_we', 'INTEGER');
  await addColumn('linien', 'betrieb_bis_we', 'INTEGER');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fahrzeuge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wagennummer TEXT,
      kennzeichen TEXT,
      typ TEXT NOT NULL DEFAULT 'solo',
      modell TEXT,
      bestand_seit TEXT,
      bestand_bis TEXT,
      status TEXT NOT NULL DEFAULT 'einsatzbereit',
      bemerkung TEXT,
      sort INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS standorte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      time_start TEXT NOT NULL,
      time_end TEXT,
      host_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await addColumn('shifts', 'linien', 'TEXT');
  await addColumn('shifts', 'auto_dienste', 'INTEGER');
  await addColumn('shifts', 'betrieb_von', 'TEXT');
  await addColumn('shifts', 'betrieb_bis', 'TEXT');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS dutys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bus',
      linie_id INTEGER REFERENCES linien(id),
      wechsel_from INTEGER REFERENCES linien(id),
      wechsel_to INTEGER REFERENCES linien(id),
      standort_id INTEGER REFERENCES standorte(id),
      fahrzeug TEXT,
      start TEXT,
      end TEXT,
      license_id INTEGER REFERENCES linien(id),
      note TEXT,
      sort INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fahrten (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duty_id INTEGER NOT NULL REFERENCES dutys(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      linie TEXT,
      kurs INTEGER,
      richtung TEXT,
      von TEXT,
      nach TEXT,
      start TEXT,
      end TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preferred_duty_ids TEXT NOT NULL DEFAULT '',
      preferred_ks_role TEXT DEFAULT '',
      volunteer_strafe INTEGER NOT NULL DEFAULT 0,
      strafe_abarbeitung INTEGER NOT NULL DEFAULT 0,
      preferred_standort_id INTEGER REFERENCES standorte(id),
      available_start TEXT,
      available_end TEXT,
      needs_senior INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'angemeldet',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await addColumn('signups', 'strafe_abarbeitung', 'INTEGER NOT NULL DEFAULT 0');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duty_id INTEGER NOT NULL REFERENCES dutys(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'haupt',
      status TEXT NOT NULL DEFAULT 'vorgeschlagen',
      source TEXT NOT NULL DEFAULT 'manual',
      grund TEXT,
      assigned_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
      duty_id INTEGER NOT NULL REFERENCES dutys(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      result TEXT NOT NULL,
      note TEXT,
      marked_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS inactivity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'offen',
      decision_note TEXT,
      decided_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS strafzeiten (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hours REAL NOT NULL,
      covered REAL NOT NULL DEFAULT 0,
      reason TEXT,
      entered_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id INTEGER REFERENCES users(id),
      pinned INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const settingsDefaults = {
    meldung_active: '0',
    meldung_text: '',
    signup_close_minutes: '60',
    staff_start_minutes: '30',
    strafe_schwelle_hours: '3',
    strafe_dauer_hours: '1.5',
    strafe_name: 'Kundenservice-Strafe',
    max_duty_wishes: '5'
  };
  for (const [k, v] of Object.entries(settingsDefaults)) {
    await client.execute(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
  }

  const linienCount = await get(`SELECT COUNT(*) AS n FROM linien`);
  if (!linienCount || linienCount.n === 0) {
    const seedLines = [
      ['Linie 19 · Stümp – Neuenburg – Gravenberg', '19', 1],
      ['Linie 24 · Sorenkoppel – Neuenburg – Gravenberg', '24', 2],
      ['Linie 8 · Gravenberg – Bergdorf', '8', 3],
      ['N1 · Gravenberg – Sorenkoppel (Nachtbus)', 'N1', 4]
    ];
    for (const l of seedLines) {
      await client.execute(`INSERT INTO linien (name, short, active, sort) VALUES (?, ?, 1, ?)`, l);
    }
  }

  const standortCount = await get(`SELECT COUNT(*) AS n FROM standorte`);
  if (!standortCount || standortCount.n === 0) {
    await client.execute(`INSERT INTO standorte (name, active, sort) VALUES ('Gravenberg ZOB', 1, 0)`);
  }

  const adminCount = await get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`);
  if (!adminCount || adminCount.n === 0) {
    const bcrypt = require('bcryptjs');
    const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    const oneTime = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(oneTime, 10);
    await client.execute(
      `INSERT INTO users (username, display_name, password_hash, role, licenses, must_change_password, active)
       VALUES (?, ?, ?, 'admin', '', 1, 1)`,
      [username, process.env.ADMIN_DISPLAYNAME || 'Administrator', hash]
    );
    console.log('[seed] Admin erstellt: Benutzername=' + username + ' Einmal-Passwort=' + oneTime + ' (bitte beim ersten Login ändern)');
  }

  try {
    await syncFahrplanFromJson();
  } catch (e) {
    console.log('[migration] Fahrplan-Sync übersprungen: ' + e.message);
  }
}

/* ------------------------- Fahrplan-Sync (fahrplaene/fahrplan.json) -------------------------
 * Stellt Linien-Metadaten (Farbe, Fahrzeugtyp, Betriebszeiten, Sortierung) und alle Fahrzeuge
 * aus der Quelle-of-Truth fahrplan.json bereit – bei jedem Start idempotent.
 * SB-Altkürzel (SB27/SB24) werden auf die aktuelle Linie 24 gemappt, damit Referenzen (Lizenzen) erhalten bleiben.
 */
const LEGACY_SHORTS = { '24': ['24', 'SB27', 'SB24'] };

async function syncFahrplanFromJson() {
  const jsonPath = path.join(__dirname, 'fahrplaene', 'fahrplan.json');
  let fp;
  try {
    fp = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    throw new Error('fahrplan.json nicht lesbar: ' + e.message);
  }

  const canons = new Map();
  for (const short of Object.keys(LEGACY_SHORTS)) {
    for (const alias of LEGACY_SHORTS[short]) canons.set(alias, short);
  }

  for (let i = 0; i < (fp.lines || []).length; i++) {
    const line = fp.lines[i];
    const short = String(line.short || line.line || '');
    if (!short) continue;
    const want = canons.get(short) || short;
    let row = null;
    const aliases = [want].concat(LEGACY_SHORTS[want] || []);
    for (const a of aliases) {
      row = await get(`SELECT * FROM linien WHERE LOWER(short) = LOWER(?)`, [a]);
      if (row) break;
    }
    if (!row) {
      const ins = await run(`INSERT INTO linien (name, short, active, sort) VALUES (?, ?, 1, ?)`,
        [line.name, want, i]);
      row = { id: ins.lastRowId };
    } else if (row.short !== want || row.name !== line.name) {
      await run(`UPDATE linien SET name = ?, short = ?, sort = ? WHERE id = ?`,
        [line.name, want, i, row.id]);
    } else if (row.sort !== i) {
      await run(`UPDATE linien SET sort = ? WHERE id = ?`, [i, row.id]);
    }
    await run(`UPDATE linien SET farbe = ?, fahrzeugtyp = ?, betrieb_von_wd = ?, betrieb_bis_wd = ?, betrieb_von_we = ?, betrieb_bis_we = ? WHERE id = ?`,
      [line.color || '', line.fahrzeugtyp || '', line.betrieb_von_wd, line.betrieb_bis_wd, line.betrieb_von_we, line.betrieb_bis_we, row.id]);
  }

  const fahrzeuge = fp.fahrzeuge || [];
  for (let i = 0; i < fahrzeuge.length; i++) {
    const fz = fahrzeuge[i];
    const wn = String(fz.wagennummer || '').trim();
    if (!wn) continue;
    const existing = await get(`SELECT id FROM fahrzeuge WHERE wagennummer = ?`, [wn]);
    const vals = [fz.kennzeichen || '', fz.typ || 'solo', fz.modell || '', fz.bestand_seit || '', fz.bestand_bis || '', fz.status || 'einsatzbereit', fz.bemerkung || ''];
    if (existing) {
      await run(`UPDATE fahrzeuge SET kennzeichen = ?, typ = ?, modell = ?, bestand_seit = ?, bestand_bis = ?, status = ?, bemerkung = ?, sort = ? WHERE id = ?`,
        [...vals, i, existing.id]);
    } else {
      await run(`INSERT INTO fahrzeuge (wagennummer, kennzeichen, typ, modell, bestand_seit, bestand_bis, status, bemerkung, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [wn, ...vals, i]);
    }
  }
  console.log('[seed] Fahrplan-Sync: ' + (fp.lines || []).length + ' Linien, ' + fahrzeuge.length + ' Fahrzeuge');
}

let initResolved = false;

async function init() {
  if (initResolved) return;
  let stale = false;
  try {
    const cols = await tableInfo('users');
    if (cols.length && cols.every((c) => c.name !== 'display_name')) stale = true;
  } catch (e) { /* Tabelle existiert noch nicht */ }

  if (stale) {
    console.log('[migration] Altes users-Schema erkannt – Datenbank wird komplett neu aufgebaut');
    await dropAll();
  }

  try {
    await initOnce();
  } catch (e) {
    const msg = e && e.message ? e.message : '';
    if (/no column named|no such table|duplicate column name/i.test(msg)) {
      console.log('[migration] Schema fehlerhaft (' + msg + ') – Datenbank wird komplett neu aufgebaut');
      await dropAll();
      await initOnce();
    } else {
      throw e;
    }
  }
  initResolved = true;
}

module.exports = { get, all, run, transaction, hasColumn: tableInfo, init, syncFahrplanFromJson };
