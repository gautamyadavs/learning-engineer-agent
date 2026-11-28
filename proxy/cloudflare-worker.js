/**
 * Learning Engineer (LE) Agent — Provider-Agnostic Server-Side LLM Proxy (Cloudflare Worker)
 * Default Pilot Provider: Google Gemini API (`gemini-2.5-flash`) · Also supports any OpenAI-compatible API
 *
 * Security Guarantees:
 * 1. API keys (`GEMINI_API_KEY` or `LLM_API_KEY`) live ONLY in Cloudflare encrypted Worker secrets.
 *    They are never exposed in client code, Git, headers, or error messages.
 * 2. Constant-time `SHARED_ACCESS_CODE` (`X-LE-Access-Code`) check locks the API to invited pilot testers.
 * 3. Strict CORS & Origin allowlist (`ALLOWED_ORIGINS`) blocks unauthorized origins.
 * 4. Action-locked & schema-locked: rejects open-ended chat hijacking; only runs bounded LE Agent actions
 *    (`review`, `recheck`, `prior_knowledge_audit`, `remediation_draft`, `draft_los`).
 * 5. Sliding-window per-IP rate limiting + daily global call ceiling + instant `PAUSE_AUDITS` kill switch.
 */

const ipWindowMap = new Map();
let globalDayKey = '';
let globalDayCount = 0;

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function constantTimeEqual(aStr, bStr) {
  const enc = new TextEncoder();
  const a = enc.encode(String(aStr || ''));
  const b = enc.encode(String(bStr || ''));
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function parseAllowedOrigins(env) {
  const raw =
    env.ALLOWED_ORIGINS ||
    'https://gautamyadavs.github.io,http://localhost:8080,http://127.0.0.1:8080';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-LE-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function checkRateLimits(ip, env) {
  const maxPerHour = Number(env.MAX_AUDITS_PER_IP_PER_HOUR || 20);
  const maxDailyGlobal = Number(env.MAX_DAILY_GLOBAL_AUDITS || 400);

  const today = getUtcDayKey();
  if (globalDayKey !== today) {
    globalDayKey = today;
    globalDayCount = 0;
  }
  if (globalDayCount >= maxDailyGlobal) {
    return {
      allowed: false,
      reason: 'Daily workspace AI audit quota reached. Resets at 00:00 UTC.',
    };
  }

  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const timestamps = (ipWindowMap.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxPerHour) {
    return {
      allowed: false,
      reason: `Hourly limit (${maxPerHour} AI audits/hr) reached for this connection. Please wait before running another audit.`,
    };
  }

  timestamps.push(now);
  ipWindowMap.set(ip, timestamps);
  globalDayCount += 1;
  return { allowed: true };
}

function buildSystemInstruction(action, track) {
  if (action === 'prior_knowledge_audit') {
    return `You are the Learning Engineer (LE) Agent Prior Knowledge Auditor (v0.3.2).
Identify the 5 to 8 highest-risk unstated prerequisites (Facts, Skills, or Principles in the KLI framework) assumed by the uploaded Learning Objectives or Assessment items.
Do NOT include prerequisites listed in suppressedOutOfScope.
Return strict JSON:
{
  "prior_knowledge_items": [
    {
      "pkId": "pk-1",
      "statement": "Concise prerequisite capability statement",
      "kliType": "fact" | "skill" | "principle",
      "requiredBy": [{ "unit": "LO1 or Q2", "quote": "Exact verbatim substring from the document" }],
      "whyNeeded": "1-sentence explanation of why learners without this will struggle here."
    }
  ]
}`;
  }

  if (action === 'remediation_draft') {
    return `You are the Learning Engineer (LE) Agent Facilitator.
Draft a concise, high-clarity Markdown 'Prerequisite Refresher' bridge addressing the educator's flagged prerequisite gaps.
Include a short intuitive explanation, 1 worked micro-example, and 1 quick self-check question with answer explanation.
Return strict JSON: { "remediationMarkdown": "..." }`;
  }

  if (action === 'draft_los') {
    return `You are the Learning Engineer (LE) Agent Facilitator.
Infer 3 to 5 student-centered, observable Bloom's-verb Learning Objectives that capture the capabilities tested by the uploaded assessment.
Include one shared header ('## Target Learning Objectives\\n\\nBy the end of this module, learners will be able to:') and start every bullet directly with a bold LO ID + capital action verb ('- **LO1:** Classify...'), NOT repeating 'Students will be able to' on each bullet.
Avoid unobservable verbs ('understand', 'know', 'appreciate', 'learn about') and avoid bundling separable 'A and B' tasks.
Return strict JSON: { "candidateLosMarkdown": "## Target Learning Objectives\\n\\nBy the end of this module, learners will be able to:\\n- **LO1:** ...\\n- **LO2:** ..." }`;
  }

  if (track === 'objectives_only') {
    return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 1: Objectives Only).
Evaluate the uploaded Learning Objectives document strictly against:
- O1: Learner-centered framing (shared 'Students/learners will be able to' stem passes; flag instructor/course coverage phrasing)
- O2: Observable Bloom's action verb (flag understand/know/learn about/appreciate/consider/enhance ability; intentional dispositional clinical/ethical norms WITH observable behavioral indicators pass O2 and O4)
- O3: Specific content & single-target granularity (split separable multi-verb 'A, B, and C' compounds; allow coupled 'select and justify' and UDL 'implement or trace'). When splitting a bulleted LO in 'replacement', quote the FULL bullet line including '- **LO X:**' and format every split line as a proper bulleted LO ('- **LO 1.2a:** ...\\n- **LO 1.2b:** ...').
- O4: Identifiable evidence of mastery & worthwhile purpose (no '80% accuracy' ABCD degree required; DO NOT double-deduct O4 on an LO that already fails O1 or O2 unless it tracks pure attendance/click completion)
- O5: Material performance conditions (tools/AI/quant-vs-qual/dual-track explicit when they alter the skill; pass or mark not_applicable when standard)
- O6: Target-faithful expression (ends vs. means; honor UDL 'A or B')
- O7: Set-level coherence on unit 'set-1' (flag duplicate LOs, missing foundational steps, or numbering/hierarchy gaps — quote the specific header/line from the doc when possible)
- C1..C5 on unit 'sec-1':
  - C1: Locatable action, clear IDs, and separation of non-LO orientation/logistics notes (e.g., 'Read Chapter 4 before lab' mixed inside Objectives MUST be excluded from leaf LOs and flagged as 'revise' under C1 quoting that exact sentence!)
  - C2: Unambiguous references & consistent terms
  - C3: Accessible phrasing
  - C4: Followable sequence
  - C5: External constraints (mark 'not_applicable' on pure LO lists).

CRITICAL: Every finding 'quote' MUST be an EXACT verbatim substring copied character-for-character from the document. Every leaf LO in results[] MUST list all passing checks from [O1,O2,O3,O4,O5,O6] in 'met' and any failing/na checks in 'findings'.
Also extract 3-6 KLI Knowledge Components (fact | skill | principle) in kc_candidates (0 score impact).

Return strict JSON:
{
  "summary": "2-sentence constructive synthesis of strengths and highest-leverage fixes.",
  "results": [
    {
      "unit": "lo-1",
      "label": "LO 1",
      "met": ["O1", "O4", "O5", "O6"],
      "findings": [
        {
          "check": "O2",
          "status": "revise",
          "quote": "Exact verbatim substring from document",
          "principle": "O2 · Observable Bloom's action verb",
          "reason": "Clear Principle -> Relevance -> Rationale explanation.",
          "replacement": "Drop-in replacement text preserving bullet formatting"
        }
      ]
    },
    { "unit": "set-1", "label": "Objective Set", "met": ["O7"], "findings": [] },
    { "unit": "sec-1", "label": "Document Clarity", "met": ["C2", "C3", "C4"], "findings": [{ "check": "C5", "status": "not_applicable", "reason": "Pure LO specification." }] }
  ],
  "kc_candidates": [
    {
      "kcId": "kc-1",
      "loUnit": "lo-1",
      "statement": "Concise Knowledge Component",
      "kliType": "skill",
      "origin": "ai_proposed",
      "impliedByLoQuote": "Exact verbatim substring",
      "suggestedTrimmedLoIfOutOfScope": "Optional narrowed LO wording"
    }
  ]
}`;
  }

  return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 2: Assessment / Quiz).
Evaluate the uploaded Assessment against its target Learning Objectives using Rubric v0.3.2:

1. SOLVER-FIRST ANSWER KEY & RUBRIC RULE (S3 — READY GATE BLOCKER):
   - Before trusting any marked key ('*', '[x]', 'Answer:', 'Correct:', or bolded option), INDEPENDENTLY SOLVE every question yourself!
   - If the author's marked key (such as a trailing '*' or '[x]') selects a factually/statistically wrong option (e.g., inverse-probability p-value fallacy) or swapped concept, you MUST flag 'S3' as 'revise' on that question and set 'quote' to the exact wrong marked option line!
   - If an open-ended or constructed question omits its rubric/criteria (e.g., 'Graded by TA' or external sheet), flag 'S3', 'OE-01', and 'OE-03' as 'unverified' quoting that scoring line!

2. Alignment per question ('p-<questionId>' units in results[]):
   - A1 (Content & scope match target LOs; 'unverified' if target LO is unobservable), A2 (Cognitive operation & modality fit), A4 (Tool/AI conditions match LO; 'not_applicable' if none), A5 (Scoring reflects target skill).

3. Set-level checks on unit 'set-1' & Clarity on unit 'sec-1':
   - 'set-1': S1 (purpose/stakes clear), S2 (domain sampling across target LOs), S5 ('not_applicable' on formative/drafts), FB-S1 (feedback timing fits purpose), FB-S2 (task/process focus).
   - 'sec-1': C1..C5 (C5 'not_applicable' if no external submission constraints).

4. Per-Question Checks in questions[] (list ALL passing check IDs for the question's format in 'met', and any failing/unverified/na check IDs in 'findings'):
   - Shared per question: S3 (defensible key/rubric), S4 (fair access & construct fidelity).
   - 'mcq': IWF-01 (clear stem), IWF-02 (plausible misconception distractors), IWF-03 (no 'all/none of the above'), IWF-04 (balanced option length/detail), IWF-05 (relevant stem info), IWF-06 (parallel options), IWF-07..19 (no cues, single defensible key, positive phrasing, clean grammar, independent items) + Feedback: FB-M1 (explains why correct option works, NOT bare 'Correct/Incorrect'), FB-M2 (task/concept focus), FB-M3 (option-specific distractor misconception repair), FB-M4 (concise actionable guidance).
   - 'cata': CATA-01 (discourage early formative CATA; recommend Yes/No MTF or MCQ -> status 'revise'), CATA-02 (independent true/false statements), CATA-03 (fair partial-credit scoring; flag harsh all-or-nothing formative grading -> 'revise'), CATA-04 (realistic cognitive load) + IWF-01,02,04,05,06,10,11,12,13,15,17,19 + Feedback: FB-C1 (per-option rationale), FB-C2 (highlights missed vs false-positive selections).
   - 'numeric_math': NUM-01 (explicit units & format: decimal vs percentage), NUM-02 (explicit rounding rule & grading tolerance), NUM-03 (realistic parameters), NUM-04 (multi-step errors don't cascade silently), NUM-05 (accessible math notation) + Feedback: FB-N1 (worked formula/setup steps), FB-N2 (diagnoses common unit/rounding/formula errors), FB-N3 (interprets result meaning).
   - 'open_ended': OE-01 (explicit analytic/holistic rubric provided), OE-02 (criteria assess quality, not mere word count), OE-03 (observable level descriptors), OE-04..11 (clear prompt deliverable, scope, exemplars/anchor guidance, authentic context, fair constraints) + Feedback: FB-O1 (criterion-referenced feedback guidance/exemplar), FB-O2 (actionable next-step revision strategy), FB-O3 (prioritizes high-leverage conceptual issues), FB-O4 (preserves student agency).
   - 'short_text': TXT-01..05 + FB-T1..T3. 'ordering': ORD-01..05 + FB-R1..R3. 'multi_input': MI-01..04 + FB-I1..I2.
   - IMPORTANT: Status 'minor_risk' is ONLY allowed on minor 'IWF-*' MCQ wording/length polish. NEVER use 'minor_risk' on S3, CATA-*, NUM-*, OE-*, or FB-* checks (use 'revise' or 'unverified')!
   - CRITICAL: Every finding 'quote' MUST be an EXACT verbatim substring copied character-for-character from the assessment document.

Return strict JSON:
{
  "summary": "2-sentence synthesis of assessment validity, answer-key accuracy, item quality, and feedback readiness.",
  "feedbackWithheldForSecureExam": false,
  "results": [
    { "unit": "set-1", "label": "Assessment Set", "met": ["S1", "S2", "FB-S2"], "findings": [{ "check": "FB-S1", "status": "revise", "quote": "Feedback: Correct / Incorrect.", "principle": "FB-S1 · Purpose-matched feedback timing & policy", "reason": "..." }, { "check": "S5", "status": "not_applicable", "reason": "Formative quiz." }] },
    { "unit": "sec-1", "label": "Clarity & Structure", "met": ["C1", "C2", "C3", "C4"], "findings": [{ "check": "C5", "status": "not_applicable", "reason": "Self-contained quiz." }] },
    { "unit": "p-q1", "label": "Q1 Alignment", "met": ["A1", "A2", "A5"], "findings": [{ "check": "A4", "status": "not_applicable", "reason": "Standard conditions." }] }
  ],
  "questions": [
    {
      "id": "q1",
      "label": "Question 1",
      "rawFormat": "mcq",
      "role": "formative",
      "met": ["S4", "IWF-01", "IWF-02", "IWF-03", "IWF-04", "IWF-05", "IWF-06", "IWF-07", "IWF-08", "IWF-09", "IWF-10", "IWF-11", "IWF-12", "IWF-13", "IWF-14", "IWF-15", "IWF-16", "IWF-17", "IWF-18", "IWF-19"],
      "findings": [
        {
          "check": "S3",
          "status": "revise",
          "quote": "- A. Wrong marked option *",
          "principle": "S3 · Substantively defensible answer key",
          "reason": "Option A states an inverse-probability misconception; Option B is the valid frequentist definition.",
          "replacement": "- A. Wrong marked option\\n- B. Correct option *"
        }
      ]
    }
  ]
}`;
}

async function invokeUpstreamLlm({ provider, apiKey, model, baseUrl, systemText, userPrompt }) {
  if (provider === 'openai_compatible') {
    const endpoint = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4.1-mini',
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemText },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Upstream OpenAI-compatible provider returned HTTP ${res.status}.`);
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || '{}';
  }

  // Default Pilot Provider: Google Gemini API (with bounded thinkingBudget on 2.5 models for 3x faster response)
  const resolvedModel = model || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    resolvedModel,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig = {
    temperature: 0.15,
    responseMimeType: 'application/json',
  };
  if (/^gemini-2\.5/i.test(resolvedModel)) {
    generationConfig.thinkingConfig = { thinkingBudget: 1024 };
  }

  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    throw new Error(`Upstream Gemini API returned HTTP ${res.status}.`);
  }

  const geminiData = await res.json();
  return geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = parseAllowedOrigins(env);
    const isAllowedOrigin = allowedOrigins.includes(origin);

    const provider = String(env.LLM_PROVIDER || 'gemini').toLowerCase();
    const apiKey = provider === 'openai_compatible' ? env.LLM_API_KEY : env.GEMINI_API_KEY || env.LLM_API_KEY;
    const model = env.LLM_MODEL || env.GEMINI_MODEL || (provider === 'openai_compatible' ? 'gpt-4.1-mini' : 'gemini-2.5-flash');

    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET') {
      return jsonResponse(
        {
          service: 'learning-engineer-agent-llm-proxy',
          provider,
          model,
          status: env.PAUSE_AUDITS === 'true' ? 'paused' : 'ready',
          rubricVersion: '0.3.2',
          hasKeyConfigured: Boolean(apiKey),
          requiresAccessCode: Boolean(env.SHARED_ACCESS_CODE),
        },
        200,
        isAllowedOrigin ? origin : allowedOrigins[0],
      );
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    if (!isAllowedOrigin) {
      return jsonResponse({ error: 'Origin not permitted by LE Agent CORS policy.' }, 403, '');
    }

    if (env.PAUSE_AUDITS === 'true') {
      return jsonResponse(
        { error: 'AI Audits are temporarily paused by the project owner.' },
        503,
        origin,
      );
    }

    if (!apiKey) {
      return jsonResponse(
        { error: 'Server LLM API key secret (GEMINI_API_KEY or LLM_API_KEY) is not configured yet.' },
        500,
        origin,
      );
    }

    if (env.SHARED_ACCESS_CODE) {
      const providedCode = request.headers.get('X-LE-Access-Code') || '';
      if (!constantTimeEqual(providedCode, env.SHARED_ACCESS_CODE)) {
        return jsonResponse(
          { error: 'Invalid or missing Pilot Access Passcode (X-LE-Access-Code).' },
          401,
          origin,
        );
      }
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rate = checkRateLimits(clientIp, env);
    if (!rate.allowed) {
      return jsonResponse({ error: rate.reason }, 429, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400, origin);
    }

    const validActions = new Set(['review', 'recheck', 'prior_knowledge_audit', 'remediation_draft', 'draft_los']);
    const validTracks = new Set(['objectives_only', 'assessment_quiz']);
    const action = String(payload.action || '');
    const track = String(payload.track || 'objectives_only');

    if (!validActions.has(action) || !validTracks.has(track)) {
      return jsonResponse({ error: 'Unsupported action or track.' }, 400, origin);
    }

    const docMarkdown = String(payload.docMarkdown || '');
    const linkedLoMarkdown = String(payload.linkedLoMarkdown || '');
    if (docMarkdown.length === 0 || docMarkdown.length > 45000 || linkedLoMarkdown.length > 15000) {
      return jsonResponse(
        { error: 'Document must be between 1 and 45,000 characters.' },
        400,
        origin,
      );
    }

    const systemText = buildSystemInstruction(action, track);
    const userPrompt = [
      `Track: ${track}`,
      `Action: ${action}`,
      linkedLoMarkdown
        ? `=== TARGET LEARNING OBJECTIVES (REFERENCE ANCHORS) ===\n${linkedLoMarkdown}`
        : '',
      payload.extraContext ? `=== EDUCATOR CONTEXT ===\n${JSON.stringify(payload.extraContext)}` : '',
      `=== UPLOADED DOCUMENT MARKDOWN ===\n${docMarkdown}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    let rawText;
    try {
      rawText = await invokeUpstreamLlm({
        provider,
        apiKey,
        model,
        baseUrl: env.LLM_BASE_URL,
        systemText,
        userPrompt,
      });
    } catch (err) {
      return jsonResponse({ error: err.message || 'Upstream LLM call failed.' }, 502, origin);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Model returned malformed JSON; please click Retry.' }, 502, origin);
    }

    return jsonResponse(
      {
        ok: true,
        provider,
        model,
        rubricVersion: '0.3.2',
        data: parsed,
      },
      200,
      origin,
    );
  },
};
