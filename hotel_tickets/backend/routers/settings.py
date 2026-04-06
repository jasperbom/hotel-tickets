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
