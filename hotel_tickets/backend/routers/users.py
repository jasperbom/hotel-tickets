import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, case
from pydantic import BaseModel
from croniter import croniter

from ..database import get_db
from ..models import UserRole, Role, Category, Ticket, Status, RecurringTemplate
from ..auth import RequireUser

router = APIRouter(prefix="/users", tags=["users"])


class UserRoleCreate(BaseModel):
    ha_user_id: str
    display_name: str
    role: Role
    department: Category | None = None
    email: str | None = None
    notify_push: bool = True
    notify_email: bool = False
    ha_notify_service: str | None = None


class UserRoleUpdate(BaseModel):
    display_name: str | None = None
    role: Role | None = None
    department: Category | None = None
    email: str | None = None
    notify_push: bool | None = None
    notify_email: bool | None = None
    ha_notify_service: str | None = None


class UserRoleOut(BaseModel):
    ha_user_id: str
    display_name: str
    role: Role
    department: Category | None
    email: str | None
    notify_push: bool
    notify_email: bool
    ha_notify_service: str | None

    model_config = {"from_attributes": True}


@router.get("/me", response_model=UserRoleOut)
async def get_me(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.get(UserRole, user.ha_user_id)
    if not result:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    return result


@router.get("/me/overview")
async def get_my_overview(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    department: Optional[Category] = Query(None),
):
    """Gepersonaliseerd overzicht voor de ingelogde medewerker."""
    uid = user.ha_user_id
    # Admin/supervisor kan optioneel filteren op afdeling via query param
    if department and user.is_admin:
        dept = department
    else:
        dept = user.department

    _priority_sort = case(
        (Ticket.priority == "urgent", 0),
        (Ticket.priority == "high", 1),
        (Ticket.priority == "medium", 2),
        (Ticket.priority == "low", 3),
        else_=4,
    )

    # Mijn openstaande tickets (aan mij toegewezen, niet gesloten)
    mine_result = await db.execute(
        select(Ticket).where(
            and_(Ticket.assigned_to == uid, Ticket.status != Status.closed)
        ).order_by(_priority_sort, Ticket.created_at)
    )
    my_tickets = mine_result.scalars().all()

    # Beschikbare tickets: open, niet toegewezen, in mijn afdeling (of alles voor admin)
    avail_filters = [Ticket.status == Status.open, Ticket.assigned_to.is_(None)]
    if dept and not user.is_admin:
        avail_filters.append(Ticket.category == dept)
    avail_result = await db.execute(
        select(Ticket).where(and_(*avail_filters)).order_by(_priority_sort, Ticket.created_at).limit(10)
    )
    available = avail_result.scalars().all()

    # Urgente tickets: alle open urgente tickets in mijn afdeling
    urgent_filters = [Ticket.status != Status.closed, Ticket.priority == "urgent"]
    if dept and not user.is_admin:
        urgent_filters.append(Ticket.category == dept)
    urgent_result = await db.execute(
        select(Ticket).where(and_(*urgent_filters)).order_by(Ticket.created_at.desc()).limit(20)
    )
    urgent_tickets = urgent_result.scalars().all()

    # Tellingen voor mijn afdeling (of alles)
    count_filters = [Ticket.status != Status.closed]
    if dept and not user.is_admin:
        count_filters.append(Ticket.category == dept)

    total_open = await db.scalar(select(func.count()).where(and_(*count_filters)))
    my_open = await db.scalar(
        select(func.count()).where(and_(Ticket.assigned_to == uid, Ticket.status != Status.closed))
    )
    urgent_count = await db.scalar(
        select(func.count()).where(and_(Ticket.status == Status.open, Ticket.priority == "urgent", *count_filters[1:]))
    )

    # Herhalende taken: vandaag gepland + aankomende
    templates_result = await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.is_active == True)
    )
    all_templates = templates_result.scalars().all()

    # Filter op afdeling (admins/supervisors zien alles)
    if dept and not user.is_admin:
        dept_templates = [t for t in all_templates if t.category == dept]
    else:
        dept_templates = list(all_templates)

    today = date.today()
    today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    today_recurring = []
    upcoming_recurring = []

    # Laad actieve tickets met subtaken voor alle templates (één query)
    template_ids = [t.id for t in dept_templates]
    active_by_template: dict[str, Ticket] = {}
    if template_ids:
        active_result = await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.recurring_template_id.in_(template_ids),
                    Ticket.status != Status.closed,
                    Ticket.subtasks.isnot(None),
                )
            )
        )
        for ticket in active_result.scalars().all():
            active_by_template[ticket.recurring_template_id] = ticket

    for t in dept_templates:
        try:
            base_dt = datetime.combine(today, datetime.min.time()) - timedelta(seconds=1)
            cron = croniter(t.cron_expression, base_dt)
            next_run = cron.get_next(datetime)
            if next_run.date() == today:
                # Tel het aantal vandaag gesloten tickets voor dit sjabloon
                closed_today_count = await db.scalar(
                    select(func.count()).where(
                        and_(
                            Ticket.recurring_template_id == t.id,
                            Ticket.status == Status.closed,
                            Ticket.closed_at >= today_start,
                        )
                    )
                )
                # Voor kamers-modus: alleen verbergen als ALLE kamers afgerond zijn
                is_rooms = t.subtask_mode == "rooms" and t.subtask_items
                if is_rooms:
                    total_rooms = len(json.loads(t.subtask_items)) if t.subtask_items else 0
                    all_done = closed_today_count >= total_rooms and total_rooms > 0
                else:
                    all_done = closed_today_count > 0

                if not all_done:
                    today_recurring.append(_template_dict(t, next_run, active_by_template.get(t.id)))

                # Voor upcoming: toon de volgende uitvoering na vandaag als vandaag al afgerond
                if all_done:
                    cron_future = croniter(t.cron_expression, datetime.now())
                    future_run = cron_future.get_next(datetime)
                    upcoming_recurring.append((future_run, _template_dict(t, future_run)))
                else:
                    upcoming_recurring.append((next_run, _template_dict(t, next_run)))
            else:
                upcoming_recurring.append((next_run, _template_dict(t, next_run)))
        except Exception:
            pass

    # Sorteer aankomende en neem de eerste 5
    upcoming_recurring.sort(key=lambda x: x[0])
    upcoming_5 = [item for _, item in upcoming_recurring[:5]]

    return {
        "user": {
            "ha_user_id": user.ha_user_id,
            "display_name": user.display_name,
            "role": user.role,
            "department": user.department,
        },
        "stats": {
            "my_open": my_open or 0,
            "team_open": total_open or 0,
            "urgent": urgent_count or 0,
        },
        "urgent_tickets": [_ticket_dict(t) for t in urgent_tickets],
        "my_tickets": [_ticket_dict(t) for t in my_tickets],
        "available_tickets": [_ticket_dict(t) for t in available],
        "today_recurring": today_recurring,
        "upcoming_recurring": upcoming_5,
    }


def _template_dict(t: RecurringTemplate, next_run: datetime, active_ticket: "Ticket | None" = None) -> dict:
    result = {
        "id": t.id,
        "title": t.title,
        "category": t.category,
        "priority": t.priority,
        "location_id": t.location_id,
        "nfc_tag_id": t.nfc_tag_id,
        "next_run": next_run.isoformat(),
        "emoji": t.emoji,
        "subtask_mode": t.subtask_mode,
        "subtask_items": json.loads(t.subtask_items) if t.subtask_items else [],
    }
    if active_ticket and active_ticket.subtasks:
        try:
            items = json.loads(active_ticket.subtasks)
            result["subtask_done"] = sum(1 for s in items if s.get("done"))
            result["subtask_total"] = len(items)
        except Exception:
            pass
    return result


def _ticket_dict(t: Ticket) -> dict:
    subtasks = None
    if t.subtasks:
        try:
            subtasks = json.loads(t.subtasks)
        except Exception:
            pass
    photos = None
    if t.photos:
        try:
            photos = json.loads(t.photos)
        except Exception:
            pass
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "category": t.category,
        "status": t.status,
        "priority": t.priority,
        "location_id": t.location_id,
        "assigned_to": t.assigned_to,
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
        "closed_at": None,
        "closed_by": None,
        "notify_when_free": t.notify_when_free,
        "recurring_template_id": t.recurring_template_id,
        "subtasks": subtasks,
        "photos": photos,
    }


@router.get("/", response_model=list[UserRoleOut])
async def list_users(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserRole).order_by(UserRole.display_name))
    return result.scalars().all()


@router.post("/", response_model=UserRoleOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserRoleCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen gebruikers aanmaken")
    existing = await db.get(UserRole, body.ha_user_id)
    if existing:
        raise HTTPException(status_code=409, detail="Gebruiker bestaat al")
    new_user = UserRole(**body.model_dump())
    db.add(new_user)
    await db.flush()
    return new_user


@router.patch("/{ha_user_id}", response_model=UserRoleOut)
async def update_user(
    ha_user_id: str,
    body: UserRoleUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    # Mag eigen profiel bewerken, admins mogen iedereen bewerken
    if ha_user_id != user.ha_user_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Geen toegang")
    if body.role is not None and not user.is_admin:
        # Uitzondering: als er helemaal geen admins zijn mag iedereen zichzelf promoveren
        admin_count = await db.scalar(select(func.count()).where(UserRole.role == Role.admin))
        if admin_count > 0:
            raise HTTPException(status_code=403, detail="Alleen admins kunnen rollen wijzigen")
    target = await db.get(UserRole, ha_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(target, field, value)
    return target


@router.delete("/{ha_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(ha_user_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen gebruikers verwijderen")
    target = await db.get(UserRole, ha_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    await db.delete(target)
