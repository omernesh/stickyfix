/**
 * stickyfix native-messaging host entry point.
 *
 * Chrome spawns this process via the registered native-messaging manifest
 * (com.stickyfix.host). It responds to GET_TOKEN with { type:'TOKEN', ... }
 * from disk-backed files, then exits (sendNativeMessage one-shot — Pitfall 3).
 *
 * ONB-02: Reads the token from <root>/.stickyfix-token and delivers it to the SW.
 * ONB-04: Chrome spawns this on demand; no persistent process or HTTP server.
 *
 * Security:
 *  T-09-07: MUST NOT call createHostServer, bindServer, or listen on any port.
 *  T-09-09: Token read from disk file (mode 0o600), sent only over native messaging.
 *
 * Node builtins only — no WXT, no Chrome imports.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sendNativeMessage, readNativeMessages } from './native-msg.js';

// ---------------------------------------------------------------------------
// Config + token/port resolution
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), '.config', 'stickyfix', 'config.json');

interface StickyFixConfig {
  root: string;
  name: string;
  notesDir: string;
}

let cfg: StickyFixConfig;
try {
  cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as StickyFixConfig;
} catch (err) {
  // Config missing — respond with a structured error so the SW gets {ok:false}
  // rather than Chrome reporting "native host exited unexpectedly"
  sendNativeMessage({ type: 'ERROR', error: 'Config not found. Run: npx stickyfix init' });
  process.exit(1);
}

let token: string;
try {
  token = readFileSync(join(cfg.root, '.stickyfix-token'), 'utf8').trim();
} catch {
  sendNativeMessage({ type: 'ERROR', error: '.stickyfix-token not found. Start the host first.' });
  process.exit(1);
}

// Port is optional — read if present; SW falls back to port scan (A5 fallback)
let port: number | undefined;
try {
  const raw = readFileSync(join(cfg.root, '.stickyfix-port'), 'utf8').trim();
  const parsed = parseInt(raw, 10);
  if (!isNaN(parsed)) {
    port = parsed;
  }
} catch {
  // .stickyfix-port absent is OK — SW re-probes (A5)
}

// ---------------------------------------------------------------------------
// Message dispatch — handle one message and exit (Pitfall 3)
// ---------------------------------------------------------------------------

readNativeMessages((msg) => {
  const m = msg as { type?: string; origin?: string };

  if (m.type === 'GET_TOKEN') {
    // Send token + port (if known) + host identity, then exit (one-shot)
    sendNativeMessage({
      type: 'TOKEN',
      token,
      port,
      name: cfg.name,
      notesDir: cfg.notesDir,
    });
    process.exit(0);
  }

  if (m.type === 'PICK_FOLDER') {
    // Stub — folder-picker wired in Plan 04; respond with null folder so SW
    // can fall back gracefully rather than hanging (Plan 04 will replace this).
    sendNativeMessage({ type: 'FOLDER_PICKED', origin: m.origin, folder: null });
    process.exit(0);
  }

  // Unknown message type — exit cleanly (Chrome expects process to exit)
  process.exit(0);
});
