---
phase: 09-turnkey-onboarding-cross-browser-distribution
plan: "02"
subsystem: extension+host
tags: [native-messaging, bootstrapper, pairing, popup-ui, security]
dependency_graph:
  requires:
    - host/src/native-msg.ts (09-01: sendNativeMessage, readNativeMessages)
    - host/src/bootstrap/register.ts (09-01: registerNativeHost, unregisterNativeHost)
    - host/src/index.ts (09-01: writes .stickyfix-port on startup)
  provides:
    - bin/stickyfix.ts → dist/host/stickyfix-init.cjs (npx stickyfix init|uninstall)
    - host/src/native-host.ts → dist/host/stickyfix-native.cjs (GET_TOKEN responder)
    - entrypoints/background.ts handlePairNative (SW pairing handler)
    - entrypoints/popup/index.html #sfx-pairing-banner (additive section)
    - entrypoints/popup/main.ts pairing state machine (states 1-5)
  affects:
    - lib/types.ts (SFX_MSG.PAIR_NATIVE + MsgPairNative added)
    - wxt.config.ts (nativeMessaging permission added)
    - package.json (bin field + build:host-bin script)
    - tsconfig.host.json (bin/**/*.ts added to include)
tech_stack:
  added: []
  patterns:
    - npx bin entry (package.json bin field → shebang CJS bundle via esbuild)
    - native-host one-shot GET_TOKEN responder (Pitfall 3: process.exit(0) after response)
    - handlePairNative mirrors handleAddHost persist shape (re-read at top, Pitfall 1)
    - popup state machine (states 1-5: not-paired/pairing/paired/failed/returning-user)
    - CSS-only spinner (::before pseudo-element, @keyframes sfx-spin, prefers-reduced-motion)
key_files:
  created:
    - bin/stickyfix.ts
    - host/src/native-host.ts
  modified:
    - package.json
    - tsconfig.host.json
    - wxt.config.ts
    - lib/types.ts
    - entrypoints/background.ts
    - entrypoints/popup/index.html
    - entrypoints/popup/main.ts
    - entrypoints/popup/popup.css
decisions:
  - "bin/stickyfix.ts uses __dirname (available in esbuild CJS output) for absolute stickyfix-native.cjs path — avoids fragile relative paths (Pitfall 4)"
  - "handlePairNative returns {ok:true,name} to let popup show host name in state 3 text"
  - "Popup state machine is button-driven (no auto-fire on open) per UI-SPEC rationale: auto-fire creates flash of 'Pairing…' → 'Failed' on machines without native host registered"
  - "State 4 builds DOM nodes for error text (not innerHTML) — safe with host-provided error strings"
  - "esbuild invoked via 'npx esbuild' in package.json scripts for cross-platform compatibility (avoids node_modules/.bin/ path separator issues on Windows CMD)"
metrics:
  duration: "approximately 30 minutes"
  completed: "2026-06-05"
  tasks_completed: 3
  files_changed: 10
---

# Phase 09 Plan 02: Turnkey Pairing Slice Summary

**One-liner:** Bootstrapper CLI (`npx stickyfix init`) + native-messaging host (GET_TOKEN one-shot) + SW pairing handler (handlePairNative) + popup state machine (states 1-5) — full token-delivery path from bootstrap to green dot with no copy-paste, awaiting live UAT.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | bin/stickyfix.ts bootstrapper CLI + host/src/native-host.ts + esbuild bundles + package.json bin | 00b0fa1 | Done |
| 2 | nativeMessaging manifest perm + SW handlePairNative + PAIR_NATIVE message case | 498d2a7 | Done |
| 3 | popup pairing banner — index.html + main.ts state machine + popup.css (09-UI-SPEC states 1-5) | be90044 | Done |
| 4 | Live pairing UAT | — | CHECKPOINT — awaiting human |

## Verification Results

- `tsc --noEmit`: **0 errors** (both extension and host tsconfigs)
- `npm run build`: **green** (wxt build + tsc + esbuild — 0 errors)
- `npm test` (host): **142/142 pass** (no regression)
- `manifest.json` nativeMessaging permission: **present** (`grep -c nativeMessaging .output/chrome-mv3/manifest.json` = 1)
- `connectNative`/`sendNativeMessage` in content scripts: **0 hits** (ONB-03 grep clean)
- `handleSendAnnotation` origin-from-tab invariant: **preserved** (`chrome.tabs.get` 15 hits in background.ts)
- `createHostServer`/`bindServer`/`.listen(` in native-host.ts non-comment code: **0 hits** (T-09-07)
- esbuild bundles: `dist/host/stickyfix-init.cjs` (6.5kb), `dist/host/stickyfix-native.cjs` (2.5kb)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript `parseArgs` values type is `string | boolean`**
- **Found during:** Task 1 tsc
- **Issue:** `values['extension-id']` has type `string | boolean` — passing directly to `registerNativeHost({ extensionId })` caused TS2345
- **Fix:** Added `typeof rawExtId !== 'string'` guard before use; extracted `const extensionId: string = rawExtId` after narrowing
- **Files modified:** bin/stickyfix.ts
- **Commit:** 00b0fa1

**2. [Rule 3 - Blocking] esbuild node_modules path separator fails on Windows CMD**
- **Found during:** Task 1 build
- **Issue:** `node_modules/.bin/esbuild ...` in npm scripts fails on Windows CMD with "not recognized as internal command"
- **Fix:** Changed to `npx esbuild ...` which resolves correctly cross-platform
- **Files modified:** package.json
- **Commit:** 00b0fa1

## Known Stubs

- `host/src/native-host.ts` PICK_FOLDER branch: responds `{ type:'FOLDER_PICKED', folder: null }` — stub for Plan 04. SW handles `null` gracefully (falls back to existing behavior). Intentional per plan spec ("leave a stub branch ... Plan 04 wires it").

## Threat Flags

No new threat surface beyond plan's `<threat_model>`. Mitigations applied:

| Threat ID | Status |
|-----------|--------|
| T-09-06 (pairing token via native messaging) | Mitigated — sendNativeMessage SW-only (ONB-03 grep clean); manifest allowed_origins pinned to dev extension ID at install time |
| T-09-07 (native host opens no port) | Mitigated — no createHostServer/bindServer/.listen in native-host.ts (0 non-comment hits) |
| T-09-08 (origin-from-tab invariant) | Mitigated — handleSendAnnotation + chrome.tabs.get derivation untouched (15 hits, no regression) |
| T-09-09 (token at rest) | Accepted — token in chrome.storage.local (same posture as Phase 3 manual entry) |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| bin/stickyfix.ts exists | FOUND |
| host/src/native-host.ts exists | FOUND |
| dist/host/stickyfix-init.cjs exists | FOUND |
| dist/host/stickyfix-native.cjs exists | FOUND |
| commit 00b0fa1 (Task 1) | FOUND |
| commit 498d2a7 (Task 2) | FOUND |
| commit be90044 (Task 3) | FOUND |
| npm test 142/142 | PASS |
| tsc --noEmit: 0 errors | PASS |
| npm run build: green | PASS |
| nativeMessaging in manifest | PASS |
| ONB-03 grep (no native API in content scripts) | PASS |
