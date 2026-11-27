# 0004 — Deterministic Scoring & Proposed vs. Confirmed State

**Status:** Accepted

**Decision:** LLMs never invent `/100` numeric scores or human confirmation states. Any AI-inferred Learning Objective, KLI Knowledge Component, or Prior Knowledge prerequisite remains *proposed* until confirmed by the educator, and `src/lib/le-scoring/scorer.ts` computes all scores deterministically from structured check statuses.
