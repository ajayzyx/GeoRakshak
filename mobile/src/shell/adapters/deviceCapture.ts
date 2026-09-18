// Expo bindings for the capture ports in src/core/capture.ts. Deliberately thin:
// all decisions (permissions, limits, messages, timeouts) live in the core.

import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  CameraPort,
  CameraResult,
  CaptureOutcome,
  GpsFix,
  LocationPort,
  MediaFilePort,
  captureMedia as captureMediaCore,
  getGpsFix as getGpsFixCore,
} from '../../core/capture';
import { MediaType, systemClock } from '../../core/types';
import { newUuid } from './expoAdapters';

function mediaDir(): Directory {
  const dir = new Directory(Paths.document, 'report-media');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const expoCamera: CameraPort = {
  async requestPermission() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    return { granted: perm.granted };
  },
  async launch({ kind, maxDurationS }): Promise<CameraResult> {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: kind === 'PHOTO' ? ['images'] : ['videos'],
      // Photo compression happens here; there is no video transcoder, so a long
      // high-quality clip is rejected by the size check instead.
      quality: 0.6,
      videoMaxDuration: maxDurationS,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { canceled: true };
    return {
      canceled: false,
      asset: {
        kind,
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        durationMs: asset.duration,
      },
    };
  },
};

export const expoMediaFiles: MediaFilePort = {
  async copyIntoAppStorage(sourceUri, filename) {
    const dest = new File(mediaDir(), filename);
    await new File(sourceUri).copy(dest);
    return { uri: dest.uri, size: dest.size };
  },
  delete(uri) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort: a leftover file only costs storage.
    }
  },
  async exists(uri) {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },
};

export const expoLocation: LocationPort = {
  async requestPermission() {
    const perm = await Location.requestForegroundPermissionsAsync();
    return { granted: perm.granted };
  },
  async getCurrentPosition() {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy && pos.coords.accuracy > 0 ? pos.coords.accuracy : null,
      timestamp: pos.timestamp,
    };
  },
};

export function captureMedia(kind: MediaType): Promise<CaptureOutcome> {
  return captureMediaCore(kind, {
    camera: expoCamera,
    files: expoMediaFiles,
    clock: systemClock,
    newId: newUuid,
  });
}

export function getGpsFix(): Promise<GpsFix> {
  return getGpsFixCore({ location: expoLocation, clock: systemClock });
}

export const discardLocalFile = (uri: string): void => expoMediaFiles.delete(uri);
export const localFileExists = (uri: string): Promise<boolean> => expoMediaFiles.exists(uri);
