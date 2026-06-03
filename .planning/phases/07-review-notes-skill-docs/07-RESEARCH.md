# Phase 7: review-notes Skill + Docs - Research

**Researched:** 2026-06-03
**Domain:** AI agent skill authoring (markdown prose), note on-disk format parsing, SKILL.md conventions, README/CLEAN-ROOM documentation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship **both** a portable, agent-agnostic `skill/SKILL.md` at repo root (self-contained markdown, no Claude-only frontmatter required to function) **and** a thin `.claude/skills/review-notes/` wrapper that points at it for native Claude Code use. The portable file is the source of truth; the wrapper must not duplicate logic.
- **D-02:** Notes dir resolution = convention `./notes` (relative to project root), overridable by an explicit path argument. Zero-config for the common case.
- **D-03:** Screenshots (`+N.png`) are referenced by path; the skill instructs the agent to open them (vision) when text + element-context is insufficient. Must not hard-require vision (ties into D-09 missing-screenshot tolerance).
- **D-04:** Auto-fix then mark read. For each unread note the skill applies the code change directly using the note's instruction + element context, then renames to `*.read.md`.
- **D-05:** One pass, all unread notes in serial order (glob `notes/*.md`, exclude `*.read.md`, sort by leading 4-digit serial ascending). Resumable because handled notes are renamed as it goes.
- **D-06:** Rename only AFTER the fix succeeds (or is consciously flagged/deferred). A crash mid-fix leaves the note unread → re-runnable, never silently lost.
- **D-07:** Read marker = rename to `*.read.md` AND set frontmatter `status: read`. Belt-and-suspenders: the rename satisfies idempotency/exclusion; the `status: read` keeps the on-page pin showing a read dot.
- **D-08:** Ambiguous note → set frontmatter `status: flagged`, append a `> flagged: <reason>` line to the body, and LEAVE the filename unchanged (stays out of `*.read.md` so it's visible + skippable on re-run).
- **D-09:** Missing screenshot file → warn once (one line), proceed text-only, fix from note text + element context, mark read normally. Never blocks the queue.
- **D-10:** Demo GIF = placeholder image + documented "how to record" steps committed this phase; Omer records the real GIF manually later.
- **D-11:** README = quickstart-first. Top: 5-step quickstart. Below: per-component reference, 127.0.0.1 + token + origin-trust security model, and troubleshooting.
- **D-12:** CLEAN-ROOM.md = MIT provenance + clean-room method narrative + the actual grep audit output run THIS phase.

### Claude's Discretion

- Exact wording/headings of `skill/SKILL.md` steps, README prose, and CLEAN-ROOM narrative.
- The precise one-line warning/summary format the skill emits — keep it terse, machine-greppable if cheap.
- Placeholder image asset choice for the demo GIF slot.

### Deferred Ideas (OUT OF SCOPE)

- Release-gate GPL grep audit (full upstream selector-constant set) — Phase 8 SC-4.
- All error-path toast hardening, concurrent-Send stress, idle-eviction regression — Phase 8.
- Installer / one-click token pairing / host auto-start / cross-browser packaging — Phase 9.
- Real recorded demo GIF asset — Omer records post-phase; this phase ships the placeholder + instructions only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKILL-01 | Ship `skill/SKILL.md` + install README that works for any folder-reading AI agent | SKILL.md format verified from existing ~/.claude/skills examples; portable + wrapper design documented |
| SKILL-02 | Skill globs `notes/*.md`, excludes `*.read.md`, sorts by leading serial ascending | Glob/exclude mechanics confirmed from read-note.ts; filename pattern confirmed from UAT notes |
| SKILL-03 | For each unread note, reads frontmatter/body/element-context/screenshot path and performs the requested fix | Full frontmatter schema documented from write-note.ts + live UAT samples |
| SKILL-04 | After handling a note, renames it to `*.read.md`; a re-run reports "no unread notes" | Rename idempotency mechanics verified; RESEARCH-FLAG-1 answered definitively |
| SKILL-05 | Edge cases: empty queue, ambiguous note (flagged), missing screenshot (text-only) | Edge case handling specified; all three scenarios documented |
| DOC-01 | Root README has install + usage instructions and a demo GIF | Existing README content catalogued; host start command verified from package.json; D-10 placeholder approach documented |
| DOC-02 | README documents the clean-room MIT provenance and confirms no GPL code present | CLEAN-ROOM.md design documented; actual grep audit result confirmed (PASS); moved to standalone CLEAN-ROOM.md per D-12 |
</phase_requirements>

---

## Summary

Phase 7 delivers three artifacts with zero host/extension code changes:

1. `skill/SKILL.md` — portable, agent-agnostic prose that any folder-reading AI follows to process unread notes serially, fix them, and rename them `*.read.md`.
2. `.claude/skills/review-notes/SKILL.md` — a thin Claude Code wrapper that references the portable skill.
3. Documentation — a rewritten root `README.md` (quickstart-first, <5 min to working, demo GIF placeholder) and a new `CLEAN-ROOM.md` (MIT provenance + the actual Phase 1 grep audit output, run again this phase to establish baseline).

The critical architectural question (RESEARCH-FLAG-1) is definitively answered: `listAnnotations` in `host/src/read-note.ts` uses `readdirSync(notesDir).filter(f => f.endsWith('.md'))`. Because `.read.md` ends with `.md`, a renamed `0001-...read.md` IS included in the listing. The `status` field from its frontmatter is surfaced to the extension as `status: "read"`, which drives the read/unread pin dot (PIN-04). D-07 is fully correct as specified — rename + frontmatter update are both necessary and both work.

**Primary recommendation:** Write `skill/SKILL.md` as numbered prose steps (not shell script) — portable across Claude Code, Cursor, Codex, and any folder-reading agent. The Claude Code wrapper in `.claude/skills/review-notes/SKILL.md` needs `name` + `description` frontmatter and a body that says "read and follow `skill/SKILL.md` in this repo." No logic duplication.

---

## RESEARCH-FLAG-1 — Definitive Answer [VERIFIED: host/src/read-note.ts line 73]

**Question:** Does `listAnnotations` include `*.read.md` files, and does their `status: read` frontmatter surface to the extension?

**Finding:** `listAnnotations` at `host/src/read-note.ts:73` uses:
```typescript
const files = readdirSync(notesDir).filter(f => f.endsWith('.md'));
```

A file named `0001-20260603-010538.read.md` **ends with `.md`**, so it **IS included** in the listing. The function then reads the YAML frontmatter and surfaces `fm['status']` directly into `PinDescriptor.status`. If the skill sets `status: read` in the frontmatter before renaming, the extension will receive `status: "read"` in the `GET /annotations` response and render the read pin dot (PIN-04).

**D-07 is valid as written.** Both belt and suspenders work: the `.read.md` filename extension does NOT exclude the note from `listAnnotations`, and the `status: read` frontmatter field IS surfaced. The rename alone is sufficient for skill idempotency (re-run glob excludes `*.read.md`), and the `status: read` frontmatter drives the visual pin state.

**Corollary for `resolveSerialFile`:** `resolveSerialFile` at `read-note.ts:49-55` uses:
```typescript
const match = files.find(
  f => f.startsWith(serial + '-') && (f.endsWith('.md') || f.endsWith('.read.md'))
);
```
This means `PUT /annotation/<serial>` and `DELETE /annotation/<serial>` also find `*.read.md` files by serial — consistent with the full design.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Note processing (read/fix/rename) | Skill (AI agent prose) | — | Disk-only; no host or extension calls needed |
| Frontmatter mutation (status: read/flagged) | Skill (AI agent prose) | — | Agent rewrites the YAML block using yaml or direct text manipulation |
| Rename to `*.read.md` | Skill (AI agent prose) | — | Simple `mv` / `Rename-Item`; after fix only |
| Pin visual state (read dot) | Extension + Host | — | Host `GET /annotations` surfaces `status` from `.read.md` frontmatter; extension renders pin |
| SKILL.md installation | Developer (manual copy) | — | Documented in README; one `cp` command |
| Clean-room grep audit | `scripts/clean-room-check.mjs` | — | Already-wired Node script; CLEAN-ROOM.md documents its output |

---

## Note On-Disk Format (Authoritative Contract) [VERIFIED: host/src/write-note.ts + host/src/types.ts + UAT samples]

The skill is the **read-side mirror** of `buildFrontmatter()` and `buildNoteBody()`. Every field the skill may need to parse:

### Frontmatter Keys

| Key | Type | Always Present | Notes |
|-----|------|---------------|-------|
| `id` | integer | Yes | Leading serial as integer (do NOT use for serial string — use filename `slice(0,4)`) |
| `created` | ISO 8601 string | Yes | e.g. `2026-06-03T05:43:53.270Z` |
| `mode` | `'free'` or `'element'` | Yes | Determines body structure |
| `url` | string | Yes | Full page URL; path-matched by host |
| `title` | string | Yes | Browser tab title |
| `viewport.width` | number | Yes | Viewport width in px |
| `viewport.height` | number | Yes | Viewport height in px |
| `viewport.dpr` | number | Yes | Device pixel ratio |
| `selector` | string | element mode only | CSS selector from `@medv/finder` |
| `react_component` | string | element mode, optional | Best-effort React component name; may be absent |
| `rect.x/y/width/height` | numbers | element mode only | Page-absolute bounding rect |
| `note_position.x/y` | numbers | free mode only | Viewport coords of note card at Send time |
| `screenshots` | string[] | Yes | Relative paths e.g. `["0001-20260603-010538+1.png"]`; may be empty `[]` |
| `status` | string | Yes | `'unread'` on write; skill sets `'read'` or `'flagged'` |

### Body Structure

```
<comment text>           ← the developer's instruction to the AI agent

## Element context       ← element mode ONLY

- **Selector:** `<css>`
- **React component:** `<name>`  ← optional
- **Tag / role:** `<tag>` / `<role>`  [· **aria-label:** <label>]
- **Text:** <truncated text>           ← optional
- **Rect:** x=N y=N w=N h=N           ← optional

### Computed styles (curated)
| prop | value |
|------|-------|
| display | flex |
...

### outerHTML (truncated)
```html
<...>
```

### Screenshots
![+1](<base>+1.png)
![+2](<base>+2.png)    ← one line per screenshot
```

**Free note body** — only `<comment>` + optional `### Screenshots` section (no `## Element context` block).

### Real UAT Samples

- `0001-20260603-010538.md` — element mode, 1 screenshot, selector present, no `rect` in frontmatter (written before D-03 rect persistence landed)
- `0003-20260603-084353.md` — element mode, 3 screenshots, `rect` in frontmatter, multi-screenshot `### Screenshots` block
- `0006-20260603-112328.md` — free mode, 1 screenshot, no `## Element context`, `note_position` absent in frontmatter (field is `note_position`, but not all UAT notes from older sessions have it)
- `0007-20260603-112631.md` — element mode, 1 screenshot, `rect` present

The skill must handle gracefully: absent `react_component`, absent `rect`, absent `note_position`, and `screenshots: []`.

---

## Filename Pattern [VERIFIED: host/src/write-note.ts + UAT directory listing]

| Component | Pattern | Example |
|-----------|---------|---------|
| Note file | `<4-digit-serial>-<YYYYMMDD-HHmmss>.md` | `0001-20260603-010538.md` |
| Read note | `<4-digit-serial>-<YYYYMMDD-HHmmss>.read.md` | `0001-20260603-010538.read.md` |
| Screenshot | `<4-digit-serial>-<YYYYMMDD-HHmmss>+<N>.png` | `0003-20260603-084353+2.png` |

**Serial ordering:** The 4-digit zero-padded prefix means lexicographic sort = serial order. Glob `notes/*.md`, exclude `*.read.md`, sort lexicographically = correct ascending serial order.

**Glob mechanics (portable prose):**
- Include: files ending in `.md`
- Exclude: files ending in `.read.md`
- Sort: ascending by filename (zero-padded prefix guarantees serial order)
- This is what `read-note.ts` does: `.filter(f => f.endsWith('.md'))` — and `.read.md` ends in `.md`, so **the skill's glob must also explicitly exclude `*.read.md`** for idempotency. The host's listing glob differs from the skill's processing glob — the host wants ALL notes; the skill wants only unread.

---

## SKILL.md Format [VERIFIED: ~/.claude/skills examples — scrapling/SKILL.md, waha-admin/SKILL.md]

Claude Code skills live in `.claude/skills/<name>/SKILL.md`. The format observed in production skills:

```yaml
---
name: <skill-name>
description: |
  <one-paragraph trigger description — what phrases/contexts cause Claude Code
   to invoke this skill automatically>
---
```

Body is free-form markdown (the skill instructions themselves).

**Key properties observed:**
- `name` — matches the directory name by convention
- `description` — natural language; controls when Claude Code auto-applies the skill. For a wrapper, this is where you describe when to invoke the `review-notes` workflow.
- `allowed-tools` — optional; restricts which tools the skill can use (seen in scrapling). For `review-notes` this is NOT needed (the skill is invoked on-demand, not tool-restricted).
- `version` — optional (seen in waha-admin)
- Body — plain markdown, any structure. The wrapper body should simply say: "Read and follow the instructions in `skill/SKILL.md` in this repo."

**Portable skill (`skill/SKILL.md` at repo root):**
- No frontmatter required (the portable file is consumed by any agent that can read files, not just Claude Code)
- Should be complete and self-contained — title, purpose, preconditions, numbered steps
- Can use `[HUMAN-READABLE]` conditional instructions ("if screenshots are available, open them")
- Must NOT assume `claude_code`, `cursor`, or any specific agent API

**Wrapper skill (`.claude/skills/review-notes/SKILL.md`):**
- Has Claude Code frontmatter (`name`, `description`)
- Body: instructs Claude Code to read `skill/SKILL.md` and follow it — NO logic duplication
- This is equivalent to the "thin pointer" pattern

---

## Idempotency Mechanics [VERIFIED: read-note.ts + write-note.ts + D-05/D-06/D-07]

The idempotency guarantee works via two independent mechanisms:

1. **Glob exclusion (skill-side):** The skill globs `notes/*.md` and excludes `*.read.md`. Notes the skill has already processed (renamed to `*.read.md`) are not returned by this glob. Re-run sees zero unread notes → reports "no unread notes."

2. **Frontmatter marker (host-side):** `status: read` in frontmatter allows the extension to show the read dot even after rename. This is the visual confirmation, not the idempotency mechanism.

3. **Rename-after-fix (crash safety):** The skill renames ONLY after the fix succeeds. A crash mid-fix leaves the `.md` unread → re-run processes it again. This is D-06 and is the core reliability guarantee.

**Ambiguous note handling (D-08):**
- Set `status: flagged` in frontmatter
- Append `> flagged: <reason>` as a blockquote line in the body (after the last line)
- Leave filename as `*.md` (NOT renamed to `*.read.md`)
- Effect: re-run includes it again (visible); but the `> flagged:` line tells the agent to skip it

**Missing screenshot handling (D-09):**
- Warn: one line `WARN: screenshot <path> not found — proceeding text-only`
- Continue with available text + element context
- Fix and rename normally (missing PNG is not an ambiguity)

---

## Host Start Command [VERIFIED: package.json scripts]

```json
"host": "node dist/host/src/index.js"
```

Run as: `npm run host -- --root <dir> --origin <url>`

**Windows PowerShell note** (already documented in existing README):
```powershell
# Option A: equals-sign form
npm run host -- --root=C:\path\to\project --origin=http://localhost:3000

# Option C: node directly (most reliable on Windows)
node dist/host/src/index.js --root C:\path\to\project --origin http://localhost:3000
```

**Accepted flags** (from `host/src/config.ts` via `util.parseArgs`):
- `--root <dir>` — required; project directory; notes written to `<root>/notes/`
- `--origin <url>` — repeatable; allowed CORS origin(s)
- `--port <number>` — optional; default scans 39240-39260
- `--name <string>` — optional; project display name
- `--notes-dir <dir>` — optional; override notes subdir (must resolve inside --root)
- `--token <string>` — optional; else `STICKYFIX_TOKEN` env, else random UUID

Host startup prints: project name, bound port, declared origins, token, and absolute notes dir (HOST-01).

---

## CLEAN-ROOM.md Design [VERIFIED: scripts/clean-room-check.mjs + Phase 1 SC-5 + actual audit run]

**Banned identifiers** (from `scripts/clean-room-check.mjs`):
```
__opc_      (upstream private-API prefix)
opencode    (upstream project name)
JodusNodus  (upstream author handle)
```

**Scan scope:** All `.ts`, `.js`, `.mjs`, `.cjs`, `.json`, `.html`, `.css`, `.md` files, excluding:
- `node_modules/`, `.git/`, `.output/`, `dist/`, `.wxt/`, `.planning/`
- Gitignored trees: `notes/`, `private/`, `.claude/`, `.qmd-memory/`
- Root-level files: `PRD.md`, `README.md`, `CLAUDE.md`, `LICENSE` (attribution allowed)

**Audit run (2026-06-03):**
```
$ node scripts/clean-room-check.mjs
clean-room audit: PASS — no banned identifiers found
Exit code: 0
```

**CLEAN-ROOM.md structure (D-12):**
1. MIT provenance declaration (project is original, MIT-licensed)
2. Clean-room method narrative (what "clean-room" means: studied upstream architecture, wrote original code, no copy-paste)
3. GPL upstream reference (acknowledgment without inclusion)
4. Grep audit section: the three banned identifiers, the command, the result
5. Scope of audit (what's scanned, what's excluded and why)
6. Note that Phase 8 SC-4 will re-run the same audit as a release gate

**Where to reference in README:** A short "License & provenance" section pointing to `CLEAN-ROOM.md` satisfies DOC-02. The full audit output lives in `CLEAN-ROOM.md`, not inline in README.

---

## README Structure [VERIFIED: D-11 + existing README.md]

**Existing README (56 lines):** Has a product description, running-the-host section (including Windows PowerShell variants), architecture one-liner, status section (stale — says "Pre-build"), and MIT license notice. The review-notes skill section and quickstart are missing.

**Preserve from existing README:**
- Product description paragraph (accurate, well-written)
- Architecture one-liner diagram
- Windows PowerShell host-start variants (important for the developer's platform)
- License section

**Rewrite/add:**
- Replace the "Status: 🚧 Pre-build" section with the 5-step quickstart (D-11)
- Add a review-notes skill install section
- Add security model section (127.0.0.1, token, origin-trust)
- Add troubleshooting section
- Add demo GIF slot (D-10: placeholder image + "record instructions")

**5-Step Quickstart (D-11):**
1. `npm run build` — build extension + host
2. `npm run host -- --root <project-dir> --origin <page-origin>` — start host
3. Build + Load unpacked extension in Chrome
4. Copy token from host startup output → paste into extension popup
5. Click "Enter Review Mode" on any page → drop notes → run `review-notes` skill

---

## Standard Stack (No new packages)

This phase installs no new packages. [VERIFIED: package.json — all needed tools already present]

| Tool | Already Present | Use |
|------|----------------|-----|
| `yaml` 2.9.0 | Yes — in `dependencies` | Skill uses it to rewrite frontmatter (if implemented as code); skill prose instructs agent to edit YAML manually |
| Node.js built-ins (`fs`, `path`) | Yes | Skill prose instructs agent to rename files |
| `scripts/clean-room-check.mjs` | Yes | Run to get audit output for CLEAN-ROOM.md |

**No `npm install` step required for this phase.** [VERIFIED: CLAUDE.md + package.json]

---

## Package Legitimacy Audit

> No new packages are installed in Phase 7. This section is N/A.

**Packages installed this phase:** None.

---

## Architecture Patterns

### Skill Architecture (Prose, not Code)

The `review-notes` skill is **instructions for an agent to follow**, not a script the agent runs. This distinction matters:

- The skill is markdown prose with numbered steps
- The agent reads it and executes the steps using its native tools (Read, Write, Bash/terminal, vision)
- No CLI is needed; no npm script is created
- The skill is idempotent by design — not by code

```
notes/
├── 0001-20260603-010538.md         ← unread
├── 0001-20260603-010538+1.png      ← screenshot sibling
├── 0002-20260603-010605.md         ← unread
├── 0003-20260603-084353.md         ← unread (3 screenshots)
├── 0003-20260603-084353+1.png
├── 0003-20260603-084353+2.png
├── 0003-20260603-084353+3.png
└── .gitkeep

After skill run:
├── 0001-20260603-010538.read.md    ← renamed; status: read in frontmatter
├── 0001-20260603-010538+1.png      ← unchanged
├── 0002-20260603-084353.read.md    ← renamed; status: read
├── 0003-20260603-084353.read.md    ← renamed; status: read
├── 0003-20260603-084353+{1,2,3}.png ← unchanged
```

### Recommended Project Structure (new files this phase)

```
skill/
└── SKILL.md          ← portable, agent-agnostic skill (source of truth)
.claude/
└── skills/
    └── review-notes/
        └── SKILL.md  ← Claude Code wrapper (thin pointer to skill/SKILL.md)
README.md             ← rewritten (quickstart-first, demo GIF placeholder)
CLEAN-ROOM.md         ← new: MIT provenance + grep audit output
docs/
└── demo-placeholder.gif  ← placeholder (or .png with text "GIF coming soon")
```

### Pattern 1: Portable Skill Format

```markdown
# review-notes Skill

**Purpose:** Process unread sticky notes (*.md files) left by the stickyfix Chrome
extension, fix each one, and rename it `*.read.md` so re-runs are idempotent.

## Preconditions

- You have access to the project's `notes/` directory (default: `./notes` relative
  to project root; or pass an explicit path as an argument).
- You can read, write, and rename files in that directory.

## Steps

1. **Discover unread notes**
   List all files in `notes/` that end in `.md` but NOT in `.read.md`.
   Sort ascending by filename — the 4-digit zero-padded serial prefix ensures
   serial order. If no unread notes exist, report "no unread notes" and stop.

2. **For each unread note (in serial order):**

   a. Read the file. Parse the YAML frontmatter block (between `---` delimiters).
      Note the `mode` (`free` or `element`), `selector`, `rect`, `screenshots`,
      and `status` fields. Read the body for the developer's instruction (the
      first line(s) before any `## Element context` heading).

   b. If `mode: element`, read the `## Element context` section — it contains
      the CSS selector, tag, computed styles, and truncated outerHTML. Use this
      context to locate the correct code to change.

   c. If `screenshots` lists one or more filenames AND the files exist alongside
      the note, open them with vision to see what the developer saw. If a
      screenshot file is missing, warn once (`WARN: <filename> not found —
      proceeding text-only`) and continue without it.

   d. If the note's instruction is clear enough to act on: apply the fix to the
      relevant source file(s). If not clear enough (genuinely ambiguous even
      with element context): do not fix — instead set `status: flagged` in the
      frontmatter and append `> flagged: <reason>` to the note body. Leave the
      filename unchanged. Skip to the next note.

   e. Only after a successful fix (or conscious flag/defer): rename the file from
      `<name>.md` to `<name>.read.md`. Also update `status` in the frontmatter
      from `unread` to `read`.

3. **After the pass:** Report a summary — N notes processed, M flagged, K skipped
   (empty queue). A flagged note stays in the queue for human review.
```

### Pattern 2: Claude Code Wrapper Format

```markdown
---
name: review-notes
description: |
  Process unread stickyfix review notes in the `notes/` directory. Use when the
  user says "read my notes", "process review notes", "fix sticky notes", "run
  review-notes", or "what notes do I have". Reads each unread `*.md` note,
  applies the requested code fix, then renames it `*.read.md`. Idempotent —
  re-running on an already-processed directory reports "no unread notes".
---

Read and follow the instructions in `skill/SKILL.md` in this repository.
The notes directory defaults to `./notes` relative to the project root.
```

### Anti-Patterns to Avoid

- **Logic in the wrapper:** The `.claude/skills/review-notes/SKILL.md` wrapper must NOT duplicate any step logic. It is a pointer only.
- **Require vision:** The skill must proceed without screenshots (D-09). Never write a step as "you must open the screenshot" — write "if the screenshot file exists, open it."
- **Rename before fix:** The rename must happen ONLY after a successful fix. Steps that rename first break crash-safety (D-06).
- **Use `id` frontmatter for serial:** The `id` field is an integer that loses leading zeros. Always derive the 4-digit serial from the filename's first 4 characters.
- **Glob `*.md` without excluding `*.read.md`:** Both glob patterns end in `.md`. The exclusion step is mandatory for idempotency.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter rewrite | String-replace heuristics | Instruct agent to parse between `---` delimiters and update the `status` key | Colons/quotes in values break naive string manipulation; `yaml` library already present |
| Serial ordering | Custom sort function | Lexicographic filename sort | Zero-padded 4-digit prefix makes lex sort = serial sort |
| Screenshot path resolution | Complex path logic | `<base>+N.png` is a sibling of the `.md` file (same directory) | The path in frontmatter `screenshots[]` is already the relative path; join with notesDir |
| GIF recording | ffmpeg scripting in CI | Document the steps for Omer to run manually post-phase | Cross-platform GIF tooling has no-install path on Windows; D-10 defers this intentionally |

---

## Common Pitfalls

### Pitfall 1: Glob Captures `*.read.md` as Unread

**What goes wrong:** A naive `ls notes/*.md` or `readdirSync().filter(f => f.endsWith('.md'))` matches both `0001-ts.md` AND `0001-ts.read.md` (because `.read.md` ends in `.md`). The skill re-processes already-handled notes.

**Why it happens:** JavaScript `endsWith('.md')` and shell `*.md` are both true for `.read.md`.

**How to avoid:** The exclusion step must be explicit: `endsWith('.md') && !endsWith('.read.md')`. In prose: "files ending in `.md` but NOT in `.read.md`." In shell: `notes/*.md | grep -v '\.read\.md$'` or `find notes -name "*.md" ! -name "*.read.md"`.

**Warning signs:** Re-run does not report "no unread notes"; instead it lists notes already marked `status: read`.

### Pitfall 2: Renaming Before Fix Completes

**What goes wrong:** Skill renames to `*.read.md`, then tries the fix, then crashes. The note is now excluded from future runs — the fix is silently dropped. Core-value violation: "a dropped note is a regression."

**Why it happens:** Rename is easier to do early; the note feels "claimed."

**How to avoid:** Enforce D-06 in the skill steps: rename is the LAST action, conditional on fix success or conscious flag. Make this explicit in step 2e.

**Warning signs:** A `*.read.md` file with `status: unread` in frontmatter — the frontmatter update and rename weren't both completed.

### Pitfall 3: `id` Used Instead of Filename for Serial

**What goes wrong:** The `id` frontmatter field is an integer (e.g., `1`). `String(1)` = `"1"`, not `"0001"`. Serial comparisons and `PUT /annotation/<serial>` calls fail.

**Why it happens:** The frontmatter `id` looks like the serial number.

**How to avoid:** Always derive serial from `filename.slice(0, 4)`. The `id` field in frontmatter is informational.

### Pitfall 4: Screenshot Path Confusion

**What goes wrong:** The `screenshots` frontmatter array contains relative paths like `0001-20260603-010538+1.png`. These are relative to the `notes/` directory, NOT the project root.

**How to avoid:** Resolve screenshot paths by joining with the notes dir: `path.join(notesDir, screenshotRelPath)`.

### Pitfall 5: Treating Missing Screenshot as Ambiguous

**What goes wrong:** A note whose screenshot file is missing gets flagged as ambiguous (status: flagged), blocking the queue unnecessarily.

**Why it happens:** Missing image feels like incomplete information.

**How to avoid:** Per D-09, missing screenshot = warn once + proceed text-only + mark read normally. Only genuinely unclear developer instructions → flagged.

### Pitfall 6: README Regression — Losing Windows PowerShell Notes

**What goes wrong:** Rewriting the README from scratch loses the Windows-specific host startup instructions (equals-sign form, `node` direct form, `STICKYFIX_ORIGINS` env var). These are critical for the developer's platform.

**How to avoid:** The existing README has accurate Windows PowerShell content — preserve it verbatim in the rewrite. Flag it explicitly in the plan task.

---

## Code Examples

### Frontmatter Read/Update Pattern (prose for skill steps)

```
Read the YAML block between the first pair of `---` delimiters.
To update `status`: locate the line `status: unread` and replace with `status: read`
(or `status: flagged`). The yaml library present in this repo can be used:
  import { parse, stringify } from 'yaml';
  const fm = parse(frontmatterText);
  fm.status = 'read';
  const updated = stringify(fm);
```

### Rename Mechanics (cross-platform)

```typescript
// Node.js (cross-platform — works on Windows, macOS, Linux)
import { rename } from 'node:fs/promises';
const readPath = mdPath.replace(/\.md$/, '.read.md');
await rename(mdPath, readPath);
```

In prose for the skill: "Rename the file from `<name>.md` to `<name>.read.md` using your file-rename tool."

### Ambiguous Note Body Update (append flagged line)

```typescript
// Append blockquote to body, before any trailing newline
const flaggedLine = `\n> flagged: ${reason}\n`;
const newContent = frontmatterBlock + body.trimEnd() + flaggedLine;
await writeFile(mdPath, newContent, 'utf8');
```

Source: Read-side mirror of editNote() pattern in `host/src/read-note.ts`.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Screenshot → paste → describe | Skill reads `.md` directly | Eliminates ping-pong; agent has full structured context |
| One-shot review | Serial serial processing with `*.read.md` rename | Enables iterative loops; only new notes are processed on re-run |
| Agent-specific skills | Portable `skill/SKILL.md` + thin wrapper | Works in Claude Code, Cursor, Codex, any folder-reading agent |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Free-note UAT samples may not have `note_position` in frontmatter (older sessions) | Note Format | Skill must handle absent `note_position` gracefully — no breakage, just omit |
| A2 | Demo GIF placeholder can be a `.png` with text "Demo GIF coming soon" | README | Omer may prefer a different placeholder format — discretion area |
| A3 | CLEAN-ROOM.md should live at repo root (not in docs/) | CLEAN-ROOM.md | Standard location; root-level legal/provenance docs are conventional |

**No high-risk assumptions.** All critical claims are VERIFIED from source code.

---

## Open Questions

1. **Placeholder GIF format**
   - What we know: D-10 says "placeholder image + record instructions"
   - What's unclear: `.png` with text vs. `.gif` with static frame vs. just a markdown note
   - Recommendation: commit a `docs/demo-placeholder.png` (a simple static image with "Demo GIF — recording instructions below" text, creatable without ImageMagick) and document recording steps inline in README. This avoids any binary asset tooling.

2. **Recording instructions specificity**
   - What we know: User records the GIF manually post-phase
   - What's unclear: Which GIF tool is preferred on Windows (LICEcap, ScreenToGif, OBS+FFmpeg)
   - Recommendation: Document two options — LICEcap (free, Windows, no FFmpeg) and ScreenToGif (free, Windows, more control). No specific one mandated — Claude's discretion.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `scripts/clean-room-check.mjs` (CLEAN-ROOM.md audit run) | Yes | Node 20+ (project requirement) | — |
| `scripts/clean-room-check.mjs` | CLEAN-ROOM.md baseline output | Yes | Committed in repo | — |
| `skill/SKILL.md` | Skill delivery | Needs creation | N/A | — |
| `.claude/skills/review-notes/` | Claude Code wrapper | Needs creation | N/A | — |

**Missing dependencies with no fallback:** None — all needed tools are already in the repo.

---

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (existing project pattern) |
| Config file | None — tests run via `npm test` / `npm run test:lib` |
| Quick run command | `node --test dist/host/test/read-note.test.js` (existing) |
| Full suite command | `npm run check` (tsc + clean-room gate + smoke test + all tests) |

**Note:** Phase 7 produces NO new TypeScript source code. The deliverables are markdown prose files (`skill/SKILL.md`, `.claude/skills/review-notes/SKILL.md`, `README.md`, `CLEAN-ROOM.md`) and optionally a placeholder image. There is nothing to unit-test in the traditional sense.

Validation for this phase is **fixture-based functional verification** — create a temp `notes/` dir with known fixtures, instruct an agent to run the skill, and verify outcomes. This maps to the success criteria (SC-1..SC-4) rather than traditional unit tests.

### Phase Requirements → Validation Map

| Req ID | Behavior | Validation Type | Validation Method | Automated? |
|--------|----------|----------------|-------------------|------------|
| SKILL-01 | `skill/SKILL.md` readable by any agent; wrapper in `.claude/skills/review-notes/` | File existence check | `ls skill/SKILL.md .claude/skills/review-notes/SKILL.md` | Yes (shell) |
| SKILL-02 | Glob excludes `*.read.md`; sorts ascending | Human-driven skill run + fixture | Fixture: create `notes/` with 3 notes + 1 `*.read.md`; run skill; verify only 3 unread processed | Human UAT |
| SKILL-03 | Reads frontmatter, body, element-context, screenshot path | Human-driven skill run | Fixture: UAT samples from `D:\docker\stickyfix-uat\notes\`; run skill; verify fix applied | Human UAT |
| SKILL-04 | Rename to `*.read.md` + `status: read`; re-run idempotent | Human-driven skill run | Re-run skill on same dir; verify "no unread notes" output | Human UAT |
| SKILL-05 | Empty queue, ambiguous note, missing screenshot | Fixture-based | Three fixtures (see Wave 0 gaps); run skill; verify each outcome | Human UAT |
| DOC-01 | README with quickstart + demo GIF | File review | Read README; verify 5-step quickstart present; verify GIF placeholder + record instructions | Human review |
| DOC-02 | CLEAN-ROOM.md with MIT provenance + grep audit | File review + script run | Read CLEAN-ROOM.md; run `node scripts/clean-room-check.mjs`; verify PASS | Yes (shell) |

### Fixture Set (Wave 0 Gap)

The planner must include a **fixture creation task** (Wave 0) that creates a `test/fixtures/notes/` directory with:

| Fixture File | Purpose |
|-------------|---------|
| `0001-20260101-120000.md` | Normal element note with valid screenshot ref (`+1.png`) |
| `0001-20260101-120000+1.png` | Actual PNG file (can be copy of UAT sample) |
| `0002-20260101-120001.md` | Free note, no screenshots |
| `0003-20260101-120002.md` | Element note with screenshot ref but NO PNG file (missing screenshot test) |
| `0004-20260101-120003.md` | Note with intentionally ambiguous instruction |
| `0099-20260101-120099.read.md` | Pre-existing read note (must NOT be processed on skill run) |

**Expected outcomes after skill run on fixtures:**
- `0001-*.md` → renamed to `0001-*.read.md`, status: read in frontmatter
- `0002-*.md` → renamed to `0002-*.read.md`, status: read in frontmatter
- `0003-*.md` → renamed to `0003-*.read.md` (missing screenshot: warned, proceeded text-only)
- `0004-*.md` → STAYS `0004-*.md`, status: flagged, `> flagged: <reason>` appended
- `0099-*.read.md` → UNCHANGED (was already read)

### Wave 0 Gaps

- [ ] `test/fixtures/notes/` — fixture directory with the 6 files above
- [ ] Human UAT runbook — short prose steps for Omer to run the skill against fixtures and verify outcomes (can live in `.planning/phases/07-*/07-HUMAN-UAT.md`)

*(No automated test file gaps — no new TS code is being written this phase.)*

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surfaces — skill reads disk only |
| V3 Session Management | No | No session state — skill is stateless |
| V4 Access Control | No | Skill reads project files only; no privilege boundary crossed |
| V5 Input Validation | Partial | README must not include user-supplied content in shell commands; CLEAN-ROOM.md is static output |
| V6 Cryptography | No | No cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `notes/` arg | Tampering | Skill prose instructs agent to use the project `notes/` dir only; the host already enforces `isInsideDir`; the skill is a consumer, not a writer to the host |
| CLEAN-ROOM.md falsification | Repudiation | Audit result is re-run live by `node scripts/clean-room-check.mjs` in-phase and in Phase 8 — not self-reported |

**Security verdict:** This phase has minimal security surface. No new network endpoints, no new auth, no executable code. The skill prose and documentation are the deliverables.

---

## Sources

### Primary (HIGH confidence)

- `host/src/read-note.ts` — `listAnnotations` glob pattern (`endsWith('.md')`), `resolveSerialFile` dual-suffix match, PinDescriptor shape [VERIFIED]
- `host/src/write-note.ts` — `buildFrontmatter()`, `buildNoteBody()`, all frontmatter keys, body structure [VERIFIED]
- `host/src/types.ts` — `AnnotationPayload`, `ElementContext`, `Screenshot` interface definitions [VERIFIED]
- `scripts/clean-room-check.mjs` — banned identifiers, scan scope, SKIP_DIRS, actual audit output [VERIFIED]
- `package.json` — `host` npm script = `node dist/host/src/index.js`; no new deps needed [VERIFIED]
- `D:\docker\stickyfix-uat\notes\*.md` — 8 live UAT note samples confirming format [VERIFIED]
- `C:\Users\omern\.claude\skills\scrapling\SKILL.md`, `waha-admin\SKILL.md` — SKILL.md frontmatter format, wrapper pattern [VERIFIED]

### Secondary (MEDIUM confidence)

- `.planning/phases/01-scaffold-clean-room-foundation/01-VERIFICATION.md` SC-5 — original grep audit result [CITED]
- `.planning/phases/07-review-notes-skill-docs/07-CONTEXT.md` — all locked decisions D-01..D-12 [CITED]

---

## Metadata

**Confidence breakdown:**
- RESEARCH-FLAG-1 (glob answer): HIGH — read directly from read-note.ts line 73
- Note format: HIGH — verified from write-note.ts + types.ts + 8 live UAT samples
- SKILL.md format: HIGH — read from 2 production skill examples in ~/.claude/skills
- Host start command: HIGH — verified from package.json scripts
- Clean-room audit: HIGH — script run live, output captured
- Idempotency mechanics: HIGH — derived from code + decision chain

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable domain — prose/docs phase; no fast-moving dependencies)

---

## RESEARCH COMPLETE

**Phase:** 7 - review-notes Skill + Docs
**Confidence:** HIGH

### Key Findings

- **RESEARCH-FLAG-1 RESOLVED:** `listAnnotations` uses `.filter(f => f.endsWith('.md'))` — `.read.md` IS included. D-07 (rename + frontmatter) is correct; both mechanisms work as designed. The skill's glob must explicitly exclude `*.read.md` for idempotency (the host's listing glob differs — it wants all notes; the skill wants only unread).
- **Note format is fully documented:** All 13 frontmatter keys mapped from `write-note.ts` + `types.ts` + 8 live UAT samples. Body structure for free vs element mode is explicit. Skill can safely parse all note types.
- **SKILL.md format confirmed:** Claude Code skills require `name` + `description` frontmatter. The wrapper pattern (pointer to `skill/SKILL.md`) is used in production skills. No logic duplication needed.
- **No new packages:** All dependencies already in `package.json`. Phase is pure markdown + docs.
- **Clean-room audit confirmed PASS:** `node scripts/clean-room-check.mjs` returns exit 0 with "clean-room audit: PASS — no banned identifiers found" as of 2026-06-03.
- **Host start command verified:** `npm run host -- --root <dir>` (or Windows variants documented in existing README). Flags: `--root`, `--origin`, `--port`, `--name`, `--notes-dir`, `--token`.

### File Created

`.planning/phases/07-review-notes-skill-docs/07-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| RESEARCH-FLAG-1 (glob answer) | HIGH | Read directly from production source code |
| Note on-disk format | HIGH | Verified from write-note.ts + types.ts + 8 live UAT samples |
| SKILL.md format | HIGH | Two production examples read from ~/.claude/skills |
| Host commands | HIGH | Verified from package.json scripts |
| Clean-room audit | HIGH | Script run live, output captured |
| Idempotency mechanics | HIGH | Code + decision chain both verified |

### Open Questions

- Placeholder GIF format preference (resolved to Claude's discretion — `.png` with text recommended)
- GIF recording tool recommendation (discretion — two Windows options: LICEcap, ScreenToGif)

### Ready for Planning

Research complete. Planner can now create PLAN.md files for Phase 7.
