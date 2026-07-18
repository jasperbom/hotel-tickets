"""
Directe berichten tussen medewerkers, los van tickets.

Een gesprek is de verzameling berichten tussen dezelfde twee personen.
Reageren is simpelweg een nieuw bericht terugsturen.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, or_, and_
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models import DirectMessage, UserRole
from ..auth import RequireUser
from ..services.notifications import notify_direct_message
from .settings import get_ticket_base_url

router = APIRouter(prefix="/messages", tags=["messages"])


class MessageOut(BaseModel):
    id: str
    sender_id: str
    recipient_id: str
    body: str
    from_me: bool
    read: bool
    created_at: datetime


class ConversationOut(BaseModel):
    user_id: str
    display_name: str
    last_body: str
    last_from_me: bool
    last_created_at: datetime
    unread: int


class MessageCreate(BaseModel):
    recipient_id: str
    body: str

    @field_validator("body")
    @classmethod
    def _body_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Bericht mag niet leeg zijn")
        return v


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Alle gesprekken van de huidige gebruiker, meest recente eerst."""
    me = user.ha_user_id
    result = await db.execute(
        select(DirectMessage)
        .where(or_(DirectMessage.sender_id == me, DirectMessage.recipient_id == me))
        .order_by(DirectMessage.created_at.desc())
    )
    messages = result.scalars().all()

    # Groepeer per gesprekspartner (nieuwste bericht bepaalt de volgorde).
    conversations: dict[str, ConversationOut] = {}
    for m in messages:
        other = m.recipient_id if m.sender_id == me else m.sender_id
        if other not in conversations:
            conversations[other] = ConversationOut(
                user_id=other,
                display_name=other,
                last_body=m.body,
                last_from_me=m.sender_id == me,
                last_created_at=m.created_at,
                unread=0,
            )
        if m.recipient_id == me and not m.read:
            conversations[other].unread += 1

    if not conversations:
        return []

    # Weergavenamen ophalen
    names_result = await db.execute(
        select(UserRole.ha_user_id, UserRole.display_name).where(
            UserRole.ha_user_id.in_(list(conversations.keys()))
        )
    )
    names = {uid: name for uid, name in names_result.all()}
    for uid, conv in conversations.items():
        conv.display_name = names.get(uid) or uid

    return list(conversations.values())


@router.get("/with/{user_id}", response_model=list[MessageOut])
async def get_thread(user_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Volledig gesprek met één medewerker, oudste eerst. Markeert
    binnenkomende berichten meteen als gelezen."""
    me = user.ha_user_id
    result = await db.execute(
        select(DirectMessage)
        .where(
            or_(
                and_(DirectMessage.sender_id == me, DirectMessage.recipient_id == user_id),
                and_(DirectMessage.sender_id == user_id, DirectMessage.recipient_id == me),
            )
        )
        .order_by(DirectMessage.created_at.asc())
    )
    messages = result.scalars().all()

    # Binnenkomende ongelezen berichten als gelezen markeren
    await db.execute(
        update(DirectMessage)
        .where(
            DirectMessage.recipient_id == me,
            DirectMessage.sender_id == user_id,
            DirectMessage.read == False,  # noqa: E712
        )
        .values(read=True)
    )

    return [
        MessageOut(
            id=m.id,
            sender_id=m.sender_id,
            recipient_id=m.recipient_id,
            body=m.body,
            from_me=m.sender_id == me,
            read=m.read,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.get("/unread-count")
async def unread_count(user: RequireUser, db: AsyncSession = Depends(get_db)):
    count = await db.scalar(
        select(func.count()).where(
            DirectMessage.recipient_id == user.ha_user_id,
            DirectMessage.read == False,  # noqa: E712
        )
    )
    return {"count": count or 0}


@router.post("/", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(body: MessageCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Stuur een direct bericht naar een medewerker."""
    me = user.ha_user_id
    if body.recipient_id == me:
        raise HTTPException(status_code=400, detail="Je kunt geen bericht naar jezelf sturen")

    recipient = await db.get(UserRole, body.recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Ontvanger niet gevonden")

    message = DirectMessage(
        sender_id=me,
        recipient_id=body.recipient_id,
        body=body.body,
    )
    db.add(message)
    await db.flush()

    # Push naar de ontvanger indien ingesteld
    if recipient.notify_push and recipient.ha_notify_service:
        base_url = await get_ticket_base_url(db)
        url = f"{base_url}/#/berichten" if base_url else None
        await notify_direct_message(user.display_name, message.body, recipient.ha_notify_service, url)

    return MessageOut(
        id=message.id,
        sender_id=message.sender_id,
        recipient_id=message.recipient_id,
        body=message.body,
        from_me=True,
        read=message.read,
        created_at=message.created_at,
    )
