"""
Synchroniseert ticket-tellingen naar HA sensor entiteiten.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..models import Ticket, Status, Category
from .ha_client import update_sensor_state

logger = logging.getLogger(__name__)


async def sync_ticket_sensors(db: AsyncSession) -> None:
    """Update alle ticket-count sensoren in HA."""
    try:
        # Totaal open
        total = await db.scalar(
            select(func.count()).where(Ticket.status != Status.closed)
        )
        await update_sensor_state(
            "sensor.hotel_tickets_open",
            total or 0,
            {"friendly_name": "Open tickets", "icon": "mdi:ticket-outline"},
        )

        # Per categorie
        for category, entity_suffix, name in [
            (Category.technical, "technical_open", "Open technische tickets"),
            (Category.housekeeping, "housekeeping_open", "Open huishoudingstickets"),
            (Category.reception, "reception_open", "Open receptietickets"),
        ]:
            count = await db.scalar(
                select(func.count()).where(
                    Ticket.status != Status.closed,
                    Ticket.category == category,
                )
            )
            await update_sensor_state(
                f"sensor.hotel_tickets_{entity_suffix}",
                count or 0,
                {"friendly_name": name, "icon": "mdi:ticket"},
            )
    except Exception as e:
        logger.warning(f"Sensor sync mislukt: {e}")
