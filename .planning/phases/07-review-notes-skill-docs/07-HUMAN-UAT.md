# Phase 07 — Human UAT Runbook (SKILL-02..05)

**Purpose:** Verify the review-notes skill processes the fixture notes set with
the correct outcome for each scenario: element fix, free-mode fix, missing
screenshot (text-only), ambiguous instruction (flagged), and idempotent re-run.

**Who runs this:** Omer (or any developer with access to the project).

**Time estimate:** 5–10 minutes.

---

## Fixture Set (test/fixtures/notes/)

| File | Mode | Screenshots | Scenario |
|------|------|-------------|----------|
| `0001-20260101-120000.md` | element | `+1.png` present | Normal element note with clear instruction |
| `0001-20260101-120000+1.png` | — | — | The actual PNG for 0001 |
| `0002-20260101-120001.md` | free | `[]` | Free-floating note, clear instruction, no screenshots |
| `0003-20260101-120002.md` | element | `+1.png` ref but **no PNG file** | Missing screenshot — text-only path |
| `0004-20260101-120003.md` | free | `[]` | Ambiguous instruction ("Make this better") |
| `0099-20260101-120039.read.md` | free | `[]` | Pre-read note (must not be processed) |

---

## Before You Begin

**IMPORTANT: Copy the fixtures to a scratch directory first.** The skill mutates
files (renames `.md` → `.read.md`, rewrites frontmatter). Working on a copy
preserves the originals for future test runs.

```
# Create a scratch copy
cp -r test/fixtures/notes /tmp/sfx-uat-notes
# (Windows PowerShell):
# Copy-Item -Recurse test\fixtures\notes $env:TEMP\sfx-uat-notes
```

---

## Steps

### 1. Point an AI agent at the scratch directory

Open a Claude Code (or compatible agent) session in the project root. Tell it:

> "Read my notes in /tmp/sfx-uat-notes"

The agent should invoke the `review-notes` skill. If using Claude Code, it will
auto-invoke via `.claude/skills/review-notes/SKILL.md` which points to
`skill/SKILL.md`.

Alternatively, paste the contents of `skill/SKILL.md` directly into the agent's
context and tell it to follow those instructions against the scratch directory.

### 2. Observe the run

Watch the agent's output for:

- A `WARN: 0003-20260101-120002+1.png not found — proceeding text-only` line
  (for note 0003)
- No attempt to process `0099-20260101-120039.read.md` (it must be skipped silently)

### 3. Verify outcomes

After the run, check the scratch directory:

**0001 — Element note with screenshot (SKILL-03, SKILL-02)**

```
# Expected: renamed to *.read.md, status updated to 'read'
ls /tmp/sfx-uat-notes/0001-20260101-120000.read.md   # must exist
ls /tmp/sfx-uat-notes/0001-20260101-120000.md        # must NOT exist
grep "status: read" /tmp/sfx-uat-notes/0001-20260101-120000.read.md
```

Confirm the agent applied the fix (button label changed to "Save Changes" in the
relevant source file or described clearly in its output).

**0002 — Free-mode note, no screenshots (SKILL-03)**

```
ls /tmp/sfx-uat-notes/0002-20260101-120001.read.md   # must exist
ls /tmp/sfx-uat-notes/0002-20260101-120001.md        # must NOT exist
grep "status: read" /tmp/sfx-uat-notes/0002-20260101-120001.read.md
```

**0003 — Missing screenshot, text-only path (D-09)**

```
ls /tmp/sfx-uat-notes/0003-20260101-120002.read.md   # must exist (fixed text-only)
ls /tmp/sfx-uat-notes/0003-20260101-120002.md        # must NOT exist
grep "status: read" /tmp/sfx-uat-notes/0003-20260101-120002.read.md
```

The agent should have emitted a WARN line about the missing PNG, then proceeded
with the text-only instruction. The note should be renamed and marked read.

**0004 — Ambiguous instruction, flagged path (D-08)**

```
ls /tmp/sfx-uat-notes/0004-20260101-120003.md        # must STILL exist (not renamed)
ls /tmp/sfx-uat-notes/0004-20260101-120003.read.md   # must NOT exist
grep "status: flagged" /tmp/sfx-uat-notes/0004-20260101-120003.md
grep "flagged:" /tmp/sfx-uat-notes/0004-20260101-120003.md
```

The frontmatter should show `status: flagged` and the body should end with a
`> flagged: <reason>` blockquote line.

**0099 — Pre-read note, unchanged (SKILL-04, SKILL-05)**

```
ls /tmp/sfx-uat-notes/0099-20260101-120039.read.md   # must still exist unchanged
grep "status: read" /tmp/sfx-uat-notes/0099-20260101-120039.read.md
```

The file must be unmodified — the agent must not have touched it.

---

## Idempotency Check (SKILL-05)

After confirming the outcomes above, run the skill again on the same scratch
directory:

> "Read my notes in /tmp/sfx-uat-notes"

Expected response: **"no unread notes"** (or equivalent wording). The agent should
process zero notes and make zero file changes.

This proves the skill is idempotent — re-running on a fully-processed directory is
a safe no-op.

---

## Expected Summary Line

After the initial run, the skill should report something like:

```
Processed 4 notes: 3 fixed and marked read, 1 flagged (ambiguous), 0 skipped.
Flagged: 0004-20260101-120003.md — "Make this better" has no actionable target.
```

(Exact wording may vary; what matters is the counts and the flagged note name.)

---

## Pass Criteria

| Check | Pass condition |
|-------|---------------|
| 0001 renamed to .read.md | `status: read` in frontmatter |
| 0002 renamed to .read.md | `status: read` in frontmatter |
| 0003 renamed to .read.md | `status: read` in frontmatter; WARN line emitted |
| 0004 NOT renamed | `status: flagged` + `> flagged:` blockquote in body |
| 0099 untouched | File unchanged, still named .read.md |
| Idempotency | Second run: "no unread notes", zero file changes |

All 6 checks must pass.

---

## On Completion

If all checks pass, reply "approved" to the checkpoint.

If any check fails, describe what diverged (e.g. "0004 was renamed to .read.md
instead of flagged") so the skill prose can be corrected.

---

## Checkpoint Resolution

**Status:** `pending (auto-approved checkpoint; manual run available)`

**Note (2026-06-03):** This checkpoint was auto-approved in GSD chain mode. No live
agent run was performed against the fixture set during execution. The runbook above
remains available for Omer to execute manually against a scratch copy of
`test/fixtures/notes/`. To do so, copy the fixtures to a scratch directory as
instructed in "Before You Begin", then follow the Steps section with a Claude Code
(or compatible) agent session.

The automated verification gates (Task 1 prose structure gate + Task 2 fixture
shape gate) both passed. End-to-end skill UAT (SKILL-03) has not been
runtime-confirmed — it is the remaining human-verifiable gate.
