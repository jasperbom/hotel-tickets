# Implementatieplan — Kennisbot voor personeel

> Status: **plan / onderzoek**. Nog niet gebouwd. Dit document beschrijft hoe een
> interne kennis-/troubleshooting-bot in de Hotel Ticket System-app gebouwd kan
> worden.

## 1. Doel

Een interne bot waar **personeel** een probleem of vraag kan intypen en een
antwoord krijgt **uitsluitend uit een door de beheerder beheerde kennisbank** —
de bot verzint nooit zelf antwoorden. Komt er geen antwoord, dan wordt de vraag
**in een wachtrij voor admins/supervisors** gezet, die er later een kennis-entry
van maken zodat de vraag voortaan wél beantwoord wordt.

De focus ligt op **problemen oplossen die personeel tegenkomt** (storingen,
"hoe doe ik X", foutcodes), als snelle voorkant op het bestaande ticketproces.

## 2. Kernprincipe: waarom de bot niets verzint

De garantie komt van de **architectuur**, niet van AI:

- De bot doorzoekt alleen de `knowledge_entries`-tabel.
- Vindt hij een match → toont die.
- Vindt hij niets → zegt "geen antwoord gevonden" en logt de vraag voor beheer.

Een AI is hierbij **optioneel** — puur om "slimmer te zoeken" (herformuleringen,
synoniemen). Hij krijgt nooit de opdracht om kennis te genereren.

## 3. Aanpak in fasen

| Fase | Inhoud | AI nodig? |
|---|---|---|
| **Fase 1** | Kennisbank + zoeken (SQLite FTS5) + wachtrij + admin-beheer + ticket-koppeling | Nee |
| **Fase 2** (optioneel, later) | Semantisch zoeken via embeddings achter een instelling | Ja |

Fase 1 is volledig zelfstandig bruikbaar, gratis en draait offline in de addon.
De zoeklaag wordt zo opgezet dat Fase 2 er later "achter geplugd" kan worden
zonder de rest te wijzigen.

## 4. Datamodel (nieuwe tabellen in `models.py`)

### 4.1 `knowledge_entries` — de kennisbank
| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | str (uuid) | PK |
| `title` | str | Het probleem / de vraag (kort) |
| `answer` | text | De oplossing / het antwoord |
| `keywords` | text, nullable | Extra trefwoorden / alternatieve formuleringen (verbetert zoeken zonder AI) |
| `category` | Category, nullable | Afdeling (technical, housekeeping, …) — sluit aan op bestaande enum |
| `source_ticket_id` | str, nullable (FK tickets.id) | Gevuld als de entry uit een gesloten ticket is "gepromoveerd" |
| `created_by` | str | HA user_id |
| `ask_count` | int, default 0 | Hoe vaak gematcht — voor prioritering/statistiek |
| `is_published` | bool, default True | Concept vs. zichtbaar |
| `created_at` / `updated_at` | datetime | |

### 4.2 `knowledge_questions` — de wachtrij + log
| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | str (uuid) | PK |
| `question_text` | text | Wat het personeel typte |
| `asked_by` | str | HA user_id |
| `category` | Category, nullable | Afdeling van de vrager |
| `status` | enum | `answered_by_bot` / `pending` / `resolved` / `dismissed` |
| `matched_entry_id` | str, nullable | Welke entry de bot teruggaf (bij `answered_by_bot`) |
| `resolved_entry_id` | str, nullable | Welke entry de admin er uiteindelijk van maakte |
| `created_at` | datetime | |
| `resolved_at` / `resolved_by` | datetime / str, nullable | |

Statusbetekenis:
- `answered_by_bot` — direct beantwoord (alleen loggen voor statistiek).
- `pending` — geen antwoord → staat in de admin-wachtrij.
- `resolved` — admin heeft er kennis van gemaakt.
- `dismissed` — admin vond het irrelevant.

### 4.3 `knowledge_fts` — zoekindex (geen ORM, raw SQL in migratie)
SQLite **FTS5** virtuele tabel over `title`, `answer`, `keywords`, met triggers
die hem synchroon houden bij insert/update/delete. Opgezet in `_run_migrations`
(zelfde plek als de bestaande raw-SQL migraties/seeds).

> Migratie-aanpak past in bestaand patroon: nieuwe ORM-tabellen ontstaan vanzelf
> via `Base.metadata.create_all`; de FTS5-tabel + triggers worden met
> `exec_driver_sql` aangemaakt in `_run_migrations` (idempotent met
> `CREATE ... IF NOT EXISTS`).

## 5. Zoeklaag (uitbreidbaar voor AI)

Een kleine service `backend/services/knowledge_search.py` met één interface:

```
search(query: str, category: Category | None) -> list[ScoredEntry]
```

- **Fase 1 implementatie**: `FtsKnowledgeSearch` — FTS5-query (met fallback naar
  LIKE). Sorteert op relevantie; filtert optioneel op afdeling.
- **Fase 2 implementatie**: `SemanticKnowledgeSearch` — embeddings. Keuze tussen
  beide via `system_settings` key `knowledge_ai_enabled` (default `"false"`).

Zo verandert er voor de router/endpoints niets als je later AI aanzet.

## 6. Backend endpoints (`backend/routers/knowledge.py`, prefix `/api/knowledge`)

Registreren in `main.py` naast de andere routers.

### Voor alle ingelogde medewerkers
| Methode | Pad | Functie |
|---|---|---|
| `POST` | `/knowledge/ask` | Body `{question, category?}`. Zoekt, logt een `knowledge_question`, geeft matches terug. Geen match → status `pending`, `{answered: false}` (de UI toont dan de knop "Maak hier een ticket van"). Match → status `answered_by_bot`, `ask_count++`, geeft entries terug. |
| `GET` | `/knowledge` | Bladeren/zoeken in de kennisbank. Alle kennis is voor iedereen zichtbaar (afdeling is alleen een optioneel filter, geen afscherming). |
| `GET` | `/knowledge/{id}` | Detail van een entry. |

### Alleen admin (let op: niet supervisor)
> Keuze: de wachtrij en het beheer zijn **alleen voor admins**. Het bestaande
> `user.is_admin` omvat óók supervisors, dus hier is een striktere check nodig:
> `if user.role != Role.admin: raise HTTPException(403, ...)`.

| Methode | Pad | Functie |
|---|---|---|
| `GET` | `/knowledge/queue` | De wachtrij: `pending` vragen. |
| `POST` | `/knowledge/queue/{qid}/answer` | Maak van een wachtrij-vraag een entry `{title, answer, keywords, category}`; vraag → `resolved`. |
| `POST` | `/knowledge/queue/{qid}/dismiss` | Vraag → `dismissed`. |
| `POST` | `/knowledge` | Handmatig nieuwe entry. |
| `PATCH` | `/knowledge/{id}` | Entry bewerken. |
| `DELETE` | `/knowledge/{id}` | Entry verwijderen. |
| `POST` | `/knowledge/from-ticket/{ticket_id}` | Promoveer een **gesloten ticket** tot entry: prefill `title` = tickettitel, `answer` samengesteld uit beschrijving + comments; legt `source_ticket_id` vast. |
| `GET` | `/knowledge/stats` | Meest gestelde/gematchte vragen + aantal openstaande wachtrij-items. |

Rechten volgen exact het patroon van `routers/settings.py`
(`if not user.is_admin: raise HTTPException(403, ...)`).

## 7. Frontend (React, `frontend/src/pages/`)

### Nieuwe pagina's
1. **`KennisBot.tsx`** (personeel) — invoerveld "Waar loop je tegenaan?".
   Toont gevonden oplossing(en). Bij geen resultaat: melding "doorgestuurd naar
   beheer" + knop **"Maak hier een ticket van"** (laagdrempelig ticket-invoer).
2. **`Kennisbank.tsx`** (of tab binnen KennisBot) — bladeren door entries per
   afdeling.
3. **`KennisbankBeheer.tsx`** (admin/supervisor) — twee delen:
   - **Wachtrij**: `pending` vragen → "beantwoorden" (maakt entry) of "afwijzen".
   - **Beheer**: CRUD op entries.

### Integratie in bestaande UI
- **`TicketDetail.tsx`**: bij **gesloten** tickets en `is_admin` een knop
  **"Toevoegen aan kennisbank"** → roept `POST /knowledge/from-ticket/{id}` aan
  (prefill in een formulier).
- **Navigatie/menu**: nieuw item (bijv. `mdi:lightbulb-on-outline`). Voor admins
  een badge met het aantal openstaande wachtrij-vragen.
- **`api/client.ts`**: types + functies voor de nieuwe endpoints, in lijn met de
  bestaande client.

## 8. Instellingen / configuratie

- `system_settings` key `knowledge_ai_enabled` = `"false"` (default) — schakelaar
  voor Fase 2. Seed in `_run_migrations` zoals `bikes_module_roles`.
- (Fase 2) API-key voor een AI-provider: bij voorkeur via **addon-optie** in
  `config.yaml` (komt dan in HA-secrets terecht) i.p.v. plain in de database.
- Optioneel later: `system_settings` key om te bepalen welke rollen de
  wachtrij/beheer zien (analoog aan `bikes_module_roles`).

## 9. Rechten-overzicht

| Actie | Wie |
|---|---|
| Vraag stellen / kennisbank bladeren | Alle ingelogde medewerkers |
| Wachtrij bekijken & beantwoorden | **Alleen admin** (`role == admin`) |
| Entries CRUD / ticket promoveren | **Alleen admin** |

> N.B. Bewust strikter dan `is_admin` (dat ook supervisors omvat): kennisbeheer
> is voorbehouden aan admins.

## 10. De ticket ↔ kennis-kringloop (kernmeerwaarde)

```
Probleem → bot raadplegen
   ├─ bekend  → directe oplossing (geen ticket nodig)
   └─ onbekend → in wachtrij  ──► admin lost op / maakt ticket
                                      │
                          ticket gaat dicht
                                      │
                     "Toevoegen aan kennisbank"  ──► nieuwe entry
                                      │
                         volgende keer wél direct beantwoord
```

De kennisbank vult zich zo met **echte, hotel-specifieke oplossingen** uit
opgeloste tickets — nooit met verzonnen tekst.

## 11. Versiebeheer & oplevering

- Conform `CLAUDE.md`: elke push verhoogt de versie in `config.yaml` met `0.0.1`
  en de commit message komt overeen (bijv. `v1.4.64: ...`).
- Voorgestelde commit-opdeling bij bouwen:
  1. Datamodel + migratie (tabellen, FTS5, seed)
  2. Zoeklaag + endpoints
  3. Frontend personeel (KennisBot + bladeren)
  4. Frontend admin (wachtrij + beheer) + ticket-promotie

## 12. Inschatting omvang (Fase 1)

- Backend: 2 ORM-modellen + 1 enum, FTS5-migratie, 1 service, 1 router
  (~9 endpoints). Geen nieuwe Python-dependencies.
- Frontend: 3 pagina's + client-uitbreiding + 1 knop op TicketDetail + menu-item.
- Goed te overzien en volledig in lijn met bestaande modules (fietsen, zwembad).

## 13. Gemaakte keuzes

1. **Onbeantwoorde vraag** → komt in de wachtrij; de medewerker krijgt een knop
   "Maak hier een ticket van" (geen automatisch ticket).
2. **Wachtrij & beheer** → alleen admins (`role == admin`), niet supervisors.
3. **Kennisbank** → alle kennis zichtbaar voor iedereen; afdeling alleen als
   optioneel filter, niet als afscherming.

### Nog open voor later (Fase 2)
- AI-keuze: cloud-API (bijv. Claude) of een lokaal model op de HA-hardware.
