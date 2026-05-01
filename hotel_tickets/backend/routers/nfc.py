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


# Mapping NFC-tag-kolom → het bijbehorende sjabloon-koppelingsveld op PoolConfig
POOL_TEMPLATE_FIELD = {
    "chloor_nfc_tag_id": "chloor_template_id",
    "zuur_nfc_tag_id": "zuur_template_id",
    "vlokmiddel_nfc_tag_id": "vlokmiddel_template_id",
    "filter_nfc_tag_id": "filter_template_id",
    "filter_nfc_tag_id_r": "filter_template_id_r",
}


async def _get_pool_linked_template_id(tag_id: str, db: AsyncSession) -> str | None:
    """Zoekt of deze NFC-tag in een pool-config staat en geeft het gekoppelde
    herhalend-sjabloon-id terug (None als de tag niet bekend is of geen koppeling
    geconfigureerd is). Hiermee sluit een NFC-scan ook automatisch de gekoppelde
    herhalende taak af zonder dat de tag-ID dubbel ingevoerd hoeft te worden."""
    result = await db.execute(
        select(PoolConfig).where(
            or_(
                PoolConfig.chloor_nfc_tag_id == tag_id,
                PoolConfig.zuur_nfc_tag_id == tag_id,
                PoolConfig.vlokmiddel_nfc_tag_id == tag_id,
                PoolConfig.filter_nfc_tag_id == tag_id,
                PoolConfig.filter_nfc_tag_id_r == tag_id,
            )
        )
    )
    config = result.scalars().first()
    if not config:
        return None
    for tag_column, template_column in POOL_TEMPLATE_FIELD.items():
        if getattr(config, tag_column) == tag_id:
            return getattr(config, template_column)
    return None


async def _handle_pool_scan(
    body: NfcScanRequest,
    db: AsyncSession,
    send_notification: bool = True,
) -> NfcScanResponse | None:
    """Probeer de NFC-tag te matchen tegen een chemicaliën- of filter-tag per bad.
    Retourneert een respons als de tag gematcht is, anders None.

    Als ``send_notification`` False is wordt de bedank-push overgeslagen —
    gebruikt wanneer dezelfde tag ook een herhalende taak afrondt en de
    taken-push dus volstaat.
    """
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

    # Bedank-notificatie naar de scanner (overgeslagen als de taken-push al
    # wordt verstuurd voor dezelfde scan)
    if send_notification and user and user.ha_notify_service:
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

    # Zoek ALLE sjablonen met dit NFC-tag. Meerdere templates kunnen dezelfde
    # tag delen; we sluiten ze allemaal af.
    result = await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.nfc_tag_id == body.tag_id)
    )
    templates = list(result.scalars().all())
    template_ids_seen = {t.id for t in templates}

    # Pool-koppeling: als deze tag in een pool-config staat én er een sjabloon
    # aan gehangen is, voeg die toe aan de af te ronden sjablonen. Zo hoeft de
    # tag-ID niet ook nog handmatig op het sjabloon ingevoerd te worden.
    pool_template_id = await _get_pool_linked_template_id(body.tag_id, db)
    if pool_template_id and pool_template_id not in template_ids_seen:
        linked = await db.get(RecurringTemplate, pool_template_id)
        if linked is not None:
            templates.append(linked)
            template_ids_seen.add(linked.id)

    # Zwembad-match: registreert pool-log en geeft eigen bedank-push. Bij
    # dezelfde tag ook een taak: push onderdrukken zodat er maar één melding
    # naar de scanner gaat (de taken-push).
    pool_response = await _handle_pool_scan(
        body, db, send_notification=not templates
    )

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

    # Eén taken-push naar de scanner (de taak is conceptueel dezelfde, ook
    # als hij in meerdere templates voorkomt voor bv. log-registratie).
    primary_title = closed_titles[0]
    if body.ha_user_id and primary_ticket is not None:
        user = await db.get(UserRole, body.ha_user_id)
        if user and user.ha_notify_service:
            base_url = await get_ticket_base_url(db)
            ticket_url = f"{base_url}/#/tickets/{primary_ticket.id}"
            await notify_push(
                user.ha_notify_service,
                title="✓ Taak afgerond",
                message=f"{primary_title} is afgevinkt via NFC",
                data={"url": ticket_url},
            )

    return NfcScanResponse(
        ok=True,
        message=f"Taak '{primary_title}' afgerond",
        ticket_id=primary_ticket.id if primary_ticket else None,
        template_title=primary_title,
    )
