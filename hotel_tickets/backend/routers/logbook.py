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
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser, RequireUser
from ..database import get_db
from ..models import (
    Category, LogEntry, LogEntryType, LogObject, LogObjectType, Priority,
    RecurringTemplate, Status, Ticket,
)

router = APIRouter(prefix="/logbook", tags=["logbook"])

# Het controleschema van een object draait in interval-modus: X dagen ná de
# vorige afronding, niet op een vaste kalenderdag. Een filter dat drie weken te
# laat verwisseld is, moet daarna wéér een jaar meegaan — niet meteen opnieuw.
# De cron eronder is alleen het dagelijkse tikje waarop de scheduler kijkt of
# de teller is afgelopen.
CONTROLE_CRON = "0 8 * * *"


# --- Schemas ---

class LogObjectCreate(BaseModel):
    name: str
    type: LogObjectType
    location_id: str | None = None
    department: Category | None = None
    serial: str | None = None
    description: str | None = None
    nfc_tag_id: str | None = None
    folder: str | None = None
    kind: str | None = None
    purchase_date: date | None = None
    supplier: str | None = None
    # Onderhoudsinterval in dagen. Geen kolom op het object: het wordt een
    # herhaaltaak, zodat de controle als gewoon werk op Vandaag verschijnt in
    # plaats van als een datum die niemand bekijkt.
    maintenance_interval_days: int | None = None


class LogObjectUpdate(BaseModel):
    name: str | None = None
    type: LogObjectType | None = None
    location_id: str | None = None
    department: Category | None = None
    serial: str | None = None
    description: str | None = None
    nfc_tag_id: str | None = None
    folder: str | None = None
    kind: str | None = None
    purchase_date: date | None = None
    supplier: str | None = None
    maintenance_interval_days: int | None = None
    is_active: bool | None = None


class LogObjectOut(BaseModel):
    id: str
    name: str
    type: LogObjectType
    location_id: str | None
    department: Category | None
    serial: str | None
    description: str | None
    nfc_tag_id: str | None
    folder: str | None
    kind: str | None
    purchase_date: date | None
    supplier: str | None
    is_active: bool
    created_at: datetime
    # Afgeleid, niet opgeslagen:
    last_check_at: datetime | None = None
    open_tickets: int = 0
    overdue: bool = False
    schedule: str | None = None
    maintenance_interval_days: int | None = None
    next_check_at: datetime | None = None

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


# --- Controleschema ---

async def _laatste_controle(db: AsyncSession, object_id: str) -> datetime | None:
    regel = (await db.execute(
        select(LogEntry)
        .where(and_(LogEntry.object_id == object_id, LogEntry.type != LogEntryType.correctie))
        .order_by(LogEntry.created_at.desc())
        .limit(1)
    )).scalars().first()
    return regel.created_at if regel else None


async def _sync_controleschema(
    db: AsyncSession, obj: LogObject, interval_days: int | None
) -> RecurringTemplate | None:
    """
    Het onderhoudsinterval van een object ís een herhaaltaak — er komt geen
    tweede motor naast. Zo verschijnt "Controle noodverlichting" gewoon tussen
    het werk op Vandaag, en schrijft het afvinken meteen de regel in het boek
    (de koppeling loopt via ``object_id``).

    Leegmaken verwijdert het sjabloon niet maar zet het uit: de geschiedenis van
    wat er ooit gepland stond blijft zo bestaan.
    """
    from ..scheduler import remove_template, schedule_template

    template = (await db.execute(
        select(RecurringTemplate).where(RecurringTemplate.object_id == obj.id).limit(1)
    )).scalars().first()

    if not interval_days or interval_days <= 0:
        if template and template.is_active:
            template.is_active = False
            await db.flush()
            await remove_template(template.id)
        return None

    vorige = await _laatste_controle(db, obj.id)
    volgende = (vorige or datetime.now(timezone.utc)) + timedelta(days=interval_days)

    if template is None:
        template = RecurringTemplate(
            title=f"Controle {obj.name}",
            description=obj.description,
            category=obj.department or Category.technical,
            priority=Priority.medium,
            location_id=obj.location_id,
            cron_expression=CONTROLE_CRON,
            interval_days=interval_days,
            next_due_at=volgende,
            object_id=obj.id,
            # Zelfde map als het object, zodat de controle bij Herhalend naast
            # de andere brandveiligheidstaken staat en niet bij "Zonder map".
            folder=obj.folder,
        )
        db.add(template)
    else:
        # Een bestaand sjabloon niet overschrijven: titel, afdeling en subtaken
        # kunnen met de hand zijn bijgesteld bij Herhalend. Alleen de teller.
        if template.interval_days != interval_days or template.next_due_at is None:
            template.next_due_at = volgende
        template.interval_days = interval_days
        template.is_active = True

    await db.flush()
    await schedule_template(template)
    return template


def _schema_op(item: LogObjectOut, template: RecurringTemplate | None) -> None:
    """
    In interval-modus is de cron alleen het dagelijkse tikje van de scheduler;
    hem tonen zou "elke dag" opleveren terwijl er maandelijks gecontroleerd
    wordt. Dan dus geen schema, alleen het interval.
    """
    if template is None:
        return
    item.maintenance_interval_days = template.interval_days
    item.next_check_at = template.next_due_at
    item.schedule = None if template.interval_days else template.cron_expression


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

    # Het controleschema van het object (de gekoppelde herhaaltaak)
    templates = (await db.execute(
        select(RecurringTemplate).where(and_(
            RecurringTemplate.object_id.in_(ids),
            RecurringTemplate.is_active == True,  # noqa: E712
        ))
    )).scalars().all()
    schema_per = {t.object_id: t for t in templates}

    uit: list[LogObjectOut] = []
    for o in objects:
        item = LogObjectOut.model_validate(o)
        item.last_check_at = laatste.get(o.id)
        item.open_tickets = open_per.get(o.id, 0)
        item.overdue = item.open_tickets > 0
        _schema_op(item, schema_per.get(o.id))
        uit.append(item)
    return uit


@router.post("/objects", response_model=LogObjectOut, status_code=status.HTTP_201_CREATED)
async def create_object(body: LogObjectCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten aanmaken")
    velden = body.model_dump()
    interval = velden.pop("maintenance_interval_days", None)
    obj = LogObject(**velden)
    db.add(obj)
    await db.flush()
    item = LogObjectOut.model_validate(obj)
    if interval:
        _schema_op(item, await _sync_controleschema(db, obj, interval))
    return item


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
        select(RecurringTemplate).where(and_(
            RecurringTemplate.object_id == object_id,
            RecurringTemplate.is_active == True,  # noqa: E712
        )).limit(1)
    )).scalars().first()
    _schema_op(item, template)
    return item


@router.patch("/objects/{object_id}", response_model=LogObjectOut)
async def update_object(object_id: str, body: LogObjectUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten wijzigen")
    obj = await db.get(LogObject, object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object niet gevonden")
    velden = body.model_dump(exclude_none=True)
    velden.pop("maintenance_interval_days", None)
    for veld, waarde in velden.items():
        setattr(obj, veld, waarde)

    # Het interval moet je ook op nul kunnen zetten ("geen onderhoud meer"),
    # dus hier telt of het veld is meegestuurd — niet of het gevuld is.
    item = LogObjectOut.model_validate(obj)
    if "maintenance_interval_days" in body.model_fields_set:
        _schema_op(item, await _sync_controleschema(db, obj, body.maintenance_interval_days))
    else:
        _schema_op(item, (await db.execute(
            select(RecurringTemplate).where(and_(
                RecurringTemplate.object_id == object_id,
                RecurringTemplate.is_active == True,  # noqa: E712
            )).limit(1)
        )).scalars().first())
    return item


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
