"""
Zoeklaag voor de kennisbank.

Fase 1: full-text zoeken via SQLite FTS5 — geen AI, draait offline.
De interface (`KnowledgeSearch.search`) is bewust simpel zodat er later een
semantische/AI-variant (Fase 2) achter geplugd kan worden zonder de router te
wijzigen.
"""
import re
import logging

from sqlalchemy import select, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KnowledgeEntry, Category

logger = logging.getLogger(__name__)


def _build_fts_query(question: str) -> str:
    """Bouw een veilige FTS5 MATCH-query uit vrije tekst.

    We splitsen op woorden, gooien hele korte tokens weg en koppelen ze met OR
    + prefix-match (`"woord"*`) voor brede recall. Elk token staat tussen
    dubbele quotes zodat speciale FTS5-tekens (", *, :, etc.) nooit als syntax
    geïnterpreteerd worden.
    """
    tokens = re.findall(r"\w+", question.lower(), flags=re.UNICODE)
    tokens = [t for t in tokens if len(t) >= 2]
    if not tokens:
        return ""
    return " OR ".join(f'"{t}"*' for t in tokens)


class FtsKnowledgeSearch:
    """Full-text zoeken (FTS5). Geen externe afhankelijkheden."""

    async def search(
        self,
        db: AsyncSession,
        question: str,
        category: Category | None = None,
        limit: int = 5,
    ) -> list[KnowledgeEntry]:
        fts_query = _build_fts_query(question)
        if not fts_query:
            return []

        # Haal de best scorende entry-id's op (bm25: lager = relevanter).
        try:
            rows = await db.execute(
                text(
                    "SELECT entry_id FROM knowledge_fts WHERE knowledge_fts MATCH :q "
                    "ORDER BY bm25(knowledge_fts) LIMIT :lim"
                ),
                {"q": fts_query, "lim": limit * 3},
            )
            ids = [r[0] for r in rows.fetchall()]
        except Exception as exc:  # pragma: no cover - defensief, val terug op LIKE
            logger.warning("FTS-zoekopdracht mislukt (%s), val terug op LIKE", exc)
            return await self._like_fallback(db, question, category, limit)

        if not ids:
            return []

        # Laad de entries, filter op gepubliceerd + (optioneel) afdeling.
        q = select(KnowledgeEntry).where(
            KnowledgeEntry.id.in_(ids),
            KnowledgeEntry.is_published == True,  # noqa: E712
        )
        if category is not None:
            q = q.where(
                or_(KnowledgeEntry.category == category, KnowledgeEntry.category.is_(None))
            )
        result = await db.execute(q)
        by_id = {e.id: e for e in result.scalars().all()}

        # Behoud de relevantievolgorde van FTS.
        ordered = [by_id[i] for i in ids if i in by_id]
        return ordered[:limit]

    async def _like_fallback(
        self,
        db: AsyncSession,
        question: str,
        category: Category | None,
        limit: int,
    ) -> list[KnowledgeEntry]:
        tokens = [t for t in re.findall(r"\w+", question.lower()) if len(t) >= 2]
        if not tokens:
            return []
        clauses = []
        for t in tokens:
            like = f"%{t}%"
            clauses.append(KnowledgeEntry.title.ilike(like))
            clauses.append(KnowledgeEntry.answer.ilike(like))
            clauses.append(KnowledgeEntry.keywords.ilike(like))
        q = select(KnowledgeEntry).where(
            or_(*clauses), KnowledgeEntry.is_published == True  # noqa: E712
        )
        if category is not None:
            q = q.where(
                or_(KnowledgeEntry.category == category, KnowledgeEntry.category.is_(None))
            )
        q = q.order_by(KnowledgeEntry.ask_count.desc()).limit(limit)
        result = await db.execute(q)
        return list(result.scalars().all())


async def search_chunks(
    db: AsyncSession,
    question: str,
    category: "Category | None" = None,
    limit: int = 8,
) -> list[str]:
    """Haal de meest relevante document-chunks op voor een vraag (RAG-retrieval).

    Retourneert een lijst tekstfragmenten (geen objecten) die als context aan de
    AI gegeven worden."""
    fts_query = _build_fts_query(question)
    if not fts_query:
        return []
    try:
        rows = await db.execute(
            text(
                "SELECT content FROM knowledge_chunk_fts WHERE knowledge_chunk_fts MATCH :q "
                "ORDER BY bm25(knowledge_chunk_fts) LIMIT :lim"
            ),
            {"q": fts_query, "lim": limit},
        )
        return [r[0] for r in rows.fetchall()]
    except Exception as exc:  # pragma: no cover - defensief
        logger.warning("Chunk-FTS-zoekopdracht mislukt: %s", exc)
        return []


# Singleton-instantie die de router gebruikt. Later kan dit op basis van de
# 'knowledge_ai_enabled'-instelling een SemanticKnowledgeSearch worden.
knowledge_search = FtsKnowledgeSearch()
