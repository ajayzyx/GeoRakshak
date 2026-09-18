import {
  buildLocalReport,
  effectiveAccuracy,
  emptyDraft,
  toCreateReportPayload,
  validateDraft,
} from '../reportDraft';
import { toIsoWithOffset } from '../time';
import { FakeClock, USER_ID, photo, sampleDraft } from './helpers';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const buildDeps = { clock: new FakeClock(), newId: () => crypto.randomUUID(), language: 'en', ownerUserId: USER_ID };
const fields = (d: Parameters<typeof validateDraft>[0]) => validateDraft(d).map((i) => i.field);

describe('report draft validation', () => {
  test('an empty draft reports one issue per field, with a message for each', () => {
    const issues = validateDraft(emptyDraft());
    expect(issues.map((i) => i.field)).toEqual(['category', 'severity', 'description', 'location', 'accuracy']);
    expect(issues.every((i) => i.message.length > 10)).toBe(true);
    expect(issues[3]?.message).toContain('Adjust pin manually');
  });

  test('rejects out-of-range coordinates, empty description and missing accuracy', () => {
    expect(fields(sampleDraft({ lat: 95 }))).toEqual(['location']);
    expect(fields(sampleDraft({ description: '   ' }))).toEqual(['description']);
    expect(fields(sampleDraft({ description: 'x'.repeat(2001) }))).toEqual(['description']);
    expect(fields(sampleDraft({ gps_accuracy_m: 0 }))).toEqual(['accuracy']);
    expect(fields(sampleDraft({ gps_accuracy_m: null }))).toEqual(['accuracy']);
    expect(fields(sampleDraft({ media: [photo(), photo(), photo(), photo(), photo(), photo()] }))).toEqual(['media']);
    expect(fields(sampleDraft())).toEqual([]);
  });

  test('a manual pin needs latitude, longitude and an uncertainty estimate (the server requires gps_accuracy_m > 0)', () => {
    const manual = sampleDraft({ location_adjusted_manually: true, manual_uncertainty_m: null });
    expect(fields(manual)).toEqual(['accuracy']);
    expect(validateDraft(manual)[0]?.message).toContain('metres');
    expect(fields({ ...manual, lat: null })).toEqual(['location', 'accuracy']);
    expect(fields({ ...manual, manual_uncertainty_m: 25 })).toEqual([]);
    expect(effectiveAccuracy({ ...manual, manual_uncertainty_m: 25 })).toBe(25);
    expect(effectiveAccuracy(sampleDraft())).toBe(8);
  });
});

describe('building local rows', () => {
  test('builds a QUEUED report with UUID v4 ids, PENDING media and device capture time', () => {
    const clock = new FakeClock();
    const { report, media } = buildLocalReport(sampleDraft({ media: [photo()], alert_id: 'al55' }), {
      ...buildDeps,
      clock,
      language: 'hi',
    });
    expect(report.client_report_id).toMatch(UUID_V4);
    expect(report).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      server_id: null,
      language: 'hi',
      alert_id: 'al55',
      owner_user_id: USER_ID,
      gps_accuracy_m: 8,
    });
    expect(report.captured_at).toBe(toIsoWithOffset(clock.now()));
    expect(Date.parse(report.captured_at)).toBe(clock.now().getTime());
    expect(media[0]?.client_media_id).toMatch(UUID_V4);
    expect(media[0]).toMatchObject({ upload_status: 'PENDING', client_report_id: report.client_report_id });
  });

  test('a manually adjusted pin is disclosed, sends the estimate, and is not copied into media geotags', () => {
    const { report, media } = buildLocalReport(
      sampleDraft({ media: [photo()], location_adjusted_manually: true, manual_uncertainty_m: 40 }),
      buildDeps,
    );
    const payload = toCreateReportPayload(report, media.length, { app_version: '0.1.0', platform: 'android' });
    expect(payload).toMatchObject({ location_adjusted_manually: true, gps_accuracy_m: 40, media_expected: 1 });
    expect(payload).not.toHaveProperty('alert_id');
    expect(media[0]).toMatchObject({ lat: null, lon: null });
  });

  test('refuses to build an invalid draft', () => {
    expect(() => buildLocalReport(emptyDraft(), buildDeps)).toThrow(/Choose what you observed/);
  });

  test('toIsoWithOffset keeps the same instant', () => {
    const d = new Date('2026-07-14T06:41:30Z');
    expect(Date.parse(toIsoWithOffset(d))).toBe(d.getTime());
    expect(toIsoWithOffset(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});
