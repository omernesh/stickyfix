# stickyfix

> Stick a note on any web page. Your AI coding agent reads it and fixes it. That's the whole loop.

## The problem you already know too well

You spot something off in your UI — a button that's 4px too low, a heading that wraps weird, a modal that scrolls when it shouldn't. So you screenshot it. Paste it into a chat. Type a paragraph explaining *which* button, on *which* page, and what "right" looks like. Your agent guesses. You screenshot again. Round and round.

That ping-pong is slow, lossy, and maddening — and it throws away everything the browser already knows about the element you're pointing at.

**stickyfix kills the ping-pong.** You drop a note *directly on the thing*, and it lands on disk as a precise, context-rich markdown file your agent can just read.

## How it feels to use

1. Click into **Review Mode** on any page.
2. Drop a **sticky note** — free-floating, or click an element to anchor it. Anchored notes auto-capture the CSS selector, computed styles, outerHTML, a screenshot, the React component name, and more. No describing required.
3. Tell your agent **"read my notes."** It reads the fresh `.md` files, makes the fixes, and marks each one done so the next pass only sees what's new.
4. Glance, drop a few more, repeat. Your UI gets tighter every loop.

No cloud. No accounts. No sign-up. Everything stays on `127.0.0.1` — **your code and your notes never leave your machine.**

## Get started

> **Developer preview.** stickyfix currently runs as an unpacked Chrome extension plus a tiny local helper. The one-command `npx stickyfix init` and one-click Web Store install are on the way — for now it's the short setup below, and we've made it as close to zero-fuss as a preview can be.

**1. Grab it and build it (once):**

```bash
npm install
npm run build
```

**2. Run the installer — it does the fiddly parts for you:**

```bash
node dist/host/stickyfix-init.cjs init --root /path/to/your/project
```

This one command:
- registers the secure pairing channel for you,
- prints your **extension ID** (it's stable — you'll never copy-paste a token), and
- drops a **"Stickyfix Host" icon on your Desktop** so you can start the backend with a double-click — no terminal babysitting.

**3. Load the extension:** open `chrome://extensions`, flip on **Developer Mode**, click **Load unpacked**, and pick the `.output/chrome-mv3/` folder. (The ID matches what the installer printed — nothing to type.)

**4. Start the backend:** double-click the **Stickyfix Host** icon on your Desktop. That's it — no commands, and double-clicking again is safe (it won't launch a second copy).

**5. Pair in one click:** open the stickyfix popup in your toolbar and hit **Pair with host**. The token is handed over automatically behind the scenes — you never see it, never paste it. Pair once and it stays paired, even after restarts.

Now open your app, click **Enter Review Mode**, and start dropping notes. When you're ready, tell your AI agent *"read my notes."*

## Tell your agent to read your notes

The **review-notes** skill is the agent half of the loop. It works through your unread notes in order, applies each fix, and quietly marks each one read — so re-running is always safe.

**Claude Code (project-local):**

```bash
mkdir -p .claude/skills/review-notes
cp /path/to/stickyfix/skill/SKILL.md .claude/skills/review-notes/SKILL.md
```

**Any other folder-reading agent (Cursor, Codex, etc.):** point it at `skill/SKILL.md` — it's plain markdown, no Claude-specific bits. For example: *"follow the instructions in skill/SKILL.md."*

**Just say the word.** Any of these kicks it off:

- "read my notes"
- "process review notes"
- "fix sticky notes"
- "what notes do I have"

**Under the hood, it:**

1. Finds every unread `notes/*.md` (skips ones already handled), oldest first.
2. Reads the note plus its screenshots, then makes the code change.
3. Marks the note read — only *after* the fix lands.
4. Flags anything ambiguous instead of guessing, so it surfaces again next run.
5. Gives you a one-line recap: N fixed, K flagged, J already done.

Run it on a clean directory and it just says "nothing to do." Safe to fire any time.

## Your code stays yours

stickyfix is built localhost-first on purpose:

- **`127.0.0.1` only.** The helper binds to localhost and nothing else — it's not reachable from anywhere on your network.
- **Authorized writes only.** Every save is token-checked. The token is delivered to the extension over a secure OS channel during pairing — it never travels over the web and you never handle it.
- **Right project, every time.** Each browser tab's origin is mapped to the matching project, so notes land in the correct folder automatically.
- **Stays in its lane.** The helper only writes `.md` and `.png` files inside the project folder you chose. Path-traversal tricks are rejected.
- **Sensible limits.** Oversized payloads are turned away (12 MB cap) so nothing runs away with your disk.

## Works in Chrome and Edge

Chrome and Microsoft Edge are both supported today (Edge is a drop-in). Firefox and Safari packaging paths are documented for a future release — see [docs/cross-browser.md](docs/cross-browser.md).

## Demo

![stickyfix demo](docs/demo-placeholder.png)

*Recorded walkthrough coming soon — the placeholder above will be replaced with a GIF of the full drop-a-note → "read my notes" loop.*

## Troubleshooting

**Popup says it can't reach the host**

Make sure the backend is running — double-click the **Stickyfix Host** icon on your Desktop. The helper listens on a port in the 39240–39260 range; the popup discovers it automatically.

**Pairing didn't take**

Click **Pair with host** again. If it still won't connect, re-run the installer (`node dist/host/stickyfix-init.cjs init --root /path/to/your/project`) and reload the extension.

**Notes aren't showing up on disk**

Double-check the `--root` you passed the installer points at the project you're reviewing. The `notes/` folder is created automatically on the first save.

**Removing stickyfix**

```bash
node dist/host/stickyfix-init.cjs uninstall
```

This cleans up the pairing channel, the desktop launcher, and the local config — no leftovers.

## Advanced: run the backend from a terminal

The desktop icon is the easy path, but you can always start the helper by hand:

```bash
# bash / macOS / Linux
npm run host -- --root /path/to/project --origin http://localhost:3000
```

**Windows PowerShell** — npm 11.x swallows unknown `--flags`, so use one of these:

```powershell
# equals-sign form
npm run host -- --root=C:\path\to\project --origin=http://localhost:3000

# or set env vars first
$env:STICKYFIX_ROOT = "C:\path\to\project"
$env:STICKYFIX_ORIGINS = "http://localhost:3000"
npm run host

# or call node directly
node dist/host/src/index.js --root C:\path\to\project --origin http://localhost:3000
```

For multiple origins, set `STICKYFIX_ORIGINS` to a comma-separated list (e.g. `"http://localhost:3000,http://localhost:4000"`).

## Architecture (one-liner)

```
[Chrome Extension (MV3)]  --POST /annotation-->  [stickyfix-host (localhost)]  --writes-->  notes/NNNN-<ts>.md
        you annotate                 token-authed, 127.0.0.1 only                 your AI agent reads these
```

Pairing rides a separate OS-level native-messaging channel so the token never touches the web; notes themselves flow over the localhost HTTP relay.

## License & provenance

MIT © 2026 Omer Nesher. See [LICENSE](./LICENSE).

This is an **original, clean-room implementation**. See [CLEAN-ROOM.md](./CLEAN-ROOM.md) for the full MIT provenance declaration, clean-room method narrative, and the live GPL grep audit result.
