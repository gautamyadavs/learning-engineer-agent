# Step-by-Step Guide: Pilot Passcode & Linking Your Gemini API Key (Provider-Agnostic Gateway)

The **Learning Engineer (LE) Agent** rubric (`docs/rubric/rubric-v0.3.json`) and deterministic scoring engine (`src/lib/le-scoring/scorer.ts`) are **100% LLM-independent**. For pilot testing, **Google Gemini (`gemini-2.5-flash`)** is pre-configured out of the box, while `proxy/cloudflare-worker.js` and `web/ai-service.js` also support any OpenAI-compatible provider (`LLM_PROVIDER = "openai_compatible"`).

Because GitHub Pages serves static files publicly, **never paste an API key or plaintext password into `web/config.js` or HTML**. Follow either **Path 1** (30-second solo test right now) or **Path 2** (5-minute shared pilot setup for invited testers).

---

## Step 1 — Create & Restrict Your Google Gemini API Key (2 Minutes)

1. Open [Google AI Studio — API Keys](https://aistudio.google.com/apikey) while signed in to your Google account.
2. Click **Create API key**, select (or create) a dedicated project (e.g., `LE-Agent-Pilot`), and copy the `AIza...` key to your clipboard.
3. *(Recommended Hardening in Google Cloud Console)*:
   - Open **APIs & Services → Credentials**, click your key, and under **API restrictions** select **Restrict key → Generative Language API** (`generativelanguage.googleapis.com`).
   - Under **Billing → Budgets & alerts**, set a monthly cap/alert (for example, \$5–\$10; `gemini-2.5-flash` costs fractions of a cent per audit).

---

## Path 1 — Instant Solo Pilot Test in Your Browser (30 Seconds, Zero CLI)

Use this path when **you** are testing documents on your own computer right now before inviting external pilot testers:

1. Open [https://gautamyadavs.github.io/learning-engineer-agent/](https://gautamyadavs.github.io/learning-engineer-agent/) and unlock the **Pilot Access Gate** with your Pilot Passcode.
2. In the top-right bar, click **`Offline Rubric · Link Gemini API`**.
3. Scroll to **Option B (Instant Solo Pilot Test)**:
   - Keep **LLM Provider** set to `Google Gemini API (Pilot Default · gemini-2.5-flash)`.
   - Paste your `AIza...` key into **Ephemeral RAM-Only API Key**.
   - Click **Save Connection** (top bar turns green: `Gemini Pilot Live (RAM-Only Key)`).
4. Upload any `.docx`, `.md`, or `.txt` file (or pick a sample) and click **`Run AI Audit`**.
   - Your key lives strictly inside a private JavaScript closure variable in tab RAM—it is **never** written to `localStorage`, `sessionStorage`, or cookies, and is wiped the instant you click **`Lock`**, refresh, or close the tab.

---

## Path 2 — Shared Pilot Deployment for Invited Testers (5 Minutes, Zero Key Exposure)

Use this path when sharing the link with pilot testers so **they only enter the Pilot Passcode once** and your `GEMINI_API_KEY` stays 100% hidden on Cloudflare's free edge servers (`100,000` free requests/day):

### 2A. Deploy Your Encrypted Proxy Worker

Run these commands once on your laptop (requires Node.js `>= 20` and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account):

```bash
git clone https://github.com/gautamyadavs/learning-engineer-agent.git
cd learning-engineer-agent/proxy

# 1. Sign in to Cloudflare in your browser
npx wrangler login

# 2. Store your Gemini API key in Cloudflare's encrypted secret vault (never in files!)
npx wrangler secret put GEMINI_API_KEY
# -> Paste your AIza... Gemini key when prompted

# 3. Store the EXACT SAME Pilot Access Passcode so only unlocked pilot users can call the Worker
npx wrangler secret put SHARED_ACCESS_CODE
# -> Type/paste your Pilot Access Passcode when prompted

# 4. Deploy live
npx wrangler deploy
```

Wrangler will print your live Worker URL, for example:
`https://le-agent-llm-proxy.<your-subdomain>.workers.dev`

### 2B. Link the Worker URL into `web/config.js`

Open `web/config.js` in the repository root and paste that Worker URL (the URL itself is safe to commit because it requires both `Origin: https://gautamyadavs.github.io` AND your secret `X-LE-Access-Code` header):

```js
DEFAULT_PROXY_URL: 'https://le-agent-llm-proxy.<your-subdomain>.workers.dev',
```

Commit and push:

```bash
cd ..
git add web/config.js
git commit -m "chore: connect pilot LLM proxy endpoint"
git push origin main
```

Now every invited pilot tester who unlocks `https://gautamyadavs.github.io/learning-engineer-agent/` with your Pilot Passcode is **automatically connected** to live Gemini `2.5-flash` (`X-LE-Access-Code` is forwarded automatically from tab memory!).

---

## Rotating Your Pilot Access Passcode Anytime

Plaintext passcodes are never stored in the repository—`web/config.js` stores only a random 16-byte salt and `120,000`-iteration `PBKDF2-HMAC-SHA256` hash. To change your pilot passcode at any time:

```bash
npm run set-passcode -- "YourNewPilotPasscodeHere"
cd proxy && npx wrangler secret put SHARED_ACCESS_CODE && cd ..
git add web/config.js && git commit -m "chore: rotate pilot passcode hash" && git push origin main
```

---

## Switching LLM Providers Later (Zero Vendor Lock-In)

If you later benchmark or switch from Google Gemini to OpenAI, OpenRouter, Azure OpenAI, or a self-hosted vLLM endpoint, edit `proxy/wrangler.toml`:

```toml
LLM_PROVIDER = "openai_compatible"
LLM_MODEL = "gpt-4.1-mini"
LLM_BASE_URL = "https://api.openai.com/v1"
```

Then run `npx wrangler secret put LLM_API_KEY && npx wrangler deploy` inside `proxy/`. No rubric, scoring, or UI code needs to change.

---

## Emergency Pause Switch

To temporarily pause all live LLM calls during pilot maintenance without deleting secrets, set `PAUSE_AUDITS = "true"` in `proxy/wrangler.toml` and run `npx wrangler deploy`.
