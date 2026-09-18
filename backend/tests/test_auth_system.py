from tests.conftest import login


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["postgis"]


def test_login_success_and_me(client, authority):
    me = client.get("/api/v1/me", headers=authority).json()
    assert me["role"] == "DISTRICT_AUTHORITY" and me["is_demo_account"] is True


def test_login_wrong_password(client):
    r = client.post("/api/v1/auth/login", json={"email": "authority.demo@example.org", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_me_requires_token(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_patch_me_language(client, officer):
    r = client.patch("/api/v1/me", headers=officer, json={"preferred_language": "hi"})
    assert r.status_code == 200 and r.json()["preferred_language"] == "hi"
    client.patch("/api/v1/me", headers=officer, json={"preferred_language": "en"})


def test_patch_me_validation(client, officer):
    assert client.patch("/api/v1/me", headers=officer, json={"preferred_language": "x"}).status_code == 422


def test_device_registration_is_honest(client, officer, authority):
    r = client.post("/api/v1/me/devices", headers=officer, json={"platform": "ANDROID", "push_token": "fake-token-123456"})
    assert r.status_code == 201 and r.json()["push_channel_status"] == "NOT_CONNECTED"
    assert client.post("/api/v1/me/devices", headers=authority, json={"platform": "ANDROID", "push_token": "fake-token-123456"}).status_code == 403


def test_pilot_and_mode(client, authority):
    pilot = client.get("/api/v1/pilot", headers=authority).json()
    assert pilot["status"] == "MOCK" and "not a real location" in pilot["name"]
    mode = client.get("/api/v1/system/mode", headers=authority).json()
    assert mode["run_mode"] == "DEMO_REPLAY"


def test_data_sources_honest_initial_statuses(client, authority, officer):
    items = {i["slug"]: i["connection_status"] for i in client.get("/api/v1/data-sources", headers=authority).json()["items"]}
    assert items["imd-weather-api"] == "AWAITING_ACCESS"
    assert items["imerg-feed"] == "NOT_CONNECTED"
    assert items["sensor-gateway"] == "NOT_CONNECTED"
    assert items["virtual-soil-moisture"] == "SIMULATED"
    assert items["sms-channel"] == "SANDBOX"
    assert items["app-push-channel"] == "NOT_CONNECTED"
    assert "CONNECTED_LIVE" not in {items["imd-weather-api"], items["imerg-feed"], items["sensor-gateway"]}
    assert client.get("/api/v1/data-sources", headers=officer).status_code == 403
    assert client.get("/api/v1/data-sources/nope", headers=authority).status_code == 404


def test_dashboard_summary(client, authority, citizen):
    s = client.get("/api/v1/dashboard/summary", headers=authority).json()
    assert sum(s["risk_zone_counts"].values()) == 36
    assert client.get("/api/v1/dashboard/summary", headers=citizen).status_code == 403


def test_live_mode_refuses_development_secrets():
    from app.config import DEV_DEFAULTS, Settings, check_production_safety

    dev = Settings(run_mode="LIVE", **DEV_DEFAULTS)
    problems = check_production_safety(dev)
    assert any("JWT_SECRET" in p for p in problems) and any("DEMO_USER_PASSWORD" in p for p in problems)
    safe = Settings(run_mode="LIVE", jwt_secret="a-real-long-secret", demo_user_password="another-real-secret")
    assert check_production_safety(safe) == []
    assert any("every origin" in p for p in check_production_safety(Settings(cors_origins="*")))
    # The escape hatch exists for local LIVE testing and is off by default.
    assert Settings().allow_dev_settings is False
    assert check_production_safety(Settings(run_mode="LIVE", allow_dev_settings=True, **DEV_DEFAULTS)), "problems are still reported"


def test_audit_trail_records_who_did_what(client, admin, authority, officer, citizen):
    from tests.conftest import report_body

    report = client.post("/api/v1/reports", headers=officer, json=report_body()).json()
    client.post(f"/api/v1/reports/{report['id']}/verify", headers=authority, json={"decision": "VERIFIED", "note": "audit test"})

    assert client.get("/api/v1/audit-events", headers=citizen).status_code == 403
    events = client.get("/api/v1/audit-events", headers=authority).json()["items"]
    verified = next(e for e in events if e["action"] == "REPORT_VERIFIED" and e["entity_id"] == report["id"])
    assert verified["actor"]["full_name"] == "Demo District Authority" and verified["details"]["decision"] == "VERIFIED"

    scoped = client.get(f"/api/v1/audit-events?entity_type=report&entity_id={report['id']}", headers=authority).json()["items"]
    assert scoped and all(e["entity_type"] == "report" for e in scoped)
    assert client.get("/api/v1/audit-events?entity_id=not-a-uuid", headers=authority).status_code == 422
    assert client.get("/api/v1/audit-events?limit=0", headers=authority).status_code == 422
