# Phase 6: Region Capture + Visual Design + Persistent Pins - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 6-region-capture-visual-design
**Areas discussed:** Phase scope, Pin data source & scoping, Edit/delete semantics, Orphaned-pin fallback, Pin scope & visual

---

## Phase Scope (numbering/scope fork)

| Option | Description | Selected |
|--------|-------------|----------|
| Region Capture + Visual Design | Keep roadmap Phase 6 as-is; pins get a later slot | |
| Pins (Persistent Element Markers) | Re-scope Phase 6 to pins; region capture shifts later | |
| Both combined in Phase 6 | Region capture + visual design + pins as one phase | ✓ |

**User's choice:** Both combined in Phase 6
**Notes:** Roadmap Phase 6 was "Region Capture + Visual Design"; pins were approved earlier but never slotted. User folded all three into Phase 6. ROADMAP.md + REQUIREMENTS.md amended accordingly (added PIN×6 + HOST-14/15/16; 68→77 reqs).

---

## Pin Data Source & Scoping

| Option | Description | Selected |
|--------|-------------|----------|
| Host reads .md frontmatter | New GET endpoint; files = source of truth; survives browser reset | ✓ |
| Extension chrome.storage | Fast cache keyed by origin/url; drifts from disk | |
| Both (cache + host sync) | chrome.storage reconciled against host GET | |

**User's choice:** Host reads .md frontmatter

| Option | Description | Selected |
|--------|-------------|----------|
| Match by exact URL (path) | Pin shows only on the same path; query ignored | ✓ |
| Match by origin only | Every note for the origin shows on every page | |
| Exact URL incl. query string | Strictest; brittle to query changes | |

**User's choice:** Match by exact URL path (query ignored)

---

## Edit/Delete Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite .md in place (PUT) | Rewrites same serial; re-marks unread; one living note | ✓ |
| Append a new note | Edit creates a fresh serial; pure append-only; clutters notes/ | |

**User's choice:** Overwrite .md in place (PUT)

| Option | Description | Selected |
|--------|-------------|----------|
| Hard delete file + screenshots | DELETE removes .md + +N.png; tidy | ✓ |
| Soft delete (.deleted.md) | Recoverable; leaves residue for the skill to ignore | |

**User's choice:** Hard delete file + screenshots

| Option | Description | Selected |
|--------|-------------|----------|
| Serial-based id in path | `/annotation/0003`; host globs `0003-*.md`; survives rename | ✓ |
| Full filename in path | Exact filename; breaks on any rename | |

**User's choice:** Serial-based id in path

---

## Orphaned-Pin Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Show greyed at last-known rect | Dimmed/dashed at stored rect; never hidden; tooltip | ✓ |
| Hide until anchor returns | No pin when selector misses; conflicts with never-lost | |
| Re-anchor heuristically | testId/text fallback; unpredictable, can mis-attach | |

**User's choice:** Show greyed at last-known rect

---

## Pin Scope & Visual

| Option | Description | Selected |
|--------|-------------|----------|
| Both: element anchored + free floating | Every note pinned; free pins float at viewport coords | ✓ |
| Element-notes only | Only anchored notes pinned; free-notes fire-and-forget | |

**User's choice:** Both: element anchored + free floating

| Option | Description | Selected |
|--------|-------------|----------|
| Color by mode + unread/read dot | Mode-tinted 📌 + read-state dot + hover preview | ✓ |
| Uniform marker, no state | One neutral marker, no encoding | |
| You decide during UI-SPEC | Defer exact styling to ui-phase | |

**User's choice:** Color by mode + unread/read dot (exact styling refinable in UI-SPEC; encoding locked)

---

## Claude's Discretion

- Exact pin glyph/size/badge, scrim opacity, marquee min-drag threshold, thumbnail strip layout, reposition throttling.
- Whether pin rehydration fetches once on review-entry or also re-syncs after each Send.

## Deferred Ideas

- Full-page scrolling region capture (FUT-02).
- Lightbox preview on thumbnail/pin click (FUT-05).
- Heuristic re-anchoring of orphaned pins (rejected for v1).
- Pin clustering / off-screen indicators (future polish).
