---
phase: 09-turnkey-onboarding-cross-browser-distribution
plan: "01"
subsystem: host
tags: [native-messaging, stdio-framing, bootstrap, manifest-writer, folder-picker, security]
dependency_graph:
  requires: []
  provides:
    - host/src/native-msg.ts (encodeNativeMessage, decodeNativeMessages, sendNativeMessage, readNativeMessages)
    - host/src/bootstrap/register.ts (nativeManifestPath, buildManifest, writeManifest, registerNativeHost, unregisterNativeHost, enumerateArtifacts)
    - host/src/folder-picker.ts (buildPickerArgs, pickFolder)
    - <root>/.stickyfix-port written by HTTP host on startup
  affects:
    - host/src/index.ts (additive: writes .stickyfix-port)
tech_stack:
  added: []
  patterns:
    - Chrome native messaging 4-byte LE stdio framing (Buffer-only writes, Pitfall 2)
    - Per-OS manifest path resolution (darwin/linux/win32 switch)
    - HKCU-only Windows registry write via execFileSync('reg', [...]) (T-09-03)
    - execFile (never exec) static arg arrays for OS dialogs (T-09-01)
    - PowerShell single-quote escape for title in FolderBrowserDialog command
key_files:
  created:
    - host/src/native-msg.ts
    - host/src/bootstrap/register.ts
    - host/src/folder-picker.ts
    - host/test/native-host.test.ts
    - host/test/bootstrapper.test.ts
  modified:
    - host/src/index.ts
decisions:
  - "decodeNativeMessages uses a position variable (not buf=buf.slice) to avoid TypeScript 6 Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer> type mismatch"
  - "metacharacter tests for PowerShell args exclude $ and ; (legitimate PowerShell syntax) — injection safety is structural (execFile, no shell) not regex-based"
  - "buildPickerArgs returns {cmd, args} pair so callers can use execFile independently and tests can inspect without spawning processes"
  - "unregisterNativeHost accepts optional manifestPath override so tests can exercise file deletion without touching real OS paths"
  - "enumerateArtifacts returns {paths, registryKeys} struct — makes downstream uninstall code typed and the test assertions explicit"
metrics:
  duration: "727s"
  completed: "2026-06-05T00:30:14Z"
  tasks_completed: 3
  files_changed: 6
---

# Phase 09 Plan 01: Native Messaging Foundation Summary

**One-liner:** 4-byte LE stdio framing, manifest writer with per-OS path resolution and Windows HKCU registry, no-shell folder-picker arg builder, and HTTP-host port-file write — all proven by 44 new node:test tests.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | native-msg.ts stdio framing + tests (TDD) | fdf6687 (RED), 3c888a9 (GREEN) | Done |
| 2 | bootstrap/register.ts + folder-picker.ts + tests (TDD) | 7e55b45 (RED), 7d71e0e (GREEN) | Done |
| 3 | HTTP host writes .stickyfix-port on startup | f840728 | Done |

## Verification Results

- `npm test` (host): **142/142 pass** (includes 44 new tests from this plan)
- `tsc --noEmit -p tsconfig.host.json`: **0 errors**
- `node scripts/host-smoke-test.mjs`: **PASS** (startup contract unchanged)
- `.stickyfix-port` written correctly and verified: PASS
- Buffer-only stdout writes confirmed: `grep -v '^\s*//' host/src/native-msg.ts | grep -c "stdout.write('"` = 0
- No `exec` calls: only `execFile`/`execFileSync` in child_process imports
- No `shell:` option anywhere in folder-picker.ts or register.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript 6 Buffer generic type mismatch**
- **Found during:** Task 1 GREEN phase
- **Issue:** `buf = rest` assignment where `decodeNativeMessages` returns `Buffer<ArrayBufferLike>` but `buf` was typed as `Buffer<ArrayBuffer>` — TS 6 strict generic checking
- **Fix:** Changed `decodeNativeMessages` to use a `pos` counter (no `buf.slice` reassignment); used `Buffer.from(rest)` at call sites; test's `accumulated = Buffer.from(rest)` for same reason
- **Files modified:** host/src/native-msg.ts, host/test/native-host.test.ts
- **Commit:** 3c888a9

**2. [Rule 1 - Bug] Path separator cross-platform mismatch in tests**
- **Found during:** Task 2 GREEN phase — tests run on Windows where `path.join('/home/testuser', ...)` produces `\home\testuser\...` (backslash prefix)
- **Fix:** Normalized test assertions to use `result.replace(/\\/g, '/')` before comparing with forward-slash literals
- **Files modified:** host/test/bootstrapper.test.ts
- **Commit:** 7d71e0e (test fix included)

**3. [Rule 1 - Bug] Metacharacter regex false-positives for PowerShell**
- **Found during:** Task 2 GREEN phase
- **Issue:** Test regex `[&|;<>\`$!\\]` included `$` and `;` — these appear legitimately in the PowerShell `-Command` arg (e.g., `$d = New-Object ...`). The security invariant is structural (`execFile` = no shell) not regex-based.
- **Fix:** Rewrote buildPickerArgs tests to check: (1) args is an array, (2) cmd is a fixed binary, (3) title with single quotes gets `''` escape, (4) no backtick injection, (5) no `cmd /c` or `/bin/sh` shell fallback patterns. Removed the overly broad metachar scan.
- **Files modified:** host/test/bootstrapper.test.ts
- **Commit:** 7d71e0e (test fix included)

## Known Stubs

None. All exports are fully implemented.

## Threat Flags

No new threat surface beyond what is in the plan's `<threat_model>`. All mitigations applied:

| Threat ID | Status |
|-----------|--------|
| T-09-01 (folder-picker execFile, fixed args) | Mitigated — execFile only, static arg arrays, no shell |
| T-09-02 (manifest path absolute) | Mitigated — resolve() always used in buildManifest |
| T-09-03 (Windows HKCU only) | Mitigated — HKCU keys only, execFileSync |
| T-09-04 (.stickyfix-port disclosure) | Accepted — mode 0o600, non-secret (also on stdout) |
| T-09-05 (enumerateArtifacts completeness) | Mitigated — unit-tested to include all init artifacts |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| host/src/native-msg.ts exists | FOUND |
| host/src/bootstrap/register.ts exists | FOUND |
| host/src/folder-picker.ts exists | FOUND |
| host/test/native-host.test.ts exists | FOUND |
| host/test/bootstrapper.test.ts exists | FOUND |
| commit fdf6687 (RED native-msg) | FOUND |
| commit 3c888a9 (GREEN native-msg) | FOUND |
| commit 7e55b45 (RED bootstrapper) | FOUND |
| commit 7d71e0e (GREEN bootstrapper) | FOUND |
| commit f840728 (.stickyfix-port) | FOUND |
| npm test: 142/142 pass | PASS |
| tsc --noEmit: 0 errors | PASS |
| smoke test: PASS | PASS |
