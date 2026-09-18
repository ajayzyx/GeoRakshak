-- Index every column that references another table. Postgres does not index them automatically, and without an
-- index each parent-row delete rescans the child table: reloading a pilot over an existing dataset stalled for
-- minutes on risk_assessments.risk_zone_id. These also serve the inbox and report lookups.
CREATE INDEX IF NOT EXISTS risk_assessments_zone_idx ON risk_assessments (risk_zone_id);
CREATE INDEX IF NOT EXISTS risk_assessments_model_idx ON risk_assessments (model_version_id);
CREATE INDEX IF NOT EXISTS risk_assessments_forecast_source_idx ON risk_assessments (forecast_source_id);
CREATE INDEX IF NOT EXISTS evidence_report_idx ON evidence (report_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_alert_idx ON notification_deliveries (alert_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_recipient_idx ON notification_deliveries (recipient_id);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS reports_road_segment_idx ON reports (road_segment_id);
CREATE INDEX IF NOT EXISTS reports_alert_idx ON reports (alert_id);
CREATE INDEX IF NOT EXISTS alerts_admin_boundary_idx ON alerts (admin_boundary_id);
CREATE INDEX IF NOT EXISTS locations_admin_boundary_idx ON locations (admin_boundary_id);
CREATE INDEX IF NOT EXISTS locations_source_idx ON locations (source_id);
CREATE INDEX IF NOT EXISTS risk_zones_admin_boundary_idx ON risk_zones (admin_boundary_id);
CREATE INDEX IF NOT EXISTS road_segments_source_idx ON road_segments (source_id);
CREATE INDEX IF NOT EXISTS historical_landslides_source_idx ON historical_landslides (source_id);
CREATE INDEX IF NOT EXISTS rainfall_observations_source_idx ON rainfall_observations (source_id);
CREATE INDEX IF NOT EXISTS rainfall_forecasts_source_idx ON rainfall_forecasts (source_id);
CREATE INDEX IF NOT EXISTS sensor_stations_source_idx ON sensor_stations (source_id);
