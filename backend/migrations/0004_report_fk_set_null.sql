-- A road segment's status can point at the verified report that blocked it. Deleting reports (a demo reset or a
-- pilot reload) must not be blocked by that reference: clear it instead.
ALTER TABLE road_segments DROP CONSTRAINT road_segments_status_report_id_fkey,
    ADD CONSTRAINT road_segments_status_report_id_fkey FOREIGN KEY (status_report_id) REFERENCES reports(id) ON DELETE SET NULL;
