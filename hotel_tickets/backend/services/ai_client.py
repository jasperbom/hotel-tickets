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
    "Je bent een interne kennisbot voor hotelpersoneel. Beantwoord de vraag "
    "UITSLUITEND op basis van de aangeleverde CONTEXT. Verzin niets en gebruik "
    "geen kennis van buiten de context.\n"
    "Antwoord ALLEEN met een JSON-object van exact deze vorm, zonder code-fences "
    "of extra tekst eromheen:\n"
    '{\"answered\": true|false, \"answer\": \"...\"}\n'
    "- Kun je de vraag volledig en betrouwbaar uit de context beantwoorden, zet "
    "dan answered op true en geef een bondig, praktisch antwoord in het "
    "Nederlands in answer.\n"
    "- Staat het antwoord niet (duidelijk) in de context, zet dan answered op "
    "false en laat answer leeg.\n"
    "- Geef geen bronverwijzingen of meta-uitleg; alleen het antwoord zelf."
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


def get_model() -> str:
    return (os.environ.get("CLAUDE_MODEL") or "").strip() or DEFAULT_MODEL


def _api_key() -> str:
    return (os.environ.get("CLAUDE_API_KEY") or "").strip()


def is_available() -> bool:
    """Is er een API-sleutel geconfigureerd?"""
    return bool(_api_key())


async def answer_from_context(question: str, contexts: list[str]) -> dict | None:
    """Vraag Claude een antwoord te formuleren uit de gegeven context-stukken.

    Retourneert {"answered": bool, "answer": str} of None bij een fout / geen
    sleutel (de router valt dan terug op de wachtrij)."""
    key = _api_key()
    if not key or not contexts:
        return None

    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        logger.warning("anthropic SDK niet geïnstalleerd; AI niet beschikbaar")
        return None

    client = AsyncAnthropic(api_key=key)
    context_text = "\n\n---\n\n".join(contexts)
    user_content = f"CONTEXT:\n{context_text}\n\nVRAAG: {question.strip()}"

    try:
        resp = await client.messages.create(
            model=get_model(),
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
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
