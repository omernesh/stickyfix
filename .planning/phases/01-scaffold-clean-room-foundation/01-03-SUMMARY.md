---
phase: 01-scaffold-clean-room-foundation
plan: 03
subsystem: infra
tags: [clean-room, build-pipeline, grep-gate, gitignore, windows, cross-platform]

requires:
  - 01-01 (package.json check chain, scripts/ dir, .gitignore base)
  - 01-02 (tsconfig.host.json, host/src/index.ts, dist/host/index.js, scripts/host-smoke-test.mjs)

provides:
  - scripts/clean-room-check.mjs: Node ESM walk, BANNED=[__opc_, opencode, JodusNodus], SKIP_DIRS+SKIP_FILENAMES, exit 1 on violation
  - Verified npm run build: wxt build + tsc -p tsconfig.host.json -> .output/chrome-mv3/ + dist/host/index.js, exit 0
  - Verified npm run check: tsc --noEmit + tsc -p tsconfig.host.json --noEmit + clean-room PASS + smoke test PASS, exit 0
  - .gitignore already complete from 01-01 (no changes needed in 01-03)

affects:
  - All future phases (clean-room gate runs on every npm run check from here forward)
  - BUILD-04 is now structurally enforced on every run, not a one-time check

tech-stack:
  added:
    - "node:fs readdirSync/readFileSync (Node stdlib) — recursive source tree walk in clean-room-check.mjs"
    - "node:path join/extname (Node stdlib) — cross-platform path handling in clean-room-check.mjs"
  patterns:
    - "Banned patterns split into string fragments (e.g. 'Jodus'+'Nodus') so the gate script does not self-trip when scanning its own source"
    - "SKIP_FILENAMES set for root-level attribution/legal docs (PRD.md, README.md, CLAUDE.md, LICENSE) that legitimately reference the upstream project"
    - "SKIP_DIRS covers node_modules,.git,.output,dist,.wxt,.planning — all build output and research dirs excluded"
    - "Gate proven fail-closed via explicit RED (planted token -> exit non-zero) + GREEN (clean tree -> exit 0) verification before commit"

key-files:
  created:
    - scripts/clean-room-check.mjs
  modified: []

key-decisions:
  - "Banned pattern strings split into fragments in clean-room-check.mjs source to prevent the gate from self-tripping when it scans its own .mjs file (the scanner is itself a scanned file)"
  - "SKIP_FILENAMES added for PRD.md/README.md/CLAUDE.md/LICENSE — these root-level docs reference the upstream project for attribution/legal notice (same rationale as .planning/ SKIP_DIR per Pitfall 5)"
  - ".gitignore already complete from plan 01-01 — no changes required in 01-03; .output/, dist/, .wxt/, node_modules/, .stickyfix-token all present"

requirements-completed: [BUILD-01, BUILD-04, BUILD-05]

duration: 6min
completed: 2026-05-31
---

# Phase 01 Plan 03: Clean-Room Gate and Full Pipeline Verification Summary

**Cross-platform Node ESM grep gate (scripts/clean-room-check.mjs) that walks the source tree and exits 1 on any banned upstream identifier (__opc_/opencode/JodusNodus), proven fail-closed via RED+GREEN, with npm run build and npm run check both green end-to-end on Windows**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-31
- **Completed:** 2026-05-31
- **Tasks:** 2 automatable (Task 3 = human-verify checkpoint, deferred per --auto flag)
- **Files modified:** 1 (created)

## Accomplishments

- `scripts/clean-room-check.mjs` implemented: recursive readdirSync walk, BANNED patterns split into fragments, SKIP_DIRS + SKIP_FILENAMES guards, exit 1 on violation / exit 0 on clean tree
- RED proven: planted `__sfx_clean_room_probe.ts` containing "JodusNodus" -> gate exited non-zero and named the offending file in output
- GREEN proven: probe removed -> gate exited 0 and printed `clean-room audit: PASS — no banned identifiers found`
- `npm run build` exits 0: wxt build produces .output/chrome-mv3/manifest.json (MV3, 4 icon sizes, background service_worker, popup action) + tsc -p tsconfig.host.json produces dist/host/index.js
- `npm run check` exits 0: tsc --noEmit (extension) + tsc --noEmit -p tsconfig.host.json (host) + clean-room PASS + smoke test PASS — all four steps green on Windows

## Task Commits

1. **Task 1: Implement cross-platform clean-room grep gate** - `3071f23` (feat)
   - scripts/clean-room-check.mjs: BANNED patterns, SKIP_DIRS, SKIP_FILENAMES, RED+GREEN verified
2. **Task 2: Finalize .gitignore and verify full pipeline** - (no commit — .gitignore already complete from 01-01; pipeline verified via npm run build + npm run check, both exit 0)

## Files Created/Modified

- `scripts/clean-room-check.mjs` — Node ESM gate: walks process.cwd(), skips build outputs and attribution docs, tests 3 BANNED patterns (case-insensitive), prints violation per file, exits 1 on any hit or 0 + PASS on clean tree

## Decisions Made

- Banned pattern strings are split into concatenated fragments (`'Jodus' + 'Nodus'`) so the gate does not self-trip when scanning its own source file (the .mjs file is within the scanned tree since `scripts/` is first-party source).
- `SKIP_FILENAMES` added for root-level attribution/legal docs: PRD.md, README.md, CLAUDE.md, LICENSE. These documents reference the upstream GPL-3.0 project by name for attribution purposes — the same reason `.planning/` is in `SKIP_DIRS` (Pitfall 5). The legal obligation to name the upstream does not create a clean-room violation.
- .gitignore required no changes in this plan — it was finalized in plan 01-01 with all required entries: `.output/`, `dist/`, `.wxt/`, `node_modules/`, `.stickyfix-token`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Self-tripping gate: script contained literal banned identifiers in comments**

- **Found during:** Task 1 (first RED+GREEN verification)
- **Issue:** Initial version of clean-room-check.mjs included comments with `__opc_`, `OpenCode`, and `JodusNodus` written verbatim. Since `scripts/` is scanned first-party source, the script flagged itself, causing the GREEN (clean tree) test to fail.
- **Fix:** (a) Rewrote comments to not contain the banned strings verbatim. (b) Changed regex construction from `new RegExp('JodusNodus', 'i')` to `new RegExp('Jodus' + 'Nodus', 'i')` (and similarly for the other two patterns) — concatenated fragments match at runtime but do not contain the full banned token in source.
- **Files modified:** scripts/clean-room-check.mjs
- **Commit:** 3071f23 (incorporated into the initial commit after fix)

**2. [Rule 1 - Bug] PRD.md and README.md contain banned identifiers for attribution/legal notice**

- **Found during:** Task 1 (first RED+GREEN verification)
- **Issue:** PRD.md references "JodusNodus/opencode-chrome-annotation" as the upstream GPL project being studied. README.md contains a clean-room attribution notice naming the same project. Both files are `.md` files at the repo root and would be scanned by the gate.
- **Fix:** Added a `SKIP_FILENAMES` set to the gate for root-level documentation files (PRD.md, README.md, CLAUDE.md, LICENSE). Same rationale as `.planning/` in `SKIP_DIRS` (Pitfall 5): attribution is a legal obligation, not a clean-room violation. First-party source files (entrypoints/, host/, scripts/, tsconfig*, wxt.config.ts) are still fully scanned.
- **Files modified:** scripts/clean-room-check.mjs
- **Commit:** 3071f23 (incorporated into the initial commit after fix)

**3. [Deviation] .gitignore required no changes in 01-03**

- **Found during:** Task 2 (read .gitignore before modifying)
- **Issue:** The .gitignore from plan 01-01 already contained all entries listed in RESEARCH Pattern 8: `.output/`, `dist/`, `.wxt/`, `node_modules/`, `.stickyfix-token`, `.DS_Store`, `Thumbs.db`, editor dirs, and project-specific rules (notes/, private/, .claude/).
- **Outcome:** No changes were needed; Task 2 was a pure verification pass. Documented as a deviation (no-op task) rather than a bug fix.

---

**Total deviations:** 2 auto-fixed (Rule 1 — bugs), 1 informational (no-op .gitignore)
**Impact on plan:** Auto-fixes required; behavior is exactly as specified. No scope creep.

## Manual Verification Required (Checkpoint 3 — Deferred per --auto flag)

**Status:** PENDING — awaiting human verification

**What was automated:**
- `npm run build` exits 0 — `.output/chrome-mv3/manifest.json` exists with correct icon refs (`/icon/16.png` through `/icon/128.png`), MV3 background service_worker, and popup action.

**What requires manual Chrome verification (BUILD-02):**
1. Run `npm run build` (if not already run). Confirm exit 0.
2. Open Chrome, navigate to `chrome://extensions`.
3. Enable "Developer mode" (top-right toggle).
4. Click "Load unpacked" and select: `D:\docker\stickyfix\.output\chrome-mv3`
5. Confirm the extension appears as "stickyfix" with NO manifest errors (no red error box).
6. Confirm the stickyfix icon renders in the extensions list (pin it — confirm a toolbar icon shows).
7. Clicking the toolbar icon should open the placeholder popup (shows "stickyfix — loading...").

**Resume signal:** Type "approved" if the extension loads with no errors and icons render, or describe the manifest error / missing icon you see.

## Build Outputs

- `.output/chrome-mv3/manifest.json` (352 B) — MV3 manifest, 4 icon sizes, background.js service worker, popup.html action
- `.output/chrome-mv3/popup.html` (417 B)
- `.output/chrome-mv3/background.js` (2.67 kB)
- `.output/chrome-mv3/icon/16.png`, 32.png, 48.png, 128.png
- `dist/host/index.js` — NodeNext ESM, compiled from host/src/index.ts

## Issues Encountered

- None beyond the auto-fixed self-tripping and attribution-file issues above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full BUILD-01/BUILD-04/BUILD-05 gate passes on Windows: `npm run build` + `npm run check` both green.
- Phase 1 scaffold is complete pending the manual Chrome load-unpacked verification (BUILD-02, checkpoint 3).
- Phase 2 (host HTTP server) can proceed once the Chrome checkpoint is approved — the host seam (parseArgs options, JSON startup shape) and the check/build pipeline are all stable.

## Threat Coverage

- T-01-06 mitigated: clean-room-check.mjs runs on every `npm run check`; fail-closed behavior proven via RED+GREEN.
- T-01-07 mitigated: `.stickyfix-token` and `private/` in .gitignore; no tokens in Phase 1 code.
- T-01-08 mitigated: SKIP_DIRS limited to build/vendor/research dirs; all first-party source is scanned; RED test proves the gate actually fails on a planted token.

## Self-Check

- [x] scripts/clean-room-check.mjs exists at D:\docker\stickyfix\scripts\clean-room-check.mjs
- [x] Commit 3071f23 exists (Task 1: clean-room-check.mjs)
- [x] npm run build exits 0 (.output/chrome-mv3/manifest.json and dist/host/index.js verified)
- [x] npm run check exits 0 (all four steps: tsc extension, tsc host, clean-room PASS, smoke test PASS)
- [x] .gitignore contains .output/, dist/, .wxt/, node_modules/, .stickyfix-token
- [x] No probe file remaining in tree (confirmed by GREEN passing)

## Self-Check: PASSED

---
*Phase: 01-scaffold-clean-room-foundation*
*Completed: 2026-05-31*
