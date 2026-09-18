// Camera, file-storage and GPS logic behind small ports, so every branch
// (permission denied, no fix, oversized file, copy failure, …) is unit-testable
// without a device. The Expo bindings live in src/shell/adapters/deviceCapture.ts.

import { CapturedAsset, checkCapturedAsset, checkSize, VIDEO_CAPTURE_MAX_S } from './media';
import { DraftMedia } from './reportDraft';
import { toIsoWithOffset } from './time';
import { Clock, MediaType } from './types';

export interface CameraPort {
  /** Camera (and, on iOS, microphone for video) permission. */
  requestPermission(kind: MediaType): Promise<{ granted: boolean }>;
  launch(opts: { kind: MediaType; maxDurationS: number }): Promise<CameraResult>;
}

export type CameraResult = { canceled: true } | { canceled: false; asset: CapturedAsset };

export interface MediaFilePort {
  /** Copies the camera's temporary file into app storage. Rejects if it cannot. */
  copyIntoAppStorage(sourceUri: string, filename: string): Promise<{ uri: string; size: number }>;
  delete(uri: string): void;
  exists(uri: string): Promise<boolean>;
}

export interface LocationPort {
  requestPermission(): Promise<{ granted: boolean }>;
  getCurrentPosition(): Promise<{ lat: number; lon: number; accuracy_m: number | null; timestamp: number }>;
}

export interface CaptureDeps {
  camera: CameraPort;
  files: MediaFilePort;
  clock: Clock;
  newId: () => string;
}

export type CaptureOutcome =
  | { ok: true; media: DraftMedia }
  | { ok: false; error: string }
  | { cancelled: true };

const extensionFor = (mime: string) => (mime === 'video/mp4' ? 'mp4' : mime === 'image/png' ? 'png' : 'jpg');

/**
 * Captures one photo or video and returns a queue-ready DraftMedia. Every
 * rejection carries a message for the reporter; nothing is dropped silently.
 */
export async function captureMedia(kind: MediaType, deps: CaptureDeps): Promise<CaptureOutcome> {
  const permission = await deps.camera.requestPermission(kind).catch(() => ({ granted: false }));
  if (!permission.granted) {
    return {
      ok: false,
      error:
        kind === 'PHOTO'
          ? 'Camera permission is needed to attach a photo. Allow it in the system settings, or save the report without media.'
          : 'Camera permission is needed to record a video. Allow it in the system settings, or save the report without media.',
    };
  }

  let result: CameraResult;
  try {
    result = await deps.camera.launch({ kind, maxDurationS: VIDEO_CAPTURE_MAX_S });
  } catch (e) {
    return { ok: false, error: `The camera could not be opened: ${message(e)}` };
  }
  if (result.canceled) return { cancelled: true };

  // Type, duration and (when the picker reports it) size, before anything is copied.
  const check = checkCapturedAsset(result.asset);
  if (!check.ok) return check;

  const filename = `${deps.newId()}.${extensionFor(check.mime_type)}`;
  let copied: { uri: string; size: number };
  try {
    copied = await deps.files.copyIntoAppStorage(result.asset.uri, filename);
  } catch (e) {
    return { ok: false, error: `Could not save the file on this device: ${message(e)}` };
  }

  // The real size is only known after the copy (the picker often omits it).
  const size = checkSize(kind, copied.size);
  if (!size.ok) {
    deps.files.delete(copied.uri);
    return size;
  }

  return {
    ok: true,
    media: {
      media_type: kind,
      local_uri: copied.uri,
      mime_type: check.mime_type,
      size_bytes: copied.size,
      duration_s: check.duration_s,
      captured_at: toIsoWithOffset(deps.clock.now()),
    },
  };
}

export type GpsFailureReason = 'PERMISSION' | 'TIMEOUT' | 'UNAVAILABLE';

export type GpsFix =
  | { ok: true; lat: number; lon: number; accuracy_m: number | null; timestamp: number }
  | { ok: false; reason: GpsFailureReason; error: string };

export interface GpsDeps {
  location: LocationPort;
  clock: Clock;
  /** A cold GPS start under tree cover can hang; the user gets the manual pin instead. */
  timeoutMs?: number;
  /** Injectable so tests do not wait. */
  delay?: (ms: number) => Promise<void>;
}

export const GPS_TIMEOUT_MS = 20_000;

export async function getGpsFix(deps: GpsDeps): Promise<GpsFix> {
  const permission = await deps.location.requestPermission().catch(() => ({ granted: false }));
  if (!permission.granted) {
    return {
      ok: false,
      reason: 'PERMISSION',
      error: 'Location permission is denied. Allow it in the system settings, or switch on "Adjust pin manually".',
    };
  }
  const timeoutMs = deps.timeoutMs ?? GPS_TIMEOUT_MS;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timedOut = Symbol('timeout');
  try {
    const fix = await Promise.race([
      deps.location.getCurrentPosition(),
      delay(timeoutMs).then(() => timedOut as never),
    ]);
    if ((fix as unknown) === timedOut) {
      return {
        ok: false,
        reason: 'TIMEOUT',
        error: `No GPS fix after ${Math.round(timeoutMs / 1000)} s. Move to open sky and try again, or switch on "Adjust pin manually".`,
      };
    }
    return { ok: true, ...fix };
  } catch (e) {
    return { ok: false, reason: 'UNAVAILABLE', error: `No GPS fix: ${message(e)}` };
  }
}

export type AccuracyQuality = 'unknown' | 'good' | 'fair' | 'poor';

// Thresholds are display-only and not a scientific claim: a consumer GNSS fix
// is typically within ~10 m under open sky, and tens of metres under cover.
export const ACCURACY_GOOD_M = 30;
export const ACCURACY_FAIR_M = 100;

export function accuracyQuality(accuracyM: number | null): AccuracyQuality {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0) return 'unknown';
  if (accuracyM <= ACCURACY_GOOD_M) return 'good';
  if (accuracyM <= ACCURACY_FAIR_M) return 'fair';
  return 'poor';
}

/** Warning to show next to a weak fix. null when the fix is good enough to submit quietly. */
export function accuracyAdvice(accuracyM: number | null): string | null {
  switch (accuracyQuality(accuracyM)) {
    case 'good':
      return null;
    case 'fair':
      return `GPS accuracy is ±${Math.round(accuracyM as number)} m. Wait a moment or refresh for a better fix.`;
    case 'poor':
      return `GPS accuracy is only ±${Math.round(accuracyM as number)} m. Refresh the fix, or adjust the pin manually and state your uncertainty.`;
    default:
      return 'The device did not report a GPS accuracy. Refresh the fix, or adjust the pin manually and state your uncertainty.';
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
