# Learning Engineer (LE) Agent — Protected Pilot Studio & Rubric `v0.3.2`

**Live Protected Pilot Studio:** [https://gautamyadavs.github.io/learning-engineer-agent/](https://gautamyadavs.github.io/learning-engineer-agent/)

Password-protected, WCAG 2.2 AA accessible learning-engineering annotation studio, canonical 100-point rubric specification (`v0.3.2`), model-independent deterministic scoring engine, KLI Knowledge Component (`KC`) scope reconciliation, and two-level Prior Knowledge Audit (`PK-1`).

## Supported Evaluation Tracks (`v0.3.2`)

| Track | ID | Budget (`/100`) | Status |
| --- | --- | --- | --- |
| **Track 1** | `objectives_only` | `Objectives 74` + `Clarity 20` + `Prior Knowledge (PK-1) 6` = **`100`** | **Live & Calibrated** |
| **Track 2** | `assessment_quiz` | `Alignment 20` + `Shared 14` + `Item & Scoring 34` + `Learner Feedback 14` + `Clarity 12` + `Prior Knowledge (PK-1) 6` = **`100`** | **Live & Calibrated** (7 question formats) |
| **Track 3** | `lesson_activity` | `Alignment 28` + `Practice & Feedback 42` + `Clarity 24` + `Prior Knowledge (PK-1) 6` = **`100`** | Next up for calibration |
| **Track 4** | `full_module` | `Objectives 14` + `Alignment 18` + `Shared 10` + `Item & Scoring 24` + `Assessment Feedback 8` + `Practice 10` + `Clarity 10` + `Prior Knowledge (PK-1) 6` = **`100`** | Planned after Track 3 |

## Core Architecture & Security Guarantees

1. **Cryptographic Pilot Passcode Gate (`ADR-0002`, [`web/auth-gate.js`](./web/auth-gate.js)):**
   - The Studio UI stays hidden and `inert` behind a `120,000`-iteration `PBKDF2-HMAC-SHA256` passcode gate until unlocked.
   - Plaintext passcodes are never committed to Git; rotate anytime via `npm run set-passcode -- "NewPasscode"`.
   - One-click **`Lock`** button wipes active tab memory immediately.
2. **LLM-Independent Core + Gemini Pilot Default ([`proxy/cloudflare-worker.js`](./proxy/cloudflare-worker.js), [`docs/llm-pilot-setup-guide.md`](./docs/llm-pilot-setup-guide.md)):**
   - Rubric definitions and `/100` scoring (`src/lib/le-scoring/scorer.ts`) are 100% vendor-neutral.
   - **Google Gemini (`gemini-2.5-flash`)** is pre-configured for pilot testing, alongside a built-in OpenAI-compatible adapter (`LLM_PROVIDER = "openai_compatible"`).
   - Server-side proxy enforces CORS allowlisting (`https://gautamyadavs.github.io`), constant-time `SHARED_ACCESS_CODE` verification (`X-LE-Access-Code`), per-IP + daily global rate caps, and a `PAUSE_AUDITS` kill switch.
3. **Explicit Human-in-the-Loop Authoring (`ADR-0003`, `ADR-0008`, `ADR-0009`):**
   - Nothing runs automatically—authors explicitly click **`Run AI Audit`**, customize or accept fixes (`Edit Fix` / `Accept Fix`), inspect line diffs in **`Preview Diff & Save New Version`**, and click **`Recheck`** separately.
   - Zero-credit Missing-LO Pre-Review Gate pauses before spending any LLM calls when an uploaded quiz lacks target Learning Objectives.
   - Track 2 enforces equal `34/N` Item-Quality + `10/N` Learner-Feedback weighting across all 7 question formats and blocks `Ready` (`>= 80`) if `S3` answer keys/rubrics are defective.

## Repository Layout

```text
index.html                        Protected GitHub Pages Annotation Studio
styles.css                        WCAG 2.2 AA editorial design system
web/
  auth-gate.js                    120k-iteration PBKDF2-SHA256 pilot passcode gate
  app.js                          Studio controller, ARIA keyboard/modal manager & diff versioning
  ai-service.js                   Provider-agnostic LLM client (Gemini pilot default) + sanitizer
  heuristic-analyzer.js           Offline client-side rubric parser & quote anchorer
  docx-loader.js                  Zero-dependency browser .docx / .md / Google Docs HTML converter
  scorer.js                       Auto-synced browser build of src/lib/le-scoring/scorer.ts
  rubric-v0.3.json                Auto-synced copy of docs/rubric/rubric-v0.3.json
proxy/
  cloudflare-worker.js            Provider-agnostic edge proxy (Gemini + OpenAI-compatible)
  wrangler.toml                   Proxy CORS, rate limits & model configuration
scripts/
  set-passcode.mjs                CLI tool to rotate PBKDF2 salt & hash in web/config.js
  sync-browser-scorer.mjs         Compiles scorer.ts & copies rubric JSON to web/
src/
  lib/le-scoring/
    scorer.ts                     Canonical TypeScript deterministic scoring & PK engine
    scorer.test.ts                Unit & 3-course calibration test suite
docs/
  llm-pilot-setup-guide.md        Step-by-step Gemini API linking & pilot passcode guide
  rubric/rubric-v0.3.json         Canonical v0.3.0 machine-readable 100-point rubric (94 checks)
  decisions/                      Architecture & Rubric Decision Records (ADRs)
```

## Local Development

Requires Node.js `>= 22` (zero external `npm` runtime dependencies):

```bash
# Run deterministic scorer unit & calibration suite
npm test

# Rotate pilot access passcode (writes PBKDF2 salt + hash only)
npm run set-passcode -- "YourPilotPasscode"

# Serve locally
python3 -m http.server 8123
```
