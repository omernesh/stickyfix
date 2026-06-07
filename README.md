<div align="center">

<img src="public/icon/128.png" alt="stickyfix" width="96" height="96" />

# stickyfix

**Stick a note on any web page. Your AI coding agent reads it and fixes it. That's the whole loop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/stickyfix.svg)](https://www.npmjs.com/package/stickyfix)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-blue.svg)](#load-the-extension)

</div>

---

## The problem you already know too well

You spot something off in your UI — a button that's 4px too low, a heading that wraps weird, a modal that scrolls when it shouldn't. So you screenshot it. Paste it into a chat. Type a paragraph explaining *which* button, on *which* page, and what "right" looks like. Your agent guesses. You screenshot again. Round and round.

That ping-pong is slow, lossy, and maddening — and it throws away everything the browser already knows about the element you're pointing at.

**stickyfix kills the ping-pong.** You drop a note *directly on the thing*, and it lands on disk as a precise, context-rich markdown file in your project's `notes/` folder — which your AI agent can just read, fix, and mark done. A durable, file-based review loop instead of ephemeral chat.

No cloud. No accounts. No sign-up. Everything stays on `127.0.0.1` — **your code and your notes never leave your machine.**

## How it feels to use

1. Click **Enter Review Mode** on any page.
2. Drop a **sticky note** — free-floating, or click an element to anchor it. Anchored notes auto-capture the CSS selector, computed styles, `outerHTML`, the bounding box, an auto-highlighted screenshot, and the React component name. No describing required.
3. Tell your agent **"read my notes."** It reads the fresh `.md` files, makes the fixes, and marks each one done so the next pass only sees what's new.
4. Glance, drop a few more, repeat. Your UI gets tighter every loop.

## Quick start

### 1. Install the host (one command)

```bash
npx stickyfix init --root /path/to/your/project
```

This turnkey installer:

- registers the secure native-messaging host for **Chrome and Edge** (user-level, no admin rights),
- writes a small config pointing at your project,
- creates a **"Stickyfix Host" launcher on your Desktop** so you can start the backend with a double-click — no terminal babysitting,
- prints your stable **extension ID** (you never copy-paste a token).

> **Keep it current:** re-run `npx --yes stickyfix@latest init --root /path/to/your/project` anytime to update the host.

### 2. Load the extension

For v1.0 the extension is loaded **unpacked** (a Chrome Web Store listing is coming next):

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the **`.output/chrome-mv3/`** folder from this repo.

The loaded ID matches what the installer printed — nothing to type. (Building `.output/chrome-mv3/` from source is covered under [Development](#development).)

### 3. Start the backend

Double-click the **Stickyfix Host** launcher on your Desktop. That's it — no commands, and double-clicking again is safe (it won't launch a second copy). The host listens on a port in the `39240–39260` range; the extension discovers it automatically.

### 4. Pair in one click

Open the stickyfix popup in your toolbar and hit **Pair with host**. The token is handed over automatically through the OS native-messaging channel — you never see it, never paste it. Pair once and it stays paired, even after restarts.

### 5. Drop a note

Open your app, click **Enter Review Mode**, and start dropping notes. The first note on a new site opens an **OS folder picker** so you can choose where that origin's notes live; it's remembered after that. When you're ready, tell your AI agent **"read my notes."**

## Features

- **Free notes** — a draggable post-it you can drop anywhere on the page. Captures URL, title, timestamp, viewport, and a screenshot.
- **Element notes** — click any element and the note auto-captures a robust unique CSS selector ([`@medv/finder`](https://github.com/antonmedv/finder)), curated computed styles, truncated `outerHTML`, bounding box, `data-*`, accessibility role/label, the best-effort **React component name**, and an **auto element-highlight screenshot** showing exactly which element you meant.
- **Region / marquee capture** — the camera tool dims the page, gives you a crosshair, and lets you drag a rectangle. stickyfix hides its own UI, captures, and crops the screenshot DPR-correctly. Stack multiple per note; each is a deletable thumbnail.
- **Persistent on-page pins** — notes stay visible as pins on the page across reloads. View, edit, and delete them in place — backed by host-side CRUD over the localhost relay.
- **Per-origin project routing** — the first note on a new site opens an OS folder picker; after that, every tab routes to the right project's `notes/` folder automatically. No per-note picking.
- **Cross-browser host** — one `npx stickyfix init` registers Chrome and Edge in a single pass.
- **The `review-notes` AI skill** — the portable agent half of the loop (see below).

## How notes reach your AI

Every note becomes a markdown file in your project's `notes/` folder, named `<serial>-<YYYYMMDD-HHmmss>.md` (e.g. `0007-20260531-143022.md`), with any screenshots written alongside it as `<base>+<N>.png`. Element notes embed a full **Element context** section — selector, computed styles, `outerHTML`, React component — so an agent can locate the exact code without guessing.

The **review-notes** skill is the agent half of the loop. It works through your unread notes in serial order, applies each fix, then renames each file to `*.read.md` so re-running is always idempotent.

**Claude Code (project-local):**

```bash
mkdir -p .claude/skills/review-notes
cp /path/to/stickyfix/skill/SKILL.md .claude/skills/review-notes/SKILL.md
```

**Any other folder-reading agent (Cursor, Codex, etc.):** point it at [`skill/SKILL.md`](skill/SKILL.md) — it's plain markdown, no Claude-specific bits. For example: *"follow the instructions in skill/SKILL.md."*

**Just say the word.** Any of these kicks it off:

- "read my notes"
- "process review notes"
- "fix sticky notes"
- "what notes do I have"

**Under the hood, it:**

1. Finds every unread `notes/*.md` (skips `*.read.md`), oldest serial first.
2. Reads the note plus its screenshots, then makes the code change.
3. Marks the note read — only *after* the fix lands. If a fix is interrupted, the note stays unread and is retried next run.
4. Flags anything ambiguous instead of guessing, so it surfaces again next run for you to clarify.
5. Gives you a one-line recap: N fixed, K flagged, J already done.

Run it on a clean directory and it just says "no unread notes." Safe to fire any time.

## Demo

![stickyfix demo](docs/demo-placeholder.png)

*Recorded walkthrough coming soon — the placeholder above will be replaced with a GIF of the full drop-a-note → "read my notes" loop.*

## Cross-browser

| Browser | v1.0 status | Notes |
|---------|-------------|-------|
| **Chrome** | Supported | Load unpacked from `.output/chrome-mv3/` |
| **Edge** | Supported | Drop-in; the same artifact loads directly. `init` registers Edge automatically |
| Firefox | Documented (next) | Different native-messaging manifest key; path documented |
| Safari | Documented (next) | App-bundled extension via Mac App Store; path documented |

Full packaging details, manifest locations, and the Firefox/Safari paths are in [docs/cross-browser.md](docs/cross-browser.md).

## Security

stickyfix is built localhost-first on purpose:

- **`127.0.0.1` only.** The host binds to localhost and nothing else — never `0.0.0.0`, not reachable from your network.
- **Authorized writes only.** Every `POST /annotation` is token-checked. The token is delivered to the extension over the OS native-messaging channel during pairing — it never travels over the web and you never handle it.
- **Stays in its lane.** The host only writes `.md` and `.png` files inside the project folder you chose (its `notes/` dir). Path-traversal attempts are rejected; no eval, no shelling out.
- **Sensible limits.** Oversized payloads are turned away (12 MB body cap → `413`).
- **Right project, every time.** Each tab's origin is mapped to its project, so notes land in the correct folder automatically.
- **MIT, clean-room.** Original implementation written from spec — contains no code from the GPL-3.0 upstream. See [CLEAN-ROOM.md](./CLEAN-ROOM.md) for the full provenance declaration and GPL grep audit.

## Development

Build the extension and host from source:

```bash
npm install          # installs deps + runs `wxt prepare`
npm run build        # builds the extension (.output/chrome-mv3) + host bundles
npm test             # host test suite
npm run check        # full gate: tsc, clean-room check, host smoke test, all tests
```

Useful scripts:

- `npm run dev` — WXT dev server with HMR for the extension.
- `npm run host -- --root /path/to/project --origin http://localhost:3000` — start the host directly from a terminal (the Desktop launcher is the easy path; this is the manual one). On Windows PowerShell, use the equals form (`--root=C:\path`) or set `STICKYFIX_ROOT` / `STICKYFIX_ORIGINS` env vars, since npm 11.x swallows unknown `--flags`.

**Removing stickyfix:**

```bash
npx stickyfix uninstall
```

This removes the native-messaging manifest, the desktop launcher, and the local config — no leftovers.

### Architecture (one-liner)

```
[Chrome/Edge Extension (MV3)]  --POST /annotation-->  [stickyfix host (localhost)]  --writes-->  notes/NNNN-<ts>.md
        you annotate                token-authed, 127.0.0.1 only                      your AI agent reads these
```

Pairing rides a separate OS-level native-messaging channel so the token never touches the web; notes themselves flow over the localhost HTTP relay (`GET /status`, `POST /annotation`, plus `GET/PUT/DELETE /annotation/<serial>` for the persistent on-page pins).

## Tech stack

TypeScript ES modules both halves. Extension built with [WXT](https://wxt.dev) (Vite, MV3) — vanilla DOM in a shadow root, [`@medv/finder`](https://github.com/antonmedv/finder) for selectors, [`interactjs`](https://interactjs.io) for drag + marquee, native `chrome.tabs.captureVisibleTab` + canvas crop for screenshots. The host is Node built-ins only plus [`yaml`](https://eemeli.org/yaml/) for safe frontmatter.

## License & provenance

MIT © 2026 Omer Nesher. See [LICENSE](./LICENSE).

This is an **original, clean-room implementation**. See [CLEAN-ROOM.md](./CLEAN-ROOM.md) for the full MIT provenance declaration, clean-room method narrative, and the live GPL grep audit result.
