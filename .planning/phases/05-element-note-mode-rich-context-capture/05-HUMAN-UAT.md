---
status: passed
phase: 05-element-note-mode-rich-context-capture
source: [05-VALIDATION.md]
started: 2026-06-03
updated: 2026-06-03
---

## Current Test

[Chrome UAT run live by user on https://app.chatlytics.ai/admin against host stickyfix-uat:39240 → D:\docker\stickyfix-uat\notes]

## Tests

### 1. Pick mode — hover overlay + click (ELEM-01, ELEM-02)
expected: 🎯 enters pick mode (crosshair); hovering shows orange outline + cursor-following `tag·WxH` label; clicking an element opens ONE pre-filled Element-note card with a read-only context header.
result: pass
note: User picked page elements and got Element-note cards. INITIAL DEFECT: the picker captured stickyfix's OWN shadow host (`sfx-review-ui · 16x8`) because the guard checked only the inner mount container, not the page-tree shadow host (shadow event retargeting). FIXED (commit fix(05): exclude stickyfix shadow host from picker) — picker now derives the host via container.getRootNode().host and excludes it in both mousemove + click guards. After fix, real page elements are picked correctly.

### 2. Element note written to disk (ELEM-03/04/05/06/09)
expected: `.md` contains selector, tag/role, text, page-absolute rect, ~25-row curated computed-styles table, truncated outerHTML.
result: pass
note: Verified 0002-20260603-010605.md — selector `div:nth-of-type(5) .cursor-pointer > .flex > .flex`, full 25-row styles table, complete outerHTML, rect x=313 y=464 w=1535 h=21. frontmatter mode:element, status:unread. Two notes written (0001, 0002).

### 3. +1.png auto-highlight screenshot (ELEM-08, D-02a)
expected: full viewport PNG with the orange highlight box drawn on the picked element; NO stickyfix own-UI (chip/FAB/card/overlay) visible in the image.
result: pass
note: Verified 0002-...+1.png (~196 KB) — orange box correctly around the "Access Control" row; zero stickyfix UI in the shot (hide → waitTwoRafs → captureTab → draw-on-canvas → restore sequence works). Earlier "no orange square" was because a 16×8 own-UI element had been picked (see Test 1 fix).

### 4. Send success + error toast (REL-01)
expected: success toast names the written file; with host unreachable, a visible error toast (never silent).
result: pass
note: Success toasts named files; "Host unreachable: TypeError: Failed to fetch" error toast observed when the origin was routed to a dead stale host — REL-01 no-silent-failure confirmed.

## UAT-driven fixes (all committed + rebuilt)

- **Picker own-UI exclusion** — picker no longer captures `sfx-review-ui` (shadow host).
- **Popup host management** — per-host `−` (remove stale/dead host + clears its origin map) and `+` (add host by port, SW-probed). Fixes stale-registry accumulation (reconcileRegistry never evicts offline hosts).
- **Popup auto-close** on successful Enter Review Mode.
- **Single-host auto-route** — `resolveRoute` auto-selects the sole host for unmapped origins (no dropdown when there is one project) + unit test.
- **Sticky picker** — element-note Send re-arms pick mode so the user stays in bullseye for the next pick.

## Summary

total: 4
passed: 4
issues: 0
note: All Phase 5 success criteria (ROADMAP 1–4) verified live + on-disk. Three defects found during UAT (picker own-UI capture, stale-host routing, ergonomics) fixed and re-verified. ELEM-01..09 functionally confirmed. The capture trio (Phase 4) is now proven in production use.
deferred: persistent clickable note pins + add/edit/delete → Phase 6 (Persistent Element Markers — needs host GET/PUT/DELETE CRUD; user-approved as its own phase).
skipped: 0
blocked: 0
