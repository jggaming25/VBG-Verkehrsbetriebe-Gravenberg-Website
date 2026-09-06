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
  return { lastRowId: res.lastInsertRowid, rowsAffected: res.rowsAffected };
}

async function hasColumn(table, column) {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => r.name === column);
}

async function init() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'besucher',
      verified INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      verify_code TEXT,
      discord_id TEXT UNIQUE,
      avatar TEXT,
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
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      time_start TEXT NOT NULL,
      time_end TEXT,
      image TEXT NOT NULL,
      host_id INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'offen',
      priority TEXT NOT NULL DEFAULT 'normal',
      user_id INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER REFERENCES users(id),
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT,
      attachment TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  /* ------------------------------ Nahverkehr (Fahrplan) ------------------------------ */
  await client.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line TEXT NOT NULL,
      course INTEGER NOT NULL,
      direction TEXT NOT NULL,
      seed_key TEXT UNIQUE
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS trip_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      stop_id INTEGER NOT NULL REFERENCES stops(id),
      arr_min INTEGER,
      dep_min INTEGER
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS trip_cancellations (
      trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS stop_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      stop_id INTEGER NOT NULL REFERENCES stops(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(trip_id, stop_id)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_a_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      trip_b_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      stop_id INTEGER NOT NULL REFERENCES stops(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(trip_a_id, trip_b_id, stop_id)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS connection_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      to_trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      stop_id INTEGER NOT NULL REFERENCES stops(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'offen',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_stops_trip_seq ON trip_stops (trip_id, seq)`);

  // Migrationen für ältere Schemas
  if (await hasColumn('users', 'password_hash') && !await hasColumn('users', 'discord_id')) {
    await client.execute(`ALTER TABLE users ADD COLUMN discord_id TEXT UNIQUE`);
  }
  if (!(await hasColumn('users', 'avatar'))) {
    await client.execute(`ALTER TABLE users ADD COLUMN avatar TEXT`);
  }
  if (!(await hasColumn('users', 'blocked'))) {
    await client.execute(`ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!(await hasColumn('shifts', 'host_id'))) {
    await client.execute(`ALTER TABLE shifts ADD COLUMN host_id INTEGER REFERENCES users(id)`);
  }
  if (!(await hasColumn('users', 'discord_roles'))) {
    await client.execute(`ALTER TABLE users ADD COLUMN discord_roles TEXT`);
  }
  if (!(await hasColumn('tickets', 'due_date'))) {
    await client.execute(`ALTER TABLE tickets ADD COLUMN due_date TEXT`);
  }
  if (!(await hasColumn('tickets', 'archive_token'))) {
    await client.execute(`ALTER TABLE tickets ADD COLUMN archive_token TEXT`);
  }
  if (!(await hasColumn('ticket_messages', 'attachment'))) {
    await client.execute(`ALTER TABLE ticket_messages ADD COLUMN attachment TEXT`);
  }
}

module.exports = { client, get, all, run, init };