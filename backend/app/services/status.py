"""One honest picture of the system for the dashboard: run mode, monitoring cycle, model, pilot and every adapter.

The `effective_label` on each adapter is a *display* label derived from the stored connection status and the run
mode. It is not a new provenance value: it exists so a judge sees the same vocabulary everywhere —
REAL_LIVE · REAL_REPLAY · REAL_HISTORICAL · SIMULATED · SANDBOX · AWAITING_ACCESS · NOT_CONNECTED.
"""
from datetime import datetime, timezone

from app.services import monitor, replay, system

GROUPS = {
    "WEATHER_LIVE": "weather", "WEATHER_FORECAST": "weather", "WEATHER_HISTORICAL": "weather",
    "SATELLITE_FEED": "satellite", "SATELLITE_LAYER": "satellite",
    "SENSOR": "sensor", "INVENTORY": "inventory", "TERRAIN": "terrain", "EXPOSURE": "exposure",
    "NOTIFICATION_CHANNEL": "notification",
}
GROUP_ORDER = ("weather", "satellite", "sensor", "inventory", "terrain", "exposure", "notification", "other")
LABELS = {"CONNECTED_LIVE": "REAL_LIVE", "CONNECTED_HISTORICAL": "REAL_HISTORICAL", "SIMULATED": "SIMULATED",
          "SANDBOX": "SANDBOX", "AWAITING_ACCESS": "AWAITING_ACCESS", "NOT_CONNECTED": "NOT_CONNECTED"}


def effective_label(source: dict, run_mode: str) -> str:
    label = LABELS[source["connection_status"]]
    # Historical rainfall driving a replay is real data being replayed, which is what a viewer needs to know.
    if label == "REAL_HISTORICAL" and run_mode == "DEMO_REPLAY" and source["kind"] == "WEATHER_HISTORICAL":
        return "REAL_REPLAY"
    return label


OPEN_LICENCE_MARKERS = ("cc-by", "cc by", "creative commons", "odbl", "open database", "public domain", "permission to use, reproduce, and distribute", "free licence", "free license")
RESTRICTED_MARKERS = ("prior permission", "without prior", "after taking proper permission", "not be reproduced")


def licence_class(source: dict) -> str:
    """OPEN, RESTRICTED or UNKNOWN. An explicit `metadata.publication_restricted` wins over the wording heuristic."""
    meta = source.get("metadata") or {}
    if "publication_restricted" in meta:
        return "RESTRICTED" if meta["publication_restricted"] else "OPEN"
    text = (source.get("licence") or "").lower()
    if any(m in text for m in RESTRICTED_MARKERS):
        return "RESTRICTED"  # wording like "not without prior permission" outranks any open-licence mention
    if any(m in text for m in OPEN_LICENCE_MARKERS):
        return "OPEN"
    return "UNKNOWN"


def _age_s(ts: datetime | None) -> int | None:
    return None if ts is None else int((datetime.now(timezone.utc) - ts).total_seconds())


def build(conn) -> dict:
    run_mode = system.run_mode()
    rows = conn.execute(
        """SELECT slug, kind, provider, dataset, connection_status::text AS connection_status, verification_status,
                  provenance_default::text AS provenance_default, status_note, last_success_at, last_error, licence,
                  attribution_text, metadata
           FROM data_sources ORDER BY kind, slug"""
    ).fetchall()
    adapters: dict[str, list[dict]] = {g: [] for g in GROUP_ORDER}
    counts: dict[str, int] = {}
    for r in rows:
        entry = {
            "slug": r["slug"], "kind": r["kind"], "provider": r["provider"], "dataset": r["dataset"],
            "connection_status": r["connection_status"], "effective_label": effective_label(r, run_mode),
            "verification_status": r["verification_status"], "provenance_default": r["provenance_default"],
            "status_note": r["status_note"], "last_success_at": r["last_success_at"], "age_s": _age_s(r["last_success_at"]),
            "last_error": r["last_error"], "licence": r["licence"], "attribution_text": r["attribution_text"],
            "is_imd": bool((r["metadata"] or {}).get("is_imd")) or r["slug"].startswith("imd-"),
        }
        entry["is_fallback"] = GROUPS.get(r["kind"]) == "weather" and not entry["is_imd"] and r["connection_status"] != "SIMULATED"
        entry["licence_class"] = licence_class(r)
        entry["publication_restricted"] = entry["licence_class"] == "RESTRICTED"
        adapters[GROUPS.get(r["kind"], "other")].append(entry)
        counts[entry["effective_label"]] = counts.get(entry["effective_label"], 0) + 1

    model = conn.execute(
        """SELECT version, model_type, stage, thresholds, metrics, validation_scheme, forecast_skill_evaluated, model_card_uri
           FROM model_versions WHERE is_active LIMIT 1"""
    ).fetchone()
    pilot = conn.execute("SELECT slug, name, status FROM pilot_area WHERE is_active LIMIT 1").fetchone()
    return {
        "run_mode": run_mode,
        "replay": replay.public_state(system.get_state(conn, "replay")),
        "monitor": monitor.public_state(system.get_state(conn, monitor.STATE_KEY)),
        "pilot": dict(pilot) if pilot else None,
        "model": None if not model else {
            "version": model["version"], "model_type": model["model_type"], "stage": model["stage"],
            "calibrated": bool((model["thresholds"] or {}).get("calibrated")),
            # One caveat string a client can show verbatim: the model's own note plus the operating-threshold note.
            "caveat": " ".join(filter(None, [(model["thresholds"] or {}).get("note"),
                                             (model["thresholds"] or {}).get("severity_thresholds_note")])) or None,
            "validated": model["metrics"] is not None, "metrics": model["metrics"],
            "validation_scheme": model["validation_scheme"], "forecast_skill_evaluated": bool(model["forecast_skill_evaluated"]),
            "model_card_uri": model["model_card_uri"],
        },
        "adapters": adapters,
        "label_counts": counts,
        "labels": {
            "REAL_LIVE": "Connected to a real source now; freshness shown",
            "REAL_REPLAY": "Real archived data replayed through the system for the demo",
            "REAL_HISTORICAL": "Real archived data from a documented source",
            "SIMULATED": "Synthetic data created by the team; never used for training or metrics",
            "SANDBOX": "Rendered and logged, not sent",
            "AWAITING_ACCESS": "Adapter exists; access requested, not granted",
            "NOT_CONNECTED": "Adapter exists; nothing connected",
        },
        "disclaimer": "Decision-support risk estimate. Not an official warning.",
        "as_of": datetime.now(timezone.utc),
    }
