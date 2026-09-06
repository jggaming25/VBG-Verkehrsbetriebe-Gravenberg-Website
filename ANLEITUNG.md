# 🚌 VBG Verkehrsbetriebe Gravenberg – Detailierte Einrichtungs-Anleitung

Diese Anleitung führt dich **Schritt für Schritt** vom *leeren Ordner* bis zur *öffentlich erreichbaren Website* mit Login, Ticketsystem, Shifts und Discord-Anmeldung.

**Was am Ende läuft:**
- Website auf **Render** (kostenloser Web Service)
- Datenbank in **Turso** (kostenlos, Cloud)
- Bestätigungs-E-Mails + Team-Benachrichtigungen über **EmailJS**
- **Discord-Login**-Button
- Rollen: Besucher · Bearbeiter · Inhaber
- Inhaber-E-Mails: `janngenzmann@gmail.com`, `platzhalter1@gmail.com` (voreingestellt, änderbar)

---

## Inhalt

1. [Was du brauchst](#1-was-du-brauchst)
2. [Projekt vorbereiten & lokal testen](#2-projekt-vorbereiten--lokal-testen)
3. [Git-Repo erstellen & hochladen](#3-git-repo-erstellen--hochladen)
4. [Turso-Datenbank anlegen](#4-turso-datenbank-anlegen)
5. [EmailJS einrichten](#5-emailjs-einrichten)
6. [Discord-Login einrichten](#6-discord-login-einrichten)
7. [Render-Deployment](#7-render-deployment)
8. [Website nutzen (Rollen, Shifts, Tickets)](#8-website-nutzen)
9. [Der 1. Start & Test](#9-der-1-start--test)
10. [Häufige Probleme (Troubleshooting)](#10-häufige-probleme-troubleshooting)

---

## 1. Was du brauchst

| Werkzeug | Wozu | Link |
|---|---|---|
| **Node.js** (≥ 18) | Server lokal starten | https://nodejs.org |
| **Git** | Code auf GitHub/Render bringen | https://git-scm.com |
| **GitHub-Konto** | Repo für Render | https://github.com |
| **Render-Konto** | Web-Server (Website live) | https://render.com |
| **Turso-Konto** | Cloud-Datenbank | https://turso.tech |
| **EmailJS-Konto** | E-Mails senden | https://www.emailjs.com |
| **Discord-Konto** + App | Discord-Login | https://discord.com/developers/applications |

> Alle Dienste haben einen **kostenlosen Plan**, der für dieses Projekt locker reicht.

---

## 2. Projekt vorbereiten & lokal testen

### 2.1 Ordner prüfen

Der Projektordner muss so aussehen (Bilder unbedingt im Ordner `IMGs/`):

```
VBG Website/
├── server.js
├── db.js
├── package.json
├── README.md
├── ANLEITUNG.md        (diese Datei)
├── .gitignore
├── IMGs/               ← 13 PNG-Bilder (Bild1.png = Hero)
└── public/
    ├── index.html
    ├── css/style.css
    └── js/ (config.js, api.js, app.js, shifts.js, tickets.js, admin.js)
```

### 2.2 Abhängigkeiten installieren

Terminal im Projektordner öffnen (z. B. Windows PowerShell) und:

```bash
npm install
```

> Das installiert Express, Turso-Client, bcryptjs und cookie-parser. Es dauert meist unter einer Minute.

### 2.3 Lokalen Server starten

```bash
npm start
```

**Ohne** Turso wird automatisch eine lokale Datei **`local.db`** (SQLite) angelegt – ideal zum Testen.

Im Browser öffnen: **http://localhost:3000**

**Test:** Registriere dich mit `janngenzmann@gmail.com` → du bist automatisch **Inhaber** und kannst oben „Shifts“ → „+ Neue Schicht“ und in „Konto“ Rollen vergeben.

Server stoppen: `Strg + C` (im Terminal).

> ⚠️ Wichtig für Render: Der Fallback `local.db` liegt nur auf der Festplatte des Servers und wird bei jedem Redeploy gelöscht. Für die echte Website brauchst du also unbedingt Turso (Schritt 4).

---

## 3. Git-Repo erstellen & hochladen

### 3.1 Git initialisieren

```bash
git init
git add .
git commit -m "VBG Website – initial"
```

> `.gitignore` sorgt dafür, dass `node_modules/` und `local.db` **nicht** ins Repo kommen (sonst bricht der Build auf Render).

### 3.2 Auf GitHub hochladen

1. Auf **github.com** → **New repository** → Namen z. B. `vbg-website` → **Public** (kostenlos) oder Private → **Create repository**.
2. Im Terminal (die angezeigten Befehle von GitHub verwenden):

```bash
git remote add origin https://github.com/DEIN_NAME/vbg-website.git
git branch -M main
git push -u origin main
```

> Die Bilddateien sind ca. 50 MB groß – das ist für GitHub okay (Limit 100 MB pro Datei, 1 GB pro Repo).

---

## 4. Turso-Datenbank anlegen

Turso hostet die SQLite-Datenbank in der Cloud, damit alle Daten (Accounts, Shifts, Tickets) auch bei Server-Neustarts erhalten bleiben.

### 4.1 Konto + Datenbank

1. Auf **https://turso.tech** registrieren & einloggen.
2. **Create database** klicken.
   - Name: `vbg` (darf nur Kleinbuchstaben/Zahlen enthalten)
   - Region: einen Standort nah bei dir wählen (z. B. Frankfurt) – egal für dieses Projekt
3. **Create** klicken.

### 4.2 Zugangsdaten kopieren

Auf der Datenbankseite siehst du die **URL**, z. B.:

```
libsql://vbg-deinname.turso.io
```

Für das **Auth-Token**:
1. Tab **Tokens** öffnen (oder oben „…“ → Tokens).
2. **Create Token** → wahlweise mit Ablaufdatum.
3. Token kopieren (beginnt mit `eyJ...` – sieht aus wie eine lange Zeile).

> **Diese zwei Werte speicherst du dir** – du brauchst sie in Schritt 7 für Render. Notfall-Link: https://app.turso.tech

> **Optional – per CLI:** Falls du das Turso-CLI installieren willst: `npm i -g @tursodatabase/turso` und dann `turso db create vbg`, `turso db show vbg`, `turso db tokens create vbg`. Das ist aber nicht nötig – die Webseite reicht.

### 4.3 Tabellen

Die Tabellen (users, sessions, shifts, tickets, ticket_messages) werden **automatisch beim ersten Serverstart** angelegt – du musst nichts in Turso konfigurieren.

---

## 5. EmailJS einrichten

EmailJS schickt aus dem Browser heraus E-Mails – für **zwei Zwecke**:

1. **Verifizierungs-Code** nach der Registrierung
2. **Benachrichtigung an das Team**, wenn ein neues Ticket kommt

> Falls du diesen Schritt überspringst: Die Website funktioniert trotzdem – der Verifizierungs-Code wird dann einfach direkt auf der Seite angezeigt.

### 5.1 Konto + Service

1. Auf **https://www.emailjs.com** registrieren.
2. **Email Services** → **Add New Service** → z. B. **Gmail** oder **Outlook** auswählen.
   - Bei Gmail: E-Mail-Adresse + „App-Passwort“ (bei 2-Faktor-Auth) oder den OAuth-Link verwenden.
3. Nach dem Verbinden bekommt der Service eine **Service ID** wie `service_abc1234` oder `default_service`. Notieren!

### 5.2 Template 1 – Verifizierungs-Code

**Email Templates** → **Create New Template**:

- **Name:** z. B. `vbg-verifizierung`
- **Template ID:** wird automatisch vergeben (z. B. `template_xyz123`). Notieren!
- **Subject:** z. B. `Dein VBG-Verifizierungs-Code`
- **Content:** Unter **Content** den Text schreiben und die **Variablen-Knöpfe** verwenden:

```
Hallo {{username}},

schön, dass du bei VBG Verkehrsbetriebe Gravenberg dabei bist!

Dein Verifizierungs-Code lautet:

    {{verification_code}}

Trage ihn auf der Website unter "Konto" ein, um deine E-Mail zu bestätigen.

– Dein VBG-Team
```

> Die Variablen `{{username}}` und `{{verification_code}}` müssen **exakt** so heißen wie in `public/js/config.js` verwendet.

⚠️ In den **Template-Settings** unter **"To email"** die Variable `{{to_email}}` als Empfänger setzen, sonst schickt EmailJS an keine Adresse.

### 5.3 Template 2 – Ticket-Benachrichtigung

Zweites Template `vbg-ticket` anlegen:

```
Subject: Neues Ticket #{{ticket_id}} – {{ticket_subject}}

Neues Support-Ticket von {{from_username}}!

#{{ticket_id}} – {{ticket_subject}}
Priorität: {{priority}}

Logge dich ein und übernimm das Ticket unter "Tickets".
```

- **"To email"** → `{{to_email}}`

### 5.4 Public Key holen

**Account** → **API Keys** (oder oben im Menü „Account“):
- Den **Public Key** kopieren (beginnt z. B. mit `abcDEf123...`). Notieren!

### 5.5 Werte in die Datei eintragen

Datei **`public/js/config.js`** öffnen und die 4 Werte eintragen:

```js
window.VBG = window.VBG || {};

Object.assign(window.VBG, {
  emailjs: {
    publicKey:        'DEIN_PUBLIC_KEY',      // aus Account → API Keys
    serviceId:        'DEIN_SERVICE_ID',      // z. B. service_abc1234
    verifyTemplateId: 'TEMPLATE_1_ID',        // vbg-verifizierung
    ticketTemplateId: 'TEMPLATE_2_ID'         // vbg-ticket
  },
  ...
});
```

> Der Public Key ist dafür gedacht, im Browser zu stehen (öffentliche Client-Zugangsdaten). Service-ID und Template-IDs sind ebenfalls clientseitig normal.

**Änderungen danach immer neu auf Git pushen** (Schritt 3.2), damit Render die neue Version bekommt.

---

## 6. Discord-Login einrichten

Der blaue „Mit Discord anmelden“-Button nutzt den offiziellen **Discord OAuth2**-Login. Spieler, die sich mit Discord anmelden, sind automatisch **E-Mail-verifiziert** und bekommen ihren Discord-Avatar angezeigt.

> **Wichtig:** Das funktioniert erst, wenn die Website online ist, weil Discord eine feste Redirect-Adresse braucht. Du kannst es also VOR dem Deployment vorbereiten, aber erst NACHHER mit echter URL testen. (Alternativ bei lokalem Test REDIRECT auf http://localhost:3000/... setzen.)

### 6.1 Discord-App erstellen

1. Auf **https://discord.com/developers/applications** → **New Application**.
2. Name z. B. `VBG Gravenberg` → **Create**.
3. **App Icon** hochladen, **Description** „Logge dich mit deinem Discord-Account bei VBG ein“ eintragen.

### 6.2 OAuth2 konfigurieren

1. Links: **OAuth2 → General**.
2. **Client ID** kopieren (lange Zahl). Notieren!
3. **Client Secret** → **Reset** klicken und den neuen Wert kopieren (Secret wird nur einmal angezeigt!). Notieren!
4. **Redirects:** unter „Redirects“ die exakte Adresse hinzufügen:

```
https://DEIN-NAME.onrender.com/api/auth/discord/callback
```

   > Erst nach dem Deployment (Schritt 7) weißt du die endgültige Render-URL. Die Redirect-URL muss exakt mit `BASE_URL` + `/api/auth/discord/callback` übereinstimmen.

5. Links: **OAuth2 → URL Generator** (zum Checken):
   - Scopes: **identify** und **email** anhaken
   - **Redirect URL** auswählen
   - Die generierte URL sollte lauten: `https://discord.com/oauth2/authorize?...&scope=identify%20email...`

6. **Zusätzlich oben**: Bei „Default Authorization Link“ können `identify` und `email` markiert werden (kein Pflichtschritt).

---

## 7. Render-Deployment

### 7.1 Web Service anlegen

1. Auf **https://render.com** registrieren (kostenloser Plan).
2. **New → Web Service**.
3. Dein GitHub-Repo auswählen (kann manchmal Nochmal verbinden erfordern).
4. Settings:
   - **Name:** `vbg-gravenberg` (wird Teil der URL: `vbg-gravenberg.onrender.com`)
   - **Region:** egal (z. B. Frankfurt)
   - **Branch:** `main`
   - **Root Directory:** *leer lassen* (Projekt liegt in der Wurzel)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. **Environment** öffnen → **Add Environment Variable**:

| Variable | Wert | Beispiel |
|---|---|---|
| `TURSO_URL` | Turso-Datenbank-URL | `libsql://vbg-deinname.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso-Token (aus 4.2) | `eyJhbGciOi...` |
| `BASE_URL` | Volle Website-URL (ohne / am Ende) | `https://vbg-gravenberg.onrender.com` |
| `NODE_ENV` | `production` | `production` |
| `OWNER_EMAILS` | optional, Inhaber-E-Mails | `janngenzmann@gmail.com,platzhalter1@gmail.com` |
| `DISCORD_CLIENT_ID` | aus 6.2 | `123456789012345678` |
| `DISCORD_CLIENT_SECRET` | aus 6.2 | `xxxxxxxx` |

> `NODE_ENV=production` ist wichtig – dann werden Cookies nur über HTTPS gesendet (sichere Sessions).

### 7.2 Erster Start

**Deploy Web Service** klicken. Render installiert jetzt automatisch, startet den Server und **legt die Tabellen in Turso an**. (Erster Build dauert ca. 2–4 Minuten; der kostenlose Plan pausiert nach Inaktivität ~15 Min – beim nächsten Aufruf dauert das Laden dann ein paar Sekunden.)

### 7.3 Nach dem Deployment

1. **Discord-Redirect**: Falls du Discord nutzt, prüfe in 6.2, dass die eingetragene Redirect-URL exakt deiner echten Render-URL entspricht:
   `https://vbg-gravenberg.onrender.com/api/auth/discord/callback`
2. **Discord-Login testen**: Klick auf „Mit Discord anmelden“ → autorisieren → zurück auf die Seite (eingeloggt).
3. **E-Mails testen**: Registriere dich mit `janngenzmann@gmail.com` → du bekommst eine E-Mail mit Verifizierungs-Code und hast direkt die **Inhaber**-Rolle.

---

## 8. Website nutzen

### 8.1 Rollen

| Rolle | Kann … |
|---|---|
| **Besucher** | Shifts & Coming-Soon-Seiten sehen, Tickets erstellen, eigenes Konto |
| **Bearbeiter** | + alle Tickets sehen, **übernehmen/abgeben**, beantworten, schließen |
| **Inhaber** | + Rollen vergeben, Shifts anlegen/löschen |

- **Registrierung:** E-Mail frei → Rolle **Besucher**. Die E-Mails aus `OWNER_EMAILS` werden automatisch **Inhaber**.
- **Rollen ändern:** Inhaber → „Konto“ → Kontoübersicht → Auswahl bei einem Spieler. (Feste Inhaber-E-Mails und das eigene Konto können nicht herabgestuft werden.)

### 8.2 Shifts anlegen (nur Inhaber)

1. Tab **Shifts** → **+ Neue Schicht**.
2. Titel, Datum, Start-/Endzeit, optional Beschreibung.
3. **Bild:** aus der Galerie (die IMG-Screenshots) **oder** „Eigenes Bild“ hochladen (wird automatisch auf 1440 px komprimiert und in Turso gespeichert – bleibt daher auch nach Neustarts erhalten).
4. **Schicht veröffentlichen**.

### 8.3 Tickets (nur nach Login)

1. Tab **Tickets** → **+ Neues Ticket** (Kategorie, Priorität, Beschreibung).
2. Das Team bekommt per E-Mail eine Benachrichtigung.
3. **Bearbeiter/Inhaber:** Ticket öffnen → **Übernehmen**, antworten, **Schließen**.
4. Der Ersteller kann ein geschlossenes Ticket wieder **öffnen** („Wieder öffnen“).

---

## 9. Der 1. Start & Test

Eine Checkliste für nach dem Deployment:

- [ ] `https://vbg-gravenberg.onrender.com` lädt, Design ist grün, Startseite zeigt das Hero-Bild
- [ ] Dark-/Light-Mode-Button (Mond/Sonne oben rechts) funktioniert
- [ ] Registrierung mit Test-E-Mail → Verifizierungs-Code kommt per E-Mail
- [ ] Login mit `janngenzmann@gmail.com` → „Konto“ zeigt **Inhaber**
- [ ] Als Inhaber: Neue Schicht anlegen (mit Galerie- und mit Upload-Bild)
- [ ] Als Besucher (2. Browser / Inkognito): Ticket erstellen
- [ ] Als Inhaber: Ticket übernehmen, antworten, schließen
- [ ] Discord-Login geht einmal komplett durch
- [ ] Second-Owner (`platzhalter1@gmail.com`) kann sich auch als Inhaber registrieren (falls gewünscht)

---

## 10. Häufige Probleme (Troubleshooting)

| Problem | Ursache / Lösung |
|---|---|
| **„Nicht angemeldet“ beim Laden** | Cookies: In production wird `secure` verlangt → prüfe `NODE_ENV=production`. Bei lokalbasis ohne Turso egal. |
| **Login klappt lokal, aber nicht online / Daten weg** | `TURSO_URL`/`TURSO_AUTH_TOKEN` fehlen → Render nutzt `local.db` auf der Flüchtigen Festplatte und verliert alles beim Redeploy. Turso-Variablen setzen. |
| **Discord-Button zeigt Fehler/404** | `DISCORD_CLIENT_ID`/`SECRET` fehlen **oder** die Redirect-URL in der Discord-App stimmt nicht exakt mit `BASE_URL/api/auth/discord/callback` überein. |
| **Andere-Nutzer-Rolle lässt sich nicht ändern** | Nur **Inhaber** darf Rollen ändern. Feste Inhaber-E-Mails können nie herabgestuft werden. |
| **Keine E-Mails** | 1) Public Key/Service/Template-IDs in `public/js/config.js` geprüft? 2) Template-„To email“ = `{{to_email}}`? 3) Bei Gmail App-Passwort nötig. 4) `git push` nach Änderung + **Redeploy** auf Render. |
| **Verifizierungs-Code fehlt** | Solange EmailJS leer ist, wird der Code nach der Registrierung direkt in einer Toast-Nachricht angezeigt. Danach unter „Konto“ eingeben. |
| **„Keine Berechtigung“ beim Schicht anlegen** | Du bist nicht **Inhaber**. Registriere dich mit einer `OWNER_EMAILS`-Adresse oder lass dir vom Inhaber die Rolle geben. |
| **Site-down nach Inaktivität** | Normal im kostenlosen Render-Plan – einfach neu laden (Wart ca. 30–60 s). |
| **Tickets nicht sichtbar für Staff** | Staff = Rolle **Bearbeiter** oder **Inhaber**. Prüfe die Rolle in „Konto → Kontoübersicht“. |
| **HEIC/riesige Uploads** | Uploads werden auf 1440 px JPEG (Qualität 0.74) komprimiert. Manche Formate (HEIC/TIFF) werden vom Browser nicht unterstützt → vorher konvertieren. |

---

### 👋 Fertig!

War noch etwas unklar oder hakt irgendwo ein Schritt? Sag einfach Bescheid – das VBG-Team hilft gerne. 😉