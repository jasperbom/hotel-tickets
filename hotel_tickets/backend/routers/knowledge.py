"""
Kennisbank / bot voor personeel.

- Iedereen mag vragen stellen en de kennisbank doorzoeken.
- Alleen admins beheren de wachtrij en de entries.

De bot put uitsluitend uit de kennisbank (knowledge_entries) en verzint nooit
zelf antwoorden. Vindt hij niets, dan komt de vraag in de wachtrij voor admins.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import RequireUser
from ..database import get_db
from ..models import (
    KnowledgeEntry,
    KnowledgeQuestion,
    KnowledgeQuestionStatus,
    Category,
    Role,
    Ticket,
    Status,
)
from ..services.knowledge_search import knowledge_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _require_admin(user) -> None:
    """Kennisbeheer is voorbehouden aan admins (niet supervisors)."""
    if user.role != Role.admin:
        raise HTTPException(403, "Alleen admins kunnen de kennisbank beheren")


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class EntryOut(BaseModel):
    id: str
    title: str
    answer: str
    keywords: Optional[str] = None
    category: Optional[Category] = None
    source_ticket_id: Optional[str] = None
    ask_count: int
    is_published: bool
    created_at: str
    updated_at: str


class EntryCreate(BaseModel):
    title: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    keywords: Optional[str] = None
    category: Optional[Category] = None
    is_published: bool = True
    source_ticket_id: Optional[str] = None


class EntryUpdate(BaseModel):
    title: Optional[str] = None
    answer: Optional[str] = None
    keywords: Optional[str] = None
    category: Optional[Category] = None
    is_published: Optional[bool] = None


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    category: Optional[Category] = None


class AskResponse(BaseModel):
    answered: bool
    question_id: str
    entries: list[EntryOut]


class QuestionOut(BaseModel):
    id: str
    question_text: str
    asked_by: str
    asked_by_name: Optional[str] = None
    category: Optional[Category] = None
    status: KnowledgeQuestionStatus
    matched_entry_id: Optional[str] = None
    resolved_entry_id: Optional[str] = None
    created_at: str
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None


class AnswerQueueRequest(BaseModel):
    title: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    keywords: Optional[str] = None
    category: Optional[Category] = None


class FromTicketRequest(BaseModel):
    title: Optional[str] = None
    answer: Optional[str] = None
    keywords: Optional[str] = None
    category: Optional[Category] = None


class StatsOut(BaseModel):
    pending_count: int
    entry_count: int
    top_entries: list[EntryOut]


def _entry_out(e: KnowledgeEntry) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "answer": e.answer,
        "keywords": e.keywords,
        "category": e.category.value if isinstance(e.category, Category) else e.category,
        "source_ticket_id": e.source_ticket_id,
        "ask_count": e.ask_count,
        "is_published": e.is_published,
        "created_at": e.created_at.isoformat() if e.created_at else "",
        "updated_at": e.updated_at.isoformat() if e.updated_at else "",
    }


def _question_out(q: KnowledgeQuestion) -> dict:
    return {
        "id": q.id,
        "question_text": q.question_text,
        "asked_by": q.asked_by,
        "asked_by_name": q.asked_by_name,
        "category": q.category.value if isinstance(q.category, Category) else q.category,
        "status": q.status.value if isinstance(q.status, KnowledgeQuestionStatus) else q.status,
        "matched_entry_id": q.matched_entry_id,
        "resolved_entry_id": q.resolved_entry_id,
        "created_at": q.created_at.isoformat() if q.created_at else "",
        "resolved_at": q.resolved_at.isoformat() if q.resolved_at else None,
        "resolved_by": q.resolved_by,
    }


# ── Vragen stellen (alle medewerkers) ──────────────────────────────────────────

@router.post("/ask", response_model=AskResponse)
async def ask(data: AskRequest, user: RequireUser, db: AsyncSession = Depends(get_db)):
    entries = await knowledge_search.search(db, data.question, data.category)

    if entries:
        top = entries[0]
        top.ask_count += 1
        q = KnowledgeQuestion(
            question_text=data.question,
            asked_by=user.ha_user_id,
            asked_by_name=user.display_name,
            category=data.category,
            status=KnowledgeQuestionStatus.answered_by_bot,
            matched_entry_id=top.id,
        )
        db.add(q)
        await db.flush()
        return AskResponse(
            answered=True,
            question_id=q.id,
            entries=[EntryOut(**_entry_out(e)) for e in entries],
        )

    # Geen antwoord → wachtrij. Voorkom duplicaten: hergebruik een bestaande
    # pending vraag met exact dezelfde tekst.
    existing = await db.execute(
        select(KnowledgeQuestion).where(
            KnowledgeQuestion.status == KnowledgeQuestionStatus.pending,
            func.lower(KnowledgeQuestion.question_text) == data.question.strip().lower(),
        ).limit(1)
    )
    q = existing.scalar_one_or_none()
    if q is None:
        q = KnowledgeQuestion(
            question_text=data.question.strip(),
            asked_by=user.ha_user_id,
            asked_by_name=user.display_name,
            category=data.category,
            status=KnowledgeQuestionStatus.pending,
        )
        db.add(q)
        await db.flush()
    return AskResponse(answered=False, question_id=q.id, entries=[])


# ── Kennisbank bladeren (alle medewerkers) ─────────────────────────────────────

@router.get("/entries", response_model=list[EntryOut])
async def list_entries(
    user: RequireUser,
    q: Optional[str] = Query(None),
    category: Optional[Category] = Query(None),
    include_unpublished: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    query = select(KnowledgeEntry)
    if not (include_unpublished and user.role == Role.admin):
        query = query.where(KnowledgeEntry.is_published == True)  # noqa: E712
    if category is not None:
        query = query.where(KnowledgeEntry.category == category)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                KnowledgeEntry.title.ilike(like),
                KnowledgeEntry.answer.ilike(like),
                KnowledgeEntry.keywords.ilike(like),
            )
        )
    query = query.order_by(KnowledgeEntry.ask_count.desc(), KnowledgeEntry.created_at.desc())
    rows = await db.execute(query)
    return [_entry_out(e) for e in rows.scalars().all()]


@router.get("/stats", response_model=StatsOut)
async def stats(user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    pending = await db.scalar(
        select(func.count(KnowledgeQuestion.id)).where(
            KnowledgeQuestion.status == KnowledgeQuestionStatus.pending
        )
    )
    total = await db.scalar(select(func.count(KnowledgeEntry.id)))
    top_rows = await db.execute(
        select(KnowledgeEntry).order_by(KnowledgeEntry.ask_count.desc()).limit(5)
    )
    return StatsOut(
        pending_count=pending or 0,
        entry_count=total or 0,
        top_entries=[EntryOut(**_entry_out(e)) for e in top_rows.scalars().all()],
    )


@router.get("/entries/{entry_id}", response_model=EntryOut)
async def get_entry(entry_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    e = await db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Kennis-entry niet gevonden")
    return _entry_out(e)


# ── Kennisbeheer (alleen admin) ────────────────────────────────────────────────

@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(data: EntryCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    e = KnowledgeEntry(
        title=data.title.strip(),
        answer=data.answer.strip(),
        keywords=(data.keywords or None),
        category=data.category,
        is_published=data.is_published,
        source_ticket_id=data.source_ticket_id,
        created_by=user.ha_user_id,
    )
    db.add(e)
    await db.flush()
    await db.refresh(e)
    return _entry_out(e)


@router.patch("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: str, data: EntryUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)
):
    _require_admin(user)
    e = await db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Kennis-entry niet gevonden")
    updates = data.model_dump(exclude_unset=True)
    for key, val in updates.items():
        if key in ("title", "answer") and isinstance(val, str):
            val = val.strip()
        setattr(e, key, val)
    await db.flush()
    await db.refresh(e)
    return _entry_out(e)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    e = await db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Kennis-entry niet gevonden")
    await db.delete(e)


# ── Wachtrij (alleen admin) ────────────────────────────────────────────────────

@router.get("/queue", response_model=list[QuestionOut])
async def queue(user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    rows = await db.execute(
        select(KnowledgeQuestion)
        .where(KnowledgeQuestion.status == KnowledgeQuestionStatus.pending)
        .order_by(KnowledgeQuestion.created_at.desc())
    )
    return [_question_out(q) for q in rows.scalars().all()]


@router.post("/queue/{question_id}/answer", response_model=EntryOut, status_code=201)
async def answer_queue(
    question_id: str,
    data: AnswerQueueRequest,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    _require_admin(user)
    q = await db.get(KnowledgeQuestion, question_id)
    if not q:
        raise HTTPException(404, "Vraag niet gevonden")

    entry = KnowledgeEntry(
        title=data.title.strip(),
        answer=data.answer.strip(),
        keywords=(data.keywords or None),
        category=data.category if data.category is not None else q.category,
        created_by=user.ha_user_id,
    )
    db.add(entry)
    await db.flush()

    q.status = KnowledgeQuestionStatus.resolved
    q.resolved_entry_id = entry.id
    q.resolved_at = datetime.now(timezone.utc)
    q.resolved_by = user.ha_user_id
    await db.flush()
    await db.refresh(entry)
    return _entry_out(entry)


@router.post("/queue/{question_id}/dismiss", status_code=200)
async def dismiss_queue(question_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    q = await db.get(KnowledgeQuestion, question_id)
    if not q:
        raise HTTPException(404, "Vraag niet gevonden")
    q.status = KnowledgeQuestionStatus.dismissed
    q.resolved_at = datetime.now(timezone.utc)
    q.resolved_by = user.ha_user_id
    return {"ok": True}


# ── Ticket → kennis (alleen admin) ─────────────────────────────────────────────

@router.post("/from-ticket/{ticket_id}", response_model=EntryOut, status_code=201)
async def from_ticket(
    ticket_id: str,
    data: FromTicketRequest,
    user: RequireUser,
    db: AsyncSession = Depends(get_db),
):
    """Promoveer een gesloten ticket tot kennis-entry. Het antwoord wordt
    voorgevuld uit de omschrijving + comments, tenzij meegegeven in de body."""
    _require_admin(user)
    result = await db.execute(
        select(Ticket).where(Ticket.id == ticket_id).options(selectinload(Ticket.comments))
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(404, "Ticket niet gevonden")
    if ticket.status != Status.closed:
        raise HTTPException(400, "Alleen gesloten tickets kunnen aan de kennisbank toegevoegd worden")

    title = (data.title or ticket.title).strip()

    if data.answer:
        answer = data.answer.strip()
    else:
        parts: list[str] = []
        if ticket.description:
            parts.append(ticket.description.strip())
        comments = sorted(ticket.comments, key=lambda c: c.created_at or datetime.min)
        for c in comments:
            if c.body and c.body.strip():
                parts.append(c.body.strip())
        answer = "\n\n".join(parts) if parts else title

    entry = KnowledgeEntry(
        title=title,
        answer=answer,
        keywords=(data.keywords or None),
        category=data.category if data.category is not None else ticket.category,
        source_ticket_id=ticket.id,
        created_by=user.ha_user_id,
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return _entry_out(entry)
