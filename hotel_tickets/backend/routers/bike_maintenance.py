"""
Fiets-onderhoud router.
Bij het starten van onderhoud wordt automatisch een ticket aangemaakt
in de Taken-module voor de technische dienst.
"""
from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    Bike, BikeStatus, BikeMaintenanceRecord,
    BikeReservation, BikeReservationBike, BikeReservationStatus,
    Ticket, Category, Priority, Status,
)
from ..auth import RequireUser
from .bikes import _get_available_bikes

router = APIRouter(prefix="/bike-maintenance", tags=["bike-maintenance"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class MaintenanceStart(BaseModel):
    bike_id: int
    start_date: date
    expected_end_date: Optional[date] = None
    reason: Optional[str] = None
    notes: Optional[str] = None
    conflict_action: str = "move"  # "move" of "cancel"


class MaintenanceResolve(BaseModel):
    bike_id: int


# ── Interne helper: ticket aanmaken ───────────────────────────────────────────

async def _create_maintenance_ticket(
    db: AsyncSession,
    bike: Bike,
    record: BikeMaintenanceRecord,
    created_by: str,
) -> str:
    """Maak een ticket aan voor de technische dienst en koppel het aan het onderhoudsrecord."""
    reason_text = record.reason or "geen reden opgegeven"
    expected = f" (verwachte terugkomst: {record.expected_end_date.strftime('%d-%m-%Y')})" if record.expected_end_date else ""
    type_name = bike.bike_type.name if bike.bike_type else "fiets"

    ticket = Ticket(
        title=f"🚲 Fiets {bike.number} — {reason_text}",
        description=(
            f"**Fiets:** {bike.name} (#{bike.number}) — {type_name}\n"
            f"**Onderhoud gestart:** {record.start_date.strftime('%d-%m-%Y')}{expected}\n\n"
            f"{record.notes or ''}"
        ).strip(),
        category=Category.technical,
        priority=Priority.high,
        created_by=created_by,
    )
    db.add(ticket)
    await db.flush()
    record.ticket_id = ticket.id
    return ticket.id


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/start")
async def start_maintenance(data: MaintenanceStart, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Bike).options(selectinload(Bike.bike_type)).where(Bike.id == data.bike_id)
    )
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")
    if bike.status == BikeStatus.maintenance:
        raise HTTPException(400, "Fiets is al in onderhoud")

    # Zoek conflicterende actieve reserveringen die overlappen met de onderhoudsperiode.
    # Overlap-voorwaarde: res_start <= maint_end  EN  res_end >= maint_start
    maint_end = data.expected_end_date if data.expected_end_date else date(9999, 12, 31)
    conflicts_result = await db.execute(
        select(BikeReservation)
        .options(
            selectinload(BikeReservation.reservation_bikes).selectinload(BikeReservationBike.bike)
        )
        .join(BikeReservationBike)
        .where(
            BikeReservationBike.bike_id == data.bike_id,
            BikeReservation.status == BikeReservationStatus.active,
            BikeReservation.end_date >= data.start_date,
            BikeReservation.start_date <= maint_end,
        )
    )
    conflicts = conflicts_result.scalars().all()

    moved = []
    cancelled = []

    for res in conflicts:
        if data.conflict_action == "move":
            alternatives = await _get_available_bikes(db, res.bike_type_id, res.start_date, res.end_date, 1)
            alternatives = [b for b in alternatives if b.id != data.bike_id]

            if alternatives:
                alt_bike = alternatives[0]
                rb_result = await db.execute(
                    select(BikeReservationBike).where(
                        BikeReservationBike.reservation_id == res.id,
                        BikeReservationBike.bike_id == data.bike_id,
                    )
                )
                rb = rb_result.scalar_one_or_none()
                if rb:
                    bike.total_rental_days = max(0, bike.total_rental_days - res.num_days)
                    alt_bike.total_rental_days += res.num_days
                    rb.bike_id = alt_bike.id
                    moved.append({"reservation_id": res.id, "new_bike": alt_bike.number})
            else:
                for rb in res.reservation_bikes:
                    rb.bike.total_rental_days = max(0, rb.bike.total_rental_days - res.num_days)
                res.status = BikeReservationStatus.cancelled
                cancelled.append({"reservation_id": res.id, "reason": "Geen vervangende fiets beschikbaar"})
        else:
            for rb in res.reservation_bikes:
                rb.bike.total_rental_days = max(0, rb.bike.total_rental_days - res.num_days)
            res.status = BikeReservationStatus.cancelled
            cancelled.append({"reservation_id": res.id, "reason": "Fiets in onderhoud"})

    # Fiets in onderhoud zetten
    bike.status = BikeStatus.maintenance
    record = BikeMaintenanceRecord(
        bike_id=data.bike_id,
        start_date=data.start_date,
        expected_end_date=data.expected_end_date,
        reason=data.reason,
        notes=data.notes,
    )
    db.add(record)
    await db.flush()

    # ── Integratie: automatisch ticket aanmaken ────────────────────────────────
    ticket_id = await _create_maintenance_ticket(db, bike, record, user.ha_user_id)

    return {
        "ok": True,
        "maintenance_record_id": record.id,
        "ticket_id": ticket_id,
        "moved_reservations": moved,
        "cancelled_reservations": cancelled,
    }


@router.post("/resolve")
async def resolve_maintenance(data: MaintenanceResolve, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bike).where(Bike.id == data.bike_id))
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")
    if bike.status != BikeStatus.maintenance:
        raise HTTPException(400, "Fiets is niet in onderhoud")

    # Sluit het openstaande onderhoudsrecord
    open_result = await db.execute(
        select(BikeMaintenanceRecord)
        .where(
            BikeMaintenanceRecord.bike_id == data.bike_id,
            BikeMaintenanceRecord.resolved_at.is_(None),
        )
        .order_by(BikeMaintenanceRecord.start_date.desc())
    )
    open_record = open_result.scalar_one_or_none()
    if open_record:
        open_record.resolved_at = datetime.now(timezone.utc)

        # Sluit ook het gekoppelde ticket als dat nog open staat
        if open_record.ticket_id:
            ticket_result = await db.execute(
                select(Ticket).where(Ticket.id == open_record.ticket_id)
            )
            ticket = ticket_result.scalar_one_or_none()
            if ticket and ticket.status != Status.closed:
                ticket.status = Status.closed
                ticket.closed_at = datetime.now(timezone.utc)
                ticket.closed_by = user.ha_user_id

    bike.status = BikeStatus.available
    return {"ok": True}


@router.get("/conflicts/{bike_id}")
async def check_conflicts(
    bike_id: int,
    start_date: date,
    expected_end_date: Optional[date] = None,
    user: RequireUser = None,
    db: AsyncSession = Depends(get_db),
):
    """Preview welke reserveringen geraakt worden als deze fiets in onderhoud gaat."""
    result = await db.execute(select(Bike).where(Bike.id == bike_id))
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")

    # Overlap-voorwaarde: res_start <= maint_end  EN  res_end >= maint_start
    maint_end = expected_end_date if expected_end_date else date(9999, 12, 31)
    conflicts_result = await db.execute(
        select(BikeReservation)
        .join(BikeReservationBike)
        .where(
            BikeReservationBike.bike_id == bike_id,
            BikeReservation.status == BikeReservationStatus.active,
            BikeReservation.end_date >= start_date,
            BikeReservation.start_date <= maint_end,
        )
    )
    conflicts = conflicts_result.scalars().all()

    output = []
    for res in conflicts:
        alternatives = await _get_available_bikes(db, res.bike_type_id, res.start_date, res.end_date, 1)
        alternatives = [b for b in alternatives if b.id != bike_id]
        output.append({
            "reservation_id": res.id,
            "guest_name": res.guest_name,
            "start_date": res.start_date.isoformat(),
            "end_date": res.end_date.isoformat(),
            "can_move": len(alternatives) > 0,
            "alternative_bike": alternatives[0].number if alternatives else None,
        })
    return output


@router.get("/history/{bike_id}")
async def get_maintenance_history(bike_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bike).where(Bike.id == bike_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Fiets niet gevonden")

    records_result = await db.execute(
        select(BikeMaintenanceRecord)
        .where(BikeMaintenanceRecord.bike_id == bike_id)
        .order_by(BikeMaintenanceRecord.start_date.desc())
    )
    return [
        {
            "id": r.id,
            "start_date": r.start_date.isoformat(),
            "expected_end_date": r.expected_end_date.isoformat() if r.expected_end_date else None,
            "reason": r.reason,
            "notes": r.notes,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
            "ticket_id": r.ticket_id,
        }
        for r in records_result.scalars().all()
    ]
