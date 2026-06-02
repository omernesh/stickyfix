---
phase: 5
slug: element-note-mode-rich-context-capture
status: verified
threats_open: 0
threats_closed: 13
asvs_level: 1
register_authored_at_plan_time: true
block_on: high
created: 2026-06-03
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> All 13 plan-time threats verified CLOSED with file:line evidence (gsd-security-auditor, FORCE mode).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| page element → element-context extraction | All extracted strings (selector, text, outerHTML, attrs, dataset, reactComponent) are untrusted page-controlled data | Untrusted page strings |
| page → content script (mousemove/click) | `e.target` is a page-controlled element; tag/id/class strings are untrusted | Untrusted element refs + strings |
| content script ↔ shadow-root UI | overlay/label/card live in the shadow root; must never be the picker target | sfx-internal DOM |
| picked element → ElementContext → card DOM / payload | selector/text/outerHTML/attrs/component name enter the shadow UI and the POST payload | Untrusted page strings |
| content script → SW (SFX_CAPTURE_TAB / SFX_SEND_ANNOTATION) | privileged capture + host POST cross here; SW is the sole privileged caller | tabId (sender-bound), payload |
| npm registry → install | supply-chain entry for @medv/finder | third-party package |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-05-01 | Tampering (XSS) | captureElementContext / buildContextSummary | mitigate | Returns plain strings only, no DOM access; zero `innerHTML` in `lib/element-context.ts` (grep 0) | closed |
| T-05-02 | DoS | text / outerHTML capture | mitigate | `element-context.ts:191` text.slice(0,1000); `:221` outerHTML.slice(0,2000); host 12 MB backstop | closed |
| T-05-03 | DoS (infinite loop) | getReactComponentName fiber walk | mitigate | `element-context.ts:101` MAX_STEPS=50; `:104` circular `seen.has(fiber)` break; try/catch (90–117) | closed |
| T-05-04 | Tampering | reactComponent minified prod names | accept | `element-context.ts:109` `name.length >= 2 && /^[A-Z]/`; best-effort, omitted if undetectable; dev-only tool | closed |
| T-05-SC | Tampering (supply chain) | @medv/finder@4.0.2 install | mitigate | `package.json:23` exact pin; slopcheck OK, MIT, no postinstall, in CLAUDE.md stack | closed |
| T-05-05 | Tampering (XSS) | hover label text | mitigate | `picker.ts:201` `hoverLabel.textContent`; buildLabelPrefix returns plain string; no `innerHTML` (only comments) | closed |
| T-05-06 | Tampering | finder on shadow element | mitigate | `picker.ts:89-90` + `:116-117` dual guard (container + shadow host via getRootNode().host) in mousemove AND click; finder runs on page elements only | closed |
| T-05-07 | Spoofing | page forges picker click | accept | `e.target` set by browser event dispatch; no caller-supplied target override; dev-only tool | closed |
| T-05-08 | Click propagation | pick click also hits page handler | accept | `picker.ts:119` no `stopPropagation` is intentional v1; aggressive-capture pages = Phase 8 edge case | closed |
| T-05-09 | Tampering (XSS) | context header `.sfx-ctx-header-text` | mitigate | `card.ts:403` `ctxText.textContent = buildContextSummary(...)`; no `innerHTML` in card.ts (only comments) | closed |
| T-05-10 | IDOR / origin-trust | captureTab / SEND_ANNOTATION relay | mitigate | `background.ts:546` `sender.tab.id !== reqTabId` IDOR guard; `handleSendAnnotation` derives origin from `chrome.tabs.get(tabId).url`, never message body; no new privileged message | closed |
| T-05-11 | Info disclosure | outerHTML sensitive page data | accept | truncated 2000 chars, inert text written by host; exhaustive redaction deferred (Phase 8); dev-only local tool | closed |
| T-05-12 | DoS | oversized +1.png / payload | accept | bounds text 1000 / outerHTML 2000 + host 12 MB cap (HOST-11); 413 matrix Phase 8 | closed |
| T-05-13 | Info disclosure | own UI leaks into +1.png | mitigate | `card.ts:587` setSfxVisibility(false) → `:594` waitTwoRafs → `:597` captureTab → `:609` drawHighlightBox on captured canvas (D-02a), never live overlay | closed |

*Status: open · closed* — *Disposition: mitigate · accept · transfer*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-1 | T-05-04 | React fiber-name is an internal API; minified single-letter/non-PascalCase names filtered; best-effort field, omitted if undetectable. Developer-only tool. | Omer | 2026-06-03 |
| AR-05-2 | T-05-07 | `e.target` is set by the browser's event dispatch; a page script cannot forge an arbitrary document-click target. Developer-only tool. | Omer | 2026-06-03 |
| AR-05-3 | T-05-08 | Not calling `stopPropagation` on picker click is intentional for v1 (page may handle its own click). Aggressive-capture pages are a Phase 8 edge case. | Omer | 2026-06-03 |
| AR-05-4 | T-05-11 | outerHTML truncated to 2000 chars, written as inert text by the host; exhaustive PII redaction is out of scope for a developer-only local tool (Phase 8). | Omer | 2026-06-03 |
| AR-05-5 | T-05-12 | Payload bounded by text 1000 / outerHTML 2000 + host 12 MB cap; oversized-screenshot 413 matrix deferred to Phase 8. | Omer | 2026-06-03 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-03 | 13 | 13 | 0 | gsd-security-auditor (FORCE mode, register_authored_at_plan_time) |

**Project invariants confirmed held:** SW is the sole privileged HTTP/capture caller (no popup/content-script fetch — the UAT-added `handleAddHost`/`handleRemoveHost` are SW-only, port-validated, no origin/tab trust from message body, no token leak); origin/tabId/windowId are never trusted from the message body (`SFX_CAPTURE_TAB` sender-binds; `SEND_ANNOTATION` resolves origin from `chrome.tabs.get`); all page-derived strings enter the DOM via `textContent` only (no `innerHTML` with external data in element-context.ts / picker.ts / card.ts); MIT deliverable (no GPL-3.0 upstream copied).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-03 (gsd-security-auditor — 13/13 CLOSED, 0 open)
