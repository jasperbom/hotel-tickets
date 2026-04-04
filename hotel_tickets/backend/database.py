import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

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
        await _run_migrations(conn)


async def _run_migrations(conn):
    """
    Voeg ontbrekende kolommen toe aan bestaande tabellen.
    SQLite ondersteunt geen IF NOT EXISTS bij ALTER TABLE,
    dus we vangen de fout af als de kolom al bestaat.
    """
    migrations = [
        "ALTER TABLE tickets ADD COLUMN notify_when_free BOOLEAN NOT NULL DEFAULT 0",
        "ALTER TABLE tickets ADD COLUMN closed_by VARCHAR(255)",
    ]
    for sql in migrations:
        try:
            await conn.exec_driver_sql(sql)
        except Exception:
            pass  # Kolom bestaat al — geen actie nodig
