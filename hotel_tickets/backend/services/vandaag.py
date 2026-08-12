"""
Wat staat er vandaag aan herhalende taken?

Deze berekening stond in het startscherm (`/users/me/overview`) en is hier
weggehaald zodat het wandscherm precies hetzelfde ziet. Twee schermen die
allebei "vandaag" tonen maar het los uitrekenen, lopen vroeg of laat uit
elkaar — en dan wijst het scherm in de werkplaats een taak aan die op de
telefoon van de monteur al weg is.
"""
import json
from datetime import date, datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Category, RecurringTemplate, Status, Ticket


def template_dict(t: RecurringTemplate, next_run: datetime, active_ticket: "Ticket | None" = None) -> dict:
    result = {
        "id": t.id,
        "title": t.title,
        "category": t.category,
        "priority": t.priority,
        "location_id": t.location_id,
        "nfc_tag_id": t.nfc_tag_id,
        "next_run": next_run.isoformat(),
        # Herhaalpatroon mee, zodat de rij op Vandaag "elke wo" in de metaregel
        # kan zetten in plaats van een aparte sectie met een 🔁-icoon.
        "cron_expression": t.cron_expression,
        "interval_days": t.interval_days,
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


async def herhaaltaken(
    db: AsyncSession, dept: Category | None
) -> tuple[list[dict], list[dict]]:
    """Geeft (vandaag, aankomend) terug — aankomend gesorteerd op tijd.

    `dept` = None betekent alle afdelingen. De caller bepaalt zelf hoeveel
    aankomende taken hij toont.
    """
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
                upcoming_recurring.append((nd_naive, template_dict(t, nd_naive)))
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
                    today_recurring.append(template_dict(t, next_run, active_by_template.get(t.id)))

                # Voor upcoming: toon de volgende uitvoering na vandaag als vandaag al afgerond
                if all_done:
                    future_run = _next_run_for(t, datetime.now())
                    upcoming_recurring.append((future_run, template_dict(t, future_run)))
                else:
                    upcoming_recurring.append((next_run, template_dict(t, next_run)))
            elif has_open:
                # Open ticket van vorige run, volgende uitvoering nog niet vandaag → toon als verlopen taak
                active_ticket = active_by_template[t.id]
                today_recurring.append(template_dict(t, active_ticket.created_at, active_ticket))
                # Niet toevoegen aan upcoming: al zichtbaar als verlopen in today_recurring
            else:
                upcoming_recurring.append((next_run, template_dict(t, next_run)))
        except Exception:
            pass

    upcoming_recurring.sort(key=lambda x: x[0])
    return today_recurring, [item for _, item in upcoming_recurring]
