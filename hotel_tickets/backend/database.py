import logging
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("DB_PATH", "./hotel_tickets.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Migraties in een aparte transactie zodat create_all altijd commit
    async with engine.begin() as conn:
        await _run_migrations(conn)


async def _column_exists(conn, table: str, column: str) -> bool:
    result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
    rows = result.fetchall()
    return any(row[1] == column for row in rows)


async def _run_migrations(conn):
    """
    Voeg ontbrekende kolommen toe aan bestaande tabellen via PRAGMA-check.
    Zo worden fouten nooit stilletjes geslokt — alleen echt ontbrekende kolommen
    worden toegevoegd.
    """
    column_migrations = [
        ("tickets", "notify_when_free", "BOOLEAN NOT NULL DEFAULT 0"),
        ("tickets", "closed_by", "VARCHAR(255)"),
        ("tickets", "subtasks", "TEXT"),
        ("recurring_templates", "nfc_tag_id", "VARCHAR(255)"),
        ("recurring_templates", "subtask_mode", "VARCHAR(20) NOT NULL DEFAULT 'none'"),
        ("recurring_templates", "subtask_items", "TEXT"),
        ("recurring_templates", "notify_when_free", "BOOLEAN NOT NULL DEFAULT 0"),
        ("recurring_templates", "emoji", "VARCHAR(10)"),
        ("recurring_templates", "folder", "VARCHAR(100)"),
        ("recurring_templates", "interval_days", "INTEGER"),
        ("recurring_templates", "next_due_at", "DATETIME"),
        ("ticket_comments", "updated_at", "DATETIME"),
        ("tickets", "photos", "TEXT"),
        ("tickets", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
        ("user_roles", "ha_device_tracker", "VARCHAR(255)"),
        ("user_roles", "notify_new_ticket", "BOOLEAN NOT NULL DEFAULT 0"),
        ("knowledge_entries", "images", "TEXT"),
        ("bike_reservations", "key_given_at", "DATETIME"),
        ("bike_reservations", "key_returned_at", "DATETIME"),
        ("bike_reservations", "key_ticket_id", "VARCHAR(36)"),
        ("pool_configs", "chloor_nfc_tag_id", "VARCHAR(255)"),
        ("pool_configs", "zuur_nfc_tag_id", "VARCHAR(255)"),
        ("pool_configs", "vlokmiddel_nfc_tag_id", "VARCHAR(255)"),
        ("pool_configs", "filter_template_id", "VARCHAR(36)"),
        ("pool_configs", "filter_template_id_r", "VARCHAR(36)"),
        ("pool_configs", "chloor_template_id", "VARCHAR(36)"),
        ("pool_configs", "zuur_template_id", "VARCHAR(36)"),
        ("pool_configs", "vlokmiddel_template_id", "VARCHAR(36)"),
    ]
    for table, column, col_def in column_migrations:
        if not await _column_exists(conn, table, column):
            logger.info("Migratie: %s.%s toevoegen", table, column)
            await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")

    # Data-migratie v1.4.61: scheid 'rang' en 'afdeling'. De oude rol-waarden
    # technician/housekeeping/reception waren een combinatie van rol en
    # afdeling; vanaf nu is role = admin/supervisor/employee en is department
    # een aparte kolom (technical/housekeeping/reception). Vul department uit
    # de oude role als die nog leeg is, en hernoem dan de oude waarden naar
    # 'employee'. Idempotent: na één run matchen de WHERE-clauses niets meer.
    await conn.exec_driver_sql(
        "UPDATE user_roles SET department = 'technical' "
        "WHERE role = 'technician' AND department IS NULL"
    )
    await conn.exec_driver_sql(
        "UPDATE user_roles SET department = 'housekeeping' "
        "WHERE role = 'housekeeping' AND department IS NULL"
    )
    await conn.exec_driver_sql(
        "UPDATE user_roles SET department = 'reception' "
        "WHERE role = 'reception' AND department IS NULL"
    )
    await conn.exec_driver_sql(
        "UPDATE user_roles SET role = 'employee' "
        "WHERE role IN ('technician', 'housekeeping', 'reception')"
    )

    # Reset custom emoji's van recurring templates naar NULL (altijd 🔁 gebruiken)
    await conn.exec_driver_sql("UPDATE recurring_templates SET emoji = NULL WHERE emoji IS NOT NULL")

    # Migreer filterspoeling van boolean (0/1) naar nullable string (NULL/X/L/R)
    # De oude kolom is NOT NULL, dus we maken een nieuwe nullable kolom
    if not await _column_exists(conn, "pool_logs", "filterspoeling_str"):
        if await _column_exists(conn, "pool_logs", "filterspoeling"):
            logger.info("Migratie: pool_logs.filterspoeling boolean → string")
            await conn.exec_driver_sql("ALTER TABLE pool_logs ADD COLUMN filterspoeling_str VARCHAR(10)")
            await conn.exec_driver_sql("UPDATE pool_logs SET filterspoeling_str = 'X' WHERE filterspoeling = 1 OR filterspoeling = '1'")
            await conn.exec_driver_sql("UPDATE pool_logs SET filterspoeling_str = NULL WHERE filterspoeling = 0 OR filterspoeling = '0' OR filterspoeling_str IS NULL")

    # Verwijder de oude boolean filterspoeling kolom (NOT NULL, blokkeert nieuwe inserts)
    if await _column_exists(conn, "pool_logs", "filterspoeling_str"):
        if await _column_exists(conn, "pool_logs", "filterspoeling"):
            logger.info("Migratie: oude pool_logs.filterspoeling kolom verwijderen")
            await conn.exec_driver_sql("ALTER TABLE pool_logs DROP COLUMN filterspoeling")

    # Seed pool_configs als de tabel leeg is
    result = await conn.exec_driver_sql("SELECT COUNT(*) FROM pool_configs")
    count = result.scalar()
    if count == 0:
        await conn.exec_driver_sql(
            "INSERT INTO pool_configs (pool_id, label) VALUES ('wellness', 'Wellness'), ('zwembad', 'Zwembad')"
        )

    # Seed standaard module-instelling voor fietsen (alle rollen mogen het zien)
    result = await conn.exec_driver_sql(
        "SELECT COUNT(*) FROM system_settings WHERE key = 'bikes_module_roles'"
    )
    if result.scalar() == 0:
        await conn.exec_driver_sql(
            "INSERT INTO system_settings (key, value) VALUES ('bikes_module_roles', 'all')"
        )

    # ── Kennisbank: FTS5 full-text index + triggers ───────────────────────────
    # De virtuele tabel spiegelt knowledge_entries (entry_id als UNINDEXED
    # kolom zodat we de match terug kunnen koppelen aan de entry). Triggers
    # houden de index synchroon bij insert/update/delete. Alles idempotent via
    # IF NOT EXISTS, zodat herhaalde starts niets dubbel doen.
    await conn.exec_driver_sql(
        "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5("
        "entry_id UNINDEXED, title, answer, keywords, tokenize='unicode61')"
    )
    await conn.exec_driver_sql(
        "CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge_entries BEGIN "
        "INSERT INTO knowledge_fts(entry_id, title, answer, keywords) "
        "VALUES (new.id, new.title, new.answer, COALESCE(new.keywords, '')); END"
    )
    await conn.exec_driver_sql(
        "CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge_entries BEGIN "
        "DELETE FROM knowledge_fts WHERE entry_id = old.id; END"
    )
    await conn.exec_driver_sql(
        "CREATE TRIGGER IF NOT EXISTS knowledge_fts_au AFTER UPDATE ON knowledge_entries BEGIN "
        "DELETE FROM knowledge_fts WHERE entry_id = old.id; "
        "INSERT INTO knowledge_fts(entry_id, title, answer, keywords) "
        "VALUES (new.id, new.title, new.answer, COALESCE(new.keywords, '')); END"
    )
    # Herbouw de index als hij leeg is maar er wél entries bestaan (bijv. bij een
    # bestaande database waar de FTS-tabel nieuw wordt aangemaakt).
    fts_count = (await conn.exec_driver_sql("SELECT COUNT(*) FROM knowledge_fts")).scalar()
    entry_count = (await conn.exec_driver_sql("SELECT COUNT(*) FROM knowledge_entries")).scalar()
    if entry_count and not fts_count:
        logger.info("Kennisbank: FTS-index opnieuw vullen voor %d entries", entry_count)
        await conn.exec_driver_sql(
            "INSERT INTO knowledge_fts(entry_id, title, answer, keywords) "
            "SELECT id, title, answer, COALESCE(keywords, '') FROM knowledge_entries"
        )

    # Seed AI-schakelaar voor de kennisbank (Fase 2; standaard uit)
    result = await conn.exec_driver_sql(
        "SELECT COUNT(*) FROM system_settings WHERE key = 'knowledge_ai_enabled'"
    )
    if result.scalar() == 0:
        await conn.exec_driver_sql(
            "INSERT INTO system_settings (key, value) VALUES ('knowledge_ai_enabled', 'false')"
        )
