// scripts/host-smoke-test.mjs
// Spawns the compiled host stub against a temp --root and asserts the startup JSON.
// Part of BUILD-05: run via `node scripts/host-smoke-test.mjs` or `npm run check`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST_DIST = 'dist/host/index.js';

// Pitfall 6 guard: fail with a helpful message if host has not been built yet
if (!existsSync(HOST_DIST)) {
  console.error(
    `smoke test: MISSING ${HOST_DIST}\n` +
    'Run `npm run build` (or `tsc -p tsconfig.host.json`) first, then re-run this test.'
  );
  process.exit(1);
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-smoke-'));
try {
  const result = spawnSync(
    process.execPath,
    [HOST_DIST, '--root', tmpRoot],
    { encoding: 'utf8', timeout: 5000 }
  );

  if (result.error || result.status !== 0) {
    console.error('smoke test: host exited non-zero or errored');
    if (result.stderr) console.error(result.stderr);
    if (result.error) console.error(result.error.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    console.error('smoke test: stdout is not valid JSON');
    console.error('stdout was:', result.stdout);
    process.exit(1);
  }

  if (parsed.app !== 'stickyfix') {
    console.error(`smoke test: expected app:"stickyfix", got: ${JSON.stringify(parsed.app)}`);
    process.exit(1);
  }

  if (parsed.root !== tmpRoot) {
    console.error(`smoke test: root mismatch — expected ${tmpRoot}, got ${parsed.root}`);
    process.exit(1);
  }

  console.log('smoke test: PASS');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
