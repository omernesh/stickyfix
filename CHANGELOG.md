# Changelog

All notable changes to **stikfix** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **"Browse folder…" in the chip dropdown.** Review Mode's project pull-down now has a `📁 Browse folder…` item at the top, so you can pick the project folder for the current site directly — no longer only via the first Send. Selecting it opens the OS folder dialog, persists the origin→folder mapping, and the chip self-updates to the `→ name · <folder>` routed label. The existing host-routing options and the Send→needs-folder flow are unchanged.
- **Firefox MV3 support (full port).** New `npm run build:firefox` WXT target emits a Firefox build with `browser_specific_settings.gecko.id` (`stikfix@stikfix.com`, `strict_min_version 109.0`). `npx stikfix init --root <dir> --browser firefox` registers a Firefox native-messaging host — `allowed_extensions` (gecko id) instead of `allowed_origins`, Mozilla manifest paths (macOS/Linux) and the `HKCU\Software\Mozilla\NativeMessagingHosts` registry key on Windows. The Chrome build is unchanged (same `key`, same derived extension ID).

### Changed
- **Renamed: stickyfix → stikfix.** The project, npm package (`stikfix`), CLI (`npx stikfix init`), native-messaging host id (`com.stikfix.host` + its OS registry keys), Firefox add-on id (`stikfix@stikfix.com`), env-var prefix (`STIKFIX_*`), and the on-disk `.stikfix-token` / `.stikfix-port` files are all renamed to **stikfix**. New home: `github.com/omernesh/stikfix` and `stikfix.com`. The Chrome extension's pinned ID is unchanged, so existing Chrome users keep the same extension; anyone who ran the old host must re-run `npx stikfix init` to re-register it under the new id.

### Fixed
- **Hermetic port-scan test (WR-06).** The test previously hardcoded the production port `39240` as its "occupied" blocker, so it failed with `EADDRINUSE` whenever a real stikfix host was already running on that port. It now occupies an OS-assigned ephemeral port and scans a range starting on it. `bindServer()` gained optional `startPort`/`endPort` params (defaulting to the existing `39240`–`39260` range) to support this — production behavior is unchanged.

## [1.1.1] - 2026-06-17

### Fixed
- **Free-note pins now restore where you dropped them.** A wire-key mismatch (the host serialized the field as `viewportCoords` while the extension read `note_position`) meant every free-floating pin fell back to the top-left corner instead of its saved position. The host descriptor field is now `note_position` end-to-end (matching the on-disk frontmatter key and the extension). Pre-existing since persistent pins shipped; surfaced by the v1.1.0 review.
- **All-pages live sync.** When the notes panel is in "All pages" mode, the live poller now polls project-wide, so a reply/status change to a note on another page updates the panel without a manual refresh (a scope switch itself no longer triggers a spurious pin re-render).

### Internal
- The service-worker `PinDescriptor` type now declares `reply`/`fixedIn` (type honesty; the fields were already forwarded structurally).

## [1.1.0] - 2026-06-17

### Added
- **Two-way review loop — AI replies on the page.** Notes now carry a `reply` (and optional `fixed_in`) field the AI writes when it processes them, surfaced on the pin and in the notes panel. New status model: `unread` (yellow) → `flagged` (amber pin, hover shows the AI's clarification question) → `resolved` (green ✓ pin, hover shows what was fixed — stays visible so you can verify) → `read` (hidden archive). The `review-notes` skill now sets `status: resolved` + `reply` on a fix instead of immediately archiving; `read`/`*.read.md` is reserved for the developer-triggered archive/dismiss step.
- **Notes panel.** A chip-toggled panel listing every note for the page: status counts, filter chips (all/unread/flagged/resolved), text search, and click-to-jump that scrolls to the pin. An "All pages" toggle lists notes across the whole project folder (`GET /annotations?scope=all`); clicking an off-page note navigates to it (http/https only).
- **Live disk→UI sync.** While Review Mode is active and the tab is visible, the page polls for note changes (~4s) and re-renders pins + panel when the AI writes a reply or changes a status — no manual refresh needed.
- **Pin decluttering.** Pins that would overlap now fan out deterministically so dense pages stay readable and every pin remains clickable.
- **Continuous integration.** GitHub Actions runs `npm run check` on push and PRs across Ubuntu and Windows (cross-platform build gate).

### Security
- The notes panel only navigates to `http`/`https` note URLs; a note file whose `url` is a `javascript:`/`data:` URL can no longer trigger navigation.

## [1.0.4] - 2026-06-17

### Fixed
- **Read notes no longer show a pin:** marking a note read (via the `review-notes` skill) now removes its pin from the page on the next refresh. The host's `listAnnotations` previously returned every note matching the page URL — including read ones — so a marked-read note's pin lingered (merely dimmed) until the file was deleted. The host now excludes notes the skill has marked done, by both signals it writes: the `*.read.md` filename rename (primary) and `status: read` in frontmatter (secondary). Unread notes are never affected — a freshly written note is always `status: unread` with a plain `.md` name, so the reliable-capture invariant holds.

## [1.0.3] - 2026-06-10

### Fixed
- **Stale pins after SPA navigation:** pins from a prior page no longer linger after an in-page (SPA) route change. Pins and the chip route are URL-scoped, but an in-page navigation does not reload the document, so the content script (and its pins) stayed bound to the old URL. The SW now detects in-page URL changes (`tabs.onUpdated` with `changeInfo.url`) on review-mode tabs and signals the live content script, which re-fetches pins (URL-filtered by the host) and refreshes the chip for the new URL. A mount-generation guard prevents overlapping refreshes from double-appending pins.

## [1.0.2] - 2026-06-10

### Fixed
- **Duplicate chip per tab:** entering Review Mode no longer leaves two chips in a tab. The idempotency guard now uses a synchronous isolated-world flag set before `createShadowRootUi` is awaited, closing a race where a second injection (SW re-inject on `tabs.onUpdated`, a repeated `complete` fire, or a fast re-enter) ran during the await window — before the shadow host was in the DOM — and the old `document.querySelector` guard missed it. The flag is released on chip close / exit / context invalidation so re-entering review mode still works.

## [1.0.1] - 2026-06-07

### Fixed
- **Folder picker error reporting:** when the native host is down or its token is missing, the chip/card now surfaces the real host error (e.g. _"stikfix host not found — run: npx stikfix init"_) instead of the misleading _"No folder chosen — note not saved. Drop again to pick one."_ toast. The "drop again" message is shown only when the OS dialog is actually dismissed by the user.
- **Folder picker no longer requires a token:** the native host reads `.stikfix-token` lazily (only for token pairing), so choosing a project folder works during onboarding even before the host token exists. Previously the native host exited early when the token file was absent and the OS dialog never opened.
- **Automatic recovery from token rotation:** every host request — loading pins, saving, editing, deleting notes, and fetching screenshots — now auto re-pairs with the native host and retries once on HTTP 401, so a host restart (which mints a new token) no longer dead-ends with an _"unauthorized"_ toast (e.g. _"Could not load pins — unauthorized"_).

## [1.0.0] - 2026-06-07

### Added
- Initial public release (npm: `stikfix`, MIT).
- Chrome MV3 extension (WXT) to pin free-floating or DOM-anchored sticky notes on any web page; review UI injected on demand inside a shadow root.
- Localhost native-messaging host (Node built-ins + `yaml`) that writes each note as a markdown file into the target project's `notes/` folder, auto-creating `notes/` if missing.
- Turnkey onboarding via `npx stikfix init --root <project>` — registers the native-messaging host and Desktop launcher.
- Zero-config origin→folder mapping (D-04): an unmapped origin opens an OS folder picker; the choice is remembered and reused silently.
- Security: host binds `127.0.0.1` only, token auth on `POST /annotation`, 12 MB body cap.
