---
phase: 08-hardening-pre-release-audit
reviewed: 2026-06-04T00:00:00Z
depth: standard
re_review: true
files_reviewed: 5
files_reviewed_list:
  - package.json
  - lib/thumbnail-number.ts
  - lib/test/thumbnail-number.test.ts
  - entrypoints/review.content/card.ts
  - tsconfig.lib.json
findings:
  critical: 0
  blocker: 0
  warning: 0
  info: 1
  total: 1
status: clean
---

# Phase 8: Code Review Report (Final Re-Review)

**Reviewed:** 2026-06-04
**Depth:** standard
**Files Reviewed:** 5
**Status:** clean

## Summary

Final re-review of Phase 8 after the WR-03 (`test:lib` glob) and IN-05 (`nextThumbnailKind` extraction) fixes landed. Both fixes are verified correct against ground-truth source and the actual compiled output layout. No blockers, no warnings. The two previously-open warnings are resolved/closed: WR-01 stays resolved, WR-02 is downgraded out of scope (test-only allocation, perf — explicitly out of v1 review scope). One pre-existing INFO item remains.

This phase is clean to ship.

## Verification of Landed Fixes

### WR-03 — `test:lib` glob (commit 6aae590) — VERIFIED CORRECT

`package.json:11`: `tsc -p tsconfig.lib.json && node --test "dist/lib/lib/test/**/*.test.js"`

- **Path correctness:** `tsconfig.lib.json` has `outDir: dist/lib`, `rootDir: .`, and includes `lib/test/**/*.ts`. A source file `lib/test/X.test.ts` therefore compiles to `dist/lib/lib/test/X.test.js` — the doubled `lib/lib` is the expected artifact of `rootDir: .` preserving the `lib/` path segment under `outDir: dist/lib`. Confirmed against actual disk output: all 12 lib test files exist at exactly `dist/lib/lib/test/*.test.js`. The glob matches them precisely.
- **No host-test leakage:** Host tests compile to `dist/host/test/*.test.js` (via `tsconfig.host.json`, `outDir: dist`). The lib glob is rooted at `dist/lib/...`, so it cannot reach `dist/host/test/`. Confirmed — no overlap.
- **No misses:** All lib tests live under `lib/test/`, so all land under `dist/lib/lib/test/` and are matched. `card-state.test.js` (whose source `card-state.ts` lives in `entrypoints/`) is itself under `lib/test/` and is correctly matched; the compiled `card-state.ts` it imports lands at `dist/lib/entrypoints/...` and is resolved by relative import, not by the glob. Correct.
- **Quoting:** The glob is double-quoted, so cmd.exe (Windows npm default shell) passes the literal `dist/lib/lib/test/**/*.test.js` to Node, which performs its own native glob expansion (Node 25 `--test` supports glob patterns). Correct — no premature shell expansion, no shell-dependent behavior.
- **Host script symmetry:** `package.json:12` `test` uses `node --test "dist/host/test/**/*.test.js"` — the same auto-discovery pattern, correctly quoted. It does NOT carry a silent-no-op risk (a new host test file is auto-discovered). The symmetry is intentional and correct; nothing was left behind.

### IN-05 — `nextThumbnailKind(count, baseOffset)` (commit ce38574) — VERIFIED CORRECT

`lib/thumbnail-number.ts:55-57`: `return \`+${count + 1 + baseOffset}\`;`

- **Free path byte-identity:** `card.ts:248` calls `nextThumbnailKind(thumbnails.length)` → `+${length + 1 + 0}` → `+${length + 1}`. Byte-identical to the prior inline `+${length + 1}`. Verified.
- **Element path byte-identity:** `card.ts:632` calls `nextThumbnailKind(thumbnails.length, 1)` → `+${length + 1 + 1}` → `+${length + 2}`. Byte-identical to the prior inline `+${length + 2}`. Verified.
- **Consistency with `renumberThumbnailKinds`:** renumber assigns item index `i` → `+${i + 1 + baseOffset}`. A push lands at `index = count`, so its kind must be `+${count + 1 + baseOffset}` — exactly what `nextThumbnailKind` returns. Internally consistent; the `+1` element auto-highlight slot (`card.ts:849`) stays exclusively reserved under `baseOffset=1`.
- **Purity:** No `chrome`, `document`, `window`, or any DOM/IO access at module level or in the function body. Importable under `node:test` without mocks. Verified.

### WR-01 — shared helper across delete + push — STILL RESOLVED

Delete-renumber (`card.ts:84` `renumberThumbnailKinds(items, baseOffset)`) and both push sites (`card.ts:248`, `card.ts:632` `nextThumbnailKind(...)`) now derive numbering from the same `lib/thumbnail-number.ts` module. The two operations can no longer drift. Resolved.

### WR-02 — payload-size 12 MB test allocations — CLOSED (out of v1 scope)

`lib/test/payload-size.test.ts:51,56` still allocate `'x'.repeat(MAX_BODY_BYTES)` (12 MB) and `MAX_BODY_BYTES + 1`. These are boundary-correctness tests and are necessary to assert the strict `>` cap at exactly 12 MB; the allocations are test-only memory/perf cost, not a correctness or security defect. Performance is explicitly out of v1 review scope. No action required for this phase. Not re-raised as a warning.

## Narrative Findings (AI reviewer)

### Critical Issues

None.

### Warnings

None.

### Info

#### IN-01: Two near-identical `setSfxVisibility*` closures duplicated across card paths

**File:** `entrypoints/review.content/card.ts:231-240` (free) and `entrypoints/review.content/card.ts:612-621` (element)
**Issue:** `setSfxVisibilityFree` and `setSfxVisibilityElem` are byte-for-byte identical apart from the function name. This is pre-existing duplication (not introduced by the two fixes under review) and is the same class of duplication IN-05 just eliminated for thumbnail numbering. Low priority; no behavioral risk.
**Fix:** Extract a single `makeSfxVisibilitySetter(container, activeCardRef)` helper (or a module-level pure function taking `container` + the active card) and call it from both card builders, mirroring the `thumbnail-number.ts` extraction pattern.

---

_Reviewed: 2026-06-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
