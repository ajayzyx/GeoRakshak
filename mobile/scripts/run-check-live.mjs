// Runner for `npm run check:live`: compiles scripts/check-live.ts (and the core
// modules it imports) with the project's TypeScript into a temporary directory,
// then runs it with plain Node. No extra dependency, and nothing is written into
// the repository.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), 'georakshak-check-live-'));

let status = 1;
try {
  const tsc = join(mobileDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const build = spawnSync(
    process.execPath,
    [tsc, '--project', join(mobileDir, 'scripts', 'tsconfig.check-live.json'), '--outDir', outDir],
    { stdio: 'inherit' },
  );
  if (build.status !== 0) {
    status = build.status ?? 1;
  } else {
    // The compiled output is CommonJS; make that explicit for Node's resolver.
    writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    const run = spawnSync(process.execPath, [join(outDir, 'scripts', 'check-live.js')], {
      stdio: 'inherit',
      env: process.env,
    });
    status = run.status ?? 1;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(status);
