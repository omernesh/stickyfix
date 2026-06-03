# Roadmap: stickyfix

## Overview

Nine phases deliver a Chrome MV3 extension + localhost host that turns on-page sticky notes into ordered markdown files on disk, readable by any AI coding agent. The delivery order is shaped by three architectural invariants established in research: GPL clean-room hygiene is enforced from the first commit (Phase 1), the service-worker-as-sole-HTTP-client boundary is proven with a dummy relay before any real UI ships (Phase 3), and the DPR-correct capture utility trio is built once in Phase 4 and inherited by Phases 5 and 6. The result is an end-to-end vertical slice (free note written to disk) that works at the end of Phase 4, well before element capture and region capture are layered on.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Scaffold & Clean-Room Foundation** - Cross-platform WXT + host build succeeds; sfx-* identifier namespace established; no GPL artifacts (completed 2026-05-31)
- [x] **Phase 2: Host MVP** - stickyfix-host writes .md + .png files with serial mutex, token auth, path safety, and CORS (completed 2026-05-31)
- [x] **Phase 3: Extension Skeleton + SW Relay Proof** - Popup, host discovery, chrome.storage.local state, on-demand injection, dummy POST relay proven end-to-end (completed 2026-05-31)
- [x] **Phase 4: Free-Note Mode + Capture Utilities** - Draggable FAB → post-it → Send → .md on disk; DPR crop, double-rAF flush, captureVisibleTab relay established as reusable utilities (completed 2026-05-31)
- [x] **Phase 5: Element-Note Mode + Rich Context Capture** - Element picker with @medv/finder selector, React fiber, computed styles, outerHTML, auto-highlight screenshot (completed 2026-06-02)
- [ ] **Phase 6: Region Capture + Visual Design + Persistent Pins** - Camera tool drag-marquee crop; full paper-aesthetic sticky-note UI inside shadow DOM; clickable on-page note pins (rehydrated from disk) with view/edit/delete via host CRUD
- [ ] **Phase 7: review-notes Skill + Docs** - Portable AI skill ships; README with demo GIF; clean-room provenance documented
- [ ] **Phase 8: Hardening + Pre-Release Audit** - All error paths surface toasts; concurrent-Send stress test; GPL grep audit; idle-eviction regression pass
- [ ] **Phase 9: Turnkey Onboarding & Cross-Browser Distribution** - One-step installer (host + extension), automatic/one-click token pairing (no manual copy-paste), host auto-start, clean uninstall; documented Edge/Firefox/Safari packaging path

## Phase Details

### Phase 1: Scaffold & Clean-Room Foundation

**Goal**: Developer can clone the repo on Windows, run `npm run build`, and load a valid (empty-but-loadable) MV3 extension and a runnable host bundle — with the sfx-* identifier namespace, pre-sized PNG icons, and zero GPL artifacts in place from commit one.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05
**Success Criteria** (what must be TRUE):

  1. `npm run build` completes without errors on Windows (no sips, no Bun, no Unix-only scripts)
  2. The built extension loads in Chrome without manifest errors (chrome://extensions → Load unpacked)
  3. `npm run check` runs tsc --noEmit and a host smoke test and exits 0
  4. Pre-sized PNG icons (16/32/48/128) are committed to public/ and appear in the loaded extension
  5. A grep for `__opc_`, `opencode`, `JodusNodus` returns zero results; all project identifiers use the sfx-* namespace

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Extension scaffold: package.json + deps, wxt.config.ts, tsconfig, entrypoints, pre-sized PNG icons (BUILD-01/02/03)
- [x] 01-02-PLAN.md — Host stub: tsconfig.host.json, parseArgs CLI stub, spawn-and-assert smoke test (BUILD-05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-03-PLAN.md — Clean-room grep gate + .gitignore finalize + full `npm run check`/`build` verification (BUILD-01/04/05)

### Phase 2: Host MVP

**Goal**: Running `npm run host -- --root <dir>` starts a server on 127.0.0.1 that accepts POST /annotation with token auth, assigns serials via a mutex, and writes .md + .png files safely inside --root.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: HOST-01, HOST-02, HOST-03, HOST-04, HOST-05, HOST-06, HOST-07, HOST-08, HOST-09, HOST-10, HOST-11, HOST-12, HOST-13
**Success Criteria** (what must be TRUE):

  1. Host starts on 127.0.0.1 in port range 39240-39260, prints name/port/token/notesDir on startup
  2. GET /status returns correct JSON with no token; POST /annotation with wrong/missing token returns 401
  3. Two simultaneous POSTs produce 0001-... and 0002-... files with no collision (serial mutex works)
  4. A POST containing a PNG data-URL writes both the .md and the +1.png file next to it with correct frontmatter
  5. A path-traversal attempt (../../../etc/passwd in notes path) is rejected; body over 12 MB returns 413

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Host core modules + unit tests: config, serial mutex, security (token/path/body-cap), write-note (frontmatter+PNG) (HOST-05/06/07/08/09/11/12/13)

**Wave 2** *(blocked on Wave 1)*

- [x] 02-02-PLAN.md — HTTP server wiring: server.ts routing+CORS, index.ts 127.0.0.1 port-scan boot, integration test (HOST-01/02/03/04/05/07/08/10/12/13)

**Wave 3** *(blocked on Wave 2)*

- [x] 02-03-PLAN.md — Smoke-test rewrite for long-running server + full npm run check gate (HOST-01/02/03/04/05/07/08/12)

### Phase 3: Extension Skeleton + SW Relay Proof

**Goal**: The popup lists live hosts discovered by the service worker, lets the developer enter a token and toggle Review Mode, and a dummy SEND_ANNOTATION message travels from the content script through the service worker to the host — proving the SW-as-HTTP-client boundary before any real note UI is built.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07, EXT-08, EXT-09, EXT-10, EXT-11
**Success Criteria** (what must be TRUE):

  1. The popup opens on any tab, lists all discovered hosts (probed from ports 39240-39260), and shows per-host token entry
  2. Toggling Review Mode injects the content script on demand (no static content_scripts); a connection chip appears on the page
  3. A dummy "Send" from the injected chip reaches the host and a stub .md appears in the notes dir — proving the CS→SW→host relay on an HTTPS-origin page
  4. All state (host registry, tokens, origin map) survives a 5-minute SW idle eviction; a subsequent Send still routes correctly
  5. An unknown-origin tab prompts a one-time host dropdown; the same origin is never re-asked on subsequent visits

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — lib/ core (types, storage schema, routing+discovery + node:test), MV3 manifest perms, Wave-0 CSS-inject (A4) build check (EXT-01/04/06/07/08/09/10)

**Wave 2** *(blocked on Wave 1)*

- [x] 03-02-PLAN.md — Background SW: discovery, routing, self-id probe, the single 127.0.0.1/annotation relay (SW = sole HTTP client) (EXT-04/05/06/08/09/10)

**Wave 3** *(blocked on Wave 2)*

- [x] 03-03-PLAN.md — Popup: discovered-host list + per-host token persistence + Review Mode toggle with the permission gesture (EXT-03/07/09)
- [x] 03-04-PLAN.md — review.content chip: runtime injection + shadow-root createShadowRootUi, draggable+clamped, one-time dropdown, stub Send relay proof (EXT-02/05/07/08/11)

**UI hint**: yes

### Phase 4: Free-Note Mode + Capture Utilities

**Goal**: A developer in Review Mode can tap the draggable + FAB, type a note, hit Send, and find a correctly named .md file in the project's notes/ dir — and the DPR-correct crop, double-rAF own-UI flush, and captureVisibleTab relay utilities are in place as reusables for Phases 5 and 6.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: FREE-01, FREE-02, FREE-03, FREE-04
**Success Criteria** (what must be TRUE):

  1. The + FAB is visible and draggable in Review Mode; clicking it opens a single post-it card
  2. Hitting Send POSTs the note and a .md file named 0001-YYYYMMDD-HHmmss.md appears in notes/
  3. A success toast shows the written filename; a failure (host down) shows a visible error toast — never a silent drop
  4. DPR-correct canvas crop utility is implemented, tested at DPR=1, DPR=1.25, and DPR=2; double-rAF flush utility eliminates own-UI in captures

**Plans**: 3 plans
Plans:
**Wave 0**

- [x] 04-01-PLAN.md — Capture lib (pure computeCropCoords DPR=1/1.25/2 + browser helpers), SFX_CAPTURE_TAB type, single-active-card guard, interactjs@1.10.27 install + test:lib wiring (FREE-02 / SC-4)

**Wave 1** *(blocked on Wave 0)*

- [x] 04-02-PLAN.md — Free-note vertical slice: + FAB + post-it card (interactjs) + toast + Send via SFX_SEND_ANNOTATION + chip re-map (FREE-01/02/03/04)

**Wave 2** *(blocked on Waves 0+1)*

- [x] 04-03-PLAN.md — captureVisibleTab SW relay (handleCaptureTab) + double-rAF/crop integration proof, standalone (NOT wired into free-note Send) (SC-4)

**UI hint**: yes

### Phase 5: Element-Note Mode + Rich Context Capture

**Goal**: A developer can click the target picker, hover to highlight any element, click to capture its full context (selector, React component, computed styles, outerHTML, aria, dataset, bounding rect), write a note, and get an auto-highlight screenshot (+1.png) alongside the .md.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: ELEM-01, ELEM-02, ELEM-03, ELEM-04, ELEM-05, ELEM-06, ELEM-07, ELEM-08, ELEM-09
**Success Criteria** (what must be TRUE):

  1. Hovering in pick mode shows an outline + "tag · WxH" label that follows the cursor; Esc cancels cleanly
  2. Clicking an element produces a unique CSS selector via @medv/finder and a pre-filled post-it with a compact context summary
  3. The written .md contains selector, React component name (or omitted gracefully if undetectable), curated computed styles table, truncated outerHTML, dataset, aria-*, nearestTestId, and page-absolute rect
  4. An auto-highlight screenshot (+1.png) is captured with the selection box drawn on the element, no own-UI visible in the image

**Plans**: 3 plans
Plans:
**Wave 0**

- [x] 05-01-PLAN.md — Install @medv/finder + pure lib (element-context.ts, highlight-draw.ts) + node:test (ELEM-02/03/04/05/06/07/08)

**Wave 1** *(blocked on Wave 0)*

- [x] 05-02-PLAN.md — Pick-mode slice: 🎯 chip button + hover-highlight overlay (picker.ts) + cursor/overlay CSS (ELEM-01)

**Wave 2** *(blocked on Waves 0+1)*

- [x] 05-03-PLAN.md — Capture+write slice: openElementCard context header + +1.png box-draw Send pipeline + index wiring (ELEM-02/03/04/05/06/07/08/09)

**UI hint**: yes

### Phase 6: Region Capture + Visual Design + Persistent Pins

**Goal**: Every note (free and element) has a working camera tool that lets the developer drag a marquee to capture a DPR-correct region crop and attach multiple deletable thumbnails; the entire injected UI has a polished paper-aesthetic sticky-note look inside shadow DOM isolation; and every note left on a page reappears as a clickable on-page pin (rehydrated from the notes on disk via a new host read endpoint) that can be viewed, edited (overwrite in place), or deleted (file + screenshots) — so a review becomes a durable, revisitable map of pending feedback.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: CAM-01, CAM-02, CAM-03, CAM-04, CAM-05, CAM-06, UI-01, UI-02, UI-03, UI-04, PIN-01, PIN-02, PIN-03, PIN-04, PIN-05, PIN-06, HOST-14, HOST-15, HOST-16
**Success Criteria** (what must be TRUE):

  1. Clicking the camera tool dims the page with a scrim and switches the cursor to a crosshair; Esc or a sub-6px drag cancels without capturing
  2. Dragging a region and releasing attaches a deletable thumbnail to the current note; a second drag attaches a second thumbnail (+2.png)
  3. The sent .md records +1.png, +2.png paths in frontmatter and body; the host writes the PNG files correctly
  4. Post-it cards have a warm paper aesthetic, smooth drag, colored header strip (free vs element distinct), and no CSS bleed from or to the host page (shadow DOM isolation verified on a Tailwind-heavy and a CSS-reset-heavy page)
  5. Re-entering Review Mode on a page renders one pin per note for that exact URL path (host reads selector/rect/mode/status/url from .md frontmatter); element pins anchor to the stored selector (reposition on scroll/resize), free pins float at stored viewport coords, and an orphaned pin shows greyed at its last-known rect (never hidden)
  6. Clicking a pin opens a card to view/edit/delete; editing overwrites the same serial file in place (host PUT, re-marks unread) and deleting removes the .md + its +N.png (host DELETE) behind a confirm guard — both token-gated and path-confined

**Decisions locked** (06-CONTEXT.md): pins are sourced from disk via `GET /annotations` (files = source of truth, survive browser reset); scope by exact URL path (query ignored); edit = `PUT /annotation/<serial>` overwrite-in-place; delete = `DELETE /annotation/<serial>` hard-delete file + screenshots; note id = leading serial (host globs `<serial>-*.md`); orphaned pins shown greyed at last-known rect; free-notes also pinned (floating); pins color-coded by mode + unread/read dot + hover preview.

**Plans**: 4 plans
Plans:

**Wave 0**

- [x] 06-01-PLAN.md — Foundation: pure marquee/url-match libs + host CRUD (GET /annotations, PUT/DELETE) + D-03 frontmatter + new SW message types + node:test (CAM-03/HOST-14/15/16/PIN-01/02/03/06)

**Wave 1** *(blocked on Wave 0)*

- [x] 06-02-PLAN.md — Region Capture slice: 📷 camera button + scrim/marquee + DPR crop + deletable thumbnail strip + Send +N.png (CAM-01..06)

**Wave 2** *(blocked on Wave 1)*

- [ ] 06-03-PLAN.md — Visual Design slice: warm paper cards + mode header strips + styled toasts + shadow-DOM isolation (UI-01..04)

**Wave 3** *(blocked on Waves 0+2)*

- [ ] 06-04-PLAN.md — Persistent Pins slice: rehydrate via GET /annotations → render/anchor/orphan pins + hover preview + view/edit (PUT)/delete (DELETE) card (PIN-01..06)

**UI hint**: yes

### Phase 7: review-notes Skill + Docs

**Goal**: Any AI coding agent can install the review-notes skill, run it against a notes/ dir, and have it process unread notes in serial order — renaming each to *.read.md — while the README gives a developer everything needed to install and use stickyfix in under 5 minutes.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, DOC-01, DOC-02
**Success Criteria** (what must be TRUE):

  1. Running the skill against a notes/ dir with three unread notes processes them in serial order (0001 before 0002) and renames each to *.read.md
  2. Re-running the skill on the same dir reports "no unread notes" without error (idempotent)
  3. Edge cases handled: empty queue reports cleanly; ambiguous note is left unread and flagged; missing screenshot causes the skill to proceed with text only
  4. The root README documents install + usage and includes a demo GIF; a CLEAN-ROOM.md confirms no GPL code present with a grep audit result

**Plans**: TBD

### Phase 8: Hardening + Pre-Release Audit

**Goal**: Every failure path (host down, 401, 413, SW eviction mid-flight, no host for origin) surfaces a visible toast and never silently drops a note; concurrent Sends produce correct serial ordering; a GPL clean-room grep audit returns zero matches.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):

  1. Every known failure path (host unreachable, 401 token mismatch, 413 body too large, SW evicted mid-flight, no matching host for origin) produces a visible toast — no silent drops in any scenario
  2. Ten concurrent Sends produce files 0001 through 0010 with no gaps or duplicates (serial mutex under stress)
  3. A near-12 MB screenshot POST is rejected with a clear error toast; a valid 11.9 MB POST succeeds
  4. A grep for `__opc_`, `opencode`, `JodusNodus`, and upstream selector constants returns zero results across the entire repo

**Plans**: TBD

### Phase 9: Turnkey Onboarding & Cross-Browser Distribution

**Goal**: A first-time user goes from zero to a working note-on-disk in one step — a double-click installer (or single bootstrap command) installs and auto-starts the host and loads the extension, and clicking the extension icon pairs with the running host automatically (no manual token copy-paste) — without weakening the 127.0.0.1-bind + token + origin-trust security model.
**Mode:** mvp
**Depends on**: Phase 8 (package and distribute a hardened, documented product)
**Requirements**: ONB-01, ONB-02, ONB-03, ONB-04, ONB-05, ONB-06
**Success Criteria** (what must be TRUE):

  1. A fresh machine reaches "note written to disk" via a single turnkey step (double-click installer or one bootstrap command) — no repo clone, no `npm install`, no manual terminal command (per-OS packaging; not Windows-only)
  2. The user never sees or copies a token: clicking the extension icon auto-pairs (or one-click "Pair") with the running host and persists the token
  3. Auto-pairing is loopback-confined and time-boxed (or native-messaging-based) — a scripted arbitrary web origin cannot obtain the token or write a note (security model proven intact)
  4. The host auto-starts / is discoverable with no manual terminal step; uninstall removes host artifacts + native-messaging manifests with no orphan processes or stray config
  5. (stretch) A documented packaging path exists for Edge (Chromium drop-in), Firefox, and Safari

**Open design questions** (for `/gsd:discuss-phase 9`):

  - Packaging tech: per-OS installer (NSIS/.exe, .pkg, .deb/sh) vs. cross-platform `npx stickyfix init` bootstrapper vs. `pkg`/SEA single binary — must satisfy the cross-platform constraint (no Windows-only deliverable)
  - Pairing channel: **native messaging** (installer registers the manifest; no HTTP token at all) vs. **time-boxed loopback `/pair` endpoint** (host exposes token only within an N-second window after launch, SW fetches it) vs. `chrome.storage.managed` policy injection
  - Host lifecycle: tray app / OS service / native-messaging-spawned-on-demand — and how it learns the project `--root`
  - Cross-browser scope: promote FUT-01 (Firefox/Safari) here, or keep stretch/Edge-only

**Plans**: TBD
**UI hint**: yes (popup pairing flow)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold & Clean-Room Foundation | 3/3 | Complete    | 2026-05-31 |
| 2. Host MVP | 3/3 | Complete    | 2026-05-31 |
| 3. Extension Skeleton + SW Relay Proof | 4/4 | Complete    | 2026-05-31 |
| 4. Free-Note Mode + Capture Utilities | 3/3 | Complete    | 2026-06-01 |
| 5. Element-Note Mode + Rich Context Capture | 3/3 | Complete   | 2026-06-02 |
| 6. Region Capture + Visual Design + Persistent Pins | 2/4 | In Progress|  |
| 7. review-notes Skill + Docs | 0/TBD | Not started | - |
| 8. Hardening + Pre-Release Audit | 0/TBD | Not started | - |
| 9. Turnkey Onboarding & Cross-Browser Distribution | 0/TBD | Not started | - |
