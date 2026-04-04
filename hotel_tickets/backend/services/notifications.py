"""
Notificatieservice: HA push, persistent notifications en e-mail.
"""
import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .ha_client import call_service

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


async def notify_ticket_assigned(ticket_title: str, assignee_service: str | None, assignee_email: str | None) -> None:
    """Notificeer een medewerker bij toewijzing van een ticket."""
    title = "Ticket toegewezen"
    message = f"Je hebt een nieuw ticket: {ticket_title}"

    if assignee_service:
        await notify_push(assignee_service, title, message)

    await notify_persistent(title, message, notification_id=f"ticket_assigned_{assignee_service}")

    if assignee_email:
        import asyncio
        await asyncio.get_event_loop().run_in_executor(
            None, send_email, assignee_email, title,
            f"<p>{message}</p>"
        )


async def notify_room_free(ticket_title: str, location_name: str, assignee_service: str) -> None:
    """Push-notificatie naar de toegewezen medewerker als de kamer vrij is."""
    await notify_push(
        assignee_service,
        title=f"🔓 {location_name} is nu vrij",
        message=f"Je kunt nu aan de slag: {ticket_title}",
        data={"tag": f"room_free_{assignee_service}"},
    )


async def notify_ticket_created(ticket_title: str, category: str) -> None:
    """Maak een algemene persistent notificatie bij nieuw ticket."""
    await notify_persistent(
        title=f"Nieuw ticket: {category}",
        message=ticket_title,
    )
