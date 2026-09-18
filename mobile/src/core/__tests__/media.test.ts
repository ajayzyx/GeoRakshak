import { checkCapturedAsset, checkSize } from '../media';

describe('media limits (api.md §5.7)', () => {
  test('video longer than 30 s is rejected', () => {
    const r = checkCapturedAsset({ kind: 'VIDEO', uri: 'file:///v.mp4', mimeType: 'video/mp4', durationMs: 30_400 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/30\.4 s.*limit is 30 s/);
  });

  test('video of exactly 30 s is accepted and duration is converted to seconds', () => {
    const r = checkCapturedAsset({ kind: 'VIDEO', uri: 'file:///v.mp4', mimeType: 'video/mp4', durationMs: 30_000 });
    expect(r).toEqual({ ok: true, mime_type: 'video/mp4', duration_s: 30 });
  });

  test('video with unknown duration is rejected rather than assumed short', () => {
    expect(checkCapturedAsset({ kind: 'VIDEO', uri: 'file:///v.mp4', mimeType: 'video/mp4' }).ok).toBe(false);
  });

  test('video over 25 MB is rejected; non-MP4 video is rejected', () => {
    expect(
      checkCapturedAsset({ kind: 'VIDEO', uri: 'file:///v.mp4', durationMs: 10_000, fileSize: 25_000_001 }).ok,
    ).toBe(false);
    expect(checkCapturedAsset({ kind: 'VIDEO', uri: 'file:///v.mov', mimeType: 'video/quicktime', durationMs: 5_000 }).ok).toBe(false);
  });

  test('photo: JPEG/PNG only, ≤10 MB, MIME inferred from extension when missing', () => {
    expect(checkCapturedAsset({ kind: 'PHOTO', uri: 'file:///p.JPG', fileSize: 3_000_000 })).toEqual({
      ok: true,
      mime_type: 'image/jpeg',
      duration_s: null,
    });
    expect(checkCapturedAsset({ kind: 'PHOTO', uri: 'file:///p.heic', mimeType: 'image/heic' }).ok).toBe(false);
    expect(checkSize('PHOTO', 10_000_001).ok).toBe(false);
    expect(checkSize('PHOTO', 10_000_000).ok).toBe(true);
    expect(checkSize('VIDEO', 0).ok).toBe(false);
  });
});
