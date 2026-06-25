"""
Kennisbank / bot voor personeel.

- Iedereen mag vragen stellen en de kennisbank doorzoeken.
- Alleen admins beheren de wachtrij en de entries.

De bot put uitsluitend uit de kennisbank (knowledge_entries) en verzint nooit
zelf antwoorden. Vindt hij niets, dan komt de vraag in de wachtrij voor admins.
"""
import base64
import io
import json
import logging
import os
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
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
    KnowledgeDocument,
    KnowledgeChunk,
    SystemSetting,
    Category,
    Role,
    Ticket,
    Status,
)
from ..services.knowledge_search import knowledge_search, search_chunks
from ..services import ai_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

# Afbeeldingen worden per entry opgeslagen onder UPLOAD_DIR/knowledge/<entry_id>/,
# net als de foto's bij tickets.
UPLOAD_DIR = os.environ.get(
    "UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads")
)
KNOWLEDGE_SUBDIR = "knowledge"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MD_EXTENSIONS = {".md", ".markdown", ".txt"}


def _entry_image_dir(entry_id: str) -> str:
    return os.path.join(UPLOAD_DIR, KNOWLEDGE_SUBDIR, entry_id)


def _load_images(e: KnowledgeEntry) -> list[str]:
    if not e.images:
        return []
    try:
        return json.loads(e.images)
    except (ValueError, TypeError):
        return []


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
    images: list[str] = []
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


class ChatTurn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    category: Optional[Category] = None
    history: list[ChatTurn] = []


class AskResponse(BaseModel):
    answered: bool
    question_id: str
    entries: list[EntryOut]
    ai_answer: Optional[str] = None        # door Claude geformuleerd antwoord (RAG)
    source: Optional[str] = None           # "ai" of "entries"


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
        "images": _load_images(e),
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

async def _setting(db: AsyncSession, key: str) -> str:
    row = await db.get(SystemSetting, key)
    return (row.value if row and row.value else "").strip()


async def _ai_key(db: AsyncSession) -> str:
    """API-sleutel: app-instelling heeft voorrang op de addon-optie/omgeving."""
    return (await _setting(db, "knowledge_ai_key")) or ai_client.env_api_key()


async def _ai_model(db: AsyncSession) -> str:
    return (await _setting(db, "knowledge_ai_model")) or ai_client.env_model() or ai_client.DEFAULT_MODEL


async def _ai_enabled(db: AsyncSession) -> bool:
    """AI is actief als de admin 'm aanzette én er een API-sleutel is."""
    row = await db.get(SystemSetting, "knowledge_ai_enabled")
    if not (row and row.value == "true"):
        return False
    return bool(await _ai_key(db))


async def _log_pending(db: AsyncSession, data: "AskRequest", user) -> AskResponse:
    """Log een onbeantwoorde vraag in de wachtrij (dedup op tekst)."""
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


async def _log_answered(
    db: AsyncSession, data: "AskRequest", user, matched_entry_id: Optional[str]
) -> KnowledgeQuestion:
    q = KnowledgeQuestion(
        question_text=data.question.strip(),
        asked_by=user.ha_user_id,
        asked_by_name=user.display_name,
        category=data.category,
        status=KnowledgeQuestionStatus.answered_by_bot,
        matched_entry_id=matched_entry_id,
    )
    db.add(q)
    await db.flush()
    return q


@router.post("/ask", response_model=AskResponse)
async def ask(data: AskRequest, user: RequireUser, db: AsyncSession = Depends(get_db)):
    # ── RAG-route: AI doorzoekt documenten + entries en formuleert een antwoord ──
    if await _ai_enabled(db):
        # Retrieval-query: bij een vervolgvraag ook de vorige vraag meenemen
        retrieval_q = data.question
        last_user = next(
            (t.content for t in reversed(data.history) if t.role == "user" and t.content), None
        )
        if last_user:
            retrieval_q = f"{last_user} {data.question}"

        chunks = await search_chunks(db, retrieval_q, data.category)
        entries = await knowledge_search.search(db, retrieval_q, data.category)
        contexts: list[str] = list(chunks)
        for e in entries:
            contexts.append(f"{e.title}\n{e.answer}")

        history = [{"role": t.role, "content": t.content} for t in data.history]
        if contexts or history:
            result = await ai_client.answer_from_context(
                data.question, contexts, await _ai_key(db), await _ai_model(db), history=history
            )
            if result is not None:
                if result["answered"] and result["answer"]:
                    matched_id = entries[0].id if entries else None
                    if entries:
                        entries[0].ask_count += 1
                    q = await _log_answered(db, data, user, matched_id)
                    return AskResponse(
                        answered=True,
                        question_id=q.id,
                        entries=[EntryOut(**_entry_out(e)) for e in entries],
                        ai_answer=result["answer"],
                        source="ai",
                    )
                # AI concludeert dat het antwoord er niet in staat → wachtrij
                return await _log_pending(db, data, user)
        # Geen context gevonden → wachtrij
        return await _log_pending(db, data, user)

    # ── Zonder AI: trefwoord-zoeken in de kennisbank-entries ──
    entries = await knowledge_search.search(db, data.question, data.category)
    if entries:
        top = entries[0]
        top.ask_count += 1
        q = await _log_answered(db, data, user, top.id)
        return AskResponse(
            answered=True,
            question_id=q.id,
            entries=[EntryOut(**_entry_out(e)) for e in entries],
            source="entries",
        )
    return await _log_pending(db, data, user)


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


# ── Afbeeldingen bij entries (alleen admin) ────────────────────────────────────

def _safe_image_name(name: str) -> str:
    base = unquote(os.path.basename((name or "").split("?")[0].split("#")[0]))
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return base or "afbeelding"


@router.post("/entries/{entry_id}/images", status_code=201)
async def upload_image(
    entry_id: str,
    user: RequireUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    _require_admin(user)
    e = await db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Kennis-entry niet gevonden")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(400, "Alleen afbeeldingen zijn toegestaan")
    d = _entry_image_dir(entry_id)
    os.makedirs(d, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(d, fname), "wb") as f:
        f.write(await file.read())
    imgs = _load_images(e)
    imgs.append(fname)
    e.images = json.dumps(imgs)
    await db.flush()
    return {"filename": fname}


@router.get("/entries/{entry_id}/images/{filename}")
async def get_image(entry_id: str, filename: str, user: RequireUser):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Ongeldige bestandsnaam")
    filepath = os.path.join(_entry_image_dir(entry_id), filename)
    if not os.path.isfile(filepath):
        raise HTTPException(404, "Afbeelding niet gevonden")
    return FileResponse(filepath)


@router.delete("/entries/{entry_id}/images/{filename}", status_code=204)
async def delete_image(
    entry_id: str, filename: str, user: RequireUser, db: AsyncSession = Depends(get_db)
):
    _require_admin(user)
    e = await db.get(KnowledgeEntry, entry_id)
    if not e:
        raise HTTPException(404, "Kennis-entry niet gevonden")
    base = os.path.basename(filename)
    filepath = os.path.join(_entry_image_dir(entry_id), base)
    if os.path.isfile(filepath):
        os.remove(filepath)
    imgs = [i for i in _load_images(e) if i != base]
    e.images = json.dumps(imgs) if imgs else None
    await db.flush()


# ── Import vanuit Markdown / ZIP (alleen admin) ────────────────────────────────

_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
_QPREFIX_RE = re.compile(r"^\s*(?:Q|Vraag|Question)\s*[:.\-]\s*(.+)$", re.IGNORECASE)
_BOLD_LINE_RE = re.compile(r"^\s*\*\*(.+?)\*\*\s*:?\s*$")
_APREFIX_RE = re.compile(r"^\s*(?:A|Antwoord|Answer)\s*[:.\-]\s*", re.IGNORECASE)
_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def _detect_question(line: str) -> Optional[str]:
    for rx in (_HEADING_RE, _QPREFIX_RE, _BOLD_LINE_RE):
        m = rx.match(line)
        if m:
            return m.group(1).strip()
    return None


def _parse_qa(md_text: str) -> list[tuple[str, str]]:
    """Splits Markdown in (titel, antwoord)-paren. Elke kop (#/##/###), 'Q:'-regel
    of vetgedrukte regel start een nieuwe vraag; de tekst eronder is het antwoord."""
    pairs: list[tuple[str, str]] = []
    title: Optional[str] = None
    body: list[str] = []

    def flush():
        if title:
            answer = "\n".join(body).strip()
            answer = _APREFIX_RE.sub("", answer, count=1).strip()
            pairs.append((title, answer))

    for line in md_text.splitlines():
        q = _detect_question(line)
        if q is not None:
            flush()
            title = q
            body = []
        elif title is not None:
            body.append(line)
    flush()
    return pairs


def _process_images(answer: str, zip_images: dict[str, bytes], entry_dir: str) -> tuple[str, list[str]]:
    """Vind image-refs in het antwoord, sla de bytes op (uit ZIP of base64) en
    herschrijf de ref naar de opgeslagen bestandsnaam. Externe/onbekende refs
    blijven ongewijzigd."""
    stored: list[str] = []

    def repl(m: "re.Match") -> str:
        alt, ref = m.group(1), m.group(2).strip()
        data_m = re.match(r"data:image/([\w+]+);base64,(.+)", ref, re.DOTALL)
        if data_m:
            ext = "." + data_m.group(1).lower().replace("jpeg", "jpg").replace("svg+xml", "svg")
            try:
                raw = base64.b64decode(data_m.group(2))
            except Exception:
                return m.group(0)
            fname = f"{uuid.uuid4().hex}{ext}"
            os.makedirs(entry_dir, exist_ok=True)
            with open(os.path.join(entry_dir, fname), "wb") as f:
                f.write(raw)
            stored.append(fname)
            return f"![{alt}]({fname})"
        base = unquote(os.path.basename(ref.split("?")[0].split("#")[0]))
        if base in zip_images:
            ext = os.path.splitext(base)[1].lower() or ".png"
            fname = f"{uuid.uuid4().hex}{ext}"
            os.makedirs(entry_dir, exist_ok=True)
            with open(os.path.join(entry_dir, fname), "wb") as f:
                f.write(zip_images[base])
            stored.append(fname)
            return f"![{alt}]({fname})"
        return m.group(0)

    return _IMG_RE.sub(repl, answer), stored


class ImportResult(BaseModel):
    found: int
    imported: int
    skipped: int
    images: int


@router.post("/import", response_model=ImportResult)
async def import_qa(
    user: RequireUser,
    file: UploadFile = File(...),
    category: Optional[Category] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Importeer Q&A uit een .md-bestand of een .zip (Markdown + afbeeldingen).
    Duplicaten (zelfde titel) worden overgeslagen."""
    _require_admin(user)
    raw = await file.read()
    fname = (file.filename or "").lower()

    md_texts: list[str] = []
    zip_images: dict[str, bytes] = {}

    is_zip = fname.endswith(".zip") or raw[:2] == b"PK"
    if is_zip:
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise HTTPException(400, "Ongeldig ZIP-bestand")
        for info in zf.infolist():
            if info.is_dir():
                continue
            ext = os.path.splitext(info.filename)[1].lower()
            if ext in MD_EXTENSIONS:
                md_texts.append(zf.read(info).decode("utf-8", errors="replace"))
            elif ext in IMAGE_EXTENSIONS:
                zip_images[os.path.basename(info.filename)] = zf.read(info)
    else:
        md_texts.append(raw.decode("utf-8", errors="replace"))

    if not md_texts:
        raise HTTPException(400, "Geen Markdown/tekst gevonden in het bestand")

    pairs: list[tuple[str, str]] = []
    for txt in md_texts:
        pairs.extend(_parse_qa(txt))

    if not pairs:
        raise HTTPException(
            400,
            "Geen vraag/antwoord-paren gevonden. Zet elke vraag als een kop "
            "(#, ## of ###) met het antwoord eronder.",
        )

    imported = 0
    skipped = 0
    images_stored = 0
    for title, answer in pairs:
        title = title.strip()
        if not title:
            continue
        exists = await db.execute(
            select(KnowledgeEntry.id)
            .where(func.lower(KnowledgeEntry.title) == title.lower())
            .limit(1)
        )
        if exists.scalar_one_or_none() is not None:
            skipped += 1
            continue
        entry = KnowledgeEntry(
            title=title,
            answer=answer or title,
            category=category,
            created_by=user.ha_user_id,
        )
        db.add(entry)
        await db.flush()  # entry.id beschikbaar
        new_answer, stored = _process_images(entry.answer, zip_images, _entry_image_dir(entry.id))
        if stored:
            entry.answer = new_answer
            entry.images = json.dumps(stored)
            images_stored += len(stored)
        imported += 1

    await db.flush()
    return ImportResult(found=len(pairs), imported=imported, skipped=skipped, images=images_stored)


# ── Documenten (RAG-bron) + AI-instellingen (alleen admin) ─────────────────────

def _chunk_text(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    """Hak tekst in overlappende stukken voor retrieval. Splitst bij voorkeur op
    paragraafgrenzen en valt anders terug op harde knippen."""
    text = text.strip()
    if not text:
        return []
    paragraphs = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) + 2 <= size:
            current = f"{current}\n\n{para}" if current else para
        else:
            if current:
                chunks.append(current)
            # paragraaf zelf te groot? hard knippen met overlap
            if len(para) > size:
                start = 0
                while start < len(para):
                    chunks.append(para[start:start + size])
                    start += size - overlap
                current = ""
            else:
                current = para
    if current:
        chunks.append(current)
    return chunks


def _extract_text(filename: str, raw: bytes) -> str:
    """Haal platte tekst uit een geüpload bestand (.md/.txt/.pdf/.zip)."""
    name = (filename or "").lower()
    ext = os.path.splitext(name)[1]
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            return "\n\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception as exc:
            raise HTTPException(400, f"PDF kon niet gelezen worden: {exc}")
    if ext == ".zip" or raw[:2] == b"PK":
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise HTTPException(400, "Ongeldig ZIP-bestand")
        parts: list[str] = []
        for info in zf.infolist():
            if info.is_dir():
                continue
            iext = os.path.splitext(info.filename)[1].lower()
            if iext in MD_EXTENSIONS:
                parts.append(zf.read(info).decode("utf-8", errors="replace"))
            elif iext == ".pdf":
                try:
                    from pypdf import PdfReader
                    reader = PdfReader(io.BytesIO(zf.read(info)))
                    parts.append("\n\n".join((p.extract_text() or "") for p in reader.pages))
                except Exception:
                    continue
        return "\n\n".join(parts)
    # tekst/markdown
    return raw.decode("utf-8", errors="replace")


async def _store_document_chunks(db: AsyncSession, doc: KnowledgeDocument) -> int:
    for ch in _chunk_text(doc.content):
        db.add(KnowledgeChunk(document_id=doc.id, ordinal=0, content=ch))
    await db.flush()
    count = await db.scalar(
        select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.document_id == doc.id)
    )
    return count or 0


class DocumentOut(BaseModel):
    id: str
    title: str
    source_filename: Optional[str] = None
    category: Optional[Category] = None
    chunk_count: int = 0
    created_at: str


class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)
    category: Optional[Category] = None


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    rows = await db.execute(select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc()))
    docs = rows.scalars().all()
    out = []
    for d in docs:
        cnt = await db.scalar(
            select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.document_id == d.id)
        )
        out.append(DocumentOut(
            id=d.id,
            title=d.title,
            source_filename=d.source_filename,
            category=d.category.value if isinstance(d.category, Category) else d.category,
            chunk_count=cnt or 0,
            created_at=d.created_at.isoformat() if d.created_at else "",
        ))
    return out


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def create_document(data: DocumentCreate, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Plak vrije tekst als kennisdocument."""
    _require_admin(user)
    doc = KnowledgeDocument(
        title=data.title.strip(),
        content=data.content.strip(),
        category=data.category,
        created_by=user.ha_user_id,
    )
    db.add(doc)
    await db.flush()
    cnt = await _store_document_chunks(db, doc)
    return DocumentOut(
        id=doc.id, title=doc.title, source_filename=None,
        category=doc.category.value if isinstance(doc.category, Category) else doc.category,
        chunk_count=cnt, created_at=doc.created_at.isoformat() if doc.created_at else "",
    )


@router.post("/documents/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    user: RequireUser,
    file: UploadFile = File(...),
    title: Optional[str] = Query(None),
    category: Optional[Category] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload een document (.md/.txt/.pdf/.zip) als kennisbron voor de AI."""
    _require_admin(user)
    raw = await file.read()
    content = _extract_text(file.filename or "", raw).strip()
    if not content:
        raise HTTPException(400, "Geen tekst gevonden in het bestand")
    doc = KnowledgeDocument(
        title=(title or os.path.splitext(file.filename or "Document")[0]).strip() or "Document",
        source_filename=file.filename,
        content=content,
        category=category,
        created_by=user.ha_user_id,
    )
    db.add(doc)
    await db.flush()
    cnt = await _store_document_chunks(db, doc)
    return DocumentOut(
        id=doc.id, title=doc.title, source_filename=doc.source_filename,
        category=doc.category.value if isinstance(doc.category, Category) else doc.category,
        chunk_count=cnt, created_at=doc.created_at.isoformat() if doc.created_at else "",
    )


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    doc = await db.get(KnowledgeDocument, document_id)
    if not doc:
        raise HTTPException(404, "Document niet gevonden")
    await db.delete(doc)


class AiSettingsOut(BaseModel):
    ai_available: bool          # is er een API-sleutel beschikbaar (app of addon)?
    ai_enabled: bool            # heeft de admin AI aangezet?
    model: str                  # actief model
    has_key: bool               # is er überhaupt een sleutel ingesteld?
    key_from_addon: bool        # komt de sleutel uit de addon-optie (env)?


class AiSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    api_key: Optional[str] = None   # "" of null = niet wijzigen; spaties = wissen
    model: Optional[str] = None


async def _set_setting(db: AsyncSession, key: str, value: str | None) -> None:
    row = await db.get(SystemSetting, key)
    if value:
        if row:
            row.value = value
        else:
            db.add(SystemSetting(key=key, value=value))
    elif row is not None:
        # lege waarde → instelling verwijderen (valt terug op addon-optie)
        await db.delete(row)


async def _ai_settings_out(db: AsyncSession) -> AiSettingsOut:
    enabled_row = await db.get(SystemSetting, "knowledge_ai_enabled")
    app_key = await _setting(db, "knowledge_ai_key")
    env_key = ai_client.env_api_key()
    return AiSettingsOut(
        ai_available=bool(app_key or env_key),
        ai_enabled=bool(enabled_row and enabled_row.value == "true"),
        model=await _ai_model(db),
        has_key=bool(app_key or env_key),
        key_from_addon=not app_key and bool(env_key),
    )


@router.get("/ai-settings", response_model=AiSettingsOut)
async def get_ai_settings(user: RequireUser, db: AsyncSession = Depends(get_db)):
    _require_admin(user)
    return await _ai_settings_out(db)


@router.patch("/ai-settings", response_model=AiSettingsOut)
async def update_ai_settings(
    data: AiSettingsUpdate, user: RequireUser, db: AsyncSession = Depends(get_db)
):
    _require_admin(user)
    if data.enabled is not None:
        await _set_setting(db, "knowledge_ai_enabled", "true" if data.enabled else "false")
    if data.api_key is not None:
        # lege string laat ongewijzigd; alleen-spaties wist de sleutel
        if data.api_key == "":
            pass
        else:
            await _set_setting(db, "knowledge_ai_key", data.api_key.strip())
    if data.model is not None:
        await _set_setting(db, "knowledge_ai_model", data.model.strip())
    await db.flush()
    return await _ai_settings_out(db)
