import json
import os
import re
import uuid as uuid_mod
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, case, delete, func
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models import Ticket, TicketComment, TicketPin, TicketNotification, TicketEvent, TicketEventType, NotificationType, Category, Status, Priority, Role, UserRole, BikeReservation, RecurringTemplate
from ..auth import RequireUser, CurrentUser
from ..services.notifications import notify_ticket_assigned, notify_urgent_ticket, notify_new_department_ticket, notify_mention
from ..services.ha_entities import sync_ticket_sensors
from ..services.ha_client import get_areas
from ..scheduler import mark_template_completed
from .settings import get_ticket_base_url

import logging
logger = logging.getLogger(__name__)

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads"))
MAX_PHOTO_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

router = APIRouter(prefix="/tickets", tags=["tickets"])


# --- Pydantic schemas ---

class TicketCreate(BaseModel):
    title: str
    description: str | None = None
    category: Category
    priority: Priority = Priority.medium
    location_id: str | None = None
    assigned_to: str | None = None
    creator_name: str | None = None  # display-naam bij aanmaken via card/service
    subtask_labels: list[str] | None = None  # optionele subtaken bij aanmaken


class TicketUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    location_id: str | None = None
    assigned_to: str | None = None
    notify_when_free: bool | None = None


class CommentCreate(BaseModel):
    body: str


class SubtaskUpdate(BaseModel):
    index: int
    done: bool


class SubtaskAdd(BaseModel):
    label: str


class TicketOut(BaseModel):
    id: str
    title: str
    description: str | None
    category: Category
    status: Status
    priority: Priority
    location_id: str | None
    created_by: str
    assigned_to: str | None
    recurring_template_id: str | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    closed_by: str | None
    notify_when_free: bool
    subtasks: list | None = None
    photos: list[str] | None = None
    pinned: bool = False

    model_config = {"from_attributes": True}

    @field_validator("subtasks", mode="before")
    @classmethod
    def parse_subtasks(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v

    @field_validator("photos", mode="before")
    @classmethod
    def parse_photos(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


class CommentUpdate(BaseModel):
    body: str


class CommentOut(BaseModel):
    id: str
    ticket_id: str
    author_id: str
    body: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class TicketEventOut(BaseModel):
    id: str
    ticket_id: str
    actor_id: str
    type: TicketEventType
    from_value: str | None
    to_value: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Helpers ---


def _log_event(
    db: AsyncSession,
    ticket_id: str,
    actor_id: str,
    type: TicketEventType,
    from_value: str | None = None,
    to_value: str | None = None,
) -> None:
    """Leg een gebeurtenis vast. Append-only: nooit bijwerken of verwijderen."""
    db.add(TicketEvent(
        ticket_id=ticket_id,
        actor_id=actor_id or "system",
        type=type,
        from_value=from_value,
        to_value=to_value,
    ))


def _require_edit_access(user: CurrentUser, ticket: Ticket) -> None:
    """Iedereen mag alle tickets zien, maar wijzigen (status, claimen,
    subtaken afvinken, velden aanpassen) is voorbehouden aan de eigen
    afdeling, de toegewezene, de aanmaker en admins/supervisors.
    Commentaar en foto's blijven voor iedereen open."""
    if user.is_admin:
        return
    if ticket.assigned_to == user.ha_user_id or ticket.created_by == user.ha_user_id:
        return
    if user.department and ticket.category == user.department:
        return
    raise HTTPException(
        status_code=403,
        detail="Tickets van een andere afdeling kun je niet wijzigen — commentaar toevoegen kan wel",
    )


def _extract_mentions(body: str, users: list[UserRole]) -> set[str]:
    """Vind @-mentions in een commentaar. Namen worden op lengte gematcht
    (langste eerst) zodat '@Jan Willem' niet ook als '@Jan' telt, en een
    mention telt alleen als de naam niet doorloopt in ander tekst."""
    mentioned: set[str] = set()
    taken_spans: list[tuple[int, int]] = []
    for u in sorted(users, key=lambda u: -len(u.display_name or "")):
        name = (u.display_name or "").strip()
        if not name:
            continue
        for m in re.finditer(r"@" + re.escape(name), body, re.IGNORECASE):
            span = (m.start(), m.end())
            if any(s < span[1] and span[0] < e for s, e in taken_spans):
                continue
            if span[1] < len(body) and body[span[1]].isalnum():
                continue
            taken_spans.append(span)
            mentioned.add(u.ha_user_id)
    return mentioned


async def _notify_comment(
    db: AsyncSession,
    ticket: Ticket,
    comment: TicketComment,
    author: CurrentUser,
    skip_recipients: set[str] | None = None,
    notify_assignee: bool = True,
) -> None:
    """Maak in-app berichten (envelopje) voor een nieuw of bewerkt commentaar:
    - iedereen die met @ genoemd wordt (+ push indien ingesteld)
    - de toegewezene van het ticket (alleen bij nieuw commentaar)
    """
    users_result = await db.execute(select(UserRole))
    all_users = users_result.scalars().all()
    mentioned_ids = _extract_mentions(comment.body, all_users)
    mentioned_ids.discard(comment.author_id)
    skip = skip_recipients or set()

    users_by_id = {u.ha_user_id: u for u in all_users}
    base_url = await get_ticket_base_url(db)
    ticket_url = f"{base_url}/#/tickets/{ticket.id}"

    for uid in mentioned_ids:
        if uid in skip:
            continue
        db.add(TicketNotification(
            recipient_id=uid,
            actor_id=comment.author_id,
            ticket_id=ticket.id,
            comment_id=comment.id,
            type=NotificationType.mention,
        ))
        recipient = users_by_id.get(uid)
        # Het in-app envelopje (hierboven) blijft altijd bestaan; alleen de
        # pushmelding is uit te zetten via notify_mention (standaard aan).
        if recipient and recipient.notify_mention and recipient.notify_push and recipient.ha_notify_service:
            await notify_mention(author.display_name, ticket.title, recipient.ha_notify_service, ticket_url)

    # Toegewezene krijgt een bericht bij elk nieuw commentaar op zijn ticket
    # (tenzij hij zelf schrijft of al via een mention genoemd is).
    assignee = ticket.assigned_to
    if (
        notify_assignee
        and assignee
        and assignee != comment.author_id
        and assignee not in mentioned_ids
        and assignee not in skip
    ):
        db.add(TicketNotification(
            recipient_id=assignee,
            actor_id=comment.author_id,
            ticket_id=ticket.id,
            comment_id=comment.id,
            type=NotificationType.comment,
        ))


# --- Endpoints ---

@router.get("/", response_model=list[TicketOut])
async def list_tickets(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    category: Category | None = Query(None),
    status_param: str | None = Query(None, alias="status"),
    priority: Priority | None = Query(None),
    assigned_to: str | None = Query(None),
    location_id: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    filters = []
    if category:
        filters.append(Ticket.category == category)
    if q and q.strip():
        # Zoeken op titel, omschrijving én kamernaam. De kamernaam staat in HA
        # (areas), niet in de database: we vertalen de zoekterm eerst naar de
        # bijbehorende area-id's en zoeken daar op location_id.
        term = f"%{q.strip()}%"
        zoek = [Ticket.title.ilike(term), Ticket.description.ilike(term)]
        try:
            areas = await get_areas()
            area_ids = [
                a["id"] for a in areas
                if q.strip().lower() in (a.get("name") or "").lower()
            ]
            if area_ids:
                zoek.append(Ticket.location_id.in_(area_ids))
        except Exception as exc:  # HA niet bereikbaar — dan zonder kamernamen
            logger.debug("Zoeken op kamernaam overgeslagen: %s", exc)
        filters.append(or_(*zoek))
    if status_param:
        status_values = [s.strip() for s in status_param.split(",") if s.strip()]
        valid = [s for s in status_values if s in (e.value for e in Status)]
        if len(valid) == 1:
            filters.append(Ticket.status == valid[0])
        elif len(valid) > 1:
            filters.append(Ticket.status.in_(valid))
    if priority:
        filters.append(Ticket.priority == priority)
    if assigned_to:
        if assigned_to == "me":
            filters.append(Ticket.assigned_to == user.ha_user_id)
        else:
            filters.append(Ticket.assigned_to == assigned_to)
    if location_id:
        filters.append(Ticket.location_id == location_id)

    # Bepaal sortering: bij filter op uitsluitend 'closed' sorteren we puur op sluitingsdatum.
    only_closed = (
        status_param is not None
        and all(s.strip() == "closed" for s in status_param.split(",") if s.strip())
    )

    stmt = select(Ticket)
    if filters:
        stmt = stmt.where(and_(*filters))
    if only_closed:
        stmt = (
            stmt
            .order_by(Ticket.closed_at.desc().nulls_last(), Ticket.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    else:
        priority_sort = case(
            (Ticket.priority == "urgent", 0),
            (Ticket.priority == "high", 1),
            (Ticket.priority == "medium", 2),
            (Ticket.priority == "low", 3),
            else_=4,
        )
        stmt = (
            stmt
            .order_by(priority_sort, Ticket.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    result = await db.execute(stmt)
    tickets = result.scalars().all()

    # Pinned-vlag per ticket bepalen voor huidige gebruiker
    pinned_ids: set[str] = set()
    if tickets:
        pin_result = await db.execute(
            select(TicketPin.ticket_id).where(
                and_(
                    TicketPin.ha_user_id == user.ha_user_id,
                    TicketPin.ticket_id.in_([t.id for t in tickets]),
                )
            )
        )
        pinned_ids = {row[0] for row in pin_result.all()}

    out: list[TicketOut] = []
    for t in tickets:
        item = TicketOut.model_validate(t)
        item.pinned = t.id in pinned_ids
        out.append(item)
    return out


@router.get("/counts")
async def ticket_counts(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    category: Category | None = Query(None),
    priority: Priority | None = Query(None),
    assigned_to: str | None = Query(None),
    location_id: str | None = Query(None),
):
    """Aantal tickets per status binnen de overige filters — voor de tellers
    op de statusknoppen in de ticketlijst."""
    filters = []
    if category:
        filters.append(Ticket.category == category)
    if priority:
        filters.append(Ticket.priority == priority)
    if assigned_to:
        if assigned_to == "me":
            filters.append(Ticket.assigned_to == user.ha_user_id)
        else:
            filters.append(Ticket.assigned_to == assigned_to)
    if location_id:
        filters.append(Ticket.location_id == location_id)

    stmt = select(Ticket.status, func.count()).group_by(Ticket.status)
    if filters:
        stmt = stmt.where(and_(*filters))
    result = await db.execute(stmt)

    counts: dict[str, int] = {s.value: 0 for s in Status}
    for status_value, count in result.all():
        key = status_value.value if hasattr(status_value, "value") else status_value
        counts[key] = count
    return counts


@router.post("/", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: TicketCreate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    logger.info("[tickets] Ticket aanmaken: title=%r category=%s door user=%s", body.title, body.category, user.ha_user_id)
    subtasks_json = None
    if body.subtask_labels:
        subtasks_json = json.dumps([
            {"label": l, "done": False, "done_by": None, "done_at": None}
            for l in body.subtask_labels
        ])
    ticket = Ticket(
        title=body.title,
        description=body.description,
        category=body.category,
        priority=body.priority,
        location_id=body.location_id,
        assigned_to=body.assigned_to,
        created_by=body.creator_name if body.creator_name else user.ha_user_id,
        subtasks=subtasks_json,
    )
    db.add(ticket)
    await db.flush()

    _log_event(db, ticket.id, ticket.created_by, TicketEventType.created)
    if body.assigned_to:
        _log_event(db, ticket.id, user.ha_user_id, TicketEventType.assigned, None, body.assigned_to)

    # Notificaties
    base_url = await get_ticket_base_url(db)
    ticket_url = f"{base_url}/#/tickets/{ticket.id}"
    if body.assigned_to:
        assignee = await db.get(UserRole, body.assigned_to)
        if assignee:
            await notify_ticket_assigned(ticket.title, assignee.ha_notify_service, assignee.email, ticket_url)
    if ticket.priority == Priority.urgent:
        admins_result = await db.execute(
            select(UserRole).where(
                and_(UserRole.role == Role.admin, UserRole.notify_push == True, UserRole.ha_notify_service.isnot(None))
            )
        )
        admin_services = [u.ha_notify_service for u in admins_result.scalars().all() if u.ha_notify_service]
        if admin_services:
            await notify_urgent_ticket(ticket.title, admin_services, ticket_url)

    # Push naar iedereen in dezelfde afdeling die opt-in heeft gegeven —
    # rang (admin/supervisor/employee) speelt geen rol meer: een admin die
    # voor de TD werkt krijgt nu óók de pushes van zijn eigen afdeling.
    # Als er een device_tracker is gekoppeld wordt alleen gepusht wanneer de
    # tracker in een HA-zone zit (= meestal: op het hotel-wifi).
    dept_result = await db.execute(
        select(UserRole).where(
            and_(
                UserRole.department == ticket.category,
                UserRole.notify_new_ticket == True,
                UserRole.notify_push == True,
                UserRole.ha_notify_service.isnot(None),
            )
        )
    )
    dept_candidates = dept_result.scalars().all()
    creator_id = ticket.created_by
    recipients = [
        {"service": u.ha_notify_service, "device_tracker": u.ha_device_tracker}
        for u in dept_candidates
        # Skip de aanmaker en de directe toegewezene — die krijgen geen dubbele push.
        if u.ha_user_id != creator_id and u.ha_user_id != ticket.assigned_to
    ]
    logger.info(
        "[notif] dept-push %s: %d kandidaten (notify_new_ticket+push aan, "
        "afdeling=%s), %d na uitsluiten aanmaker/toegewezene",
        ticket.id, len(dept_candidates), ticket.category.value, len(recipients),
    )
    if dept_candidates and not recipients:
        logger.info(
            "[notif] alle kandidaten uitgesloten (aanmaker=%s, toegewezene=%s); "
            "kandidaat-ids=%s",
            creator_id, ticket.assigned_to,
            [u.ha_user_id for u in dept_candidates],
        )
    if not dept_candidates:
        # Diagnose: laat zien WAAROM er niemand door de filter komt. Pak alle
        # opt-in-medewerkers (los van afdeling/role) en log welke filter ze
        # laat afvallen.
        diag_result = await db.execute(
            select(UserRole).where(UserRole.notify_new_ticket == True)
        )
        diag_users = diag_result.scalars().all()
        if not diag_users:
            logger.info(
                "[notif] diag: geen enkele medewerker heeft notify_new_ticket aan"
            )
        for u in diag_users:
            reasons = []
            if u.department != ticket.category:
                dept_val = u.department.value if u.department else None
                reasons.append(f"afdeling={dept_val!r} ≠ {ticket.category.value!r}")
            if not u.notify_push:
                reasons.append("notify_push=False")
            if not u.ha_notify_service:
                reasons.append("ha_notify_service leeg")
            logger.info(
                "[notif] diag: user=%s display=%r → %s",
                u.ha_user_id, u.display_name,
                ", ".join(reasons) if reasons else "zou moeten matchen (?!)",
            )
    if recipients:
        category_label = {
            "technical": "TD", "housekeeping": "Huishouding", "reception": "Receptie",
            "service": "Bediening", "kitchen": "Keuken", "sales": "Sales", "garden": "Tuin",
        }.get(ticket.category.value, ticket.category.value)
        await notify_new_department_ticket(ticket.title, category_label, recipients, ticket_url)

    await sync_ticket_sensors(db)
    return ticket


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    item = TicketOut.model_validate(ticket)
    pin = await db.get(TicketPin, (user.ha_user_id, ticket_id))
    item.pinned = pin is not None
    return item


class ReorderRequest(BaseModel):
    ticket_ids: list[str]


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tickets(body: ReorderRequest, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Update sort_order voor een lijst tickets van de huidige gebruiker.

    De volgorde in `ticket_ids` bepaalt de nieuwe sort_order. We gebruiken
    negatieve waarden (positie 0 → -N, ... positie N-1 → -1) zodat nieuwe
    tickets met de standaardwaarde 0 onderaan hun prioriteitsgroep verschijnen.
    """
    if not body.ticket_ids:
        return
    result = await db.execute(
        select(Ticket).where(
            Ticket.id.in_(body.ticket_ids),
            Ticket.assigned_to == user.ha_user_id,
        )
    )
    tickets_by_id = {t.id: t for t in result.scalars().all()}
    n = len(body.ticket_ids)
    for idx, ticket_id in enumerate(body.ticket_ids):
        t = tickets_by_id.get(ticket_id)
        if t is not None:
            t.sort_order = idx - n


@router.post("/{ticket_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def pin_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Pin een ticket bovenaan in 'Mijn openstaande tickets' voor de huidige gebruiker."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    existing = await db.get(TicketPin, (user.ha_user_id, ticket_id))
    if existing:
        return
    db.add(TicketPin(ha_user_id=user.ha_user_id, ticket_id=ticket_id))


@router.delete("/{ticket_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def unpin_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Verwijder de persoonlijke pin van een ticket."""
    pin = await db.get(TicketPin, (user.ha_user_id, ticket_id))
    if pin:
        await db.delete(pin)


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    body: TicketUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    _require_edit_access(user, ticket)

    old_assigned = ticket.assigned_to
    old_priority = ticket.priority
    old_status = ticket.status

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(ticket, field, value)

    # Wat er veranderde vastleggen — dit is het stuk dat tot nu toe nergens
    # stond en dat bij escalaties altijd als eerste gevraagd wordt.
    if "assigned_to" in body.model_fields_set and body.assigned_to != old_assigned:
        if body.assigned_to:
            _log_event(db, ticket.id, user.ha_user_id, TicketEventType.assigned, old_assigned, body.assigned_to)
        else:
            _log_event(db, ticket.id, user.ha_user_id, TicketEventType.unassigned, old_assigned, None)
    if body.priority is not None and body.priority != old_priority:
        _log_event(db, ticket.id, user.ha_user_id, TicketEventType.priority,
                   old_priority.value if old_priority else None, body.priority.value)
    if body.status is not None and body.status != old_status:
        if body.status == Status.closed:
            _log_event(db, ticket.id, user.ha_user_id, TicketEventType.closed)
        elif old_status == Status.closed:
            _log_event(db, ticket.id, user.ha_user_id, TicketEventType.reopened)

    if body.status == Status.closed and not ticket.closed_at:
        ticket.closed_at = datetime.now(timezone.utc)
        ticket.closed_by = user.ha_user_id
        # Recurring template: volgende uitvoering plannen zodat de taak pas
        # weer opduikt op de dag dat hij echt moet gebeuren.
        if ticket.recurring_template_id:
            template = await db.get(RecurringTemplate, ticket.recurring_template_id)
            await mark_template_completed(template, db, closed_at=ticket.closed_at)
        # Sync: als dit een sleutelticket is, registreer sleutelterugave op de reservering
        res_result = await db.execute(select(BikeReservation).where(BikeReservation.key_ticket_id == ticket_id))
        linked_res = res_result.scalar_one_or_none()
        if linked_res and not linked_res.key_returned_at:
            linked_res.key_returned_at = datetime.now(timezone.utc)
    elif body.status and body.status != Status.closed:
        ticket.closed_at = None
        ticket.closed_by = None
        # Sync: heropen → sleutelterugave wissen
        res_result = await db.execute(select(BikeReservation).where(BikeReservation.key_ticket_id == ticket_id))
        linked_res = res_result.scalar_one_or_none()
        if linked_res and linked_res.key_returned_at:
            linked_res.key_returned_at = None

    ticket.updated_at = datetime.now(timezone.utc)

    # Notificeer bij nieuwe toewijzing
    if body.assigned_to and body.assigned_to != old_assigned:
        assignee = await db.get(UserRole, body.assigned_to)
        if assignee:
            base_url = await get_ticket_base_url(db)
            ticket_url = f"{base_url}/#/tickets/{ticket.id}"
            await notify_ticket_assigned(ticket.title, assignee.ha_notify_service, assignee.email, ticket_url)

    await sync_ticket_sensors(db)
    return ticket


@router.get("/{ticket_id}/events", response_model=list[TicketEventOut])
async def list_ticket_events(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Het verloop van een ticket: wie deed wat, en wanneer."""
    result = await db.execute(
        select(TicketEvent).where(TicketEvent.ticket_id == ticket_id).order_by(TicketEvent.created_at)
    )
    return result.scalars().all()


@router.post("/{ticket_id}/claim", response_model=TicketOut)
async def claim_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Medewerker pakt een onbehandeld ticket zelf op."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    _require_edit_access(user, ticket)
    if ticket.assigned_to:
        raise HTTPException(status_code=409, detail="Ticket al toegewezen")
    ticket.assigned_to = user.ha_user_id
    ticket.status = Status.in_progress
    ticket.updated_at = datetime.now(timezone.utc)
    _log_event(db, ticket.id, user.ha_user_id, TicketEventType.assigned, None, user.ha_user_id)
    return ticket


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen tickets verwijderen")
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    await db.execute(delete(TicketNotification).where(TicketNotification.ticket_id == ticket_id))
    await db.execute(delete(TicketEvent).where(TicketEvent.ticket_id == ticket_id))
    await db.delete(ticket)
    await sync_ticket_sensors(db)


# --- Subtaken ---

@router.post("/{ticket_id}/subtasks")
async def add_subtask(
    ticket_id: str,
    body: SubtaskAdd,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Voeg een nieuwe subtaak toe aan een bestaand ticket."""
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Subtaak mag niet leeg zijn")

    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    _require_edit_access(user, ticket)
    if ticket.status == Status.closed:
        raise HTTPException(status_code=400, detail="Subtaken kunnen niet toegevoegd worden aan een gesloten ticket")

    try:
        subtasks = json.loads(ticket.subtasks) if ticket.subtasks else []
    except Exception:
        subtasks = []

    subtasks.append({"label": label, "done": False, "done_by": None, "done_at": None})
    ticket.subtasks = json.dumps(subtasks)
    ticket.updated_at = datetime.now(timezone.utc)
    return {"ok": True, "subtasks": subtasks}


@router.patch("/{ticket_id}/subtasks")
async def update_subtask(
    ticket_id: str,
    body: SubtaskUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Markeer een subtaak als gedaan of ongedaan."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    _require_edit_access(user, ticket)
    if not ticket.subtasks:
        raise HTTPException(status_code=400, detail="Ticket heeft geen subtaken")

    try:
        subtasks = json.loads(ticket.subtasks)
    except Exception:
        raise HTTPException(status_code=400, detail="Subtaken data ongeldig")

    if body.index < 0 or body.index >= len(subtasks):
        raise HTTPException(status_code=400, detail="Ongeldige subtaak index")

    subtasks[body.index]["done"] = body.done
    if body.done:
        subtasks[body.index]["done_by"] = user.ha_user_id
        subtasks[body.index]["done_at"] = datetime.now(timezone.utc).isoformat()
    else:
        subtasks[body.index]["done_by"] = None
        subtasks[body.index]["done_at"] = None

    ticket.subtasks = json.dumps(subtasks)
    ticket.updated_at = datetime.now(timezone.utc)
    return {"ok": True, "subtasks": subtasks}


# --- Commentaar ---

@router.get("/{ticket_id}/comments", response_model=list[CommentOut])
async def list_comments(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at)
    )
    return result.scalars().all()


@router.post("/{ticket_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(
    ticket_id: str,
    body: CommentCreate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    comment = TicketComment(ticket_id=ticket_id, author_id=user.ha_user_id, body=body.body)
    db.add(comment)
    await db.flush()
    await _notify_comment(db, ticket, comment, user)
    return comment


@router.patch("/{ticket_id}/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    ticket_id: str,
    comment_id: str,
    body: CommentUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    comment = await db.get(TicketComment, comment_id)
    if not comment or comment.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="Commentaar niet gevonden")
    if comment.author_id != user.ha_user_id:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen commentaar bewerken")
    comment.body = body.body
    comment.updated_at = datetime.now(timezone.utc)
    await db.flush()
    # Nieuw toegevoegde @-mentions alsnog melden, zonder dubbele berichten
    # voor wie al een bericht over dit commentaar kreeg.
    ticket = await db.get(Ticket, ticket_id)
    if ticket:
        existing_result = await db.execute(
            select(TicketNotification.recipient_id).where(TicketNotification.comment_id == comment_id)
        )
        already_notified = {row[0] for row in existing_result.all()}
        await _notify_comment(db, ticket, comment, user, skip_recipients=already_notified, notify_assignee=False)
    return comment


@router.delete("/{ticket_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    ticket_id: str,
    comment_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    comment = await db.get(TicketComment, comment_id)
    if not comment or comment.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="Commentaar niet gevonden")
    if comment.author_id != user.ha_user_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen commentaar verwijderen")
    await db.execute(delete(TicketNotification).where(TicketNotification.comment_id == comment_id))
    await db.delete(comment)


# --- Foto's ---

@router.post("/{ticket_id}/photos")
async def upload_photo(
    ticket_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
):
    """Upload een foto bij een ticket."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen (JPEG, PNG, WebP, GIF) zijn toegestaan")

    content = await file.read()
    if len(content) > MAX_PHOTO_SIZE:
        raise HTTPException(status_code=400, detail="Bestand te groot (max 10 MB)")

    ticket_dir = os.path.join(UPLOAD_DIR, ticket_id)
    os.makedirs(ticket_dir, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "jpg"
    filename = f"{uuid_mod.uuid4().hex}.{ext}"
    filepath = os.path.join(ticket_dir, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    # Update photos JSON in DB voor overzicht-emoji
    photos = json.loads(ticket.photos) if ticket.photos else []
    photos.append(filename)
    ticket.photos = json.dumps(photos)
    ticket.updated_at = datetime.now(timezone.utc)

    return {"filename": filename, "size": len(content), "content_type": file.content_type}


@router.get("/{ticket_id}/photos")
async def list_photos(
    ticket_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Lijst alle foto's bij een ticket."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")

    ticket_dir = os.path.join(UPLOAD_DIR, ticket_id)
    if not os.path.isdir(ticket_dir):
        return []

    photos = []
    for fname in sorted(os.listdir(ticket_dir)):
        if fname.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
            photos.append({"filename": fname})
    return photos


@router.get("/{ticket_id}/photos/{filename}")
async def get_photo(
    ticket_id: str,
    filename: str,
    user: RequireUser,
):
    """Serveer een specifieke foto."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ongeldige bestandsnaam")
    filepath = os.path.join(UPLOAD_DIR, ticket_id, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Foto niet gevonden")
    return FileResponse(filepath)


@router.delete("/{ticket_id}/photos/{filename}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    ticket_id: str,
    filename: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Verwijder een foto."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ongeldige bestandsnaam")
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    filepath = os.path.join(UPLOAD_DIR, ticket_id, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Foto niet gevonden")
    os.remove(filepath)

    # Update photos JSON in DB
    photos = json.loads(ticket.photos) if ticket.photos else []
    photos = [p for p in photos if p != filename]
    ticket.photos = json.dumps(photos) if photos else None
    ticket.updated_at = datetime.now(timezone.utc)
