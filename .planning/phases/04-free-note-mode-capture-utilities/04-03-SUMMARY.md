---
phase: 04-free-note-mode-capture-utilities
plan: 03
subsystem: service-worker-capture
tags: [capture, captureVisibleTab, service-worker, security, anti-spoof]
dependency_graph:
  requires:
    - phase: 04-01
      provides: lib/capture.ts (captureTab, waitTwoRafs, cropToRect) + SFX_CAPTURE_TAB/MsgCaptureTab in types.ts
    - phase: 04-02
      provides: free-note FAB/card/toast UI (D-06 invariant: screenshots stays [])
  provides:
    - entrypoints/background.ts: handleCaptureTab + SFX_CAPTURE_TAB router case
  affects:
    - Phase 5 (element capture +1): consumes handleCaptureTab via SFX_CAPTURE_TAB
    - Phase 6 (region capture +N): consumes cropToRect + SFX_CAPTURE_TAB chain
tech-stack:
  added: []
  patterns:
    - SW-as-sole-captureVisibleTab-caller (INVARIANT B enforced, T-04-09 mitigated)
    - windowId derived from chrome.tabs.get(tabId) never from message body (T-04-07 anti-spoof)
    - return-true async pattern for SFX_CAPTURE_TAB case (Pitfall 1)

key-files:
  created: []
  modified:
    - entrypoints/background.ts (handleCaptureTab + SFX_CAPTURE_TAB import + router case)

key-decisions:
  - "handleCaptureTab uses chrome.tabs.get(tabId) for windowId — never the message body (T-04-07 anti-spoof, Pitfall 8)"
  - "captureVisibleTab appears exactly once in the codebase, inside handleCaptureTab (T-04-09 elevation-of-privilege mitigated)"
  - "case SFX_CAPTURE_TAB returns true synchronously to keep channel open for async response (Pitfall 1)"
  - "handleSendAnnotation and card.ts untouched — D-06 honored, screenshots:[] remains"

requirements-completed: [FREE-01]

duration: ~8min
completed: "2026-05-31"
---

# Phase 4 Plan 3: SW Capture Relay — handleCaptureTab + SFX_CAPTURE_TAB Summary

**SW becomes the sole `captureVisibleTab` caller via a new `handleCaptureTab` handler and `case SFX_CAPTURE_TAB:` router branch — anti-spoof windowId derivation from `chrome.tabs.get`, async `return true` channel kept open, D-06 free-note isolation honored.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-31
- **Completed:** 2026-05-31
- **Tasks:** 1 of 2 completed (Task 2 awaits human integration proof)
- **Files modified:** 1

## Accomplishments

- `handleCaptureTab(tabId)` added to background.ts — derives `windowId` from `chrome.tabs.get`, calls `captureVisibleTab`, returns `{ ok, dataUrl }`
- `SFX_CAPTURE_TAB` and `MsgCaptureTab` imported into background.ts from types.ts
- `case SFX_CAPTURE_TAB:` router branch added before `default:` with mandatory `return true`
- STRIDE threats T-04-07 (spoofing), T-04-08 (info disclosure), T-04-09 (EoP) mitigated by design
- `tsc --noEmit` x2 + `npm run build`: exit 0

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | handleCaptureTab + SFX_CAPTURE_TAB router case | 496f4c8 | entrypoints/background.ts |
| 1b | Security fix — sender-bind SFX_CAPTURE_TAB (T-04 IDOR) | 6736413 | entrypoints/background.ts |
| 2 | Integration proof (manual) | PENDING — awaiting human verification | — |

## Files Created/Modified

- `entrypoints/background.ts` — added 36 lines: `handleCaptureTab` async function, updated import line (SFX_CAPTURE_TAB + MsgCaptureTab), extended router union signature, added `case SFX_CAPTURE_TAB:` branch

## Decisions Made

- `windowId` derived from `chrome.tabs.get(tabId)` not from the message body — a forged `windowId` from a content script cannot redirect the capture to an unintended window (T-04-07).
- `captureVisibleTab` appears exactly once in the codebase (grep-verifiable invariant for T-04-09).
- Router case casts to `(msg as MsgCaptureTab).tabId` — same pattern as existing `MsgSetRoute`/`MsgGetTabId` local interfaces in background.ts.
- Free-note Send (`handleSendAnnotation`, `card.ts`) left completely untouched per D-06.

## Security Fix (post-implementation, automated review)

**Finding (HIGH — Spoofable Message Parameter / cross-tab IDOR):** The initial
`case SFX_CAPTURE_TAB:` branch passed `(msg as MsgCaptureTab).tabId` straight from
the message body into `handleCaptureTab`. A content script running in tab A could
send the `tabId` of tab B and capture a screenshot of an arbitrary tab it does not
control — an Insecure Direct Object Reference across the content-script → SW trust
boundary.

**Mitigation (commit 6736413):** The router now sender-binds the request before
invoking the handler — it returns `{ ok:false, error:'forbidden' }` unless
`sender.tab?.id != null && sender.tab.id === reqTabId`. This restricts a content
script to capturing ONLY its own tab, the same sender-bound trust model already used
by `SFX_GET_TAB_ID`, and consistent with the file's "never trust the message body"
invariant (T-03-01). Note this is defense-in-depth alongside the existing
`windowId`-from-`chrome.tabs.get` anti-spoof inside `handleCaptureTab` (T-04-07):
the router gate prevents a forged tabId from ever reaching the handler.

```typescript
case SFX_CAPTURE_TAB: {
  const reqTabId = (msg as MsgCaptureTab).tabId;
  if (sender.tab?.id == null || sender.tab.id !== reqTabId) {
    sendResponse({ ok: false, error: 'forbidden' });
    return true;
  }
  handleCaptureTab(reqTabId).then(sendResponse).catch(...);
  return true;
}
```

**Verification:** `tsc --noEmit` x2 + `npm run build` + `npm run check` (57 tests) all exit 0.

## Deviations from Plan

None - plan executed exactly as written for Task 1. One post-implementation security
fix applied from automated review (see "Security Fix" section above) — sender-binding
hardens the T-04 IDOR surface without changing the public behavior of a legitimate
same-tab capture request.

## Known Stubs

None. `handleCaptureTab` is fully implemented. The capture trio round-trip (captureTab → SW → captureVisibleTab → waitTwoRafs → cropToRect) cannot be verified automatically — it requires a live Chrome session.

## Threat Flags

None new. Mitigations verified in code:

| Threat | Mitigation | Verification |
|--------|-----------|--------------|
| T-04-07 (Spoofing) | `windowId` from `chrome.tabs.get(tabId)`, never `msg.windowId` | grep: `captureVisibleTab(msg.` returns 0 matches |
| T-04-08 (Info Disclosure) | captureVisibleTab captures only active visible viewport; trio is standalone, not auto-fired | D-06 enforced: card.ts/handleSendAnnotation unchanged |
| T-04-09 (EoP) | captureVisibleTab appears exactly once, inside the SW handler | grep: exactly 1 actual call site in background.ts |
| T-04 IDOR (Cross-tab capture spoofing) | Router sender-binds `reqTabId` to `sender.tab.id` before invoking handler; mismatch → `forbidden` | commit 6736413; a content script can only capture its own tab |

## Checkpoint: Task 2 — Human Integration Proof Required

Task 2 is a `checkpoint:human-verify` gate. The automated portion (Task 1 build + type-check) passed. The round-trip proof requires a live Chrome session:

**Steps:**
1. `npm run build` (done — exit 0), load/reload unpacked extension in `chrome://extensions`
2. Start a host: `npm run host -- --root <test-dir>`, open any HTTPS page, enter Review Mode
3. From DevTools console, invoke the trio:
   - Hide shadow-root UI (`visibility:hidden`)
   - `await waitTwoRafs()`
   - `const url = await captureTab(tabId)` — expect `data:image/png;base64,...`
   - `const cropped = await cropToRect(url, {x:0,y:0,width:200,height:120}, window.devicePixelRatio)`
   - Restore UI (`visibility:''`)
4. Open the dataURL in a new tab — confirm real page pixels, NO stickyfix UI (chip/FAB) visible
5. Send a free note — verify written `.md` file has `screenshots: []`

**Acceptance:** captureTab → SW PNG dataUrl + own-UI absent + DPR-correct crop + free-note screenshots still [].

## Self-Check: PASSED (partial — Task 1 only)

- [x] entrypoints/background.ts modified: FOUND
- [x] `async function handleCaptureTab` in background.ts: FOUND (line 369)
- [x] `chrome.tabs.captureVisibleTab(tab.windowId` in background.ts: FOUND (line 375)
- [x] `captureVisibleTab(msg.` matches: 0 (anti-spoof confirmed)
- [x] `case SFX_CAPTURE_TAB:` branch in router: FOUND (line 477)
- [x] `return true;` after SFX_CAPTURE_TAB case: FOUND (line 483)
- [x] Commit 496f4c8 exists: FOUND
- [x] tsc --noEmit: exit 0
- [x] tsc --noEmit -p tsconfig.host.json: exit 0
- [x] npm run build: exit 0 (156.87 kB)
- [ ] Task 2 integration proof: PENDING human verification
