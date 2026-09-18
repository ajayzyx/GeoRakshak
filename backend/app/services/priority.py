"""Transparent response-priority rules (docs/product-spec.md OR-14). Weights are MVP heuristics, not calibrated."""
RULE_VERSION = "priority-rules-0.1.0"
W_RISK, W_EVIDENCE, W_EXPOSURE = 0.40, 0.35, 0.25
SEV_W = {"LOW": 0.0, "MODERATE": 0.3, "HIGH": 0.6, "VERY_HIGH": 1.0}
REPORT_W = {"LOW": 0.25, "MEDIUM": 0.5, "HIGH": 0.75, "CRITICAL": 1.0}
EXPOSURE_RADIUS_M = 2000


def compute(conn, mode: str, lead_time_h: int = 0, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        f"""WITH cand AS (
               SELECT rz.id, rz.centroid, rz.geom, ra.severity::text AS severity, ra.factors
               FROM risk_zones rz
               LEFT JOIN risk_assessments ra ON ra.risk_zone_id = rz.id AND ra.is_latest AND ra.lead_time_h = %s AND ra.run_mode = %s
               WHERE ra.severity IN ('MODERATE', 'HIGH', 'VERY_HIGH')
                  OR EXISTS (SELECT 1 FROM reports r WHERE r.risk_zone_id = rz.id AND r.verification_status = 'VERIFIED'))
           SELECT c.id, c.severity, c.factors,
               (SELECT json_agg(json_build_object('category', r.category, 'severity', r.severity, 'media', (SELECT array_agg(DISTINCT e.media_type) FROM evidence e WHERE e.report_id = r.id)))
                  FROM reports r WHERE r.risk_zone_id = c.id AND r.verification_status = 'VERIFIED') AS verified,
               (SELECT count(*) FROM locations l WHERE l.type IN ('VILLAGE', 'TOWN') AND ST_DWithin(l.geom, c.centroid, 0.03)
                    AND ST_DWithin(l.geom::geography, c.centroid::geography, {EXPOSURE_RADIUS_M})) AS villages,
               (SELECT count(*) FROM locations l WHERE l.access_status = 'ACCESS_AT_RISK' AND ST_DWithin(l.geom, c.centroid, 0.03)
                    AND ST_DWithin(l.geom::geography, c.centroid::geography, {EXPOSURE_RADIUS_M})) AS villages_access,
               (SELECT count(*) FROM locations l WHERE l.type IN ('HEALTH_FACILITY', 'SCHOOL', 'SHELTER', 'BRIDGE') AND ST_DWithin(l.geom, c.centroid, 0.03)
                    AND ST_DWithin(l.geom::geography, c.centroid::geography, {EXPOSURE_RADIUS_M})) AS facilities,
               (SELECT count(*) FROM road_segments s WHERE s.status = 'BLOCKED' AND ST_DWithin(s.geom, c.geom, 0.01)) AS blocked
           FROM cand c""",
        (lead_time_h, mode),
    ).fetchall()
    items = []
    for r in rows:
        risk = SEV_W.get(r["severity"] or "LOW", 0)
        verified = r["verified"] or []
        evidence = max((REPORT_W[v["severity"]] for v in verified), default=0.0)
        exposure = min(1.0, min(r["villages"], 5) / 5 * 0.4 + min(r["facilities"], 3) / 3 * 0.3 + (0.3 if (r["villages_access"] or r["blocked"]) else 0))
        score = round(W_RISK * risk + W_EVIDENCE * evidence + W_EXPOSURE * exposure, 3)
        reasons = []
        for v in verified:
            media = " + ".join(m.lower() for m in (v["media"] or []) if m)
            reasons.append(f"Verified report: {v['category'].replace('_', ' ').lower()} ({v['severity']}){' with ' + media if media else ''}")
        if r["severity"]:
            top = (r["factors"] or [{}])[0]
            reasons.append(f"Risk {r['severity']}" + (f" ({top.get('label')}: {top.get('text')})" if top.get("text") else ""))
        if r["villages"] or r["facilities"]:
            reasons.append(f"{r['villages']} village(s) and {r['facilities']} facility(ies) within 2 km")
        if r["villages_access"]:
            reasons.append(f"{r['villages_access']} village(s) with access at risk")
        if r["blocked"]:
            reasons.append(f"{r['blocked']} blocked road segment(s) nearby")
        items.append({"risk_zone_id": str(r["id"]), "priority_score": score, "reasons": reasons, "provenance": "MODEL_OUTPUT"})
    items.sort(key=lambda i: i["priority_score"], reverse=True)
    for rank, item in enumerate(items[:limit], start=1):
        item["rank"] = rank
        item["priority_level"] = "P1" if item["priority_score"] >= 0.7 else "P2" if item["priority_score"] >= 0.45 else "P3"
    return items[:limit]
