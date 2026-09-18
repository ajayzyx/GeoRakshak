import { MediaType } from './types';

// Frozen limits, docs/api.md §5.7. "MB" is read as 10^6 bytes, the stricter
// reading (the backend currently checks MiB), so a file accepted here is never
// rejected by the server for size.
export const PHOTO_MAX_BYTES = 10_000_000;
export const VIDEO_MAX_BYTES = 25_000_000;
export const VIDEO_MAX_DURATION_S = 30;
/**
 * Camera recording cap. One second below the limit: Android can report a clip
 * stopped at exactly 30 s as 30.0x s, which the server (and checkCapturedAsset)
 * would reject after the user has already recorded it.
 */
export const VIDEO_CAPTURE_MAX_S = 29;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const VIDEO_MIME_TYPES = ['video/mp4'] as const;
export const MAX_MEDIA_PER_REPORT = 5;

export interface CapturedAsset {
  kind: MediaType;
  uri: string;
  mimeType?: string | null;
  /** Bytes. May be unknown straight from the picker; check again after copying. */
  fileSize?: number | null;
  /** expo-image-picker reports video duration in milliseconds. */
  durationMs?: number | null;
}

export type MediaCheck =
  | { ok: true; mime_type: string; duration_s: number | null }
  | { ok: false; error: string };

function inferMime(uri: string, kind: MediaType): string | null {
  const ext = uri.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (kind === 'PHOTO') {
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
  } else if (ext === 'mp4') {
    return 'video/mp4';
  }
  return null;
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * Checks type and duration before the file is copied, so an over-long video is
 * rejected immediately. Size is checked by `checkSize` once the size is known.
 */
export function checkCapturedAsset(asset: CapturedAsset): MediaCheck {
  const mime = (asset.mimeType ?? '').toLowerCase() || inferMime(asset.uri, asset.kind);
  if (asset.kind === 'PHOTO') {
    if (!mime || !(PHOTO_MIME_TYPES as readonly string[]).includes(mime)) {
      return { ok: false, error: `Photo must be JPEG or PNG (got ${mime ?? 'unknown type'}).` };
    }
    return withSize({ ok: true, mime_type: mime, duration_s: null }, asset);
  }

  if (!mime || !(VIDEO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, error: `Video must be MP4 (got ${mime ?? 'unknown type'}).` };
  }
  if (asset.durationMs === null || asset.durationMs === undefined || !Number.isFinite(asset.durationMs)) {
    return { ok: false, error: 'Could not read the video length. Record the video again.' };
  }
  const durationS = asset.durationMs / 1000;
  if (durationS > VIDEO_MAX_DURATION_S) {
    return {
      ok: false,
      error: `Video is ${durationS.toFixed(1)} s. The limit is ${VIDEO_MAX_DURATION_S} s. Record a shorter clip.`,
    };
  }
  return withSize({ ok: true, mime_type: mime, duration_s: durationS }, asset);
}

function withSize(check: MediaCheck, asset: CapturedAsset): MediaCheck {
  if (!check.ok || asset.fileSize === null || asset.fileSize === undefined) return check;
  const size = checkSize(asset.kind, asset.fileSize);
  return size.ok ? check : size;
}

export function checkSize(kind: MediaType, sizeBytes: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: 'The file is empty or unreadable.' };
  }
  const limit = kind === 'PHOTO' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
  if (sizeBytes > limit) {
    const what = kind === 'PHOTO' ? 'Photo' : 'Video';
    const hint = kind === 'VIDEO' ? ' Record a shorter clip.' : '';
    return { ok: false, error: `${what} is ${mb(sizeBytes)}. The limit is ${mb(limit)}.${hint}` };
  }
  return { ok: true };
}
