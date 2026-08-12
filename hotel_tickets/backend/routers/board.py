"""
Het wandscherm: één leesbaar overzicht voor een scherm aan de muur.

Bewust één endpoint dat alles al opgelost teruggeeft — kamernamen en
medewerkersnamen zitten er ingevuld in. Een tablet aan de muur in de
werkplaats hangt op de slechtste wifi van het hotel; vier losse verzoeken per
verversing betekent vier kansen dat het scherm half gevuld blijft staan.

Het scherm toont dezelfde dag als Vandaag: dezelfde herhaaltaken (via
services/vandaag.py) en dezelfde regel dat tickets uit een herhaalsjabloon niet
los meetellen — die staan al als taakregel op het bord.
"""
import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import RequireUser
from ..database import get_db
from ..models import Category, Status, Ticket, TicketComment, UserRole
from ..services.ha_client import get_areas
from ..services.vandaag import herhaaltaken

router = APIRouter(prefix="/board", tags=["board"])

# Hoeveel regels een kolom hoogstens teruggeeft. Een wandscherm dat 80 tickets
# toont is geen wandscherm meer; wie meer wil zien pakt zijn telefoon.
MAX_PER_KOLOM = 30

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
    user: RequireUser,
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
    elif user.department:
        gekozen = [user.department]
    else:
        gekozen = list(Category)

    # Namen één keer ophalen voor alle kolommen samen. Valt Home Assistant weg,
    # dan blijft het bord staan met kamer-ids in plaats van "214" — een half
    # leesbaar bord is beter dan een leeg bord.
    try:
        areas = {a["id"]: a["name"] for a in await get_areas()}
    except Exception:
        areas = {}
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
            "kamers": [areas.get(k) or k for k in t.get("subtask_items", [])]
                      if t.get("subtask_mode") == "rooms" else [],
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
