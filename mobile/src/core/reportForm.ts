// Pure state machine behind the report form screen. Keeping it here means the
// screen is a thin rendering layer and every rule (GPS race with the manual pin,
// media limits, validation gating) is unit-tested without rendering anything.

import { GpsFailureReason, GpsFix } from './capture';
import { MAX_MEDIA_PER_REPORT } from './media';
import { DraftIssue, DraftMedia, ReportDraft, emptyDraft, validateDraft } from './reportDraft';
import { ReportCategory, ReportSeverity } from './types';

export type GpsState =
  | { kind: 'locating' }
  | { kind: 'fix'; accuracy_m: number | null; timestamp: number }
  | { kind: 'failed'; reason: GpsFailureReason; error: string };

export type FormBusy = 'idle' | 'capturing' | 'saving';

export interface ReportFormState {
  draft: ReportDraft;
  latText: string;
  lonText: string;
  uncertaintyText: string;
  gps: GpsState;
  /** Validation messages are shown only after the first save attempt. */
  showIssues: boolean;
  mediaError: string | null;
  saveError: string | null;
  busy: FormBusy;
}

export type ReportFormAction =
  | { type: 'setCategory'; category: ReportCategory }
  | { type: 'setSeverity'; severity: ReportSeverity }
  | { type: 'setDescription'; text: string }
  | { type: 'locating' }
  | { type: 'gpsResult'; fix: GpsFix }
  | { type: 'setManual'; on: boolean }
  | { type: 'setLatText'; text: string }
  | { type: 'setLonText'; text: string }
  | { type: 'setUncertaintyText'; text: string }
  | { type: 'mediaAdded'; media: DraftMedia }
  | { type: 'mediaRemoved'; uri: string }
  | { type: 'mediaError'; error: string | null }
  | { type: 'busy'; busy: FormBusy }
  | { type: 'attemptSave' }
  | { type: 'saveError'; error: string };

export function initialFormState(alertId: string | null = null): ReportFormState {
  return {
    draft: emptyDraft(alertId),
    latText: '',
    lonText: '',
    uncertaintyText: '',
    gps: { kind: 'locating' },
    showIssues: false,
    mediaError: null,
    saveError: null,
    busy: 'idle',
  };
}

/** Accepts "23.7" and "23,7" (comma-decimal keyboards). Empty or invalid input gives null. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function reportFormReducer(state: ReportFormState, action: ReportFormAction): ReportFormState {
  const patchDraft = (patch: Partial<ReportDraft>): ReportFormState => ({
    ...state,
    draft: { ...state.draft, ...patch },
    saveError: null,
  });

  switch (action.type) {
    case 'setCategory':
      return patchDraft({ category: action.category });
    case 'setSeverity':
      return patchDraft({ severity: action.severity });
    case 'setDescription':
      return patchDraft({ description: action.text });

    case 'locating':
      return { ...state, gps: { kind: 'locating' } };

    case 'gpsResult': {
      if (!action.fix.ok) {
        return { ...state, gps: { kind: 'failed', reason: action.fix.reason, error: action.fix.error } };
      }
      const gps: GpsState = { kind: 'fix', accuracy_m: action.fix.accuracy_m, timestamp: action.fix.timestamp };
      // A pin the user placed by hand while the fix was pending is never overwritten.
      if (state.draft.location_adjusted_manually) return { ...state, gps };
      return {
        ...state,
        gps,
        latText: action.fix.lat.toFixed(6),
        lonText: action.fix.lon.toFixed(6),
        draft: { ...state.draft, lat: action.fix.lat, lon: action.fix.lon, gps_accuracy_m: action.fix.accuracy_m },
      };
    }

    case 'setManual': {
      if (!action.on) {
        return {
          ...state,
          latText: '',
          lonText: '',
          uncertaintyText: '',
          gps: { kind: 'locating' },
          draft: {
            ...state.draft,
            location_adjusted_manually: false,
            lat: null,
            lon: null,
            gps_accuracy_m: null,
            manual_uncertainty_m: null,
          },
        };
      }
      // Start from the GPS position and its accuracy when there is one.
      const seeded = state.draft.gps_accuracy_m !== null ? Math.ceil(state.draft.gps_accuracy_m) : null;
      return {
        ...state,
        latText: state.draft.lat !== null ? state.draft.lat.toFixed(6) : state.latText,
        lonText: state.draft.lon !== null ? state.draft.lon.toFixed(6) : state.lonText,
        uncertaintyText: seeded !== null ? String(seeded) : state.uncertaintyText,
        draft: {
          ...state.draft,
          location_adjusted_manually: true,
          manual_uncertainty_m: seeded ?? parseNumber(state.uncertaintyText),
        },
      };
    }

    case 'setLatText':
      return { ...patchDraft({ lat: parseNumber(action.text) }), latText: action.text };
    case 'setLonText':
      return { ...patchDraft({ lon: parseNumber(action.text) }), lonText: action.text };
    case 'setUncertaintyText':
      return { ...patchDraft({ manual_uncertainty_m: parseNumber(action.text) }), uncertaintyText: action.text };

    case 'mediaAdded': {
      if (state.draft.media.length >= MAX_MEDIA_PER_REPORT) {
        return { ...state, mediaError: `At most ${MAX_MEDIA_PER_REPORT} photos/videos per report.` };
      }
      return { ...state, mediaError: null, draft: { ...state.draft, media: [...state.draft.media, action.media] } };
    }
    case 'mediaRemoved':
      return {
        ...state,
        mediaError: null,
        draft: { ...state.draft, media: state.draft.media.filter((m) => m.local_uri !== action.uri) },
      };
    case 'mediaError':
      return { ...state, mediaError: action.error };

    case 'busy':
      return { ...state, busy: action.busy };
    case 'attemptSave':
      return { ...state, showIssues: true, saveError: null };
    case 'saveError':
      return { ...state, saveError: action.error, busy: 'idle' };
  }
}

export function formIssues(state: ReportFormState): DraftIssue[] {
  return validateDraft(state.draft);
}

export function issuesFor(issues: DraftIssue[], field: DraftIssue['field']): string[] {
  return issues.filter((i) => i.field === field).map((i) => i.message);
}

/** True when the draft has anything worth a "discard this draft?" confirmation. */
export function hasContent(state: ReportFormState): boolean {
  return state.draft.category !== null || state.draft.description.trim() !== '' || state.draft.media.length > 0;
}

export function mediaCounts(state: ReportFormState): { photos: number; videos: number; atLimit: boolean } {
  const photos = state.draft.media.filter((m) => m.media_type === 'PHOTO').length;
  return {
    photos,
    videos: state.draft.media.length - photos,
    atLimit: state.draft.media.length >= MAX_MEDIA_PER_REPORT,
  };
}
