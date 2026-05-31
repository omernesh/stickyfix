---
phase: 01-scaffold-clean-room-foundation
plan: 02
subsystem: host
tags: [host, typescript, nodejs, esm, parseargs, smoke-test, build-pipeline]

requires:
  - 01-01 (package.json type:module, @types/node installed, host/ dir seam)

provides:
  - tsconfig.host.json: NodeNext ESM tsconfig, target ES2022, outDir dist/host, types:["node"]
  - host/src/index.ts: CLI stub — parseArgs --root/origin/name/notes-dir/port/token, prints startup JSON
  - dist/host/index.js: compiled ESM artifact (gitignored, produced by tsc -p tsconfig.host.json)
  - scripts/host-smoke-test.mjs: spawnSync-based smoke test asserting app=stickyfix and root match

affects:
  - 01-03-clean-room-gate (scripts/ dir established; host-smoke-test.mjs referenced in check chain)
  - package.json check script (tsc -p tsconfig.host.json + node scripts/host-smoke-test.mjs — both now resolvable)
  - Phase 2 (host seam: parseArgs options and JSON startup shape are the contract Phase 2 extends into the real HTTP server)

tech-stack:
  added:
    - "node:util parseArgs (Node stdlib, stable since 18.3) — host CLI arg parsing"
    - "node:path basename (Node stdlib) — derives project name from --root when --name omitted"
    - "node:child_process spawnSync (Node stdlib) — smoke test spawns the host stub"
    - "node:fs mkdtempSync/rmSync/existsSync (Node stdlib) — smoke test temp dir lifecycle"
    - "node:os tmpdir (Node stdlib) — cross-platform temp directory"
  patterns:
    - "tsconfig.host.json (NodeNext) + tsconfig.json (bundler) two-config split in place — both paths verified"
    - "Host stub exits after printing — Phase 2 replaces with long-running server; smoke test designed for Phase 2 upgrade to GET /status"
    - "Pitfall 6 guard: smoke test checks existsSync(dist/host/index.js) before spawn and exits 1 with helpful message"
    - "strict: false in parseArgs supports Phase 2 flags without breaking stub"
    - "Type assertions (as string) required for parseArgs return type under TS6 strict + strict:false combination"

key-files:
  created:
    - tsconfig.host.json
    - host/src/index.ts
    - scripts/host-smoke-test.mjs
  modified: []

key-decisions:
  - "parseArgs strict:false returns string | true | undefined for string options under TS6 — required explicit type assertion (as string) after guard; cleaner than switching to strict:true which would reject unknown Phase 2 flags"
  - "Smoke test does NOT recompile — runs only against already-built dist/host/index.js so compile errors and smoke test errors are separate exit codes (per plan spec)"
  - "host/src/index.ts uses top-level import { basename } from 'node:path' (not inline require()) per RESEARCH Pattern 4 note and environment_notes requirement"

requirements-completed: [BUILD-05]

duration: 8min
completed: 2026-05-31
---

# Phase 01 Plan 02: Host CLI Stub and Smoke Test Summary

**NodeNext-compiled host stub (tsc -> dist/host/index.js) that parses --root via util.parseArgs and prints a JSON startup line {app:"stickyfix",...}, plus a spawnSync-based smoke test that asserts the startup fields and exits 0 — satisfying the host half of BUILD-05**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-31T~01:30Z
- **Completed:** 2026-05-31
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments

- `tsc -p tsconfig.host.json` exits 0 and emits runnable ESM at `dist/host/index.js`
- `node dist/host/index.js --root .` prints `{"app":"stickyfix","name":".","root":".","port":null,"token":null,"notesDir":null}` and exits 0
- `node dist/host/index.js` (no --root) prints `stickyfix-host: --root is required` and exits non-zero
- `node scripts/host-smoke-test.mjs` prints `smoke test: PASS` and exits 0
- Smoke test creates and removes temp dir (sfx-smoke-*) cleanly; no temp artifacts left
- Pitfall 6 guard: smoke test exits 1 with build instructions if `dist/host/index.js` absent

## Task Commits

1. **Task 1: Write tsconfig.host.json and the host CLI stub** - `b5dd165` (feat)
   - tsconfig.host.json, host/src/index.ts; tsc compilation verified
2. **Task 2: Write the spawn-and-assert host smoke test** - `92b18e8` (feat)
   - scripts/host-smoke-test.mjs; smoke test passes against Task 1's compiled artifact

## Files Created/Modified

- `tsconfig.host.json` — NodeNext ESM config: target ES2022, module/moduleResolution NodeNext, outDir dist/host, rootDir host/src, strict:true, types:["node"], esModuleInterop, skipLibCheck, include host/src/**/*.ts
- `host/src/index.ts` — parseArgs stub: options root/origin(multiple)/name/notes-dir/port/token, strict:false; missing --root -> console.error + exit(1); else prints JSON startup line with app:"stickyfix"
- `scripts/host-smoke-test.mjs` — mkdtempSync temp root, spawnSync dist/host/index.js with 5000ms timeout, asserts app==="stickyfix" && root===tmpRoot, rmSync finally, existsSync guard

## Decisions Made

- TS6 + `strict: false` in parseArgs causes the inferred return type for string options to be `string | true | undefined`. After the `if (!values.root)` guard, TypeScript does not narrow the type to `string`. Resolved with explicit `as string` type assertion — more precise than switching to `strict: true` (which would break Phase 2 flags passed through the stub).
- Smoke test deliberately does NOT recompile — it asserts only the smoke-test step, not the compile step. This keeps the two exit codes independent as required by the plan.
- `import { basename } from 'node:path'` at top level (not inline `require()`) — the RESEARCH Pattern 4 note and environment_notes both require this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type assertion required for parseArgs return type under TS6 strict**

- **Found during:** Task 1 (first `tsc -p tsconfig.host.json` invocation)
- **Issue:** `tsc` error TS2345: Argument of type `string | true` is not assignable to parameter of type `string` on `basename(values.root)`. The `parseArgs` `strict: false` option makes TypeScript infer string options as `string | true | undefined` — the boolean case comes from allowing unknown boolean flags to co-exist.
- **Fix:** Added `const root = values.root as string` after the guard, and `values.name as string | undefined` for the name field. Both are guaranteed string by the guard + parseArgs semantics; the assertion is safe.
- **Files modified:** host/src/index.ts (line 22-23)
- **Commit:** b5dd165

---

**Total deviations:** 1 auto-fixed (Rule 1 — type error / bug)
**Impact on plan:** Minimal — type assertion is the idiomatic solution; behavior is identical to the plan spec.

## Issues Encountered

- None beyond the auto-fixed TS type narrowing issue.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 01-03 (clean-room gate) can proceed: `scripts/` dir established, `package.json` check chain references `scripts/clean-room-check.mjs` (not yet created).
- `npm run check` still fails until 01-03 lands `scripts/clean-room-check.mjs` — expected.
- `npm run build` now succeeds: `wxt build && tsc -p tsconfig.host.json` both exit 0.
- Phase 2 seam: `host/src/index.ts` parseArgs options and JSON startup shape are the extension point. Phase 2 replaces the stub body with the real HTTP server.

## Threat Coverage

T-01-05 mitigated: `spawnSync` uses `timeout: 5000` — a hung stub fails fast rather than blocking `npm run check`.
T-01-03, T-01-04 accepted as designed (stub-only phase; no listener, no secrets).

## Self-Check

- [x] tsconfig.host.json exists — FOUND
- [x] host/src/index.ts exists — FOUND
- [x] scripts/host-smoke-test.mjs exists — FOUND
- [x] dist/host/index.js exists (compiled artifact) — FOUND
- [x] Commit b5dd165 exists (Task 1)
- [x] Commit 92b18e8 exists (Task 2)

## Self-Check: PASSED
