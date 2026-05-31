---
phase: 03-extension-skeleton-sw-relay-proof
verified: 2026-05-31T00:00:00Z
status: passed
human_verified: 2026-05-31
human_verified_by: Omer
human_uat_result: "PASS — relay proof (EXT-05) confirmed; notes/0001,0002-*.md written, chip 'sent OK'. 5 UAT bugs fixed. See 03-HUMAN-UAT.md."
score: 10/10 must-haves verified (automated surface)
overrides_applied: 0
human_verification:
  - test: "Popup lists discovered hosts after loading extension in Chrome with a running stickyfix host (npm run host -- --root <dir>)"
    expected: "Popup shows project name, port, status dot, and token input for each host on 39240-39260"
    why_human: "Requires live Chrome extension runtime + running host process; not automatable"
  - test: "Enter Review Mode toggle requests <all_urls> permission and injects chip on the current tab"
    expected: "Chrome permission dialog appears; chip mounts in shadow root at z-index 2147483647 after grant"
    why_human: "Chrome permission dialog + scripting.executeScript require live browser"
  - test: "Chip is draggable and viewport-clamped (EXT-11)"
    expected: "Drag to all four viewport corners; chip clamps and never exits screen. Works on a scrolled page."
    why_human: "Pointer-event drag + viewport clamp requires visual inspection in live browser"
  - test: "Stub Send relay proof on an HTTPS-origin page (Success Criterion 3 / EXT-05)"
    expected: "Clicking Send writes a file named '0001-*.md' in the host's notes dir with 'comment: stickyfix relay proof'; chip shows 'sent ✓ 0001-*.md'"
    why_human: "End-to-end CS→SW→host relay requires live Chrome + live host; file write must be verified on disk"
  - test: "One-time origin dropdown — unknown origin shows dropdown once, never re-asks (EXT-07/EXT-08)"
    expected: "On a tab whose origin is not in any host's origins[] or sfxOriginMap, chip shows a project dropdown. After selecting, chip transitions to labeled view. Reopen on same origin — dropdown never reappears."
    why_human: "Requires live Chrome + host; persisted storage behavior not testable without runtime"
  - test: "State survives SW eviction — registry/tokens/originMap/prefs persist across Chrome restart (EXT-09)"
    expected: "After restarting Chrome, the host list and per-host tokens are still present in the popup; the chip routes the same origin without re-prompting"
    why_human: "SW eviction + Chrome restart requires live browser"
  - test: "Shadow-DOM CSS isolation (EXT-11)"
    expected: "Host page CSS does not affect chip appearance; chip CSS does not affect host page. Verify in DevTools."
    why_human: "CSS isolation is a visual/layout property requiring browser DevTools inspection"
  - test: "Exit (x) unmounts chip and resets popup to 'Enter Review Mode' (EXT-11)"
    expected: "Clicking the x on the chip removes it from the page; popup toggle resets state"
    why_human: "Requires live browser"
  - test: "EXT-02 — chip appears only after toggle, never on other pages"
    expected: "No content_scripts entries in chrome://extensions Details view; chip does not appear without toggling"
    why_human: "Requires chrome://extensions inspection"
---

# Phase 3: Extension Skeleton + SW Relay Proof — Verification Report

**Phase Goal:** The popup lists live hosts discovered by the service worker, lets the developer enter a token and toggle Review Mode, and a dummy SEND_ANNOTATION message travels from the content script through the service worker to the host — proving the SW-as-HTTP-client boundary before any real note UI is built.

**Verified:** 2026-05-31
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pure routing resolution (advertised origin > persisted map > null) is unit-tested and green | VERIFIED | 13/13 routing.test.ts assertions pass (`npm run check` output: 22 lib tests all pass) |
| 2 | Registry reconciliation re-binds a restarted host by name+origin, preserving tokens | VERIFIED | `reconcileRegistry` in `lib/routing.ts` implements name-keyed merge; 5 tests cover EXT-10 scenarios |
| 3 | The built manifest has `host_permissions` = `["http://127.0.0.1/*","http://localhost/*"]` with NO `<all_urls>` | VERIFIED | `manifest.json` confirmed: `"host_permissions":["http://127.0.0.1/*","http://localhost/*"]`; CR-01 hook strips `<all_urls>` |
| 4 | `optional_host_permissions` = `["<all_urls>"]` | VERIFIED | `manifest.json` confirmed: `"optional_host_permissions":["<all_urls>"]` |
| 5 | `content_scripts` is absent / empty (no static injection — EXT-01/02) | VERIFIED | `manifest.json` has `"content_scripts":[]`; build emits `content-scripts/review.js` as runtime-only |
| 6 | A runtime-registered content script is emitted as `content-scripts/review.js` | VERIFIED | Build output shows `content-scripts/review.js` (33.09 kB); `registration: 'runtime'` in `index.ts:19` |
| 7 | ONLY `entrypoints/background.ts` fetches `http://127.0.0.1/*` (SW-as-only-HTTP-client — EXT-05) | VERIFIED | `background.ts:303` is the single `fetch('http://127.0.0.1:...')` call; `popup/main.ts` and `chip.ts` contain zero code-level fetches to localhost (grep confirmed) |
| 8 | `chrome.permissions.request` is the first awaited call in the popup toggle enter branch | VERIFIED | `popup/main.ts:340` — `await chrome.permissions.request({origins:['<all_urls>']})` is first; no storage or tabs calls precede it |
| 9 | lib/routing + lib/discovery node:test cover EXT-04/06/07/08/10 (22 tests green) | VERIFIED | `npm run check` exit 0; 22 lib tests (EXT-04:4, EXT-06:2, EXT-07:2, EXT-08:1, EXT-10:2 + supporting cases) |
| 10 | All 3 review blockers (CR-01/02/03) and 4 warnings (WR-01/02/03/06/07) are fixed, not regressed | VERIFIED | CR-01: `build:manifestGenerated` hook present in `wxt.config.ts`; CR-02: Refresh button in `<header>` (not inside empty-state); CR-03: live `offsetWidth`/`getBoundingClientRect()` in `pointermove` with `Math.max(0,...)` ceiling; WR-01: `Malformed host response` validation in `background.ts:332`; WR-02: `!resp` guards on all 3 callbacks; WR-03: `reason === 'unmapped'` discriminator; WR-06: `typeof raw === 'string' && raw.length < 128`; WR-07: `chrome.tabs.sendMessage(EXIT_REVIEW)` — no CustomEvent |

**Score:** 10/10 automated truths verified

### Deferred Items

None — all must-haves are in scope for Phase 3. WR-04 (eviction TTL) and WR-05 (LIST_HOSTS relay) were explicitly deferred to Phase 4-6 by the fix report and do not affect phase goal achievement.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/types.ts` | Shared types, SfxMessage protocol, AnnotationPayload re-export | VERIFIED | Exists; exports `SFX_MSG`, `HostEntry`, `StorageState`, `SfxMessage`, `SfxResponse` |
| `lib/storage.ts` | WXT `defineItem` storage schema (registry/tokens/originMap/prefs) + `loadStorageState` | VERIFIED | Exists; 4 `defineItem` calls + `loadStorageState` via `Promise.all` |
| `lib/routing.ts` | `resolveRoute` + `reconcileRegistry` — zero chrome/wxt imports | VERIFIED | Exists; grep returns 0 `chrome.`/`from 'wxt'`/`browser.` matches |
| `lib/discovery.ts` | `probePort` + `discoverHosts` — zero chrome/wxt imports | VERIFIED | Exists; grep returns 0 `chrome.`/`from 'wxt'`/`browser.` matches |
| `lib/test/routing.test.ts` | node:test coverage for resolveRoute + reconcileRegistry | VERIFIED | 226 lines; 13 test cases; all pass |
| `lib/test/discovery.test.ts` | node:test coverage for discoverHosts port filtering | VERIFIED | 176 lines; 9 test cases; all pass |
| `tsconfig.lib.json` | node-targeted config for lib, excludes storage.ts | VERIFIED | Exists; double-nesting `dist/lib/lib/` path confirmed in package.json `test:lib` |
| `wxt.config.ts` | Phase 3 permissions + `build:manifestGenerated` hook | VERIFIED | `permissions`, `host_permissions`, `optional_host_permissions`, hook all present |
| `entrypoints/background.ts` | SW message router: discovery, routing, single relay fetch, self-id probe | VERIFIED | Exists; handles `ENTER_REVIEW`, `EXIT_REVIEW`, `GET_ROUTE`, `SEND_ANNOTATION`, `REFRESH_HOSTS`, `SET_ROUTE`, `GET_TAB_ID`; single `fetch('http://127.0.0.1:...')` |
| `entrypoints/popup/main.ts` | Host list render, token persistence, Review Mode toggle | VERIFIED | Exists; `permissions.request` at line 340 (first in enter branch); `sfxTokens.setValue` for persistence |
| `entrypoints/popup/index.html` | Popup DOM with Refresh in header (CR-02 fix) | VERIFIED | `#sfx-refresh-btn` in `<header>` element, NOT inside `#sfx-empty-state` |
| `entrypoints/review.content/index.ts` | `defineContentScript registration:'runtime'` + `createShadowRootUi` | VERIFIED | `registration: 'runtime'` at line 19; `createShadowRootUi` at line 25; EXIT listener via `chrome.runtime.onMessage` (WR-07 fix) |
| `entrypoints/review.content/chip.ts` | Chip DOM, drag+clamp (CR-03 fixed), SEND_ANNOTATION, one-time dropdown, inline confirm/error, Exit | VERIFIED | All present; `reason === 'unmapped'` discriminator; `!resp` null-guards; `makeDraggable` live-width clamp |
| `entrypoints/review.content/styles.css` | Shadow-root CSS (`all:initial`, `z-index:2147483647`, px-only) | VERIFIED | `z-index: 2147483647` at line 23; no `rem` units; `all: initial` in `:host` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib/routing.ts` | `lib/types.ts` | `import type { HostEntry, StorageState }` | WIRED | Line 8 of routing.ts |
| `package.json check` | `lib/test/*.test.js` | `node --test dist/lib/lib/test/...` | WIRED | `test:lib` script confirmed in `npm run check` output |
| `background.ts` | `http://127.0.0.1/annotation` | `fetch(...)` with `X-Stickyfix-Token` | WIRED | Line 303 of background.ts |
| `background.ts` | `lib/routing.ts resolveRoute` | import + call in `handleGetRoute`/`handleSendAnnotation` | WIRED | `resolveRoute(origin, state)` called in both handlers |
| `background.ts` | `lib/storage.ts loadStorageState` | re-read at handler top | WIRED | `await loadStorageState()` at top of each handler |
| `chip.ts` | `background.ts SEND_ANNOTATION` | `chrome.runtime.sendMessage({type: SFX_MSG.SEND_ANNOTATION, ...})` | WIRED | `chip.ts:367` |
| `chip.ts` | `background.ts GET_ROUTE` | `chrome.runtime.sendMessage({type: SFX_MSG.GET_ROUTE, ...})` | WIRED | `chip.ts:137` |
| `chip.ts` | `background.ts SET_ROUTE` | `chrome.runtime.sendMessage({type: SFX_SET_ROUTE, ...})` | WIRED | `chip.ts:300` |
| `popup/main.ts` | `background.ts ENTER_REVIEW` | `chrome.runtime.sendMessage` after permission grant | WIRED | Lines 340+ of main.ts |
| `review.content/index.ts` | `createShadowRootUi` | WXT content-script ctx | WIRED | Line 25 of index.ts |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `background.ts handleSendAnnotation` | `host` (HostEntry with token) | `resolveRoute(origin, state)` reading `loadStorageState()` from chrome.storage.local | Yes — validated shape: `typeof body.file === 'string' && typeof body.serial === 'number'` | FLOWING |
| `lib/routing.ts resolveRoute` | `state.registry`, `state.originMap`, `state.tokens` | `StorageState` from caller (SW re-reads storage on each handler invocation) | Yes — pure function, data comes from storage reads | FLOWING |
| `popup/main.ts` | `registry` (host entries for display) | `sfxRegistry.getValue()` from chrome.storage.local | Yes — real storage read + `sendMessage(REFRESH_HOSTS)` to SW | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `npm run build` exits 0; emits `review.js` + `review.css` | `npm run build` | Exit 0; `content-scripts/review.js` (33.09 kB) + `review.css` (1.48 kB) emitted | PASS |
| Manifest `host_permissions` has no `<all_urls>` | Inspected `manifest.json` | `["http://127.0.0.1/*","http://localhost/*"]` — no `<all_urls>` | PASS |
| Manifest `optional_host_permissions` = `["<all_urls>"]` | Inspected `manifest.json` | `["<all_urls>"]` confirmed | PASS |
| Manifest `content_scripts` is empty | Inspected `manifest.json` | `[]` — runtime-only injection | PASS |
| `npm run check` exits 0: tsc x2 + clean-room + smoke + lib:22 + host:48 = 70 total | `npm run check` | Exit 0; 22 lib + 48 host = 70/70 PASS | PASS |
| `lib/routing.ts` + `lib/discovery.ts` are chrome/wxt-free | `grep -c` chrome./wxt/browser. | 0 matches in both files | PASS |
| ONLY `background.ts` fetches `127.0.0.1` | grep on popup, chip | popup: 0 code fetches (1 comment-only hit); chip: 0 code fetches | PASS |
| `chrome.permissions.request` is first awaited call in enter branch | `popup/main.ts:340` | No storage/tabs calls before it in enter branch | PASS |
| CR-01 hook present in `wxt.config.ts` | Read file | `build:manifestGenerated` hook strips `<all_urls>` from `host_permissions` | PASS |
| CR-02 Refresh button in `<header>` (not empty-state) | Read `index.html` | `#sfx-refresh-btn` at line 15 in `<header>` | PASS |
| CR-03 live clamp: `el.offsetWidth || getBoundingClientRect().width` in `pointermove` | Read `chip.ts:467` | `const w = el.offsetWidth \|\| el.getBoundingClientRect().width \|\| 0` with `Math.max(0, ...)` ceiling | PASS |
| WR-03 `reason === 'unmapped'` discriminator | grep `background.ts:225` + `chip.ts:152` | Both files use typed `reason: 'unmapped'` field, not `startsWith('unmapped:')` | PASS |
| WR-07 EXIT via `chrome.tabs.sendMessage` (not CustomEvent) | `background.ts:159` | `chrome.tabs.sendMessage(tabId, {type: SFX_MSG.EXIT_REVIEW, tabId})` confirmed | PASS |

---

## Probe Execution

Step 7c: SKIPPED — no probe scripts exist at `scripts/*/tests/probe-*.sh` for Phase 3. The phase uses `npm run build` and `npm run check` as its verification mechanism, both run above.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXT-01 | 03-01, 03-03 | MV3 manifest: `activeTab`, `scripting`, `storage`, `tabs`; localhost `host_permissions`; `optional_host_permissions` on demand | SATISFIED | `manifest.json` confirmed; `permissions`, `host_permissions`, `optional_host_permissions` all correct |
| EXT-02 | 03-01, 03-04 | Review UI injected dynamically via `chrome.scripting.executeScript` only; no static `content_scripts` | SATISFIED | `content_scripts: []` in manifest; `registration: 'runtime'` in `index.ts` |
| EXT-03 | 03-03 | Toolbar popup lists discovered hosts with project name, per-host token entry/state, Enter/Exit toggle | SATISFIED (automated); UAT required | `popup/main.ts` renders host entries from registry; token stored via `sfxTokens.setValue` |
| EXT-04 | 03-01, 03-02 | SW probes ports 39240–39260; builds registry from `/status` | SATISFIED | `discovery.ts` PROBE_PORTS 39240-39260; 9 discovery tests pass |
| EXT-05 | 03-02, 03-04 | All localhost fetches route through SW (not content script) | SATISFIED | Only `background.ts:303` fetches `127.0.0.1`; popup and chip have zero code fetches |
| EXT-06 | 03-01, 03-02 | Note routes by active tab's origin to advertising host | SATISFIED | `resolveRoute` step 1 + 2 covered by 13 routing tests; `background.ts` derives origin from `chrome.tabs.get(tabId).url` |
| EXT-07 | 03-01, 03-03, 03-04 | Unknown origin prompts one-time dropdown; `origin → host` persisted | SATISFIED (automated); UAT required | `SET_ROUTE` handler in `background.ts:229`; chip shows dropdown on `reason === 'unmapped'`; persistence via `sfxOriginMap.setValue` |
| EXT-08 | 03-01, 03-02, 03-04 | Same-origin clashes resolved by page self-id (`<meta>`/`window.__stickyfix_project`) | SATISFIED | `handleGetRoute` in `background.ts` runs `scripting.executeScript` for self-id probe; validated `typeof raw === 'string' && raw.length < 128` |
| EXT-09 | 03-01, 03-03 | Registry/tokens/originMap/prefs persist in `chrome.storage.local` | SATISFIED (automated); UAT required | `lib/storage.ts` `defineItem` for all 4 items; persisted on write, read on load |
| EXT-10 | 03-01, 03-02 | On wake: re-discover hosts; re-bind by name+origin when host restarts on new port | SATISFIED | `reconcileRegistry` tested: same-name host updates port, preserves token; SW runs discovery on `ENTER_REVIEW` |
| EXT-11 | 03-04 | Draggable, viewport-clamped chip at `z-index: 2147483647`; connection state + target project/notesDir; Exit button | SATISFIED (automated); UAT required | `styles.css` z-index confirmed; `makeDraggable` clamp present (CR-03 fixed); Exit via `chrome.tabs.sendMessage` |

All 11 EXT requirements declared in PLAN frontmatter are covered.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `lib/routing.ts:77-94` | — | WR-04: Stale hosts never evicted — no TTL or `lastSeen` | Info | Deferred by REVIEW-FIX.md to Phase 4-6; no functional blocker for Phase 3 goal |
| `entrypoints/review.content/chip.ts:266-285` | — | WR-05: Content script reads `sfxRegistry` from `chrome.storage.local` directly (bypasses SW relay) | Info | Deferred by REVIEW-FIX.md; chip has a comment documenting the trade-off; no data-loss risk |

No `TBD`, `FIXME`, or `XXX` debt markers found in phase-modified files. No unreferenced blocking debt.

---

## Human Verification Required

The following require a live Chrome environment with a running stickyfix host:

### 1. Popup Host Discovery (EXT-03 / SC-1)

**Test:** Load the extension in Chrome (`chrome://extensions` → load unpacked `.output/chrome-mv3`). Start a host (`npm run host -- --root <dir>`). Open the popup.
**Expected:** Popup displays a row for the discovered host with project name, port number, a green status dot, and an editable token field. Enter a token and blur — reopen popup and confirm the token is persisted.
**Why human:** Requires live Chrome runtime + running host process; popup rendering is not automatable.

### 2. Review Mode Toggle (EXT-01/02)

**Test:** With a host running and a token entered, navigate to any HTTPS page and click "Enter Review Mode" in the popup.
**Expected:** Chrome shows a permission dialog for `<all_urls>`. After granting, the connection chip appears on the page inside a shadow root. Popup shows "Exit Review Mode".
**Why human:** Chrome permission dialog and `chrome.scripting.executeScript` injection require live browser.

### 3. Stub Send Relay Proof (SC-3 / EXT-05)

**Test:** With the chip visible on an HTTPS-origin page (with a live host and valid token), click the Send button on the chip.
**Expected:** The host's `notes/` directory receives a new file `0001-<timestamp>.md` with frontmatter `comment: stickyfix relay proof`. The chip shows inline `sent ✓ 0001-<timestamp>.md` for ~1.5s. This proves the CS→SW→host relay end-to-end.
**Why human:** Requires live HTTPS page + live host + file-system verification.

### 4. One-Time Origin Dropdown (EXT-07/EXT-08 / SC-5)

**Test:** Navigate to a tab whose origin is not in any host's `origins[]`. Toggle Review Mode.
**Expected:** Chip shows a project dropdown (not a routed label). Select a project. Chip transitions to `→ name · notesDir` label. Close and reopen on the same origin — dropdown must not reappear.
**Why human:** Requires live runtime + storage persistence verification across popup opens.

### 5. State Survives SW Eviction (EXT-09)

**Test:** Enter Review Mode, enter tokens for discovered hosts. Restart Chrome.
**Expected:** On restart, the popup still shows the same hosts with the persisted tokens. The chip on previously-mapped origins does not re-show the dropdown.
**Why human:** SW eviction + Chrome restart requires a live browser session cycle.

### 6. Chip Drag + Clamp + Exit (EXT-11)

**Test:** With the chip mounted, drag it to each viewport corner. Then click the × Exit button.
**Expected:** Chip clamps at every edge — never exits viewport. Exit unmounts chip; popup resets to "Enter Review Mode".
**Why human:** Pointer-event drag behavior and viewport clamping require visual browser verification.

### 7. Shadow-DOM CSS Isolation (EXT-11)

**Test:** With chip mounted, inspect the page in DevTools. Change `body { font-size: 50px }` in the console.
**Expected:** Chip appearance is unaffected (shadow DOM `all: initial` isolation). Chip CSS does not alter host page layout.
**Why human:** CSS isolation is a visual/layout property requiring browser DevTools.

### 8. EXT-02 Runtime-Only Injection

**Test:** Open `chrome://extensions` → stickyfix → Permissions. Check that no page origins are listed as static content script targets.
**Expected:** No content_scripts permissions shown for pages you haven't visited with Review Mode active. The chip appears only after toggling Review Mode.
**Why human:** Requires chrome://extensions inspection.

---

## Gaps Summary

No automated gaps found. All 10 automated must-haves are VERIFIED. The 9 human verification items above are all MANUAL-CHROME scenarios that were explicitly flagged as `[MANUAL-CHROME / HUMAN-UAT]` in the PLAN files and as PENDING in the SUMMARY acceptance criteria tables. They are not failures — they are the UAT gate for this phase.

The 3 critical review blockers (CR-01 `<all_urls>` regression, CR-02 Refresh button unreachable, CR-03 drag clamp off-screen) are all confirmed fixed and not regressed. The 7 warnings addressed by the fix pass (WR-01 through WR-03, WR-06, WR-07, IN-01, IN-02) are all confirmed in place. WR-04, WR-05, and IN-04 were explicitly deferred per the REVIEW-FIX scope decision.

---

_Verified: 2026-05-31_
_Verifier: Claude (gsd-verifier)_
