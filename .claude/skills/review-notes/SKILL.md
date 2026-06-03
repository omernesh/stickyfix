---
name: review-notes
description: |
  Process unread stickyfix review notes in the notes/ directory. Use when the
  user says "read my notes", "process review notes", "fix sticky notes", "run
  review-notes", or "what notes do I have". Reads each unread *.md note in
  serial order, applies the requested code fix, then renames it *.read.md.
  Idempotent — re-running on an already-processed directory reports "no unread
  notes".
---

Read and follow the instructions in `skill/SKILL.md` in this repository.
The notes directory defaults to `./notes` relative to the project root.
