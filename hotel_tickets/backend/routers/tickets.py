import json
import os
import uuid as uuid_mod
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, case
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models import Ticket, TicketComment, Category, Status, Priority, Role, UserRole
from ..auth import RequireUser, CurrentUser
from ..services.notifications import notify_ticket_assigned, notify_ticket_created, notify_urgent_ticket
from ..services.ha_entities import sync_ticket_sensors
from .settings import get_ticket_base_url

import logging
logger = logging.getLogger(__name__)

PHOTOS_DIR = Path(os.environ.get("PHOTOS_DIR", "/data/photos" if not os.environ.get("DEV_MODE") else "./photos"))
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

router = APIRouter(prefix="/tickets", tags=["tickets"])


# --- Pydantic schemas ---

class TicketCreate(BaseModel):
    title: str
    description: str | None = None
    category: Category
    priority: Priority = Priority.medium
    location_id: str | None = None
    assigned_to: str | None = None
    creator_name: str | None = None  # display-naam bij aanmaken via card/service
    subtask_labels: list[str] | None = None  # optionele subtaken bij aanmaken


class TicketUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    location_id: str | None = None
    assigned_to: str | None = None
    notify_when_free: bool | None = None


class CommentCreate(BaseModel):
    body: str


class SubtaskUpdate(BaseModel):
    index: int
    done: bool


class TicketOut(BaseModel):
    id: str
    title: str
    description: str | None
    category: Category
    status: Status
    priority: Priority
    location_id: str | None
    created_by: str
    assigned_to: str | None
    recurring_template_id: str | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    closed_by: str | None
    notify_when_free: bool
    subtasks: list | None = None
    photos: list[str] | None = None

    model_config = {"from_attributes": True}

    @field_validator("subtasks", mode="before")
    @classmethod
    def parse_subtasks(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v

    @field_validator("photos", mode="before")
    @classmethod
    def parse_photos(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


class CommentOut(BaseModel):
    id: str
    ticket_id: str
    author_id: str
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Helpers ---

def _visible_filter(user: CurrentUser):
    """Bouw een filter op basis van de rol van de gebruiker."""
    if user.is_admin:
        return None  # Ziet alles
    if user.department:
        return Ticket.category == user.department
    return None


# --- Endpoints ---

@router.get("/", response_model=list[TicketOut])
async def list_tickets(
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
    category: Category | None = Query(None),
    status_param: str | None = Query(None, alias="status"),
    priority: Priority | None = Query(None),
    assigned_to: str | None = Query(None),
    location_id: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    filters = []
    vis = _visible_filter(user)
    if vis is not None:
        filters.append(vis)
    if category:
        filters.append(Ticket.category == category)
    if status_param:
        status_values = [s.strip() for s in status_param.split(",") if s.strip()]
        valid = [s for s in status_values if s in (e.value for e in Status)]
        if len(valid) == 1:
            filters.append(Ticket.status == valid[0])
        elif len(valid) > 1:
            filters.append(Ticket.status.in_(valid))
    if priority:
        filters.append(Ticket.priority == priority)
    if assigned_to:
        filters.append(Ticket.assigned_to == assigned_to)
    if location_id:
        filters.append(Ticket.location_id == location_id)

    priority_sort = case(
        (Ticket.priority == "urgent", 0),
        (Ticket.priority == "high", 1),
        (Ticket.priority == "medium", 2),
        (Ticket.priority == "low", 3),
        else_=4,
    )
    stmt = select(Ticket).where(and_(*filters)).order_by(priority_sort, Ticket.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: TicketCreate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    logger.info("[tickets] Ticket aanmaken: title=%r category=%s door user=%s", body.title, body.category, user.ha_user_id)
    subtasks_json = None
    if body.subtask_labels:
        subtasks_json = json.dumps([
            {"label": l, "done": False, "done_by": None, "done_at": None}
            for l in body.subtask_labels
        ])
    ticket = Ticket(
        title=body.title,
        description=body.description,
        category=body.category,
        priority=body.priority,
        location_id=body.location_id,
        assigned_to=body.assigned_to,
        created_by=body.creator_name if body.creator_name else user.ha_user_id,
        subtasks=subtasks_json,
    )
    db.add(ticket)
    await db.flush()

    # Notificaties
    await notify_ticket_created(ticket.title, ticket.category.value)
    base_url = await get_ticket_base_url(db)
    ticket_url = f"{base_url}/#/tickets/{ticket.id}"
    if body.assigned_to:
        assignee = await db.get(UserRole, body.assigned_to)
        if assignee:
            await notify_ticket_assigned(ticket.title, assignee.ha_notify_service, assignee.email, ticket_url)
    if ticket.priority == Priority.urgent:
        admins_result = await db.execute(
            select(UserRole).where(
                and_(UserRole.role == Role.admin, UserRole.notify_push == True, UserRole.ha_notify_service.isnot(None))
            )
        )
        admin_services = [u.ha_notify_service for u in admins_result.scalars().all() if u.ha_notify_service]
        if admin_services:
            await notify_urgent_ticket(ticket.title, admin_services, ticket_url)

    await sync_ticket_sensors(db)
    return ticket


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    return ticket


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    body: TicketUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")

    old_assigned = ticket.assigned_to

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(ticket, field, value)

    if body.status == Status.closed and not ticket.closed_at:
        ticket.closed_at = datetime.now(timezone.utc)
        ticket.closed_by = user.ha_user_id
    elif body.status and body.status != Status.closed:
        ticket.closed_at = None
        ticket.closed_by = None

    ticket.updated_at = datetime.now(timezone.utc)

    # Notificeer bij nieuwe toewijzing
    if body.assigned_to and body.assigned_to != old_assigned:
        assignee = await db.get(UserRole, body.assigned_to)
        if assignee:
            base_url = await get_ticket_base_url(db)
            ticket_url = f"{base_url}/#/tickets/{ticket.id}"
            await notify_ticket_assigned(ticket.title, assignee.ha_notify_service, assignee.email, ticket_url)

    await sync_ticket_sensors(db)
    return ticket


@router.post("/{ticket_id}/claim", response_model=TicketOut)
async def claim_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Medewerker pakt een onbehandeld ticket zelf op."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    if ticket.assigned_to:
        raise HTTPException(status_code=409, detail="Ticket al toegewezen")
    ticket.assigned_to = user.ha_user_id
    ticket.status = Status.in_progress
    ticket.updated_at = datetime.now(timezone.utc)
    return ticket


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen tickets verwijderen")
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    await db.delete(ticket)
    await sync_ticket_sensors(db)


# --- Subtaken ---

@router.patch("/{ticket_id}/subtasks")
async def update_subtask(
    ticket_id: str,
    body: SubtaskUpdate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Markeer een subtaak als gedaan of ongedaan."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    if not ticket.subtasks:
        raise HTTPException(status_code=400, detail="Ticket heeft geen subtaken")

    try:
        subtasks = json.loads(ticket.subtasks)
    except Exception:
        raise HTTPException(status_code=400, detail="Subtaken data ongeldig")

    if body.index < 0 or body.index >= len(subtasks):
        raise HTTPException(status_code=400, detail="Ongeldige subtaak index")

    subtasks[body.index]["done"] = body.done
    if body.done:
        subtasks[body.index]["done_by"] = user.ha_user_id
        subtasks[body.index]["done_at"] = datetime.now(timezone.utc).isoformat()
    else:
        subtasks[body.index]["done_by"] = None
        subtasks[body.index]["done_at"] = None

    ticket.subtasks = json.dumps(subtasks)
    ticket.updated_at = datetime.now(timezone.utc)
    return {"ok": True, "subtasks": subtasks}


# --- Commentaar ---

@router.get("/{ticket_id}/comments", response_model=list[CommentOut])
async def list_comments(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at)
    )
    return result.scalars().all()


@router.post("/{ticket_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(
    ticket_id: str,
    body: CommentCreate,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    comment = TicketComment(ticket_id=ticket_id, author_id=user.ha_user_id, body=body.body)
    db.add(comment)
    await db.flush()
    return comment


# --- Foto's ---

@router.post("/{ticket_id}/photos")
async def upload_photo(
    ticket_id: str,
    user: RequireUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")

    ext = Path(file.filename or "photo.jpg").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Ongeldig bestandstype. Toegestaan: {', '.join(ALLOWED_EXTENSIONS)}")

    filename = f"{uuid_mod.uuid4().hex}{ext}"
    ticket_dir = PHOTOS_DIR / ticket_id
    ticket_dir.mkdir(parents=True, exist_ok=True)
    file_path = ticket_dir / filename

    content = await file.read()
    file_path.write_bytes(content)

    photos = json.loads(ticket.photos) if ticket.photos else []
    photos.append(filename)
    ticket.photos = json.dumps(photos)
    ticket.updated_at = datetime.now(timezone.utc)

    return {"ok": True, "filename": filename, "photos": photos}


@router.get("/{ticket_id}/photos/{filename}")
async def get_photo(ticket_id: str, filename: str):
    file_path = PHOTOS_DIR / ticket_id / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Foto niet gevonden")
    return FileResponse(file_path)


@router.delete("/{ticket_id}/photos/{filename}")
async def delete_photo(
    ticket_id: str,
    filename: str,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")

    file_path = PHOTOS_DIR / ticket_id / filename
    if file_path.is_file():
        file_path.unlink()

    photos = json.loads(ticket.photos) if ticket.photos else []
    photos = [p for p in photos if p != filename]
    ticket.photos = json.dumps(photos) if photos else None
    ticket.updated_at = datetime.now(timezone.utc)

    return {"ok": True, "photos": photos}
