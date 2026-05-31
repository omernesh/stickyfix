# Feature Research

**Domain:** On-page annotation / visual feedback tool — developer-facing, AI-agent-oriented
**Researched:** 2026-05-31
**Confidence:** HIGH (cross-validated across Marker.io, BugHerd, Vercel Comments, Userback, Vibe Annotations, AgentEcho, opencode-chrome-annotation)

---

## Competitive Landscape Summary

Tools analyzed fall into two clusters:

**Cluster A — Client/team feedback (cloud-first):** Marker.io, BugHerd, Userback, Netlify Drawer, Vercel Comments. These are multi-user, cloud-backed, PM-tool-integrated. Their unit of output is a task card in Jira/Linear/Asana. They capture screenshots + light browser metadata. Element context is shallow (selector + browser info). No file-on-disk contract.

**Cluster B — Developer/AI-agent annotation (local-first):** opencode-chrome-annotation (GPL upstream), Vibe Annotations, AgentEcho, MarkUp. These are single-developer, localhost-first, targeting the AI coding agent workflow. Element context is richer. Output varies: some push directly to agent API (opencode, Vibe via MCP), some export markdown (AgentEcho, MarkUp). None write durable ordered markdown files to the project repo with a read/unread queue.

**stickyfix sits in Cluster B but uniquely combines:** durable file-on-disk contract (not ephemeral push), rich element context capture (React fiber, computed styles, outerHTML), ordered serial queue consumable by any agent, and a shipped AI skill that closes the loop.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that every annotation/feedback tool in the category has. Missing them makes the product feel broken or unfinished — users leave before understanding the differentiator.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Click-to-annotate on any element | Core mechanic of all tools in category | MEDIUM | Hover highlight + click to open note card is universal. Without this, it is not an annotation tool. |
| Visual highlight of selected element | Users need feedback that the right element was targeted | LOW | Outline + label (tag · size) on hover. All tools do this. |
| Screenshot capture attached to note | Every tool captures a screenshot; reviewers expect it | HIGH | MV3: must use `chrome.tabs.captureVisibleTab`; need to hide own UI before capture to avoid self-contamination. |
| Note text / comment field | The annotation is the core payload | LOW | Textarea in a post-it card. Universal. |
| Send / submit action that confirms delivery | Users need confirmation the note was not lost | LOW | A toast with the filename is sufficient. Absence = notes silently dropped = tool is useless. |
| Review Mode toggle (on/off) | No overlay should be permanent on every page visit | LOW | Extension popup toggle or toolbar button. All tools gate their UI behind explicit activation. |
| Capture URL + page title with each note | Minimum context to reproduce the issue | LOW | Every tool captures this automatically. Missing = notes are ambiguous. |
| Capture browser + viewport info | Context needed for bug reproduction | LOW | Browser, OS, screen resolution, DPR. All Cluster A tools capture this. |
| No permanent footprint on pages | Overlay must be injected on demand, not always present | MEDIUM | MV3 `optional_host_permissions` + dynamic `executeScript` injection. Static content_scripts always execute and break page load metrics. |
| Error surfacing — no silent failures | A failed Send must produce a visible error | LOW | Toast on 4xx/5xx/network error. The PRD calls this out explicitly as critical; users will never trust a tool that silently swallows notes. |
| Persist settings across browser restarts | Token + project mapping should survive Chrome restart | MEDIUM | MV3 service workers are ephemeral; must use `chrome.storage.local`, not in-memory state. |
| Free-floating note (not element-anchored) | Sometimes the issue is the page, not a specific element | LOW | A draggable `+` FAB. Cluster A tools all support "annotate anywhere". |
| Element-anchored note with selector | The selector is the minimum developer context | MEDIUM | `@medv/finder` for robust selectors. BugHerd and Marker.io both capture CSS selector. |

### Differentiators (Competitive Advantage)

Features that distinguish stickyfix from all comparable tools. These are the reasons the primary user (developer with AI coding agent) chooses this over alternatives.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **File-on-disk as the output contract** | Notes become durable `.md` files in the project repo. Any agent that reads files works — no MCP, no API key, no vendor lock-in. Notes survive agent restarts, branch switches, and context resets. | HIGH | The localhost host is the bridge (MV3 cannot write arbitrary paths). This is the primary architectural differentiator vs. Vibe Annotations (MCP-only), AgentEcho (paste-to-agent), opencode (OpenCode-coupled). |
| **Ordered serial queue + read/unread distinction** | Files named `NNNN-<timestamp>.md` sort chronologically. The `.read.md` rename is an idempotent "processed" signal. Re-running the AI skill picks up exactly where it left off — no duplicate processing, no guessing. | MEDIUM | No competitor has this. Cluster A tools use task boards. Cluster B tools push once to the agent. Neither supports iterative, resumable review cycles. |
| **React fiber / named component capture** | The note says "TabHeader save button" not just `#root > div > button:nth-child(3)`. This dramatically reduces AI guessing on React apps. | MEDIUM | Detect `__reactFiber$*` / `_reactInternals` on the DOM node, walk up to nearest named component. No competitor captures this. |
| **Curated computed styles in the note** | AI agent sees `fontSize: 14px`, `padding: 8px 12px`, `display: inline-flex` — not just a selector. Lets the agent fix visual bugs without running the app. | MEDIUM | Capture ~20 curated props via `getComputedStyle`. Marker.io does not expose computed styles. None of Cluster B does. |
| **outerHTML snapshot (truncated)** | AI agent sees the actual DOM subtree — attributes, children, content — not just the tag name. Catches dynamic class names, data attributes, aria states. | LOW | 2000-char truncation. opencode-chrome-annotation omits this. |
| **Multi-project routing by tab origin, zero picks** | One extension routes to multiple localhost hosts by tab URL origin. Notes from the `:5173` tab land in `proj-a/notes/`; notes from `:3000` land in `proj-b/notes/` — automatically, with no per-note selection. | HIGH | Critical for developers juggling multiple projects in parallel (the primary user's actual workflow). No competitor supports this. |
| **Auto element-highlight screenshot on Send** | The sent image shows which element was annotated, in context, with the picker highlight box drawn on it. The AI agent sees both the selector AND a visual confirmation of what was selected. | HIGH | Requires: capture after picker overlay is drawn, hide own UI, crop DPR-correct. Harder than it looks. |
| **Manual region capture (camera tool) with DPR-correct crop** | Developer can capture any region of the page — not just the selected element. Multiple captures stack as thumbnails. Extension crops before POSTing (host stays near-zero-dep). | HIGH | Uses `interact.js` for drag-rectangle. DPR multiply before canvas crop or HiDPI captures misalign. Not present in any comparable tool. |
| **`review-notes` AI skill shipped in the repo** | The fix loop is closed by a portable skill that reads unread notes in serial order, fixes, and marks each `.read.md`. Reduces the AI session prompt to "read my notes". | MEDIUM | Works for any agent that can read files (Claude Code, Cursor, Windsurf, etc.). No comparable tool ships a ready-made skill. |
| **Local-only, zero-account, no telemetry** | Data never leaves the machine. No vendor dependency. No account creation. No subscription risk. Survives internet outages. | LOW | Architecture constraint, not a feature to build — but a strong trust signal for the target user (developer reviewing sensitive internal apps). |
| **Polished sticky-note aesthetic (genuine paper look)** | Developer tools usually look like developer tools. A visual review tool used for visual tasks benefits from a design-conscious UI — builds trust that the tool takes visual quality seriously. | MEDIUM | Shadow DOM isolation prevents CSS collision with host page. `interact.js` for smooth drag. Mode color-coding (free vs. element). |
| **dataset + aria + nearestTestId capture** | AI agent can reference `data-testid="bot-selector"` in its fix — matching the codebase's own test identifiers, not a computed selector. | LOW | Low implementation cost, high AI-usefulness. No competitor captures this combination. |
| **Same-origin collision resolution via `<meta>` self-id** | When two projects run on the same port at different times, the page can self-declare its project via `<meta name="stickyfix-project">`. | LOW | Rare case, but without it the extension has no way to disambiguate. Documented as optional for consuming projects. |

### Anti-Features (Deliberately NOT building in v1)

These are features that appear in competitor tools or are commonly requested, but are explicitly out of scope for stickyfix v1 — either by PRD non-goal or by deliberate design decision.

| Feature | Why Requested | Why NOT building it | Alternative |
|---------|---------------|---------------------|-------------|
| **Cloud sync / multi-user / accounts** | Enables team collaboration, sharing notes across machines | Violates G6 (local-only, private, zero-account). Adds backend, auth, hosting cost, vendor dependency. The primary user is a solo developer + AI agent pair. | File-based contract works with git — commit `notes/` to share with teammates. |
| **PM tool integration (Jira, Linear, Asana)** | Cluster A tools all offer this; expected in "feedback tool" category | Wrong output format for stickyfix's user. The AI agent is the consumer, not a human task manager. Adding Jira integration means maintaining OAuth, webhook listeners, field mapping. Scope explosion. | Notes are `.md` files; trivially scriptable to POST to any tool if needed. |
| **Session replay / video recording** | BugHerd and Userback offer video; helps reproduce interaction bugs | High implementation complexity (MediaRecorder API, large file sizes, no disk-write path in MV3). Overkill for the target workflow: developer annotating their own app, not capturing user sessions. | Screenshot + element context + comment is sufficient for developer-to-agent communication. |
| **Full-page (scrolling) screenshot** | Reviewers want to capture below-the-fold content | PRD NG3. Visible viewport is enough for v1. Full-page capture requires scroll + stitch — complex, fragile across layouts, breaks sticky headers. | Manual region capture (`📷` camera tool) can be used for below-fold content by scrolling first. |
| **Console log / network request capture** | Marker.io captures this for bug reproduction | Wrong audience. stickyfix targets UI visual review, not runtime error reporting. Console log capture requires injecting a global `console` override — fragile, increases footprint. | Developer has DevTools open. AI agent reads source code, not runtime logs. |
| **Central notes store with project prefixing** | Single folder for all projects seems simpler at first | Rejected in PRD §15. Orphans notes from their repo. The AI skill must know which project's files to read. Multi-project routing requires separate `notes/` dirs. | Host-per-project; each host owns its own `notes/` dir in the project root. |
| **Firefox / Safari port** | Broader reach | PRD NG4. MV3 APIs differ across browsers; testing matrix doubles. WXT supports multi-browser but adds build complexity and testing burden. Chrome/Chromium covers the primary user's dev workflow. | Keep code port-friendly (no Chrome-isms in business logic); implement later if validated. |
| **shadow-DOM deep traversal** | Some React apps render into shadow roots | PRD NG5. Correct selector generation inside a shadow root requires recursive `shadowRoot.querySelector` chains that `@medv/finder` doesn't natively support. Best-effort capture; note the limitation in the file. | Note the limitation in element context. Most React apps don't use shadow DOM for app content. |
| **Real-time collaboration / multi-cursor** | Vercel Comments supports threaded team review | Requires backend, WebSocket, auth. Out of scope for local-only tool. stickyfix is single-developer → AI agent. | Multiple developers can work from the same `notes/` dir via git (async, not real-time). |
| **Keyboard shortcut to activate tools** | Power users want shortcuts | Not table stakes for v1; adds keybinding conflict risk with host pages. | Click-based UI is sufficient; shortcuts can be added in v1.x once core is stable. |
| **AI summary / auto-title generation** | Marker.io has AI-powered title rewriting | Requires external API call; introduces latency, cost, privacy concern (note content leaves machine). Violates local-only principle. | The note + element context is already structured; the AI agent reading the file generates its own understanding. |
| **Annotation on static images / PDFs** | BugHerd supports Figma + PDF feedback | Different use case (design review, not live DOM review). No DOM, no selectors, no element context. | Out of scope; different product category. |

---

## Feature Dependencies

```
[Review Mode Toggle]
    └──requires──> [Host Discovery (port scan 39240-39260)]
                       └──requires──> [Token Auth + chrome.storage.local persistence]

[Free Note]
    └──requires──> [Review Mode Toggle]
    └──requires──> [Draggable Post-it Card]
    └──requires──> [Host Client (POST /annotation)]

[Element Note]
    └──requires──> [Review Mode Toggle]
    └──requires──> [Element Picker (hover highlight + click)]
                       └──requires──> [@medv/finder for selector generation]
    └──requires──> [Element context capture (styles, outerHTML, fiber, aria)]
    └──requires──> [Auto element-highlight screenshot]
                       └──requires──> [Screenshot capture + DPR-correct crop]
                       └──requires──> [Hide-own-UI before capture + restore]

[Camera Tool (region capture)]
    └──requires──> [Free Note OR Element Note (post-it card must be open)]
    └──requires──> [interact.js drag-rectangle]
    └──requires──> [Screenshot capture + DPR-correct crop]
    └──requires──> [Hide-own-UI before capture + restore]

[Multi-project Routing]
    └──requires──> [Host Discovery]
    └──requires──> [chrome.storage.local (origin→host map)]
    └──requires──> [/status endpoint advertising origins]

[review-notes AI Skill]
    └──requires──> [File naming (serial + .read.md rename marker)]
    └──requires──> [Note file format (§9.2 frontmatter + element context)]

[Screenshot capture + DPR-correct crop]
    └──requires──> [chrome.tabs.captureVisibleTab]
    └──enhances──> [Element Note (auto highlight +1)]
    └──enhances──> [Camera Tool (manual region +N)]

[Auto element-highlight screenshot] ──conflicts──> [Camera Tool during capture]
    (both require hide-UI + captureVisibleTab; must be serialized, not concurrent)
```

### Dependency Notes

- **Element Note requires Element Picker:** The picker is the UX that produces the element context object. Cannot have element notes without it.
- **All notes require Host Client:** The POST /annotation to the resolved host is how notes reach disk. Without a reachable host, no note can be saved — the error toast is the only output.
- **Screenshot capture requires Hide-own-UI:** stickyfix's own overlay (chip, post-it, picker highlight) must be hidden before `captureVisibleTab` or the screenshot shows the tool's UI, not the page. This is a cross-cutting concern affecting both auto-highlight and camera tool.
- **Camera Tool conflicts with concurrent element picker highlight:** Cannot have both active during a capture pass. The capture sequence is: hide UI → capture → crop → restore UI. Must be a single mutex-guarded operation.
- **Multi-project routing requires chrome.storage.local persistence:** The origin→host map must survive MV3 service worker recycling. In-memory maps are lost on worker death (happens after ~30s idle).
- **review-notes skill requires correct file naming:** The skill's glob (`notes/*.md` excluding `*.read.md`) and sort-by-serial logic depend entirely on the `NNNN-<timestamp>` naming convention. Any deviation breaks the skill.

---

## MVP Definition

### Launch With (v1 = M1–M8 per PRD §12)

All of the following are required for the core value proposition ("a note dropped on a page reliably becomes a precise, context-rich `.md` file on disk"):

- [x] Review Mode toggle with host discovery and connection chip — without this, nothing else is accessible
- [x] Free note mode (draggable `+` FAB → post-it → Send → `.md` on disk) — minimum annotation capability
- [x] Element note mode with picker, `@medv/finder` selector, and rich context capture — the primary differentiator
- [x] Auto element-highlight screenshot on element Send — the visual anchor for the AI agent
- [x] Token auth + no silent failures (toast on every error) — reliability is the core promise; a silently dropped note is a regression
- [x] Serial file naming + `.read.md` marker — enables the AI skill; without it, the note queue is unprocessable
- [x] Multi-project routing by tab origin (chrome.storage.local persistence, re-bind by name+origin) — the primary user runs multiple projects concurrently
- [x] Camera tool (region capture, DPR-correct crop, deletable thumbnails) — manual screenshot is table stakes; the auto highlight alone is insufficient for free notes
- [x] `review-notes` AI skill (SKILL.md + README) — closes the loop; without it the user must write their own glob+rename logic every time
- [x] Polished sticky-note UI (shadow DOM isolation, smooth drag, mode color-coding) — visual tool for visual work; ugly UI undermines trust

### Add After Validation (v1.x)

- [ ] Keyboard shortcuts for Review Mode toggle and tool switching — add when power-user demand is confirmed
- [ ] Lightbox preview of thumbnail captures in post-it — nice UX, low priority; thumbnails are already visible
- [ ] `<meta name="stickyfix-project">` page self-identification — add when same-origin collision is reported by users
- [ ] `npm publish` for `stickyfix-host` — add when install friction is confirmed as a barrier

### Future Consideration (v2+)

- [ ] Firefox port — validate Chrome user base first
- [ ] Shadow DOM deep traversal for selectors — significant complexity; validate need from real-world reports
- [ ] CLI flag to configure computed-styles capture list per project — add if per-project customization is requested
- [ ] Watch mode for `review-notes` skill (auto-process on file creation) — explore after validating the manual invocation loop

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Free note → file on disk | HIGH | MEDIUM | P1 |
| Element picker + rich context capture | HIGH | HIGH | P1 |
| Auto element-highlight screenshot | HIGH | HIGH | P1 |
| Serial naming + `.read.md` queue | HIGH | LOW | P1 |
| Token auth + error toasts (no silent failures) | HIGH | LOW | P1 |
| Multi-project routing by tab origin | HIGH | HIGH | P1 |
| `review-notes` AI skill | HIGH | MEDIUM | P1 |
| Camera tool (region capture) | MEDIUM | HIGH | P1 (PRD M6) |
| Polished sticky-note UI | MEDIUM | MEDIUM | P1 (G8 goal) |
| chrome.storage.local persistence | HIGH | MEDIUM | P1 (MV3 correctness) |
| React fiber / named component capture | HIGH | MEDIUM | P1 (primary differentiator) |
| Computed styles capture (curated) | HIGH | LOW | P1 (differentiator) |
| outerHTML + dataset + aria capture | MEDIUM | LOW | P1 (low cost, high AI value) |
| DPR-correct crop (HiDPI) | MEDIUM | LOW | P1 (correctness, not a feature) |
| Keyboard shortcuts | LOW | LOW | P3 |
| Thumbnail lightbox preview | LOW | LOW | P3 |
| Firefox port | LOW | HIGH | P3 |
| Shadow DOM deep traversal | MEDIUM | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Marker.io | BugHerd | Vercel Comments | Vibe Annotations | opencode upstream | **stickyfix** |
|---------|-----------|---------|-----------------|-----------------|-------------------|----------------|
| Click-to-annotate element | Yes | Yes | Yes (click page, not element) | Yes | Yes | Yes |
| Element hover highlight | Unclear | Yes | No | Yes | Yes | Yes |
| CSS selector capture | Light | Yes (CSS selector) | No | Yes | Heuristic (fragile) | Yes (`@medv/finder`) |
| React component name | No | No | No | No | No | Yes (fiber walk) |
| Computed styles | No | No | No | No | No | Yes (curated ~20 props) |
| outerHTML | No | No | No | No | No | Yes (truncated 2000c) |
| data-* attributes | No | No | No | No | No | Yes (full dataset) |
| aria / role capture | No | Partial | No | No | Partial | Yes |
| Screenshot | Auto, high-fidelity | Auto | No | Optional | Auto (viewport) | Auto + region crop |
| Region capture (camera) | No | No | No | No | No | Yes (drag + DPR crop) |
| File-on-disk output | No (cloud) | No (cloud) | No (cloud) | No (MCP push) | No (agent push) | Yes (ordered .md) |
| Serial queue + read marker | No | No | No | No | No | Yes |
| Multi-project routing | No | No | Preview URL scoped | No | No | Yes (by tab origin) |
| AI skill (review-notes) | No | No | No | Partial (MCP) | No | Yes (shipped) |
| Local-only / zero-account | No | No | No | Yes | Yes | Yes |
| Console log capture | Yes (paid) | No | No | No | No | No (out of scope) |
| Session replay | Yes (paid) | Yes | No | No | No | No (out of scope) |
| PM tool integration | Yes | Yes | Slack | No | No | No (out of scope) |
| Multi-user collaboration | Yes | Yes | Yes | No | No | No (out of scope) |

---

## Sources

- [BugHerd vs Marker.io comparison — bugherd.com](https://bugherd.com/cp/marker-alternative)
- [Visual feedback tools comparison 2026 — note8.dev](https://note8.dev/blog/visual-feedback-tools-comparison/)
- [Marker.io features — marker.io/features](https://marker.io/features)
- [Vercel Comments overview — vercel.com/docs/comments](https://vercel.com/docs/comments)
- [Netlify Drawer for feedback — docs.netlify.com](https://docs.netlify.com/deploy/review-deploys/netlify-drawer-for-feedback/overview/)
- [Vibe Annotations — vibe-annotations.com](https://www.vibe-annotations.com/)
- [AgentEcho on Product Hunt](https://www.producthunt.com/products/agentecho)
- [opencode-chrome-annotation — github.com/JodusNodus](https://github.com/JodusNodus/opencode-chrome-annotation)
- [Userback screen annotation features — userback.io](https://userback.io/feature/screen-annotation/)
- [BugHerd website annotation tool](https://bugherd.com/website-annotation-tool)
- PRD.md (§3 goals/non-goals, §5 UX walkthrough, §7 extension spec, §9 data contracts, §10 review-notes skill, §15 open decisions)
- .planning/PROJECT.md (requirements, out-of-scope, key decisions)

---
*Feature research for: Chrome MV3 annotation extension + localhost host, developer-facing, AI-agent-oriented*
*Researched: 2026-05-31*
