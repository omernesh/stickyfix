# Changelog

All notable changes to **stickyfix** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Folder picker error reporting:** when the native host is down or its token is missing, the chip/card now surfaces the real host error (e.g. _"stickyfix host not found — run: npx stickyfix init"_) instead of the misleading _"No folder chosen — note not saved. Drop again to pick one."_ toast. The "drop again" message is shown only when the OS dialog is actually dismissed by the user.
- **Folder picker no longer requires a token:** the native host reads `.stickyfix-token` lazily (only for token pairing), so choosing a project folder works during onboarding even before the host token exists. Previously the native host exited early when the token file was absent and the OS dialog never opened.
- **Automatic recovery from token rotation:** every host request — loading pins, saving, editing, deleting notes, and fetching screenshots — now auto re-pairs with the native host and retries once on HTTP 401, so a host restart (which mints a new token) no longer dead-ends with an _"unauthorized"_ toast (e.g. _"Could not load pins — unauthorized"_).

## [1.0.0] - 2026-06-07

### Added
- Initial public release (npm: `stickyfix`, MIT).
- Chrome MV3 extension (WXT) to pin free-floating or DOM-anchored sticky notes on any web page; review UI injected on demand inside a shadow root.
- Localhost native-messaging host (Node built-ins + `yaml`) that writes each note as a markdown file into the target project's `notes/` folder, auto-creating `notes/` if missing.
- Turnkey onboarding via `npx stickyfix init --root <project>` — registers the native-messaging host and Desktop launcher.
- Zero-config origin→folder mapping (D-04): an unmapped origin opens an OS folder picker; the choice is remembered and reused silently.
- Security: host binds `127.0.0.1` only, token auth on `POST /annotation`, 12 MB body cap.
