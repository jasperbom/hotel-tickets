"""Hotel Ticket System — Home Assistant custom component."""
import logging
import os
from pathlib import Path

import aiohttp

from homeassistant.core import HomeAssistant, ServiceCall, Event
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr

DOMAIN = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

ADDON_URL = "http://62246620-hotel-tickets:8080"
CARD_URL = "/hotel_tickets/hotel-ticket-card.js"
CARD_FILE = Path(__file__).parent / "hotel-ticket-card.js"


def _get_supervisor_token() -> str:
    return os.environ.get("SUPERVISOR_TOKEN", "")


def _get_ha_user_id_for_device(hass: HomeAssistant, device_id: str | None) -> str | None:
    """Zoek de HA user_id die hoort bij een mobile_app device_id."""
    if not device_id:
        return None
    try:
        from homeassistant.components.mobile_app.const import DOMAIN as MOBILE_APP_DOMAIN
        for entry in hass.config_entries.async_entries(MOBILE_APP_DOMAIN):
            if entry.data.get("device_id") == device_id:
                return entry.data.get("user_id")
    except Exception:
        pass
    return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    # Lovelace card beschikbaar stellen
    if CARD_FILE.exists():
        try:
            hass.http.register_static_path(CARD_URL, str(CARD_FILE), cache_headers=False)
            _LOGGER.info("Hotel Ticket card beschikbaar op %s", CARD_URL)
        except Exception:
            pass

    supervisor_token = _get_supervisor_token()

    # --- create_ticket service ---
    if not hass.services.has_service(DOMAIN, "create_ticket"):
        async def handle_create_ticket(call: ServiceCall) -> None:
            data = {k: v for k, v in {
                "title":        call.data.get("title"),
                "category":     call.data.get("category"),
                "description":  call.data.get("description"),
                "priority":     call.data.get("priority", "medium"),
                "location_id":  call.data.get("location"),
                "assigned_to":  call.data.get("assigned_to"),
                "creator_name": call.data.get("creator_name"),
            }.items() if v is not None}

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{ADDON_URL}/api/tickets/",
                        headers={"Authorization": f"Bearer {supervisor_token}"},
                        json=data,
                    ) as resp:
                        body = await resp.text()
                        if resp.status in (200, 201):
                            _LOGGER.info("Ticket aangemaakt: %s", data.get("title"))
                        else:
                            raise HomeAssistantError(
                                f"Ticket aanmaken mislukt (HTTP {resp.status}): {body[:200]}"
                            )
            except HomeAssistantError:
                raise
            except Exception as exc:
                raise HomeAssistantError(f"Verbindingsfout: {exc}") from exc

        hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)

    # --- NFC tag listener ---
    async def handle_tag_scanned(event: Event) -> None:
        tag_id: str | None = event.data.get("tag_id")
        device_id: str | None = event.data.get("device_id")

        if not tag_id:
            return

        ha_user_id = _get_ha_user_id_for_device(hass, device_id)
        _LOGGER.debug("NFC tag gescand: %s door device %s (user %s)", tag_id, device_id, ha_user_id)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{ADDON_URL}/api/nfc/scan",
                    headers={"Authorization": f"Bearer {supervisor_token}"},
                    json={"tag_id": tag_id, "ha_user_id": ha_user_id},
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        _LOGGER.info("NFC afgerond: %s", data.get("message", ""))
                    elif resp.status == 404:
                        _LOGGER.debug("NFC tag '%s' niet gekoppeld aan een taak — genegeerd", tag_id)
                    else:
                        body = await resp.text()
                        _LOGGER.warning("NFC scan mislukt HTTP %s: %s", resp.status, body[:200])
        except Exception as exc:
            _LOGGER.error("NFC scan verbindingsfout: %s", exc)

    # Luister naar alle tag scans in HA
    cancel_listener = hass.bus.async_listen("tag.tag_scanned", handle_tag_scanned)

    hass.data[DOMAIN][entry.entry_id] = {
        "cancel_tag_listener": cancel_listener,
    }
    _LOGGER.info("Hotel Ticket System actief — NFC listener geregistreerd")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_data = hass.data[DOMAIN].pop(entry.entry_id, {})

    # Verwijder de NFC listener
    cancel = entry_data.get("cancel_tag_listener")
    if cancel:
        cancel()

    if not hass.data[DOMAIN]:
        if hass.services.has_service(DOMAIN, "create_ticket"):
            hass.services.async_remove(DOMAIN, "create_ticket")

    return True
