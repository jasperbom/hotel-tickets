"""
NFC-scan endpoint: sluit de bijbehorende herhalende taak af en stuurt een pushmelding.
Wordt aangeroepen vanuit een HA-automatisering wanneer een NFC-tag gescand wordt.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from pydantic import BaseModel

from ..database import get_db
from ..models import (
    RecurringTemplate,
    Ticket,
    Status,
    Priority,
    UserRole,
    PoolConfig,
    PoolLog,
    PoolId,
    new_uuid,
)
from ..services.notifications import notify_push
from ..services.ha_entities import sync_ticket_sensors
from .settings import get_ticket_base_url

router = APIRouter(prefix="/nfc", tags=["nfc"])


# Welke chemische actie hoort bij welk PoolConfig-kolom
CHEMICAL_ACTIONS = {
    "chloor_nfc_tag_id": "Chloor tank vervangen",
    "zuur_nfc_tag_id": "Zuur tank vervangen",
    "vlokmiddel_nfc_tag_id": "Vlokmiddel bijgevuld",
}

POOL_LABELS = {"wellness": "Wellness", "zwembad": "Zwembad"}


class NfcScanRequest(BaseModel):
    tag_id: str
    ha_user_id: str | None = None


class NfcScanResponse(BaseModel):
    ok: bool
    message: str
    ticket_id: str | None = None
    template_title: str | None = None
    pool_log_id: str | None = None


async def _handle_chemical_scan(
    body: NfcScanRequest,
    db: AsyncSession,
) -> NfcScanResponse | None:
    """Probeer de NFC-tag te matchen tegen een chemicaliën-tag per bad.
    Retourneert een respons als de tag gematcht is, anders None."""
    result = await db.execute(
        select(PoolConfig).where(
            or_(
                PoolConfig.chloor_nfc_tag_id == body.tag_id,
                PoolConfig.zuur_nfc_tag_id == body.tag_id,
                PoolConfig.vlokmiddel_nfc_tag_id == body.tag_id,
            )
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        return None

    # Bepaal welke actie het is
    action_label: str | None = None
    for column, label in CHEMICAL_ACTIONS.items():
        if getattr(config, column) == body.tag_id:
            action_label = label
            break
    if action_label is None:
        return None

    # Bepaal wie de scan uitvoerde
    user: UserRole | None = None
    if body.ha_user_id:
        user = await db.get(UserRole, body.ha_user_id)
    gemeten_door = (user.display_name if user else None) or body.ha_user_id or "nfc"

    now = datetime.now(timezone.utc)
    pool_label = POOL_LABELS.get(config.pool_id, config.pool_id)

    log = PoolLog(
        id=new_uuid(),
        pool_id=PoolId(config.pool_id),
        datum=now.date().isoformat(),
        tijd=now.strftime("%H:%M"),
        chemicalien=action_label,
        gemeten_door=gemeten_door,
    )
    db.add(log)
    await db.flush()

    # Bedank-notificatie naar de scanner
    if user and user.ha_notify_service:
        await notify_push(
            user.ha_notify_service,
            title=f"✓ {action_label} — {pool_label}",
            message=f"Dankjewel {user.display_name}, dit is geregistreerd in het logboek.",
        )

    return NfcScanResponse(
        ok=True,
        message=f"{action_label} geregistreerd voor {pool_label}",
        pool_log_id=log.id,
    )


@router.post("/scan", response_model=NfcScanResponse)
async def nfc_scan(body: NfcScanRequest, db: AsyncSession = Depends(get_db)):
    """Verwerk een NFC-scan: sluit de openstaande taak en stuur een bevestiging."""

    # Eerst checken of het een zwembad-chemicaliën-tag is
    chemical_response = await _handle_chemical_scan(body, db)
    if chemical_response is not None:
        return chemical_response

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

    now = datetime.now(timezone.utc)

    if ticket:
        # Sluit de bestaande openstaande ticket
        ticket.status = Status.closed
        ticket.closed_at = now
        ticket.closed_by = body.ha_user_id or "nfc"
    else:
        # Geen openstaande ticket — maak er een aan en sluit hem direct
        # zodat er altijd een registratie is van de NFC-scan
        ticket = Ticket(
            id=new_uuid(),
            title=template.title,
            description="Afgevinkt via NFC-scan",
            category=template.category,
            priority=template.priority,
            location_id=template.location_id,
            created_by=body.ha_user_id or "nfc",
            assigned_to=body.ha_user_id,
            recurring_template_id=template.id,
            status=Status.closed,
            closed_at=now,
            closed_by=body.ha_user_id or "nfc",
        )
        db.add(ticket)

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
