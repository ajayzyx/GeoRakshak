import psycopg
import pytest

from app.config import get_settings


def _run_replay_until_high(client, admin):
    start = client.post("/api/v1/demo/replay/start", headers=admin)
    assert start.status_code == 200 and start.json()["replay"]["provenance"] == "SIMULATED_DEMO"
    for _ in range(8):
        client.post("/api/v1/demo/replay/step", headers=admin)


def test_demo_controls_require_admin(client, authority):
    assert client.post("/api/v1/demo/replay/start", headers=authority).status_code == 403
    assert client.post("/api/v1/demo/replay/step", headers=authority).status_code == 403


def test_step_before_start_conflicts(client, admin):
    client.post("/api/v1/demo/reset", headers=admin)
    assert client.post("/api/v1/demo/replay/step", headers=admin).status_code == 409


def test_tiered_alert_policy_end_to_end(client, admin, authority, officer, citizen):
    client.post("/api/v1/demo/reset", headers=admin)
    _run_replay_until_high(client, admin)

    forecast = client.get("/api/v1/risk-zones?lead_time_h=48", headers=authority).json()["metadata"]
    assert forecast["forecast_source"]["connection_status"] == "SIMULATED" and forecast["forecast_skill_evaluated"] is False

    watches = client.get("/api/v1/alerts?tier=WATCH", headers=authority).json()["items"]
    current_watches = [w for w in watches if w["lead_time_h"] == 0]
    assert len(current_watches) == 1, "open WATCH alerts must be deduplicated per horizon"
    assert len(watches) - len(current_watches) <= 1
    watch = current_watches[0]
    assert watch["status"] == "AUTO_DISPATCHED" and watch["approved_by"] is None
    assert client.post(f"/api/v1/alerts/{watch['id']}/approve", headers=authority, json={}).status_code == 409

    officer_inbox = client.get("/api/v1/me/inbox", headers=officer).json()["items"]
    assert any(i["alert_id"] == watch["id"] for i in officer_inbox)
    assert not any(i["tier"] == "WATCH" for i in client.get("/api/v1/me/inbox", headers=citizen).json()["items"])
    assert client.post(f"/api/v1/alerts/{watch['id']}/acknowledge", headers=officer).status_code == 200
    assert client.post(f"/api/v1/alerts/{watch['id']}/acknowledge", headers=citizen).status_code == 404

    drafts = client.get("/api/v1/alerts?tier=WARNING&status=DRAFT", headers=authority).json()["items"]
    assert len(drafts) == 1
    draft = drafts[0]
    assert client.get("/api/v1/me/inbox", headers=citizen).json()["items"] == [], "no public warning before approval"
    assert client.post(f"/api/v1/alerts/{draft['id']}/approve", headers=citizen, json={}).status_code == 403
    assert client.patch(f"/api/v1/alerts/{draft['id']}", headers=authority, json={"recommended_actions": "Avoid the road."}).status_code == 200

    bad_lang = client.post(f"/api/v1/alerts/{draft['id']}/approve", headers=authority, json={"languages": ["en", "xx"]})
    assert bad_lang.status_code == 422 and bad_lang.json()["error"]["details"]["unsupported"] == ["xx"]
    assert client.patch(f"/api/v1/alerts/{draft['id']}", headers=authority, json={"languages": []}).status_code == 422
    assert client.get(f"/api/v1/alerts/{draft['id']}", headers=authority).json()["status"] == "DRAFT"

    approved = client.post(f"/api/v1/alerts/{draft['id']}/approve", headers=authority,
                           json={"languages": ["en", "hi"], "channels": ["APP_PUSH", "APP_INBOX", "SMS"]}).json()
    assert approved["status"] == "DISPATCHED" and approved["approved_by"]["full_name"] == "Demo District Authority"
    assert approved["delivery_summary"]["SMS"] == {"SANDBOXED": 2}, "one sandboxed SMS per consenting demo citizen"
    assert approved["delivery_summary"]["APP_INBOX"] == {"SENT": 4}
    assert approved["delivery_summary"]["SMS_COST"]["segments"] >= 3, "Hindi costs 2 UCS-2 segments, English 1"
    assert approved["delivery_summary"]["APP_PUSH"] == {"NOT_CONNECTED": 4}, "push is never claimed as sent"
    assert client.post(f"/api/v1/alerts/{draft['id']}/approve", headers=authority, json={}).status_code == 409
    assert client.patch(f"/api/v1/alerts/{draft['id']}", headers=authority, json={"recommended_actions": "x"}).status_code == 409

    deliveries = client.get(f"/api/v1/alerts/{draft['id']}/deliveries", headers=authority).json()["items"]
    sms = [d for d in deliveries if d["channel"] == "SMS"]
    assert sms and all(d["status"] == "SANDBOXED" and d["channel_mode"] == "SANDBOX" for d in sms)
    assert all(d["destination_masked"].startswith("+91") and "*" in d["destination_masked"]
               and len(d["destination_masked"]) == len("+910000000000") for d in sms), "numbers must be masked, never shown in full"
    citizen_inbox = client.get("/api/v1/me/inbox", headers=citizen).json()["items"]
    assert citizen_inbox and citizen_inbox[0]["tier"] == "WARNING"
    # Each recipient is served in their own language, which is what makes the multilingual beat real.
    langs = {d["language"] for d in deliveries}
    assert langs == {"en", "hi"}, f"expected both demo languages in the delivery log, got {langs}"
    hindi = [d for d in deliveries if d["language"] == "hi"]
    assert all("भूस्खलन" in d["rendered_text"] for d in hindi), "Hindi deliveries must carry the Hindi text"
    assert all(d["sms_encoding"] == "UCS2" and d["sms_segments"] >= 2 for d in hindi if d["channel"] == "SMS")

    assert client.post(f"/api/v1/alerts/{draft['id']}/reject", headers=authority).status_code == 409
    assert client.post(f"/api/v1/alerts/{draft['id']}/close", headers=authority).json()["status"] == "CLOSED"

    statuses = {i["slug"]: i["connection_status"] for i in client.get("/api/v1/data-sources", headers=authority).json()["items"]}
    assert statuses["app-inbox-channel"] == "CONNECTED_LIVE" and statuses["sms-channel"] == "SANDBOX"


def test_database_enforces_policy(db):
    alert_id = db.execute("SELECT id FROM alerts WHERE tier = 'WARNING' LIMIT 1").fetchone()
    watch_id = db.execute("SELECT id FROM alerts WHERE tier = 'WATCH' LIMIT 1").fetchone()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE alerts SET status = 'DISPATCHED', approved_by = NULL WHERE id = %s", (alert_id["id"],))
    db.rollback()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE alerts SET tier = 'WARNING', status = 'AUTO_DISPATCHED' WHERE id = %s", (watch_id["id"],))
    db.rollback()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE notification_deliveries SET status = 'SENT' WHERE channel_mode = 'SANDBOX'")


def test_manual_draft_and_validation(client, authority):
    zid = client.get("/api/v1/risk-zones", headers=authority).json()["features"][0]["id"]
    r = client.post("/api/v1/alerts", headers=authority, json={"tier": "WARNING", "risk_zone_ids": [zid], "recommended_actions": "Stay alert."})
    assert r.status_code == 201 and r.json()["status"] == "DRAFT" and r.json()["trigger_type"] == "MANUAL"
    assert client.post("/api/v1/alerts", headers=authority, json={"tier": "WATCH", "risk_zone_ids": [zid]}).status_code == 422
    assert client.post("/api/v1/alerts", headers=authority, json={"tier": "WARNING", "risk_zone_ids": ["00000000-0000-0000-0000-000000000000"]}).status_code == 422
    assert client.get("/api/v1/alerts/nope", headers=authority).status_code == 404


def test_demo_disabled_in_live_mode(client, admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    assert client.post("/api/v1/demo/replay/start", headers=admin).status_code == 409
    assert client.post("/api/v1/demo/reset", headers=admin).status_code == 409
