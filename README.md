# 🚌 VBG Verkehrsbetriebe Gravenberg

Website für das **fiktive Roblox Bus-RP-Game** „VBG Verkehrsbetriebe Gravenberg“ – mit Licht-/Dark-Mode, Shifts-Tab, Coming-Soon-Seiten (Netzplan & Linienübersicht, DE + EN), einem **Discord-ähnlichen Ticketsystem** (Login/Register, „Übernehmen“, Rollen) und einer **Kontoübersicht** zur Rollenvergabe.

**Tech-Stack:** Node.js + Express · [Render](https://render.com) · [Turso](https://turso.tech) (SQLite-Datenbank) · [EmailJS](https://www.emailjs.com) · Discord OAuth-Login

---

## Übersicht

| Bereich | Beschreibung |
|---|---|
| **Start / Landing** | Hero mit `IMGs/Bild1.png` als breitem Hintergrund, restliche Bilder als Vorschaugalerie, Tags #Roblox #Bus #Fiktiv |
| **Shifts** | Alle Shifts mit Datum, Uhrzeit + Vorschaubild. Untertabs **„Alle Shifts“ / „Shift erstellen“** (Shift erstellen nur für **Inhaber**). Bild aus der IMG-Galerie **oder eigener Upload** (wird im Browser komprimiert und in Turso gespeichert) |
| **Netzplan / Linienübersicht** | **Netzplan** zeigt `IMGs/Netzplan_V1.png` im Vollbild (Klick = Großansicht). **Linienübersicht** listet **Linie 19** (Stümp, Voiskamp ⇄ Gravenberg, ZOB, 16 Min) und **Linie SB24** (Neuenburg, Schule ⇄ Gravenberg, ZOB, 8 Min) mit Richtungs-Varianten und kurzer Beschreibung |
| **Tickets** | Nur nach Anmeldung sichtbar. Ab **Tickets** im Menü öffnet sich per **Hover ein Dropdown** – **„Ticket Dashboard“** (nur Staff) + **„Ticket erstellen“** (jeder, mit **„Meine Tickets“**). Besucher sehen nur „Ticket erstellen“. Discord-artiger Chat mit **Ticketnummern** (VBG-0001), Filter (Alle/Offen/In Arbeit/Geschlossen) + Suche, **Bearbeiten** (Thema, Kategorie, Priorität, Fälligkeitsdatum, Beschreibung – wird protokolliert), Bild-**Anhänge**, „Übernehmen“/„Abgeben“, Prioritäten, Kategorien, Schließen/Wieder öffnen, Systemmeldungen, **⚑-Melden** fremder Nachrichten. **Geschlossene Tickets** verschwinden für Besucher aus „Meine Tickets“ und sind danach nur noch über den **Archiv-Link** erreichbar, der beim Schließen erzeugt und vom Staff kopiert/verschickt wird (`/archiv/<token>`, öffentliche Read-only-Seite) |
| **Admin** | Nur für Staff sichtbar: **Meldungen** (offene zuerst, „als erledigt markieren“ oder direkt **verwarnen**), **Verwarnungen** vergeben/Liste. Badge mit offenen Meldungen im Nav |
| **Konto / Kontoübersicht** | Profil, E-Mail-Verifizierung, Rollenübersicht aller Spieler. **Inhaber** können Rollen vergeben (Besucher/Bearbeiter/Inhaber) |

### Rollen
- **Besucher** – kann Shifts sehen und Tickets erstellen; sieht im Tickets-Tab nur „Ticket erstellen“ + „Meine Tickets“ (= offene + in Arbeit; **geschlossene nur noch per Archiv-Link**) und kann in Tickets **nur kommentieren** (kein Bearbeiten, kein Schließen). Ausgeloggt ist der **Tickets-Tab im Menü komplett unsichtbar**
- **Bearbeiter** (Staff) – zusätzlich: Ticket-Dashboard, Tickets bearbeiten/schließen, Meldungen bearbeiten, Verwarnungen aussprechen
- **Inhaber** (Owner) – zusätzlich: Rollen vergeben, Shifts anlegen/löschen

Die E-Mails **`janngenzmann@gmail.com`** und **`platzhalter1@gmail.com`** werden automatisch als **Inhaber** registriert. *(Beide sind über die Server-Variable `OWNER_EMAILS` änderbar.)*

---

## 🚀 1. Lokal ausprobieren

```bash
npm install
npm start
# Ohne Turso wird automatisch eine lokale SQLite-Datei "local.db" angelegt
# → http://localhost:3000
```

Für den lokalen Test sind **keine Umgebungsvariablen** nötig (DB = `local.db`, keine E-Mails erforderlich).

---

## 📦 2. Auf Render deployen

1. Projekt als **Git-Repo** auf GitHub/GitLab pushen (inkl. `IMGs/`).
2. Auf [render.com](https://render.com) → **New → Web Service** → Repo auswählen.
3. Settings:
   - **Build:** `npm install`
   - **Start:** `npm start`
   - **Root Directory:** wie gewünscht (falls das Repo aus der Website besteht, leer lassen)
4. **Environment Variables** setzen (unten).

---

## 🗄️ 3. Turso-Datenbank anlegen

1. Konto erstellen auf [turso.tech](https://turso.tech) → **Database** → Name z. B. `vbg`.
2. Zwei Werte aus der Datenbank kopieren:
   - **URL** (z. B. `libsql://vbg-xxx.turso.io`)
   - **Auth token** (Tab „Tokens“ erzeugen)
3. Als Umgebungsvariablen setzen:
   ```
   TURSO_URL=libsql://vbg-xxx.turso.io
   TURSO_AUTH_TOKEN=eyJ...
   ```
4. Tabellen werden beim ersten Serverstart automatisch angelegt.

---

## 📧 4. EmailJS einrichten (E-Mail-Verifizierung + Ticket-Benachrichtigung)

1. Konto auf [emailjs.com](https://www.emailjs.com) anlegen.
2. **E-Mail-Service** verbinden („Add New Service“, z. B. Gmail).
3. **Zwei Email-Templates** anlegen:
   - **Template 1 – Verifizierung** (Variablen: `to_email`, `username`, `verification_code`), z. B.:
     ```
     Hey {{username}},
     dein VBG-Verifizierungs-Code ist: {{verification_code}}
     ```
   - **Template 2 – Neues Ticket** (Variablen: `to_email`, `from_username`, `ticket_subject`, `ticket_id`, `priority`), z. B.:
     ```
     Neues Support-Ticket von {{from_username}}!
     #{{ticket_id}} – {{ticket_subject}} ({{priority}})
     ```
4. Werte in `public/js/config.js` eintragen:
   ```js
   emailjs: {
     publicKey:        'DEIN_PUBLIC_KEY',
     serviceId:        'DEIN_SERVICE_ID',
     verifyTemplateId: 'DEIN_TEMPLATE_1_ID',
     ticketTemplateId: 'DEIN_TEMPLATE_2_ID'
   }
   ```
   > Der Public Key ist dafür gedacht, im Browser genutzt zu werden – daher liegt er in der Frontend-Config.

Falls du EmailJS (noch) nicht nutzen willst, einfach die Felder leer lassen. Dann siehst du den Verifizierungs-Code direkt auf der Seite.

---

## ✉️ 5. Discord-Login einrichten (optional, aber empfohlen)

1. Auf [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** (z. B. „VBG“).
2. Links **OAuth2 → General**:
   - **Redirects** eintragen: `https://DEINE-RENDER-URL/api/auth/discord/callback`
   - `Client ID` und `Client Secret` kopieren.
   - Unter **Default Authorization Link** die Scopes `identify`, `email`, `guilds` und `guilds.members.read` markieren (nötig, um die Rollen anzuzeigen).
3. Umgebungsvariablen auf Render:
   ```
   DISCORD_CLIENT_ID=1234567890...
   DISCORD_CLIENT_SECRET=xxxxxxxx
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   BASE_URL=https://DEINE-RENDER-URL.onrender.com
   ```
   > `BASE_URL` ist wichtig – steuert die Admin-Seite und die OAuth-Redirect-URL.
   > `DISCORD_WEBHOOK_URL` ist optional: Aktionen (Konten, Shifts, Tickets, Meldungen) werden dort als „VBG Log“ gepostet.

Mit Discord angemeldete Nutzer sind automatisch **E-Mail-verifiziert** und bekommen ihren Discord-Avatar angezeigt.

---

## 🧪 6. Umgebungsvariablen gesamt (Render)

| Variable | Beispiel | Pflicht? |
|---|---|---|
| `TURSO_URL` | `libsql://vbg-xxx.turso.io` | ✅ (sonst lokale Datei) |
| `TURSO_AUTH_TOKEN` | `eyJ...` | ✅ für Turso-Cloud |
| `BASE_URL` | `https://vbg.onrender.com` | ✅ für Discord + Links |
| `NODE_ENV` | `production` | ⚠️ sonst kein sichere Cookies |
| `OWNER_EMAILS` | `janngenzmann@gmail.com,platzhalter1@gmail.com` | optional |
| `DISCORD_CLIENT_ID` | – | optional |
| `DISCORD_CLIENT_SECRET` | – | optional |
| `DISCORD_WEBHOOK_URL` | – | optional („VBG Log“-Benachrichtigungen) |
| `PING_INTERVAL_MINUTES` | `4` | optional (Server-Ticker + keep-alive.js) |
| `TARGET_URL` | `https://vbg.onrender.com` | optional (nur keep-alive.js) |
| `SESSION_SECRET` | (reserviert) | – |

---

## 📁 Projektstruktur

```
VBG Website/
├── server.js              # Express-Server + komplette API (Auth, Discord OAuth, Shifts, Tickets, Rollen, Archiv, Ping)
├── db.js                  # Turso-Verbindung + Tabellen
├── keep-alive.js          # optionales Ping-Script gegen Render-Sleep
├── package.json
├── README.md
├── IMGs/                  # 13 breite Roblox-Screenshots (3440×1440), Bild1.png = Hero
└── public/
    ├── index.html         # SPA mit allen Tabs + Modals
    ├── archiv.html        # Read-only-Archivseite für geschlossene Tickets per Link
    ├── css/style.css      # Lichtgrünes Design, Light-/Dark-Mode
    └── js/
        ├── config.js      # EmailJS-Schlüssel hier eintragen!
        ├── api.js         # Fetch-Wrapper + Helfer
        ├── app.js         # Tabs, Theme, Auth, Konto, E-Mails
        ├── shifts.js      # Shift-Karten + Anlegen (Galerie/Upload)
        ├── tickets.js     # Ticketliste + Chat ("Übernehmen")
        └── admin.js       # Kontoübersicht / Rollenvergabe
```

---

## 🔌 API-Endpunkte (Kurzübersicht)

**Auth:** `POST /api/register` · `POST /api/login` · `POST /api/logout` · `GET /api/me` · `POST /api/verify` · `POST /api/verify/resend` · `GET /api/auth/discord` · `GET /api/auth/discord/callback`

**Rollen/Nutzer:** `GET /api/users` (Staff) · `PUT /api/users/:id/role` (Inhaber) · `GET /api/staff-emails`

**Shifts:** `GET /api/shifts` · `POST /api/shifts` (Inhaber) · `DELETE /api/shifts/:id` (Inhaber) · `GET /api/images`

**Tickets:** `GET /api/tickets` · `POST /api/tickets` · `GET /api/tickets/:id/messages` · `POST /api/tickets/:id/messages` · `PUT /api/tickets/:id` · `POST /api/tickets/:id/claim` · `.../unclaim` · `.../close` · `.../reopen`

**Ticket-Archiv:** `GET /api/archive/:token` (öffentlich, Read-only) · `GET /archiv/:token` (Read-only-Seite)

**Ping/Keep-Alive:** `GET /api/ping` · `npm run keepalive` (pingt `TARGET_URL`/`BASE_URL` alle `PING_INTERVAL_MINUTES` Min)

**Meldungen (Banner):** `GET /api/notices` (öffentlich) · `POST /api/notices` (Inhaber) · `DELETE /api/notices/:id` (Inhaber)

**Discord:** Login via OAuth (`identify email guilds guilds.members.read`) · Rollen (`discord_roles`) werden beim Login aus dem Bot-Bereich geladen und auf dem Profil angezeigt. Aktionen (Register, Login, Rollenänderung, Shifts, Tickets, Meldungen) werden optional als „VBG Log“ in einen Discord-Webhook gepostet (`DISCORD_WEBHOOK_URL`).

> **Bearbeiten (`PUT /api/tickets/:id`):** Felder mit Themas/Kategorie/Priorität/Fälligkeitsdatum/Beschreibung. Nur für das **Team** (Bearbeiter/Inhaber); **Besucher** können nur kommentieren. Änderungen erscheinen als protokollierte Systemmeldung im Chat. Geschlossene Tickets sind gesperrt. Auch **Schließen/Wieder öffnen** ist Staff-only. Beim **Schließen** erzeugt der Server einen `archive_token`; die Antwort enthält `archive_url` – du kannst den Link direkt in die Zwischenablage kopieren und dem Besucher schicken.
> **Nachrichten:** optional `attachment` (Base64-Daten-URL, max. ~8 MB pro Bild, wird im Browser auf 1200 px komprimiert).

---

## ⏱️ 7. Keep-Alive gegen Render-Sleep

Render-Prozesse im **Free-Plan** schlafen nach ~15 Min ohne Traffic ein – die Seite antwortet dann erst nach einem Kaltstart wieder. Ein `setInterval` **innerhalb** des Servers kann das nicht verhindern, weil Render dabei den kompletten Prozess stoppt. Daher:

- **Empfohlen (kostenlos):** externer Uptime-Monitor wie [UptimeRobot](https://uptimerobot.com) (Free: 50 Monitore, pingen alle 5 Min von **verschiedenen Standorten** aus) oder [cron-job.org](https://cron-job.org). Einfach eine URL-„Ping/GET“-Überwachung auf `https://DEINE-RENDER-URL/api/ping` anlegen. Für „immer eine andere IP“ mehrere solcher Dienste nutzen – eine einzelne Instanz hat nur **eine** öffentliche IP und kann „verschiedene IPs pro Ping“ nicht selbst erzeugen.
- **Render Cron-Job** (Free: 2 Cron-Jobs): planmäßig `GET /api/ping` aufrufen (pingt aber nur von Render-IP).
- **Lokal/Self-Hosted:** `npm run keepalive` – pingt `TARGET_URL` (oder `BASE_URL`/`http://localhost:3000`) alle `PING_INTERVAL_MINUTES` (Standard 4).
- Der Server bietet zusätzlich `GET /api/ping` + einen eigenen Ticker (alle 4 Min, via `PING_INTERVAL_MINUTES` konfigurierbar) – das hilft lokal/bei Always-On, ersetzt aber keinen externen Monitor für den Render-Free-Sleep.

---

## 🖼️ Bilder

Alle Bilder liegen breit (`3440×1440`) im Ordner `IMGs/`. `Bild1.png` ist das **Hero-Hauptbild**; die übrigen 12 dienen als Vorschaubilder in Galerie und Shifts. Eigene Shift-Bilder werden im Browser auf max. 1440 px komprimiert und als Base64 in Turso gespeichert – so braucht kein externer Bildhost (alles läuft über Render + Turso).

> **Hinweis:** Das Spiel „VBG Verkehrsbetriebe Gravenberg“ ist ein **rein fiktives Roblox-Roleplay-Projekt** und steht in keinem Bezug zu einem echten Verkehrsunternehmen.