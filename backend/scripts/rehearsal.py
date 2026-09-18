"""Timed rehearsal of the jury demo (docs/demo.md §4), beat by beat, against a running backend.

It performs the judge-facing calls each beat depends on, times them, and checks the story element is really
there — so a beat cannot "pass" while the screen would be empty. It does not reset: run
`python -m scripts.demo_prepare --to-step 26` first, which leaves the replay three steps below the peak so the
presenter can step it live inside the 30-second monitoring beat.

Usage: python -m scripts.rehearsal [--api http://localhost:8000/api/v1] [--steps 3]
Reports per-beat API time against the scripted budget, plus anything that would stall or mislead on stage.
"""
import argparse
import os
import sys
import time

from scripts.smoke_e2e import Api, SmokeFailure, _bbox_of, _centre_of, check, midpoint, multipart, PNG_1PX
import uuid

BEATS = [
    ("0:00-0:20", "Problem", 20),
    ("0:20-0:50", "Monitoring inputs + data-source status", 30),
    ("0:50-1:20", "Rainfall replay + virtual sensors -> risk up, roads AT_RISK", 30),
    ("1:20-1:40", "Forecast +48 h", 20),
    ("1:40-2:05", "Click a cell -> explanation", 25),
    ("2:05-2:35", "Automatic WATCH -> approved WARNING -> app + SMS sandbox", 30),
    ("2:35-3:10", "Offline field report -> photo + video -> sync", 35),
    ("3:10-3:20", "Citizen report in moderation", 10),
    ("3:20-3:45", "Verify -> road BLOCKED -> village access", 25),
    ("3:45-4:00", "Response priority", 15),
]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--api", default=os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1"))
    p.add_argument("--steps", type=int, default=3, help="replay steps the presenter takes live")
    args = p.parse_args()
    api = Api(args.api)
    password = os.environ.get("DEMO_USER_PASSWORD", "georakshak-local-demo")
    tok = {r: api.post("/auth/login", None, {"email": f"{r}.demo@example.org", "password": password})["access_token"]
           for r in ("admin", "authority", "officer", "citizen")}
    notes: list[str] = []
    results: list[tuple[str, str, float, int]] = []

    def beat(index: int, fn):
        window, title, budget = BEATS[index]
        t0 = time.time()
        fn()
        elapsed = time.time() - t0
        results.append((window, title, elapsed, budget))
        flag = "  <-- OVER BUDGET" if elapsed > budget else ""
        print(f"  {window:<11} {elapsed:6.2f}s / {budget:>3}s  {title}{flag}", flush=True)

    print(f"Rehearsal against {args.api}\n")

    # 0:00-0:20 Problem: the map must already be framed on the pilot.
    def b0():
        pilot = api.get("/pilot", tok["authority"])
        check(pilot["status"] in ("PROVISIONAL", "SELECTED") and pilot["boundary_note"], "pilot has no boundary note")
        if pilot["status"] == "PROVISIONAL":
            notes.append("Pilot is PROVISIONAL: say 'provisional pilot area' on the title beat.")
    beat(0, b0)

    # 0:20-0:50 Monitoring inputs: layers plus the honest status panel.
    def b1():
        status = api.get("/system/status", tok["authority"])
        labels = status["label_counts"]
        check(status["adapters"]["inventory"], "no landslide inventory registered")
        check(any(a["effective_label"] == "AWAITING_ACCESS" for a in status["adapters"]["weather"]),
              "the IMD API should be visible as AWAITING_ACCESS on this beat")
        for path, what in (("/layers/landcover", "land cover"), ("/layers/historical-landslides", "landslide records"),
                           ("/layers/locations", "villages and facilities"), ("/sensor-stations", "sensor stations")):
            body = api.get(path, tok["authority"])
            items = body.get("features", body.get("items", []))
            check(items or what == "sensor stations", f"{what} layer is empty; the beat would show nothing")
            if not items:
                notes.append(f"{what} layer is empty at rehearsal time.")
        restricted = [a["slug"] for g in status["adapters"].values() for a in g if a.get("publication_restricted")]
        if restricted:
            notes.append(f"Publication-restricted sources on screen: {', '.join(restricted)} — say 'permission pending'.")
        print(f"      labels: {labels}")
    beat(1, b1)

    # 0:50-1:20 Replay: the presenter steps it live from the pre-positioned state.
    def b2():
        mode = api.get("/system/mode", tok["authority"])
        check(mode["replay"], "replay not started; run scripts.demo_prepare first")
        before = api.get("/dashboard/summary", tok["authority"])
        step_times = []
        for _ in range(args.steps):
            t = time.time()
            replay = api.post("/demo/replay/step", tok["admin"])["replay"]
            step_times.append(time.time() - t)
        after = api.get("/dashboard/summary", tok["authority"])
        high_before = before["risk_zone_counts"]["HIGH"] + before["risk_zone_counts"]["VERY_HIGH"]
        high_after = after["risk_zone_counts"]["HIGH"] + after["risk_zone_counts"]["VERY_HIGH"]
        check(high_after > 0, "no High cells after stepping; the risk beat has nothing to show")
        check(after["road_segments"]["AT_RISK"] > 0, "no roads AT_RISK; the road beat has nothing to show")
        print(f"      step {replay['step']}/{replay['steps'] - 1} as_of {replay['as_of'][:10]} "
              f"({replay['provenance']}); High+VeryHigh {high_before} -> {high_after}; "
              f"roads AT_RISK {after['road_segments']['AT_RISK']}; steps {[f'{t:.1f}s' for t in step_times]}")
        if max(step_times) > 4:
            notes.append(f"A live replay step took {max(step_times):.1f}s — pre-position closer to the peak.")
    beat(2, b2)

    # 1:20-1:40 Forecast: labelled as simulated, skill not evaluated.
    def b3():
        meta = api.get("/risk-zones?lead_time_h=48&min_severity=MODERATE", tok["authority"])["metadata"]
        check(meta["forecast_source"] and meta["forecast_source"]["connection_status"] in ("SIMULATED", "CONNECTED_LIVE"),
              "forecast view carries no source")
        check(meta["forecast_skill_evaluated"] is False, "forecast skill must not be claimed")
        print(f"      +48 h source {meta['forecast_source']['slug']} ({meta['forecast_source']['connection_status']}), "
              f"skill_evaluated={meta['forecast_skill_evaluated']}")
    beat(3, b3)

    # 1:40-2:05 Explanation.
    state = {}

    def b4():
        very = api.get("/risk-zones?min_severity=VERY_HIGH", tok["authority"])["features"]
        high = api.get("/risk-zones?min_severity=HIGH", tok["authority"])["features"]
        cells = very + [f for f in high if f["id"] not in {v["id"] for v in very}]
        check(cells, "no High cell to click")
        chosen, roads = cells[0], []
        for cand in sorted(cells, key=lambda f: -f["properties"]["score"])[:60]:
            found = api.get(f"/road-segments?bbox={_bbox_of(cand)}", tok["authority"])["features"]
            if found:
                chosen, roads = cand, found
                break
        detail = api.get(f"/risk-zones/{chosen['id']}", tok["authority"])
        a = detail["assessment"]
        check(a["factors"] and detail["disclaimer"], "explanation has no factors or disclaimer")
        check(a["model_version"] and a["provenance"] == "MODEL_OUTPUT", "explanation is not labelled model output")
        state.update(cell=chosen, roads=roads, detail=detail)
        print(f"      {detail['grid_code']} {a['severity']} {a['score']} · {len(a['factors'])} factors · "
              f"confidence {a['confidence']} · road nearby: {'yes' if roads else 'no'}")
        if not roads:
            notes.append("The highest-risk cell has no mapped road: pick a different cell for the road beat.")
    beat(4, b4)

    # 2:05-2:35 Alerts and approval.
    def b5():
        watches = [w for w in api.get("/alerts?tier=WATCH", tok["authority"])["items"] if w["status"] == "AUTO_DISPATCHED"]
        check(watches, "no automatic internal WATCH to show")
        officer_inbox = api.get("/me/inbox", tok["officer"])["items"]
        check(any(i["alert_id"] == watches[0]["id"] for i in officer_inbox), "the WATCH is not in the officer inbox")
        drafts = api.get("/alerts?tier=WARNING&status=DRAFT", tok["authority"])["items"]
        check(drafts, "no public WARNING draft to approve")
        draft = drafts[0]
        approved = api.post(f"/alerts/{draft['id']}/approve", tok["authority"],
                            {"languages": ["en", "hi"], "channels": ["APP_INBOX", "APP_PUSH", "SMS"]})
        check(approved["status"] == "DISPATCHED" and approved["approved_by"], "approval did not record a human approver")
        deliveries = api.get(f"/alerts/{draft['id']}/deliveries", tok["authority"])["items"]
        sms = [d for d in deliveries if d["channel"] == "SMS"]
        check(all(d["channel_mode"] == "SANDBOX" and d["status"] == "SANDBOXED" for d in sms), "SMS is not sandboxed")
        citizen = api.get("/me/inbox", tok["citizen"])["items"]
        check(any(i["tier"] == "WARNING" for i in citizen), "the citizen received no public warning")
        langs = sorted({d["language"] for d in deliveries})
        print(f"      {len(watches)} auto WATCH · approved by {approved['approved_by']['full_name']} · "
              f"{approved['delivery_summary']} · languages {langs}")
        if len(langs) < 2:
            notes.append(f"Only {langs} rendered: the 'three languages' line needs recipients with those preferences.")
        if not sms:
            notes.append("No SMS delivery: no consenting citizen inside the warning area.")
    beat(5, b5)

    # 2:35-3:10 Field report with media (the mobile app does this on stage; here via the same API).
    def b6():
        roads_here = state.get("roads") or []
        if roads_here:
            lon, lat = midpoint(roads_here[0]["geometry"])
        else:
            lon, lat = _centre_of(state["cell"])
        cid = str(uuid.uuid4())
        body = {"client_report_id": cid, "category": "ROAD_BLOCKED", "severity": "HIGH",
                "description": "Rehearsal report (simulated demo data)",
                "location": {"type": "Point", "coordinates": [lon, lat]}, "gps_accuracy_m": 8,
                "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "media_expected": 1}
        _, report = api.call("POST", "/reports", tok["officer"], body, expect=(201,))
        raw, ctype = multipart({"client_media_id": str(uuid.uuid4()), "media_type": "PHOTO"}, "rehearsal.png", "image/png", PNG_1PX)
        api.call("POST", f"/reports/{report['id']}/media", tok["officer"], raw=raw, content_type=ctype, expect=(201,))
        api.call("POST", "/reports", tok["officer"], body, expect=(200,))
        state["report"] = report
        print(f"      report {report['id'][:8]} · road_segment_id={'set' if report.get('road_segment_id') else 'none'} · "
              f"duplicate submit -> 200")
        if not report.get("road_segment_id"):
            notes.append("The report did not snap to a road: the 'road blocked' beat will not change road status.")
    beat(6, b6)

    # 3:10-3:20 Citizen report awaiting moderation.
    def b7():
        cid = str(uuid.uuid4())
        lon, lat = _centre_of(state["cell"])
        _, rep = api.call("POST", "/reports", tok["citizen"], {
            "client_report_id": cid, "category": "CRACK", "severity": "MEDIUM",
            "description": "Citizen observation (simulated demo data)",
            "location": {"type": "Point", "coordinates": [lon, lat]}, "gps_accuracy_m": 25,
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "media_expected": 0}, expect=(201,))
        check(rep["verification_status"] == "UNVERIFIED" and rep["reporter_role"] == "CITIZEN",
              "citizen report is not queued as unverified")
        queue = api.get("/reports?verification_status=UNVERIFIED", tok["authority"])["items"]
        check(any(r["id"] == rep["id"] for r in queue), "citizen report is not in the moderation queue")
        print(f"      citizen report {rep['id'][:8]} UNVERIFIED in the queue ({len(queue)} pending)")
    beat(7, b7)

    # 3:20-3:45 Verification consequences.
    def b8():
        report = state["report"]
        verified = api.post(f"/reports/{report['id']}/verify", tok["authority"],
                            {"decision": "VERIFIED", "note": "Rehearsal verification"})
        effects = verified["effects"]
        check(verified["verification_status"] == "VERIFIED", "verification failed")
        village_note = None
        if report.get("road_segment_id"):
            check(effects["road_segment"] and effects["road_segment"]["status"] == "BLOCKED", "road did not turn BLOCKED")
            locs = api.get("/layers/locations?type=VILLAGE,TOWN", tok["authority"])["features"]
            at_risk = [f for f in locs if f["properties"]["access_status"] == "ACCESS_AT_RISK"]
            near = [f for f in locs if f["properties"].get("access_status_reason")]
            village_note = (at_risk[0]["properties"]["access_status_reason"] if at_risk
                            else (near[0]["properties"]["access_status_reason"] if near else None))
            if not at_risk:
                notes.append("No village reached ACCESS_AT_RISK: the rule needs every road within 1 km bad. "
                             "Narrate the dependency count instead of promising a flip.")
        print(f"      road {effects['road_segment']} · villages at risk {effects['villages_access_at_risk']} · {village_note}")
    beat(8, b8)

    # 3:45-4:00 Response priority.
    def b9():
        prios = api.get("/response-priorities", tok["authority"])
        check(prios["items"], "no response priorities to show")
        top = prios["items"][0]
        check(top["reasons"], "the top priority has no reasons")
        print(f"      top {top['priority_level']} score {top['priority_score']} rule {prios['rule_version']} · "
              f"{'; '.join(top['reasons'][:2])}")
        if top["priority_level"] == "P3":
            notes.append(f"Top priority is only P3 ({top['priority_score']}): the beat lands better on P1/P2.")
    beat(9, b9)

    api_total = sum(r[2] for r in results)
    budget = sum(r[3] for r in results)
    print(f"\nAPI time across all beats: {api_total:.1f}s (scripted narration budget {budget}s)")
    over = [r for r in results if r[2] > r[3]]
    print("Beats over budget on API time alone:", ", ".join(f"{r[0]} {r[1]}" for r in over) or "none")
    print("\nFindings:" if notes else "\nFindings: none")
    for n in notes:
        print(f"  - {n}")
    return 1 if over else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SmokeFailure as e:
        print(f"  x REHEARSAL FAILED: {e}")
        sys.exit(1)
