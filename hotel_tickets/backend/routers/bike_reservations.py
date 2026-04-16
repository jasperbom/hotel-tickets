from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models import (
    Bike, BikeType, BikeReservation, BikeReservationBike,
    BikeReservationStatus, SystemSetting,
)
from ..auth import RequireUser
from .bikes import _get_available_bikes, _bike_dict

router = APIRouter(prefix="/bike-reservations", tags=["bike-reservations"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class BikeReservationCreate(BaseModel):
    guest_name: str
    guest_room: Optional[str] = None
    start_date: date
    num_days: int
    num_bikes: int = 1
    bike_type_id: int
    notes: Optional[str] = None


class BikeReservationUpdate(BaseModel):
    guest_name: Optional[str] = None
    guest_room: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


# ── Helper ─────────────────────────────────────────────────────────────────────

def _reservation_dict(res: BikeReservation) -> dict:
    return {
        "id": res.id,
        "guest_name": res.guest_name,
        "guest_room": res.guest_room,
        "start_date": res.start_date.isoformat(),
        "end_date": res.end_date.isoformat(),
        "num_days": res.num_days,
        "num_bikes": res.num_bikes,
        "bike_type_id": res.bike_type_id,
        "bike_type_name": res.bike_type.name if res.bike_type else None,
        "price_per_day": res.bike_type.price_per_day if res.bike_type else None,
        "total_price": (res.num_days * res.num_bikes * res.bike_type.price_per_day) if res.bike_type else None,
        "status": res.status.value,
        "notes": res.notes,
        "bikes": [
            {"id": rb.bike.id, "number": rb.bike.number, "name": rb.bike.name}
            for rb in res.reservation_bikes
        ],
        "created_at": res.created_at.isoformat() if res.created_at else None,
    }


async def _next_reservation_id(db: AsyncSession) -> int:
    """Houd een aparte teller bij voor reserverings-IDs (start bij 1 tenzij er al data is)."""
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "bike_reservation_counter"))
    counter = result.scalar_one_or_none()
    if counter:
        next_id = int(counter.value)
        counter.value = str(next_id + 1)
    else:
        max_result = await db.execute(select(func.max(BikeReservation.id)))
        last_id = max_result.scalar() or 0
        next_id = last_id + 1
        db.add(SystemSetting(key="bike_reservation_counter", value=str(next_id + 1)))
    return next_id


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
async def list_reservations(
    status: Optional[str] = None,
    user: RequireUser = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(BikeReservation).order_by(BikeReservation.start_date.desc())
    if status:
        try:
            stmt = stmt.where(BikeReservation.status == BikeReservationStatus(status))
        except ValueError:
            pass
    result = await db.execute(stmt)
    return [_reservation_dict(r) for r in result.scalars().all()]


@router.post("")
async def create_reservation(data: BikeReservationCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    # Valideer fietstype
    bt_result = await db.execute(select(BikeType).where(BikeType.id == data.bike_type_id))
    bt = bt_result.scalar_one_or_none()
    if not bt:
        raise HTTPException(404, "Fietstype niet gevonden")
    if data.num_days < 1:
        raise HTTPException(400, "Aantal dagen moet minimaal 1 zijn")
    if data.num_bikes < 1:
        raise HTTPException(400, "Aantal fietsen moet minimaal 1 zijn")

    end_date = date.fromordinal(data.start_date.toordinal() + data.num_days - 1)

    # Beschikbaarheidscheck met rotatie (minste verhuurdagen eerst)
    available = await _get_available_bikes(db, data.bike_type_id, data.start_date, end_date, data.num_bikes)
    if len(available) < data.num_bikes:
        raise HTTPException(
            400,
            f"Niet genoeg fietsen beschikbaar: {len(available)} van {data.num_bikes} gevraagd",
        )

    res_id = await _next_reservation_id(db)
    reservation = BikeReservation(
        id=res_id,
        guest_name=data.guest_name,
        guest_room=data.guest_room,
        start_date=data.start_date,
        end_date=end_date,
        num_days=data.num_days,
        num_bikes=data.num_bikes,
        bike_type_id=data.bike_type_id,
        status=BikeReservationStatus.active,
        notes=data.notes,
    )
    db.add(reservation)
    await db.flush()

    for bike in available[: data.num_bikes]:
        db.add(BikeReservationBike(reservation_id=reservation.id, bike_id=bike.id))
        bike.total_rental_days += data.num_days

    await db.flush()
    await db.refresh(reservation)
    return _reservation_dict(reservation)


@router.get("/{reservation_id}")
async def get_reservation(reservation_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BikeReservation).where(BikeReservation.id == reservation_id))
    res = result.scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Reservering niet gevonden")
    return _reservation_dict(res)


@router.put("/{reservation_id}")
async def update_reservation(
    reservation_id: int,
    data: BikeReservationUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BikeReservation).where(BikeReservation.id == reservation_id))
    res = result.scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Reservering niet gevonden")
    if data.guest_name is not None:
        res.guest_name = data.guest_name
    if data.guest_room is not None:
        res.guest_room = data.guest_room
    if data.notes is not None:
        res.notes = data.notes
    if data.status is not None:
        try:
            res.status = BikeReservationStatus(data.status)
        except ValueError:
            raise HTTPException(400, f"Ongeldige status: {data.status}")
    return _reservation_dict(res)


@router.delete("/{reservation_id}")
async def cancel_reservation(reservation_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BikeReservation).where(BikeReservation.id == reservation_id))
    res = result.scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Reservering niet gevonden")
    if res.status == BikeReservationStatus.cancelled:
        raise HTTPException(400, "Reservering is al geannuleerd")

    for rb in res.reservation_bikes:
        rb.bike.total_rental_days = max(0, rb.bike.total_rental_days - res.num_days)

    res.status = BikeReservationStatus.cancelled
    return {"ok": True}
