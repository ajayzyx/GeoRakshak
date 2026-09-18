import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import check_production_safety, get_settings
from app.db import close_pool, get_pool
from app.errors import install_error_handlers
from app.services import monitor, scoring
from app.routers import alerts, auth, demo, layers, priority, reports, risk, roads, sensors, system


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_pool()
    settings = get_settings()
    scoring.apply_severity_thresholds()  # fail fast on a bad SEVERITY_THRESHOLDS value
    problems = check_production_safety(settings)
    log = logging.getLogger("georakshak")
    if problems and settings.run_mode == "LIVE" and not settings.allow_dev_settings:
        raise RuntimeError("Refusing to start in LIVE mode with development settings: " + "; ".join(problems)
                           + ". Set real values (see backend/.env.example), or ALLOW_DEV_SETTINGS=true for local testing only.")
    for problem in problems:
        log.warning("INSECURE: development setting in use: %s", problem)
    if problems and settings.run_mode == "LIVE":
        log.warning("INSECURE: running LIVE mode with development settings because ALLOW_DEV_SETTINGS is set. "
                    "This must never be a deployment.")
    task = None
    if settings.run_mode == "LIVE" and settings.monitor_interval_s > 0:
        task = asyncio.create_task(monitor.scheduler())
    else:
        logging.getLogger("georakshak.monitor").info(
            "monitoring scheduler off (run_mode=%s, interval=%ss); DEMO_REPLAY runs cycles on replay steps",
            settings.run_mode, settings.monitor_interval_s)
    yield
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="GeoRakshak API", version="1.0.0-mvp", lifespan=lifespan,
                  description="Decision-support landslide risk API (SIH26001). Contract: docs/api.md v1.")
    # Real pilot layers are several MB of GeoJSON (e.g. ~5 MB of road segments); venue and field networks are slow.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_methods=["*"], allow_headers=["*"])
    install_error_handlers(app)
    for r in (system, auth, risk, layers, roads, sensors, reports, alerts, priority, demo):
        app.include_router(r.router, prefix="/api/v1")
    return app


app = create_app()
