"""Step 3: OSM roads (split at intersections, <= MAX_SEGMENT_M) and locations via the Overpass API.

Raw Overpass responses are cached in data/raw/osm/. Data © OpenStreetMap contributors, ODbL 1.0.
"""

from __future__ import annotations

import json

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, box, mapping
from shapely.ops import transform as shp_transform

import pilot_config as P
from common import overpass

ROADS_SLUG = "osm-roads"
LOCATIONS_SLUG = "osm-locations"


def bbox_ql():
    b = P.BBOX
    return f"{b[1]},{b[0]},{b[3]},{b[2]}"


def fetch():
    bb = bbox_ql()
    classes = "|".join(P.ROAD_CLASSES)
    roads = overpass(f'[out:json][timeout:180];way[highway~"^({classes})$"]({bb});out body geom;',
                     cache=P.RAW_DIR / "osm" / f"{P.PILOT_SLUG}_roads.json")
    locs = overpass(f"""[out:json][timeout:180];
(
  nwr[place~"^(city|town|village|hamlet)$"]({bb});
  nwr[amenity~"^(school|college)$"]({bb});
  nwr[amenity~"^(hospital|clinic|doctors)$"]({bb});
  nwr[healthcare~"^(hospital|clinic|centre|doctor)$"]({bb});
  nwr[emergency=assembly_point]({bb});
  nwr[social_facility=shelter]({bb});
);
out tags center;""", cache=P.RAW_DIR / "osm" / f"{P.PILOT_SLUG}_locations.json")
    return roads, locs


def location_type(tags):
    place = tags.get("place")
    if place in ("city", "town"):
        return "TOWN"
    if place in ("village", "hamlet"):
        return "VILLAGE"
    if tags.get("amenity") in ("hospital", "clinic", "doctors") or tags.get("healthcare") in ("hospital", "clinic", "centre", "doctor"):
        return "HEALTH_FACILITY"
    if tags.get("amenity") in ("school", "college"):
        return "SCHOOL"
    if tags.get("emergency") == "assembly_point" or tags.get("social_facility") == "shelter":
        return "SHELTER"
    return None


KEEP_TAGS = ("place", "amenity", "healthcare", "emergency", "social_facility", "operator", "name:en", "isced:level",
             "population", "population:date", "source")


def build_locations(locs, roads):
    b = P.BBOX
    feats, seen = [], set()
    for el in locs["elements"]:
        tags = el.get("tags", {})
        t = location_type(tags)
        if t is None:
            continue
        if el["type"] == "node":
            lon, lat = el["lon"], el["lat"]
        elif "center" in el:
            lon, lat = el["center"]["lon"], el["center"]["lat"]
        else:
            continue
        if not (b[0] <= lon <= b[2] and b[1] <= lat <= b[3]):
            continue
        oid = f"{el['type']}/{el['id']}"
        if oid in seen:
            continue
        seen.add(oid)
        attrs = {k: v for k, v in tags.items() if k in KEEP_TAGS}
        attrs["osm_geometry"] = el["type"] if el["type"] == "node" else f"{el['type']} (center point)"
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                      "properties": {"type": t, "name": tags.get("name"), "osm_id": oid, "attributes": attrs,
                                     "source_slug": LOCATIONS_SLUG, "provenance": "REAL_HISTORICAL"}})
    # Bridges: OSM highway ways tagged bridge=yes, represented by their midpoint.
    clip = box(*b)
    for el in roads["elements"]:
        tags = el.get("tags", {})
        if tags.get("bridge") in (None, "no"):
            continue
        line = LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
        mid = line.interpolate(0.5, normalized=True)
        if not clip.contains(mid):
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(mid.x, 7), round(mid.y, 7)]},
                      "properties": {"type": "BRIDGE", "name": tags.get("bridge:name") or tags.get("name"),
                                     "osm_id": f"way/{el['id']}",
                                     "attributes": {"highway": tags.get("highway"), "bridge": tags.get("bridge"),
                                                    "osm_geometry": "way (midpoint)"},
                                     "source_slug": LOCATIONS_SLUG, "provenance": "REAL_HISTORICAL"}})
    return feats


def split_roads(roads):
    to_utm = Transformer.from_crs("EPSG:4326", P.PROJECTED_CRS, always_xy=True).transform
    clip = box(*P.BBOX)
    ways = [el for el in roads["elements"] if el["type"] == "way" and "geometry" in el]
    usage = {}
    for w in ways:
        for n in set(w["nodes"]):
            usage[n] = usage.get(n, 0) + 1
    feats = []
    for w in ways:
        tags = w.get("tags", {})
        coords = [(p["lon"], p["lat"]) for p in w["geometry"]]
        # 1) split at intersections (nodes shared with another kept way)
        pieces, cur = [], [coords[0]]
        for i in range(1, len(coords)):
            cur.append(coords[i])
            if i < len(coords) - 1 and usage.get(w["nodes"][i], 0) > 1:
                pieces.append(cur)
                cur = [coords[i]]
        pieces.append(cur)
        idx = 0
        for piece in pieces:
            if len(piece) < 2:
                continue
            geom = LineString(piece).intersection(clip)  # 2) clip to pilot bbox
            parts = [geom] if isinstance(geom, LineString) else list(getattr(geom, "geoms", []))
            for part in parts:
                if not isinstance(part, LineString) or part.is_empty or len(part.coords) < 2:
                    continue
                # 3) split long pieces at vertices so each segment is <= MAX_SEGMENT_M where possible
                pts = list(part.coords)
                seg, seg_len = [pts[0]], 0.0
                for a, c in zip(pts[:-1], pts[1:]):
                    d = shp_transform(to_utm, LineString([a, c])).length
                    if seg_len + d > P.MAX_SEGMENT_M and len(seg) > 1:
                        feats.append(_road_feature(w, tags, seg, idx)); idx += 1
                        seg, seg_len = [a], 0.0
                    seg.append(c); seg_len += d
                if len(seg) > 1:
                    feats.append(_road_feature(w, tags, seg, idx)); idx += 1
    return feats


def _road_feature(w, tags, pts, idx):
    return {"type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in pts]},
            "properties": {"osm_way_id": str(w["id"]), "segment_index": idx, "name": tags.get("name"),
                           "road_class": tags.get("highway"), "ref": tags.get("ref"), "surface": tags.get("surface"),
                           "bridge": tags.get("bridge") not in (None, "no"),
                           "source_slug": ROADS_SLUG, "provenance": "REAL_HISTORICAL"}}


def main():
    roads, locs = fetch()
    loc_feats = build_locations(locs, roads)
    road_feats = split_roads(roads)
    meta = {"osm_base_timestamp_roads": roads.get("osm3s", {}).get("timestamp_osm_base"),
            "osm_base_timestamp_locations": locs.get("osm3s", {}).get("timestamp_osm_base"),
            "attribution": "© OpenStreetMap contributors (ODbL 1.0)"}
    (P.OUT / "locations.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": loc_feats}))
    (P.OUT / "road_segments.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": road_feats}))
    from collections import Counter
    print("locations:", dict(Counter(f["properties"]["type"] for f in loc_feats)))
    print("road segments:", len(road_feats), "from ways:", len({f["properties"]["osm_way_id"] for f in road_feats}),
          dict(Counter(f["properties"]["road_class"] for f in road_feats)))
    print(meta)


if __name__ == "__main__":
    main()
