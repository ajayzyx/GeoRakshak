"""Fixed-input tests for the offline pipeline helpers used by the Stage A v2 evaluation. No network."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
pytest.importorskip("numpy")
pytest.importorskip("rasterio")
pytest.importorskip("requests")

import point_features as PF  # noqa: E402
import replay_sanity as RS  # noqa: E402
import stage_a_v2_dataset as DS  # noqa: E402
import train_stage_a_v2 as T  # noqa: E402
from georakshak_ml import config, score  # noqa: E402


def test_exposure_bins_are_disjoint_and_ordered():
    assert [PF.exposure_bin(x) for x in (0.0, 1e-6, 0.1, 0.100001, 0.3, 0.45, 0.6, 0.7, 1.0)] == [0, 1, 1, 2, 2, 3, 3, 4, 4]


def test_t6_has_no_exposure_proxy_features():
    banned = {"builtup_share_500m", "exposure_x", "landcover_class", "landcover_tree_share", "population",
              "dist_to_road_m", "dist_to_builtup_m", "past_landslide_density"}
    assert set(PF.T6).isdisjoint(banned)
    assert T.FEATURES == PF.T6


def test_threshold_at_recall():
    s = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    t = T.threshold_at_recall(s, 0.70)
    assert sum(v >= t for v in s) / len(s) == pytest.approx(0.70, abs=0.05)
    assert T.threshold_at_recall([0.5], 0.7) == 0.5


def test_haversine_matrix_and_scalar_agree():
    import numpy as np
    a = np.array([[92.72, 23.73]])
    b = np.array([[92.72, 23.83], [93.72, 23.73]])
    m = T.haversine_matrix(a, b)[0]
    assert m[0] == pytest.approx(DS.haversine_m(92.72, 23.73, 92.72, 23.83), rel=1e-9)
    assert m[0] == pytest.approx(11119, rel=0.01)   # 0.1 deg of latitude
    assert m[1] == pytest.approx(102000, rel=0.02)  # 1 deg of longitude at 23.7 N


def test_positive_dedup_rules():
    recs = [
        {"lon": 92.7000, "lat": 23.7000, "acc": "1km", "event_id": "1", "event_date": 100, "country": "IN", "state": "mizoram"},
        {"lon": 92.7020, "lat": 23.7000, "acc": "1km", "event_id": "2", "event_date": 200, "country": "IN", "state": "mizoram"},  # 204 m away -> drop
        {"lon": 92.7100, "lat": 23.7000, "acc": "1km", "event_id": "3", "event_date": 100, "country": "IN", "state": "mizoram"},  # 1 km, same date -> drop
        {"lon": 92.7300, "lat": 23.7000, "acc": "1km", "event_id": "4", "event_date": 300, "country": "IN", "state": "mizoram"},  # 3 km, other date -> keep
        {"lon": 92.9000, "lat": 23.9000, "acc": "5km", "event_id": "5", "event_date": 400, "country": "IN", "state": "mizoram"},  # accuracy -> excluded
        {"lon": 88.4000, "lat": 27.1000, "acc": "1km", "event_id": "6", "event_date": 500, "country": "IN", "state": "west bengal"},  # not NER
        {"lon": 92.9000, "lat": 23.9000, "acc": "1km", "event_id": "7", "event_date": 600, "country": "BD", "state": "sylhet"},  # not India
    ]
    cand, kept, dropped = DS.positives(recs)
    assert [r["event_id"] for r in cand] == ["1", "2", "3", "4"]
    assert [r["event_id"] for r in kept] == ["1", "4"]
    assert dict(dropped) == {"within_500m": 1, "same_event_within_2km": 1}


def test_exclusion_buffers_are_accuracy_aware():
    recs = [{"lon": 92.7, "lat": 23.7, "acc": "1km", "event_id": "1", "event_date": 1, "country": "IN", "state": "mizoram"},
            {"lon": 93.0, "lat": 24.0, "acc": "5km", "event_id": "2", "event_date": 1, "country": "MM", "state": ""},
            {"lon": 93.5, "lat": 24.5, "acc": "25km", "event_id": "3", "event_date": 1, "country": "IN", "state": "manipur"}]
    excl = DS.exclusion_points(recs)
    assert sorted(b for _, _, b in excl) == [1500.0, 5500.0]  # the 25 km record is ignored


def test_replay_candidate_score_matches_b0_when_susceptibility_matches():
    """The offline replay combination must reproduce georakshak_ml for the same susceptibility and rain."""
    feats = {"slope_deg_mean": 35.0, "relief_m": 250.0, "rain_1d_mm": 150.0, "rain_3d_mm": 300.0}
    [r] = score([{"cell_id": "c", "features": feats, "feature_provenance": {}}])
    s, sev = RS.candidate_score(1.0, feats)  # both required factors saturate -> B0 susceptibility = 1.0
    assert s == pytest.approx(r["score"], abs=1e-4)
    assert sev == r["severity"]


def test_replay_candidate_score_without_rain_and_severity_bands():
    # Bands are operator configuration (H11); the helper must follow whatever is active.
    assert RS.candidate_score(1.0, {}) == (0.5, "MODERATE")  # 0.55 High band in force
    config.set_severity_thresholds(0.25, 0.45, 0.65, source="TEST")
    try:
        assert RS.candidate_score(1.0, {}) == (0.5, "HIGH")
    finally:
        config.set_severity_thresholds(0.25, 0.55, 0.70, source="PACKAGE_DEFAULT")
    assert RS.candidate_score(0.0, {"rain_1d_mm": 300.0}) == (0.0, "LOW")
    assert RS.candidate_score(0.5, {"rain_1d_mm": 150.0})[0] == pytest.approx(0.5, abs=1e-4)


def test_rain_features_use_only_days_up_to_as_of():
    from datetime import date, timedelta
    d = date(2017, 6, 10)
    series = {d - timedelta(days=k): float(k + 1) for k in range(20)}
    series[d + timedelta(days=1)] = 999.0  # future day must never be used
    f = RS.rain_features(series, d)
    assert f["rain_1d_mm"] == 1.0
    assert f["rain_3d_mm"] == 6.0          # 1 + 2 + 3
    assert f["rain_7d_mm"] == 28.0
    assert f["rain_antecedent_15d_mm"] == 120.0
    assert 999.0 not in f.values()
    partial = RS.rain_features({d: 5.0, d - timedelta(days=1): 4.0}, d)
    assert partial["rain_7d_mm"] == 9.0    # partial windows sum what exists, as the backend does


def test_v3_dedup_drops_records_within_500m():
    import random
    import stage_a_v3_dataset as V3
    recs = [
        {"lon": 92.7000, "lat": 23.7000, "event_id": "1"},
        {"lon": 92.7020, "lat": 23.7000, "event_id": "2"},   # 204 m from #1 -> drop
        {"lon": 92.7060, "lat": 23.7000, "event_id": "3"},   # 612 m from #1 -> keep
        {"lon": 92.7061, "lat": 23.7000, "event_id": "4"},   # 10 m from #3 -> drop
        {"lon": 93.5000, "lat": 24.5000, "event_id": "5"},   # far away -> keep
    ]
    kept, dropped = V3.dedup([dict(r) for r in recs], random.Random(0))
    assert sorted(r["event_id"] for r in kept) == ["1", "3", "5"]
    assert dropped == 2


def test_v3_exclusion_uses_gsi_and_coolr_buffers():
    """Design-E negatives must stay 1 km from GSI records and outside the accuracy-aware COOLR buffers."""
    import stage_a_v3_dataset as V3
    assert V3.GSI_EXCLUSION_M == 1000.0
    assert V3.NEG_RATIO == 3 and V3.SEED == 42
    coolr = [{"lon": 92.7, "lat": 23.7, "acc": "5km", "event_id": "1", "event_date": 1, "country": "IN", "state": "mizoram"}]
    assert DS.exclusion_points(coolr) == [(92.7, 23.7, 5500.0)]


# --------------------------------------------------------------------- v4 hydrology and soil features

def test_fill_depressions_raises_pits_to_their_spill_level():
    import numpy as np
    import hydro_features as HF
    z = np.array([[5, 4, 3], [4, 0, 2], [3, 2, 1]], dtype=float)
    f = HF.fill_depressions(z)
    assert f[1, 1] == 1.0                    # the pit fills to the lowest neighbouring spill point
    assert (f >= z).all()                    # filling never lowers the surface
    assert (f[z == 5] == 5).all()            # non-pit cells are untouched
    flat = np.zeros((4, 4))
    assert (HF.fill_depressions(flat) == 0).all()


def test_flow_accumulation_on_a_uniform_slope():
    import numpy as np
    import hydro_features as HF
    acc = HF.flow_accumulation(np.array([[3, 2, 1], [3, 2, 1], [3, 2, 1]], dtype=float), res=25.0)
    cell = 625.0
    assert acc[:, 0].tolist() == [cell] * 3                  # ridge column drains only itself
    assert acc[:, 1].tolist() == [2 * cell] * 3              # each row adds one cell downslope
    assert acc[:, 2].tolist() == [3 * cell] * 3
    assert acc.min() == cell                                 # every cell contributes its own area


def test_twi_is_finite_on_flat_ground_and_grows_with_accumulation():
    import numpy as np
    import hydro_features as HF
    flat = np.zeros((3, 3))
    t = HF.twi(np.full((3, 3), 625.0), flat)
    assert np.isfinite(t).all()                              # the tan(beta) floor prevents infinities
    slope = np.array([[3, 2, 1], [3, 2, 1], [3, 2, 1]], dtype=float)
    low = HF.twi(np.full((3, 3), 625.0), slope)[1, 1]
    high = HF.twi(np.full((3, 3), 6250.0), slope)[1, 1]
    assert high > low


def test_curvature_zero_on_a_plane_and_signed_on_a_dome():
    import numpy as np
    import hydro_features as HF
    yy, xx = np.mgrid[0:5, 0:5].astype(float)
    plan, prof = HF.zevenbergen_thorne(3.0 * xx + 2.0 * yy, res=25.0)
    assert abs(np.nanmax(np.abs(plan[1:-1, 1:-1]))) < 1e-12
    assert abs(np.nanmax(np.abs(prof[1:-1, 1:-1]))) < 1e-12
    dome = -((xx - 2) ** 2 + (yy - 2) ** 2)
    plan_d, prof_d = HF.zevenbergen_thorne(dome, res=25.0)
    assert np.nanmean(prof_d[1:-1, 1:-1]) < 0                # convex (ridge-like) profile curvature is negative


def test_ruggedness_index():
    import numpy as np
    import hydro_features as HF
    assert np.nanmax(np.abs(HF.ruggedness(np.zeros((4, 4))))) == 0.0
    z = np.zeros((3, 3)); z[1, 1] = 8.0
    assert HF.ruggedness(z)[1, 1] == pytest.approx(8.0)      # 8 neighbours each 8 m lower


def test_hydro_feature_lists_are_disjoint_and_free_of_exposure_proxies():
    import hydro_features as HF
    import soil_features as SF
    assert set(HF.H6).isdisjoint(HF.H_REPORTED_ONLY)
    # dist_to_drainage_m is offered but only survives the 5 % missingness rule enforced in train_stage_a_v4
    assert "dist_to_drainage_m" in HF.H6
    banned = {"builtup_share_500m", "exposure_x", "landcover_class", "landcover_tree_share", "past_landslide_density"}
    assert set(HF.H6 + SF.S5).isdisjoint(banned)


def test_soilgrids_sampling_treats_zero_as_missing(tmp_path):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    import soil_features as SF
    path = tmp_path / "layer.tif"
    a = np.array([[0, 200, 200], [200, 200, 0], [0, 0, 0]], dtype="int16")
    with rasterio.open(path, "w", driver="GTiff", height=3, width=3, count=1, dtype="int16",
                       crs="EPSG:4326", transform=from_origin(92.0, 24.0, 0.002, 0.002)) as dst:
        dst.write(a, 1)
    zeros = tmp_path / "zeros.tif"
    with rasterio.open(zeros, "w", driver="GTiff", height=3, width=3, count=1, dtype="int16",
                       crs="EPSG:4326", transform=from_origin(92.0, 24.0, 0.002, 0.002)) as dst:
        dst.write(np.zeros((3, 3), dtype="int16"), 1)
    old_dir, old_layers = SF.DIR, SF.LAYERS
    try:
        SF.DIR = tmp_path
        SF.LAYERS = {"clay_pct": ("layer.tif", 0.1), "sand_pct": ("zeros.tif", 0.1)}
        s = SF.SoilGrids()
        got = s.sample(92.003, 23.997)                       # centre pixel of the 3x3 window
        assert got["clay_pct"] == pytest.approx(20.0)        # mean of the valid 200s x 0.1, zeros ignored
        assert got["sand_pct"] is None                       # all-zero window -> missing, never imputed
        assert s.sample(10.0, 10.0)["clay_pct"] is None      # outside the raster -> missing
    finally:
        SF.DIR, SF.LAYERS = old_dir, old_layers
