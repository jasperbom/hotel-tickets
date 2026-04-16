"""
APScheduler voor het automatisch aanmaken van tickets op basis van recurring templates.
"""
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler(timezone="Europe/Amsterdam")


def get_scheduler() -> AsyncIOScheduler:
    return _scheduler


async def _create_ticket_from_template(template_id: str) -> None:
    """Job functie die wordt aangeroepen door APScheduler."""
    import json
    from .database import AsyncSessionLocal
    from .models import RecurringTemplate, Ticket
    from .services.ha_entities import sync_ticket_sensors

    async with AsyncSessionLocal() as db:
        template = await db.get(RecurringTemplate, template_id)
        if not template or not template.is_active:
            return

        if template.subtask_mode == "rooms" and template.subtask_items:
            # Maak één ticket per kamer
            room_ids = json.loads(template.subtask_items)
            for room_id in room_ids:
                ticket = Ticket(
                    title=template.title,
                    description=template.description,
                    category=template.category,
                    priority=template.priority,
                    location_id=room_id,
                    assigned_to=template.assign_to,
                    created_by="system",
                    recurring_template_id=template.id,
                    notify_when_free=template.notify_when_free,
                )
                db.add(ticket)
            logger.info(f"Recurring tickets aangemaakt voor {len(room_ids)} kamers: {template.title}")
        elif template.subtask_mode == "subtasks" and template.subtask_items:
            # Maak één ticket met subtaken JSON
            labels = json.loads(template.subtask_items)
            subtasks_json = json.dumps([
                {"label": l, "done": False, "done_by": None, "done_at": None}
                for l in labels
            ])
            ticket = Ticket(
                title=template.title,
                description=template.description,
                category=template.category,
                priority=template.priority,
                location_id=template.location_id,
                assigned_to=template.assign_to,
                created_by="system",
                recurring_template_id=template.id,
                notify_when_free=template.notify_when_free,
                subtasks=subtasks_json,
            )
            db.add(ticket)
            logger.info(f"Recurring ticket aangemaakt met {len(labels)} subtaken: {template.title}")
        else:
            ticket = Ticket(
                title=template.title,
                description=template.description,
                category=template.category,
                priority=template.priority,
                location_id=template.location_id,
                assigned_to=template.assign_to,
                created_by="system",
                recurring_template_id=template.id,
                notify_when_free=template.notify_when_free,
            )
            db.add(ticket)
            logger.info(f"Recurring ticket aangemaakt: {template.title}")

        await db.commit()
        await sync_ticket_sensors(db)


async def schedule_template(template) -> None:
    """Plan een recurring template in de scheduler."""
    if not template.is_active:
        return

    # Parse cron expressie (5-veld standaard cron)
    parts = template.cron_expression.split()
    if len(parts) != 5:
        logger.warning(f"Ongeldige cron expressie: {template.cron_expression}")
        return

    minute, hour, day, month, day_of_week = parts

    _scheduler.add_job(
        _create_ticket_from_template,
        trigger=CronTrigger(
            minute=minute,
            hour=hour,
            day=day,
            month=month,
            day_of_week=day_of_week,
        ),
        args=[template.id],
        id=f"recurring_{template.id}",
        replace_existing=True,
        name=template.title,
    )
    logger.info(f"Template gepland: {template.title} ({template.cron_expression})")


async def reschedule_template(template) -> None:
    """Herplan een bestaand template (na wijziging)."""
    await remove_template(template.id)
    if template.is_active:
        await schedule_template(template)


async def remove_template(template_id: str) -> None:
    """Verwijder een job uit de scheduler."""
    job_id = f"recurring_{template_id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


async def _keycard_watcher_job() -> None:
    """
    Polt elk minuut de keycard-sensoren voor tickets waarbij
    'notify_when_free' is ingeschakeld. Stuurt een push-notificatie
    naar de toegewezen medewerker zodra de kamer vrij is.
    """
    from .database import AsyncSessionLocal
    from .models import Ticket, UserRole, Status
    from .services.ha_client import get_sensor_state
    from .services.notifications import notify_room_free
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Ticket).where(
                Ticket.notify_when_free == True,        # noqa: E712
                Ticket.location_id.isnot(None),
                Ticket.assigned_to.isnot(None),
                Ticket.status != Status.closed,
            )
        )
        tickets = result.scalars().all()

        for ticket in tickets:
            entity_id = f"binary_sensor.{ticket.location_id}_keycard"
            state = await get_sensor_state(entity_id)
            if not state or state.get("state") != "off":
                continue  # Kamer nog bezet of sensor onbekend

            # Kamer is nu vrij — medewerker ophalen voor push
            user_result = await db.execute(
                select(UserRole).where(UserRole.ha_user_id == ticket.assigned_to)
            )
            user = user_result.scalar_one_or_none()

            location_name = ticket.location_id  # Fallback als naam onbekend is
            if user and user.ha_notify_service:
                await notify_room_free(ticket.title, location_name, user.ha_notify_service)
                logger.info(f"Kamer-vrij notificatie verstuurd voor ticket {ticket.id} → {user.display_name}")

            ticket.notify_when_free = False
            await db.commit()


def start_keycard_watcher() -> None:
    """Plan de keycard watcher job — draait elke minuut."""
    _scheduler.add_job(
        _keycard_watcher_job,
        trigger="interval",
        minutes=1,
        id="keycard_watcher",
        replace_existing=True,
        name="Keycard watcher",
    )
    logger.info("Keycard watcher gestart (elke minuut)")


async def _bike_key_return_job() -> None:
    """
    Maakt dagelijks om 07:00 receptie-tickets aan voor fietsreserveringen die vandaag aflopen,
    zodat de receptie de sleutel kan terugkrijgen.
    """
    from datetime import date
    from sqlalchemy import select, and_
    from .database import AsyncSessionLocal
    from .models import Ticket, BikeReservation, BikeReservationStatus, Category, Priority, Status

    async with AsyncSessionLocal() as db:
        today = date.today()
        result = await db.execute(
            select(BikeReservation).where(
                and_(
                    BikeReservation.end_date == today,
                    BikeReservation.status == BikeReservationStatus.active,
                    BikeReservation.key_ticket_id.is_(None),
                    BikeReservation.key_returned_at.is_(None),
                )
            )
        )
        reservations = result.scalars().all()
        for res in reservations:
            desc_parts = [f"Verhuurperiode eindigt vandaag ({today})."]
            if res.guest_room:
                desc_parts.append(f"Kamer: {res.guest_room}.")
            ticket = Ticket(
                title=f"Fietssleutel terugkrijgen – {res.guest_name}",
                description=" ".join(desc_parts),
                category=Category.reception,
                priority=Priority.high,
                created_by="system",
                status=Status.open,
            )
            db.add(ticket)
            await db.flush()
            res.key_ticket_id = ticket.id
        if reservations:
            await db.commit()
            logger.info("Sleuteltickets aangemaakt voor %d reserveringen", len(reservations))


def start_bike_key_watcher() -> None:
    """Plan de dagelijkse fietssleutel-terugave job — draait elke dag om 07:00."""
    _scheduler.add_job(
        _bike_key_return_job,
        trigger=CronTrigger(hour=7, minute=0),
        id="bike_key_return",
        replace_existing=True,
        name="Fietssleutel terugave tickets",
    )
    logger.info("Bike key return job gepland (dagelijks 07:00)")


async def load_all_templates() -> None:
    """Laad alle actieve templates bij opstarten van de app."""
    from .database import AsyncSessionLocal
    from .models import RecurringTemplate
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RecurringTemplate).where(RecurringTemplate.is_active == True)
        )
        templates = result.scalars().all()
        for template in templates:
            await schedule_template(template)
        logger.info(f"{len(templates)} recurring templates geladen")
