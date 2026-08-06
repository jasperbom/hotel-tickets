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

class MaintenanceIn(BaseModel):
    """Eén onderhoudsschema. Zonder id is het nieuw; met id wordt het bijgewerkt."""
    id: str | None = None
    title: str | None = None
    interval_days: int


class MaintenanceOut(BaseModel):
    id: str
    title: str
    interval_days: int | None
    next_check_at: datetime | None
    is_active: bool


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
    # Onderhoudsschema's. Geen kolom op het object: elk schema wordt een
    # herhaaltaak, zodat de controle als gewoon werk op Vandaag verschijnt in
    # plaats van als een datum die niemand bekijkt. Een lijst, want één ding
    # heeft vaak meer dan één ritme: de cv-ketel maandelijks ontluchten én
    # jaarlijks een servicebeurt.
    maintenance: list["MaintenanceIn"] | None = None


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
    maintenance: list["MaintenanceIn"] | None = None
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
    maintenance: list["MaintenanceOut"] = []

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


async def _schemas_van(db: AsyncSession, object_ids: list[str]) -> dict[str, list[RecurringTemplate]]:
    """De actieve controleschema's per object, in aanmaakvolgorde."""
    rijen = (await db.execute(
        select(RecurringTemplate)
        .where(and_(
            RecurringTemplate.object_id.in_(object_ids),
            RecurringTemplate.is_active == True,  # noqa: E712
        ))
        .order_by(RecurringTemplate.created_at)
    )).scalars().all()
    per: dict[str, list[RecurringTemplate]] = {}
    for t in rijen:
        per.setdefault(t.object_id, []).append(t)
    return per


def _als_out(templates: list[RecurringTemplate]) -> list[MaintenanceOut]:
    return [
        MaintenanceOut(
            id=t.id,
            title=t.title,
            interval_days=t.interval_days,
            next_check_at=t.next_due_at,
            is_active=t.is_active,
        )
        for t in templates
    ]


async def _sync_controleschemas(
    db: AsyncSession, obj: LogObject, gewenst: list[MaintenanceIn]
) -> list[RecurringTemplate]:
    """
    Onderhoudsschema's van een object ín de herhaaltaken — er komt geen tweede
    motor naast. Zo verschijnt "Controle noodverlichting" gewoon tussen het werk
    op Vandaag, en schrijft het afvinken meteen de regel in het boek (de
    koppeling loopt via ``object_id``).

    Eén ding heeft vaak meer dan één ritme: maandelijks een visuele controle,
    jaarlijks de keuring. Elk schema is een eigen herhaaltaak met een eigen
    teller, die loopt vanaf de laatste registratie — een keuring die drie weken
    te laat was moet daarna wéér een jaar mee, niet meteen opnieuw.

    Een schema dat uit de lijst verdwijnt wordt uitgezet, niet verwijderd: wat er
    ooit gepland stond blijft zo terug te vinden.
    """
    from ..scheduler import remove_template, schedule_template

    bestaand = (await db.execute(
        select(RecurringTemplate)
        .where(RecurringTemplate.object_id == obj.id)
        .order_by(RecurringTemplate.created_at)
    )).scalars().all()
    per_id = {t.id: t for t in bestaand}

    vorige = await _laatste_controle(db, obj.id)
    basis = vorige or datetime.now(timezone.utc)

    gehouden: list[RecurringTemplate] = []
    for wens in gewenst:
        if not wens.interval_days or wens.interval_days <= 0:
            continue
        titel = (wens.title or "").strip() or f"Controle {obj.name}"
        template = per_id.get(wens.id) if wens.id else None

        if template is None:
            template = RecurringTemplate(
                title=titel,
                description=obj.description,
                category=obj.department or Category.technical,
                priority=Priority.medium,
                location_id=obj.location_id,
                cron_expression=CONTROLE_CRON,
                interval_days=wens.interval_days,
                next_due_at=basis + timedelta(days=wens.interval_days),
                object_id=obj.id,
                # Zelfde map als het object, zodat de controle bij Herhalend
                # naast de andere brandveiligheidstaken staat.
                folder=obj.folder,
            )
            db.add(template)
        else:
            # Alleen de teller en de naam bijstellen: afdeling, prioriteit en
            # subtaken kunnen met de hand zijn aangepast bij Herhalend.
            if template.interval_days != wens.interval_days or template.next_due_at is None:
                template.next_due_at = basis + timedelta(days=wens.interval_days)
            template.interval_days = wens.interval_days
            template.title = titel
            template.is_active = True
        gehouden.append(template)

    await db.flush()
    for template in gehouden:
        await schedule_template(template)

    # Wat niet meer in de lijst staat: uitzetten en uit de scheduler halen.
    houden = {t.id for t in gehouden}
    for template in bestaand:
        if template.id not in houden and template.is_active:
            template.is_active = False
            await remove_template(template.id)
    await db.flush()
    return gehouden


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

    # De controleschema's van het object (de gekoppelde herhaaltaken)
    schema_per = await _schemas_van(db, ids)

    uit: list[LogObjectOut] = []
    for o in objects:
        item = LogObjectOut.model_validate(o)
        item.last_check_at = laatste.get(o.id)
        item.open_tickets = open_per.get(o.id, 0)
        item.overdue = item.open_tickets > 0
        item.maintenance = _als_out(schema_per.get(o.id, []))
        uit.append(item)
    return uit


@router.post("/objects", response_model=LogObjectOut, status_code=status.HTTP_201_CREATED)
async def create_object(body: LogObjectCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten aanmaken")
    velden = body.model_dump()
    velden.pop("maintenance", None)
    obj = LogObject(**velden)
    db.add(obj)
    await db.flush()
    item = LogObjectOut.model_validate(obj)
    if body.maintenance:
        item.maintenance = _als_out(await _sync_controleschemas(db, obj, body.maintenance))
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
    item.maintenance = _als_out((await _schemas_van(db, [object_id])).get(object_id, []))
    return item


@router.patch("/objects/{object_id}", response_model=LogObjectOut)
async def update_object(object_id: str, body: LogObjectUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not _mag_beheren(user):
        raise HTTPException(status_code=403, detail="Alleen leidinggevenden kunnen objecten wijzigen")
    obj = await db.get(LogObject, object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object niet gevonden")
    velden = body.model_dump(exclude_none=True)
    velden.pop("maintenance", None)
    for veld, waarde in velden.items():
        setattr(obj, veld, waarde)

    # Een lege lijst betekent "geen onderhoud meer"; niet meegestuurd betekent
    # "laat staan". Daarom telt hier of het veld ís meegestuurd.
    item = LogObjectOut.model_validate(obj)
    if "maintenance" in body.model_fields_set:
        item.maintenance = _als_out(await _sync_controleschemas(db, obj, body.maintenance or []))
    else:
        item.maintenance = _als_out((await _schemas_van(db, [object_id])).get(object_id, []))
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
