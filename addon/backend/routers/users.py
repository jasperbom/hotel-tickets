from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from pydantic import BaseModel

from ..database import get_db
from ..models import UserRole, Role, Category, Ticket, Status
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
async def get_my_overview(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Gepersonaliseerd overzicht voor de ingelogde medewerker."""
    uid = user.ha_user_id
    dept = user.department

    # Mijn openstaande tickets (aan mij toegewezen, niet gesloten)
    mine_result = await db.execute(
        select(Ticket).where(
            and_(Ticket.assigned_to == uid, Ticket.status != Status.closed)
        ).order_by(Ticket.priority.desc(), Ticket.created_at)
    )
    my_tickets = mine_result.scalars().all()

    # Beschikbare tickets: open, niet toegewezen, in mijn afdeling (of alles voor admin)
    avail_filters = [Ticket.status == Status.open, Ticket.assigned_to.is_(None)]
    if dept and not user.is_admin:
        avail_filters.append(Ticket.category == dept)
    avail_result = await db.execute(
        select(Ticket).where(and_(*avail_filters)).order_by(Ticket.priority.desc(), Ticket.created_at).limit(10)
    )
    available = avail_result.scalars().all()

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
        "my_tickets": [_ticket_dict(t) for t in my_tickets],
        "available_tickets": [_ticket_dict(t) for t in available],
    }


def _ticket_dict(t: Ticket) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "category": t.category,
        "status": t.status,
        "priority": t.priority,
        "location_id": t.location_id,
        "assigned_to": t.assigned_to,
        "created_at": t.created_at.isoformat(),
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
