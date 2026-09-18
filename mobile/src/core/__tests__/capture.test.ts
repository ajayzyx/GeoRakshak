// Device capabilities (camera, file storage, GPS) with the ports mocked: no
// device, no emulator. Every branch must produce a user-facing message.

import {
  ACCURACY_FAIR_M,
  ACCURACY_GOOD_M,
  CameraPort,
  CameraResult,
  LocationPort,
  MediaFilePort,
  accuracyAdvice,
  accuracyQuality,
  captureMedia,
  getGpsFix,
} from '../capture';
import { VIDEO_CAPTURE_MAX_S } from '../media';
import { FakeClock } from './helpers';

function cameraFake(result: CameraResult | Error, granted = true) {
  const launched: { kind: string; maxDurationS: number }[] = [];
  const camera: CameraPort = {
    requestPermission: async () => ({ granted }),
    launch: async (opts) => {
      launched.push(opts);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { camera, launched };
}

function filesFake(opts: { size?: number; copyError?: Error } = {}) {
  const deleted: string[] = [];
  const copied: { source: string; filename: string }[] = [];
  const files: MediaFilePort = {
    copyIntoAppStorage: async (source, filename) => {
      copied.push({ source, filename });
      if (opts.copyError) throw opts.copyError;
      return { uri: `file:///data/app/report-media/${filename}`, size: opts.size ?? 2_000_000 };
    },
    delete: (uri) => deleted.push(uri),
    exists: async () => true,
  };
  return { files, deleted, copied };
}

const photoAsset = (over: Partial<{ mimeType: string | null; fileSize: number | null }> = {}): CameraResult => ({
  canceled: false,
  asset: { kind: 'PHOTO', uri: 'file:///tmp/camera/IMG_1.jpg', mimeType: 'image/jpeg', ...over },
});

const videoAsset = (durationMs: number | null | undefined, over: Partial<{ mimeType: string | null }> = {}): CameraResult => ({
  canceled: false,
  asset: { kind: 'VIDEO', uri: 'file:///tmp/camera/VID_1.mp4', mimeType: 'video/mp4', durationMs, ...over },
});

const deps = (camera: CameraPort, files: MediaFilePort) => ({
  camera,
  files,
  clock: new FakeClock(),
  newId: () => 'fixed-id',
});

describe('captureMedia with mocked camera and storage', () => {
  test('photo: copied into app storage, size taken from the copy, captured_at from the clock', async () => {
    const cam = cameraFake(photoAsset());
    const fs = filesFake({ size: 1_234_567 });
    const clock = new FakeClock(new Date('2026-07-14T06:41:30Z'));

    const res = await captureMedia('PHOTO', { ...deps(cam.camera, fs.files), clock });

    expect(res).toMatchObject({
      ok: true,
      media: {
        media_type: 'PHOTO',
        local_uri: 'file:///data/app/report-media/fixed-id.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1_234_567,
        duration_s: null,
      },
    });
    if (!('ok' in res) || !res.ok) throw new Error('unreachable');
    // Local time with the device's offset, same instant as the clock (api.md §5.6).
    expect(Date.parse(res.media.captured_at)).toBe(clock.now().getTime());
    expect(res.media.captured_at).toMatch(/^2026-07-1[45]T\d{2}:\d{2}:30[+-]\d{2}:\d{2}$/);
    expect(fs.copied).toEqual([{ source: 'file:///tmp/camera/IMG_1.jpg', filename: 'fixed-id.jpg' }]);
    expect(fs.deleted).toEqual([]);
  });

  test('video: recording is capped at 29 s and the duration is stored in seconds', async () => {
    const cam = cameraFake(videoAsset(12_500));
    const fs = filesFake({ size: 5_000_000 });

    const res = await captureMedia('VIDEO', deps(cam.camera, fs.files));

    expect(cam.launched).toEqual([{ kind: 'VIDEO', maxDurationS: VIDEO_CAPTURE_MAX_S }]);
    expect(VIDEO_CAPTURE_MAX_S).toBe(29);
    expect(res).toMatchObject({ ok: true, media: { duration_s: 12.5, mime_type: 'video/mp4', size_bytes: 5_000_000 } });
  });

  test('camera permission denied: explains what to do, for photo and for video', async () => {
    for (const kind of ['PHOTO', 'VIDEO'] as const) {
      const cam = cameraFake(photoAsset(), false);
      const fs = filesFake();
      const res = await captureMedia(kind, deps(cam.camera, fs.files));
      expect(res).toEqual({ ok: false, error: expect.stringContaining('Camera permission is needed') });
      if (!('ok' in res) || res.ok) throw new Error('unreachable');
      expect(res.error).toContain('system settings');
      expect(cam.launched).toEqual([]);
      expect(fs.copied).toEqual([]);
    }
  });

  test('a permission check that throws counts as denied, not as a crash', async () => {
    const fs = filesFake();
    const camera: CameraPort = {
      requestPermission: async () => {
        throw new Error('module not available');
      },
      launch: async () => photoAsset(),
    };
    expect(await captureMedia('PHOTO', deps(camera, fs.files))).toMatchObject({ ok: false });
  });

  test('cancelling the camera is not an error and leaves no file', async () => {
    const cam = cameraFake({ canceled: true });
    const fs = filesFake();
    expect(await captureMedia('PHOTO', deps(cam.camera, fs.files))).toEqual({ cancelled: true });
    expect(fs.copied).toEqual([]);
  });

  test('a camera that fails to open is reported with its reason', async () => {
    const cam = cameraFake(new Error('camera busy'));
    const fs = filesFake();
    const res = await captureMedia('VIDEO', deps(cam.camera, fs.files));
    expect(res).toEqual({ ok: false, error: 'The camera could not be opened: camera busy' });
  });

  test('unsupported MIME type is rejected before anything is copied', async () => {
    const cam = cameraFake(photoAsset({ mimeType: 'image/heic' }));
    const fs = filesFake();
    const res = await captureMedia('PHOTO', deps(cam.camera, fs.files));
    expect(res).toEqual({ ok: false, error: 'Photo must be JPEG or PNG (got image/heic).' });
    expect(fs.copied).toEqual([]);
  });

  test('video longer than 30 s is rejected before copying, with the measured length', async () => {
    const cam = cameraFake(videoAsset(30_400));
    const fs = filesFake();
    const res = await captureMedia('VIDEO', deps(cam.camera, fs.files));
    expect(res).toEqual({ ok: false, error: 'Video is 30.4 s. The limit is 30 s. Record a shorter clip.' });
    expect(fs.copied).toEqual([]);
  });

  test('video with unknown duration is rejected rather than assumed to be short', async () => {
    const cam = cameraFake(videoAsset(null));
    const fs = filesFake();
    expect(await captureMedia('VIDEO', deps(cam.camera, fs.files))).toEqual({
      ok: false,
      error: 'Could not read the video length. Record the video again.',
    });
    expect(fs.copied).toEqual([]);
  });

  test('oversized photo reported by the picker is rejected before copying', async () => {
    const cam = cameraFake(photoAsset({ fileSize: 12_000_000 }));
    const fs = filesFake();
    const res = await captureMedia('PHOTO', deps(cam.camera, fs.files));
    expect(res).toEqual({ ok: false, error: 'Photo is 12.0 MB. The limit is 10.0 MB.' });
    expect(fs.copied).toEqual([]);
  });

  test('oversized file discovered only after the copy is rejected and the copy is deleted', async () => {
    const cam = cameraFake(videoAsset(28_000));
    const fs = filesFake({ size: 26_000_000 });
    const res = await captureMedia('VIDEO', deps(cam.camera, fs.files));
    expect(res).toEqual({ ok: false, error: 'Video is 26.0 MB. The limit is 25.0 MB. Record a shorter clip.' });
    expect(fs.deleted).toEqual(['file:///data/app/report-media/fixed-id.mp4']);
  });

  test('an empty or unreadable copy is rejected', async () => {
    const cam = cameraFake(photoAsset());
    const fs = filesFake({ size: 0 });
    expect(await captureMedia('PHOTO', deps(cam.camera, fs.files))).toEqual({
      ok: false,
      error: 'The file is empty or unreadable.',
    });
    expect(fs.deleted).toHaveLength(1);
  });

  test('a file-copy failure is reported with its cause and nothing is queued', async () => {
    const cam = cameraFake(photoAsset());
    const fs = filesFake({ copyError: new Error('ENOSPC: no space left on device') });
    expect(await captureMedia('PHOTO', deps(cam.camera, fs.files))).toEqual({
      ok: false,
      error: 'Could not save the file on this device: ENOSPC: no space left on device',
    });
    expect(fs.deleted).toEqual([]);
  });
});

describe('getGpsFix with a mocked location provider', () => {
  const never = () => new Promise<never>(() => {});
  const location = (impl: Partial<LocationPort>): LocationPort => ({
    requestPermission: async () => ({ granted: true }),
    getCurrentPosition: never,
    ...impl,
  });

  test('a good fix passes accuracy through', async () => {
    const fix = await getGpsFix({
      location: location({
        getCurrentPosition: async () => ({ lat: 23.73, lon: 92.72, accuracy_m: 8, timestamp: 1 }),
      }),
      clock: new FakeClock(),
      delay: never,
    });
    expect(fix).toEqual({ ok: true, lat: 23.73, lon: 92.72, accuracy_m: 8, timestamp: 1 });
    expect(accuracyQuality(8)).toBe('good');
    expect(accuracyAdvice(8)).toBeNull();
  });

  test('permission denied points the reporter at the manual pin', async () => {
    const fix = await getGpsFix({
      location: location({ requestPermission: async () => ({ granted: false }) }),
      clock: new FakeClock(),
      delay: never,
    });
    expect(fix).toMatchObject({ ok: false, reason: 'PERMISSION' });
    if (fix.ok) throw new Error('unreachable');
    expect(fix.error).toContain('Adjust pin manually');
  });

  test('no fix within the timeout is reported as a timeout, with the manual pin as the way out', async () => {
    const fix = await getGpsFix({
      location: location({ getCurrentPosition: never }),
      clock: new FakeClock(),
      timeoutMs: 20_000,
      delay: async () => undefined, // the timer fires immediately in the test
    });
    expect(fix).toMatchObject({ ok: false, reason: 'TIMEOUT' });
    if (fix.ok) throw new Error('unreachable');
    expect(fix.error).toContain('No GPS fix after 20 s');
    expect(fix.error).toContain('Adjust pin manually');
  });

  test('a provider error is reported with its reason', async () => {
    const fix = await getGpsFix({
      location: location({
        getCurrentPosition: async () => {
          throw new Error('Location services are disabled');
        },
      }),
      clock: new FakeClock(),
      delay: never,
    });
    expect(fix).toEqual({ ok: false, reason: 'UNAVAILABLE', error: 'No GPS fix: Location services are disabled' });
  });

  test('a low-accuracy fix is accepted but advised against; a missing accuracy is flagged', async () => {
    const weak = await getGpsFix({
      location: location({
        getCurrentPosition: async () => ({ lat: 23.73, lon: 92.72, accuracy_m: 240, timestamp: 2 }),
      }),
      clock: new FakeClock(),
      delay: never,
    });
    expect(weak).toMatchObject({ ok: true, accuracy_m: 240 });
    expect(accuracyQuality(240)).toBe('poor');
    expect(accuracyAdvice(240)).toContain('±240 m');
    expect(accuracyAdvice(240)).toContain('adjust the pin manually');

    expect(accuracyQuality(null)).toBe('unknown');
    expect(accuracyAdvice(null)).toContain('did not report a GPS accuracy');
    expect(accuracyQuality(ACCURACY_GOOD_M)).toBe('good');
    expect(accuracyQuality(ACCURACY_GOOD_M + 1)).toBe('fair');
    expect(accuracyAdvice(ACCURACY_FAIR_M)).toContain('±100 m');
    expect(accuracyQuality(ACCURACY_FAIR_M + 1)).toBe('poor');
  });
});
