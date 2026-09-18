# georakshak_ml — B0 rule-based landslide risk index

> **Status: uncalibrated heuristic.** Model `b0-rules-0.1.0` is a transparent, rule-based
> index built so the product works end-to-end before any trained model exists
> (docs/ml-strategy.md §2.3, §6). Every weight and threshold is a **literature-informed
> heuristic chosen by the ML engineer**. None has been fitted to, or validated against,
> a landslide inventory. It is **not** a validated warning threshold. `active_model()`
> reports `metrics: None` and `forecast_skill_evaluated: False`.

This file is the model card for B0 (`model_card_uri`).

## Install and test

```bash
/opt/homebrew/bin/python3.11 -m venv ml/.venv
ml/.venv/bin/pip install -e 'ml[test]'
cd ml && .venv/bin/python -m pytest -q
```

No runtime dependencies (pure Python ≥3.11).

## Interface (docs/development.md §5)

```python
from georakshak_ml import score, explain, active_model, MissingFeaturesError

cell = {"cell_id": "PILOT-0001", "features": {"slope_deg_mean": 28.0, "relief_m": 180.0, "rain_3d_mm": 140.0},
        "feature_provenance": {"slope_deg_mean": "REAL_HISTORICAL", "relief_m": "REAL_HISTORICAL",
                               "rain_3d_mm": "REAL_HISTORICAL"}}
score([cell], lead_time_h=0, sensor_inputs=None)
# [{"cell_id", "score", "severity", "confidence", "model_version": "b0-rules-0.1.0", "factors": [...]}]
```

### Features

| Feature | Required | Component | Unit | Normalisation (→ 0..1) | Weight |
|---|---|---|---|---|---|
| `slope_deg_mean` | **yes** | SUSCEPTIBILITY | deg | ramp 5 → 35 | 0.40 |
| `relief_m` | **yes** | SUSCEPTIBILITY | m | ramp 20 → 250 | 0.20 |
| `landcover_class` | no | SUSCEPTIBILITY | ESA WorldCover code | lookup (below) | 0.15 |
| `ndvi_mean` | no | SUSCEPTIBILITY | — | inverted ramp 0.8 → 0.2 | 0.10 |
| `past_landslide_density` | no | SUSCEPTIBILITY | count/km² | ramp 0 → 2 | 0.15 |
| `rain_1d_mm` | no | TRIGGER | mm | ramp 20 → 150 | 0.30 |
| `rain_3d_mm` | no | TRIGGER | mm | ramp 50 → 300 | 0.25 |
| `rain_7d_mm` | no | TRIGGER | mm | ramp 100 → 500 | 0.15 |
| `rain_antecedent_15d_mm` | no | TRIGGER | mm | ramp 150 → 600 | 0.15 |
| `rain_anomaly` | no | TRIGGER | ratio to day-of-year normal | ramp 1 → 4 | 0.15 |
| `sensor_vwc` (from `sensor_inputs`) | no | SENSOR_ADJUSTMENT | m³/m³ | bands (below) | multiplier |

- Missing, `None`, NaN or non-numeric **required** features raise `MissingFeaturesError`
  (`.cell_id`, `.missing`). No imputation.
- **Optional** features that are absent are skipped, and the weights **within a component are
  renormalised over the features present** (available-case weighting). The factor list shows
  exactly which features were used. Other extra keys in `features` are ignored.
- Land-cover lookup (WorldCover code → relative risk): 10 tree 0.30 · 20 shrub 0.50 · 30 grass 0.60 ·
  40 cropland 0.65 · 50 built-up 0.65 · 60 bare/sparse 0.90 · 70 snow 0.30 · 80 water 0.00 ·
  90 wetland 0.10 · 95 mangroves 0.10 · 100 moss/lichen 0.50. Unknown codes are skipped.
  Integer codes, digit strings, or the English class names are accepted.

### Combination

```
S = Σ w_i · n_i   (susceptibility factors present, weights renormalised)
T = Σ v_j · r_j   (rainfall factors present, weights renormalised; T = 0 when none)
M = sensor multiplier ∈ [1.00, 1.25]  (1.00 when no sensor in range)
score = clip(0.5 · S + 0.5 · S · T · M, 0, 1)      rounded to 4 dp
```

Rationale:
- The trigger is **gated by susceptibility** (`· S`), so heavy rain on flat ground adds nothing.
- With no rainfall input, the score is capped at 0.5, so terrain alone reaches at most `HIGH`.
- The sensor modifier only multiplies the trigger. It **never reduces** risk (one virtual sensor
  should not suppress a rainfall signal), and it has no effect without rainfall.

### Severity (lower bound inclusive, on the reported score)

| Severity | Score |
|---|---|
| LOW | < 0.25 |
| MODERATE | 0.25 – < 0.45 |
| HIGH | 0.45 – < 0.65 |
| VERY_HIGH | ≥ 0.65 |

Heuristic bands. Not chosen from validation curves (ml-strategy §7 step 7 is still pending).

### Confidence

B0 is uncalibrated, so it never reports `HIGH`. It starts at `MEDIUM`, then drops one level for
`lead_time_h ≥ 48` and one level when the cell has no rainfall input. The floor is `LOW`.
So: lead 0/24 → MEDIUM, lead 48/72 → LOW, and no rainfall → LOW.

### Sensor modifier (ml-strategy §2.4)

- Uses `sensor_inputs` entries with the same `cell_id`, `variable == "SOIL_MOISTURE_VWC"`, and
  `distance_m ≤ 2000` (or no distance given). The nearest one wins, with ties broken by `station_code`.
- Unit must be `m3/m3`. Any other unit raises `ValueError`, with no silent conversion.
- Bands: VWC ≥ 0.45 → ×1.25 ("high"), ≥ 0.35 → ×1.10 ("elevated"), otherwise ×1.00 ("normal").
  Rationale: typical mineral soils reach field capacity around 0.25–0.35 m³/m³ and saturation
  around 0.40–0.50 m³/m³. These values are not site-calibrated.
- Text gets the suffix " (virtual sensor, simulated)" when the reading's provenance is `SIMULATED_DEMO`.
- If no reading is in range, a note factor says "No soil moisture sensor coverage for this cell; no sensor adjustment."
- Excluded from any reported metrics.

### Factors (docs/api.md §6.2)

Each factor has `feature, label, value, unit, contribution, direction, component, text, provenance`,
plus `station_code` for sensor factors.

- **Susceptibility contribution** = `0.5 · w_i · (n_i − ref_i)`. It is signed relative to a neutral
  reference `ref_i`, so a gentle slope shows `decreases_risk`. `ref_i = 0.5` for all factors except
  `past_landslide_density`, where `ref = 0.0`: inventories are incomplete, so the absence of
  records never lowers risk. The baseline is `0.5 · Σ w_i · ref_i` (renormalised weights). It is
  0.25 when `past_landslide_density` is absent
  (`active_model()["thresholds"]["susceptibility_baseline"]`, `factor_references`).
- **Trigger contribution** = `0.5 · S · v_j · r_j` (always ≥ 0).
- **Sensor contribution** = `0.5 · S · T · (M − 1)` (always ≥ 0).
- Before clipping, `baseline + Σ contributions = score` (up to 4-dp rounding).
- A zero contribution is labelled `increases_risk`. `direction` only carries meaning when the contribution is non-zero.
- `direction` is `decreases_risk` if the contribution is < 0, otherwise `increases_risk`.
- `provenance` is copied from `feature_provenance[feature]` (`None` if the caller omitted it),
  or from the sensor reading. Note factors ("No rainfall input for this cell.", no sensor
  coverage) have `value: None`, `contribution: 0.0`, `provenance: "MODEL_OUTPUT"`.
- Text is chosen from fixed templates (`templates.py`) by normalised band: < 1/3, mid, ≥ 2/3.
  For `lead_time_h > 0`, trigger texts are prefixed "Forecast (+N h): ".
- Order: by |contribution| descending, with note factors last. Clients show the top 3–5.
- Explanations describe the index's reasoning, not proven physical causation.

## Limitations

All limitations in docs/ml-strategy.md §11 apply. In particular:
1. The weights, ramps, bands and severity thresholds are uncalibrated heuristics.
2. Rainfall inputs from 0.25° grids are far coarser than 500 m cells.
3. Susceptibility does not include lithology, soil depth or drainage.
4. Not a warning authority. Scores support human judgement only.

## Changing the model

Edit `config.py`, bump `MODEL_VERSION`, update this card and the tests.
