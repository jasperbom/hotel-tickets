from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..auth import RequireUser
from ..services.ha_client import get_areas, get_sensor_state

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/")
async def list_locations(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Haal HA areas op als locaties voor tickets."""
    areas = await get_areas()
    return areas


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
