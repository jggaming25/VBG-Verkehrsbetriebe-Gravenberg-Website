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

const WEB_DEV_EMAIL = 'janngenzmann@gmail.com';
const WEB_DEV_ROLE = 'web_developer';

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
  // Virtuelle, nicht verlinkte Discord-Rolle für den Webentwickler.
  if (String(u.email || '').toLowerCase() === WEB_DEV_EMAIL && !discordRoles.includes(WEB_DEV_ROLE)) {
    discordRoles.push(WEB_DEV_ROLE);
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
    `SELECT u.id, u.email, u.username, u.role, u.verified, u.blocked, u.verify_code, u.created_at, u.avatar, u.discord_roles
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [sha256(token)]
  );
  const u = rows[0];
  if (!u) return null;
  if (u.blocked) return null;
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
    if (user.blocked) return res.status(403).json({ error: 'Konto wurde gesperrt.' });
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

    if (user && user.blocked) {
      return res.redirect('/?auth_error=' + encodeURIComponent('Konto wurde gesperrt.'));
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
    `SELECT id, email, username, role, verified, blocked, created_at, avatar FROM users
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
  if (target.role === 'inhaber' && id !== req.user.id) {
    return res.status(400).json({ error: 'Inhaber können einander keine Rollen verändern.' });
  }
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

// Inhaber können einander nicht sperren; feste Inhaber-Konten sind komplett geschützt.
async function guardAccountAction(req, res, target) {
  if (!target) { res.status(404).json({ error: 'Nutzer nicht gefunden.' }); return true; }
  const isOwnerAccount = OWNER_EMAILS.includes(String(target.email).toLowerCase());
  if (target.role === 'inhaber' && target.id !== req.user.id) {
    res.status(400).json({ error: 'Inhaber können einander keine Konten sperren oder löschen.' });
    return true;
  }
  if (isOwnerAccount) {
    res.status(400).json({ error: 'Feste Inhaber-Konten können nicht gesperrt oder gelöscht werden.' });
    return true;
  }
  return false;
}

app.put('/api/users/:id/block', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.get('SELECT id, email, role FROM users WHERE id = ?', [id]);
  if (await guardAccountAction(req, res, target)) return;
  const blocked = (req.body || {}).blocked ? 1 : 0;
  await db.run('UPDATE users SET blocked = ? WHERE id = ?', [blocked, id]);
  if (blocked) await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  res.json({ ok: true, blocked });
  discordLog(blocked ? '⛔ Konto gesperrt' : '✅ Konto entsperrt', `**${target.email}** wurde ${blocked ? 'gesperrt' : 'entsperrt'} (${req.user.username}).`);
});

app.delete('/api/users/:id', guard(['inhaber']), async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.get('SELECT id, email, role FROM users WHERE id = ?', [id]);
  if (await guardAccountAction(req, res, target)) return;
  await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  await db.run('DELETE FROM ticket_messages WHERE user_id = ?', [id]);
  await db.run('DELETE FROM tickets WHERE user_id = ?', [id]);
  await db.run('DELETE FROM notices WHERE created_by = ?', [id]);
  await db.run('DELETE FROM shifts WHERE created_by = ?', [id]);
  await db.run('DELETE FROM connection_requests WHERE user_id = ?', [id]);
  await db.run('UPDATE connections SET created_by = NULL WHERE created_by = ?', [id]);
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
  discordLog('🗑️ Konto gelöscht', `**${target.email}** wurde gelöscht (${req.user.username}).`);
});

app.get('/api/staff-emails', guard(), async (req, res) => {
  const rows = await db.all(`SELECT email FROM users WHERE role IN ('inhaber','bearbeiter') AND verified = 1`);
  res.json({ emails: rows.map((r) => r.email) });
});

/* ------------------------------ Shifts ------------------------------ */

app.get('/api/shifts', async (req, res) => {
  const shifts = await db.all(
    `SELECT s.*, u.username AS created_by, h.username AS host_name, h.avatar AS host_avatar
     FROM shifts s
     JOIN users u ON u.id = s.created_by
     LEFT JOIN users h ON h.id = s.host_id
     ORDER BY s.date ASC, s.time_start ASC`
  );
  res.json({ shifts });
});

app.post('/api/shifts', guard(['inhaber']), async (req, res) => {
  const { title, description, date, time_start, time_end, image, host_id } = req.body || {};
  if (!title || !date || !time_start || !image) {
    return res.status(400).json({ error: 'Titel, Datum, Startzeit und Bild sind Pflicht.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Ungültiges Datum.' });
  let hostId = host_id ? Number(host_id) : null;
  if (hostId) {
    const host = await db.get('SELECT id, role, username FROM users WHERE id = ?', [hostId]);
    if (!host || host.role !== 'inhaber') return res.status(400).json({ error: 'Der Shifthost muss ein Inhaber sein.' });
  }
  const r = await db.run(
    `INSERT INTO shifts (title, description, date, time_start, time_end, image, host_id, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [String(title).trim(), String(description || '').trim(), date, time_start, time_end || null, image, hostId, req.user.id]
  );
  res.json({ ok: true, id: Number(r.lastRowId) });
  const hostName = hostId ? (await db.get('SELECT username FROM users WHERE id = ?', [hostId])).username : null;
  discordLog('🚍 Neue Schicht', `**${String(title).trim()}** am ${date} (${time_start}${time_end ? '–' + time_end : ''}) von ${req.user.username}${hostName ? '\n🎤 Shifthost: ' + hostName : ''}`);
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

// Die Priorität wird automatisch je Kategorie vergeben und ist danach unveränderbar.
const PRIORITY_FOR_CATEGORY = { frage: 'normal', problem: 'hoch', vorschlag: 'niedrig', bewerbung: 'normal', sonstiges: 'normal' };
const priorityForCategory = (category) => PRIORITY_FOR_CATEGORY[String(category).toLowerCase()] || 'normal';

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
  const { subject, category, description } = req.body || {};
  if (!subject || !category) return res.status(400).json({ error: 'Thema und Kategorie sind Pflicht.' });
  if (!['frage', 'problem', 'vorschlag', 'bewerbung', 'sonstiges'].includes(category)) {
    return res.status(400).json({ error: 'Ungültige Kategorie.' });
  }
  // Die Priorität wird automatisch aus der Kategorie vergeben und kann nicht gewählt werden.
  const priority = priorityForCategory(category);
  const r = await db.run(
    `INSERT INTO tickets (subject, category, description, priority, user_id, status) VALUES (?,?,?,?,?,'offen')`,
    [String(subject).trim(), category, String(description || '').trim(), priority, req.user.id]
  );
  const newId = Number(r.lastRowId);
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, user_id, message, is_system) VALUES (?,?,?,1)`,
    [newId, req.user.id, `Ticket ${vbgTicketNr(newId)} wurde erstellt von ${req.user.username}.`]
  );
  res.json({ ok: true, id: Number(r.lastRowId), priority });
  discordLog('🎫 Neues Ticket', `**${vbgTicketNr(newId)}** – ${String(subject).trim()} (${category}, Priorität: ${priority}) von ${req.user.username}`);
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
    if (body.category !== t.category) {
      set.category = body.category;
      // Priorität folgt automatisch aus der Kategorie und ist nicht manuell änderbar.
      const prio = priorityForCategory(body.category);
      set.priority = prio;
      changes.push(`Kategorie (→ ${body.category}), Priorität (auto → ${prio})`);
    }
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

/* ------------------------------ Nahverkehr (Fahrplan) ------------------------------ */

async function getSetting(key) {
  const r = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : null;
}
async function setSetting(key, value) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

function fmtTime(min) {
  const m = ((Math.floor(Number(min)) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function berlinNowMin() {
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const part = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  return (part('hour') % 24) * 60 + part('minute');
}

let NAH = null;

async function buildNahCache() {
  const stops = await db.all('SELECT id, name FROM stops ORDER BY id');
  const trips = await db.all('SELECT id, line, course, direction FROM trips ORDER BY line, course, direction, id');
  const ts = await db.all('SELECT trip_id, seq, stop_id, arr_min, dep_min FROM trip_stops ORDER BY trip_id, seq');
  const stopName = {};
  for (const s of stops) stopName[s.id] = s.name;
  const byTrip = {};
  for (const row of ts) {
    if (!byTrip[row.trip_id]) byTrip[row.trip_id] = [];
    byTrip[row.trip_id].push({
      seq: row.seq,
      stopId: row.stop_id,
      stopName: stopName[row.stop_id],
      arr: row.arr_min,
      dep: row.dep_min
    });
  }
  NAH = {
    stops,
    stopName,
    stopIdx: {},
    trips: trips.map((t) => {
      const st = byTrip[t.id] || [];
      return {
        id: t.id,
        line: t.line,
        course: t.course,
        direction: t.direction,
        stops: st,
        dest: st.length ? st[st.length - 1].stopName : ''
      };
    })
  };
  for (const s of stops) NAH.stopIdx[s.id] = s.name;
}

async function seedFahrplan() {
  const file = path.join(__dirname, 'fahrplaene', 'fahrplan.json');
  if (fs.existsSync(file)) {
    let fahrplan;
    try {
      fahrplan = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('[fahrplan] JSON-Fehler:', e.message);
    }
    if (fahrplan && Array.isArray(fahrplan.lines)) {
      await db.transaction(async (tx) => {
        const linesMeta = {};
        for (const lineDef of fahrplan.lines) {
          const stops = lineDef.stops || [];
          const travel = lineDef.travel_minutes || [];
          const hours = lineDef.hours || [];
          const stopIds = [];
          for (const name of stops) {
            await tx.run('INSERT INTO stops (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
            const row = await tx.get('SELECT id FROM stops WHERE name = ?', [name]);
            stopIds.push(Number(row.id));
          }
          const n = stops.length;
          for (const kurs of lineDef.kurse || []) {
            const course = Number(kurs.course);
            for (const dir of ['hin', 'zurück']) {
              for (const mm of kurs.trips[dir] || []) {
                for (const h of hours) {
                  const startMin = Number(h) * 60 + Number(mm);
                  const seedKey = `${lineDef.line}|${course}|${dir}|${startMin}`;
                  await tx.run(
                    `INSERT INTO trips (line, course, direction, seed_key) VALUES (?,?,?,?)
                     ON CONFLICT(seed_key) DO NOTHING`,
                    [lineDef.line, course, dir, seedKey]
                  );
                  const tripRow = await tx.get('SELECT id FROM trips WHERE seed_key = ?', [seedKey]);
                  const tripId = Number(tripRow.id);
                  for (let i = 0; i < n; i++) {
                    const stopIdx = dir === 'hin' ? i : n - 1 - i;
                    const m = startMin + travel[i];
                    await tx.run(
                      `INSERT INTO trip_stops (trip_id, seq, stop_id, arr_min, dep_min) VALUES (?,?,?,?,?)
                       ON CONFLICT DO NOTHING`,
                      [tripId, i, stopIds[stopIdx], m, m]
                    );
                  }
                }
              }
            }
          }
          linesMeta[lineDef.line] = {
            name: lineDef.name || 'Linie ' + lineDef.line,
            color: lineDef.color || '#2e9e5b',
            stops: stops.length,
            travel_minutes: travel,
            kurse: (lineDef.kurse || []).map((k) => ({ course: Number(k.course), bus: k.bus || 'Solo' }))
          };
        }
        await tx.run(
          `INSERT INTO settings (key, value) VALUES (?,?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ['lines_meta', JSON.stringify(linesMeta)]
        );
      });
    }
  }
  await buildNahCache();
  console.log('[fahrplan] Nahverkehr geladen – Stops:', NAH.stops.length, 'Trips:', NAH.trips.length);
}

async function linesMetaMap() {
  try {
    return JSON.parse((await getSetting('lines_meta')) || '{}');
  } catch (e) {
    return {};
  }
}

async function nahCtx() {
  if (!NAH) await seedFahrplan();
  const [meta, tripCancels, stopCancels, conns, active] = await Promise.all([
    linesMetaMap(),
    db.all('SELECT trip_id FROM trip_cancellations'),
    db.all('SELECT trip_id, stop_id FROM stop_cancellations'),
    db.all(
      `SELECT c.id, c.stop_id, c.trip_a_id, c.trip_b_id,
              ta.line AS a_line, ta.course AS a_course, tb.line AS b_line, tb.course AS b_course
       FROM connections c JOIN trips ta ON ta.id = c.trip_a_id JOIN trips tb ON tb.id = c.trip_b_id`
    ),
    getSetting('active_kurs')
  ]);
  const cancelledTrips = new Set(tripCancels.map((r) => r.trip_id));
  const cancelledStops = new Set(stopCancels.map((r) => r.trip_id + ':' + r.stop_id));
  const activeParts = active ? String(active).split('|') : null;
  const busOf = {};
  for (const [line, m] of Object.entries(meta)) {
    for (const k of m.kurse || []) busOf[line + '|' + k.course] = k.bus;
  }
  return { meta, cancelledTrips, cancelledStops, conns, activeParts, busOf };
}

app.get('/api/nahverkehr/meta', async (req, res) => {
  try {
    if (!NAH) await seedFahrplan();
    const meta = await linesMetaMap();
    const groups = {};
    for (const s of NAH.stops) groups[s.name] = { id: s.id, name: s.name, lines: [] };
    for (const t of NAH.trips) {
      for (const s of t.stops) {
        const g = groups[s.stopName];
        if (g && !g.lines.includes(t.line)) g.lines.push(t.line);
      }
    }
    res.json({
      lines: Object.entries(meta).map(([num, m]) => ({ line: num, name: m.name, color: m.color, kurse: m.kurse })),
      stops: Object.values(groups).sort((a, b) => a.name.localeCompare(b.name, 'de'))
    });
  } catch (e) {
    res.status(500).json({ error: 'Nahverkehr nicht verfügbar.' });
  }
});

app.get('/api/nahverkehr/departures', async (req, res) => {
  const { meta, cancelledTrips, cancelledStops, conns, activeParts, busOf } = await nahCtx();
  const stopParam = String(req.query.stop || '').trim();
  const kind = req.query.kind === 'ankunft' ? 'ankunft' : 'abfahrt';
  const limit = Math.min(60, Math.max(5, Number(req.query.limit) || 24));
  let stopRec = stopParam && !Number.isNaN(Number(stopParam))
    ? NAH.stops.find((s) => s.id === Number(stopParam))
    : NAH.stops.find((s) => s.name.toLowerCase() === String(stopParam).toLowerCase());
  if (!stopRec) stopRec = NAH.stops.find((s) => s.name === 'Gravenberg ZOB') || NAH.stops[0];
  if (!stopRec) return res.json({ error: 'Keine Haltestellen geladen.', stop: null, kind, rows: [] });
  const stopId = stopRec.id;

  const nowMin = berlinNowMin();
  const horizon = nowMin + 8 * 60;

  const rows = [];
  for (const trip of NAH.trips) {
    const at = trip.stops.find((s) => s.stopId === stopId);
    if (!at) continue;
    if (cancelledTrips.has(trip.id)) continue;
    if (cancelledStops.has(trip.id + ':' + stopId)) continue;
    const anchor = kind === 'abfahrt' ? at.dep : at.arr;
    if (anchor < nowMin || anchor > horizon) continue;
    const row = {
      tripId: trip.id,
      line: trip.line,
      lineName: meta[trip.line] ? meta[trip.line].name : trip.line,
      color: meta[trip.line] ? meta[trip.line].color : '#2e9e5b',
      course: trip.course,
      bus: busOf[trip.line + '|' + trip.course] || 'Solo',
      direction: trip.direction,
      dest: trip.dest,
      isStart: at.seq === 0,
      isEnd: at.seq === trip.stops.length - 1,
      dep: fmtTime(at.dep),
      arr: fmtTime(at.arr),
      depMin: at.dep,
      arrMin: at.arr,
      active: true,
      tracked: !!(activeParts && activeParts.length >= 2 && activeParts[0] === trip.line && Number(activeParts[1]) === trip.course)
    };
    const ca = conns.find((c) => c.trip_a_id === trip.id && c.stop_id === stopId);
    if (ca) {
      const bTrip = NAH.trips.find((t) => t.id === ca.trip_b_id);
      const bStop = bTrip && bTrip.stops.find((s) => s.stopId === stopId);
      if (bStop) row.connAfter = { line: ca.b_line, course: ca.b_course, dep: fmtTime(bStop.dep), waitMin: bStop.dep - at.arr };
    }
    const cb = conns.find((c) => c.trip_b_id === trip.id && c.stop_id === stopId);
    if (cb) {
      const aTrip = NAH.trips.find((t) => t.id === cb.trip_a_id);
      const aStop = aTrip && aTrip.stops.find((s) => s.stopId === stopId);
      if (aStop) row.connWait = { line: cb.a_line, course: cb.a_course, arr: fmtTime(aStop.arr), waitMin: at.dep - aStop.arr };
    }
    rows.push(row);
  }
  rows.sort((a, b) => (kind === 'abfahrt' ? a.depMin - b.depMin : a.arrMin - b.arrMin));
  res.json({ stop: stopRec.name, stopId, kind, rows: rows.slice(0, limit) });
});

app.get('/api/nahverkehr/trips', async (req, res) => {
  const { cancelledTrips, busOf } = await nahCtx();
  const line = String(req.query.line || '').trim();
  const course = req.query.course ? Number(req.query.course) : null;
  const direction = String(req.query.direction || '').trim();
  let trips = NAH.trips;
  if (line) trips = trips.filter((t) => t.line === line);
  if (course) trips = trips.filter((t) => t.course === course);
  if (['hin', 'zurück'].includes(direction)) trips = trips.filter((t) => t.direction === direction);
  const out = trips.map((t) => ({
    id: t.id,
    line: t.line,
    course: t.course,
    direction: t.direction,
    dest: t.dest,
    start: t.stops.length ? fmtTime(t.stops[0].dep) : null,
    end: t.stops.length ? fmtTime(t.stops[t.stops.length - 1].arr) : null,
    bus: busOf[t.line + '|' + t.course] || null,
    cancelled: cancelledTrips.has(t.id)
  })).sort((a, b) => a.line.localeCompare(b.line) || a.course - b.course || a.start.localeCompare(b.start));
  res.json({ trips: out });
});

app.get('/api/nahverkehr/active', async (req, res) => {
  const active = await getSetting('active_kurs');
  if (!active) return res.json({ line: null, course: null });
  const [line, course] = String(active).split('|');
  res.json({ line, course: Number(course) });
});

app.put('/api/nahverkehr/active', guard(['inhaber']), async (req, res) => {
  const { line, course } = req.body || {};
  if (!line || !course || !Number.isInteger(Number(course))) {
    if (!line && course == null) {
      await setSetting('active_kurs', '');
      return res.json({ ok: true, line: null, course: null });
    }
    return res.status(400).json({ error: 'Linie und Kurs angeben.' });
  }
  const exists = NAH.trips.find((t) => t.line === line && t.course === Number(course));
  if (!exists) return res.status(400).json({ error: 'Diesen Kurs gibt es nicht.' });
  await setSetting('active_kurs', `${line}|${Number(course)}`);
  res.json({ ok: true, line, course: Number(course) });
  discordLog('⭐ Aktiver Kurs gesetzt', `${req.user.username} hat Kurs ${course} der Linie ${line} aktiviert.`);
});

app.post('/api/nahverkehr/cancel-kurs', guard(['inhaber']), async (req, res) => {
  const { line, course } = req.body || {};
  const trips = NAH.trips.filter((t) => t.line === line && t.course === Number(course));
  if (!trips.length) return res.status(400).json({ error: 'Kurs nicht gefunden.' });
  for (const t of trips) {
    await db.run('INSERT OR IGNORE INTO trip_cancellations (trip_id) VALUES (?)', [t.id]);
  }
  res.json({ ok: true, count: trips.length });
  discordLog('🚫 Kurs fällt aus', `Kurs ${course} der Linie ${line} wurde von ${req.user.username} ausgesetzt (${trips.length} Fahrten).`);
});

app.delete('/api/nahverkehr/cancel-kurs', guard(['inhaber']), async (req, res) => {
  const body = { ...((req.body || {})), ...(req.query || {}) };
  const { line, course } = body;
  const trips = NAH.trips.filter((t) => t.line === line && t.course === Number(course));
  for (const t of trips) {
    await db.run('DELETE FROM trip_cancellations WHERE trip_id = ?', [t.id]);
  }
  res.json({ ok: true });
  discordLog('🚌 Kurs fährt wieder', `Kurs ${course} der Linie ${line} wurde von ${req.user.username} reaktiviert.`);
});

app.post('/api/nahverkehr/trips/:id/stop-cancel', guard(['inhaber']), async (req, res) => {
  const tripId = Number(req.params.id);
  const stopId = Number((req.body || {}).stopId);
  if (!stopId) return res.status(400).json({ error: 'Haltestelle angeben.' });
  const trip = NAH.trips.find((t) => t.id === tripId);
  if (!trip || !trip.stops.some((s) => s.stopId === stopId)) return res.status(400).json({ error: 'Halt nicht in dieser Fahrt.' });
  await db.run('INSERT OR IGNORE INTO stop_cancellations (trip_id, stop_id) VALUES (?,?)', [tripId, stopId]);
  res.json({ ok: true });
});

app.delete('/api/nahverkehr/trips/:id/stop-cancel', guard(['inhaber']), async (req, res) => {
  const tripId = Number(req.params.id);
  const stopId = Number(req.query.stopId);
  await db.run('DELETE FROM stop_cancellations WHERE trip_id = ? AND stop_id = ?', [tripId, stopId]);
  res.json({ ok: true });
});

app.get('/api/nahverkehr/cancellations', guard(['inhaber']), async (req, res) => {
  const rows = await db.all(
    `SELECT tc.trip_id, t.line, t.course
     FROM trip_cancellations tc JOIN trips t ON t.id = tc.trip_id
     GROUP BY t.line, t.course`
  );
  res.json({ cancellations: rows });
});

/* Verbindungssuche */

app.get('/api/nahverkehr/search', async (req, res) => {
  const { cancelledTrips } = await nahCtx();
  const fromName = String(req.query.from || '').trim();
  const toName = String(req.query.to || '').trim();
  const timeParam = String(req.query.time || '').trim();
  const [h, m] = timeParam.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || m < 0 || m > 59 || h < 0 || h > 23) {
    return res.status(400).json({ error: 'Ungültige Uhrzeit.' });
  }
  const t0 = h * 60 + m;
  const fromId = NAH.stops.find((s) => s.name.toLowerCase() === fromName.toLowerCase());
  const toId = NAH.stops.find((s) => s.name.toLowerCase() === toName.toLowerCase());
  if (!fromId || !toId) return res.status(400).json({ error: 'Haltestellen nicht gefunden.' });
  if (fromId.id === toId.id) return res.status(400).json({ error: 'Start und Ziel sind gleich.' });

  const valid = (tid) => !cancelledTrips.has(tid);
  const conns = (await db.all('SELECT trip_a_id, trip_b_id, stop_id FROM connections'))
    .reduce((acc, c) => { acc.set(c.trip_a_id + ':' + c.trip_b_id + ':' + c.stop_id, true); return acc; }, new Map());

  const direct = [];
  for (const trip of NAH.trips) {
    const fi = trip.stops.findIndex((s) => s.stopId === fromId.id);
    const ti = trip.stops.findIndex((s) => s.stopId === toId.id);
    if (fi >= 0 && ti > fi) {
      const d = trip.stops[fi].dep;
      if (d >= t0 && valid(trip.id)) direct.push({ trip, dep: d, arr: trip.stops[ti].arr });
    }
  }
  direct.sort((a, b) => a.dep - b.dep);

  const transfers = [];
  outer: for (const t1 of NAH.trips) {
    const fi = t1.stops.findIndex((s) => s.stopId === fromId.id);
    if (fi < 0 || !valid(t1.id)) continue;
    for (const via of t1.stops.slice(fi + 1)) {
      const rel = via.dep;
      if (rel < t0) continue;
      for (const t2 of NAH.trips) {
        if (t2.id === t1.id) continue;
        const vIdx = t2.stops.findIndex((s) => s.stopId === via.stopId);
        const ti = t2.stops.findIndex((s) => s.stopId === toId.id);
        if (vIdx < 0 || ti <= vIdx || !valid(t2.id)) continue;
        const dep2 = t2.stops[vIdx].dep;
        const wait = dep2 - rel;
        if (wait < 2 || wait > 45) continue;
        const official = conns.has(t1.id + ':' + t2.id + ':' + via.stopId);
        transfers.push({
          trip1: t1, trip2: t2, via: via.stopName,
          leg1Arr: t1.stops[t1.stops.length - 1].arr, // irrelevant
          dep1: rel, arr1: via.arr,
          dep2, arr2: t2.stops[ti].arr,
          wait, official
        });
        if (transfers.length >= 40) break outer;
      }
    }
  }
  transfers.sort((a, b) => a.dep1 - b.dep1 || a.wait - b.wait);

  const leg = (trip, depStop, dep, arrStop, arr) => ({
    line: trip.line,
    course: trip.course,
    direction: trip.direction,
    dest: trip.dest,
    dep: { stop: depStop, time: fmtTime(dep) },
    arr: { stop: arrStop, time: fmtTime(arr) }
  });

  res.json({
    from: fromId.name,
    to: toId.name,
    direct: direct.slice(0, 3).map((d) => leg(d.trip, fromId.name, d.dep, toName, d.arr)),
    transfers: transfers.slice(0, 3).map((x) => {
      const t1Dep = x.trip1.stops.find((s) => s.stopId === fromId.id);
      const t2Arr = x.trip2.stops.find((s) => s.stopId === toId.id);
      return {
        via: x.via,
        waitMin: x.wait,
        official: x.official,
        leg1: leg(x.trip1, fromId.name, t1Dep.dep, x.via, x.arr1),
        leg2: leg(x.trip2, x.via, x.dep2, toName, t2Arr.arr)
      };
    })
  });
});

/* Anschlussanfragen */

app.post('/api/nahverkehr/requests', guard(), async (req, res) => {
  const { stop, toTripId, fromLine } = req.body || {};
  const stopRec = NAH.stops.find((s) => s.name.toLowerCase() === String(stop || '').toLowerCase());
  const toTrip = NAH.trips.find((t) => t.id === Number(toTripId));
  if (!stopRec || !toTrip) return res.status(400).json({ error: 'Angaben unvollständig.' });
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const toStop = toTrip.stops.find((s) => s.stopId === stopRec.id);
  if (!toStop) return res.status(400).json({ error: 'Diese Linie hält nicht dort.' });
  const fromLineName = String(fromLine || '').trim();
  let fromTrip = null;
  if (fromLineName) {
    const cands = NAH.trips
      .filter((t) => t.line === fromLineName && t.id !== toTrip.id && t.stops.some((s) => s.stopId === stopRec.id))
      .map((t) => ({ trip: t, arr: t.stops.find((s) => s.stopId === stopRec.id).arr }))
      .filter((x) => x.arr <= toStop.dep - 1)
      .sort((a, b) => b.arr - a.arr);
    if (cands.length) fromTrip = cands[0].trip;
  }
  if (!fromTrip) return res.status(400).json({ error: 'Kein passender Anschluss (an der Haltestelle kommt nichts früh genug an).' });

  const r = await db.run(
    `INSERT INTO connection_requests (from_trip_id, to_trip_id, stop_id, user_id, status) VALUES (?,?,?,?,?)`,
    [fromTrip.id, toTrip.id, stopRec.id, req.user.id, 'offen']
  );
  res.json({ ok: true, id: Number(r.lastRowId), fromLine: fromTrip.line, fromCourse: fromTrip.course });
  discordLog('🚏 Anschlussanfrage', `${req.user.username} möchte von Linie ${fromTrip.line} auf Linie ${toTrip.line} (Kurs ${toTrip.course}) an ${stopRec.name} umsteigen.`);
});

app.get('/api/nahverkehr/requests', guard(['inhaber']), async (req, res) => {
  const { cancelledTrips } = await nahCtx();
  const rows = await db.all(
    `SELECT r.id, r.status, r.created_at, r.stop_id, r.from_trip_id, r.to_trip_id, u.username
     FROM connection_requests r JOIN users u ON u.id = r.user_id
     ORDER BY CASE r.status WHEN 'offen' THEN 0 ELSE 1 END, r.id ASC LIMIT 100`
  );
  const stopsIdx = {};
  for (const s of NAH.stops) stopsIdx[s.id] = s.name;
  const out = rows.map((r) => {
    const fromT = NAH.trips.find((t) => t.id === r.from_trip_id);
    const toT = NAH.trips.find((t) => t.id === r.to_trip_id);
    const fromStop = fromT ? fromT.stops.find((s) => s.stopId === r.stop_id) : null;
    const toStop = toT ? toT.stops.find((s) => s.stopId === r.stop_id) : null;
    return {
      id: r.id,
      status: r.status,
      username: r.username,
      stop: stopsIdx[r.stop_id] || '?',
      from: fromT ? { line: fromT.line, course: fromT.course, arr: fromStop ? fmtTime(fromStop.arr) : null } : null,
      to: toT ? { line: toT.line, course: toT.course, dep: toStop ? fmtTime(toStop.dep) : null } : null,
      waitMin: fromStop && toStop ? toStop.dep - fromStop.arr : null,
      cancelledFrom: !!(fromT && cancelledTrips.has(fromT.id)),
      cancelledTo: !!(toT && cancelledTrips.has(toT.id))
    };
  });
  res.json({ requests: out });
});

app.post('/api/nahverkehr/requests/:id/accept', guard(['inhaber']), async (req, res) => {
  const r = await db.get('SELECT * FROM connection_requests WHERE id = ?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
  await db.run(
    `INSERT OR IGNORE INTO connections (trip_a_id, trip_b_id, stop_id, created_by) VALUES (?,?,?,?)`,
    [r.from_trip_id, r.to_trip_id, r.stop_id, req.user.id]
  );
  await db.run(`UPDATE connection_requests SET status='angenommen' WHERE id = ?`, [r.id]);
  res.json({ ok: true });
  discordLog('✅ Anschluss bestätigt', `${req.user.username} hat den Anschluss bestätigt (Anfrage #${r.id}).`);
});

app.post('/api/nahverkehr/requests/:id/decline', guard(['inhaber']), async (req, res) => {
  await db.run(`UPDATE connection_requests SET status='abgelehnt' WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/nahverkehr/requests/:id', guard(['inhaber']), async (req, res) => {
  await db.run('DELETE FROM connection_requests WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* Offizielle Verbindungen */

app.get('/api/nahverkehr/connections', async (req, res) => {
  const { meta } = await nahCtx();
  const rows = await db.all(
    `SELECT c.id, c.stop_id, c.trip_a_id, c.trip_b_id, u.username AS created_by,
            ta.line AS a_line, ta.course AS a_course, ta.direction AS a_direction,
            tb.line AS b_line, tb.course AS b_course, tb.direction AS b_direction
     FROM connections c
     JOIN trips ta ON ta.id = c.trip_a_id
     JOIN trips tb ON tb.id = c.trip_b_id
     LEFT JOIN users u ON u.id = c.created_by
     ORDER BY c.id DESC LIMIT 100`
  );
  const stopsIdx = {};
  for (const s of NAH.stops) stopsIdx[s.id] = s.name;
  res.json({
    connections: rows.map((r) => ({
      id: r.id,
      stop: stopsIdx[r.stop_id] || '?',
      a: { line: r.a_line, course: r.a_course, direction: r.a_direction, color: meta[r.a_line] ? meta[r.a_line].color : null },
      b: { line: r.b_line, course: r.b_course, direction: r.b_direction, color: meta[r.b_line] ? meta[r.b_line].color : null },
      created_by: r.created_by || null
    }))
  });
});

app.post('/api/nahverkehr/connections', guard(['inhaber']), async (req, res) => {
  const { fromTripId, toTripId, stop } = req.body || {};
  const fromT = NAH.trips.find((t) => t.id === Number(fromTripId));
  const toT = NAH.trips.find((t) => t.id === Number(toTripId));
  const stopRec = stop ? NAH.stops.find((s) => s.name.toLowerCase() === String(stop).toLowerCase())
                       : NAH.stops.find((s) => s.name === 'Gravenberg ZOB');
  if (!fromT || !toT || !stopRec) return res.status(400).json({ error: 'Angaben unvollständig.' });
  const aStop = fromT.stops.find((s) => s.stopId === stopRec.id);
  const bStop = toT.stops.find((s) => s.stopId === stopRec.id);
  if (!aStop || !bStop) return res.status(400).json({ error: 'Beide Linien halten nicht an dieser Haltestelle.' });
  if (aStop.arr >= bStop.dep) return res.status(400).json({ error: 'Ankunft muss vor der Abfahrt liegen.' });
  await db.run(
    `INSERT OR IGNORE INTO connections (trip_a_id, trip_b_id, stop_id, created_by) VALUES (?,?,?,?)`,
    [fromT.id, toT.id, stopRec.id, req.user.id]
  );
  res.json({ ok: true });
  discordLog('🔗 Verbindung angelegt', `${req.user.username}: Linie ${fromT.line} (Kurs ${fromT.course}) → Linie ${toT.line} (Kurs ${toT.course}) an ${stopRec.name}.`);
});

app.delete('/api/nahverkehr/connections/:id', guard(['inhaber']), async (req, res) => {
  await db.run('DELETE FROM connections WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
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
  await seedFahrplan();
  app.listen(PORT, () => {
    console.log(`VBG Server läuft auf Port ${PORT}`);
    console.log(`BASE_URL: ${BASE_URL}`);
  });
}

main().catch((e) => {
  console.error('Start fehlgeschlagen', e);
  process.exit(1);
});