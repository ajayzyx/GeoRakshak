"""Put a running backend into a repeatable demo state (docs/demo.md §7).

Reset → start the rainfall replay → advance to the chosen step → place virtual soil-moisture stations on the
highest-risk cells and post a rising series → print the resulting state.

Deterministic: same pilot data and same `--to-step` give the same risk, roads and alerts every time. Station
placement follows the risk ranking, not a random seed. Everything it creates is labelled SIMULATED_DEMO by the API.

Usage:
  python -m scripts.demo_prepare                 # stop at the first public WARNING draft
  python -m scripts.demo_prepare --to-step 29    # stop at a fixed step (see docs/demo.md)
  python -m scripts.demo_prepare --stations 0    # no virtual sensors
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

from app.config import get_settings


def _call(method: str, url: str, body=None, headers=None, expect=(200, 201)):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read() or b"null")
        if e.code not in expect:
            raise SystemExit(f"{method} {url}: HTTP {e.code} {json.dumps(payload)[:300]}")
        return e.code, payload


def _centre(cell: dict) -> tuple[float, float]:
    ring = cell["geometry"]["coordinates"][0][:-1]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--api", default="http://localhost:8000/api/v1")
    p.add_argument("--password", default=get_settings().demo_user_password)
    p.add_argument("--to-step", type=int, default=None, help="replay step to stop at (default: first public WARNING draft)")
    p.add_argument("--max-steps", type=int, default=60)
    p.add_argument("--stations", type=int, default=2, help="virtual soil-moisture stations to place on the top cells")
    p.add_argument("--posts", type=int, default=3, help="readings per station, rising towards saturation")
    p.add_argument("--no-place-citizen", dest="place_citizen", action="store_false",
                   help="leave the demo citizen's registered location where the seed put it")
    args = p.parse_args()
    api = args.api.rstrip("/")

    def login(role: str) -> dict:
        _, r = _call("POST", f"{api}/auth/login", {"email": f"{role}.demo@example.org", "password": args.password})
        return {"Authorization": f"Bearer {r['access_token']}"}

    admin, authority = login("admin"), login("authority")
    _, mode = _call("GET", f"{api}/system/mode", headers=authority)
    if mode["run_mode"] != "DEMO_REPLAY":
        raise SystemExit(f"run mode is {mode['run_mode']}; demo preparation only applies to DEMO_REPLAY")
    _, pilot = _call("GET", f"{api}/pilot", headers=authority)
    print(f"pilot: {pilot['name']} [{pilot['status']}]")

    def reset_and_start() -> dict:
        _call("POST", f"{api}/demo/reset", headers=admin)
        _, started = _call("POST", f"{api}/demo/replay/start", headers=admin)
        return started["replay"]

    def jump(replay: dict, target: int) -> dict:
        if target <= replay["step"]:
            return replay
        _, res = _call("POST", f"{api}/demo/replay/step", {"to_step": target}, admin)
        return res["replay"]

    def place_stations(replay: dict, count: int) -> int:
        """Register virtual stations on the currently highest-scoring cells and post a rising series."""
        _, zones = _call("GET", f"{api}/risk-zones?min_severity=MODERATE", headers=authority)
        top = sorted(zones["features"], key=lambda f: -f["properties"]["score"])[:count]
        placed = 0
        for i, cell in enumerate(top, start=1):
            lon, lat = _centre(cell)
            code = f"VS-{i:02d}"
            status, reg = _call("POST", f"{api}/sensor-stations", {
                "station_code": code, "name": f"Virtual station {i} (simulated)", "station_type": "VIRTUAL",
                "location": {"type": "Point", "coordinates": [lon, lat]}, "depth_cm": 30}, admin, expect=(201, 409))
            if status == 409:
                print(f"{code} already exists; its key is not retrievable, so skipping (reset first)", file=sys.stderr)
                continue
            base = datetime.fromisoformat(replay["as_of"])
            readings = [{"variable": "SOIL_MOISTURE_VWC", "unit": "m3/m3", "value": round(0.30 + 0.06 * n, 3),
                         "observed_at": (base + timedelta(hours=6 * n)).isoformat()} for n in range(args.posts)]
            _call("POST", f"{api}/sensor-readings", {"station_code": code, "readings": readings}, {"X-Station-Key": reg["station_key"]}, expect=(200, 201))
            print(f"{code} on {cell['properties']['grid_code']}: {len(readings)} simulated readings up to {readings[-1]['value']} m3/m3")
            placed += 1
        return placed

    replay = reset_and_start()
    print(f"replay: {replay['steps']} steps of {replay['provenance']} rainfall")
    target = args.to_step
    if target is None:
        # Find the step where a public WARNING is first drafted, then rebuild that state with sensors in place.
        while True:
            _, drafts = _call("GET", f"{api}/alerts?tier=WARNING&status=DRAFT", headers=authority)
            if drafts["items"]:
                break
            if replay["step"] + 1 >= min(replay["steps"], args.max_steps):
                print(f"no public WARNING draft within {replay['step'] + 1} steps; using that step", file=sys.stderr)
                break
            _, res = _call("POST", f"{api}/demo/replay/step", headers=admin)
            replay = res["replay"]
        target = replay["step"]
        print(f"first public WARNING draft at step {target}; pass --to-step {target} to skip this search")
        if args.stations:
            replay = reset_and_start()

    # Readings must exist before the cycle that scores them, so place stations one step short of the target.
    if args.stations and target > 0:
        replay = jump(replay, target - 1)
        place_stations(replay, args.stations)
    replay = jump(replay, target)
    print(f"stopped at step {replay['step']}/{replay['steps'] - 1}, as_of {replay['as_of'][:10]}")

    if args.place_citizen:
        # Put the demo citizen inside the cell the public WARNING actually covers, so approving it reaches
        # them by app and SMS sandbox. A 500 m warning area otherwise misses a fixed seed location.
        _, drafts = _call("GET", f"{api}/alerts?tier=WARNING&status=DRAFT", headers=authority)
        _, zones = _call("GET", f"{api}/risk-zones?min_severity=MODERATE", headers=authority)
        wanted = set(drafts["items"][0]["risk_zone_ids"]) if drafts["items"] else set()
        cells = [f for f in zones["features"] if f["id"] in wanted] or \
                sorted(zones["features"], key=lambda f: -f["properties"]["score"])[:1]
        if cells:
            lon, lat = _centre(cells[0])
            _, res = _call("POST", f"{api}/demo/place-citizen", {"lat": lat, "lon": lon}, admin, expect=(200,))
            where = "the WARNING draft area" if wanted else "the highest-risk cell"
            print(f"demo citizen moved into {where}: {cells[0]['properties']['grid_code']} "
                  f"({lat:.5f},{lon:.5f}), {res['moved']} demo account(s), SIMULATED_DEMO")

    _, summary = _call("GET", f"{api}/dashboard/summary", headers=authority)
    _, alerts = _call("GET", f"{api}/alerts", headers=authority)
    print("\nstate:")
    print(f"  risk cells       {summary['risk_zone_counts']}")
    print(f"  roads            {summary['road_segments']}")
    print(f"  reports          {summary['reports']}")
    for a in alerts["items"]:
        horizon = "current" if a["lead_time_h"] == 0 else f"forecast +{a['lead_time_h']} h"
        print(f"  alert            {a['tier']:<8} {a['status']:<16} {horizon:<15} {len(a['risk_zone_ids'])} cell(s)")
    _, sources = _call("GET", f"{api}/data-sources", headers=authority)
    unhonest = [s["slug"] for s in sources["items"] if s["connection_status"] == "CONNECTED_LIVE" and s["slug"] != "app-inbox-channel"]
    print(f"  data sources     {len(sources['items'])} registered" + (f"; CHECK: {unhonest} claim live connections" if unhonest else ""))
    print("\nReady. Public WARNING drafts still need human approval in the dashboard.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
