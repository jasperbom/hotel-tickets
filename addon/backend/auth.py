"""
HA authentication middleware.
Verifies the ingress token via the HA Supervisor API and resolves the HA user.
"""
import os
from typing import Annotated
import aiohttp
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .database import get_db
from .models import UserRole, Role

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_API_BASE = "http://supervisor/core/api"
HA_AUTH_URL = "http://supervisor/auth"


async def _get_ha_user(token: str) -> dict:
    """Verify token with HA supervisor and return user info."""
    headers = {
        "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        # Validate the ingress/long-lived token via HA auth endpoint
        async with session.get(
            f"{HA_API_BASE}/states",
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status == 401:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ongeldige token")

        # Get current user info
        async with session.get(
            f"{HA_API_BASE}/states/person.me",
            headers={"Authorization": f"Bearer {SUPERVISOR_TOKEN}"},
        ) as _:
            pass

        # Use supervisor whoami equivalent
        async with session.get(
            "http://supervisor/core/api/config",
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ongeldige token")

    # Return minimal user info; the token itself identifies the user
    return {"token": token}


class CurrentUser:
    def __init__(self, ha_user_id: str, display_name: str, role: Role, department, email: str | None, ha_notify_service: str | None, is_admin: bool):
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
    Extract and validate the HA token from the request.
    In HA ingress mode, the token comes via the X-Ingress-Path header or
    the Authorization header set by the frontend after HA auth.
    """
    token = None

    # Try Authorization header first
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]

    # Fallback: ingress token injected by HA supervisor
    if not token:
        token = request.headers.get("X-Ingress-Token", "")

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Geen token opgegeven")

    # In development mode without HA, accept a dev token
    dev_mode = os.environ.get("DEV_MODE", "false").lower() == "true"
    if dev_mode and token == "dev-token":
        ha_user_id = "dev-user"
        display_name = "Dev User"
    else:
        # Validate via HA API - use supervisor to verify
        try:
            await _get_ha_user(token)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token verificatie mislukt")

        # The token is the HA long-lived token; derive user_id from it
        # In practice we store HA user_id when user first accesses the system
        ha_user_id = token[:36]  # Placeholder – see note below
        display_name = "HA Gebruiker"

    # Look up role in our DB
    result = await db.execute(select(UserRole).where(UserRole.ha_user_id == ha_user_id))
    user_role = result.scalar_one_or_none()

    if not user_role:
        # First-time user: create with default role
        user_role = UserRole(
            ha_user_id=ha_user_id,
            display_name=display_name,
            role=Role.technician,
        )
        db.add(user_role)
        await db.flush()

    return CurrentUser(
        ha_user_id=user_role.ha_user_id,
        display_name=user_role.display_name,
        role=user_role.role,
        department=user_role.department,
        email=user_role.email,
        ha_notify_service=user_role.ha_notify_service,
        is_admin=user_role.role in (Role.admin, Role.supervisor),
    )


RequireUser = Annotated[CurrentUser, Depends(get_current_user)]
