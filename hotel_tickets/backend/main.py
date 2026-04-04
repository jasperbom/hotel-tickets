import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .scheduler import get_scheduler, load_all_templates
from .routers import tickets, users, locations, recurring, reports

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


# Serve frontend (gebouwde React app)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
else:
    logger.warning("Frontend dist niet gevonden, alleen API beschikbaar")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
