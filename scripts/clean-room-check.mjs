// scripts/clean-room-check.mjs
// Cross-platform Node ESM script — walks the source tree and exits 1 if any
// banned upstream identifier is found. Zero dependencies; runs on Windows,
// macOS, and Linux without bash or ripgrep.
//
// Enforces BUILD-04: the repo is an MIT clean-room build and must not contain
// identifiers from the GPL-3.0 upstream project (see PRD section 13).
// The three banned patterns are tested case-insensitively against file content.
//
// Banned patterns are constructed from fragments to avoid a false-positive
// when the script scans itself (the scanner must not trigger on its own source).

import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

// Construct banned patterns from fragments so this file does not self-trip.
const BANNED = [
  // upstream private-API prefix: __ + opc + _
  new RegExp('__' + 'opc' + '_', 'i'),
  // upstream project name: open + code
  new RegExp('open' + 'code', 'i'),
  // upstream author handle: Jodus + Nodus
  new RegExp('Jodus' + 'Nodus', 'i'),
];

const SCAN_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md']);

// Directories to skip — build outputs, vendor, research/planning dirs, and
// gitignored local-only trees that legitimately reference upstream identifiers
// (strategy docs, agent memory, user notes, editor config).
// These are NOT part of the published MIT repo and must not trip the gate.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.output',
  'dist',
  '.wxt',
  '.planning',
  // Gitignored local-only trees (see .gitignore) — allowed to name upstream:
  'notes',       // runtime user content, never committed
  'private',     // private business/strategy docs, never published
  '.claude',     // editor/agent config, never published
  '.qmd-memory', // agent long-term memory, never published
]);

// Root-level documentation and legal files that may reference the upstream
// project for attribution or legal notice — NOT first-party source code.
// Excluded for the same reason as .planning/: attribution must be allowed.
const SKIP_FILENAMES = new Set([
  'PRD.md',
  'README.md',
  'CLAUDE.md',
  'LICENSE',
  'CLEAN-ROOM.md',
]);

/**
 * Recursively walk `dir`, collecting {file, match} for every banned pattern found.
 * Unreadable files (broken symlinks, EPERM, deleted-mid-walk) are skipped with a
 * warning — an I/O hiccup is NOT a clean-room violation.
 * @param {string} dir
 * @param {{ file: string; match: string }[]} found
 * @returns {{ file: string; match: string }[]}
 */
function walk(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    process.stderr.write(`⚠ skipped unreadable directory: ${dir}\n`);
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name), found);
      }
    } else if (SCAN_EXTS.has(extname(entry.name))) {
      if (SKIP_FILENAMES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        process.stderr.write(`⚠ skipped unreadable: ${full}\n`);
        continue; // I/O error is not a violation
      }
      for (const pattern of BANNED) {
        const match = text.match(pattern);
        if (match) {
          found.push({ file: full, match: match[0] });
        }
      }
    }
  }
  return found;
}

const hits = walk(process.cwd());

if (hits.length > 0) {
  console.error('CLEAN-ROOM VIOLATION — banned identifiers found:');
  for (const h of hits) {
    console.error(`  ${h.file}: "${h.match}"`);
  }
  process.exit(1);
}

console.log('clean-room audit: PASS — no banned identifiers found');
