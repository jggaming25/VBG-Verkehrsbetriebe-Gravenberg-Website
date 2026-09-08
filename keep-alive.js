/* Keep-Alive-Script für VBG: hält die Website wach.
 *
 * Standardmäßig wird die Render-URL alle 2 Minuten gepin'gt.
 * Ziele via KEEPALIVE_TARGETS (kommagetrennt) oder TARGET_URL/BASE_URL setzen.
 * Die lokale .env wird gelesen (KEY=Wert aus derselben Datei wie server.js).
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  try {
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || !m[1]) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* keine .env vorhanden – ok */ }
}
loadEnv();

const DEFAULT_URL = 'https://vbg-verkehrsbetriebe-gravenberg-website.onrender.com';
const resolveTargets = () => (process.env.KEEPALIVE_TARGETS || process.env.TARGET_URL || process.env.BASE_URL || DEFAULT_URL)
  .split(',')
  .map((s) => String(s).trim())
  .filter(Boolean)
  .map((u) => (u.endsWith('/') ? u.slice(0, -1) : u));

const MINUTES = Number(process.env.PING_INTERVAL_MINUTES) || 2; // alle 2 Minuten
const TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS) || 15000;
const RETRIES = Number(process.env.PING_RETRIES) || 2; // erneuter Versuch nach Fehlschlag
const RETRY_DELAY_MS = Number(process.env.PING_RETRY_DELAY_MS) || 8000; // Raum fürs Aufwachen

function pingOnce(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetch(url + '/api/ping', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json().catch(() => null);
        if (!j || j.ok !== true) throw new Error('ungültige Antwort');
        console.log('[keepalive] ' + new Date().toISOString() + ' OK in ' + (Date.now() - started) + 'ms -> ' + url);
        resolve(true);
      })
      .catch((e) => {
        console.error('[keepalive] ' + new Date().toISOString() + ' FEHLER: ' + e.message + ' -> ' + url);
        resolve(false);
      })
      .finally(() => clearTimeout(timer));
  });
}

async function pingOneWithRetries(url, attempt) {
  const attemptNo = attempt || 1;
  const ok = await pingOnce(url);
  if (ok) return true;
  if (attemptNo < RETRIES) {
    console.log('[keepalive] ' + new Date().toISOString() + ' erneuter Versuch (' + attemptNo + '/' + RETRIES + ') in ' + (RETRY_DELAY_MS / 1000) + 's… -> ' + url);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return pingOneWithRetries(url, attemptNo + 1);
  }
  return false;
}

let inFlight = false;
async function pingAll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const targets = resolveTargets();
    for (const url of targets) {
      await pingOneWithRetries(url);
    }
  } finally {
    inFlight = false;
  }
}

const targets = resolveTargets();
console.log('[keepalive] Pinge ' + targets.join(', ') + ' alle ' + MINUTES + ' Minute(n).');

pingAll();
setInterval(pingAll, MINUTES * 60 * 1000);