const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const fahrplan = require('./fahrplan');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

app.use('/IMGs', express.static(path.join(ROOT, 'IMGs')));
app.use(express.static(PUBLIC));

const COOKIE = { signed: false, sameSite: 'lax', path: '/' };

function cookieOpts(secure) {
  return { ...COOKIE, secure: !!secure };
}

async function getSettings(t) {
  const rows = await db.all(`SELECT key, value FROM settings`);
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    meldung_active: s.meldung_active === '1',
    meldung_text: s.meldung_text || '',
    signup_close_minutes: parseInt(s.signup_close_minutes || '60', 10),
    staff_start_minutes: parseInt(s.staff_start_minutes || '30', 10),
    strafe_schwelle_hours: parseFloat(s.strafe_schwelle_hours || '3'),
    strafe_dauer_hours: parseFloat(s.strafe_dauer_hours || '1.5'),
    strafe_name: s.strafe_name || 'Kundenservice-Strafe',
    max_duty_wishes: parseInt(s.max_duty_wishes || '5', 10)
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    role: u.role,
    licenses: (u.licenses || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)),
    must_change_password: !!u.must_change_password,
    active: !!u.active,
    avatar: u.avatar || '',
    country_code: u.country_code || '',
    language: u.language || 'de',
    theme: u.theme || 'auto',
    created_at: u.created_at
  };
}

async function loadUser(id) {
  return db.get(`SELECT * FROM users WHERE id = ?`, [id]);
}

async function authUser(req) {
  const token = req.cookies && req.cookies.vbg_sid;
  if (!token) return { user: null, token: null };
  const session = await db.get(`SELECT * FROM sessions WHERE token = ?`, [token]);
  if (!session) return { user: null, token: null };
  const u = await loadUser(session.user_id);
  if (!u || !u.active) return { user: null, token: null };
  return { user: u, token };
}

function csrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

function bearerToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function requireAuth(req, res, next) {
  const { user } = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  req.user = user;
  next();
}

function requireScheduler(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'senior') {
    return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur für Administratoren.' });
  }
  next();
}

function csrfCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const header = req.get('x-csrf-token');
  const cookie = req.cookies && req.cookies.vbg_csrf;
  if (!header || !cookie || header !== cookie) {
    return res.status(403).json({ error: 'Ungültiges CSRF-Token. Seite neu laden?' });
  }
  next();
}

app.use('/api', csrfCheck);

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/session', async (req, res) => {
  const { user } = await authUser(req);
  const settings = await getSettings();
  const token = csrfToken();
  res.cookie('vbg_csrf', token, cookieOpts(req.secure));
  res.json({ user: publicUser(user), csrf: token, settings: {
    meldung_active: settings.meldung_active,
    meldung_text: settings.meldung_text,
    strafe_name: settings.strafe_name
  } });
});

/* ------------------------------- Auth ------------------------------- */

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort angeben.' });
  const u = await db.get(`SELECT * FROM users WHERE LOWER(username) = ?`, [username]);
  if (!u || !u.password_hash) return res.status(400).json({ error: 'Benutzername oder Passwort ist falsch.' });
  if (!u.active) return res.status(403).json({ error: 'Dieses Konto ist gesperrt.' });
  const okPw = await bcrypt.compare(password, u.password_hash);
  if (!okPw) return res.status(400).json({ error: 'Benutzername oder Passwort ist falsch.' });
  const token = bearerToken();
  await db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, u.id]);
  res.cookie('vbg_sid', token, cookieOpts(req.secure));
  const s = await getSettings();
  const csrf = csrfToken();
  res.cookie('vbg_csrf', csrf, cookieOpts(req.secure));
  res.json({ user: publicUser(u), csrf, settings: { meldung_active: s.meldung_active, meldung_text: s.meldung_text, strafe_name: s.strafe_name } });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.cookies.vbg_sid;
  if (token) await db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  res.clearCookie('vbg_sid', { path: '/' });
  res.cookie('vbg_csrf', csrfToken(), cookieOpts(req.secure));
  res.json({ ok: true });
});

app.post('/api/password', requireAuth, async (req, res) => {
  const cur = String(req.body.current_password || '');
  const nw = String(req.body.new_password || '');
  const rp = String(req.body.new_password_repeat || '');
  if (nw.length < 6) return res.status(400).json({ error: 'Das neue Passwort muss mindestens 6 Zeichen haben.' });
  if (nw !== rp) return res.status(400).json({ error: 'Die Passwörter stimmen nicht überein.' });
  const okPw = await bcrypt.compare(cur, req.user.password_hash);
  if (!okPw) return res.status(400).json({ error: 'Das aktuelle Passwort ist falsch.' });
  const hash = await bcrypt.hash(nw, 10);
  await db.run(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/password/first', requireAuth, async (req, res) => {
  const nw = String(req.body.new_password || '');
  const rp = String(req.body.new_password_repeat || '');
  if (nw.length < 6) return res.status(400).json({ error: 'Das Passwort muss mindestens 6 Zeichen haben.' });
  if (nw !== rp) return res.status(400).json({ error: 'Die Passwörter stimmen nicht überein.' });
  const hash = await bcrypt.hash(nw, 10);
  await db.run(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const display_name = String(req.body.display_name || '').trim().slice(0, 40);
  const avatar = String(req.body.avatar || '').slice(0, 6000000);
  const country_code = String(req.body.country_code || '').slice(0, 4);
  const language = String(req.body.language || 'de') === 'en' ? 'en' : 'de';
  const theme = ['light', 'dark', 'auto'].includes(req.body.theme) ? req.body.theme : 'auto';
  await db.run(`UPDATE users SET display_name = ?, avatar = ?, country_code = ?, language = ?, theme = ? WHERE id = ?`,
    [display_name || req.user.username, avatar, country_code, language, theme, req.user.id]);
  const u = await loadUser(req.user.id);
  res.json({ user: publicUser(u) });
});

/* ------------------------------ Stammdaten ------------------------------ */

app.get('/api/linien', async (req, res) => {
  const rows = await db.all(`SELECT * FROM linien WHERE active = 1 ORDER BY sort, name`);
  res.json({ linien: rows });
});

app.get('/api/standorte', async (req, res) => {
  const rows = await db.all(`SELECT * FROM standorte WHERE active = 1 ORDER BY sort, name`);
  res.json({ standorte: rows });
});

/* --------------------------------- News --------------------------------- */

app.get('/api/news', async (req, res) => {
  const rows = await db.all(`
    SELECT n.*, u.username AS author
    FROM news n LEFT JOIN users u ON u.id = n.author_id
    WHERE n.active = 1 ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`);
  res.json({ news: rows });
});

app.get('/api/images', (req, res) => {
  const dir = path.join(ROOT, 'IMGs');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort(); } catch (e) { /* Ordner fehlt */ }
  res.json({ images: files });
});

/* ------------------------------ Shifts & Duty ------------------------------ */

function shiftRow(r) {
  if (!r) return null;
  let linien = [];
  try { linien = r.linien ? JSON.parse(r.linien) : []; } catch (e) { /* ignoriert */ }
  return {
    id: r.id, title: r.title, description: r.description, date: r.date,
    time_start: r.time_start, time_end: r.time_end,
    host_id: r.host_id, host: r.host || '', status: r.status, created_at: r.created_at,
    linien,
    auto_dienste: !!r.auto_dienste,
    betrieb_von: r.betrieb_von || '',
    betrieb_bis: r.betrieb_bis || ''
  };
}

async function listShifts(withHost) {
  const h = withHost ? ', (SELECT username FROM users WHERE id = shifts.host_id) AS host' : '';
  return db.all(`SELECT shifts.*${h} FROM shifts ORDER BY shifts.date DESC, shifts.time_start DESC, shifts.id DESC`);
}

function signupState(shift, settings, nowIso) {
  if (shift.status !== 'published') return 'entwurf';
  const start = new Date(shift.date + 'T' + (shift.time_start || '00:00'));
  if (nowIso > start) return 'vorbei';
  const closeMs = (settings.signup_close_minutes || 60) * 60000;
  const closeAt = new Date(start.getTime() - closeMs);
  return nowIso < closeAt ? 'offen' : 'geschlossen';
}

function dutyFull(row) {
  return {
    id: row.id, shift_id: row.shift_id, code: row.code, type: row.type,
    linie_id: row.linie_id, linie: row.linie || '',
    wechsel_from: row.wechsel_from, wechsel_to: row.wechsel_to,
    wechsel_from_name: row.wechsel_from_name || '', wechsel_to_name: row.wechsel_to_name || '',
    standort_id: row.standort_id, standort: row.standort || '',
    fahrzeug: row.fahrzeug || '', start: row.start, end: row.end,
    license_id: row.license_id, license: row.license_name || '',
    note: row.note || '', sort: row.sort
  };
}

const DUTY_SELECT = `
  SELECT d.*, l.name AS linie,
         wf.name AS wechsel_from_name, wt.name AS wechsel_to_name,
         st.name AS standort, lg.name AS license_name
  FROM dutys d
  LEFT JOIN linien l ON l.id = d.linie_id
  LEFT JOIN linien wf ON wf.id = d.wechsel_from
  LEFT JOIN linien wt ON wt.id = d.wechsel_to
  LEFT JOIN standorte st ON st.id = d.standort_id
  LEFT JOIN linien lg ON lg.id = d.license_id`;

async function dutiesForShift(shiftId) {
  const rows = await db.all(`${DUTY_SELECT} WHERE d.shift_id = ? ORDER BY d.start, d.sort, d.id`, [shiftId]);
  const duties = rows.map(dutyFull);
  await attachFahrten(duties);
  return duties;
}

async function attachFahrten(duties) {
  if (!duties.length) return duties;
  const ids = duties.map((d) => d.id);
  const rows = await db.all(
    `SELECT * FROM fahrten WHERE duty_id IN (${ids.map(() => '?').join(',')}) ORDER BY duty_id, seq`,
    ids
  );
  const byDuty = {};
  for (const f of rows) (byDuty[f.duty_id] = byDuty[f.duty_id] || []).push(f);
  for (const d of duties) d.fahrten = byDuty[d.id] || [];
  return duties;
}

async function assignmentsForShift(shiftId) {
  return db.all(`
    SELECT a.*, d.shift_id, d.code AS duty_code, d.start AS duty_start, d.end AS duty_end, d.type AS duty_type,
           u.username, u.display_name
    FROM assignments a
    JOIN dutys d ON d.id = a.duty_id
    JOIN users u ON u.id = a.user_id
    WHERE d.shift_id = ?
    ORDER BY d.start, d.id`, [shiftId]);
}

app.get('/api/shifts', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const nowIso = new Date();
  const rows = await listShifts(true);
  const shifts = rows.map((r) => ({ ...shiftRow(r), signup_state: signupState(r, settings, nowIso) }));
  res.json({ shifts });
});

app.get('/api/dienstplan', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const now = new Date();
  const rows = await listShifts(true);
  const selectable = rows.filter((r) => r.status === 'published' || req.user.role === 'admin' || req.user.role === 'senior');
  let shiftId = parseInt(req.query.shift_id, 10);
  const visible = selectable.find((r) => r.id === shiftId);
  const target = visible || selectable.filter((r) => r.status === 'published')[0] || selectable[0] || null;
  if (!target) return res.json({ shift: null, duties: [], assignments: [], shifts: selectable.map(shiftRow), canManage: ['admin', 'senior'].includes(req.user.role) });
  const duties = await dutiesForShift(target.id);
  const assignments = (await assignmentsForShift(target.id)).map((a) => ({
    id: a.id, duty_id: a.duty_id, user_id: a.user_id, kind: a.kind, status: a.status, source: a.source,
    username: a.username, display_name: a.display_name
  }));
  const users = ['admin', 'senior'].includes(req.user.role)
    ? (await db.all(`SELECT id, username, display_name, role, licenses FROM users WHERE active = 1 ORDER BY username`)).map((u) => ({ ...u, licenses: (u.licenses || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)) }))
    : [];
  res.json({
    shift: shiftRow(target),
    duties,
    assignments,
    shifts: selectable.map(shiftRow),
    canManage: ['admin', 'senior'].includes(req.user.role),
    users,
    signup_state: signupState(target, settings, now),
    settings
  });
});

app.get('/api/meine-dienste', requireAuth, async (req, res) => {
  const rows = await listShifts(true);
  const shifts = rows.map(shiftRow);
  const assignments = await db.all(`
    SELECT a.*, d.code AS duty_code, d.start AS duty_start, d.end AS duty_end, d.type AS duty_type,
           d.shift_id, s.title AS shift_title, s.date AS shift_date,
           l.name AS linie, st.name AS standort,
           wf.name AS wechsel_from_name, wt.name AS wechsel_to_name, fz.fahrzeug
    FROM assignments a
    JOIN dutys d ON d.id = a.duty_id
    JOIN shifts s ON s.id = d.shift_id
    LEFT JOIN linien l ON l.id = d.linie_id
    LEFT JOIN linien wf ON wf.id = d.wechsel_from
    LEFT JOIN linien wt ON wt.id = d.wechsel_to
    LEFT JOIN standorte st ON st.id = d.standort_id
    LEFT JOIN dutys fz ON fz.id = d.id
    WHERE a.user_id = ? AND a.status = 'bestaetigt'
    ORDER BY d.start`, [req.user.id]);
  res.json({
    shifts,
    assignments: assignments.map((a) => ({
      id: a.id, duty_id: a.duty_id, shift_id: a.shift_id, shift_title: a.shift_title, shift_date: a.shift_date,
      code: a.duty_code, start: a.duty_start, end: a.duty_end, type: a.duty_type,
      linie: a.linie, standort: a.standort, wechsel_from_name: a.wechsel_from_name, wechsel_to_name: a.wechsel_to_name,
      kind: a.kind, status: a.status, fahrzeug: a.fahrzeug
    }))
  });
});

/* ------------------------------- Anmeldung ------------------------------- */

app.get('/api/anmeldung', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const now = new Date();
  const rows = await listShifts(false);
  const openShifts = rows.filter((r) => r.status === 'published' && signupState(r, settings, now) === 'offen');
  const mySignups = await db.all(`
    SELECT sg.*, s.title AS shift_title, s.date AS shift_date, s.time_start AS shift_start, s.time_end AS shift_end,
           s.status AS shift_status
    FROM signups sg JOIN shifts s ON s.id = sg.shift_id
    WHERE sg.user_id = ? ORDER BY s.date DESC, s.time_start DESC`, [req.user.id]);
  const dutiesByShift = {};
  for (const sh of [...openShifts, ...rows.filter((r) => (mySignups || []).some((m) => m.shift_id === r.id))]) {
    dutiesByShift[sh.id] = await dutiesForShift(sh.id);
  }
  const standorte = await db.all(`SELECT * FROM standorte WHERE active = 1 ORDER BY sort, name`);
  const linien = await db.all(`SELECT * FROM linien WHERE active = 1 ORDER BY sort, name`);
  res.json({
    open_shifts: openShifts.map(shiftRow),
    signups: mySignups.map((s) => ({
      id: s.id, shift_id: s.shift_id, shift_title: s.shift_title, shift_date: s.shift_date,
      shift_start: s.shift_start, shift_end: s.shift_end, shift_status: s.shift_status,
      preferred_duty_ids: (s.preferred_duty_ids || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)),
      preferred_ks_role: s.preferred_ks_role || '',
      volunteer_strafe: !!s.volunteer_strafe,
      preferred_standort_id: s.preferred_standort_id || null,
      available_start: s.available_start || '', available_end: s.available_end || '',
      needs_senior: !!s.needs_senior, note: s.note || '', status: s.status
    })),
    duties_by_shift: dutiesByShift,
    standorte, linien,
    settings
  });
});

app.post('/api/anmeldung', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const shiftId = parseInt(req.body.shift_id, 10);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);
  if (!shift || shift.status !== 'published') return res.status(400).json({ error: 'Shift nicht gefunden.' });
  if (signupState(shift, settings, new Date()) !== 'offen') return res.status(400).json({ error: 'Die Anmeldung für diese Shift ist geschlossen.' });

  const rawWish = Array.isArray(req.body.preferred_duty_ids) ? req.body.preferred_duty_ids : [];
  const maxWish = settings.max_duty_wishes;
  const wished = rawWish.slice(0, maxWish).map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x > 0);
  const dutyIds = await db.all(`SELECT id FROM dutys WHERE shift_id = ?`, [shiftId]);
  const validSet = new Set(dutyIds.map((d) => d.id));
  const preferred_duty_ids = [...new Set(wished.filter((x) => validSet.has(x)))].slice(0, maxWish);
  const preferred_ks_role = String(req.body.preferred_ks_role || '').slice(0, 60);
  const volunteer_strafe = req.body.volunteer_strafe ? 1 : 0;
  const preferred_standort_id = parseInt(req.body.preferred_standort_id || '0', 10) || null;
  const available_start = String(req.body.available_start || '').slice(0, 20);
  const available_end = String(req.body.available_end || '').slice(0, 20);
  const needs_senior = req.body.needs_senior ? 1 : 0;
  const note = String(req.body.note || '').trim().slice(0, 500);

  const existing = await db.get(`SELECT id FROM signups WHERE shift_id = ? AND user_id = ?`, [shiftId, req.user.id]);
  if (existing) {
    await db.run(`
      UPDATE signups SET preferred_duty_ids = ?, preferred_ks_role = ?, volunteer_strafe = ?, preferred_standort_id = ?,
      available_start = ?, available_end = ?, needs_senior = ?, note = ?, updated_at = datetime('now')
      WHERE id = ?`,
      [preferred_duty_ids.join(','), preferred_ks_role, volunteer_strafe, preferred_standort_id, available_start, available_end, needs_senior, note, existing.id]);
  } else {
    await db.run(`
      INSERT INTO signups (shift_id, user_id, preferred_duty_ids, preferred_ks_role, volunteer_strafe, preferred_standort_id, available_start, available_end, needs_senior, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shiftId, req.user.id, preferred_duty_ids.join(','), preferred_ks_role, volunteer_strafe, preferred_standort_id, available_start, available_end, needs_senior, note]);
  }
  res.json({ ok: true });
});

app.delete('/api/anmeldung/:shiftId', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const shiftId = parseInt(req.params.shiftId, 10);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);
  if (!shift) return res.status(400).json({ error: 'Shift nicht gefunden.' });
  if (shift.status === 'published' && signupState(shift, settings, new Date()) !== 'offen') {
    return res.status(400).json({ error: 'Die Anmeldung ist bereits geschlossen.' });
  }
  const confirmed = await db.get(`
    SELECT a.id FROM assignments a JOIN dutys d ON d.id = a.duty_id
    WHERE d.shift_id = ? AND a.user_id = ? AND a.status = 'bestaetigt'`, [shiftId, req.user.id]);
  if (confirmed) return res.status(400).json({ error: 'Für diese Shift bist du bereits fest eingeteilt. Wende dich an die Leitung.' });
  await db.run(`DELETE FROM signups WHERE shift_id = ? AND user_id = ?`, [shiftId, req.user.id]);
  res.json({ ok: true });
});

/* -------------------------------- Autoshift -------------------------------- */

function eligibleForDuty(user, duty, signup, assignedRanges, inactivityRanges) {
  if (!user.active) return false;
  if (duty.license_id) {
    const lic = (user.licenses || '').split(',').filter(Boolean).map((x) => parseInt(x, 10));
    if (!lic.includes(duty.license_id)) return false;
  }
  if (!duty.start) return true;
  const dStart = new Date(duty.start + ':00');
  if (isNaN(dStart)) return false;
  const dday = duty.start.slice(0, 10);
  if (inactivityRanges.some((r) => dday >= r.start && dday <= r.end)) return false;
  if (signup.available_start && signup.available_end) {
    if (dStart < new Date(signup.available_start + ':00') || dStart >= new Date(signup.available_end + ':00')) return false;
  }
  const range = { start: dStart, end: new Date(duty.end + ':00') };
  return !assignedRanges.some((r) => range.start < r.end && r.start < range.end);
}

async function inactivityRangesFor(userId) {
  const rows = await db.all(`SELECT start_date, end_date FROM inactivity WHERE user_id = ? AND status = 'genehmigt'`, [userId]);
  return rows;
}

async function runAutoshift(shiftId, actor) {
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);
  if (!shift) return { error: 'Shift nicht gefunden.' };
  const duties = await dutiesForShift(shiftId);
  const signupRows = await db.all(`
    SELECT sg.*, u.id AS uid, u.active, u.licenses, u.username, u.display_name, u.role
    FROM signups sg JOIN users u ON u.id = sg.user_id
    WHERE sg.shift_id = ? AND sg.status = 'angemeldet' AND u.active = 1
    ORDER BY sg.created_at ASC, sg.id ASC`, [shiftId]);
  const confirmed = await db.all(`
    SELECT a.* FROM assignments a JOIN dutys d ON d.id = a.duty_id
    WHERE d.shift_id = ? AND a.status = 'bestaetigt'`, [shiftId]);

  await db.run(`DELETE FROM assignments WHERE status = 'vorgeschlagen' AND duty_id IN (SELECT id FROM dutys WHERE shift_id = ?)`, [shiftId]);

  const busyMap = new Map();
  const slotMap = new Map();
  for (const a of confirmed) {
    const key = a.duty_id + ':' + a.kind;
    slotMap.set(key, a);
    busyMap.set(a.user_id, [...(busyMap.get(a.user_id) || []), {
      start: new Date((a.duty_start || '') + ':00'), end: new Date((a.duty_end || '') + ':00')
    }]);
  }

  const perUser = new Map();
  for (const sg of signupRows) {
    perUser.set(sg.user_id, {
      row: sg,
      wishes: (sg.preferred_duty_ids || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)),
      assigned: [],
      ranges: busyMap.get(sg.user_id) || []
    });
  }

  const insert = async (duty, user, kind) => {
    await db.run(`INSERT INTO assignments (duty_id, user_id, kind, status, source, assigned_by) VALUES (?, ?, ?, 'vorgeschlagen', 'autoshift', ?)`,
      [duty.id, user.user_id, kind, actor.id]);
    const pu = perUser.get(user.user_id);
    pu.assigned.push(duty.id);
    pu.ranges.push({ start: new Date((duty.start || '') + ':00'), end: new Date((duty.end || '') + ':00') });
    slotMap.set(duty.id + ':' + kind, { user_id: user.user_id });
  };

  const strafeDuties = duties.filter((d) => d.type === 'strafe');
  const scheduleDuties = duties.filter((d) => d.type !== 'strafe');

  for (const sg of signupRows) {
    const pu = perUser.get(sg.user_id);
    const inact = await inactivityRangesFor(sg.user_id);
    pu.inact = inact;
    for (const duty of scheduleDuties) {
      const cand = eligibleForDuty(pu.row, duty, sg, pu.ranges, inact);
      pu['d_' + duty.id] = cand;
    }
  }

  const maxWish = Math.max(...signupRows.map((sg) => (sg.preferred_duty_ids || '').split(',').length), 0);
  for (let r = 0; r < maxWish; r++) {
    for (const sg of signupRows) {
      const pu = perUser.get(sg.user_id);
      if (pu.assigned.length) continue;
      const wish = pu.wishes[r];
      if (!wish) continue;
      const duty = scheduleDuties.find((d) => d.id === wish);
      if (!duty) continue;
      if (slotMap.has(duty.id + ':haupt')) continue;
      if (pu['d_' + duty.id] !== true) continue;
      await insert(duty, pu.row, 'haupt');
    }
  }

  for (const duty of scheduleDuties) {
    if (slotMap.has(duty.id + ':haupt')) continue;
    const candidates = signupRows.filter((sg) => {
      const pu = perUser.get(sg.user_id);
      if (pu.assigned.length) return false;
      return pu['d_' + duty.id] === true;
    });
    if (!candidates.length) continue;
    await insert(duty, candidates[0], 'haupt');
  }

  for (const duty of strafeDuties) {
    if (slotMap.has(duty.id + ':haupt')) continue;
    const volunteers = signupRows.filter((sg) => {
      const pu = perUser.get(sg.user_id);
      if (pu.assigned.length) return false;
      if (!sg.volunteer_strafe) return false;
      if (duty.standort_id && sg.preferred_standort_id && duty.standort_id !== sg.preferred_standort_id) return false;
      return pu['d_' + duty.id] !== false;
    });
    if (!volunteers.length) continue;
    await insert(duty, volunteers[0], 'haupt');
  }

  for (const duty of scheduleDuties) {
    if (slotMap.has(duty.id + ':reserve')) continue;
    const cand = signupRows.find((sg) => {
      const pu = perUser.get(sg.user_id);
      if (pu.assigned.includes(duty.id)) return false;
      return pu['d_' + duty.id] === true;
    });
    if (!cand) continue;
    await insert(duty, cand, 'reserve');
  }

  return { ok: true };
}

app.post('/api/admin/autoshift', requireAuth, requireScheduler, async (req, res) => {
  const shiftId = parseInt(req.body.shift_id, 10);
  const result = await runAutoshift(shiftId, req.user);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

app.post('/api/admin/assignments', requireAuth, requireScheduler, async (req, res) => {
  const dutyId = parseInt(req.body.duty_id, 10);
  const userId = req.body.user_id ? parseInt(req.body.user_id, 10) : null;
  const kind = req.body.kind === 'reserve' ? 'reserve' : 'haupt';
  const status = req.body.status === 'bestaetigt' ? 'bestaetigt' : 'vorgeschlagen';
  const duty = await db.get(`SELECT * FROM dutys WHERE id = ?`, [dutyId]);
  if (!duty) return res.status(400).json({ error: 'Dienst nicht gefunden.' });
  await db.run(`DELETE FROM assignments WHERE duty_id = ? AND kind = ?`, [dutyId, kind]);
  if (userId) {
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND active = 1`, [userId]);
    if (!u) return res.status(400).json({ error: 'Nutzer nicht gefunden.' });
    await db.run(`INSERT INTO assignments (duty_id, user_id, kind, status, source, assigned_by) VALUES (?, ?, ?, ?, 'manual', ?)`,
      [dutyId, userId, kind, status, req.user.id]);
  }
  res.json({ ok: true });
});

app.post('/api/admin/confirm-plan', requireAuth, requireScheduler, async (req, res) => {
  const shiftId = parseInt(req.body.shift_id, 10);
  await db.run(`
    UPDATE assignments SET status = 'bestaetigt'
    WHERE status = 'vorgeschlagen'
      AND duty_id IN (SELECT id FROM dutys WHERE shift_id = ?)`, [shiftId]);
  res.json({ ok: true });
});

/* -------------------------------- Activity -------------------------------- */

app.get('/api/activity', requireAuth, async (req, res) => {
  const stats = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM activity WHERE user_id = ? AND result = 'teilgenommen') AS teil,
      (SELECT COUNT(*) FROM activity WHERE user_id = ? AND result = 'nicht_teilgenommen') AS fehlt`,
    [req.user.id, req.user.id]);
  const history = await db.all(`
    SELECT a.*, d.code AS duty_code, s.title AS shift_title, s.date AS shift_date
    FROM activity a
    JOIN dutys d ON d.id = a.duty_id
    JOIN shifts s ON s.id = d.shift_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC`, [req.user.id]);
  res.json({ teilgenommen: stats.teil || 0, nicht_teilgenommen: stats.fehlt || 0, history });
});

function dutyHours(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start + ':00');
  const b = new Date(end + ':00');
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  return Math.round(((b - a) / 3600000) * 10) / 10;
}

app.get('/api/admin/activity-list', requireAuth, requireScheduler, async (req, res) => {
  const shiftId = parseInt(req.query.shift_id || '0', 10);
  const allShifts = (await db.all(`SELECT * FROM shifts WHERE status = 'published' ORDER BY date DESC`)).map(shiftRow);
  if (!shiftId && allShifts.length) return res.json({ shifts: allShifts, items: [], shift_id: null });
  const items = await db.all(`
    SELECT a.id AS assignment_id, a.user_id, d.id AS duty_id, d.code AS duty_code, d.start AS duty_start, d.end AS duty_end, d.shift_id, d.type AS duty_type,
           u.username, u.display_name,
           ac.id AS activity_id, ac.result AS activity_result, ac.note AS activity_note
    FROM assignments a
    JOIN dutys d ON d.id = a.duty_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN activity ac ON ac.user_id = a.user_id AND ac.duty_id = a.duty_id
    WHERE d.shift_id = ? AND a.kind = 'haupt' AND a.status = 'bestaetigt'
    ORDER BY d.start, d.id`, [shiftId]);
  res.json({ shifts: allShifts, items, shift_id: shiftId });
});

app.post('/api/admin/activity', requireAuth, requireScheduler, async (req, res) => {
  const dutyId = parseInt(req.body.duty_id, 10);
  const userId = parseInt(req.body.user_id, 10);
  const result = req.body.result === 'nicht_teilgenommen' ? 'nicht_teilgenommen' : 'teilgenommen';
  if (req.body.assignment_id) {
    await db.run(`DELETE FROM activity WHERE assignment_id = ?`, [parseInt(req.body.assignment_id, 10)]);
  }
  await db.run(`
    INSERT INTO activity (assignment_id, duty_id, user_id, result, note, marked_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.body.assignment_id || null, dutyId, userId, result, String(req.body.note || '').slice(0, 300), req.user.id]);
  if (req.body.auto_strafe && result === 'nicht_teilgenommen') {
    const duty = await db.get(`SELECT * FROM dutys WHERE id = ?`, [dutyId]);
    const h = dutyHours(duty.start, duty.end) || 1;
    await db.run(`INSERT INTO strafzeiten (user_id, hours, reason, entered_by) VALUES (?, ?, ?, ?)`,
      [userId, h, 'Nicht erschienen: ' + duty.code, req.user.id]);
  }
  res.json({ ok: true });
});

/* -------------------------------- Inactivity -------------------------------- */

app.get('/api/inactivity', requireAuth, async (req, res) => {
  const mine = await db.all(`SELECT * FROM inactivity WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [req.user.id]);
  const canManage = req.user.role === 'admin' || req.user.role === 'senior';
  const open = canManage ? await db.all(`
    SELECT i.*, u.username, u.display_name FROM inactivity i
    JOIN users u ON u.id = i.user_id
    WHERE i.status = 'offen' ORDER BY i.created_at ASC`) : [];
  res.json({ mine, open, canManage });
});

app.post('/api/inactivity', requireAuth, async (req, res) => {
  const start = String(req.body.start_date || '');
  const end = String(req.body.end_date || '');
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'Ungültiger Zeitraum.' });
  }
  if (end < start) return res.status(400).json({ error: 'Das Ende liegt vor dem Beginn.' });
  const days = Math.round((new Date(end) - new Date(start)) / 86400000);
  if (days > 31) return res.status(400).json({ error: 'Ein Zeitraum darf maximal einen Monat (31 Tage) sein.' });
  await db.run(`INSERT INTO inactivity (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)`, [req.user.id, start, end, reason]);
  res.json({ ok: true });
});

app.post('/api/admin/inactivity/:id', requireAuth, requireScheduler, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = req.body.action === 'genehmigt' ? 'genehmigt' : 'abgelehnt';
  const note = String(req.body.note || '').slice(0, 300);
  await db.run(`UPDATE inactivity SET status = ?, decision_note = ?, decided_by = ? WHERE id = ?`, [status, note, req.user.id, id]);
  res.json({ ok: true });
});

/* ------------------------- Kundenservice Strafe ------------------------- */

app.get('/api/strafe', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const open = await db.get(`
    SELECT COALESCE(SUM(hours - covered), 0) AS h FROM strafzeiten
    WHERE user_id = ? AND hours > covered`, [req.user.id]);
  const offen = await db.all(`
    SELECT id, hours, covered, reason, created_at FROM strafzeiten
    WHERE user_id = ? AND hours > covered ORDER BY created_at DESC`, [req.user.id]);
  const verlauf = await db.all(`
    SELECT a.id AS assignment_id, d.id AS duty_id, d.code, st.name AS standort, d.start, d.end,
           a.grund, a.status, a.created_at
    FROM assignments a
    JOIN dutys d ON d.id = a.duty_id
    LEFT JOIN standorte st ON st.id = d.standort_id
    WHERE a.user_id = ? AND d.type = 'strafe' AND a.kind = 'haupt'
    ORDER BY d.start DESC`, [req.user.id]);
  const canManage = req.user.role === 'admin' || req.user.role === 'senior';
  let users = [], shifts = [];
  if (canManage) {
    users = await db.all(`SELECT id, username, display_name, role, licenses FROM users WHERE active = 1 ORDER BY username`);
    shifts = (await db.all(`SELECT * FROM shifts WHERE status = 'published' ORDER BY date DESC LIMIT 10`)).map(shiftRow);
  }
  res.json({
    open_hours: Math.round(open.h * 10) / 10,
    schwelle: settings.strafe_schwelle_hours,
    dauer: settings.strafe_dauer_hours,
    name: settings.strafe_name,
    offen,
    verlauf,
    canManage,
    users,
    shifts
  });
});

async function coverStrafe(userId, hours, out) {
  const entries = await db.all(`SELECT * FROM strafzeiten WHERE user_id = ? AND hours > covered ORDER BY created_at ASC`, [userId]);
  let remaining = hours;
  const reasons = [];
  for (const e of entries) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, e.hours - e.covered);
    if (take > 0) {
      await db.run(`UPDATE strafzeiten SET covered = covered + ? WHERE id = ?`, [take, e.id]);
      reasons.push((e.reason || 'Strafe') + ' (' + Math.round(take * 10) / 10 + ' h)');
      remaining = Math.round((remaining - take) * 10) / 10;
    }
  }
  out.push(...reasons);
}

async function nextUpcomingShift(excludeShiftId) {
  const settings = await getSettings();
  const rows = await db.all(`SELECT * FROM shifts WHERE status = 'published' ORDER BY date, time_start LIMIT 5`);
  const now = new Date();
  const starts = rows.filter((r) => new Date(r.date + 'T' + (r.time_start || '00:00')) > now);
  const target = starts[0] || rows[0] || null;
  if (!target) return null;
  return target;
}

app.post('/api/admin/strafe', requireAuth, requireScheduler, async (req, res) => {
  const userId = parseInt(req.body.user_id, 10);
  const hours = parseFloat(req.body.hours);
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!userId || !(hours > 0) || hours > 120) return res.status(400).json({ error: 'Ungültige Eingabe.' });
  const u = await db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!u) return res.status(400).json({ error: 'Nutzer nicht gefunden.' });
  await db.run(`INSERT INTO strafzeiten (user_id, hours, reason, entered_by) VALUES (?, ?, ?, ?)`, [userId, hours, reason, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/admin/strafe-config', requireAuth, requireAdmin, async (req, res) => {
  const schwelle = parseFloat(req.body.schwelle_hours);
  const dauer = parseFloat(req.body.dauer_hours);
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!(schwelle > 0) || !(dauer > 0) || !name) return res.status(400).json({ error: 'Ungültige Eingabe.' });
  await db.run(`UPDATE settings SET value = ? WHERE key = 'strafe_schwelle_hours'`, [String(schwelle)]);
  await db.run(`UPDATE settings SET value = ? WHERE key = 'strafe_dauer_hours'`, [String(dauer)]);
  await db.run(`UPDATE settings SET value = ? WHERE key = 'strafe_name'`, [name]);
  res.json({ ok: true });
});

app.post('/api/admin/strafe-generate', requireAuth, requireScheduler, async (req, res) => {
  const settings = await getSettings();
  const reqShiftId = parseInt(req.body.shift_id || '0', 10) || null;
  const targetShift = reqShiftId ? await db.get(`SELECT * FROM shifts WHERE id = ?`, [reqShiftId]) : await nextUpcomingShift(null);
  if (!targetShift) return res.status(400).json({ error: 'Kein Shift vorhanden.' });
  const openUsers = await db.all(`
    SELECT user_id, SUM(hours - covered) AS open_hours
    FROM strafzeiten
    WHERE hours > covered
    GROUP BY user_id
    HAVING SUM(hours - covered) >= ?`, [settings.strafe_schwelle_hours]);
  const existing = await db.all(`
    SELECT a.user_id FROM assignments a
    JOIN dutys d ON d.id = a.duty_id
    WHERE d.type = 'strafe' AND a.kind = 'haupt' AND a.status IN ('vorgeschlagen','bestaetigt')
      AND d.start >= ?`, [new Date().toISOString().slice(0, 10) + 'T00:00']);
  const existingSet = new Set(existing.map((r) => r.user_id));
  const dauer = settings.strafe_dauer_hours;
  const baseStart = new Date(targetShift.date + 'T' + (targetShift.time_start || '10:00'));
  const created = [];
  for (const rec of openUsers) {
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND active = 1`, [rec.user_id]);
    if (!u || existingSet.has(rec.user_id)) continue;
    const code = settings.strafe_name + ((rec.user_id % 1000) + 1);
    const reasons = [];
    const sStart = new Date(baseStart);
    const sEnd = new Date(sStart.getTime() + dauer * 3600000);
    const nextDate = (d) => d.toISOString().slice(0, 10) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const dutyRes = await db.run(`INSERT INTO dutys (shift_id, code, type, start, end, note, sort) VALUES (?, ?, 'strafe', ?, ?, ?, 0)`,
      [targetShift.id, code, nextDate(sStart), nextDate(sEnd), 'Automatisch erstellt nach Erreichen der Schwelle.']);
    await coverStrafe(rec.user_id, dauer, reasons);
    const duty = await db.get(`SELECT * FROM dutys WHERE id = ?`, [dutyRes.lastRowId]);
    const standorte = await db.all(`SELECT * FROM standorte WHERE active = 1 ORDER BY sort, name LIMIT 1`);
    if (standorte.length) {
      await db.run(`UPDATE dutys SET standort_id = ? WHERE id = ?`, [standorte[0].id, duty.id]);
    }
    await db.run(`UPDATE dutys SET standort_id = ?, note = ? WHERE id = ?`, [standorte[0].id, duty.note + ' Grund: ' + (reasons.join(' · ') || 'offene Strafzeit'), duty.id]);
    const grund = reasons.join(' · ') || 'offene Strafzeit';
    await db.run(`INSERT INTO assignments (duty_id, user_id, kind, status, source, grund, assigned_by) VALUES (?, ?, 'haupt', 'bestaetigt', 'strafe', ?, ?)`,
      [duty.id, rec.user_id, grund, req.user.id]);
    existingSet.add(rec.user_id);
    created.push({ user_id: rec.user_id, code });
  }
  res.json({ ok: true, created: created.length });
});

/* --------------------------------- Admin ---------------------------------- */

app.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const settings = await getSettings();
  res.json({ settings });
});

app.post('/api/admin/meldung', requireAuth, requireAdmin, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  const active = req.body.active ? '1' : '0';
  await db.run(`UPDATE settings SET value = ? WHERE key = 'meldung_text'`, [text]);
  await db.run(`UPDATE settings SET value = ? WHERE key = 'meldung_active'`, [active]);
  res.json({ ok: true });
});

app.post('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const signup_close = parseInt(req.body.signup_close_minutes, 10);
  const staff_start = parseInt(req.body.staff_start_minutes, 10);
  const max_wishes = parseInt(req.body.max_duty_wishes, 10);
  if (!(signup_close > 0)) return res.status(400).json({ error: 'Ungültiger Wert.' });
  await db.run(`UPDATE settings SET value = ? WHERE key = 'signup_close_minutes'`, [String(signup_close)]);
  await db.run(`UPDATE settings SET value = ? WHERE key = 'staff_start_minutes'`, [String(staff_start || 0)]);
  await db.run(`UPDATE settings SET value = ? WHERE key = 'max_duty_wishes'`, [String(max_wishes > 0 && max_wishes <= 10 ? max_wishes : 5)]);
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await db.all(`
    SELECT u.*, g.open_hours,
           (SELECT COUNT(*) FROM inactivity i2 WHERE i2.user_id = u.id AND i2.status = 'offen') AS open_inactivity
    FROM users u
    LEFT JOIN (SELECT user_id, SUM(hours - covered) AS open_hours FROM strafzeiten WHERE hours > covered GROUP BY user_id) g ON g.user_id = u.id
    ORDER BY u.username`);
  const linien = await db.all(`SELECT * FROM linien ORDER BY sort, name`);
  const byId = new Map(linien.map((l) => [l.id, l]));
  res.json({ users: users.map((u) => ({
    ...u,
    licenses: (u.licenses || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)),
    license_names: (u.licenses || '').split(',').filter(Boolean).map((x) => (byId.get(parseInt(x, 10)) || {}).name).filter(Boolean).join(', '),
    open_hours: Math.round((u.open_hours || 0) * 10) / 10
  })) });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const display_name = String(req.body.display_name || '').slice(0, 40);
  const password = String(req.body.password || '');
  const role = ['busfahrer', 'senior', 'admin'].includes(req.body.role) ? req.body.role : 'busfahrer';
  const licenses = Array.isArray(req.body.licenses) ? [...new Set(req.body.licenses.map((x) => parseInt(x, 10)).filter((x) => x > 0))] : [];
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return res.status(400).json({ error: 'Benutzername: 3–24 Zeichen, nur a-z 0-9 _ . -' });
  const exists = await db.get(`SELECT id FROM users WHERE LOWER(username) = ?`, [username]);
  if (exists) return res.status(400).json({ error: 'Der Benutzername ist bereits vergeben.' });
  const oneTime = password.length >= 6 ? password : crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + String(Math.floor(1000 + Math.random() * 9000));
  const hash = await bcrypt.hash(oneTime, 10);
  await db.run(`INSERT INTO users (username, display_name, password_hash, role, licenses, must_change_password, active) VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [username, display_name || username, hash, role, licenses.join(',')]);
  res.json({ ok: true, one_time_password: oneTime, username });
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = await db.get(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!u) return res.status(400).json({ error: 'Nutzer nicht gefunden.' });
  const display_name = String(req.body.display_name ?? u.display_name ?? '').slice(0, 40);
  const role = ['busfahrer', 'senior', 'admin'].includes(req.body.role) ? req.body.role : u.role;
  const licenses = Array.isArray(req.body.licenses) ? [...new Set(req.body.licenses.map((x) => parseInt(x, 10)).filter((x) => x > 0))] : (u.licenses || '').split(',').filter(Boolean).map((x) => parseInt(x, 10));
  const active = req.body.active === undefined ? u.active : (req.body.active ? 1 : 0);
  await db.run(`UPDATE users SET display_name = ?, role = ?, licenses = ?, active = ? WHERE id = ?`,
    [display_name || u.username, role, licenses.join(','), active, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen.' });
  const u = await db.get(`SELECT id FROM users WHERE id = ?`, [id]);
  if (!u) return res.status(400).json({ error: 'Nutzer nicht gefunden.' });
  await db.run(`DELETE FROM users WHERE id = ?`, [id]);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newPw = String(req.body.password || '');
  const oneTime = newPw.length >= 6 ? newPw : crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + String(Math.floor(1000 + Math.random() * 9000));
  const hash = await bcrypt.hash(oneTime, 10);
  await db.run(`UPDATE users SET password_hash = ?, must_change_password = 1, active = 1 WHERE id = ?`, [hash, id]);
  res.json({ ok: true, one_time_password: oneTime });
});

/* -------------------------------- Admin Shifts -------------------------------- */

function parseShiftBody(b) {
  const linien = Array.isArray(b.linien)
    ? b.linien.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    title: String(b.title || '').trim().slice(0, 80),
    description: String(b.description || '').trim().slice(0, 2000),
    date: String(b.date || ''),
    time_start: String(b.time_start || ''),
    time_end: String(b.time_end || ''),
    host_id: parseInt(b.host_id || '0', 10) || null,
    status: b.status === 'published' ? 'published' : 'draft',
    linien,
    auto_dienste: (b.auto_generate || b.auto_dienste) ? 1 : 0,
    betrieb_von: String(b.betrieb_von || '').slice(0, 5),
    betrieb_bis: String(b.betrieb_bis || '').slice(0, 5)
  };
}

app.get('/api/admin/shifts', requireAuth, requireAdmin, async (req, res) => {
  const rows = await listShifts(true);
  const settings = await getSettings();
  const now = new Date();
  res.json({ shifts: rows.map((r) => ({ ...shiftRow(r), signup_state: signupState(r, settings, now) })) });
});

app.post('/api/admin/shifts', requireAuth, requireAdmin, async (req, res) => {
  const b = parseShiftBody(req.body);
  if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'Titel und Datum angeben.' });
  const res2 = await db.run(`INSERT INTO shifts (title, description, date, time_start, time_end, host_id, status, linien, auto_dienste, betrieb_von, betrieb_bis, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.title, b.description, b.date, b.time_start, b.time_end, b.host_id, b.status, JSON.stringify(b.linien), b.auto_dienste, b.betrieb_von, b.betrieb_bis, req.user.id]);
  let generated = 0, fahrtCount = 0;
  if (b.auto_dienste && b.linien.length) {
    const r = await generateDienstplanForShift(res2.lastRowId);
    generated = (r && r.generated) || 0;
    fahrtCount = (r && r.fahrten) || 0;
  }
  res.json({ ok: true, id: res2.lastRowId, generated, fahrten: fahrtCount });
});

async function generateDienstplanForShift(shiftId) {
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [shiftId]);
  if (!shift) return { error: 'Shift nicht gefunden.' };
  let linien = [];
  try { linien = JSON.parse(shift.linien || '[]'); } catch (e) { /* ignoriert */ }
  if (!linien.length) return { error: 'Keine Linien ausgewählt.' };
  const startMin = fahrplan.toMinutes(shift.betrieb_von || shift.time_start);
  const endMin = fahrplan.toMinutes(shift.betrieb_bis || shift.time_end);
  if (startMin === null) return { error: 'Startzeit fehlt.' };

  const trips = fahrplan.expandShiftTrips(linien, shift.date, startMin, endMin);
  if (!trips.length) return { error: 'Keine Fahrten im gewählten Zeitfenster.' };
  const dienste = fahrplan.buildDienstplan(trips);

  const linienRows = await db.all(`SELECT * FROM linien`);
  const shortToId = new Map(linienRows.map((l) => [String(l.short || '').toLowerCase(), l.id]));
  const fahrzeuge = await db.all(`SELECT * FROM fahrzeuge WHERE status = 'einsatzbereit' ORDER BY sort`);
  const used = new Set();

  const dateForMin = (absMin) => {
    const min = absMin % 1440;
    const dayShift = Math.floor(absMin / 1440);
    const d = new Date(shift.date + 'T00:00');
    d.setDate(d.getDate() + dayShift);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + da + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  };

  const pickFahrzeug = (lineShort) => {
    const wantTyp = (fahrplan.getLine(lineShort) || {}).fahrzeugtyp || '';
    const wantTypes = wantTyp === 'gelenk' ? ['gelenk', 'beide'] : wantTyp === 'solo' ? ['solo', 'beide'] : ['gelenk', 'solo', 'beide'];
    const pool = fahrzeuge.filter((f) => !used.has(f.wagennummer) && wantTypes.some((t) => f.typ === t || f.typ === 'gelenk/solo'));
    const pick = pool[0] || fahrzeuge.filter((f) => !used.has(f.wagennummer))[0];
    if (pick) used.add(pick.wagennummer);
    return pick ? pick.wagennummer : '';
  };

  await db.transaction(async (t) => {
    await t.run(`DELETE FROM fahrten WHERE duty_id IN (SELECT id FROM dutys WHERE shift_id = ?)`, [shiftId]);
    for (let i = 0; i < dienste.length; i++) {
      const d = dienste[i];
      const linieId = shortToId.get(String(d.linie || '').toLowerCase());
      const dutyRes = await t.run(`INSERT INTO dutys (shift_id, code, type, linie_id, fahrzeug, start, end, license_id, note, sort) VALUES (?, ?, 'bus', ?, ?, ?, ?, ?, ?, ?)`,
        [shiftId, d.code, linieId || null, pickFahrzeug(d.linie), dateForMin(d.startAbs), dateForMin(d.endAbs), linieId || null, d.note, i]);
      const dutyId = dutyRes.lastRowId;
      let seq = 0;
      for (const f of d.fahrten || []) {
        await t.run(`INSERT INTO fahrten (duty_id, seq, linie, kurs, richtung, von, nach, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dutyId, seq, f.linie || '', f.kurs || null, f.richtung || '', f.von || '', f.nach || '', dateForMin(f.startAbs), dateForMin(f.endAbs)]);
        seq++;
      }
    }
  });

  return { ok: true, generated: dienste.length, fahrten: trips.length };
}

/* Gibt alle Fahrten/Dienste-Vorschläge für eine Shift VOR dem Speichern zurück (Vorschau). */
app.post('/api/preview/dienste', requireAuth, requireScheduler, async (req, res) => {
  const dateStr = String(req.body.date || '');
  const linien = Array.isArray(req.body.linien) ? req.body.linien.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !linien.length) return res.json({ dienste: [], fahrten: 0 });
  const startMin = fahrplan.toMinutes(req.body.betrieb_von || req.body.time_start);
  const endMin = fahrplan.toMinutes(req.body.betrieb_bis || req.body.time_end);
  if (startMin === null) return res.json({ dienste: [], fahrten: 0 });
  const trips = fahrplan.expandShiftTrips(linien, dateStr, startMin, endMin);
  const dienste = fahrplan.buildDienstplan(trips);
  res.json({ dienste, fahrten: trips.length });
});

app.post('/api/admin/shifts/:id/generate-preview', requireAuth, requireScheduler, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [id]);
  if (!shift) return res.status(400).json({ error: 'Shift nicht gefunden.' });
  const startMin = fahrplan.toMinutes(req.body.betrieb_von || shift.betrieb_von || shift.time_start);
  const endMin = fahrplan.toMinutes(req.body.betrieb_bis || shift.betrieb_bis || shift.time_end);
  const linien = Array.isArray(req.body.linien) ? req.body.linien.map((x) => String(x).trim()).filter(Boolean) : (() => { try { return JSON.parse(shift.linien || '[]'); } catch (e) { return []; } })();
  if (startMin === null || !linien.length) return res.json({ dienste: [], fahrten: 0 });
  const trips = fahrplan.expandShiftTrips(linien, shift.date, startMin, endMin);
  const dienste = fahrplan.buildDienstplan(trips);
  res.json({ dienste, fahrten: trips.length });
});

app.post('/api/admin/shifts/:id/generate', requireAuth, requireScheduler, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [id]);
  if (!shift) return res.status(400).json({ error: 'Shift nicht gefunden.' });
  const existing = await db.get(`SELECT COUNT(*) AS n FROM dutys WHERE shift_id = ?`, [id]);
  if (existing.n > 0 && req.query.replace !== '1') {
    return res.status(400).json({ error: 'Für diese Shift gibt es bereits Dienste. Mit replace=1 werden sie neu erzeugt.' });
  }
  const confirmed = await db.get(`
    SELECT COUNT(*) AS n FROM assignments a JOIN dutys d ON d.id = a.duty_id
    WHERE d.shift_id = ? AND a.status = 'bestaetigt'`, [id]);
  if (confirmed.n > 0) return res.status(400).json({ error: 'Es gibt bereits bestätigte Zuordnungen – zuerst lösen.' });
  await db.run(`DELETE FROM dutys WHERE shift_id = ?`, [id]);
  const r = await generateDienstplanForShift(id);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true, generated: r.generated, fahrten: r.fahrten });
});

app.put('/api/admin/shifts/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = parseShiftBody(req.body);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [id]);
  if (!shift) return res.status(400).json({ error: 'Shift nicht gefunden.' });
  const prevLinien = (() => { try { return JSON.parse(shift.linien || '[]'); } catch (e) { return []; } })();
  const linienOut = b.linien.length ? b.linien : prevLinien;
  const autoOut = b.linien.length ? b.auto_dienste : shift.auto_dienste;
  const bvonOut = req.body.betrieb_von !== undefined ? b.betrieb_von : (shift.betrieb_von || '');
  const bbisOut = req.body.betrieb_bis !== undefined ? b.betrieb_bis : (shift.betrieb_bis || '');
  await db.run(`UPDATE shifts SET title = ?, description = ?, date = ?, time_start = ?, time_end = ?, host_id = ?, status = ?, linien = ?, auto_dienste = ?, betrieb_von = ?, betrieb_bis = ? WHERE id = ?`,
    [b.title || shift.title, b.description, b.date || shift.date, b.time_start, b.time_end, b.host_id, b.status, JSON.stringify(linienOut), autoOut, bvonOut, bbisOut, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/shifts/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const activities = await db.get(`SELECT COUNT(*) AS n FROM activity a JOIN dutys d ON d.id = a.duty_id WHERE d.shift_id = ?`, [id]);
  if (activities.n > 0) return res.status(400).json({ error: 'Zu dieser Shift gibt es schon Activity-Einträge – nicht löschbar.' });
  await db.run(`DELETE FROM shifts WHERE id = ?`, [id]);
  res.json({ ok: true });
});

app.post('/api/admin/shifts/:id/duplicate', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const shift = await db.get(`SELECT * FROM shifts WHERE id = ?`, [id]);
  if (!shift) return res.status(400).json({ error: 'Shift nicht gefunden.' });
  const res2 = await db.run(`INSERT INTO shifts (title, description, date, time_start, time_end, host_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [shift.title + ' (Kopie)', shift.description, shift.date, shift.time_start, shift.time_end, shift.host_id, req.user.id]);
  const newId = res2.lastRowId;
  const duties = await db.all(`SELECT * FROM dutys WHERE shift_id = ?`, [id]);
  for (const d of duties) {
    const r = await db.run(`INSERT INTO dutys (shift_id, code, type, linie_id, wechsel_from, wechsel_to, standort_id, fahrzeug, start, end, license_id, note, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, d.code, d.type, d.linie_id, d.wechsel_from, d.wechsel_to, d.standort_id, d.fahrzeug, d.start, d.end, d.license_id, d.note, d.sort]);
    const fahrten = await db.all(`SELECT * FROM fahrten WHERE duty_id = ? ORDER BY seq`, [d.id]);
    for (const f of fahrten) {
      await db.run(`INSERT INTO fahrten (duty_id, seq, linie, kurs, richtung, von, nach, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.lastRowId, f.seq, f.linie, f.kurs, f.richtung, f.von, f.nach, f.start, f.end]);
    }
  }
  res.json({ ok: true, id: newId });
});

/* --------------------------------- Admin Dutys --------------------------------- */

app.get('/api/admin/dutys', requireAuth, requireScheduler, async (req, res) => {
  const shiftId = parseInt(req.query.shift_id || '0', 10);
  const duties = shiftId ? await dutiesForShift(shiftId) : await attachFahrten((await db.all(`${DUTY_SELECT} ORDER BY d.start`)).map(dutyFull));
  const shifts = await listShifts(true);
  const linien = await db.all(`SELECT * FROM linien ORDER BY sort, name`);
  const standorte = await db.all(`SELECT * FROM standorte ORDER BY sort, name`);
  const assignments = shiftId ? await assignmentsForShift(shiftId) : [];
  res.json({ duties, shifts: shifts.map(shiftRow), linien, standorte, assignments });
});

function parseDutyBody(b) {
  return {
    shift_id: parseInt(b.shift_id || '0', 10) || null,
    code: String(b.code || '').trim().slice(0, 40),
    type: ['bus', 'wechsel', 'strafe'].includes(b.type) ? b.type : 'bus',
    linie_id: parseInt(b.linie_id || '0', 10) || null,
    wechsel_from: parseInt(b.wechsel_from || '0', 10) || null,
    wechsel_to: parseInt(b.wechsel_to || '0', 10) || null,
    standort_id: parseInt(b.standort_id || '0', 10) || null,
    fahrzeug: String(b.fahrzeug || '').trim().slice(0, 40),
    start: String(b.start || '').slice(0, 20),
    end: String(b.end || '').slice(0, 20),
    license_id: parseInt(b.license_id || '0', 10) || null,
    note: String(b.note || '').trim().slice(0, 300),
    sort: parseInt(b.sort || '0', 10) || 0
  };
}

app.post('/api/admin/dutys', requireAuth, requireAdmin, async (req, res) => {
  const b = parseDutyBody(req.body);
  if (!b.code || !b.shift_id) return res.status(400).json({ error: 'Code und Shift angeben.' });
  const res2 = await db.run(`INSERT INTO dutys (shift_id, code, type, linie_id, wechsel_from, wechsel_to, standort_id, fahrzeug, start, end, license_id, note, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.shift_id, b.code, b.type, b.linie_id, b.wechsel_from, b.wechsel_to, b.standort_id, b.fahrzeug, b.start, b.end, b.license_id, b.note, b.sort]);
  res.json({ ok: true, id: res2.lastRowId });
});

app.put('/api/admin/dutys/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const duty = await db.get(`SELECT * FROM dutys WHERE id = ?`, [id]);
  if (!duty) return res.status(400).json({ error: 'Dienst nicht gefunden.' });
  const b = parseDutyBody(req.body);
  await db.run(`UPDATE dutys SET code = ?, type = ?, linie_id = ?, wechsel_from = ?, wechsel_to = ?, standort_id = ?, fahrzeug = ?, start = ?, end = ?, license_id = ?, note = ?, sort = ? WHERE id = ?`,
    [b.code || duty.code, b.type, b.linie_id, b.wechsel_from, b.wechsel_to, b.standort_id, b.fahrzeug, b.start, b.end, b.license_id, b.note, b.sort, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/dutys/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const activities = await db.get(`SELECT COUNT(*) AS n FROM activity WHERE duty_id = ?`, [id]);
  if (activities.n > 0) return res.status(400).json({ error: 'Zu diesem Dienst gibt es schon Activity-Einträge.' });
  await db.run(`DELETE FROM dutys WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/* ------------------------------ Linien / Standorte ------------------------------ */

app.get('/api/admin/linien', requireAuth, requireAdmin, async (req, res) => {
  res.json({ linien: await db.all(`SELECT * FROM linien ORDER BY sort, name`) });
});

app.post('/api/admin/linien', requireAuth, requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 30);
  const short = String(req.body.short || '').trim().slice(0, 10);
  if (!name) return res.status(400).json({ error: 'Name angeben.' });
  const sortRes = await db.get(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM linien`);
  await db.run(`INSERT INTO linien (name, short, active, sort) VALUES (?, ?, 1, ?)`, [name, short, sortRes.n]);
  res.json({ ok: true });
});

app.put('/api/admin/linien/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body.name || '').trim().slice(0, 30);
  const short = String(req.body.short || '').trim().slice(0, 10);
  const active = req.body.active === undefined ? 1 : (req.body.active ? 1 : 0);
  if (!name) return res.status(400).json({ error: 'Name angeben.' });
  await db.run(`UPDATE linien SET name = ?, short = ?, active = ? WHERE id = ?`, [name, short, active, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/linien/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const used = await db.get(`SELECT COUNT(*) AS n FROM dutys WHERE linie_id = ? OR wechsel_from = ? OR wechsel_to = ? OR license_id = ?`, [id, id, id, id]);
  if (used.n > 0) return res.status(400).json({ error: 'Die Linie wird noch von Diensten verwendet.' });
  await db.run(`DELETE FROM linien WHERE id = ?`, [id]);
  res.json({ ok: true });
});

app.get('/api/admin/standorte', requireAuth, requireAdmin, async (req, res) => {
  res.json({ standorte: await db.all(`SELECT * FROM standorte ORDER BY sort, name`) });
});

app.post('/api/admin/standorte', requireAuth, requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name angeben.' });
  const sortRes = await db.get(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM standorte`);
  await db.run(`INSERT INTO standorte (name, active, sort) VALUES (?, 1, ?)`, [name, sortRes.n]);
  res.json({ ok: true });
});

app.put('/api/admin/standorte/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body.name || '').trim().slice(0, 60);
  const active = req.body.active === undefined ? 1 : (req.body.active ? 1 : 0);
  if (!name) return res.status(400).json({ error: 'Name angeben.' });
  await db.run(`UPDATE standorte SET name = ?, active = ? WHERE id = ?`, [name, active, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/standorte/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const used = await db.get(`SELECT COUNT(*) AS n FROM dutys WHERE standort_id = ?`, [id]);
  if (used.n > 0) return res.status(400).json({ error: 'Der Standort wird noch von Diensten verwendet.' });
  await db.run(`DELETE FROM standorte WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/* ---------------------------------- Fahrzeuge ---------------------------------- */

function fahrzeugRow(r) {
  return {
    id: r.id, wagennummer: r.wagennummer, kennzeichen: r.kennzeichen || '',
    typ: r.typ || 'solo', modell: r.modell || '',
    bestand_seit: r.bestand_seit || '', bestand_bis: r.bestand_bis || '',
    status: r.status || 'einsatzbereit', bemerkung: r.bemerkung || '', sort: r.sort || 0
  };
}

app.get('/api/fahrzeuge', async (req, res) => {
  const rows = await db.all(`SELECT * FROM fahrzeuge ORDER BY sort, wagennummer`);
  res.json({ fahrzeuge: rows.map(fahrzeugRow) });
});

app.get('/api/admin/fahrzeuge', requireAuth, requireAdmin, async (req, res) => {
  const rows = await db.all(`SELECT * FROM fahrzeuge ORDER BY sort, wagennummer`);
  res.json({ fahrzeuge: rows.map(fahrzeugRow) });
});

app.post('/api/admin/fahrzeuge', requireAuth, requireAdmin, async (req, res) => {
  const wagennummer = String(req.body.wagennummer || '').trim().slice(0, 20);
  if (!wagennummer) return res.status(400).json({ error: 'Wagennummer angeben.' });
  const sortRes = await db.get(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM fahrzeuge`);
  const res2 = await db.run(`INSERT INTO fahrzeuge (wagennummer, kennzeichen, typ, modell, bestand_seit, bestand_bis, status, bemerkung, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [wagennummer, String(req.body.kennzeichen || '').slice(0, 20), String(req.body.typ || 'solo').slice(0, 20),
     String(req.body.modell || '').slice(0, 60), String(req.body.bestand_seit || '').slice(0, 10),
     String(req.body.bestand_bis || '').slice(0, 10), String(req.body.status || 'einsatzbereit').slice(0, 30),
     String(req.body.bemerkung || '').slice(0, 300), sortRes.n]);
  res.json({ ok: true, id: res2.lastRowId });
});

app.put('/api/admin/fahrzeuge/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fz = await db.get(`SELECT * FROM fahrzeuge WHERE id = ?`, [id]);
  if (!fz) return res.status(400).json({ error: 'Fahrzeug nicht gefunden.' });
  const wagennummer = String(req.body.wagennummer ?? fz.wagennummer ?? '').trim().slice(0, 20);
  if (!wagennummer) return res.status(400).json({ error: 'Wagennummer angeben.' });
  await db.run(`UPDATE fahrzeuge SET wagennummer = ?, kennzeichen = ?, typ = ?, modell = ?, bestand_seit = ?, bestand_bis = ?, status = ?, bemerkung = ? WHERE id = ?`,
    [wagennummer, String(req.body.kennzeichen ?? fz.kennzeichen ?? '').slice(0, 20),
     String(req.body.typ ?? fz.typ ?? 'solo').slice(0, 20), String(req.body.modell ?? fz.modell ?? '').slice(0, 60),
     String(req.body.bestand_seit ?? fz.bestand_seit ?? '').slice(0, 10), String(req.body.bestand_bis ?? fz.bestand_bis ?? '').slice(0, 10),
     String(req.body.status ?? fz.status ?? 'einsatzbereit').slice(0, 30), String(req.body.bemerkung ?? fz.bemerkung ?? '').slice(0, 300), id]);
  res.json({ ok: true });
});

app.delete('/api/admin/fahrzeuge/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fz = await db.get(`SELECT * FROM fahrzeuge WHERE id = ?`, [id]);
  if (!fz) return res.status(400).json({ error: 'Fahrzeug nicht gefunden.' });
  const used = await db.get(`SELECT COUNT(*) AS n FROM dutys WHERE fahrzeug = ?`, [fz.wagennummer]);
  if (used.n > 0) return res.status(400).json({ error: 'Das Fahrzeug wird noch von Diensten verwendet.' });
  await db.run(`DELETE FROM fahrzeuge WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/* ---------------------------------- News verwalten ---------------------------------- */

app.get('/api/admin/news', requireAuth, requireAdmin, async (req, res) => {
  const rows = await db.all(`SELECT n.*, u.username AS author FROM news n LEFT JOIN users u ON u.id = n.author_id ORDER BY n.created_at DESC`);
  res.json({ news: rows });
});

app.post('/api/admin/news', requireAuth, requireAdmin, async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 4000);
  const pinned = req.body.pinned ? 1 : 0;
  const active = req.body.active === undefined ? 1 : (req.body.active ? 1 : 0);
  if (!title || !body) return res.status(400).json({ error: 'Titel und Text angeben.' });
  await db.run(`INSERT INTO news (title, body, author_id, pinned, active) VALUES (?, ?, ?, ?, ?)`, [title, body, req.user.id, pinned, active]);
  res.json({ ok: true });
});

app.put('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const news = await db.get(`SELECT * FROM news WHERE id = ?`, [id]);
  if (!news) return res.status(400).json({ error: 'News nicht gefunden.' });
  const title = String(req.body.title ?? news.title).trim().slice(0, 120);
  const body = String(req.body.body ?? news.body).trim().slice(0, 4000);
  const pinned = req.body.pinned ? 1 : 0;
  const active = req.body.active === undefined ? 1 : (req.body.active ? 1 : 0);
  await db.run(`UPDATE news SET title = ?, body = ?, pinned = ?, active = ? WHERE id = ?`, [title, body, pinned, active, id]);
  res.json({ ok: true });
});

app.delete('/api/admin/news/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.run(`DELETE FROM news WHERE id = ?`, [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
});

/* ----------------------------------- Fallback ----------------------------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler.' });
});

db.init()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log('VBG Verwalter läuft auf Port ' + port);
    });
  })
  .catch((e) => {
    console.error('DB-Initialisierung fehlgeschlagen:', e);
    process.exit(1);
  });

module.exports = app;