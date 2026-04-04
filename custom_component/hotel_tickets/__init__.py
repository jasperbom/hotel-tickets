"""Hotel Ticket System — Home Assistant custom component."""
import logging
import os
from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

ADDON_SLUG = "hotel_tickets"
CARD_URL = "/hotel_tickets/hotel-ticket-card.js"
CARD_FILE = Path(__file__).parent / "hotel-ticket-card.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # Lovelace card als statisch bestand
    if CARD_FILE.exists():
        try:
            hass.http.register_static_path(CARD_URL, str(CARD_FILE), cache_headers=False)
            _LOGGER.info("Hotel Ticket card beschikbaar op %s", CARD_URL)
        except Exception:
            pass  # Al geregistreerd bij vorige load

    # create_ticket service (eenmalig registreren)
    if not hass.services.has_service(DOMAIN, "create_ticket"):
        supervisor_token = os.environ.get("SUPERVISOR_TOKEN", "")

        async def handle_create_ticket(call: ServiceCall) -> None:
            data = {k: v for k, v in {
                "title":       call.data.get("title"),
                "category":    call.data.get("category"),
                "description": call.data.get("description"),
                "priority":    call.data.get("priority", "medium"),
                "location_id": call.data.get("location"),
                "assigned_to": call.data.get("assigned_to"),
            }.items() if v is not None}

            url = f"http://supervisor/addons/{ADDON_SLUG}/api/tickets/"
            headers = {"Authorization": f"Bearer {supervisor_token}"}
            try:
                session = async_get_clientsession(hass)
                async with session.post(url, headers=headers, json=data) as resp:
                    if resp.status in (200, 201):
                        result = await resp.json()
                        _LOGGER.info("Ticket aangemaakt: %s (id=%s)", data.get("title"), result.get("id"))
                    else:
                        _LOGGER.error("Ticket aanmaken mislukt: HTTP %s", resp.status)
            except Exception as exc:
                _LOGGER.error("Ticket aanmaken fout: %s", exc)

        hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)
        _LOGGER.info("hotel_tickets.create_ticket service geregistreerd")

    hass.data[DOMAIN][entry.entry_id] = {}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN].pop(entry.entry_id, None)
    if not hass.data[DOMAIN]:
        if hass.services.has_service(DOMAIN, "create_ticket"):
            hass.services.async_remove(DOMAIN, "create_ticket")
    return True
