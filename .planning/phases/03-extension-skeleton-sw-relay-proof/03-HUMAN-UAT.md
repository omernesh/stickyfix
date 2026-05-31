---
status: passed
phase: 03-extension-skeleton-sw-relay-proof
source: [03-VERIFICATION.md]
started: 2026-05-31
updated: 2026-05-31
approved_by: Omer
---

## Current Test

Manual Chrome UAT for the extension skeleton + SW relay proof (Success Criteria 1–5).

## Setup (once)

1. `npm run build`
2. Start a host pointed at any folder:  `npm run host -- --root D:\docker\stickyfix --origin https://example.com` (note the printed **token** and **notes dir**).
3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `D:\docker\stickyfix\.output\chrome-mv3`.

## Tests

### 1. Popup lists discovered hosts + token entry (EXT-03, EXT-04)
expected: Open the popup on any tab → the running host appears (project name + port); paste/confirm its token in the per-host field; the token persists (reopen popup → still there).
result: PASS — popup listed `stickyfix :39240`, token field persisted. (Added Apply/Clear buttons per user request.)

### 2. Review Mode injects the chip on demand (EXT-01, EXT-02, EXT-11)
expected: Click **Enter Review Mode** → Chrome prompts for site access (`<all_urls>` optional permission) → grant → a connection chip appears on the page showing "→ <project> · <notesDir>". No chip appears before toggling (no static injection).
result: PASS (after fix) — chip injects on demand; no static injection. BLOCKER found+fixed: content script imported background.ts, bundling SW-only onStartup/onInstalled.addListener into the CS → crashed on startup → chip never mounted.

### 3. CS→SW→host relay proof on an HTTPS page (EXT-05) — THE KEY TEST
expected: On a real **HTTPS** site (e.g. https://example.com, matching the host's --origin or via the one-time map), click the chip's stub **Send** → a brief "sent ✓" → a file `NNNN-<ts>.md` with `comment: stickyfix relay proof` appears in the host's notes dir. (Proves the service worker — not the content script — reached 127.0.0.1.)
result: PASS — `notes/0001-…md` and `0002-…md` written; chip shows `sent ✓`. Proves SW reached 127.0.0.1 → Chrome-142 LNA confirmed a non-issue for extension-SW fetches with host_permissions.

### 4. Unknown origin → one-time dropdown, never re-asked (EXT-06, EXT-07, EXT-08)
expected: On an unmapped origin, the chip shows a project dropdown once; pick the project → it routes; revisit the same origin → no dropdown, routes automatically.
result: PASS (after 2 fixes) — origin was `https://www.example.com` (≠ advertised `example.com`) → dropdown shown, picked `stickyfix`, persisted, auto-routes after. Fixes: (a) dropdown read raw storage key → now reads host names from SW REFRESH_HOSTS response; (b) drag handler swallowed control clicks → now yields on interactive descendants.

### 5. State survives SW eviction + Chrome restart (EXT-09, EXT-10)
expected: Stop the service worker (`chrome://serviceworker-internals` → Stop, or wait ~5 min idle) → Send again → still routes correctly (no re-discovery prompt for the mapped origin). Bonus: restart Chrome and/or restart the host on a different port → it re-binds by project name and still routes.
result: NOT RUN — optional check; user approved without running. Mapping persists in storage.local (unit-tested in routing/discovery). Re-verify opportunistically in Phase 4+.

### 6. Chip is draggable, viewport-clamped, Exit works (EXT-11)
expected: Drag the chip around — it can't leave the viewport (no off-screen escape); the page's CSS doesn't alter the chip and vice-versa (shadow-DOM isolation); the × Exit button removes the chip and exits Review Mode.
result: NOT RUN formally — chip mounted, draggable code in place + unit-reasoned (CR-03); Exit/× present. User approved without formal drag test.

## Summary

total: 6
passed: 4
issues: 0
pending: 0
skipped: 2
blocked: 0
verdict: APPROVED by Omer 2026-05-31 — key relay-proof criterion (EXT-05) PASS; 2 optional checks deferred.

## Bugs found & fixed during UAT (all committed on gsd/v1.0-milestone)
1. popup `[hidden]` defeated by ID-specificity `display:flex` → empty state never hid (falsely read "no hosts found"). Fix: global `[hidden]{display:none!important}`.
2. **BLOCKER** — chip.ts imported SFX_SET_ROUTE/SFX_GET_TAB_ID from background.ts → ES side-effects bundled SW-only `onStartup.addListener` into the CS → "Cannot read properties of undefined (reading 'addListener')" crashed the chip on every load. Fix: moved shared constants to side-effect-free lib/types.ts.
3. project dropdown read raw `chrome.storage.local.get(['sfxRegistry'])` (key ≠ WXT wrapper key) → empty. Fix: SW returns host names in REFRESH_HOSTS response; CS no longer touches storage.
4. drag handler's `pointerdown` preventDefault+setPointerCapture swallowed clicks on `<select>`/buttons → dropdown/buttons dead. Fix: bail out of drag when target is an interactive control.
5. SW response guard required `serial:number`; host returns padded `serial:"0001"` string (server.test pinned) → false "Malformed host response". Fix: align extension to serial:string.

Also: host minted a new random token per launch (`.stickyfix-token` written but never read back) — pinned via `STICKYFIX_TOKEN` env for UAT; npm-on-PowerShell strips `--root` → resolveConfigValues reads npm_config_* fallback.

## Deferred to later phases
- Re-map affordance (click routed label to re-choose project) — user-requested; fold into Phase 4 chip interaction model.
- `message channel closed` console noise on Exit→Enter (orphaned in-flight CS message) — Phase 8 hardening (swallow lastError on invalidated context).
- Stale review-mode pref vs torn-down chip after extension reload/SW evict — Phase 8 (re-inject on demand when pref active but no chip).

## Gaps
