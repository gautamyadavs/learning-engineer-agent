import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  checkMissingLoGate,
  segmentObjectiveBlocks,
  normalizeQuestionFormat,
  computeTrackScore,
  evaluatePriorKnowledgeAudit,
  markRemainingPrerequisitesHave,
  reconcileKliKcScope,
  preparePriorKnowledgeSeedFromKcs,
  buildRemediationPlacementPreview,
  buildPromotePrerequisiteToLoPreview,
} from './scorer.ts';
import type { RubricSpec, PriorKnowledgeItem } from './scorer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rubricPath = resolve(__dirname, '../../../docs/rubric/rubric-v0.3.json');
const rubric: RubricSpec = JSON.parse(readFileSync(rubricPath, 'utf8'));

describe('rubric-v0.3.json structural invariants', () => {
  it('allocates exactly 100 points (94 visible + 6 PK-1) on all 4 tracks and validates all 7 question formats', () => {
    assert.equal(rubric.rubric_version, '0.3.0');
    assert.equal(rubric.credit_rule?.document_checks, 'proportional_unit_credit');
    assert.equal(
      rubric.credit_rule?.assessment_question_distribution,
      'equal_1_over_N_per_question',
    );

    const checkIds = new Set(rubric.checks.map((c) => c.id));
    for (const [trackKey, spec] of Object.entries(rubric.tracks)) {
      const total = Object.values(spec.dimension_budgets).reduce((a, b) => a + b, 0);
      assert.equal(total, 100, `Track ${trackKey} must total 100 points`);
      assert.equal(spec.dimension_budgets.prior_knowledge, 6);
    }

    assert.ok(rubric.question_formats);
    const expectedFormats = [
      'mcq',
      'open_ended',
      'cata',
      'numeric_math',
      'short_text',
      'ordering',
      'multi_input',
    ] as const;
    for (const fmt of expectedFormats) {
      const fSpec = rubric.question_formats![fmt];
      assert.ok(fSpec, `Missing format spec for ${fmt}`);
      for (const cid of [...fSpec.item_check_ids, ...fSpec.feedback_check_ids]) {
        assert.ok(checkIds.has(cid), `Format ${fmt} references unknown check ${cid}`);
      }
    }
  });
});

describe('Missing-LO pre-review gate (0 LLM calls)', () => {
  it('blocks Assessment/Lesson/Module review with 3 frictionless options when LOs are absent', () => {
    const res = checkMissingLoGate({
      track: 'assessment_quiz',
      docMarkdown: '# Quiz 1\n\n1. Which graph shows a skewed distribution?',
    });
    assert.equal(res.readyToReview, false);
    assert.equal(res.llmCallsMade, 0);
    assert.deepEqual(res.promptActions, [
      'pick_workspace_lo_doc',
      'paste_inline_los',
      'facilitator_draft_los',
    ]);
  });

  it('passes silently for linked Workspace LO docs AND inline OLI Learning Objective table rows', () => {
    const linked = checkMissingLoGate({
      track: 'assessment_quiz',
      docMarkdown: '# Quiz 1\n\n1. Explain residual error.',
      linkedWorkspaceLoDocId: 'doc-lo-1',
      linkedWorkspaceLoMarkdown: '## Learning Objectives\n- LO1: Interpret residual plots.',
    });
    assert.equal(linked.readyToReview, true);
    assert.equal(linked.loSource, 'linked_workspace_doc');

    const oliTable = checkMissingLoGate({
      track: 'assessment_quiz',
      docMarkdown: '| **Learning Objective** | Use CTA to dissect LOs into KCs | |\n| --- | --- | --- |',
    });
    assert.equal(oliTable.readyToReview, true);
    assert.equal(oliTable.loSource, 'inline');
  });
});

describe('Track 1: 4-way Objective segmentation, KLI KC piping & PK Audit', () => {
  it('separates leaf LOs, umbrella parent headers, author-written KCs, and orientation notes', () => {
    const seg = segmentObjectiveBlocks([
      {
        id: 'p01-note',
        text: 'Mechanism preview for P02 (N01): token generation and retrieval contribute to a response.',
      },
      { id: 'goal-4', text: '4. Consider contextual features of learning environments' },
      {
        id: 'goal-4.1',
        parentId: 'goal-4',
        text: '4.1 Identify and explain strategies to create a positive learning climate',
      },
      {
        id: 'kc-1.1',
        text: 'KC 1.1: Distinguish between perceived affordances, feedforward, and inherent feedback',
      },
    ]);

    assert.deepEqual(seg.scoredLeafLoIds, ['goal-4.1']);
    assert.deepEqual(seg.umbrellaHeaderIds, ['goal-4']);
    assert.equal(seg.authorKcBlocks.length, 1);
    assert.equal(seg.orientationNoteBlocks.length, 1);
  });

  it('eliminates frozen-score cliff via 100% proportional unit credit on a 28-sub-LO syllabus', () => {
    const leafUnits = Array.from({ length: 28 }, (_, i) => `lo-${i + 1}`);
    const results = leafUnits.map((u, idx) => ({
      unit: u,
      met: [
        'O1',
        ...(idx < 26 ? ['O2'] : []),
        ...(idx < 25 ? ['O3'] : []),
        'O4',
        'O5',
        'O6',
      ],
      findings: [
        ...(idx >= 26 ? [{ check: 'O2', status: 'revise' as const, reason: 'Enhance ability.' }] : []),
        ...(idx >= 25 ? [{ check: 'O3', status: 'revise' as const, reason: 'Laundry list.' }] : []),
      ],
    }));

    const out = computeTrackScore({
      rubric,
      track: 'objectives_only',
      loContextSatisfied: true,
      expectedUnitsByType: {
        objective: leafUnits,
        objective_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        ...results,
        { unit: 'set-1', met: [], findings: [{ check: 'O7', status: 'revise', reason: 'Dupes.' }] },
        {
          unit: 'sec-1',
          met: ['C1', 'C2', 'C3', 'C4'],
          findings: [{ check: 'C5', status: 'not_applicable', reason: 'Pure LOs.' }],
        },
      ],
    });

    assert.equal(out.displayScore, 82);
  });

  it('pipes KLI KC prerequisite / out_of_scope choices into Prior Knowledge Audit and caps at 10', () => {
    const kcSummary = reconcileKliKcScope(
      [
        {
          kcId: 'author-kc-2.1',
          loUnit: 'lo2',
          statement: "Apply Fitts's Law qualitatively",
          kliType: 'skill',
          origin: 'author_authored',
        },
        {
          kcId: 'ai-kc-prereq',
          loUnit: 'lo3',
          statement: 'Distinguish client state from server latency',
          kliType: 'principle',
          origin: 'ai_proposed',
        },
      ],
      { 'ai-kc-prereq': 'prerequisite' },
    );

    const pkSeed = preparePriorKnowledgeSeedFromKcs(kcSummary);
    assert.equal(pkSeed.seededPrerequisiteItems.length, 1);

    const twelveItems: PriorKnowledgeItem[] = Array.from({ length: 12 }, (_, idx) => ({
      pkId: `pk-${idx + 1}`,
      statement: `Prerequisite #${idx + 1}`,
      kliType: 'skill',
      requiredBy: [{ unit: 'q1' }],
      whyNeeded: 'Assumed by quiz scenario.',
    }));

    const batchTriaged = markRemainingPrerequisitesHave({
      auditHasRun: true,
      items: twelveItems,
      triage: { 'pk-1': { decision: 'most_lack' } },
    });

    const promotePreview = buildPromotePrerequisiteToLoPreview({
      loDocMarkdown: '## Learning Objectives\n\n- **LO1:** Evaluate model residuals.',
      newLoId: 'LO0',
      proposedLoStatement: 'Interpret slope and intercept in linear equations.',
    });

    const companionPreview = buildRemediationPlacementPreview({
      placement: 'companion_workspace_doc',
      currentDocTitle: 'Quiz 1',
      currentDocMarkdown: '# Quiz 1',
      remediationMarkdown: 'Quick algebra refresher.',
    });
    assert.equal(companionPreview.companionWorkspaceDoc?.track, 'lesson_activity');

    const resolved = evaluatePriorKnowledgeAudit({
      auditHasRun: true,
      items: twelveItems,
      triage: {
        ...batchTriaged,
        'pk-1': {
          decision: 'most_lack',
          resolution: {
            path: 'promoted_to_lo',
            promotedLoId: 'LO0',
            promotedLoText: promotePreview.promotedLoLine,
            targetLoDocId: 'doc-lo',
            appliedVersionId: 'v2',
          },
        },
      },
    });
    assert.equal(resolved.pkCheckEarned, true);
    assert.equal(resolved.totalItems, 10);
    assert.equal(resolved.triggersNewLoBaseline, true);
  });
});

describe('Track 2: 7-format 1/N equal distribution, Feedback dimension & secure-exam N/A renormalization', () => {
  it('distributes 34/N item pts and 10/N format-feedback pts equally across all 7 question formats', () => {
    // 7 questions: 1 of each supported format, all meeting 100% of their applicable checks
    // (with minor_risk on Q1 MCQ verifying minor_risk deducts 0 pts!)
    const out = computeTrackScore({
      rubric,
      track: 'assessment_quiz',
      loContextSatisfied: true,
      expectedUnitsByType: {
        alignment_pair: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
        assessment_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((u) => ({
          unit: u,
          met: ['A1', 'A2', 'A5'],
          findings: [{ check: 'A4', status: 'not_applicable' as const, reason: 'No special tools.' }],
        })),
        {
          unit: 'set-1',
          met: ['S1', 'S2', 'FB-S1', 'FB-S2'],
          findings: [{ check: 'S5', status: 'not_applicable', reason: 'Formative.' }],
        },
        {
          unit: 'sec-1',
          met: ['C1', 'C2', 'C3', 'C4'],
          findings: [{ check: 'C5', status: 'not_applicable', reason: 'Inline quiz.' }],
        },
      ],
      questions: [
        {
          id: 'q1-mcq',
          rawFormat: 'LBD_MCQ',
          role: 'formative',
          met: [
            'S3', 'S4',
            'IWF-01', 'IWF-02', 'IWF-03', 'IWF-05', 'IWF-06', 'IWF-07', 'IWF-08', 'IWF-09',
            'IWF-10', 'IWF-11', 'IWF-12', 'IWF-13', 'IWF-14', 'IWF-15', 'IWF-17', 'IWF-18', 'IWF-19',
            'FB-M1', 'FB-M2', 'FB-M3',
          ],
          findings: [
            { check: 'IWF-04', status: 'minor_risk', reason: 'Key is 3 words longer than foils.' },
            { check: 'IWF-16', status: 'not_applicable', reason: 'Non-numeric options.' },
            { check: 'FB-M4', status: 'not_applicable', reason: 'Hints omitted.' },
          ],
        },
        {
          id: 'q2-oe',
          rawFormat: 'open_ended',
          met: [
            'S3', 'S4',
            'OE-01', 'OE-02', 'OE-03', 'OE-04', 'OE-05', 'OE-06', 'OE-07', 'OE-08', 'OE-09', 'OE-10', 'OE-11',
            'FB-O1', 'FB-O2', 'FB-O3', 'FB-O4',
          ],
        },
        {
          id: 'q3-cata',
          rawFormat: 'CATA',
          role: 'summative',
          met: [
            'S3', 'S4',
            'CATA-01', 'CATA-02', 'CATA-03', 'CATA-04',
            'IWF-01', 'IWF-02', 'IWF-04', 'IWF-05', 'IWF-06', 'IWF-10',
            'IWF-11', 'IWF-12', 'IWF-13', 'IWF-15', 'IWF-17', 'IWF-19',
            'FB-C1',
          ],
          findings: [{ check: 'FB-C2', status: 'not_applicable', reason: 'No hints.' }],
        },
        {
          id: 'q4-num',
          rawFormat: 'numeric_math',
          met: ['S3', 'S4', 'NUM-01', 'NUM-02', 'NUM-03', 'NUM-05', 'FB-N1', 'FB-N2'],
          findings: [
            { check: 'NUM-04', status: 'not_applicable', reason: 'Plain scalar entry.' },
            { check: 'FB-N3', status: 'not_applicable', reason: 'No hints.' },
          ],
        },
        {
          id: 'q5-txt',
          rawFormat: 'fill_in_the_blank',
          met: ['S3', 'S4', 'TXT-01', 'TXT-02', 'TXT-03', 'TXT-04', 'TXT-05', 'FB-T1', 'FB-T2'],
          findings: [{ check: 'FB-T3', status: 'not_applicable', reason: 'No hints.' }],
        },
        {
          id: 'q6-ord',
          rawFormat: 'parsons',
          met: ['S3', 'S4', 'ORD-01', 'ORD-02', 'ORD-03', 'ORD-04', 'ORD-05', 'FB-R1', 'FB-R2', 'FB-R3'],
        },
        {
          id: 'q7-mtf',
          rawFormat: 'LBD_TAF', // OLI Yes/No MTF matrix -> must normalize to multi_input!
          met: ['S3', 'S4', 'MI-01', 'MI-02', 'MI-03', 'MI-04', 'FB-I1'],
          findings: [{ check: 'FB-I2', status: 'not_applicable', reason: 'Independent MTF rows.' }],
        },
      ],
    });

    assert.equal(normalizeQuestionFormat('LBD_TAF'), 'multi_input');
    assert.equal(out.advisoryNotes.length, 1); // minor_risk recorded as advisory, 0 deduction
    assert.ok(Math.abs(out.visiblePointsEarned - 94) < 1e-9);
    assert.equal(out.displayScore, 94);
    assert.equal(out.ready, true);

    // Every single question got exact 34/7 item points and 10/7 feedback points!
    for (const qb of out.questionBreakdowns) {
      assert.ok(Math.abs(qb.itemPointsAvailable - 34 / 7) < 1e-9);
      assert.ok(Math.abs(qb.itemPointsEarned - 34 / 7) < 1e-9);
      assert.ok(Math.abs(qb.feedbackPointsAvailable - 10 / 7) < 1e-9);
      assert.ok(Math.abs(qb.feedbackPointsEarned - 10 / 7) < 1e-9);
    }
  });

  it('renormalizes visible budget cleanly to 94 pts when secure credentialing exam withholds feedback', () => {
    const out = computeTrackScore({
      rubric,
      track: 'assessment_quiz',
      loContextSatisfied: true,
      feedbackWithheldForSecureExam: true,
      expectedUnitsByType: {
        alignment_pair: ['p1'],
        assessment_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        { unit: 'p1', met: ['A1', 'A2', 'A4', 'A5'] },
        { unit: 'set-1', met: ['S1', 'S2', 'S5'] },
        { unit: 'sec-1', met: ['C1', 'C2', 'C3', 'C4', 'C5'] },
      ],
      questions: [
        {
          id: 'q1',
          rawFormat: 'mcq',
          role: 'summative',
          met: [
            'S3', 'S4',
            'IWF-01', 'IWF-02', 'IWF-03', 'IWF-04', 'IWF-05', 'IWF-06', 'IWF-07', 'IWF-08', 'IWF-09',
            'IWF-10', 'IWF-11', 'IWF-12', 'IWF-13', 'IWF-14', 'IWF-15', 'IWF-16', 'IWF-17', 'IWF-18', 'IWF-19',
          ],
        },
      ],
    });

    assert.equal(out.dimensionSubtotals.assessment_feedback.available, 0);
    assert.ok(Math.abs(out.visiblePointsAvailable - 94) < 1e-9);
    assert.ok(Math.abs(out.visiblePointsEarned - 94) < 1e-9);
    assert.equal(out.displayScore, 94);
  });
});

describe('Track 2 Real-World 3-Course Google Drive Stress Tests', () => {
  it('Course 1 (Faculty PD Quiz: 10 MCQs + 2 OE, zero feedback, wrong key Q9, aid contradiction Q6, circular/missing rubrics)', () => {
    // Mirrors [Gautam] Doc A assessment section:
    // - 10 MCQs + 2 OE = 12 questions (each worth 34/12 = 2.833 item pts, 10/12 = 0.833 fb pts)
    // - Zero learner feedback anywhere -> 0 / 14 on assessment_feedback!
    // - Q9 wrong key (A marked instead of B) + OE2 missing rubric -> S3 fails on Q9 & unverified on OE2
    // - Q6 permits ChatGPT while LO5 bans AI -> fails A4
    // - Q7, Q8, Q9 reference broken LOs (LO1 Understand, LO3 Instructor-centered, LO6 Appreciate); Q10 untagged trivia -> fails A1/A2
    // - Q2 All of the above (IWF-09), Q4 & Q6 huge key-length cue (IWF-04), Q7 un-emphasized NOT (IWF-19), Q8 None of the above (IWF-03)
    // - OE1 circular rubric ("Shows excellent insight") -> fails OE-06, OE-07
    const allMcqChecks = rubric.question_formats!.mcq.item_check_ids;
    const makeMcq = (id: string, failedChecks: string[], s3Pass = true) => ({
      id,
      rawFormat: 'mcq' as const,
      met: [
        ...(s3Pass ? ['S3'] : []),
        'S4',
        ...allMcqChecks.filter((c) => c !== 'IWF-16' && !failedChecks.includes(c)),
      ],
      findings: [
        ...(!s3Pass ? [{ check: 'S3', status: 'revise' as const, reason: 'Marked key A contradicts equitable practice (B).' }] : []),
        ...(id === 'q10' ? [] : [{ check: 'IWF-16', status: 'not_applicable' as const, reason: 'Non-numeric.' }]),
        ...(id === 'q10' ? [{ check: 'IWF-16', status: 'meets' as const, reason: '1, 3, 5, 7 ordered.' }] : []),
        ...failedChecks.map((c) => ({ check: c, status: 'revise' as const, reason: `Flagged ${c}` })),
        { check: 'FB-M1', status: 'revise' as const, reason: 'No learner feedback provided.' },
        { check: 'FB-M2', status: 'revise' as const, reason: 'No key explanation.' },
        { check: 'FB-M3', status: 'revise' as const, reason: 'No distractor misconception feedback.' },
        { check: 'FB-M4', status: 'not_applicable' as const, reason: 'No hints.' },
      ],
    });

    const docAScore = computeTrackScore({
      rubric,
      track: 'assessment_quiz',
      loContextSatisfied: true,
      expectedUnitsByType: {
        alignment_pair: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'oe1', 'oe2'],
        assessment_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        // Alignment across the 12 items
        ...['q1', 'q2', 'q4', 'q5', 'oe1'].map((u) => ({
          unit: u,
          met: ['A1', 'A2', 'A5'],
          findings: [{ check: 'A4', status: 'not_applicable' as const, reason: 'No special aid condition.' }],
        })),
        {
          unit: 'q3', // definition recall for application LO2
          met: ['A1', 'A5'],
          findings: [
            { check: 'A2', status: 'revise', reason: 'Tests term recall rather than judging rubric alignment (LO2).' },
            { check: 'A4', status: 'not_applicable', reason: 'No aid rule.' },
          ],
        },
        {
          unit: 'q6', // Violates LO5 "without using another AI tool"
          met: ['A1', 'A2', 'A5'],
          findings: [
            { check: 'A4', status: 'revise', reason: 'Permits pasting into ChatGPT when LO5 requires unaided identification.' },
          ],
        },
        ...['q7', 'q8', 'q9'].map((u) => ({
          unit: u,
          met: [],
          findings: [
            { check: 'A1', status: 'unverified' as const, reason: 'Referenced LO1/LO3/LO6 is unobservable or instructor-centered.' },
            { check: 'A2', status: 'unverified' as const, reason: 'Cannot verify target operation from vague LO.' },
            { check: 'A4', status: 'not_applicable' as const, reason: 'No aid rule.' },
            { check: 'A5', status: 'revise' as const, reason: 'Key/shortcut fails to reflect target capability.' },
          ],
        })),
        {
          unit: 'q10',
          met: [],
          findings: [
            { check: 'A1', status: 'revise', reason: 'Untagged pilot-speed trivia outside module LOs.' },
            { check: 'A2', status: 'revise', reason: 'Rote trivia memorization.' },
            { check: 'A4', status: 'not_applicable', reason: 'No aid rule.' },
            { check: 'A5', status: 'revise', reason: 'Credits memorizing arbitrary pilot day count.' },
          ],
        },
        {
          unit: 'oe2',
          met: ['A1', 'A2'],
          findings: [
            { check: 'A4', status: 'not_applicable', reason: 'No aid rule.' },
            { check: 'A5', status: 'unverified', reason: 'No scoring rubric provided.' },
          ],
        },
        {
          unit: 'set-1',
          met: ['S2'],
          findings: [
            { check: 'S1', status: 'revise', reason: 'Formative vs. summative stakes not stated.' },
            { check: 'S5', status: 'not_applicable', reason: 'Design draft.' },
            { check: 'FB-S1', status: 'revise', reason: 'No feedback delivery/timing specified.' },
            { check: 'FB-S2', status: 'revise', reason: 'No task/process feedback provided.' },
          ],
        },
        {
          unit: 'sec-1',
          met: ['C2', 'C3', 'C4'],
          findings: [
            { check: 'C1', status: 'revise', reason: 'Q10 omits target LO tag; OE2 lacks deliverable format.' },
            { check: 'C5', status: 'revise', reason: 'OE2 omits length and submission expectations.' },
          ],
        },
      ],
      questions: [
        makeMcq('q1', []),
        makeMcq('q2', ['IWF-09']), // All of the above
        makeMcq('q3', []),
        makeMcq('q4', ['IWF-04']), // 24-word key vs 3-word distractors
        makeMcq('q5', []),
        makeMcq('q6', ['IWF-04']), // 19-word key vs 1-word distractors
        makeMcq('q7', ['IWF-19']), // un-emphasized 'not'
        makeMcq('q8', ['IWF-03']), // None of the above key
        makeMcq('q9', ['IWF-18'], false), // Wrong key marked!
        makeMcq('q10', []),
        {
          id: 'oe1',
          rawFormat: 'open_ended',
          met: ['S4', 'OE-01', 'OE-02', 'OE-03', 'OE-04', 'OE-05', 'OE-11'],
          findings: [
            { check: 'S3', status: 'revise', reason: 'Rubric uses circular adjectives ("excellent insight") rather than defensible criteria.' },
            { check: 'OE-06', status: 'revise', reason: 'Uses evaluative adjectives instead of inspectable features.' },
            { check: 'OE-07', status: 'revise', reason: 'Does not define minimum sufficient evidence.' },
            { check: 'OE-08', status: 'revise', reason: 'Cannot distinguish right claim with missing quote.' },
            { check: 'OE-09', status: 'not_applicable', reason: 'Single target judgment.' },
            { check: 'OE-10', status: 'not_applicable', reason: 'Low stakes.' },
            { check: 'FB-O1', status: 'revise', reason: 'No model response or anchor.' },
            { check: 'FB-O2', status: 'revise', reason: 'No criterion-referenced feedback.' },
            { check: 'FB-O3', status: 'revise', reason: 'No feed-forward guidance.' },
            { check: 'FB-O4', status: 'not_applicable', reason: 'Single target.' },
          ],
        },
        {
          id: 'oe2',
          rawFormat: 'open_ended',
          met: ['S4', 'OE-11'],
          findings: [
            { check: 'S3', status: 'unverified', reason: 'No scoring guide supplied.' },
            { check: 'OE-01', status: 'revise', reason: 'Deliverable components/length unspecified.' },
            { check: 'OE-02', status: 'revise', reason: 'Unbounded scope ("Design an AI-use policy").' },
            { check: 'OE-03', status: 'not_applicable', reason: 'Own course context.' },
            { check: 'OE-04', status: 'revise', reason: 'Does not ask for rationale linking policy to course goals.' },
            { check: 'OE-05', status: 'not_applicable', reason: 'No restrictive cap.' },
            { check: 'OE-06', status: 'unverified', reason: 'Missing rubric.' },
            { check: 'OE-07', status: 'unverified', reason: 'Missing rubric.' },
            { check: 'OE-08', status: 'unverified', reason: 'Missing rubric.' },
            { check: 'OE-09', status: 'unverified', reason: 'Missing rubric.' },
            { check: 'OE-10', status: 'not_applicable', reason: 'Low stakes.' },
            { check: 'FB-O1', status: 'revise', reason: 'Missing exemplar/checklist.' },
            { check: 'FB-O2', status: 'revise', reason: 'Missing criterion feedback.' },
            { check: 'FB-O3', status: 'revise', reason: 'Missing feed-forward.' },
            { check: 'FB-O4', status: 'not_applicable', reason: 'Draft.' },
          ],
        },
      ],
    });

    assert.equal(docAScore.dimensionSubtotals.assessment_feedback.earned, 0);
    assert.equal(docAScore.ready, false);
    assert.ok(docAScore.displayScore >= 45 && docAScore.displayScore <= 60);
  });

  it('Course 2 (LEFP Week 2 OLI Formative Set: catches inverted KLI Skill/Principle key+feedback, copy-pasted feedback on MCQ5, cross-item cues, and rewards LBD_TAF MTF matrix)', () => {
    const allMcqChecks = rubric.question_formats!.mcq.item_check_ids.filter((c) => c !== 'IWF-16');

    const lefpScore = computeTrackScore({
      rubric,
      track: 'assessment_quiz',
      loContextSatisfied: true,
      expectedUnitsByType: {
        alignment_pair: ['mcq3-1', 'mcq3-2', 'mcq3-3', 'mcq8-1', 'mcq5', 'tf1'],
        assessment_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        // Modality-claim note: LO says "design measurable LOs" while MCQ3-1..3-3 test KLI classification (prerequisite KC, not full LO authoring)
        ...['mcq3-1', 'mcq3-2', 'mcq3-3', 'mcq8-1'].map((u) => ({
          unit: u,
          met: ['A1', 'A5'],
          findings: [
            { check: 'A2', status: 'revise' as const, reason: 'Classifies KLI terms via MCQ rather than eliciting LO design claimed by parent LO.' },
            { check: 'A4', status: 'not_applicable' as const, reason: 'Formative.' },
          ],
        })),
        ...['mcq5', 'tf1'].map((u) => ({
          unit: u,
          met: ['A1', 'A2', 'A5'],
          findings: [{ check: 'A4', status: 'not_applicable' as const, reason: 'Formative.' }],
        })),
        {
          unit: 'set-1',
          met: ['S1', 'S2', 'FB-S2'],
          findings: [
            { check: 'S5', status: 'not_applicable', reason: 'OLI formative LBD/DIGT.' },
            { check: 'FB-S1', status: 'revise', reason: 'MCQ3-1 distractor feedback leaks keys to sibling MCQ3-2/3-3, and MCQ5 Distractor A/C feedback reveals Key B verbatim on Attempt 1.' },
          ],
        },
        {
          unit: 'sec-1',
          met: ['C1', 'C2', 'C3', 'C4'],
          findings: [{ check: 'C5', status: 'not_applicable', reason: 'Embedded OLI formative activities.' }],
        },
      ],
      questions: [
        ...['mcq3-1', 'mcq3-2', 'mcq3-3'].map((id) => ({
          id,
          rawFormat: 'LBD_MCQ',
          role: 'formative' as const,
          met: ['S3', 'S4', ...allMcqChecks.filter((c) => c !== 'IWF-08'), 'FB-M1', 'FB-M2', 'FB-M3'],
          findings: [
            { check: 'IWF-08', status: 'revise' as const, reason: 'Identical 4-option set across 3 adjacent items enables cross-item elimination.' },
            { check: 'IWF-16', status: 'not_applicable' as const, reason: 'Non-numeric.' },
            { check: 'FB-M4', status: 'not_applicable' as const, reason: 'Hints N/A.' },
          ],
        })),
        {
          id: 'mcq8-1', // Inverted KLI Skill vs Principle definition!
          rawFormat: 'LBD_MCQ',
          role: 'formative',
          met: ['S4', ...allMcqChecks.filter((c) => c !== 'IWF-18'), 'FB-M1'],
          findings: [
            { check: 'S3', status: 'revise', reason: 'Swaps KLI Skill (procedural) and Principle (conceptual interrelationships) definitions; key should be Principle (C).' },
            { check: 'IWF-18', status: 'revise', reason: 'Marked key B contradicts KLI framework.' },
            { check: 'IWF-16', status: 'not_applicable', reason: 'Non-numeric.' },
            { check: 'FB-M2', status: 'revise', reason: 'Key feedback teaches inverted KLI Skill definition.' },
            { check: 'FB-M3', status: 'revise', reason: 'Distractor C feedback misdefines KLI Principle as procedural.' },
            { check: 'FB-M4', status: 'not_applicable', reason: 'No hints.' },
          ],
        },
        {
          id: 'mcq5', // Copy-pasted feedback across A, B, C + huge key length bias + missing Table 1 stimulus check
          rawFormat: 'LBD_MCQ',
          role: 'formative',
          met: ['S3', ...allMcqChecks.filter((c) => c !== 'IWF-04' && c !== 'IWF-02'), 'FB-M1', 'FB-M2'],
          findings: [
            { check: 'S4', status: 'unverified', reason: 'Verify Table 1 of Zhu & Simon is visible above this item on the OLI page.' },
            { check: 'IWF-02', status: 'revise', reason: 'Option C ("nothing about the design") is an implausible throwaway distractor.' },
            { check: 'IWF-04', status: 'revise', reason: 'Correct option B is 30 words with parenthetical proof vs. 8-12 word foils.' },
            { check: 'IWF-16', status: 'not_applicable', reason: 'Non-numeric.' },
            { check: 'FB-M3', status: 'revise', reason: 'Identical correct-answer text is copy-pasted onto Distractors A and C without addressing either choice.' },
            { check: 'FB-M4', status: 'not_applicable', reason: 'No hints.' },
          ],
        },
        {
          id: 'tf1', // OLI LBD_TAF 6-row Yes/No MTF matrix -> cleanly scored as multi_input (earns 100%!)
          rawFormat: 'LBD_TAF',
          role: 'formative',
          met: ['S3', 'S4', 'MI-01', 'MI-02', 'MI-03', 'MI-04', 'FB-I1'],
          findings: [{ check: 'FB-I2', status: 'not_applicable', reason: 'Self-contained MTF protocol rows.' }],
        },
      ],
    });

    const tf1Breakdown = lefpScore.questionBreakdowns.find((q) => q.questionId === 'tf1')!;
    assert.equal(tf1Breakdown.format, 'multi_input');
    assert.ok(Math.abs(tf1Breakdown.itemPointsEarned - 34 / 6) < 1e-9);
    assert.equal(lefpScore.displayScore, 82); // Fair proportional credit for 5 strong items,
    assert.equal(lefpScore.ready, false);     // ...yet blocked from Ready (>=80) until S3 wrong key on mcq8-1 is fixed!
  });

  it('Course 3 (OLI Module 6 Mixed F/S ICAP Bank: handles mixed F/S roles, deducts missing item Skill tags on C1 only, and flags throwaway Passive foils on IWF-02)', () => {
    const allMcqChecks = rubric.question_formats!.mcq.item_check_ids.filter((c) => c !== 'IWF-16');

    const oli6Score = computeTrackScore({
      rubric,
      track: 'assessment_quiz',
      loContextSatisfied: true,
      expectedUnitsByType: {
        alignment_pair: ['f1', 'f2', 's1', 's2'],
        assessment_set: ['set-1'],
        section: ['sec-1'],
      },
      unitResults: [
        ...['f1', 'f2', 's1', 's2'].map((u) => ({
          unit: u,
          met: ['A1', 'A2', 'A5'],
          findings: [{ check: 'A4', status: 'not_applicable' as const, reason: 'Standard quiz.' }],
        })),
        {
          unit: 'set-1',
          met: ['S1', 'S2', 'FB-S1', 'FB-S2'],
          findings: [{ check: 'S5', status: 'not_applicable', reason: 'Module checkpoint.' }],
        },
        {
          unit: 'sec-1',
          met: ['C2', 'C3', 'C4'],
          findings: [
            { check: 'C1', status: 'revise', reason: 'Authoring table leaves Skill/LO ID column blank on items (Google Docs "1. 1. 1." numbering ignored).' },
            { check: 'C5', status: 'not_applicable', reason: 'Authoring bank.' },
          ],
        },
      ],
      questions: [
        // f1, f2: subtle Interactive vs parallel-Constructive foils -> pass all IWF & FB checks!
        ...['f1', 'f2'].map((id) => ({
          id,
          rawFormat: 'mcq',
          role: 'formative' as const,
          met: ['S3', 'S4', ...allMcqChecks, 'FB-M1', 'FB-M2', 'FB-M3'],
          findings: [
            { check: 'IWF-16', status: 'not_applicable' as const, reason: 'Non-numeric.' },
            { check: 'FB-M4', status: 'not_applicable' as const, reason: 'Hints optional.' },
          ],
        })),
        // s1, s2: summative items flagged by reviewer ("These are too easy") due to obvious Passive lecture foils (IWF-02)
        ...['s1', 's2'].map((id) => ({
          id,
          rawFormat: 'mcq',
          role: 'summative' as const,
          met: ['S3', 'S4', ...allMcqChecks.filter((c) => c !== 'IWF-02'), 'FB-M1', 'FB-M2', 'FB-M3'],
          findings: [
            { check: 'IWF-02', status: 'revise' as const, reason: 'Passive "Listen to a lecture" distractor is an obvious throwaway foil; use near-boundary Active vs. Constructive foils.' },
            { check: 'IWF-16', status: 'not_applicable' as const, reason: 'Non-numeric.' },
            { check: 'FB-M4', status: 'not_applicable' as const, reason: 'Summative.' },
          ],
        })),
      ],
    });

    assert.equal(oli6Score.displayScore, 90); // Strong well-feedbacked bank (90/94 visible), loses ~3 pts on C1 blank Skill tags + ~1 pt on s1/s2 IWF-02 foils
    assert.equal(oli6Score.ready, true);
  });
});
