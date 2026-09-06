const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');

function loadEnv() {
  try {
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || !m[1]) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { }
}
loadEnv();

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

const DISCORD_GAME_ROLES = {
  '1544008757447757965': 'Trainee Busfahrer',
  '1544007506475614308': 'Busfahrer',
  '1545071119000805447': 'Trainee Leitstelle',
  '1544007146751139880': 'Leitstelle',
  '1544007001489809579': 'Trainee Notfallmanager',
  '1544006432892911616': 'Notfallmanager',
  '1544009575550947418': 'Trainee Kundenservice',
  '1544008876020596786': 'Kundenservice'
};

const discordRoleName = (id) => DISCORD_GAME_ROLES[String(id)] || null;

async function fetchDiscordRoles(accessToken) {
  try {
    const guildRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!guildRes.ok) return [];
    const guilds = await guildRes.json();
    const found = [];
    await Promise.all((guilds || []).map(async (g) => {
      try {
        const mRes = await fetch(`https://discord.com/api/users/@me/guilds/${g.id}/member`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!mRes.ok) return;
        const member = await mRes.json();
        const roles = (member.roles || []).map((r) => String(r)).filter((r) => r in DISCORD_GAME_ROLES);
        for (const r of roles) if (!found.includes(r)) found.push(r);
      } catch (e) { }
    }));
    return found;
  } catch (e) {
    return [];
  }
}

async function discordLog(title, description, color) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'VBG Log',
        embeds: [{ title, description: String(description || '').slice(0, 1800), color: color || 0x2e9e5b, timestamp: new Date().toISOString() }]
      })
    });
  } catch (e) {
    console.error('[webhook]', e.message);
  }
}

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
  let discordRoles = [];
  if (u.discord_roles) {
    try { discordRoles = JSON.parse(u.discord_roles); } catch (e) { discordRoles = []; }
  }
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    verified: u.verified,
    avatar: u.avatar || null,
    discord_roles: discordRoles,
    created_at: u.created_at,
  };
}

async function currentUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db.all(
    `SELECT u.id, u.email, u.username, u.role, u.verified, u.verify_code, u.created_at, u.avatar, u.discord_roles
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

    const u = await db.get('SELECT id, email, username, role, verified, avatar, created_at, discord_roles FROM users WHERE id = ?', [userId]);
    res.json({ ok: true, user: publicUser(u), verifyCode });
    discordLog('📝 Neue Registrierung', `**${String(username).trim()}** (${mail}) hat sich registriert. Rolle: ${isOwner ? 'Inhaber' : 'Besucher'}`);
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
    discordLog('🔑 Login', `**${user.username}** (${mail}) hat sich per Passwort angemeldet.`);
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
    scope: 'identify email guilds guilds.members.read',
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
    const discordRoles = await fetchDiscordRoles(access_token);
    const rolesJson = JSON.stringify(discordRoles);

    let user = await db.get('SELECT * FROM users WHERE discord_id = ?', [disc.id]);
    let isNew = false;
    if (!user) {
      user = await db.get('SELECT * FROM users WHERE email = ?', [mail]);
      if (user) {
        await db.run(
          'UPDATE users SET discord_id = ?, avatar = ?, verified = 1, verify_code = NULL, discord_roles = ? WHERE id = ?',
          [disc.id, avatar, rolesJson, user.id]
        );
      } else {
        const r = await db.run(
          `INSERT INTO users (email, username, role, verified, discord_id, avatar, discord_roles)
           VALUES (?,?,?,1,?,?,?)`,
          [mail, desiredName, OWN_ROLE_FOR_EMAIL(mail), disc.id, avatar, rolesJson]
        );
        user = { id: Number(r.lastRowId) };
        isNew = true;
      }
    } else {
      await db.run('UPDATE users SET avatar = ?, verified = 1, verify_code = NULL, discord_roles = ? WHERE id = ?', [avatar, rolesJson, user.id]);
      if (OWNER_EMAILS.includes(mail) && user.role !== 'inhaber') {
        await db.run('UPDATE users SET role = ? WHERE id = ?', ['inhaber', user.id]);
      }
    }

    const token = await startSession(user.id);
    setSessionCookie(res, token);
    res.redirect('/');
    const roleNames = discordRoles.map((r) => (discordRoleName(r) || r)).join(', ');
    discordLog(isNew ? '✨ Neues Discord-Konto' : '🔗 Discord-Login', `**${desiredName}** (${user.id}) hat sich angemeldet.${roleNames ? '\n🎖️ Rollen: ' + roleNames : ''}`);
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
  discordLog('🛡️ Rollenänderung', `**${target.email}** wurde von **${target.role}** auf **${role}** geändert (${req.user.username}).`);
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
  discordLog('🚍 Neue Schicht', `**${String(title).trim()}** am ${date} (${time_start}${time_end ? '–' + time_end : ''}) von ${req.user.username}`);
});

app.delete('/api/shifts/:id', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const exists = await db.get('SELECT id, title FROM shifts WHERE id = ?', [id]);
  if (!exists) return res.status(404).json({ error: 'Schicht nicht gefunden.' });
  await db.run('DELETE FROM shifts WHERE id = ?', [id]);
  res.json({ ok: true });
  discordLog('🗑️ Schicht gelöscht', `**${exists.title}** wurde entfernt.`);
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

/* ------------------------------ Meldungen (Banner) ------------------------------ */

app.get('/api/notices', async (req, res) => {
  const notices = await db.all(
    `SELECT n.id, n.text, n.created_at, u.username AS created_by
     FROM notices n JOIN users u ON u.id = n.created_by
     ORDER BY n.id DESC`
  );
  res.json({ notices });
});

app.post('/api/notices', guard(['inhaber']), async (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Bitte einen Meldungstext angeben.' });
  if (text.length > 300) return res.status(400).json({ error: 'Meldungstext zu lang (max. 300 Zeichen).' });
  const r = await db.run(`INSERT INTO notices (text, created_by) VALUES (?,?)`, [text, req.user.id]);
  res.json({ ok: true, id: Number(r.lastRowId) });
  discordLog('⚠️ Neue Meldung', `**${text}**\nErstellt von ${req.user.username}`);
});

app.delete('/api/notices/:id', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const n = await db.get('SELECT text FROM notices WHERE id = ?', [id]);
  if (!n) return res.status(404).json({ error: 'Meldung nicht gefunden.' });
  await db.run(`DELETE FROM notices WHERE id = ?`, [id]);
  res.json({ ok: true });
  discordLog('🗑️ Meldung gelöscht', `„**${n.text}**“ wurde entfernt.`);
});

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
    ${staff ? '' : 'WHERE t.user_id = ? AND t.status != \'geschlossen\''}
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
  discordLog('🎫 Neues Ticket', `**${vbgTicketNr(newId)}** – ${String(subject).trim()} (${category}, ${priority || 'normal'}) von ${req.user.username}`);
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
  if (!isStaff(req.user) && t.status === 'geschlossen') {
    return { error: res.status(403).json({ error: 'Das Ticket ist geschlossen und nur noch über den Archiv-Link verfügbar.' }) };
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
  if (!isStaff(req.user)) {
    return res.status(403).json({ error: 'Nur das Team darf Tickets bearbeiten.' });
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

app.post('/api/tickets/:id/close', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  let token = t.archive_token;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    await db.run(`UPDATE tickets SET archive_token=? WHERE id=?`, [token, t.id]);
  }
  await db.run(`UPDATE tickets SET status='geschlossen', updated_at=datetime('now') WHERE id=?`, [t.id]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [t.id, req.user.id, `Ticket geschlossen von ${req.user.username}.`]
  );
  res.json({ ok: true, archive_token: token, archive_url: `${BASE_URL}/archiv/${token}` });
  discordLog('🔒 Ticket geschlossen', `**${vbgTicketNr(t.id)}** wurde von ${req.user.username} geschlossen.\n📎 Archiv: ${BASE_URL}/archiv/${token}`);
});

app.post('/api/tickets/:id/reopen', guard(['inhaber', 'bearbeiter']), async (req, res) => {
  const { t, error } = await loadTicketFor(req, res);
  if (error) return;
  await db.run(`UPDATE tickets SET status='offen', assignee_id=NULL, updated_at=datetime('now') WHERE id=?`, [t.id]);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [t.id, req.user.id, `Ticket wieder geöffnet von ${req.user.username}.`]
  );
  res.json({ ok: true });
  discordLog('🔓 Ticket wieder geöffnet', `**${vbgTicketNr(t.id)}** wurde von ${req.user.username} wieder geöffnet.`);
});

/* ------------------------------ Ticket-Archiv (öffentlicher Link) ------------------------------ */

app.get('/api/archive/:token', async (req, res) => {
  const t = await db.get(
    `SELECT t.*, u.username AS user_name, a.username AS assignee_name
     FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.assignee_id
     WHERE t.archive_token = ?`,
    [req.params.token]
  );
  if (!t) return res.status(404).json({ error: 'Archiv-Link ist ungültig oder abgelaufen.' });
  const messages = await db.all(
    `SELECT m.id, m.user_id, m.message, m.attachment, m.is_system, m.created_at, u.username, u.role
     FROM ticket_messages m JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ORDER BY m.id ASC`,
    [t.id]
  );
  res.json({ ticket: t, messages });
});

app.get('/archiv/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'archiv.html'));
});

/* ------------------------------ Ping / Keep-Alive ------------------------------ */

app.get('/api/ping', (req, res) => res.json({ ok: true, t: Date.now() }));

const PING_INTERVAL = (Number(process.env.PING_INTERVAL_MINUTES) || 4) * 60 * 1000;
setInterval(() => {
  fetch(`${BASE_URL}/api/ping`).catch(() => {});
}, PING_INTERVAL);

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