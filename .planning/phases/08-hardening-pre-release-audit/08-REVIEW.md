---
phase: 08-hardening-pre-release-audit
reviewed: 2026-06-04T00:00:00Z
depth: standard
re_review: true
fix_commit: ce878a0
files_reviewed: 11
files_reviewed_list:
  - lib/error-toast.ts
  - lib/payload-size.ts
  - lib/thumbnail-number.ts
  - lib/test/error-toast.test.ts
  - lib/test/payload-size.test.ts
  - lib/test/thumbnail-number.test.ts
  - entrypoints/review.content/card.ts
  - host/test/server.test.ts
  - scripts/clean-room-check.mjs
  - tsconfig.lib.json
  - package.json
findings:
  critical: 0
  blocker: 0
  warning: 2
  info: 4
  total: 6
status: issues-found
---

# Phase 8: Code Review Report (RE-REVIEW after WR-01 fix)

**Reviewed:** 2026-06-04
**Depth:** standard
**Files Reviewed:** 11
**Fix under review:** commit `ce878a0` (path-aware thumbnail renumber)
**Status:** issues-found (2 warnings carried over, 4 info; the prior BLOCKER-class correctness defect WR-01 is RESOLVED)

## Summary

This is a re-review after the single fix commit `ce878a0`, which addressed the
prior **WR-01** (element-path thumbnail renumber collision) and its associated
misleading-comment defect **IN-02**. I verified the fix against ground-truth
source in `card.ts`, not merely against the new test's self-assertions, and ran
the lib suite to confirm the new test actually executes.

**Verification results:**

- **WR-01 — RESOLVED (verified against source, not just tests).**
  - The renumber logic now lives in the pure helper
    `lib/thumbnail-number.ts:30-37`: `item.kind = `+${i + 1 + baseOffset}``.
  - **Element path** (`renderThumbnails(thumbStrip, thumbnails, 1)` at
    `card.ts:633`; delete handler at `card.ts:84` passes `baseOffset=1`):
    renumber produces `+${i + 2}` → for indices `0,1,2,…` → `+2, +3, +4, …`.
    Minimum possible kind is `+2`. The `_doElementSend` auto-highlight is
    injected as `kind: '+1'` (`card.ts:849`) and the thumbnails are spread
    after it (`card.ts:859`). Because no renumbered thumbnail can ever be `+1`,
    the two-`+1`-collision the prior review proved is now impossible. Confirmed
    against the actual payload-assembly block at `card.ts:847-860`.
  - **Camera-push vs renumber consistency (element):** the camera handler pushes
    `+${thumbnails.length + 2}` (`card.ts:632`). For `n` existing items the push
    yields `+(n+2)`; the renumber yields `+2 … +(n+1)` for those `n` items, so
    the next pushed slot `+(n+2)` is exactly the successor — no gap, no overlap,
    no duplicate. The two numbering sites agree.
  - **Free path** (`renderThumbnails(thumbStrip, thumbnails)` at `card.ts:249`,
    `baseOffset` defaults to `0`; delete handler `baseOffset=0`): renumber yields
    `+${i + 1}` → `+1, +2, …`; camera push yields `+${thumbnails.length + 1}` →
    `+1, +2, …`. **Byte-identical to the pre-fix behaviour.** No regression on the
    free path.
  - Verified via the `node:test` run: the 3 element-path tests (incl. the
    explicit "none equals +1" Set-uniqueness assertion and the
    multi-delete no-`+1` test) and the 3 free-path tests all execute and pass.

- **IN-02 — RESOLVED.** The misleading inline comment is gone. `card.ts:81-83`
  now correctly states the path-aware semantics ("free path (baseOffset=0) →
  +1,+2,…; element path (baseOffset=1) → +2,+3,… (reserves +1 …)"), and the
  helper docblock (`thumbnail-number.ts:9-13, 20-28`) matches the implementation
  exactly. No comment now contradicts the code.

- **Helper purity — CONFIRMED.** `lib/thumbnail-number.ts` has no top-level
  `chrome`/`document`/`window` access; it is a pure array-mutating transform.
  It imports cleanly under `node:test` without mocks (proven by the passing
  suite). INVARIANT D (sfx-* namespace) is untouched; the file introduces no
  new identifiers.

- **Test wiring — CONFIRMED NOT A SILENT NO-OP.** `tsconfig.lib.json:25`
  includes `lib/thumbnail-number.ts`; the test glob `lib/test/**/*.ts`
  (`tsconfig.lib.json:26`) compiles the new test; `package.json:11` appends
  `dist/lib/lib/test/thumbnail-number.test.js` to the explicit `test:lib` list.
  I ran `npm run test:lib`: the suite reports **152 tests, 152 pass, 0 fail**,
  and the 8 `renumberThumbnailKinds` tests appear by name in the runner output —
  they genuinely run.

- **Previously-clean contracts re-confirmed (no regression from the change):**
  - **D-01a verbatim toast strings (error-toast.ts):** unchanged by this commit;
    all three forms (`'Extension error: ' + (… ?? 'no response')`, relay
    pass-through, `wrote notes\<file>` single-backslash) still match the
    `card.ts` call sites (`:430-432`, `:443-445`, `:451-453`, `:877-879`,
    `:887-889`, `:896-898`). PASS.
  - **D-04 boundary (payload-size.ts):** `exceedsBodyCap` uses strict `>` against
    `12 * 1024 * 1024`; pre-flight at both send paths (`card.ts:414`, `:864`)
    fires before `sendMessage`. Unchanged. PASS.
  - **Concurrency test (server.test.ts:573-609):** still builds all 10 fetch
    promises before awaiting (`Promise.all(Array.from(...))`) — genuinely
    concurrent; serial-integrity and file-count assertions intact. PASS.
  - **clean-room (clean-room-check.mjs):** ran the scanner — **PASS, no banned
    identifiers**. Fragment-constructed banned patterns still don't self-trip;
    the new `lib/thumbnail-number.ts` introduces no upstream tokens.
  - Full host suite contracts (token gate, 127.0.0.1 bind, 12 MB 413 backstop,
    traversal rejection) unaffected by this extension-only change.

**Net change vs prior review:** WR-01 (correctness defect) and IN-02 (misleading
comment) are resolved. WR-02 and WR-03 remain open (no fix attempted — they were
explicitly out of this commit's scope). No new defects of Blocker/Warning
severity were introduced. One minor new info item (IN-05) on residual numbering
duplication. The prior IN-01, IN-03, IN-04 carry over unchanged.

## Warnings

### WR-02: Payload-size tests allocate up to 12 MB+ strings — slow and memory-heavy under `--test` (STILL OPEN)

**File:** `lib/test/payload-size.test.ts:49-57`; mirrored in
`host/test/server.test.ts:628-728`
**Issue:** Unchanged by `ce878a0`. `'x'.repeat(MAX_BODY_BYTES)` and
`'x'.repeat(MAX_BODY_BYTES + 1)` each materialise ~12 MB strings, and
`encodedBodyBytes` re-encodes them via `TextEncoder` into another ~12 MB
`Uint8Array`. Combined with the host 11.9 MB / 12 MB+ integration bodies in one
`node --test` process, RSS can spike 60–100 MB. Correctness-neutral, but a
flake/OOM risk on constrained CI runners. (Performance per se is out of v1
scope; flagged only as a test-robustness risk.)
**Fix:** The pure boundary test does not require a real 12 MB allocation —
assert `>` against `MAX_BODY_BYTES` with a synthetic/short input, or reuse a
single shared buffer across the over/at-cap cases rather than allocating twice.

### WR-03: `test:lib` enumerates test files by hand — a new lib test can silently never run (STILL OPEN)

**File:** `package.json:11` (and `:12` for host)
**Issue:** Unchanged by `ce878a0`. The fix correctly appended the new
`thumbnail-number.test.js` path, so it does run today — but this commit is the
exact failure mode the warning describes: the test only executes because the
author remembered to hand-edit the string. The next lib test that someone
forgets to append will compile and silently never run, yielding a green CI that
proves nothing for that file. For a project whose core value is "a dropped note
is a regression," a silently-unrun test is a real reliability hazard.
**Fix:** Use Node 20+ glob discovery so every compiled test is found:
```json
"test:lib": "tsc -p tsconfig.lib.json && node --test \"dist/lib/lib/test/**/*.test.js\""
```
Apply the same treatment to `test`. If the explicit list must stay, add a guard
that asserts the count of `dist/lib/lib/test/*.test.js` equals the enumerated
path count.

## Info

### IN-05: Element camera-push numbering is duplicated, not delegated to the helper (NEW)

**File:** `entrypoints/review.content/card.ts:632` (and the free counterpart `:248`)
**Issue:** The fix centralised the *delete-renumber* path into
`renumberThumbnailKinds`, but the *initial push* numbering is still hand-computed
inline: element pushes `+${thumbnails.length + 2}`, free pushes
`+${thumbnails.length + 1}`. There are now two sources of truth for "what number
does a thumbnail get." They currently agree with the helper's offset math (I
verified: push `+(n+2)` is the exact successor of the helper's last `+(n+1)` on
the element path), so this is **not** a regression and **not** a live bug — but
the `+2` vs `baseOffset=1` relationship is implicit. A future edit to the helper
offset that isn't mirrored in the push site would reintroduce a numbering skew.
**Fix:** Optional — derive the pushed kind from the same helper, e.g. push with a
placeholder kind then call `renumberThumbnailKinds(items, baseOffset)` once
immediately after the push, so a single function owns all numbering.

### IN-01: Doubled `lib/lib` output path is correct but brittle/confusing (CARRIED OVER)

**File:** `tsconfig.lib.json:6-7`; `package.json:11`
**Issue:** `outDir: "dist/lib"` + `rootDir: "."` maps `lib/test/x.ts` →
`dist/lib/lib/test/x.js`, hence the `dist/lib/lib/test/...` paths in `test:lib`
(the new thumbnail test path inherits the same doubled segment). Internally
consistent and working, but a foot-gun for the next editor (easy to write
`dist/lib/test/...` and get "no test files found").
**Fix:** Optional — set `rootDir: "lib"` (adjusting `card-state.ts` handling) so
output is `dist/lib/test/...`, or document the doubled segment near the script.

### IN-03: `mapSendOutcome` switch relies on exhaustiveness without a guard (CARRIED OVER)

**File:** `lib/error-toast.ts:60-79`
**Issue:** Unchanged. `switch (o.kind)` has no `default`/`never` guard. TS
enforces all three arms today, but a future fourth `SendOutcome` kind would make
the function fall through and return `undefined`, surfacing as a blank/crashing
toast — at odds with the no-silent-failure invariant.
**Fix:**
```ts
default: {
  const _exhaustive: never = o;
  return _exhaustive;
}
```

### IN-04: clean-room scanner reads every matched file fully into memory (CARRIED OVER)

**File:** `scripts/clean-room-check.mjs:99,104-109`
**Issue:** Unchanged. `readFileSync(full, 'utf8')` loads each scanned file
entirely and runs three regexes; no size guard. Skip dirs exclude
`node_modules`/`.output`/`dist`, so low risk, but a large committed `.json`/`.md`
fixture would be fully buffered. Latent robustness only.
**Fix:** Optional — skip files over ~2 MB with a warning; banned tokens are short
and appear in normal-sized source.

---

_Reviewed: 2026-06-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (re-review of fix commit ce878a0)_
