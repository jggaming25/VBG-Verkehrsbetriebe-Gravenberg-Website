/* Fahrplan-Seed: synchronisiert Linien-Metadaten und Fahrzeuge aus fahrplaene/fahrplan.json.
 *
 * Normalerweise passiert das automatisch bei jedem Serverstart (db.js). Dieses Skript
 * erlaubt es, den Sync ohne Neustart einzuspielen:
 *   node scripts/seed-fahrplan.js
 *
 * Umgebung: TURSO_URL / TURSO_AUTH_TOKEN (sonst lokal file:local.db). Erwartet einen
 * vorhandenen Stand (Genügend: einmalig server/server-Start zum Aufbau des Schemas).
 */
const db = require('../db');

(async () => {
  await db.init();
  await db.syncFahrplanFromJson();
  const linien = await db.all(`SELECT id, name, short, farbe, fahrzeugtyp FROM linien ORDER BY sort`);
  const fahrzeuge = await db.all(`SELECT COUNT(*) AS n FROM fahrzeuge`);
  console.log('Linien:');
  for (const l of linien) console.log('  - ' + l.short + ' · ' + l.name + ' (' + l.fahrzeugtyp + ')');
  console.log('Fahrzeuge: ' + fahrzeuge.n);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});