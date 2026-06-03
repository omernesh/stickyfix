# review-notes

Process unread stickyfix review notes in serial order — read each note, apply the
requested code fix, then rename the note file to `*.read.md`. This replaces the
screenshot-paste-describe ping-pong of UI review with a durable, file-based,
iterative loop: a developer drops notes on a live page, saves them to disk via the
stickyfix host, then tells you to "read my notes" — and you fix the code and mark
each note done, idempotently, without any manual copy-paste.

## When to use

- The user says "read my notes", "process review notes", "fix sticky notes", "run
  review-notes", or "what notes do I have"
- There is a `notes/` directory in the project (or an explicit path was given) that
  may contain unread `.md` note files written by the stickyfix extension

## When NOT to use

- The user wants to view notes without acting on them (read-only inspection)
- The user has not set up the stickyfix host and extension (no `notes/` directory)
- You are operating outside the project repository where notes live

## Preconditions

- Notes directory: `./notes` relative to the project root, unless the user supplies an
  explicit path argument (e.g. "read my notes in /path/to/project/notes")
- You must be able to read, write, and rename files inside that directory
- The `yaml` library (`yaml@2.9.0`) is available in the project if you need to
  programmatically parse or reserialize frontmatter; alternatively, parse the YAML
  block manually as described in the steps below

## Steps

1. **Discover unread notes**

   List all files in the notes directory. Keep only filenames that end in `.md` AND
   do NOT end in `.read.md` — both patterns end with `.md`, so the exclusion must be
   explicit. In pseudocode:

   ```
   unread = files.filter(f => f.endsWith('.md') && !f.endsWith('.read.md'))
   unread.sort()   // ascending lexicographic
   ```

   The filename format is `<serial>-<YYYYMMDD-HHmmss>.md` where `<serial>` is a
   4-digit zero-padded integer (e.g. `0001`, `0042`). Because every serial is
   zero-padded to exactly 4 digits, ascending lexicographic sort equals serial order
   — process notes from lowest serial to highest.

   If there are no unread notes, report "no unread notes" and stop. Do not process
   `*.read.md` files — they are already done.

2. **Process each note in serial order**

   For each unread note filename (lowest serial first):

   a. **Read the file and parse frontmatter**

      The file begins with a YAML frontmatter block delimited by `---` lines:

      ```
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
      selector: "#submit-btn"         # element mode only
      react_component: "SubmitButton" # element mode, optional
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

      Free-mode notes omit `selector`, `react_component`, and `rect`, and instead
      include `note_position: {x, y}`. Parse the frontmatter by extracting the text
      between the first `---` pair and passing it to a YAML parser.

      Derive the note's serial from `filename.slice(0, 4)` — NEVER from the `id`
      frontmatter field. The `id` field is stored as an integer and loses its leading
      zeros (the integer `1` is not the string `"0001"`). The filename prefix always
      carries the authoritative zero-padded serial.

      The text after the closing `---\n` is the note body. The first non-blank line
      of the body is the developer's instruction — the comment they typed into the
      stickyfix note UI. Read it as the actionable request.

   b. **Read element context (element mode only)**

      If `mode` is `element`, the body contains a `## Element context` section
      immediately after the developer comment. Use this section to locate the
      relevant code. It looks like:

      ```markdown
      ## Element context

      - **Selector:** `#submit-btn`
      - **React component:** `SubmitButton`
      - **Tag / role:** `button` / `button`
      - **Text:** Submit
      - **Rect:** x=100 y=200 w=80 h=30

      ### Computed styles (curated)
      | prop | value |
      |------|-------|
      | display | inline-flex |
      | color | rgb(255,255,255) |

      ### outerHTML (truncated)
      ```html
      <button id="submit-btn" class="btn-primary">Submit</button>
      ```
      ```

      The selector, React component name, tag, text, computed styles, and outerHTML
      together give you enough context to locate the exact element in the codebase
      without guessing. Use `grep`, a file search, or your knowledge of the project
      structure to find the relevant source file(s).

   c. **Open screenshots (if available and present on disk)**

      The frontmatter `screenshots` field is an array of filenames. These filenames
      are relative to the **notes directory**, not the project root. Resolve each
      screenshot path by joining it with the notes directory path:

      ```
      screenshotAbsPath = join(notesDir, screenshotFilename)
      ```

      If `screenshots` is non-empty AND the referenced PNG files exist on disk, open
      them with vision when the text description or element context alone is
      insufficient to understand the issue.

      If a referenced screenshot file does not exist on disk, emit exactly one line:

      ```
      WARN: <filename> not found — proceeding text-only
      ```

      Then continue processing the note as a text-only note. A missing screenshot is
      NOT ambiguous — the developer instruction and element context remain actionable.
      Do not flag the note or skip it because of a missing screenshot.

   d. **Apply the fix**

      Using all available context — the developer instruction, element context
      (selector, computed styles, outerHTML), and any screenshots — apply the
      requested fix to the relevant source file(s) in the project.

      If the instruction is genuinely ambiguous even after reading the element
      context and any screenshots — for example, "make this better" with no
      actionable target and no element context — do NOT attempt a fix. Instead:

      - Update the frontmatter: set `status` from `unread` to `flagged`
      - Append a blockquote line to the end of the note body:
        ```
        > flagged: <brief reason why the instruction is ambiguous>
        ```
      - Leave the filename unchanged (do NOT rename to `.read.md`)
      - Skip to the next note

      For all other cases (clear instruction, missing-screenshot text-only, element
      mode with context), proceed with the fix and continue to step (e).

   e. **Mark the note as read (rename + update status) — ONLY after a successful fix**

      Rename and status-update are the LAST actions, performed only after the fix has
      been successfully applied. This ordering is the core reliability guarantee: if
      the fix fails or is interrupted, the note stays unread and will be retried on
      the next run.

      **Update the frontmatter status key:** Parse the YAML block, set
      `status: read`, and reserialize. The pattern:

      ```
      rawFm = content between the first --- pair
      fm = yaml.parse(rawFm)
      fm['status'] = 'read'
      newFmBlock = '---\n' + yaml.stringify(fm) + '---\n'
      newContent = newFmBlock + bodyAfterFrontmatter
      writeFile(mdPath, newContent)
      ```

      The project's `yaml` library (`yaml@2.9.0`, import `{ parse, stringify } from
      'yaml'`) handles colons and quotes in URL values correctly — do not hand-roll
      YAML serialization.

      **Rename the file:** After writing the updated content, rename the file:

      ```
      readPath = mdPath.replace(/\.md$/, '.read.md')
      rename(mdPath, readPath)
      ```

      This two-step approach (status:read + rename to *.read.md) is belt-and-suspenders:
      the rename is the primary skip signal on the next run (excluded by the glob in
      Step 1); the `status: read` frontmatter field lets other tools (like
      `listAnnotations` in the host) still list the note while knowing it is done.

3. **Report a terse summary**

   After processing all notes, report:

   ```
   Processed N notes: M fixed and marked read, K flagged (ambiguous), J skipped (already read).
   ```

   If any notes were flagged, list their filenames and the flagged reason so the
   developer knows what to clarify.

## After the pass

On the next run the skill will find no unread notes (the glob in Step 1 excludes
`*.read.md`). This is the idempotency guarantee — re-running on a fully-processed
directory is a no-op that safely reports "no unread notes".

## Forbidden patterns (do not do these)

- **Glob `*.md` without excluding `*.read.md`** — `.read.md` files end in `.md`; a
  naive glob will reprocess already-read notes
- **Derive serial from the `id` frontmatter field** — the integer `id` loses zero-
  padding; always use `filename.slice(0, 4)`
- **Rename before fix** — renaming first creates a silent data-loss window if the
  fix fails; rename is always the last action
- **Treat a missing screenshot as ambiguous** — warn once and proceed text-only;
  only an unclear developer instruction triggers the flagged path
- **Make network or host calls** — this skill is disk-only; do not call the stickyfix
  host HTTP API, do not POST to any endpoint
