-- Alert lifecycle (CLAUDE.md §4a):
-- * UPDATE / all-clear is public and human-approved, like WARNING: enforce approval in the database too.
-- * UPDATE goes to the previous recipients of the alert it updates.
-- * Internal WATCH alerts can be closed automatically when risk subsides; the reason is recorded.

ALTER TABLE alerts
    ADD CONSTRAINT alerts_public_dispatch_requires_approval
        CHECK (NOT (tier IN ('WARNING', 'UPDATE') AND status = 'DISPATCHED' AND approved_by IS NULL)),
    ADD COLUMN related_alert_id uuid REFERENCES alerts(id) ON DELETE CASCADE,
    ADD CONSTRAINT alerts_update_has_related CHECK (tier <> 'UPDATE' OR related_alert_id IS NOT NULL),
    ADD COLUMN closed_reason text,
    -- Automatic closure is only allowed for internal WATCH alerts; public alerts close by authority action.
    ADD CONSTRAINT alerts_auto_close_watch_only CHECK (closed_reason IS NULL OR closed_reason NOT LIKE 'AUTO:%' OR tier = 'WATCH');

CREATE INDEX alerts_open_idx ON alerts (run_mode, tier, status);
