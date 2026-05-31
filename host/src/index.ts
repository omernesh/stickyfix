/**
 * stickyfix-host CLI entry point.
 * D-08/HOST-01/HOST-02/HOST-03: bind 127.0.0.1 only; honor --port or scan 39240-39260
 * D-07/HOST-12: writeTokenFile to <root>/.stickyfix-token
 * Startup JSON line: {app,name,root,port,token,notesDir,origins}
 * Pattern 1: bind-or-fail loop (EADDRINUSE -> retry next port)
 * WR-06: bindServer/tryListen extracted to bind.ts; removeAllListeners between attempts
 * Pitfall 2: server runs indefinitely (smoke test uses spawn+readline, not spawnSync)
 */

import { parseArgs } from 'node:util';
import type { AddressInfo } from 'node:net';
import { resolveConfig, ensureNotesDir, writeTokenFile } from './config.js';
import { createHostServer } from './server.js';
import { bindServer, BIND_HOST } from './bind.js';

// ---------------------------------------------------------------------------
// CLI parsing (preserve Phase 1 stub options block — HOST-13)
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    origin: { type: 'string', multiple: true },
    name: { type: 'string' },
    'notes-dir': { type: 'string' },
    port: { type: 'string' },
    token: { type: 'string' },
  },
  strict: false,
});

if (!values.root) {
  console.error('stickyfix-host: --root is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config resolution + filesystem setup
// ---------------------------------------------------------------------------

const cfg = resolveConfig(values as Record<string, unknown>);
ensureNotesDir(cfg.notesDir);
writeTokenFile(cfg.root, cfg.token);

// ---------------------------------------------------------------------------
// Port discovery — bind-or-fail loop on 127.0.0.1 (Pattern 1 / D-08)
// ---------------------------------------------------------------------------

const server = createHostServer(cfg);
const boundPort = await bindServer(server, cfg.port);

// Safety assertion: binding must be 127.0.0.1 (T-02-bind)
const addr = server.address() as AddressInfo;
if (addr.address !== BIND_HOST) {
  throw new Error(`FATAL: server bound to ${addr.address} instead of ${BIND_HOST}`);
}

// Startup JSON line — read by smoke test via readline (Pattern 12)
console.log(JSON.stringify({
  app: 'stickyfix',
  name: cfg.name,
  root: cfg.root,
  port: boundPort,
  token: cfg.token,
  notesDir: cfg.notesDir,
  origins: cfg.origins,
}));

// Server runs indefinitely (Pitfall 2 — no process.exit here)
