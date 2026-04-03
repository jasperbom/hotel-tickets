# Hotel Ticket System

Ticket- en taakbeheersysteem voor hotels, gebouwd als Home Assistant addon.
Bedoeld voor drie afdelingen: technische dienst, huishouding en receptie/conciërge.

## Architectuur

```
hotel-tickets/
├── addon/
│   ├── config.yaml              # HA addon manifest
│   ├── Dockerfile               # Multi-stage: Python backend + Node frontend
│   ├── run.sh                   # Startup (bashio, env vars)
│   ├── backend/                 # FastAPI + SQLite
│   │   ├── main.py              # App entry point, lifespan
│   │   ├── database.py          # SQLAlchemy async setup
│   │   ├── models.py            # Ticket, TicketComment, RecurringTemplate, UserRole
│   │   ├── auth.py              # HA token verificatie, CurrentUser
│   │   ├── scheduler.py         # APScheduler voor recurring tasks (cron)
│   │   ├── routers/             # FastAPI routers
│   │   │   ├── tickets.py       # CRUD + claim + commentaar
│   │   │   ├── users.py         # Rollen & medewerkers
│   │   │   ├── locations.py     # HA areas sync
│   │   │   ├── recurring.py     # Template beheer
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

cd addon

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

1. Kopieer de `addon/` map naar je HA addons directory (bijv. `/addons/hotel_tickets/`)
2. Kopieer `custom_component/hotel_tickets/` naar `/config/custom_components/hotel_tickets/`
3. Herstart HA → installeer de addon via Supervisor → Add-on Store (lokaal)
4. Configureer SMTP indien gewenst in de addon opties

## Authenticatie

- In productie: HA ingress token, geverifieerd via de Supervisor API
- In dev mode: elke request met `Authorization: Bearer dev-token` wordt geaccepteerd
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
