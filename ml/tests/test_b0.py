"""Fixed-input deterministic tests for the B0 rule-based index. No network."""

import copy
import math

import pytest

from georakshak_ml import MissingFeaturesError, active_model, config, explain, score

FACTOR_KEYS = {"feature", "label", "value", "unit", "contribution", "direction", "component", "text", "provenance"}
RH = "REAL_HISTORICAL"


def cell(cell_id="C1", provenance=RH, **features):
    return {
        "cell_id": cell_id,
        "features": features,
        "feature_provenance": {k: provenance for k in features},
    }


def by_feature(factors, name):
    matches = [f for f in factors if f["feature"] == name]
    assert len(matches) == 1, name
    return matches[0]


def sensor(cell_id="C1", value=0.40, distance_m=300.0, provenance="SIMULATED_DEMO", station="VS-01", **kw):
    s = {
        "cell_id": cell_id, "station_code": station, "variable": "SOIL_MOISTURE_VWC", "value": value,
        "unit": "m3/m3", "observed_at": "2026-07-14T06:00:00Z", "distance_m": distance_m, "provenance": provenance,
    }
    s.update(kw)
    return s


# --------------------------------------------------------------------------- terrain only

def test_terrain_only_midpoint():
    [r] = score([cell(slope_deg_mean=20.0, relief_m=135.0)])
    assert r["cell_id"] == "C1"
    assert r["score"] == pytest.approx(0.25)
    assert r["severity"] == "MODERATE"
    assert r["confidence"] == "LOW"  # no rainfall input
    assert r["model_version"] == "b0-rules-0.1.0"
    slope = by_feature(r["factors"], "slope_deg_mean")
    assert slope["contribution"] == 0.0
    assert slope["component"] == "SUSCEPTIBILITY"
    assert slope["provenance"] == RH
    assert slope["unit"] == "deg"
    assert slope["text"] == "Moderately steep slope"
    rain = by_feature(r["factors"], "rainfall")
    assert rain["text"] == "No rainfall input for this cell."
    assert rain["contribution"] == 0.0 and rain["component"] == "TRIGGER"
    nosensor = by_feature(r["factors"], "sensor_vwc")
    assert nosensor["component"] == "SENSOR_ADJUSTMENT" and nosensor["value"] is None


def test_flat_cell_is_low_and_factors_decrease_risk():
    [r] = score([cell(slope_deg_mean=2.0, relief_m=5.0)])
    assert r["score"] == 0.0
    assert r["severity"] == "LOW"
    slope = by_feature(r["factors"], "slope_deg_mean")
    assert slope["direction"] == "decreases_risk"
    assert slope["contribution"] == pytest.approx(-0.1667, abs=1e-4)
    assert slope["text"] == "Gentle slope"
    relief = by_feature(r["factors"], "relief_m")
    assert relief["contribution"] == pytest.approx(-0.0833, abs=1e-4)


def test_terrain_alone_cannot_reach_very_high():
    [r] = score([cell(slope_deg_mean=60.0, relief_m=900.0, landcover_class=60, ndvi_mean=0.0,
                      past_landslide_density=10.0)])
    # landcover 60 normalises to 0.9, everything else saturates: 0.5 * (1 - 0.15 * 0.1)
    assert r["score"] == pytest.approx(0.4925)
    assert r["severity"] != "VERY_HIGH", "terrain alone is capped at w_susceptibility = 0.5"
    [r2] = score([cell(slope_deg_mean=60.0, relief_m=900.0)])
    assert r2["score"] == pytest.approx(0.5) and r2["severity"] != "VERY_HIGH"


# --------------------------------------------------------------------------- rainfall trigger

def test_steep_heavy_rain_very_high_with_contributions():
    c = cell(slope_deg_mean=35.0, relief_m=250.0, rain_1d_mm=150.0, rain_3d_mm=300.0)
    [r] = score([c])
    assert r["score"] == pytest.approx(1.0)
    assert r["severity"] == "VERY_HIGH"
    assert r["confidence"] == "MEDIUM"
    f = r["factors"]
    assert by_feature(f, "rain_1d_mm")["contribution"] == pytest.approx(0.2727, abs=1e-4)
    assert by_feature(f, "rain_3d_mm")["contribution"] == pytest.approx(0.2273, abs=1e-4)
    assert by_feature(f, "slope_deg_mean")["contribution"] == pytest.approx(0.1667, abs=1e-4)
    assert by_feature(f, "rain_1d_mm")["text"] == "1-day rainfall is very heavy"
    assert by_feature(f, "rain_1d_mm")["component"] == "TRIGGER"
    assert not [x for x in f if x["feature"] == "rainfall"]
    # sorted by absolute contribution, notes last
    contribs = [abs(x["contribution"]) for x in f if x["value"] is not None]
    assert contribs == sorted(contribs, reverse=True)
    assert f[-1]["feature"] == "sensor_vwc" and f[-1]["value"] is None


def test_contributions_sum_to_score_minus_baseline_when_unclipped():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, rain_1d_mm=85.0)
    s = [sensor(value=0.40)]
    [r] = score([c], sensor_inputs=s)
    assert r["score"] == pytest.approx(0.3875)
    baseline = active_model()["thresholds"]["susceptibility_baseline"]
    total = sum(x["contribution"] for x in r["factors"])
    assert baseline + total == pytest.approx(r["score"], abs=1e-3)


def test_rain_on_flat_ground_adds_nothing():
    [r] = score([cell(slope_deg_mean=0.0, relief_m=0.0, rain_1d_mm=300.0)])
    assert r["score"] == 0.0
    assert by_feature(r["factors"], "rain_1d_mm")["contribution"] == 0.0


def test_forecast_prefix_and_confidence_decreases_with_lead_time():
    c = cell(slope_deg_mean=30.0, relief_m=200.0, rain_3d_mm=200.0)
    conf = {h: score([c], lead_time_h=h)[0]["confidence"] for h in (0, 24, 48, 72)}
    assert conf == {0: "MEDIUM", 24: "MEDIUM", 48: "LOW", 72: "LOW"}
    order = ["LOW", "MEDIUM", "HIGH"]
    assert [order.index(conf[h]) for h in (0, 24, 48, 72)] == sorted(
        [order.index(conf[h]) for h in (0, 24, 48, 72)], reverse=True)
    f = explain(c, lead_time_h=24)
    assert by_feature(f, "rain_3d_mm")["text"].startswith("Forecast (+24 h): ")
    assert not by_feature(f, "slope_deg_mean")["text"].startswith("Forecast")


# --------------------------------------------------------------------------- sensor modifier

def test_simulated_sensor_high_reading():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, rain_1d_mm=85.0)
    [r] = score([c], sensor_inputs=[sensor(value=0.5)])
    sf = by_feature(r["factors"], "sensor_vwc")
    assert sf["text"] == "Nearby soil moisture reading is high (virtual sensor, simulated)"
    assert sf["provenance"] == "SIMULATED_DEMO"
    assert sf["station_code"] == "VS-01"
    assert sf["component"] == "SENSOR_ADJUSTMENT"
    assert sf["contribution"] == pytest.approx(0.25 * 0.5 * 0.25, abs=1e-4)
    assert r["score"] == pytest.approx(0.25 + 0.125 * 1.25, abs=1e-4)


def test_real_sensor_has_no_simulated_suffix_and_nearest_wins():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, rain_1d_mm=85.0)
    s = [sensor(value=0.30, distance_m=900.0, station="FAR", provenance="REAL_LIVE"),
         sensor(value=0.40, distance_m=100.0, station="NEAR", provenance="REAL_LIVE")]
    sf = by_feature(explain(c, sensor_inputs=s), "sensor_vwc")
    assert sf["station_code"] == "NEAR"
    assert sf["text"] == "Nearby soil moisture reading is elevated"


def test_sensor_bounds_out_of_range_other_cell_and_never_reduces():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, rain_1d_mm=85.0)
    base = score([c])[0]["score"]
    assert score([c], sensor_inputs=[sensor(value=0.9, distance_m=5000.0)])[0]["score"] == base
    assert score([c], sensor_inputs=[sensor(cell_id="OTHER", value=0.9)])[0]["score"] == base
    assert score([c], sensor_inputs=[sensor(value=0.05)])[0]["score"] == base
    hi = score([c], sensor_inputs=[sensor(value=0.99)])[0]["score"]
    assert hi == pytest.approx(0.25 + 0.125 * 1.25, abs=1e-4)


def test_sensor_bad_unit_raises():
    c = cell(slope_deg_mean=20.0, relief_m=135.0)
    with pytest.raises(ValueError):
        score([c], sensor_inputs=[sensor(unit="%")])


def test_sensor_without_rain_contributes_zero():
    [r] = score([cell(slope_deg_mean=35.0, relief_m=250.0)], sensor_inputs=[sensor(value=0.6)])
    assert by_feature(r["factors"], "sensor_vwc")["contribution"] == 0.0
    assert r["score"] == pytest.approx(0.5)


# --------------------------------------------------------------------------- optional susceptibility

def test_landcover_ndvi_and_history_are_used():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, landcover_class=60, ndvi_mean=0.2, past_landslide_density=2.0)
    [r] = score([c])
    # weights 0.4, 0.2, 0.15, 0.10, 0.15 (sum 1.0); normalised 0.5, 0.5, 0.9, 1.0, 1.0
    expected_s = 0.4 * 0.5 + 0.2 * 0.5 + 0.15 * 0.9 + 0.10 * 1.0 + 0.15 * 1.0
    assert r["score"] == pytest.approx(0.5 * expected_s, abs=1e-4)
    lc = by_feature(r["factors"], "landcover_class")
    assert lc["value"] == 60
    assert lc["text"] == "Land cover is bare / sparse vegetation, which is more prone to slope failure"
    assert by_feature(r["factors"], "ndvi_mean")["text"] == "Sparse vegetation cover"


def test_no_recorded_landslides_never_decreases_risk():
    c = cell(slope_deg_mean=20.0, relief_m=135.0, past_landslide_density=0.0)
    [r] = score([c])
    f = by_feature(r["factors"], "past_landslide_density")
    assert f["contribution"] == 0.0
    assert f["text"] == "Few or no recorded past landslides nearby (records are incomplete)"
    # weights renormalised over 0.75: S = (0.4*0.5 + 0.2*0.5 + 0.15*0) / 0.75 = 0.4
    assert r["score"] == pytest.approx(0.2)
    # baseline = 0.5 * (0.4*0.5 + 0.2*0.5 + 0.15*0.0) / 0.75 = 0.2 ; contributions sum to score - baseline
    assert 0.2 + sum(x["contribution"] for x in r["factors"]) == pytest.approx(r["score"], abs=1e-3)
    g = by_feature(score([cell(slope_deg_mean=20.0, relief_m=135.0, past_landslide_density=1.0)])[0]["factors"],
                   "past_landslide_density")
    assert g["contribution"] > 0 and g["direction"] == "increases_risk"
    assert active_model()["thresholds"]["factor_references"]["past_landslide_density"] == 0.0


def test_landcover_string_code_and_unknown_code_ignored():
    a = score([cell(slope_deg_mean=20.0, relief_m=135.0, landcover_class="10")])[0]
    assert by_feature(a["factors"], "landcover_class")["value"] == 10
    b = score([cell(slope_deg_mean=20.0, relief_m=135.0, landcover_class=12345)])[0]
    assert not [f for f in b["factors"] if f["feature"] == "landcover_class"]


# --------------------------------------------------------------------------- errors and contract

@pytest.mark.parametrize("features,missing", [
    ({"relief_m": 10.0}, ["slope_deg_mean"]),
    ({"slope_deg_mean": None, "relief_m": 10.0}, ["slope_deg_mean"]),
    ({"slope_deg_mean": float("nan"), "relief_m": "abc"}, ["slope_deg_mean", "relief_m"]),
    ({}, ["slope_deg_mean", "relief_m"]),
])
def test_missing_required_features_raise(features, missing):
    with pytest.raises(MissingFeaturesError) as e:
        score([{"cell_id": "X", "features": features, "feature_provenance": {}}])
    assert e.value.missing == missing
    assert e.value.cell_id == "X"


def test_invalid_lead_time():
    with pytest.raises(ValueError):
        score([cell(slope_deg_mean=1.0, relief_m=1.0)], lead_time_h=-24)


def test_factor_schema_and_explain_matches_score():
    c = cell(slope_deg_mean=28.0, relief_m=180.0, ndvi_mean=0.5, rain_1d_mm=70.0, rain_7d_mm=260.0,
             rain_antecedent_15d_mm=400.0, rain_anomaly=2.5)
    s = [sensor(value=0.47)]
    [r] = score([c], lead_time_h=0, sensor_inputs=s)
    assert explain(c, 0, s) == r["factors"]
    for f in r["factors"]:
        assert FACTOR_KEYS <= set(f)
        assert f["direction"] in ("increases_risk", "decreases_risk")
        assert f["component"] in ("SUSCEPTIBILITY", "TRIGGER", "SENSOR_ADJUSTMENT")
        assert isinstance(f["text"], str) and f["text"]
    assert 0.0 <= r["score"] <= 1.0
    assert r["severity"] in ("LOW", "MODERATE", "HIGH", "VERY_HIGH")


def test_deterministic_and_does_not_mutate_inputs():
    c = cell(slope_deg_mean=28.0, relief_m=180.0, rain_1d_mm=70.0)
    s = [sensor(value=0.47)]
    c0, s0 = copy.deepcopy(c), copy.deepcopy(s)
    assert score([c, c], sensor_inputs=s) == score([c, c], sensor_inputs=s)
    assert c == c0 and s == s0
    assert score([]) == []


def test_severity_boundaries():
    # S = n (both required factors equal); score = 0.5 * S with no rain
    def sc(n):
        return score([cell(slope_deg_mean=5 + 30 * n, relief_m=20 + 230 * n)])[0]
    # Bands are operator configuration (H11), so the test states the ones it asserts against.
    config.set_severity_thresholds(0.25, 0.55, 0.70, source="TEST")
    try:
        assert sc(0.49)["severity"] == "LOW"        # 0.245
        assert sc(0.50)["severity"] == "MODERATE"   # 0.25
        assert sc(0.90)["severity"] == "MODERATE"   # 0.45, below the 0.55 High band
        assert sc(1.00)["severity"] == "MODERATE"   # 0.50: terrain alone cannot reach High under these bands
        config.set_severity_thresholds(0.25, 0.45, 0.65, source="TEST")
        assert sc(0.90)["severity"] == "HIGH"       # 0.45 is High under the earlier bands
    finally:
        config.set_severity_thresholds(0.25, 0.55, 0.70, source="PACKAGE_DEFAULT")


def test_severity_bands_are_configurable_and_validated():
    assert config.severity_thresholds_source() in ("PACKAGE_DEFAULT", "ENV", "CONFIGURED", "TEST")
    assert dict((label, lo) for lo, label in config.DEFAULT_SEVERITY_THRESHOLDS)["HIGH"] == 0.55
    for bad in ((0.0, 0.55, 0.70), (0.25, 0.70, 0.55), (0.25, 0.55, 1.0), ("a", 0.55, 0.7)):
        with pytest.raises(ValueError):
            config.set_severity_thresholds(*bad)
    assert config.severity_thresholds() == ((0.70, "VERY_HIGH"), (0.55, "HIGH"), (0.25, "MODERATE"), (0.00, "LOW")), \
        "a rejected override must not change the active bands"


def test_active_model():
    m = active_model()
    assert m["version"] == "b0-rules-0.1.0"
    assert m["metrics"] is None
    assert m["forecast_skill_evaluated"] is False
    assert m["feature_list"]["required"] == ["slope_deg_mean", "relief_m"]
    assert m["thresholds"]["calibrated"] is False
    for k in ("version", "model_type", "stage", "feature_list", "thresholds", "validation_scheme",
              "metrics", "forecast_skill_evaluated", "model_card_uri"):
        assert k in m
    assert math.isclose(m["thresholds"]["severity_lower_bounds"]["VERY_HIGH"], 0.70)
    assert math.isclose(m["thresholds"]["severity_lower_bounds"]["HIGH"], 0.55)
    assert m["thresholds"]["severity_thresholds_source"]
    assert "not statistically optimal" in m["thresholds"]["severity_thresholds_note"].lower()
