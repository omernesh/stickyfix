/**
 * Config resolution for stickyfix-host.
 * D-07: token resolution order --token -> STICKYFIX_TOKEN -> crypto.randomUUID()
 * D-09: ensureNotesDir creates notesDir + .gitkeep (HOST-12)
 * D-10: resolveConfig rejects notesDir outside root (HOST-09)
 * Pattern 11: VERSION read from package.json at runtime via import.meta.url
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isInsideDir } from './security.js';
import type { Config } from './types.js';

// ---------------------------------------------------------------------------
// VERSION — read from package.json at runtime (Pattern 11)
// dist/host/src/config.js → ../../../package.json
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const _pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { version: string };
export const VERSION: string = _pkg.version;

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------

/**
 * Resolve CLI parseArgs values into a validated Config.
 * Throws if notesDir resolves outside root (D-10).
 */
export function resolveConfig(values: Record<string, unknown>): Config {
  if (typeof values['root'] !== 'string' || !values['root']) {
    throw new Error('--root is required');
  }

  const root = resolve(values['root'] as string);
  const name = (values['name'] as string | undefined) ?? basename(root);

  // origins: parseArgs multiple:true gives string[], fallback to []
  const origins = (values['origin'] as string[] | undefined) ?? [];

  const notesDirRaw = values['notes-dir'] as string | undefined;
  const notesDir = resolve(notesDirRaw ?? join(root, 'notes'));

  // D-10: notesDir must be inside root
  if (!isInsideDir(root, notesDir)) {
    throw new Error(
      `--notes-dir must be inside --root.\n  root:     ${root}\n  notesDir: ${notesDir}`
    );
  }

  const portStr = values['port'] as string | undefined;
  let port: number | undefined;
  if (portStr !== undefined) {
    // WR-05: validate port — Number('abc') → NaN, Number('0x10') → 16, etc.
    port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--port must be an integer 1-65535, got: ${portStr}`);
    }
  }

  // D-07 token resolution order
  const token =
    (values['token'] as string | undefined) ??
    process.env['STICKYFIX_TOKEN'] ??
    randomUUID();

  return { root, notesDir, name, origins, port, token };
}

// ---------------------------------------------------------------------------
// ensureNotesDir (HOST-12)
// ---------------------------------------------------------------------------

/**
 * Create notesDir (recursively) if it does not exist.
 * Write a .gitkeep file if absent so the empty dir is tracked by git.
 */
export function ensureNotesDir(notesDir: string): void {
  mkdirSync(notesDir, { recursive: true });
  const gitkeep = join(notesDir, '.gitkeep');
  if (!existsSync(gitkeep)) {
    writeFileSync(gitkeep, '');
  }
}

// ---------------------------------------------------------------------------
// writeTokenFile (HOST-12)
// ---------------------------------------------------------------------------

/**
 * Write the resolved token to <root>/.stickyfix-token for developer convenience.
 * The file is already gitignored (verified in Phase 1).
 *
 * The token is a credential, so the file is created owner-only (mode 0o600).
 * Any pre-existing file is removed first so a prior, looser-permissioned inode
 * (e.g. 0o644) is not reused. POSIX mode bits are honored on macOS/Linux; on
 * Windows they are largely ignored by the filesystem, which is acceptable.
 */
export function writeTokenFile(root: string, token: string): void {
  const tokenPath = join(root, '.stickyfix-token');
  if (existsSync(tokenPath)) {
    rmSync(tokenPath, { force: true });
  }
  writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
}
