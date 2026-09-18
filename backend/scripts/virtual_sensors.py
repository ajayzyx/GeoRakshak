"""Virtual soil-moisture station emulator (OR-02). Posts SIMULATED readings through the REAL ingestion API.

Every station it creates is registered as VIRTUAL, so the API labels its data SIMULATED_DEMO.
Readings are synthetic and uncalibrated. They show the ingestion path, not real ground conditions.

Usage:
  python -m scripts.virtual_sensors --stations 3 --interval 10 --rise 0.01
  (logs in as the demo admin to register stations inside the active pilot bbox; stdlib only)
"""
import argparse
import json
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from app.config import get_settings


def _call(method: str, url: str, body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8000/api/v1")
    p.add_argument("--email", default="admin.demo@example.org")
    p.add_argument("--password", default=get_settings().demo_user_password)
    p.add_argument("--stations", type=int, default=3)
    p.add_argument("--interval", type=float, default=10.0, help="seconds between posts")
    p.add_argument("--start", type=float, default=0.28, help="starting volumetric water content (m3/m3)")
    p.add_argument("--rise", type=float, default=0.01, help="increase per post, capped at 0.55")
    p.add_argument("--count", type=int, default=0, help="number of posts (0 = run until stopped)")
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args()
    rng = random.Random(args.seed)

    token = _call("POST", f"{args.api}/auth/login", {"email": args.email, "password": args.password})["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    bbox = _call("GET", f"{args.api}/pilot", headers=auth)["bbox"]
    stations = []
    for i in range(args.stations):
        code = f"VS-{i + 1:02d}"
        lon = bbox[0] + (bbox[2] - bbox[0]) * rng.uniform(0.2, 0.8)
        lat = bbox[1] + (bbox[3] - bbox[1]) * rng.uniform(0.2, 0.8)
        try:
            reg = _call("POST", f"{args.api}/sensor-stations", {"station_code": code, "name": f"Virtual station {i + 1} (simulated)",
                        "station_type": "VIRTUAL", "location": {"type": "Point", "coordinates": [lon, lat]}}, auth)
            stations.append((code, reg["station_key"]))
            print(f"registered {code} at {lon:.5f},{lat:.5f}")
        except urllib.error.HTTPError as e:
            if e.code == 409:
                print(f"{code} already registered (its key isn't retrievable); reset the demo or choose another code")
                continue
            raise
    value, n = args.start, 0
    while stations and (args.count == 0 or n < args.count):
        now = datetime.now(timezone.utc).isoformat()
        for code, key in stations:
            v = round(min(0.55, max(0.05, value + rng.uniform(-0.01, 0.01))), 3)
            res = _call("POST", f"{args.api}/sensor-readings",
                        {"station_code": code, "readings": [{"variable": "SOIL_MOISTURE_VWC", "value": v, "unit": "m3/m3", "observed_at": now}]},
                        {"X-Station-Key": key})
            print(f"{now} {code} vwc={v} accepted={res['accepted']} provenance={res['provenance']}")
        value = min(0.55, value + args.rise)
        n += 1
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
