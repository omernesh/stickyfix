# Changelog

All notable changes to **stickyfix** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Folder picker error reporting:** when the native host is down or its token is missing, the chip/card now surfaces the real host error (e.g. _"stickyfix host not found — run: npx stickyfix init"_) instead of the misleading _"No folder chosen — note not saved. Drop again to pick one."_ toast. The "drop again" message is shown only when the OS dialog is actually dismissed by the user.
- **Folder picker no longer requires a token:** the native host reads `.stickyfix-token` lazily (only for token pairing), so choosing a project folder works during onboarding even before the host token exists. Previously the native host exited early when the token file was absent and the OS dialog never opened.
- **Automatic recovery from token rotation:** saving a note now auto re-pairs with the native host and retries once on HTTP 401, so a host restart (which mints a new token) no longer dead-ends with an _"unauthorized"_ toast.

## [1.0.0] - 2026-06-07

### Added
- Initial public release (npm: `stickyfix`, MIT).
- Chrome MV3 extension (WXT) to pin free-floating or DOM-anchored sticky notes on any web page; review UI injected on demand inside a shadow root.
- Localhost native-messaging host (Node built-ins + `yaml`) that writes each note as a markdown file into the target project's `notes/` folder, auto-creating `notes/` if missing.
- Turnkey onboarding via `npx stickyfix init --root <project>` — registers the native-messaging host and Desktop launcher.
- Zero-config origin→folder mapping (D-04): an unmapped origin opens an OS folder picker; the choice is remembered and reused silently.
- Security: host binds `127.0.0.1` only, token auth on `POST /annotation`, 12 MB body cap.
