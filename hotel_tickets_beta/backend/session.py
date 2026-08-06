"""
Server-side sessies voor de standalone loginpagina.

De loginpagina geeft een token uit met de vorm ``hts.<geheim>.<handtekening>``:

- ``<geheim>`` is een willekeurige, hoge-entropie string (``secrets.token_urlsafe``).
- ``<handtekening>`` is een HMAC-SHA256 over het geheim met een lokaal
  server-geheim (naast de database bewaard, in ``/config/hotel_tickets/``).
  Hiermee worden vervalste of beschadigde tokens meteen — zonder database-hit —
  afgewezen, en maakt het roteren van het server-geheim in één klap álle
  sessies ongeldig.

In de database staat alleen ``sha256(<geheim>)`` (kolom ``token_hash``), nooit
het token zelf. Een datalek van de database levert dus geen bruikbare tokens op.
De rij in de ``sessions``-tabel bepaalt de geldigheid: een sessie is intrekbaar
(uitloggen op afstand, per apparaat) en meeschuivend — ``expires_at`` schuift bij
gebruik vooruit, zodat een actieve gebruiker ingelogd blijft en een vergeten of
gestolen token na de inactiviteitsperiode vanzelf verloopt.
"""
import base64
import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Session

logger = logging.getLogger(__name__)

# Inactiviteitsvenster: zonder gebruik verloopt een sessie na zoveel uur. Zolang
# de app binnen dit venster gebruikt wordt, schuift de vervaltijd mee vooruit.
SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12"))

# Hoe vaak een actieve sessie hoogstens "aangeraakt" wordt (last_seen +
# vervaltijd bijwerken). Voorkomt een database-schrijfactie bij élk verzoek;
# 5 minuten granulariteit is ruim voldoende voor zowel de apparatenlijst als
# het meeschuiven van de vervaltijd.
TOUCH_INTERVAL = timedelta(minutes=5)

# Prefix onderscheidt onze tokens van HA Supervisor-tokens in de auth-flow
TOKEN_PREFIX = "hts."

_secret: bytes | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite bewaart naïeve datetimes; interpreteer die als UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _secret_path() -> str:
    db_dir = os.path.dirname(os.path.abspath(os.environ.get("DB_PATH", "./hotel_tickets.db")))
    return os.path.join(db_dir, "session_secret")


def _get_secret() -> bytes:
    global _secret
    if _secret is not None:
        return _secret
    path = _secret_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        if len(value) >= 32:
            _secret = value.encode()
            return _secret
        logger.warning("Sessiegeheim in %s is te kort — nieuw geheim genereren", path)
    except FileNotFoundError:
        pass
    value = secrets.token_hex(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(value)
    logger.info("Nieuw sessiegeheim aangemaakt in %s", path)
    _secret = value.encode()
    return _secret


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _sign(secret_part: str) -> str:
    sig = hmac.new(_get_secret(), secret_part.encode(), hashlib.sha256).digest()
    return _b64encode(sig)


def _hash(secret_part: str) -> str:
    return hashlib.sha256(secret_part.encode()).hexdigest()


def _build_token(secret_part: str) -> str:
    return f"{TOKEN_PREFIX}{secret_part}.{_sign(secret_part)}"


def token_hash_if_valid(token: str) -> str | None:
    """Controleer prefix + handtekening en geef de ``token_hash`` terug (of None).

    Doet géén database-hit: alleen de HMAC wordt geverifieerd. Zo worden
    vervalste of beschadigde tokens meteen afgewezen, en kan de aanroeper de
    hash gebruiken om de bijbehorende sessie op te zoeken of te vergelijken.
    """
    if not token.startswith(TOKEN_PREFIX):
        return None
    try:
        secret_part, signature = token[len(TOKEN_PREFIX):].split(".", 1)
    except ValueError:
        return None
    if not secret_part or not signature:
        return None
    if not hmac.compare_digest(_sign(secret_part), signature):
        return None
    return _hash(secret_part)


async def create_session(
    db: AsyncSession,
    ha_user_id: str,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[str, datetime]:
    """Maak een nieuwe server-side sessie; geeft ``(token, expires_at)`` terug."""
    secret_part = secrets.token_urlsafe(32)
    now = _now()
    expires_at = now + timedelta(hours=SESSION_HOURS)
    session = Session(
        token_hash=_hash(secret_part),
        ha_user_id=ha_user_id,
        created_at=now,
        last_seen_at=now,
        expires_at=expires_at,
        user_agent=user_agent[:400] if user_agent else None,
        ip=ip,
    )
    db.add(session)
    # Ruim meteen de verlopen sessies van deze gebruiker op — goedkoop en
    # zelfbeperkend, zodat de apparatenlijst niet volloopt met oude rijen.
    await db.execute(
        delete(Session).where(
            Session.ha_user_id == ha_user_id,
            Session.expires_at < now,
        )
    )
    await db.flush()
    return _build_token(secret_part), expires_at


async def verify_session(db: AsyncSession, token: str, ip: str | None = None) -> str | None:
    """Geef de ``ha_user_id`` terug bij een geldige, niet-verlopen sessie, anders None.

    Werkt de sessie meeschuivend bij (throttled op ``TOUCH_INTERVAL``): bij
    gebruik schuift de vervaltijd vooruit zodat een actieve gebruiker ingelogd
    blijft. De schrijfactie wordt bij het einde van het verzoek gecommit.
    """
    token_hash = token_hash_if_valid(token)
    if token_hash is None:
        return None
    result = await db.execute(select(Session).where(Session.token_hash == token_hash))
    session = result.scalar_one_or_none()
    if session is None:
        return None
    now = _now()
    if _aware(session.expires_at) < now:
        return None
    if now - _aware(session.last_seen_at) >= TOUCH_INTERVAL:
        session.last_seen_at = now
        session.expires_at = now + timedelta(hours=SESSION_HOURS)
        if ip:
            session.ip = ip
    return session.ha_user_id


async def revoke_session(db: AsyncSession, session_id: str) -> "Session | None":
    """Verwijder een sessie op ID. Geeft de verwijderde sessie terug (of None)."""
    session = await db.get(Session, session_id)
    if session is None:
        return None
    await db.delete(session)
    return session


async def revoke_token(db: AsyncSession, token: str) -> bool:
    """Verwijder de sessie die bij dit token hoort (uitloggen huidige sessie)."""
    token_hash = token_hash_if_valid(token)
    if token_hash is None:
        return False
    result = await db.execute(delete(Session).where(Session.token_hash == token_hash))
    return bool(result.rowcount)


async def list_user_sessions(db: AsyncSession, ha_user_id: str) -> list[Session]:
    """Alle actieve (niet-verlopen) sessies van één gebruiker, nieuwste eerst."""
    now = _now()
    result = await db.execute(
        select(Session)
        .where(Session.ha_user_id == ha_user_id, Session.expires_at >= now)
        .order_by(Session.last_seen_at.desc())
    )
    return list(result.scalars().all())


async def list_all_sessions(db: AsyncSession) -> list[Session]:
    """Alle actieve sessies over alle gebruikers (admin-overzicht)."""
    now = _now()
    result = await db.execute(
        select(Session).where(Session.expires_at >= now).order_by(Session.last_seen_at.desc())
    )
    return list(result.scalars().all())


async def cleanup_expired_sessions(db: AsyncSession) -> int:
    """Verwijder alle verlopen sessies; geeft het aantal opgeruimde rijen terug."""
    result = await db.execute(delete(Session).where(Session.expires_at < _now()))
    return int(result.rowcount or 0)
