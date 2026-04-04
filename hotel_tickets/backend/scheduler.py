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
    from .database import AsyncSessionLocal
    from .models import RecurringTemplate, Ticket
    from .services.ha_entities import sync_ticket_sensors

    async with AsyncSessionLocal() as db:
        template = await db.get(RecurringTemplate, template_id)
        if not template or not template.is_active:
            return

        ticket = Ticket(
            title=template.title,
            description=template.description,
            category=template.category,
            priority=template.priority,
            location_id=template.location_id,
            assigned_to=template.assign_to,
            created_by="system",
            recurring_template_id=template.id,
        )
        db.add(ticket)
        await db.commit()
        await sync_ticket_sensors(db)
        logger.info(f"Recurring ticket aangemaakt: {template.title}")


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
