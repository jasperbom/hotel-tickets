import ipaddress
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .database import init_db
from .scheduler import get_scheduler, load_all_templates, start_keycard_watcher, start_bike_key_watcher, start_interval_watcher
from .routers import auth, tickets, users, locations, recurring, reports, integration, settings, nfc, pools, bikes, bike_reservations, bike_maintenance, bike_admin, knowledge, notifications

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Database initialiseren...")
    await init_db()

    logger.info("Scheduler starten...")
    scheduler = get_scheduler()
    scheduler.start()
    await load_all_templates()
    start_keycard_watcher()
    start_bike_key_watcher()
    start_interval_watcher()

    yield

    # Shutdown
    logger.info("Scheduler stoppen...")
    scheduler.shutdown()


app = FastAPI(
    title="Hotel Ticket System",
    version="1.0.0",
    lifespan=lifespan,
    # Disable docs in production (HA ingress)
    docs_url="/api/docs" if os.environ.get("DEV_MODE") else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Netwerkrestrictie ──────────────────────────────────────────────────────────
# Wanneer ALLOWED_NETWORKS gezet is (komma-gescheiden CIDR's, bijv.
# "192.168.1.0/24") worden verzoeken van andere IP's geweigerd. Interne HA
# bronnen (ingress-proxy, Supervisor, loopback) blijven altijd toegestaan.
# De echte afscherming is het níet port-forwarden van de addon-poort; dit is
# verdediging in de diepte.
_ALWAYS_ALLOWED = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("172.30.32.0/23"),  # HA Supervisor docker-netwerk
]

def _parse_allowed_networks() -> list:
    networks = []
    for raw in os.environ.get("ALLOWED_NETWORKS", "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            networks.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            logger.warning("Ongeldige CIDR in ALLOWED_NETWORKS genegeerd: %r", raw)
    return networks

ALLOWED_NETWORKS = _parse_allowed_networks()
if ALLOWED_NETWORKS:
    logger.info("Netwerkrestrictie actief: %s", ", ".join(str(n) for n in ALLOWED_NETWORKS))


@app.middleware("http")
async def restrict_networks(request: Request, call_next):
    if ALLOWED_NETWORKS:
        client_host = request.client.host if request.client else ""
        try:
            client_ip = ipaddress.ip_address(client_host)
        except ValueError:
            return JSONResponse(status_code=403, content={"detail": "Toegang geweigerd"})
        if not any(client_ip in net for net in _ALWAYS_ALLOWED + ALLOWED_NETWORKS):
            logger.warning("Verzoek geweigerd van %s (buiten toegestane netwerken)", client_host)
            return JSONResponse(
                status_code=403,
                content={"detail": "Toegang alleen mogelijk vanaf het bedrijfsnetwerk"},
            )
    return await call_next(request)


# API routes
app.include_router(auth.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(locations.router, prefix="/api")
app.include_router(recurring.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(integration.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(nfc.router, prefix="/api")
app.include_router(pools.router, prefix="/api")
app.include_router(bikes.router, prefix="/api")
app.include_router(bike_reservations.router, prefix="/api")
app.include_router(bike_maintenance.router, prefix="/api")
app.include_router(bike_admin.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")


# Serve frontend (gebouwde React app)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    # Assets (hashed bestandsnamen) mogen gecached worden
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    # index.html altijd no-cache serveren zodat de browser nooit oude JS laadt
    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str = ""):
        # Statische bestanden in de dist-root (app-iconen, favicon, manifest)
        # direct serveren — de SPA-fallback zou er anders index.html voor
        # teruggeven en dan toont iOS geen beginscherm-icoon. Alleen kale
        # bestandsnamen (geen "/" of leidende ".") zodat path traversal
        # onmogelijk is.
        if (
            full_path
            and "/" not in full_path
            and not full_path.startswith(".")
            and full_path != "index.html"
        ):
            candidate = os.path.join(frontend_dist, full_path)
            if os.path.isfile(candidate):
                media_type = (
                    "application/manifest+json"
                    if full_path.endswith(".webmanifest")
                    else None
                )
                return FileResponse(
                    candidate,
                    media_type=media_type,
                    headers={"Cache-Control": "public, max-age=86400"},
                )
        index = os.path.join(frontend_dist, "index.html")
        return FileResponse(
            index,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
else:
    logger.warning("Frontend dist niet gevonden, alleen API beschikbaar")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
