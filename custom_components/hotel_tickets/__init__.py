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
    Haal het IP op via de individuele addon-endpoint (bevat ip_address).
    Probeer meerdere slug-formaten en log alles op WARNING zodat het zichtbaar is.
    """
    headers = {"Authorization": f"Bearer {supervisor_token}"}

    # Stap 1: probeer de individuele info-endpoints met beide slug-formaten
    for slug in ("local_hotel_tickets", "hotel_tickets"):
        for path in (f"/addons/{slug}", f"/addons/{slug}/info"):
            try:
                async with session.get(
                    f"http://supervisor{path}",
                    headers=headers,
                ) as r:
                    body = await r.text()
                    _LOGGER.warning(
                        "[hotel_tickets] GET %s → HTTP %s | body: %s",
                        path, r.status, body[:600],
                    )
                    if r.status == 200:
                        import json
                        info = json.loads(body)
                        ip = (
                            info.get("data", {}).get("ip_address")
                            or info.get("ip_address")
                        )
                        _LOGGER.warning("[hotel_tickets] ip_address in response: %r", ip)
                        if ip:
                            return ip
            except Exception as exc:
                _LOGGER.warning("[hotel_tickets] GET %s fout: %s", path, exc)

    # Stap 2: haal alle addons op en log de volledige lijst
    try:
        async with session.get(
            "http://supervisor/addons",
            headers=headers,
        ) as r:
            body = await r.text()
            _LOGGER.warning(
                "[hotel_tickets] GET /addons → HTTP %s | body (eerste 1200): %s",
                r.status, body[:1200],
            )
    except Exception as exc:
        _LOGGER.warning("[hotel_tickets] GET /addons fout: %s", exc)

    return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if CARD_FILE.exists():
        try:
            hass.http.register_static_path(CARD_URL, str(CARD_FILE), cache_headers=False)
            _LOGGER.warning("Hotel Ticket card beschikbaar op %s", CARD_URL)
        except Exception:
            pass

    supervisor_token = os.environ.get("SUPERVISOR_TOKEN", "")
    _LOGGER.warning(
        "[hotel_tickets] SUPERVISOR_TOKEN aanwezig: %s",
        "JA (lengte %d)" % len(supervisor_token) if supervisor_token else "NEE",
    )

    # Haal addon IP op — altijd, ook als service al geregistreerd is
    addon_ip = None
    if supervisor_token:
        session = async_get_clientsession(hass)
        addon_ip = await _get_addon_ip(session, supervisor_token)
        _LOGGER.warning("[hotel_tickets] Addon IP resultaat: %r", addon_ip)

    hass.data[DOMAIN]["addon_ip"] = addon_ip

    if not hass.services.has_service(DOMAIN, "create_ticket"):

        async def handle_create_ticket(call: ServiceCall) -> None:
            ip = hass.data[DOMAIN].get("addon_ip")
            if not ip:
                raise HomeAssistantError(
                    "Addon IP onbekend — zie HA logs voor details en herstart HA"
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
            _LOGGER.warning("[hotel_tickets] POST naar: %s — data: %s", url, data)

            try:
                session = async_get_clientsession(hass)
                async with session.post(
                    url,
                    headers={"Authorization": f"Bearer {supervisor_token}"},
                    json=data,
                ) as resp:
                    body = await resp.text()
                    _LOGGER.warning("[hotel_tickets] HTTP %s | %s", resp.status, body[:300])
                    if resp.status in (200, 201):
                        _LOGGER.warning("[hotel_tickets] Ticket aangemaakt: %s", data.get("title"))
                    else:
                        raise HomeAssistantError(f"Ticket aanmaken mislukt (HTTP {resp.status}): {body[:200]}")
            except HomeAssistantError:
                raise
            except Exception as exc:
                _LOGGER.warning("[hotel_tickets] Verbindingsfout: %s", exc)
                raise HomeAssistantError(f"Verbindingsfout: {exc}") from exc

        hass.services.async_register(DOMAIN, "create_ticket", handle_create_ticket)
        _LOGGER.warning("[hotel_tickets] create_ticket service geregistreerd")

    hass.data[DOMAIN][entry.entry_id] = {}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN].pop(entry.entry_id, None)
    if not hass.data[DOMAIN]:
        if hass.services.has_service(DOMAIN, "create_ticket"):
            hass.services.async_remove(DOMAIN, "create_ticket")
    return True
