// Report form logic (the state machine the screen renders) and the category
// vocabulary. No rendering: the screen only maps this state onto components.

import { GpsFix } from '../capture';
import { CATEGORY_HINTS, CATEGORY_LABELS } from '../categories';
import { MAX_MEDIA_PER_REPORT } from '../media';
import { toCreateReportPayload, buildLocalReport, validateDraft } from '../reportDraft';
import {
  ReportFormAction,
  ReportFormState,
  formIssues,
  hasContent,
  initialFormState,
  issuesFor,
  mediaCounts,
  parseNumber,
  reportFormReducer,
} from '../reportForm';
import { REPORT_CATEGORIES } from '../types';
import { FakeClock, USER_ID, photo, video } from './helpers';

const run = (actions: ReportFormAction[], start: ReportFormState = initialFormState()): ReportFormState =>
  actions.reduce(reportFormReducer, start);

const goodFix: GpsFix = { ok: true, lat: 23.731234567, lon: 92.721234567, accuracy_m: 7.4, timestamp: 111 };
const weakFix: GpsFix = { ok: true, lat: 23.74, lon: 92.73, accuracy_m: 180, timestamp: 222 };
const deniedFix: GpsFix = { ok: false, reason: 'PERMISSION', error: 'Location permission is denied. …' };

const complete: ReportFormAction[] = [
  { type: 'setCategory', category: 'LANDSLIDE' },
  { type: 'setSeverity', severity: 'HIGH' },
  { type: 'setDescription', text: 'Simulated test observation.' },
  { type: 'gpsResult', fix: goodFix },
];

describe('report form state machine', () => {
  test('starts empty, locating, with no validation messages shown', () => {
    const s = initialFormState('al55');
    expect(s).toMatchObject({ gps: { kind: 'locating' }, showIssues: false, busy: 'idle' });
    expect(s.draft.alert_id).toBe('al55');
    expect(formIssues(s)).toHaveLength(5);
    expect(hasContent(s)).toBe(false);
  });

  test('a GPS fix fills the position, its accuracy and the text fields', () => {
    const s = run([{ type: 'gpsResult', fix: goodFix }]);
    expect(s.gps).toEqual({ kind: 'fix', accuracy_m: 7.4, timestamp: 111 });
    expect(s.draft).toMatchObject({ lat: 23.731234567, lon: 92.721234567, gps_accuracy_m: 7.4 });
    expect([s.latText, s.lonText]).toEqual(['23.731235', '92.721235']);
  });

  test('a failed fix is kept for display and leaves the position empty', () => {
    const s = run([{ type: 'gpsResult', fix: deniedFix }]);
    expect(s.gps).toEqual({ kind: 'failed', reason: 'PERMISSION', error: deniedFix.ok ? '' : deniedFix.error });
    expect(issuesFor(formIssues(s), 'location')[0]).toContain('Adjust pin manually');
  });

  test('switching to a manual pin seeds the fields from the fix and rounds the uncertainty up', () => {
    const s = run([{ type: 'gpsResult', fix: weakFix }, { type: 'setManual', on: true }]);
    expect(s.draft).toMatchObject({ location_adjusted_manually: true, manual_uncertainty_m: 180 });
    expect(s.uncertaintyText).toBe('180');
    expect(formIssues(s)).toHaveLength(3); // category, severity, description only
  });

  test('a fix that arrives after the user placed a pin does not move it', () => {
    const s = run([
      { type: 'setManual', on: true },
      { type: 'setLatText', text: '23.700000' },
      { type: 'setLonText', text: '92,700000' },
      { type: 'setUncertaintyText', text: '50' },
      { type: 'gpsResult', fix: goodFix },
    ]);
    expect(s.draft).toMatchObject({ lat: 23.7, lon: 92.7, manual_uncertainty_m: 50, location_adjusted_manually: true });
    expect(s.gps).toMatchObject({ kind: 'fix' });
    expect(s.latText).toBe('23.700000');
  });

  test('switching the manual pin off clears it and goes back to locating', () => {
    const s = run([
      { type: 'gpsResult', fix: goodFix },
      { type: 'setManual', on: true },
      { type: 'setManual', on: false },
    ]);
    expect(s.draft).toMatchObject({
      location_adjusted_manually: false,
      lat: null,
      lon: null,
      gps_accuracy_m: null,
      manual_uncertainty_m: null,
    });
    expect(s).toMatchObject({ latText: '', lonText: '', uncertaintyText: '', gps: { kind: 'locating' } });
  });

  test('unparseable coordinates and uncertainty become issues, not silent zeros', () => {
    const s = run([
      ...complete,
      { type: 'setManual', on: true },
      { type: 'setLatText', text: 'abc' },
      { type: 'setUncertaintyText', text: '' },
    ]);
    expect(s.draft.lat).toBeNull();
    expect(formIssues(s).map((i) => i.field)).toEqual(['location', 'accuracy']);
    expect(parseNumber('23,7')).toBe(23.7);
    expect(parseNumber(' ')).toBeNull();
    expect(parseNumber('x')).toBeNull();
  });

  test('media are added up to the limit, then refused with a message; removing clears the error', () => {
    let s = run(complete);
    for (let i = 0; i < MAX_MEDIA_PER_REPORT; i++) {
      s = reportFormReducer(s, { type: 'mediaAdded', media: i === 0 ? video() : photo() });
    }
    expect(mediaCounts(s)).toEqual({ photos: 4, videos: 1, atLimit: true });
    const last = s.draft.media[4]!;

    s = reportFormReducer(s, { type: 'mediaAdded', media: photo() });
    expect(s.draft.media).toHaveLength(MAX_MEDIA_PER_REPORT);
    expect(s.mediaError).toBe('At most 5 photos/videos per report.');

    s = reportFormReducer(s, { type: 'mediaRemoved', uri: last.local_uri });
    expect(s.mediaError).toBeNull();
    expect(mediaCounts(s)).toEqual({ photos: 3, videos: 1, atLimit: false });
    expect(formIssues(s)).toHaveLength(0);
  });

  test('a capture error is surfaced and does not block saving the report without media', () => {
    const s = run([...complete, { type: 'mediaError', error: 'Video is 30.4 s. The limit is 30 s.' }]);
    expect(s.mediaError).toContain('30.4 s');
    expect(formIssues(s)).toHaveLength(0);
  });

  test('validation messages appear only after a save attempt, and busy/save errors are tracked', () => {
    let s = initialFormState();
    expect(s.showIssues).toBe(false);
    s = reportFormReducer(s, { type: 'attemptSave' });
    expect(s.showIssues).toBe(true);
    s = reportFormReducer(s, { type: 'busy', busy: 'saving' });
    s = reportFormReducer(s, { type: 'saveError', error: 'disk full' });
    expect(s).toMatchObject({ busy: 'idle', saveError: 'disk full' });
    // Editing clears the previous save error but keeps the messages visible.
    s = reportFormReducer(s, { type: 'setSeverity', severity: 'LOW' });
    expect(s).toMatchObject({ saveError: null, showIssues: true });
  });

  test('a completed form validates and builds the payload the backend expects', () => {
    const s = run([...complete, { type: 'mediaAdded', media: photo() }]);
    expect(validateDraft(s.draft)).toEqual([]);
    expect(hasContent(s)).toBe(true);
    const { report, media } = buildLocalReport(s.draft, {
      clock: new FakeClock(),
      newId: () => crypto.randomUUID(),
      language: 'en',
      ownerUserId: USER_ID,
    });
    const payload = toCreateReportPayload(report, media.length, { app_version: '0.1.0', platform: 'ios' });
    expect(payload).toMatchObject({
      category: 'LANDSLIDE',
      severity: 'HIGH',
      gps_accuracy_m: 7.4,
      location_adjusted_manually: false,
      media_expected: 1,
      device_info: { platform: 'ios' },
    });
  });
});

describe('category vocabulary', () => {
  test('labels and hints cover exactly the frozen enum, and add no new values', () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...REPORT_CATEGORIES].sort());
    expect(Object.keys(CATEGORY_HINTS).sort()).toEqual([...REPORT_CATEGORIES].sort());
    expect(REPORT_CATEGORIES).toEqual([
      'LANDSLIDE',
      'CRACK',
      'SEEPAGE',
      'ROCKFALL',
      'ROAD_BLOCKED',
      'SUBSIDENCE',
      'OTHER',
    ]);
  });

  test('"slope movement" is field wording for LANDSLIDE, not a category of its own', () => {
    expect(CATEGORY_LABELS.LANDSLIDE).toContain('slope movement');
    expect(CATEGORY_HINTS.LANDSLIDE).toContain('reported as LANDSLIDE');
    const slopeWording = Object.entries(CATEGORY_LABELS).filter(([, l]) => /slope movement/i.test(l));
    expect(slopeWording.map(([value]) => value)).toEqual(['LANDSLIDE']);
    // The wire value stays the enum, never the label.
    const s = run([
      { type: 'setCategory', category: 'LANDSLIDE' },
      { type: 'setSeverity', severity: 'LOW' },
      { type: 'setDescription', text: 'Slope movement seen above the road (simulated).' },
      { type: 'gpsResult', fix: goodFix },
    ]);
    const { report } = buildLocalReport(s.draft, {
      clock: new FakeClock(),
      newId: () => crypto.randomUUID(),
      language: 'en',
      ownerUserId: USER_ID,
    });
    expect(report.category).toBe('LANDSLIDE');
  });
});
