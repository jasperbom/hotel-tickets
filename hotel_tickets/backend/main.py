import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import init_db
from .scheduler import get_scheduler, load_all_templates, start_keycard_watcher, start_bike_key_watcher, start_interval_watcher
from .routers import tickets, users, locations, recurring, reports, integration, settings, nfc, pools, bikes, bike_reservations, bike_maintenance, bike_admin

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

# API routes
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


# Serve frontend (gebouwde React app)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    # Assets (hashed bestandsnamen) mogen gecached worden
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    # index.html altijd no-cache serveren zodat de browser nooit oude JS laadt
    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str = ""):
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
