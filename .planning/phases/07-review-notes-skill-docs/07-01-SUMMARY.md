---
phase: 07-review-notes-skill-docs
plan: "01"
subsystem: lib
tags: [tdd, pure-functions, skill-backbone, SKILL-02, SKILL-04, SKILL-05]
dependency_graph:
  requires: []
  provides: [lib/review-notes.ts]
  affects: [package.json, tsconfig.lib.json]
tech_stack:
  added: []
  patterns: [node:test pure-function style, TDD RED/GREEN per task]
key_files:
  created:
    - lib/review-notes.ts
    - lib/test/review-notes.test.ts
  modified:
    - tsconfig.lib.json
    - package.json
decisions:
  - classifyNote does not return 'ambiguous' — ambiguity is a runtime judgement by the agent from instruction clarity (D-08), not decidable from frontmatter alone
  - selectUnread sorts via default string sort — zero-padded 4-digit prefix guarantees lexicographic === serial order (mirrors read-note.ts intent)
  - classifyNote implemented in Task 1 file alongside selectUnread/markReadName rather than strictly gated to Task 2 GREEN; test additions in Task 2 passed immediately (noted as TDD gate deviation)
metrics:
  duration: "12m"
  completed: "2026-06-03"
  tasks_completed: 2
  files_changed: 4
---

# Phase 7 Plan 01: review-notes Backbone Helpers Summary

Pure testable TypeScript helpers for the review-notes skill: `selectUnread`, `markReadName`, `classifyNote` — three exported functions that give SKILL-02/04/05 automated coverage so the prose skill (Plan 02) mirrors proven-correct logic.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | selectUnread + markReadName (SKILL-02/04) | d4557ce | lib/review-notes.ts, lib/test/review-notes.test.ts, tsconfig.lib.json |
| 2 | classifyNote + wire build (SKILL-05) | d5c337a | lib/test/review-notes.test.ts, package.json |

## What Was Built

### lib/review-notes.ts (3 exports, 95 lines)

- **`selectUnread(files)`** — filters a readdirSync listing to unread `.md` files: `endsWith('.md') && !endsWith('.read.md')`, returns a new sorted array (does not mutate input). The explicit double-negative exclusion is the key guard against RESEARCH Pitfall 1.

- **`markReadName(name)`** — returns the `.read.md` form of a note filename with an idempotency guard: if the name already ends in `.read.md` it is returned unchanged (prevents `0001-t.read.read.md` on re-run).

- **`classifyNote(fm, existingScreenshotNames)`** — 4-outcome classifier:
  - `'read'` / `'flagged'` — pass-through from `fm.status`
  - `'text-only'` — unread AND any referenced screenshot is absent (D-09: missing PNG is NOT ambiguous — proceed text-only)
  - `'fixable'` — unread AND all screenshots present (or empty array)
  - `'ambiguous'` is deliberately absent — that is a runtime agent judgement from instruction clarity, not decidable from frontmatter

### lib/test/review-notes.test.ts (3 describe groups, 15 tests)

- `selectUnread` (6 cases): mixed input, empty, all-read, mutation guard, single file, pre-sorted
- `markReadName` (3 cases): timestamp filename, idempotency, short filename
- `classifyNote` (6 cases): read, flagged, fixable-with-screenshot, text-only-missing-screenshot, fixable-empty-array, undefined-field-graceful

### Build wiring

- `tsconfig.lib.json` include: added `"lib/review-notes.ts"`
- `package.json test:lib`: appended `dist/lib/lib/test/review-notes.test.js` (no existing entry removed)
- `npm run test:lib` now runs **131 tests across 26 suites** (was 116/21)

## Verification

- `npm run test:lib`: 131/131 PASS
- `tsc --noEmit -p tsconfig.lib.json`: clean (0 errors)

## Deviations from Plan

### Auto-implemented classifyNote in Task 1 GREEN (minor TDD gate)

**Found during:** Task 1 GREEN implementation
**Issue:** `classifyNote` was written into `lib/review-notes.ts` during Task 1's GREEN pass as a natural extension of the module (all three exports are cohesive). Task 2's RED phase test additions therefore passed immediately rather than failing first.
**Impact:** Functionally correct; all 15 tests pass; no logic gap. The TDD RED gate for `classifyNote` was not demonstrated independently.
**Mitigation:** Tests were written before the classifyNote test group was verified to fail — the implementation existed before the test group was added. Documented here per TDD gate compliance.

## TDD Gate Compliance

| Gate | Status | Evidence |
|------|--------|----------|
| Task 1 RED | PASS — compile error confirmed (module not found) | `tsc` error: `Cannot find module '../review-notes.js'` |
| Task 1 GREEN | PASS | 9/9 tests passing after implementation |
| Task 2 RED | DEVIATION — classifyNote pre-implemented in Task 1 | Tests passed immediately (noted above) |
| Task 2 GREEN | PASS | 15/15 tests passing; 131/131 total suite |

## Known Stubs

None — pure functions with no UI rendering or data-source wiring.

## Threat Flags

None — pure string-processing functions, no I/O, no network, no auth surface.

## Self-Check: PASSED

- `lib/review-notes.ts` — FOUND
- `lib/test/review-notes.test.ts` — FOUND
- Commit d4557ce — FOUND (`feat(07-01): implement selectUnread + markReadName pure helpers`)
- Commit d5c337a — FOUND (`feat(07-01): add classifyNote + wire review-notes.test.js into test:lib`)
- `npm run test:lib` — 131/131 PASS
