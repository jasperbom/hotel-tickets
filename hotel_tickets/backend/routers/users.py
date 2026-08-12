import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, case
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models import UserRole, Role, Category, Ticket, Status, TicketComment, TicketPin, PermissionEvent, new_uuid
from ..auth import RequireUser
from ..passwords import MIN_PASSWORD_LENGTH, hash_password
from ..services.vandaag import herhaaltaken

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
    notify_direct_message: bool = False
    notify_mention: bool = True


class UserRoleUpdate(BaseModel):
    display_name: str | None = None
    # Uitzonderingen op de afdelingsstandaard (zie models.UserRole)
    extra_departments: list[Category] | None = None
    modules: list[str] | None = None
    can_reports: bool | None = None
    ha_username: str | None = None
    role: Role | None = None
    department: Category | None = None
    email: str | None = None
    notify_push: bool | None = None
    notify_email: bool | None = None
    ha_notify_service: str | None = None
    ha_device_tracker: str | None = None
    notify_new_ticket: bool | None = None
    notify_direct_message: bool | None = None
    notify_mention: bool | None = None


class UserRoleOut(BaseModel):
    ha_user_id: str
    display_name: str
    ha_username: str | None
    role: Role
    department: Category | None
    # Alle afdelingen waarin gehandeld mag worden (hoofdafdeling + extra's)
    departments: list[Category] = []
    modules: list[str] | None = None
    can_reports: bool | None = None
    email: str | None
    notify_push: bool
    notify_email: bool
    ha_notify_service: str | None
    ha_device_tracker: str | None
    notify_new_ticket: bool
    notify_direct_message: bool
    notify_mention: bool
    # True = lokaal app-account (wachtwoord in eigen database, geen HA nodig)
    has_password: bool = False

    model_config = {"from_attributes": True}

    @field_validator("modules", mode="before")
    @classmethod
    def parse_modules(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


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
    # Iedereen kan filteren op afdeling via de query param; "all" betekent
    # expliciet alle afdelingen. Zonder param valt iedereen terug op de eigen
    # afdeling — ook een admin. Die zag eerst standaard alles, en dan staat er
    # op zijn startscherm werk van de keuken tussen dat hij nooit oppakt. Wie
    # geen afdeling op zijn profiel heeft ziet nog steeds alles.
    if department == "all":
        dept = None
    elif department:
        try:
            dept = Category(department)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Onbekende afdeling: {department}")
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
    urgent_count_filters = [Ticket.status != Status.closed, Ticket.priority == "urgent"]
    if dept:
        urgent_count_filters.append(Ticket.category == dept)
    urgent_count = await db.scalar(select(func.count()).where(and_(*urgent_count_filters)))

    # Herhalende taken: vandaag gepland + aankomende. De berekening staat in
    # services/vandaag.py, zodat het wandscherm exact hetzelfde ziet.
    today_recurring, upcoming_all = await herhaaltaken(db, dept)
    upcoming_5 = upcoming_all[:5]

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
    # Rechtenwijzigingen zijn zelf een logboekregel: wie wat mocht en sinds
    # wanneer is bij een incident net zo relevant als wie wat deed.
    def _log_recht(veld: str, oud, nieuw):
        if str(oud) == str(nieuw):
            return
        db.add(PermissionEvent(
            subject_id=ha_user_id,
            actor_id=user.ha_user_id,
            field=veld,
            from_value=None if oud is None else str(oud),
            to_value=None if nieuw is None else str(nieuw),
        ))

    velden = body.model_dump(exclude_none=True)
    # Voor de drie rechtenvelden kijken we naar wat er meegestuurd is, niet naar
    # "niet-null": alleen zo kan een admin een uitzondering ook weer wegnemen
    # (modules terug naar alles, rapportage terug naar "volgt de rol").
    gezet = body.model_fields_set
    if "role" in velden:
        _log_recht("role", target.role.value if target.role else None, velden["role"].value)
    if "department" in velden:
        _log_recht("department", target.department.value if target.department else None, velden["department"].value)
    if "extra_departments" in gezet:
        nieuw = [c.value for c in body.extra_departments or []]
        _log_recht("extra_departments", target.extra_departments, json.dumps(nieuw) if nieuw else None)
        target.extra_departments = json.dumps(nieuw) if nieuw else None
    if "modules" in gezet:
        # Lege lijst = geen uitzondering meer, dus alle modules.
        nieuw_mod = json.dumps(body.modules) if body.modules else None
        _log_recht("modules", target.modules, nieuw_mod)
        target.modules = nieuw_mod
    if "can_reports" in gezet:
        _log_recht("can_reports", target.can_reports, body.can_reports)
        target.can_reports = body.can_reports
    for veld in ("extra_departments", "modules", "can_reports"):
        velden.pop(veld, None)

    for field, value in velden.items():
        setattr(target, field, value)
    return target


class PermissionEventOut(BaseModel):
    id: str
    subject_id: str
    actor_id: str
    field: str
    from_value: str | None
    to_value: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/{ha_user_id}/permission-events", response_model=list[PermissionEventOut])
async def list_permission_events(ha_user_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Wat er aan de rechten van deze medewerker veranderde, en door wie."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen het rechtenlogboek inzien")
    result = await db.execute(
        select(PermissionEvent)
        .where(PermissionEvent.subject_id == ha_user_id)
        .order_by(PermissionEvent.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.delete("/{ha_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(ha_user_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen gebruikers verwijderen")
    target = await db.get(UserRole, ha_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    await db.delete(target)
