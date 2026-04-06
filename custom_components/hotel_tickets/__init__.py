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
    """Zoek de HA user_id via device registry → mobile_app config entry."""
    if not device_id:
        return None
    try:
        from homeassistant.components.mobile_app.const import DOMAIN as MOBILE_APP_DOMAIN
        dev_reg = dr.async_get(hass)
        device = dev_reg.async_get(device_id)
        if device:
            for entry_id in device.config_entries:
                entry = hass.config_entries.async_get_entry(entry_id)
                if entry and entry.domain == MOBILE_APP_DOMAIN:
                    return entry.data.get("user_id")
    except Exception as exc:
        _LOGGER.warning("Kon ha_user_id niet bepalen voor device '%s': %s", device_id, exc)
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
        _LOGGER.info("NFC tag gescand: tag_id='%s' device_id='%s' ha_user_id='%s'", tag_id, device_id, ha_user_id)
        _LOGGER.info("NFC → POST %s/api/nfc/scan", ADDON_URL)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{ADDON_URL}/api/nfc/scan",
                    headers={"Authorization": f"Bearer {supervisor_token}"},
                    json={"tag_id": tag_id, "ha_user_id": ha_user_id},
                ) as resp:
                    body = await resp.text()
                    _LOGGER.info("NFC scan response HTTP %s: %s", resp.status, body[:300])
                    if resp.status == 200:
                        _LOGGER.info("NFC afgerond voor tag '%s'", tag_id)
                    elif resp.status == 404:
                        _LOGGER.warning(
                            "NFC tag '%s' niet gevonden in de addon — controleer of de tag ID exact overeenkomt met het sjabloon",
                            tag_id,
                        )
        except Exception as exc:
            _LOGGER.error("NFC scan verbindingsfout naar %s: %s", ADDON_URL, exc)

    # Luister naar alle tag scans in HA (event heet "tag_scanned", niet "tag.tag_scanned")
    cancel_listener = hass.bus.async_listen("tag_scanned", handle_tag_scanned)

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
