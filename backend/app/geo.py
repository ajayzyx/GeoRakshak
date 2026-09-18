import json


def feature(geometry_json: str | dict, properties: dict, feature_id=None) -> dict:
    geometry = json.loads(geometry_json) if isinstance(geometry_json, str) else geometry_json
    f = {"type": "Feature", "geometry": geometry, "properties": properties}
    if feature_id is not None:
        f["id"] = str(feature_id)
    return f


def collection(features: list[dict], metadata: dict | None = None) -> dict:
    fc = {"type": "FeatureCollection", "features": features}
    if metadata is not None:
        fc["metadata"] = metadata
    return fc


def parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    parts = [float(p) for p in bbox.split(",")]
    if len(parts) != 4 or parts[0] >= parts[2] or parts[1] >= parts[3]:
        raise ValueError("bbox must be minLon,minLat,maxLon,maxLat")
    return parts[0], parts[1], parts[2], parts[3]
