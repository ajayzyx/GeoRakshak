"""Template-based plain-language factor text (no free-form generation).

Text is keyed by feature and normalised-value band: "low" (< 1/3), "mid", "high" (>= 2/3).
"""

from __future__ import annotations

TEMPLATES = {
    "slope_deg_mean": {
        "low": "Gentle slope",
        "mid": "Moderately steep slope",
        "high": "Very steep slope",
    },
    "relief_m": {
        "low": "Low local relief (fairly flat ground)",
        "mid": "Moderate local relief",
        "high": "High local relief (deeply cut hill terrain)",
    },
    "landcover_class": {
        "low": "Land cover is {name}, which is less prone to slope failure",
        "mid": "Land cover is {name}",
        "high": "Land cover is {name}, which is more prone to slope failure",
    },
    "ndvi_mean": {
        "low": "Dense vegetation cover",
        "mid": "Moderate vegetation cover",
        "high": "Sparse vegetation cover",
    },
    "past_landslide_density": {
        "low": "Few or no recorded past landslides nearby (records are incomplete)",
        "mid": "Some recorded past landslides nearby",
        "high": "Many recorded past landslides nearby",
    },
    "rain_1d_mm": {
        "low": "1-day rainfall is light",
        "mid": "1-day rainfall is heavy",
        "high": "1-day rainfall is very heavy",
    },
    "rain_3d_mm": {
        "low": "3-day rainfall is low",
        "mid": "3-day rainfall is high",
        "high": "3-day rainfall is very high",
    },
    "rain_7d_mm": {
        "low": "7-day rainfall is low",
        "mid": "7-day rainfall is high",
        "high": "7-day rainfall is very high",
    },
    "rain_antecedent_15d_mm": {
        "low": "Ground has had little rain over the past 15 days",
        "mid": "Ground is wet from rain over the past 15 days",
        "high": "Ground is very wet from heavy rain over the past 15 days",
    },
    "rain_anomaly": {
        "low": "Recent rainfall is near this area's usual level for this time of year",
        "mid": "Recent rainfall is above this area's usual level for this time of year",
        "high": "Recent rainfall is far above this area's usual level for this time of year",
    },
}

NO_RAINFALL_TEXT = "No rainfall input for this cell."
NO_SENSOR_TEXT = "No soil moisture sensor coverage for this cell; no sensor adjustment."
SENSOR_TEXT = {
    "high": "Nearby soil moisture reading is high",
    "elevated": "Nearby soil moisture reading is elevated",
    "normal": "Nearby soil moisture reading is normal; no adjustment",
}
SIMULATED_SENSOR_SUFFIX = " (virtual sensor, simulated)"
FORECAST_PREFIX = "Forecast (+{h} h): "


def band(n: float, low: float, high: float) -> str:
    if n < low:
        return "low"
    if n >= high:
        return "high"
    return "mid"
