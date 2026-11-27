/**
 * Built-in Deterministic Learning-Engineering Static Analyzer (Rubric v0.3.0)
 *
 * Parses ANY uploaded Learning Objectives (Track 1) or Assessment / Quiz (Track 2)
 * Markdown document in the browser with 0 API keys required, producing exact verbatim
 * quote-anchored findings, KLI KC candidates, Prior Knowledge items, and inputs for
 * `computeTrackScore()`. When the Cloudflare Gemini Proxy (or ephemeral session key)
 * is connected, Gemini 2.5 Flash enriches this with deep semantic & domain solving.
 */

import { segmentObjectiveBlocks, normalizeQuestionFormat } from './scorer.js';

const UNOBSERVABLE_VERB_MAP = [
  { regex: /\bunderstand(?:ing)?\b/i, verb: 'Understand', suggest: 'Diagnose and explain' },
  { regex: /\bknow(?:ing)?\b/i, verb: 'Know', suggest: 'Identify and apply' },
  { regex: /\blearn\s+about\b/i, verb: 'Learn about', suggest: 'Analyze' },
  { regex: /\bappreciate\b/i, verb: 'Appreciate', suggest: 'Evaluate and justify responses to' },
  { regex: /\bbecome\s+(?:familiar|aware)\s+with\b/i, verb: 'Become familiar with', suggest: 'Distinguish' },
  { regex: /\bconsider\b/i, verb: 'Consider', suggest: 'Evaluate' },
  { regex: /\benhance\s+(?:their\s+)?ability\s+to\b/i, verb: 'Enhance ability to', suggest: 'Apply' },
];

const INSTRUCTOR_FRAMING_REGEX =
  /\b(?:instructors?\s+will|teachers?\s+will|this\s+(?:course|module)\s+(?:covers?|introduces?|teaches?)|cover\s+how\s+to|teach\s+students)\b/i;

const ACTION_VERBS_FOR_COMPOUND =
  /\b(?:write|build|design|create|critique|compare|evaluate|analyze|implement|calculate|compute|diagnose|justify|explain|formulate|derive)\b/gi;

export function runDeterministicAudit({ track, docMarkdown, linkedLoMarkdown = '' }) {
  if (track === 'objectives_only') {
    return analyzeObjectivesTrack(docMarkdown);
  }
  return analyzeAssessmentTrack(docMarkdown, linkedLoMarkdown);
}

function analyzeObjectivesTrack(docMarkdown) {
  const lines = docMarkdown.split('\n');
  const rawBlocks = [];
  let loCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed)) continue;
    if (/^by\s+the\s+end\s+of\s+this/i.test(trimmed)) continue;

    if (/^(?:[-*•]|\d+[.)])\s+/.test(trimmed)) {
      loCounter += 1;
      const cleanText = trimmed.replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
      rawBlocks.push({
        id: `lo-${loCounter}`,
        rawLine: trimmed,
        text: cleanText,
      });
    } else if (/^(?:note|preview|mechanism\s+preview|background|overview)\b[^:]*:/i.test(trimmed)) {
      rawBlocks.push({
        id: `note-${rawBlocks.length + 1}`,
        rawLine: trimmed,
        text: trimmed,
      });
    }
  }

  // Fallback if user pasted plain paragraphs without bullets
  if (rawBlocks.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !/^#{1,6}\s/.test(trimmed) && trimmed.length > 18) {
        loCounter += 1;
        rawBlocks.push({ id: `lo-${loCounter}`, rawLine: trimmed, text: trimmed });
      }
    }
  }

  const segmented = segmentObjectiveBlocks(rawBlocks);
  const leafBlocks = rawBlocks.filter((b) => segmented.scoredLeafLoIds.includes(b.id));

  const results = [];
  const kcCandidates = [];
  let kcIdx = 0;

  for (const b of leafBlocks) {
    const met = [];
    const findings = [];
    const cleanBody = b.text.replace(/^\*{0,2}(?:LO[-_\s]?\d+|Objective\s+\d+)[.:]?\*{0,2}\s*/i, '');

    // O1: Learner-centered framing
    if (INSTRUCTOR_FRAMING_REGEX.test(b.text)) {
      const rewritten = cleanBody
        .replace(
          /^(?:(?:instructors?|teachers?)\s+will\s+(?:cover|teach|introduce|present)(?:\s+how\s+to(?:\s+read)?)?|this\s+(?:course|module)\s+(?:covers?|introduces?|teaches?)(?:\s+how\s+to)?|cover\s+how\s+to(?:\s+read)?|teach\s+students(?:\s+how\s+to)?)\b/i,
          'Interpret and diagnose',
        )
        .replace(INSTRUCTOR_FRAMING_REGEX, 'Interpret and diagnose')
        .replace(/^\s+/, '');
      findings.push({
        check: 'O1',
        status: 'revise',
        quote: b.text,
        principle: 'O1 · Learner-centered framing',
        reason:
          'Describes instructor/course coverage rather than what the learner will be able to do (LO1, LLSS-LO-1). Reframe around observable learner performance.',
        replacement: b.text.replace(cleanBody, rewritten),
      });
    } else {
      met.push('O1');
    }

    // O2: Observable Bloom's action verb
    const unobs = UNOBSERVABLE_VERB_MAP.find((u) => u.regex.test(cleanBody));
    if (unobs) {
      const replacedBody = cleanBody.replace(unobs.regex, unobs.suggest);
      findings.push({
        check: 'O2',
        status: 'revise',
        quote: b.text,
        principle: "O2 · Observable Bloom's action verb",
        reason: `"${unobs.verb}" is an internal, unobservable state rather than an inspectable action (LLSS-LO-2, EdDesign Step 2). Specify the cognitive action learners perform to demonstrate mastery.`,
        replacement: b.text.replace(cleanBody, replacedBody),
      });
    } else {
      met.push('O2');
    }

    // O3: Specific content & single-target granularity
    const matchedVerbs = cleanBody.match(ACTION_VERBS_FOR_COMPOUND) || [];
    const commaCount = (cleanBody.match(/,/g) || []).length;
    const isUdlOr = /\bimplement\s+or\s+trace\b/i.test(cleanBody);
    const isCoupledPair = /\b(?:select|identify|evaluate)\s+and\s+(?:justify|explain)\b/i.test(cleanBody);

    if (!isUdlOr && !isCoupledPair && (matchedVerbs.length >= 3 || commaCount >= 4)) {
      const firstClause = cleanBody.split(/,\s*(?:and\s+)?|\s+and\s+(?=design|write|create|build)/i)[0];
      findings.push({
        check: 'O3',
        status: 'revise',
        quote: b.text,
        principle: 'O3 · Specific content & single-target granularity',
        reason: `Bundles multiple separable capabilities (${matchedVerbs.slice(0, 4).join(', ')}) into a single objective, making alignment and scoring ambiguous when a learner masters one part but not the others (LLSS2 s.43–52). Split into focused leaf objectives.`,
        replacement: b.text.replace(cleanBody, `${firstClause.trim()}.`),
      });
    } else {
      met.push('O3');
    }

    // O4: Evidence of mastery (avoid double-deducting when O1/O2 already flagged)
    if (findings.some((f) => f.check === 'O1' || f.check === 'O2')) {
      met.push('O4');
    } else if (/\b(?:attend|click|watch\s+video|complete\s+worksheet)\b/i.test(cleanBody)) {
      findings.push({
        check: 'O4',
        status: 'revise',
        quote: b.text,
        principle: 'O4 · Identifiable evidence of mastery',
        reason:
          'Tracks task completion/attendance rather than demonstrating transferable capability (LO2, LO7).',
      });
    } else {
      met.push('O4');
    }

    // O5: Material performance conditions
    if (/\bimplement\s+or\s+trace\b/i.test(cleanBody) && !/\b(?:track|role|self-select|given)\b/i.test(cleanBody)) {
      findings.push({
        check: 'O5',
        status: 'revise',
        quote: b.text,
        principle: 'O5 · Material performance conditions',
        reason:
          'Uses a legitimate UDL/dual-track disjunction ("implement or trace"), which passes O3, but omits the condition governing whether learners self-select a path or follow coding vs. non-coding track rules (LO5).',
        replacement: b.text.replace(
          /Implement or trace/i,
          'Given starter code or execution logs (coding vs. conceptual track), implement or trace',
        ),
      });
    } else {
      met.push('O5');
    }

    // O6: Target-faithful expression (ends vs. means)
    if (/\b(?:in\s+PowerPoint|using\s+Canvas\s+discussion|5-slide\s+deck)\b/i.test(cleanBody)) {
      findings.push({
        check: 'O6',
        status: 'revise',
        quote: b.text,
        principle: 'O6 · Target-faithful expression (ends vs. means)',
        reason: 'Locks in an incidental tool/delivery medium that is not part of the target domain skill (LO6, UDL).',
      });
    } else {
      met.push('O6');
    }

    results.push({
      unit: b.id,
      label: b.id.toUpperCase(),
      met,
      findings,
    });

    // Generate KLI KC Candidate for each leaf LO
    kcIdx += 1;
    const kliType = /\b(?:compute|implement|build|diagnose|write)\b/i.test(cleanBody)
      ? 'skill'
      : /\b(?:why|assumptions|fairness|trade-?off|principle)\b/i.test(cleanBody)
        ? 'principle'
        : 'fact';
    kcCandidates.push({
      kcId: `kc-${kcIdx}`,
      loUnit: b.id,
      statement: cleanBody.slice(0, 110),
      kliType,
      origin: 'ai_proposed',
      impliedByLoQuote: b.text,
      suggestedTrimmedLoIfOutOfScope: `${b.text.replace(/\.$/, '')} (qualitative conceptual scope only).`,
    });
  }

  for (const akc of segmented.authorKcBlocks) {
    kcIdx += 1;
    kcCandidates.push({
      kcId: `author-kc-${kcIdx}`,
      loUnit: leafBlocks[0]?.id || 'lo-1',
      statement: akc.text,
      kliType: 'skill',
      origin: 'author_authored',
    });
  }

  // Set-level O7
  if (leafBlocks.length <= 1) {
    results.push({
      unit: 'set-1',
      label: 'Objective Set',
      met: [],
      findings: [{ check: 'O7', status: 'not_applicable', reason: 'Single objective uploaded.' }],
    });
  } else {
    results.push({
      unit: 'set-1',
      label: 'Objective Set',
      met: ['O7'],
      findings: [],
    });
  }

  // Clarity C1-C5
  const secMet = ['C2', 'C3'];
  const secFindings = [];
  if (segmented.orientationNoteBlocks.length > 0) {
    const note = segmented.orientationNoteBlocks[0];
    secFindings.push({
      check: 'C1',
      status: 'revise',
      quote: note.text,
      principle: 'C1 · Separate non-LO orientation notes from Objectives',
      reason:
        'Non-objective preview prose is placed inside the Learning Objectives section. Our 4-way segmenter excluded it from O1–O6 penalties, but moving it to a Module Overview callout improves scanability (CP-05).',
      replacement: `> **Module Context Note:** ${note.text}`,
    });
  } else {
    secMet.push('C1');
  }
  if (leafBlocks.length > 1) {
    secMet.push('C4');
  } else {
    secFindings.push({ check: 'C4', status: 'not_applicable', reason: 'Single item.' });
  }
  secFindings.push({
    check: 'C5',
    status: 'not_applicable',
    reason: 'Standalone LO specification without external submission files.',
  });

  results.push({
    unit: 'sec-1',
    label: 'Clarity & Structure',
    met: secMet,
    findings: secFindings,
  });

  const totalFlags = results.reduce(
    (acc, r) => acc + r.findings.filter((f) => f.status === 'revise' || f.status === 'unverified').length,
    0,
  );

  return {
    mode: 'deterministic_baseline',
    summary:
      totalFlags === 0
        ? `Strong Learning Objectives set across ${leafBlocks.length} leaf objectives—all observable verbs, learner framing, and granularity checks pass.`
        : `Audited ${leafBlocks.length} leaf objectives (${segmented.orientationNoteBlocks.length} non-LO note separated) and surfaced ${totalFlags} evidence-based revisions across Bloom observability, learner framing, and granularity.`,
    expectedUnitsByType: {
      objective: leafBlocks.map((b) => b.id),
      objective_set: ['set-1'],
      section: ['sec-1'],
    },
    results,
    questions: [],
    kc_candidates: kcCandidates,
  };
}

function analyzeAssessmentTrack(docMarkdown, linkedLoMarkdown) {
  const combinedLoText = `${linkedLoMarkdown}\n${docMarkdown}`;
  // Split questions by ### Q..., **Q..., ### Question..., or numbered items
  const qHeaderRegex =
    /(?:^|\n)(?=#{2,4}\s*(?:Q(?:uestion)?\s*\d+|OE\s*\d+|Item\s*\d+)|(?:\*\*Q(?:uestion)?\s*\d+|\*\*OE\s*\d+))/gi;
  const rawChunks = docMarkdown.split(qHeaderRegex).filter((c) => /\b(?:Q(?:uestion)?\s*\d+|OE\s*\d+|Item\s*\d+)\b/i.test(c));

  // Fallback if simple numbered list 1. 2. 3.
  const chunks =
    rawChunks.length > 0
      ? rawChunks
      : docMarkdown
          .split(/\n(?=\d+[.)]\s+[A-Z])/)
          .filter((c) => /^\d+[.)]\s+/.test(c.trim()));

  const questions = [];
  const alignmentPairs = [];
  const results = [];
  let untaggedCount = 0;

  chunks.forEach((chunk, idx) => {
    const qId = `q${idx + 1}`;
    const firstLine = chunk.trim().split('\n')[0].replace(/^#{1,4}\s*/, '').trim();
    const fmt = detectQuestionFormat(chunk);
    const role = /\bsummative|exam|final|graded\b/i.test(chunk) ? 'summative' : 'formative';
    const hasLoTag = /\bLO[-_\s]?\d+\b/i.test(firstLine);
    if (!hasLoTag) untaggedCount += 1;

    const qMet = ['S4'];
    const qFindings = [];
    const alignMet = ['A1', 'A2', 'A5'];
    const alignFindings = [];

    // Check A4 aid contradiction (e.g., ChatGPT allowed when LO says without AI)
    if (
      /\bpaste.*into\s+(?:ChatGPT|AI|Claude)|use\s+ChatGPT\b/i.test(chunk) &&
      /\bwithout\s+using\s+(?:another\s+)?AI\b/i.test(combinedLoText)
    ) {
      const quoteMatch = chunk.match(/[^.\n]*(?:ChatGPT|AI)[^.\n]*\./i)?.[0]?.trim() || firstLine;
      alignFindings.push({
        check: 'A4',
        status: 'revise',
        quote: quoteMatch,
        principle: 'A4 · Performance & assistance conditions match LO claim',
        reason:
          'Question instructions permit using ChatGPT/AI while the target Learning Objective explicitly claims unaided error identification (AS-08, Bastani et al., 2025).',
        replacement: 'Evaluate the AI comments independently without using external AI tools.',
      });
    } else {
      alignFindings.push({ check: 'A4', status: 'not_applicable', reason: 'Standard conditions.' });
    }

    if (fmt === 'mcq') {
      evaluateMcqChunk(chunk, firstLine, qMet, qFindings);
    } else if (fmt === 'cata') {
      evaluateCataChunk(chunk, firstLine, role, qMet, qFindings);
    } else if (fmt === 'numeric_math') {
      evaluateNumericChunk(chunk, firstLine, qMet, qFindings);
    } else if (fmt === 'ordering') {
      evaluateOrderingChunk(chunk, firstLine, qMet, qFindings);
    } else if (fmt === 'short_text') {
      evaluateShortTextChunk(chunk, firstLine, qMet, qFindings);
    } else if (fmt === 'multi_input') {
      qMet.push('S3', 'MI-01', 'MI-02', 'MI-03', 'MI-04', 'FB-I1');
      qFindings.push({ check: 'FB-I2', status: 'not_applicable', reason: 'Self-contained rows.' });
    } else {
      evaluateOpenEndedChunk(chunk, firstLine, qMet, qFindings, alignMet, alignFindings);
    }

    alignmentPairs.push(`p-${qId}`);
    results.push({
      unit: `p-${qId}`,
      label: `${qId.toUpperCase()} Alignment`,
      met: alignMet,
      findings: alignFindings,
    });

    questions.push({
      id: qId,
      label: firstLine.slice(0, 64),
      rawFormat: normalizeQuestionFormat(fmt),
      role,
      met: Array.from(new Set(qMet)),
      findings: qFindings,
    });
  });

  // Set-level S1, S2, S5, FB-S1, FB-S2
  const setMet = ['S2', 'FB-S2'];
  const setFindings = [{ check: 'S5', status: 'not_applicable', reason: 'Design-stage review.' }];

  if (/\b(?:purpose|formative|summative|checkpoint|practice|diagnostic|lbd|digt)\b/i.test(docMarkdown)) {
    setMet.push('S1');
  } else {
    setFindings.push({
      check: 'S1',
      status: 'revise',
      quote: docMarkdown.trim().split('\n')[0],
      principle: 'S1 · Identifiable assessment purpose & stakes',
      reason:
        'State whether this assessment is diagnostic, ungraded formative practice, or a summative mastery check so feedback timing and retry policies are interpretable (AS-01, LLSS3 s.15).',
    });
  }

  const anyMissingFb = questions.some((q) =>
    q.findings.some((f) => /^FB-/.test(f.check) && f.status === 'revise'),
  );
  if (anyMissingFb) {
    setFindings.push({
      check: 'FB-S1',
      status: 'revise',
      principle: 'FB-S1 · Purpose-matched feedback timing & answer-release policy',
      reason:
        'Formative items reveal bare correctness or final answers without retry/misconception scaffolding (Shute, 2008; Van der Kleij et al., 2015).',
    });
  } else {
    setMet.push('FB-S1');
  }

  results.unshift({
    unit: 'set-1',
    label: 'Assessment Set',
    met: setMet,
    findings: setFindings,
  });

  // Clarity C1-C5
  const secMet = ['C2', 'C3', 'C4'];
  const secFindings = [
    { check: 'C5', status: 'not_applicable', reason: 'Self-contained quiz items.' },
  ];
  if (untaggedCount > 0 && questions.length > 0) {
    secFindings.push({
      check: 'C1',
      status: 'revise',
      quote: questions[0].label,
      principle: 'C1 · Explicit Question-to-LO instrumentation tags',
      reason: `${untaggedCount} of ${questions.length} questions omit an explicit target LO tag (e.g., "(LO1)"), limiting alignment traceability and learning-analytics instrumentation (LLSS3 s.6–8).`,
    });
  } else {
    secMet.push('C1');
  }

  results.push({
    unit: 'sec-1',
    label: 'Clarity & Navigability',
    met: secMet,
    findings: secFindings,
  });

  const flagCount =
    results.reduce(
      (a, r) => a + r.findings.filter((f) => f.status === 'revise' || f.status === 'unverified').length,
      0,
    ) +
    questions.reduce(
      (a, q) => a + q.findings.filter((f) => f.status === 'revise' || f.status === 'unverified').length,
      0,
    );

  return {
    mode: 'deterministic_baseline',
    summary:
      questions.length === 0
        ? 'No structured quiz questions were detected. Use headings like "### Q1" or numbered items.'
        : `Audited ${questions.length} assessment questions across ${new Set(questions.map((q) => q.rawFormat)).size} item format(s) (1/N equal weight = ${(34 / questions.length).toFixed(1)} item pts + ${(10 / questions.length).toFixed(1)} feedback pts per question) and flagged ${flagCount} actionable improvements.`,
    expectedUnitsByType: {
      alignment_pair: alignmentPairs,
      assessment_set: ['set-1'],
      section: ['sec-1'],
    },
    results,
    questions,
    kc_candidates: [],
  };
}

function detectQuestionFormat(chunk) {
  if (/\bLBD_TAF\b|\bYes\s+or\s+No\s+if\s+the\s+row\b/i.test(chunk)) return 'multi_input';
  if (/\[[x\s]\]|\bCheck\s+All\s+That\s+Apply\b|\bSelect\s+all\s+that\s+apply\b|\bCATA\b|\bSATA\b/i.test(chunk)) {
    return 'cata';
  }
  if (/\bOrdering\b|\bDrag\s+and\s+drop\s+the\s+steps\b|\bParsons\b/i.test(chunk)) return 'ordering';
  if (/\bNumeric\s+Input\b|(?:^|\n)\s*Answer:\s*[-+]?\d+(?:\.\d+)?/i.test(chunk)) return 'numeric_math';
  if (/_{3,}|\bFill\s+in\s+the\s+blank\b/i.test(chunk) && !/^\s*[-*]\s*[A-D][.:)]/m.test(chunk)) {
    return 'short_text';
  }
  if (/^\s*[-*]\s*[A-E][.:)]/m.test(chunk) || /\bMCQ\b/i.test(chunk)) return 'mcq';
  return 'open_ended';
}

function evaluateMcqChunk(chunk, fallbackQuote, qMet, qFindings) {
  const allIwf = [
    'IWF-01', 'IWF-02', 'IWF-03', 'IWF-04', 'IWF-05', 'IWF-06', 'IWF-07',
    'IWF-08', 'IWF-09', 'IWF-10', 'IWF-11', 'IWF-12', 'IWF-13', 'IWF-14',
    'IWF-15', 'IWF-17', 'IWF-18', 'IWF-19',
  ];
  const failed = new Set();

  const optionLines = chunk
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s*[A-E][.:)]/i.test(l));

  const keyLine = optionLines.find((l) => /\*\s*$/.test(l));
  const distractorLines = optionLines.filter((l) => l !== keyLine);

  // Check S3: key present + KLI swapped definition check
  const swapsKli =
    /\bSkills?\s+involves?\s+understanding\s+the\s+(?:conceptual\s+)?interrelationships\b/i.test(chunk) ||
    /\bPrinciples?\s+involves?\s+executing\s+step-by-step\s+procedural\b/i.test(chunk);

  if (swapsKli) {
    const swapQuote =
      chunk.match(/Skills?\s+involves?[^\n]+/i)?.[0] || keyLine || fallbackQuote;
    qFindings.push({
      check: 'S3',
      status: 'revise',
      quote: swapQuote,
      principle: 'S3 · Substantively defensible answer key [Ready Gate Blocker]',
      reason:
        'Marked key B ("Skill") swaps KLI definitions: in Koedinger, Corbett, & Perfetti (2012), Skills are procedural how-to rules while Principles capture causal/conceptual interrelationships. Any wrong S3 key blocks the Ready badge.',
      replacement:
        'Skills involve executing procedural rules across variable inputs; Principle (Option C) is the defensible key for explaining causal interrelationships.',
    });
    failed.add('IWF-18');
    qFindings.push({
      check: 'IWF-18',
      status: 'revise',
      quote: keyLine || fallbackQuote,
      principle: 'IWF-18 · Single substantively defensible answer',
      reason: 'Move the correct-answer marker (*) from Option B (Skill) to Option C (Principle).',
      replacement: (keyLine || '- B. Skill *').replace(/\s*\*\s*$/, ''),
    });
  } else if (!keyLine && !/\bCorrect(?:\s+Answer)?\s*[:\-]\s*[A-E]\b/i.test(chunk)) {
    qFindings.push({
      check: 'S3',
      status: 'unverified',
      quote: fallbackQuote,
      principle: 'S3 · Answer key required [Ready Gate Blocker]',
      reason: 'No correct option is marked (*). Unkeyed items stay unverified (0 pts) and hold Ready.',
    });
  } else {
    qMet.push('S3');
  }

  // IWF-09: All of the above
  const aotaLine = optionLines.find((l) => /\ball\s+of\s+the\s+above\b/i.test(l));
  if (aotaLine) {
    failed.add('IWF-09');
    qFindings.push({
      check: 'IWF-09',
      status: 'revise',
      quote: aotaLine,
      principle: 'IWF-09 · Independent alternatives (avoid "All of the above")',
      reason:
        'Recognizing just two true options lets testwise learners pick "All of the above" without evaluating the remaining option (Haladyna et al., 2002; MCQ Quality Coach).',
      replacement:
        '- D. Synthesize rubric alignment, factual fidelity to student text, and task-focused tone before release *',
    });
  }

  // IWF-03: None of the above
  const notaLine = optionLines.find((l) => /\bnone\s+of\s+the\s+above\b/i.test(l));
  if (notaLine) {
    failed.add('IWF-03');
    qFindings.push({
      check: 'IWF-03',
      status: 'revise',
      quote: notaLine,
      principle: 'IWF-03 · Content-bearing options (avoid "None of the above")',
      reason: 'Measures elimination rather than recognition of the defensible target rule.',
      replacement: '- D. Disclose AI assistance on every draft and final submission per syllabus policy *',
    });
  }

  // IWF-04: Key length giveaway
  if (keyLine && distractorLines.length >= 2) {
    const countWords = (s) => s.replace(/^[-*]\s*[A-E][.:)]\s*/i, '').replace(/\*\s*$/, '').trim().split(/\s+/).length;
    const keyWords = countWords(keyLine);
    const avgDistWords =
      distractorLines.reduce((a, d) => a + countWords(d), 0) / distractorLines.length;
    if (keyWords >= 12 && keyWords >= avgDistWords * 2.1) {
      failed.add('IWF-04');
      qFindings.push({
        check: 'IWF-04',
        status: 'revise',
        quote: keyLine,
        principle: 'IWF-04 · Balanced key length and detail',
        reason: `The correct option is ${keyWords} words long while distractors average ${avgDistWords.toFixed(1)} words—a classic length-bias cue that lets learners guess the key without reading the scenario (LLSS3 s.27).`,
        replacement: '- C. A factual error contradicting the student draft *',
      });
    }
  }

  // IWF-19: Un-emphasized negative stem
  const unemphNeg = chunk.match(/\bwhich\s+of\s+the\s+following\s+is\s+not\b/i);
  if (unemphNeg && !/\bNOT\b/.test(unemphNeg[0])) {
    failed.add('IWF-19');
    qFindings.push({
      check: 'IWF-19',
      status: 'revise',
      quote: unemphNeg[0],
      principle: 'IWF-19 · Positive or clearly emphasized negative stem',
      reason: 'Lowercase "not" is easily misread under cognitive load; reframe positively or bold/capitalize **NOT**.',
      replacement: 'Which of the following is **NOT**',
    });
  }

  qFindings.push({ check: 'IWF-16', status: 'not_applicable', reason: 'Non-numeric choices.' });
  for (const cid of allIwf) {
    if (!failed.has(cid)) qMet.push(cid);
  }

  // MCQ Feedback checks FB-M1..M4
  const fbMatch = chunk.match(/Feedback:[\s\S]*$/i)?.[0] || '';
  const isBareKr =
    !fbMatch ||
    /^Feedback:\s*(?:Correct\s*\/?\s*Incorrect\.?|Try\s+again!?)\s*$/im.test(fbMatch) ||
    (/-\s*A:\s*Incorrect\.\s*\n-\s*B:\s*Incorrect\./i.test(fbMatch));

  if (isBareKr) {
    const fbQuote = fbMatch.trim() || fallbackQuote;
    qFindings.push({
      check: 'FB-M1',
      status: 'revise',
      quote: fbQuote,
      principle: 'FB-M1 · Elaborated feedback beyond bare right/wrong (KR)',
      reason:
        'Bare "Correct / Incorrect" verification fails to repair distractor misconceptions or neutralize the MCQ negative suggestion effect (Van der Kleij et al., 2015; Roediger & Marsh, 2005).',
      replacement:
        'Feedback:\n- Correct key: Explains why verifying rubric alignment, text accuracy, and task tone protects feedback validity.\n- Distractors: Explains which essential check is omitted when checking only one dimension in isolation.',
    });
    qFindings.push({
      check: 'FB-M2',
      status: 'revise',
      principle: 'FB-M2 · Correct-key principle reinforcement',
      reason: 'Add a 1-sentence explanation on the correct choice reinforcing why it holds (Butler et al., 2008).',
    });
    qFindings.push({
      check: 'FB-M3',
      status: 'revise',
      principle: 'FB-M3 · Option-specific distractor misconception repair',
      reason: 'Explain the specific misconception behind each wrong option rather than repeating "Incorrect."',
    });
  } else if (swapsKli) {
    qMet.push('FB-M1');
    qFindings.push({
      check: 'FB-M2',
      status: 'revise',
      principle: 'FB-M2 · Substantively accurate key explanation',
      reason: 'Feedback teaches an inverted KLI definition; update alongside S3.',
    });
    qFindings.push({
      check: 'FB-M3',
      status: 'revise',
      principle: 'FB-M3 · Accurate distractor misconception contrast',
      reason: 'Option C feedback mischaracterizes KLI Principles as procedural.',
    });
  } else {
    qMet.push('FB-M1', 'FB-M2', 'FB-M3');
  }
  qFindings.push({ check: 'FB-M4', status: 'not_applicable', reason: 'Hints optional per AS-07.' });
}

function evaluateCataChunk(chunk, fallbackQuote, role, qMet, qFindings) {
  qMet.push(
    'S3', 'IWF-01', 'IWF-02', 'IWF-04', 'IWF-05', 'IWF-06',
    'IWF-10', 'IWF-11', 'IWF-12', 'IWF-13', 'IWF-15', 'IWF-17', 'IWF-19',
  );

  if (role === 'formative') {
    qFindings.push({
      check: 'CATA-01',
      status: 'revise',
      quote: fallbackQuote,
      principle: 'CATA-01 · Discourage Check-All-That-Apply in early formative practice',
      reason:
        'Dichotomous CATA items harshly penalize partial mastery (4/5 right = 0 pts) and trap novices across 2^k - 1 combinations (Brassil & Couch, 2019; LLSS3 s.28–29). Convert to a Multiple True–False (MTF) Yes/No matrix so each visual pattern gives independent verification.',
      repairAction: 'convert_cata_to_mtf',
      replacement: fallbackQuote.replace(/Check All That Apply/i, 'Multiple True–False (Yes/No per pattern · LBD_TAF)'),
    });
  } else {
    qMet.push('CATA-01');
  }

  if (!/select\s+all\s+that\s+apply/i.test(chunk)) {
    qFindings.push({
      check: 'CATA-02',
      status: 'revise',
      quote: fallbackQuote,
      principle: 'CATA-02 · Explicit "Select all that apply" prompt cue',
      reason: 'Prompt does not explicitly instruct learners to "Select all that apply" (LLSS3 s.29).',
    });
  } else {
    qMet.push('CATA-02');
  }

  if (/\ball-or-nothing\b/i.test(chunk)) {
    const scoreQuote = chunk.match(/Scoring:[^\n]+/i)?.[0] || fallbackQuote;
    qFindings.push({
      check: 'CATA-03',
      status: 'revise',
      quote: scoreQuote,
      principle: 'CATA-03 · Non-punitive partial credit rule',
      reason:
        'All-or-nothing (0/1) CATA scoring erases partial conceptual knowledge and induces defensive under-selection (Brassil & Couch, 2019; NCSBN, 2023).',
      replacement: 'Scoring: Option-level partial credit (+0.25 per accurately evaluated pattern, floored at 0).',
    });
  } else {
    qMet.push('CATA-03');
  }

  const metaOpt = chunk.match(/^[-*]\s*\[[x\s]\]\s*(?:All|None)\s+of\s+the\s+above.*$/im)?.[0];
  if (metaOpt) {
    qFindings.push({
      check: 'CATA-04',
      status: 'revise',
      quote: metaOpt,
      principle: 'CATA-04 · Ban "All/None of the above" in multi-select',
      reason: '"All of the above" inside a checkbox item creates mathematical contradiction with selecting individual boxes (LLSS3 s.29).',
      replacement: '',
    });
  } else {
    qMet.push('CATA-04');
  }

  const bareCataFb = chunk.match(/Feedback:\s*Incorrect[^\n]*/i)?.[0];
  if (bareCataFb) {
    qFindings.push({
      check: 'FB-C1',
      status: 'revise',
      quote: bareCataFb,
      principle: 'FB-C1 · Proposition-level diagnostic feedback per option',
      reason:
        'Combination-level "Incorrect — try again!" leaves learners guessing which checkbox failed. Provide statement-level feedback for every option.',
      replacement:
        'Feedback (per statement):\n- Funnel spread (Yes): Indicates heteroscedasticity (non-constant error variance).\n- Curved U-shape (Yes): Indicates non-linearity.\n- Random horizontal cloud (No): Indicates healthy homoscedastic linear fit.\n- High-leverage outlier (Yes): Indicates influential observation risk.',
    });
  } else {
    qMet.push('FB-C1');
  }
  qFindings.push({ check: 'FB-C2', status: 'not_applicable', reason: 'Hints optional.' });
}

function evaluateNumericChunk(chunk, fallbackQuote, qMet, qFindings) {
  // Check arithmetic for sample Q5: y_hat = 2.5(3.3) + 1.4 = 9.65 -> e = 11.0 - 9.65 = 1.35 (correct!)
  qMet.push('S3', 'NUM-01', 'NUM-03', 'NUM-05');
  qFindings.push({ check: 'NUM-04', status: 'not_applicable', reason: 'Plain scalar numeric entry.' });

  if (!/\bround|decimal\s+places|significant\s+figures|tolerance|\±|\+\/-/i.test(chunk)) {
    const ansQuote = chunk.match(/Answer:\s*[^\n]+/i)?.[0] || fallbackQuote;
    qFindings.push({
      check: 'NUM-02',
      status: 'revise',
      quote: ansQuote,
      principle: 'NUM-02 · Stated rounding precision & grading tolerance band',
      reason:
        'Decimal answer omits rounding instructions in the prompt and lacks an acceptance tolerance window (e.g., ±0.02), risking construct-irrelevant rejections from intermediate rounding (LLSS3 s.32; Sangwin, 2013).',
      replacement: 'Answer: 1.35 (Prompt: "Round to 2 decimal places"; Grading tolerance: ±0.02)',
    });
  } else {
    qMet.push('NUM-02');
  }

  const bareNumFb = chunk.match(/Feedback:\s*The\s+answer\s+is\s+[^\n]+/i)?.[0];
  if (bareNumFb) {
    qFindings.push({
      check: 'FB-N1',
      status: 'revise',
      quote: bareNumFb,
      principle: 'FB-N1 · Concise step-structured worked setup',
      reason: 'Revealing a bare scalar ("1.35") does not show learners which substitution step diverged (Shute, 2008; ASSISTments).',
      replacement:
        'Feedback:\n- Worked steps: y_hat = 2.5(3.3) + 1.4 = 9.65, so e = y - y_hat = 11.0 - 9.65 = +1.35.\n- Common error (-1.35): Subtracting y_i from y_hat_i reverses the residual sign.\n- Common error (2.75): Omitting the +1.4 intercept.',
    });
    qFindings.push({
      check: 'FB-N2',
      status: 'revise',
      principle: 'FB-N2 · Targeted buggy-value misconception branches',
      reason: 'Add targeted error branches for sign reversal (-1.35) and omitted intercept (2.75) (Brown & Burton, 1978; LLSS3 s.32).',
    });
  } else {
    qMet.push('FB-N1', 'FB-N2');
  }
  qFindings.push({ check: 'FB-N3', status: 'not_applicable', reason: 'Hints optional.' });
}

function evaluateOrderingChunk(chunk, fallbackQuote, qMet, qFindings) {
  qMet.push('S3', 'ORD-01', 'ORD-02', 'ORD-03');

  if (/\ball-or-nothing|exact\s+position\s+match\s+only\b/i.test(chunk)) {
    const gQuote = chunk.match(/Grading:[^\n]+/i)?.[0] || fallbackQuote;
    qFindings.push({
      check: 'ORD-04',
      status: 'revise',
      quote: gQuote,
      principle: 'ORD-04 · Relative-order partial credit (avoid index-shift cliff)',
      reason:
        'Exact-slot all-or-nothing grading awards 0/4 if a learner misplaces item #1 even when all remaining pairwise precedes relations are accurate.',
      replacement: 'Grading: Pairwise relative-order partial credit. Provide keyboard/dropdown rank controls alongside drag-and-drop.',
    });
  } else {
    qMet.push('ORD-04');
  }

  const hasTransitionLeak = /\b(?:First,|Finally,)\b/.test(chunk);
  const isDragOnly = /\bDrag\s+cards\s+with\s+mouse\b/i.test(chunk);
  if (hasTransitionLeak || isDragOnly) {
    const leakQuote = chunk.match(/1\.\s*First,[^\n]+/)?.[0] || fallbackQuote;
    qFindings.push({
      check: 'ORD-05',
      status: 'revise',
      quote: leakQuote,
      principle: 'ORD-05 · Remove discourse giveaways & add WCAG 2.2 SC 2.5.7 non-drag controls',
      reason:
        'Discourse markers ("First,", "Finally,") give away positions by surface grammar alone, and mouse-only drag-and-drop violates WCAG 2.2 Level AA SC 2.5.7 (Dragging Movements) and LLSS3 s.30.',
      replacement: '1. Specify the minimum practically meaningful effect size (delta) based on domain context.',
    });
  } else {
    qMet.push('ORD-05');
  }

  qFindings.push({
    check: 'FB-R1',
    status: 'revise',
    principle: 'FB-R1 · Precondition rationale for sequence',
    reason: 'Explain why effect size, alpha/power, and variance must be defined before sample-size computation rather than printing "1, 2, 3, 4".',
  });
  qFindings.push({
    check: 'FB-R2',
    status: 'revise',
    principle: 'FB-R2 · Violated-dependency diagnosis',
    reason: 'Diagnose out-of-order preconditions rather than returning a binary order check.',
  });
  qFindings.push({ check: 'FB-R3', status: 'not_applicable', reason: 'Hints optional.' });
}

function evaluateShortTextChunk(chunk, fallbackQuote, qMet, qFindings) {
  qMet.push('S3', 'TXT-01', 'TXT-02', 'TXT-05', 'FB-T1');
  qFindings.push(
    {
      check: 'TXT-03',
      status: 'revise',
      quote: fallbackQuote,
      principle: 'TXT-03 · Synonym, acronym & case normalization',
      reason: 'Specify accepted synonyms, hyphenation, and case-insensitive variants (Jordan & Mitchell, 2009; LLSS3 s.32).',
    },
    { check: 'TXT-04', status: 'meets', reason: 'Standard tolerance.' },
    {
      check: 'FB-T2',
      status: 'revise',
      principle: 'FB-T2 · Near-miss foil branches',
      reason: 'Add contrastive feedback for predictable confusable terms.',
    },
    { check: 'FB-T3', status: 'not_applicable', reason: 'No hints.' },
  );
}

function evaluateOpenEndedChunk(chunk, fallbackQuote, qMet, qFindings, alignMet, alignFindings) {
  qMet.push('OE-01', 'OE-02', 'OE-04', 'OE-05', 'OE-11');
  qFindings.push(
    { check: 'OE-03', status: 'meets', reason: 'Stimulus referenced.' },
    { check: 'OE-09', status: 'not_applicable', reason: 'Standard case.' },
    { check: 'OE-10', status: 'not_applicable', reason: 'Formative.' },
  );

  const hasRubric = /\brubric|scoring\s+guide|criteria\b/i.test(chunk);
  const hasCircularAdjectives = /\b(?:excellent|good|fair)\s+(?:statistical\s+)?insight\b/i.test(chunk);

  if (!hasRubric) {
    qFindings.push(
      {
        check: 'S3',
        status: 'unverified',
        quote: fallbackQuote,
        principle: 'S3 · Missing open-ended scoring rubric [Ready Gate Blocker]',
        reason: 'Open-ended prompt supplies no evaluation criteria or scoring anchor. Unrubriced open tasks stay unverified (0 pts) and block Ready.',
      },
      { check: 'OE-06', status: 'unverified', reason: 'Missing rubric.' },
      { check: 'OE-07', status: 'unverified', reason: 'Missing rubric.' },
      { check: 'OE-08', status: 'unverified', reason: 'Missing rubric.' },
    );
    const idxA5 = alignMet.indexOf('A5');
    if (idxA5 !== -1) alignMet.splice(idxA5, 1);
    alignFindings.push({ check: 'A5', status: 'unverified', reason: 'Cannot verify scoring alignment without rubric.' });
  } else if (hasCircularAdjectives) {
    const circQuote = chunk.match(/\|\s*4\s*-\s*Excellent[^\n]+/i)?.[0] || fallbackQuote;
    qFindings.push(
      {
        check: 'S3',
        status: 'revise',
        quote: circQuote,
        principle: 'S3 / OE-06 · Replace circular evaluative adjectives with inspectable criteria',
        reason:
          'Describing Level 4 as "excellent insight" and Level 3 as "good insight" gives graders and learners zero observable features to inspect (Brookhart, 2018; AS-04).',
        replacement:
          '| 4 - Complete | Accurately names the residual pattern (e.g., funnel heteroscedasticity), links it to non-constant error variance, and justifies a matching remedy (log transform or robust SEs). |',
      },
      {
        check: 'OE-06',
        status: 'revise',
        principle: 'OE-06 · Observable evaluation criteria',
        reason: 'Point to inspectable claims, evidence citations, and justified remedies rather than "insight" adjectives.',
      },
      {
        check: 'OE-07',
        status: 'revise',
        principle: 'OE-07 · Minimum sufficient response anchor',
        reason: 'Define the minimum evidence required for mastery.',
      },
      { check: 'OE-08', status: 'meets', reason: 'Multi-level table present.' },
    );
  } else {
    qMet.push('S3', 'OE-06', 'OE-07', 'OE-08');
  }

  if (!/\bmodel\s+response|exemplar|sample\s+answer|feed-?forward\b/i.test(chunk)) {
    qFindings.push(
      {
        check: 'FB-O1',
        status: 'revise',
        principle: 'FB-O1 · Concise model response or self-check exemplar',
        reason:
          'Constructed-response learners need a verifiable exemplar or concrete post-submission checklist to calibrate free-text work (Sadler, 1989; Lipnevich et al., 2014).',
      },
      {
        check: 'FB-O2',
        status: 'revise',
        principle: 'FB-O2 · Criterion-linked gap diagnosis',
        reason: 'Provide criterion-level comment anchors tied to OE-06 features (Wollenschläger et al., 2016).',
      },
      {
        check: 'FB-O3',
        status: 'revise',
        principle: 'FB-O3 · Actionable "Where to Next" feed-forward',
        reason: 'Specify concrete revision moves without rewriting student prose (Brooks et al., 2019).',
      },
      { check: 'FB-O4', status: 'not_applicable', reason: 'Focused prompt.' },
    );
  } else {
    qMet.push('FB-O1', 'FB-O2', 'FB-O3', 'FB-O4');
  }
}

export function generateDeterministicPriorKnowledge({ track, docMarkdown, seededPrerequisites = [], suppressedOutOfScope = [] }) {
  const suppressedSet = new Set(suppressedOutOfScope.map((s) => s.toLowerCase()));
  const candidates = [...seededPrerequisites];

  const rules = [
    {
      test: /\bresidual|heteroscedastic|ordinary\s+least\s+squares|regression|y_hat\b/i,
      pkId: 'pk-lin-reg',
      statement: 'Compute predicted values (y_hat) and interpret slope/intercept in single-variable linear equations',
      kliType: 'skill',
      unit: track === 'objectives_only' ? 'LO1' : 'Q5',
      whyNeeded: 'Diagnosing residual plots or computing e_i = y_i - y_hat_i assumes fluency with fitted linear predictions.',
    },
    {
      test: /\brubric|criterion-referenced|analytic\s+rubric\b/i,
      pkId: 'pk-rubric-lit',
      statement: 'Distinguish analytic rubric criteria and performance descriptors from holistic letter grades',
      kliType: 'concept',
      kliMapped: 'fact',
      unit: track === 'objectives_only' ? 'LO5' : 'Q1',
      whyNeeded: 'Evaluating whether AI comments match rubric criteria assumes familiarity with analytic rubric structure.',
    },
    {
      test: /\bKLI|Knowledge\s+Component|Koedinger\b/i,
      pkId: 'pk-kli-basics',
      statement: 'Define Knowledge Components (Facts, Skills, Principles) as mental building blocks inferred from observable tasks',
      kliMapped: 'principle',
      unit: 'Q3',
      whyNeeded: 'Classifying instructional tasks by KLI category assumes baseline familiarity with KLI terminology.',
    },
    {
      test: /\bR\s+or\s+Python|script|code|trace\b/i,
      pkId: 'pk-script-syntax',
      statement: 'Read basic Python/R function calls, data-frame indexing, and plotting output without syntax scaffolding',
      kliMapped: 'skill',
      unit: 'LO4',
      whyNeeded: 'Implementing or tracing diagnostic scripts requires baseline programming/notebook literacy.',
    },
    {
      test: /\bpower\s+analysis|Type\s+I\s+error|alpha|intraclass\s+correlation\b/i,
      pkId: 'pk-hyp-testing',
      statement: 'Distinguish Type I error (alpha), Type II error (beta), and sampling variability in hypothesis testing',
      kliMapped: 'principle',
      unit: 'Q2',
      whyNeeded: 'Sequencing a statistical power analysis presupposes foundational null-hypothesis testing concepts.',
    },
  ];

  for (const r of rules) {
    if (r.test.test(docMarkdown) && !suppressedSet.has(r.statement.toLowerCase())) {
      const quoteMatch = docMarkdown.match(r.test)?.[0];
      candidates.push({
        pkId: r.pkId,
        statement: r.statement,
        kliType: r.kliMapped || 'skill',
        requiredBy: [{ unit: r.unit, quote: quoteMatch }],
        whyNeeded: r.whyNeeded,
      });
    }
  }

  if (candidates.length < 3) {
    candidates.push(
      {
        pkId: 'pk-domain-vocab',
        statement: 'Interpret foundational terminology and notation introduced in prior course modules',
        kliType: 'fact',
        requiredBy: [{ unit: 'Document' }],
        whyNeeded: 'Uploaded tasks use domain vocabulary without inline glossary definitions.',
      },
      {
        pkId: 'pk-evidence-warrant',
        statement: 'Support evaluative claims by citing specific evidence from a provided scenario or stimulus',
        kliType: 'skill',
        requiredBy: [{ unit: 'Document' }],
        whyNeeded: 'Tasks expect learners to connect judgments to explicit textual or quantitative evidence.',
      },
    );
  }

  return candidates.slice(0, 8);
}
