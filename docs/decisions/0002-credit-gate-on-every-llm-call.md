# 0002 — Password-Protected Pilot Access & Provider-Agnostic Server-Side LLM Gate

**Status:** Accepted · Updated 2026-11-27

**Decision:**
1. **PBKDF2 Pilot Access Gate:** Access to the public GitHub Pages Annotation Studio requires a pilot passcode verified via `120,000`-iteration `PBKDF2-HMAC-SHA256` (`web/auth-gate.js`). Plaintext passcodes are never committed to source control (`npm run set-passcode` writes only cryptographic `salt` + `hash`).
2. **Server-Side Key & Passcode Enforcement:** Raw LLM API keys (`GEMINI_API_KEY` during pilot testing, or `LLM_API_KEY` for any OpenAI-compatible provider) live exclusively inside encrypted Cloudflare Worker secrets (`proxy/cloudflare-worker.js`). Every proxy request verifies CORS origin, `X-LE-Access-Code` (`SHARED_ACCESS_CODE`), per-IP + daily global rate limits, and bounded LE Agent JSON schemas.
3. **LLM Independence:** Scoring math (`src/lib/le-scoring/scorer.ts`) and the canonical rubric (`docs/rubric/rubric-v0.3.json`) are 100% model-independent; `proxy/cloudflare-worker.js` supports both Google Gemini (`LLM_PROVIDER="gemini"`, pilot default) and any OpenAI-compatible endpoint (`LLM_PROVIDER="openai_compatible"`).

**Why:** Prevents unauthorized public access, guarantees zero API key leakage, and avoids single-vendor LLM lock-in. See [`docs/llm-pilot-setup-guide.md`](../llm-pilot-setup-guide.md).
