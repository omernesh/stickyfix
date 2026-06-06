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

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { sendNativeMessage, readNativeMessages } from './native-msg.js';
import { pickFolder } from './folder-picker.js';

// ---------------------------------------------------------------------------
// Config + token/port resolution
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), '.config', 'stickyfix', 'config.json');

interface StickyFixConfig {
  root: string;
  name: string;
  notesDir: string;
}

// ---------------------------------------------------------------------------
// Folder-picker result validation (T-09-14)
// ---------------------------------------------------------------------------

/**
 * Sensitive system directories that must NEVER become a note-write root.
 * Compared against a resolved, normalized chosen path (case-insensitive on
 * win32). If the chosen folder equals one of these roots, the pick is rejected.
 */
const SYSTEM_DIRS_NIX = ['/', '/System', '/usr', '/etc'];
const SYSTEM_DIRS_WIN = ['C:\\Windows', 'C:\\Program Files'];

/**
 * Validate a folder-picker result before it becomes a note root (T-09-14).
 *
 * IMPORTANT — why isInsideDir does NOT apply here:
 * The chosen folder is a *brand-new* note root selected by the user, NOT a
 * child of any pre-existing root. The `isInsideDir(root, target)` confinement
 * guard asserts that `target` lives inside an already-established `root`; there
 * is no such pre-existing root at folder-pick time. Do not "fix" this by adding
 * an isInsideDir call against the wrong base — that would reject every valid
 * pick. Instead we validate the path defensively on its own terms:
 *   (1) absolute, (2) exists, (3) is a directory, (4) not a sensitive system dir.
 *
 * @returns the validated absolute directory, or null if any check fails.
 */
export function validateChosenFolder(
  folder: string | null,
  plat: NodeJS.Platform = process.platform,
): string | null {
  // User cancelled / dialog unavailable — no folder chosen.
  if (folder === null || typeof folder !== 'string' || folder.length === 0) {
    return null;
  }

  // (1) Must be absolute.
  if (!isAbsolute(folder)) return null;

  // (2) Must exist + (3) must be a directory.
  try {
    if (!existsSync(folder)) return null;
    if (!statSync(folder).isDirectory()) return null;
  } catch {
    return null;
  }

  // (4) Reject sensitive system directories. Normalize via resolve() and, on
  // win32, compare case-insensitively (the filesystem is case-insensitive).
  const normalized = resolve(folder);
  const denyList = plat === 'win32' ? SYSTEM_DIRS_WIN : SYSTEM_DIRS_NIX;
  const cmp = plat === 'win32' ? normalized.toLowerCase() : normalized;
  for (const sysDir of denyList) {
    const sysCmp = plat === 'win32' ? resolve(sysDir).toLowerCase() : resolve(sysDir);
    if (cmp === sysCmp) return null;
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// PICK_FOLDER handler — open the OS dialog, validate, respond, exit (Pitfall 8)
// ---------------------------------------------------------------------------

/**
 * Handle a PICK_FOLDER native message: open the OS folder dialog, validate the
 * chosen path, send a FOLDER_PICKED frame echoing the origin, then exit(0).
 *
 * Pitfall 8: Chrome spawns a FRESH process per sendNativeMessage, so PICK_FOLDER
 * is handled per-spawn entirely separately from GET_TOKEN — the blocking folder
 * dialog can never delay a token fetch (which is a different spawn).
 *
 * `pickFn` is injectable so tests can stub the OS dialog.
 */
export async function handlePickFolder(
  origin: string | undefined,
  pickFn: (title: string) => Promise<string | null> = pickFolder,
  plat: NodeJS.Platform = process.platform,
  out?: { write(b: Buffer): boolean },
): Promise<void> {
  let chosen: string | null;
  try {
    chosen = await pickFn('Choose a folder for ' + (origin ?? 'this site'));
  } catch {
    // Dialog spawn error — never crash; respond with null (no silent drop).
    chosen = null;
  }
  const folder = validateChosenFolder(chosen, plat);
  if (out) {
    sendNativeMessage({ type: 'FOLDER_PICKED', origin, folder }, out);
  } else {
    sendNativeMessage({ type: 'FOLDER_PICKED', origin, folder });
  }
}

// ---------------------------------------------------------------------------
// Message dispatch — handle one message and exit (Pitfall 3)
// ---------------------------------------------------------------------------

/**
 * Native-host entry point. Reads config/token/port from disk, then dispatches
 * the single inbound native message and exits.
 *
 * Kept as a function (not top-level side effects) so the pure helpers above
 * (validateChosenFolder / handlePickFolder) can be imported by unit tests
 * WITHOUT triggering a config read + process.exit on import.
 */
export function main(): void {
  let cfg: StickyFixConfig;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as StickyFixConfig;
  } catch {
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
      // PICK_FOLDER is a SEPARATE spawn from GET_TOKEN (Pitfall 8) — the dialog
      // never blocks a token fetch. Open the dialog, validate, respond, exit.
      handlePickFolder(m.origin).then(
        () => process.exit(0),
        () => process.exit(0),
      );
      return;
    }

    // Unknown message type — exit cleanly (Chrome expects process to exit)
    process.exit(0);
  });
}

// Run only when invoked as the entry point (esbuild CJS bundle), never on import.
// In the esbuild CJS bundle (stickyfix-native.cjs), `require`/`module` are CJS
// scope locals and `require.main === module` is true when run directly. The
// node:test compile path emits ESM where these are undefined at runtime — the
// `typeof` guards keep main() from running on import there.
if (
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module
) {
  main();
}
