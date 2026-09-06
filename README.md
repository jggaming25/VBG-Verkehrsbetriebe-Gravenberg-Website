# 🚌 VBG Verkehrsbetriebe Gravenberg

Website für das **fiktive Roblox Bus-RP-Game** „VBG Verkehrsbetriebe Gravenberg“ – mit Licht-/Dark-Mode, Shifts-Tab, Coming-Soon-Seiten (Netzplan & Linienübersicht, DE + EN), einem **Discord-ähnlichen Ticketsystem** (Login/Register, „Übernehmen“, Rollen) und einer **Kontoübersicht** zur Rollenvergabe.

**Tech-Stack:** Node.js + Express · [Render](https://render.com) · [Turso](https://turso.tech) (SQLite-Datenbank) · [EmailJS](https://www.emailjs.com) · Discord OAuth-Login

---

## Übersicht

| Bereich | Beschreibung |
|---|---|
| **Start / Landing** | Hero mit `IMGs/Bild1.png` als breitem Hintergrund, restliche Bilder als Vorschaugalerie, Tags #Roblox #Bus #Fiktiv |
| **Shifts** | Alle Shifts mit Datum, Uhrzeit + Vorschaubild. **Inhaber** legen Shifts an – Bild aus der IMG-Galerie **oder eigener Upload** (wird im Browser komprimiert und in Turso gespeichert) |
| **Netzplan / Linienübersicht** | „Coming Soon“ mit deutschen **und** englischen Texten |
| **Tickets** | Nur nach Anmeldung sichtbar. Discord-artiger Chat, „Übernehmen“/„Abgeben“, Prioritäten, Kategorien, Schließen/Wieder öffnen, Systemmeldungen |
| **Konto / Kontoübersicht** | Profil, E-Mail-Verifizierung, Rollenübersicht aller Spieler. **Inhaber** können Rollen vergeben (Besucher/Bearbeiter/Inhaber) |

### Rollen
- **Besucher** – kann Shifts sehen und Tickets erstellen
- **Bearbeiter** (Staff) – kann Tickets übernehmen, beantworten und schließen
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
   - Unter **Default Authorization Link** die Scopes `identify` und `email` markieren.
3. Umgebungsvariablen auf Render:
   ```
   DISCORD_CLIENT_ID=1234567890...
   DISCORD_CLIENT_SECRET=xxxxxxxx
   BASE_URL=https://DEINE-RENDER-URL.onrender.com
   ```
   > `BASE_URL` ist wichtig – steuert die Admin-Seite und die OAuth-Redirect-URL.

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
| `SESSION_SECRET` | (reserviert) | – |

---

## 📁 Projektstruktur

```
VBG Website/
├── server.js              # Express-Server + komplette API (Auth, Discord OAuth, Shifts, Tickets, Rollen)
├── db.js                  # Turso-Verbindung + Tabellen
├── package.json
├── README.md
├── IMGs/                  # 13 breite Roblox-Screenshots (3440×1440), Bild1.png = Hero
└── public/
    ├── index.html         # SPA mit allen Tabs + Modals
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

**Tickets:** `GET /api/tickets` · `POST /api/tickets` · `GET /api/tickets/:id/messages` · `POST /api/tickets/:id/messages` · `POST /api/tickets/:id/claim` · `.../unclaim` · `.../close` · `.../reopen`

---

## 🖼️ Bilder

Alle Bilder liegen breit (`3440×1440`) im Ordner `IMGs/`. `Bild1.png` ist das **Hero-Hauptbild**; die übrigen 12 dienen als Vorschaubilder in Galerie und Shifts. Eigene Shift-Bilder werden im Browser auf max. 1440 px komprimiert und als Base64 in Turso gespeichert – so braucht kein externer Bildhost (alles läuft über Render + Turso).

> **Hinweis:** Das Spiel „VBG Verkehrsbetriebe Gravenberg“ ist ein **rein fiktives Roblox-Roleplay-Projekt** und steht in keinem Bezug zu einem echten Verkehrsunternehmen.