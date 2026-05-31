---
phase: 03-extension-skeleton-sw-relay-proof
plan: "03"
subsystem: ui
tags: [popup, chrome-extension, storage, mv3, permissions, vanilla-dom, wxt]

requires:
  - phase: 03-01
    provides: lib/types.ts (SFX_MSG constants, HostEntry, SfxMessage, sfxTokens/sfxRegistry/sfxPrefs), lib/storage.ts
  - phase: 03-02
    provides: background.ts SW message handlers (ENTER_REVIEW, EXIT_REVIEW, GET_ROUTE, REFRESH_HOSTS response shapes)

provides:
  - "entrypoints/popup/index.html — full popup scaffold (header, host-list, empty-state, toggle, routing line)"
  - "entrypoints/popup/main.ts — host-list render, token persistence via sfxTokens.setValue, Review Mode toggle with permission-gesture ordering, routing line via GET_ROUTE"
  - "entrypoints/popup/popup.css — 320px neutral functional-minimal popup styling"

affects: [03-04, 06-visual-design-pass]

tech-stack:
  added: []
  patterns:
    - "Vanilla DOM via createElement/textContent — no innerHTML with host-provided strings (XSS surface avoided)"
    - "chrome.permissions.request(<all_urls>) as FIRST awaited call in ENTER branch of toggle handler (Pattern 3 / Pitfall 3)"
    - "sfxTokens.getValue() + sfxTokens.setValue() for per-host token persistence (EXT-09)"
    - "EXIT branch returns before reaching permissions.request; ENTER branch calls it first"
    - "Popup reads chrome.storage.local directly for display; SW owns all writes and HTTP"

key-files:
  created:
    - entrypoints/popup/popup.css
  modified:
    - entrypoints/popup/index.html
    - entrypoints/popup/main.ts

key-decisions:
  - "EXIT path in toggle handler runs before the ENTER guard — reviewModeActive flag gates which branch executes, so permissions.request is never preceded by awaits on the ENTER path"
  - "Connection dots default to grey (stale) in popup — true reachability requires a REFRESH_HOSTS cycle; SW owns probing, popup owns display"
  - "Token persistence: on blur AND on Enter key (via tokenInput.blur() delegation) — both trigger sfxTokens.setValue"
  - "loadReviewState() reads sfxPrefs.reviewMode[tabId] on open to initialize toggle label — but this runs AFTER the toggle handler is registered, so no gesture-chain risk"
  - "sfxPrefs.reviewMode keyed by String(tabId) — consistent with background.ts which uses tabId numerically but sfxPrefs accepts string keys"

requirements-completed: [EXT-03, EXT-07, EXT-09]

duration: ~15 min
completed: 2026-05-31
---

# Phase 03 Plan 03: Action Popup — Host List, Token Persistence, Review Mode Toggle Summary

**Vanilla-DOM popup (~320px) listing SW-discovered hosts with per-host token inputs that persist to chrome.storage.local, a GET_ROUTE routing line, and a Review Mode toggle where chrome.permissions.request(<all_urls>) is the first awaited call in the ENTER branch.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-31T05:00:00Z
- **Completed:** 2026-05-31T05:15:00Z
- **Tasks:** 2 (combined into 1 commit — both target main.ts)
- **Files modified:** 3

## Accomplishments

- Full popup DOM: header wordmark + host-count summary, host rows (name bold, port, grey/green connection dot, monospace token input), empty state with CLI hint + Refresh button, Review Mode toggle button, routing line section
- Token persistence: each token input's blur/Enter fires `sfxTokens.getValue()` → sets `allTokens[name] = value` → `sfxTokens.setValue(allTokens)` — survives popup close and reopen (EXT-09)
- Permission-gesture constraint satisfied: the ENTER branch of the toggle click handler calls `chrome.permissions.request({origins:['<all_urls>']})` as its first `await` — no storage or tabs call precedes it on that path
- Routing line queries active tab + sends SFX_GET_ROUTE → renders "→ name · notesDir" or "unmapped — pick on page"
- `tsc --noEmit` + `npm run build` + `npm run check` all exit 0; 70/70 tests pass (22 lib + 48 host)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1+2 | Popup DOM + host list + token persistence + routing line + Review Mode toggle | b24ddcb | entrypoints/popup/index.html, entrypoints/popup/main.ts, entrypoints/popup/popup.css |

(Tasks 1 and 2 both target `main.ts`; implemented together and committed after joint tsc + build + check verification.)

## Files Created/Modified

- `entrypoints/popup/index.html` — full popup scaffold: header, sfx-host-list, sfx-empty-state, sfx-toggle-section, sfx-routing-section, link to popup.css
- `entrypoints/popup/main.ts` — complete vanilla-DOM popup: host render, token persistence, refresh, routing line, Review Mode toggle with permission-gesture ordering
- `entrypoints/popup/popup.css` — 320px neutral palette, system font, functional-minimal; NO post-it/paper aesthetics (Phase 6 deferred)

## Decisions Made

- EXIT branch of the toggle handler is guarded by `if (reviewModeActive) { ... return; }`. It runs and returns before the ENTER branch is reached. The ENTER branch starts at `chrome.permissions.request` — this is the first await in that branch, satisfying the gesture constraint.
- Connection dots render grey (stale) by default in Phase 3. Live reachability (green dot) would require the popup to trigger a REFRESH_HOSTS and wait for the SW to probe — acceptable Phase 6 UX refinement; the SW's REFRESH_HOSTS updates the registry on demand.
- Token input uses `type="password"` to prevent shoulder-surfing of API tokens; the autocomplete attribute is disabled.

## Deviations from Plan

None — plan executed exactly as written.

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `npx tsc --noEmit` exits 0 | PASS | No output |
| `npm run build` exits 0 | PASS | Built in 583ms, popup-CzFuyoVp.js + assets |
| `npm run check` exits 0 | PASS | 70/70 tests, clean-room PASS, smoke test PASS |
| sfxTokens.setValue present, tied to token input event | PASS | Lines 108-115 main.ts — blur handler calls setValue |
| No fetch/localhost in popup (grep) | PASS | Only match is the header comment; zero code matches |
| Host rows built with textContent/createElement (not innerHTML) | PASS | el() helper uses appendChild(createTextNode()) throughout |
| permissions.request is first awaited call in ENTER branch | PASS | Line 340 — first await after the `if (reviewModeActive)` guard exits |
| Handler requests origins:['<all_urls>'] | PASS | Line 341 |
| On !granted: return without ENTER_REVIEW | PASS | Lines 347-352 |
| [MANUAL-CHROME / HUMAN-UAT] Popup lists live host with token field; token persists across reopen | PENDING | Requires Chrome + live host |
| [MANUAL-CHROME / HUMAN-UAT] Toggle shows Chrome permission prompt; injects chip (joint with Plan 04) | PENDING | Requires Chrome; chip (Plan 04) not yet built |

## HUMAN-UAT Items (flagged for manual Chrome verification)

The following acceptance criteria require a live Chrome environment:

1. **SC-1 — Host list + token persistence:** With `npm run host -- --root <dir>` running, open the popup → host appears in list with token input. Enter token, close popup, reopen → token value persisted.

2. **SC-2 — Review Mode toggle:** Click "Enter Review Mode" → Chrome permission prompt appears once → chip appears on page (requires Plan 04 content script). Click "Exit Review Mode" → chip unmounts.

These are tracked as PENDING in the Phase 3 UAT gate and will be verified after Plan 04 ships.

## Known Stubs

- Connection dots are always grey in Phase 3 — the popup does not re-probe reachability. After REFRESH_HOSTS, the SW updates the registry but the popup would need to re-read it to show green dots. This is an intentional Phase 3 limitation; Phase 6 UX pass can add dot refresh.

## Threat Flags

None — popup reads from chrome.storage.local and messages the SW only. No network access, no new trust-boundary surfaces.

## Self-Check: PASSED

- entrypoints/popup/index.html: EXISTS (updated)
- entrypoints/popup/main.ts: EXISTS (431 lines, replaces 3-line placeholder)
- entrypoints/popup/popup.css: EXISTS (created)
- Commit b24ddcb: EXISTS
- `npx tsc --noEmit`: EXITS 0
- `npm run build`: EXITS 0
- `npm run check`: EXITS 0 (70/70 tests)
- No localhost fetch in popup (grep): CONFIRMED (zero code matches)
- permissions.request at line 340: FIRST await in ENTER branch — CONFIRMED
- setValue tied to token input blur: CONFIRMED (lines 108-115)
