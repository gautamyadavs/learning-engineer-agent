// AUTO-GENERATED FROM src/lib/le-scoring/scorer.ts via scripts/sync-browser-scorer.mjs
// Do not edit by hand — run `npm run sync:web` after modifying scorer.ts.

/**
 * Deterministic scoring, 4-way LO unit segmentation, Missing-LO pre-gate,
 * Track 2 7-format 1/N assessment & learner-feedback engine, KLI Knowledge
 * Component scope check, and Prior Knowledge Audit + 3-path Gap Resolution
 * engine for the Learning Engineer (LE) Agent (v0.3.0).
 *
 * Implements ADR-0008, ADR-0009, and docs/rubric/rubric-v0.3.json while
 * preserving ADR-0001..0005.
 */

                     
                     
                     
                     
                  

                              
         
                
          
                  
                
              
                  

                           
            
                
                    
           
                 

                                                              

export const MAX_PRIOR_KNOWLEDGE_ITEMS = 10;

                                     
                
                     
                           
                               
 

                                  
             
                       
                    
                      
                    
                
                    
                    
                    
                          
                                
 

                            
                
                        
                                                                   
                                     
                                        
                    
                            
                                 
                  
    
                                            
 

                             
                         
                 
                                                                   
                                                                     
                     
                                   
                                       
    
                    
                      
                                
                                                  
                                         
    
                                                                  
                                     
                            
 

                               
                
                        
                 
                 
                       
                
                    
                           
                           
                             
                    
 

                                   
               
                
                            
 

                                          
             
                                       
                                   
     
                                                                         
                                                          
     
                                      
                
                            
 

// --- 1. Question Format Normalization (inc. OLI LBD_TAF / MTF Routing) ---

const FORMAT_ALIAS_MAP                                   = {
  mcq: 'mcq',
  single_select: 'mcq',
  lbd_mcq: 'mcq',
  digt_mcq: 'mcq',
  true_false: 'mcq',
  open_ended: 'open_ended',
  essay: 'open_ended',
  paragraph: 'open_ended',
  constructed_response: 'open_ended',
  case_analysis: 'open_ended',
  cata: 'cata',
  sata: 'cata',
  multiple_select: 'cata',
  select_all_that_apply: 'cata',
  check_all_that_apply: 'cata',
  numeric_math: 'numeric_math',
  numeric: 'numeric_math',
  number: 'numeric_math',
  numbers: 'numeric_math',
  math: 'numeric_math',
  symbolic_math: 'numeric_math',
  formula: 'numeric_math',
  short_text: 'short_text',
  fill_in_the_blank: 'short_text',
  fitb: 'short_text',
  completion: 'short_text',
  cloze_text: 'short_text',
  ordering: 'ordering',
  sequencing: 'ordering',
  ranking: 'ordering',
  parsons: 'ordering',
  multi_input: 'multi_input',
  dropdown: 'multi_input',
  dropdown_cloze: 'multi_input',
  mtf: 'multi_input',
  multiple_true_false: 'multi_input',
  lbd_taf: 'multi_input',
  digt_taf: 'multi_input',
  yes_no_matrix: 'multi_input',
  two_tier: 'multi_input',
  matrix: 'multi_input',
};

export function normalizeQuestionFormat(rawFormat        )                   {
  const normalizedKey = rawFormat.trim().toLowerCase().replace(/[\s\-]+/g, '_');
  const mapped = FORMAT_ALIAS_MAP[normalizedKey];
  if (!mapped) {
    throw new Error(`Unsupported question format: "${rawFormat}"`);
  }
  return mapped;
}

// --- 2. Missing-LO Pre-Review Gate (0 LLM Credits) ---

                                     
                 
                      
                                  
                                     
                                
 

                                      
                         
                                                                       
                  
                                                                                               
                   
 

const LO_HEADING_OR_LABEL_REGEX =
  /(?:^|\n)\s*(?:#{1,4}\s*(?:learning\s+objectives?|objectives?|learning\s+goals?)|(?:\|\s*\*{0,2}Learning\s+Objective\*{0,2}\s*\|)|(?:LO[-_\s]?\d+|Objective\s+\d+)\s*[:.\-])/i;

const ACTIONABLE_LINE_REGEX = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S+/;

export function checkMissingLoGate(input                    )                      {
  const trimmed = input.docMarkdown.trim();

  if (input.track === 'objectives_only') {
    const hasObjectiveContent =
      trimmed.length > 0 &&
      (LO_HEADING_OR_LABEL_REGEX.test(trimmed) || ACTIONABLE_LINE_REGEX.test(trimmed));

    if (hasObjectiveContent) {
      return {
        readyToReview: true,
        loSource: 'inline',
        llmCallsMade: 0,
        promptActions: [],
      };
    }

    return {
      readyToReview: false,
      loSource: null,
      llmCallsMade: 0,
      promptActions: ['paste_inline_los', 'facilitator_draft_los'],
      message:
        'Add or draft at least one learning objective before running an Objectives review.',
    };
  }

  if (input.pinnedLoStatements && input.pinnedLoStatements.some((s) => s.trim().length > 0)) {
    return {
      readyToReview: true,
      loSource: 'pinned_header',
      llmCallsMade: 0,
      promptActions: [],
    };
  }

  if (
    input.linkedWorkspaceLoDocId &&
    input.linkedWorkspaceLoMarkdown &&
    input.linkedWorkspaceLoMarkdown.trim().length > 0
  ) {
    return {
      readyToReview: true,
      loSource: 'linked_workspace_doc',
      llmCallsMade: 0,
      promptActions: [],
    };
  }

  if (LO_HEADING_OR_LABEL_REGEX.test(trimmed)) {
    return {
      readyToReview: true,
      loSource: 'inline',
      llmCallsMade: 0,
      promptActions: [],
    };
  }

  return {
    readyToReview: false,
    loSource: null,
    llmCallsMade: 0,
    promptActions: ['pick_workspace_lo_doc', 'paste_inline_los', 'facilitator_draft_los'],
    message:
      'Add target learning objectives (link from Workspace, paste inline, or draft with Facilitator) before scoring.',
  };
}

// --- 3. Four-Way Objective Block Segmentation ---

                                
             
                     
               
                       

                                    
             
               
                    
                               
 

                                           
                            
                              
                                      
                                             
 

const AUTHOR_KC_PREFIX_REGEX = /^\s*(?:\*|_|\*\*)*\s*KC\s*\d+(?:[.\-]\d+)*\s*[:.)]/i;
const ORIENTATION_NOTE_REGEX =
  /^\s*(?:note|preview|mechanism\s+preview|background|context|overview)\b[^:]*:/i;

export function segmentObjectiveBlocks(blocks                     )                           {
  const parentIdsWithChildren = new Set        ();
  for (const b of blocks) {
    if (b.parentId) {
      parentIdsWithChildren.add(b.parentId);
    }
  }

  const scoredLeafLoIds           = [];
  const umbrellaHeaderIds           = [];
  const authorKcBlocks                      = [];
  const orientationNoteBlocks                      = [];

  for (const b of blocks) {
    if (AUTHOR_KC_PREFIX_REGEX.test(b.text)) {
      authorKcBlocks.push(b);
      continue;
    }

    if (ORIENTATION_NOTE_REGEX.test(b.text)) {
      orientationNoteBlocks.push(b);
      continue;
    }

    if (b.hasChildObjectives || parentIdsWithChildren.has(b.id)) {
      umbrellaHeaderIds.push(b.id);
      continue;
    }

    scoredLeafLoIds.push(b.id);
  }

  return {
    scoredLeafLoIds,
    umbrellaHeaderIds,
    authorKcBlocks,
    orientationNoteBlocks,
  };
}

// --- 4. Unscored KLI Knowledge Component (KC) Scope Enhancement + PK Piping ---

                                 
               
                 
                    
                            
                                             
                            
                                          
 

                                                                                 

                                         
                 
                                     
                                           
                                      
                                    
                                 
                 
                   
                  
                        
                   
     
 

export function reconcileKliKcScope(
  candidates                  ,
  decisions                                                   ,
)                         {
  const confirmedInScope                   = [];
  const confirmedPrerequisites                   = [];
  const removedOutOfScope                   = [];
  const pendingProposed                   = [];
  const loScopeTrimSuggestions                                                   = [];

  for (const kc of candidates) {
    const choice =
      decisions[kc.kcId] ?? (kc.origin === 'author_authored' ? 'in_scope' : undefined);

    if (!choice) {
      pendingProposed.push(kc);
    } else if (choice === 'in_scope') {
      confirmedInScope.push(kc);
    } else if (choice === 'prerequisite') {
      confirmedPrerequisites.push(kc);
    } else if (choice === 'out_of_scope') {
      removedOutOfScope.push(kc);
      if (kc.impliedByLoQuote && kc.suggestedTrimmedLoIfOutOfScope) {
        loScopeTrimSuggestions.push({
          kcId: kc.kcId,
          loUnit: kc.loUnit,
          quote: kc.impliedByLoQuote,
          replacement: kc.suggestedTrimmedLoIfOutOfScope,
          reason: `You marked "${kc.statement}" as out of scope; trimming this phrasing prevents assessments and instruction from being judged against it.`,
        });
      }
    }
  }

  return {
    scoreImpact: 0,
    confirmedInScope,
    confirmedPrerequisites,
    removedOutOfScope,
    pendingProposed,
    loScopeTrimSuggestions,
  };
}

                                            
                                                
                                           
 

export function preparePriorKnowledgeSeedFromKcs(
  kcSummary                        ,
)                            {
  const seededPrerequisiteItems                       = kcSummary.confirmedPrerequisites.map(
    (kc) => ({
      pkId: `pk-from-${kc.kcId}`,
      statement: kc.statement,
      kliType: kc.kliType,
      requiredBy: [{ unit: kc.loUnit, quote: kc.impliedByLoQuote }],
      whyNeeded: 'Marked as an assumed prerequisite during KLI Knowledge Component review.',
    }),
  );

  const suppressedOutOfScopeStatements = kcSummary.removedOutOfScope.map((kc) => kc.statement);

  return {
    seededPrerequisiteItems,
    suppressedOutOfScopeStatements,
  };
}

// --- 5. Prior Knowledge Audit & 3-Path Gap Resolution (PK-1, Mixed-Cohort Aware) ---

                                     
               
                    
                            
                                                      
                    
 

                                                                                

                                    
                
          
                
               
               
              

                                      
     
                             
                                      
                          
                                      
                                                        
                               
     
     
                                 
                                      
                          
                                  
                                                        
                               
     
     
                             
                           
                             
                            
                                      
      

                                            
                                   
                                        
 

                                           
                       
                              
                                                                
 

export function markRemainingPrerequisitesHave(
  audit                          ,
)                                            {
  const updated                                            = {};
  for (const item of audit.items.slice(0, MAX_PRIOR_KNOWLEDGE_ITEMS)) {
    const existing = audit.triage[item.pkId];
    if (!existing || existing.decision === 'unreviewed') {
      updated[item.pkId] = { decision: 'have' };
    } else {
      updated[item.pkId] = existing;
    }
  }
  return updated;
}

                                                
                         
                                                     
                     
                                   
                       
                    
                         
                        
                        
                       
                           
                       
                          
                                 
                               
           
                                                                 
    
                                      
 

export function evaluatePriorKnowledgeAudit(
  audit                           ,
)                                {
  if (!audit || !audit.auditHasRun) {
    return {
      pkCheckEarned: false,
      status: 'not_audited',
      totalItems: 0,
      truncatedExcessItemCount: 0,
      clearedItems: 0,
      haveCount: 0,
      notNeededCount: 0,
      someLackCount: 0,
      mostLackCount: 0,
      missingCount: 0,
      resolvedGapCount: 0,
      openGapIds: [],
      unreviewedIds: [],
      triggersNewLoBaseline: false,
      recommendedPathByGap: {},
      gapFeedback: {},
    };
  }

  const cappedItems = audit.items.slice(0, MAX_PRIOR_KNOWLEDGE_ITEMS);
  const truncatedExcessItemCount = Math.max(0, audit.items.length - cappedItems.length);

  let haveCount = 0;
  let notNeededCount = 0;
  let someLackCount = 0;
  let mostLackCount = 0;
  let resolvedGapCount = 0;
  const openGapIds           = [];
  const unreviewedIds           = [];
  let triggersNewLoBaseline = false;
  const recommendedPathByGap                                                        = {};
  const gapFeedback                         = {};

  for (const item of cappedItems) {
    const entry = audit.triage[item.pkId];
    if (!entry || entry.decision === 'unreviewed') {
      unreviewedIds.push(item.pkId);
      continue;
    }

    if (entry.decision === 'have') {
      haveCount += 1;
      continue;
    }

    if (entry.decision === 'not_needed') {
      notNeededCount += 1;
      continue;
    }

    if (entry.decision === 'most_lack') {
      mostLackCount += 1;
      recommendedPathByGap[item.pkId] = 'promote_to_lo_or_inline_bridge';
    } else {
      someLackCount += 1;
      recommendedPathByGap[item.pkId] = 'ai_or_author_remediation';
    }

    const res = entry.resolution;
    if (!res) {
      openGapIds.push(item.pkId);
      gapFeedback[item.pkId] =
        entry.decision === 'most_lack'
          ? 'Most learners lack this: consider promoting to a Module LO (Path C) or adding a required inline refresher (Path A/B).'
          : 'Mixed cohort gap: consider generating a companion Prerequisite Refresher doc (Path A) or adding your own refresher + Recheck (Path B).';
      continue;
    }

    if (res.path === 'ai_remediation') {
      if (res.appliedVersionId && res.recheckStatus === 'meets') {
        resolvedGapCount += 1;
      } else {
        openGapIds.push(item.pkId);
        gapFeedback[item.pkId] = !res.appliedVersionId
          ? 'Preview and Apply the remediation draft first (either inline or as a companion Workspace doc).'
          : res.recheckFeedback || 'Run Recheck to verify the applied remediation covers this gap.';
      }
    } else if (res.path === 'author_remediation') {
      if (res.authorContentOrPlan.trim().length > 0 && res.recheckStatus === 'meets') {
        resolvedGapCount += 1;
      } else {
        openGapIds.push(item.pkId);
        gapFeedback[item.pkId] =
          res.recheckFeedback ||
          'Run Recheck so the LE Agent can verify your remediation content/plan addresses this gap.';
      }
    } else if (res.path === 'promoted_to_lo') {
      if (res.appliedVersionId && res.promotedLoText.trim().length > 0) {
        resolvedGapCount += 1;
        triggersNewLoBaseline = true;
      } else {
        openGapIds.push(item.pkId);
        gapFeedback[item.pkId] =
          'Confirm the diff preview and Apply to add this prerequisite as a Module LO.';
      }
    }
  }

  const missingCount = someLackCount + mostLackCount;
  const clearedItems = haveCount + notNeededCount + resolvedGapCount;
  const allCleared =
    unreviewedIds.length === 0 && openGapIds.length === 0 && clearedItems === cappedItems.length;

  return {
    pkCheckEarned: allCleared,
    status: allCleared ? 'verified' : 'in_progress',
    totalItems: cappedItems.length,
    truncatedExcessItemCount,
    clearedItems,
    haveCount,
    notNeededCount,
    someLackCount,
    mostLackCount,
    missingCount,
    resolvedGapCount,
    openGapIds,
    unreviewedIds,
    triggersNewLoBaseline,
    recommendedPathByGap,
    gapFeedback,
  };
}

// --- 6. Diff / Placement Helpers for Remediation & Promote-to-LO (ADR-0003) ---

                                           
                                  
                                  
                                     
                           
                           
                             
                            
    
 

export function buildRemediationPlacementPreview(params   
                                  
                          
                             
                              
 )                           {
  const cleanSection = `## Prerequisite Refresher\n\n${params.remediationMarkdown.trim()}\n\n`;
  if (params.placement === 'inline_section') {
    return {
      placement: 'inline_section',
      requiresApplyConfirmation: true,
      updatedCurrentDocMarkdown: `${cleanSection}${params.currentDocMarkdown}`,
    };
  }
  return {
    placement: 'companion_workspace_doc',
    requiresApplyConfirmation: true,
    companionWorkspaceDoc: {
      suggestedTitle: `${params.currentDocTitle} — Prerequisite Refresher`,
      track: 'lesson_activity',
      markdownContent: `# ${params.currentDocTitle} — Prerequisite Refresher\n\n${params.remediationMarkdown.trim()}\n`,
    },
  };
}

                                           
                                  
                         
                        
                         
                                                      
 

export function buildPromotePrerequisiteToLoPreview(params   
                        
                  
                              
 )                           {
  const promotedLoLine = `- **${params.newLoId}:** ${params.proposedLoStatement.trim()}`;
  const headingMatch = params.loDocMarkdown.match(
    /(^|\n)(#{1,4}\s*(?:Learning\s+Objectives?|Objectives?)\s*\n+)/i,
  );

  let afterMarkdown        ;
  if (headingMatch && headingMatch.index !== undefined) {
    const insertAt = headingMatch.index + headingMatch[0].length;
    afterMarkdown =
      params.loDocMarkdown.slice(0, insertAt) +
      `${promotedLoLine}\n` +
      params.loDocMarkdown.slice(insertAt);
  } else {
    afterMarkdown = `## Learning Objectives\n\n${promotedLoLine}\n\n${params.loDocMarkdown}`;
  }

  return {
    requiresApplyConfirmation: true,
    beforeMarkdown: params.loDocMarkdown,
    afterMarkdown,
    promotedLoLine,
    newBaselineReason: 'promoted_prior_knowledge_to_lo',
  };
}

// --- 7. Deterministic Track /100 Score Computation (v0.3.0: 1/N Equal Question Distribution) ---

                                      
                  
                    
                
                                                                        
                          
                       
                          
                       
                               
                          
                             
                           
 

                                         
                     
                           
                                   
                              
                           
                               
                            
                                  
                               
                                   
                                
 

                               
               
                  
                 
                 
 

                                   
                 
                        
                     
                       
                              
                                 
                                     
                                        
                 
                                                                            
                                         
                                               
                                
                                                          
                                  
 

const DEFAULT_QUESTION_FORMATS                                               = {
  mcq: {
    label: 'Multiple-Choice (Single-Select)',
    item_check_ids: [
      'IWF-01', 'IWF-02', 'IWF-03', 'IWF-04', 'IWF-05', 'IWF-06', 'IWF-07',
      'IWF-08', 'IWF-09', 'IWF-10', 'IWF-11', 'IWF-12', 'IWF-13', 'IWF-14',
      'IWF-15', 'IWF-16', 'IWF-17', 'IWF-18', 'IWF-19',
    ],
    feedback_check_ids: ['FB-M1', 'FB-M2', 'FB-M3', 'FB-M4'],
  },
  open_ended: {
    label: 'Open-Ended',
    item_check_ids: [
      'OE-01', 'OE-02', 'OE-03', 'OE-04', 'OE-05', 'OE-06',
      'OE-07', 'OE-08', 'OE-09', 'OE-10', 'OE-11',
    ],
    feedback_check_ids: ['FB-O1', 'FB-O2', 'FB-O3', 'FB-O4'],
  },
  cata: {
    label: 'Check All That Apply',
    item_check_ids: [
      'CATA-01', 'CATA-02', 'CATA-03', 'CATA-04',
      'IWF-01', 'IWF-02', 'IWF-04', 'IWF-05', 'IWF-06', 'IWF-10',
      'IWF-11', 'IWF-12', 'IWF-13', 'IWF-15', 'IWF-17', 'IWF-19',
    ],
    feedback_check_ids: ['FB-C1', 'FB-C2'],
  },
  numeric_math: {
    label: 'Numeric & Symbolic Math',
    item_check_ids: ['NUM-01', 'NUM-02', 'NUM-03', 'NUM-04', 'NUM-05'],
    feedback_check_ids: ['FB-N1', 'FB-N2', 'FB-N3'],
  },
  short_text: {
    label: 'Auto-Graded Short-Text / FITB',
    item_check_ids: ['TXT-01', 'TXT-02', 'TXT-03', 'TXT-04', 'TXT-05'],
    feedback_check_ids: ['FB-T1', 'FB-T2', 'FB-T3'],
  },
  ordering: {
    label: 'Ordering / Sequencing & Parsons',
    item_check_ids: ['ORD-01', 'ORD-02', 'ORD-03', 'ORD-04', 'ORD-05'],
    feedback_check_ids: ['FB-R1', 'FB-R2', 'FB-R3'],
  },
  multi_input: {
    label: 'Multi-Input / Dropdown Cloze / MTF Matrix',
    item_check_ids: ['MI-01', 'MI-02', 'MI-03', 'MI-04'],
    feedback_check_ids: ['FB-I1', 'FB-I2'],
  },
};

export function computeTrackScore(params   
                     
                 
                              
                                                            
                                  
     
                                                                                           
                                                                                  
     
                                        
     
                                                                                    
                                                                
     
                                          
                                                 
 )                   {
  const trackSpec = params.rubric.tracks[params.track];
  if (!trackSpec) {
    throw new Error(`Unknown track: ${params.track}`);
  }

  const useProportionalCredit =
    (params.rubric.credit_rule?.document_checks ?? 'proportional_unit_credit') ===
    'proportional_unit_credit';

  const formatSpecs = params.rubric.question_formats ?? DEFAULT_QUESTION_FORMATS;

  const checkById = new Map                         ();
  for (const chk of params.rubric.checks) {
    checkById.set(chk.id, chk);
    for (const alias of chk.alias_ids ?? []) {
      checkById.set(alias, chk);
    }
  }

  const advisoryNotes                 = [];
  const unitJudgments = new Map                                    ();

  const registerUnitResult = (unitId        , metList          , findingsList                 ) => {
    if (!unitJudgments.has(unitId)) {
      unitJudgments.set(unitId, new Map());
    }
    const perCheck = unitJudgments.get(unitId) ;

    for (const metId of metList ?? []) {
      const canonical = checkById.get(metId);
      if (!canonical) {
        throw new Error(`Unknown check ID "${metId}" on unit "${unitId}"`);
      }
      if (perCheck.has(canonical.id)) {
        throw new Error(`Duplicate judgment for check "${canonical.id}" on unit "${unitId}"`);
      }
      perCheck.set(canonical.id, 'meets');
    }

    for (const f of findingsList ?? []) {
      const canonical = checkById.get(f.check);
      if (!canonical) {
        throw new Error(`Unknown check ID "${f.check}" in findings on unit "${unitId}"`);
      }
      if (perCheck.has(canonical.id)) {
        throw new Error(
          `Conflicting/duplicate judgment for check "${canonical.id}" on unit "${unitId}"`,
        );
      }
      if (f.status === 'minor_risk') {
        advisoryNotes.push({
          unit: unitId,
          checkId: canonical.id,
          reason: f.reason,
          quote: f.quote,
        });
        perCheck.set(canonical.id, 'meets');
      } else {
        perCheck.set(canonical.id, f.status);
      }
    }
  };

  for (const ur of params.unitResults) {
    registerUnitResult(ur.unit, ur.met, ur.findings);
  }

  // Build normalized question list (either explicit params.questions or synthesized from expectedUnitsByType)
  const normalizedQuestions         
               
                             
                                     
                                       
     = [];

  if (params.questions && params.questions.length > 0) {
    for (const q of params.questions) {
      const fmt = normalizeQuestionFormat(q.rawFormat);
      registerUnitResult(q.id, q.met, q.findings);
      normalizedQuestions.push({
        id: q.id,
        format: fmt,
        role: q.role,
        inheritedSubPartCheckIds: q.inheritedSubPartCheckIds ?? [],
      });
    }
  } else {
    const formatKeys                     = [
      'mcq',
      'open_ended',
      'cata',
      'numeric_math',
      'short_text',
      'ordering',
      'multi_input',
    ];
    for (const fk of formatKeys) {
      for (const qId of params.expectedUnitsByType[fk] ?? []) {
        normalizedQuestions.push({
          id: qId,
          format: fk,
          inheritedSubPartCheckIds: [],
        });
      }
    }
  }

  // Ensure expectedUnitsByType['question'] automatically includes normalizedQuestions if omitted
  const effectiveUnitsByType                                       = {
    ...params.expectedUnitsByType,
  };
  if (
    (!effectiveUnitsByType['question'] || effectiveUnitsByType['question'].length === 0) &&
    normalizedQuestions.length > 0
  ) {
    effectiveUnitsByType['question'] = normalizedQuestions.map((q) => q.id);
  }

  const pkEval = evaluatePriorKnowledgeAudit(params.priorKnowledgeAudit);
  const dimensionSubtotals                                                        = {};
  const checkBreakdowns                        = [];
  const questionBreakdownsMap = new Map                                ();
  for (const q of normalizedQuestions) {
    questionBreakdownsMap.set(q.id, {
      questionId: q.id,
      format: q.format,
      role: q.role,
      itemPointsAvailable: 0,
      itemPointsEarned: 0,
      itemChecksApplicable: 0,
      itemChecksMeeting: 0,
      feedbackPointsAvailable: 0,
      feedbackPointsEarned: 0,
      feedbackChecksApplicable: 0,
      feedbackChecksMeeting: 0,
    });
  }

  const missingExpectedBlocks           = [];

  const scoreStandardCheckGroup = (
    groupDimensionKey        ,
    budget        ,
    checks                   ,
  )                                        => {
    const rawEval = checks.map((chk) => {
      if (chk.unit_type === 'prior_knowledge_audit') {
        const total = pkEval.totalItems;
        return {
          chk,
          isPriorKnowledgeGate: true,
          applicable: 1,
          meeting: pkEval.pkCheckEarned ? 1 : 0,
          revising: pkEval.openGapIds.length > 0 ? 1 : 0,
          unverified: !pkEval.pkCheckEarned && pkEval.openGapIds.length === 0 ? 1 : 0,
          na: 0,
          remainingUnits:
            pkEval.openGapIds.length > 0
              ? pkEval.openGapIds
              : !pkEval.pkCheckEarned
                ? total > 0
                  ? pkEval.unreviewedIds
                  : ['prior_knowledge_audit']
                : [],
          allNa: false,
          noUnitsProvided: false,
        };
      }

      const units = effectiveUnitsByType[chk.unit_type] ?? [];
      if (units.length === 0) {
        return {
          chk,
          isPriorKnowledgeGate: false,
          applicable: 0,
          meeting: 0,
          revising: 0,
          unverified: 1,
          na: 0,
          remainingUnits: [`missing_${chk.unit_type}`],
          allNa: false,
          noUnitsProvided: true,
        };
      }

      let meeting = 0;
      let revising = 0;
      let unverified = 0;
      let na = 0;
      const remainingUnits           = [];

      const defaultTrackStatus                = chk.default_na_tracks?.includes(params.track)
        ? 'not_applicable'
        : 'unverified';

      for (const u of units) {
        const st = unitJudgments.get(u)?.get(chk.id) ?? defaultTrackStatus;
        if (st === 'meets') {
          meeting += 1;
        } else if (st === 'not_applicable') {
          na += 1;
        } else if (st === 'revise') {
          revising += 1;
          remainingUnits.push(u);
        } else {
          unverified += 1;
          remainingUnits.push(u);
        }
      }

      const applicable = units.length - na;
      return {
        chk,
        isPriorKnowledgeGate: false,
        applicable,
        meeting,
        revising,
        unverified,
        na,
        remainingUnits,
        allNa: applicable === 0 && units.length > 0,
        noUnitsProvided: false,
      };
    });

    const allUnitsMissing =
      rawEval.length > 0 && rawEval.every((r) => r.noUnitsProvided === true);
    if (allUnitsMissing) {
      missingExpectedBlocks.push(groupDimensionKey);
    }

    const applicableBaseSum = rawEval
      .filter((r) => !r.allNa)
      .reduce((acc, r) => acc + r.chk.base_points, 0);

    let groupEarned = 0;

    for (const r of rawEval) {
      if (r.allNa || applicableBaseSum === 0) {
        checkBreakdowns.push({
          checkId: r.chk.id,
          dimension: groupDimensionKey,
          label: r.chk.label,
          status: 'not_applicable',
          pointsAvailable: 0,
          pointsEarned: 0,
          unitsApplicable: 0,
          unitsMeeting: 0,
          unitsNeedingRevision: 0,
          unitsUnverified: 0,
          unitsNotApplicable: r.na,
          remainingUnits: [],
        });
        continue;
      }

      const pointsAvailable = (budget * r.chk.base_points) / applicableBaseSum;
      const isFullyEarned = r.applicable > 0 && r.meeting === r.applicable;

      let pointsEarned        ;
      if (r.isPriorKnowledgeGate || !useProportionalCredit) {
        pointsEarned = isFullyEarned ? pointsAvailable : 0;
      } else {
        pointsEarned = r.applicable > 0 ? pointsAvailable * (r.meeting / r.applicable) : 0;
      }

      groupEarned += pointsEarned;

      const status                                = isFullyEarned
        ? 'earned'
        : r.revising > 0
          ? 'needs_revision'
          : 'unverified';

      checkBreakdowns.push({
        checkId: r.chk.id,
        dimension: groupDimensionKey,
        label: r.chk.label,
        status,
        pointsAvailable,
        pointsEarned,
        unitsApplicable: r.applicable,
        unitsMeeting: r.meeting,
        unitsNeedingRevision: r.revising,
        unitsUnverified: r.unverified,
        unitsNotApplicable: r.na,
        remainingUnits: r.remainingUnits,
      });
    }

    return {
      earned: groupEarned,
      available: allUnitsMissing ? budget : applicableBaseSum > 0 ? budget : 0,
    };
  };

  /**
   * Scores per-question checks with exact 1/N equal per-question distribution.
   */
  const scorePerQuestionPool = (
    poolDimensionKey        ,
    poolBudget        ,
    mode                     ,
  )                                        => {
    const N = normalizedQuestions.length;
    if (N === 0) {
      missingExpectedBlocks.push(poolDimensionKey);
      return { earned: 0, available: poolBudget };
    }

    // Track per-check rollup across all questions where that check was inspected
    const accumByCheck = new Map 
             
       
                             
                                
                             
                           
                        
                         
                           
                   
                                 
       
     ();

    const ensureCheckAccum = (chkId        ) => {
      const spec = checkById.get(chkId);
      if (!spec) {
        throw new Error(`Missing check specification for "${chkId}"`);
      }
      if (!accumByCheck.has(spec.id)) {
        accumByCheck.set(spec.id, {
          chk: spec,
          pointsAvailable: 0,
          pointsEarned: 0,
          applicable: 0,
          meeting: 0,
          revising: 0,
          unverified: 0,
          na: 0,
          remainingUnits: [],
        });
      }
      return accumByCheck.get(spec.id) ;
    };

    // First determine which questions have >= 1 applicable check in this pool
    const perQuestionActiveChecks         
                                              
                         
                              
       = [];

    for (const q of normalizedQuestions) {
      const fmtSpec = formatSpecs[q.format];
      const baseIds =
        mode === 'item'
          ? [...fmtSpec.item_check_ids, ...q.inheritedSubPartCheckIds]
          : [...fmtSpec.feedback_check_ids];
      const dedupedIds = Array.from(new Set(baseIds));

      const applicableIds           = [];
      for (const cid of dedupedIds) {
        const acc = ensureCheckAccum(cid);
        const st = unitJudgments.get(q.id)?.get(acc.chk.id) ?? 'unverified';
        if (st === 'not_applicable') {
          acc.na += 1;
        } else {
          applicableIds.push(acc.chk.id);
        }
      }

      perQuestionActiveChecks.push({ q, checkIds: dedupedIds, applicableIds });
    }

    const activeQuestionCount = perQuestionActiveChecks.filter(
      (x) => x.applicableIds.length > 0,
    ).length;

    if (activeQuestionCount === 0) {
      for (const acc of accumByCheck.values()) {
        checkBreakdowns.push({
          checkId: acc.chk.id,
          dimension: poolDimensionKey,
          label: acc.chk.label,
          status: 'not_applicable',
          pointsAvailable: 0,
          pointsEarned: 0,
          unitsApplicable: 0,
          unitsMeeting: 0,
          unitsNeedingRevision: 0,
          unitsUnverified: 0,
          unitsNotApplicable: acc.na,
          remainingUnits: [],
        });
      }
      return { earned: 0, available: 0 };
    }

    const perQuestionShare = poolBudget / activeQuestionCount;
    let totalPoolEarned = 0;

    for (const { q, applicableIds } of perQuestionActiveChecks) {
      const qBreakdown = questionBreakdownsMap.get(q.id) ;
      if (applicableIds.length === 0) {
        continue;
      }

      const sliceWeight = perQuestionShare / applicableIds.length;
      let qEarned = 0;
      let qMeeting = 0;

      for (const cid of applicableIds) {
        const acc = ensureCheckAccum(cid);
        const st = unitJudgments.get(q.id)?.get(cid) ?? 'unverified';
        acc.applicable += 1;
        acc.pointsAvailable += sliceWeight;

        if (st === 'meets') {
          acc.meeting += 1;
          qMeeting += 1;
          if (useProportionalCredit) {
            acc.pointsEarned += sliceWeight;
            qEarned += sliceWeight;
          }
        } else if (st === 'revise') {
          acc.revising += 1;
          acc.remainingUnits.push(q.id);
        } else {
          acc.unverified += 1;
          acc.remainingUnits.push(q.id);
        }
      }

      if (!useProportionalCredit && qMeeting === applicableIds.length) {
        qEarned = perQuestionShare;
      }

      totalPoolEarned += qEarned;

      if (mode === 'item') {
        qBreakdown.itemPointsAvailable = perQuestionShare;
        qBreakdown.itemPointsEarned = qEarned;
        qBreakdown.itemChecksApplicable = applicableIds.length;
        qBreakdown.itemChecksMeeting = qMeeting;
      } else {
        qBreakdown.feedbackPointsAvailable = perQuestionShare;
        qBreakdown.feedbackPointsEarned = qEarned;
        qBreakdown.feedbackChecksApplicable = applicableIds.length;
        qBreakdown.feedbackChecksMeeting = qMeeting;
      }
    }

    for (const acc of accumByCheck.values()) {
      if (acc.applicable === 0) {
        checkBreakdowns.push({
          checkId: acc.chk.id,
          dimension: poolDimensionKey,
          label: acc.chk.label,
          status: 'not_applicable',
          pointsAvailable: 0,
          pointsEarned: 0,
          unitsApplicable: 0,
          unitsMeeting: 0,
          unitsNeedingRevision: 0,
          unitsUnverified: 0,
          unitsNotApplicable: acc.na,
          remainingUnits: [],
        });
        continue;
      }

      const isFullyEarned = acc.meeting === acc.applicable;
      const earnedPts = useProportionalCredit
        ? acc.pointsEarned
        : isFullyEarned
          ? acc.pointsAvailable
          : 0;

      const status                                = isFullyEarned
        ? 'earned'
        : acc.revising > 0
          ? 'needs_revision'
          : 'unverified';

      checkBreakdowns.push({
        checkId: acc.chk.id,
        dimension: poolDimensionKey,
        label: acc.chk.label,
        status,
        pointsAvailable: acc.pointsAvailable,
        pointsEarned: earnedPts,
        unitsApplicable: acc.applicable,
        unitsMeeting: acc.meeting,
        unitsNeedingRevision: acc.revising,
        unitsUnverified: acc.unverified,
        unitsNotApplicable: acc.na,
        remainingUnits: acc.remainingUnits,
      });
    }

    return { earned: totalPoolEarned, available: poolBudget };
  };

  // First pass: score each configured dimension
  for (const [dimKey, budget] of Object.entries(trackSpec.dimension_budgets)) {
    if (dimKey === 'assessment_format') {
      const res = scorePerQuestionPool('assessment_format', budget, 'item');
      dimensionSubtotals['assessment_format'] = res;
      continue;
    }

    if (dimKey === 'assessment_feedback') {
      if (params.feedbackWithheldForSecureExam) {
        const setFbChecks = params.rubric.checks.filter(
          (c) => c.dimension === 'assessment_feedback_set',
        );
        for (const sc of setFbChecks) {
          checkBreakdowns.push({
            checkId: sc.id,
            dimension: 'assessment_feedback',
            label: sc.label,
            status: 'not_applicable',
            pointsAvailable: 0,
            pointsEarned: 0,
            unitsApplicable: 0,
            unitsMeeting: 0,
            unitsNeedingRevision: 0,
            unitsUnverified: 0,
            unitsNotApplicable: 1,
            remainingUnits: [],
          });
        }
        dimensionSubtotals['assessment_feedback'] = { earned: 0, available: 0 };
        continue;
      }

      const split = trackSpec.feedback_split ?? {
        set_level_share: 4 / 14,
        question_level_share: 10 / 14,
      };
      const setBudget = budget * split.set_level_share;
      const questionBudget = budget * split.question_level_share;

      const setFbChecks = params.rubric.checks.filter(
        (c) => c.dimension === 'assessment_feedback_set',
      );
      const setRes = scoreStandardCheckGroup('assessment_feedback', setBudget, setFbChecks);
      const qRes = scorePerQuestionPool('assessment_feedback', questionBudget, 'feedback');

      dimensionSubtotals['assessment_feedback'] = {
        earned: setRes.earned + qRes.earned,
        available: setRes.available + qRes.available,
      };
      continue;
    }

    const checksForDim = params.rubric.checks.filter((c) => c.dimension === dimKey);
    dimensionSubtotals[dimKey] = scoreStandardCheckGroup(dimKey, budget, checksForDim);
  }

  // Cross-dimension proportional renormalization if a conditional visible dimension (e.g., secure exam feedback) is N/A
  const configuredVisibleTarget = Object.entries(trackSpec.dimension_budgets)
    .filter(([k]) => k !== 'prior_knowledge')
    .reduce((acc, [, v]) => acc + v, 0);

  const rawVisibleAvailable = Object.entries(dimensionSubtotals)
    .filter(([k]) => k !== 'prior_knowledge')
    .reduce((acc, [, sub]) => acc + sub.available, 0);

  if (
    rawVisibleAvailable > 0 &&
    Math.abs(rawVisibleAvailable - configuredVisibleTarget) > 1e-9 &&
    missingExpectedBlocks.length === 0
  ) {
    const scale = configuredVisibleTarget / rawVisibleAvailable;
    for (const [dimKey, sub] of Object.entries(dimensionSubtotals)) {
      if (dimKey !== 'prior_knowledge' && sub.available > 0) {
        sub.earned *= scale;
        sub.available *= scale;
      }
    }
    for (const cb of checkBreakdowns) {
      if (cb.dimension !== 'prior_knowledge' && cb.pointsAvailable > 0) {
        cb.pointsAvailable *= scale;
        cb.pointsEarned *= scale;
      }
    }
    for (const qb of questionBreakdownsMap.values()) {
      qb.itemPointsAvailable *= scale;
      qb.itemPointsEarned *= scale;
      qb.feedbackPointsAvailable *= scale;
      qb.feedbackPointsEarned *= scale;
    }
  }

  let exactScore = 0;
  let visiblePointsEarned = 0;
  let visiblePointsAvailable = 0;
  let priorKnowledgePointsEarned = 0;
  let priorKnowledgePointsAvailable = 0;

  for (const dimKey of Object.keys(trackSpec.dimension_budgets)) {
    const sub = dimensionSubtotals[dimKey] ?? { earned: 0, available: 0 };
    exactScore += sub.earned;
    if (dimKey === 'prior_knowledge') {
      priorKnowledgePointsEarned += sub.earned;
      priorKnowledgePointsAvailable += sub.available;
    } else {
      visiblePointsEarned += sub.earned;
      visiblePointsAvailable += sub.available;
    }
  }

  const s3Breakdown = checkBreakdowns.find((c) => c.checkId === 'S3');
  const s3GateSatisfied =
    !params.rubric.ready_threshold.require_defensible_s3_keys ||
    !s3Breakdown ||
    s3Breakdown.status === 'earned' ||
    s3Breakdown.status === 'not_applicable';

  const displayScore = Math.round(exactScore);
  const ready =
    displayScore >= params.rubric.ready_threshold.score_min &&
    (!params.rubric.ready_threshold.require_lo_context || params.loContextSatisfied) &&
    (!params.rubric.ready_threshold.require_zero_missing_expected_blocks ||
      missingExpectedBlocks.length === 0) &&
    s3GateSatisfied;

  return {
    track: params.track,
    rubricVersion: params.rubric.rubric_version,
    exactScore,
    displayScore,
    visiblePointsEarned,
    visiblePointsAvailable,
    priorKnowledgePointsEarned,
    priorKnowledgePointsAvailable,
    ready,
    dimensionSubtotals,
    checkBreakdowns,
    questionBreakdowns: Array.from(questionBreakdownsMap.values()),
    advisoryNotes,
    priorKnowledgeEvaluation: pkEval,
    missingExpectedBlocks,
  };
}
