import uuid

from app.routers import reports as reports_router
from tests.conftest import PNG_1PX, report_body


def test_create_and_duplicate_report(client, officer):
    body = report_body()
    r1 = client.post("/api/v1/reports", headers=officer, json=body)
    assert r1.status_code == 201
    data = r1.json()
    assert data["verification_status"] == "UNVERIFIED" and data["provenance"] == "SIMULATED_DEMO"
    assert data["risk_zone_id"] and data["road_segment_id"]
    r2 = client.post("/api/v1/reports", headers=officer, json=body)
    assert r2.status_code == 200 and r2.json()["id"] == data["id"]


def test_report_client_id_reused_by_other_reporter(client, officer, citizen):
    body = report_body()
    assert client.post("/api/v1/reports", headers=officer, json=body).status_code == 201
    assert client.post("/api/v1/reports", headers=citizen, json=body).status_code == 409


def test_report_validation_and_roles(client, officer, authority):
    assert client.post("/api/v1/reports", headers=officer, json=report_body(gps_accuracy_m=0)).status_code == 422
    assert client.post("/api/v1/reports", headers=officer, json=report_body(category="FLOOD")).status_code == 422
    assert client.post("/api/v1/reports", headers=officer, json=report_body(alert_id=str(uuid.uuid4()))).status_code == 422
    assert client.post("/api/v1/reports", headers=authority, json=report_body()).status_code == 403


def test_citizen_report_unverified_and_scoped_listing(client, citizen, officer, authority):
    r = client.post("/api/v1/reports", headers=citizen, json=report_body(category="CRACK"))
    assert r.status_code == 201 and r.json()["reporter_role"] == "CITIZEN" and r.json()["verification_status"] == "UNVERIFIED"
    own = client.get("/api/v1/reports", headers=citizen).json()["items"]
    assert own and all(i["reporter_role"] == "CITIZEN" for i in own)
    everything = client.get("/api/v1/reports", headers=authority).json()["items"]
    assert len(everything) > len(own)
    assert client.get(f"/api/v1/reports/{r.json()['id']}", headers=officer).status_code == 404


def test_batch_sync_mixed_results(client, officer):
    dup = report_body()
    client.post("/api/v1/reports", headers=officer, json=dup)
    r = client.post("/api/v1/reports/sync", headers=officer, json={"reports": [report_body(), dup, {"client_report_id": "x"}]})
    assert [x["status"] for x in r.json()["results"]] == ["CREATED", "DUPLICATE", "REJECTED"]


def _upload(client, headers, report_id, media_type="PHOTO", mime="image/png", content=PNG_1PX, **extra):
    data = {"client_media_id": extra.pop("client_media_id", str(uuid.uuid4())), "media_type": media_type, **extra}
    return client.post(f"/api/v1/reports/{report_id}/media", headers=headers, data=data, files={"file": ("f", content, mime)})


def test_media_upload_signed_url_and_idempotency(client, officer, authority):
    rid = client.post("/api/v1/reports", headers=officer, json=report_body()).json()["id"]
    cmid = str(uuid.uuid4())
    up = _upload(client, officer, rid, client_media_id=cmid)
    assert up.status_code == 201 and up.json()["upload_status"] == "UPLOADED"
    assert _upload(client, officer, rid, client_media_id=cmid).status_code == 200
    link = client.get(f"/api/v1/media/{up.json()['id']}", headers=authority).json()
    path = link["url"].split("http://localhost:8000", 1)[1]
    assert client.get(path).content == PNG_1PX
    assert client.get(path.replace("sig=", "sig=0")).status_code == 403


def test_media_validation(client, officer, citizen, monkeypatch):
    rid = client.post("/api/v1/reports", headers=officer, json=report_body()).json()["id"]
    assert _upload(client, officer, rid, mime="image/gif").status_code == 422
    assert _upload(client, officer, rid, media_type="VIDEO", mime="video/mp4", content=b"0" * 100, duration_s="31").status_code == 422
    assert _upload(client, officer, rid, media_type="VIDEO", mime="video/mp4", content=b"0" * 100, duration_s="10").status_code == 201
    monkeypatch.setattr(reports_router, "PHOTO_MAX", 10)
    assert _upload(client, officer, rid).status_code == 413
    assert _upload(client, citizen, rid).status_code == 404


def test_verification_blocks_road_and_updates_access(client, officer, authority, db):
    rid = client.post("/api/v1/reports", headers=officer, json=report_body()).json()["id"]
    assert client.post(f"/api/v1/reports/{rid}/verify", headers=officer, json={"decision": "VERIFIED"}).status_code == 403
    r = client.post(f"/api/v1/reports/{rid}/verify", headers=authority, json={"decision": "VERIFIED", "note": "photo checked"})
    effects = r.json()["effects"]
    assert r.status_code == 200 and effects["road_segment"]["status"] == "BLOCKED" and effects["priority_recomputed"]
    seg = client.get("/api/v1/road-segments?status=BLOCKED", headers=authority).json()
    assert seg["features"] and "no evidence of blockage" in seg["metadata"]["status_semantics"]
    assert db.execute("SELECT count(*) AS n FROM audit_events WHERE action = 'REPORT_VERIFIED'").fetchone()["n"] >= 1
    assert client.post("/api/v1/reports/00000000-0000-0000-0000-000000000000/verify", headers=authority, json={"decision": "VERIFIED"}).status_code == 404
    pr = client.get("/api/v1/response-priorities", headers=authority).json()
    assert pr["items"][0]["rank"] == 1 and any("Verified report" in reason for reason in pr["items"][0]["reasons"])
    assert client.get("/api/v1/response-priorities", headers=officer).status_code == 403


def test_road_override(client, authority, officer):
    seg = client.get("/api/v1/road-segments", headers=authority).json()["features"][0]["id"]
    r = client.post(f"/api/v1/road-segments/{seg}/status-override", headers=authority, json={"status": "OPEN", "reason": "Cleared by crew"})
    assert r.status_code == 200 and r.json()["properties"]["status_source"] == "AUTHORITY_OVERRIDE"
    assert client.post(f"/api/v1/road-segments/{seg}/status-override", headers=officer, json={"status": "OPEN", "reason": "x y z"}).status_code == 403
    assert client.post("/api/v1/road-segments/nope/status-override", headers=authority, json={"status": "OPEN", "reason": "Cleared"}).status_code == 404
