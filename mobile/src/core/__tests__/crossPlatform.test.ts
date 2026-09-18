// Guards the boundary that keeps the app testable and portable: src/core must
// stay free of React Native, Expo and platform-specific APIs, so it runs on
// Android, iOS and (as in these tests and check:live) plain Node.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CORE_DIR = join(__dirname, '..');

function coreFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(CORE_DIR, f));
}

describe('src/core stays platform-neutral', () => {
  test('there are core modules to check', () => {
    expect(coreFiles().length).toBeGreaterThan(10);
  });

  test('no core module imports react-native, expo or node built-ins', () => {
    const offenders: string[] = [];
    for (const file of coreFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        const specifier = match[1] as string;
        const banned =
          specifier === 'react-native' ||
          specifier.startsWith('react-native/') ||
          specifier.startsWith('expo') ||
          specifier.startsWith('@react-native') ||
          specifier.startsWith('node:');
        if (banned) offenders.push(`${file.split('/').pop()} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no core module branches on the platform or touches platform globals', () => {
    // Comments may of course mention Android or iOS; only code is checked.
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const offenders: string[] = [];
    for (const file of coreFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of [
        /Platform\.OS/,
        /\bNativeModules\b/,
        /requireNativeModule/,
        /\bwindow\./,
        /\bdocument\./,
        /['"]android['"]/i,
        /['"]ios['"]/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${file.split('/').pop()} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the app config declares both platforms with the permissions each one needs', () => {
    const app = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'app.json'), 'utf8')) as {
      expo: {
        ios?: Record<string, unknown>;
        android?: { permissions?: string[] };
        plugins?: (string | [string, Record<string, unknown>])[];
      };
    };
    expect(app.expo.ios).toBeDefined();
    expect(app.expo.android?.permissions).toEqual(
      expect.arrayContaining(['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']),
    );
    // The iOS usage descriptions come from the plugin config (Info.plist keys).
    const plugins = new Map(
      (app.expo.plugins ?? []).map((p) => (typeof p === 'string' ? [p, {}] : [p[0], p[1]])) as [
        string,
        Record<string, unknown>,
      ][],
    );
    expect(typeof plugins.get('expo-image-picker')?.cameraPermission).toBe('string');
    expect(typeof plugins.get('expo-location')?.locationWhenInUsePermission).toBe('string');
    expect(plugins.has('expo-sqlite')).toBe(true);
    expect(plugins.has('expo-secure-store')).toBe(true);
  });
});
