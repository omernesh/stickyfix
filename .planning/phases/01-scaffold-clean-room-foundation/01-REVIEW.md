---
phase: 01-scaffold-clean-room-foundation
reviewed: 2026-05-31T05:05:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - wxt.config.ts
  - tsconfig.json
  - tsconfig.host.json
  - package.json
  - entrypoints/background.ts
  - entrypoints/popup/index.html
  - entrypoints/popup/main.ts
  - host/src/index.ts
  - scripts/clean-room-check.mjs
  - scripts/host-smoke-test.mjs
  - .gitignore
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-31T05:05:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the Phase 1 scaffold for stickyfix: WXT MV3 config, the two tsconfigs, package scripts, the background/popup placeholders, the stub host (`host/src/index.ts`), and the two cross-platform tooling scripts (clean-room audit + host smoke test). I verified the work end-to-end by running `npm run check` (both `tsc` passes, clean-room audit, and smoke test all PASS) and confirming `defineBackground` resolves through WXT's generated `#imports`.

Within the intentionally narrow scaffold scope, the extension/tsconfig/host-stub surface is sound and cross-platform-clean (no `sips`/`bash`/Bun, all paths via `node:path`, temp dir via `os.tmpdir()`). No Critical issues.

The defects that exist are concentrated in the **clean-room gate** — the one piece of Phase 1 logic that is supposed to be load-bearing for the MIT story. Its directory-skip list is built around what's *committed*, but it actually walks `process.cwd()`, so it scans several on-disk-but-gitignored trees (`private/`, `.claude/`, `.qmd-memory/`) and runtime user content (`notes/`). Those are exactly the locations allowed to mention the upstream project, so the gate has latent false-positive failure modes that will surface the moment one of those files contains a banned token. It also has no error guard while walking the tree. These are the WARNINGs below.

## Warnings

### WR-01: Clean-room audit scans gitignored, non-published directories (false-positive gate failures)

**File:** `scripts/clean-room-check.mjs:30-37, 76`
**Issue:** `walk(process.cwd())` recurses the entire working tree, but `SKIP_DIRS` only lists build/planning dirs. It does **not** skip `private/`, `.claude/`, or `.qmd-memory/` — all of which are gitignored (see `.gitignore:29-35`) and therefore are **not** part of the published MIT repo. These local-only trees are precisely the places allowed to reference the upstream project (strategy docs, agent memory). `private/monetization-phase.md` already exists on disk and is exactly the kind of doc that may legitimately name the GPL upstream. The audit passes today only because none of those files currently contain a banned token; the gate will hard-fail `npm run check` for content that never ships. The skip list is conceptually "things not in the published repo," but it was derived from a hand-picked subset instead of from gitignore reality.
**Fix:** Skip all gitignored top-level trees the same way `.planning` is skipped. Minimum, add the dot/private dirs:
```js
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.output', 'dist', '.wxt', '.planning',
  'private', '.claude', '.qmd-memory', 'notes',
]);
```
Better: also skip any directory whose name starts with `.` (covers future `.cache`, `.vscode`, etc.) unless explicitly whitelisted, so the gate only audits first-party publishable source.

### WR-02: Clean-room audit scans runtime user content (`notes/`) — user note text can fail the build

**File:** `scripts/clean-room-check.mjs:55-71`
**Issue:** `notes/` holds runtime-captured user content (`.gitignore:18-20` calls it out: "user content, never commit"). The scanner walks it and matches `.md` files. A user who pins a sticky note containing the word "opencode" (a common enough term) would cause `node scripts/clean-room-check.mjs` — and thus `npm run check` — to fail with a "CLEAN-ROOM VIOLATION" pointing at their own note. The clean-room gate must only judge first-party source, never user data. (Same root cause as WR-01 but called out separately because it has a distinct, user-facing failure trigger and persists even after the future HTTP server lands.)
**Fix:** Add `'notes'` to `SKIP_DIRS` (included in the WR-01 snippet above).

### WR-03: `walk()` has no error handling — a broken symlink or unreadable file crashes the audit with a stack trace

**File:** `scripts/clean-room-check.mjs:55-72`
**Issue:** `readdirSync` and `readFileSync` are called with no try/catch. On any contributor's machine, a broken symlink, a file deleted mid-walk, or an EPERM (Windows file locked by another process — realistic on the platform this project must support) throws an unhandled exception. The audit then dies with a raw Node stack trace and a non-zero exit, which is indistinguishable to CI from an actual clean-room violation. A correctness gate should fail loudly only for real violations and degrade gracefully on I/O hiccups.
**Fix:** Wrap the per-entry read in a guard and skip unreadable entries:
```js
} else if (SCAN_EXTS.has(extname(entry.name))) {
  if (SKIP_FILENAMES.has(entry.name)) continue;
  const full = join(dir, entry.name);
  let text;
  try { text = readFileSync(full, 'utf8'); }
  catch { continue; } // unreadable/locked/symlink — not a violation
  for (const pattern of BANNED) { /* ... */ }
}
```
Also consider guarding the `readdirSync` in the directory branch the same way.

## Info

### IN-01: Host stub parses flags with `strict: false`, silently swallowing typos

**File:** `host/src/index.ts:4-14`
**Issue:** `parseArgs({ ..., strict: false })` means a mistyped flag (e.g. `--rooot /x`) is accepted and ignored rather than reported. Combined with the `--root` required-check, a user who typos `--root` gets the generic "`--root` is required" error with no hint that they passed `--rooot`. For a CLI a human invokes by hand, `strict: true` (with the options already enumerated) gives far better diagnostics. If `strict: false` is intentional to tolerate future/unknown flags during the phased build, that's defensible — but worth a comment.
**Fix:** Either set `strict: true`, or add a one-line comment documenting why unknown flags are intentionally tolerated in the stub.

### IN-02: Smoke test does not assert the stub's only real behavior (`name` defaulting to `basename(root)`)

**File:** `scripts/host-smoke-test.mjs:45-53`
**Issue:** The only non-trivial logic in the Phase 1 host is `projectName = values.name ?? basename(root)` (`host/src/index.ts:23`). The smoke test asserts `app` and `root` but never asserts `name`, so the basename-defaulting — the one branch worth testing in this stub — is uncovered. A regression that emitted `name: null` or the wrong value would pass the smoke test.
**Fix:** Add an assertion, e.g.:
```js
import { basename } from 'node:path';
const expectedName = basename(tmpRoot);
if (parsed.name !== expectedName) {
  console.error(`smoke test: expected name:"${expectedName}", got: ${JSON.stringify(parsed.name)}`);
  process.exit(1);
}
```

### IN-03: `check` script runs the host smoke test but does not guarantee a fresh host build

**File:** `package.json:9-11`
**Issue:** `check` runs `host-smoke-test.mjs`, which requires `dist/host/index.js`. If a dev edits `host/src/index.ts` and runs `npm run check` without first running `npm run build`, the smoke test either fails on the missing-file guard (acceptable) or — worse — passes against a **stale** compiled host, hiding a regression. The smoke test's own guard message tells the user to build, so this is a workflow papercut, not a correctness break, but `check` and `build` are not chained.
**Fix:** Either document that `npm run build` must precede `npm run check`, or make `check` depend on a build step (e.g. `"check": "npm run build && tsc --noEmit && ..."`), or have the smoke test compile the host itself before spawning.

### IN-04: `.gitignore` ignores `dist/` but the host is published from `dist/host`

**File:** `.gitignore:5-6`, `package.json:9-10`
**Issue:** `dist/` is gitignored and the `host` npm script runs `node dist/host/index.js`. That's correct for source control (compiled output shouldn't be committed), but note that any future packaging/distribution step must build `dist/host` as part of release, since it never lives in git. Flagging only so the eventual publish phase doesn't assume `dist/host` is present in a fresh clone. No change needed in Phase 1.

---

_Reviewed: 2026-05-31T05:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
