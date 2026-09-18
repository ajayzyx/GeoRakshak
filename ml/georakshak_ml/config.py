"""B0 rule-based index configuration.

Scoring parameters below are model internals: changing one requires a MODEL_VERSION bump. Severity banding is
operator configuration (see DEFAULT_SEVERITY_THRESHOLDS) and does not.

IMPORTANT: every number in this module is an UNCALIBRATED, literature-informed
heuristic chosen so the product works end-to-end before a trained model exists
(docs/ml-strategy.md §2.3, §6). None of these values is a validated or
site-calibrated threshold. They have not been fitted to, or evaluated against,
any landslide inventory. Rationale for each value is given inline and in
ml/georakshak_ml/README.md. Changing any value requires bumping MODEL_VERSION.
"""

from __future__ import annotations

import os

MODEL_VERSION = "b0-rules-0.1.0"
MODEL_TYPE = "RULE_BASED_INDEX"
STAGE = "B0_BASELINE"
MODEL_CARD_URI = "ml/georakshak_ml/README.md"

# ---------------------------------------------------------------------------
# Top-level combination
#   score = W_SUSCEPTIBILITY * S  +  W_TRIGGER * S * T * M      (clipped to [0, 1])
#   S = susceptibility in [0,1], T = rainfall trigger in [0,1], M = sensor modifier.
# Rationale: the trigger is gated by susceptibility (multiplied by S) so that heavy
# rain on flat ground does not create high landslide risk. With no rainfall input
# (T = 0) the score is capped at W_SUSCEPTIBILITY = 0.5, i.e. terrain alone can at
# most reach HIGH, never VERY_HIGH.
# ---------------------------------------------------------------------------
W_SUSCEPTIBILITY = 0.5
W_TRIGGER = 0.5

# Susceptibility factor contributions are reported relative to a per-factor neutral
# reference on the normalised scale (default 0.5, so gentle slopes show
# "decreases_risk"). A factor may override it with "reference" in its spec.
# baseline = W_SUSCEPTIBILITY * sum(w_i * reference_i) over the factors present;
# score (before clipping) = baseline + sum(contributions).
SUSCEPTIBILITY_REFERENCE = 0.5

# ---------------------------------------------------------------------------
# Required features: kept minimal (terrain derived from the DEM, available for
# every pilot cell). Missing/None/non-numeric -> MissingFeaturesError.
# ---------------------------------------------------------------------------
REQUIRED_FEATURES = ("slope_deg_mean", "relief_m")

# ---------------------------------------------------------------------------
# Susceptibility factors.
#   kind "ramp": linear ramp from `lo` (normalised 0) to `hi` (normalised 1), clipped.
#                If lo > hi the ramp is inverted (higher raw value -> lower risk).
#   kind "lookup": categorical lookup table.
# Weights are renormalised over the factors present for a cell (documented
# available-case weighting; the optional factors actually used are visible in the
# factor list). Required factors are always present.
# ---------------------------------------------------------------------------
SUSCEPTIBILITY_FACTORS = {
    "slope_deg_mean": {
        "label": "Slope",
        "unit": "deg",
        "kind": "ramp",
        "lo": 5.0,
        "hi": 35.0,
        "weight": 0.40,
        # Rationale: slope is the dominant conditioning factor in most landslide
        # susceptibility studies. Rainfall-induced shallow slides are rare on
        # slopes below ~10 deg and most frequent on ~25-45 deg slopes. A 500 m
        # cell MEAN of 30 m DEM slopes is damped relative to local slopes, so the
        # ramp is shifted down (5 -> 35 deg).
    },
    "relief_m": {
        "label": "Local relief",
        "unit": "m",
        "kind": "ramp",
        "lo": 20.0,
        "hi": 250.0,
        "weight": 0.20,
        # Rationale: elevation range inside a 500 m cell; proxy for slope height and
        # valley incision. <20 m is near-flat, >250 m within 500 m is deeply incised
        # hill terrain typical of NER.
    },
    "landcover_class": {
        "label": "Land cover (satellite)",
        "unit": None,
        "kind": "lookup",
        "weight": 0.15,
        # ESA WorldCover v100/v200 class codes -> relative risk. Rationale: bare /
        # sparsely vegetated ground and disturbed land (cropland, built-up with cut
        # slopes) are more failure-prone than closed forest; water/wetland cells are
        # not hillslopes. Heuristic ordering only.
        "table": {
            10: 0.30,   # Tree cover
            20: 0.50,   # Shrubland
            30: 0.60,   # Grassland
            40: 0.65,   # Cropland (incl. shifting cultivation / jhum)
            50: 0.65,   # Built-up (road/house cut slopes)
            60: 0.90,   # Bare / sparse vegetation
            70: 0.30,   # Snow and ice
            80: 0.00,   # Permanent water bodies
            90: 0.10,   # Herbaceous wetland
            95: 0.10,   # Mangroves
            100: 0.50,  # Moss and lichen
        },
        "names": {
            10: "tree cover", 20: "shrubland", 30: "grassland", 40: "cropland",
            50: "built-up", 60: "bare / sparse vegetation", 70: "snow and ice",
            80: "permanent water", 90: "herbaceous wetland", 95: "mangroves",
            100: "moss and lichen",
        },
    },
    "ndvi_mean": {
        "label": "Vegetation (satellite)",
        "unit": None,
        "kind": "ramp",
        "lo": 0.8,
        "hi": 0.2,
        "weight": 0.10,
        # Rationale: inverted ramp - dense vegetation (NDVI >= 0.8) adds root
        # cohesion and interception; NDVI <= 0.2 is bare soil/rock or recent scars.
    },
    "past_landslide_density": {
        "label": "Past landslides nearby",
        "unit": "count/km2",
        "kind": "ramp",
        "lo": 0.0,
        "hi": 2.0,
        "weight": 0.15,
        "reference": 0.0,
        # reference 0.0: inventories are incomplete ("absence of a record is not absence
        # of a landslide", ml-strategy §4), so having no records never DEcreases risk.
        # Rationale: landslides recur where they occurred before. 2 mapped events per
        # km2 is treated as saturating for a 500 m grid. Must be computed excluding
        # evaluation-fold events when used in any evaluation.
    },
}

# ---------------------------------------------------------------------------
# Rainfall trigger factors (all optional). Normalised with ramps from lo -> hi.
# Weights are renormalised over the rainfall features present. If none are present
# the trigger is 0 and a "No rainfall input for this cell." factor is emitted.
# ---------------------------------------------------------------------------
TRIGGER_FACTORS = {
    "rain_1d_mm": {
        "label": "1-day rainfall", "unit": "mm", "lo": 20.0, "hi": 150.0, "weight": 0.30,
        # Rationale: IMD 24 h categories - heavy rain 64.5-115.5 mm, very heavy
        # 115.6-204.4 mm. Ramp starts at 20 mm (moderate) and saturates at 150 mm.
    },
    "rain_3d_mm": {
        "label": "3-day rainfall", "unit": "mm", "lo": 50.0, "hi": 300.0, "weight": 0.25,
        # Rationale: multi-day accumulations of a few hundred mm are commonly
        # associated with landslide clusters in the Himalaya / NER.
    },
    "rain_7d_mm": {
        "label": "7-day rainfall", "unit": "mm", "lo": 100.0, "hi": 500.0, "weight": 0.15,
        # Rationale: weekly totals that wet the regolith; heuristic.
    },
    "rain_antecedent_15d_mm": {
        "label": "15-day antecedent rainfall", "unit": "mm", "lo": 150.0, "hi": 600.0, "weight": 0.15,
        # Rationale: antecedent wetness lowers the rainfall needed to trigger slides;
        # NER monsoon months often exceed 400-600 mm.
    },
    "rain_anomaly": {
        "label": "Rainfall vs. normal", "unit": "ratio", "lo": 1.0, "hi": 4.0, "weight": 0.15,
        # Rationale: ratio of recent rainfall to the cell's day-of-year climatology.
        # 1 = normal (no extra trigger), 4x normal = saturating.
    },
}

# ---------------------------------------------------------------------------
# Soil-moisture sensor modifier (docs/ml-strategy.md §2.4). Multiplies the trigger
# term; bounded to [1.0, SENSOR_MAX_MULTIPLIER]. It never reduces risk: one
# (virtual) sensor should not suppress a rainfall signal. The nearest reading
# within SENSOR_INFLUENCE_RADIUS_M is used.
# Rationale: typical mineral soils have field capacity around 0.25-0.35 m3/m3 and
# saturation around 0.40-0.50 m3/m3. Readings near saturation indicate the slope
# has little remaining storage. NOT site-calibrated.
# ---------------------------------------------------------------------------
SENSOR_VARIABLE = "SOIL_MOISTURE_VWC"
SENSOR_UNIT = "m3/m3"
SENSOR_INFLUENCE_RADIUS_M = 2000.0
SENSOR_BANDS = (
    # (min_vwc inclusive, multiplier, band name)
    (0.45, 1.25, "high"),
    (0.35, 1.10, "elevated"),
    (0.00, 1.00, "normal"),
)
SENSOR_MAX_MULTIPLIER = 1.25

# ---------------------------------------------------------------------------
# Severity classes (lower bound inclusive). Heuristic equal-ish bands on the
# score; NOT chosen from validation curves (ml-strategy §7 step 7 still pending).
# ---------------------------------------------------------------------------
# Severity banding is an OPERATING decision (H11), not a scoring parameter: it maps the score onto the classes an
# authority acts on, so it is configurable per deployment and does not require a MODEL_VERSION bump. The scoring
# weights above are model internals and do. Whatever is configured, the active bands are reported by active_model()
# and stored with every assessment run.
DEFAULT_SEVERITY_THRESHOLDS = (
    (0.70, "VERY_HIGH"),
    (0.55, "HIGH"),
    (0.25, "MODERATE"),
    (0.00, "LOW"),
)
SEVERITY_THRESHOLDS_NOTE = (
    "Current operating thresholds for the MVP demo, selected from the measured area/recall decision table "
    "(backend/scripts/threshold_options.py). They are an operational choice, NOT statistically optimal and not "
    "fitted to any inventory."
)
_ACTIVE_SEVERITY = {"thresholds": DEFAULT_SEVERITY_THRESHOLDS, "source": "PACKAGE_DEFAULT"}


def severity_thresholds() -> tuple:
    """Active bands, highest lower-bound first."""
    return _ACTIVE_SEVERITY["thresholds"]


def severity_thresholds_source() -> str:
    return _ACTIVE_SEVERITY["source"]


def set_severity_thresholds(moderate: float, high: float, very_high: float, source: str = "CONFIGURED") -> tuple:
    """Override the operating bands. Values must be strictly increasing within (0, 1)."""
    bounds = (moderate, high, very_high)
    if not all(isinstance(v, (int, float)) for v in bounds):
        raise ValueError("severity thresholds must be numbers")
    if not 0.0 < moderate < high < very_high < 1.0:
        raise ValueError(f"severity thresholds must satisfy 0 < moderate < high < very_high < 1, got {bounds}")
    _ACTIVE_SEVERITY["thresholds"] = ((very_high, "VERY_HIGH"), (high, "HIGH"), (moderate, "MODERATE"), (0.00, "LOW"))
    _ACTIVE_SEVERITY["source"] = source
    return _ACTIVE_SEVERITY["thresholds"]


def _severity_from_env() -> None:
    raw = os.environ.get("GEORAKSHAK_SEVERITY_THRESHOLDS")
    if not raw:
        return
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 3:
        raise ValueError("GEORAKSHAK_SEVERITY_THRESHOLDS must be 'moderate,high,very_high'")
    set_severity_thresholds(*(float(p) for p in parts), source="ENV")


_severity_from_env()

# ---------------------------------------------------------------------------
# Confidence rule. B0 is uncalibrated, so it never reports HIGH confidence.
# Start at MEDIUM; downgrade one level each for (a) lead_time_h >= 48 and
# (b) no rainfall input for the cell. Floor at LOW.
# ---------------------------------------------------------------------------
CONFIDENCE_LEVELS = ("LOW", "MEDIUM", "HIGH")
CONFIDENCE_BASE = "MEDIUM"
CONFIDENCE_LEAD_TIME_DOWNGRADE_H = 48

# Normalised-value bands used to pick template text.
BAND_LOW = 1.0 / 3.0
BAND_HIGH = 2.0 / 3.0
