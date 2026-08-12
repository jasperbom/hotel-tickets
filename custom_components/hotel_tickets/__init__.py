"""Hotel Ticket System — Home Assistant custom component."""
import logging
import os
import threading
from pathlib import Path

import aiohttp

from homeassistant.core import HomeAssistant, ServiceCall, Event
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr

DOMAIN = "hotel_tickets"
_LOGGER = logging.getLogger(__name__)

ADDON_URL = "http://62246620-hotel-tickets:8080"
ADDON_INGRESS_BASE = "/hassio/ingress/hotel_tickets"
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

    # --- navigate service ---
    if not hass.services.has_service(DOMAIN, "navigate"):
        async def handle_navigate(call: ServiceCall) -> None:
            target = call.data.get("target", "")
            path = call.data.get("path", "/")
            title = call.data.get("title", "Hotel Tickets")
            message = call.data.get("message", "Tik om te openen")

            if not target:
                raise HomeAssistantError("'target' is verplicht (bijv. mobile_app_iphone_jan)")

            # Bouw de deep link URL
            path = path.lstrip("/")
            url = f"{ADDON_INGRESS_BASE}/#{path}"

            try:
                await hass.services.async_call(
                    "notify",
                    target,
                    {"title": title, "message": message, "data": {"url": url}},
                )
                _LOGGER.info("Navigatie push verstuurd naar %s: %s", target, url)
            except Exception as exc:
                raise HomeAssistantError(f"Navigatie push mislukt: {exc}") from exc

        hass.services.async_register(DOMAIN, "navigate", handle_navigate)

    # --- cast_wandscherm service ---
    if not hass.services.has_service(DOMAIN, "cast_wandscherm"):
        async def handle_cast_wandscherm(call: ServiceCall) -> None:
            """Zet het wandscherm op een Chromecast via DashCast.

            Een Chromecast kan geen webpagina openen: de Default Media Receiver
            speelt alleen media. DashCast is een openbare receiver-app die
            precies één ding doet — een URL laden — en daar praten we hier mee.

            De URL moet een kioskcode bevatten (Instellingen → Wandschermen) en
            bereikbaar zijn vanaf het Chromecast-apparaat zelf: dus het
            LAN-adres van Home Assistant op poort 8080, niet het ingress-pad.
            Gebruik http; de ingebouwde browser weigert een zelfondertekend
            certificaat zonder dat je dat te zien krijgt.
            """
            url = (call.data.get("url") or "").strip()
            device_name = (call.data.get("device_name") or "").strip()
            entity_id = call.data.get("entity_id")
            force = call.data.get("force", True)

            if not url:
                raise HomeAssistantError("'url' is verplicht")

            # entity_id is de makkelijke weg; de naam van de entiteit is meestal
            # ook de naam van het apparaat. Is hij in HA hernoemd, dan werkt dat
            # niet en moet 'device_name' erbij.
            if not device_name and entity_id:
                if isinstance(entity_id, list):
                    entity_id = entity_id[0] if entity_id else None
                state = hass.states.get(entity_id) if entity_id else None
                if state:
                    device_name = state.attributes.get("friendly_name") or ""

            if not device_name:
                raise HomeAssistantError(
                    "Geef 'device_name' op (de naam van de Chromecast in de Google Home-app) "
                    "of een 'entity_id' waarvan de naam daarmee overeenkomt"
                )

            def _cast() -> None:
                try:
                    import pychromecast
                    from pychromecast.controllers.dashcast import DashCastController
                except ImportError as exc:  # pragma: no cover
                    raise HomeAssistantError(
                        "pychromecast ontbreekt — voeg de Google Cast integratie toe in "
                        "Home Assistant, die installeert de benodigde bibliotheek"
                    ) from exc

                casts, browser = pychromecast.get_listed_chromecasts(friendly_names=[device_name])
                try:
                    if not casts:
                        raise HomeAssistantError(
                            f"Chromecast '{device_name}' niet gevonden op het netwerk"
                        )
                    cast = casts[0]
                    cast.wait(timeout=15)
                    controller = DashCastController()
                    cast.register_handler(controller)

                    # Wachten op de bevestiging van het apparaat: zonder dat
                    # zouden we de verbinding kunnen sluiten voordat de opdracht
                    # het toestel bereikt heeft.
                    klaar = threading.Event()
                    controller.load_url(url, force=force, callback_function=lambda *_: klaar.set())
                    if not klaar.wait(timeout=15):
                        _LOGGER.warning(
                            "Geen bevestiging van '%s' binnen 15 s — mogelijk toch geladen",
                            device_name,
                        )
                    cast.disconnect(blocking=True, timeout=5)
                finally:
                    pychromecast.discovery.stop_discovery(browser)

            try:
                await hass.async_add_executor_job(_cast)
                _LOGGER.info("Wandscherm gecast naar '%s': %s", device_name, url)
            except HomeAssistantError:
                raise
            except Exception as exc:
                raise HomeAssistantError(f"Casten mislukt: {exc}") from exc

        hass.services.async_register(DOMAIN, "cast_wandscherm", handle_cast_wandscherm)

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
        if hass.services.has_service(DOMAIN, "navigate"):
            hass.services.async_remove(DOMAIN, "navigate")
        if hass.services.has_service(DOMAIN, "cast_wandscherm"):
            hass.services.async_remove(DOMAIN, "cast_wandscherm")

    return True
