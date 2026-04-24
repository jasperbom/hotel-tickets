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


def _filterspoeling_value(config: PoolConfig, tag_id: str) -> str | None:
    """Bepaal welke filterspoeling-waarde hoort bij deze tag. L/R voor zwembad, X voor wellness."""
    if config.filter_nfc_tag_id == tag_id:
        return "L" if config.pool_id == "zwembad" else "X"
    if config.filter_nfc_tag_id_r == tag_id:
        return "R"
    return None


async def _handle_pool_scan(
    body: NfcScanRequest,
    db: AsyncSession,
) -> NfcScanResponse | None:
    """Probeer de NFC-tag te matchen tegen een chemicaliën- of filter-tag per bad.
    Retourneert een respons als de tag gematcht is, anders None."""
    result = await db.execute(
        select(PoolConfig).where(
            or_(
                PoolConfig.chloor_nfc_tag_id == body.tag_id,
                PoolConfig.zuur_nfc_tag_id == body.tag_id,
                PoolConfig.vlokmiddel_nfc_tag_id == body.tag_id,
                PoolConfig.filter_nfc_tag_id == body.tag_id,
                PoolConfig.filter_nfc_tag_id_r == body.tag_id,
            )
        )
    )
    config = result.scalars().first()
    if not config:
        return None

    # Bepaal of het een chemicaliën- of filter-scan is
    chemicalien: str | None = None
    filterspoeling: str | None = None
    action_label: str | None = None

    for column, label in CHEMICAL_ACTIONS.items():
        if getattr(config, column) == body.tag_id:
            chemicalien = label
            action_label = label
            break

    if action_label is None:
        filterspoeling = _filterspoeling_value(config, body.tag_id)
        if filterspoeling is None:
            return None
        side = {"L": " links", "R": " rechts", "X": ""}.get(filterspoeling, "")
        action_label = f"Filterspoeling{side}"

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
        chemicalien=chemicalien,
        filterspoeling=filterspoeling,
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
    """Verwerk een NFC-scan: sluit de openstaande taak en stuur een bevestiging.

    Eén fysieke NFC-tag mag bewust aan meerdere dingen gekoppeld zijn (bv.
    dezelfde pooltag dient ook als afvink-tag voor een herhalende controle,
    of twee herhalende taken delen één tag). Deze handler verwerkt daarom
    álle matches in plaats van bij de eerste te stoppen.
    """

    # Zwembad-match (chemicaliën of filter) — registreert en geeft eigen push.
    # Geeft None terug als de tag geen pool-actie is.
    pool_response = await _handle_pool_scan(body, db)

    # Zoek ALLE sjablonen met dit NFC-tag. Meerdere templates kunnen dezelfde
    # tag delen; we sluiten ze allemaal af.
    result = await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.nfc_tag_id == body.tag_id)
    )
    templates = list(result.scalars().all())

    if not templates:
        if pool_response is not None:
            return pool_response
        raise HTTPException(status_code=404, detail=f"Geen taak gekoppeld aan NFC-tag '{body.tag_id}'")

    now = datetime.now(timezone.utc)
    closed_by = body.ha_user_id or "nfc"
    primary_ticket: Ticket | None = None
    closed_titles: list[str] = []

    for template in templates:
        # Zoek ALLE openstaande tickets van dit sjabloon — zelfde gedrag als de
        # "Afronden"-knop (zie routers/recurring.py::complete_template). Als er
        # meerdere cycli openstaan moeten ze allemaal gesloten worden, anders
        # blijft een oudere ticket achter als "verlopen".
        ticket_result = await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.recurring_template_id == template.id,
                    Ticket.status != Status.closed,
                )
            ).order_by(Ticket.created_at.desc())
        )
        open_tickets = list(ticket_result.scalars().all())

        if open_tickets:
            for t in open_tickets:
                t.status = Status.closed
                t.closed_at = now
                t.closed_by = closed_by
            ticket = open_tickets[0]
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
                created_by=closed_by,
                assigned_to=body.ha_user_id,
                recurring_template_id=template.id,
                status=Status.closed,
                closed_at=now,
                closed_by=closed_by,
            )
            db.add(ticket)

        closed_titles.append(template.title)
        if primary_ticket is None:
            primary_ticket = ticket

    await sync_ticket_sensors(db)

    # Eén gebundelde pushmelding voor alle afgeronde taken
    if body.ha_user_id and primary_ticket is not None:
        user = await db.get(UserRole, body.ha_user_id)
        if user and user.ha_notify_service:
            base_url = await get_ticket_base_url(db)
            ticket_url = f"{base_url}/#/tickets/{primary_ticket.id}"
            if len(closed_titles) == 1:
                push_title = "✓ Taak afgerond"
                push_message = f"{closed_titles[0]} is afgevinkt via NFC"
            else:
                push_title = f"✓ {len(closed_titles)} taken afgerond"
                push_message = ", ".join(closed_titles)
            await notify_push(
                user.ha_notify_service,
                title=push_title,
                message=push_message,
                data={"url": ticket_url},
            )

    if len(closed_titles) == 1:
        message = f"Taak '{closed_titles[0]}' afgerond"
        template_title = closed_titles[0]
    else:
        message = f"{len(closed_titles)} taken afgerond: {', '.join(closed_titles)}"
        template_title = ", ".join(closed_titles)

    return NfcScanResponse(
        ok=True,
        message=message,
        ticket_id=primary_ticket.id if primary_ticket else None,
        template_title=template_title,
    )
