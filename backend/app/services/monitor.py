"""Monitoring cycle and its scheduler.

One cycle = score every cell → recompute road status and village access → evaluate the alert policy.
In `DEMO_REPLAY` each replay step runs a cycle. In `LIVE` a background task runs one every
`MONITOR_INTERVAL_S` seconds. Outcomes and failures are recorded in `system_state` under `monitor`
and served by `GET /system/mode`, so a stalled or failing scheduler is visible rather than silent.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.adapters import weather
from app.config import get_settings
from app.db import get_pool
from app.services import alerts, roads, scoring, system, weather_ingest

log = logging.getLogger("georakshak.monitor")
STATE_KEY = "monitor"
WEATHER_STATE_KEY = "weather_last_fetch"


def _weather_due(conn, trigger: str) -> bool:
    """Providers publish a few times a day, so fetching on every cycle only churns rows and burns rate limit."""
    if trigger == "MANUAL":
        return True
    state = system.get_state(conn, WEATHER_STATE_KEY)
    if not state or not state.get("at"):
        return True
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(state["at"])).total_seconds()
    return age >= get_settings().weather_min_interval_s


def prune_history(conn, mode: str) -> dict:
    """LIVE mode keeps a bounded history: superseded assessments and stale forecast issues are dropped.

    DEMO_REPLAY is never pruned, because its issue times are the replayed historical dates and a demo reset
    clears everything anyway.
    """
    if mode != "LIVE":
        return {"pruned": False}
    days = get_settings().assessment_retention_days
    if days <= 0:
        return {"pruned": False}
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    assessments = conn.execute(
        "DELETE FROM risk_assessments WHERE run_mode = 'LIVE' AND NOT is_latest AND issue_time < %s", (cutoff,)).rowcount
    forecasts = conn.execute(
        """DELETE FROM rainfall_forecasts WHERE provenance = 'REAL_LIVE' AND issue_time < %s
             AND issue_time < (SELECT max(issue_time) FROM rainfall_forecasts WHERE provenance = 'REAL_LIVE')""",
        (cutoff,)).rowcount
    return {"pruned": True, "assessments_deleted": assessments, "forecasts_deleted": forecasts, "older_than_days": days}


def run_cycle(conn, mode: str, as_of: datetime) -> dict:
    result = {"scoring": scoring.score_all(conn, mode, as_of)}
    result["roads"] = roads.recompute_model_status(conn, mode)
    result["alerts"] = alerts.evaluate(conn, mode)
    return result


def _summarise(cycle: dict) -> dict:
    a = cycle["alerts"]
    return {
        "scored": cycle["scoring"]["scored"], "model_version": cycle["scoring"]["model_version"],
        "roads_at_risk": cycle["roads"]["at_risk"], "villages_access_at_risk": cycle["roads"]["villages_access_at_risk"],
        "watch_created": a.get("watch_created"), "forecast_watch_created": a.get("forecast_watch_created"),
        "warning_draft_created": a.get("warning_draft_created"), "watches_auto_closed": len(a.get("watches_auto_closed") or []),
        "retention": cycle.get("retention"),
    }


def run_and_record(trigger: str) -> dict:
    """Run one cycle on its own connection and record the outcome, including failures."""
    started = datetime.now(timezone.utc)
    mode = system.run_mode()
    weather_result: dict | None = None
    weather_error: str | None = None
    try:
        with get_pool().connection() as conn:
            # Fetch real rainfall first, when a provider is configured. A weather failure must not stop the
            # cycle: scoring then runs on whatever is already stored, and the error is reported.
            provider = weather.get_provider(get_settings().weather_provider)
            if provider is not None and _weather_due(conn, trigger):
                try:
                    weather_result = weather_ingest.ingest(conn, provider)
                    system.set_state(conn, WEATHER_STATE_KEY, {"at": datetime.now(timezone.utc).isoformat(),
                                                               "provider": provider.slug})
                except weather.NotConnected as e:
                    weather_error = str(e)[:300]
                    log.warning("weather ingest unavailable: %s", weather_error)
            elif provider is not None:
                last = system.get_state(conn, WEATHER_STATE_KEY) or {}
                # Explicit zeros: this cycle wrote nothing. Nulls would read as "unknown" in a client.
                weather_result = {"provider": provider.slug, "is_imd": provider.is_imd, "skipped": "fetched recently",
                                  "min_interval_s": get_settings().weather_min_interval_s, "observations": 0, "forecasts": 0,
                                  "last_fetch_at": last.get("at"),
                                  "observed_source": f"{provider.slug}-recent", "forecast_source": f"{provider.slug}-forecast"}
            cycle = run_cycle(conn, mode, started)
            cycle["retention"] = prune_history(conn, mode)
            state = {"last_run_at": started.isoformat(), "last_success_at": started.isoformat(), "last_status": "OK", "last_error": None,
                     "duration_s": round((datetime.now(timezone.utc) - started).total_seconds(), 2),
                     "trigger": trigger, "run_mode": mode, "result": _summarise(cycle),
                     "weather": weather_result, "weather_error": weather_error}
            system.set_state(conn, STATE_KEY, state)
        log.info("monitoring cycle ok (%s): %s", trigger, state["result"])
        return state
    except Exception as e:  # recorded, not swallowed: the API must be able to show that the cycle is failing
        previous_success = None
        try:
            with get_pool().connection() as conn:
                previous_success = (system.get_state(conn, STATE_KEY) or {}).get("last_success_at")
        except Exception:
            log.exception("could not read the previous successful run")
        # Keeping the last good run lets a client say exactly how stale the displayed risk is.
        state = {"last_run_at": started.isoformat(), "last_success_at": previous_success, "last_status": "FAILED",
                 "last_error": f"{type(e).__name__}: {e}"[:500],
                 "duration_s": round((datetime.now(timezone.utc) - started).total_seconds(), 2),
                 "trigger": trigger, "run_mode": mode, "result": None, "weather": weather_result, "weather_error": weather_error}
        log.exception("monitoring cycle failed (%s)", trigger)
        try:
            with get_pool().connection() as conn:
                system.set_state(conn, STATE_KEY, state)
        except Exception:
            log.exception("could not record the monitoring failure")
        return state


def public_state(state: dict | None) -> dict:
    s = get_settings()
    enabled = s.run_mode == "LIVE" and s.monitor_interval_s > 0
    out = {"enabled": enabled, "interval_s": s.monitor_interval_s if enabled else None,
           "weather_provider": s.weather_provider, "last_run_at": None, "last_success_at": None, "last_status": None, "last_error": None,
           "next_run_at": None, "result": None, "weather": None, "weather_error": None}
    if state:
        out.update({k: state.get(k) for k in ("last_run_at", "last_success_at", "last_status", "last_error", "result", "weather", "weather_error")})
        if enabled and state.get("last_run_at"):
            out["next_run_at"] = (datetime.fromisoformat(state["last_run_at"]) + timedelta(seconds=s.monitor_interval_s)).isoformat()
    if not enabled and s.run_mode == "DEMO_REPLAY":
        out["note"] = "DEMO_REPLAY: cycles run on replay steps, not on a timer"
    return out


async def scheduler() -> None:
    """Background loop for LIVE mode. Each cycle runs in a worker thread, since the database driver is synchronous."""
    interval = get_settings().monitor_interval_s
    log.info("monitoring scheduler started: every %s s", interval)
    while True:
        try:
            await asyncio.to_thread(run_and_record, "SCHEDULER")
        except asyncio.CancelledError:
            log.info("monitoring scheduler stopped")
            raise
        except Exception:  # never let the loop die: the next tick must still run
            log.exception("monitoring scheduler iteration raised")
        await asyncio.sleep(interval)
