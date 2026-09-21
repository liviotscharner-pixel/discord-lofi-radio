# Discord Lofi Radio Bot

Ein Discord-Bot, der einem Voice-Channel beitritt und **kontinuierliche Lofi-Radio-Streams** abspielt. Kein YouTube-Scraping, keine lokalen Musikdateien – nur öffentliche Icecast-/Radio-Streams.

## Sender

| Key | Name | Stream |
|-----|------|--------|
| `hiphop` | Lofi HipHop | [SomaFM Fluid](https://somafm.com/fluid/) – Instrumental HipHop / Future Soul |
| `house` | Lofi House | [SomaFM Beat Blender](https://somafm.com/beatblender/) – Deep House & Downtempo |
| `gaming` | Lofi Gaming Music | [SomaFM DEF CON Radio](https://somafm.com/defcon/) – Elektronische Gaming-/Hacker-Vibes |

Die URLs liegen in `stations.json` bzw. `src/stations.json` und können bei Bedarf ausgetauscht werden.

## Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `/radio station:` | Tritt deinem Voice-Channel bei und spielt den gewählten Sender. Danach erscheint eine Nachricht mit **Buttons** zum Umschalten. |
| `/stop` | Stoppt die Wiedergabe und verlässt den Voice-Channel. |
| `/now` | Zeigt den aktuell laufenden Sender. |

Beim Wechsel des Senders (Slash-Befehl oder Button) bleibt der Bot im Channel und tauscht nur den Stream.

---

## Voraussetzungen

- **Node.js** 18+ (LTS empfohlen)
- **FFmpeg** im `PATH` (zwingend für Audio-Decoding)
- Ein Discord-Bot im [Developer Portal](https://discord.com/developers/applications)

### FFmpeg installieren

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg

# macOS (Homebrew)
brew install ffmpeg

# Windows (Chocolatey)
choco install ffmpeg
```

Prüfen: `ffmpeg -version`

---

## Discord Developer Portal – Setup

1. Gehe zu https://discord.com/developers/applications und erstelle eine **New Application**.
2. Unter **Bot** → Bot hinzufügen, Token kopieren (`DISCORD_TOKEN`).
3. Unter **Bot** → Privileged Gateway Intents:
   - Für diesen Bot reichen die Standard-Intents. Aktiviere ggf. nichts Extra; der Code nutzt `Guilds` + `Guild Voice States`.
4. Unter **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: **Connect**, **Speak**, **Use Voice Activity** (optional), sowie Lesen/Schreiben von Nachrichten falls gewünscht (`Send Messages`, `Embed Links`)
5. Invite-URL öffnen und den Bot auf deinen Server einladen.

Beispiel-Invite (Client-ID ersetzen):

```
https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```

`3148800` = Connect + Speak (+ View Channel). Passe die Permissions im Generator an.

Unter **General Information** findest du die **Application ID** → `DISCORD_CLIENT_ID`.  
Die **Server-ID** (Rechtsklick auf Server → ID kopieren, Developer Mode an) → optional `DISCORD_GUILD_ID` für sofortige Slash-Command-Registrierung.

---

## Installation & Start

```bash
git clone https://github.com/liviotscharner-pixel/discord-lofi-radio.git
cd discord-lofi-radio
cp .env.example .env
# .env mit DISCORD_TOKEN, DISCORD_CLIENT_ID (und optional DISCORD_GUILD_ID) füllen

npm install
npm run build
npm start
```

### Entwicklung (Hot-Reload)

```bash
npm run dev
```

### Slash-Commands manuell registrieren

Commands werden beim Start automatisch registriert. Optional:

```bash
npm run register
```

- Mit `DISCORD_GUILD_ID`: sofort sichtbar auf diesem Server.
- Ohne: globale Registrierung (kann bis zu ~1 Stunde dauern).

---

## Umgebungsvariablen (`.env`)

```env
DISCORD_TOKEN=dein_bot_token
DISCORD_CLIENT_ID=deine_application_id
DISCORD_GUILD_ID=optional_server_id
```

---

## Nutzung

1. Bot starten (`npm start`).
2. In einen Voice-Channel gehen.
3. `/radio` ausführen und z. B. **Lofi HipHop** wählen.
4. Mit den Buttons unter der Bot-Nachricht den Sender wechseln.
5. `/stop` zum Beenden.

Fehler (nicht im Voice-Channel, fehlende Rechte) erscheinen **ephemeral** (nur für dich sichtbar).

---

## Technik

- **discord.js** v14+
- **@discordjs/voice** + FFmpeg für HTTP(S)-Icecast-Streams
- **TypeScript**, CommonJS-Build nach `dist/`
- Encryption: `libsodium-wrappers` (Fallback `tweetnacl`) / Opus via `opusscript` (optional: `@discordjs/opus` für native Performance)

Scripts:

| Script | Aktion |
|--------|--------|
| `npm run build` | TypeScript → `dist/` |
| `npm start` | Bot starten |
| `npm run dev` | Dev-Mode mit `tsx watch` |
| `npm run register` | Slash-Commands registrieren |

---

## Hinweise & Caveats

- **FFmpeg** muss installiert sein, sonst startet kein Audio.
- Öffentliche Streams können ausfallen oder die URL ändern – dann Eintrag in `stations.json` aktualisieren und neu bauen.
- SomaFM-Streams sind kostenlos nutzbar; bitte die [SomaFM-Nutzungsbedingungen](https://somafm.com/) respektieren und den Dienst unterstützen, wenn du ihn magst.
- Der Bot speichert keine Musikdateien und scrapt kein YouTube.
- Pro Server läuft maximal eine Radio-Session.

## Lizenz

MIT
