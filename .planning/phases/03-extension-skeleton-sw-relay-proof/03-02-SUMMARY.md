---
phase: 03-extension-skeleton-sw-relay-proof
plan: "02"
subsystem: extension-sw
tags: [background, service-worker, relay, routing, discovery, mv3, lna, stride]
dependency_graph:
  requires: [03-01]
  provides: [entrypoints/background.ts]
  affects: [03-03, 03-04]
tech_stack:
  added: []
  patterns:
    - "MV3 onMessage return-true async pattern (Pattern 4)"
    - "SW-as-sole-HTTP-client relay (LNA exemption, T-03-04)"
    - "chrome.scripting.executeScript files:[] for on-demand content-script injection"
    - "loadStorageState() re-read at top of every handler (no module-level cache)"
    - "Promise.then(sendResponse).catch(err => sendResponse({ok:false,error})) pattern"
    - "readPageSelfId injected probe via executeScript({func}) for step-3 routing"
    - "SFX_SET_ROUTE added to protocol for one-time dropdown persistence"
key_files:
  created: []
  modified:
    - entrypoints/background.ts
decisions:
  - "chrome.scripting (not browser.scripting) used for executeScript files:[] — WXT restricts browser.scripting.executeScript to ScriptPublicPath[], a generated type that only includes currently-known build outputs; chrome.scripting.executeScript takes string[] without restriction"
  - "A4 CSS fallback included: chrome.scripting.insertCSS(['content-scripts/review.css']) called after executeScript with a try/catch — if the CSS file doesn't exist yet (pre-Plan-04) the catch swallows the error; Plan 03-04 will confirm/remove the fallback after first build"
  - "SFX_SET_ROUTE added as a new message type (string constant 'SFX_SET_ROUTE') — persists origin→hostName to sfxOriginMap after user one-time dropdown selection (EXT-07/EXT-08); exported for Plans 03/04 to import"
  - "ExitReviewResponse typed as {ok:true}|{ok:false;error:string} directly (not SfxResponse<Record<string,never>>) — Record<string,never> intersection with {ok:true} is not assignable due to TypeScript structural typing rules"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-31"
  tasks_completed: 2
  files_created: 0
  files_modified: 1
---

# Phase 03 Plan 02: Service Worker — Discovery, Relay, Routing, Self-ID Probe

**One-liner:** Complete MV3 service worker implementing the SW-as-sole-HTTP-client boundary: discovery+reconcile, message router with 8x return-true async branches, SEND_ANNOTATION relay fetch with X-Stickyfix-Token, GET_ROUTE step-3 page self-id probe, ENTER_REVIEW content-script injection, EXIT_REVIEW unmount, and SFX_SET_ROUTE one-time mapping persistence.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1+2 | Full SW implementation (skeleton + relay) | 39b5190 | entrypoints/background.ts |

(Tasks 1 and 2 both target the same file; all work landed in one commit after joint verification — `tsc --noEmit` + `npm run check` both green.)

## Message Protocol (Final — for Plans 03/04)

Plans 03 and 04 MUST use these exact constants:

```typescript
import { SFX_MSG } from '../lib/types.js';
import { SFX_SET_ROUTE } from '../entrypoints/background.js';

// From lib/types.ts:
SFX_MSG.ENTER_REVIEW    // 'SFX_ENTER_REVIEW'   → EnterReviewResponse
SFX_MSG.EXIT_REVIEW     // 'SFX_EXIT_REVIEW'     → ExitReviewResponse
SFX_MSG.GET_ROUTE       // 'SFX_GET_ROUTE'       → RouteResponse
SFX_MSG.SEND_ANNOTATION // 'SFX_SEND_ANNOTATION' → AnnotationResponse
SFX_MSG.REFRESH_HOSTS   // 'SFX_REFRESH_HOSTS'   → RefreshResponse

// Added in this plan:
SFX_SET_ROUTE           // 'SFX_SET_ROUTE'       → {ok:true,host:HostEntry}|{ok:false,error}
```

## SfxResponse Shapes (for Plans 03/04)

These are the exact shapes popup and content script should expect from `chrome.runtime.sendMessage`:

```typescript
// REFRESH_HOSTS
type RefreshResponse = { ok: true; count: number } | { ok: false; error: string };

// ENTER_REVIEW
type EnterReviewResponse =
  | { ok: true; route: HostEntry | null }   // null = no host mapped yet (show dropdown)
  | { ok: false; error: string };

// EXIT_REVIEW
type ExitReviewResponse = { ok: true } | { ok: false; error: string };

// GET_ROUTE
type RouteResponse =
  | { ok: true; host: HostEntry; mapped?: boolean }  // mapped=true when step-3 probe persisted
  | { ok: false; error: string };                    // error starts with "unmapped:" for dropdown trigger

// SEND_ANNOTATION
type AnnotationResponse =
  | { ok: true; file: string; serial: number }   // from host 200 response
  | { ok: false; error: string };                // host down / 401 / 400 / 413 / unmapped

// SFX_SET_ROUTE
type SetRouteResponse =
  | { ok: true; host: HostEntry }
  | { ok: false; error: string };
```

**Dropdown trigger detection for GET_ROUTE:**
```typescript
const resp = await chrome.runtime.sendMessage({ type: SFX_MSG.GET_ROUTE, tabId, origin });
if (!resp.ok && resp.error.startsWith('unmapped:')) {
  // show one-time host selection dropdown
}
```

## A4 CSS Injection (Carry-Forward to Plan 03-04)

**Current state:** `chrome.scripting.insertCSS({ target: { tabId }, files: ['content-scripts/review.css'] })` is called in ENTER_REVIEW with a try/catch. If the file exists in the extension bundle, it will be injected. If not (pre-04), the error is swallowed.

**Plan 03-04 action:** After building the `review.content/` entrypoint for the first time, inspect `.output/chrome-mv3/content-scripts/review.css`. If present and WXT auto-injects it via `cssInjectionMode:'ui'`, remove the `insertCSS` call from `background.ts`. If not auto-injected, keep it.

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `npx tsc --noEmit` exits 0 | PASS | Clean exit |
| `npm run check` exits 0 | PASS | 70/70 tests (22 lib + 48 host) |
| No module-scope mutable registry/token variables | PASS | `grep "^let\|^var" background.ts` → 0 matches |
| Every async onMessage branch returns true | PASS | 8 `return true` statements (6 message types + consistent) |
| `refreshHosts()` persists via `sfxRegistry.setValue()` | PASS | Line 78 |
| SEND_ANNOTATION derives origin from `chrome.tabs.get(tabId).url` | PASS | Lines 270-274 |
| X-Stickyfix-Token header in relay fetch | PASS | Line 297 |
| Sole localhost fetcher (no 127.0.0.1 fetch outside background.ts) | PASS | grep entrypoints/ → only background.ts |
| Host-down / 401 / unmapped-origin return {ok:false,error} | PASS | All error paths wrapped |
| MANUAL-CHROME: dummy Send writes .md on HTTPS-origin page | PENDING | Human-UAT required (Phase 3 UAT gate) |
| MANUAL-CHROME: SW re-routes after idle eviction | PENDING | Human-UAT required (Phase 3 UAT gate) |

## Deviations from Plan

**1. [Rule 3 - Blocking] Used chrome.scripting instead of browser.scripting for files-based executeScript**
- **Found during:** Task 2 — tsc reported error TS2322 on `files: ['content-scripts/review.js']`
- **Issue:** WXT's `browser.scripting.executeScript` restricts `files[]` to `ScriptPublicPath[]`, a generated union of currently-known build outputs. `content-scripts/review.js` is not yet in that union (the `review.content/` entrypoint doesn't exist until Plan 03-04).
- **Fix:** Switched to `chrome.scripting.executeScript` and `chrome.scripting.insertCSS` which accept `string[]` directly.
- **Files modified:** `entrypoints/background.ts`
- **Commit:** 39b5190

**2. [Rule 1 - Bug] Fixed ExitReviewResponse type incompatibility**
- **Found during:** Task 1 — `SfxResponse<Record<string,never>>` intersection with `{ok:true}` fails TypeScript structural typing (Property 'ok' incompatible with index signature in Record<string,never>)
- **Fix:** Typed `ExitReviewResponse` as `{ok:true}|{ok:false;error:string}` directly.
- **Files modified:** `entrypoints/background.ts`
- **Commit:** 39b5190

## STRIDE Mitigations Implemented

| Threat ID | Mitigation | Location |
|-----------|-----------|---------|
| T-03-01 | `chrome.tabs.get(tabId).url` → `new URL(tab.url).origin` in SEND_ANNOTATION, GET_ROUTE, ENTER_REVIEW, EXIT_REVIEW — never trusts origin from message body | Lines 112, 179, 230, 270 |
| T-03-02 | Token read from `chrome.storage.local` inside SW; attached in SW fetch; never in content-script response | Lines 264, 297 |
| T-03-04 | `fetch('http://127.0.0.1:...')` exists only in `background.ts`; grep-confirmed zero instances in other entrypoints | grep result NONE |

## Known Stubs

- `ENTER_REVIEW` injects `content-scripts/review.js` which does not exist yet (Plan 03-04 creates it). ENTER_REVIEW will throw a Chrome scripting error until Plan 03-04 ships.
- `EXIT_REVIEW` dispatches `sfx-exit-review` CustomEvent — the content script listener for this event is implemented in Plan 03-04.
- `readPageSelfId` probe via `executeScript({func})` is complete and functional; it will silently fail on pages that block scripting (catch swallowed).

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surfaces beyond what was planned.

## Self-Check: PASSED

- entrypoints/background.ts: EXISTS (429 lines, replacing 7-line placeholder)
- Commit 39b5190: EXISTS (`git log --oneline -1`)
- `npx tsc --noEmit`: EXITS 0
- `npm run check`: EXITS 0 (70/70 tests)
- Sole localhost fetcher grep: CONFIRMED (no 127.0.0.1 outside background.ts in entrypoints/)
- `return true` count: 8 (covers all 6 message types + SFX_SET_ROUTE)
- `sfxRegistry.setValue` in refreshHosts: CONFIRMED line 78
- `X-Stickyfix-Token` in relay fetch: CONFIRMED line 297
- origin from `chrome.tabs.get(tabId).url`: CONFIRMED (not from msg body)
