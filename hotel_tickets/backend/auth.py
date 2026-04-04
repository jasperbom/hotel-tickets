"""
HA authenticatie via ingress headers.

In HA ingress zet de Supervisor automatisch:
  X-Remote-User-ID           → unieke HA user ID
  X-Remote-User-Name         → inlognaam
  X-Remote-User-Display-Name → weergavenaam (HA 2023.4+)

Deze headers worden door de Supervisor proxy ingesteld en
kunnen niet worden vervalst door de client.
"""
import os
from typing import Annotated
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .database import get_db
from .models import UserRole, Role

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"


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
    Haal de ingelogde gebruiker op via de HA ingress headers.
    Maakt automatisch een profiel aan bij eerste gebruik.
    """
    # HA Supervisor zet deze headers voor elke ingress request
    ha_user_id   = request.headers.get("X-Remote-User-ID", "").strip()
    display_name = (
        request.headers.get("X-Remote-User-Display-Name")
        or request.headers.get("X-Remote-User-Name")
        or "HA Gebruiker"
    ).strip()

    # Dev mode: accepteer ook requests zonder HA headers
    if DEV_MODE and not ha_user_id:
        ha_user_id   = "dev-user"
        display_name = "Dev User"

    if not ha_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Niet ingelogd via Home Assistant",
        )

    # Zoek het gebruikersprofiel op
    result = await db.execute(select(UserRole).where(UserRole.ha_user_id == ha_user_id))
    user_role = result.scalar_one_or_none()

    if not user_role:
        # Eerste keer: maak profiel aan met standaard rol
        user_role = UserRole(
            ha_user_id=ha_user_id,
            display_name=display_name,
            role=Role.technician,
        )
        db.add(user_role)
        await db.flush()
    elif user_role.display_name != display_name:
        # Naam bijwerken als die veranderd is in HA
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


RequireUser = Annotated[CurrentUser, Depends(get_current_user)]
