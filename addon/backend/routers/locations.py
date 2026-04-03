from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..auth import RequireUser
from ..services.ha_client import get_areas

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/")
async def list_locations(user: RequireUser, db: AsyncSession = Depends(get_db)):
    """Haal HA areas op als locaties voor tickets."""
    areas = await get_areas()
    return areas
