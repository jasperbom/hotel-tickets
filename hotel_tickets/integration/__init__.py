"""Hotel Ticket System — Home Assistant custom component."""
import logging
import os
from pathlib import Path

import aiohttp

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import HomeAssistantError

DOMAIN = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

# Docker hostname = Supervisor slug (repo-hash + slug, zie GET /addons listing).
# async_get_clientsession(hass) gebruikt HA's mDNS-resolver die Docker DNS niet kent;
# aiohttp.ClientSession() gebruikt de systeems-DNS die Docker container-namen oplost.
ADDON_URL = "http://62246620-hotel-tickets:8080"

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

        async def handle_create_ticket(call: ServiceCall) -> None:
            data = {k: v for k, v in {
                "title":       call.data.get("title"),
                "category":    call.data.get("category"),
                "description": call.data.get("description"),
                "priority":    call.data.get("priority", "medium"),
                "location_id": call.data.get("location"),
                "assigned_to": call.data.get("assigned_to"),
            }.items() if v is not None}

            url = f"{ADDON_URL}/api/tickets/"
            _LOGGER.info("[hotel_tickets] create_ticket → POST %s", url)

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        url,
                        headers={"Authorization": f"Bearer {supervisor_token}"},
                        json=data,
                    ) as resp:
                        body = await resp.text()
                        _LOGGER.info("[hotel_tickets] HTTP %s | %s", resp.status, body[:300])
                        if resp.status in (200, 201):
                            _LOGGER.info("[hotel_tickets] Ticket aangemaakt: %s", data.get("title"))
                        else:
                            _LOGGER.error("[hotel_tickets] Mislukt HTTP %s: %s", resp.status, body[:300])
                            raise HomeAssistantError(
                                f"Ticket aanmaken mislukt (HTTP {resp.status}): {body[:200]}"
                            )
            except HomeAssistantError:
                raise
            except Exception as exc:
                _LOGGER.error("[hotel_tickets] Verbindingsfout: %s", exc, exc_info=True)
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
