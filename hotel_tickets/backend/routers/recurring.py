from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from croniter import croniter

from ..database import get_db
from ..models import RecurringTemplate, Category, Priority, Ticket, Status, new_uuid
from ..auth import RequireUser
from ..services.ha_entities import sync_ticket_sensors

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
    is_active: bool = True
    nfc_tag_id: str | None = None


class TemplateUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    location_id: str | None = None
    assign_to: str | None = None
    cron_expression: str | None = None
    advance_days: int | None = None
    is_active: bool | None = None
    nfc_tag_id: str | None = None


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
    is_active: bool
    nfc_tag_id: str | None
    next_run: str | None = None

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


def _calc_next_run(cron_expression: str) -> str | None:
    try:
        now = datetime.now()
        cron = croniter(cron_expression, now)
        return cron.get_next(datetime).isoformat()
    except Exception:
        return None


def _template_with_next_run(template: RecurringTemplate) -> dict:
    data = {
        "id": template.id,
        "title": template.title,
        "description": template.description,
        "category": template.category,
        "priority": template.priority,
        "location_id": template.location_id,
        "assign_to": template.assign_to,
        "cron_expression": template.cron_expression,
        "advance_days": template.advance_days,
        "is_active": template.is_active,
        "nfc_tag_id": template.nfc_tag_id,
        "next_run": _calc_next_run(template.cron_expression),
    }
    return data


@router.get("/", response_model=list[TemplateOut])
async def list_templates(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RecurringTemplate).order_by(RecurringTemplate.title))
    templates = result.scalars().all()
    return [_template_with_next_run(t) for t in templates]


@router.post("/", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins en supervisors kunnen sjablonen aanmaken")
    _validate_cron(body.cron_expression)
    template = RecurringTemplate(**body.model_dump())
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
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Geen toegang")
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    if body.cron_expression:
        _validate_cron(body.cron_expression)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(template, field, value)

    from ..scheduler import reschedule_template
    await reschedule_template(template)

    return _template_with_next_run(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Geen toegang")
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    from ..scheduler import remove_template
    await remove_template(template.id)

    await db.delete(template)


@router.post("/{template_id}/complete")
async def complete_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Rond een taak handmatig af — maakt een ticket aan en sluit het direct."""
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    now = datetime.now(timezone.utc)

    # Zoek openstaande ticket voor dit sjabloon
    result = await db.execute(
        select(Ticket).where(
            and_(
                Ticket.recurring_template_id == template_id,
                Ticket.status != Status.closed,
            )
        ).order_by(Ticket.created_at.desc()).limit(1)
    )
    ticket = result.scalar_one_or_none()

    if ticket:
        ticket.status = Status.closed
        ticket.closed_at = now
        ticket.closed_by = user.ha_user_id
    else:
        ticket = Ticket(
            id=new_uuid(),
            title=template.title,
            description="Handmatig afgevinkt",
            category=template.category,
            priority=template.priority,
            location_id=template.location_id,
            created_by=user.ha_user_id,
            assigned_to=user.ha_user_id,
            recurring_template_id=template.id,
            status=Status.closed,
            closed_at=now,
            closed_by=user.ha_user_id,
        )
        db.add(ticket)

    await sync_ticket_sensors(db)
    return {"ok": True, "ticket_id": ticket.id}


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
