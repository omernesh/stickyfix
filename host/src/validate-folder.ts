/**
 * Shared folder-picker / target-folder validation (T-09-14 / T-09-14b).
 *
 * Single source of truth used by BOTH:
 *  - the native host (native-host.ts) when validating a freshly-picked folder, and
 *  - the HTTP server (server.ts) when re-validating an optional per-request
 *    targetDir before confining a note write to <targetDir>/notes.
 *
 * Node builtins only — no Chrome/WXT imports.
 */

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Sensitive system directories that must NEVER become a note-write root.
 * Compared against a resolved, normalized chosen path (case-insensitive on
 * win32). If the chosen folder equals one of these roots, the pick is rejected.
 */
const SYSTEM_DIRS_NIX = ['/', '/System', '/usr', '/etc'];
const SYSTEM_DIRS_WIN = ['C:\\Windows', 'C:\\Program Files'];

/**
 * Validate a folder before it becomes a note root (T-09-14 / T-09-14b).
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
 * Server-side reuse (D-04): the server re-runs this on EVERY request that
 * carries a targetDir, then confines the write to <returned>/notes. An invalid
 * or system targetDir returns null → the server maps that to HTTP 400 and
 * writes nothing.
 *
 * @returns the validated absolute directory, or null if any check fails.
 */
export function validateChosenFolder(
  folder: string | null,
  plat: NodeJS.Platform = process.platform,
): string | null {
  // User cancelled / dialog unavailable / empty target — no folder chosen.
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
