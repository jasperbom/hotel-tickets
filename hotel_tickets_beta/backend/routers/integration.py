"""
Endpoint om de HA custom component (integratie) te installeren vanuit de addon.
De addon heeft config:rw in de map, waardoor /config beschikbaar is.
"""
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from ..auth import RequireUser
from ..beta import BETA_MODE

router = APIRouter(prefix="/integration", tags=["integration"])

# Pad naar de gebundelde integratie-bestanden (in de Docker image)
BUNDLED = Path(__file__).parent.parent.parent / "integration"

# Doelpad in de HA config map (beschikbaar via config:rw)
TARGET = Path("/config/custom_components/hotel_tickets")


def _bundled_version() -> str:
    manifest = BUNDLED / "manifest.json"
    if manifest.exists():
        return json.loads(manifest.read_text()).get("version", "?")
    return "?"


def _installed_version() -> str | None:
    manifest = TARGET / "manifest.json"
    if manifest.exists():
        return json.loads(manifest.read_text()).get("version", "?")
    return None


@router.get("/status")
async def integration_status(user: RequireUser):
    installed = _installed_version()
    bundled = _bundled_version()
    return {
        "installed": installed is not None,
        "installed_version": installed,
        "bundled_version": bundled,
        "update_available": installed is not None and installed != bundled,
    }


@router.post("/install")
async def install_integration(user: RequireUser):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Alleen admins kunnen de integratie installeren")
    # De integratie in /config is gedeeld met productie; vanuit de beta
    # installeren zou de productie-integratie overschrijven.
    if BETA_MODE:
        raise HTTPException(
            status_code=400,
            detail="In de beta-omgeving kan de integratie niet geïnstalleerd worden — "
                   "doe dat vanuit de productie-addon.",
        )
    if not BUNDLED.exists():
        raise HTTPException(status_code=500, detail="Integratie-bestanden niet gevonden in de addon")

    TARGET.mkdir(parents=True, exist_ok=True)
    for src in BUNDLED.iterdir():
        shutil.copy2(src, TARGET / src.name)

    return {
        "ok": True,
        "version": _bundled_version(),
        "message": "Integratie geïnstalleerd. Herstart Home Assistant om het te activeren.",
    }
