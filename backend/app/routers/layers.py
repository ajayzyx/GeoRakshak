import psycopg
from fastapi import APIRouter, Depends

from app.db import get_db
from app.errors import ApiError
from app.geo import collection, feature, parse_bbox
from app.security import AUTHORITY_ROLES, CurrentUser, require_roles

router = APIRouter(tags=["layers"])
VIEWERS = (*AUTHORITY_ROLES, "FIELD_OFFICER")


def _bbox_clause(bbox, column: str, where: list, args: list):
    try:
        box = parse_bbox(bbox)
    except ValueError as e:
        raise ApiError(422, str(e))
    if box:
        where.append(f"{column} && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        args += list(box)


def _layer_metadata(db, table: str) -> dict:
    """Provenance and attribution for a layer, taken from the data sources its rows actually reference."""
    row = db.execute(
        f"""SELECT string_agg(DISTINCT ds.attribution_text, '; ') AS attribution, string_agg(DISTINCT ds.slug, ',') AS slugs,
                   string_agg(DISTINCT t.provenance::text, ',') AS provenance
            FROM {table} t LEFT JOIN data_sources ds ON ds.id = t.source_id"""
    ).fetchone()
    provenances = sorted((row["provenance"] or "").split(",")) if row["provenance"] else []
    return {"provenance": provenances[0] if len(provenances) == 1 else provenances,
            "source_slugs": sorted((row["slugs"] or "").split(",")) if row["slugs"] else [],
            "attribution": row["attribution"]}


@router.get("/layers/locations")
def locations(bbox: str | None = None, type: str | None = None, access_status: str | None = None,
              user: CurrentUser = Depends(require_roles(*VIEWERS)), db: psycopg.Connection = Depends(get_db)):
    where, args = ["true"], []
    _bbox_clause(bbox, "l.geom", where, args)
    if type:
        where.append("l.type = ANY(%s)")
        args.append(type.split(","))
    if access_status:
        where.append("l.access_status::text = ANY(%s)")
        args.append(access_status.split(","))
    rows = db.execute(
        f"""SELECT l.id, ST_AsGeoJSON(l.geom, 6) AS g, l.type, l.name, l.access_status::text AS access_status, l.access_status_reason,
                   l.population, l.population_source_year, ds.slug AS source_slug, l.provenance::text AS provenance
            FROM locations l LEFT JOIN data_sources ds ON ds.id = l.source_id WHERE {' AND '.join(where)}""",
        args,
    ).fetchall()
    return collection([feature(r.pop("g"), {k: v for k, v in r.items() if k != "id"}, r["id"]) for r in rows],
                      _layer_metadata(db, "locations"))


@router.get("/layers/historical-landslides")
def landslides(bbox: str | None = None, user: CurrentUser = Depends(require_roles(*VIEWERS)), db: psycopg.Connection = Depends(get_db)):
    where, args = ["true"], []
    _bbox_clause(bbox, "h.geom", where, args)
    rows = db.execute(
        f"""SELECT h.id, ST_AsGeoJSON(h.geom, 6) AS g, h.event_date, h.event_date_precision, h.trigger, h.landslide_type,
                   h.location_accuracy_m, ds.slug AS source_slug, h.provenance::text AS provenance
            FROM historical_landslides h JOIN data_sources ds ON ds.id = h.source_id WHERE {' AND '.join(where)}""",
        args,
    ).fetchall()
    return collection([feature(r.pop("g"), {k: v for k, v in r.items() if k != "id"}, r["id"]) for r in rows],
                      _layer_metadata(db, "historical_landslides"))


# ESA WorldCover 2021 v200 class codes (the product's own legend, not our invention).
WORLDCOVER_CLASSES = {
    10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up",
    60: "Bare / sparse vegetation", 70: "Snow and ice", 80: "Permanent water bodies",
    90: "Herbaceous wetland", 95: "Mangroves", 100: "Moss and lichen",
}


@router.get("/layers/landcover")
def landcover(bbox: str | None = None, user: CurrentUser = Depends(require_roles(*VIEWERS)), db: psycopg.Connection = Depends(get_db)):
    """Satellite-derived land cover per analysis cell (OR-03), from the values stored with the pilot grid."""
    where, args = ["rz.static_features ? 'landcover_class'"], []
    _bbox_clause(bbox, "rz.geom", where, args)
    rows = db.execute(
        f"""SELECT rz.id, rz.grid_code, ST_AsGeoJSON(rz.geom, 6) AS g,
                   (rz.static_features->>'landcover_class')::int AS landcover_class,
                   (rz.static_features->>'landcover_tree_share')::float AS landcover_tree_share,
                   rz.feature_provenance->>'landcover_class' AS provenance
            FROM risk_zones rz WHERE {' AND '.join(where)}""",
        args,
    ).fetchall()
    source = db.execute(
        """SELECT slug, dataset, attribution_text, metadata, provenance_default::text AS p, connection_status::text AS status
           FROM data_sources WHERE kind = 'SATELLITE_LAYER' AND metadata ? 'acquisition_period' ORDER BY slug LIMIT 1"""
    ).fetchone()
    period = ((source or {}).get("metadata") or {}).get("acquisition_period") or ""
    start, end = (period.split("/", 1) + [None])[:2] if "/" in period else (None, None)
    feats = [feature(r["g"], {"grid_code": r["grid_code"], "landcover_class": r["landcover_class"],
                              "landcover_label": WORLDCOVER_CLASSES.get(r["landcover_class"], "Unclassified"),
                              "landcover_tree_share": r["landcover_tree_share"], "provenance": r["provenance"]}, r["id"])
             for r in rows]
    return collection(feats, {
        "source_slug": source["slug"] if source else None,
        "dataset": source["dataset"] if source else None,
        "connection_status": source["status"] if source else None,
        "acquisition_start": start, "acquisition_end": end,
        "acquisition_note": None if start else "Acquisition date range not recorded for this source",
        "attribution": source["attribution_text"] if source else None,
        "provenance": (source["p"] if source else None) or "REAL_HISTORICAL",
        "class_labels": {str(k): v for k, v in WORLDCOVER_CLASSES.items()},
        "note": "Majority land-cover class per analysis cell, as used by the risk model. Not an image.",
    })


@router.get("/layers/satellite")
def satellite(user: CurrentUser = Depends(require_roles(*VIEWERS)), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute("SELECT slug, dataset, metadata, attribution_text, provenance_default::text AS p FROM data_sources WHERE kind = 'SATELLITE_LAYER' ORDER BY slug").fetchall()
    items = []
    for r in rows:
        m = r["metadata"] or {}
        # An acquisition date range must always be shown (CLAUDE.md §9 rule 12). Sources record it either as
        # explicit fields or as an ISO interval "start/end"; if neither exists, say so rather than showing nothing.
        start, end = m.get("acquisition_start"), m.get("acquisition_end")
        if not start and isinstance(m.get("acquisition_period"), str) and "/" in m["acquisition_period"]:
            start, end = (p.strip() or None for p in m["acquisition_period"].split("/", 1))
        items.append({
            "slug": r["slug"], "title": m.get("title", r["dataset"]), "kind": m.get("layer_kind", "IMAGERY"),
            "acquisition_start": start, "acquisition_end": end,
            "acquisition_note": None if start else "Acquisition date range not recorded for this source",
            "bounds": m.get("bounds"), "display": m.get("display"), "attribution_text": r["attribution_text"],
            "provenance": r["p"] or "REAL_HISTORICAL",
        })
    return {"items": items}
