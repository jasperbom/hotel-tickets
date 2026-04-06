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

### Stap 2 — Custom component via HACS installeren (aanbevolen)

De custom component voegt de `hotel_tickets.create_ticket` service, sensor entiteiten en de Lovelace card toe.

#### Integratie (custom component)

1. Ga in HACS naar **Integraties → ⋮ → Aangepaste repositories**
2. Voeg toe:
   - **URL:** `https://github.com/jasperbom/hotel-tickets`
   - **Categorie:** Integratie
3. Zoek op **Hotel Ticket System** en klik op **Downloaden**
4. Herstart Home Assistant

#### Lovelace card

1. Ga in HACS naar **Frontend → ⋮ → Aangepaste repositories**
2. Voeg toe:
   - **URL:** `https://github.com/jasperbom/hotel-ticket-card`
   - **Categorie:** Lovelace
3. Zoek op **Hotel Ticket Card** en klik op **Downloaden**
4. De card is nu beschikbaar als `hotel-ticket-card`

> **Handmatige installatie (zonder HACS):**  
> Download `__init__.py`, `manifest.json` en `services.yaml` uit de map `custom_components/hotel_tickets/` en plaats ze in `/config/custom_components/hotel_tickets/`. Herstart HA.

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

## Lovelace card

Na installatie van de custom component is de **Hotel Ticket Card** beschikbaar.
De kaart toont een formulier waarmee medewerkers direct vanuit een HA dashboard een ticket kunnen aanmaken.

### Stap 1 — Card toevoegen als Lovelace resource

1. Ga naar **Instellingen → Dashboards → drie puntjes (⋮) → Resources**
2. Klik op **+ Resource toevoegen**
3. Vul in:
   - URL: `/hotel_tickets/hotel-ticket-card.js`
   - Resourcetype: **JavaScript module**
4. Klik op **Bijwerken** en herlaad de pagina

> De URL wordt automatisch beschikbaar gesteld zodra de custom component geladen is. Er is geen handmatige bestandskopie nodig.

### Stap 2 — Card toevoegen aan dashboard

Ga naar je dashboard → **Bewerken → + Kaart toevoegen → Handmatig** en plak:

```yaml
type: custom:hotel-ticket-card
title: Ticket aanmaken
default_category: technical
default_priority: medium
```

**Beschikbare opties:**

| Optie | Omschrijving | Standaard |
|---|---|---|
| `title` | Titel bovenaan de kaart | `"Ticket aanmaken"` |
| `default_category` | Voorgeselecteerde categorie (`technical` / `housekeeping` / `reception`) | `technical` |
| `default_priority` | Voorgeselecteerde prioriteit (`low` / `medium` / `high` / `urgent`) | `medium` |

De kaart laadt automatisch je HA zones/gebieden als locatiekeuzelijst.

---

## NFC-tags koppelen aan terugkerende taken

Met NFC-tags kun je terugkerende taken (zoals schoonmaken van een kamer of technische controles) automatisch afronden door de tag te scannen met de HA Companion app.

### Hoe het werkt

1. Medewerker scant een NFC-tag met de HA app
2. HA triggert een automatisering
3. De automatisering roept het `/api/nfc/scan` endpoint aan
4. De bijbehorende openstaande taak wordt afgesloten
5. De medewerker ontvangt een pushmelding ter bevestiging

---

### Stap 1 — NFC-tag koppelen in de app

1. Ga in de Tickets app naar **Herhalend**
2. Maak een nieuw sjabloon aan of bewerk een bestaand sjabloon
3. Vul bij **NFC-tag ID** de ID in van je HA NFC-tag

**NFC-tag ID vinden:**  
Ga in HA naar **Instellingen → Tags** en klik op de tag. De ID staat onderaan, bijv. `abc123-def456-ghi789`.

---

### Stap 2 — Push notificaties instellen per medewerker

Om een bevestigingsmelding te ontvangen na het scannen moet de `ha_notify_service` van de medewerker ingevuld zijn.

1. Ga in de Tickets app naar **Instellingen → Medewerkers**
2. Bewerk de medewerker en vul bij **HA notify service** de naam van de notify-service in

De notify-service naam vind je via **Developer Tools → Diensten** — zoek op `notify.`. Elke telefoon met de HA Companion app heeft een eigen service, bijv.:
- `notify.mobile_app_iphone_jan`
- `notify.mobile_app_pixel_7_marie`

---

### Stap 3 — HA automatisering aanmaken

Maak in HA een automatisering aan die bij het scannen van de NFC-tag het scan-endpoint aanroept.

**Via de UI (aanbevolen):**

1. Ga naar **Instellingen → Automatiseringen → + Automatisering aanmaken**
2. Trigger: **Tag** → selecteer de NFC-tag
3. Actie: **REST-commando aanroepen** → zie configuratie hieronder

**Via YAML:**

```yaml
automation:
  alias: "NFC scan - Kamer 301 schoonmaak"
  trigger:
    - platform: tag
      tag_id: "abc123-def456-ghi789"   # jouw NFC-tag ID
  action:
    - service: rest_command.hotel_tickets_nfc_scan
      data:
        tag_id: "abc123-def456-ghi789"
        ha_user_id: "{{ trigger.device_id }}"
```

---

### Stap 4 — REST command instellen in configuration.yaml

Voeg dit toe aan je `configuration.yaml`:

```yaml
rest_command:
  hotel_tickets_nfc_scan:
    url: "http://supervisor/ingress/hotel_tickets/api/nfc/scan"
    method: POST
    content_type: "application/json"
    payload: '{"tag_id": "{{ tag_id }}", "ha_user_id": "{{ ha_user_id }}"}'
    headers:
      Authorization: "Bearer {{ states('sensor.supervisor_token') }}"
```

> **Let op:** De URL `http://supervisor/ingress/hotel_tickets/` werkt alleen binnen HA (supervisor netwerk). Herstart HA na het aanpassen van `configuration.yaml`.

---

### Meerdere NFC-tags

Maak voor elke locatie/taak een aparte automatisering met de bijbehorende `tag_id`. Je kunt één `rest_command` hergebruiken voor alle tags:

```yaml
automation:
  - alias: "NFC - Kamer 101 schoonmaak"
    trigger:
      platform: tag
      tag_id: "tag-id-kamer-101"
    action:
      service: rest_command.hotel_tickets_nfc_scan
      data:
        tag_id: "tag-id-kamer-101"
        ha_user_id: "{{ trigger.device_id }}"

  - alias: "NFC - Kamer 102 schoonmaak"
    trigger:
      platform: tag
      tag_id: "tag-id-kamer-102"
    action:
      service: rest_command.hotel_tickets_nfc_scan
      data:
        tag_id: "tag-id-kamer-102"
        ha_user_id: "{{ trigger.device_id }}"
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
