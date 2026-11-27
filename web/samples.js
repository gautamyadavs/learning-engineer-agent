/**
 * Permission-clean sample documents for testing Track 1 (Objectives Only),
 * Track 2 (Assessment / Quiz across multiple item formats), and the Missing-LO Pre-Review Gate.
 */
export const SAMPLE_DOCUMENTS = [
  {
    id: 'sample-lo-regression-ai',
    track: 'objectives_only',
    title: 'Module 2 Learning Objectives — Regression Diagnostics & AI Feedback',
    badge: 'Track 1 · Objectives Only',
    description:
      'Contains planted flaws: unobservable verbs ("Understand", "Appreciate"), instructor-centered framing, a 4-verb compound objective, an ambiguous dual-track condition, and an inline orientation note.',
    linkedLoMarkdown: '',
    markdown: `# Module 2: Regression Diagnostics & AI-Assisted Feedback

## Learning Objectives

Mechanism preview for Module 3: shrinkage estimators and cross-validation trade bias for lower variance on small samples.

By the end of this module, learners will be able to:

- **LO1.** Understand the core assumptions of ordinary least squares linear regression.
- **LO2.** Instructors will cover how to read residual-versus-fitted plots and Q-Q plots in R or Python.
- **LO3.** Build a multiple regression model, diagnose heteroscedasticity, write an APA technical memo, and design an automated peer-review rubric.
- **LO4.** Implement or trace a residual-diagnostic script on an observational housing dataset.
- **LO5.** Given a student data-analysis paragraph, an analytic rubric, and an AI-generated critique, evaluate whether the AI comment accurately cites evidence from the student's work without using another AI tool.
- **LO6.** Appreciate the importance of algorithmic fairness when interpreting predictive model errors across demographic subgroups.
`,
  },
  {
    id: 'sample-quiz-mixed-formats',
    track: 'assessment_quiz',
    title: 'Module 2 Formative & Checkpoint Quiz — Mixed Item Formats (6 Questions)',
    badge: 'Track 2 · Mixed Quiz (MCQ, CATA, Numeric, OE)',
    description:
      'Tests all Track 2 dimensions: swapped KLI answer key (S3 Ready gate blocker), aid contradiction (A4), All-of-the-above & key-length cues, early-formative CATA, Numeric tolerance/units gap, circular rubric, and missing distractor feedback.',
    linkedLoMarkdown: `## Target Learning Objectives
- **LO1:** Diagnose violations of linear regression assumptions from residual-versus-fitted plots.
- **LO2:** Given a student draft, rubric, and AI comment, evaluate whether the comment addresses the cited rubric criterion without using another AI tool.
- **LO3:** Distinguish Facts, Skills, and Principles in the KLI framework when designing practice activities.
- **LO4:** Compute ordinary least squares residuals from fitted linear equations.`,
    markdown: `# Module 2 Quiz: Diagnostics, KLI & AI Feedback Review

Purpose: Formative practice quiz for Module 2 learners.

### Q1 (LO2 · MCQ)
Which of the following checks should an instructor perform before releasing an AI-generated comment to a student?
- A. Verify that the comment cites the intended rubric criterion
- B. Verify that the comment is factually accurate about the student's draft
- C. Verify that the tone focuses on the task rather than personal traits
- D. All of the above *

Feedback: Correct / Incorrect.

### Q2 (LO2 · MCQ)
You may paste the AI comments into ChatGPT to check them. A student's paragraph opens with a clear thesis sentence, yet the AI tool writes: "Your paragraph is missing a thesis." Which option best describes this failure?
- A. A tone error
- B. A formatting error
- C. A factual misreading of the student's text, because the comment contradicts the explicit opening thesis sentence and would mislead revision if shared unedited *
- D. A citation error

Feedback:
- A: Incorrect.
- B: Incorrect.
- C: Correct.
- D: Incorrect.

### Q3 (LO3 · LBD_MCQ)
Using the KLI framework (Koedinger, Corbett, & Perfetti, 2012), what type of knowledge Component is targeted when students explain the causal interrelationships among variables in photosynthesis in their own words?
- A. Fact
- B. Skill *
- C. Principle

Feedback:
- A: Incorrect. Facts involve verbatim recall.
- B: Correct. Skills involve understanding the conceptual interrelationships among elements within a larger causal structure.
- C: Incorrect. Principles involve executing step-by-step procedural tasks.

### Q4 (LO1 · Check All That Apply — Formative)
Which visual patterns in a residualplot indicate violation of linear regression assumptions?
- [x] Funnel-shaped spread increasing with fitted values
- [x] Systematic curved U-shape across fitted values
- [ ] Random horizontal cloud centered around zero
- [x] Extreme high-leverage outlier distorting the slope
- [ ] All of the above

Scoring: All-or-nothing (1 pt only if exact combination is checked, 0 pts otherwise).
Feedback: Incorrect — try again!

### Q5 (LO4 · Numeric Input)
Given the fitted regression line y_hat = 2.5x + 1.4, compute the residual e_i = y_i - y_hat_i for an observation at x = 3.3 with observed outcome y = 11.0.
Answer: 1.35

Feedback: The answer is 1.35.

### Q6 (LO1 · Open-Ended)
Examine the residual plot from the regional housing dataset and write 150 words diagnosing any assumption violations and recommending a remedy.

Scoring Rubric:
| Level | Criteria |
| --- | --- |
| 4 - Excellent | Demonstrates excellent statistical insight into the residual plot. |
| 3 - Good | Demonstrates good insight with minor gaps. |
| 2 - Fair | Shows partial understanding. |
| 1 - Poor | Little to no understanding shown. |
`,
  },
  {
    id: 'sample-quiz-missing-los',
    track: 'assessment_quiz',
    title: 'Standalone Checkpoint Quiz (Missing Target LOs — Gate Demo)',
    badge: 'Pre-Review LO Gate Demo',
    description:
      'Demonstrates the 0-credit Missing-LO Pre-Review Gate: clicking Run AI Audit pauses cleanly before spending tokens and lets you paste LOs or draft candidate LOs.',
    linkedLoMarkdown: '',
    markdown: `# Quick Checkpoint: Experimental Design & Sampling

### Question 1 (MCQ)
A medical researcher assigns clinics at random to either an AI triage alert or standard care and measures patient wait time. What type of design is this?
- A. Cluster randomized controlled trial *
- B. Observational cohort study
- C. Case-control study
- D. Cross-sectional survey

Feedback:
- A: Correct! Randomizing intact clinics rather than individual patients defines a cluster RCT, preventing contamination within clinics.
- B: Incorrect. Clinics were actively randomized by the researcher rather than passively observed.
- C: Incorrect. Participants were not sampled retrospectively by outcome status.
- D: Incorrect. An intervention was randomly assigned rather than measured at a single snapshot.

### Question 2 (Ordering)
Drag and drop the steps of conducting a power analysis into order from top to bottom:
1. First, specify the minimum practically meaningful effect size (delta) based on domain context.
2. Set the target Type I error rate (alpha) and desired statistical power (1 - beta).
3. Estimate outcome variance and intraclass correlation from pilot or prior literature.
4. Finally, compute the required sample size per arm and adjust for anticipated attrition.

Grading: Exact position match only (all-or-nothing). Drag cards with mouse to reorder.
Feedback: Correct order is 1, 2, 3, 4.
`,
  },
];
