from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    Bike, BikeType, BikeStatus,
    BikeReservation, BikeReservationBike, BikeReservationStatus,
    BikeLog, BikeLogCategory, BikeMaintenanceRecord,
)
from ..auth import RequireUser

router = APIRouter(prefix="/bikes", tags=["bikes"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class BikeTypeCreate(BaseModel):
    name: str
    price_per_day: float


class BikeTypeUpdate(BaseModel):
    name: Optional[str] = None
    price_per_day: Optional[float] = None


class BikeCreate(BaseModel):
    number: str
    name: str
    type_id: int
    is_reserve: bool = False
    notes: Optional[str] = None


class BikeUpdate(BaseModel):
    number: Optional[str] = None
    name: Optional[str] = None
    type_id: Optional[int] = None
    is_reserve: Optional[bool] = None
    notes: Optional[str] = None


class BikeLogCreate(BaseModel):
    entry_date: date
    category: str = "note"
    description: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _bike_dict(bike: Bike) -> dict:
    return {
        "id": bike.id,
        "number": bike.number,
        "name": bike.name,
        "type_id": bike.type_id,
        "type_name": bike.bike_type.name if bike.bike_type else None,
        "is_reserve": bike.is_reserve,
        "status": bike.status.value,
        "total_rental_days": bike.total_rental_days,
        "notes": bike.notes,
    }


async def _get_available_bikes(
    db: AsyncSession,
    type_id: int,
    start_date: date,
    end_date: date,
    count: int,
) -> list[Bike]:
    """Geef fietsen van het juiste type terug die vrij zijn in de datumrange, gesorteerd op verhuurdagen (rotatie)."""
    result = await db.execute(
        select(Bike)
        .options(selectinload(Bike.bike_type))
        .where(Bike.type_id == type_id, Bike.status == BikeStatus.available)
        .order_by(Bike.total_rental_days.asc())
    )
    candidates = result.scalars().all()

    available = []
    for bike in candidates:
        conflict = await db.execute(
            select(BikeReservationBike)
            .join(BikeReservation)
            .where(
                BikeReservationBike.bike_id == bike.id,
                BikeReservation.status == BikeReservationStatus.active,
                BikeReservation.start_date <= end_date,
                BikeReservation.end_date >= start_date,
            )
        )
        if not conflict.first():
            available.append(bike)
        if len(available) >= count:
            break

    return available


# ── Bike types ─────────────────────────────────────────────────────────────────

@router.get("/types")
async def list_bike_types(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BikeType).options(selectinload(BikeType.bikes)).order_by(BikeType.name)
    )
    types = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "price_per_day": t.price_per_day,
            "bike_count": len(t.bikes),
        }
        for t in types
    ]


@router.post("/types")
async def create_bike_type(data: BikeTypeCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    bt = BikeType(name=data.name, price_per_day=data.price_per_day)
    db.add(bt)
    await db.flush()
    return {"id": bt.id, "name": bt.name, "price_per_day": bt.price_per_day}


@router.put("/types/{type_id}")
async def update_bike_type(type_id: int, data: BikeTypeUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BikeType).where(BikeType.id == type_id))
    bt = result.scalar_one_or_none()
    if not bt:
        raise HTTPException(404, "Fietstype niet gevonden")
    if data.name is not None:
        bt.name = data.name
    if data.price_per_day is not None:
        bt.price_per_day = data.price_per_day
    return {"id": bt.id, "name": bt.name, "price_per_day": bt.price_per_day}


@router.delete("/types/{type_id}")
async def delete_bike_type(type_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BikeType).options(selectinload(BikeType.bikes)).where(BikeType.id == type_id)
    )
    bt = result.scalar_one_or_none()
    if not bt:
        raise HTTPException(404, "Fietstype niet gevonden")
    if bt.bikes:
        raise HTTPException(400, "Kan fietstype niet verwijderen: er zijn nog fietsen aan gekoppeld")
    await db.delete(bt)
    return {"ok": True}


# ── Bikes ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_bikes(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Bike).options(selectinload(Bike.bike_type)).order_by(Bike.number)
    )
    bikes = result.scalars().all()
    return [_bike_dict(b) for b in bikes]


@router.post("")
async def create_bike(data: BikeCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Bike).where(Bike.number == data.number))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Fietsnummer {data.number} bestaat al")
    bt = await db.execute(select(BikeType).where(BikeType.id == data.type_id))
    if not bt.scalar_one_or_none():
        raise HTTPException(404, "Fietstype niet gevonden")
    bike = Bike(
        number=data.number,
        name=data.name,
        type_id=data.type_id,
        is_reserve=data.is_reserve,
        notes=data.notes,
        status=BikeStatus.available,
        total_rental_days=0,
    )
    db.add(bike)
    await db.flush()
    # Herlaad met relationship zodat _bike_dict bike.bike_type kan lezen
    result2 = await db.execute(
        select(Bike).options(selectinload(Bike.bike_type)).where(Bike.id == bike.id)
    )
    bike = result2.scalar_one()
    return _bike_dict(bike)


@router.put("/{bike_id}")
async def update_bike(bike_id: int, data: BikeUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Bike).options(selectinload(Bike.bike_type)).where(Bike.id == bike_id)
    )
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")
    if data.number is not None:
        dup = await db.execute(select(Bike).where(Bike.number == data.number, Bike.id != bike_id))
        if dup.scalar_one_or_none():
            raise HTTPException(400, f"Fietsnummer {data.number} bestaat al")
        bike.number = data.number
    if data.name is not None:
        bike.name = data.name
    if data.type_id is not None:
        bt = await db.execute(select(BikeType).where(BikeType.id == data.type_id))
        if not bt.scalar_one_or_none():
            raise HTTPException(404, "Fietstype niet gevonden")
        bike.type_id = data.type_id
    if data.is_reserve is not None:
        bike.is_reserve = data.is_reserve
    if data.notes is not None:
        bike.notes = data.notes
    return _bike_dict(bike)


@router.delete("/{bike_id}")
async def delete_bike(bike_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bike).where(Bike.id == bike_id))
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")
    # Controleer actieve reserveringen
    active = await db.execute(
        select(BikeReservationBike)
        .join(BikeReservation)
        .where(
            BikeReservationBike.bike_id == bike_id,
            BikeReservation.status == BikeReservationStatus.active,
            BikeReservation.end_date >= date.today(),
        )
    )
    if active.first():
        raise HTTPException(400, "Fiets heeft nog actieve reserveringen")
    await db.delete(bike)
    return {"ok": True}


# ── Beschikbaarheid ────────────────────────────────────────────────────────────

@router.get("/availability")
async def check_availability(
    start_date: date,
    num_days: int,
    type_id: int,
    count: int = 1,
    user: RequireUser = None,
    db: AsyncSession = Depends(get_db),
):
    end_date = date.fromordinal(start_date.toordinal() + num_days - 1)
    available = await _get_available_bikes(db, type_id, start_date, end_date, count)
    return {
        "available": len(available) >= count,
        "available_count": len(available),
        "requested_count": count,
        "bikes": [_bike_dict(b) for b in available[:count]],
    }


# ── Logboek ────────────────────────────────────────────────────────────────────

@router.get("/{bike_id}/log")
async def get_bike_log(bike_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bike).where(Bike.id == bike_id))
    bike = result.scalar_one_or_none()
    if not bike:
        raise HTTPException(404, "Fiets niet gevonden")

    entries = []

    for rb in bike.reservation_bikes:
        res = rb.reservation
        entries.append({
            "id": None,
            "type": "rental",
            "date": res.start_date.isoformat(),
            "end_date": res.end_date.isoformat(),
            "description": f"Verhuurd aan {res.guest_name}" + (f" (kamer {res.guest_room})" if res.guest_room else ""),
            "meta": f"{res.num_days}d — #{res.id} — {res.status.value}",
            "deletable": False,
        })

    for m in bike.maintenance_records:
        end = m.resolved_at.date().isoformat() if m.resolved_at else (m.expected_end_date.isoformat() if m.expected_end_date else None)
        entries.append({
            "id": None,
            "type": "maintenance",
            "date": m.start_date.isoformat(),
            "end_date": end,
            "description": m.reason or "Onderhoud",
            "meta": "Gereed" if m.resolved_at else "Lopend",
            "ticket_id": m.ticket_id,
            "deletable": False,
        })

    for log in bike.log_entries:
        entries.append({
            "id": log.id,
            "type": log.category.value,
            "date": log.entry_date.isoformat(),
            "end_date": None,
            "description": log.description,
            "meta": None,
            "deletable": True,
        })

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


@router.post("/{bike_id}/log")
async def add_bike_log(bike_id: int, data: BikeLogCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bike).where(Bike.id == bike_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Fiets niet gevonden")
    try:
        category = BikeLogCategory(data.category)
    except ValueError:
        category = BikeLogCategory.note
    entry = BikeLog(
        bike_id=bike_id,
        entry_date=data.entry_date,
        category=category,
        description=data.description.strip(),
    )
    db.add(entry)
    await db.flush()
    return {"id": entry.id, "ok": True}


@router.delete("/{bike_id}/log/{entry_id}")
async def delete_bike_log(bike_id: int, entry_id: int, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BikeLog).where(BikeLog.id == entry_id, BikeLog.bike_id == bike_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Logboek-entry niet gevonden")
    await db.delete(entry)
    return {"ok": True}
