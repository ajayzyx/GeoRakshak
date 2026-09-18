-- SMS cost and compliance input for H14: record the encoding and segment count of every rendered message.
-- A Hindi warning is UCS-2 (70 characters per segment), so it costs several times an English one.
ALTER TABLE notification_deliveries
    ADD COLUMN sms_encoding text CHECK (sms_encoding IN ('GSM7', 'UCS2')),
    ADD COLUMN sms_segments smallint CHECK (sms_segments IS NULL OR sms_segments > 0),
    ADD CONSTRAINT deliveries_sms_fields_only_for_sms
        CHECK (channel = 'SMS' OR (sms_encoding IS NULL AND sms_segments IS NULL));
