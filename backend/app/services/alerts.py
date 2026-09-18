"""Tiered alert policy (CLAUDE.md §4a): WATCH auto-dispatches internally; WARNING is drafted and needs human approval."""
from psycopg.types.json import Jsonb

from app.services import channels, templates

DRAFT_LANGUAGES = ["en", "hi"]
INTERNAL_ROLES = ("FIELD_OFFICER", "DISTRICT_AUTHORITY", "STATE_AUTHORITY")
CITIZEN_RADIUS_M = 2000


def _lead_clause(forecast: bool) -> str:
    return "lead_time_h > 0" if forecast else "lead_time_h = 0"


def _open_zone_ids(conn, tier: str, statuses: tuple, mode: str, forecast: bool = False) -> set:
    rows = conn.execute(
        f"""SELECT unnest(risk_zone_ids) AS z FROM alerts
            WHERE tier = %s AND status = ANY(%s::alert_status[]) AND run_mode = %s AND {_lead_clause(forecast)}""",
        (tier, list(statuses), mode),
    ).fetchall()
    return {r["z"] for r in rows}


def _latest_open(conn, tier: str, statuses: tuple, mode: str, forecast: bool = False):
    row = conn.execute(
        f"""SELECT id FROM alerts WHERE tier = %s AND status = ANY(%s::alert_status[]) AND run_mode = %s AND {_lead_clause(forecast)}
            ORDER BY created_at DESC LIMIT 1""",
        (tier, list(statuses), mode),
    ).fetchone()
    return row["id"] if row else None


def _extend(conn, alert_id, zones: list[dict]) -> None:
    ids = [z["zone_id"] for z in zones]
    worst = "VERY_HIGH" if any(z["severity"] == "VERY_HIGH" for z in zones) else "HIGH"
    # The area is rebuilt from the merged cell list with ST_Collect, never unioned incrementally: dissolving two
    # large multipolygons re-nodes every shared grid edge and took ~100 s on a step that added hundreds of cells.
    # ST_Collect is linear, and distance queries (ST_DWithin for recipients) give the same answer on a collection.
    conn.execute(
        """WITH merged AS (
               SELECT ARRAY(SELECT DISTINCT unnest(a.risk_zone_ids || %s::uuid[])) AS ids FROM alerts a WHERE a.id = %s
           )
           UPDATE alerts a SET risk_zone_ids = m.ids,
               area_geom = (SELECT ST_Multi(ST_Collect(rz.geom)) FROM risk_zones rz WHERE rz.id = ANY(m.ids)),
               severity = GREATEST(a.severity, %s::severity),
               lead_time_h = CASE WHEN a.lead_time_h > 0 THEN LEAST(a.lead_time_h, %s) ELSE a.lead_time_h END
           FROM merged m WHERE a.id = %s""",
        (ids, alert_id, worst, min(z["lead_time_h"] for z in zones), alert_id),
    )


def _create(conn, tier: str, status: str, zones: list[dict], mode: str, is_demo: bool, actions: str = "") -> dict:
    sev = "VERY_HIGH" if any(z["severity"] == "VERY_HIGH" for z in zones) else "HIGH"
    lead = min(z["lead_time_h"] for z in zones)
    top = zones[0]
    reason = "; ".join(f["label"] + ": " + f["text"] for f in (top["factors"] or [])[:2]) if top.get("factors") else ""
    key = "WATCH_FORECAST" if tier == "WATCH" and lead > 0 else tier
    msgs = templates.render(key, DRAFT_LANGUAGES, severity=sev.replace("_", " ").title(), n=len(zones), reason=reason, actions=actions, lead=lead)
    return conn.execute(
        """INSERT INTO alerts (tier, status, severity, trigger_type, lead_time_h, area_geom, risk_zone_ids, admin_boundary_id,
               triggering_assessment_id, explanation_snapshot, messages, languages, recommended_actions, run_mode, is_demo,
               dispatched_at)
           SELECT %s, %s, %s, 'AUTOMATIC_THRESHOLD', %s, ST_Multi(ST_Collect(geom)), array_agg(id), min(admin_boundary_id::text)::uuid,
                  %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s = 'AUTO_DISPATCHED' THEN now() END
           FROM risk_zones WHERE id = ANY(%s)
           RETURNING *""",
        (tier, status, sev, lead, top["assessment_id"], Jsonb(top["factors"] or []), Jsonb(msgs), DRAFT_LANGUAGES, actions, mode,
         is_demo, status, [z["zone_id"] for z in zones]),
    ).fetchone()


def internal_recipients(conn) -> list[dict]:
    return conn.execute(
        "SELECT id, preferred_language, phone, sms_enabled FROM users WHERE is_active AND role = ANY(%s::user_role[])",
        (list(INTERNAL_ROLES),),
    ).fetchall()


def public_recipients(conn, alert_id) -> list[dict]:
    return conn.execute(
        f"""SELECT u.id, u.preferred_language, u.phone, u.sms_enabled FROM users u, alerts a
            WHERE a.id = %s AND u.is_active AND (
                u.role = ANY(%s::user_role[])
                OR (u.role = 'CITIZEN' AND u.registered_location IS NOT NULL
                    AND ST_DWithin(u.registered_location::geography, a.area_geom::geography, {CITIZEN_RADIUS_M})))""",
        (alert_id, list(INTERNAL_ROLES)),
    ).fetchall()


def _high_zones(conn, mode: str, forecast: bool) -> list[dict]:
    """Latest High/Very High assessments; for forecasts, the earliest lead at which each cell reaches High."""
    rows = conn.execute(
        f"""SELECT DISTINCT ON (rz.id) rz.id AS zone_id, ra.id AS assessment_id, ra.severity::text AS severity, ra.score, ra.factors,
                  ra.input_provenance, ra.lead_time_h,
                  EXISTS (SELECT 1 FROM reports r WHERE r.risk_zone_id = rz.id AND r.verification_status = 'VERIFIED') AS verified
           FROM risk_zones rz JOIN risk_assessments ra ON ra.risk_zone_id = rz.id AND ra.is_latest AND ra.run_mode = %s AND ra.{_lead_clause(forecast)}
           WHERE ra.severity IN ('HIGH', 'VERY_HIGH') ORDER BY rz.id, ra.lead_time_h""",
        (mode,),
    ).fetchall()
    return sorted(rows, key=lambda z: -z["score"])


def _auto_close_subsided_watches(conn, mode: str, current_ids: set, forecast_ids: set) -> list[str]:
    """Internal WATCH only (public alerts close by authority action). No message is sent; the closure is audited,
    so a later rise creates a new WATCH and notifies again instead of silently extending a stale one."""
    closed = []
    for a in conn.execute(
        "SELECT id, lead_time_h, risk_zone_ids FROM alerts WHERE tier = 'WATCH' AND status = 'AUTO_DISPATCHED' AND run_mode = %s", (mode,)
    ).fetchall():
        forecast = a["lead_time_h"] > 0
        still_high = forecast_ids if forecast else current_ids
        if still_high & set(a["risk_zone_ids"]):
            continue
        reason = f"AUTO: no cell in this watch is High or Very High in the latest {'forecast' if forecast else 'current'} assessment"
        conn.execute("UPDATE alerts SET status = 'CLOSED', closed_at = now(), closed_reason = %s WHERE id = %s", (reason, a["id"]))
        conn.execute(
            "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (NULL, 'ALERT_AUTO_CLOSED', 'alert', %s, %s)",
            (a["id"], Jsonb({"reason": reason})),
        )
        closed.append(str(a["id"]))
    return closed


def _watch(conn, mode: str, zones: list[dict], is_demo: bool, forecast: bool, out: dict) -> None:
    prefix = "forecast_watch" if forecast else "watch"
    covered = _open_zone_ids(conn, "WATCH", ("AUTO_DISPATCHED",), mode, forecast)
    new = [z for z in zones if z["zone_id"] not in covered]
    if not new:
        return
    open_watch = _latest_open(conn, "WATCH", ("AUTO_DISPATCHED",), mode, forecast)
    if open_watch:
        # Deduplicate: one open WATCH per run mode and horizon; newly affected cells extend it instead of re-notifying.
        _extend(conn, open_watch, new)
        out[f"{prefix}_extended"] = str(open_watch)
        return
    alert = _create(conn, "WATCH", "AUTO_DISPATCHED", new, mode, is_demo)
    summary = channels.dispatch(conn, alert, internal_recipients(conn), ["APP_INBOX", "APP_PUSH", "SMS"])
    conn.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (NULL, 'ALERT_AUTO_DISPATCHED', 'alert', %s, %s)",
        (alert["id"], Jsonb({"zones": len(new), "lead_time_h": alert["lead_time_h"], "deliveries": summary})),
    )
    out[f"{prefix}_created"] = str(alert["id"])


def evaluate(conn, mode: str) -> dict:
    """WATCH (internal) is automatic for current or forecast High. WARNING (public) is only ever drafted, from current risk."""
    current = _high_zones(conn, mode, forecast=False)
    forecast = _high_zones(conn, mode, forecast=True)
    current_ids = {z["zone_id"] for z in current}
    out = {"watch_created": None, "warning_draft_created": None,
           "watches_auto_closed": _auto_close_subsided_watches(conn, mode, current_ids, {z["zone_id"] for z in forecast})}
    is_demo = mode == "DEMO_REPLAY" or any("SIMULATED_DEMO" in (z["input_provenance"] or []) for z in current + forecast)

    if current:
        _watch(conn, mode, current, is_demo, False, out)
    # Cells already High now are covered by the current WATCH; the forecast WATCH is for cells expected to reach High.
    upcoming = [z for z in forecast if z["zone_id"] not in current_ids]
    if upcoming:
        _watch(conn, mode, upcoming, is_demo, True, out)

    covered_w = _open_zone_ids(conn, "WARNING", ("DRAFT", "APPROVED", "DISPATCHED"), mode)
    candidates = [z for z in current if z["zone_id"] not in covered_w and (z["severity"] == "VERY_HIGH" or z["verified"])]
    open_draft = _latest_open(conn, "WARNING", ("DRAFT",), mode)
    if candidates and open_draft:
        _extend(conn, open_draft, candidates)
        out["warning_draft_extended"] = str(open_draft)
    elif candidates:
        alert = _create(conn, "WARNING", "DRAFT", candidates, mode, is_demo)
        out["warning_draft_created"] = str(alert["id"])
    return out


def previous_recipients(conn, alert_id) -> list[dict]:
    return conn.execute(
        """SELECT DISTINCT u.id, u.preferred_language, u.phone, u.sms_enabled
           FROM notification_deliveries d JOIN users u ON u.id = d.recipient_id WHERE d.alert_id = %s AND u.is_active""",
        (alert_id,),
    ).fetchall()


def approve(conn, alert: dict, user_id, languages: list[str], chans: list[str], actions: str | None, valid_until) -> dict:
    actions = actions if actions is not None else alert["recommended_actions"]
    sev = alert["severity"].replace("_", " ").title()
    msgs = templates.render(alert["tier"], languages, severity=sev, n=len(alert["risk_zone_ids"]), reason="", actions=actions, lead=alert["lead_time_h"])
    updated = conn.execute(
        """UPDATE alerts SET status = 'DISPATCHED', approved_by = %s, approved_at = now(), dispatched_at = now(), messages = %s,
               languages = %s, recommended_actions = %s, valid_until = COALESCE(%s, valid_until)
           WHERE id = %s AND status = 'DRAFT' RETURNING *""",
        (user_id, Jsonb(msgs), languages, actions, valid_until, alert["id"]),
    ).fetchone()
    # UPDATE / all-clear goes to the people who received the alert it updates (CLAUDE.md §4a).
    recipients = previous_recipients(conn, alert["related_alert_id"]) if alert["tier"] == "UPDATE" else public_recipients(conn, alert["id"])
    summary = channels.dispatch(conn, updated, recipients, chans)
    conn.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (%s, 'ALERT_APPROVED', 'alert', %s, %s)",
        (user_id, alert["id"], Jsonb({"languages": languages, "channels": chans, "deliveries": summary})),
    )
    return {"alert": updated, "delivery_summary": summary}
