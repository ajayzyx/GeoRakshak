"""Provisional pilot configuration (selected in ml/reports/data-spike.md; status PROVISIONAL until H4 sign-off)."""

from common import PROCESSED, RAW, candidate_bbox

PILOT_SLUG = "aizawl-mizoram"
PILOT_NAME = "Aizawl, Mizoram (provisional pilot)"
STATUS = "PROVISIONAL"
BBOX = candidate_bbox("aizawl")  # (minLon, minLat, maxLon, maxLat)
PROJECTED_CRS = "EPSG:32646"  # WGS 84 / UTM zone 46N (90-96 E)
CELL_SIZE_M = 500
DEM_RES_M = 25  # DEM resampled to 25 m so each 500 m cell is exactly 20x20 pixels
LC_RES_M = 10
GRID_CODE_PREFIX = "AIZ"
FEATURE_VERSION = "pilot-features-0.2.0"  # 0.2.0: past_landslide_density from the GSI surveyed inventory
BOUNDARY_NOTE = "Pilot bounding box — not an official administrative boundary"

# Real monsoon replay window: covers the 2017-06-01 and 2017-06-10 inventory events inside the pilot bbox,
# with >= 15 days of antecedent rainfall before the first event.
RAIN_YEAR = 2017
RAIN_START = "2017-05-15"
RAIN_END = "2017-06-30"

OUT = PROCESSED / PILOT_SLUG
RAW_DIR = RAW

# Road classes kept from OSM (service roads, footways, paths and steps are excluded).
ROAD_CLASSES = [
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
    "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "track",
]
MAX_SEGMENT_M = 1000.0

# past_landslide_density: GSI surveyed inventory records within this radius of the cell centroid (build_inventory.py).
DENSITY_RADIUS_M = 2000.0
DENSITY_MAX_ACCURACY_M = 5000.0  # still used for the NASA GLC exclusion buffers in the Stage A datasets
