// scripts/host-smoke-test.mjs
// Spawns the compiled host server against a temp --root, reads the startup JSON line
// via readline (Pattern 12 — server runs indefinitely; spawnSync would hang).
// Part of npm run check: asserts startup line shape and GET /status response.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST_DIST = 'dist/host/src/index.js';

// Guard: fail with a helpful message if host has not been built yet
if (!existsSync(HOST_DIST)) {
  console.error(
    `smoke test: MISSING ${HOST_DIST}\n` +
    'Run `npm run build` (or `tsc -p tsconfig.host.json`) first, then re-run this test.'
  );
  process.exit(1);
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-smoke-'));

let child;
try {
  child = spawn(process.execPath, [HOST_DIST, '--root', tmpRoot], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect stderr for diagnostics
  const stderrLines = [];
  child.stderr.on('data', (chunk) => stderrLines.push(chunk.toString()));

  // Read the startup JSON line (Pattern 12)
  const startupLine = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('smoke test: timeout waiting for startup JSON line (5 s)'));
    }, 5000);

    const rl = createInterface({ input: child.stdout });
    rl.once('line', (line) => {
      clearTimeout(timer);
      rl.close();
      resolve(line);
    });

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) {
        reject(new Error(`smoke test: host exited with code ${code}\nstderr: ${stderrLines.join('')}`));
      }
    });
  });

  // Parse startup JSON
  let startup;
  try {
    startup = JSON.parse(startupLine);
  } catch {
    console.error('smoke test: startup line is not valid JSON:', startupLine);
    process.exit(1);
  }

  // Assert startup shape
  if (startup.app !== 'stickyfix') {
    console.error(`smoke test: expected app:"stickyfix", got: ${JSON.stringify(startup.app)}`);
    process.exit(1);
  }
  if (typeof startup.port !== 'number' || startup.port < 1) {
    console.error(`smoke test: expected numeric port in startup, got: ${JSON.stringify(startup.port)}`);
    process.exit(1);
  }
  if (startup.root !== tmpRoot) {
    console.error(`smoke test: root mismatch — expected ${tmpRoot}, got ${startup.root}`);
    process.exit(1);
  }

  // Probe GET /status
  const statusRes = await fetch(`http://127.0.0.1:${startup.port}/status`);
  if (!statusRes.ok) {
    console.error(`smoke test: GET /status returned ${statusRes.status}`);
    process.exit(1);
  }

  const status = await statusRes.json();
  if (status.app !== 'stickyfix') {
    console.error(`smoke test: /status.app expected "stickyfix", got ${JSON.stringify(status.app)}`);
    process.exit(1);
  }
  if (status.token !== undefined) {
    console.error('smoke test: /status must NOT include the token field');
    process.exit(1);
  }

  console.log('smoke test: PASS');
} finally {
  // Always kill the child and clean up temp dir
  if (child) {
    child.kill('SIGTERM');
    // Wait briefly for clean exit on Windows (SIGTERM may not be immediate)
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  rmSync(tmpRoot, { recursive: true, force: true });
}
