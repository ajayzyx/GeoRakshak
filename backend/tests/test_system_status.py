from app.config import get_settings
from app.services import status as status_service


def test_status_aggregate_groups_adapters_with_honest_labels(client, authority, citizen):
    assert client.get("/api/v1/system/status", headers=citizen).status_code == 403
    body = client.get("/api/v1/system/status", headers=authority).json()
    assert body["run_mode"] == "DEMO_REPLAY" and body["monitor"]["enabled"] is False
    assert body["pilot"]["slug"] and body["model"]["version"]
    assert body["model"]["validated"] is False and body["model"]["calibrated"] is False, "B0 must not read as validated"
    caveat = body["model"]["caveat"].lower()
    assert "not validated" in caveat and "not statistically optimal" in caveat, \
        "the model caveat must disclaim both validation and optimal thresholds"

    by_slug = {a["slug"]: a for group in body["adapters"].values() for a in group}
    assert by_slug["imd-weather-api"]["effective_label"] == "AWAITING_ACCESS" and by_slug["imd-weather-api"]["is_imd"]
    assert by_slug["imerg-feed"]["effective_label"] == "NOT_CONNECTED"
    assert by_slug["sensor-gateway"]["effective_label"] == "NOT_CONNECTED"
    assert by_slug["virtual-soil-moisture"]["effective_label"] == "SIMULATED"
    assert by_slug["sms-channel"]["effective_label"] == "SANDBOX"
    assert by_slug["app-push-channel"]["effective_label"] == "NOT_CONNECTED"
    assert by_slug["open-meteo-forecast"]["effective_label"] == "NOT_CONNECTED" and by_slug["open-meteo-forecast"]["is_imd"] is False
    assert by_slug["mock-rainfall"]["effective_label"] == "SIMULATED"
    assert "imd-weather-api" in [a["slug"] for a in body["adapters"]["weather"]]
    assert "sms-channel" in [a["slug"] for a in body["adapters"]["notification"]]
    assert set(body["labels"]) >= {"REAL_LIVE", "REAL_REPLAY", "REAL_HISTORICAL", "SIMULATED", "SANDBOX", "AWAITING_ACCESS", "NOT_CONNECTED"}
    assert sum(body["label_counts"].values()) == len(by_slug)
    assert not any(a["effective_label"] == "REAL_LIVE" and a["slug"] != "app-inbox-channel" for a in by_slug.values()), \
        "nothing may claim a live connection in the test fixture"


def test_replayed_real_rainfall_is_labelled_real_replay_only_in_demo_mode(monkeypatch):
    src = {"kind": "WEATHER_HISTORICAL", "connection_status": "CONNECTED_HISTORICAL", "slug": "imd-gridded-rainfall"}
    assert status_service.effective_label(src, "DEMO_REPLAY") == "REAL_REPLAY"
    assert status_service.effective_label(src, "LIVE") == "REAL_HISTORICAL"
    terrain = {"kind": "TERRAIN", "connection_status": "CONNECTED_HISTORICAL", "slug": "copernicus-dem-glo30"}
    assert status_service.effective_label(terrain, "DEMO_REPLAY") == "REAL_HISTORICAL", "only the replayed rainfall is a replay"
    sim = {"kind": "WEATHER_HISTORICAL", "connection_status": "SIMULATED", "slug": "mock-rainfall"}
    assert status_service.effective_label(sim, "DEMO_REPLAY") == "SIMULATED", "simulated never becomes REAL anything"


def test_status_reflects_live_mode_monitor(client, authority, admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "weather_provider", "none")
    client.post("/api/v1/system/monitor/run", headers=admin)
    body = client.get("/api/v1/system/status", headers=authority).json()
    assert body["run_mode"] == "LIVE" and body["monitor"]["enabled"] is True
    assert body["monitor"]["last_status"] == "OK" and body["monitor"]["last_success_at"]
    assert body["monitor"]["weather_provider"] == "none"


def test_licence_class_and_fallback_flags(client, authority):
    from app.services.status import licence_class

    assert licence_class({"licence": "CC-BY 4.0 (Zenodo record)"}) == "OPEN"
    assert licence_class({"licence": "Open Data Commons Open Database License (ODbL) 1.0"}) == "OPEN"
    assert licence_class({"licence": "No open licence found. IMD Pune disclaimer: data 'should not be reproduced anywhere without prior permission'."}) == "RESTRICTED"
    assert licence_class({"licence": "GSI terms: material may be reproduced free of charge after taking proper permission by sending a mail"}) == "RESTRICTED"
    assert licence_class({"licence": "Not checked (portal unreachable)"}) == "UNKNOWN"
    assert licence_class({"licence": None}) == "UNKNOWN"
    assert licence_class({"licence": "CC-BY 4.0", "metadata": {"publication_restricted": True}}) == "RESTRICTED", "explicit flag wins"

    body = client.get("/api/v1/system/status", headers=authority).json()
    by_slug = {a["slug"]: a for group in body["adapters"].values() for a in group}
    assert by_slug["open-meteo-forecast"]["is_fallback"] is True and by_slug["imd-weather-api"]["is_fallback"] is False
    assert by_slug["replay-forecast"]["is_fallback"] is False, "a simulated stand-in is not a fallback provider"
    assert all("publication_restricted" in a and "licence_class" in a for a in by_slug.values())
