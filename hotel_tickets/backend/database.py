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
        ("ticket_comments", "updated_at", "DATETIME"),
        ("tickets", "photos", "TEXT"),
    ]
    for table, column, col_def in column_migrations:
        if not await _column_exists(conn, table, column):
            logger.info("Migratie: %s.%s toevoegen", table, column)
            await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")

    # Reset custom emoji's van recurring templates naar NULL (altijd 🔁 gebruiken)
    await conn.exec_driver_sql("UPDATE recurring_templates SET emoji = NULL WHERE emoji IS NOT NULL")
