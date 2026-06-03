---
phase: 7
slug: review-notes-skill-docs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 7 ships a portable markdown SKILL.md + README + CLEAN-ROOM.md — no extension/host runtime changes. Validation centers on a node:test harness that exercises the skill's *processing contract* against fixture notes/ dirs, plus the existing clean-room grep gate.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, already used for lib + host) |
| **Config file** | none — `tsconfig.lib.json` already compiles `lib/**` + `test/**` to `dist/lib/` |
| **Quick run command** | `npm run test:lib` |
| **Full suite command** | `npm run check` (tsc --noEmit + test:lib + host smoke) |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:lib`
- **After every plan wave:** Run `npm run check`
- **Before `/gsd:verify-work`:** Full suite must be green + `node scripts/clean-room-check.mjs` exits 0
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | SKILL-02 | — | Glob `notes/*.md`, exclude `*.read.md`, sort ascending by 4-digit serial | unit | `npm run test:lib` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 0 | SKILL-04 | — | Read-marker transform: rename→`*.read.md` + set `status: read`; idempotent re-scan returns empty | unit | `npm run test:lib` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 0 | SKILL-05 | — | Edge classifiers: empty queue clean; ambiguous→`status: flagged`+reason, filename kept; missing screenshot→text-only flag | unit | `npm run test:lib` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | SKILL-01,02,03,04,05 | — | `skill/SKILL.md` prose contract matches the pure helpers; serial order + auto-fix + after-fix rename documented | manual+grep | `test -f skill/SKILL.md` | ✅ | ⬜ pending |
| 07-02-02 | 02 | 1 | SKILL-01 | — | `.claude/skills/review-notes/SKILL.md` wrapper with `name`+`description` frontmatter pointing at `skill/SKILL.md` | grep | `grep -q 'skill/SKILL.md' .claude/skills/review-notes/SKILL.md` | ✅ | ⬜ pending |
| 07-03-01 | 03 | 1 | DOC-01 | — | README quickstart (host `npm run host -- --root`, load unpacked, token, Review Mode, run skill) + GIF placeholder + record steps | grep | `grep -q '## Quickstart' README.md` | ✅ | ⬜ pending |
| 07-03-02 | 03 | 1 | DOC-02 | — | CLEAN-ROOM.md: MIT provenance + clean-room narrative + live grep audit result | grep+cmd | `node scripts/clean-room-check.mjs` exits 0; `test -f CLEAN-ROOM.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/review-notes.ts` (or similar) — pure helpers: `selectUnread(files[])`, `markReadName(name)`, `classifyNote(frontmatter, files[])` returning `read|flagged|fixable|text-only`. These are the testable core extracted from the skill prose so SKILL-02/04/05 have automated coverage.
- [ ] `lib/test/review-notes.test.ts` — stubs for SKILL-02 (glob/sort/exclude), SKILL-04 (rename + status:read + idempotency), SKILL-05 (empty/ambiguous/missing-screenshot)
- [ ] Fixture note frontmatter strings inline in the test (no real disk notes needed for pure helpers)
- [ ] node:test already installed — no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Skill actually applies a code fix end-to-end | SKILL-03 | Requires a live AI agent reading a real note + codebase; can't be unit-tested deterministically | Drop a note via the extension, point an agent at `notes/`, confirm the fix is applied and the note becomes `*.read.md` |
| Demo GIF shows the real flow | DOC-01 | Needs a live browser recording session the agent can't drive | Omer records per the README "how to record" steps; replaces placeholder asset |
| README "<5 min to working" | DOC-01 | Subjective time-to-first-success | Follow quickstart top-to-bottom on a clean checkout |

*The SKILL-03 auto-fix behavior is documented + prose-tested; only the live application is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (pure helpers + fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
