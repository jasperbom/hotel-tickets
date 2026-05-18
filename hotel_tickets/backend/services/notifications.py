"""
Notificatieservice: HA push, persistent notifications en e-mail.
"""
import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .ha_client import call_service, get_sensor_state

logger = logging.getLogger(__name__)

SMTP_ENABLED = os.environ.get("SMTP_ENABLED", "false").lower() == "true"
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")


async def notify_push(ha_notify_service: str, title: str, message: str, data: dict | None = None) -> None:
    """Stuur een push notificatie via de HA mobiele app."""
    if not ha_notify_service:
        return
    try:
        await call_service(
            *ha_notify_service.split(".", 1),
            {"title": title, "message": message, **({"data": data} if data else {})},
        )
    except Exception as e:
        logger.warning(f"Push notificatie mislukt naar {ha_notify_service}: {e}")


async def notify_persistent(title: str, message: str, notification_id: str | None = None) -> None:
    """Maak een persistent notification aan in HA."""
    try:
        payload = {"title": title, "message": message}
        if notification_id:
            payload["notification_id"] = notification_id
        await call_service("persistent_notification", "create", payload)
    except Exception as e:
        logger.warning(f"Persistent notificatie mislukt: {e}")


def send_email(to: str, subject: str, body: str) -> None:
    """Stuur een e-mail via SMTP (synchroon, gebruik in executor)."""
    if not SMTP_ENABLED or not SMTP_HOST or not to:
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = to
        msg.attach(MIMEText(body, "html", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [to], msg.as_string())
    except Exception as e:
        logger.warning(f"E-mail mislukt naar {to}: {e}")


async def notify_ticket_assigned(
    ticket_title: str,
    assignee_service: str | None,
    assignee_email: str | None,
    ticket_url: str | None = None,
) -> None:
    """Notificeer een medewerker bij toewijzing van een ticket."""
    title = "Ticket toegewezen"
    message = f"Je hebt een nieuw ticket: {ticket_title}"

    if assignee_service:
        data = {"url": ticket_url} if ticket_url else None
        await notify_push(assignee_service, title, message, data=data)

    await notify_persistent(title, message, notification_id=f"ticket_assigned_{assignee_service}")

    if assignee_email:
        import asyncio
        link = f'<p><a href="{ticket_url}">Open ticket</a></p>' if ticket_url else ""
        await asyncio.get_event_loop().run_in_executor(
            None, send_email, assignee_email, title,
            f"<p>{message}</p>{link}"
        )


async def notify_room_free(ticket_title: str, location_name: str, assignee_service: str, ticket_url: str | None = None) -> None:
    """Push-notificatie naar de toegewezen medewerker als de kamer vrij is."""
    data: dict = {"tag": f"room_free_{assignee_service}"}
    if ticket_url:
        data["url"] = ticket_url
    await notify_push(
        assignee_service,
        title=f"🔓 {location_name} is nu vrij",
        message=f"Je kunt nu aan de slag: {ticket_title}",
        data=data,
    )


async def notify_ticket_created(ticket_title: str, category: str) -> None:
    """Maak een algemene persistent notificatie bij nieuw ticket."""
    await notify_persistent(
        title=f"Nieuw ticket: {category}",
        message=ticket_title,
    )


# States van device_tracker / person entities die als 'niet aanwezig' tellen.
# Elke andere state (incl. 'home' of een eigen zone-naam zoals 'Hotel') betekent
# dat de medewerker in een HA-zone zit en dus een push krijgt.
_AWAY_STATES = {"not_home", "away", "unavailable", "unknown", "none", ""}


async def _is_on_wifi(device_tracker: str | None) -> bool:
    """True wanneer geen tracker gekoppeld is, óf de tracker in een HA-zone zit.

    Een device_tracker rapporteert 'home' wanneer het toestel binnen de HA
    home-zone is (typisch: aangesloten op het hotel-wifi). Wanneer de HA
    home-zone niet samenvalt met het hotel kan de state ook een andere
    zone-naam zijn (bv. 'Hotel'). Beide tellen als 'aanwezig'.
    """
    if not device_tracker:
        return True
    try:
        state = await get_sensor_state(device_tracker)
    except Exception as e:
        logger.warning("[notif] device_tracker %s uitlezen mislukt: %s", device_tracker, e)
        return False
    if not state:
        logger.warning(
            "[notif] device_tracker %s bestaat niet in HA — controleer de "
            "entity-id in Instellingen.", device_tracker,
        )
        return False
    raw = str(state.get("state", "")).strip().lower()
    is_present = raw not in _AWAY_STATES
    logger.info(
        "[notif] device_tracker %s state=%r → %s",
        device_tracker, raw, "aanwezig" if is_present else "afwezig",
    )
    return is_present


async def notify_new_department_ticket(
    ticket_title: str,
    category_label: str,
    recipients: list[dict],
    ticket_url: str | None = None,
) -> None:
    """Stuur een push naar elke medewerker met opt-in voor nieuwe-ticket meldingen.

    `recipients` is een lijst dicts met keys: `service` (notify.<...>),
    `device_tracker` (optioneel entity_id). Als `device_tracker` gevuld is wordt
    de push alleen verstuurd wanneer de tracker-state een aanwezig-zone is.
    """
    if not recipients:
        logger.info("[notif] geen recipients voor afdelings-ticket %r", ticket_title)
        return
    logger.info(
        "[notif] %d recipient(s) voor afdelings-ticket %r",
        len(recipients), ticket_title,
    )
    title = f"Nieuw ticket: {category_label}"
    data: dict = {"tag": "new_department_ticket"}
    if ticket_url:
        data["url"] = ticket_url
    for r in recipients:
        service = r.get("service")
        if not service:
            continue
        device_tracker = r.get("device_tracker")
        if not await _is_on_wifi(device_tracker):
            logger.info(
                "[notif] push overgeslagen voor %s — device_tracker %s niet aanwezig",
                service, device_tracker,
            )
            continue
        logger.info("[notif] push naar %s (device_tracker=%s)", service, device_tracker)
        await notify_push(service, title, ticket_title, data=data)


async def notify_urgent_ticket(
    ticket_title: str,
    admin_services: list[str],
    ticket_url: str | None = None,
) -> None:
    """Stuur een push naar alle admins bij een urgent ticket."""
    data: dict = {"tag": "urgent_ticket"}
    if ticket_url:
        data["url"] = ticket_url
    for service in admin_services:
        await notify_push(
            service,
            title="🚨 Urgent ticket",
            message=ticket_title,
            data=data,
        )
