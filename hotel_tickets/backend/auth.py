"""
HA authenticatie via ingress headers.

In HA ingress zet de Supervisor automatisch:
  X-Remote-User-ID           → unieke HA user ID
  X-Remote-User-Name         → inlognaam
  X-Remote-User-Display-Name → weergavenaam (HA 2023.4+)

Deze headers worden door de Supervisor proxy ingesteld en
kunnen niet worden vervalst door de client.
"""
import logging
import os
from typing import Annotated
import aiohttp
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from .database import get_db
from .models import UserRole, Role

logger = logging.getLogger(__name__)

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")

_SYSTEM_USER = None  # wordt aangemaakt bij eerste gebruik


def _system_user() -> "CurrentUser":
    return CurrentUser(
        ha_user_id="system",
        display_name="Home Assistant",
        role=Role.admin,
        department=None,
        email=None,
        ha_notify_service=None,
        is_admin=True,
    )


async def _verify_supervisor_token(token: str) -> bool:
    """
    Verifieer of een Bearer token geldig is door de Supervisor te pingen.
    Elk proces in HA OS (core, addons) heeft een eigen SUPERVISOR_TOKEN,
    maar alle tokens zijn geldig voor de Supervisor API.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "http://supervisor/supervisor/ping",
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=3),
            ) as resp:
                return resp.status == 200
    except Exception as exc:
        logger.debug("Supervisor ping mislukt: %s", exc)
        return False


class CurrentUser:
    def __init__(
        self,
        ha_user_id: str,
        display_name: str,
        role: Role,
        department,
        email: str | None,
        ha_notify_service: str | None,
        is_admin: bool,
    ):
        self.ha_user_id = ha_user_id
        self.display_name = display_name
        self.role = role
        self.department = department
        self.email = email
        self.ha_notify_service = ha_notify_service
        self.is_admin = is_admin


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    Haal de ingelogde gebruiker op.

    Prioriteit:
    1. X-Remote-User-ID header (HA ingress → frontend gebruiker)
    2. Bearer token = eigen SUPERVISOR_TOKEN (intern / dev)
    3. Bearer token geverifieerd via Supervisor ping (HA core / andere addons)
    4. DEV_MODE fallback
    """
    auth_header = request.headers.get("Authorization", "")
    bearer_token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else ""

    # 1. Ingress header — standaard pad voor alle frontend-gebruikers
    ha_user_id = request.headers.get("X-Remote-User-ID", "").strip()
    display_name = (
        request.headers.get("X-Remote-User-Display-Name")
        or request.headers.get("X-Remote-User-Name")
        or "HA Gebruiker"
    ).strip()

    if ha_user_id:
        logger.debug("[auth] Ingress gebruiker: %s", ha_user_id)
        # Profiel ophalen of aanmaken
        result = await db.execute(select(UserRole).where(UserRole.ha_user_id == ha_user_id))
        user_role = result.scalar_one_or_none()
        if not user_role:
            # Eerste gebruiker zonder admins wordt automatisch admin
            admin_count = await db.scalar(
                select(func.count()).where(UserRole.role == Role.admin)
            )
            initial_role = Role.admin if admin_count == 0 else Role.employee
            if initial_role == Role.admin:
                logger.info("[auth] Eerste gebruiker %s krijgt automatisch admin-rol", ha_user_id)
            user_role = UserRole(
                ha_user_id=ha_user_id,
                display_name=display_name,
                role=initial_role,
            )
            db.add(user_role)
            await db.flush()
        elif user_role.display_name != display_name:
            user_role.display_name = display_name
        return CurrentUser(
            ha_user_id=user_role.ha_user_id,
            display_name=user_role.display_name,
            role=user_role.role,
            department=user_role.department,
            email=user_role.email,
            ha_notify_service=user_role.ha_notify_service,
            is_admin=user_role.role in (Role.admin, Role.supervisor),
        )

    # 2. Eigen SUPERVISOR_TOKEN (snel pad, geen netwerkoproep)
    if SUPERVISOR_TOKEN and bearer_token == SUPERVISOR_TOKEN:
        logger.info("[auth] Eigen SUPERVISOR_TOKEN herkend — systeem gebruiker")
        return _system_user()

    # 3. Onbekend Bearer token → verifieer met Supervisor
    #    (HA core heeft een andere SUPERVISOR_TOKEN dan de addon)
    if bearer_token and bearer_token != "dev-token":
        logger.info("[auth] Onbekend token ontvangen (lengte %d) — Supervisor ping...", len(bearer_token))
        ok = await _verify_supervisor_token(bearer_token)
        logger.info("[auth] Supervisor ping resultaat: %s", "geldig" if ok else "ONGELDIG")
        if ok:
            return _system_user()

    # 4. Dev mode fallback
    if DEV_MODE:
        return CurrentUser(
            ha_user_id="dev-user",
            display_name="Dev User",
            role=Role.admin,
            department=None,
            email=None,
            ha_notify_service=None,
            is_admin=True,
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Niet ingelogd via Home Assistant",
    )


RequireUser = Annotated[CurrentUser, Depends(get_current_user)]
