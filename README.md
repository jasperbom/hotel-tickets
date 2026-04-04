# Hotel Ticket System

Ticket- en taakbeheersysteem voor hotels, geïnstalleerd als **Home Assistant addon**.  
Bedoeld voor de technische dienst, huishouding en receptie.

![screenshot-placeholder](https://placehold.co/900x400/1e3a5f/ffffff?text=Hotel+Ticket+System)

## Functies

- **Tickets aanmaken en beheren** — per afdeling, prioriteit en locatie (HA areas)
- **Gepersonaliseerd overzicht** per medewerker — eigen tickets, beschikbare taken, urgentiemeldingen
- **Toewijzing** — supervisor wijst toe of medewerker pakt zelf een taak op
- **Terugkerende taken** — geavanceerde cron-schema's met visuele builder
- **Home Assistant integratie**
  - `hotel_tickets.create_ticket` service (aanroepbaar vanuit automaties)
  - Sensor entiteiten per afdeling (`sensor.hotel_tickets_open`, etc.)
  - Notificaties via HA mobiele app, persistent notifications en e-mail
- **Rapportage** — grafieken, filters, export naar CSV en Excel

---

## Vereisten

- Home Assistant OS of Home Assistant Supervised
- Home Assistant versie **2023.6** of nieuwer
- Voldoende schijfruimte voor de Docker container (~250 MB)

---

## Installatie

### Stap 1 — Addon toevoegen

1. Ga in Home Assistant naar **Instellingen → Add-ons → Add-on Store**
2. Klik op de drie puntjes (⋮) rechtsboven en kies **Repositories**
3. Voeg de volgende URL toe:
   ```
   https://github.com/jasperbom/hotel-tickets
   ```
4. Ververs de pagina — de addon **Hotel Ticket System** verschijnt nu in de store
5. Klik op de addon → **Installeren**

> **Let op:** De eerste installatie duurt enkele minuten omdat de Docker image gebouwd wordt.

---

### Stap 2 — Custom component installeren

De custom component zorgt voor de `hotel_tickets.create_ticket` service en de sensor entiteiten.

> **Let op:** Deze repository is een addon repository. HACS beheert geen addons — gebruik onderstaande handmatige installatie.

1. Ga in HA naar **Terminal & SSH addon** (of gebruik Samba/File editor)
2. Maak de map aan als die nog niet bestaat:
   ```bash
   mkdir -p /config/custom_components/hotel_tickets
   ```
3. Download de bestanden rechtstreeks:
   ```bash
   cd /config/custom_components/hotel_tickets
   wget https://raw.githubusercontent.com/jasperbom/hotel-tickets/main/custom_component/hotel_tickets/__init__.py
   wget https://raw.githubusercontent.com/jasperbom/hotel-tickets/main/custom_component/hotel_tickets/manifest.json
   wget https://raw.githubusercontent.com/jasperbom/hotel-tickets/main/custom_component/hotel_tickets/services.yaml
   ```
4. Herstart Home Assistant

De mapstructuur moet er zo uitzien:
```
config/
└── custom_components/
    └── hotel_tickets/
        ├── __init__.py
        ├── manifest.json
        └── services.yaml
```

---

### Stap 3 — Addon configureren

Ga naar de addon pagina → tabblad **Configuratie** en stel de opties in:

| Optie | Beschrijving | Verplicht |
|---|---|---|
| `smtp_enabled` | E-mailnotificaties inschakelen | Nee |
| `smtp_host` | SMTP server adres (bijv. `smtp.gmail.com`) | Alleen als smtp_enabled |
| `smtp_port` | SMTP poort (standaard `587`) | Alleen als smtp_enabled |
| `smtp_user` | SMTP gebruikersnaam / e-mailadres | Alleen als smtp_enabled |
| `smtp_password` | SMTP wachtwoord of app-wachtwoord | Alleen als smtp_enabled |
| `smtp_from` | Afzenderadres (bijv. `tickets@jouwhotel.nl`) | Alleen als smtp_enabled |
| `log_level` | Logniveau: `info` / `debug` / `warning` / `error` | Nee |

**Voorbeeld configuratie (YAML):**
```yaml
smtp_enabled: true
smtp_host: smtp.gmail.com
smtp_port: 587
smtp_user: tickets@jouwhotel.nl
smtp_password: jouw-app-wachtwoord
smtp_from: tickets@jouwhotel.nl
log_level: info
```

---

### Stap 4 — Addon starten

1. Ga naar het tabblad **Info** van de addon
2. Schakel eventueel **Starten bij opstarten** in
3. Klik op **Starten**
4. Ga naar het tabblad **Logboek** om te controleren of de addon correct opgestart is

Na het starten verschijnt **Tickets** automatisch in de Home Assistant zijbalk.

---

### Stap 5 — Medewerkers instellen

1. Open de Tickets app via de HA zijbalk
2. Ga naar **Instellingen**
3. Voeg medewerkers toe met hun HA `user_id` en wijs een rol toe:

| Rol | Beschrijving |
|---|---|
| `admin` | Volledige toegang, gebruikersbeheer |
| `supervisor` | Alle tickets zien en toewijzen |
| `technician` | Technische tickets |
| `housekeeping` | Huishoudingstickets |
| `reception` | Receptietickets |

**HA user_id vinden:**  
Ga naar **Instellingen → Personen → [medewerker]** en kopieer de user ID onderaan de pagina. Of gebruik Developer Tools → Template:
```
{{ user_id }}
```

---

## Gebruik in automaties

Na installatie van de custom component kun je tickets aanmaken vanuit HA automaties:

```yaml
# Voorbeeld: ticket aanmaken bij sensor alarm
automation:
  alias: "Airco storing melding"
  trigger:
    - platform: state
      entity_id: sensor.airco_kamer_301
      to: "error"
  action:
    - service: hotel_tickets.create_ticket
      data:
        title: "Airco storing kamer 301"
        category: technical
        priority: high
        description: "Sensor heeft een storing gedetecteerd"
        location: "{{ area_id('Kamer 301') }}"
```

**Beschikbare velden:**

| Veld | Type | Verplicht | Opties |
|---|---|---|---|
| `title` | tekst | Ja | — |
| `category` | keuze | Ja | `technical` / `housekeeping` / `reception` |
| `priority` | keuze | Nee | `low` / `medium` / `high` / `urgent` |
| `description` | tekst | Nee | — |
| `location` | area_id | Nee | HA area ID |
| `assigned_to` | user_id | Nee | HA user ID |

---

## Sensor entiteiten

Na installatie van de custom component zijn deze sensoren beschikbaar:

| Entiteit | Beschrijving |
|---|---|
| `sensor.hotel_tickets_open` | Totaal aantal open tickets |
| `sensor.hotel_tickets_technical_open` | Open technische tickets |
| `sensor.hotel_tickets_housekeeping_open` | Open huishoudingstickets |
| `sensor.hotel_tickets_reception_open` | Open receptietickets |

Gebruik deze in dashboards of automaties:
```yaml
# Voorbeeld: notificatie als er urgente tickets zijn
condition:
  - condition: numeric_state
    entity_id: sensor.hotel_tickets_open
    above: 5
```

---

## Lokaal ontwikkelen

```bash
# Vereisten: Python 3.11–3.13, Node.js 18+

git clone https://github.com/jasperbom/hotel-tickets.git
cd hotel-tickets/hotel_tickets

# Python venv aanmaken (gebruik Python 3.13 via Homebrew op Mac)
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# Backend starten op poort 8099 (zonder HA auth)
DEV_MODE=true DB_PATH=./test.db .venv/bin/python3.13 -m uvicorn backend.main:app --reload --port 8099

# Frontend (apart terminal)
cd frontend
npm install
npm run dev -- --port 5174
# → open http://localhost:5174
```

In `DEV_MODE` wordt elke request met `Authorization: Bearer dev-token` geaccepteerd zonder echte HA authenticatie.

---

## Architectuur

```
hotel-tickets/
├── hotel_tickets/                # Home Assistant addon
│   ├── config.yaml               # Addon manifest
│   ├── Dockerfile                # Multi-stage build
│   ├── run.sh                    # Startup script
│   ├── backend/                  # Python FastAPI backend
│   │   ├── main.py
│   │   ├── models.py             # SQLAlchemy modellen
│   │   ├── scheduler.py          # APScheduler (recurring tasks)
│   │   ├── routers/              # API endpoints
│   │   └── services/             # HA client, notificaties, sensoren
│   └── frontend/                 # React + TypeScript + Tailwind
│       └── src/
│           ├── pages/
│           └── components/
└── custom_component/
    └── hotel_tickets/            # HA custom component
        ├── __init__.py
        └── services.yaml
```

**Tech stack:** Python 3.13 · FastAPI · SQLite · APScheduler · React 18 · TypeScript · Vite · Tailwind CSS · Recharts

---

## Licentie

MIT
