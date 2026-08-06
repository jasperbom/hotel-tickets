# Hotel Ticket System

## Versiebeheer

Bij elke commit die naar GitHub gepusht wordt, **moet** de versie in `hotel_tickets/config.yaml` verhoogd worden met `0.0.1`.

- Huidig formaat: `"x.y.z"` (bijv. `"1.3.22"`)
- Elke push: z +1 (bijv. 1.3.22 → 1.3.23)
- Bij z = 99: y +1 en z = 0 (bijv. 1.3.99 → 1.4.0)
- Bij y = 99: x +1 en y = 0 en z = 0

De versie in `config.yaml` en de commit message moeten altijd overeenkomen (bijv. `v1.3.23: ...`).

## Beta-addon

`hotel_tickets_beta/` is **gegenereerde code**: een kopie van `hotel_tickets/`
met een eigen slug, poorten en database (`scripts/sync-beta.sh`). Nooit
handmatig bewerken.

- Functionaliteit wijzigen → `hotel_tickets/`
- Beta-specifieke instellingen (slug, poorten, `BETA_MODE`) → `scripts/beta-overlay/`
- Na een wijziging in `hotel_tickets/`: `./scripts/sync-beta.sh` draaien en de
  gewijzigde map meecommitten (een GitHub Action doet dit ook automatisch op `main`)

Ticket- en taakbeheersysteem voor hotels, gebouwd als Home Assistant addon.
Bedoeld voor drie afdelingen: technische dienst, huishouding en receptie/conciërge.

## Architectuur

```
hotel-tickets/
├── hotel_tickets_beta/          # Gegenereerde beta-addon (niet bewerken)
├── scripts/
│   ├── sync-beta.sh             # Genereert hotel_tickets_beta/
│   └── beta-overlay/            # Beta-specifieke config.yaml + run.sh
├── hotel_tickets/
│   ├── config.yaml              # HA addon manifest
│   ├── Dockerfile               # Multi-stage: Python backend + Node frontend
│   ├── run.sh                   # Startup (bashio, env vars)
│   ├── backend/                 # FastAPI + SQLite
│   │   ├── main.py              # App entry point, lifespan
│   │   ├── database.py          # SQLAlchemy async setup
│   │   ├── models.py            # Ticket, TicketComment, RecurringTemplate, UserRole
│   │   ├── auth.py              # HA token verificatie, CurrentUser
│   │   ├── beta.py              # Beta-modus (vlaggen + paden productiedata)
│   │   ├── scheduler.py         # APScheduler voor recurring tasks (cron)
│   │   ├── routers/             # FastAPI routers
│   │   │   ├── tickets.py       # CRUD + claim + commentaar
│   │   │   ├── users.py         # Rollen & medewerkers
│   │   │   ├── locations.py     # HA areas sync
│   │   │   ├── recurring.py     # Template beheer
│   │   │   ├── beta.py          # Beta-status + productiedata kopiëren
│   │   │   └── reports.py       # Analytics, CSV/Excel export
│   │   └── services/
│   │       ├── ha_client.py     # HA Supervisor API client
│   │       ├── notifications.py # Push / persistent / e-mail
│   │       └── ha_entities.py   # Sensor state updates in HA
│   └── frontend/                # React + TypeScript + Vite + Tailwind
│       └── src/
│           ├── api/client.ts    # Axios client + alle types
│           ├── pages/           # MijnOverzicht, TicketList, TicketDetail, ...
│           └── components/      # TicketCard, StatusBadge, RecurrenceEditor, ...
└── custom_component/
    └── hotel_tickets/           # HA custom component
        ├── __init__.py          # Registreert hotel_tickets.create_ticket service
        └── services.yaml        # Service schema definitie
```

## Tech stack

| Laag | Keuze | Reden |
|---|---|---|
| Backend | Python 3.13 + FastAPI | Async, snel, HA-ecosysteem |
| Database | SQLite + SQLAlchemy async | Embedded, geen extra dienst |
| Scheduler | APScheduler (AsyncIOScheduler) | Cron-schema's voor recurring tasks |
| Frontend | React 18 + TypeScript + Vite | Moderne SPA |
| Styling | Tailwind CSS | Utility-first, mobiel-vriendelijk |
| Grafieken | Recharts | Lichtgewicht charting voor React |
| HA comms | aiohttp → Supervisor API | Auth, areas, notificaties, entities |

## Lokaal draaien

```bash
# Vereisten: Python 3.13 (via Homebrew), Node.js

cd hotel_tickets

# Backend (eerste keer: maak venv aan)
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# Backend starten (poort 8099, dev mode zonder HA auth)
DEV_MODE=true DB_PATH=./test.db .venv/bin/python3.13 -m uvicorn backend.main:app --reload --port 8099

# Frontend (apart terminal)
cd frontend
npm install
npm run dev -- --port 5174
# → http://localhost:5174
```

In dev mode (`DEV_MODE=true`) wordt het token `dev-token` geaccepteerd zonder HA.
De Vite dev server proxiet `/api/*` automatisch naar `localhost:8099`.

## HA addon installeren

1. Kopieer de `hotel_tickets/` map naar je HA addons directory (bijv. `/addons/hotel_tickets/`)
2. Kopieer `custom_component/hotel_tickets/` naar `/config/custom_components/hotel_tickets/`
3. Herstart HA → installeer de addon via Supervisor → Add-on Store (lokaal)
4. Configureer SMTP indien gewenst in de addon opties

## Authenticatie

- In productie: HA ingress token, geverifieerd via de Supervisor API. Ingress-headers
  worden alleen vertrouwd wanneer het verzoek van de ingress-proxy komt (172.30.32.2).
- Standalone toegang (LAN): loginpagina op `#/login` — HA-gebruikersnaam/wachtwoord
  wordt geverifieerd via de Supervisor auth-API (`POST http://supervisor/auth`,
  vereist `auth_api: true`). De backend geeft een eigen sessietoken uit
  (`backend/session.py`, vorm `hts.<geheim>.<HMAC>`, HMAC-geheim in
  `/config/hotel_tickets/session_secret`). De sessie zelf staat server-side in de
  tabel `sessions`, waarin alleen een SHA-256-hash van het token wordt bewaard
  (een datalek levert dus geen bruikbare tokens op). Sessies zijn **intrekbaar**
  (uitloggen op afstand, per apparaat) en **meeschuivend**: `expires_at` schuift
  bij gebruik vooruit (throttled op 5 min), zodat een actieve gebruiker ingelogd
  blijft en een vergeten/gestolen token na het inactiviteitsvenster (`SESSION_HOURS`)
  vanzelf verloopt. Verlopen sessies worden dagelijks opgeruimd (scheduler). Elke
  medewerker beheert de eigen apparaten via `#/apparaten`
  (`GET /api/auth/sessions`, `DELETE /api/auth/sessions/{id}`, `POST /api/auth/logout`);
  admins zien alle sessies bij Instellingen → Beveiliging (`GET /api/auth/sessions/all`).
  Het roteren van het HMAC-geheim maakt in één klap alle sessies ongeldig.
  Koppeling gebeurt via `user_roles.ha_username` (auto-gevuld bij ingress-login).
- Lokale app-accounts: een admin kan bij Instellingen → Medewerkers een account
  aanmaken met inlognaam + wachtwoord (of een wachtwoord instellen op een bestaand
  profiel). Het wachtwoord staat als PBKDF2-hash in `user_roles.password_hash`
  (`backend/passwords.py`) en wordt volledig binnen de addon geverifieerd — de
  medewerker heeft dan géén Home Assistant-account nodig. Bij het inloggen op de
  loginpagina gaat lokale verificatie vóór de Supervisor auth-API.
- Brute-force-bescherming loginpagina: naast de rate-limiter (5 pogingen/minuut
  per IP, in-memory) wordt een IP na 25 echt mislukte pogingen permanent
  geblokkeerd (tabel `login_bans`, overleeft herstarts). Admins krijgen daarvan
  een pushmelding en kunnen blokkades opheffen bij Instellingen → Beveiliging
  (`GET/DELETE /api/auth/bans`). Verzoeken vanaf de ingress-proxy worden nooit
  geblokkeerd.
  Poort 8080 (HTTP) of 8443 (HTTPS) moet hiervoor opengezet worden in de
  addon-netwerkconfiguratie; optioneel beperkt `allowed_networks` (CIDR's) de
  toegang tot het bedrijfsnetwerk.
- HTTPS: met `ssl: true` + `certfile`/`keyfile` (uit HA's `/ssl`-map) start run.sh
  een nginx die TLS termineert op poort 8443 en proxiet naar uvicorn op
  127.0.0.1:8080. uvicorn draait dan met `--proxy-headers` zodat rate-limiting
  en de allowlist het echte client-IP zien; nginx stript de X-Remote-User-*
  headers zodat die nooit van buitenaf binnen kunnen komen.
- In dev mode: elke request met `Authorization: Bearer dev-token` wordt geaccepteerd;
  op de loginpagina is wachtwoord `dev` geldig voor elke bestaande gebruikersnaam
- Gebruikersrollen worden opgeslagen in de `user_roles` tabel (niet in HA zelf)
- Eerste keer inloggen: medewerker krijgt automatisch rol `technician`

## Rollen & rechten

| Rol | Ziet | Wijzigt | Admin functies |
|---|---|---|---|
| `admin` | Alles | Alles | Ja |
| `supervisor` | Alles | Alles | Nee |
| `technician` | Technisch + eigen | Eigen tickets | Nee |
| `housekeeping` | Huishouding + eigen | Eigen tickets | Nee |
| `reception` | Receptie + eigen | Eigen tickets | Nee |

## Ticket statussen

`open` → `in_progress` → `closed`

## Datamodellen (SQLite tabellen)

- **tickets** — hoofdtabel, foreign key naar recurring_templates
- **ticket_comments** — commentaar per ticket
- **recurring_templates** — cron-gebaseerde taaksjablonen
- **user_roles** — medewerker profiel + HA user_id koppeling
- **sessions** — server-side loginsessies (intrekbaar + meeschuivend); alleen een SHA-256-hash van het token
- **login_bans** — mislukte inlogpogingen / IP-blokkades loginpagina

## HA integratie

- **Service:** `hotel_tickets.create_ticket` — aanroepbaar vanuit automaties
- **Sensoren:** `sensor.hotel_tickets_open`, `sensor.hotel_tickets_technical_open`, etc.
- **Notificaties:** via `notify.<device>` service en `persistent_notification.create`
- **Locaties:** HA areas worden gebruikt als locatiekoppeling voor tickets

## Omgevingsvariabelen (run.sh / dev)

| Variabele | Omschrijving |
|---|---|
| `DEV_MODE` | `true` = sla HA auth over |
| `DB_PATH` | Pad naar SQLite bestand |
| `SUPERVISOR_TOKEN` | Automatisch beschikbaar in HA addon |
| `SMTP_*` | E-mail configuratie |
| `LOG_LEVEL` | `debug` / `info` / `warning` / `error` |
| `ALLOWED_NETWORKS` | Komma-gescheiden CIDR's; indien gezet worden andere client-IP's geweigerd (interne HA-bronnen altijd toegestaan) |
| `SESSION_HOURS` | Inactiviteitsvenster van standalone loginsessies in uren; de sessie schuift mee bij gebruik en verloopt vanzelf bij inactiviteit (standaard 720 = 30 dagen) |
| `LOGIN_BAN_THRESHOLD` | Aantal mislukte inlogpogingen waarna een IP permanent geblokkeerd wordt (standaard 25) |
| `INGRESS_PROXY_IPS` | IP('s) waarvandaan ingress-headers vertrouwd worden (standaard 172.30.32.2) |
| `UPLOAD_DIR` | Map met ticketfoto's en kennisbank-afbeeldingen (addon: `/config/hotel_tickets/uploads`) |
| `BETA_MODE` | `true` = testomgeving: geen pushmeldingen, geen e-mail, geen HA-sensoren, banner in de app |
| `SOURCE_DB_PATH` / `SOURCE_UPLOAD_DIR` | Productiedata die de beta kan kopiëren (read-only) |
| `BETA_BASE_URL` | Ingress-pad van de beta; wordt na een kopie in `ticket_base_url` gezet |
