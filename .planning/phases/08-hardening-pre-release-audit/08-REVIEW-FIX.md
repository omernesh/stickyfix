---
phase: 08-hardening-pre-release-audit
fixed_at: 2026-06-04T02:00:00Z
review_path: .planning/phases/08-hardening-pre-release-audit/08-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-06-04
**Source review:** `.planning/phases/08-hardening-pre-release-audit/08-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-03, IN-05 — as specified by caller)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-03: test:lib auto-discovers all lib tests

**Files modified:** `package.json`
**Commit:** `6aae590`
**Applied fix:** Replaced hand-enumerated test paths in both `test:lib` and `test` scripts with Node native glob discovery:
- `test:lib`: `tsc -p tsconfig.lib.json && node --test "dist/lib/lib/test/**/*.test.js"`
- `test`: `tsc -p tsconfig.host.json && node --test "dist/host/test/**/*.test.js"`

**Mechanism chosen:** `node --test` CLI glob (Node v25.8.1 expands the glob natively — no shell expansion needed, cross-platform safe on Windows/npm). Quoting the glob pattern ensures the shell does not attempt expansion (cmd.exe cannot glob); Node itself resolves it. No new dependency added.

**Proof of discovery:**
1. `npm run test:lib` with new glob: 152 pass, 0 fail — all 12 existing suites present.
2. Probe `lib/test/__wr03probe.test.ts` created (1 trivial test), recompiled, ran `npm run test:lib` — 153 pass, probe appeared without any `package.json` edit.
3. Probe deleted, `npm run test:lib` confirmed 152 pass again.

---

### IN-05: Single source of truth for thumbnail numbering via nextThumbnailKind

**Files modified:** `lib/thumbnail-number.ts`, `lib/test/thumbnail-number.test.ts`, `entrypoints/review.content/card.ts`
**Commit:** `ce38574`
**Applied fix:** Added pure companion function `nextThumbnailKind(count, baseOffset=0): string` to `lib/thumbnail-number.ts`. The formula `+(count + 1 + baseOffset)` is consistent with `renumberThumbnailKinds` (item at index i gets `+(i+1+baseOffset)`; a new push lands at index = current count).

Card.ts changes (byte-identical output):
- Import updated: `import { renumberThumbnailKinds, nextThumbnailKind } from '../../lib/thumbnail-number.js'`
- Free push (line 248): `` `+${thumbnails.length + 1}` `` → `nextThumbnailKind(thumbnails.length)` — still emits `+1, +2, …`
- Element push (line 632): `` `+${thumbnails.length + 2}` `` → `nextThumbnailKind(thumbnails.length, 1)` — still emits `+2, +3, …`

No change to `renumberThumbnailKinds`, delete handler, `_doElementSend`, or payload assembly.

Unit tests added to `lib/test/thumbnail-number.test.ts` (7 new tests):
- `nextThumbnailKind(0,0)='+1'`, `nextThumbnailKind(2,0)='+3'`
- `nextThumbnailKind(0,1)='+2'`, `nextThumbnailKind(2,1)='+4'`
- Default baseOffset=0 check
- Consistency proof: free path next-kind equals what renumberThumbnailKinds would assign at index N (for N=0,1,2,5)
- Consistency proof: element path next-kind equals what renumberThumbnailKinds would assign at index N (for N=0,1,2,5)

---

## Verification Results

| Check | Result |
|-------|--------|
| Node version | v25.8.1 |
| `npx tsc --noEmit` (extension, main repo) | EXIT 0 |
| `npx tsc -p tsconfig.lib.json --noEmit` | EXIT 0 |
| `npm run test:lib` | EXIT 0 — 159 pass, 0 fail |
| `npm test` (host) | 97 pass, 1 cancelled (known WR-06 EADDRINUSE :39240 flake) |
| `npm run build` | EXIT 0 — extension 197.44 kB, host compiled |
| `node scripts/clean-room-check.mjs` | PASS — no banned identifiers |

---

_Fixed: 2026-06-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
