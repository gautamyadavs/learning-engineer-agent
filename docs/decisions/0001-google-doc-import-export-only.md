# 0001 — Document Import / Export Only (`.docx`, `.md`, `.txt` & Rich Paste)

**Status:** Accepted

**Decision:** Users import `.docx`, `.md`, or `.txt` files (or paste rich formatting from Google Docs / Word) into the Annotation Studio and export updated Markdown drafts. There is no live two-way Google Docs OAuth sync.

**Why:** Eliminates OAuth token scope overhead, conflict resolution fragility, and external vendor lock-in while preserving clean document version history inside the studio.
