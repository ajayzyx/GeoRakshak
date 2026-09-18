"""End-to-end smoke test against a running backend in DEMO_REPLAY mode (docs/demo.md, CLAUDE.md §8 rule 8).

Flow: reset → rainfall replay → risk change → cell explanation → internal WATCH (automatic) → public WARNING draft
(not dispatched) → field report + photo (duplicate-safe) → verification → road BLOCKED → response priority →
human approval → deliveries (SMS sandboxed, push not connected).

It RESETS the demo data first, so the run is repeatable. Standard library only; exits non-zero on the first failure.

Usage: python -m scripts.smoke_e2e [--api http://localhost:8000/api/v1] [--max-steps 60]
The demo account password comes from DEMO_USER_PASSWORD (default: the local-development value).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

# 1×1 PNG generated for tests. Not a real photo; the report is labelled SIMULATED_DEMO by the backend.
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082"
)
EXPECTED_STATUSES = {
    "imd-weather-api": "AWAITING_ACCESS",
    "sms-channel": "SANDBOX",
    "app-push-channel": "NOT_CONNECTED",
    "sensor-gateway": "NOT_CONNECTED",
    "imerg-feed": "NOT_CONNECTED",
    "replay-forecast": "SIMULATED",
    "virtual-soil-moisture": "SIMULATED",
}


class SmokeFailure(Exception):
    pass


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, token: str | None = None, body=None, expect=(200,), raw: bytes | None = None, content_type=None, extra: dict | None = None):
        headers = {"Accept": "application/json", **(extra or {})}
        data = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if raw is not None:
            data, headers["Content-Type"] = raw, content_type
        elif body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                status, payload = res.status, res.read()
        except urllib.error.HTTPError as e:
            status, payload = e.code, e.read()
        except urllib.error.URLError as e:
            raise SmokeFailure(f"{method} {path}: cannot reach the API ({e.reason})") from e
        parsed = json.loads(payload) if payload else None
        if status not in expect:
            raise SmokeFailure(f"{method} {path}: HTTP {status}, expected {expect}: {json.dumps(parsed)[:400]}")
        return status, parsed

    def get(self, path, token, **kw):
        return self.call("GET", path, token, **kw)[1]

    def post(self, path, token, body=None, **kw):
        return self.call("POST", path, token, body, **kw)[1]


def multipart(fields: dict, filename: str, mime: str, content: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + content + b"\r\n")
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def check(condition, message: str):
    if not condition:
        raise SmokeFailure(message)


def _bbox_of(cell: dict) -> str:
    ring = cell["geometry"]["coordinates"][0]
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    return f"{min(lons)},{min(lats)},{max(lons)},{max(lats)}"


def _centre_of(cell: dict) -> tuple[float, float]:
    ring = cell["geometry"]["coordinates"][0][:-1]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def midpoint(line: dict) -> list[float]:
    coords = line["coordinates"] if line["type"] == "LineString" else line["coordinates"][0]
    return coords[len(coords) // 2]


def run(api: Api, password: str, max_steps: int) -> list[tuple[str, str]]:
    log: list[tuple[str, str]] = []
    t0 = time.time()

    def ok(step: str, detail: str):
        log.append((step, detail))
        print(f"  ✓ {step:<34} {detail}  [{time.time() - t0:5.1f}s]", flush=True)

    health = api.get("/health", None)
    check(health.get("status") == "ok" and health.get("database") == "ok", f"health not ok: {health}")
    tok = {r: api.post("/auth/login", None, {"email": f"{r}.demo@example.org", "password": password})["access_token"]
           for r in ("admin", "authority", "officer", "citizen")}
    mode = api.get("/system/mode", tok["authority"])
    check(mode["run_mode"] == "DEMO_REPLAY", f"backend must run in DEMO_REPLAY mode, got {mode['run_mode']}")
    pilot = api.get("/pilot", tok["authority"])
    ok("health, login, pilot", f"pilot={pilot['slug']} ({pilot['status']})")

    sources = {s["slug"]: s for s in api.get("/data-sources", tok["authority"])["items"]}
    for slug, expected in EXPECTED_STATUSES.items():
        check(slug in sources and sources[slug]["connection_status"] == expected,
              f"data source {slug} must be {expected}, got {sources.get(slug, {}).get('connection_status')}")
    live = [s for s, v in sources.items() if v["connection_status"] == "CONNECTED_LIVE" and s != "app-inbox-channel"]
    check(not live, f"only the in-app inbox may be CONNECTED_LIVE (after a real delivery); also live: {live}")
    ok("integration status honesty", f"{len(sources)} sources; no false live connections")

    reset = api.post("/demo/reset", tok["admin"])
    summary = api.get("/dashboard/summary", tok["authority"])
    check(summary["alerts"] == {"DRAFT": 0, "AUTO_DISPATCHED": 0, "DISPATCHED": 0}, f"alerts after reset: {summary['alerts']}")
    check(summary["road_segments"]["BLOCKED"] == 0 and summary["road_segments"]["AT_RISK"] == 0, f"roads after reset: {summary['road_segments']}")
    check(reset["villages_access_at_risk"] == 0 and api.get("/system/mode", tok["authority"])["replay"] is None, "reset left replay or village state behind")
    baseline_high = summary["risk_zone_counts"]["HIGH"] + summary["risk_zone_counts"]["VERY_HIGH"]
    ok("deterministic reset", f"baseline High+VeryHigh={baseline_high}")

    start = api.post("/demo/replay/start", tok["admin"])
    replay = start["replay"]
    check(replay["provenance"] in ("REAL_HISTORICAL", "SIMULATED_DEMO"), f"replay provenance missing: {replay}")
    draft = None
    while True:
        drafts = api.get("/alerts?tier=WARNING&status=DRAFT", tok["authority"])["items"]
        if drafts:
            draft = drafts[0]
            break
        if replay["step"] + 1 >= min(replay["steps"], max_steps):
            raise SmokeFailure(f"no public WARNING draft within {replay['step'] + 1} replay steps")
        replay = api.post("/demo/replay/step", tok["admin"])["replay"]
    summary = api.get("/dashboard/summary", tok["authority"])
    high = summary["risk_zone_counts"]["HIGH"] + summary["risk_zone_counts"]["VERY_HIGH"]
    check(high > baseline_high, f"risk did not change: High+VeryHigh {baseline_high} -> {high}")
    ok("rainfall replay → risk change", f"step {replay['step']}/{replay['steps']} as_of={replay['as_of'][:10]} "
       f"({replay['provenance']}); High+VeryHigh {baseline_high} → {high}")

    model = api.get("/models/active", tok["authority"])
    very_high = api.get("/risk-zones?min_severity=VERY_HIGH", tok["authority"])["features"]
    high = api.get("/risk-zones?min_severity=HIGH", tok["authority"])["features"]
    # Very High first (that is the story), then High: the cell must also carry a mapped road, or the
    # verification -> road BLOCKED beat silently does nothing.
    zones = very_high + [f for f in high if f["id"] not in {v["id"] for v in very_high}]
    check(zones, "no High/Very High cell to explain")
    # Prefer a high cell that has a mapped road, so the report → verification → road status path is exercised.
    ranked = sorted(zones, key=lambda f: -f["properties"]["score"])
    top, roads = ranked[0], []
    for cand in ranked[:60]:
        found = api.get(f"/road-segments?bbox={_bbox_of(cand)}", tok["authority"])["features"]
        if found:
            top, roads = cand, found
            break
    detail = api.get(f"/risk-zones/{top['id']}", tok["authority"])
    a = detail["assessment"]
    check(a["provenance"] == "MODEL_OUTPUT" and a["model_version"] == model["version"], f"assessment provenance/model mismatch: {a['provenance']} {a['model_version']}")
    check(a["factors"] and all(f.get("text") and f.get("component") and "provenance" in f for f in a["factors"]), "factors missing text/component/provenance")
    check(any(f["component"] == "TRIGGER" and f["contribution"] > 0 for f in a["factors"]), "no rainfall trigger contribution in the explanation")
    check(detail.get("disclaimer"), "explanation has no decision-support disclaimer")
    current_meta = api.get("/risk-zones?min_severity=VERY_HIGH", tok["authority"])["metadata"]
    forecast_meta = api.get("/risk-zones?lead_time_h=48&min_severity=VERY_HIGH", tok["authority"])["metadata"]
    check(current_meta["lead_time_h"] == 0 and not current_meta.get("forecast_source"), "current risk must not carry a forecast source")
    check(forecast_meta["lead_time_h"] == 48 and forecast_meta["forecast_source"]["connection_status"] == "SIMULATED"
          and forecast_meta["forecast_skill_evaluated"] is False, f"forecast view not labelled as simulated/unevaluated: {forecast_meta}")
    check(roads or not high, "no High/Very High cell has a mapped road; the road-status beat cannot run")
    ok("cell explanation + labels", f"{detail['grid_code']} {a['severity']} {a['score']} model={a['model_version']}; "
       f"{len(a['factors'])} factors; forecast labelled SIMULATED")

    # Virtual soil-moisture station through the real ingestion API (OR-02, OR-19). Always SIMULATED_DEMO.
    lon0, lat0 = _centre_of(top)
    code = f"SMOKE-{uuid.uuid4().hex[:6].upper()}"
    station = api.post("/sensor-stations", tok["admin"], {"station_code": code, "name": "Smoke test virtual sensor (simulated)",
                       "station_type": "VIRTUAL", "location": {"type": "Point", "coordinates": [lon0, lat0]}, "depth_cm": 30}, expect=(201,))
    check(station.get("station_key"), "station registration did not return a key")
    api.call("POST", "/sensor-readings", None, {"station_code": code, "readings": [
        {"variable": "SOIL_MOISTURE_VWC", "value": 0.48, "unit": "m3/m3", "observed_at": replay["as_of"]}]},
        expect=(201, 200), extra={"X-Station-Key": station["station_key"]})
    api.call("POST", "/sensor-readings", None, {"station_code": code, "readings": [
        {"variable": "SOIL_MOISTURE_VWC", "value": 2.0, "unit": "m3/m3", "observed_at": replay["as_of"]}]}, expect=(422,),
        extra={"X-Station-Key": station["station_key"]})
    replay = api.post("/demo/replay/step", tok["admin"])["replay"]
    sensor_cell = api.get(f"/risk/at?lat={lat0}&lon={lon0}", tok["authority"])
    sensor_factor = next((f for f in sensor_cell["factors"] if f["component"] == "SENSOR_ADJUSTMENT"), None)
    check(sensor_factor and sensor_factor["provenance"] == "SIMULATED_DEMO" and sensor_factor["contribution"] > 0,
          f"virtual sensor reading did not reach the explanation as simulated input: {sensor_factor}")
    stations = api.get("/sensor-stations", tok["authority"])["features"]
    mine = next(f for f in stations if f["properties"]["station_code"] == code)
    check(mine["properties"]["station_type"] == "VIRTUAL" and mine["properties"]["provenance"] == "SIMULATED_DEMO", "virtual station not labelled simulated")
    ok("virtual sensor → explanation", f"{code} 0.48 m3/m3 → {sensor_factor['text'][:60]}… (bad unit rejected)")

    watches = [w for w in api.get("/alerts?tier=WATCH", tok["authority"])["items"] if w["status"] == "AUTO_DISPATCHED"]
    current_watch = next((w for w in watches if w["lead_time_h"] == 0), None)
    check(current_watch and current_watch["approved_by"] is None, "no automatic internal WATCH for current High risk")
    api.call("POST", f"/alerts/{current_watch['id']}/approve", tok["authority"], {}, expect=(409,))
    officer_inbox = api.get("/me/inbox", tok["officer"])["items"]
    check(any(i["alert_id"] == current_watch["id"] for i in officer_inbox), "WATCH not in the field officer inbox")
    citizen_inbox = api.get("/me/inbox", tok["citizen"])["items"]
    check(not any(i["tier"] in ("WATCH", "WARNING") for i in citizen_inbox), "citizen received an internal WATCH or an unapproved WARNING")
    ack = api.post(f"/alerts/{current_watch['id']}/acknowledge", tok["officer"])
    check(ack.get("acknowledged_at"), "acknowledge failed")
    check(draft["status"] == "DRAFT" and draft["approved_by"] is None and draft["dispatched_at"] is None, "public WARNING was not held as a draft")
    ok("alerts: WATCH auto, WARNING held", f"{len(watches)} open WATCH (forecast: {sum(1 for w in watches if w['lead_time_h'] > 0)}); "
       f"WARNING draft over {len(draft['risk_zone_ids'])} cells; officer acknowledged")

    bbox = _bbox_of(top)
    if roads:
        lon, lat = midpoint(roads[0]["geometry"])
    else:
        lon, lat = _centre_of(top)
    client_report_id = str(uuid.uuid4())
    report_body = {"client_report_id": client_report_id, "category": "ROAD_BLOCKED", "severity": "HIGH",
                   "description": "Smoke test report (simulated demo data, not a real event)",
                   "location": {"type": "Point", "coordinates": [lon, lat]}, "gps_accuracy_m": 10,
                   "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "media_expected": 1}
    status, report = api.call("POST", "/reports", tok["officer"], report_body, expect=(201,))
    body, ctype = multipart({"client_media_id": str(uuid.uuid4()), "media_type": "PHOTO"}, "smoke.png", "image/png", PNG_1PX)
    api.call("POST", f"/reports/{report['id']}/media", tok["officer"], raw=body, content_type=ctype, expect=(201,))
    status, dup = api.call("POST", "/reports", tok["officer"], report_body, expect=(200,))
    check(dup["id"] == report["id"], "duplicate submission created a second report")
    listed = api.get("/reports?verification_status=UNVERIFIED", tok["authority"])["items"]
    check(any(r["id"] == report["id"] for r in listed), "report does not appear on the dashboard list")
    check(report.get("road_segment_id") or not roads, "report near a mapped road was not linked to a road segment")
    ok("field report + photo", f"report {report['id'][:8]} on road={'yes' if report.get('road_segment_id') else 'no'}; duplicate → 200 same id")

    verified = api.post(f"/reports/{report['id']}/verify", tok["authority"], {"decision": "VERIFIED", "note": "Smoke test verification"})
    effects = verified["effects"]
    check(verified["verification_status"] == "VERIFIED" and effects["priority_recomputed"], f"verification failed: {verified}")
    if report.get("road_segment_id"):
        check(effects["road_segment"] and effects["road_segment"]["status"] == "BLOCKED", f"verified road blockage did not block the segment: {effects}")
        road = next(f for f in api.get(f"/road-segments?bbox={bbox}", tok["authority"])["features"] if f["id"] == report["road_segment_id"])
        check(road["properties"]["status"] == "BLOCKED" and road["properties"]["status_source"] == "VERIFIED_REPORT", f"road status not from verified report: {road['properties']}")
    ok("verification → road status", f"road={effects['road_segment']}; villages with access at risk={effects['villages_access_at_risk']}")

    prios = api.get("/response-priorities", tok["authority"])
    check(prios["items"] and prios["rule_version"], "no response priorities")
    first = prios["items"][0]
    check(first.get("reasons"), f"top priority has no reasons: {first}")
    ok("response priority", f"top={first.get('priority_level')} score={first.get('priority_score')} rule={prios['rule_version']}; reasons: {'; '.join(first['reasons'][:2])}")

    # The public-warning beat must actually reach a citizen: place the demo citizen inside the warning area
    # (demo accounts only) so the app + sandbox SMS deliveries are exercised rather than silently empty.
    warned = [f for f in (very_high + high) if f["id"] in set(draft["risk_zone_ids"])]
    if warned:
        clon, clat = _centre_of(warned[0])
        api.post("/demo/place-citizen", tok["admin"], {"lat": clat, "lon": clon})
    approved = api.post(f"/alerts/{draft['id']}/approve", tok["authority"], {"languages": ["en", "hi"], "channels": ["APP_INBOX", "APP_PUSH", "SMS"]})
    check(approved["status"] == "DISPATCHED" and approved["approved_by"], "approval did not record the approver")
    deliveries = api.get(f"/alerts/{draft['id']}/deliveries", tok["authority"])["items"]
    check(deliveries, "approved WARNING produced no deliveries")
    check(all(d["status"] in ("SANDBOXED", "FAILED") and d["channel_mode"] == "SANDBOX" for d in deliveries if d["channel"] == "SMS"), "an SMS was not sandboxed")
    check(all(d["status"] != "SENT" for d in deliveries if d["channel"] == "APP_PUSH"), "push reported SENT but FCM is not connected")
    if warned:
        sms = [d for d in deliveries if d["channel"] == "SMS"]
        check(sms, "an approved public warning reached nobody by SMS; the citizen beat would be empty in the demo")
        check(all(d["sms_encoding"] and d["sms_segments"] for d in sms), "SMS deliveries must record encoding and segments")
        citizen_inbox = api.get("/me/inbox", tok["citizen"])["items"]
        check(any(i["tier"] == "WARNING" for i in citizen_inbox), "the citizen did not receive the approved warning")
    ok("human approval → deliveries", f"summary={approved['delivery_summary']}")
    return log


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default=os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1"))
    parser.add_argument("--max-steps", type=int, default=60)
    args = parser.parse_args()
    password = os.environ.get("DEMO_USER_PASSWORD", "georakshak-local-demo")
    print(f"GeoRakshak smoke test against {args.api} (resets demo data)")
    try:
        run(Api(args.api), password, args.max_steps)
    except SmokeFailure as e:
        print(f"  ✗ FAILED: {e}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
