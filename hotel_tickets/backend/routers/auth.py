"""
Standalone login voor toegang buiten HA ingress om (bijv. de app op een
telefoon via het LAN).

Inloggegevens worden geverifieerd tegen de bestaande Home Assistant
gebruikersaccounts via de Supervisor auth-API (vereist `auth_api: true` in
config.yaml — staat al aan). Er worden dus nergens wachtwoorden opgeslagen.

De Supervisor bevestigt alleen geldig/ongeldig en geeft geen user-ID terug;
daarom wordt de HA-gebruikersnaam gekoppeld via `user_roles.ha_username`.
Die kolom wordt automatisch gevuld zodra iemand één keer via ingress inlogt
(X-Remote-User-Name header), of kan door een admin worden ingesteld.
"""
import logging
import os
import time

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import UserRole
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


class LoginIn(BaseModel):
    username: str
    password: str


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
                headers={"Authorization": f"Bearer {SUPERVISOR_TOKEN}"},
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


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "?"
    _check_rate_limit(client_ip)

    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=422, detail="Vul gebruikersnaam en wachtwoord in")

    if DEV_MODE:
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
        raise HTTPException(status_code=401, detail="Ongeldige gebruikersnaam of wachtwoord")

    result = await db.execute(
        select(UserRole).where(func.lower(UserRole.ha_username) == username.lower())
    )
    user = result.scalars().first()
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
    token, expires_at = create_session_token(user.ha_user_id)
    logger.info("[auth] %s ingelogd via loginpagina (sessie %d uur)", username, SESSION_HOURS)
    return LoginOut(token=token, expires_at=expires_at, display_name=user.display_name)
