"""Check a running backend for the claims a judge must never see (CLAUDE.md §9, docs/demo.md §5).

Every rule here is a thing we promised not to imply: no unconnected source claiming to be live, Open-Meteo never
presented as IMD, replayed rainfall never shown as live, virtual sensors always simulated, SMS never "sent",
no satellite image passed off as current, and no accuracy or optimality claimed for the rule-based model.

Run it against every backend that will be on screen, in each run mode:
  python -m scripts.honesty_sweep --api http://localhost:8000/api/v1
Exits non-zero on the first violation, so it can gate a rehearsal.
"""
import argparse
import os
import sys

from scripts.smoke_e2e import Api, SmokeFailure

FORBIDDEN_LIVE = {"imd-weather-api", "imerg-feed", "sensor-gateway", "sms-channel", "app-push-channel",
                  "gsi-bhukosh-landslide-inventory", "sentinel2-composite"}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--api", default=os.environ.get("API_BASE_URL", "http://localhost:8000/api/v1"))
    args = p.parse_args()
    api = Api(args.api)
    password = os.environ.get("DEMO_USER_PASSWORD", "georakshak-local-demo")
    tok = api.post("/auth/login", None, {"email": "authority.demo@example.org", "password": password})["access_token"]
    status = api.get("/system/status", tok)
    adapters = {a["slug"]: a for group in status["adapters"].values() for a in group}
    run_mode = status["run_mode"]
    failures: list[str] = []

    def rule(ok: bool, what: str) -> None:
        print(f"  {'OK  ' if ok else 'FAIL'}  {what}")
        if not ok:
            failures.append(what)

    print(f"Honesty sweep: {args.api} ({run_mode})")

    for slug in FORBIDDEN_LIVE & set(adapters):
        rule(adapters[slug]["effective_label"] != "REAL_LIVE", f"{slug} does not claim a live connection")
    rule(adapters["imd-weather-api"]["effective_label"] == "AWAITING_ACCESS", "IMD weather API stays AWAITING_ACCESS")

    om = [a for s, a in adapters.items() if s.startswith("open-meteo")]
    rule(bool(om), "the non-IMD weather adapter is registered")
    rule(all(not a["is_imd"] for a in om), "Open-Meteo is never flagged as IMD")
    rule(all(a["is_fallback"] for a in om), "Open-Meteo is marked a non-IMD fallback")
    rule(all("non-imd" in (a["status_note"] or "").lower() or "not imd" in (a["status_note"] or "").lower() for a in om),
         "Open-Meteo notes state it is not IMD")
    rule(all("not gauge observations" in (a["status_note"] or "").lower()
             for a in om if a["kind"] == "WEATHER_HISTORICAL"),
         "Open-Meteo 'recent' data is described as model output, not gauge observations")

    rain = adapters.get("imd-gridded-rainfall")
    if rain:
        expected = "REAL_REPLAY" if run_mode == "DEMO_REPLAY" else "REAL_HISTORICAL"
        rule(rain["effective_label"] == expected, f"IMD gridded rainfall reads {expected}, never REAL_LIVE")
        rule(rain["publication_restricted"], "IMD rainfall is marked publication-restricted")
    gsi = adapters.get("gsi-bhusanket")
    if gsi:
        rule(gsi["publication_restricted"], "GSI inventory is marked publication-restricted")

    rule(adapters["virtual-soil-moisture"]["effective_label"] == "SIMULATED", "virtual sensors are labelled SIMULATED")
    sms = adapters["sms-channel"]
    rule(sms["effective_label"] == "SANDBOX" and "not sent" in (sms["status_note"] or "").lower(),
         "SMS is sandboxed and says messages are not sent")
    rule(adapters["app-push-channel"]["effective_label"] == "NOT_CONNECTED", "push is not claimed while FCM is unconfigured")

    model = status["model"]
    rule(model["validated"] is False and model["calibrated"] is False, "the served model reads unvalidated and uncalibrated")
    rule(model["metrics"] is None, "no metrics are published for the rule-based model")
    caveat = (model.get("caveat") or "").lower()
    rule("not validated" in caveat, "the model caveat says the thresholds are not validated")
    rule("not statistically optimal" in caveat, "the model caveat says the thresholds are not statistically optimal")
    rule(model["forecast_skill_evaluated"] is False, "forecast skill is not claimed")
    rule(status["disclaimer"].lower().startswith("decision-support"), "the decision-support disclaimer is served")

    meta = api.get("/risk-zones?lead_time_h=48&min_severity=MODERATE", tok)["metadata"]
    rule(meta["forecast_skill_evaluated"] is False, "the forecast view does not claim skill")
    rule(bool(meta["forecast_source"]), "the forecast view names its source")
    if meta["forecast_source"]:
        fslug = meta["forecast_source"]["slug"]
        rule(not fslug.startswith("imd-"), f"the forecast source ({fslug}) is not presented as IMD")

    for item in api.get("/layers/satellite", tok)["items"]:
        rule(bool(item["acquisition_start"]) or bool(item.get("acquisition_note")),
             f"satellite layer {item['slug']} states its acquisition range or why it has none")
        rule(not item.get("display") or bool(item["acquisition_start"]),
             f"satellite layer {item['slug']} is not rendered without a date range")

    zones = api.get("/risk-zones?min_severity=HIGH", tok)["features"]
    if zones:
        detail = api.get(f"/risk-zones/{zones[0]['id']}", tok)
        rule(detail["assessment"]["provenance"] == "MODEL_OUTPUT", "risk is labelled model output")
        rule("not an official warning" in detail["disclaimer"].lower(), "cell detail carries the not-an-official-warning line")
        rule(detail["assessment"]["confidence"] != "HIGH", "the uncalibrated model never reports HIGH confidence")

    print(f"\n{'ALL CLEAR' if not failures else str(len(failures)) + ' VIOLATION(S)'}")
    for f in failures:
        print(f"  - {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SmokeFailure as e:
        print(f"  x SWEEP FAILED: {e}")
        sys.exit(1)
