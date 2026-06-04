# Phase 7: review-notes Skill + Docs - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 6 new/modified files
**Analogs found:** 4 / 6 (2 files have no codebase analog — they are a new artifact type)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `skill/SKILL.md` | skill-prose | event-driven (agent reads -> acts -> renames) | `C:\Users\omern\.claude\skills\scrapling\SKILL.md` (global) | role-match (portable prose, no frontmatter) |
| `.claude/skills/review-notes/SKILL.md` | skill-wrapper | request-response (Claude Code auto-invokes) | `.claude/skills/claudios.md` (in-repo) | exact (same frontmatter schema: name + description + body) |
| `README.md` | docs | — | Existing `README.md` (56 lines — MODIFY, not greenfield) | exact (preserve + extend) |
| `CLEAN-ROOM.md` | provenance-doc | — | `scripts/clean-room-check.mjs` (audit source) | partial (the script is the data source; the doc form is new) |
| `test/fixtures/notes/` (fixture set) | test-fixture | file-I/O | `host/test/read-note.test.ts` fixture helpers (`writeFixture`, `makeFrontmatter`) | role-match |
| `docs/demo-placeholder.png` | asset | — | none | no analog |

---

## Pattern Assignments

### `skill/SKILL.md` (portable skill, no frontmatter)

**Analog:** `C:\Users\omern\.claude\skills\scrapling\SKILL.md` (global user skill — portable prose body)

**Key observation:** The scrapling skill has Claude Code frontmatter (`name`, `description`, `allowed-tools`). The portable `skill/SKILL.md` in this repo must NOT have frontmatter — it must be readable by any folder-reading agent (Claude Code, Cursor, Codex, etc.). The body pattern (title -> purpose -> when-to-use -> numbered steps) IS the pattern to copy.

**Portable body structure to copy** (scrapling lines 10-32 as reference shape):
```markdown
# <Skill Name>

<One-paragraph purpose statement.>

## When to use

- <trigger condition 1>
- <trigger condition 2>

## When NOT to use

- <anti-pattern 1>

## Preconditions

- <precondition>

## Steps

1. **Step title**
   <prose description of what the agent does>

2. **Step title**
   <prose description>

## After the pass

<Summary / reporting format>
```

**Skill-specific content contract (from RESEARCH.md):**
- Step 1: Discover unread notes — glob `notes/*.md`, exclude `*.read.md`, sort ascending by filename
- Step 2: For each note: parse frontmatter, read body, check mode (`free`|`element`), open screenshots (if present), apply fix, rename only after success
- Frontmatter keys to parse: `id`, `created`, `mode`, `url`, `title`, `viewport`, `selector`, `react_component`, `rect`, `note_position`, `screenshots`, `status`
- Body structure: comment + optional `## Element context` (element mode) + optional `### Screenshots`
- D-07: after fix: rename `*.md` to `*.read.md` AND set `status: read`
- D-08: ambiguous note: set `status: flagged`, append `> flagged: <reason>`, leave filename unchanged
- D-09: missing screenshot PNG: warn one line (`WARN: <filename> not found — proceeding text-only`), continue
- Serial ALWAYS derived from `filename.slice(0, 4)` — never from `id` frontmatter (loses zero-padding)
- Glob exclusion MUST be explicit: `endsWith('.md') && !endsWith('.read.md')`

---

### `.claude/skills/review-notes/SKILL.md` (Claude Code wrapper)

**Analog:** `.claude/skills/claudios.md` (lines 1-17)

**Frontmatter pattern to copy** (`.claude/skills/claudios.md` lines 1-17):
```
---
name: claudios
description: |
  Complete operational manual for interacting with Claudios (VP R&D) ...
  Use when: checking Claudios health, submitting/polling tasks, ...
when-to-use: |
  - Checking if Claudios is alive or healthy
  - ...
---
```

**Apply for review-notes wrapper:**
```
---
name: review-notes
description: |
  Process unread stickyfix review notes in the notes/ directory. Use when the
  user says "read my notes", "process review notes", "fix sticky notes", "run
  review-notes", or "what notes do I have". Reads each unread *.md note,
  applies the requested code fix, then renames it *.read.md. Idempotent —
  re-running on an already-processed directory reports "no unread notes".
---

Read and follow the instructions in skill/SKILL.md in this repository.
The notes directory defaults to ./notes relative to the project root.
```

**Wrapper rule:** Body is ONE sentence pointing to `skill/SKILL.md`. No step logic. No duplication (D-01).

**Second analog:** `C:\Users\omern\.claude\skills\scrapling\SKILL.md` lines 1-8 for `allowed-tools` pattern — note that review-notes does NOT need `allowed-tools` (on-demand invocation, not tool-restricted, per RESEARCH.md).

---

### `README.md` (MODIFY existing 56-line file)

**Analog:** Existing `README.md` itself — this is a modify, not a greenfield.

**Preserve verbatim** (from current README, verified accurate):
- Product description (lines 1-13): tagline + the 5-step flow description (lines 2-11)
- Architecture one-liner diagram (lines 47-51)
- Windows PowerShell host-start variants (lines 22-38) — CRITICAL for developer's platform; regression if lost
- `STICKYFIX_ORIGINS` env var note (line 39)
- License section (lines 52-56)

**Replace / rewrite:**
- Lines 41-44: Delete "Status: Pre-build" section — replace with 5-step Quickstart (D-11)

**Add sections (after Quickstart, before Architecture):**
- `## review-notes Skill` — install instructions (`cp skill/SKILL.md <project>/.claude/skills/review-notes/SKILL.md` or `cp skill/SKILL.md` for any agent), trigger phrase, what it does
- `## Security model` — 127.0.0.1 binding, token auth required on POST, origin-trust (existing README already documents the Windows PowerShell forms but not the security model)
- `## Troubleshooting` — common issues (token mismatch, port scan, Windows PowerShell flag parsing)
- `## Demo` — placeholder image slot + "how to record" instructions (D-10)
- `## License & provenance` — one line pointing to `CLEAN-ROOM.md` (DOC-02)

**5-step Quickstart structure (D-11):**
```markdown
## Quickstart (< 5 minutes)

1. **Build** — `npm run build`
2. **Start the host** — `npm run host -- --root <project-dir> --origin <page-origin>`
   (Windows: `node dist/host/src/index.js --root C:\path\to\project --origin http://localhost:3000`)
3. **Load the extension** — open `chrome://extensions`, enable Developer Mode, Load unpacked -> select `.output/chrome-mv3/`
4. **Pair the token** — copy the token printed by the host -> paste into the extension popup
5. **Drop notes** — click "Enter Review Mode" on any page, drop notes, then tell your AI agent **"read my notes"**
```

---

### `CLEAN-ROOM.md` (NEW)

**Analog (data source):** `scripts/clean-room-check.mjs` (lines 1-108) — this script IS the audit; the doc records its output.

**Banned identifiers (from `scripts/clean-room-check.mjs` lines 17-24):**

The script defines three banned patterns using fragment concatenation (to avoid self-tripping). The PATTERNS.md file is safe because `.planning/` is in `SKIP_DIRS`. CLEAN-ROOM.md itself is NOT in the skip list by default, so the planner must add `'CLEAN-ROOM.md'` to `SKIP_FILENAMES` in `scripts/clean-room-check.mjs` (alongside `README.md`) before writing that doc — same rationale: attribution/legal doc. The three patterns the script checks are described in `scripts/clean-room-check.mjs` comments as: upstream private-API prefix, upstream project name, upstream author handle.

**Scan scope from the script** (lines 26-54):
- Extensions scanned: `.ts`, `.js`, `.mjs`, `.cjs`, `.json`, `.html`, `.css`, `.md`
- Skipped dirs: `node_modules`, `.git`, `.output`, `dist`, `.wxt`, `.planning`, `notes`, `private`, `.claude`, `.qmd-memory`
- Skipped root files: `PRD.md`, `README.md`, `CLAUDE.md`, `LICENSE` — add `CLEAN-ROOM.md` to this set before writing the doc

**Audit output to embed** (from RESEARCH.md — run 2026-06-03):
```
$ node scripts/clean-room-check.mjs
clean-room audit: PASS — no banned identifiers found
Exit code: 0
```

**CLEAN-ROOM.md structure (D-12):**
1. MIT provenance declaration
2. Clean-room method narrative (studied architecture, wrote original, no copy-paste)
3. GPL upstream reference (acknowledgment without inclusion: repo name + license — no banned strings)
4. Grep audit section: describe the three banned identifier classes by description (not by value), the command, the captured output
5. Scope of audit (what is scanned, what is excluded and why)
6. Note that Phase 8 SC-4 re-runs as release gate

**Implementation note for planner:** Task 1 of the CLEAN-ROOM.md wave must be: add `'CLEAN-ROOM.md'` to `SKIP_FILENAMES` in `scripts/clean-room-check.mjs`. Only then write the doc. The doc must describe banned identifiers by their purpose/description, not by printing the literal banned strings.

---

### `test/fixtures/notes/` (fixture set — Wave 0 gap)

**Analog:** `host/test/read-note.test.ts` — `makeFixture` / `writeFixture` / `makeFrontmatter` helpers (lines 33-56)

**Frontmatter fixture shape to copy** (read-note.test.ts lines 103-106):
```typescript
writeFixture(dir, '0001-20260603-100000.md', {
  id: 1, mode: 'free', url: 'https://example.com/admin/users',
  status: 'unread', screenshots: [],
}, 'First note body');
```

**Full frontmatter schema for fixtures** (all keys the skill may parse, from write-note.ts `buildFrontmatter`):
```yaml
---
id: 1
created: "2026-01-01T12:00:00.000Z"
mode: element          # or: free
url: "https://example.com/page"
title: "Page Title"
viewport:
  width: 1280
  height: 800
  dpr: 1
selector: "#some-element"          # element mode only
react_component: "MyComponent"     # element mode, optional
rect:
  x: 100
  y: 200
  width: 80
  height: 30
screenshots:
  - "0001-20260101-120000+1.png"
status: unread
---
```

**Free-mode frontmatter** (no `selector`, no `rect`; has `note_position`):
```yaml
---
id: 6
created: "2026-01-01T12:00:00.000Z"
mode: free
url: "https://example.com/page"
title: "Page Title"
viewport:
  width: 1280
  height: 800
  dpr: 1
note_position:
  x: 320
  y: 480
screenshots: []
status: unread
---
```

**Required fixture files** (from RESEARCH.md Validation section):

| Fixture File | Mode | Screenshots | Purpose |
|-------------|------|-------------|---------|
| `0001-20260101-120000.md` | element | `+1.png` present | Normal element note |
| `0001-20260101-120000+1.png` | — | — | Actual PNG (copy UAT sample or 1x1 transparent) |
| `0002-20260101-120001.md` | free | `[]` | Free note, no screenshots |
| `0003-20260101-120002.md` | element | `+1.png` ref but NO PNG file | Missing screenshot test |
| `0004-20260101-120003.md` | free | `[]` | Ambiguous instruction |
| `0099-20260101-120099.read.md` | free | `[]` | Pre-existing read (must NOT be processed) |

**Element body template** (mirrors `buildNoteBody` output from write-note.ts lines 115-152):
```
<comment text here>

## Element context

- **Selector:** `#some-element`
- **React component:** `MyComponent`
- **Tag / role:** `button` / `button`
- **Text:** Click me
- **Rect:** x=100 y=200 w=80 h=30

### Computed styles (curated)
| prop | value |
|------|-------|
| display | inline-flex |
| color | rgb(255,255,255) |

### outerHTML (truncated)
[html snippet here]

### Screenshots
![+1](0001-20260101-120000+1.png)
```

**Free-mode body** (no `## Element context` block):
```
<comment text here>
```

---

## Shared Patterns

### YAML Frontmatter Parse/Update Pattern
**Source:** `host/src/read-note.ts` lines 81-84 (read) and lines 147-151 (update/rewrite)

Read pattern (read-note.ts lines 81-84):
```typescript
const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) continue;
const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;
```

Update-and-rewrite pattern (read-note.ts lines 147-151):
```typescript
const rawFm = fmMatch[1].replace(/^---\n/, '').replace(/\n---$/, '');
const fm = yamlParse(rawFm) as Record<string, unknown>;
fm['status'] = 'unread';           // for skill: set to 'read' or 'flagged'
const newFmBlock = '---\n' + yamlStringify(fm) + '---\n';
```

**Apply to:** `skill/SKILL.md` step 2e (instruct agent to update `status` key using this pattern in prose form). The agent can use `yaml.parse` / `yaml.stringify` — the library is already present (`yaml@2.9.0` in `dependencies`).

### Serial Extraction from Filename
**Source:** `host/src/read-note.ts` line 77
```typescript
const serial = file.slice(0, 4); // leading 4-digit serial from filename
```
**Apply to:** `skill/SKILL.md` step 2 — "derive the 4-digit serial from `filename.slice(0, 4)`, never from the `id` frontmatter field (which loses zero-padding)."

### Glob Exclusion Pattern (unread-only)
**Source:** `host/src/read-note.ts` line 73 (host intentionally includes ALL `.md`; skill must EXCLUDE `.read.md`)
```typescript
// Host (all notes, including read):
const files = readdirSync(notesDir).filter(f => f.endsWith('.md'));

// Skill (unread only — explicit exclusion required):
const unread = readdirSync(notesDir).filter(
  f => f.endsWith('.md') && !f.endsWith('.read.md')
);
```
**Apply to:** `skill/SKILL.md` step 1 prose — "List files ending in `.md` but NOT in `.read.md`."

### Rename Mechanics (cross-platform)
**Source:** `host/src/read-note.ts` lines 187-189 (base-stripping pattern for both suffixes)
```typescript
const base = basename(mdPath).replace(/\.read\.md$|\.md$/, '');
```
For the skill rename direction (`.md` to `.read.md`):
```typescript
import { rename } from 'node:fs/promises';
const readPath = mdPath.replace(/\.md$/, '.read.md');
await rename(mdPath, readPath);
```
**Apply to:** `skill/SKILL.md` step 2e — "Rename the file from `<name>.md` to `<name>.read.md`."

### Screenshot Path Resolution
**Source:** `host/src/write-note.ts` lines 117 and 182 — screenshots are sibling files in `notesDir`, not relative to project root
```typescript
const screenshotRelPaths = pngBuffers.map((_, i) => `${base}+${i + 1}.png`);
// resolve as: path.join(notesDir, screenshotRelPath)
```
**Apply to:** `skill/SKILL.md` step 2c — "Screenshot paths in `screenshots[]` are relative to the `notes/` directory, not the project root. Resolve as: join(notesDir, screenshotPath)."

### node:test File Test Structure
**Source:** `host/test/read-note.test.ts` (primary) and `lib/test/marquee.test.ts` (secondary — pure function pattern)

Import block (read-note.test.ts lines 16-27):
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { functionUnderTest } from '../src/module.js';
```

tmpdir lifecycle pattern (read-note.test.ts lines 62-65):
```typescript
describe('groupName', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-purpose-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });
  // tests that write to dir
});
```

**Apply to:** Any future `lib/test/review-notes.test.ts` or host-side tests (Phase 7 produces no new TS code per RESEARCH.md, but fixture creation follows this pattern).

### tsconfig.lib.json Include Pattern
**Source:** `tsconfig.lib.json` lines 13-27

If `lib/review-notes.ts` were created (confirmed out-of-scope for Phase 7 — no new TS source this phase), it would need to be added to `tsconfig.lib.json` `include` array:
```json
{
  "include": [
    "lib/review-notes.ts",
    "lib/test/review-notes.test.ts"
  ]
}
```
And to the `test:lib` script in `package.json` alongside existing test files. The `test:lib` script pattern: `tsc -p tsconfig.lib.json && node --test dist/lib/lib/test/<name>.test.js`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `skill/SKILL.md` (portable, no frontmatter) | skill-prose | event-driven | No portable agent-agnostic skill files exist in this repo; analog is from global `~/.claude/skills/scrapling/SKILL.md` (body-only pattern extracted above) |
| `CLEAN-ROOM.md` | provenance-doc | — | No provenance docs exist in the repo yet; `scripts/clean-room-check.mjs` is the data source, not a structural analog |
| `docs/demo-placeholder.png` | binary asset | — | No image assets or asset-creation patterns exist in this repo |

---

## Critical Anti-Patterns (from RESEARCH.md)

These must be explicitly avoided in the skill prose and fixture content:

| Anti-Pattern | Why | Correct Form |
|---|---|---|
| Glob `*.md` without excluding `*.read.md` | `.read.md` ends in `.md` — both match | `endsWith('.md') && !endsWith('.read.md')` |
| Use `id` frontmatter for serial | Integer loses leading zeros: `1` not `"0001"` | `filename.slice(0, 4)` always |
| Rename before fix | Crash leaves note silently lost (core-value violation) | Rename is LAST action, after fix succeeds |
| Treat missing screenshot as ambiguous | Blocks queue for non-ambiguous reason | Warn once + proceed text-only + mark read normally |
| Logic in Claude wrapper | Duplicates skill prose, breaks D-01 portability | Wrapper body = ONE pointer sentence only |
| CLEAN-ROOM.md not in SKIP_FILENAMES | Doc must name banned identifiers by description; add to skip list first | Add `'CLEAN-ROOM.md'` to `SKIP_FILENAMES` in `scripts/clean-room-check.mjs` before writing the doc |

---

## Metadata

**Analog search scope:** `host/src/`, `host/test/`, `lib/`, `lib/test/`, `.claude/skills/`, `~/.claude/skills/`, root config files
**Files scanned:** 14 source files, 2 skill files, 3 config files, 1 script
**Pattern extraction date:** 2026-06-03
