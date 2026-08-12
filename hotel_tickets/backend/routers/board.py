"""
Het wandscherm: één leesbaar overzicht voor een scherm aan de muur.

Bewust één endpoint dat alles al opgelost teruggeeft — kamernamen en
medewerkersnamen zitten er ingevuld in. Een tablet aan de muur in de
werkplaats hangt op de slechtste wifi van het hotel; vier losse verzoeken per
verversing betekent vier kansen dat het scherm half gevuld blijft staan.

Het scherm toont dezelfde dag als Vandaag: dezelfde herhaaltaken (via
services/vandaag.py) en dezelfde regel dat tickets uit een herhaalsjabloon niet
los meetellen — die staan al als taakregel op het bord.

Toegang kan op twee manieren:
  * een gewone ingelogde medewerker die het bord even bekijkt;
  * een kioskcode in de URL, voor een scherm dat niet kan inloggen (een
    Chromecast, een TV-stick, een tablet die niemand elke maand aanraakt).
    Die code geeft uitsluitend leestoegang tot dit ene endpoint.
"""
import hashlib
import json
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser, RequireUser, get_current_user
from ..database import get_db
from ..models import BoardKey, Category, Role, Status, Ticket, TicketComment, UserRole
from ..services.ha_client import get_areas, get_keycard_states
from ..services.vandaag import herhaaltaken

router = APIRouter(prefix="/board", tags=["board"])

# Hoeveel regels een kolom hoogstens teruggeeft. Een wandscherm dat 80 tickets
# toont is geen wandscherm meer; wie meer wil zien pakt zijn telefoon.
MAX_PER_KOLOM = 30

# Herkenbaar aan de voorkant, zodat een code in een logregel of een URL meteen
# thuis te brengen is.
KIOSK_PREFIX = "hbk."

# Niet bij elke verversing schrijven: een scherm haalt het bord elke 30
# seconden op, en "voor het laatst gezien" hoeft niet op de seconde te kloppen.
LAST_SEEN_THROTTLE = timedelta(minutes=5)

AFDELING_LABELS: dict[Category, str] = {
    Category.technical: "Technische dienst",
    Category.housekeeping: "Huishouding",
    Category.reception: "Receptie",
    Category.service: "Bediening",
    Category.kitchen: "Keuken",
    Category.sales: "Sales",
    Category.garden: "Tuin",
}

_PRIORITEIT_SORT = case(
    (Ticket.priority == "urgent", 0),
    (Ticket.priority == "high", 1),
    (Ticket.priority == "medium", 2),
    (Ticket.priority == "low", 3),
    else_=4,
)


def _hash_key(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


async def _kiosk_key(db: AsyncSession, code: str, ip: str | None) -> BoardKey | None:
    """Zoek de kioskcode op en stempel 'voor het laatst gezien'."""
    if not code.startswith(KIOSK_PREFIX):
        return None
    result = await db.execute(select(BoardKey).where(BoardKey.key_hash == _hash_key(code)))
    key = result.scalar_one_or_none()
    if not key:
        return None
    nu = datetime.now(timezone.utc)
    laatst = key.last_seen_at
    if laatst is not None and laatst.tzinfo is None:
        laatst = laatst.replace(tzinfo=timezone.utc)
    if laatst is None or nu - laatst > LAST_SEEN_THROTTLE:
        key.last_seen_at = nu
        key.last_ip = ip
    return key


async def board_kijker(
    request: Request,
    sleutel: str | None = Query(None, description="Kioskcode van een scherm dat niet kan inloggen"),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser | None:
    """Wie mag het bord zien: een medewerker, of een scherm met een kioskcode.

    Geeft None terug voor een kioskscherm — dat heeft geen eigen afdeling, dus
    dan moet de URL zeggen welke afdelingen erop staan.
    """
    if sleutel:
        if await _kiosk_key(db, sleutel, request.client.host if request.client else None):
            return None
        raise HTTPException(status_code=401, detail="Onbekende kioskcode")
    return await get_current_user(request, db)


def _subtaak_fractie(ticket: Ticket) -> tuple[int, int] | None:
    if not ticket.subtasks:
        return None
    try:
        items = json.loads(ticket.subtasks)
    except Exception:
        return None
    if not items:
        return None
    return sum(1 for s in items if s.get("done")), len(items)


@router.get("")
async def get_board(
    kijker: CurrentUser | None = Depends(board_kijker),
    db: AsyncSession = Depends(get_db),
    afdelingen: str | None = Query(
        None,
        description="Komma-gescheiden afdelingen; leeg = de afdeling van de "
                    "ingelogde medewerker, 'all' = alle afdelingen.",
    ),
):
    """Alles wat één scherm aan de muur moet tonen, in één verzoek."""
    # Welke kolommen? Het scherm hangt op een vaste plek en toont een vaste
    # keuze — die staat daarom in de URL, niet in een gebruikersinstelling.
    if afdelingen == "all":
        gekozen = list(Category)
    elif afdelingen:
        gekozen = []
        for deel in afdelingen.split(","):
            deel = deel.strip()
            if not deel:
                continue
            try:
                cat = Category(deel)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Onbekende afdeling: {deel}")
            if cat not in gekozen:
                gekozen.append(cat)
        if not gekozen:
            gekozen = list(Category)
    elif kijker is not None and kijker.department:
        gekozen = [kijker.department]
    else:
        gekozen = list(Category)

    # Namen één keer ophalen voor alle kolommen samen. Valt Home Assistant weg,
    # dan blijft het bord staan met kamer-ids in plaats van "214" — een half
    # leesbaar bord is beter dan een leeg bord.
    try:
        areas = {a["id"]: a["name"] for a in await get_areas()}
    except Exception:
        areas = {}
    # Bezetting van de kamers, ook in één keer. Valt hij weg, dan staat er bij
    # geen enkele kamer iets — een bord dat "vrij" zegt op grond van een sensor
    # die niet antwoordde, stuurt iemand voor niets naar boven.
    try:
        bezetting = await get_keycard_states()
    except Exception:
        bezetting = {}
    medewerkers = {
        u.ha_user_id: u.display_name
        for u in (await db.execute(select(UserRole))).scalars().all()
    }

    vandaag = date.today()
    dag_start = datetime.combine(vandaag, datetime.min.time()).replace(tzinfo=timezone.utc)

    kolommen = []
    for cat in gekozen:
        # Werk dat er ligt: open en in behandeling. Tickets uit een
        # herhaalsjabloon niet los tonen — die staan al als taakregel.
        rows = (await db.execute(
            select(Ticket).where(and_(
                Ticket.category == cat,
                Ticket.status != Status.closed,
                Ticket.recurring_template_id.is_(None),
            )).order_by(_PRIORITEIT_SORT, Ticket.created_at)
        )).scalars().all()

        zichtbaar = rows[:MAX_PER_KOLOM]

        commentaren: dict[str, int] = {}
        if zichtbaar:
            cc = await db.execute(
                select(TicketComment.ticket_id, func.count(TicketComment.id))
                .where(TicketComment.ticket_id.in_([t.id for t in zichtbaar]))
                .group_by(TicketComment.ticket_id)
            )
            commentaren = {tid: aantal for tid, aantal in cc.all()}

        tickets = []
        for t in zichtbaar:
            fractie = _subtaak_fractie(t)
            tickets.append({
                "id": t.id,
                "title": t.title,
                "priority": t.priority,
                "status": t.status,
                "kamer": areas.get(t.location_id) or t.location_id,
                "kamer_bezet": bezetting.get(t.location_id) if t.location_id else None,
                "toegewezen_aan": medewerkers.get(t.assigned_to) if t.assigned_to else None,
                "created_at": t.created_at.isoformat(),
                "comment_count": commentaren.get(t.id, 0),
                "subtask_done": fractie[0] if fractie else None,
                "subtask_total": fractie[1] if fractie else None,
            })

        taken_vandaag, _ = await herhaaltaken(db, cat)
        taken = [{
            "id": t["id"],
            "title": t["title"],
            "priority": t["priority"],
            "emoji": t.get("emoji"),
            "kamer": areas.get(t.get("location_id")) or t.get("location_id"),
            "kamer_bezet": bezetting.get(t["location_id"]) if t.get("location_id") else None,
            # Naam én bezetting per kamer: op het bord kleurt elke kamer van
            # een schoonmaakronde apart, net als in de app.
            "kamers": [
                {"naam": areas.get(k) or k, "bezet": bezetting.get(k)}
                for k in t.get("subtask_items", [])
            ] if t.get("subtask_mode") == "rooms" else [],
            "subtask_done": t.get("subtask_done"),
            "subtask_total": t.get("subtask_total"),
        } for t in taken_vandaag]

        urgent = sum(1 for t in rows if t.priority == "urgent")
        afgerond_vandaag = await db.scalar(
            select(func.count()).where(and_(
                Ticket.category == cat,
                Ticket.status == Status.closed,
                Ticket.closed_at >= dag_start,
            ))
        )

        kolommen.append({
            "afdeling": cat.value,
            "label": AFDELING_LABELS.get(cat, cat.value),
            "tickets": tickets,
            "verborgen": max(0, len(rows) - len(zichtbaar)),
            "taken": taken,
            "tellers": {
                "open": len(rows),
                "urgent": urgent,
                "afgerond_vandaag": afgerond_vandaag or 0,
            },
        })

    return {
        "gegenereerd_op": datetime.now(timezone.utc).isoformat(),
        "kolommen": kolommen,
    }


# ── Kioskcodes beheren (admin) ───────────────────────────────────────────────

class BoardKeyCreate(BaseModel):
    label: str


def _require_admin(user: CurrentUser) -> None:
    if user.role != Role.admin:
        raise HTTPException(403, "Alleen admins beheren kioskcodes")


def _key_dict(k: BoardKey) -> dict:
    return {
        "id": k.id,
        "label": k.label,
        "created_at": k.created_at.isoformat(),
        "created_by": k.created_by,
        "last_seen_at": k.last_seen_at.isoformat() if k.last_seen_at else None,
        "last_ip": k.last_ip,
    }


@router.get("/keys")
async def list_keys(user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    rows = (await db.execute(select(BoardKey).order_by(BoardKey.created_at))).scalars().all()
    return [_key_dict(k) for k in rows]


@router.post("/keys")
async def create_key(data: BoardKeyCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Maak een kioskcode aan. De code komt hier één keer terug en nooit meer."""
    _require_admin(user)
    label = data.label.strip()
    if not label:
        raise HTTPException(422, "Geef het scherm een naam, bijvoorbeeld 'Werkplaats'")

    code = KIOSK_PREFIX + secrets.token_urlsafe(32)
    key = BoardKey(label=label, key_hash=_hash_key(code), created_by=user.ha_user_id)
    db.add(key)
    await db.flush()
    return {**_key_dict(key), "code": code}


@router.delete("/keys/{key_id}")
async def delete_key(key_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    result = await db.execute(select(BoardKey).where(BoardKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Kioskcode bestaat niet")
    await db.delete(key)
    return {"ok": True}
