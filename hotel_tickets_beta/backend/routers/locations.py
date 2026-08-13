import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..auth import RequireUser
from ..services.ha_client import get_areas, get_keycard_states, get_sensor_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/")
async def list_locations(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Haal HA areas op als locaties voor tickets."""
    areas = await get_areas()
    return areas


@router.get("/keycards")
async def get_all_keycards(user: RequireUser) -> dict[str, bool]:
    """
    Bezetting van alle kamers in één verzoek: {area_id: bezet}.

    Een lijst met dertig tickets vroeg anders dertig keer los een sensor op.
    Kamers zonder (bruikbare) sensor ontbreken; de voorkant leest een
    ontbrekende sleutel als "onbekend", en dat is iets anders dan "vrij".

    Staat vóór /{area_id}/keycard: anders leest FastAPI "keycards" als area_id.

    Geen Home Assistant, geen fout: dan zijn er domweg geen standen. Een lijst
    met werk hoort niet om te vallen omdat de sensoren even niets zeggen.
    """
    try:
        return await get_keycard_states()
    except Exception:
        logger.warning("Keycard-standen niet op te halen", exc_info=True)
        return {}


@router.get("/{area_id}/keycard")
async def get_keycard_status(area_id: str, user: RequireUser, db: AsyncSession = Depends(get_db)):
    """
    Lees de keycard-sensor van een kamer uit.
    Verwacht een binary_sensor met entity_id: binary_sensor.<area_id>_keycard
    State 'on' = keycard aanwezig (kamer bezet), 'off' = keycard weg (kamer vrij).
    """
    entity_id = f"binary_sensor.{area_id}_keycard"
    state = await get_sensor_state(entity_id)
    if state is None:
        return {"entity_id": entity_id, "found": False, "occupied": None}
    return {
        "entity_id": entity_id,
        "found": True,
        "occupied": state.get("state") == "on",
        "state": state.get("state"),
        "friendly_name": state.get("attributes", {}).get("friendly_name"),
    }
