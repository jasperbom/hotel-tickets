import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from pydantic import BaseModel
from croniter import croniter

from ..database import get_db
from ..models import RecurringTemplate, Category, Priority, Ticket, Status, PoolConfig, new_uuid
from ..auth import RequireUser
from ..services.ha_entities import sync_ticket_sensors
from ..scheduler import mark_template_completed, calc_next_due_after_completion
from .logbook import schrijf_registratie_bij_afronden

router = APIRouter(prefix="/recurring", tags=["recurring"])


class TemplateCreate(BaseModel):
    title: str
    description: str | None = None
    category: Category
    priority: Priority = Priority.medium
    location_id: str | None = None
    assign_to: str | None = None
    cron_expression: str
    advance_days: int = 0
    interval_days: int | None = None
    is_active: bool = True
    nfc_tag_id: str | None = None
    # Controleschema: hoort dit sjabloon bij een logboekobject?
    object_id: str | None = None
    subtask_mode: str = "none"  # none | subtasks | rooms
    subtask_items: list[str] | None = None
    notify_when_free: bool = False
    emoji: str | None = None
    folder: str | None = None


class TemplateUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    location_id: str | None = None
    assign_to: str | None = None
    cron_expression: str | None = None
    advance_days: int | None = None
    interval_days: int | None = None
    is_active: bool | None = None
    nfc_tag_id: str | None = None
    object_id: str | None = None
    subtask_mode: str | None = None
    subtask_items: list[str] | None = None
    notify_when_free: bool | None = None
    emoji: str | None = None
    folder: str | None = None


class TemplateOut(BaseModel):
    id: str
    title: str
    description: str | None
    category: Category
    priority: Priority
    location_id: str | None
    assign_to: str | None
    cron_expression: str
    advance_days: int
    interval_days: int | None
    is_active: bool
    nfc_tag_id: str | None
    object_id: str | None = None
    subtask_mode: str
    subtask_items: list[str] | None
    notify_when_free: bool
    emoji: str | None
    folder: str | None
    next_run: str | None = None
    next_due_at: str | None = None

    model_config = {"from_attributes": True}


class HistoryOut(BaseModel):
    id: str
    title: str
    closed_at: str | None
    closed_by: str | None
    created_at: str

    model_config = {"from_attributes": True}


def _validate_cron(expr: str) -> None:
    if not croniter.is_valid(expr):
        raise HTTPException(status_code=422, detail=f"Ongeldige cron expressie: {expr}")


def _can_manage(user, category: Category) -> bool:
    """Sjablonen beheren/afronden mag als admin/supervisor, of als medewerker
    voor de eigen afdeling."""
    return user.is_admin or category in user.departments


def _require_manage(user, category: Category, action: str) -> None:
    if not _can_manage(user, category):
        raise HTTPException(
            status_code=403,
            detail=f"Je kunt alleen taken van je eigen afdeling {action}",
        )


def _calc_next_run(cron_expression: str) -> str | None:
    try:
        now = datetime.now()
        cron = croniter(cron_expression, now)
        return cron.get_next(datetime).isoformat()
    except Exception:
        return None


def _template_with_next_run(template: RecurringTemplate) -> dict:
    subtask_items = None
    if template.subtask_items:
        try:
            subtask_items = json.loads(template.subtask_items)
        except Exception:
            subtask_items = []
    # Interval-modus: 'next_run' komt uit next_due_at. Cron-modus: bereken
    # vanuit de cron, maar pak next_due_at als die later valt (bv. omdat de
    # taak vroeger via NFC is afgevinkt).
    if template.interval_days and template.next_due_at:
        next_run_str = template.next_due_at.isoformat()
    else:
        next_run_str = _calc_next_run(template.cron_expression)
        if template.next_due_at and next_run_str:
            try:
                cron_next = datetime.fromisoformat(next_run_str)
                if template.next_due_at.replace(tzinfo=None) > cron_next.replace(tzinfo=None):
                    next_run_str = template.next_due_at.isoformat()
            except Exception:
                pass
    return {
        "id": template.id,
        "title": template.title,
        "description": template.description,
        "category": template.category,
        "priority": template.priority,
        "location_id": template.location_id,
        "assign_to": template.assign_to,
        "cron_expression": template.cron_expression,
        "advance_days": template.advance_days,
        "interval_days": template.interval_days,
        "is_active": template.is_active,
        "nfc_tag_id": template.nfc_tag_id,
        "object_id": template.object_id,
        "subtask_mode": template.subtask_mode or "none",
        "subtask_items": subtask_items,
        "notify_when_free": template.notify_when_free,
        "emoji": template.emoji,
        "folder": template.folder,
        "next_run": next_run_str,
        "next_due_at": template.next_due_at.isoformat() if template.next_due_at else None,
    }


@router.get("/", response_model=list[TemplateOut])
async def list_templates(user: RequireUser, db: AsyncSession = Depends(get_db)):
    # Iedereen ziet alle sjablonen (net als tickets); beheren blijft beperkt
    # tot eigen afdeling of admin/supervisor.
    result = await db.execute(select(RecurringTemplate).order_by(RecurringTemplate.title))
    templates = result.scalars().all()
    return [_template_with_next_run(t) for t in templates]


@router.post("/", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_manage(user, body.category, "aanmaken")
    _validate_cron(body.cron_expression)
    data = body.model_dump()
    data["subtask_items"] = json.dumps(data["subtask_items"]) if data.get("subtask_items") else None
    template = RecurringTemplate(**data)
    # Voor interval-sjablonen meteen een eerste next_due_at zetten: nu + interval.
    # Zo verschijnt het eerste ticket pas na één volledige cyclus (gebruiker kan
    # 'Start nu' gebruiken om er direct eentje aan te maken).
    if template.interval_days and template.interval_days > 0:
        template.next_due_at = datetime.now(timezone.utc) + timedelta(days=template.interval_days)
    db.add(template)
    await db.flush()

    from ..scheduler import schedule_template
    await schedule_template(template)

    return _template_with_next_run(template)


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    return _template_with_next_run(template)


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    _require_manage(user, template.category, "bewerken")
    if body.category is not None:
        # Verplaatsen naar een andere afdeling vereist ook beheer op die afdeling
        _require_manage(user, body.category, "bewerken")

    if body.cron_expression:
        _validate_cron(body.cron_expression)

    old_interval = template.interval_days
    updates = body.model_dump(exclude_none=True)
    if "subtask_items" in updates:
        updates["subtask_items"] = json.dumps(updates["subtask_items"]) if updates["subtask_items"] else None
    for field, value in updates.items():
        setattr(template, field, value)

    # Interval-instelling gewijzigd → next_due_at opnieuw bepalen zodat de
    # nieuwe cadans direct effect heeft.
    if "interval_days" in updates and old_interval != template.interval_days:
        if template.interval_days and template.interval_days > 0:
            template.next_due_at = datetime.now(timezone.utc) + timedelta(days=template.interval_days)
        else:
            # Terug naar cron-modus: laat de cron de planning bepalen.
            template.next_due_at = None

    from ..scheduler import reschedule_template
    await reschedule_template(template)

    return _template_with_next_run(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    _require_manage(user, template.category, "verwijderen")

    from ..scheduler import remove_template
    await remove_template(template.id)

    # Pool-koppelingen die naar dit sjabloon verwijzen leegmaken zodat er
    # geen dode references blijven staan.
    pool_result = await db.execute(select(PoolConfig))
    for cfg in pool_result.scalars().all():
        for col in ("filter_template_id", "filter_template_id_r", "chloor_template_id", "zuur_template_id", "vlokmiddel_template_id"):
            if getattr(cfg, col) == template.id:
                setattr(cfg, col, None)

    await db.delete(template)


@router.post("/{template_id}/start")
async def start_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Maak actieve (open) tickets aan voor dit sjabloon, zonder ze meteen te sluiten.
    Gebruikt wanneer de gebruiker subtaken handmatig wil afvinken vóór afronding."""
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    _require_manage(user, template.category, "starten")

    existing = await db.scalar(
        select(func.count()).where(
            and_(Ticket.recurring_template_id == template_id, Ticket.status != Status.closed)
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Er zijn al openstaande tickets voor dit sjabloon")

    created_ids = []
    if template.subtask_mode == "rooms" and template.subtask_items:
        room_ids = json.loads(template.subtask_items)
        for room_id in room_ids:
            ticket = Ticket(
                id=new_uuid(), title=template.title, description=template.description,
                category=template.category, priority=template.priority,
                location_id=room_id, created_by=user.ha_user_id,
                recurring_template_id=template.id,
                notify_when_free=template.notify_when_free,
                object_id=template.object_id,
            )
            db.add(ticket)
            created_ids.append(ticket.id)
    elif template.subtask_mode == "subtasks" and template.subtask_items:
        labels = json.loads(template.subtask_items)
        subtasks_json = json.dumps([{"label": l, "done": False, "done_by": None, "done_at": None} for l in labels])
        ticket = Ticket(
            id=new_uuid(), title=template.title, description=template.description,
            category=template.category, priority=template.priority,
            location_id=template.location_id, created_by=user.ha_user_id,
            recurring_template_id=template.id,
            subtasks=subtasks_json, notify_when_free=template.notify_when_free,
            object_id=template.object_id,
        )
        db.add(ticket)
        created_ids.append(ticket.id)
    else:
        ticket = Ticket(
            id=new_uuid(), title=template.title, description=template.description,
            category=template.category, priority=template.priority,
            location_id=template.location_id, created_by=user.ha_user_id,
            recurring_template_id=template.id,
            notify_when_free=template.notify_when_free,
            object_id=template.object_id,
        )
        db.add(ticket)
        created_ids.append(ticket.id)

    await db.flush()
    await sync_ticket_sensors(db)
    return {"ok": True, "created_ticket_ids": created_ids}


class CompleteRequest(BaseModel):
    room_id: str | None = None  # voor kamers-modus: sluit alleen dit kamer-ticket


@router.post("/{template_id}/complete")
async def complete_template(template_id: str, body: CompleteRequest = CompleteRequest(), user: RequireUser = None, db: AsyncSession = Depends(get_db)):
    """Rond een taak handmatig af — sluit openstaande tickets of maakt nieuwe aan."""
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    if user is not None:
        _require_manage(user, template.category, "afronden")

    now = datetime.now(timezone.utc)
    closed_ids = []

    filters = [
        Ticket.recurring_template_id == template_id,
        Ticket.status != Status.closed,
    ]
    if body.room_id:
        filters.append(Ticket.location_id == body.room_id)

    result = await db.execute(select(Ticket).where(and_(*filters)))
    open_tickets = result.scalars().all()

    if open_tickets:
        for ticket in open_tickets:
            ticket.status = Status.closed
            ticket.closed_at = now
            ticket.closed_by = user.ha_user_id if user else "manual"
            # Hoort dit sjabloon bij een logboekobject? Dan is afvinken een
            # onwisbare regel in dat boek.
            if not ticket.object_id and template.object_id:
                ticket.object_id = template.object_id
            await schrijf_registratie_bij_afronden(db, ticket, ticket.closed_by)
            closed_ids.append(ticket.id)
    else:
        # Geen openstaand ticket — maak een nieuw aan en sluit direct
        location_id = body.room_id if body.room_id else template.location_id
        ticket = Ticket(
            id=new_uuid(),
            title=template.title,
            description="Handmatig afgevinkt",
            category=template.category,
            priority=template.priority,
            location_id=location_id,
            created_by=user.ha_user_id if user else "manual",
            assigned_to=user.ha_user_id if user else None,
            recurring_template_id=template.id,
            status=Status.closed,
            closed_at=now,
            closed_by=user.ha_user_id if user else "manual",
            object_id=template.object_id,
        )
        db.add(ticket)
        await db.flush()
        await schrijf_registratie_bij_afronden(db, ticket, ticket.closed_by)
        closed_ids.append(ticket.id)

    # Volgende uitvoering plannen (interval: now + interval_days, cron:
    # eerstvolgende cron-tick na nu). Alleen als er geen andere openstaande
    # tickets meer zijn (bij kamer-modus kunnen die er nog wel zijn).
    await mark_template_completed(template, db, closed_at=now)

    await sync_ticket_sensors(db)
    return {"ok": True, "closed_ticket_ids": closed_ids}


@router.get("/{template_id}/active-tickets")
async def get_active_tickets(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Geeft openstaande tickets terug voor dit sjabloon (voor kamers-modus)."""
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    result = await db.execute(
        select(Ticket).where(
            and_(
                Ticket.recurring_template_id == template_id,
                Ticket.status != Status.closed,
            )
        ).order_by(Ticket.created_at)
    )
    tickets = result.scalars().all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "location_id": t.location_id,
            "subtasks": json.loads(t.subtasks) if t.subtasks else None,
            "assigned_to": t.assigned_to,
            "notify_when_free": t.notify_when_free,
        }
        for t in tickets
    ]


@router.get("/{template_id}/history", response_model=list[HistoryOut])
async def get_template_history(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Uitvoeringslog: alle afgesloten tickets van dit sjabloon."""
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    result = await db.execute(
        select(Ticket).where(
            and_(
                Ticket.recurring_template_id == template_id,
                Ticket.status == Status.closed,
            )
        ).order_by(Ticket.closed_at.desc()).limit(50)
    )
    tickets = result.scalars().all()

    return [
        {
            "id": t.id,
            "title": t.title,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "closed_by": t.closed_by,
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]
