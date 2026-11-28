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
    if (action === 'draft_los') {
      return normalizeDraftedLosPayload(body.data);
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
    if (action === 'draft_los') {
      return normalizeDraftedLosPayload(rawData);
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

  const generationConfig = {
    temperature: 0.15,
    responseMimeType: 'application/json',
  };
  if (/^gemini-2\.5/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 1024 };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig,
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
    return `Infer 3 to 5 observable, student-centered Bloom's-verb Learning Objectives aligned to the uploaded assessment. Include '## Target Learning Objectives\\n\\nBy the end of this module, learners will be able to:' once and start each bullet directly with a bold LO ID + capital action verb ('- **LO1:** Classify...'). Return strict JSON: { "candidateLosMarkdown": "..." }`;
  }
  if (track === 'objectives_only') {
    return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 1: Objectives Only).
Evaluate each leaf Learning Objective on O1, O2, O3, O4 (do not double-deduct O4 when O1/O2 already fails), O5, O6; evaluate unit 'set-1' on O7; evaluate unit 'sec-1' on C1 (flag non-LO orientation notes mixed into Objectives), C2, C3, C4, C5 (mark C5 not_applicable on pure LO lists).
Every finding 'quote' MUST be an EXACT verbatim substring from the document, and 'replacement' a clean drop-in rewrite preserving bullet formatting.
Also propose 3-6 KLI Knowledge Components in kc_candidates.
Return strict JSON: { "summary": "...", "results": [...], "kc_candidates": [...] }`;
  }
  return `You are the Learning Engineer (LE) Agent Reviewer (Rubric v0.3.2 — Track 2: Assessment / Quiz).
1. Independently solve every question BEFORE checking any marked key ('*', '[x]', 'Answer:'). Flag wrong keys as S3 'revise' quoting the wrong option line; flag missing rubrics ('Graded by TA') as S3, OE-01, OE-03 'unverified'.
2. Evaluate Alignment ('p-q1', etc.) on A1, A2, A4 (conditional), A5; 'set-1' on S1, S2, S5 (conditional), FB-S1, FB-S2; 'sec-1' on C1..C5.
3. Evaluate each question on S3, S4, format checks (mcq: IWF-01..19 + FB-M1..M4; open_ended: OE-01..11 + FB-O1..O4; cata: CATA-01..04 + IWF core + FB-C1..C2; numeric_math: NUM-01..05 + FB-N1..N3; short_text: TXT-01..05 + FB-T1..T3; ordering: ORD-01..05 + FB-R1..R3; multi_input: MI-01..04 + FB-I1..I2).
Status 'minor_risk' is ONLY permitted on minor IWF-* polish, never on S3, CATA-*, NUM-*, OE-*, or FB-*. Every 'quote' MUST be an exact verbatim substring.
Return strict JSON: { "summary": "...", "feedbackWithheldForSecureExam": false, "results": [...], "questions": [...] }`;
}

/**
 * Sanitizes model output against rubric-v0.3.json and enforces deterministic rubric invariants:
 * 1. `minor_risk` (0-pt advisory) is strictly limited to `IWF-*` MCQ item-writing checks (ADR-0009).
 * 2. Track 1 `O4` is not double-deducted on leaf LOs already failing `O1` or `O2` unless pure completion.
 * 3. Track 2 `open_ended` items with `S3 = unverified` (missing rubric) propagate `unverified` to `OE-01` & `OE-03`.
 * 4. Cleans redundant repeated 'Students will be able to' prefixes if present in `draft_los`.
 */
function normalizeDraftedLosPayload(raw) {
  let md = String(raw?.candidateLosMarkdown || '').trim();
  if (!md) return { candidateLosMarkdown: '' };
  md = md.replace(
    /^(\s*[-*]\s*(?:\*\*LO\s*[\d.]+\w*:?\*\*\s*))Students?\s+will\s+be\s+able\s+to\s+(?:\*\*)?([a-z])/gim,
    (_, prefix, firstChar) => `${prefix}${firstChar.toUpperCase()}`,
  );
  if (!/^#{1,4}\s+/m.test(md)) {
    md = `## Target Learning Objectives\n\nBy the end of this module, learners will be able to:\n${md}`;
  }
  return { candidateLosMarkdown: md };
}

function normalizeModelReviewPayload(raw, track, rubric, modeLabel) {
  const validCheckIds = new Set(rubric.checks.map((c) => c.id));
  const validStatuses = new Set(['revise', 'unverified', 'not_applicable', 'meets', 'minor_risk']);

  const sanitizeUnit = (u, fallbackId) => {
    const seen = new Set();
    const cleanFindings = [];
    for (const f of Array.isArray(u.findings) ? u.findings : []) {
      const cid = String(f.check || '').trim();
      if (!validCheckIds.has(cid) || seen.has(cid)) continue;
      let st = validStatuses.has(f.status) ? f.status : 'revise';
      // Enforce ADR-0009 invariant: minor_risk is strictly for IWF-* MCQ item-writing nuances
      if (st === 'minor_risk' && !cid.startsWith('IWF-')) {
        st = 'revise';
      }
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

  // Track 1 Invariant: Prevent O4 double-deduction when O1 or O2 already failed on the same leaf LO
  if (track === 'objectives_only') {
    for (const r of results) {
      if (r.unit === 'set-1' || r.unit === 'sec-1') continue;
      const hasO1OrO2Revise = r.findings.some(
        (f) => (f.check === 'O1' || f.check === 'O2') && f.status === 'revise',
      );
      if (hasO1OrO2Revise) {
        const o4Idx = r.findings.findIndex(
          (f) =>
            f.check === 'O4' &&
            f.status === 'revise' &&
            !/\b(?:attend|watch|click|complete\s+worksheet)\b/i.test(f.quote || ''),
        );
        if (o4Idx !== -1) {
          r.findings.splice(o4Idx, 1);
          if (!r.met.includes('O4')) r.met.push('O4');
        }
      }
    }
  }

  const rawQuestions = Array.isArray(raw?.questions) ? raw.questions : [];
  const questions = rawQuestions.map((q, i) => {
    const base = sanitizeUnit(q, `q${i + 1}`);
    const rawFormat = String(q.rawFormat || 'mcq');
    const s3Unverified = base.findings.find((f) => f.check === 'S3' && f.status === 'unverified');

    // Track 2 Invariant: Missing rubric on open_ended ('S3 = unverified') cannot simultaneously pass OE-01 / OE-03
    if (rawFormat === 'open_ended' && s3Unverified) {
      for (const oeCid of ['OE-01', 'OE-03']) {
        base.met = base.met.filter((m) => m !== oeCid);
        if (!base.findings.some((f) => f.check === oeCid)) {
          base.findings.push({
            check: oeCid,
            status: 'unverified',
            quote: s3Unverified.quote,
            principle:
              oeCid === 'OE-01'
                ? 'OE-01 · Explicit scoring criteria or rubric'
                : 'OE-03 · Observable performance-level descriptors',
            reason:
              'Scoring rubric or performance descriptors are not included in the uploaded document, so rubric quality cannot be verified yet.',
          });
        }
      }
    }

    return {
      id: base.unit,
      label: base.label,
      rawFormat,
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
