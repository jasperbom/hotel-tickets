"""
Client voor de Home Assistant Supervisor REST API.
Gebruikt de SUPERVISOR_TOKEN om namens de addon te communiceren met HA.
"""
import os
import aiohttp
from typing import Any

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_API = "http://supervisor/core/api"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
        "Content-Type": "application/json",
    }


async def get_areas() -> list[dict]:
    """Haal alle HA areas op (kamers, verdiepingen, zones)."""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/template",
            headers=_headers(),
            json={"template": "{{ areas() | tojson }}"},
        ) as resp:
            if resp.status != 200:
                return []
            raw = await resp.text()
            import json
            area_ids = json.loads(raw)

        areas = []
        for area_id in area_ids:
            async with session.post(
                f"{HA_API}/template",
                headers=_headers(),
                json={"template": f"{{{{ area_name('{area_id}') }}}}"},
            ) as r:
                name = (await r.text()).strip()
            areas.append({"id": area_id, "name": name})
        return areas


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


async def call_service(domain: str, service: str, data: dict[str, Any] | None = None) -> bool:
    """Roep een HA service aan."""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/services/{domain}/{service}",
            headers=_headers(),
            json=data or {},
        ) as resp:
            return resp.status in (200, 201)


async def update_sensor_state(entity_id: str, state: str | int, attributes: dict | None = None) -> bool:
    """Zet de staat van een sensor via de HA states API."""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{HA_API}/states/{entity_id}",
            headers=_headers(),
            json={"state": str(state), "attributes": attributes or {}},
        ) as resp:
            return resp.status in (200, 201)
