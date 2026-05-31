# Requirements: stickyfix

**Defined:** 2026-05-31
**Core Value:** A note dropped on a page reliably becomes a precise, context-rich `.md` file on disk in the right project's `notes/` folder — never silently lost.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Scaffold & Build (BUILD)

- [x] **BUILD-01**: `npm run build` succeeds on Windows with no macOS-only steps (no `sips`, no Bun)
- [x] **BUILD-02**: WXT scaffold produces a loadable (empty-but-valid) MV3 extension via Vite
- [x] **BUILD-03**: Extension icons (16/32/48/128) ship as committed pre-sized PNGs (no `sharp`/auto-icons native dep)
- [ ] **BUILD-04**: Repo is public, MIT-licensed, with no GPL code present (clean-room §13 honored; `sfx-*` identifier namespace from M1)
- [ ] **BUILD-05**: `npm run check` runs `tsc --noEmit` plus a host smoke test

### Host (HOST)

- [ ] **HOST-01**: Host starts via `npm run host -- --root <dir>` and prints project name, bound port, declared origins, token, and absolute notes dir
- [ ] **HOST-02**: Host binds `127.0.0.1` only and is not reachable from another LAN host
- [ ] **HOST-03**: Host picks a free port in range 39240–39260 (or honors `--port`)
- [ ] **HOST-04**: `GET /status` returns `{ app: "stickyfix", version, name, root, notesDir, origins }` with no token required
- [ ] **HOST-05**: `POST /annotation` requires a valid `X-Stickyfix-Token`; missing/wrong token returns 401
- [ ] **HOST-06**: Host assigns a zero-padded running serial (`0001`) via an in-process mutex so concurrent POSTs never collide
- [ ] **HOST-07**: Host writes `<serial>-<YYYYMMDD-HHmmss>.md` with YAML frontmatter + comment body
- [ ] **HOST-08**: Host decodes already-cropped PNG data-URLs and writes them next to the `.md` as `<base>+<N>.png`, recording paths in frontmatter and body
- [ ] **HOST-09**: Writes are confined inside `--root`; path traversal is rejected; `--notes-dir` must resolve inside `--root`
- [ ] **HOST-10**: CORS echoes the request `Origin` and allows the `X-Stickyfix-Token` header for `POST`/`OPTIONS`
- [ ] **HOST-11**: Body size cap of 12 MB; larger payloads rejected with 413
- [ ] **HOST-12**: Notes dir is created if missing with a `.gitkeep`; token also written to gitignored `<root>/.stickyfix-token`
- [ ] **HOST-13**: Host accepts `--origin` (repeatable), `--name`, `--notes-dir`, `--token` (else `STICKYFIX_TOKEN` env, else random UUID) via `util.parseArgs`

### Extension Shell & Routing (EXT)

- [ ] **EXT-01**: MV3 manifest with `activeTab`, `scripting`, `storage`, `tabs` permissions; localhost host_permissions; `optional_host_permissions` requested on demand
- [ ] **EXT-02**: Review UI is injected dynamically via `chrome.scripting.executeScript` only on entering Review Mode (no static content_scripts)
- [ ] **EXT-03**: Toolbar popup lists every discovered host with project name + per-host token entry/state and an Enter/Exit Review Mode toggle
- [ ] **EXT-04**: Service worker probes ports 39240–39260 and builds a registry of all live hosts from `/status`
- [ ] **EXT-05**: All localhost fetches route through the service worker (not the content script) to satisfy Chrome LNA/CORS
- [ ] **EXT-06**: Each note routes by the active tab's origin to the advertising host with zero per-note picks
- [ ] **EXT-07**: Unknown origin prompts a one-time host dropdown; the `origin → host` mapping persists and is never re-asked
- [ ] **EXT-08**: Same-origin clashes are resolved by page self-id (`<meta name="stickyfix-project">` / `window.__stickyfix_project`) preferred over the origin map
- [ ] **EXT-09**: Registry, per-host tokens, `origin → host` map, and prefs persist in `chrome.storage.local` and survive Chrome restart + service-worker recycling
- [ ] **EXT-10**: On wake the worker re-discovers hosts and re-binds by project name+origin (not port) when a host restarts on a different port
- [ ] **EXT-11**: A draggable, viewport-clamped connection chip (`z-index: 2147483647`) shows connection state + target project/notes dir with an Exit button

### Free-Note Mode (FREE)

- [ ] **FREE-01**: A draggable `+` floating action button opens a single post-it note card (textarea + Send/Cancel)
- [ ] **FREE-02**: The post-it card is draggable; only one active note card at a time
- [ ] **FREE-03**: Send captures url, title, timestamp, viewport, and POSTs to the routed host, writing `notes/0001-<ts>.md`
- [ ] **FREE-04**: A toast confirms the written filename on success

### Element-Note Mode (ELEM)

- [ ] **ELEM-01**: The 🎯 picker enters pick mode; hovering highlights the element under cursor with an outline + `tag · WxH` label; `Esc` cancels
- [ ] **ELEM-02**: Clicking an element captures a robust unique selector via `@medv/finder`
- [ ] **ELEM-03**: Capture includes tag, id, classList, name, type, href, role, ariaLabel + aria-*, collapsed text (~1000 char truncation noted)
- [ ] **ELEM-04**: Capture includes rect (rounded + page-absolute), a curated `computedStyles` set (single config constant), truncated `outerHTML` (~2000 chars), and full `dataset`
- [ ] **ELEM-05**: Best-effort React fiber detection walks up to the nearest named component and records its display name (omitted if undetectable)
- [ ] **ELEM-06**: Capture includes `nearestTestId` (closest ancestor-or-self `data-testid`)
- [ ] **ELEM-07**: The post-it pre-fills with a compact context summary; full detail goes into the `.md`
- [ ] **ELEM-08**: On Send, an auto element-highlight screenshot (`+1`) is captured with the highlight box drawn on the selected element
- [ ] **ELEM-09**: The element note `.md` includes selector + react_component frontmatter, a curated computed-styles table, and truncated outerHTML

### Region Capture (CAM)

- [ ] **CAM-01**: A 📷 camera tool is available on every note (free and element)
- [ ] **CAM-02**: Activating it dims the page with a scrim and switches the cursor to a crosshair
- [ ] **CAM-03**: The user drags a rectangle (via interact.js); sub-threshold (<~6px) drag or `Esc` cancels without capturing
- [ ] **CAM-04**: On release, stickyfix hides its own UI, captures the visible tab, crops to the dragged rect (DPR-corrected), and restores the UI
- [ ] **CAM-05**: Each crop attaches as a deletable (`×`) thumbnail; multiple captures stack and increment `+2`, `+3`
- [ ] **CAM-06**: Crops are sent as already-cropped PNG data-URLs; the host writes them as `<base>+<N>.png` and records paths in the `.md`

### Visual Design (UI)

- [ ] **UI-01**: Injected UI mounts inside a Shadow DOM (`createShadowRootUi`) so post-it CSS cannot collide with the host page; uses `px` units to resist host font inheritance
- [ ] **UI-02**: Post-it has a genuine sticky-note aesthetic — warm paper color, subtle shadow, legible type, smooth drag
- [ ] **UI-03**: A colored header strip encodes mode (free vs element distinct colors)
- [ ] **UI-04**: Success and error states surface as styled toasts

### Reliability (REL)

- [ ] **REL-01**: Every failed Send (host down, 4xx/5xx, token rejected, no host for origin) surfaces a visible toast — never a silent drop
- [ ] **REL-02**: Multi-note sessions remain stable; a second note increments the serial to `0002`
- [ ] **REL-03**: Large-screenshot payloads are handled gracefully (size guard + clear error)

### review-notes Skill (SKILL)

- [ ] **SKILL-01**: Ship `skill/SKILL.md` + install README that works for any folder-reading AI agent
- [ ] **SKILL-02**: Skill globs `notes/*.md`, excludes `*.read.md`, sorts by leading serial ascending
- [ ] **SKILL-03**: For each unread note, the skill reads frontmatter/body/element-context/screenshot path and performs the requested fix
- [ ] **SKILL-04**: After handling a note, the skill renames it to `*.read.md`; a re-run reports "no unread notes" (idempotent)
- [ ] **SKILL-05**: Edge cases handled — empty queue, ambiguous note (left unread + flagged), missing screenshot (proceed with text)

### Documentation (DOC)

- [ ] **DOC-01**: Root README has install + usage instructions and a demo GIF
- [ ] **DOC-02**: README documents the clean-room MIT provenance and confirms no GPL code present

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Future (FUT)

- **FUT-01**: Firefox/Safari port (keep code port-friendly, don't build)
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
| BUILD-04 | Phase 1 | Pending |
| BUILD-05 | Phase 1 | Pending |
| HOST-01 | Phase 2 | Pending |
| HOST-02 | Phase 2 | Pending |
| HOST-03 | Phase 2 | Pending |
| HOST-04 | Phase 2 | Pending |
| HOST-05 | Phase 2 | Pending |
| HOST-06 | Phase 2 | Pending |
| HOST-07 | Phase 2 | Pending |
| HOST-08 | Phase 2 | Pending |
| HOST-09 | Phase 2 | Pending |
| HOST-10 | Phase 2 | Pending |
| HOST-11 | Phase 2 | Pending |
| HOST-12 | Phase 2 | Pending |
| HOST-13 | Phase 2 | Pending |
| EXT-01 | Phase 3 | Pending |
| EXT-02 | Phase 3 | Pending |
| EXT-03 | Phase 3 | Pending |
| EXT-04 | Phase 3 | Pending |
| EXT-05 | Phase 3 | Pending |
| EXT-06 | Phase 3 | Pending |
| EXT-07 | Phase 3 | Pending |
| EXT-08 | Phase 3 | Pending |
| EXT-09 | Phase 3 | Pending |
| EXT-10 | Phase 3 | Pending |
| EXT-11 | Phase 3 | Pending |
| FREE-01 | Phase 4 | Pending |
| FREE-02 | Phase 4 | Pending |
| FREE-03 | Phase 4 | Pending |
| FREE-04 | Phase 4 | Pending |
| ELEM-01 | Phase 5 | Pending |
| ELEM-02 | Phase 5 | Pending |
| ELEM-03 | Phase 5 | Pending |
| ELEM-04 | Phase 5 | Pending |
| ELEM-05 | Phase 5 | Pending |
| ELEM-06 | Phase 5 | Pending |
| ELEM-07 | Phase 5 | Pending |
| ELEM-08 | Phase 5 | Pending |
| ELEM-09 | Phase 5 | Pending |
| CAM-01 | Phase 6 | Pending |
| CAM-02 | Phase 6 | Pending |
| CAM-03 | Phase 6 | Pending |
| CAM-04 | Phase 6 | Pending |
| CAM-05 | Phase 6 | Pending |
| CAM-06 | Phase 6 | Pending |
| UI-01 | Phase 6 | Pending |
| UI-02 | Phase 6 | Pending |
| UI-03 | Phase 6 | Pending |
| UI-04 | Phase 6 | Pending |
| REL-01 | Phase 8 | Pending |
| REL-02 | Phase 8 | Pending |
| REL-03 | Phase 8 | Pending |
| SKILL-01 | Phase 7 | Pending |
| SKILL-02 | Phase 7 | Pending |
| SKILL-03 | Phase 7 | Pending |
| SKILL-04 | Phase 7 | Pending |
| SKILL-05 | Phase 7 | Pending |
| DOC-01 | Phase 7 | Pending |
| DOC-02 | Phase 7 | Pending |

**Coverage:**

- v1 requirements: 62 total (BUILD×5 + HOST×13 + EXT×11 + FREE×4 + ELEM×9 + CAM×6 + UI×4 + REL×3 + SKILL×5 + DOC×2)
- Mapped to phases: 62
- Unmapped: 0 ✓

Note: The requirements document header previously stated 56 total; the actual count from enumerated REQ-IDs is 62. All 62 are mapped.

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-05-31 — traceability populated after roadmap creation*
