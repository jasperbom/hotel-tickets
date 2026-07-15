import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, case
from pydantic import BaseModel
from croniter import croniter

from ..database import get_db
from ..models import UserRole, Role, Category, Ticket, Status, RecurringTemplate, TicketComment, TicketPin, new_uuid
from ..auth import RequireUser
from ..passwords import MIN_PASSWORD_LENGTH, hash_password

router = APIRouter(prefix="/users", tags=["users"])


class UserRoleCreate(BaseModel):
    # Leeg laten kan alleen bij een lokaal app-account (met wachtwoord);
    # er wordt dan een eigen id gegenereerd (prefix "local-").
    ha_user_id: str | None = None
    display_name: str
    ha_username: str | None = None
    # Indien gezet: lokaal app-account — de medewerker logt in met
    # ha_username + dit wachtwoord, zonder Home Assistant-account.
    password: str | None = None
    role: Role
    department: Category | None = None
    email: str | None = None
    notify_push: bool = True
    notify_email: bool = False
    ha_notify_service: str | None = None
    ha_device_tracker: str | None = None
    notify_new_ticket: bool = False


class UserRoleUpdate(BaseModel):
    display_name: str | None = None
    ha_username: str | None = None
    role: Role | None = None
    department: Category | None = None
    email: str | None = None
    notify_push: bool | None = None
    notify_email: bool | None = None
    ha_notify_service: str | None = None
    ha_device_tracker: str | None = None
    notify_new_ticket: bool | None = None


class UserRoleOut(BaseModel):
    ha_user_id: str
    display_name: str
    ha_username: str | None
    role: Role
    department: Category | None
    email: str | None
    notify_push: bool
    notify_email: bool
    ha_notify_service: str | None
    ha_device_tracker: str | None
    notify_new_ticket: bool
    # True = lokaal app-account (wachtwoord in eigen database, geen HA nodig)
    has_password: bool = False

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
    department: Optional[str] = Query(None),
):
    """Gepersonaliseerd overzicht voor de ingelogde medewerker."""
    uid = user.ha_user_id
    # Iedereen kan filteren op afdeling via de query param. De waarde "all"
    # betekent expliciet alle afdelingen. Zonder param: admins zien alles,
    # medewerkers vallen terug op hun eigen afdeling (oud gedrag).
    if department == "all":
        dept = None
    elif department:
        try:
            dept = Category(department)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Onbekende afdeling: {department}")
    elif user.is_admin:
        dept = None
    else:
        dept = user.department

    _priority_sort = case(
        (Ticket.priority == "urgent", 0),
        (Ticket.priority == "high", 1),
        (Ticket.priority == "medium", 2),
        (Ticket.priority == "low", 3),
        else_=4,
    )

    # Mijn openstaande tickets (aan mij toegewezen, niet gesloten, geen herhalende taken)
    mine_filters = [
        Ticket.assigned_to == uid,
        Ticket.status != Status.closed,
        Ticket.recurring_template_id.is_(None),
    ]
    if dept:
        mine_filters.append(Ticket.category == dept)
    mine_result = await db.execute(
        select(Ticket).where(and_(*mine_filters)).order_by(_priority_sort, Ticket.sort_order, Ticket.created_at)
    )
    my_tickets = mine_result.scalars().all()

    # Pinned-set bepalen voor huidige gebruiker en pinned tickets bovenaan plaatsen
    pinned_result = await db.execute(
        select(TicketPin.ticket_id).where(TicketPin.ha_user_id == uid)
    )
    pinned_ids = {row[0] for row in pinned_result.all()}
    if pinned_ids:
        my_tickets = sorted(my_tickets, key=lambda t: 0 if t.id in pinned_ids else 1)

    # Beschikbare tickets: open, niet toegewezen, gefilterd op afdeling (altijd als dept gezet), geen herhalende taken
    avail_filters = [Ticket.status == Status.open, Ticket.assigned_to.is_(None), Ticket.recurring_template_id.is_(None)]
    if dept:
        avail_filters.append(Ticket.category == dept)
    avail_result = await db.execute(
        select(Ticket).where(and_(*avail_filters)).order_by(_priority_sort, Ticket.created_at).limit(10)
    )
    available = avail_result.scalars().all()

    # Urgente tickets: gefilterd op de geselecteerde afdeling ("alle" = alles)
    urgent_filters = [Ticket.status != Status.closed, Ticket.priority == "urgent"]
    if dept:
        urgent_filters.append(Ticket.category == dept)
    urgent_result = await db.execute(
        select(Ticket).where(and_(*urgent_filters)).order_by(Ticket.created_at.desc()).limit(20)
    )
    urgent_tickets = urgent_result.scalars().all()

    # Tellingen: geen herhalende taken meerekenen
    if dept:
        # Met afdelingsfilter: eigen afdeling + eigen tickets (cross-dept)
        dept_or_mine = or_(Ticket.category == dept, Ticket.assigned_to == uid)
        total_open = await db.scalar(
            select(func.count()).where(and_(Ticket.status != Status.closed, Ticket.recurring_template_id.is_(None), dept_or_mine))
        )
    else:
        total_open = await db.scalar(
            select(func.count()).where(and_(Ticket.status != Status.closed, Ticket.recurring_template_id.is_(None)))
        )
    my_open_filters = [Ticket.assigned_to == uid, Ticket.status != Status.closed, Ticket.recurring_template_id.is_(None)]
    if dept:
        my_open_filters.append(Ticket.category == dept)
    my_open = await db.scalar(select(func.count()).where(and_(*my_open_filters)))
    urgent_count_filters = [Ticket.status == Status.open, Ticket.priority == "urgent"]
    if dept:
        urgent_count_filters.append(Ticket.category == dept)
    urgent_count = await db.scalar(select(func.count()).where(and_(*urgent_count_filters)))

    # Herhalende taken: vandaag gepland + aankomende
    templates_result = await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.is_active == True)
    )
    all_templates = templates_result.scalars().all()

    # Filter op afdeling (geen dept = alles zichtbaar, bijv. admin zonder filter)
    if dept:
        dept_templates = [t for t in all_templates if t.category == dept]
    else:
        dept_templates = list(all_templates)

    today = date.today()
    today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    today_recurring = []
    upcoming_recurring = []

    # Laad alle actieve (niet-gesloten) tickets voor templates (één query)
    template_ids = [t.id for t in dept_templates]
    active_by_template: dict[str, Ticket] = {}
    templates_with_open: set[str] = set()
    if template_ids:
        active_result = await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.recurring_template_id.in_(template_ids),
                    Ticket.status != Status.closed,
                )
            ).order_by(Ticket.created_at)  # oudste eerst
        )
        for ticket in active_result.scalars().all():
            tid = ticket.recurring_template_id
            templates_with_open.add(tid)
            # Bewaar oudste ticket per template (voor created_at referentie en subtaken)
            if tid not in active_by_template:
                active_by_template[tid] = ticket

    def _next_run_for(t: RecurringTemplate, after: datetime) -> datetime:
        # Respecteer next_due_at als die in de toekomst ligt — ook in cron-modus.
        # Anders blijft een net-afgeronde taak nog als 'verlopen' verschijnen
        # omdat croniter de cron-tick van vandaag teruggeeft, terwijl
        # mark_template_completed next_due_at al naar de volgende cyclus heeft
        # doorgeschoven (bv. wanneer een achterblijver van vorige week vandaag
        # wordt afgesloten in kamer-modus).
        if t.next_due_at:
            nd = t.next_due_at
            if nd.tzinfo is not None:
                nd = nd.replace(tzinfo=None)
            if nd > after:
                return nd
        return croniter(t.cron_expression, after).get_next(datetime)

    for t in dept_templates:
        try:
            base_dt = datetime.combine(today, datetime.min.time()) - timedelta(seconds=1)
            next_run = _next_run_for(t, base_dt)
            has_open = t.id in templates_with_open

            # Als de cyclus al doorgeschoven is naar ná vandaag (next_due_at
            # ligt in een toekomstige dag) is het sjabloon afgerond voor nu —
            # nooit als 'vandaag/verlopen' tonen, ook niet als er nog een open
            # ticket bestaat (bv. via 'Start nu' of heropende ticket).
            nd_naive = None
            if t.next_due_at:
                nd_naive = t.next_due_at
                if nd_naive.tzinfo is not None:
                    nd_naive = nd_naive.replace(tzinfo=None)
            cycle_advanced = nd_naive is not None and nd_naive.date() > today

            if cycle_advanced:
                upcoming_recurring.append((nd_naive, _template_dict(t, nd_naive)))
                continue

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
                    future_run = _next_run_for(t, datetime.now())
                    upcoming_recurring.append((future_run, _template_dict(t, future_run)))
                else:
                    upcoming_recurring.append((next_run, _template_dict(t, next_run)))
            elif has_open:
                # Open ticket van vorige run, volgende uitvoering nog niet vandaag → toon als verlopen taak
                active_ticket = active_by_template[t.id]
                today_recurring.append(_template_dict(t, active_ticket.created_at, active_ticket))
                # Niet toevoegen aan upcoming: al zichtbaar als verlopen in today_recurring
            else:
                upcoming_recurring.append((next_run, _template_dict(t, next_run)))
        except Exception:
            pass

    # Sorteer aankomende en neem de eerste 5
    upcoming_recurring.sort(key=lambda x: x[0])
    upcoming_5 = [item for _, item in upcoming_recurring[:5]]

    # Commentaar-tellingen per ticket (één query voor alle tickets tegelijk)
    all_ticket_ids = [t.id for t in list(my_tickets) + list(available) + list(urgent_tickets)]
    comment_count_map: dict[str, int] = {}
    if all_ticket_ids:
        cc_result = await db.execute(
            select(TicketComment.ticket_id, func.count(TicketComment.id).label("cnt"))
            .where(TicketComment.ticket_id.in_(all_ticket_ids))
            .group_by(TicketComment.ticket_id)
        )
        comment_count_map = {row.ticket_id: row.cnt for row in cc_result}

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
        "urgent_tickets": [_ticket_dict(t, comment_count_map, pinned_ids) for t in urgent_tickets],
        "my_tickets": [_ticket_dict(t, comment_count_map, pinned_ids) for t in my_tickets],
        "available_tickets": [_ticket_dict(t, comment_count_map, pinned_ids) for t in available],
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


def _ticket_dict(t: Ticket, comment_counts: dict[str, int] | None = None, pinned_ids: set[str] | None = None) -> dict:
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
        "comment_count": (comment_counts or {}).get(t.id, 0),
        "pinned": t.id in pinned_ids if pinned_ids else False,
    }


@router.get("/", response_model=list[UserRoleOut])
async def list_users(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserRole).order_by(UserRole.display_name))
    return result.scalars().all()


@router.post("/", response_model=UserRoleOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserRoleCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen gebruikers aanmaken")

    ha_user_id = (body.ha_user_id or "").strip()
    ha_username = (body.ha_username or "").strip() or None

    if body.password is not None:
        # Lokaal app-account: inloggen met ha_username + wachtwoord, zonder HA
        if not ha_username:
            raise HTTPException(
                status_code=422,
                detail="Een lokaal account heeft een gebruikersnaam (inlognaam) nodig",
            )
        if len(body.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=422,
                detail=f"Het wachtwoord moet minimaal {MIN_PASSWORD_LENGTH} tekens lang zijn",
            )
        if not ha_user_id:
            ha_user_id = f"local-{new_uuid()}"
    elif not ha_user_id:
        raise HTTPException(
            status_code=422,
            detail="Vul een HA user_id in, of geef een wachtwoord op voor een lokaal account",
        )

    existing = await db.get(UserRole, ha_user_id)
    if existing:
        raise HTTPException(status_code=409, detail="Gebruiker bestaat al")
    if ha_username:
        # De loginpagina zoekt op gebruikersnaam — die moet dus uniek zijn
        result = await db.execute(
            select(UserRole).where(func.lower(UserRole.ha_username) == ha_username.lower())
        )
        if result.scalars().first():
            raise HTTPException(status_code=409, detail="Deze gebruikersnaam is al in gebruik")

    new_user = UserRole(
        **body.model_dump(exclude={"ha_user_id", "ha_username", "password"}),
        ha_user_id=ha_user_id,
        ha_username=ha_username,
        password_hash=hash_password(body.password) if body.password is not None else None,
    )
    db.add(new_user)
    await db.flush()
    return new_user


class SetPasswordIn(BaseModel):
    # None = lokale login uitschakelen (terug naar HA-verificatie)
    password: str | None


@router.post("/{ha_user_id}/password", response_model=UserRoleOut)
async def set_password(
    ha_user_id: str,
    body: SetPasswordIn,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Admin: zet of reset het wachtwoord van een lokaal app-account."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen wachtwoorden instellen")
    target = await db.get(UserRole, ha_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    if body.password is None:
        target.password_hash = None
        return target
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Het wachtwoord moet minimaal {MIN_PASSWORD_LENGTH} tekens lang zijn",
        )
    if not target.ha_username:
        raise HTTPException(
            status_code=422,
            detail="Stel eerst een gebruikersnaam (inlognaam) in voor deze medewerker",
        )
    target.password_hash = hash_password(body.password)
    return target


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
    if body.ha_username is not None and not user.is_admin:
        # Bepaalt aan welk profiel de standalone login gekoppeld wordt
        raise HTTPException(status_code=403, detail="Alleen admins kunnen de HA-gebruikersnaam wijzigen")
    if body.role is not None and not user.is_admin:
        # Uitzondering: als er helemaal geen admins zijn mag iedereen zichzelf promoveren
        admin_count = await db.scalar(select(func.count()).where(UserRole.role == Role.admin))
        if admin_count > 0:
            raise HTTPException(status_code=403, detail="Alleen admins kunnen rollen wijzigen")
    target = await db.get(UserRole, ha_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    if body.ha_username:
        # De loginpagina zoekt op gebruikersnaam — die moet dus uniek blijven
        result = await db.execute(
            select(UserRole).where(
                and_(
                    func.lower(UserRole.ha_username) == body.ha_username.strip().lower(),
                    UserRole.ha_user_id != ha_user_id,
                )
            )
        )
        if result.scalars().first():
            raise HTTPException(status_code=409, detail="Deze gebruikersnaam is al in gebruik")
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
