import psycopg
import pytest
from psycopg.rows import dict_row

from app.services import alerts
from tests.conftest import DB, login


def _replay_to(client, admin, step):
    client.post("/api/v1/demo/reset", headers=admin)
    assert client.post("/api/v1/demo/replay/start", headers=admin).status_code == 200
    r = client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": step})
    assert r.status_code == 200, r.text
    return r.json()


def _state(client, authority):
    summary = client.get("/api/v1/dashboard/summary", headers=authority).json()
    zones = client.get("/api/v1/risk-zones", headers=authority).json()["features"]
    alerts_ = client.get("/api/v1/alerts", headers=authority).json()["items"]
    return (
        {k: summary[k] for k in ("risk_zone_counts", "alerts", "reports", "road_segments")},
        sorted((z["properties"]["grid_code"], z["properties"]["severity"], z["properties"]["score"]) for z in zones),
        sorted((a["tier"], a["status"], a["lead_time_h"], len(a["risk_zone_ids"])) for a in alerts_),
    )


def test_forecast_watch_is_internal_automatic_and_separate(client, admin, authority, officer, citizen):
    _replay_to(client, admin, 7)
    watches = client.get("/api/v1/alerts?tier=WATCH", headers=authority).json()["items"]
    forecast = [w for w in watches if w["lead_time_h"] > 0]
    assert forecast, "a cell forecast to reach High must raise an internal forecast WATCH"
    fw = forecast[0]
    assert fw["status"] == "AUTO_DISPATCHED" and fw["approved_by"] is None
    assert "forecast" in fw["messages"]["en"]["title"].lower()
    assert any(i["alert_id"] == fw["id"] for i in client.get("/api/v1/me/inbox", headers=officer).json()["items"])
    assert not any(i["tier"] == "WATCH" for i in client.get("/api/v1/me/inbox", headers=citizen).json()["items"])
    assert all(w["tier"] == "WATCH" for w in watches)
    assert not client.get("/api/v1/alerts?tier=WARNING&status=DISPATCHED", headers=authority).json()["items"], "no public dispatch without approval"


def test_jump_equals_stepping_and_reset_is_deterministic(client, admin, authority):
    client.post("/api/v1/demo/reset", headers=admin)
    client.post("/api/v1/demo/replay/start", headers=admin)
    for _ in range(6):
        assert client.post("/api/v1/demo/replay/step", headers=admin).status_code == 200
    stepped = _state(client, authority)

    jumped_result = _replay_to(client, admin, 6)
    assert jumped_result["replay"]["step"] == 6
    assert _state(client, authority) == stepped
    _replay_to(client, admin, 6)
    assert _state(client, authority) == stepped, "reset + replay must reproduce the same state"

    assert client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": 6}).status_code == 409
    assert client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": 999}).status_code == 409
    assert client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": -1}).status_code == 422

    reset = client.post("/api/v1/demo/reset", headers=admin).json()
    assert reset["villages_access_at_risk"] == 0
    summary = client.get("/api/v1/dashboard/summary", headers=authority).json()
    assert summary["alerts"] == {"DRAFT": 0, "AUTO_DISPATCHED": 0, "DISPATCHED": 0}
    assert summary["road_segments"]["BLOCKED"] == 0 and summary["road_segments"]["AT_RISK"] == 0
    assert client.get("/api/v1/system/mode", headers=authority).json()["replay"] is None


def test_watch_auto_closes_when_risk_subsides_and_a_new_rise_notifies_again(client, admin, authority):
    _replay_to(client, admin, 8)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        open_before = conn.execute("SELECT id FROM alerts WHERE tier = 'WATCH' AND status = 'AUTO_DISPATCHED'").fetchall()
        assert open_before
        conn.execute("UPDATE risk_assessments SET severity = 'LOW' WHERE is_latest AND run_mode = 'DEMO_REPLAY'")
        out = alerts.evaluate(conn, "DEMO_REPLAY")
        assert set(out["watches_auto_closed"]) == {str(r["id"]) for r in open_before}
        closed = conn.execute("SELECT status::text, closed_reason FROM alerts WHERE tier = 'WATCH'").fetchall()
        assert all(r["status"] == "CLOSED" and r["closed_reason"].startswith("AUTO:") for r in closed)
        assert conn.execute("SELECT count(*) AS n FROM audit_events WHERE action = 'ALERT_AUTO_CLOSED'").fetchone()["n"] >= len(open_before)
        drafts = conn.execute("SELECT count(*) AS n FROM alerts WHERE tier = 'WARNING' AND status = 'DRAFT'").fetchone()["n"]
        assert drafts >= 1, "public drafts are never closed automatically"

        zone = conn.execute("SELECT risk_zone_id FROM risk_assessments WHERE is_latest AND lead_time_h = 0 AND run_mode = 'DEMO_REPLAY' LIMIT 1").fetchone()
        conn.execute("UPDATE risk_assessments SET severity = 'HIGH' WHERE is_latest AND lead_time_h = 0 AND risk_zone_id = %s", (zone["risk_zone_id"],))
        again = alerts.evaluate(conn, "DEMO_REPLAY")
        assert again["watch_created"], "a new rise after closure must create and dispatch a new WATCH"
        n = conn.execute("SELECT count(*) AS n FROM notification_deliveries WHERE alert_id = %s", (again["watch_created"],)).fetchone()["n"]
        assert n > 0
        conn.rollback()


def test_update_goes_to_previous_recipients_only_after_approval(client, admin, authority, officer, citizen):
    _replay_to(client, admin, 8)
    draft = client.get("/api/v1/alerts?tier=WARNING&status=DRAFT", headers=authority).json()["items"][0]
    zid = draft["risk_zone_ids"][0]
    assert client.post("/api/v1/alerts", headers=authority, json={"tier": "UPDATE", "risk_zone_ids": [zid], "recommended_actions": "x"}).status_code == 422
    assert client.post("/api/v1/alerts", headers=authority, json={"tier": "UPDATE", "related_alert_id": draft["id"], "recommended_actions": "x"}).status_code == 422

    client.post(f"/api/v1/alerts/{draft['id']}/approve", headers=authority, json={"languages": ["en"], "channels": ["APP_INBOX", "SMS"]})
    warning_recipients = {d["recipient"] for d in client.get(f"/api/v1/alerts/{draft['id']}/deliveries", headers=authority).json()["items"]}

    assert client.post("/api/v1/alerts", headers=authority, json={"tier": "UPDATE", "related_alert_id": draft["id"]}).status_code == 422
    upd = client.post("/api/v1/alerts", headers=authority,
                      json={"tier": "UPDATE", "related_alert_id": draft["id"], "recommended_actions": "Road cleared; risk reduced."})
    assert upd.status_code == 201
    update = upd.json()
    assert update["status"] == "DRAFT" and update["related_alert_id"] == draft["id"] and set(update["risk_zone_ids"]) == set(draft["risk_zone_ids"])
    assert update["messages"]["en"]["title"] == "Landslide risk update"
    assert not any(i["tier"] == "UPDATE" for i in client.get("/api/v1/me/inbox", headers=citizen).json()["items"]), "no UPDATE before approval"

    approved = client.post(f"/api/v1/alerts/{update['id']}/approve", headers=authority, json={"languages": ["en"], "channels": ["APP_INBOX", "SMS"]})
    assert approved.status_code == 200 and approved.json()["status"] == "DISPATCHED"
    update_recipients = {d["recipient"] for d in client.get(f"/api/v1/alerts/{update['id']}/deliveries", headers=authority).json()["items"]}
    assert update_recipients == warning_recipients
    assert any(i["tier"] == "UPDATE" for i in client.get("/api/v1/me/inbox", headers=citizen).json()["items"])

    closed = client.post(f"/api/v1/alerts/{update['id']}/close", headers=authority, json={"note": "AUTO: spoof"}).json()
    assert closed["status"] == "CLOSED" and closed["closed_reason"] == "Authority: AUTO: spoof"


def test_database_enforces_update_approval_and_watch_only_auto_close(client, admin):
    _replay_to(client, admin, 8)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        warning = conn.execute("SELECT id FROM alerts WHERE tier = 'WARNING' LIMIT 1").fetchone()
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE alerts SET tier = 'UPDATE', related_alert_id = id, status = 'DISPATCHED', approved_by = NULL WHERE id = %s", (warning["id"],))
        conn.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE alerts SET tier = 'UPDATE', related_alert_id = NULL WHERE id = %s", (warning["id"],))
        conn.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE alerts SET status = 'CLOSED', closed_reason = 'AUTO: nope' WHERE id = %s", (warning["id"],))
        conn.rollback()


def test_demo_citizen_placement_is_demo_only_and_audited(client, admin, authority, citizen, db):
    """The demo may move DEMO citizen accounts into the risk area; real citizens' locations are never moved."""
    before = db.execute("SELECT count(*) AS n FROM users WHERE role = 'CITIZEN' AND NOT is_demo_account").fetchone()["n"]
    r = client.post("/api/v1/demo/place-citizen", headers=admin, json={"lat": 23.73, "lon": 92.72})
    assert r.status_code == 200 and r.json()["moved"] >= 1 and r.json()["provenance"] == "SIMULATED_DEMO"
    assert client.post("/api/v1/demo/place-citizen", headers=authority, json={"lat": 23.73, "lon": 92.72}).status_code == 403
    assert client.post("/api/v1/demo/place-citizen", headers=admin, json={"lat": 999, "lon": 0}).status_code == 422
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        assert conn.execute("SELECT count(*) AS n FROM users WHERE role = 'CITIZEN' AND NOT is_demo_account").fetchone()["n"] == before
        assert conn.execute("SELECT count(*) AS n FROM audit_events WHERE action = 'DEMO_CITIZEN_PLACED'").fetchone()["n"] >= 1
        moved = conn.execute("""SELECT count(*) AS n FROM users WHERE role = 'CITIZEN' AND is_demo_account
                                AND ST_DWithin(registered_location::geography, ST_SetSRID(ST_MakePoint(92.72, 23.73), 4326)::geography, 1)""").fetchone()["n"]
        assert moved >= 1
