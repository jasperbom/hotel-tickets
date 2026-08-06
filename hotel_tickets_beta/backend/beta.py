"""
Beta-modus: de addon draait als losse testomgeving naast de productie-addon.

De beta-addon (slug ``hotel_tickets_beta``) draait exact dezelfde code, maar
met een eigen database (``/config/hotel_tickets_beta/``) en een eigen
uploadmap. Omdat beide addons de HA-configmap gedeeld hebben, kan de beta
de productiedatabase rechtstreeks inlezen en kopiëren — zie
``routers/beta.py``.

Wat in beta-modus bewust uit staat, zodat testen nooit het echte hotel raakt:

* uitgaande HA-service-aanroepen (pushmeldingen) — zie ``services/ha_client``
* het bijwerken van de ``sensor.hotel_tickets_*`` entiteiten (die horen bij
  productie; twee addons die dezelfde sensor schrijven vechten met elkaar)
* e-mail via SMTP
* het installeren/overschrijven van de HA custom component in ``/config``
"""
import os
import re
from pathlib import Path

BETA_MODE = os.environ.get("BETA_MODE", "false").lower() == "true"

# Label in de banner bovenin de app
BETA_LABEL = os.environ.get("BETA_LABEL", "BETA")

# Database van de productie-addon; de beta leest deze alleen (read-only) om
# hem te kopiëren.
SOURCE_DB_PATH = os.environ.get("SOURCE_DB_PATH", "/config/hotel_tickets/hotel_tickets.db")

# Uploadmap van de productie-addon (ticketfoto's + kennisbank-afbeeldingen)
SOURCE_UPLOAD_DIR = os.environ.get("SOURCE_UPLOAD_DIR", "/config/hotel_tickets/uploads")

# Ingress-pad van de beta-addon. Na een kopie wijst de meegekopieerde
# instelling ``ticket_base_url`` naar productie; die zetten we om zodat links
# vanuit de beta ook in de beta blijven.
BETA_BASE_URL = os.environ.get("BETA_BASE_URL", "/hassio/ingress/hotel_tickets_beta")


def app_version() -> str:
    """Versie uit het addon-manifest (meegekopieerd in de image)."""
    manifest = Path(__file__).resolve().parent.parent / "config.yaml"
    try:
        for line in manifest.read_text(encoding="utf-8").splitlines():
            m = re.match(r'^version:\s*"?([^"\s]+)"?', line)
            if m:
                return m.group(1)
    except OSError:
        pass
    return "?"
