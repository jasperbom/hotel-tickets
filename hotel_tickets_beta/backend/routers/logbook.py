"""
Logboeken voor installaties en middelen.

Een ticket beantwoordt "wat moet er gebeuren?" en verdwijnt als het klaar is.
Een logboek beantwoordt "wat is er met dit ding gebeurd?" en mag juist nooit
verdwijnen — voor de brandmeldcentrale is dat wettelijk.

Driekwart van het systeem stond er al: de herhaaltaken zijn de motor (de
maandelijkse controle is een cron-sjabloon), tickets zijn de storingen, en
locaties zijn HA-areas. Wat hier bij komt is één begrip: het object.

Registraties zijn onwisbaar. Toevoegen kan altijd, corrigeren is een nieuwe
regel die naar de oude verwijst, verwijderen bestaat niet — dat is wat het
boek geloofwaardig maakt tegenover een inspecteur.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser, RequireUser
from ..database import get_db
from ..models import (
    Category, LogEntry, LogEntryType, LogObject, LogObjectType,
    RecurringTemplate, Status, Ticket,
)

router = APIRouter(prefix="/logbook", tags=["logbook"])


# --- Schemas ---

class LogObjectCreate(BaseModel):
    name: str
    type: LogObjectType
    location_id: str | None = None
    department: Category | None = None
    serial: str | None = None
    description: str | None = None


class LogObjectUpdate(BaseModel):
    name: str | None = None
    type: LogObjectType | None = None
    location_id: str | None = None
    department: Category | None = None
    serial: str | None = None
    description: str | None = None
    is_active: bool | None = None


class LogObjectOut(BaseModel):
    id: str
    name: str
    type: LogObjectType
    location_id: str | None
    department: Category | None
    serial: str | None
    description: str | None
    is_active: bool
    created_at: datetime
    # Afgeleid, niet opgeslagen:
    last_check_at: datetime | None = None
    open_tickets: int = 0
    overdue: bool = False
    schedule: str | None = None

    model_config = {"from_attributes": True}


class LogEntryCreate(BaseModel):
    type: LogEntryType = LogEntryType.registratie
    body: str | None = None
    value: str | None = None
    corrects_id: str | None = None


class LogEntryOut(BaseModel):
    id: str
    object_id: str
    actor_id: str
    type: LogEntryType
    body: str | None
    value: str | None
    ticket_id: str | None
    corrects_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Rechten ---

def _mag_schrijven(user: CurrentUser, obj: LogObject) -> bool:
    """
    Registraties schrijven mag de afdeling van het object — dat is een
    aantoonbaarheidseis (wie is ervoor geïnstrueerd), geen wantrouwen.
    Zonder afdeling op het object mag iedereen schrijven.
    """
    if user.is_admin or user.role.value == "supervisor":
        return True
    if obj.department is None:
        return True
    return obj.department in user.departments


def _mag_beheren(user: CurrentUser) -> bool:
    return user.is_admin or user.role.value == "supervisor"


# --- Objecten ---

@router.get("/objects", response_model=list[LogObjectOut])
async def list_objects(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    include_inactive: bool = Query(False),
):
    """Alle objecten, met wat er aandacht nodig heeft bovenaan te bepalen."""
    filters = [] if include_inactive else [LogObject.is_active == True]  # noqa: E712
    result = await db.execute(select(LogObject).where(and_(*filters)) if filters else select(LogObject))
    objects = result.scalars().all()
    if not objects:
        return []

    ids = [o.id for o in objects]

    # Laatste controle per object
    entries = (await db.execute(
        select(LogEntry).where(LogEntry.object_id.in_(ids)).order_by(LogEntry.created_at.desc())
    )).scalars().all()
    laatste: dict[str, datetime] = {}
    for e in entries:
        if e.type in (LogEntryType.controle, LogEntryType.registratie) and e.object_id not in laatste:
            laatste[e.object_id] = e.created_at

    # Openstaand werk per object — dat is precies wat "controle nodig" betekent:
    # het staat al op Vandaag.
    open_tickets = (await db.execute(
        select(Ticket).where(and_(Ticket.object_id.in_(ids), Ticket.status != Status.closed))
    )).scalars().all()
    open_per: dict[str, int] = {}
    for t in open_tickets:
        open_per[t.object_id] = open_per.get(t.object_id, 0) + 1

    # Het controleschema van het object (het cron-sjabloon)
    templates = (await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.object_id.in_(ids))
    )).scalars().all()
    schema_per = {t.object_id: t.cron_expression for t in templates}

    uit: list[LogObjectOut] = []
    for o in objects:
        item = LogObjectOut.model_validate(o)
        item.last_check_at = laatste.get(o.id)
        item.open_tickets = open_per.get(o.id, 0)
        item.overdue = item.open_tickets > 0
        item.schedule = schema_per.get(o.id)
        uit.append(item)
    return uit


@router.post("/objects", response_model=LogObjectOut, status_code=status.HTTP_201_CREATED)
async def create_object(body: LogObjectCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten aanmaken")
    obj = LogObject(**body.model_dump())
    db.add(obj)
    await db.flush()
    return LogObjectOut.model_validate(obj)


@router.get("/objects/{object_id}", response_model=LogObjectOut)
async def get_object(object_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    obj = await db.get(LogObject, object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object niet gevonden")
    item = LogObjectOut.model_validate(obj)
    laatste = (await db.execute(
        select(LogEntry)
        .where(and_(LogEntry.object_id == object_id, LogEntry.type != LogEntryType.correctie))
        .order_by(LogEntry.created_at.desc())
        .limit(1)
    )).scalars().first()
    item.last_check_at = laatste.created_at if laatste else None
    open_count = (await db.execute(
        select(Ticket).where(and_(Ticket.object_id == object_id, Ticket.status != Status.closed))
    )).scalars().all()
    item.open_tickets = len(open_count)
    item.overdue = item.open_tickets > 0
    template = (await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.object_id == object_id).limit(1)
    )).scalars().first()
    item.schedule = template.cron_expression if template else None
    return item


@router.patch("/objects/{object_id}", response_model=LogObjectOut)
async def update_object(object_id: str, body: LogObjectUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten wijzigen")
    obj = await db.get(LogObject, object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object niet gevonden")
    for veld, waarde in body.model_dump(exclude_none=True).items():
        setattr(obj, veld, waarde)
    return LogObjectOut.model_validate(obj)


# --- Registraties ---

@router.get("/objects/{object_id}/entries", response_model=list[LogEntryOut])
async def list_entries(
    object_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    from_date: datetime | None = Query(None),
    to_date: datetime | None = Query(None),
):
    """De geschiedenis van het object — dát is het logboek."""
    filters = [LogEntry.object_id == object_id]
    if from_date:
        filters.append(LogEntry.created_at >= from_date)
    if to_date:
        filters.append(LogEntry.created_at <= to_date)
    result = await db.execute(
        select(LogEntry).where(and_(*filters)).order_by(LogEntry.created_at.desc())
    )
    return result.scalars().all()


@router.post("/objects/{object_id}/entries", response_model=LogEntryOut, status_code=status.HTTP_201_CREATED)
async def add_entry(object_id: str, body: LogEntryCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """
    Een regel toevoegen. Er is geen bewerk- of verwijderendpoint: een fout
    corrigeer je met een nieuwe regel van het type 'correctie' die naar de oude
    verwijst.
    """
    obj = await db.get(LogObject, object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object niet gevonden")
    if not _mag_schrijven(user, obj):
        raise HTTPException(
            status_code=403,
            detail="Registraties in dit logboek schrijft de afdeling die ervoor is aangewezen",
        )
    if body.corrects_id:
        origineel = await db.get(LogEntry, body.corrects_id)
        if not origineel or origineel.object_id != object_id:
            raise HTTPException(status_code=400, detail="De te corrigeren regel hoort niet bij dit object")

    entry = LogEntry(
        object_id=object_id,
        actor_id=user.ha_user_id,
        type=body.type,
        body=body.body,
        value=body.value,
        corrects_id=body.corrects_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def schrijf_registratie_bij_afronden(db: AsyncSession, ticket: Ticket, actor_id: str) -> None:
    """
    Afvinken op Vandaag schrijft de regel in het boek. De medewerker leert niets
    nieuws: dezelfde rij, hetzelfde vinkje — het enige verschil zit ná de tik.

    Een ticket uit een controleschema wordt een 'controle', een los ticket op
    hetzelfde object een 'storing'.
    """
    if not ticket.object_id:
        return
    obj = await db.get(LogObject, ticket.object_id)
    if not obj:
        return
    soort = LogEntryType.controle if ticket.recurring_template_id else LogEntryType.storing
    db.add(LogEntry(
        object_id=obj.id,
        actor_id=actor_id or "system",
        type=soort,
        body=ticket.title,
        ticket_id=ticket.id,
    ))
