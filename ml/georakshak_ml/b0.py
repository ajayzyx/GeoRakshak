"""B0 transparent rule-based landslide risk index (uncalibrated heuristic).

See config.py for every weight/threshold and README.md for the method.
Pure Python, no third-party dependencies.
"""

from __future__ import annotations

import math
from typing import Any

from . import config as C
from . import templates as T


class MissingFeaturesError(ValueError):
    """Raised when a cell lacks one or more required features. No imputation is done."""

    def __init__(self, cell_id: Any, missing: list[str]):
        self.cell_id = cell_id
        self.missing = list(missing)
        super().__init__(f"Cell {cell_id!r} is missing required features: {', '.join(self.missing)}")


# --------------------------------------------------------------------------- helpers

def _num(v: Any) -> float | None:
    """Return v as a finite float, or None if absent / non-numeric / NaN."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _ramp(x: float, lo: float, hi: float) -> float:
    n = (x - lo) / (hi - lo)
    return min(1.0, max(0.0, n))


def _r(x: float) -> float:
    return round(x, 4)


def _direction(contribution: float) -> str:
    return "decreases_risk" if contribution < 0 else "increases_risk"


def _landcover_code(v: Any) -> int | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        code = int(v) if float(v).is_integer() else None
    else:
        s = str(v).strip().lower()
        code = None
        if s.lstrip("-").isdigit():
            code = int(s)
        else:
            for k, name in C.SUSCEPTIBILITY_FACTORS["landcover_class"]["names"].items():
                if s == name:
                    code = k
                    break
    if code not in C.SUSCEPTIBILITY_FACTORS["landcover_class"]["table"]:
        return None
    return code


def _validate_cell(cell: dict) -> tuple[Any, dict, dict]:
    if not isinstance(cell, dict):
        raise TypeError("cell must be a dict")
    cell_id = cell.get("cell_id")
    features = cell.get("features") or {}
    provenance = cell.get("feature_provenance") or {}
    missing = [f for f in C.REQUIRED_FEATURES if _num(features.get(f)) is None]
    if missing:
        raise MissingFeaturesError(cell_id, missing)
    return cell_id, features, provenance


def _pick_sensor(cell_id: Any, sensor_inputs: list[dict] | None) -> dict | None:
    if not sensor_inputs:
        return None
    best = None
    for s in sensor_inputs:
        if s.get("cell_id") != cell_id or s.get("variable") != C.SENSOR_VARIABLE:
            continue
        if s.get("unit") != C.SENSOR_UNIT:
            raise ValueError(
                f"Sensor {s.get('station_code')!r}: unit {s.get('unit')!r} not supported, expected {C.SENSOR_UNIT!r}"
            )
        value = _num(s.get("value"))
        if value is None:
            continue
        dist = _num(s.get("distance_m"))
        if dist is not None and dist > C.SENSOR_INFLUENCE_RADIUS_M:
            continue
        key = (dist if dist is not None else math.inf, str(s.get("station_code")))
        if best is None or key < best[0]:
            best = (key, s, value)
    if best is None:
        return None
    return {"reading": best[1], "value": best[2]}


# --------------------------------------------------------------------------- core

def _evaluate(cell: dict, lead_time_h: int, sensor_inputs: list[dict] | None) -> dict:
    if not isinstance(lead_time_h, int) or isinstance(lead_time_h, bool) or lead_time_h < 0:
        raise ValueError("lead_time_h must be a non-negative integer")
    cell_id, features, prov = _validate_cell(cell)

    # ---- susceptibility
    present: list[tuple[str, dict, float, Any, str | None]] = []  # (name, spec, normalised, raw value, lc name)
    for name, spec in C.SUSCEPTIBILITY_FACTORS.items():
        raw = features.get(name)
        if spec["kind"] == "lookup":
            code = _landcover_code(raw)
            if code is None:
                continue
            present.append((name, spec, spec["table"][code], code, spec["names"][code]))
        else:
            x = _num(raw)
            if x is None:
                continue
            present.append((name, spec, _ramp(x, spec["lo"], spec["hi"]), x, None))

    wsum = sum(p[1]["weight"] for p in present)
    susceptibility = sum(p[1]["weight"] / wsum * p[2] for p in present)
    factors: list[dict] = []
    for name, spec, n, raw, lc_name in present:
        w = spec["weight"] / wsum
        contribution = C.W_SUSCEPTIBILITY * w * (n - spec.get("reference", C.SUSCEPTIBILITY_REFERENCE))
        text = T.TEMPLATES[name][T.band(n, C.BAND_LOW, C.BAND_HIGH)].format(name=lc_name)
        factors.append({
            "feature": name,
            "label": spec["label"],
            "value": raw if isinstance(raw, int) and spec["kind"] == "lookup" else _r(float(raw)),
            "unit": spec["unit"],
            "contribution": _r(contribution),
            "direction": _direction(contribution),
            "component": "SUSCEPTIBILITY",
            "text": text,
            "provenance": prov.get(name),
        })

    # ---- rainfall trigger
    rain = []
    for name, spec in C.TRIGGER_FACTORS.items():
        x = _num(features.get(name))
        if x is not None:
            rain.append((name, spec, _ramp(x, spec["lo"], spec["hi"]), x))
    has_rain = bool(rain)
    rsum = sum(r[1]["weight"] for r in rain)
    trigger = sum(r[1]["weight"] / rsum * r[2] for r in rain) if has_rain else 0.0

    # ---- sensor modifier
    picked = _pick_sensor(cell_id, sensor_inputs)
    multiplier = 1.0
    sensor_band = None
    if picked is not None:
        for min_vwc, mult, band_name in C.SENSOR_BANDS:
            if picked["value"] >= min_vwc:
                multiplier, sensor_band = min(mult, C.SENSOR_MAX_MULTIPLIER), band_name
                break

    trigger_scale = C.W_TRIGGER * susceptibility  # trigger gated by susceptibility
    prefix = T.FORECAST_PREFIX.format(h=lead_time_h) if lead_time_h > 0 else ""
    for name, spec, n, x in rain:
        contribution = trigger_scale * (spec["weight"] / rsum) * n
        factors.append({
            "feature": name,
            "label": spec["label"],
            "value": _r(x),
            "unit": spec["unit"],
            "contribution": _r(contribution),
            "direction": _direction(contribution),
            "component": "TRIGGER",
            "text": prefix + T.TEMPLATES[name][T.band(n, C.BAND_LOW, C.BAND_HIGH)],
            "provenance": prov.get(name),
        })
    notes = []
    if not has_rain:
        notes.append({
            "feature": "rainfall",
            "label": "Rainfall",
            "value": None,
            "unit": None,
            "contribution": 0.0,
            "direction": "increases_risk",
            "component": "TRIGGER",
            "text": T.NO_RAINFALL_TEXT,
            "provenance": "MODEL_OUTPUT",
        })

    if picked is not None:
        reading = picked["reading"]
        contribution = trigger_scale * trigger * (multiplier - 1.0)
        text = T.SENSOR_TEXT[sensor_band]
        if reading.get("provenance") == "SIMULATED_DEMO":
            text += T.SIMULATED_SENSOR_SUFFIX
        f = {
            "feature": "sensor_vwc",
            "label": "Soil moisture sensor",
            "value": _r(picked["value"]),
            "unit": C.SENSOR_UNIT,
            "contribution": _r(contribution),
            "direction": _direction(contribution),
            "component": "SENSOR_ADJUSTMENT",
            "text": text,
            "provenance": reading.get("provenance"),
        }
        if reading.get("station_code") is not None:
            f["station_code"] = reading.get("station_code")
        factors.append(f)
    else:
        notes.append({
            "feature": "sensor_vwc",
            "label": "Soil moisture sensor",
            "value": None,
            "unit": None,
            "contribution": 0.0,
            "direction": "increases_risk",
            "component": "SENSOR_ADJUSTMENT",
            "text": T.NO_SENSOR_TEXT,
            "provenance": "MODEL_OUTPUT",
        })

    raw_score = C.W_SUSCEPTIBILITY * susceptibility + trigger_scale * trigger * multiplier
    # Severity is derived from the rounded (reported) score so the two never disagree.
    score = _r(min(1.0, max(0.0, raw_score)))

    severity = next(label for lo, label in C.severity_thresholds() if score >= lo)

    level = C.CONFIDENCE_LEVELS.index(C.CONFIDENCE_BASE)
    if lead_time_h >= C.CONFIDENCE_LEAD_TIME_DOWNGRADE_H:
        level -= 1
    if not has_rain:
        level -= 1
    confidence = C.CONFIDENCE_LEVELS[max(0, level)]

    factors.sort(key=lambda f: (-abs(f["contribution"]), f["component"], f["feature"]))
    return {
        "cell_id": cell_id,
        "score": score,
        "severity": severity,
        "confidence": confidence,
        "model_version": C.MODEL_VERSION,
        "factors": factors + notes,
    }


# --------------------------------------------------------------------------- public API

def score(cells: list[dict], lead_time_h: int = 0, sensor_inputs: list[dict] | None = None) -> list[dict]:
    """Score cells with the B0 rule-based index. Output order matches input order."""
    return [_evaluate(c, lead_time_h, sensor_inputs) for c in cells]


def explain(cell: dict, lead_time_h: int = 0, sensor_inputs: list[dict] | None = None) -> list[dict]:
    """Return the Factor list for one cell (identical to score()[0]["factors"])."""
    return _evaluate(cell, lead_time_h, sensor_inputs)["factors"]


def active_model() -> dict:
    return {
        "version": C.MODEL_VERSION,
        "model_type": C.MODEL_TYPE,
        "stage": C.STAGE,
        "feature_list": {
            "required": list(C.REQUIRED_FEATURES),
            "optional_susceptibility": [k for k in C.SUSCEPTIBILITY_FACTORS if k not in C.REQUIRED_FEATURES],
            "optional_trigger": list(C.TRIGGER_FACTORS),
            "sensor_modifier": [C.SENSOR_VARIABLE],
        },
        "thresholds": {
            "severity_lower_bounds": {label: lo for lo, label in C.severity_thresholds()},
            "severity_thresholds_source": C.severity_thresholds_source(),
            "severity_thresholds_note": C.SEVERITY_THRESHOLDS_NOTE,
            "sensor_vwc_bands": [
                {"min_vwc_m3m3": lo, "multiplier": m, "band": b} for lo, m, b in C.SENSOR_BANDS
            ],
            "sensor_influence_radius_m": C.SENSOR_INFLUENCE_RADIUS_M,
            "w_susceptibility": C.W_SUSCEPTIBILITY,
            "w_trigger": C.W_TRIGGER,
            "susceptibility_baseline": C.W_SUSCEPTIBILITY * C.SUSCEPTIBILITY_REFERENCE,
            "susceptibility_baseline_note": (
                "baseline = w_susceptibility * sum(renormalised weight * reference) over the susceptibility factors "
                "present; equals susceptibility_baseline when past_landslide_density (reference 0.0) is absent. "
                "score before clipping = baseline + sum(factor contributions)."),
            "factor_references": {k: v.get("reference", C.SUSCEPTIBILITY_REFERENCE)
                                  for k, v in C.SUSCEPTIBILITY_FACTORS.items()},
            "calibrated": False,
            "note": "Uncalibrated literature-informed heuristics; not validated thresholds.",
        },
        "validation_scheme": "NONE - rule-based heuristic, not trained or validated",
        "metrics": None,
        "forecast_skill_evaluated": False,
        "model_card_uri": C.MODEL_CARD_URI,
    }
