from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..database import get_db
from ..models import SystemSetting
from ..auth import RequireUser

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULT_TICKET_BASE_URL = "/hassio/ingress/hotel_tickets"


class SystemSettingsOut(BaseModel):
    ticket_base_url: str


class SystemSettingsUpdate(BaseModel):
    ticket_base_url: str | None = None


async def get_ticket_base_url(db: AsyncSession) -> str:
    row = await db.get(SystemSetting, "ticket_base_url")
    return row.value if row else DEFAULT_TICKET_BASE_URL


@router.get("/system", response_model=SystemSettingsOut)
async def get_system_settings(user: RequireUser, db: AsyncSession = Depends(get_db)):
    return SystemSettingsOut(ticket_base_url=await get_ticket_base_url(db))


@router.patch("/system", response_model=SystemSettingsOut)
async def update_system_settings(
    body: SystemSettingsUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen systeeminstellingen wijzigen")

    if body.ticket_base_url is not None:
        row = await db.get(SystemSetting, "ticket_base_url")
        if row:
            row.value = body.ticket_base_url.rstrip("/")
        else:
            db.add(SystemSetting(key="ticket_base_url", value=body.ticket_base_url.rstrip("/")))

    return SystemSettingsOut(ticket_base_url=await get_ticket_base_url(db))


# ── Fietsen module instelling ──────────────────────────────────────────────────

BIKES_MODULE_ROLES_OPTIONS = ["all", "reception", "admin_supervisor"]


@router.get("/bikes-module")
async def get_bikes_module_setting(user: RequireUser, db: AsyncSession = Depends(get_db)):
    row = await db.get(SystemSetting, "bikes_module_roles")
    return {"bikes_module_roles": row.value if row else "all"}


@router.patch("/bikes-module")
async def update_bikes_module_setting(
    body: dict,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen deze instelling wijzigen")
    value = body.get("bikes_module_roles", "all")
    if value not in BIKES_MODULE_ROLES_OPTIONS:
        raise HTTPException(status_code=400, detail=f"Ongeldige waarde. Kies uit: {BIKES_MODULE_ROLES_OPTIONS}")
    row = await db.get(SystemSetting, "bikes_module_roles")
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key="bikes_module_roles", value=value))
    return {"bikes_module_roles": value}
