---
phase: 4
slug: free-note-mode-capture-utilities
status: secured
threats_open: 0
threats_closed: 11
asvs_level: unset
block_on: high
created: 2026-06-02
---

# SECURITY.md — stickyfix Phase 4 Security Audit

**Phase:** 4 — Free-Note Mode + Capture Utilities (plans 04-01, 04-02, 04-03)
**Audit date:** 2026-06-02
**ASVS Level:** (unset)
**Auditor stance:** FORCE — every mitigation assumed absent until grep proves otherwise

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-04-SC | Tampering (supply chain) | accept | CLOSED | See Accepted Risks §1 |
| T-04-01 | Tampering (integer math) | mitigate | CLOSED | `lib/capture.ts:30-33` — `Math.round` applied to all four coords (`sx`, `sy`, `sw`, `sh`); DPR=1.25 case asserts `sx=13`, `sh=63` in `lib/test/capture.test.ts` (29 tests, 0 fail per 04-01-SUMMARY.md) |
| T-04-02 | Information Disclosure (module surface) | mitigate | CLOSED | `lib/capture.ts:1-35` — no top-level `chrome.*`/`document.*`/`window.*` access; all browser API calls are inside function bodies (`cropToRect` body line 75, `captureTab` body lines 98-103); `computeCropCoords` is a pure function with zero side-effects |
| T-04-03 | Tampering (XSS) | mitigate | CLOSED | `entrypoints/review.content/card.ts` — zero `.innerHTML` matches (grep confirmed); all host-derived strings (`resp.file` line 309, `resp.error` line 313) passed to `showToastFn` which uses `textContent` only. `entrypoints/review.content/toast.ts:48` — `msgSpan.textContent = msg.slice(0, 200)` is the single rendering path for host-derived content; zero `.innerHTML` matches in toast.ts (grep confirmed) |
| T-04-04 | Elevation of Privilege (CS localhost access) | mitigate | CLOSED | `entrypoints/review.content/card.ts` — no `import.*capture` in source (grep returns only JSDoc comments, no actual import statement); no `fetch()` or `127.0.0.1` references (grep confirmed); relay exclusively via `chrome.runtime.sendMessage({type: SFX_MSG.SEND_ANNOTATION, ...})` at line 291; `screenshots: []` literal at line 286 confirms D-06 |
| T-04-05 | Information Disclosure (textarea content) | accept | CLOSED | See Accepted Risks §2 |
| T-04-06 | Spoofing (SFX_SEND_ANNOTATION origin) | mitigate | CLOSED | `entrypoints/background.ts:289` — `const tab = await chrome.tabs.get(tabId)` inside `handleSendAnnotation`; origin derived as `new URL(tab.url).origin` at line 293; message body origin field `_originFromMsg` is intentionally ignored (named with underscore prefix, comment at line 178: "IN-02: kept for API compat; tab.url is always used") |
| T-04-07 | Spoofing (SFX_CAPTURE_TAB windowId) | mitigate | CLOSED | `entrypoints/background.ts:373` — `const tab = await chrome.tabs.get(tabId)` inside `handleCaptureTab`; `tab.windowId` passed to `captureVisibleTab` at line 375; grep for `captureVisibleTab(msg.` and `captureVisibleTab((msg` returns zero matches — windowId is never sourced from the message body |
| T-04-08 | Information Disclosure (captureVisibleTab scope) | mitigate | CLOSED | `entrypoints/background.ts:375` — `captureVisibleTab(tab.windowId, { format: 'png' })` captures only the resolved window's active visible viewport; capture is not auto-fired (no call in `handleSendAnnotation` or `card.ts` — D-06 enforced); `card.ts` `screenshots: []` literal at line 286 confirms free notes never trigger capture |
| T-04-09 | Elevation of Privilege (CS direct captureVisibleTab) | mitigate | CLOSED | Grep for `captureVisibleTab` across all `.ts` files returns exactly one file: `entrypoints/background.ts`; the single call site is line 375 inside `handleCaptureTab` (SW-only function); content scripts have no access path to this API |
| T-04-IDOR | Spoofing (cross-tab capture via SFX_CAPTURE_TAB) | mitigate | CLOSED | `entrypoints/background.ts:481-485` — `case SFX_CAPTURE_TAB` router block: `const reqTabId = (msg as MsgCaptureTab).tabId`; guard `if (sender.tab?.id == null \|\| sender.tab.id !== reqTabId)` returns `{ ok: false, error: 'forbidden' }` before `handleCaptureTab` is ever invoked; a content script in tab A cannot capture tab B (commit 6736413 per 04-03-SUMMARY.md) |

---

## Accepted Risks Log

### §1 — T-04-SC: Supply Chain (interactjs@1.10.27)

**Rationale accepted:** `interactjs@1.10.27` was vetted in `04-RESEARCH.md` Package Legitimacy Audit prior to installation. The package is ~9 years old, MIT-licensed, published under the `interactjs` npm name (the project's documented canonical name), and locked in `CLAUDE.md` technology stack table as an approved dependency. No code mitigation is appropriate for a vetted, pinned npm dependency of this maturity profile. The version is exact (no caret/tilde) in `package.json`. Risk accepted at project level.

**Residual risk:** A future compromised release would not affect this installation because the version is pinned. Risk of the already-installed version being malicious is assessed as low given the package's public audit history and 9-year track record.

### §2 — T-04-05: Information Disclosure (page-controlled textarea content)

**Rationale accepted:** The textarea content is developer-authored on their own machine in Review Mode; the user is the author of the text being sent. The content script has no access to cross-origin content that it could leak via this path. The host validates payload shape and enforces a 12 MB body cap (returning HTTP 413 for over-limit payloads), consistent with the existing `SFX_SEND_ANNOTATION` contract established in Phase 3. No new exposure surface is introduced beyond what Phase 3 already accepted. Risk accepted.

---

## Unregistered Flags

None. The `## Threat Flags` sections of 04-01-SUMMARY.md, 04-02-SUMMARY.md, and 04-03-SUMMARY.md all declare no new threat flags. No implementation-detected surface was identified that lacks a threat register mapping.

---

## Project Security Invariants — Phase 4 Compliance

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Host binds `127.0.0.1` only (not `0.0.0.0`) | Not in scope for Phase 4 (host server unchanged) | — |
| Token auth on `POST /annotation` | Not in scope for Phase 4 (SW relay unchanged) | — |
| SW is sole HTTP client | HELD | No `fetch()` or `127.0.0.1` in `card.ts`; single `fetch()` in `background.ts:312` inside `handleSendAnnotation` only |
| Origin/tabId/windowId never trusted from message body | HELD | T-04-06: origin from `chrome.tabs.get` in `handleSendAnnotation`; T-04-07: windowId from `chrome.tabs.get` in `handleCaptureTab`; T-04-IDOR: sender-bound tabId check before `handleCaptureTab` call |
| Body cap 12 MB (413 over) | Not in scope for Phase 4 (host server unchanged) | — |
| `captureVisibleTab` appears exactly once | HELD | Grep across all `.ts` files: single call site at `background.ts:375` inside `handleCaptureTab` |

---

## Notes for Future Phases

- **Task 2 of 04-03** (integration proof: captureTab round-trip, own-UI absent, DPR crop live) is a `checkpoint:human-verify` gate marked PENDING in 04-03-SUMMARY.md. This audit covers the code-verifiable mitigations; the runtime proof (double-rAF flush eliminating own-UI from the captured screenshot) cannot be confirmed by static analysis and must be completed before Phase 5 or 6 consume `captureTab`/`cropToRect` in production paths.
