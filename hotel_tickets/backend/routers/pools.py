"""
Zwembaden logboek — CRUD + BAL-compliance status.
"""
import csv
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import PoolLog, PoolId

router = APIRouter(prefix="/pools", tags=["pools"])


# --- Pydantic schemas ---

class PoolLogCreate(BaseModel):
    pool_id: PoolId
    datum: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    tijd: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    doorzicht: Optional[str] = None
    water_temp: Optional[float] = None
    ph: Optional[float] = None
    vbc_in: Optional[float] = None
    vbc_uit: Optional[float] = None
    tbc: Optional[float] = None
    gbc: Optional[float] = None
    ph_automaat: Optional[float] = None
    vbc_automaat: Optional[float] = None
    watermeter: Optional[float] = None
    verbruik: Optional[float] = None
    filterspoeling: bool = False
    bezoekers: Optional[int] = None
    reiniging: bool = False
    flow: Optional[float] = None
    chemicalien: Optional[str] = None
    gemeten_door: str
    notitie: Optional[str] = None


class PoolLogUpdate(BaseModel):
    doorzicht: Optional[str] = None
    water_temp: Optional[float] = None
    ph: Optional[float] = None
    vbc_in: Optional[float] = None
    vbc_uit: Optional[float] = None
    tbc: Optional[float] = None
    gbc: Optional[float] = None
    ph_automaat: Optional[float] = None
    vbc_automaat: Optional[float] = None
    watermeter: Optional[float] = None
    verbruik: Optional[float] = None
    filterspoeling: Optional[bool] = None
    bezoekers: Optional[int] = None
    reiniging: Optional[bool] = None
    flow: Optional[float] = None
    chemicalien: Optional[str] = None
    gemeten_door: Optional[str] = None
    notitie: Optional[str] = None


class PoolLogOut(PoolLogCreate):
    id: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class PoolStatus(BaseModel):
    pool_id: str
    label: str
    today: str
    measurements_today: int
    compliant: bool  # >= 2 metingen vandaag
    latest: Optional[PoolLogOut] = None


def _row_to_out(row: PoolLog) -> dict:
    return {
        "id": row.id,
        "pool_id": row.pool_id.value if isinstance(row.pool_id, PoolId) else row.pool_id,
        "datum": row.datum,
        "tijd": row.tijd,
        "doorzicht": row.doorzicht,
        "water_temp": row.water_temp,
        "ph": row.ph,
        "vbc_in": row.vbc_in,
        "vbc_uit": row.vbc_uit,
        "tbc": row.tbc,
        "gbc": row.gbc,
        "ph_automaat": row.ph_automaat,
        "vbc_automaat": row.vbc_automaat,
        "watermeter": row.watermeter,
        "verbruik": row.verbruik,
        "filterspoeling": row.filterspoeling,
        "bezoekers": row.bezoekers,
        "reiniging": row.reiniging,
        "flow": row.flow,
        "chemicalien": row.chemicalien,
        "gemeten_door": row.gemeten_door,
        "notitie": row.notitie,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


# --- Endpoints ---

POOL_LABELS = {"wellness": "Wellness", "zwembad": "Zwembad"}


@router.get("/status", response_model=list[PoolStatus])
async def pool_status(db: AsyncSession = Depends(get_db)):
    """BAL-compliance status per bad: zijn er vandaag >= 2 metingen?"""
    today_str = date.today().isoformat()
    result = []
    for pid in PoolId:
        count_q = await db.execute(
            select(func.count(PoolLog.id)).where(
                and_(PoolLog.pool_id == pid, PoolLog.datum == today_str)
            )
        )
        count = count_q.scalar() or 0

        latest_q = await db.execute(
            select(PoolLog)
            .where(PoolLog.pool_id == pid)
            .order_by(PoolLog.datum.desc(), PoolLog.tijd.desc())
            .limit(1)
        )
        latest_row = latest_q.scalar_one_or_none()

        result.append(PoolStatus(
            pool_id=pid.value,
            label=POOL_LABELS[pid.value],
            today=today_str,
            measurements_today=count,
            compliant=count >= 2,
            latest=_row_to_out(latest_row) if latest_row else None,
        ))
    return result


@router.get("/logs", response_model=list[PoolLogOut])
async def list_logs(
    pool_id: Optional[str] = Query(None),
    datum_van: Optional[str] = Query(None),
    datum_tot: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(PoolLog).order_by(PoolLog.datum.desc(), PoolLog.tijd.desc())
    if pool_id:
        q = q.where(PoolLog.pool_id == pool_id)
    if datum_van:
        q = q.where(PoolLog.datum >= datum_van)
    if datum_tot:
        q = q.where(PoolLog.datum <= datum_tot)
    q = q.offset(offset).limit(limit)
    rows = await db.execute(q)
    return [_row_to_out(r) for r in rows.scalars().all()]


@router.post("/logs", response_model=PoolLogOut, status_code=201)
async def create_log(data: PoolLogCreate, db: AsyncSession = Depends(get_db)):
    row = PoolLog(**data.model_dump())
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _row_to_out(row)


@router.get("/logs/{log_id}", response_model=PoolLogOut)
async def get_log(log_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(PoolLog, log_id)
    if not row:
        raise HTTPException(404, "Log niet gevonden")
    return _row_to_out(row)


@router.patch("/logs/{log_id}", response_model=PoolLogOut)
async def update_log(log_id: str, data: PoolLogUpdate, db: AsyncSession = Depends(get_db)):
    row = await db.get(PoolLog, log_id)
    if not row:
        raise HTTPException(404, "Log niet gevonden")
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(row, key, val)
    await db.flush()
    await db.refresh(row)
    return _row_to_out(row)


@router.delete("/logs/{log_id}", status_code=204)
async def delete_log(log_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(PoolLog, log_id)
    if not row:
        raise HTTPException(404, "Log niet gevonden")
    await db.delete(row)


@router.post("/import", status_code=201)
async def import_csv(file: UploadFile = File(...), pool_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Importeer historische metingen vanuit CSV (;-gescheiden)."""
    content = (await file.read()).decode("utf-8-sig")
    # Skip HA header lines
    lines = content.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("Datum;"):
            header_idx = i
            break
    if header_idx is None:
        raise HTTPException(400, "Geen geldige header gevonden (verwacht: Datum;Tijd;...)")

    reader = csv.DictReader(lines[header_idx:], delimiter=";")
    count = 0
    for row in reader:
        datum = (row.get("Datum") or "").strip()
        tijd = (row.get("Tijd") or "").strip()
        if not datum or not tijd or datum == "-":
            continue

        def safe_float(key):
            v = (row.get(key) or "").strip()
            if not v or v == "-":
                return None
            try:
                return float(v)
            except ValueError:
                return None

        def safe_int(key):
            v = safe_float(key)
            return int(v) if v is not None else None

        log = PoolLog(
            pool_id=pool_id,
            datum=datum,
            tijd=tijd,
            doorzicht=(row.get("Doorzicht") or "").strip() or None,
            water_temp=safe_float("Water temperatuur"),
            ph=safe_float("pH"),
            vbc_in=safe_float("VBC in"),
            vbc_uit=safe_float("VBC uit"),
            tbc=safe_float("TBC"),
            gbc=safe_float("GBC"),
            ph_automaat=safe_float("pH automaat"),
            vbc_automaat=safe_float("VBC automaat"),
            watermeter=safe_float("Watermeter"),
            verbruik=safe_float("Verbruik"),
            filterspoeling=(row.get("Filterspoeling") or "").strip().upper() == "X",
            bezoekers=safe_int("Aantal bezoekers"),
            reiniging=(row.get("Reiniging") or "").strip().upper() == "X",
            flow=safe_float("Flow"),
            chemicalien=(row.get("Chemicalien") or "").strip() or None,
            gemeten_door=(row.get("Gemeten door") or "").strip() or "onbekend",
            notitie=(row.get("Notitie") or "").strip() or None,
        )
        db.add(log)
        count += 1

    await db.flush()
    return {"imported": count, "pool_id": pool_id}
