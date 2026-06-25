"""
Claude-koppeling voor de kennisbot (Fase 2 / RAG).

De AI krijgt uitsluitend de gevonden context mee en de strikte opdracht om
alléén daaruit te antwoorden — kan hij het niet beantwoorden, dan zet hij
`answered: false` en gaat de vraag (in de router) naar de admin-wachtrij. Zo
verzint de bot nooit zelf antwoorden, ook niet met AI.

De API-sleutel en het model komen uit omgevingsvariabelen (gezet door run.sh
vanuit de addon-opties). Zonder sleutel is de AI simpelweg niet beschikbaar en
valt de app terug op trefwoord-zoeken.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-4-5"

_SYSTEM_PROMPT = (
    "Je bent Jaisper, een vriendelijke interne kennisbot voor hotelpersoneel. Je "
    "voert een gesprek en helpt de medewerker stap voor stap. Gebruik de eerdere "
    "berichten in het gesprek als context.\n"
    "Baseer je inhoudelijke antwoorden UITSLUITEND op de aangeleverde CONTEXT en "
    "wat al in het gesprek staat. Verzin geen feiten en gebruik geen kennis van "
    "buiten de context.\n"
    "Antwoord ALLEEN met een JSON-object van exact deze vorm, zonder code-fences "
    "of extra tekst eromheen:\n"
    '{\"answered\": true|false, \"answer\": \"...\"}\n'
    "- answer is je bericht aan de medewerker, in het Nederlands, in een "
    "natuurlijke gesprekstoon. Geef bij procedures duidelijke, genummerde stappen "
    "en houd het bondig. Je mag één verhelderende vervolgvraag stellen als dat "
    "nodig is om verder te helpen.\n"
    "- Zet answered op true zodra je inhoudelijk reageert op basis van de context "
    "(ook bij een verhelderende vraag of een deelantwoord).\n"
    "- Zet answered alleen op false als het gevraagde echt niet in de context of "
    "het gesprek staat; laat answer dan leeg."
)


_COVERAGE_PROMPT = (
    "Je beoordeelt of een door een medewerker aangedragen OPLOSSING inhoudelijk "
    "al gedekt wordt door de bestaande kennis (CONTEXT). Antwoord ALLEEN met een "
    'JSON-object van exact deze vorm: {\"covered\": true|false}.\n'
    "- covered=true als de oplossing in essentie hetzelfde zegt als wat al in de "
    "context staat (geen nieuwe informatie).\n"
    "- covered=false als de oplossing nieuwe of aanvullende informatie bevat die "
    "nog niet in de context staat."
)


def _extract_json(text: str) -> dict | None:
    """Haal het JSON-object uit het modelantwoord (tolerant voor code-fences)."""
    import re

    cleaned = text.strip()
    # strip ```json ... ``` of ``` ... ```
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        # val terug op het eerste {...}-blok
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except (ValueError, TypeError):
                return None
    return None


def env_model() -> str:
    return (os.environ.get("CLAUDE_MODEL") or "").strip()


def env_api_key() -> str:
    return (os.environ.get("CLAUDE_API_KEY") or "").strip()


async def answer_from_context(
    question: str,
    contexts: list[str],
    api_key: str,
    model: str,
    history: list[dict] | None = None,
) -> dict | None:
    """Vraag Claude een antwoord te formuleren uit de gegeven context-stukken.

    `history` is de voorgaande chatbeurten ([{role, content}, ...]) zodat de bot
    vervolgvragen in context begrijpt. `api_key` en `model` worden door de router
    bepaald (app-instelling, anders addon-optie/omgeving). Retourneert
    {"answered": bool, "answer": str} of None bij een fout / geen sleutel."""
    if not api_key or (not contexts and not history):
        return None

    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        logger.warning("anthropic SDK niet geïnstalleerd; AI niet beschikbaar")
        return None

    client = AsyncAnthropic(api_key=api_key)
    context_text = "\n\n---\n\n".join(contexts) if contexts else "(geen nieuwe context gevonden)"
    user_content = f"CONTEXT:\n{context_text}\n\nVRAAG: {question.strip()}"

    messages: list[dict] = []
    for turn in (history or [])[-10:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        content = (turn.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_content})

    try:
        resp = await client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=messages,
        )
    except Exception as exc:
        logger.warning("Claude-aanroep mislukt: %s", exc)
        return None

    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    data = _extract_json(text)
    if data is None:
        logger.warning("Claude gaf geen geldige JSON terug")
        return None

    return {"answered": bool(data.get("answered")), "answer": (data.get("answer") or "").strip()}


async def is_covered(solution: str, contexts: list[str], api_key: str, model: str) -> bool | None:
    """Beoordeel of een aangedragen oplossing al door de bestaande kennis gedekt
    wordt. Retourneert True/False, of None bij een fout/geen sleutel/geen context
    (de router beslist dan zelf via een eenvoudige tekstvergelijking)."""
    if not api_key or not contexts or not solution.strip():
        return None
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        return None

    client = AsyncAnthropic(api_key=api_key)
    context_text = "\n\n---\n\n".join(contexts)
    user_content = f"CONTEXT:\n{context_text}\n\nAANGEDRAGEN OPLOSSING:\n{solution.strip()}"
    try:
        resp = await client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=64,
            system=_COVERAGE_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as exc:
        logger.warning("Claude coverage-check mislukt: %s", exc)
        return None
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    data = _extract_json(text)
    if data is None:
        return None
    return bool(data.get("covered"))


_EXPAND_PROMPT = (
    "Een hotelmedewerker stelt een vraag. Bedenk korte alternatieve "
    "zoekformuleringen zodat we de juiste kennis terugvinden, ook als die anders "
    "verwoord is. Gebruik synoniemen, kernwoorden en gangbare termen (bijv. "
    "'reset' en 'herstart', 'kapot' en 'storing'). Antwoord ALLEEN met een "
    'JSON-object: {\"queries\": [\"...\", \"...\"]} — maximaal 4 korte varianten in '
    "het Nederlands, zonder uitleg."
)


_CLEANUP_PROMPT = (
    "Je herstructureert ruwe tekst tot een nette, overzichtelijke kennisbank-"
    "pagina voor hotelpersoneel. Behoud ALLE informatie en verzin niets — je mag "
    "alleen herformuleren, ordenen en opmaken.\n"
    "Antwoord ALLEEN met een JSON-object van exact deze vorm:\n"
    '{\"title\": \"...\", \"category\": \"<sleutel of leeg>\", \"folder\": \"...\", \"content\": \"...\"}\n'
    "- title: korte, duidelijke titel.\n"
    "- category: kies de meest passende SLEUTEL uit ALLOWED_CATEGORIES (alleen de "
    "sleutel vóór de haakjes), of laat leeg als niets past.\n"
    "- folder: kort onderwerp/map; hergebruik er één uit BESTAANDE_ONDERWERPEN als "
    "die goed past, anders een passende nieuwe.\n"
    "- content: nette Markdown in het Nederlands, met kopjes (##) per deelonderwerp "
    "en genummerde stappen waar dat logisch is."
)


async def cleanup_document(
    text: str, api_key: str, model: str, categories: list[str], folders: list[str]
) -> dict | None:
    """Herstructureer ruwe tekst tot een nette kennispagina + suggesties voor
    titel/afdeling/onderwerp. Retourneert dict of None."""
    if not api_key or not text.strip():
        return None
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        return None
    client = AsyncAnthropic(api_key=api_key)
    cats = ", ".join(categories)
    folder_list = ", ".join(folders) if folders else "(nog geen)"
    user_content = (
        f"ALLOWED_CATEGORIES: {cats}\n"
        f"BESTAANDE_ONDERWERPEN: {folder_list}\n\n"
        f"RUWE TEKST:\n{text.strip()}"
    )
    try:
        resp = await client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=4096,
            system=_CLEANUP_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as exc:
        logger.warning("Claude opschonen mislukt: %s", exc)
        return None
    out = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    return _extract_json(out)


async def expand_query(question: str, api_key: str, model: str) -> list[str]:
    """Genereer alternatieve zoekformuleringen voor een vraag (synoniemen e.d.).
    Retourneert een lijst varianten of [] bij een fout/geen sleutel."""
    if not api_key or not question.strip():
        return []
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        return []
    client = AsyncAnthropic(api_key=api_key)
    try:
        resp = await client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=200,
            system=_EXPAND_PROMPT,
            messages=[{"role": "user", "content": question.strip()}],
        )
    except Exception as exc:
        logger.warning("Claude query-expansie mislukt: %s", exc)
        return []
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    data = _extract_json(text)
    if not data:
        return []
    queries = data.get("queries") or []
    return [q.strip() for q in queries if isinstance(q, str) and q.strip()][:4]
