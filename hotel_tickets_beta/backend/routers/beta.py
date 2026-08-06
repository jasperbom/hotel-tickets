"""
Beta-omgeving: status + het kopiëren van de productiedata naar de beta.

De beta-addon heeft ``config:rw`` in zijn mapping en ziet daardoor de
database én de uploadmap van de productie-addon in ``/config/hotel_tickets/``.
Kopiëren gebeurt met de SQLite backup-API op een read-only verbinding, zodat
de productiedatabase gegarandeerd niet aangeraakt wordt en de kopie ook
consistent is wanneer er op dat moment in productie gewerkt wordt.

Na het kopiëren:
* draaien de schema-migraties over de gekopieerde data (de beta loopt vooruit)
* worden de sessies gewist (die tokens zijn ondertekend met het geheim van
  productie en hier dus toch ongeldig)
* wijst ``ticket_base_url`` naar de beta-ingress in plaats van productie
* herlaadt de scheduler de gekopieerde herhaaltaken
"""
import asyncio
import logging
import os
import shutil
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..auth import RequireUser
from ..beta import (
    BETA_BASE_URL,
    BETA_LABEL,
    BETA_MODE,
    SOURCE_DB_PATH,
    SOURCE_UPLOAD_DIR,
    app_version,
)
from ..database import AsyncSessionLocal, engine, init_db
from ..models import Session as SessionModel, SystemSetting

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/beta", tags=["beta"])

DB_PATH = os.environ.get("DB_PATH", "./hotel_tickets.db")
UPLOAD_DIR = os.environ.get(
    "UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads")
)

LAST_COPY_KEY = "beta_last_copy_at"
SOURCE_STAMP_KEY = "beta_source_modified_at"

# Eén kopie tegelijk — twee gelijktijdige swaps zouden elkaars bestanden
# onder de voeten weglopen.
_copy_lock = asyncio.Lock()

# Interne SQLite-tabellen en FTS-schaduwtabellen tellen we niet mee in het
# overzicht; die zeggen de gebruiker niets.
_HIDDEN_TABLE_SUFFIXES = ("_data", "_idx", "_content", "_docsize", "_config")


class SourceInfo(BaseModel):
    available: bool
    modified_at: str | None = None
    size_bytes: int | None = None


class BetaStatus(BaseModel):
    beta_mode: bool
    label: str
    version: str
    source: SourceInfo
    last_copy_at: str | None = None
    copied_source_modified_at: str | None = None


class CopyResult(BaseModel):
    ok: bool
    copied_at: str
    source_modified_at: str | None
    tables: dict[str, int]
    photos: int
    message: str


def _source_info() -> SourceInfo:
    if not SOURCE_DB_PATH or not os.path.isfile(SOURCE_DB_PATH):
        return SourceInfo(available=False)
    st = os.stat(SOURCE_DB_PATH)
    return SourceInfo(
        available=True,
        modified_at=datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        size_bytes=st.st_size,
    )


@router.get("/status", response_model=BetaStatus)
async def beta_status():
    """
    Of dit een beta-omgeving is. Bewust zonder authenticatie: de banner en het
    label op de loginpagina moeten al zichtbaar zijn vóór het inloggen, en het
    antwoord bevat niets vertrouwelijks.
    """
    last_copy = None
    source_stamp = None
    if BETA_MODE:
        try:
            async with AsyncSessionLocal() as db:
                rows = (
                    await db.execute(
                        select(SystemSetting).where(
                            SystemSetting.key.in_([LAST_COPY_KEY, SOURCE_STAMP_KEY])
                        )
                    )
                ).scalars()
                values = {r.key: r.value for r in rows}
            last_copy = values.get(LAST_COPY_KEY)
            source_stamp = values.get(SOURCE_STAMP_KEY)
        except Exception as exc:  # database nog niet klaar / net omgewisseld
            logger.debug("Beta-status: instellingen niet leesbaar (%s)", exc)

    return BetaStatus(
        beta_mode=BETA_MODE,
        label=BETA_LABEL,
        version=app_version(),
        source=_source_info() if BETA_MODE else SourceInfo(available=False),
        last_copy_at=last_copy,
        copied_source_modified_at=source_stamp,
    )


def _table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    names = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    counts: dict[str, int] = {}
    for name in names:
        if name.endswith(_HIDDEN_TABLE_SUFFIXES):
            continue
        try:
            count = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        except sqlite3.Error:
            continue
        if count:
            counts[name] = count
    return counts


def _copy_database() -> dict[str, int]:
    """
    Kopieer de productiedatabase over die van de beta heen. Draait in een
    thread (sqlite3 is synchroon). De vorige beta-database blijft als
    ``.vorige`` naast de nieuwe staan, zodat een misklik terug te draaien is.
    """
    tmp = DB_PATH + ".import"
    for path in (tmp, tmp + "-wal", tmp + "-shm"):
        if os.path.exists(path):
            os.remove(path)

    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)

    # mode=ro: de productiedatabase wordt gegarandeerd alleen gelezen.
    source = sqlite3.connect(f"file:{SOURCE_DB_PATH}?mode=ro", uri=True)
    try:
        target = sqlite3.connect(tmp)
        try:
            source.backup(target)
            counts = _table_counts(target)
        finally:
            target.close()
    finally:
        source.close()

    if os.path.exists(DB_PATH):
        shutil.move(DB_PATH, DB_PATH + ".vorige")
    for suffix in ("-wal", "-shm"):
        if os.path.exists(DB_PATH + suffix):
            os.remove(DB_PATH + suffix)
    os.replace(tmp, DB_PATH)
    return counts


def _copy_uploads() -> int:
    """Kopieer ticketfoto's en kennisbank-afbeeldingen. Geeft het aantal
    bestanden terug."""
    if not SOURCE_UPLOAD_DIR or not os.path.isdir(SOURCE_UPLOAD_DIR):
        return 0
    dest = os.path.abspath(UPLOAD_DIR)
    if os.path.abspath(SOURCE_UPLOAD_DIR) == dest:
        return 0
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(SOURCE_UPLOAD_DIR, dest)
    return sum(len(files) for _, _, files in os.walk(dest))


@router.post("/copy-production", response_model=CopyResult)
async def copy_production(user: RequireUser):
    """Vervang alle beta-data door een verse kopie van productie."""
    if not BETA_MODE:
        raise HTTPException(
            status_code=400,
            detail="Deze installatie is geen beta-omgeving — kopiëren is hier uitgeschakeld.",
        )
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen productiedata kopiëren")

    info = _source_info()
    if not info.available:
        raise HTTPException(
            status_code=404,
            detail=f"Productiedatabase niet gevonden op {SOURCE_DB_PATH}. "
                   "Draait de productie-addon en staat 'config:rw' in de mapping?",
        )

    if _copy_lock.locked():
        raise HTTPException(status_code=409, detail="Er loopt al een kopieeractie")

    async with _copy_lock:
        logger.info("Beta: productiedata kopiëren van %s", SOURCE_DB_PATH)
        # Alle open verbindingen sluiten vóór de bestandswissel, anders blijven
        # ze naar de oude database wijzen.
        await engine.dispose()
        try:
            counts = await asyncio.to_thread(_copy_database)
            photos = await asyncio.to_thread(_copy_uploads)
        except (OSError, sqlite3.Error) as exc:
            logger.exception("Beta: kopiëren mislukt")
            raise HTTPException(status_code=500, detail=f"Kopiëren mislukt: {exc}") from exc
        finally:
            await engine.dispose()

        # Schema-migraties over de gekopieerde productiedata draaien.
        await init_db()

        copied_at = datetime.now(timezone.utc).isoformat()
        async with AsyncSessionLocal() as db:
            # Sessietokens uit productie zijn hier ongeldig (ander HMAC-geheim).
            await db.execute(SystemSetting.__table__.delete().where(SystemSetting.key.in_(
                [LAST_COPY_KEY, SOURCE_STAMP_KEY]
            )))
            db.add(SystemSetting(key=LAST_COPY_KEY, value=copied_at))
            if info.modified_at:
                db.add(SystemSetting(key=SOURCE_STAMP_KEY, value=info.modified_at))
            base = await db.get(SystemSetting, "ticket_base_url")
            if base:
                base.value = BETA_BASE_URL
            else:
                db.add(SystemSetting(key="ticket_base_url", value=BETA_BASE_URL))
            await db.execute(SessionModel.__table__.delete())
            await db.commit()

        # Herhaaltaken opnieuw inplannen op basis van de gekopieerde sjablonen.
        from ..scheduler import load_all_templates

        await load_all_templates()

        counts.pop("sessions", None)
        logger.info("Beta: kopie klaar (%s tabellen, %s bestanden)", len(counts), photos)
        return CopyResult(
            ok=True,
            copied_at=copied_at,
            source_modified_at=info.modified_at,
            tables=counts,
            photos=photos,
            message="Productiedata gekopieerd. Log opnieuw in als je via de "
                    "loginpagina (LAN) werkt.",
        )
