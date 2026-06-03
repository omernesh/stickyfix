---
phase: 07-review-notes-skill-docs
reviewed: 2026-06-03T11:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - lib/review-notes.ts
  - lib/test/review-notes.test.ts
  - skill/SKILL.md
  - tsconfig.lib.json
  - package.json
  - scripts/clean-room-check.mjs
  - CLEAN-ROOM.md
  - README.md
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: clean
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-03T11:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** clean (no HIGH or BLOCKER issues; one WARNING in test fixtures)

## Summary

Phase 7 delivers three distinct artifacts: pure helper functions in `lib/review-notes.ts`, a portable agent skill in `skill/SKILL.md`, and documentation in `README.md` + `CLEAN-ROOM.md`. The review checked each artifact against its specification (07-CONTEXT.md decisions D-01 through D-12, SKILL-02..05) and against the note format contract in `host/src/write-note.ts`.

The implementation is sound. All three helper functions (`selectUnread`, `markReadName`, `classifyNote`) are correct, pure, and match the SKILL.md prose exactly. The skill prose faithfully implements the D-04..D-09 decisions. The CLEAN-ROOM.md and README.md docs are accurate and complete for their stated scope.

One WARNING-level defect was found in a test fixture: an invalid ISO 8601 timestamp. Three INFO items cover minor test-coverage gaps and a doc pseudocode style note.

No security issues, no logic errors, no GPL-namespace violations, no chrome.*/node side-effects in the lib.

---

## Warnings

### WR-01: Invalid ISO 8601 timestamp in fixture `0099-20260101-120099.read.md`

**File:** `test/fixtures/notes/0099-20260101-120099.read.md:3`

**Issue:** The `created` frontmatter field is `"2026-01-01T12:00:99.000Z"`. Seconds value `99` is out of range for ISO 8601 (valid: 00-59). The filename also encodes `120099` reflecting the same invalid time component. `yaml@2.9.0` parses this as a plain string (no exception), so it won't break `classifyNote` at runtime, but the fixture is supposed to model a real note written by the host — and `write-note.ts` uses `new Date()` which will never produce seconds=99. Any future validator or agent that checks timestamp validity will be confused by this fixture.

**Fix:** Use a valid timestamp. The fixture's intent is to model serial 99 (a high serial to test non-collison with serials 1-4). Use any valid time, e.g.:

```yaml
# filename: 0099-20260101-120039.read.md
id: 99
created: "2026-01-01T12:00:39.000Z"
```

Rename the fixture file to match: `0099-20260101-120039.read.md`.

---

## Info

### IN-01: `classifyNote` test suite has no coverage for absent `status` + screenshots

**File:** `lib/test/review-notes.test.ts:83-131`

**Issue:** The test suite covers `status: 'unread'` with screenshots present, missing, and empty. It does not cover `status: undefined` (malformed frontmatter) with screenshots present on disk, or `status: undefined` with screenshots missing. In both cases the function falls through correctly to the screenshot check and returns `fixable` or `text-only` respectively — but these paths are untested. Given that agents will be parsing real files, a frontmatter with a missing `status` key is plausible.

**Fix:** Add two test cases:

```ts
test('absent status + screenshot present → fixable (safe default, treats as unread)', () => {
  assert.strictEqual(
    classifyNote({ screenshots: ['0005-t+1.png'] }, ['0005-t+1.png']),
    'fixable'
  );
});

test('absent status + screenshot missing → text-only', () => {
  assert.strictEqual(
    classifyNote({ screenshots: ['0005-t+1.png'] }, []),
    'text-only'
  );
});
```

### IN-02: `markReadName` has no test for non-`.md` input (contract-violation defensive behavior)

**File:** `lib/test/review-notes.test.ts:59-77`

**Issue:** If `markReadName` is called with a filename that does not end in `.md` (contract violation — callers should only pass output of `selectUnread`, which guarantees `.md`), `replace(/\.md$/, '.read.md')` returns the name unchanged. This is defensively fine but untested. A future refactor could change this silently.

**Fix:** Add one test documenting the no-op behavior:

```ts
test('non-.md input (contract violation) → unchanged (no-op, regex has no match)', () => {
  assert.strictEqual(markReadName('0001-t.png'), '0001-t.png');
});
```

### IN-03: SKILL.md step 2c uses Node.js-idiomatic `join()` pseudocode in an agent-agnostic skill

**File:** `skill/SKILL.md:139`

**Issue:** Step 2c instructs: `screenshotAbsPath = join(notesDir, screenshotFilename)`. The skill is intentionally agent-agnostic (D-01: readable by Claude Code / Cursor / Codex), but `join()` is a Node.js `path` function. A Python-based agent or a shell-using agent could misread this as code to execute rather than pseudocode for path concatenation. The risk is low — the intent is clear in context — but a language-neutral description would be more robust.

**Fix:** Rephrase to make the pseudocode language-neutral:

```
screenshotAbsPath = notesDir + "/" + screenshotFilename
  (or use your language's path join utility)
```

---

## Structural Findings (fallow)

No structural pre-pass was provided for this phase.

---

_Reviewed: 2026-06-03T11:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
