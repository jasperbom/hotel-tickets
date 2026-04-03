"""
Home Assistant custom component voor het Hotel Ticket System.

Registreert:
- hotel_tickets.create_ticket service (voor gebruik in automaties)
- Sensor entiteiten voor ticket tellingen
"""
import logging
import aiohttp

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from homeassistant.const import STATE_UNAVAILABLE

DOMAIN = "hotel_tickets"
ADDON_SLUG = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

# URL van de addon via HA ingress
ADDON_API_BASE = "http://supervisor/addons/local_hotel_tickets/api"


def _addon_headers() -> dict:
    """Gebruik de supervisor token voor communicatie met de addon."""
    import os
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    return {"Authorization": f"Bearer {token}"}


async def _call_addon(hass: HomeAssistant, method: str, path: str, json: dict | None = None) -> dict | None:
    """Stuur een request naar de addon API."""
    # Haal de addon interne URL op via de ingress
    url = f"http://supervisor/addons/{ADDON_SLUG}/api{path}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(method, url, headers=_addon_headers(), json=json) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                else:
                    _LOGGER.warning(f"Addon API antwoordde {resp.status} op {path}")
                    return None
    except Exception as e:
        _LOGGER.error(f"Addon API fout: {e}")
        return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Zet het component op."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Zet een config entry op."""
    hass.data[DOMAIN][entry.entry_id] = {}

    # Registreer de create_ticket service
    async def handle_create_ticket(call: ServiceCall) -> None:
        data = {
            "title": call.data.get("title"),
            "category": call.data.get("category"),
            "description": call.data.get("description"),
            "priority": call.data.get("priority", "medium"),
            "location_id": call.data.get("location"),
            "assigned_to": call.data.get("assigned_to"),
        }
        # Verwijder None-waarden
        data = {k: v for k, v in data.items() if v is not None}

        result = await _call_addon(hass, "POST", "/tickets/", json=data)
        if result:
            _LOGGER.info(f"Ticket aangemaakt via service: {data['title']} (id={result.get('id')})")
        else:
            _LOGGER.error(f"Ticket aanmaken mislukt: {data}")

    hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)
    _LOGGER.info("Hotel Ticket System geladen, service hotel_tickets.create_ticket beschikbaar")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Verwijder een config entry."""
    hass.services.async_remove(DOMAIN, "create_ticket")
    hass.data[DOMAIN].pop(entry.entry_id)
    return True
