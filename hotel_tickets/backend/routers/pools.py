"""
Zwembaden logboek — CRUD + BAL-compliance status.
"""
import csv
import io
import logging
import zipfile
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import RequireUser
from ..database import get_db
from ..models import PoolLog, PoolId, PoolConfig, PoolIncident, UserRole, Role
from ..services.notifications import notify_push, notify_persistent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pools", tags=["pools"])


# --- Bewakingswaardes: harde grenzen waarbinnen metingen moeten vallen ---
BEWAKING = {
    "ph": (4.00, 9.00),
    "vbc_in": (0.00, 2.00),
    "vbc_uit": (0.00, 2.00),
    "tbc": (0.00, 2.50),
}


def _check_bewaking(data: dict) -> None:
    """Valideer dat gemeten waardes binnen de bewakingsgrenzen vallen."""
    for key, (lo, hi) in BEWAKING.items():
        val = data.get(key)
        if val is None:
            continue
        if val < lo or val > hi:
            raise HTTPException(
                status_code=422,
                detail=f"{key.upper()} {val} valt buiten bewakingsgrens ({lo}–{hi})",
            )


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
    filterspoeling: Optional[str] = None
    bezoekers: Optional[int] = None
    reiniging: bool = False
    flow: Optional[float] = None
    chemicalien: Optional[str] = None
    gemeten_door: str
    notitie: Optional[str] = None


class PoolLogUpdate(BaseModel):
    datum: Optional[str] = None
    tijd: Optional[str] = None
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
    filterspoeling: Optional[str] = None
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


def _has_measurement_filter():
    """SQL-filter: log telt als 'echte meting' als minstens één meetwaarde gevuld is.
    Logs met alleen chemicaliën, filterspoeling of notitie tellen niet mee."""
    return or_(
        PoolLog.water_temp.isnot(None),
        PoolLog.doorzicht.isnot(None),
        PoolLog.ph.isnot(None),
        PoolLog.vbc_in.isnot(None),
        PoolLog.vbc_uit.isnot(None),
        PoolLog.tbc.isnot(None),
        PoolLog.gbc.isnot(None),
        PoolLog.ph_automaat.isnot(None),
        PoolLog.vbc_automaat.isnot(None),
        PoolLog.watermeter.isnot(None),
        PoolLog.verbruik.isnot(None),
        PoolLog.flow.isnot(None),
        PoolLog.bezoekers.isnot(None),
    )


@router.get("/status", response_model=list[PoolStatus])
async def pool_status(db: AsyncSession = Depends(get_db)):
    """BAL-compliance status per bad: zijn er vandaag >= 2 metingen?"""
    today_str = date.today().isoformat()
    result = []
    for pid in PoolId:
        count_q = await db.execute(
            select(func.count(PoolLog.id)).where(
                and_(
                    PoolLog.pool_id == pid,
                    PoolLog.datum == today_str,
                    _has_measurement_filter(),
                )
            )
        )
        count = count_q.scalar() or 0

        latest_q = await db.execute(
            select(PoolLog)
            .where(and_(PoolLog.pool_id == pid, _has_measurement_filter()))
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
    only_measurements: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    q = select(PoolLog).order_by(PoolLog.datum.desc(), PoolLog.tijd.desc())
    if pool_id:
        q = q.where(PoolLog.pool_id == pool_id)
    if datum_van:
        q = q.where(PoolLog.datum >= datum_van)
    if datum_tot:
        q = q.where(PoolLog.datum <= datum_tot)
    if only_measurements:
        q = q.where(_has_measurement_filter())
    q = q.offset(offset).limit(limit)
    rows = await db.execute(q)
    return [_row_to_out(r) for r in rows.scalars().all()]


@router.post("/logs", response_model=PoolLogOut, status_code=201)
async def create_log(data: PoolLogCreate, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump()
    _check_bewaking(payload)
    row = PoolLog(**payload)
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
    updates = data.model_dump(exclude_unset=True)
    _check_bewaking(updates)
    for key, val in updates.items():
        setattr(row, key, val)
    await db.flush()
    await db.refresh(row)
    return _row_to_out(row)


@router.delete("/logs/{log_id}", status_code=204)
async def delete_log(
    log_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(403, "Alleen admins mogen logregels verwijderen")
    row = await db.get(PoolLog, log_id)
    if not row:
        raise HTTPException(404, "Log niet gevonden")
    await db.delete(row)


CSV_HEADER = [
    "Datum", "Tijd", "Doorzicht", "Water temperatuur", "pH",
    "VBC in", "VBC uit", "TBC", "GBC", "pH automaat", "VBC automaat",
    "Watermeter", "Verbruik", "Filterspoeling", "Aantal bezoekers",
    "Reiniging", "Flow", "Chemicalien", "Gemeten door", "Notitie",
]


def _write_csv(logs: list[PoolLog]) -> bytes:
    """Schrijf een lijst PoolLog-rijen naar CSV-bytes (;-gescheiden, UTF-8-sig)."""
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(CSV_HEADER)
    for log in logs:
        writer.writerow([
            log.datum,
            log.tijd,
            log.doorzicht or "",
            log.water_temp if log.water_temp is not None else "",
            log.ph if log.ph is not None else "",
            log.vbc_in if log.vbc_in is not None else "",
            log.vbc_uit if log.vbc_uit is not None else "",
            log.tbc if log.tbc is not None else "",
            log.gbc if log.gbc is not None else "",
            log.ph_automaat if log.ph_automaat is not None else "",
            log.vbc_automaat if log.vbc_automaat is not None else "",
            log.watermeter if log.watermeter is not None else "",
            log.verbruik if log.verbruik is not None else "",
            log.filterspoeling or "",
            log.bezoekers if log.bezoekers is not None else "",
            "X" if log.reiniging else "",
            log.flow if log.flow is not None else "",
            log.chemicalien or "",
            log.gemeten_door,
            log.notitie or "",
        ])
    return output.getvalue().encode("utf-8-sig")


@router.get("/export/csv")
async def export_csv(
    pool_id: Optional[str] = Query(None),
    datum_van: Optional[str] = Query(None),
    datum_tot: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Exporteer metingen als CSV per bad. Zonder pool_id: ZIP met los bestand per bad."""
    def _build_query(pid: str):
        q = select(PoolLog).where(PoolLog.pool_id == pid)
        q = q.order_by(PoolLog.datum.desc(), PoolLog.tijd.desc())
        if datum_van:
            q = q.where(PoolLog.datum >= datum_van)
        if datum_tot:
            q = q.where(PoolLog.datum <= datum_tot)
        return q

    if pool_id:
        rows = await db.execute(_build_query(pool_id))
        content = _write_csv(rows.scalars().all())
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=logboek_{pool_id}.csv"},
        )

    # Geen pool_id: ZIP met een CSV per bad
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for pid in PoolId:
            rows = await db.execute(_build_query(pid.value))
            csv_bytes = _write_csv(rows.scalars().all())
            zf.writestr(f"logboek_{pid.value}.csv", csv_bytes)
    zip_buf.seek(0)
    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=logboek_export.zip"},
    )


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

    def safe_float(row, key):
        v = (row.get(key) or "").strip()
        if not v or v == "-":
            return None
        try:
            return float(v)
        except ValueError:
            return None

    def safe_int(row, key):
        v = safe_float(row, key)
        return int(v) if v is not None else None

    count = 0
    skipped = 0
    filter_rows: list[tuple[str, str]] = []  # (datum, filterspoeling_val)

    for row in reader:
        datum = (row.get("Datum") or "").strip()
        tijd = (row.get("Tijd") or "").strip()
        if not datum or datum == "-":
            continue

        filterspoeling_val = (row.get("Filterspoeling") or "").strip().upper()
        filterspoeling_val = filterspoeling_val if filterspoeling_val in ("X", "L", "R") else None

        # Filter-only row: has datum but no tijd
        if not tijd:
            if filterspoeling_val:
                filter_rows.append((datum, filterspoeling_val))
            continue

        # Deduplicatie: skip als meting met zelfde pool+datum+tijd al bestaat
        existing = await db.execute(
            select(PoolLog.id).where(
                and_(PoolLog.pool_id == pool_id, PoolLog.datum == datum, PoolLog.tijd == tijd)
            ).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            skipped += 1
            continue

        log = PoolLog(
            pool_id=pool_id,
            datum=datum,
            tijd=tijd,
            doorzicht=(row.get("Doorzicht") or "").strip() or None,
            water_temp=safe_float(row, "Water temperatuur"),
            ph=safe_float(row, "pH"),
            vbc_in=safe_float(row, "VBC in"),
            vbc_uit=safe_float(row, "VBC uit"),
            tbc=safe_float(row, "TBC"),
            gbc=safe_float(row, "GBC"),
            ph_automaat=safe_float(row, "pH automaat"),
            vbc_automaat=safe_float(row, "VBC automaat"),
            watermeter=safe_float(row, "Watermeter"),
            verbruik=safe_float(row, "Verbruik"),
            filterspoeling=filterspoeling_val,
            bezoekers=safe_int(row, "Aantal bezoekers"),
            reiniging=(row.get("Reiniging") or "").strip().upper() == "X",
            flow=safe_float(row, "Flow"),
            chemicalien=(row.get("Chemicalien") or "").strip() or None,
            gemeten_door=(row.get("Gemeten door") or "").strip() or "onbekend",
            notitie=(row.get("Notitie") or "").strip() or None,
        )
        db.add(log)
        count += 1

    await db.flush()

    # Merge filter-only rows into the latest measurement on the same date
    for f_datum, fs_val in filter_rows:
        result = await db.execute(
            select(PoolLog).where(
                and_(PoolLog.pool_id == pool_id, PoolLog.datum == f_datum)
            ).order_by(PoolLog.tijd.desc()).limit(1)
        )
        target = result.scalar_one_or_none()
        if target:
            target.filterspoeling = fs_val
        else:
            # No measurement for this date — create minimal entry
            db.add(PoolLog(
                pool_id=pool_id,
                datum=f_datum,
                tijd="00:00",
                filterspoeling=fs_val,
                gemeten_door="import",
            ))
            count += 1

    await db.flush()
    return {"imported": count, "skipped": skipped, "pool_id": pool_id}


@router.delete("/logs", status_code=200)
async def reset_logs(
    pool_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Verwijder alle metingen, optioneel gefilterd op bad."""
    q = select(PoolLog)
    if pool_id:
        q = q.where(PoolLog.pool_id == pool_id)
    rows = await db.execute(q)
    logs = rows.scalars().all()
    count = len(logs)
    for log in logs:
        await db.delete(log)
    await db.flush()
    return {"deleted": count}


# --- Pool configuratie ---

class PoolConfigOut(BaseModel):
    pool_id: str
    label: str
    filter_nfc_tag_id: Optional[str] = None
    filter_nfc_tag_id_r: Optional[str] = None
    chloor_nfc_tag_id: Optional[str] = None
    zuur_nfc_tag_id: Optional[str] = None
    vlokmiddel_nfc_tag_id: Optional[str] = None
    filter_template_id: Optional[str] = None
    filter_template_id_r: Optional[str] = None
    chloor_template_id: Optional[str] = None
    zuur_template_id: Optional[str] = None
    vlokmiddel_template_id: Optional[str] = None

    class Config:
        from_attributes = True


class PoolConfigUpdate(BaseModel):
    label: Optional[str] = None
    filter_nfc_tag_id: Optional[str] = None
    filter_nfc_tag_id_r: Optional[str] = None
    chloor_nfc_tag_id: Optional[str] = None
    zuur_nfc_tag_id: Optional[str] = None
    vlokmiddel_nfc_tag_id: Optional[str] = None
    filter_template_id: Optional[str] = None
    filter_template_id_r: Optional[str] = None
    chloor_template_id: Optional[str] = None
    zuur_template_id: Optional[str] = None
    vlokmiddel_template_id: Optional[str] = None


@router.get("/config", response_model=list[PoolConfigOut])
async def list_configs(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(PoolConfig))
    return [r for r in rows.scalars().all()]


@router.patch("/config/{pool_id}", response_model=PoolConfigOut)
async def update_config(pool_id: str, data: PoolConfigUpdate, db: AsyncSession = Depends(get_db)):
    row = await db.get(PoolConfig, pool_id)
    if not row:
        raise HTTPException(404, "Pool config niet gevonden")
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(row, key, val)
    await db.flush()
    await db.refresh(row)
    return row


# --- Ongewone voorvallen ---

class PoolIncidentCreate(BaseModel):
    pool_id: PoolId
    datum: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    tijd: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    beschrijving: str = Field(..., min_length=1)
    maatregelen: Optional[str] = None


class PoolIncidentOut(BaseModel):
    id: str
    pool_id: str
    datum: str
    tijd: str
    beschrijving: str
    maatregelen: Optional[str]
    gemeld_door: str
    created_at: str

    class Config:
        from_attributes = True


def _incident_to_out(row: PoolIncident) -> dict:
    return {
        "id": row.id,
        "pool_id": row.pool_id.value if isinstance(row.pool_id, PoolId) else row.pool_id,
        "datum": row.datum,
        "tijd": row.tijd,
        "beschrijving": row.beschrijving,
        "maatregelen": row.maatregelen,
        "gemeld_door": row.gemeld_door,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


@router.get("/incidents", response_model=list[PoolIncidentOut])
async def list_incidents(
    pool_id: Optional[str] = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(PoolIncident).order_by(PoolIncident.datum.desc(), PoolIncident.tijd.desc())
    if pool_id:
        q = q.where(PoolIncident.pool_id == pool_id)
    q = q.limit(limit)
    rows = await db.execute(q)
    return [_incident_to_out(r) for r in rows.scalars().all()]


@router.post("/incidents", response_model=PoolIncidentOut, status_code=201)
async def create_incident(
    data: PoolIncidentCreate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    row = PoolIncident(
        pool_id=data.pool_id,
        datum=data.datum,
        tijd=data.tijd,
        beschrijving=data.beschrijving,
        maatregelen=data.maatregelen,
        gemeld_door=user.display_name or user.ha_user_id,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)

    # Notificeer admins: push + persistent
    pool_label = POOL_LABELS.get(data.pool_id.value, data.pool_id.value)
    title = f"⚠️ Ongewoon voorval — {pool_label}"
    short = data.beschrijving if len(data.beschrijving) <= 160 else data.beschrijving[:157] + "..."
    message = f"{short}\nGemeld door: {row.gemeld_door}"

    try:
        admins_q = await db.execute(
            select(UserRole).where(
                and_(
                    UserRole.role == Role.admin,
                    UserRole.notify_push == True,
                    UserRole.ha_notify_service.isnot(None),
                )
            )
        )
        for admin in admins_q.scalars().all():
            if admin.ha_notify_service:
                await notify_push(admin.ha_notify_service, title, message)
        await notify_persistent(title, message, notification_id=f"pool_incident_{row.id}")
    except Exception as exc:
        logger.warning("Admin notificatie voor ongewoon voorval mislukt: %s", exc)

    return _incident_to_out(row)


@router.delete("/incidents/{incident_id}", status_code=204)
async def delete_incident(
    incident_id: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(403, "Alleen admins mogen voorvallen verwijderen")
    row = await db.get(PoolIncident, incident_id)
    if not row:
        raise HTTPException(404, "Voorval niet gevonden")
    await db.delete(row)
