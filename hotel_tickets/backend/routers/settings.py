import base64
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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


MAX_LOGO_SIZE = 500 * 1024      # 500 KB
MAX_BG_IMAGE_SIZE = 2 * 1024 * 1024  # 2 MB
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}


class BrandingOut(BaseModel):
    brand_color: str | None
    brand_logo: str | None
    btn_color: str | None
    bg_color: str | None
    bg_image: str | None


class BrandingUpdate(BaseModel):
    brand_color: str | None = None
    btn_color: str | None = None
    bg_color: str | None = None


async def _get_branding(db: AsyncSession) -> BrandingOut:
    keys = ["brand_color", "brand_logo", "btn_color", "bg_color", "bg_image"]
    rows = {k: await db.get(SystemSetting, k) for k in keys}
    return BrandingOut(**{k: rows[k].value if rows[k] else None for k in keys})


@router.get("/branding", response_model=BrandingOut)
async def get_branding(db: AsyncSession = Depends(get_db)):
    return await _get_branding(db)


@router.patch("/branding", response_model=BrandingOut)
async def update_branding(
    body: BrandingUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen de huisstijl wijzigen")
    for field in ("brand_color", "btn_color", "bg_color"):
        value = getattr(body, field)
        if value is not None:
            row = await db.get(SystemSetting, field)
            if row:
                row.value = value
            else:
                db.add(SystemSetting(key=field, value=value))
    await db.commit()
    return await _get_branding(db)


@router.post("/branding/logo", response_model=BrandingOut)
async def upload_branding_logo(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen het logo wijzigen")
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Alleen PNG, JPEG of WebP toegestaan")
    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="Logo mag maximaal 500 KB zijn")
    data_url = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"
    row = await db.get(SystemSetting, "brand_logo")
    if row:
        row.value = data_url
    else:
        db.add(SystemSetting(key="brand_logo", value=data_url))
    await db.commit()
    return await _get_branding(db)


@router.post("/branding/background", response_model=BrandingOut)
async def upload_branding_background(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen de achtergrond wijzigen")
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Alleen PNG, JPEG of WebP toegestaan")
    data = await file.read()
    if len(data) > MAX_BG_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Achtergrond mag maximaal 2 MB zijn")
    data_url = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"
    row = await db.get(SystemSetting, "bg_image")
    if row:
        row.value = data_url
    else:
        db.add(SystemSetting(key="bg_image", value=data_url))
    await db.commit()
    return await _get_branding(db)


@router.delete("/branding/background", response_model=BrandingOut)
async def delete_branding_background(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen de achtergrond wijzigen")
    row = await db.get(SystemSetting, "bg_image")
    if row:
        await db.delete(row)
    await db.commit()
    return await _get_branding(db)


# ── Fietsen module instelling ──────────────────────────────────────────────────

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
