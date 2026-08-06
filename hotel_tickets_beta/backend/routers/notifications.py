"""
Berichten (envelopje): @-mentions in commentaar en nieuw commentaar op
tickets die aan jou zijn toegewezen.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from pydantic import BaseModel

from ..database import get_db
from ..models import TicketNotification, NotificationType, Ticket, TicketComment, UserRole
from ..auth import RequireUser

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: str
    type: NotificationType
    ticket_id: str
    ticket_title: str | None
    comment_id: str | None
    comment_body: str | None
    actor_id: str
    actor_name: str | None
    read: bool
    created_at: datetime


@router.get("/", response_model=list[NotificationOut])
async def list_notifications(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Berichten van de huidige gebruiker, nieuwste eerst."""
    result = await db.execute(
        select(TicketNotification, Ticket.title, TicketComment.body, UserRole.display_name)
        .join(Ticket, Ticket.id == TicketNotification.ticket_id)
        .outerjoin(TicketComment, TicketComment.id == TicketNotification.comment_id)
        .outerjoin(UserRole, UserRole.ha_user_id == TicketNotification.actor_id)
        .where(TicketNotification.recipient_id == user.ha_user_id)
        .order_by(TicketNotification.read, TicketNotification.created_at.desc())
        .limit(50)
    )
    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            ticket_id=n.ticket_id,
            ticket_title=title,
            comment_id=n.comment_id,
            comment_body=body,
            actor_id=n.actor_id,
            actor_name=actor_name,
            read=n.read,
            created_at=n.created_at,
        )
        for n, title, body, actor_name in result.all()
    ]


@router.get("/unread-count")
async def unread_count(user: RequireUser, db: AsyncSession = Depends(get_db)):
    count = await db.scalar(
        select(func.count()).where(
            TicketNotification.recipient_id == user.ha_user_id,
            TicketNotification.read == False,  # noqa: E712
        )
    )
    return {"count": count or 0}


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(notification_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    notification = await db.get(TicketNotification, notification_id)
    if not notification or notification.recipient_id != user.ha_user_id:
        raise HTTPException(status_code=404, detail="Bericht niet gevonden")
    notification.read = True


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(user: RequireUser, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(TicketNotification)
        .where(
            TicketNotification.recipient_id == user.ha_user_id,
            TicketNotification.read == False,  # noqa: E712
        )
        .values(read=True)
    )


@router.post("/read-by-ticket/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read_by_ticket(ticket_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Markeer alle berichten over een ticket als gelezen — aangeroepen
    wanneer de gebruiker de ticketpagina opent."""
    await db.execute(
        update(TicketNotification)
        .where(
            TicketNotification.recipient_id == user.ha_user_id,
            TicketNotification.ticket_id == ticket_id,
            TicketNotification.read == False,  # noqa: E712
        )
        .values(read=True)
    )
