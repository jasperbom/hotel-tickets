"""
Home Assistant custom component voor het Hotel Ticket System.

Registreert:
- hotel_tickets.create_ticket service (voor automaties en de Lovelace card)
- Statisch pad voor de hotel-ticket-card.js Lovelace card
"""
import logging
import os
import aiohttp
from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry

DOMAIN = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

ADDON_SLUG = "hotel_tickets"
CARD_URL = "/hotel_tickets/hotel-ticket-card.js"
CARD_FILE = Path(__file__).parent / "hotel-ticket-card.js"

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_API = "http://supervisor/core/api"


def _addon_headers() -> dict:
    return {"Authorization": f"Bearer {SUPERVISOR_TOKEN}"}


async def _call_addon(hass: HomeAssistant, method: str, path: str, json: dict | None = None) -> dict | None:
    url = f"http://supervisor/addons/{ADDON_SLUG}/api{path}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(method, url, headers=_addon_headers(), json=json) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                _LOGGER.warning(f"Addon API {resp.status} op {path}")
    except Exception as e:
        _LOGGER.error(f"Addon API fout: {e}")
    return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})

    # Serveer de Lovelace card JS als statisch bestand
    if CARD_FILE.exists():
        hass.http.register_static_path(CARD_URL, str(CARD_FILE), cache_headers=False)
        _LOGGER.info(f"Hotel Ticket card beschikbaar op {CARD_URL}")
    else:
        _LOGGER.warning(f"hotel-ticket-card.js niet gevonden op {CARD_FILE}")

    # Registreer de create_ticket service
    async def handle_create_ticket(call: ServiceCall) -> None:
        data = {
            "title":       call.data.get("title"),
            "category":    call.data.get("category"),
            "description": call.data.get("description"),
            "priority":    call.data.get("priority", "medium"),
            "location_id": call.data.get("location"),
            "assigned_to": call.data.get("assigned_to"),
        }
        data = {k: v for k, v in data.items() if v is not None}

        result = await _call_addon(hass, "POST", "/tickets/", json=data)
        if result:
            _LOGGER.info(f"Ticket aangemaakt: {data['title']} (id={result.get('id')})")
        else:
            _LOGGER.error(f"Ticket aanmaken mislukt: {data}")

    hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)
    _LOGGER.info("hotel_tickets.create_ticket service geregistreerd")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN][entry.entry_id] = {}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.services.async_remove(DOMAIN, "create_ticket")
    hass.data[DOMAIN].pop(entry.entry_id)
    return True
