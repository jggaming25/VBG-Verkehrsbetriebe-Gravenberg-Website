/* Keep-Alive-Script für VBG: pingt die Website regelmäßig, damit sie nicht einschläft. */
const TARGET = process.env.TARGET_URL || process.env.BASE_URL || 'http://localhost:3000';
const MINUTES = Number(process.env.PING_INTERVAL_MINUTES) || 4;

function ping() {
  const started = Date.now();
  fetch(TARGET + '/api/ping')
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(() => console.log('[keepalive] ' + new Date().toISOString() + ' OK in ' + (Date.now() - started) + 'ms -> ' + TARGET))
    .catch((e) => console.error('[keepalive] ' + new Date().toISOString() + ' FEHLER: ' + e.message));
}

ping();
setInterval(ping, MINUTES * 60 * 1000);
console.log('[keepalive] Pinge ' + TARGET + ' alle ' + MINUTES + ' Minute(n).');