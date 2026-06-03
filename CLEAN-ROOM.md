# CLEAN-ROOM.md — MIT Provenance & Clean-Room Declaration

## 1. MIT Provenance Declaration

**stickyfix** is an original work.

Copyright (c) 2026 Omer Nesher. Licensed under the MIT License — see [LICENSE](./LICENSE).

This codebase was written from scratch, with no source code, comments, identifiers, file
structure, or text copied from any other project. Every file in this repository is an
independent, original contribution.

---

## 2. Clean-Room Method Narrative

This project was built using a clean-room method:

1. **Architecture study only.** The GPL-3.0 upstream project was read to understand the
   problem space — what a localhost annotation host needs, how an MV3 extension communicates
   with a local server, and what a note's on-disk format should contain. No code, no text,
   no identifiers were extracted from that study.

2. **Original code from spec.** All implementation was derived from the product spec
   (PRD.md) and architecture decisions documented in `.planning/`. Each phase's plan is the
   primary design authority; the upstream was a reference only for problem-space understanding.

3. **Zero copy-paste.** No file was created by pasting and modifying upstream source. The
   identifier namespace (`sfx-*`, `stickyfix`) was established and enforced from Phase 1 so
   that no upstream-flavored naming could inadvertently creep in.

4. **Automated gate from commit one.** The clean-room check script (`scripts/clean-room-check.mjs`)
   has been present and enforced since Phase 1 (BUILD-04). It runs on every phase as a
   mandatory verification step. The gate has passed every phase to date.

---

## 3. GPL Upstream Acknowledgment (Without Inclusion)

The architecture of stickyfix was informed by studying the open-source project hosted at
GitHub under the user handle `JodusNodus`, a Chrome annotation extension released under
the GPL-3.0 license. That project served as a reference for understanding the domain; its
GPL license means its source code cannot be incorporated into an MIT-licensed codebase.

**None of that project's source code is present in this repository.** This declaration
itself names the upstream project and its license for attribution purposes — which is why
`CLEAN-ROOM.md` is listed in the `SKIP_FILENAMES` exclusion set of the audit script (see
Section 4). The mention here is a legal acknowledgment, not an inclusion.

---

## 4. Automated Grep Audit

The audit script `scripts/clean-room-check.mjs` checks all first-party source files for
three classes of banned identifiers:

| Class | Description | Why banned |
|-------|-------------|------------|
| Upstream private-API prefix | The upstream project's internal identifier prefix (a double-underscore followed by a three-letter abbreviation and another underscore) | Would indicate copy-pasted private API calls |
| Upstream project name | The upstream project's name (two English words combined) | Would indicate naming derived from the upstream rather than original |
| Upstream author handle | The upstream author's GitHub handle (two Latin words concatenated) | Would indicate copied comments or attribution text |

The banned patterns are constructed from fragments inside the script itself — so the scanner
does not self-trip on its own source code. `CLEAN-ROOM.md` is listed in `SKIP_FILENAMES`
for the same reason: this document legitimately names the upstream project and its
associated identifiers by *description*, as required for a legal provenance declaration.

**Command:**

```
node scripts/clean-room-check.mjs
```

**Live output (run 2026-06-03, during Phase 7 execution):**

```
clean-room audit: PASS — no banned identifiers found
Exit code: 0
```

---

## 5. Audit Scope

**Extensions scanned:** `.ts` `.js` `.mjs` `.cjs` `.json` `.html` `.css` `.md`

**Directories excluded (and why):**

| Directory | Reason for exclusion |
|-----------|----------------------|
| `node_modules` | Third-party vendor code — not first-party source |
| `.git` | Version-control metadata |
| `.output` | WXT build output — derived from scanned source |
| `dist` | esbuild host output — derived from scanned source |
| `.wxt` | WXT internal cache |
| `.planning` | Research and planning documents — may reference upstream for architectural study; never published as part of the MIT deliverable |
| `notes` | Runtime user content — written at runtime, never committed |
| `private` | Private business/strategy documents — never published |
| `.claude` | Editor/agent configuration — never published |
| `.qmd-memory` | Agent long-term memory — never published |

**Root-level files excluded (and why):**

| File | Reason |
|------|--------|
| `PRD.md` | Product spec — may reference upstream for problem-space description |
| `README.md` | Attribution doc — names the upstream for legal notice |
| `CLAUDE.md` | Editor instructions — may reference upstream for context |
| `LICENSE` | License file |
| `CLEAN-ROOM.md` | This file — names the upstream by description for provenance |

All remaining first-party source files are scanned in full.

---

## 6. Phase 8 Release Gate

Phase 8 (SC-4) will re-run this same audit as a mandatory release gate before the v1.0
milestone ships. The Phase 8 run will additionally check for upstream selector constants
(specific CSS/JS identifiers introduced in the upstream's element-picker implementation)
that are out of scope for the current Phase 7 baseline.

Re-running `node scripts/clean-room-check.mjs` at that point must still exit 0. Any
violation found during Phase 8 will block release.
