# stickyfix

## What This Is

A Chrome extension (MV3) + a tiny localhost host that let a developer pin **sticky notes** onto any web page — free-floating or anchored to a specific DOM element — and have each note written as a **markdown file** into the project's `notes/` folder, so an AI coding agent can read them, fix them, and iterate. It replaces the painful screenshot-paste-describe ping-pong of UI review with a durable, file-based, iterative review loop. Product-agnostic: works on any web page in Chrome.

## Core Value

A note dropped on a page reliably becomes a precise, context-rich `.md` file on disk in the right project's `notes/` folder — never silently lost. Reliable capture is the whole point; a dropped note is a regression.

## Requirements

### Validated

- ✓ Cross-platform build (Windows/macOS/Linux) — no macOS-only steps — Phase 1 (`npm run build`/`npm run check` green on Windows; no sips/Bun)
- ✓ MIT clean-room foundation established — `sfx-*`/`stickyfix` namespace + automated grep gate from commit one — Phase 1 (BUILD-04)
- ✓ Localhost host writes notes to disk — `127.0.0.1`-only HTTP server, token auth, serial mutex, safe `.md`+`.png` writes inside `--root`, CORS, 12MB cap — Phase 2 (HOST-01..13; 48 tests)
- ✓ Token auth on the host (`X-Stickyfix-Token`); host binds `127.0.0.1` only — Phase 2 (HOST-02, HOST-05; owner-only token file)

### Active

- [ ] One-click Review Mode toggle on any page via an MV3 Chrome extension
- [ ] Free-floating note mode via a draggable `+` button
- [ ] Element-anchored note mode via an element picker with rich auto-capture (selector, computed styles, outerHTML, rect, react fiber, a11y)
- [ ] Notes written to disk as `.md` files by a localhost host (the bridge MV3 can't be)
- [ ] Distinct, sortable file naming (running serial + timestamp) for ordered, unread/read processing
- [ ] `📷` camera tool: DPR-correct region capture cropped extension-side, multiple deletable thumbnails per note
- [ ] Auto element-highlight screenshot on element-note Send
- [ ] Multi-project routing: one host per project, extension discovers all live hosts, routes by tab origin with zero per-note picks
- [ ] One-time origin→project mapping persisted in `chrome.storage.local`, re-binds by name+origin across restarts
- [ ] No silent failures — every routing/auth/connection error surfaces as a visible toast (extension side)
- [ ] Design-conscious sticky-note UI (genuine paper aesthetic, smooth drag, mode color-coding, shadow-DOM isolation)
- [ ] Shipped `review-notes` AI skill: reads unread notes in serial order, renames each to `*.read.md`
- [ ] MIT clean-room implementation — keep writing original code, nothing copied from the GPL upstream (gate enforced each phase)

### Out of Scope

- Cloud sync / multi-user / accounts / remote backend — local-only, private, zero-account by design (NG1)
- Deep integration with a specific AI agent's API — the contract is files on disk; any folder-reading agent works (NG2)
- Full-page (scrolling) screenshot — visible-viewport capture is enough for v1 (NG3)
- Firefox/Safari port — Chrome/Chromium MV3 only; keep code port-friendly but don't build it (NG4)
- Shadow-DOM deep traversal — best-effort capture only in v1, note the limitation (NG5)
- Central note store + prefixing — rejected; orphans notes from their repo and complicates the skill (§15)

## Context

- Conceived while iterating on a React admin panel (`chatlytics.ai`), but deliberately product-agnostic.
- Today's loop forces the developer to be both the rendering pipeline and the context-transfer mechanism: screenshot → paste → describe-which-element → AI guesses → repeat. stickyfix removes the human from that pipe by capturing exact element context (selector, computed styles, outerHTML, bbox, screenshot) at click time.
- MV3 extensions are sandboxed and cannot write to arbitrary filesystem paths; the File System Access API needs per-session re-grants. A localhost host owns the notes dir, assigns serials atomically, validates paths, and writes files. This is the chosen architecture (path "A").
- Developer's primary OS is **Windows** — the build must succeed there with no macOS-only steps.
- Architecture was derived by **studying** the GPL-3.0 project `JodusNodus/opencode-chrome-annotation` for ideas only. This is a clean-room MIT build (see Key Decisions and PRD §13): architectural facts may be reused; no code/comments/identifiers/file structure/text may be copied.

## Constraints

- **License**: Deliverable is MIT — must not copy any code/text from the GPL-3.0 upstream; write original code from spec (PRD §13).
- **Tech stack**: TypeScript ES modules both halves. Extension via **WXT** (Vite-based, cross-platform); vanilla DOM in a shadow root (`createShadowRootUi`); `@medv/finder` for selectors; `interact.js` for drag + marquee; native `chrome.tabs.captureVisibleTab` + canvas crop for screenshots. Host = Node built-ins only (`http`, `fs`, `crypto`, `path`, `util.parseArgs`) **plus one dep: `yaml`** for frontmatter.
- **Compatibility**: Cross-platform build (Windows/macOS/Linux) — no `sips`, no Bun, no macOS-only steps.
- **Security**: Host binds `127.0.0.1` only (never `0.0.0.0`); token auth required on `POST /annotation`; writes confined inside `--root`; no eval, no shelling out; body cap 12 MB (413 over).
- **Platform**: Chrome/Chromium MV3 only for v1.
- **Reliability**: No silent failures — every failed Send must surface a visible toast.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Localhost host writes files (path "A") | MV3 can't write arbitrary paths; File System Access API needs per-session re-grants | — Pending |
| WXT as extension framework | Cross-platform Vite build, generates manifest + icons from one source, shadow-root UI, on-demand injection — avoids upstream's macOS-only Bun/`sips` | — Pending |
| `@medv/finder` for selectors | Robust unique CSS selectors; don't hand-roll a fragile heuristic (also clean-room separation from upstream) | — Pending |
| Host-per-project + auto-route by tab origin | Concurrent reviews with zero per-note picks; notes stay in each project's own repo | — Pending |
| Crop screenshots extension-side (canvas) | Keeps host near-zero-dep; DPR-correct crop done before POST | — Pending |
| `chrome.storage.local` for all settings | Survives Chrome restart + MV3 service-worker recycling; never in worker memory; re-bind by name+origin not port | — Pending |
| Token auth via `X-Stickyfix-Token` header | We write files to disk — any local page guessing the port could otherwise write notes | — Pending |
| Serial + timestamp filenames; `.read.md` rename marker | Chronological order + unique key; rename is the idempotent "processed" signal for the skill | — Pending |
| Only `/status` + `/annotation` endpoints | Drop upstream's OpenCode session-binding endpoints (`/sessions`,`/claim`,`/unclaim`) we don't need | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-03 after Phase 7 (review-notes Skill + Docs) — portable `skill/SKILL.md` processes `notes/*.md` in serial order (auto-fix → rename `*.read.md` + `status: read`; ambiguous→flagged; missing-screenshot→text-only), backed by pure `lib/review-notes.ts` helpers (131/131 tests); quickstart-first README + CLEAN-ROOM.md (live GPL audit PASS). SKILL-01–05/DOC-01–02 done. One human UAT pending (live skill run, runbook in 07-HUMAN-UAT.md). Next: Phase 8 (Hardening + Pre-Release Audit).*
