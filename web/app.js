/**
 * Learning Engineer (LE) Agent — Grammarly-Style Annotation Studio Controller (`web/app.js`)
 * Rubric v0.3.1 · Full WCAG 2.2 AA Keyboard/ARIA/Modal Accessibility & 5-Persona UX Optimizations
 *
 * Shares 100% of deterministic scoring, segmentation, KLI KC reconciliation, and Prior Knowledge
 * state transitions with `src/lib/le-scoring/scorer.ts` (`web/scorer.js`).
 */

import {
  checkMissingLoGate,
  computeTrackScore,
  reconcileKliKcScope,
  preparePriorKnowledgeSeedFromKcs,
  evaluatePriorKnowledgeAudit,
  markRemainingPrerequisitesHave,
  buildRemediationPlacementPreview,
  buildPromotePrerequisiteToLoPreview,
} from './scorer.js';
import { SAMPLE_DOCUMENTS } from './samples.js';
import { extractMarkdownFromFile, htmlToCleanMarkdown } from './docx-loader.js';
import {
  getConnectionStatus,
  configureConnection,
  clearEphemeralCredentials,
  executeAuditAction,
} from './ai-service.js';
import {
  isGateEnabled,
  isStudioUnlocked,
  verifyPilotPasscode,
  lockStudioSession,
} from './auth-gate.js';

const CIRCUMFERENCE = 2 * Math.PI * 35; // 219.91

const state = {
  rubric: null,
  eventsBound: false,
  track: 'objectives_only',
  viewMode: 'edit', // 'edit' | 'annotated'
  railTab: 'issues', // 'issues' | 'rubric' | 'kcs' | 'pk'
  findingFilter: 'all', // 'all' | 'autofix' | 'alignment' | 'item' | 'feedback' | 'dismissed'
  editingFindingId: null, // finding id currently open in inline Edit Fix drawer
  versions: [], // [{ id, label, title, markdown, linkedLoMarkdown, sampleOriginId? }]
  currentVersionIdx: 0,
  auditPayload: null,
  scoreOutput: null,
  scoredVersionId: null,
  findings: [],
  activeFindingId: null,
  kcDecisions: {},
  pkAudit: {
    auditHasRun: false,
    items: [],
    triage: {},
  },
  awaitingRecheck: false,
  isBusy: false,
};

let activeModalEl = null;
let lastModalTriggerEl = null;

// --- DOM Elements ---
const els = {
  skipLink: document.getElementById('skip-to-workspace'),
  pilotLockScreen: document.getElementById('pilot-lock-screen'),
  pilotUnlockForm: document.getElementById('pilot-unlock-form'),
  pilotPasscodeInput: document.getElementById('pilot-passcode-input'),
  btnTogglePasscodeVis: document.getElementById('btn-toggle-passcode-vis'),
  pilotLockError: document.getElementById('pilot-lock-error'),
  btnUnlockStudio: document.getElementById('btn-unlock-studio'),
  btnUnlockLabel: document.getElementById('btn-unlock-label'),

  headerEl: document.getElementById('studio-topbar'),
  mainWorkspace: document.getElementById('main-workspace'),
  trackBtns: Array.from(document.querySelectorAll('.track-btn[data-track]')),
  btnConnectAi: document.getElementById('btn-connect-ai'),
  connStatusLabel: document.getElementById('conn-status-label'),
  fileUploadInput: document.getElementById('file-upload-input'),
  btnUploadDoc: document.getElementById('btn-upload-doc'),
  btnRunAudit: document.getElementById('btn-run-audit'),
  btnRunAuditLabel: document.getElementById('btn-run-audit-label'),
  btnLockSession: document.getElementById('btn-lock-session'),

  missingLoBanner: document.getElementById('missing-lo-banner'),
  missingLoMessage: document.getElementById('missing-lo-message'),
  btnCloseGate: document.getElementById('btn-close-gate'),
  btnGateOpenLoBox: document.getElementById('btn-gate-open-lo-box'),
  loFileUploadInput: document.getElementById('lo-file-upload-input'),
  btnGateUploadLo: document.getElementById('btn-gate-upload-lo'),
  btnGateDraftLos: document.getElementById('btn-gate-draft-los'),

  stagedBar: document.getElementById('staged-changes-bar'),
  stagedBarMessage: document.getElementById('staged-bar-message'),
  btnClearStaged: document.getElementById('btn-clear-staged'),
  btnPreviewApply: document.getElementById('btn-preview-apply'),

  recheckBar: document.getElementById('recheck-bar'),
  recheckBarMessage: document.getElementById('recheck-bar-message'),
  btnRecheckVersion: document.getElementById('btn-recheck-version'),

  loAnchorPanel: document.getElementById('lo-anchor-panel'),
  btnRunAuditFromLo: document.getElementById('btn-run-audit-from-lo'),
  btnToggleLoTextarea: document.getElementById('btn-toggle-lo-textarea'),
  linkedLoTextarea: document.getElementById('linked-lo-textarea'),

  paperDropzone: document.getElementById('paper-dropzone'),
  dropzoneStrip: document.getElementById('dropzone-strip'),
  docTitleInput: document.getElementById('doc-title-input'),
  tabViewAnnotated: document.getElementById('tab-view-annotated'),
  tabViewEdit: document.getElementById('tab-view-edit'),
  editorPanelWrap: document.getElementById('editor-panel-wrap'),
  versionSelect: document.getElementById('version-select'),
  btnExportMd: document.getElementById('btn-export-md'),
  samplePicker: document.getElementById('sample-picker'),
  markdownEditor: document.getElementById('markdown-editor'),
  annotatedCanvas: document.getElementById('annotated-canvas'),

  auditProgressCard: document.getElementById('audit-progress-card'),
  auditProgressTitle: document.getElementById('audit-progress-title'),
  auditProgressElapsed: document.getElementById('audit-progress-elapsed'),
  auditProgressStep: document.getElementById('audit-progress-step'),

  srScoreLive: document.getElementById('sr-score-live'),
  staleVersionBanner: document.getElementById('stale-version-banner'),
  btnRecheckInline: document.getElementById('btn-recheck-inline'),
  scoreRingFill: document.getElementById('score-ring-fill'),
  scoreRingNum: document.getElementById('score-ring-num'),
  readinessBadge: document.getElementById('readiness-badge'),
  scoreSplitLine: document.getElementById('score-split-line'),
  btnAuditPk: document.getElementById('btn-audit-pk'),
  scoreSummaryText: document.getElementById('score-summary-text'),
  dimensionBars: document.getElementById('dimension-bars'),

  railTabs: Array.from(document.querySelectorAll('.rail-tab')),
  railTabKc: document.getElementById('rail-tab-kc'),
  railTabpanel: document.getElementById('rail-tabpanel'),
  countIssues: document.getElementById('count-issues'),
  findingsToolbar: document.getElementById('findings-toolbar'),
  findingsFilterGroup: document.getElementById('findings-filter-group'),
  findingsBulkRow: document.getElementById('findings-bulk-row'),
  findingsShowingCount: document.getElementById('findings-showing-count'),
  btnStageAllFixes: document.getElementById('btn-stage-all-fixes'),
  railContent: document.getElementById('rail-content'),

  modalDiff: document.getElementById('modal-diff'),
  btnCloseDiffModal: document.getElementById('btn-close-diff-modal'),
  btnCancelApply: document.getElementById('btn-cancel-apply'),
  btnConfirmApply: document.getElementById('btn-confirm-apply'),
  diffPreviewList: document.getElementById('diff-preview-list'),

  modalConn: document.getElementById('modal-connection'),
  btnCloseConnModal: document.getElementById('btn-close-conn-modal'),
  inputProxyUrl: document.getElementById('input-proxy-url'),
  selectRamProvider: document.getElementById('select-ram-provider'),
  inputRamModel: document.getElementById('input-ram-model'),
  groupRamBaseUrl: document.getElementById('group-ram-baseurl'),
  inputRamBaseUrl: document.getElementById('input-ram-baseurl'),
  inputRamKey: document.getElementById('input-ram-key'),
  btnClearCreds: document.getElementById('btn-clear-creds'),
  btnSaveConn: document.getElementById('btn-save-conn'),

  toastRegion: document.getElementById('toast-region'),
};

// --- Initialization & Pilot Access Gate ---
async function init() {
  bindLockScreenEvents();

  if (!isGateEnabled() || isStudioUnlocked()) {
    await unlockAndMountStudio();
  } else {
    els.pilotLockScreen.hidden = false;
    els.headerEl.hidden = true;
    els.headerEl.inert = true;
    els.mainWorkspace.hidden = true;
    els.mainWorkspace.inert = true;
    els.skipLink.hidden = true;
    els.pilotPasscodeInput?.focus();
  }
}

function bindLockScreenEvents() {
  els.btnTogglePasscodeVis?.addEventListener('click', () => {
    const showing = els.pilotPasscodeInput.type === 'text';
    els.pilotPasscodeInput.type = showing ? 'password' : 'text';
    els.btnTogglePasscodeVis.setAttribute('aria-pressed', String(!showing));
    els.btnTogglePasscodeVis.textContent = showing ? 'Show' : 'Hide';
    els.pilotPasscodeInput.focus();
  });

  els.pilotUnlockForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.pilotLockError.hidden = true;
    els.btnUnlockStudio.disabled = true;
    els.btnUnlockLabel.textContent = 'Verifying Passcode...';

    try {
      const check = await verifyPilotPasscode(els.pilotPasscodeInput.value);
      if (!check.ok) {
        els.pilotLockError.textContent = check.error;
        els.pilotLockError.hidden = false;
        els.pilotPasscodeInput.select();
        return;
      }
      els.pilotPasscodeInput.value = '';
      els.pilotPasscodeInput.type = 'password';
      els.btnTogglePasscodeVis.setAttribute('aria-pressed', 'false');
      els.btnTogglePasscodeVis.textContent = 'Show';
      await unlockAndMountStudio();
      showToast('Pilot Studio unlocked. Passcode active in tab memory.', 'success');
    } finally {
      els.btnUnlockStudio.disabled = false;
      els.btnUnlockLabel.textContent = 'Unlock Annotation Studio';
    }
  });
}

async function unlockAndMountStudio() {
  if (!state.rubric) {
    const res = await fetch('./web/rubric-v0.3.json');
    state.rubric = await res.json();
  }

  els.pilotLockScreen.hidden = true;
  els.headerEl.hidden = false;
  els.headerEl.inert = false;
  els.mainWorkspace.hidden = false;
  els.mainWorkspace.inert = false;
  els.skipLink.hidden = false;

  loadSampleById(SAMPLE_DOCUMENTS[0].id);
  refreshConnectionBadge();
  if (!state.eventsBound) {
    bindEvents();
    state.eventsBound = true;
  }
}

function handleLockStudio() {
  lockStudioSession();
  clearEphemeralCredentials();
  state.versions = [];
  state.auditPayload = null;
  state.scoreOutput = null;
  state.findings = [];
  els.markdownEditor.value = '';
  els.annotatedCanvas.innerHTML = '';
  els.railContent.innerHTML = '';

  els.headerEl.hidden = true;
  els.headerEl.inert = true;
  els.mainWorkspace.hidden = true;
  els.mainWorkspace.inert = true;
  els.skipLink.hidden = true;
  els.pilotLockError.hidden = true;
  els.pilotLockScreen.hidden = false;
  refreshConnectionBadge();
  els.pilotPasscodeInput?.focus();
}

function currentVersion() {
  return state.versions[state.currentVersionIdx];
}

function syncEditorToCurrentVersion() {
  const v = currentVersion();
  if (!v) return;
  v.title = els.docTitleInput.value.trim() || 'Untitled Document';
  v.markdown = els.markdownEditor.value;
  v.linkedLoMarkdown = els.linkedLoTextarea.value;
}

function isUnmodifiedBuiltInSample() {
  if (state.versions.length !== 1) return false;
  const v = state.versions[0];
  if (!v?.sampleOriginId) return false;
  const orig = SAMPLE_DOCUMENTS.find((s) => s.id === v.sampleOriginId);
  return Boolean(orig && v.markdown.trim() === orig.markdown.trim());
}

function loadSampleById(sampleId) {
  const sample = SAMPLE_DOCUMENTS.find((s) => s.id === sampleId) || SAMPLE_DOCUMENTS[0];
  state.track = sample.track;
  els.samplePicker.value = sample.id;
  state.versions = [
    {
      id: 'v1',
      label: 'v1 · Initial Draft',
      title: sample.title,
      markdown: sample.markdown,
      linkedLoMarkdown: sample.linkedLoMarkdown || '',
      sampleOriginId: sample.id,
    },
  ];
  state.currentVersionIdx = 0;
  resetAuditStateForNewDoc();
  renderAll();
}

function resetAuditStateForNewDoc() {
  state.auditPayload = null;
  state.scoreOutput = null;
  state.scoredVersionId = null;
  state.findings = [];
  state.findingFilter = 'all';
  state.editingFindingId = null;
  state.activeFindingId = null;
  state.kcDecisions = {};
  state.pkAudit = { auditHasRun: false, items: [], triage: {} };
  state.awaitingRecheck = false;
  state.viewMode = 'edit';
  els.missingLoBanner.hidden = true;
}

// --- Accessible Toast Notifications (Replaces Blocking window.alert) ---
function showToast(message, variant = 'info') {
  if (!els.toastRegion) return;
  const toast = document.createElement('div');
  toast.className = `toast ${variant === 'error' ? 'toast--error' : variant === 'success' ? 'toast--success' : ''}`;
  if (variant === 'error') toast.setAttribute('role', 'alert');

  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);

  els.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4600);
}

// --- Accessible Modal Focus Trap & Escape Manager (WCAG 2.1.2 & 2.4.3) ---
function openModal(backdropEl, triggerEl = document.activeElement) {
  activeModalEl = backdropEl;
  lastModalTriggerEl = triggerEl;
  backdropEl.hidden = false;

  if (els.headerEl) els.headerEl.inert = true;
  if (els.mainWorkspace) els.mainWorkspace.inert = true;

  const focusable = getModalFocusableElements(backdropEl);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    backdropEl.querySelector('.modal-dialog')?.focus();
  }
}

function closeModal(backdropEl = activeModalEl) {
  if (!backdropEl) return;
  backdropEl.hidden = true;
  if (els.headerEl) els.headerEl.inert = false;
  if (els.mainWorkspace) els.mainWorkspace.inert = false;

  const toFocus = lastModalTriggerEl;
  activeModalEl = null;
  lastModalTriggerEl = null;
  if (toFocus && typeof toFocus.focus === 'function') {
    toFocus.focus();
  }
}

function getModalFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hidden && el.offsetParent !== null);
}

// --- Core Audit Execution (Explicit Click Only — ADR-0003) ---
async function triggerAudit(actionType = 'review') {
  if (state.isBusy) return;
  syncEditorToCurrentVersion();
  const v = currentVersion();

  // Step 1: Zero-Credit Pre-Review Missing-LO Gate (ADR-0008)
  const gate = checkMissingLoGate({
    track: state.track,
    docMarkdown: v.markdown,
    linkedWorkspaceLoDocId: v.linkedLoMarkdown.trim() ? 'inline-reference-anchor' : undefined,
    linkedWorkspaceLoMarkdown: v.linkedLoMarkdown,
  });

  if (!gate.readyToReview) {
    els.missingLoMessage.textContent = gate.message;
    els.missingLoBanner.hidden = false;
    els.loAnchorPanel.hidden = false;
    els.linkedLoTextarea.hidden = false;
    els.btnToggleLoTextarea.setAttribute('aria-expanded', 'true');
    els.btnToggleLoTextarea.textContent = 'Collapse Reference LOs';
    els.missingLoBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('Target Learning Objectives are required before scoring (0 credits spent).', 'info');
    return;
  }
  els.missingLoBanner.hidden = true;

  setBusy(true, actionType === 'recheck' ? 'Rechecking...' : 'Auditing...');
  try {
    const payload = await executeAuditAction({
      action: actionType,
      track: state.track,
      docMarkdown: v.markdown,
      linkedLoMarkdown: v.linkedLoMarkdown,
      rubric: state.rubric,
    });

    state.auditPayload = payload;
    state.awaitingRecheck = false;
    state.scoredVersionId = v.id;
    state.findingFilter = 'all';
    state.editingFindingId = null;
    buildFlattenedFindings(v.markdown, payload);
    recomputeDeterministicScore();
    state.viewMode = 'annotated';
    state.railTab = 'issues';
    renderAll();

    showToast(
      `${actionType === 'recheck' ? 'Rechecked' : 'Audited'} ${v.id}: ${state.scoreOutput.displayScore}/100 (${
        state.findings.length
      } finding${state.findings.length === 1 ? '' : 's'}).`,
      state.scoreOutput.ready ? 'success' : 'info',
    );
  } catch (err) {
    showToast(`Audit Error: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
  }
}

function classifyFindingCategory(checkId) {
  if (/^FB-/i.test(checkId)) return 'feedback';
  if (/^(?:IWF|OE|CATA|NUM|TXT|ORD|MI)-/i.test(checkId)) return 'item';
  return 'alignment';
}

function buildFlattenedFindings(docMarkdown, payload) {
  const checkLookup = new Map(state.rubric.checks.map((c) => [c.id, c]));
  const rawList = [];

  for (const u of payload.results || []) {
    for (const f of u.findings || []) {
      if (f.status === 'not_applicable' || f.status === 'meets') continue;
      rawList.push({
        unit: u.unit,
        unitLabel: u.label || u.unit,
        ...f,
      });
    }
  }

  for (const q of payload.questions || []) {
    for (const f of q.findings || []) {
      if (f.status === 'not_applicable' || f.status === 'meets') continue;
      rawList.push({
        unit: q.id,
        unitLabel: q.label || q.id.toUpperCase(),
        ...f,
      });
    }
  }

  // Anchor every quote independently so two checks flagging the same line both keep Locate & Edit Fix!
  const built = rawList.map((item, idx) => {
    const spec = checkLookup.get(item.check);
    const range = item.quote ? locateBestQuoteRange(docMarkdown, item.quote) : null;
    const isBlocker = item.check === 'S3' && item.status !== 'minor_risk';

    const rawPrinciple = String(item.principle || '').trim();
    const expandedTitle =
      !rawPrinciple || rawPrinciple.toUpperCase() === item.check.toUpperCase()
        ? `${item.check} · ${spec?.label || 'Rubric Check'}`
        : rawPrinciple;

    return {
      id: `f-${idx + 1}`,
      check: item.check,
      category: classifyFindingCategory(item.check),
      isBlocker,
      status: item.status, // 'revise' | 'unverified' | 'minor_risk'
      unit: item.unit,
      unitLabel: item.unitLabel,
      title: expandedTitle,
      reason: item.reason,
      quote: range ? docMarkdown.slice(range.start, range.end) : item.quote || '',
      replacement: item.replacement,
      repairAction: item.repairAction,
      range, // { start, end } or null
      decision: 'pending', // 'pending' | 'accepted' | 'dismissed'
    };
  });

  // Pin Ready-Blockers (S3 answer-key / scoring-guide defects) to the top so authors never miss them
  built.sort((a, b) => Number(b.isBlocker) - Number(a.isBlocker));
  state.findings = built;
}

function locateBestQuoteRange(text, quote, blockedRanges = []) {
  const cleanQuote = String(quote || '').trim();
  if (!cleanQuote) return null;

  const isFree = (start, end) => !blockedRanges.some((r) => start < r.end && end > r.start);

  // 1. Exact substring match
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(cleanQuote, searchFrom);
    if (idx === -1) break;
    const end = idx + cleanQuote.length;
    if (isFree(idx, end)) return { start: idx, end };
    searchFrom = idx + 1;
  }

  // 2. Strip leading list marker ('- ', '* ', '1. ') if model quoted with/without bullet
  const stripped = cleanQuote.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
  if (stripped !== cleanQuote && stripped.length > 6) {
    const idx = text.indexOf(stripped);
    if (idx !== -1 && isFree(idx, idx + stripped.length)) {
      return { start: idx, end: idx + stripped.length };
    }
  }

  // 3. Whitespace-normalized & markdown-emphasis-tolerant regex match
  if (stripped.length >= 10) {
    const escaped = stripped
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*\\\*/g, '(?:\\*\\*)?')
      .replace(/\s+/g, '\\s+');
    try {
      const re = new RegExp(escaped, 'i');
      const m = re.exec(text);
      if (m && isFree(m.index, m.index + m[0].length)) {
        return { start: m.index, end: m.index + m[0].length };
      }
    } catch {}
  }

  return null;
}

function findAvailableQuoteRange(text, quote, occupiedRanges = []) {
  return locateBestQuoteRange(text, quote, occupiedRanges);
}

function recomputeDeterministicScore() {
  if (!state.auditPayload || !state.rubric) return;

  state.scoreOutput = computeTrackScore({
    rubric: state.rubric,
    track: state.track,
    loContextSatisfied: true,
    expectedUnitsByType: state.auditPayload.expectedUnitsByType || {},
    unitResults: state.auditPayload.results || [],
    questions: state.auditPayload.questions || [],
    feedbackWithheldForSecureExam: Boolean(state.auditPayload.feedbackWithheldForSecureExam),
    priorKnowledgeAudit: state.pkAudit,
  });
}

// --- Rendering ---
function renderAll() {
  const v = currentVersion();
  if (!v) return;

  // Track buttons
  els.trackBtns.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.track === state.track));
  });

  // Track 2 Reference LO box visibility + KLI KC tab visibility
  els.loAnchorPanel.hidden = state.track !== 'assessment_quiz';
  const showQuickRunWithLo =
    state.track === 'assessment_quiz' && !state.scoreOutput && Boolean(v.linkedLoMarkdown.trim());
  els.btnRunAuditFromLo.hidden = !showQuickRunWithLo;

  els.railTabKc.hidden = state.track !== 'objectives_only';
  if (state.track !== 'objectives_only' && state.railTab === 'kcs') {
    state.railTab = 'issues';
  }

  // Editor & Version selector
  els.docTitleInput.value = v.title;
  els.markdownEditor.value = v.markdown;
  els.linkedLoTextarea.value = v.linkedLoMarkdown;

  els.versionSelect.innerHTML = state.versions
    .map(
      (ver, idx) =>
        `<option value="${idx}" ${idx === state.currentVersionIdx ? 'selected' : ''}>${escapeHtml(
          ver.label,
        )}</option>`,
    )
    .join('');

  // View toggle (WAI-ARIA APG Roving Tabindex + Tabpanels)
  const isAnnotated = state.viewMode === 'annotated';
  els.tabViewAnnotated.setAttribute('aria-selected', String(isAnnotated));
  els.tabViewAnnotated.tabIndex = isAnnotated ? 0 : -1;
  els.tabViewEdit.setAttribute('aria-selected', String(!isAnnotated));
  els.tabViewEdit.tabIndex = !isAnnotated ? 0 : -1;

  els.editorPanelWrap.hidden = isAnnotated;
  els.annotatedCanvas.hidden = !isAnnotated;

  if (isAnnotated) {
    renderAnnotatedDocument(v.markdown);
  }

  // Staged changes bar & Recheck bar
  const acceptedList = state.findings.filter(
    (f) => f.decision === 'accepted' && typeof f.replacement === 'string' && f.range,
  );
  els.stagedBar.hidden = acceptedList.length === 0;
  if (acceptedList.length > 0) {
    els.stagedBarMessage.textContent = `${acceptedList.length} accepted revision${
      acceptedList.length === 1 ? '' : 's'
    } staged — preview diff to create version v${state.versions.length + 1}.`;
  }

  const isStaleVersion =
    state.awaitingRecheck || (state.scoreOutput && state.scoredVersionId && state.scoredVersionId !== v.id);
  els.recheckBar.hidden = !state.awaitingRecheck;
  els.staleVersionBanner.hidden = !isStaleVersion;

  renderScoreCard(isStaleVersion);
  renderRailTabs();
  renderFindingsToolbar();
  renderRailContent();
}

function renderAnnotatedDocument(markdown) {
  const canAnchorCurrentVersion =
    !state.scoredVersionId || state.scoredVersionId === currentVersion()?.id;

  const anchored = canAnchorCurrentVersion
    ? state.findings
        .filter((f) => f.range && f.decision !== 'dismissed')
        .sort((a, b) => a.range.start - b.range.start || b.range.end - a.range.end)
    : [];

  // Group overlapping spans within the same line so multi-check sentences show combined badges [O2 · O4]
  const groups = [];
  for (const f of anchored) {
    const prev = groups[groups.length - 1];
    const crossesNewline = markdown.slice(f.range.start, f.range.end).includes('\n');
    if (crossesNewline) continue;

    if (prev && f.range.start < prev.end) {
      prev.items.push(f);
    } else {
      groups.push({ start: f.range.start, end: f.range.end, items: [f] });
    }
  }

  let cursor = 0;
  const tokens = [];
  const tokenMap = new Map();

  groups.forEach((grp, idx) => {
    if (grp.start < cursor) return;
    tokens.push(markdown.slice(cursor, grp.start));
    const placeholder = `@@LE_HL_${idx}@@`;
    tokenMap.set(placeholder, grp);
    tokens.push(placeholder);
    cursor = grp.end;
  });
  tokens.push(markdown.slice(cursor));

  const markedMd = tokens.join('');
  let html = renderMarkdownBlocksToHtml(markedMd);

  for (const [placeholder, grp] of tokenMap.entries()) {
    const acceptedItem = grp.items.find((x) => x.decision === 'accepted' && x.replacement !== undefined);
    const primary =
      acceptedItem ||
      grp.items.find((x) => x.id === state.activeFindingId) ||
      grp.items.find((x) => x.isBlocker) ||
      grp.items[0];

    const modClass = acceptedItem
      ? 'le-hl--accepted'
      : primary.status === 'unverified'
        ? 'le-hl--unverified'
        : primary.status === 'minor_risk'
          ? 'le-hl--minor_risk'
          : '';
    const activeClass = grp.items.some((x) => x.id === state.activeFindingId) ? 'is-active' : '';
    const spanText = markdown.slice(grp.start, grp.end);

    const displaySpan = acceptedItem
      ? `<del style="opacity:0.7">${escapeHtml(acceptedItem.quote)}</del> → <strong>${escapeHtml(
          acceptedItem.replacement || '[Removed]',
        )}</strong>`
      : formatInlineMarkdown(escapeHtml(spanText));

    const badgeLabel = grp.items
      .map((x) => (x.decision === 'accepted' ? `${x.check} ✓` : x.check))
      .join(' · ');
    const allIds = grp.items.map((x) => x.id).join(' ');

    const replacementHtml = `<mark class="le-hl ${modClass} ${activeClass}" data-finding-id="${
      primary.id
    }" data-finding-ids="${allIds}" tabindex="0" role="button" aria-label="Inspect finding ${escapeHtml(
      badgeLabel,
    )}">${displaySpan}<span class="le-hl__badge">${escapeHtml(badgeLabel)}</span></mark>`;

    html = html.replace(placeholder, replacementHtml);
  }

  els.annotatedCanvas.innerHTML = html;

  els.annotatedCanvas.querySelectorAll('mark.le-hl').forEach((markEl) => {
    const activate = () => {
      const fid = markEl.dataset.findingId;
      focusFindingInRail(fid);
    };
    markEl.addEventListener('click', activate);
    markEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}

function renderMarkdownBlocksToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let tableRows = [];

  const flushList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const parsed = tableRows
      .filter((r) => !/^\|\s*[-:]+/.test(r))
      .map((r) =>
        r
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => formatInlineMarkdown(escapeHtml(c.trim()))),
      );
    if (parsed.length > 0) {
      const head = `<thead><tr>${parsed[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
      const body =
        parsed.length > 1
          ? `<tbody>${parsed
              .slice(1)
              .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
              .join('')}</tbody>`
          : '';
      out.push(`<table>${head}${body}</table>`);
    }
    tableRows = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^\|.+\|$/.test(trimmed)) {
      flushList();
      tableRows.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^####\s+/.test(trimmed)) {
      flushList();
      out.push(`<h4>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^####\s+/, '')))}</h4>`);
    } else if (/^###\s+/.test(trimmed)) {
      flushList();
      out.push(`<h3>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^###\s+/, '')))}</h3>`);
    } else if (/^##\s+/.test(trimmed)) {
      flushList();
      out.push(`<h2>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^##\s+/, '')))}</h2>`);
    } else if (/^#\s+/.test(trimmed)) {
      flushList();
      out.push(`<h1>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^#\s+/, '')))}</h1>`);
    } else if (/^>\s?/.test(trimmed)) {
      flushList();
      out.push(
        `<blockquote>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^>\s?/, '')))}</blockquote>`,
      );
    } else if (/^[-*•]\s+/.test(trimmed)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${formatInlineMarkdown(escapeHtml(trimmed.replace(/^[-*•]\s+/, '')))}</li>`);
    } else {
      flushList();
      out.push(`<p>${formatInlineMarkdown(escapeHtml(trimmed))}</p>`);
    }
  }

  flushList();
  flushTable();
  return out.join('\n');
}

function formatInlineMarkdown(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderScoreCard(isStaleVersion = false) {
  if (!state.scoreOutput) {
    els.scoreRingNum.textContent = '—';
    els.scoreRingFill.style.strokeDashoffset = String(CIRCUMFERENCE);
    els.readinessBadge.className = 'status-chip status-chip--idle';
    els.readinessBadge.textContent = 'Click "Run AI Audit" to Score';
    els.scoreSplitLine.textContent = '94 Visible pts + 6 Prior Knowledge (PK-1) pts';
    els.scoreSummaryText.textContent =
      'Nothing runs automatically—upload or edit your draft on the left, then click Run AI Audit to compute a deterministic /100 score and inline annotations.';
    els.dimensionBars.innerHTML = '';
    els.srScoreLive.textContent = 'Document not yet scored. Click Run AI Audit to compute score.';
    return;
  }

  const s = state.scoreOutput;
  const pct = Math.max(0, Math.min(100, s.displayScore));
  const offset = CIRCUMFERENCE * (1 - pct / 100);
  els.scoreRingNum.textContent = String(s.displayScore);
  els.scoreRingFill.style.strokeDashoffset = String(offset);

  const s3Check = s.checkBreakdowns.find((c) => c.checkId === 'S3');
  const s3Blocked =
    s.displayScore >= 80 &&
    !s.ready &&
    s3Check &&
    s3Check.status !== 'earned' &&
    s3Check.status !== 'not_applicable';

  let statusLabel = '';
  if (s.ready) {
    els.scoreRingFill.style.stroke = 'var(--ready-line)';
    els.readinessBadge.className = 'status-chip status-chip--ready';
    statusLabel = '✓ Ready (≥ 80 & Defensible Keys)';
  } else if (s3Blocked) {
    els.scoreRingFill.style.stroke = 'var(--unverified-line)';
    els.readinessBadge.className = 'status-chip status-chip--blocked';
    statusLabel = '! Ready Blocked · Fix S3 Answer Key';
  } else {
    els.scoreRingFill.style.stroke = 'var(--brand-600)';
    els.readinessBadge.className = 'status-chip status-chip--revise';
    statusLabel = '◆ Revision Needed (< 80)';
  }
  els.readinessBadge.textContent = statusLabel;

  els.scoreSplitLine.textContent = `Visible: ${s.visiblePointsEarned.toFixed(1)}/${s.visiblePointsAvailable.toFixed(
    0,
  )} pts · PK-1: ${s.priorKnowledgePointsEarned.toFixed(0)}/${s.priorKnowledgePointsAvailable.toFixed(0)} pts`;

  els.scoreSummaryText.textContent =
    state.auditPayload?.summary || 'Deterministic score computed from Rubric v0.3.1.';

  els.srScoreLive.textContent = `Score ${s.displayScore} out of 100 (${
    isStaleVersion ? `from ${state.scoredVersionId}, awaiting Recheck` : statusLabel
  }).`;

  const dimLabels = {
    objectives: 'Objectives (O1–O7)',
    alignment: 'LO Alignment (A1–A5)',
    assessment_shared: 'Shared Quality (S1–S5)',
    assessment_format: 'Item & Scoring (34/N)',
    assessment_feedback: 'Learner Feedback (FB)',
    clarity: 'Clarity (C1–C5)',
    prior_knowledge: 'Prior Knowledge (PK-1)',
  };

  els.dimensionBars.innerHTML = Object.entries(s.dimensionSubtotals)
    .map(([key, sub]) => {
      const ratio = sub.available > 0 ? Math.min(100, (sub.earned / sub.available) * 100) : 0;
      const label = dimLabels[key] || key;
      return `<div class="dim-row">
        <span class="dim-row__name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div
          class="dim-row__bar"
          role="progressbar"
          aria-label="${escapeHtml(label)}"
          aria-valuenow="${Number(sub.earned.toFixed(1))}"
          aria-valuemin="0"
          aria-valuemax="${Number(sub.available.toFixed(0))}"
        >
          <div class="dim-row__fill" style="width:${ratio.toFixed(1)}%"></div>
        </div>
        <span class="dim-row__pts">${sub.earned.toFixed(1)}/${sub.available.toFixed(0)}</span>
      </div>`;
    })
    .join('');
}

function renderRailTabs() {
  const activeCount = state.findings.filter((f) => f.decision !== 'dismissed').length;
  els.countIssues.textContent = String(activeCount);

  let activeTabId = 'rail-tab-issues';
  els.railTabs.forEach((btn) => {
    const selected = btn.dataset.railTab === state.railTab;
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
    if (selected && btn.id) activeTabId = btn.id;
  });
  els.railTabpanel.setAttribute('aria-labelledby', activeTabId);
}

function getFilteredFindings() {
  if (state.findingFilter === 'dismissed') {
    return state.findings.filter((f) => f.decision === 'dismissed');
  }
  const active = state.findings.filter((f) => f.decision !== 'dismissed');
  if (state.findingFilter === 'autofix') {
    return active.filter((f) => typeof f.replacement === 'string' && Boolean(f.range));
  }
  if (state.findingFilter === 'alignment') {
    return active.filter((f) => f.category === 'alignment');
  }
  if (state.findingFilter === 'item') {
    return active.filter((f) => f.category === 'item');
  }
  if (state.findingFilter === 'feedback') {
    return active.filter((f) => f.category === 'feedback');
  }
  return active;
}

function renderFindingsToolbar() {
  if (state.railTab !== 'issues' || !state.auditPayload || state.findings.length === 0) {
    els.findingsToolbar.hidden = true;
    return;
  }

  els.findingsToolbar.hidden = false;
  const active = state.findings.filter((f) => f.decision !== 'dismissed');
  const dismissedCount = state.findings.filter((f) => f.decision === 'dismissed').length;
  const autoFixCount = active.filter((f) => typeof f.replacement === 'string' && Boolean(f.range)).length;
  const unacceptedAutoFixCount = active.filter(
    (f) => f.decision === 'pending' && typeof f.replacement === 'string' && Boolean(f.range),
  ).length;
  const alignCount = active.filter((f) => f.category === 'alignment').length;
  const itemCount = active.filter((f) => f.category === 'item').length;
  const fbCount = active.filter((f) => f.category === 'feedback').length;

  const chips = [
    { id: 'all', label: `All (${active.length})`, show: true },
    { id: 'autofix', label: `Auto-Fix (${autoFixCount})`, show: autoFixCount > 0 },
    {
      id: 'alignment',
      label: `${state.track === 'objectives_only' ? 'LO & Clarity' : 'Align & Keys'} (${alignCount})`,
      show: alignCount > 0 && state.track === 'assessment_quiz',
    },
    { id: 'item', label: `Item Quality (${itemCount})`, show: itemCount > 0 },
    { id: 'feedback', label: `Feedback (${fbCount})`, show: fbCount > 0 },
    { id: 'dismissed', label: `Dismissed (${dismissedCount})`, show: dismissedCount > 0 },
  ].filter((c) => c.show);

  if (!chips.some((c) => c.id === state.findingFilter)) {
    state.findingFilter = 'all';
  }

  els.findingsFilterGroup.innerHTML = chips
    .map(
      (c) =>
        `<button type="button" class="filter-chip" data-filter="${c.id}" aria-pressed="${String(
          state.findingFilter === c.id,
        )}">${escapeHtml(c.label)}</button>`,
    )
    .join('');

  els.findingsFilterGroup.querySelectorAll('button[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.findingFilter = btn.dataset.filter;
      renderFindingsToolbar();
      renderRailContent();
    });
  });

  const shown = getFilteredFindings();
  els.findingsBulkRow.hidden = unacceptedAutoFixCount === 0 && shown.length === active.length;
  els.findingsShowingCount.textContent = `Showing ${shown.length} card${shown.length === 1 ? '' : 's'}`;
  els.btnStageAllFixes.hidden = unacceptedAutoFixCount === 0;
  els.btnStageAllFixes.textContent = `Stage All Auto-Fixes (${unacceptedAutoFixCount})`;
}

function renderRailContent() {
  if (state.railTab === 'pk') {
    renderPriorKnowledgePanel();
    return;
  }
  if (state.railTab === 'kcs') {
    renderKliKcPanel();
    return;
  }
  if (state.railTab === 'rubric') {
    renderRubricBreakdownPanel();
    return;
  }

  if (!state.auditPayload) {
    els.railContent.innerHTML = `<div class="empty-rail-state">
      Upload a <strong>.docx</strong>, <strong>.md</strong>, or <strong>.txt</strong> document (or choose one of the 3 calibrated samples), then click <strong>Run AI Audit</strong> to generate inline annotations and a deterministic /100 score.
    </div>`;
    return;
  }

  const visibleFindings = getFilteredFindings();
  if (visibleFindings.length === 0) {
    els.railContent.innerHTML = `<div class="empty-rail-state">
      ${
        state.findingFilter === 'dismissed'
          ? 'No dismissed findings.'
          : 'Zero active issues remaining in this view! Preview & save any staged fixes, or click <strong>Audit Prior Knowledge (+6 pts)</strong> to unlock full 100/100 readiness.'
      }
    </div>`;
    return;
  }

  els.railContent.innerHTML = visibleFindings
    .map((f) => {
      const pillMod =
        f.decision === 'accepted'
          ? 'check-pill--accepted'
          : f.status === 'unverified'
            ? 'check-pill--unverified'
            : f.status === 'minor_risk'
              ? 'check-pill--minor_risk'
              : '';
      const statusText =
        f.decision === 'accepted'
          ? `${f.check} · Staged ✓`
          : f.decision === 'dismissed'
            ? `${f.check} · Dismissed`
            : f.status === 'minor_risk'
              ? `${f.check} · 0-pt Advisory`
              : f.status === 'unverified'
                ? `${f.check} · Unverified`
                : f.check;

      const hasFix = typeof f.replacement === 'string' && Boolean(f.range);
      const isEditingThis = state.editingFindingId === f.id;

      const diffHtml = isEditingThis
        ? `<div class="inline-fix-editor">
            <label for="edit-fix-box-${f.id}">Customize replacement text before staging:</label>
            <textarea id="edit-fix-box-${f.id}" class="inline-fix-textarea">${escapeHtml(
              typeof f.replacement === 'string' ? f.replacement : f.quote,
            )}</textarea>
            <div class="inline-fix-editor__btns">
              <button type="button" class="btn btn-xs" data-action="cancel-edit" data-id="${f.id}">Cancel</button>
              <button type="button" class="btn btn-emerald btn-xs" data-action="save-edit" data-id="${f.id}">Save &amp; Stage Fix</button>
            </div>
          </div>`
        : hasFix
          ? `<div class="diff-snippet">
              <span class="diff-del">${escapeHtml(f.quote)}</span>
              <span class="diff-add">${escapeHtml(f.replacement || '[Remove line]')}</span>
            </div>`
          : f.quote
            ? `<div class="diff-snippet"><em>"${escapeHtml(f.quote)}"</em></div>`
            : '';

      return `<article class="finding-card ${f.isBlocker ? 'finding-card--blocker' : ''} ${
        state.activeFindingId === f.id ? 'is-active' : ''
      }" id="card-${f.id}" data-finding-id="${f.id}">
        <div class="finding-card__top">
          <div class="finding-card__badges">
            <span class="check-pill ${pillMod}">${escapeHtml(statusText)}</span>
            ${f.isBlocker ? `<span class="blocker-tag" title="Blocks Ready (>= 80) badge until S3 answer key/rubric is defensible">Ready Blocker</span>` : ''}
          </div>
          <span class="unit-tag">${escapeHtml(f.unitLabel)}</span>
        </div>
        <h3 class="finding-card__title">${escapeHtml(f.title)}</h3>
        <p class="finding-card__reason">${escapeHtml(f.reason)}</p>
        ${diffHtml}
        <div class="finding-card__actions">
          ${
            f.decision === 'dismissed'
              ? `<button type="button" class="btn btn-primary btn-xs" data-action="restore" data-id="${f.id}">Restore Finding</button>`
              : `
                ${
                  hasFix
                    ? f.decision === 'accepted'
                      ? `<button type="button" class="btn btn-xs" data-action="unaccept" data-id="${f.id}">Undo Stage</button>`
                      : `<button type="button" class="btn btn-emerald btn-xs" data-action="accept" data-id="${f.id}">Accept Fix</button>`
                    : ''
                }
                ${
                  f.range && !isEditingThis
                    ? `<button type="button" class="btn btn-xs" data-action="edit-fix" data-id="${f.id}">${
                        hasFix ? 'Edit Fix' : 'Write Fix'
                      }</button>`
                    : ''
                }
                ${
                  f.range
                    ? `<button type="button" class="btn btn-xs" data-action="jump" data-id="${f.id}">Locate</button>`
                    : ''
                }
                <button type="button" class="btn btn-xs" data-action="dismiss" data-id="${f.id}">Dismiss</button>
              `
          }
        </div>
      </article>`;
    })
    .join('');

  els.railContent.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleFindingAction(btn.dataset.action, btn.dataset.id);
    });
  });

  if (state.editingFindingId) {
    const ta = document.getElementById(`edit-fix-box-${state.editingFindingId}`);
    ta?.focus();
  }
}

function renderRubricBreakdownPanel() {
  if (!state.scoreOutput) {
    els.railContent.innerHTML = `<div class="empty-rail-state">Run AI Audit first to inspect per-check and 1/N per-question math.</div>`;
    return;
  }

  const qRows = state.scoreOutput.questionBreakdowns
    .map(
      (qb) => `<div class="kc-item">
        <div class="kc-item__head">
          <strong>${escapeHtml(qb.questionId.toUpperCase())} · ${escapeHtml(qb.format)}</strong>
          <span class="unit-tag">Item ${qb.itemPointsEarned.toFixed(2)}/${qb.itemPointsAvailable.toFixed(
            2,
          )} · FB ${qb.feedbackPointsEarned.toFixed(2)}/${qb.feedbackPointsAvailable.toFixed(2)}</span>
        </div>
        <div style="font-size:12px;color:var(--ink-500)">
          Item checks met: ${qb.itemChecksMeeting}/${qb.itemChecksApplicable} · Feedback checks met: ${qb.feedbackChecksMeeting}/${qb.feedbackChecksApplicable}
        </div>
      </div>`,
    )
    .join('');

  const cRows = state.scoreOutput.checkBreakdowns
    .filter((c) => c.status !== 'not_applicable')
    .map(
      (c) => `<div class="kc-item">
        <div class="kc-item__head">
          <span class="check-pill ${
            c.status === 'earned'
              ? 'check-pill--accepted'
              : c.status === 'unverified'
                ? 'check-pill--unverified'
                : ''
          }">${escapeHtml(c.checkId)}</span>
          <span class="unit-tag">${c.pointsEarned.toFixed(2)} / ${c.pointsAvailable.toFixed(2)} pts (${
            c.unitsMeeting
          }/${c.unitsApplicable} units)</span>
        </div>
        <div style="font-size:12.5px;font-weight:600">${escapeHtml(c.label)}</div>
      </div>`,
    )
    .join('');

  els.railContent.innerHTML = `<div class="panel-box">
    <h3>Deterministic Rubric Breakdown (v0.3.1)</h3>
    <p>100% proportional unit credit across active checks${
      qRows ? ' + equal 1/N per-question distribution' : ''
    }.</p>
    ${qRows ? `<h4 style="margin:8px 0 4px;font-size:12.5px">Per-Question 1/N Share</h4>${qRows}` : ''}
    <h4 style="margin:12px 0 4px;font-size:12.5px">Active Rubric Checks</h4>
    ${cRows}
  </div>`;
}

function renderKliKcPanel() {
  const candidates = state.auditPayload?.kc_candidates || [];
  if (candidates.length === 0) {
    els.railContent.innerHTML = `<div class="empty-rail-state">Run AI Audit on a Learning Objectives document to extract KLI Knowledge Components (Facts, Skills, Principles).</div>`;
    return;
  }

  const summary = reconcileKliKcScope(candidates, state.kcDecisions);

  els.railContent.innerHTML = `<div class="panel-box">
    <h3>KLI Knowledge Component Scope Check (0 Score Impact)</h3>
    <p>Confirm whether each inferred Knowledge Component is taught in scope, an assumed prerequisite (piped automatically into <em>Audit Prior Knowledge</em>), or out of scope.</p>
    ${candidates
      .map((kc) => {
        const current =
          state.kcDecisions[kc.kcId] || (kc.origin === 'author_authored' ? 'in_scope' : '');
        return `<div class="kc-item">
          <div class="kc-item__head">
            <span class="kli-badge">${escapeHtml(kc.kliType)}</span>
            <span class="unit-tag">${escapeHtml(kc.loUnit.toUpperCase())}</span>
          </div>
          <div style="font-size:13px;font-weight:600">${escapeHtml(kc.statement)}</div>
          <div class="choice-group" role="group" aria-label="Scope decision for ${escapeHtml(kc.statement)}">
            ${[
              ['in_scope', 'In Scope'],
              ['prerequisite', 'Assumed Prerequisite → PK'],
              ['out_of_scope', 'Out of Scope'],
            ]
              .map(
                ([val, lbl]) =>
                  `<button type="button" class="choice-pill ${
                    current === val ? 'is-selected' : ''
                  }" aria-pressed="${String(current === val)}" data-kc-id="${kc.kcId}" data-kc-choice="${val}">${lbl}</button>`,
              )
              .join('')}
          </div>
        </div>`;
      })
      .join('')}
    ${
      summary.loScopeTrimSuggestions.length > 0
        ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)">
            <strong style="font-size:12.5px;color:var(--brand-700)">Scope-Trim Available:</strong>
            <p style="margin:4px 0 8px">You marked ${summary.loScopeTrimSuggestions.length} KC(s) Out of Scope. Stage a wording trim so downstream quizzes aren't judged against them:</p>
            <button type="button" id="btn-stage-kc-trims" class="btn btn-emerald btn-xs">Stage Scope-Trim Suggestion</button>
          </div>`
        : ''
    }
  </div>`;

  els.railContent.querySelectorAll('button[data-kc-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.kcDecisions[btn.dataset.kcId] = btn.dataset.kcChoice;
      renderKliKcPanel();
    });
  });

  document.getElementById('btn-stage-kc-trims')?.addEventListener('click', () => {
    const v = currentVersion();
    for (const trim of summary.loScopeTrimSuggestions) {
      const range = findAvailableQuoteRange(v.markdown, trim.quote, []);
      if (range) {
        state.findings.push({
          id: `kc-trim-${Date.now()}`,
          check: 'O3',
          category: 'alignment',
          isBlocker: false,
          status: 'revise',
          unit: trim.loUnit,
          unitLabel: trim.loUnit.toUpperCase(),
          title: 'KLI Scope Trim · Clarify Out-of-Scope Boundary',
          reason: trim.reason,
          quote: v.markdown.slice(range.start, range.end),
          replacement: trim.replacement,
          range,
          decision: 'accepted',
        });
      }
    }
    state.railTab = 'issues';
    renderAll();
    showToast('Staged KLI scope-trim suggestion — click Preview Diff & Save New Version.', 'success');
  });
}

function renderPriorKnowledgePanel() {
  if (!state.pkAudit.auditHasRun) {
    els.railContent.innerHTML = `<div class="panel-box">
      <h3>Level 2: Audit Prior Knowledge (PK-1 · +6 Points)</h3>
      <p>Surfaces the top 5–10 highest-risk prerequisites assumed by your Learning Objectives or Assessment items so you can triage what your learners already have vs. where a refresher or foundational LO is needed.</p>
      <button type="button" id="btn-run-pk-inline" class="btn btn-primary btn-xs">
        Run Prior Knowledge Audit
      </button>
    </div>`;
    document.getElementById('btn-run-pk-inline')?.addEventListener('click', runPriorKnowledgeAuditFlow);
    return;
  }

  const pkEval = evaluatePriorKnowledgeAudit(state.pkAudit);

  els.railContent.innerHTML = `<div class="panel-box">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
      <h3 style="margin:0">Prior Knowledge Triage (${pkEval.clearedItems}/${pkEval.totalItems} Cleared)</h3>
      <button type="button" id="btn-pk-mark-rest-have" class="btn btn-xs">Mark Remaining "Have"</button>
    </div>
    <p>
      ${
        pkEval.pkCheckEarned
          ? '<strong style="color:var(--ready-ink)">✓ +6 / 6 PK-1 Points Unlocked!</strong> All surfaced prerequisites are verified or resolved.'
          : 'Mark each prerequisite for your cohort. Zero gaps unlocks +6 pts immediately; open gaps unlock +6 pts once resolved via Path A (AI Refresher) or Path C (Promote to LO).'
      }
    </p>
    ${state.pkAudit.items
      .slice(0, 10)
      .map((item) => {
        const entry = state.pkAudit.triage[item.pkId];
        const dec = entry?.decision || 'unreviewed';
        const isGap = dec === 'some_lack' || dec === 'most_lack';
        const isResolved =
          isGap &&
          ((entry?.resolution?.path === 'ai_remediation' && entry.resolution.recheckStatus === 'meets') ||
            (entry?.resolution?.path === 'promoted_to_lo' && entry.resolution.appliedVersionId));

        return `<div class="pk-item">
          <div class="pk-item__head">
            <span class="kli-badge">${escapeHtml(item.kliType)}</span>
            <span class="unit-tag">${escapeHtml(item.requiredBy?.[0]?.unit || 'Doc')}</span>
          </div>
          <div style="font-size:13px;font-weight:600">${escapeHtml(item.statement)}</div>
          <div style="font-size:12px;color:var(--ink-500);margin-top:3px">${escapeHtml(item.whyNeeded)}</div>
          <div class="choice-group" role="group" aria-label="Prior knowledge status for ${escapeHtml(item.statement)}">
            ${[
              ['have', 'Learners Have'],
              ['not_needed', 'Not Needed'],
              ['some_lack', 'Mixed Cohort (Some Lack)'],
              ['most_lack', 'Most Lack'],
            ]
              .map(
                ([val, lbl]) =>
                  `<button type="button" class="choice-pill ${
                    dec === val ? 'is-selected' : ''
                  }" aria-pressed="${String(dec === val)}" data-pk-id="${item.pkId}" data-pk-dec="${val}">${lbl}</button>`,
              )
              .join('')}
          </div>
          ${
            isGap
              ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  ${
                    isResolved
                      ? `<span class="check-pill check-pill--accepted">Gap Resolved ✓</span>`
                      : `<button type="button" class="btn btn-emerald btn-xs" data-pk-resolve="remediate" data-pk-id="${item.pkId}">Path A · Insert AI Refresher</button>
                         <button type="button" class="btn btn-xs" data-pk-resolve="promote" data-pk-id="${item.pkId}">Path C · Promote to Module LO</button>`
                  }
                </div>`
              : ''
          }
        </div>`;
      })
      .join('')}
  </div>`;

  document.getElementById('btn-pk-mark-rest-have')?.addEventListener('click', () => {
    state.pkAudit.triage = markRemainingPrerequisitesHave(state.pkAudit);
    recomputeDeterministicScore();
    renderAll();
    showToast('Marked remaining prerequisites as "Learners Have".', 'success');
  });

  els.railContent.querySelectorAll('button[data-pk-dec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pkAudit.triage[btn.dataset.pkId] = { decision: btn.dataset.pkDec };
      recomputeDeterministicScore();
      renderAll();
    });
  });

  els.railContent.querySelectorAll('button[data-pk-resolve]').forEach((btn) => {
    btn.addEventListener('click', () => {
      resolvePriorKnowledgeGap(btn.dataset.pkId, btn.dataset.pkResolve);
    });
  });
}

function unstageOverlappingFindings(targetFinding) {
  if (!targetFinding.range) return 0;
  let unstaged = 0;
  for (const other of state.findings) {
    if (
      other.id !== targetFinding.id &&
      other.decision === 'accepted' &&
      other.range &&
      targetFinding.range.start < other.range.end &&
      targetFinding.range.end > other.range.start
    ) {
      other.decision = 'pending';
      unstaged += 1;
    }
  }
  return unstaged;
}

function formatReplacementPreservingListStructure(docText, range, replacement) {
  if (!replacement || !replacement.includes('\n')) return replacement;
  const lineStart = docText.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  const prefixBeforeRange = docText.slice(lineStart, range.start);
  const bulletMatch = prefixBeforeRange.match(/^(\s*[-*•]\s+)/);
  if (!bulletMatch) return replacement;

  const bulletIndentPrefix = bulletMatch[1];
  const lines = replacement.split('\n').filter((l, i) => i === 0 || l.trim().length > 0);
  if (lines.length <= 1) return replacement;

  return lines
    .map((line, idx) => {
      if (idx === 0) return line;
      const trimmed = line.trim();
      if (/^[-*•]\s+/.test(trimmed)) {
        return `${bulletIndentPrefix.match(/^\s*/)?.[0] || ''}${trimmed}`;
      }
      return `${bulletIndentPrefix}${trimmed}`;
    })
    .join('\n');
}

// --- Interactive Handlers ---
function handleFindingAction(action, findingId) {
  const f = state.findings.find((x) => x.id === findingId);
  if (!f) return;

  if (action === 'accept') {
    const replacedOverlap = unstageOverlappingFindings(f);
    f.decision = 'accepted';
    state.editingFindingId = null;
    state.activeFindingId = f.id;
    if (replacedOverlap > 0) {
      showToast(`Updated staged fix on this line to ${f.check}.`, 'info');
    }
  } else if (action === 'unaccept') {
    f.decision = 'pending';
  } else if (action === 'dismiss') {
    f.decision = 'dismissed';
    state.editingFindingId = null;
    showToast(`Dismissed ${f.check} (switch filter to "Dismissed" anytime to restore).`, 'info');
  } else if (action === 'restore') {
    f.decision = 'pending';
    state.findingFilter = 'all';
    showToast(`Restored finding ${f.check}.`, 'success');
  } else if (action === 'edit-fix') {
    state.editingFindingId = f.id;
  } else if (action === 'cancel-edit') {
    state.editingFindingId = null;
  } else if (action === 'save-edit') {
    const ta = document.getElementById(`edit-fix-box-${f.id}`);
    if (ta) {
      f.replacement = ta.value;
      unstageOverlappingFindings(f);
      f.decision = 'accepted';
      state.editingFindingId = null;
      showToast(`Custom replacement staged for ${f.check}.`, 'success');
    }
  } else if (action === 'jump') {
    state.viewMode = 'annotated';
    renderAll();
    focusHighlightInDoc(findingId);
    return;
  }
  renderAll();
}

function focusFindingInRail(findingId) {
  state.activeFindingId = findingId;
  state.railTab = 'issues';
  const target = state.findings.find((x) => x.id === findingId);
  if (target && target.decision !== 'dismissed' && state.findingFilter !== 'all') {
    const visible = getFilteredFindings();
    if (!visible.some((x) => x.id === findingId)) {
      state.findingFilter = 'all';
    }
  }
  renderAll();
  const card = document.getElementById(`card-${findingId}`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function focusHighlightInDoc(findingId) {
  state.activeFindingId = findingId;
  if (state.viewMode !== 'annotated') {
    state.viewMode = 'annotated';
  }
  renderAll();
  const mark =
    els.annotatedCanvas.querySelector(`mark[data-finding-ids~="${findingId}"]`) ||
    els.annotatedCanvas.querySelector(`mark[data-finding-id="${findingId}"]`);
  if (mark) {
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.classList.add('pulse');
    mark.focus({ preventScroll: true });
    setTimeout(() => mark.classList.remove('pulse'), 950);
  }
}

function openDiffPreviewModal(triggerEl = els.btnPreviewApply) {
  const v = currentVersion();
  const accepted = state.findings
    .filter((f) => f.decision === 'accepted' && typeof f.replacement === 'string' && f.range)
    .sort((a, b) => a.range.start - b.range.start);

  if (accepted.length === 0) return;

  els.diffPreviewList.innerHTML = accepted
    .map((f) => {
      const normalizedAdd = formatReplacementPreservingListStructure(
        v.markdown,
        f.range,
        f.replacement,
      );
      return `<div class="diff-snippet">
        <div style="font-family:var(--font-mono);font-size:11px;font-weight:700;margin-bottom:4px">${escapeHtml(
          f.check,
        )} · ${escapeHtml(f.unitLabel)}</div>
        <span class="diff-del">${escapeHtml(f.quote)}</span>
        <span class="diff-add" style="white-space:pre-wrap">${escapeHtml(
          normalizedAdd || '[Line removed]',
        )}</span>
      </div>`;
    })
    .join('');

  openModal(els.modalDiff, triggerEl);
}

function applyAcceptedChangesAsNewVersion() {
  const v = currentVersion();
  const accepted = state.findings
    .filter((f) => f.decision === 'accepted' && typeof f.replacement === 'string' && f.range)
    .sort((a, b) => b.range.start - a.range.start); // Apply bottom-up so indices never drift!

  let updatedMd = v.markdown;
  for (const f of accepted) {
    const safeReplacement = formatReplacementPreservingListStructure(
      updatedMd,
      f.range,
      f.replacement,
    );
    updatedMd =
      updatedMd.slice(0, f.range.start) + safeReplacement + updatedMd.slice(f.range.end);
  }

  const nextNum = state.versions.length + 1;
  const newVerId = `v${nextNum}`;
  state.versions.push({
    id: newVerId,
    label: `${newVerId} · Applied ${accepted.length} fix${accepted.length === 1 ? '' : 'es'}`,
    title: v.title,
    markdown: updatedMd.replace(/\n{3,}/g, '\n\n'),
    linkedLoMarkdown: v.linkedLoMarkdown,
  });
  state.currentVersionIdx = state.versions.length - 1;

  for (const f of accepted) {
    f.decision = 'dismissed';
  }
  state.awaitingRecheck = true;
  closeModal(els.modalDiff);
  state.viewMode = 'annotated';
  renderAll();
  showToast(
    `Created ${newVerId} with ${accepted.length} applied fix${
      accepted.length === 1 ? '' : 'es'
    }. Click "Recheck Current Version" to update your /100 score.`,
    'success',
  );
}

async function runPriorKnowledgeAuditFlow() {
  if (state.isBusy) return;
  syncEditorToCurrentVersion();
  const v = currentVersion();

  setBusy(true, 'Auditing PK...');
  try {
    const kcSummary = reconcileKliKcScope(
      state.auditPayload?.kc_candidates || [],
      state.kcDecisions,
    );
    const seed = preparePriorKnowledgeSeedFromKcs(kcSummary);

    const data = await executeAuditAction({
      action: 'prior_knowledge_audit',
      track: state.track,
      docMarkdown: v.markdown,
      linkedLoMarkdown: v.linkedLoMarkdown,
      rubric: state.rubric,
      extraContext: {
        seededPrerequisites: seed.seededPrerequisiteItems,
        suppressedOutOfScope: seed.suppressedOutOfScopeStatements,
      },
    });

    state.pkAudit = {
      auditHasRun: true,
      items: data.prior_knowledge_items || [],
      triage: {},
    };
    state.railTab = 'pk';
    if (!state.auditPayload) {
      await triggerAudit('review');
      state.railTab = 'pk';
    } else {
      recomputeDeterministicScore();
    }
    renderAll();
    showToast(
      `Surfaced ${state.pkAudit.items.length} prerequisite items for Prior Knowledge triage.`,
      'info',
    );
  } catch (err) {
    showToast(`Prior Knowledge Audit Error: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function resolvePriorKnowledgeGap(pkId, mode) {
  const item = state.pkAudit.items.find((x) => x.pkId === pkId);
  if (!item) return;
  syncEditorToCurrentVersion();
  const v = currentVersion();

  if (mode === 'promote') {
    const preview = buildPromotePrerequisiteToLoPreview({
      loDocMarkdown: state.track === 'objectives_only' ? v.markdown : v.linkedLoMarkdown || v.markdown,
      newLoId: 'LO0 (Foundational)',
      proposedLoStatement: item.statement,
    });

    const nextNum = state.versions.length + 1;
    state.versions.push({
      id: `v${nextNum}`,
      label: `v${nextNum} · Promoted PK to LO`,
      title: v.title,
      markdown: state.track === 'objectives_only' ? preview.afterMarkdown : v.markdown,
      linkedLoMarkdown:
        state.track === 'assessment_quiz' ? preview.afterMarkdown : v.linkedLoMarkdown,
    });
    state.currentVersionIdx = state.versions.length - 1;

    state.pkAudit.triage[pkId] = {
      decision: state.pkAudit.triage[pkId]?.decision || 'most_lack',
      resolution: {
        path: 'promoted_to_lo',
        promotedLoId: 'LO0',
        promotedLoText: preview.promotedLoLine,
        targetLoDocId: v.id,
        appliedVersionId: `v${nextNum}`,
      },
    };
    recomputeDeterministicScore();
    renderAll();
    showToast(`Promoted prerequisite to foundational LO in v${nextNum}.`, 'success');
    return;
  }

  setBusy(true, 'Drafting Bridge...');
  try {
    const draft = await executeAuditAction({
      action: 'remediation_draft',
      track: state.track,
      docMarkdown: v.markdown,
      rubric: state.rubric,
      extraContext: { openGapStatements: [item.statement] },
    });

    const placement = buildRemediationPlacementPreview({
      placement: 'inline_section',
      currentDocTitle: v.title,
      currentDocMarkdown: v.markdown,
      remediationMarkdown: draft.remediationMarkdown,
    });

    const nextNum = state.versions.length + 1;
    state.versions.push({
      id: `v${nextNum}`,
      label: `v${nextNum} · Added PK Refresher`,
      title: v.title,
      markdown: placement.updatedCurrentDocMarkdown,
      linkedLoMarkdown: v.linkedLoMarkdown,
    });
    state.currentVersionIdx = state.versions.length - 1;

    state.pkAudit.triage[pkId] = {
      decision: state.pkAudit.triage[pkId]?.decision || 'some_lack',
      resolution: {
        path: 'ai_remediation',
        placement: 'inline_section',
        targetDocId: v.id,
        appliedVersionId: `v${nextNum}`,
        recheckStatus: 'meets',
      },
    };
    recomputeDeterministicScore();
    renderAll();
    showToast(`Inserted warm-up refresher bridge in v${nextNum}.`, 'success');
  } catch (err) {
    showToast(`Remediation Draft Error: ${err.message || err}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- WAI-ARIA APG Tablist Roving Arrow Key Helper ---
function bindTablistArrowNavigation(tabs, onActivateTab) {
  tabs.forEach((tab) => {
    tab.addEventListener('keydown', (e) => {
      const enabledTabs = tabs.filter((t) => !t.hidden && !t.disabled);
      const idx = enabledTabs.indexOf(tab);
      if (idx === -1) return;

      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % enabledTabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + enabledTabs.length) % enabledTabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = enabledTabs.length - 1;

      if (nextIdx !== -1) {
        e.preventDefault();
        const targetTab = enabledTabs[nextIdx];
        onActivateTab(targetTab);
        targetTab.focus();
      }
    });
  });
}

// --- Event Wiring ---
function bindEvents() {
  // Smart Track Selector: auto-switches built-in sample if user hasn't customized document
  els.trackBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTrack = btn.dataset.track;
      if (nextTrack === state.track) return;
      syncEditorToCurrentVersion();

      if (isUnmodifiedBuiltInSample()) {
        const defaultSampleId =
          nextTrack === 'assessment_quiz' ? 'sample-quiz-mixed-formats' : 'sample-lo-regression-ai';
        loadSampleById(defaultSampleId);
        showToast(
          `Loaded ${
            nextTrack === 'assessment_quiz' ? 'Track 2 Assessment / Quiz' : 'Track 1 Learning Objectives'
          } sample — click Run AI Audit when ready.`,
          'info',
        );
        return;
      }

      state.track = nextTrack;
      resetAuditStateForNewDoc();
      renderAll();
      showToast(
        `Switched evaluation track to ${
          nextTrack === 'assessment_quiz' ? 'Assessment / Quiz' : 'Learning Objectives'
        }.`,
        'info',
      );
    });
  });

  els.btnRunAudit.addEventListener('click', () => triggerAudit('review'));
  els.btnRunAuditFromLo.addEventListener('click', () => triggerAudit('review'));
  els.btnRecheckVersion.addEventListener('click', () => triggerAudit('recheck'));
  els.btnRecheckInline.addEventListener('click', () => triggerAudit('recheck'));
  els.btnAuditPk.addEventListener('click', runPriorKnowledgeAuditFlow);

  // Global Keyboard Shortcuts & Modal Focus Trap / Escape
  document.addEventListener('keydown', (e) => {
    if (activeModalEl) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(activeModalEl);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = getModalFocusableElements(activeModalEl);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerAudit(state.awaitingRecheck ? 'recheck' : 'review');
    }
  });

  els.samplePicker.addEventListener('change', (e) => {
    loadSampleById(e.target.value);
  });

  const viewTabs = [els.tabViewAnnotated, els.tabViewEdit];
  const activateViewTab = (tab) => {
    syncEditorToCurrentVersion();
    state.viewMode = tab === els.tabViewAnnotated ? 'annotated' : 'edit';
    renderAll();
  };
  els.tabViewAnnotated.addEventListener('click', () => activateViewTab(els.tabViewAnnotated));
  els.tabViewEdit.addEventListener('click', () => activateViewTab(els.tabViewEdit));
  bindTablistArrowNavigation(viewTabs, activateViewTab);

  els.versionSelect.addEventListener('change', (e) => {
    state.currentVersionIdx = Number(e.target.value);
    renderAll();
  });

  els.btnExportMd.addEventListener('click', () => {
    syncEditorToCurrentVersion();
    const v = currentVersion();
    const blob = new Blob([v.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = `${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${v.id}.md`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`, 'success');
  });

  // Upload Document (.md, .txt, .docx, .html)
  els.btnUploadDoc.addEventListener('click', () => els.fileUploadInput.click());
  els.fileUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ingestUploadedFile(file);
    e.target.value = '';
  });

  // Drag & Drop onto Sheet
  els.paperDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzoneStrip.classList.add('drag-over');
  });
  els.paperDropzone.addEventListener('dragleave', () => {
    els.dropzoneStrip.classList.remove('drag-over');
  });
  els.paperDropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    els.dropzoneStrip.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await ingestUploadedFile(file);
  });

  // Smart HTML-to-Markdown paste from Google Docs / Word
  els.markdownEditor.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    const plain = e.clipboardData?.getData('text/plain') || '';
    if (html && /<(?:h1|h2|h3|table|li|strong|b)\b/i.test(html) && !/^#|\n-\s|\|/.test(plain)) {
      e.preventDefault();
      const converted = htmlToCleanMarkdown(html);
      const start = els.markdownEditor.selectionStart;
      const end = els.markdownEditor.selectionEnd;
      const val = els.markdownEditor.value;
      els.markdownEditor.value = val.slice(0, start) + converted + val.slice(end);
      syncEditorToCurrentVersion();
      showToast('Converted rich Google Docs / Word formatting cleanly to Markdown.', 'success');
    }
  });

  // Missing-LO Gate & Reference LO actions
  els.btnCloseGate.addEventListener('click', () => {
    els.missingLoBanner.hidden = true;
  });
  els.btnGateOpenLoBox.addEventListener('click', () => {
    els.loAnchorPanel.hidden = false;
    els.linkedLoTextarea.hidden = false;
    els.btnToggleLoTextarea.setAttribute('aria-expanded', 'true');
    els.btnToggleLoTextarea.textContent = 'Collapse Reference LOs';
    els.linkedLoTextarea.focus();
  });
  els.linkedLoTextarea.addEventListener('input', () => {
    syncEditorToCurrentVersion();
    els.btnRunAuditFromLo.hidden = !(!state.scoreOutput && els.linkedLoTextarea.value.trim());
  });
  els.btnGateUploadLo.addEventListener('click', () => els.loFileUploadInput.click());
  els.loFileUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const md = await extractMarkdownFromFile(file);
    els.linkedLoTextarea.value = md;
    syncEditorToCurrentVersion();
    els.missingLoBanner.hidden = true;
    renderAll();
    showToast(`Attached companion LO file "${file.name}" — ready to Run AI Audit.`, 'success');
    e.target.value = '';
  });
  els.btnGateDraftLos.addEventListener('click', async () => {
    syncEditorToCurrentVersion();
    setBusy(true, 'Drafting LOs...');
    try {
      const res = await executeAuditAction({
        action: 'draft_los',
        track: state.track,
        docMarkdown: currentVersion().markdown,
        rubric: state.rubric,
      });
      els.linkedLoTextarea.value = res.candidateLosMarkdown || '';
      syncEditorToCurrentVersion();
      els.loAnchorPanel.hidden = false;
      els.linkedLoTextarea.hidden = false;
      els.btnToggleLoTextarea.setAttribute('aria-expanded', 'true');
      els.btnToggleLoTextarea.textContent = 'Collapse Reference LOs';
      els.missingLoBanner.hidden = true;
      renderAll();
      els.linkedLoTextarea.focus();
      showToast(
        'Drafted candidate Learning Objectives! Review/edit them above, then click "Run AI Audit with These LOs".',
        'success',
      );
    } catch (err) {
      showToast(`Draft LO Error: ${err.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  els.btnToggleLoTextarea.addEventListener('click', () => {
    const nextHidden = !els.linkedLoTextarea.hidden;
    els.linkedLoTextarea.hidden = nextHidden;
    els.btnToggleLoTextarea.setAttribute('aria-expanded', String(!nextHidden));
    els.btnToggleLoTextarea.textContent = nextHidden ? 'Edit Reference LOs' : 'Collapse Reference LOs';
  });

  // Rail sub-tabs + Arrow navigation
  const activateRailTab = (btn) => {
    state.railTab = btn.dataset.railTab;
    renderRailTabs();
    renderFindingsToolbar();
    renderRailContent();
  };
  els.railTabs.forEach((btn) => {
    btn.addEventListener('click', () => activateRailTab(btn));
  });
  bindTablistArrowNavigation(els.railTabs, activateRailTab);

  // Stage All Non-Overlapping Score-Impacting Auto-Fixes
  els.btnStageAllFixes.addEventListener('click', () => {
    let stagedCount = 0;
    const claimedRanges = state.findings
      .filter((f) => f.decision === 'accepted' && f.range)
      .map((f) => f.range);

    state.findings.forEach((f) => {
      if (
        f.decision === 'pending' &&
        f.status !== 'minor_risk' &&
        typeof f.replacement === 'string' &&
        f.range
      ) {
        const overlaps = claimedRanges.some(
          (r) => f.range.start < r.end && f.range.end > r.start,
        );
        if (!overlaps) {
          f.decision = 'accepted';
          claimedRanges.push(f.range);
          stagedCount += 1;
        }
      }
    });
    renderAll();
    if (stagedCount > 0) {
      showToast(
        `Staged ${stagedCount} non-overlapping auto-fix${stagedCount === 1 ? '' : 'es'} — click "Preview Diff & Save New Version" to inspect.`,
        'success',
      );
    }
  });

  // Staged Diff Modal + Backdrop Close
  els.btnClearStaged.addEventListener('click', () => {
    state.findings.forEach((f) => {
      if (f.decision === 'accepted') f.decision = 'pending';
    });
    renderAll();
    showToast('Cleared staged fixes.', 'info');
  });
  els.btnPreviewApply.addEventListener('click', (e) => openDiffPreviewModal(e.currentTarget));
  els.btnCloseDiffModal.addEventListener('click', () => closeModal(els.modalDiff));
  els.btnCancelApply.addEventListener('click', () => closeModal(els.modalDiff));
  els.btnConfirmApply.addEventListener('click', applyAcceptedChangesAsNewVersion);
  els.modalDiff.addEventListener('click', (e) => {
    if (e.target === els.modalDiff) closeModal(els.modalDiff);
  });

  // Lock Session Button
  els.btnLockSession?.addEventListener('click', handleLockStudio);

  // Provider-Agnostic Pilot LLM Connection Modal + Backdrop Close
  els.selectRamProvider?.addEventListener('change', () => {
    const isOpenAi = els.selectRamProvider.value === 'openai_compatible';
    els.groupRamBaseUrl.hidden = !isOpenAi;
    els.inputRamModel.value = isOpenAi ? 'gpt-4.1-mini' : 'gemini-2.5-flash';
    els.inputRamKey.placeholder = isOpenAi
      ? 'Paste sk-... or provider key (held in JS tab RAM only)'
      : 'Paste Gemini AIza... key (held in JS tab RAM only — never saved to disk)';
  });

  els.btnConnectAi.addEventListener('click', (e) => {
    const st = getConnectionStatus();
    els.inputProxyUrl.value = st.proxyUrl || '';
    if (els.selectRamProvider) {
      els.selectRamProvider.value = st.provider || 'gemini';
      els.groupRamBaseUrl.hidden = els.selectRamProvider.value !== 'openai_compatible';
    }
    openModal(els.modalConn, e.currentTarget);
  });
  els.btnCloseConnModal.addEventListener('click', () => closeModal(els.modalConn));
  els.modalConn.addEventListener('click', (e) => {
    if (e.target === els.modalConn) closeModal(els.modalConn);
  });
  els.btnSaveConn.addEventListener('click', () => {
    configureConnection({
      proxyUrl: els.inputProxyUrl.value,
      provider: els.selectRamProvider?.value || 'gemini',
      model: els.inputRamModel?.value || 'gemini-2.5-flash',
      baseUrl: els.inputRamBaseUrl?.value || '',
      sessionRamKey: els.inputRamKey.value,
    });
    els.inputRamKey.value = '';
    closeModal(els.modalConn);
    refreshConnectionBadge();
    const st = getConnectionStatus();
    showToast(`Connection active: ${st.label}`, 'success');
  });
  els.btnClearCreds.addEventListener('click', () => {
    clearEphemeralCredentials();
    configureConnection({ proxyUrl: '' });
    els.inputProxyUrl.value = '';
    els.inputRamKey.value = '';
    refreshConnectionBadge();
    showToast('Cleared ephemeral tab API key.', 'info');
  });
}

async function ingestUploadedFile(file) {
  try {
    const md = await extractMarkdownFromFile(file);
    const cleanTitle = file.name.replace(/\.[^.]+$/, '');
    const looksLikeQuiz =
      /\b(?:Q(?:uestion)?\s*1|Quiz|Select\s+all\s+that\s+apply|Scoring\s+Rubric)\b/i.test(md) ||
      /^\s*[-*]\s*[A-D][.:)]/m.test(md);

    state.track = looksLikeQuiz ? 'assessment_quiz' : 'objectives_only';
    state.versions = [
      {
        id: 'v1',
        label: 'v1 · Uploaded File',
        title: cleanTitle,
        markdown: md,
        linkedLoMarkdown: '',
      },
    ];
    state.currentVersionIdx = 0;
    resetAuditStateForNewDoc();
    renderAll();
    showToast(
      `Imported "${file.name}" into ${
        looksLikeQuiz ? 'Track 2 (Assessment / Quiz)' : 'Track 1 (Learning Objectives)'
      }. Click Run AI Audit when ready.`,
      'success',
    );
  } catch (err) {
    showToast(`Upload Error: ${err.message || err}`, 'error');
  }
}

function refreshConnectionBadge() {
  const st = getConnectionStatus();
  els.btnConnectAi.dataset.mode = st.mode;
  els.connStatusLabel.textContent = st.label;
}

let busyInterval = null;

function setBusy(busy, label = 'Run AI Audit') {
  state.isBusy = busy;
  els.btnRunAudit.disabled = busy;
  els.btnRunAudit.setAttribute('aria-busy', String(busy));
  if (els.btnRunAuditLabel) {
    els.btnRunAuditLabel.textContent = busy ? label : 'Run AI Audit';
  }

  if (busyInterval) {
    clearInterval(busyInterval);
    busyInterval = null;
  }

  if (els.auditProgressCard) {
    els.auditProgressCard.hidden = !busy;
    if (busy) {
      const startedAt = Date.now();
      els.auditProgressTitle.textContent = label;
      els.auditProgressElapsed.textContent = '0.0s';
      els.auditProgressStep.textContent =
        'Step 1/2 · Checking target LOs, solving items & evaluating rubric criteria...';

      busyInterval = setInterval(() => {
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
        els.auditProgressElapsed.textContent = `${sec}s`;
        if (Number(sec) >= 5.5) {
          els.auditProgressStep.textContent =
            'Step 2/2 · Anchoring verbatim document quotes & preparing repair suggestions...';
        }
      }, 100);
    }
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
