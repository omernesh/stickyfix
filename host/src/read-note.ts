/**
 * Note read/list/edit/delete service for stikfix-host.
 * HOST-14/15/16: resolveSerialFile, listAnnotations, editNote, deleteNote
 *
 * matchesUrlPath is IMPORTED from lib/pin-position.ts (single source of truth —
 * do NOT redefine inline; lib/pin-position.ts is the authoritative implementation).
 *
 * All file operations are path-confined via isInsideDir from security.ts (T-06-02).
 * Throws {statusCode:404} when serial doesn't resolve (D-06).
 * Throws {statusCode:403} when resolved path fails isInsideDir guard.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { isInsideDir } from './security.js';
import { matchesUrlPath } from '../../lib/pin-position.js';

// ---------------------------------------------------------------------------
// PinDescriptor — the shape returned by listAnnotations
// ---------------------------------------------------------------------------

export interface PinDescriptor {
  serial: string;
  mode: 'free' | 'element';
  status: string;
  url: string;
  text: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  /** Free-note viewport coords — from fm['note_position'], the CANONICAL key (D-03).
   *  Property name MUST match the extension consumer (pin.ts/_positionPin reads
   *  `note_position` off the wire); a `viewportCoords` name here silently breaks
   *  free-pin placement end-to-end. */
  note_position?: { x: number; y: number };
  screenshots: string[];
  /** AI reply written by the review-notes skill — from fm['reply'] */
  reply?: string;
  /** Commit hash / PR ref the fix landed in — from fm['fixed_in'] (snake_case) */
  fixedIn?: string;
}

// ---------------------------------------------------------------------------
// resolveSerialFile — find a note file by its leading 4-digit serial
// ---------------------------------------------------------------------------

/**
 * Find the note file whose name starts with `<serial>-` in `notesDir`.
 * Matches both *.md and *.read.md (the serial prefix predicate handles both).
 * Returns the absolute path to the file, or null when no match.
 *
 * Pattern: readdirSync + startsWith filter (serial.ts:27-36 analog).
 * Does NOT call getNextSerial / withSerialLock — read-only resolution (Pitfall 7).
 */
export function resolveSerialFile(notesDir: string, serial: string): string | null {
  const files = readdirSync(notesDir);
  // Must end in .md or .read.md — avoids matching sibling +N.png files (RESEARCH.md Pitfall 5)
  const match = files.find(
    f => f.startsWith(serial + '-') && (f.endsWith('.md') || f.endsWith('.read.md'))
  );
  return match ? join(notesDir, match) : null;
}

// ---------------------------------------------------------------------------
// listAnnotations — list all notes whose URL path matches the given page URL
// ---------------------------------------------------------------------------

/**
 * Read all *.md files in notesDir, parse their YAML frontmatter, and return a
 * PinDescriptor for each note whose `url` pathname matches `pageUrl` (D-02).
 *
 * When `opts.allUrls` is true the per-note URL-path match is skipped, so notes
 * from ALL pages are returned (project-wide listing). A note still needs a
 * string `url` field to be included. The read/.read.md exclusion and the
 * `status === 'read'` skip apply identically in both modes — read notes are
 * never returned regardless of `allUrls`.
 *
 * Serial is extracted from filename.slice(0,4) — NEVER from fm['id'] which loses
 * zero-padding (RESEARCH.md Pitfall 7).
 *
 * CANONICAL: reads fm['note_position'] into the note_position descriptor field —
 * the SAME key that buildFrontmatter writes AND the extension consumer reads off
 * the wire. Do NOT use alternative key names (a mismatch breaks free-pin placement).
 * Also maps fm['reply'] → reply and fm['fixed_in'] → fixedIn (snake_case → camelCase).
 */
export function listAnnotations(
  notesDir: string,
  pageUrl: string,
  opts?: { allUrls?: boolean; includeDone?: boolean },
): PinDescriptor[] {
  // Read notes must not produce pins. The review-notes skill marks a note done
  // two ways (belt-and-suspenders): it renames the file to `*.read.md` AND sets
  // `status: read` in the frontmatter. Exclude both here so a marked-read note's
  // pin disappears on the next refresh. The filename check is the robust primary
  // signal (works even if the frontmatter status is stale or missing).
  const files = readdirSync(notesDir).filter(
    f => f.endsWith('.md') && (opts?.includeDone || !f.endsWith('.read.md'))
  );
  const pins: PinDescriptor[] = [];

  for (const file of files) {
    const serial = file.slice(0, 4); // leading 4-digit serial from filename
    const content = readFileSync(join(notesDir, file), 'utf8');

    // Extract YAML frontmatter block
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;

    // Skip notes explicitly marked read in frontmatter (secondary signal —
    // catches an in-place status flip that did not rename the file).
    if (!opts?.includeDone && (fm['status'] as string) === 'read') continue;

    // Skip notes without a string url field
    if (typeof fm['url'] !== 'string') continue;

    // D-02: path-only URL match (query string ignored). Skipped for project-wide
    // listing (opts.allUrls) so notes from every page are returned.
    if (!opts?.allUrls && !matchesUrlPath(fm['url'], pageUrl)) continue;

    // Extract first line of body as text
    const bodyStart = content.indexOf('\n---', 3) + 4; // skip closing ---\n
    const text = content.slice(bodyStart).trim().split('\n')[0] ?? '';

    pins.push({
      serial,
      mode: (fm['mode'] as 'free' | 'element') ?? 'free',
      status: (fm['status'] as string) ?? 'unread',
      url: fm['url'],
      text,
      selector: typeof fm['selector'] === 'string' ? fm['selector'] : undefined,
      rect: fm['rect'] as PinDescriptor['rect'],
      // CANONICAL KEY: note_position — D-03 (same name on disk, descriptor, and wire)
      note_position: fm['note_position'] as PinDescriptor['note_position'],
      screenshots: Array.isArray(fm['screenshots']) ? (fm['screenshots'] as string[]) : [],
      reply: typeof fm['reply'] === 'string' ? fm['reply'] : undefined,
      fixedIn: typeof fm['fixed_in'] === 'string' ? fm['fixed_in'] : undefined,
    });
  }

  return pins;
}

// ---------------------------------------------------------------------------
// editNote — overwrite note body in place; set status:unread; preserve frontmatter+screenshots
// ---------------------------------------------------------------------------

/**
 * Rewrite the note body for the given serial. Preserves the YAML frontmatter block
 * (with status updated to 'unread') and any existing ### Screenshots section.
 *
 * Throws {statusCode:404} when serial doesn't resolve.
 * Throws {statusCode:403} when resolved path fails isInsideDir guard (T-06-02).
 *
 * D-04: editing an already-read note re-marks it unread (you changed it).
 */
export async function editNote(
  notesDir: string,
  serial: string,
  newComment: string,
): Promise<void> {
  const mdPath = resolveSerialFile(notesDir, serial);
  if (!mdPath) {
    throw Object.assign(new Error('not found'), { statusCode: 404 });
  }
  if (!isInsideDir(notesDir, mdPath)) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }

  const content = await readFile(mdPath, 'utf8');

  // Extract the complete frontmatter block (including --- delimiters)
  const fmMatch = content.match(/^(---\n[\s\S]*?\n---)\n/);
  if (!fmMatch) {
    throw Object.assign(new Error('malformed note: no frontmatter'), { statusCode: 400 });
  }

  // Re-parse frontmatter to update status
  const rawFm = fmMatch[1].replace(/^---\n/, '').replace(/\n---$/, '');
  const fm = yamlParse(rawFm) as Record<string, unknown>;
  fm['status'] = 'unread';
  const newFmBlock = '---\n' + yamlStringify(fm) + '---\n';

  // Extract existing body after frontmatter
  const bodyAfterFm = content.slice(fmMatch[0].length);

  // Preserve the ### Screenshots section if present (D-04 — preserve screenshots)
  const screenshotSection = bodyAfterFm.match(/(### Screenshots[\s\S]*)$/)?.[1] ?? '';
  const newBody = newComment + '\n' + (screenshotSection ? '\n' + screenshotSection : '');

  await writeFile(mdPath, newFmBlock + newBody, 'utf8');
}

// ---------------------------------------------------------------------------
// deleteNote — remove the .md file and any +N.png screenshots
// ---------------------------------------------------------------------------

/**
 * Hard-delete the note file and its associated screenshot PNGs.
 * Base name stripping handles both *.md and *.read.md (Pitfall 5 / RESEARCH.md).
 *
 * Throws {statusCode:404} when serial doesn't resolve.
 * Throws {statusCode:403} when resolved path fails isInsideDir guard (T-06-02).
 *
 * Every rm is guarded by isInsideDir — no path traversal (T-06-01/02).
 */
export async function deleteNote(
  notesDir: string,
  serial: string,
): Promise<void> {
  const mdPath = resolveSerialFile(notesDir, serial);
  if (!mdPath) {
    throw Object.assign(new Error('not found'), { statusCode: 404 });
  }
  if (!isInsideDir(notesDir, mdPath)) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }

  // Strip both .md and .read.md extensions to get the base name for PNG glob (Pitfall 5)
  const base = basename(mdPath).replace(/\.read\.md$|\.md$/, '');

  // Remove the .md file
  await rm(mdPath);

  // Find and remove associated +N.png screenshots
  const dirEntries = await readdir(notesDir);
  const pngs = dirEntries.filter(f => f.startsWith(base + '+') && f.endsWith('.png'));
  for (const png of pngs) {
    const pngPath = join(notesDir, png);
    // isInsideDir guard on every rm — non-negotiable (T-06-02)
    if (isInsideDir(notesDir, pngPath)) {
      await rm(pngPath);
    }
  }
}
