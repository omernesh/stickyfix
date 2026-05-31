---
phase: 04-free-note-mode-capture-utilities
plan: 01
subsystem: lib-capture-utilities
tags: [tdd, pure-functions, dpr-math, card-state, interactjs]
dependency_graph:
  requires: []
  provides:
    - lib/capture.ts (computeCropCoords pure + browser-only helpers)
    - entrypoints/review.content/card-state.ts (FREE-02 DOM-free guard)
    - SFX_CAPTURE_TAB + MsgCaptureTab in lib/types.ts
    - interactjs@1.10.27 in package.json dependencies
  affects:
    - tsconfig.lib.json (include globs + chrome types)
    - package.json test:lib script
tech_stack:
  added:
    - interactjs@1.10.27 (MIT, drag for FAB + card in subsequent plans)
  patterns:
    - TDD RED/GREEN for pure math (computeCropCoords DPR unit tests)
    - Module-level boolean guard (card-state active flag, DOM-free)
    - Math.round after DPR multiply (Windows 125% fractional pixel safety)
key_files:
  created:
    - lib/capture.ts
    - lib/test/capture.test.ts
    - entrypoints/review.content/card-state.ts
    - lib/test/card-state.test.ts
  modified:
    - lib/types.ts
    - tsconfig.lib.json
    - package.json
decisions:
  - tsconfig.lib.json adds "chrome" to types array so captureTab fn body type-checks; does not affect node:test runtime
  - MsgCaptureTab NOT added to SfxMessage union — it is a top-level const handled by its own router case (same pattern as SFX_SET_ROUTE)
  - card-state.ts lives in entrypoints/review.content/ (not lib/) to keep the module co-located with card.ts that will consume it in 04-02
metrics:
  duration: "~20 minutes"
  completed: "2026-05-31"
  tasks: 3
  files: 7
---

# Phase 4 Plan 1: Wave-0 Nyquist Gate — Capture Utilities + Card State Summary

One-liner: interactjs installed, DPR-correct `computeCropCoords` proven at 1/1.25/2 via node:test, and FREE-02 single-card guard extracted as a DOM-free state machine — all 29 lib tests green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install interactjs + SFX_CAPTURE_TAB | a909736 | package.json, lib/types.ts |
| 2 (RED) | capture.test.ts failing tests | b7742f0 | lib/test/capture.test.ts |
| 2 (GREEN) | lib/capture.ts implementation | 0075d97 | lib/capture.ts, tsconfig.lib.json |
| 3 (RED) | card-state.test.ts failing tests | e19fc26 | lib/test/card-state.test.ts |
| 3 (GREEN) | card-state.ts + wire test:lib | a6fd62a | entrypoints/review.content/card-state.ts, tsconfig.lib.json, package.json |

## Verification Results

- `tsc --noEmit`: exit 0
- `tsc --noEmit -p tsconfig.host.json`: exit 0
- `npm run test:lib`: 29 pass, 0 fail (routing + discovery + capture + card-state)
- `npm test` (host): 57 pass, 0 fail
- `node scripts/clean-room-check.mjs`: PASS — no banned identifiers found
- interactjs@1.10.27 in package.json dependencies (exact, no caret)

## TDD Gate Compliance

| Phase | Commit | Gate |
|-------|--------|------|
| Task 2 RED | b7742f0 | `test(04-01): add failing tests for computeCropCoords DPR=1/1.25/2` |
| Task 2 GREEN | 0075d97 | `feat(04-01): implement computeCropCoords + browser-only capture helpers` |
| Task 3 RED | e19fc26 | `test(04-01): add failing tests for card-state single-active-card guard` |
| Task 3 GREEN | a6fd62a | `feat(04-01): card-state.ts DOM-free guard + wire test:lib; all 29 tests green` |

All RED/GREEN gates committed in order. No REFACTOR commits required — code was clean from initial write.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment `chrome.*/document.*` closed block comment early**
- **Found during:** Task 2 (compile lib/capture.ts)
- **Issue:** `/** ... chrome.*/document.*/window.* ... */` — the `*/` in the comment text closed the JSDoc block at `chrome.`, causing parser errors on the following lines
- **Fix:** Changed comment text to `chrome / document / window` (no asterisk-slash sequence)
- **Files modified:** lib/capture.ts
- **Commit:** 0075d97

**2. [Rule 2 - Missing critical functionality] tsconfig.lib.json missing chrome types**
- **Found during:** Task 2 (tsc -p tsconfig.lib.json with captureTab fn body)
- **Issue:** `captureTab()` function body references `chrome.runtime` — tsconfig.lib.json only had `"types": ["node"]` so tsc reported `Cannot find name 'chrome'`
- **Fix:** Added `"chrome"` to `types` array in tsconfig.lib.json. This does not affect node:test runtime (types are compile-only); the function body is not exercised under node:test.
- **Files modified:** tsconfig.lib.json
- **Commit:** 0075d97

## Known Stubs

None. All exports are fully implemented. Browser-only functions (`waitTwoRafs`, `cropToRect`, `captureTab`) are correctly declared with real implementations — they are exercised in 04-03, not in this plan.

## Threat Flags

None. Wave-0 is pure logic + install; no Chrome/HTTP runtime surface exercised. Threat mitigations:
- T-04-01 (computeCropCoords integer math): mitigated — Math.round on all coords, asserted at DPR=1.25 in capture.test.ts (sx=13, sh=63 prove rounding not truncation)
- T-04-02 (lib/capture.ts module surface): mitigated — no top-level chrome/DOM access; computeCropCoords is pure

## Self-Check: PASSED

- [x] lib/capture.ts exists: FOUND
- [x] lib/test/capture.test.ts exists: FOUND
- [x] entrypoints/review.content/card-state.ts exists: FOUND
- [x] lib/test/card-state.test.ts exists: FOUND
- [x] Commit a909736 exists: FOUND
- [x] Commit b7742f0 exists: FOUND
- [x] Commit 0075d97 exists: FOUND
- [x] Commit e19fc26 exists: FOUND
- [x] Commit a6fd62a exists: FOUND
- [x] npm run test:lib: 29 pass, 0 fail
