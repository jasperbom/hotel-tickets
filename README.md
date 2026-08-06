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

Met NFC-tags kun je terugkerende taken automatisch afronden door de tag te scannen met de HA Companion app. **Er zijn geen automaties of YAML-aanpassingen nodig** — de integratie regelt dit automatisch.

### Hoe het werkt

1. Medewerker scant een NFC-tag met de HA Companion app
2. HA vuurt een `tag.tag_scanned` event
3. De **Hotel Ticket System integratie** vangt dit event op (automatisch)
4. De bijbehorende openstaande taak wordt afgesloten
5. De medewerker ontvangt een pushmelding ter bevestiging

---

### Stap 1 — NFC-tag koppelen in de app

1. Ga in de Tickets app naar **Herhalend**
2. Maak een nieuw sjabloon aan of bewerk een bestaand sjabloon
3. Vul bij **NFC-tag ID** de ID in van je HA NFC-tag

**NFC-tag ID vinden:**  
Ga in HA naar **Instellingen → Tags** en klik op de tag. De ID staat onderaan, bijv. `abc123-def456-ghi789`.

> Dat is alles. Zodra de integratie geïnstalleerd is, worden alle tag scans automatisch verwerkt.

---

### Stap 2 — Push notificaties instellen per medewerker

Om een bevestigingsmelding te ontvangen na het scannen moet de **HA notify service** van de medewerker ingevuld zijn.

1. Ga in de Tickets app naar **Instellingen → Medewerkers**
2. Bewerk de medewerker en vul bij **HA notify service** de naam in

De notify-service naam vind je via **Developer Tools → Diensten** — zoek op `notify.`. Elke telefoon met de HA Companion app heeft een eigen service, bijv.:
- `notify.mobile_app_iphone_jan`
- `notify.mobile_app_pixel_7_marie`

De integratie koppelt automatisch de medewerker aan de telefoon die de tag heeft gescand (via de HA mobile_app device koppeling).

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

## Beta-omgeving (testen met echte data)

Naast de gewone addon staat er een tweede addon in deze repository:
**Hotel Ticket System (Beta)** (`hotel_tickets_beta`). Dat is exact dezelfde
app, maar met een eigen database — bedoeld om een grote update eerst op een
kopie van de echte data uit te proberen.

### Installeren

1. Supervisor → Add-on Store → dezelfde repository → **Hotel Ticket System (Beta)**
2. Installeren en starten. De beta verschijnt als apart paneel (**Tickets β**).
3. Ga in de beta naar **Instellingen → Beta → Productiedata kopiëren**.

Bij het kopiëren wordt alles overgenomen: tickets, commentaren, herhaaltaken,
medewerkers (inclusief wachtwoorden), kennisbank, fietsen, zwembadlogboek en
alle foto's. De productie-addon wordt daarbij **alleen gelezen** — die
verandert niet. De vorige beta-database blijft als `.vorige` naast de nieuwe
staan.

### Wat er in de beta bewust uit staat

| | |
|---|---|
| Pushmeldingen en e-mail | uit — testen belt het personeel niet wakker |
| `sensor.hotel_tickets_*` in HA | blijven van productie |
| Installeren van de HA-integratie | geblokkeerd (die staat in de gedeelde `/config`) |
| Herhaaltaken | lopen wél; er komen dus vanzelf testtickets bij |

Overal in de app staat een gele balk met **BETA**, ook op de loginpagina, zodat
niemand per ongeluk in de testomgeving werkt.

### Scheiding van data

| | Productie | Beta |
|---|---|---|
| Database | `/config/hotel_tickets/hotel_tickets.db` | `/config/hotel_tickets_beta/hotel_tickets.db` |
| Foto's | `/config/hotel_tickets/uploads/` | `/config/hotel_tickets_beta/uploads/` |
| LAN-poorten | 8080 / 8443 | 8081 / 8444 |
| Ingress | `/hassio/ingress/hotel_tickets` | `/hassio/ingress/hotel_tickets_beta` |

### Update-volgorde

Beide addons volgen dezelfde repository, maar Home Assistant installeert een
update pas als je erop klikt. De werkwijze is dus: nieuwe versie pushen →
**alleen de beta bijwerken** → testen op de gekopieerde data → daarna pas
productie bijwerken.

> `hotel_tickets_beta/` is gegenereerde code (`scripts/sync-beta.sh`). Pas
> functionaliteit aan in `hotel_tickets/` en beta-specifieke instellingen in
> `scripts/beta-overlay/`; een GitHub Action synchroniseert de rest.

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

Lokaal de beta-modus nabootsen (banner, geen meldingen, kopieerknop):

```bash
DEV_MODE=true BETA_MODE=true \
  DB_PATH=./beta.db UPLOAD_DIR=./beta-uploads \
  SOURCE_DB_PATH=./test.db SOURCE_UPLOAD_DIR=./data/uploads \
  .venv/bin/python3.13 -m uvicorn backend.main:app --reload --port 8099
```

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
