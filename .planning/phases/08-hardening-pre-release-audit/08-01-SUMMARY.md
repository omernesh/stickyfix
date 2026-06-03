---
phase: "08-hardening-pre-release-audit"
plan: "01"
subsystem: "lib"
tags: [pure-lib, error-toast, payload-size, tdd, node-test]
dependency_graph:
  requires: []
  provides: ["lib/error-toast.ts mapSendOutcome", "lib/payload-size.ts exceedsBodyCap"]
  affects: ["Wave 1 plan 02 — card.ts consolidation", "Wave 1 plan 02 — Send path pre-flight guard"]
tech_stack:
  added: []
  patterns: ["pure-lib invariant (no top-level chrome/document/window)", "TDD RED/GREEN with node:test"]
key_files:
  created:
    - lib/error-toast.ts
    - lib/test/error-toast.test.ts
    - lib/payload-size.ts
    - lib/test/payload-size.test.ts
  modified:
    - tsconfig.lib.json
    - package.json
decisions:
  - "mapSendOutcome uses discriminated union SendOutcome (ok|channel-dead|relay-error) returning ToastSpec {message, isError}"
  - "exceedsBodyCap uses strict > MAX_BODY_BYTES (boundary inclusive-accept) matching host security.ts exactly"
  - "TextEncoder used as global (no import) — available in both content scripts and Node 20+"
  - "tsconfig.lib.json include[] updated at Task 1/2 time; package.json test:lib explicit list updated in Task 3"
metrics:
  duration: "299s"
  completed_date: "2026-06-04"
  tasks_completed: 3
  files_changed: 6
---

# Phase 8 Plan 01: Pure lib units — error-toast mapper + payload-size pre-flight check

**One-liner:** Pure `mapSendOutcome` mapper (D-01a verbatim card.ts strings) and `exceedsBodyCap` pre-flight check (D-04, strict `>` boundary matching host) — both node:test-covered, wired into `test:lib`, 144/144 pass.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 RED | Failing error-toast tests | 147ad3a | lib/test/error-toast.test.ts |
| 1 GREEN | error-toast mapper implementation | 3a79ae1 | lib/error-toast.ts, tsconfig.lib.json |
| 2 RED | Failing payload-size tests | 7579b0c | lib/test/payload-size.test.ts |
| 2 GREEN | payload-size implementation | 00b1041 | lib/payload-size.ts |
| 3 | Wire both test files into package.json test:lib | 9a2abae | package.json |

## What Was Built

### lib/error-toast.ts (D-01 / D-01a)

Pure `SendOutcome -> ToastSpec` mapper. Exports:
- `SendOutcome` discriminated union: `ok` (file: string), `channel-dead` (lastErrorMessage?: string), `relay-error` (error: string)
- `ToastSpec` interface: `{ message: string; isError: boolean }`
- `mapSendOutcome(o: SendOutcome): ToastSpec`

Reproduces EXACT card.ts D-01a strings verbatim:
- `channel-dead`: `'Extension error: ' + (o.lastErrorMessage ?? 'no response')`
- `relay-error`: `o.error` passed through unchanged
- `ok`: template `` `wrote notes\\${o.file}` `` — single backslash at runtime

Zero top-level chrome/document/window access (comment refs in JSDoc only).

### lib/payload-size.ts (D-04)

Pure encoded-size pre-flight check. Exports:
- `MAX_BODY_BYTES = 12 * 1024 * 1024` (= 12582912, mirrors host/src/security.ts:12)
- `encodedBodyBytes(jsonBody: string): number` — `new TextEncoder().encode(jsonBody).length`
- `exceedsBodyCap(jsonBody: string): boolean` — strict `>` so the exact boundary is accepted (matching host reject comparison)

### tsconfig.lib.json

Added `"lib/error-toast.ts"` and `"lib/payload-size.ts"` to explicit `include[]` array. (The `lib/test/**/*.ts` glob already picks up the new test files for compilation.)

### package.json test:lib

Appended `dist/lib/lib/test/error-toast.test.js` and `dist/lib/lib/test/payload-size.test.js` to the explicit `node --test` file list. The runner does NOT glob (Pitfall 3) — omission would cause silent no-ops.

## Verification

- `npx tsc -p tsconfig.lib.json --noEmit` exits 0
- `npm run test:lib` exits 0, 144 tests pass (131 before + 13 new)
- New test suites explicitly visible in output:
  - `mapSendOutcome — channel-dead` (3 tests)
  - `mapSendOutcome — relay-error` (2 tests)
  - `mapSendOutcome — ok` (2 tests)
  - `MAX_BODY_BYTES` (1 test)
  - `encodedBodyBytes` (2 tests)
  - `exceedsBodyCap` (3 tests)

## Deviations from Plan

None — plan executed exactly as written.

The tsconfig.lib.json addition for both source files was done as part of Task 1/2 implementation (not as separate commits) since tsc needed the include entries to compile the test files. This is correct sequencing and does not deviate from the plan's intent.

## TDD Gate Compliance

- Task 1 RED gate: commit `147ad3a` — test(08-01): add failing error-toast tests
- Task 1 GREEN gate: commit `3a79ae1` — feat(08-01): implement error-toast mapper
- Task 2 RED gate: commit `7579b0c` — test(08-01): add failing payload-size tests
- Task 2 GREEN gate: commit `00b1041` — feat(08-01): implement payload-size check
- No REFACTOR step needed (clean implementation, no dead code)

## Known Stubs

None — both modules are complete implementations with no placeholders.

## Self-Check: PASSED

- [x] lib/error-toast.ts exists and exports mapSendOutcome, SendOutcome, ToastSpec
- [x] lib/payload-size.ts exists and exports MAX_BODY_BYTES, encodedBodyBytes, exceedsBodyCap
- [x] lib/test/error-toast.test.ts exists with verbatim D-01a string assertions
- [x] lib/test/payload-size.test.ts exists with boundary assertions
- [x] tsconfig.lib.json contains "lib/error-toast.ts" and "lib/payload-size.ts"
- [x] package.json test:lib contains error-toast.test.js and payload-size.test.js
- [x] npm run test:lib exits 0 with 144 tests (13 new)
- [x] All TDD RED/GREEN gate commits present in git log
