"""
Client voor de Home Assistant Supervisor REST API.
Gebruikt de SUPERVISOR_TOKEN om namens de addon te communiceren met HA.

In beta-modus zijn alle *schrijvende* aanroepen (services aanroepen, sensor-
standen zetten) uitgeschakeld: de testomgeving mag geen pushmeldingen naar
het personeel sturen en niet de sensoren van de productie-addon overschrijven.
Lezen (areas, states) blijft gewoon werken.
"""
import logging
import os
import aiohttp
from typing import Any

from ..beta import BETA_MODE

logger = logging.getLogger(__name__)

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_API = "http://supervisor/core/api"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
        "Content-Type": "application/json",
    }


async def get_areas() -> list[dict]:
    """Haal alle HA areas op via de template API."""
    import json as _json
    # Één template-call die een lijst van {id, name} objecten teruggeeft.
    # areas() geeft area IDs als strings; area_name() geeft de weergavenaam.
    template = (
        "{%- set ns = namespace(r=[]) -%}"
        "{%- for a in areas() -%}"
        "{%- set ns.r = ns.r + [{'id': a, 'name': area_name(a)}] -%}"
        "{%- endfor -%}"
        "{{ ns.r | tojson }}"
    )
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/template",
            headers=_headers(),
            json={"template": template},
        ) as resp:
            if resp.status == 200:
                try:
                    return _json.loads(await resp.text())
                except Exception:
                    pass
    return []


async def get_users() -> list[dict]:
    """Haal alle HA gebruikers op via de auth API."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            "http://supervisor/core/api/states",
            headers=_headers(),
        ) as resp:
            # Gebruikers zijn niet direct beschikbaar via REST; gebruik persons
            pass

        # Gebruik persons als proxy voor gebruikers
        async with session.get(
            f"{HA_API}/states",
            headers=_headers(),
        ) as resp:
            if resp.status != 200:
                return []
            states = await resp.json()

    persons = [
        {"id": s["attributes"].get("user_id", s["entity_id"]),
         "name": s["attributes"].get("friendly_name", s["entity_id"])}
        for s in states
        if s["entity_id"].startswith("person.")
    ]
    return persons


async def get_keycard_states() -> dict[str, bool]:
    """
    Bezetting van alle kamers in één keer: {area_id: bezet}.

    Per kamer heet de sensor `binary_sensor.<area_id>_keycard` (zie
    routers/locations.py): 'on' = sleutel in de houder, dus bezet.

    Voor één kamer bestaat get_sensor_state al, maar het wandscherm vraagt naar
    dertig kamers tegelijk en doet dat elke halve minuut opnieuw. Dat zijn
    dertig verzoeken aan Home Assistant voor een bord dat er één hoort te doen.
    Deze template-call geeft alleen de keycard-sensoren terug — één verzoek,
    een handvol regels antwoord, ongeacht hoe groot het hotel is.

    Kamers zonder sensor of met een sensor die niets weet ('unavailable')
    ontbreken in het antwoord: "geen sensor" is iets anders dan "vrij", en dat
    verschil hoort niet onderweg verloren te gaan.
    """
    import json as _json
    # [14:-8] knipt 'binary_sensor.' en '_keycard' eraf; endswith/replace zijn
    # in HA-templates net wat wisselvalliger dan gewoon snijden.
    template = (
        "{%- set ns = namespace(r=[]) -%}"
        "{%- for s in states.binary_sensor -%}"
        "{%- if s.entity_id[-8:] == '_keycard' -%}"
        "{%- set ns.r = ns.r + [{'id': s.entity_id[14:-8], 'state': s.state}] -%}"
        "{%- endif -%}"
        "{%- endfor -%}"
        "{{ ns.r | tojson }}"
    )
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/template",
            headers=_headers(),
            json={"template": template},
        ) as resp:
            if resp.status != 200:
                return {}
            try:
                rijen = _json.loads(await resp.text())
            except Exception:
                return {}
    return {
        r["id"]: r["state"] == "on"
        for r in rijen
        if r.get("id") and r.get("state") in ("on", "off")
    }


async def get_sensor_state(entity_id: str) -> dict | None:
    """Haal de staat van een HA entiteit op. Geeft None als de entiteit niet bestaat."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{HA_API}/states/{entity_id}",
            headers=_headers(),
        ) as resp:
            if resp.status == 200:
                return await resp.json()
    return None


async def call_service(domain: str, service: str, data: dict[str, Any] | None = None) -> bool:
    """Roep een HA service aan."""
    if BETA_MODE:
        logger.info("Beta: service-aanroep %s.%s onderdrukt", domain, service)
        return True
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/services/{domain}/{service}",
            headers=_headers(),
            json=data or {},
        ) as resp:
            return resp.status in (200, 201)


async def update_sensor_state(entity_id: str, state: str | int, attributes: dict | None = None) -> bool:
    """Zet de staat van een sensor via de HA states API."""
    if BETA_MODE:
        logger.debug("Beta: sensorupdate %s onderdrukt", entity_id)
        return True
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/states/{entity_id}",
            headers=_headers(),
            json={"state": str(state), "attributes": attributes or {}},
        ) as resp:
            return resp.status in (200, 201)
