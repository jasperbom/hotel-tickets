from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from croniter import croniter

from ..database import get_db
from ..models import RecurringTemplate, Category, Priority
from ..auth import RequireUser

router = APIRouter(prefix="/recurring", tags=["recurring"])


class TemplateCreate(BaseModel):
    title: str
    description: str | None = None
    category: Category
    priority: Priority = Priority.medium
    location_id: str | None = None
    assign_to: str | None = None
    cron_expression: str
    advance_days: int = 0
    is_active: bool = True
    nfc_tag_id: str | None = None


class TemplateUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: Category | None = None
    priority: Priority | None = None
    location_id: str | None = None
    assign_to: str | None = None
    cron_expression: str | None = None
    advance_days: int | None = None
    is_active: bool | None = None
    nfc_tag_id: str | None = None


class TemplateOut(BaseModel):
    id: str
    title: str
    description: str | None
    category: Category
    priority: Priority
    location_id: str | None
    assign_to: str | None
    cron_expression: str
    advance_days: int
    is_active: bool
    nfc_tag_id: str | None

    model_config = {"from_attributes": True}


def _validate_cron(expr: str) -> None:
    if not croniter.is_valid(expr):
        raise HTTPException(status_code=422, detail=f"Ongeldige cron expressie: {expr}")


@router.get("/", response_model=list[TemplateOut])
async def list_templates(user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RecurringTemplate).order_by(RecurringTemplate.title))
    return result.scalars().all()


@router.post("/", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins en supervisors kunnen sjablonen aanmaken")
    _validate_cron(body.cron_expression)
    template = RecurringTemplate(**body.model_dump())
    db.add(template)
    await db.flush()

    # Plan de job in de scheduler
    from ..scheduler import schedule_template
    await schedule_template(template)

    return template


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")
    return template


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Geen toegang")
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    if body.cron_expression:
        _validate_cron(body.cron_expression)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(template, field, value)

    # Herplan de job
    from ..scheduler import reschedule_template
    await reschedule_template(template)

    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Geen toegang")
    template = await db.get(RecurringTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Sjabloon niet gevonden")

    from ..scheduler import remove_template
    await remove_template(template.id)

    await db.delete(template)
