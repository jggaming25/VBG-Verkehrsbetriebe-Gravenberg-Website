# 🚌 VBG Verwalter – Verkehrsbetriebe Gravenberg

Team-Verwaltung für das **fiktive Roblox Bus-RP-Game** „VBG Verkehrsbetriebe Gravenberg“:
Dienstplan mit Anmeldung (Staff Sign-Ups), Auto-Shift-Einteilung, Activity-Erfassung,
Inactivity-Anträge, Kundenservice-Strafe und Admin-Bereich – als klassische SPA ohne Bundler.

**Tech-Stack:** Node.js + Express · [Turso](https://turso.tech)/SQLite (`@libsql/client`) · bcrypt · Cookie/Session · Vanilla JS

---

## Übersicht

| Bereich | Beschreibung |
|---|---|
| **Start** | Neuigkeiten/Hinweise aus der Verwaltung + Bildergalerie (`/IMGs`). |
| **Anmeldung** | Offene Shifts mit Duty-Übersicht, Wunschfahrt + Standort anmelden; Anmeldung bis 60 Min vor Shift-Beginn stornierbar. |
| **Dienstplan** | Kalender mit geplanten Shifts, eingeteilten Fahrern und freien Plätzen. |
| **Meine Dienste** | Deine Einteilungen für die aktuelle Woche (+ Auto-Shift-Vorschau). |
| **Activity** | Teilnahme-Erfassung pro Shift; „Nicht teilgenommen“ erzeugt automatisch eine Kundenservice-Strafe. |
| **Inactivity** | Anträge auf Beurlaubung; Entscheidung durch Scheduler/Admin. |
| **Kundenservice Strafe** | Offene Strafzeiten als Pflicht-Dienste; automatische Generierung ab konfigurierter Schwelle. |
| **Profil** | Nutzerprofil, Passwort ändern, Profilbild. |
| **Admin** | Nur für Admins: Benutzerverwaltung, Shifts, Dutys, Linien, Standorte, Meldungen, News, Einstellungen, Auto-Shift, Aktivlist & Strafen-Konfiguration. |

### Rollen
- **Busfahrer** – Anmeldung, Meine Dienste, Activity, Inactivity, Profil
- **Senior Busfahrer** (Scheduler) – zusätzlich: Auto-Shift, Zuweisungen, Plan bestätigen, Activity-Erfassung, Inactivity-Entscheidungen, Strafen generieren
- **Admin** – zusätzlich: Benutzer anlegen/bearbeiten, Shifts/Dutys/Linien/Standorte/News/Meldungen/Einstellungen verwalten

Aufteilung: `busfahrer` < `senior` < `admin`. Scheduler-Rechte = `admin` oder `senior`.

---

## 🚀 Lokal ausprobieren

```bash
npm install
npm start
# Ohne TURSO_URL wird automatisch die lokale SQLite-Datei "local.db" angelegt
# → http://localhost:3000
```

Beim ersten Start legt die Seed-Logik ein Admin-Konto an (env `ADMIN_USERNAME`,
Standard `admin`, mit Einmal-Passwort `ADMIN_PASSWORD`, Standard `admin123`).
Beim ersten Login muss ein eigenes Passwort festgelegt werden.

Für den lokalen Test sind **keine Umgebungsvariablen** nötig (DB = `local.db`).

---

## 📦 Auf Render deployen

1. Projekt als **Git-Repo** auf GitHub/GitLab pushen (inkl. `IMGs/`).
2. Auf [render.com](https://render.com) → **New → Web Service** → Repo auswählen.
3. Settings (**Build:** `npm install`, **Start:** `npm start`) und Umgebungsvariablen setzen.
   Die Werte werden in `render.yaml` verwaltet (Turso-URL, Admin-Konto).

---

## 🗄️ Turso-Datenbank anlegen

1. Konto erstellen auf [turso.tech](https://turso.tech) → **Database** (z. B. `vbg`).
2. **URL** und **Auth token** kopieren und setzen:
   ```
   TURSO_URL=libsql://vbg-xxx.turso.io
   TURSO_AUTH_TOKEN=eyJ...
   ```
3. Tabellen werden beim ersten Serverstart automatisch angelegt.

---

## 🧪 Umgebungsvariablen gesamt

| Variable | Beispiel | Pflicht? |
|---|---|---|
| `TURSO_URL` | `libsql://vbg-xxx.turso.io` | ⚠️ sonst lokale Datei `local.db` |
| `TURSO_AUTH_TOKEN` | `eyJ...` | ✅ für Turso-Cloud |
| `ADMIN_USERNAME` | `admin` | ✅ Seed (Standard `admin`) |
| `ADMIN_PASSWORD` | `…` | ✅ Seed-Einmalpasswort (Standard `admin123`) |
| `ADMIN_DISPLAYNAME` | `Administrator` | optional |
| `BASE_URL` | `https://vbg.onrender.com` | optional (Links) |
| `NODE_ENV` | `production` | ⚠️ sonst keine Secure-Cookies |
| `PING_INTERVAL_MINUTES` | `2` | optional (Server-Ticker + keep-alive.js) |
| `KEEPALIVE_TARGETS` / `TARGET_URL` | `https://vbg.onrender.com` | optional (nur keep-alive.js) |

---

## 📁 Projektstruktur

```
VBG Website/
├── server.js              # Express-Server + komplette API (Auth, Shifts, Anmeldung, Auto-Shift, Activity, Inactivity, Strafe, Admin)
├── db.js                  # libsql/Turso-Verbindung + Schema + Admin-Seed
├── keep-alive.js          # optionales Ping-Script gegen Render-Sleep
├── package.json
├── README.md
├── render.yaml            # Render-Service-Definition inkl. Env-Vars
├── IMGs/                  # Screenshots für Landeseite + Bildarchiv
└── public/
    ├── index.html         # SPA-Shell (Login, Einmal-Passwort, App, Lightbox)
    ├── impressum.html     # Impressum (eigenständige Seite)
    ├── datenschutz.html   # Datenschutzerklärung
    ├── archiv.html        # Öffentliches Bildarchiv (Galerie)
    ├── css/style.css      # Design-System (Light-/Dark-Mode)
    └── js/
        ├── config.js      # Navigation + Konstanten (window.VBG)
        ├── api.js         # Fetch-Wrapper, CSRF, Session, Helfer
        ├── app.js         # App-Router, Tabs, Theme, Login, Lightbox
        └── pages/         # Seite-Module (Start, Anmeldung, Dienstplan, …)
            ├── start.js
            ├── anmeldung.js
            ├── dienstplan.js
            ├── meinedienste.js
            ├── activity.js
            ├── inactivity.js
            ├── strafe.js
            ├── profil.js
            └── admin.js
```

---

## 🔌 API-Endpunkte (Kurzübersicht)

Authentifizierung: Session-Cookie `vbg_sid` + CSRF-Cookie `vbg_csrf` (`X-CSRF-Token`-Header
bei allen Nicht-GET-Requests).

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/session` · `POST /api/password` · `POST /api/password/first` · `POST /api/profile`

**Öffentlich:** `GET /api/ping` · `GET /api/news` · `GET /api/linien` · `GET /api/standorte` · `GET /api/images`

**Fahrer:** `GET /api/shifts` · `GET /api/dienstplan` · `GET /api/meine-dienste` · `GET/POST /api/anmeldung` · `DELETE /api/anmeldung/:shiftId`
· `GET /api/activity` · `GET/POST /api/inactivity` · `GET /api/strafe`

**Scheduler (`senior`/`admin`):** `POST /api/admin/autoshift` · `POST /api/admin/assignments` · `POST /api/admin/confirm-plan`
· `GET/POST /api/admin/activity` · `GET /api/admin/activity-list` · `POST /api/admin/inactivity/:id`
· `POST /api/admin/strafe` · `POST /api/admin/strafe-generate` · `GET /api/admin/dutys` · `GET /api/admin/settings`

**Admin (nur `admin`):** `POST /api/admin/strafe-config` · `GET/POST/PUT/DELETE /api/admin/users[/:id][/reset-password]`
· `GET/POST/PUT/DELETE /api/admin/shifts[/:id][/duplicate]` · `POST/PUT/DELETE /api/admin/dutys[/:id]`
· `GET/POST/PUT/DELETE /api/admin/linien[/:id]` · `GET/POST/PUT/DELETE /api/admin/standorte[/:id]`
· `GET/POST/PUT/DELETE /api/admin/news[/:id]` · `POST /api/admin/meldung` · `GET/POST /api/admin/settings`

---

## 🖼️ Bilder

Alle Bilder liegen im Ordner `IMGs/` (statt der gleichnamigen URL `/IMGs/…`). `Bild1.png`
und `Netzplan_V1.png` sind benannte Motive; der Rest dient als Galerie in **Start** und
**Bildarchiv** (`/archiv.html`).

> **Hinweis:** Das Spiel „VBG Verkehrsbetriebe Gravenberg“ ist ein **rein fiktives Roblox-Roleplay-Projekt**
> und steht in keinem Bezug zu einem echten Verkehrsunternehmen.