"""
Fiets-admin router: Excel-import van historische reserveringsdata.
Accepteert een geüpload .xlsx-bestand (Fietsverhuur formaat).
"""
import asyncio
import io
import re
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..models import (
    Bike, BikeReservation, BikeReservationBike,
    BikeReservationStatus, SystemSetting,
)
from ..auth import RequireUser

router = APIRouter(prefix="/bike-admin", tags=["bike-admin"])

# Dutch month names → month number
MONTH_MAP = {
    "JANUARI": 1, "FEBRUARI": 2, "MAART": 3, "APRIL": 4,
    "MEI": 5, "JUNI": 6, "JULI": 7, "AUGUSTUS": 8,
    "SEPTEMBER": 9, "OKTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12,
}

SKIP_VALUES = {"onderhoud", "x", "reserve", ""}


def _extract_bike_number(header_text: str) -> str | None:
    if not header_text:
        return None
    m = re.search(r"fiets\s+(\d+)", str(header_text).lower())
    return m.group(1) if m else None


def _normalize_name(name) -> str | None:
    if name is None:
        return None
    s = str(name).strip()
    if not s or s.lower() in SKIP_VALUES:
        return None
    return s


def _parse_sections(ws) -> list[dict]:
    rows = list(ws.iter_rows(min_row=1, values_only=True))
    sections = []
    section_starts = []
    for i, row in enumerate(rows):
        if row and len(row) > 1 and isinstance(row[1], datetime):
            section_starts.append(i)

    for sec_idx, start in enumerate(section_starts):
        dt: datetime = rows[start][1]
        year, month = dt.year, dt.month

        header_row_idx = start + 2
        if header_row_idx >= len(rows):
            continue
        header_row = rows[header_row_idx]

        col_map: dict[int, str] = {}
        if header_row:
            for col_i, cell in enumerate(header_row):
                num = _extract_bike_number(cell)
                if num:
                    col_map[col_i] = num

        if not col_map:
            continue

        data_start = header_row_idx + 1
        data_end = section_starts[sec_idx + 1] if sec_idx + 1 < len(section_starts) else len(rows)

        data_rows = []
        for row_i in range(data_start, data_end):
            row = rows[row_i]
            if row and len(row) > 1 and isinstance(row[1], int):
                data_rows.append((row[1], row))

        sections.append({
            "year": year,
            "month": month,
            "col_map": col_map,
            "data_rows": data_rows,
        })
    return sections


def _extract_segments(data_rows: list, col_idx: int) -> list[dict]:
    segments = []
    current = None
    for day, row in data_rows:
        name = _normalize_name(row[col_idx]) if col_idx < len(row) else None
        if name and current and name.lower() == current["guest_name"].lower():
            current["end_day"] = day
        elif name:
            if current:
                segments.append(current)
            current = {"start_day": day, "end_day": day, "guest_name": name}
        else:
            if current:
                segments.append(current)
            current = None
    if current:
        segments.append(current)
    return segments


def _parse_excel(file_bytes: bytes) -> tuple[list[dict], list[str]]:
    """Parse Excel bytes → lijst van reservation-dicts + foutmeldingen. Synchrone functie."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    results = []
    errors = []
    today = date.today()

    for sheet_name in wb.sheetnames:
        if sheet_name == "Blad2":
            continue
        ws = wb[sheet_name]
        sections = _parse_sections(ws)

        for section in sections:
            year = section["year"]
            month = section["month"]
            col_map = section["col_map"]
            data_rows = section["data_rows"]

            for col_idx, bike_number in col_map.items():
                segments = _extract_segments(data_rows, col_idx)
                for seg in segments:
                    try:
                        start_date = date(year, month, int(seg["start_day"]))
                        end_date = date(year, month, int(seg["end_day"]))
                    except (ValueError, OverflowError) as e:
                        errors.append(f"Ongeldige datum in {sheet_name}: {e}")
                        continue
                    num_days = (end_date - start_date).days + 1
                    status = (
                        BikeReservationStatus.completed
                        if end_date < today
                        else BikeReservationStatus.active
                    )
                    results.append({
                        "bike_number": bike_number,
                        "guest_name": seg["guest_name"],
                        "start_date": start_date,
                        "end_date": end_date,
                        "num_days": num_days,
                        "status": status,
                    })
    return results, errors


@router.post("/import-excel")
async def import_excel(
    user: RequireUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(403, "Alleen admins kunnen Excel importeren")
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Alleen .xlsx bestanden zijn toegestaan")

    # Controleer of al eerder geïmporteerd
    already = await db.get(SystemSetting, "bike_excel_imported")
    if already and already.value == "true":
        raise HTTPException(
            400,
            "Excel al eerder geïmporteerd. Verwijder de instelling 'bike_excel_imported' om opnieuw te importeren."
        )

    contents = await file.read()

    # Parse synchroon in thread (openpyxl is niet async)
    parsed, errors = await asyncio.to_thread(_parse_excel, contents)

    # Bouw bike_number → Bike lookup
    bikes_result = await db.execute(select(Bike))
    bike_lookup: dict[str, Bike] = {b.number: b for b in bikes_result.scalars().all()}

    # Haal huidige max ID op voor counter
    max_id_result = await db.execute(select(func.max(BikeReservation.id)))
    last_id = max_id_result.scalar() or 0
    next_id = last_id + 1

    imported = 0
    skipped = 0

    for entry in parsed:
        bike = bike_lookup.get(entry["bike_number"])
        if not bike:
            skipped += 1
            continue

        res = BikeReservation(
            id=next_id,
            guest_name=entry["guest_name"],
            guest_room=None,
            start_date=entry["start_date"],
            end_date=entry["end_date"],
            num_days=entry["num_days"],
            num_bikes=1,
            bike_type_id=bike.type_id,
            status=entry["status"],
            notes="Geïmporteerd uit Excel",
        )
        db.add(res)
        await db.flush()
        db.add(BikeReservationBike(reservation_id=res.id, bike_id=bike.id))
        bike.total_rental_days += entry["num_days"]
        next_id += 1
        imported += 1

    # Update counter instelling
    counter = await db.get(SystemSetting, "bike_reservation_counter")
    if counter:
        counter.value = str(next_id)
    else:
        db.add(SystemSetting(key="bike_reservation_counter", value=str(next_id)))

    # Markeer als geïmporteerd
    db.add(SystemSetting(key="bike_excel_imported", value="true"))

    return {
        "ok": True,
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:10],  # max 10 foutmeldingen tonen
    }


@router.delete("/import-excel")
async def reset_import(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Reset de import-vlag zodat opnieuw geïmporteerd kan worden."""
    if not user.is_admin:
        raise HTTPException(403, "Alleen admins")
    setting = await db.get(SystemSetting, "bike_excel_imported")
    if setting:
        setting.value = "false"
    return {"ok": True}
