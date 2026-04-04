"""Hotel Ticket System — Home Assistant custom component."""
import logging
import os
from pathlib import Path

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import HomeAssistantError
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
    if CARD_FILE.exists():
        try:
            hass.http.register_static_path(CARD_URL, str(CARD_FILE), cache_headers=False)
            _LOGGER.info("Hotel Ticket card beschikbaar op %s", CARD_URL)
        except Exception:
            pass

    if not hass.services.has_service(DOMAIN, "create_ticket"):
        supervisor_token = os.environ.get("SUPERVISOR_TOKEN", "")

        _LOGGER.info(
            "[hotel_tickets] SUPERVISOR_TOKEN aanwezig: %s",
            "JA (lengte %d)" % len(supervisor_token) if supervisor_token else "NEE — aanroepen zullen falen",
        )

        async def handle_create_ticket(call: ServiceCall) -> None:
            data = {k: v for k, v in {
                "title":       call.data.get("title"),
                "category":    call.data.get("category"),
                "description": call.data.get("description"),
                "priority":    call.data.get("priority", "medium"),
                "location_id": call.data.get("location"),
                "assigned_to": call.data.get("assigned_to"),
            }.items() if v is not None}

            # Supervisor proxy strips /addons/{slug}/api en stuurt de rest door.
            # FastAPI serveert op /api/tickets/, dus de URL moet /api/api/tickets/ zijn:
            # http://supervisor/addons/{slug}/api  +  /api/tickets/  →  addon ontvangt /api/tickets/
            url = f"http://supervisor/addons/{ADDON_SLUG}/api/api/tickets/"

            _LOGGER.info("[hotel_tickets] create_ticket aangeroepen — data: %s", data)
            _LOGGER.info("[hotel_tickets] POST naar: %s", url)
            _LOGGER.info("[hotel_tickets] SUPERVISOR_TOKEN lengte: %d", len(supervisor_token))

            try:
                session = async_get_clientsession(hass)
                async with session.post(
                    url,
                    headers={"Authorization": f"Bearer {supervisor_token}"},
                    json=data,
                ) as resp:
                    body = await resp.text()
                    _LOGGER.info("[hotel_tickets] HTTP status: %s", resp.status)
                    _LOGGER.info("[hotel_tickets] Antwoord (eerste 300 tekens): %s", body[:300])
                    if resp.status in (200, 201):
                        _LOGGER.info("[hotel_tickets] Ticket succesvol aangemaakt: %s", data.get("title"))
                    else:
                        _LOGGER.error("[hotel_tickets] Ticket aanmaken MISLUKT — HTTP %s: %s", resp.status, body[:300])
                        raise HomeAssistantError(f"Ticket aanmaken mislukt (HTTP {resp.status}): {body[:200]}")
            except HomeAssistantError:
                raise
            except Exception as exc:
                _LOGGER.error("[hotel_tickets] Verbindingsfout bij ticket aanmaken: %s", exc, exc_info=True)
                raise HomeAssistantError(f"Verbindingsfout: {exc}") from exc

        hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)
        _LOGGER.info("[hotel_tickets] create_ticket service geregistreerd")

    hass.data[DOMAIN][entry.entry_id] = {}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN].pop(entry.entry_id, None)
    if not hass.data[DOMAIN]:
        if hass.services.has_service(DOMAIN, "create_ticket"):
            hass.services.async_remove(DOMAIN, "create_ticket")
    return True
