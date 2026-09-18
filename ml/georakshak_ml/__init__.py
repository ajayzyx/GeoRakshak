"""GeoRakshak ML scoring package (docs/development.md §5).

Active model: B0 transparent rule-based index (uncalibrated heuristic).
"""

from .b0 import MissingFeaturesError, active_model, explain, score
from .config import MODEL_VERSION, set_severity_thresholds

__all__ = ["score", "explain", "active_model", "MissingFeaturesError", "MODEL_VERSION", "set_severity_thresholds"]
__version__ = "0.1.0"
