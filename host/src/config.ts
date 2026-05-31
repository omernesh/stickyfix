/**
 * Config resolution for stickyfix-host.
 * D-07: token resolution order --token -> STICKYFIX_TOKEN -> crypto.randomUUID()
 * D-09: ensureNotesDir creates notesDir + .gitkeep (HOST-12)
 * D-10: resolveConfig rejects notesDir outside root (HOST-09)
 * Pattern 11: VERSION read from package.json at runtime via import.meta.url
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
  const port = portStr ? Number(portStr) : undefined;

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
 */
export function writeTokenFile(root: string, token: string): void {
  writeFileSync(join(root, '.stickyfix-token'), token, 'utf8');
}
