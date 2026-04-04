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

ADDON_PORT = 8080
CARD_URL = "/hotel_tickets/hotel-ticket-card.js"
CARD_FILE = Path(__file__).parent / "hotel-ticket-card.js"


async def _get_addon_ip(session, supervisor_token: str) -> str | None:
    """
    Haal het IP-adres van de addon op via de Supervisor info-endpoint.
    Probeer zowel 'local_hotel_tickets' (lokale addon) als 'hotel_tickets'.
    """
    for slug in ("local_hotel_tickets", "hotel_tickets"):
        try:
            async with session.get(
                f"http://supervisor/addons/{slug}/info",
                headers={"Authorization": f"Bearer {supervisor_token}"},
            ) as r:
                if r.status == 200:
                    info = await r.json()
                    ip = info.get("data", {}).get("ip_address")
                    _LOGGER.info(
                        "[hotel_tickets] Addon IP gevonden (slug=%s): %s", slug, ip
                    )
                    return ip
                _LOGGER.debug(
                    "[hotel_tickets] Addon info slug=%s → HTTP %s", slug, r.status
                )
        except Exception as exc:
            _LOGGER.debug("[hotel_tickets] Addon info fout (slug=%s): %s", slug, exc)
    return None


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

        # Haal addon IP op zodat we geen DNS nodig hebben.
        # HA's aiohttp sessie gebruikt een mDNS resolver die Docker hostnames niet oplost.
        addon_ip = None
        if supervisor_token:
            session = async_get_clientsession(hass)
            addon_ip = await _get_addon_ip(session, supervisor_token)
            if not addon_ip:
                _LOGGER.warning(
                    "[hotel_tickets] Addon IP niet gevonden — ticket aanmaken zal mislukken. "
                    "Zorg dat de addon draait en herstart HA."
                )

        hass.data[DOMAIN]["addon_ip"] = addon_ip

        async def handle_create_ticket(call: ServiceCall) -> None:
            ip = hass.data[DOMAIN].get("addon_ip")
            if not ip:
                raise HomeAssistantError(
                    "Addon IP onbekend — zorg dat de addon draait en herstart HA"
                )

            data = {k: v for k, v in {
                "title":       call.data.get("title"),
                "category":    call.data.get("category"),
                "description": call.data.get("description"),
                "priority":    call.data.get("priority", "medium"),
                "location_id": call.data.get("location"),
                "assigned_to": call.data.get("assigned_to"),
            }.items() if v is not None}

            url = f"http://{ip}:{ADDON_PORT}/api/tickets/"

            _LOGGER.info("[hotel_tickets] create_ticket aangeroepen — data: %s", data)
            _LOGGER.info("[hotel_tickets] POST naar: %s", url)

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
