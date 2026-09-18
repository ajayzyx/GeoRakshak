-- Indexes for the columns that reference risk_assessments and reports.
-- Without them, deleting the replay's assessments (hundreds of thousands of rows) rescans the referencing
-- tables per row: a demo reset took ~280 s at replay step 29 instead of well under a second.
CREATE INDEX IF NOT EXISTS risk_zones_current_assessment_idx ON risk_zones (current_assessment_id);
CREATE INDEX IF NOT EXISTS alerts_triggering_assessment_idx ON alerts (triggering_assessment_id);
CREATE INDEX IF NOT EXISTS road_segments_status_report_idx ON road_segments (status_report_id);
CREATE INDEX IF NOT EXISTS reports_risk_zone_idx ON reports (risk_zone_id);
CREATE INDEX IF NOT EXISTS rainfall_forecasts_issue_idx ON rainfall_forecasts (issue_time);
