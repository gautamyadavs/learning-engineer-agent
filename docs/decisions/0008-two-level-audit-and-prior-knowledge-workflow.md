# 0008 — Two-level learner audit, Missing-LO gate, and Prior Knowledge gap workflows
**Status:** Accepted · 2026-11-21

## Context
1. **No evaluation without Learning Objectives:** Neither alignment (`A1–A5`), assessment elicitation (`S1–S5`, `IWF`, `OE`), nor practice fit (`P1–P4`) can be evaluated defensibly without knowing the intended Learning Objectives (LOs). However, blocking users with an error screen or burning Reviewer credits on incomplete inputs creates poor UX.
2. **Visible artifact quality vs. implicit prior knowledge:** Auditing timeframe from LOs alone is unrealistic guesswork, and asking educators to type learner prior knowledge into a blank text box runs into the *expert blindspot* (~70% of implicit prerequisites go unstated). At the same time, prior knowledge readiness is critical across **all four upload tracks** (*Objectives only*, *Assessment/Quiz*, *Lesson/Activity page*, *Full Module*), because quizzes and lessons routinely introduce unstated notation, tool, or conceptual prerequisites.
3. **KLI Knowledge Component (KC) scope alignment:** An LO often implies sub-skills or concepts (`Facts`, `Skills`, `Principles` under KLI) that an educator considers out of scope or already mastered. Surfacing candidate KCs as an unscored confirmation check prevents downstream reviews from nagging authors about out-of-scope sub-skills.

## Proposal

### 1. Four Pilot Tracks & Just-in-Time Missing-LO Gate (`0` LLM Credits)
- Every document selects one of four pilot tracks (`D-1`): `objectives_only`, `assessment_quiz`, `lesson_activity`, or `full_module`.
- When the user clicks **Review**, the app first checks whether LOs exist inline in the Markdown or as a pinned Workspace LO reference:
  - **LOs present:** Review runs immediately with zero extra prompts.
  - **LOs missing:** Review pauses *before* any LLM call (`0` credits spent, `ADR-0002`) and shows a compact inline card offering three one-click paths:
    1. **Pick from Workspace:** Link an existing doc from the workspace's `objectives_only` track as pinned read-only reference context.
    2. **Paste / type inline:** Pin LOs to the document context header or insert a `## Learning Objectives` section via diff preview (`ADR-0003`).
    3. **Draft LOs first:** Hand off to **Facilitator** mode to propose candidate LOs from the draft quiz/lesson for human confirmation (`ADR-0004`).
- On `assessment_quiz` and `lesson_activity` tracks, attached/referenced LOs act as **alignment anchors** (`O1–O7` are scored in `objectives_only` and `full_module`; if a referenced LO is too vague to judge alignment, the affected Alignment check is marked `unverified` and points to the vague LO).

### 2. Two-Level Learner Audit (`94` Visible Points + `6` Prior Knowledge Points Across All 4 Tracks)
- **Level 1 — Visible Artifact Review (`Review` button, `94/100` pts):**
  - Evaluates observable features in the uploaded Markdown using deterministic app-side scoring (`model judges per-unit checks → app calculates /100`) with **100% proportional unit credit** (`points_earned = points_available × units_meeting / units_applicable`) so every verified fix moves the headline score linearly without frozen-score cliffs on 30-item syllabi or quizzes. Timeframe guessing is excluded.
  - **4-Way Objective Segmentation:** Classifies entries inside Objective blocks into `leaf_lo` (scored on `O1–O6`), `umbrella_header` (container goal evaluated via its child `leaf_lo`s rather than penalized for breadth), `author_kc` (existing author-written KCs imported directly into KLI KC reconciliation + `O7` coherence), and `orientation_note` (non-LO prose routed solely to `C1`).
  - **Dispositional & Dual-Track Nuance:** Intentional dispositional/normative goals pass `O2` and check observable behavioral indicators under `O4`. Intentional UDL `"A or B"` disjunctions (*"implement or trace"*) pass `O3`/`O6` and route track-selection clarity to `O5`.
  - **Unscored KLI Knowledge Component (`KC`) Scope Check (`0` score impact):** Imports any `author_kc` entries and adds AI-proposed `fact` / `skill` / `principle` KCs per LO so the educator can mark each `in_scope`, `prerequisite`, or `out_of_scope` (offering a 1-click LO wording trim whenever an `out_of_scope` KC was implied).
- **Level 2 — Prior Knowledge Audit & Gap Resolution (`Audit Prior Knowledge` button, `PK-1` = `6/100` pts in all 4 tracks):**
  - Separate user-triggered gated LLM call (`action = 'prior_knowledge_audit'`, `ADR-0002`, `ADR-0003`), **capped at the 5–10 highest-risk prerequisites** (`MAX_PRIOR_KNOWLEDGE_ITEMS = 10`).
  - **Connected to KLI KC decisions:** Automatically seeds KCs marked `prerequisite` and suppresses prerequisites unique to KCs marked `out_of_scope` so educators are never asked the same question twice.
  - Educator triages each surfaced item in the UI (`0` LLM calls, `ADR-0004` proposed → confirmed, with a 1-click **Mark remaining as Have** batch helper):
    - `have` (*Most learners reasonably have this*) → cleared.
    - `not_needed` (*False assumption / out of scope*) → cleared.
    - `some_lack` (*Mixed cohort — some learners lack this*; alias `missing`) → opens a **Gap** (recommends Path A/B optional refresher).
    - `most_lack` (*Most learners lack this*) → opens a **Gap** (recommends Path C *Promote to Module LO* or required inline bridge).
  - **Scoring rule for `PK-1` (`6 pts`):**
    - Before `Audit Prior Knowledge` is run or while any item remains `unreviewed` or has an unresolved gap, `PK-1` earns `0/6` pts (displaying `k of N prerequisites cleared`).
    - If `0` gaps remain after triage, `PK-1` immediately earns `+6/6` pts with no additional LLM call; otherwise `+6/6` pts unlock once every flagged gap resolves via Path A, B, or C.

### 3. Three Prior Knowledge Gap-Resolution Workflows (Flexible Placement)
For any prerequisite marked `missing` (e.g., `2 of 10` items):
- **Path A — AI-Drafted Remediation Content (`action = 'remediation_draft'`):**
  - Generates a concise prerequisite refresher (explanation + mini-example + quick self-check).
  - Educator chooses placement in the Apply preview (`ADR-0003`): **(i) insert a `## Prerequisite Refresher` section** in the current doc (creating a new doc version), or **(ii) save/link a companion Prerequisite Bridge doc** in the workspace so standalone LO or Quiz files stay clean.
  - Explicit **Recheck** verifies that the saved remediation covers the flagged prerequisite gap.
- **Path B — Author-Written Remediation Content or Plan + AI Review:**
  - Educator writes/attaches their own remediation section (inline or in a linked Workspace doc) or records their concrete bridge plan and clicks **Recheck** (`ADR-0003`).
  - Reviewer checks whether the supplied material/plan addresses the gap (`meets` → verified resolved; `revise` → specific feedback on what prerequisite step is still unaddressed).
- **Path C — Promote Missing Prerequisite to a Module Learning Objective:**
  - When a prerequisite is missing across most learners, educator clicks **Promote to Module LO**.
  - Proposes a student-centered, Bloom-verb foundational LO (`O1–O6` compliant) positioned *before* dependent LOs (`C4`) via **Diff Preview → Confirm Apply → New Doc Version** (updating inline LOs or proposing a new version on the linked Workspace LO doc).
  - Resolves the prior-knowledge assumption gap immediately and starts a new LO inventory baseline so downstream Alignment, Practice, and Assessment reviews treat it as an explicit target LO.

## Consequences
- Preserves all five Accepted invariants (`ADR-0001`–`ADR-0005`): Google Docs remains import/export only, every LLM action passes the credit gate, Review / Prior-Knowledge Audit / Remediation Draft / Apply / Recheck are explicit separate clicks, Apply always previews a diff and creates a new version, and AI inferences (`KC` chips, `PK` candidates) remain `proposed` until human triage confirms them.
- Adds `prior_knowledge_audit` and `remediation_draft` to `llm_calls.action`.
- Canonical machine-readable Track 1 + cross-track `PK-1` specification lives in `docs/rubric/rubric-v0.2.json` (Tracks 2–4 item weights remain marked `provisional` pending owner walk-through).
