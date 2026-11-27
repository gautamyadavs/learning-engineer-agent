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
Avoid unobservable verbs ('understand', 'know', 'appreciate', 'learn about') and avoid bundling separable 'A and B' tasks.
Return strict JSON: { "candidateLosMarkdown": "- **LO1:** ...\\n- **LO2:** ..." }`;
  }

  if (track === 'objectives_only') {
    return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 1: Objectives Only).
Evaluate the uploaded Learning Objectives document strictly against:
- O1 (Learner-centered framing; shared 'Students will be able to' stem passes)
- O2 (Observable Bloom's action verb; flag understand/know/learn about/appreciate/consider/enhance ability; intentional dispositional norms pass O2 and verify behavioral indicators in O4)
- O3 (Specific content & single-target granularity; split separable 'A and B' compounds and 10+ concept laundry lists; allow inseparable 'select and justify' and UDL 'implement or trace')
- O4 (Identifiable evidence of mastery & worthwhile purpose; no '80% accuracy' ABCD degree required)
- O5 (Material performance conditions — tools/AI/quant-vs-qual/dual-track explicit when they alter the skill; mark not_applicable or pass when no special condition applies)
- O6 (Target-faithful expression — ends vs. means; honor UDL 'A or B')
- O7 (Set-level coherence on unit 'set-1' — no missing sub-KCs, level inversions, or duplicates; mark not_applicable if only 1 LO)
- C1..C5 on unit 'sec-1' (C1 clear IDs & separation of non-LO orientation notes, ignoring Markdown '1.' export quirks; C2 unambiguous references; C3 accessible phrasing; C4 sequence; C5 external constraints, mark not_applicable on pure LO lists).

4-Way Block Segmentation:
Classify items into 'leaf_lo' (scored on O1-O6), 'umbrella_header' (container goal with child LOs; do not penalize on O1-O6), 'author_kc' (author-written KC X.Y), or 'orientation_note' (non-LO prose inside Objectives block; exclude from O1-O6 and flag under C1).

CRITICAL: Every finding 'quote' MUST be an EXACT verbatim substring copied character-for-character from the document so inline Grammarly-style highlighting anchors cleanly.
Also extract 3-6 KLI Knowledge Components (fact | skill | principle) in kc_candidates (0 score impact).

Return strict JSON matching:
{
  "summary": "2-sentence constructive synthesis of strengths and highest-leverage fixes.",
  "objective_blocks": [{ "id": "lo-1", "text": "...", "role": "leaf_lo" }],
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
          "reason": "Clear Principle -> Relevance -> Rationale explanation of the issue and its assessment impact.",
          "replacement": "Drop-in replacement text for the quoted span"
        }
      ]
    },
    { "unit": "set-1", "label": "Objective Set", "met": ["O7"], "findings": [] },
    { "unit": "sec-1", "label": "Document Clarity", "met": ["C1", "C2", "C3", "C4"], "findings": [{ "check": "C5", "status": "not_applicable", "reason": "Pure LO specification." }] }
  ],
  "kc_candidates": [
    {
      "kcId": "kc-1",
      "loUnit": "lo-1",
      "statement": "Concise Knowledge Component",
      "kliType": "skill",
      "origin": "ai_proposed",
      "impliedByLoQuote": "Exact verbatim substring if potentially out of scope",
      "suggestedTrimmedLoIfOutOfScope": "Optional narrowed LO wording"
    }
  ]
}`;
  }

  return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 2: Assessment / Quiz).
Evaluate the uploaded Assessment against its target Learning Objectives using Rubric v0.3.2:
1. Alignment per question ('p-<questionId>' units in results[]):
   - A1 (Content & scope match target LOs; mark 'unverified' if referenced LO is unobservable/instructor-centered)
   - A2 (Tasks elicit intended cognitive operation; MCQs can test discrimination/decisions, NOT full authoring/coding implementation)
   - A4 (Permitted tools/AI/independence match LO conditions; mark 'not_applicable' if no special aid rule)
   - A5 (Credit & scoring reflect target capability). Note: A3 is automatically not_applicable in standalone quizzes.
2. Shared Assessment & Set-Level Feedback on unit 'set-1':
   - S1 (Identifiable diagnostic/formative/summative purpose; supports mixed F/S banks)
   - S2 (Sufficient domain sampling across LOs without rigid item-count quotas)
   - S5 (Score interpretation limits; mark 'not_applicable' on formative/design drafts; never demand Cronbach's alpha without learner data)
   - FB-S1 (Feedback timing fits purpose; no Attempt-1 key spoilers on multi-try/graded items or cross-item key leakage)
   - FB-S2 (Task/process focus; no self-level praise or overclaimed psychological diagnosis).
3. Document Clarity on unit 'sec-1': C1..C5 (C1 checks clear question IDs & LO tags, ignoring '1. 1. 1.' export quirks; C5 conditional).
4. Per-Question Evaluation in questions[] (equal 1/N weight across all N questions):
   - Every question MUST evaluate S3 (substantively solve & verify answer key/rubric; missing/external rubrics = 'unverified'; wrong keys = 'revise') and S4 (fair access to stimuli & construct fidelity).
   - Assign rawFormat from: 'mcq' (checks IWF-01..19 + FB-M1..M4), 'open_ended' (OE-01..11 + FB-O1..O4), 'cata' (CATA-01..04 + IWF-01,02,04,05,06,10,11,12,13,15,17,19 + FB-C1..C2; CATA-01 flags early formative CATA and suggests MTF/MCQ), 'numeric_math' (NUM-01..05 + FB-N1..N3), 'short_text' (TXT-01..05 + FB-T1..T3), 'ordering' (ORD-01..05 + FB-R1..R3), 'multi_input' (MI-01..04 + FB-I1..I2; route Yes/No MTF matrices & LBD_TAF here!).
   - Use status 'minor_risk' for minor MCQ wording/length nuances (0 score deduction) and 'revise' only for genuine flaws.
   - CRITICAL: Every finding 'quote' MUST be an EXACT verbatim substring copied character-for-character from the assessment document.

Return strict JSON:
{
  "summary": "2-sentence synthesis of assessment validity, item quality, and feedback readiness.",
  "feedbackWithheldForSecureExam": false,
  "results": [
    { "unit": "set-1", "label": "Assessment Set", "met": ["S1", "S2", "FB-S1", "FB-S2"], "findings": [{ "check": "S5", "status": "not_applicable", "reason": "Formative quiz." }] },
    { "unit": "sec-1", "label": "Clarity & Structure", "met": ["C1", "C2", "C3", "C4", "C5"], "findings": [] },
    { "unit": "p-q1", "label": "Q1 Alignment", "met": ["A1", "A2", "A5"], "findings": [{ "check": "A4", "status": "not_applicable", "reason": "Standard conditions." }] }
  ],
  "questions": [
    {
      "id": "q1",
      "label": "Question 1",
      "rawFormat": "mcq",
      "role": "formative",
      "met": ["S3", "S4", "IWF-01", "IWF-02"],
      "findings": [
        {
          "check": "FB-M3",
          "status": "revise",
          "quote": "Exact verbatim substring from Q1 in the document",
          "principle": "FB-M3 · Option-specific distractor misconception repair",
          "reason": "Explains why bare right/wrong or missing distractor feedback leaves misconceptions intact.",
          "replacement": "Concrete drop-in replacement with option-level feedback"
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

  // Default Pilot Provider: Google Gemini API
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model || 'gemini-2.5-flash',
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: 'application/json',
      },
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
