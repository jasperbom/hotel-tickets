"""
NFC-scan endpoint: sluit de bijbehorende herhalende taak af en stuurt een pushmelding.
Wordt aangeroepen vanuit een HA-automatisering wanneer een NFC-tag gescand wordt.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel

from ..database import get_db
from ..models import RecurringTemplate, Ticket, Status, UserRole
from ..services.notifications import notify_push
from ..services.ha_entities import sync_ticket_sensors
from .settings import get_ticket_base_url

router = APIRouter(prefix="/nfc", tags=["nfc"])


class NfcScanRequest(BaseModel):
    tag_id: str
    ha_user_id: str | None = None


class NfcScanResponse(BaseModel):
    ok: bool
    message: str
    ticket_id: str | None = None
    template_title: str | None = None


@router.post("/scan", response_model=NfcScanResponse)
async def nfc_scan(body: NfcScanRequest, db: AsyncSession = Depends(get_db)):
    """Verwerk een NFC-scan: sluit de openstaande taak en stuur een bevestiging."""

    # Zoek het sjabloon met dit NFC-tag
    result = await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.nfc_tag_id == body.tag_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail=f"Geen herhalende taak gekoppeld aan NFC-tag '{body.tag_id}'")

    # Zoek de laatste openstaande ticket van dit sjabloon
    ticket_result = await db.execute(
        select(Ticket).where(
            and_(
                Ticket.recurring_template_id == template.id,
                Ticket.status != Status.closed,
            )
        ).order_by(Ticket.created_at.desc()).limit(1)
    )
    ticket = ticket_result.scalar_one_or_none()

    if ticket:
        ticket.status = Status.closed
        ticket.closed_at = datetime.now(timezone.utc)
        ticket.closed_by = body.ha_user_id or "nfc"
        await sync_ticket_sensors(db)

    # Stuur pushmelding naar de scanner (als ha_user_id bekend is)
    if body.ha_user_id:
        user = await db.get(UserRole, body.ha_user_id)
        if user and user.ha_notify_service:
            base_url = await get_ticket_base_url(db)
            ticket_url = f"{base_url}/#/tickets/{ticket.id}" if ticket else None
            await notify_push(
                user.ha_notify_service,
                title="✓ Taak afgerond",
                message=f"{template.title} is afgevinkt via NFC",
                data={"url": ticket_url} if ticket_url else None,
            )

    return NfcScanResponse(
        ok=True,
        message=f"Taak '{template.title}' afgerond",
        ticket_id=ticket.id if ticket else None,
        template_title=template.title,
    )
