# 0003 — Review, Apply, and Recheck Are Separate User Actions

**Status:** Accepted

**Decision:** `Run AI Audit` (Review), `Preview Diff & Save New Version` (Apply), and `Recheck` are three distinct user clicks and are never auto-chained. Applying accepted suggestions previews a line-level diff and creates a new immutable document version (`v2`, `v3`, ...).

**Why:** Keeps educators in full authorship control, prevents silent overwrites, and ensures predictable, intentional LLM usage on every step.
