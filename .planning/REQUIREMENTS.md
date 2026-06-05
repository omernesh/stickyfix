# Requirements: stickyfix

**Defined:** 2026-05-31
**Core Value:** A note dropped on a page reliably becomes a precise, context-rich `.md` file on disk in the right project's `notes/` folder — never silently lost.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Scaffold & Build (BUILD)

- [x] **BUILD-01**: `npm run build` succeeds on Windows with no macOS-only steps (no `sips`, no Bun)
- [x] **BUILD-02**: WXT scaffold produces a loadable (empty-but-valid) MV3 extension via Vite
- [x] **BUILD-03**: Extension icons (16/32/48/128) ship as committed pre-sized PNGs (no `sharp`/auto-icons native dep)
- [x] **BUILD-04**: Repo is public, MIT-licensed, with no GPL code present (clean-room §13 honored; `sfx-*` identifier namespace from M1)
- [x] **BUILD-05**: `npm run check` runs `tsc --noEmit` plus a host smoke test

### Host (HOST)

- [x] **HOST-01**: Host starts via `npm run host -- --root <dir>` and prints project name, bound port, declared origins, token, and absolute notes dir
- [x] **HOST-02**: Host binds `127.0.0.1` only and is not reachable from another LAN host
- [x] **HOST-03**: Host picks a free port in range 39240–39260 (or honors `--port`)
- [x] **HOST-04**: `GET /status` returns `{ app: "stickyfix", version, name, root, notesDir, origins }` with no token required
- [x] **HOST-05**: `POST /annotation` requires a valid `X-Stickyfix-Token`; missing/wrong token returns 401
- [x] **HOST-06**: Host assigns a zero-padded running serial (`0001`) via an in-process mutex so concurrent POSTs never collide
- [x] **HOST-07**: Host writes `<serial>-<YYYYMMDD-HHmmss>.md` with YAML frontmatter + comment body
- [x] **HOST-08**: Host decodes already-cropped PNG data-URLs and writes them next to the `.md` as `<base>+<N>.png`, recording paths in frontmatter and body
- [x] **HOST-09**: Writes are confined inside `--root`; path traversal is rejected; `--notes-dir` must resolve inside `--root`
- [x] **HOST-10**: CORS echoes the request `Origin` and allows the `X-Stickyfix-Token` header for `POST`/`OPTIONS`
- [x] **HOST-11**: Body size cap of 12 MB; larger payloads rejected with 413
- [x] **HOST-12**: Notes dir is created if missing with a `.gitkeep`; token also written to gitignored `<root>/.stickyfix-token`
- [x] **HOST-13**: Host accepts `--origin` (repeatable), `--name`, `--notes-dir`, `--token` (else `STICKYFIX_TOKEN` env, else random UUID) via `util.parseArgs`
- [x] **HOST-14**: `GET /annotations?url=<page-url>` returns the notes whose frontmatter `url` path-matches (query string ignored), each with serial, mode, status, selector, rect, text, and screenshot paths read from `.md` frontmatter; token-gated
- [x] **HOST-15**: `PUT /annotation/<serial>` overwrites the body of the existing note in place (resolves serial → `<serial>-*.md`, preserves frontmatter + screenshots, re-marks status `unread`); path-confined, token-gated, 12 MB cap
- [x] **HOST-16**: `DELETE /annotation/<serial>` removes the note `.md` and its `+N.png` screenshots; path-confined, token-gated; 404 if serial not found

### Extension Shell & Routing (EXT)

- [x] **EXT-01**: MV3 manifest with `activeTab`, `scripting`, `storage`, `tabs` permissions; localhost host_permissions; `optional_host_permissions` requested on demand
- [x] **EXT-02**: Review UI is injected dynamically via `chrome.scripting.executeScript` only on entering Review Mode (no static content_scripts)
- [x] **EXT-03**: Toolbar popup lists every discovered host with project name + per-host token entry/state and an Enter/Exit Review Mode toggle
- [x] **EXT-04**: Service worker probes ports 39240–39260 and builds a registry of all live hosts from `/status`
- [x] **EXT-05**: All localhost fetches route through the service worker (not the content script) to satisfy Chrome LNA/CORS
- [x] **EXT-06**: Each note routes by the active tab's origin to the advertising host with zero per-note picks
- [x] **EXT-07**: Unknown origin prompts a one-time host dropdown; the `origin → host` mapping persists and is never re-asked
- [x] **EXT-08**: Same-origin clashes are resolved by page self-id (`<meta name="stickyfix-project">` / `window.__stickyfix_project`) preferred over the origin map
- [x] **EXT-09**: Registry, per-host tokens, `origin → host` map, and prefs persist in `chrome.storage.local` and survive Chrome restart + service-worker recycling
- [x] **EXT-10**: On wake the worker re-discovers hosts and re-binds by project name+origin (not port) when a host restarts on a different port
- [x] **EXT-11**: A draggable, viewport-clamped connection chip (`z-index: 2147483647`) shows connection state + target project/notes dir with an Exit button

### Free-Note Mode (FREE)

- [x] **FREE-01**: A draggable `+` floating action button opens a single post-it note card (textarea + Send/Cancel)
- [x] **FREE-02**: The post-it card is draggable; only one active note card at a time
- [x] **FREE-03**: Send captures url, title, timestamp, viewport, and POSTs to the routed host, writing `notes/0001-<ts>.md`
- [x] **FREE-04**: A toast confirms the written filename on success

### Element-Note Mode (ELEM)

- [ ] **ELEM-01**: The 🎯 picker enters pick mode; hovering highlights the element under cursor with an outline + `tag · WxH` label; `Esc` cancels
- [x] **ELEM-02**: Clicking an element captures a robust unique selector via `@medv/finder`
- [x] **ELEM-03**: Capture includes tag, id, classList, name, type, href, role, ariaLabel + aria-*, collapsed text (~1000 char truncation noted)
- [x] **ELEM-04**: Capture includes rect (rounded + page-absolute), a curated `computedStyles` set (single config constant), truncated `outerHTML` (~2000 chars), and full `dataset`
- [x] **ELEM-05**: Best-effort React fiber detection walks up to the nearest named component and records its display name (omitted if undetectable)
- [x] **ELEM-06**: Capture includes `nearestTestId` (closest ancestor-or-self `data-testid`)
- [x] **ELEM-07**: The post-it pre-fills with a compact context summary; full detail goes into the `.md`
- [x] **ELEM-08**: On Send, an auto element-highlight screenshot (`+1`) is captured with the highlight box drawn on the selected element
- [x] **ELEM-09**: The element note `.md` includes selector + react_component frontmatter, a curated computed-styles table, and truncated outerHTML

### Region Capture (CAM)

- [x] **CAM-01**: A 📷 camera tool is available on every note (free and element)
- [x] **CAM-02**: Activating it dims the page with a scrim and switches the cursor to a crosshair
- [x] **CAM-03**: The user drags a rectangle (via interact.js); sub-threshold (<~6px) drag or `Esc` cancels without capturing
- [x] **CAM-04**: On release, stickyfix hides its own UI, captures the visible tab, crops to the dragged rect (DPR-corrected), and restores the UI
- [x] **CAM-05**: Each crop attaches as a deletable (`×`) thumbnail; multiple captures stack and increment `+2`, `+3`
- [x] **CAM-06**: Crops are sent as already-cropped PNG data-URLs; the host writes them as `<base>+<N>.png` and records paths in the `.md`

### Visual Design (UI)

- [x] **UI-01**: Injected UI mounts inside a Shadow DOM (`createShadowRootUi`) so post-it CSS cannot collide with the host page; uses `px` units to resist host font inheritance
- [x] **UI-02**: Post-it has a genuine sticky-note aesthetic — warm paper color, subtle shadow, legible type, smooth drag
- [x] **UI-03**: A colored header strip encodes mode (free vs element distinct colors)
- [x] **UI-04**: Success and error states surface as styled toasts

### Persistent Pins (PIN)

- [x] **PIN-01**: On entering Review Mode, the extension fetches notes for the current page (exact URL path match, query ignored) via `GET /annotations` and renders one persistent on-page pin per note
- [x] **PIN-02**: Element-note pins anchor to the stored `@medv/finder` selector (re-queried on load), repositioning on scroll/resize; free-note pins float at the stored viewport coords (page-level, no anchor)
- [x] **PIN-03**: An orphaned pin (selector matches nothing) renders greyed/dashed at its last-known page-absolute rect with a tooltip; it is never hidden (a note is never silently lost)
- [x] **PIN-04**: Pins encode mode (element vs free — same header colors as the cards, UI-03) and unread/read state (read = `*.read.md`); hover shows a note-text preview
- [x] **PIN-05**: Clicking a pin opens a card to view, edit, or delete the note
- [x] **PIN-06**: Editing saves via `PUT /annotation/<serial>` (overwrite in place); deleting via `DELETE /annotation/<serial>` (file + screenshots) behind a confirm guard; the on-page pin updates/disappears accordingly

### Reliability (REL)

- [x] **REL-01**: Every failed Send (host down, 4xx/5xx, token rejected, no host for origin) surfaces a visible toast — never a silent drop
- [x] **REL-02**: Multi-note sessions remain stable; a second note increments the serial to `0002`
- [x] **REL-03**: Large-screenshot payloads are handled gracefully (size guard + clear error)

### review-notes Skill (SKILL)

- [x] **SKILL-01**: Ship `skill/SKILL.md` + install README that works for any folder-reading AI agent
- [x] **SKILL-02**: Skill globs `notes/*.md`, excludes `*.read.md`, sorts by leading serial ascending
- [x] **SKILL-03**: For each unread note, the skill reads frontmatter/body/element-context/screenshot path and performs the requested fix
- [x] **SKILL-04**: After handling a note, the skill renames it to `*.read.md`; a re-run reports "no unread notes" (idempotent)
- [x] **SKILL-05**: Edge cases handled — empty queue, ambiguous note (left unread + flagged), missing screenshot (proceed with text)

### Documentation (DOC)

- [x] **DOC-01**: Root README has install + usage instructions and a demo GIF
- [x] **DOC-02**: README documents the clean-room MIT provenance and confirms no GPL code present

### Onboarding & Turnkey Distribution (ONB)

- [x] **ONB-01**: A turnkey, one-step setup (double-click installer / single bootstrap command, per-OS — not Windows-only) installs the host and the browser extension without manual repo cloning, `npm install`, or terminal steps
- [x] **ONB-02**: The user never manually copies or pastes a token — clicking the extension icon obtains and stores the running host's token automatically (auto-pair) or via a single one-click "Pair" action
- [x] **ONB-03**: Auto-pairing preserves the security model — an arbitrary web origin can NEVER obtain the token or write notes; pairing happens over a loopback-only, time-boxed window or a native-messaging channel, with the `127.0.0.1`-bind and origin-trust invariants intact
- [x] **ONB-04**: The host is auto-started / discoverable without the user running a manual terminal command (launcher, tray app, or native-messaging-spawned process)
- [x] **ONB-05**: Uninstall / teardown is clean — removes host artifacts and native-messaging manifests, leaves no orphan processes or stray registry/config entries
- [x] **ONB-06**: (cross-browser, stretch) A documented packaging path covers Edge (Chromium drop-in), Firefox, and Safari — promotes FUT-01 into scope

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Future (FUT)

- **FUT-01**: Firefox/Safari port (keep code port-friendly, don't build) — *may be promoted by ONB-06 (Phase 9)*
- **FUT-02**: Full-page (scrolling) screenshot capture
- **FUT-03**: Shadow-DOM deep traversal for element capture
- **FUT-04**: Publish `stickyfix-host` as an npm `bin`
- **FUT-05**: Lightbox preview on thumbnail click (optional nicety)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud sync / remote backend | Local-only, private, zero-account by design (NG1) |
| Multi-user / accounts | Single-developer tool; no auth surface beyond local token (NG1) |
| Deep integration with a specific AI agent API | Contract is files on disk; any folder-reading agent works (NG2) |
| PM-tool integrations (Jira/Linear/etc.) | Wrong user (AI agent, not client reviewer); violates local-only |
| Session replay / console-log capture | Disproportionate complexity; not core to visual review |
| Central note store + prefixing | Orphans notes from their repo; complicates the skill (§15) |
| html2canvas / DOM-to-canvas screenshots | Real pixels matter; `captureVisibleTab` is higher fidelity (§7.3) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUILD-01 | Phase 1 | Complete |
| BUILD-02 | Phase 1 | Complete |
| BUILD-03 | Phase 1 | Complete |
| BUILD-04 | Phase 1 | Complete |
| BUILD-05 | Phase 1 | Complete |
| HOST-01 | Phase 2 | Complete |
| HOST-02 | Phase 2 | Complete |
| HOST-03 | Phase 2 | Complete |
| HOST-04 | Phase 2 | Complete |
| HOST-05 | Phase 2 | Complete |
| HOST-06 | Phase 2 | Complete |
| HOST-07 | Phase 2 | Complete |
| HOST-08 | Phase 2 | Complete |
| HOST-09 | Phase 2 | Complete |
| HOST-10 | Phase 2 | Complete |
| HOST-11 | Phase 2 | Complete |
| HOST-12 | Phase 2 | Complete |
| HOST-13 | Phase 2 | Complete |
| HOST-14 | Phase 6 | Complete |
| HOST-15 | Phase 6 | Complete |
| HOST-16 | Phase 6 | Complete |
| EXT-01 | Phase 3 | Complete |
| EXT-02 | Phase 3 | Complete |
| EXT-03 | Phase 3 | Complete |
| EXT-04 | Phase 3 | Complete |
| EXT-05 | Phase 3 | Complete |
| EXT-06 | Phase 3 | Complete |
| EXT-07 | Phase 3 | Complete |
| EXT-08 | Phase 3 | Complete |
| EXT-09 | Phase 3 | Complete |
| EXT-10 | Phase 3 | Complete |
| EXT-11 | Phase 3 | Complete |
| FREE-01 | Phase 4 | Complete |
| FREE-02 | Phase 4 | Complete |
| FREE-03 | Phase 4 | Complete |
| FREE-04 | Phase 4 | Complete |
| ELEM-01 | Phase 5 | Pending |
| ELEM-02 | Phase 5 | Complete |
| ELEM-03 | Phase 5 | Complete |
| ELEM-04 | Phase 5 | Complete |
| ELEM-05 | Phase 5 | Complete |
| ELEM-06 | Phase 5 | Complete |
| ELEM-07 | Phase 5 | Complete |
| ELEM-08 | Phase 5 | Complete |
| ELEM-09 | Phase 5 | Complete |
| CAM-01 | Phase 6 | Complete |
| CAM-02 | Phase 6 | Complete |
| CAM-03 | Phase 6 | Complete |
| CAM-04 | Phase 6 | Complete |
| CAM-05 | Phase 6 | Complete |
| CAM-06 | Phase 6 | Complete |
| UI-01 | Phase 6 | Complete |
| UI-02 | Phase 6 | Complete |
| UI-03 | Phase 6 | Complete |
| UI-04 | Phase 6 | Complete |
| PIN-01 | Phase 6 | Complete |
| PIN-02 | Phase 6 | Complete |
| PIN-03 | Phase 6 | Complete |
| PIN-04 | Phase 6 | Complete |
| PIN-05 | Phase 6 | Complete |
| PIN-06 | Phase 6 | Complete |
| REL-01 | Phase 8 | Complete |
| REL-02 | Phase 8 | Complete |
| REL-03 | Phase 8 | Complete |
| SKILL-01 | Phase 7 | Complete |
| SKILL-02 | Phase 7 | Complete |
| SKILL-03 | Phase 7 | Complete |
| SKILL-04 | Phase 7 | Complete |
| SKILL-05 | Phase 7 | Complete |
| DOC-01 | Phase 7 | Complete |
| DOC-02 | Phase 7 | Complete |
| ONB-01 | Phase 9 | Complete |
| ONB-02 | Phase 9 | Complete |
| ONB-03 | Phase 9 | Complete |
| ONB-04 | Phase 9 | Complete |
| ONB-05 | Phase 9 | Complete |
| ONB-06 | Phase 9 | Complete |

**Coverage:**

- v1 requirements: 77 total (BUILD×5 + HOST×16 + EXT×11 + FREE×4 + ELEM×9 + CAM×6 + UI×4 + PIN×6 + REL×3 + SKILL×5 + DOC×2 + ONB×6)
- Mapped to phases: 77
- Unmapped: 0 ✓

Note: The requirements document header previously stated 56 total; the original enumerated count was 62. Phase 9 (Onboarding) added ONB×6 → 68. Phase 6 scope expansion (Persistent Pins) adds PIN×6 + host CRUD HOST-14/15/16 → 77 total. All 77 are mapped.

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-06-03 — Phase 6 expanded with Persistent Pins (PIN×6 + HOST-14/15/16 CRUD); ONB family added for Phase 9*
