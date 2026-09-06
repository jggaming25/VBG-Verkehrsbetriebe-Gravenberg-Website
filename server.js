const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/IMGs', express.static(path.join(__dirname, 'IMGs')));

const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'janngenzmann@gmail.com,platzhalter1@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const SESSION_COOKIE = 'vbg_session';
const OAUTH_STATE_COOKIE = 'vbg_oauth_state';
const SESSION_TTL_DAYS = 30;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const ROLES = ['besucher', 'bearbeiter', 'inhaber'];

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: SESSION_TTL_DAYS * 864e5,
  });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    verified: u.verified,
    avatar: u.avatar || null,
    created_at: u.created_at,
  };
}

async function currentUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db.all(
    `SELECT u.id, u.email, u.username, u.role, u.verified, u.verify_code, u.created_at, u.avatar
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [sha256(token)]
  );
  const u = rows[0];
  if (!u) return null;
  return publicUser(u);
}

function guard(roles) {
  return async (req, res, next) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Nicht angemeldet.' });
    if (roles && !roles.includes(user.role)) return res.status(403).json({ error: 'Keine Berechtigung.' });
    req.user = user;
    next();
  };
}

async function startSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id) VALUES (?,?)', [sha256(token), userId]);
  return token;
}

const OWN_ROLE_FOR_EMAIL = (email) => (OWNER_EMAILS.includes(email) ? 'inhaber' : 'besucher');

/* ------------------------------ Auth ------------------------------ */

app.post('/api/register', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password) return res.status(400).json({ error: 'Alle Felder ausfüllen.' });
    const mail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
    if (String(username).trim().length < 2) return res.status(400).json({ error: 'Nutzername zu kurz.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben.' });

    const exists = await db.get('SELECT id FROM users WHERE email = ?', [mail]);
    if (exists) return res.status(409).json({ error: 'E-Mail bereits registriert.' });

    const hash = await bcrypt.hash(password, 10);
    const isOwner = OWNER_EMAILS.includes(mail);
    const verifyCode = isOwner ? null : String(crypto.randomInt(100000, 1000000));
    const r = await db.run(
      `INSERT INTO users (email, username, password_hash, role, verified, verify_code)
       VALUES (?,?,?,?,?,?)`,
      [mail, String(username).trim(), hash, isOwner ? 'inhaber' : 'besucher', isOwner ? 1 : 0, verifyCode]
    );
    const userId = Number(r.lastRowId);
    const token = await startSession(userId);
    setSessionCookie(res, token);

    const u = await db.get('SELECT id, email, username, role, verified, avatar, created_at FROM users WHERE id = ?', [userId]);
    res.json({ ok: true, user: publicUser(u), verifyCode });
  } catch (e) {
    console.error('[register]', e);
    res.status(500).json({ error: 'Serverfehler beim Registrieren.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [mail]);
    if (!user || !user.password_hash || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
    }
    const token = await startSession(user.id);
    setSessionCookie(res, token);
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Serverfehler beim Login.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  res.json({ user });
});

app.post('/api/verify', guard(), async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code fehlt.' });
  const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u || u.verified) return res.status(400).json({ error: 'Konto bereits verifiziert.' });
  if (!u.verify_code || u.verify_code !== String(code).trim()) {
    return res.status(401).json({ error: 'Code ist falsch.' });
  }
  await db.run('UPDATE users SET verified = 1, verify_code = NULL WHERE id = ?', [req.user.id]);
  res.json({ ok: true });
});

app.post('/api/verify/resend', guard(), async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u || u.verified) return res.status(400).json({ error: 'Konto bereits verifiziert.' });
  const code = String(crypto.randomInt(100000, 1000000));
  await db.run('UPDATE users SET verify_code = ? WHERE id = ?', [code, req.user.id]);
  res.json({ ok: true, verifyCode: code });
});

/* --------------------------- Discord OAuth --------------------------- */

function discordAvatarUrl(discordId, avatar) {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${(Number(discordId) >> 22) % 6}.png`;
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=128`;
}

app.get('/api/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'Discord Login ist nicht konfiguriert.' });
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 600000 });
  const redirectUri = `${BASE_URL}/api/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query || {};
    if (error) return res.redirect('/?auth_error=' + encodeURIComponent('Discord-Anmeldung abgebrochen.'));
    const stateCookie = req.cookies[OAUTH_STATE_COOKIE];
    if (!state || !stateCookie || state !== stateCookie) {
      return res.status(400).redirect('/?auth_error=' + encodeURIComponent('Ungültiger OAuth-State.'));
    }
    res.clearCookie(OAUTH_STATE_COOKIE);
    if (!code) return res.status(400).redirect('/?auth_error=' + encodeURIComponent('Kein Code vorhanden.'));

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(503).redirect('/?auth_error=' + encodeURIComponent('Discord Login nicht konfiguriert.'));

    const redirectUri = `${BASE_URL}/api/auth/discord/callback`;
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('[discord token]', tokenRes.status, t);
      return res.redirect('/?auth_error=' + encodeURIComponent('Discord-Token konnte nicht getauscht werden.'));
    }
    const { access_token } = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) return res.redirect('/?auth_error=' + encodeURIComponent('Discord-Nutzer konnte nicht geladen werden.'));
    const disc = await userRes.json();

    const mail = (disc.email || '').trim().toLowerCase();
    if (!mail) return res.redirect('/?auth_error=' + encodeURIComponent('Für Discord-Login wird eine verifizierte E-Mail benötigt.'));

    const avatar = disc.avatar ? discordAvatarUrl(disc.id, disc.avatar) : null;
    const desiredName = disc.global_name || disc.username || `Discord-${disc.id.toString().slice(-4)}`;

    let user = await db.get('SELECT * FROM users WHERE discord_id = ?', [disc.id]);
    if (!user) {
      user = await db.get('SELECT * FROM users WHERE email = ?', [mail]);
      if (user) {
        await db.run(
          'UPDATE users SET discord_id = ?, avatar = ?, verified = 1, verify_code = NULL WHERE id = ?',
          [disc.id, avatar, user.id]
        );
      } else {
        const r = await db.run(
          `INSERT INTO users (email, username, role, verified, discord_id, avatar)
           VALUES (?,?,?,1,?,?)`,
          [mail, desiredName, OWN_ROLE_FOR_EMAIL(mail), disc.id, avatar]
        );
        user = { id: Number(r.lastRowId) };
      }
    } else {
      await db.run('UPDATE users SET avatar = ?, verified = 1, verify_code = NULL WHERE id = ?', [avatar, user.id]);
      if (OWNER_EMAILS.includes(mail) && user.role !== 'inhaber') {
        await db.run('UPDATE users SET role = ? WHERE id = ?', ['inhaber', user.id]);
      }
    }

    const token = await startSession(user.id);
    setSessionCookie(res, token);
    res.redirect('/');
  } catch (e) {
    console.error('[discord callback]', e);
    res.redirect('/?auth_error=' + encodeURIComponent('Discord-Login fehlgeschlagen.'));
  }
});

/* ------------------------------ Nutzer / Rollen ------------------------------ */

app.get('/api/users', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const users = await db.all(
    `SELECT id, email, username, role, verified, created_at, avatar FROM users
     ORDER BY CASE role WHEN 'inhaber' THEN 0 WHEN 'bearbeiter' THEN 1 ELSE 2 END, username COLLATE NOCASE`
  );
  res.json({ users });
});

app.put('/api/users/:id/role', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });
  const target = await db.get('SELECT id, email, role FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const targetIsOwnerEmail = OWNER_EMAILS.includes(String(target.email).toLowerCase());
  if (targetIsOwnerEmail && role !== 'inhaber') {
    return res.status(400).json({ error: 'Die festen Inhaber-E-Mails können nicht herabgestuft werden.' });
  }
  if (id === req.user.id && role !== 'inhaber') {
    return res.status(400).json({ error: 'Du kannst dir selbst nicht die Inhaber-Rolle entziehen.' });
  }
  await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  res.json({ ok: true });
});

app.get('/api/staff-emails', guard(), async (req, res) => {
  const rows = await db.all(`SELECT email FROM users WHERE role IN ('inhaber','bearbeiter') AND verified = 1`);
  res.json({ emails: rows.map((r) => r.email) });
});

/* ------------------------------ Shifts ------------------------------ */

app.get('/api/shifts', async (req, res) => {
  const shifts = await db.all(
    `SELECT s.*, u.username AS created_by FROM shifts s
     JOIN users u ON u.id = s.created_by
     ORDER BY s.date ASC, s.time_start ASC`
  );
  res.json({ shifts });
});

app.post('/api/shifts', guard(['inhaber']), async (req, res) => {
  const { title, description, date, time_start, time_end, image } = req.body || {};
  if (!title || !date || !time_start || !image) {
    return res.status(400).json({ error: 'Titel, Datum, Startzeit und Bild sind Pflicht.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Ungültiges Datum.' });
  const r = await db.run(
    `INSERT INTO shifts (title, description, date, time_start, time_end, image, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [String(title).trim(), String(description || '').trim(), date, time_start, time_end || null, image, req.user.id]
  );
  res.json({ ok: true, id: Number(r.lastRowId) });
});

app.delete('/api/shifts/:id', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const exists = await db.get('SELECT id FROM shifts WHERE id = ?', [id]);
  if (!exists) return res.status(404).json({ error: 'Schicht nicht gefunden.' });
  await db.run('DELETE FROM shifts WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/api/images', (req, res) => {
  const dir = path.join(__dirname, 'IMGs');
  try {
    const images = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .sort();
    res.json({ images });
  } catch (e) {
    res.json({ images: [] });
  }
});

/* ------------------------------ Reports & Verwarnungen ------------------------------ */

app.post('/api/reports', guard(), async (req, res) => {
  try {
    const { reported_user_id, reason, details, ticket_id, message_id } = req.body || {};
    const rid = Number(reported_user_id);
    if (!rid || rid === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst melden.' });
    const reasonStr = String(reason || '').trim();
    if (!reasonStr) return res.status(400).json({ error: 'Bitte einen Grund angeben.' });
    if (reasonStr.length > 200) return res.status(400).json({ error: 'Grund zu lang (max. 200 Zeichen).' });
    const target = await db.get('SELECT id FROM users WHERE id = ?', [rid]);
    if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
    await db.run(
      `INSERT INTO reports (reported_user_id, reporter_user_id, ticket_id, message_id, reason, details)
       VALUES (?,?,?,?,?,?)`,
      [rid, req.user.id, ticket_id ? Number(ticket_id) : null, message_id ? Number(message_id) : null, reasonStr, String(details || '').trim().slice(0, 1000) || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[reports create]', e);
    res.status(500).json({ error: 'Serverfehler beim Melden.' });
  }
});

app.get('/api/reports', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const reports = await db.all(
    `SELECT r.*, ru.username AS reported_name, re.username AS reporter_name, m.message AS message_text, t.subject AS ticket_subject
     FROM reports r
     JOIN users ru ON ru.id = r.reported_user_id
     JOIN users re ON re.id = r.reporter_user_id
     LEFT JOIN ticket_messages m ON m.id = r.message_id
     LEFT JOIN tickets t ON t.id = r.ticket_id
     ORDER BY CASE r.status WHEN 'offen' THEN 0 ELSE 1 END, r.id DESC`
  );
  const openCount = (await db.get(`SELECT COUNT(*) AS c FROM reports WHERE status = 'offen'`)).c;
  res.json({ reports, openCount });
});

app.post('/api/reports/:id/resolve', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const rid = Number(req.params.id);
  const rep = await db.get('SELECT * FROM reports WHERE id = ?', [rid]);
  if (!rep) return res.status(404).json({ error: 'Meldung nicht gefunden.' });
  await db.run(`UPDATE reports SET status='erledigt' WHERE id = ?`, [rid]);
  res.json({ ok: true });
});

app.post('/api/reports/:id/warn', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const rid = Number(req.params.id);
  const rep = await db.get('SELECT * FROM reports WHERE id = ?', [rid]);
  if (!rep) return res.status(404).json({ error: 'Meldung nicht gefunden.' });
  await addWarning(rep.reported_user_id, req.user.id, rep.reason);
  await db.run(`UPDATE reports SET status='erledigt' WHERE id = ?`, [rid]);
  res.json({ ok: true });
});

app.get('/api/warnings', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const warnings = await db.all(
    `SELECT w.*, u.username AS user_name, b.username AS by_name
     FROM warnings w
     JOIN users u ON u.id = w.user_id
     JOIN users b ON b.id = w.by_user_id
     ORDER BY w.id DESC LIMIT 100`
  );
  res.json({ warnings });
});

app.post('/api/users/:id/warn', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  try {
    const uid = Number(req.params.id);
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Bitte einen Grund für die Verwarnung angeben.' });
    if (reason.length > 500) return res.status(400).json({ error: 'Grund zu lang (max. 500 Zeichen).' });
    const target = await db.get('SELECT id FROM users WHERE id = ?', [uid]);
    if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
    await addWarning(uid, req.user.id, reason);
    res.json({ ok: true });
  } catch (e) {
    console.error('[warn]', e);
    res.status(500).json({ error: 'Serverfehler beim Verwarnen.' });
  }
});

async function addWarning(userId, byUserId, reason) {
  await db.run(
    `INSERT INTO warnings (user_id, by_user_id, reason) VALUES (?,?,?)`,
    [userId, byUserId, reason]
  );
}

/* ------------------------------ Tickets ------------------------------ */

const isStaff = (u) => u && ['inhaber', 'bearbeiter'].includes(u.role);

const vbgTicketNr = (id) => 'VBG-' + String(id).padStart(4, '0');

app.get('/api/tickets', guard(), async (req, res) => {
  const staff = isStaff(req.user);
  const sql = `
    SELECT t.*, u.username AS user_name, a.username AS assignee_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assignee_id
    ${staff ? '' : 'WHERE t.user_id = ?'}
    ORDER BY
      CASE t.status WHEN 'offen' THEN 0 WHEN 'in_arbeit' THEN 1 ELSE 2 END,
      t.updated_at DESC`;
  const tickets = staff ? await db.all(sql) : await db.all(sql, [req.user.id]);
  const openCount = staff
    ? (await db.get(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'offen'`)).c
    : (await db.get(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status = 'offen'`, [req.user.id])).c;
  res.json({ tickets, openCount });
});

app.post('/api/tickets', guard(), async (req, res) => {
  const { subject, category, description, priority } = req.body || {};
  if (!subject || !category) return res.status(400).json({ error: 'Thema und Kategorie sind Pflicht.' });
  const r = await db.run(
    `INSERT INTO tickets (subject, category, description, priority, user_id, status) VALUES (?,?,?,?,?,'offen')`,
    [String(subject).trim(), category, String(description || '').trim(), priority || 'normal', req.user.id]
  );
  const newId = Number(r.lastRowId);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [newId, req.user.id, `Ticket ${vbgTicketNr(newId)} wurde erstellt von ${req.user.username}.`]
  );
  res.json({ ok: true, id: Number(r.lastRowId) });
});

async function loadTicketFor(req, res) {
  const tid = Number(req.params.id);
  const t = await db.get(
    `SELECT t.*, u.username AS user_name, a.username AS assignee_name
     FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.assignee_id
     WHERE t.id = ?`,
    [tid]
  );
  if (!t) return { error: res.status(404).json({ error: 'Ticket nicht gefunden.' }) };
  if (t.user_id !== req.user.id && !isStaff(req.user)) {
    return { error: res.status(403).json({ error: 'Zugriff verweigert.' }) };
  }
  return { t };
}

app.get('/api/tickets/:id/messages', guard(), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  const messages = await db.all(
    `SELECT m.id, m.user_id, m.message, m.attachment, m.is_system, m.created_at, u.username, u.role, u.avatar
     FROM ticket_messages m JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ORDER BY m.id ASC`,
    [t.id]
  );
  res.json({ ticket: t, messages });
});

app.post('/api/tickets/:id/messages', guard(), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  const { message, attachment } = req.body || {};
  const text = String(message || '').trim();
  if (!text && !attachment) return res.status(400).json({ error: 'Nachricht oder Anhang fehlt.' });
  if (text.length > 4000) return res.status(400).json({ error: 'Nachricht zu lang (max. 4000 Zeichen).' });
  if (attachment && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(attachment))) {
    return res.status(400).json({ error: 'Ungültiges Bild.' });
  }
  if (t.status === 'geschlossen') return res.status(400).json({ error: 'Ticket ist geschlossen.' });
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, attachment) VALUES (?,?,?,?)`,
    [t.id, req.user.id, text || null, attachment || null]
  );
  if (isStaff(req.user) && t.status === 'offen') {
    await db.run(`UPDATE tickets SET status='in_arbeit', assignee_id=?, updated_at=datetime('now') WHERE id=?`, [req.user.id, t.id]);
  } else {
    await db.run(`UPDATE tickets SET updated_at=datetime('now') WHERE id=?`, [t.id]);
  }
  const updated = await db.get('SELECT * FROM tickets WHERE id = ?', [t.id]);
  const messages = await db.all(
    `SELECT m.id, m.user_id, m.message, m.attachment, m.is_system, m.created_at, u.username, u.role, u.avatar
     FROM ticket_messages m JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ORDER BY m.id ASC`,
    [t.id]
  );
  res.json({ ticket: updated, messages });
});

const EDITABLE_FIELDS = ['subject', 'category', 'priority', 'description', 'due_date'];

app.put('/api/tickets/:id', guard(), async (req, res) => {
  const tid = Number(req.params.id);
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', [tid]);
  if (!t) return res.status(404).json({ error: 'Ticket nicht gefunden.' });
  const isCreator = t.user_id === req.user.id;
  const isAssignee = t.assignee_id === req.user.id;
  const isOwner = req.user.role === 'inhaber';
  if (!isCreator && !isAssignee && !isOwner) {
    return res.status(403).json({ error: 'Nur Ersteller, zugewiesener Bearbeiter oder Inhaber kann das Ticket bearbeiten.' });
  }
  const body = req.body || {};
  const set = {};
  const changes = [];

  if (body.subject !== undefined) {
    const v = String(body.subject).trim().slice(0, 90);
    if (!v) return res.status(400).json({ error: 'Thema darf nicht leer sein.' });
    if (v !== t.subject) { set.subject = v; changes.push(`Thema ("${t.subject}" → "${v}")`); }
  }
  if (body.category !== undefined) {
    if (!['frage', 'problem', 'vorschlag', 'bewerbung', 'sonstiges'].includes(body.category)) {
      return res.status(400).json({ error: 'Ungültige Kategorie.' });
    }
    if (body.category !== t.category) { set.category = body.category; changes.push(`Kategorie (→ ${body.category})`); }
  }
  if (body.priority !== undefined) {
    if (!['niedrig', 'normal', 'hoch'].includes(body.priority)) {
      return res.status(400).json({ error: 'Ungültige Priorität.' });
    }
    if (body.priority !== t.priority) { set.priority = body.priority; changes.push(`Priorität (→ ${body.priority})`); }
  }
  if (body.description !== undefined) {
    const v = String(body.description || '').trim().slice(0, 4000);
    if (v !== (t.description || '')) { set.description = v; changes.push(`Beschreibung`); }
  }
  if (body.due_date !== undefined) {
    if (body.due_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
        return res.status(400).json({ error: 'Ungültiges Fälligkeitsdatum.' });
      }
      const y = +body.due_date.slice(0, 4), m = +body.due_date.slice(5, 7), d = +body.due_date.slice(8, 10);
      const dv = new Date(Date.UTC(y, m - 1, d));
      if (dv.getUTCFullYear() !== y || dv.getUTCMonth() !== m - 1 || dv.getUTCDate() !== d) {
        return res.status(400).json({ error: 'Ungültiges Fälligkeitsdatum.' });
      }
    }
    if ((body.due_date || null) !== t.due_date) {
      set.due_date = body.due_date || null;
      changes.push(`Fälligkeitsdatum (→ ${body.due_date || 'ohne'})`);
    }
  }

  if (t.status === 'geschlossen' && Object.keys(set).length) {
    return res.status(400).json({ error: 'Geschlossene Tickets können nicht bearbeitet werden.' });
  }
  if (!Object.keys(set).length) {
    return res.json({ ok: true });
  }

  const cols = [];
  const vals = [];
  Object.keys(set).forEach((f) => {
    if (EDITABLE_FIELDS.includes(f)) { cols.push(`${f} = ?`); vals.push(set[f]); }
  });
  if (cols.length) cols.push("updated_at = datetime('now')");
  await db.run(`UPDATE tickets SET ${cols.join(', ')} WHERE id = ?`, [...vals, tid]);

  const msg = changes.length
    ? `${req.user.username} hat das Ticket bearbeitet: ${changes.join(' · ')}`
    : `${req.user.username} hat das Ticket bearbeitet.`;
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [tid, req.user.id, msg]
  );

  const updated = await db.get('SELECT * FROM tickets WHERE id = ?', [tid]);
  const messages = await db.all(
    `SELECT m.id, m.user_id, m.message, m.attachment, m.is_system, m.created_at, u.username, u.role, u.avatar
     FROM ticket_messages m JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ORDER BY m.id ASC`,
    [tid]
  );
  res.json({ ok: true, ticket: updated, messages });
});

app.post('/api/tickets/:id/claim', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const tid = Number(req.params.id);
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', [tid]);
  if (!t) return res.status(404).json({ error: 'Ticket nicht gefunden.' });
  if (t.status === 'geschlossen') return res.status(400).json({ error: 'Ticket ist geschlossen.' });
  await db.run(`UPDATE tickets SET status='in_arbeit', assignee_id=?, updated_at=datetime('now') WHERE id=?`, [req.user.id, tid]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [tid, req.user.id, `${req.user.username} hat das Ticket übernommen.`]
  );
  res.json({ ok: true });
});

app.post('/api/tickets/:id/unclaim', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const tid = Number(req.params.id);
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', [tid]);
  if (!t) return res.status(404).json({ error: 'Ticket nicht gefunden.' });
  await db.run(`UPDATE tickets SET status='offen', assignee_id=NULL, updated_at=datetime('now') WHERE id=?`, [tid]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [tid, req.user.id, `${req.user.username} hat das Ticket abgegeben.`]
  );
  res.json({ ok: true });
});

app.post('/api/tickets/:id/close', guard(), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  await db.run(`UPDATE tickets SET status='geschlossen', updated_at=datetime('now') WHERE id=?`, [t.id]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [t.id, req.user.id, `Ticket geschlossen von ${req.user.username}.`]
  );
  res.json({ ok: true });
});

app.post('/api/tickets/:id/reopen', guard(), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  await db.run(`UPDATE tickets SET status='offen', assignee_id=NULL, updated_at=datetime('now') WHERE id=?`, [t.id]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [t.id, req.user.id, `Ticket wieder geöffnet von ${req.user.username}.`]
  );
  res.json({ ok: true });
});

/* ------------------------------ Start ------------------------------ */

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

async function main() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`VBG Server läuft auf Port ${PORT}`);
    console.log(`BASE_URL: ${BASE_URL}`);
  });
}

main().catch((e) => {
  console.error('Start fehlgeschlagen', e);
  process.exit(1);
});