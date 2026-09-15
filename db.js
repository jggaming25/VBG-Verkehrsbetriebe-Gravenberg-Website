const { createClient } = require('@libsql/client');

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

const DROP_TABLES = [
  'sessions', 'activity', 'inactivity', 'strafzeiten', 'assignments', 'signups',
  'dutys', 'shifts', 'news', 'linien', 'standorte', 'settings', 'users',
  'tickets', 'ticket_messages', 'connections', 'messages', 'avatar_cache',
  'fahrtausfaelle', 'notifications', 'announcements', 'fahrplan_cache', 'channels'
];

async function init() {
  let legacy = false;
  try {
    const cols = await tableInfo('users');
    if (cols.length && cols.some((c) => c.name === 'email')) legacy = true;
  } catch (e) { /* taegliche Tabelle existiert nicht */ }

  if (legacy) {
    for (const t of DROP_TABLES) {
      try { await client.execute(`DROP TABLE IF EXISTS ${t}`); } catch (e) { /* ignorieren */ }
    }
  }

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
    CREATE TABLE IF NOT EXISTS signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preferred_duty_ids TEXT NOT NULL DEFAULT '',
      preferred_ks_role TEXT DEFAULT '',
      volunteer_strafe INTEGER NOT NULL DEFAULT 0,
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
      ['Linie 19', '19', 1],
      ['SB27', 'SB27', 2],
      ['Linie 8', '8', 3],
      ['N1', 'N1', 4]
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
}

module.exports = { get, all, run, transaction, hasColumn: tableInfo, init };