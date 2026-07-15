"""
Standalone login voor toegang buiten HA ingress om (bijv. de app op een
telefoon via het LAN).

Twee soorten accounts:

1. HA-gekoppelde accounts — inloggegevens worden geverifieerd tegen de
   bestaande Home Assistant gebruikersaccounts via de Supervisor auth-API
   (vereist `auth_api: true` in config.yaml — staat al aan). Er worden dan
   nergens wachtwoorden opgeslagen. De Supervisor bevestigt alleen
   geldig/ongeldig en geeft geen user-ID terug; daarom wordt de
   HA-gebruikersnaam gekoppeld via `user_roles.ha_username`. Die kolom wordt
   automatisch gevuld zodra iemand één keer via ingress inlogt
   (X-Remote-User-Name header), of kan door een admin worden ingesteld.

2. Lokale app-accounts — door een admin aangemaakt bij Instellingen →
   Medewerkers, mét een wachtwoord. Het wachtwoord staat als PBKDF2-hash in
   `user_roles.password_hash` en wordt volledig binnen de addon geverifieerd:
   de medewerker heeft géén Home Assistant-account nodig.
"""
import logging
import os
import time
from datetime import datetime, timezone

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import INGRESS_PROXY_IPS, RequireUser
from ..database import get_db
from ..models import LoginBan, Role, UserRole
from ..passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
from ..services.notifications import notify_login_ban
from ..session import SESSION_HOURS, create_session_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")

# Simpele rate-limiting per IP: max 5 pogingen per 60 seconden. Het endpoint
# praat rechtstreeks met de HA-accounts, dus brute-force moet geremd worden.
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60.0
_attempts: dict[str, list[float]] = {}

# Permanente blokkade (persistent in de database, overleeft herstarts): na
# zoveel echt mislukte pogingen wordt het IP geblokkeerd tot een admin de
# blokkade opheft. De rate-limiter hierboven remt alleen; dit stopt.
BAN_THRESHOLD = int(os.environ.get("LOGIN_BAN_THRESHOLD", "25"))


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _attempts.get(ip, []) if now - t < WINDOW_SECONDS]
    if len(attempts) >= MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Te veel inlogpogingen — probeer het over een minuut opnieuw",
        )
    attempts.append(now)
    _attempts[ip] = attempts


async def _check_ban(ip: str, db: AsyncSession) -> None:
    """Weiger het verzoek als dit IP permanent geblokkeerd is."""
    ban = await db.get(LoginBan, ip)
    if ban and ban.banned_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Dit IP-adres is geblokkeerd wegens te veel mislukte "
                "inlogpogingen. Vraag een beheerder de blokkade op te heffen."
            ),
        )


async def _register_failed_attempt(ip: str, username: str, db: AsyncSession) -> None:
    """Tel een mislukte poging; blokkeer het IP bij de drempel en push admins.

    Verzoeken vanaf de ingress-proxy worden overgeslagen: die zijn al door HA
    geauthenticeerd en één gedeeld proxy-IP blokkeren zou iedereen raken.
    """
    if ip in INGRESS_PROXY_IPS:
        return
    now = datetime.now(timezone.utc)
    ban = await db.get(LoginBan, ip)
    if not ban:
        ban = LoginBan(ip=ip, failed_count=0)
        db.add(ban)
    ban.failed_count += 1
    ban.last_username = username[:255] or None
    ban.last_attempt_at = now
    if ban.failed_count >= BAN_THRESHOLD and ban.banned_at is None:
        ban.banned_at = now
        logger.warning(
            "[auth] IP %s geblokkeerd na %d mislukte inlogpogingen (laatste gebruikersnaam %r)",
            ip, ban.failed_count, username,
        )
        admins_result = await db.execute(
            select(UserRole).where(
                and_(
                    UserRole.role == Role.admin,
                    UserRole.notify_push == True,  # noqa: E712
                    UserRole.ha_notify_service.isnot(None),
                )
            )
        )
        admin_services = [u.ha_notify_service for u in admins_result.scalars().all() if u.ha_notify_service]
        if admin_services:
            await notify_login_ban(ip, ban.failed_count, ban.last_username, admin_services)
    # Expliciet committen: de aanroeper raist hierna een 401 en get_db doet
    # dan een rollback — zonder commit zou de teller nooit opgeslagen worden.
    await db.commit()


async def _clear_failed_attempts(ip: str, db: AsyncSession) -> None:
    """Succesvolle login: teller voor dit IP weer op nul."""
    ban = await db.get(LoginBan, ip)
    if ban and ban.banned_at is None:
        await db.delete(ban)


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class LoginOut(BaseModel):
    token: str
    expires_at: int
    display_name: str


async def _verify_ha_credentials(username: str, password: str) -> bool:
    """Verifieer gebruikersnaam/wachtwoord tegen de HA-accounts via de Supervisor.

    Statuscodes van de Supervisor:
      200      → geldig
      400/401  → ongeldige inloggegevens
      403      → addon mist auth_api-rechten (herbouw/herinstalleer de addon)
      overig   → infra-probleem
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://supervisor/auth",
                # Let op: X-Supervisor-Token, níet "Authorization: Bearer".
                # Het /auth-endpoint interpreteert een Authorization-header als
                # BasicAuth-inloggegevens en geeft dan altijd 401
                # (home-assistant/supervisor#6313).
                headers={"X-Supervisor-Token": SUPERVISOR_TOKEN},
                json={"username": username, "password": password},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    return True
                body = (await resp.text())[:300]
                logger.warning(
                    "[auth] Supervisor weigerde login voor %r: HTTP %s — %s",
                    username, resp.status, body,
                )
                if resp.status in (400, 401):
                    return False
                if resp.status == 403:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=(
                            "De addon heeft geen toegang tot de HA auth-API. "
                            "Herbouw of herinstalleer de addon en probeer het opnieuw."
                        ),
                    )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Home Assistant gaf een onverwachte fout (HTTP {resp.status}) — zie het addon-log",
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[auth] Supervisor auth-API onbereikbaar: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kan inloggegevens nu niet verifiëren — probeer het later opnieuw",
        )


async def _supervisor_reset_password(username: str, new_password: str) -> None:
    """Zet een nieuw wachtwoord voor een HA-gebruiker via de Supervisor.

    Gebruikt `POST /auth/reset` (hetzelfde als `ha authentication reset` in de
    HA CLI). Vereist `hassio_role: admin` in config.yaml.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://supervisor/auth/reset",
                headers={"X-Supervisor-Token": SUPERVISOR_TOKEN},
                json={"username": username, "password": new_password},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    return
                body = (await resp.text())[:300]
                logger.error(
                    "[auth] Supervisor wachtwoord-reset voor %r mislukt: HTTP %s — %s",
                    username, resp.status, body,
                )
                if resp.status in (401, 403):
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=(
                            "De addon heeft geen rechten om wachtwoorden te wijzigen. "
                            "Werk de addon bij naar de nieuwste versie en herstart hem."
                        ),
                    )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Wachtwoord wijzigen mislukt (HTTP {resp.status}) — zie het addon-log",
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[auth] Supervisor auth-reset-API onbereikbaar: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kan het wachtwoord nu niet wijzigen — probeer het later opnieuw",
        )


@router.post("/change-password")
async def change_password(
    body: ChangePasswordIn,
    request: Request,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Zelfservice: de ingelogde medewerker wijzigt het eigen wachtwoord.

    Lokale app-accounts: het huidige wachtwoord wordt tegen de eigen hash
    geverifieerd en de nieuwe hash wordt in de database gezet.

    HA-gekoppelde accounts: het huidige wachtwoord wordt geverifieerd via de
    Supervisor auth-API, daarna wordt het nieuwe wachtwoord gezet via
    /auth/reset. Er worden dan nergens wachtwoorden opgeslagen.

    Deelt de rate-limiting met de loginpagina.
    """
    client_ip = request.client.host if request.client else "?"
    _check_rate_limit(client_ip)
    await _check_ban(client_ip, db)

    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Het nieuwe wachtwoord moet minimaal {MIN_PASSWORD_LENGTH} tekens lang zijn",
        )
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="Het nieuwe wachtwoord is gelijk aan het huidige")

    profile = await db.get(UserRole, user.ha_user_id)

    if profile and profile.password_hash:
        # Lokaal app-account — volledig binnen de addon afhandelen
        if not verify_password(body.current_password, profile.password_hash):
            logger.info(
                "[auth] Wachtwoordwijziging geweigerd voor lokaal account %s: huidig wachtwoord onjuist (vanaf %s)",
                user.ha_user_id, client_ip,
            )
            await _register_failed_attempt(client_ip, profile.ha_username or user.ha_user_id, db)
            raise HTTPException(status_code=401, detail="Het huidige wachtwoord is onjuist")
        profile.password_hash = hash_password(body.new_password)
        _attempts.pop(client_ip, None)
        logger.info("[auth] Wachtwoord gewijzigd voor lokaal account %s", user.ha_user_id)
        return {"ok": True}

    if not profile or not profile.ha_username:
        raise HTTPException(
            status_code=400,
            detail=(
                "Je HA-gebruikersnaam is nog niet gekoppeld aan je profiel. "
                "Log één keer in via Home Assistant zelf, of vraag een beheerder "
                "je gebruikersnaam in te stellen bij Instellingen → Medewerkers."
            ),
        )
    username = profile.ha_username

    if DEV_MODE:
        # Dev: huidig wachtwoord "dev" is geldig; er wordt niets echt gewijzigd
        valid = body.current_password == "dev"
    else:
        if not SUPERVISOR_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supervisor niet beschikbaar — wachtwoord wijzigen kan alleen binnen Home Assistant",
            )
        valid = await _verify_ha_credentials(username, body.current_password)

    if not valid:
        logger.info(
            "[auth] Wachtwoordwijziging geweigerd voor %r: huidig wachtwoord onjuist (vanaf %s)",
            username, client_ip,
        )
        await _register_failed_attempt(client_ip, username, db)
        raise HTTPException(status_code=401, detail="Het huidige wachtwoord is onjuist")

    if not DEV_MODE:
        await _supervisor_reset_password(username, body.new_password)

    _attempts.pop(client_ip, None)
    logger.info("[auth] Wachtwoord gewijzigd voor %r (user %s)", username, user.ha_user_id)
    return {"ok": True}


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "?"
    _check_rate_limit(client_ip)
    await _check_ban(client_ip, db)

    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=422, detail="Vul gebruikersnaam en wachtwoord in")

    result = await db.execute(
        select(UserRole).where(func.lower(UserRole.ha_username) == username.lower())
    )
    user = result.scalars().first()

    if user and user.password_hash:
        # Lokaal app-account: wachtwoord staat (gehasht) in de eigen database
        valid = verify_password(body.password, user.password_hash)
    elif DEV_MODE:
        # Dev: wachtwoord "dev" is geldig voor elke bestaande gebruikersnaam
        valid = body.password == "dev"
    else:
        if not SUPERVISOR_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supervisor niet beschikbaar — inloggen kan alleen binnen Home Assistant",
            )
        valid = await _verify_ha_credentials(username, body.password)

    if not valid:
        logger.info("[auth] Mislukte inlogpoging voor %r vanaf %s", username, client_ip)
        await _register_failed_attempt(client_ip, username, db)
        raise HTTPException(status_code=401, detail="Ongeldige gebruikersnaam of wachtwoord")

    if not user:
        logger.info("[auth] Geldige login voor %r maar geen gekoppeld profiel", username)
        raise HTTPException(
            status_code=403,
            detail=(
                "Je account is nog niet gekoppeld. Log eerst één keer in via "
                "Home Assistant zelf, of vraag een beheerder je HA-gebruikersnaam "
                "in te stellen bij Instellingen → Medewerkers."
            ),
        )

    _attempts.pop(client_ip, None)
    await _clear_failed_attempts(client_ip, db)
    token, expires_at = create_session_token(user.ha_user_id)
    logger.info("[auth] %s ingelogd via loginpagina (sessie %d uur)", username, SESSION_HOURS)
    return LoginOut(token=token, expires_at=expires_at, display_name=user.display_name)


# ── Beheer van IP-blokkades (admin) ──────────────────────────────────────────


class LoginBanOut(BaseModel):
    ip: str
    failed_count: int
    last_username: str | None
    last_attempt_at: datetime
    banned: bool


@router.get("/bans", response_model=list[LoginBanOut])
async def list_bans(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Alle IP's met mislukte inlogpogingen, geblokkeerde bovenaan."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen blokkades inzien")
    result = await db.execute(
        select(LoginBan).order_by(LoginBan.banned_at.isnot(None).desc(), LoginBan.last_attempt_at.desc())
    )
    return [
        LoginBanOut(
            ip=b.ip,
            failed_count=b.failed_count,
            last_username=b.last_username,
            last_attempt_at=b.last_attempt_at,
            banned=b.banned_at is not None,
        )
        for b in result.scalars().all()
    ]


@router.delete("/bans/{ip}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ban(ip: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Hef een blokkade op (of wis de teller van een nog niet geblokkeerd IP)."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen blokkades opheffen")
    ban = await db.get(LoginBan, ip)
    if not ban:
        raise HTTPException(status_code=404, detail="IP niet gevonden")
    await db.delete(ban)
    _attempts.pop(ip, None)
    logger.info("[auth] Blokkade/teller voor IP %s opgeheven door %s", ip, user.ha_user_id)
