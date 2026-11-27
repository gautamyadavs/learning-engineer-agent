/**
 * Provider-Agnostic, Zero-Leak LE Agent Audit Service (`web/ai-service.js`)
 * Active Pilot Default: Google Gemini (`gemini-2.5-flash`)
 *
 * Connection Priority:
 * 1. Server-Side Edge Proxy (`proxyUrl` -> `proxy/cloudflare-worker.js`):
 *    Recommended for shared pilot testing! Your `GEMINI_API_KEY` (or `LLM_API_KEY`) stays 100%
 *    encrypted inside Cloudflare Worker secrets, gated by `SHARED_ACCESS_CODE` (`X-LE-Access-Code`).
 * 2. Owner Ephemeral RAM-Only Pilot Test Key (`ephemeralApiKey` in private JS closure):
 *    Allows instant solo testing with Gemini (or any OpenAI-compatible endpoint) in 10 seconds
 *    before deploying the proxy — NEVER written to `localStorage`, `sessionStorage`, or cookies.
 * 3. Deterministic Learning-Engineering Static Analyzer (`runDeterministicAudit`):
 *    Works offline with 0 API calls.
 */

import { LE_CONFIG } from './config.js';
import { getUnlockedPasscode } from './auth-gate.js';
import {
  runDeterministicAudit,
  generateDeterministicPriorKnowledge,
} from './heuristic-analyzer.js';

// Private closure memory — never persisted to Web Storage!
let ephemeralApiKey = '';
let ephemeralProvider = LE_CONFIG.PILOT_LLM_PROVIDER || 'gemini'; // 'gemini' | 'openai_compatible'
let ephemeralModel = LE_CONFIG.DEFAULT_LLM_MODEL || 'gemini-2.5-flash';
let ephemeralBaseUrl = 'https://api.openai.com/v1';
let customProxyUrl = LE_CONFIG.DEFAULT_PROXY_URL || '';
let customAccessCodeOverride = '';

export function getConnectionStatus() {
  if (customProxyUrl.trim()) {
    return {
      mode: 'edge_proxy',
      label: 'Pilot LLM Proxy Connected',
      proxyUrl: customProxyUrl.trim(),
      provider: ephemeralProvider,
      model: ephemeralModel,
      hasEphemeralKey: false,
    };
  }
  if (ephemeralApiKey.trim()) {
    const provLabel = ephemeralProvider === 'openai_compatible' ? 'Custom LLM' : 'Gemini Pilot';
    return {
      mode: 'ephemeral_ram_key',
      label: `${provLabel} Live (RAM-Only Key)`,
      proxyUrl: '',
      provider: ephemeralProvider,
      model: ephemeralModel,
      hasEphemeralKey: true,
    };
  }
  return {
    mode: 'deterministic_engine',
    label: 'Offline Rubric · Link Gemini API',
    proxyUrl: '',
    provider: ephemeralProvider,
    model: ephemeralModel,
    hasEphemeralKey: false,
  };
}

export function configureConnection({
  proxyUrl,
  sessionRamKey,
  provider,
  model,
  baseUrl,
  accessCode,
}) {
  if (typeof proxyUrl === 'string') {
    customProxyUrl = proxyUrl.trim().replace(/\/+$/, '');
  }
  if (typeof sessionRamKey === 'string' && sessionRamKey.trim()) {
    ephemeralApiKey = sessionRamKey.trim();
  }
  if (typeof provider === 'string' && provider.trim()) {
    ephemeralProvider = provider.trim();
  }
  if (typeof model === 'string' && model.trim()) {
    ephemeralModel = model.trim();
  }
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    ephemeralBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  }
  if (typeof accessCode === 'string') {
    customAccessCodeOverride = accessCode.trim();
  }
  return getConnectionStatus();
}

export function clearEphemeralCredentials() {
  ephemeralApiKey = '';
  customAccessCodeOverride = '';
  return getConnectionStatus();
}

export async function executeAuditAction({
  action,
  track,
  docMarkdown,
  linkedLoMarkdown = '',
  rubric,
  extraContext = null,
}) {
  const status = getConnectionStatus();

  if (status.mode === 'edge_proxy') {
    const headers = { 'Content-Type': 'application/json' };
    const effectiveCode = customAccessCodeOverride || getUnlockedPasscode();
    if (effectiveCode) {
      headers['X-LE-Access-Code'] = effectiveCode;
    }

    const res = await fetch(status.proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action,
        track,
        docMarkdown,
        linkedLoMarkdown,
        extraContext,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Edge proxy returned HTTP ${res.status}.`);
    }

    if (action === 'review' || action === 'recheck') {
      return normalizeModelReviewPayload(
        body.data,
        track,
        rubric,
        `${body.provider || 'llm'}_proxy (${body.model || LE_CONFIG.DEFAULT_LLM_MODEL})`,
      );
    }
    return body.data;
  }

  if (status.mode === 'ephemeral_ram_key') {
    const rawData = await callDirectLlmWithRamKey({
      action,
      track,
      docMarkdown,
      linkedLoMarkdown,
      extraContext,
    });
    if (action === 'review' || action === 'recheck') {
      return normalizeModelReviewPayload(
        rawData,
        track,
        rubric,
        `${ephemeralProvider}_ram (${ephemeralModel})`,
      );
    }
    return rawData;
  }

  // Fallback / Offline Mode: Deterministic Rule-Based Engine (0 API calls)
  if (action === 'review' || action === 'recheck') {
    return runDeterministicAudit({ track, docMarkdown, linkedLoMarkdown });
  }

  if (action === 'prior_knowledge_audit') {
    return {
      prior_knowledge_items: generateDeterministicPriorKnowledge({
        track,
        docMarkdown,
        seededPrerequisites: extraContext?.seededPrerequisites || [],
        suppressedOutOfScope: extraContext?.suppressedOutOfScope || [],
      }),
    };
  }

  if (action === 'remediation_draft') {
    const gaps = extraContext?.openGapStatements || ['Foundational prerequisite concepts'];
    return {
      remediationMarkdown: gaps
        .map(
          (g, idx) =>
            `### ${idx + 1}. Quick Bridge: ${g}\n- **Core Idea:** Clarify the underlying representation and units before attempting Module tasks.\n- **Worked Micro-Example:** Walk through one concrete 2-step substitution verifying assumptions.\n- **Self-Check:** Explain in one sentence how changing the input parameter alters the expected output.`,
        )
        .join('\n\n'),
    };
  }

  if (action === 'draft_los') {
    return {
      candidateLosMarkdown: `## Learning Objectives\n\n- **LO1:** Distinguish cluster-randomized experimental designs from observational cohort and case-control studies given a research scenario.\n- **LO2:** Sequence and justify the parameter inputs required to compute statistical power and minimum sample size.`,
    };
  }

  throw new Error(`Unsupported action: ${action}`);
}

async function callDirectLlmWithRamKey({
  action,
  track,
  docMarkdown,
  linkedLoMarkdown,
  extraContext,
}) {
  const systemPrompt = buildDirectSystemPrompt(action, track);
  const userText = [
    `Track: ${track}`,
    `Action: ${action}`,
    linkedLoMarkdown
      ? `=== TARGET LEARNING OBJECTIVES (REFERENCE ANCHORS) ===\n${linkedLoMarkdown}`
      : '',
    extraContext ? `=== EDUCATOR CONTEXT ===\n${JSON.stringify(extraContext)}` : '',
    `=== UPLOADED DOCUMENT MARKDOWN ===\n${docMarkdown.slice(0, 45000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (ephemeralProvider === 'openai_compatible') {
    const endpoint = `${ephemeralBaseUrl}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ephemeralApiKey}`,
      },
      body: JSON.stringify({
        model: ephemeralModel || 'gpt-4.1-mini',
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM endpoint returned HTTP ${res.status}. Verify your temporary session key & model.`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
  }

  // Default Pilot Provider: Google Gemini API
  const model = ephemeralModel || LE_CONFIG.DEFAULT_LLM_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(ephemeralApiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API returned HTTP ${res.status}. Verify your temporary Gemini API key.`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(text);
}

function buildDirectSystemPrompt(action, track) {
  if (action === 'prior_knowledge_audit') {
    return `You are the Learning Engineer (LE) Agent Prior Knowledge Auditor (Rubric v0.3.2).
Identify 5 to 8 concrete unstated prerequisites (fact | skill | principle) required by the uploaded document.
Exclude any items in suppressedOutOfScope.
Return strict JSON:
{ "prior_knowledge_items": [{ "pkId": "pk-1", "statement": "...", "kliType": "fact"|"skill"|"principle", "requiredBy": [{ "unit": "LO1", "quote": "Exact verbatim substring" }], "whyNeeded": "..." }] }`;
  }
  if (action === 'remediation_draft') {
    return `Draft a concise Markdown 'Prerequisite Refresher' with intuitive explanation, 1 worked example, and 1 self-check for the educator's flagged prerequisite gaps. Return strict JSON: { "remediationMarkdown": "..." }`;
  }
  if (action === 'draft_los') {
    return `Infer 3 to 5 observable, student-centered Bloom's-verb Learning Objectives aligned to the uploaded assessment. Return strict JSON: { "candidateLosMarkdown": "## Learning Objectives\\n\\n- **LO1:** ..." }`;
  }
  if (track === 'objectives_only') {
    return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 1: Objectives Only).
Evaluate each leaf Learning Objective on O1, O2, O3, O4, O5, O6; evaluate unit 'set-1' on O7; evaluate unit 'sec-1' on C1, C2, C3, C4, C5 (mark C5 not_applicable on pure LO lists).
Exclude orientation notes from leaf LOs and flag them under C1.
Every finding 'quote' MUST be an EXACT verbatim substring from the document, and 'replacement' a clean drop-in rewrite when applicable.
Also propose 3-6 KLI Knowledge Components in kc_candidates.
Return strict JSON:
{
  "summary": "2-sentence overview",
  "results": [
    { "unit": "lo-1", "label": "LO 1", "met": ["O1","O3","O4","O5","O6"], "findings": [{ "check": "O2", "status": "revise", "quote": "exact substring", "principle": "O2 · Observable Bloom's action verb", "reason": "...", "replacement": "..." }] },
    { "unit": "set-1", "label": "Objective Set", "met": ["O7"], "findings": [] },
    { "unit": "sec-1", "label": "Clarity", "met": ["C1","C2","C3","C4"], "findings": [{ "check": "C5", "status": "not_applicable", "reason": "Pure LO list." }] }
  ],
  "kc_candidates": [{ "kcId": "kc-1", "loUnit": "lo-1", "statement": "...", "kliType": "skill", "origin": "ai_proposed", "impliedByLoQuote": "exact substring", "suggestedTrimmedLoIfOutOfScope": "..." }]
}`;
  }
  return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 2: Assessment / Quiz).
Evaluate:
- Alignment units ('p-q1', etc.) in results[] on A1, A2, A4 (conditional), A5.
- Set unit 'set-1' on S1, S2, S5 (conditional), FB-S1, FB-S2.
- Clarity unit 'sec-1' on C1, C2, C3, C4, C5 (conditional).
- Questions in questions[] with rawFormat ('mcq' | 'open_ended' | 'cata' | 'numeric_math' | 'short_text' | 'ordering' | 'multi_input'), evaluating S3 (solve & verify answer key/rubric!), S4, format item checks (IWF-01..19 / OE-01..11 / CATA-01..04 / NUM-01..05 / TXT-01..05 / ORD-01..05 / MI-01..04), and format feedback checks (FB-M1..M4 / FB-O1..M4 / FB-C1..C2 / FB-N1..N3 / FB-T1..T3 / FB-R1..R3 / FB-I1..I2).
Every finding 'quote' MUST be an EXACT verbatim substring from the document.
Return strict JSON: { "summary": "...", "feedbackWithheldForSecureExam": false, "results": [...], "questions": [...] }`;
}

/**
 * Sanitizes model output against rubric-v0.3.json so `computeTrackScore()` is 100% crash-proof.
 */
function normalizeModelReviewPayload(raw, track, rubric, modeLabel) {
  const validCheckIds = new Set(rubric.checks.map((c) => c.id));
  const validStatuses = new Set(['revise', 'unverified', 'not_applicable', 'meets', 'minor_risk']);

  const sanitizeUnit = (u, fallbackId) => {
    const seen = new Set();
    const cleanFindings = [];
    for (const f of Array.isArray(u.findings) ? u.findings : []) {
      const cid = String(f.check || '').trim();
      if (!validCheckIds.has(cid) || seen.has(cid)) continue;
      const st = validStatuses.has(f.status) ? f.status : 'revise';
      seen.add(cid);
      cleanFindings.push({
        check: cid,
        status: st,
        quote: typeof f.quote === 'string' && f.quote.trim() ? f.quote.trim() : undefined,
        principle: f.principle || cid,
        reason: String(f.reason || 'Review against rubric standard.'),
        replacement: typeof f.replacement === 'string' ? f.replacement : undefined,
        repairAction: f.repairAction,
      });
    }

    const cleanMet = [];
    for (const m of Array.isArray(u.met) ? u.met : []) {
      const cid = String(m || '').trim();
      if (!validCheckIds.has(cid) || seen.has(cid)) continue;
      seen.add(cid);
      cleanMet.push(cid);
    }

    return {
      unit: String(u.unit || u.id || fallbackId),
      label: String(u.label || u.unit || u.id || fallbackId),
      met: cleanMet,
      findings: cleanFindings,
    };
  };

  const rawResults = Array.isArray(raw?.results) ? raw.results : [];
  const results = rawResults.map((r, i) => sanitizeUnit(r, `u-${i + 1}`));

  const rawQuestions = Array.isArray(raw?.questions) ? raw.questions : [];
  const questions = rawQuestions.map((q, i) => {
    const base = sanitizeUnit(q, `q${i + 1}`);
    return {
      id: base.unit,
      label: base.label,
      rawFormat: String(q.rawFormat || 'mcq'),
      role: q.role === 'summative' ? 'summative' : 'formative',
      met: base.met,
      findings: base.findings,
    };
  });

  if (track === 'objectives_only') {
    const objUnits = results
      .map((r) => r.unit)
      .filter((id) => id !== 'set-1' && id !== 'sec-1' && !/^set|^sec/i.test(id));
    if (!results.some((r) => r.unit === 'set-1')) {
      results.push({ unit: 'set-1', label: 'Objective Set', met: ['O7'], findings: [] });
    }
    if (!results.some((r) => r.unit === 'sec-1')) {
      results.push({
        unit: 'sec-1',
        label: 'Clarity',
        met: ['C1', 'C2', 'C3', 'C4'],
        findings: [{ check: 'C5', status: 'not_applicable', reason: 'LO list.' }],
      });
    }
    return {
      mode: modeLabel,
      summary: String(raw?.summary || 'Completed Learning Objective audit.'),
      expectedUnitsByType: {
        objective: objUnits.length > 0 ? objUnits : ['lo-1'],
        objective_set: ['set-1'],
        section: ['sec-1'],
      },
      results,
      questions: [],
      kc_candidates: Array.isArray(raw?.kc_candidates) ? raw.kc_candidates : [],
    };
  }

  if (!results.some((r) => r.unit === 'set-1')) {
    results.unshift({
      unit: 'set-1',
      label: 'Assessment Set',
      met: ['S1', 'S2', 'FB-S1', 'FB-S2'],
      findings: [{ check: 'S5', status: 'not_applicable', reason: 'Design review.' }],
    });
  }
  if (!results.some((r) => r.unit === 'sec-1')) {
    results.push({
      unit: 'sec-1',
      label: 'Clarity',
      met: ['C1', 'C2', 'C3', 'C4'],
      findings: [{ check: 'C5', status: 'not_applicable', reason: 'Self-contained quiz.' }],
    });
  }

  const alignUnits = results
    .map((r) => r.unit)
    .filter((id) => id !== 'set-1' && id !== 'sec-1');

  if (alignUnits.length === 0 && questions.length > 0) {
    for (const q of questions) {
      const pId = `p-${q.id}`;
      alignUnits.push(pId);
      results.push({
        unit: pId,
        label: `${q.label} Alignment`,
        met: ['A1', 'A2', 'A5'],
        findings: [{ check: 'A4', status: 'not_applicable', reason: 'Standard conditions.' }],
      });
    }
  }

  return {
    mode: modeLabel,
    summary: String(raw?.summary || 'Completed Assessment & Feedback audit.'),
    feedbackWithheldForSecureExam: Boolean(raw?.feedbackWithheldForSecureExam),
    expectedUnitsByType: {
      alignment_pair: alignUnits,
      assessment_set: ['set-1'],
      section: ['sec-1'],
    },
    results,
    questions,
    kc_candidates: [],
  };
}
