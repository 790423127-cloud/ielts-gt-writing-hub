"use strict";

function roundHalf(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(9, Math.round(numeric * 2) / 2));
}

function averageBand(criteria) {
  const values = Object.values(criteria || {}).map(Number).filter(Number.isFinite);
  if (values.length !== 4) throw new Error("Exactly four criterion bands are required.");
  const rawAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { rawAverage: Number(rawAverage.toFixed(3)), overallBand: roundHalf(rawAverage) };
}

function text(value) {
  return String(value || "").trim();
}

function list(value, limit = 8) {
  return (Array.isArray(value) ? value : (value ? [value] : []))
    .map(text)
    .filter(Boolean)
    .slice(0, limit);
}

function exactEvidence(value, essay) {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const raw = typeof entry === "string" ? { quote: entry } : (entry || {});
    const quote = text(raw.quote || raw.text || raw.original);
    if (!quote || !essay.includes(quote)) return null;
    return {
      quote,
      explanation: text(raw.explanation || raw.meaning || raw.evidence),
      explanationZh: text(raw.explanationZh || raw.meaningZh || raw.evidenceZh)
    };
  }).filter(Boolean).slice(0, 6);
}

function normalizeNextRevision(source, essay) {
  const raw = source && typeof source === "object" ? source : {};
  const beforeQuote = text(raw.beforeQuote || raw.quote || raw.original);
  return {
    priority: text(raw.priority || raw.focus),
    priorityZh: text(raw.priorityZh || raw.focusZh),
    action: text(raw.action || raw.howToImprove),
    actionZh: text(raw.actionZh || raw.howToImproveZh),
    beforeQuote: beforeQuote && essay.includes(beforeQuote) ? beforeQuote : "",
    revisedExample: text(raw.revisedExample || raw.after || raw.rewrite),
    whyItWorks: text(raw.whyItWorks || raw.explanation),
    whyItWorksZh: text(raw.whyItWorksZh || raw.explanationZh)
  };
}

function normalizeCeilingAudit(source) {
  const raw = source && typeof source === "object" ? source : {};
  const highestBandTested = roundHalf(raw.highestBandTested);
  return {
    highestBandTested,
    passed: raw.passed === true,
    reason: text(raw.reason || raw.descriptorDecision),
    band9PositiveEvidence: text(raw.band9PositiveEvidence || raw.positiveEvidenceForBand9),
    band9BlockingPattern: text(raw.band9BlockingPattern || raw.blockingEvidenceForBand9)
  };
}

function normalizeCriterion(raw, band, essay) {
  const source = raw && typeof raw === "object" ? raw : {};
  const boundary = source.bandBoundary && typeof source.bandBoundary === "object" ? source.bandBoundary : {};
  const normalizedBand = roundHalf(source.band ?? band);
  if (normalizedBand === null) throw new Error("A criterion band is missing or invalid.");
  const diagnosis = text(source.diagnosis || source.whyThisBand || source.summary);
  const diagnosisZh = text(source.diagnosisZh || source.whyThisBandZh || source.summaryZh);
  const boundaryFit = text(boundary.fit || source.whyNotLower || diagnosis);
  const boundaryFitZh = text(boundary.fitZh || source.whyNotLowerZh || diagnosisZh);
  const nextBandGap = text(boundary.nextBandGap || source.whyNotHigher);
  const nextBandGapZh = text(boundary.nextBandGapZh || source.whyNotHigherZh);
  const strengths = list(source.strengths || source.positiveEvidence || source.supportingEvidence);
  const strengthsZh = list(source.strengthsZh || source.positiveEvidenceZh || source.supportingEvidenceZh);
  const constraints = list(source.constraints || source.limitingEvidence || source.limitsHigherBand);
  const constraintsZh = list(source.constraintsZh || source.limitingEvidenceZh || source.limitsHigherBandZh);
  const essayEvidence = exactEvidence(source.essayEvidence || source.textEvidence || source.evidenceQuotes, essay);
  const nextRevision = normalizeNextRevision(source.nextRevision || {
    priority: source.howToImprove || source.improvementFocus,
    priorityZh: source.howToImproveZh || source.improvementFocusZh,
    action: source.howToImprove || source.improvementFocus,
    actionZh: source.howToImproveZh || source.improvementFocusZh
  }, essay);
  const ceilingAudit = normalizeCeilingAudit(source.ceilingAudit || source.upperBandAudit);
  const howToImprove = text(source.howToImprove || source.improvementFocus || nextRevision.action || nextRevision.priority);
  const howToImproveZh = text(source.howToImproveZh || source.improvementFocusZh || nextRevision.actionZh || nextRevision.priorityZh);
  const feedbackComplete = Boolean(
    diagnosis &&
    diagnosisZh &&
    boundaryFit &&
    boundaryFitZh &&
    nextBandGap &&
    nextBandGapZh &&
    essayEvidence.length >= 2 &&
    essayEvidence.every((entry) => entry.explanation && entry.explanationZh) &&
    (nextRevision.action || nextRevision.priority) &&
    (nextRevision.actionZh || nextRevision.priorityZh) &&
    nextRevision.revisedExample &&
    nextRevision.whyItWorks &&
    nextRevision.whyItWorksZh
  );
  return {
    band: normalizedBand,
    diagnosis,
    diagnosisZh,
    bandBoundary: {
      fit: boundaryFit,
      fitZh: boundaryFitZh,
      nextBandGap,
      nextBandGapZh
    },
    strengths,
    strengthsZh,
    constraints,
    constraintsZh,
    essayEvidence,
    nextRevision,
    ceilingAudit,
    feedbackComplete,
    // Compatibility aliases for older front-end and API consumers.
    whyThisBand: diagnosis,
    whyThisBandZh: diagnosisZh,
    whyNotLower: boundaryFit,
    whyNotLowerZh: boundaryFitZh,
    whyNotHigher: nextBandGap,
    whyNotHigherZh: nextBandGapZh,
    positiveEvidence: strengths,
    positiveEvidenceZh: strengthsZh,
    limitingEvidence: constraints,
    limitingEvidenceZh: constraintsZh,
    howToImprove,
    howToImproveZh,
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0.5))
  };
}

function normalizeExaminerReport(raw, taskConfig, essay, examinerId, context = {}) {
  if (!raw || typeof raw !== "object") throw new Error(`Examiner ${examinerId} returned no report.`);
  const rawCriteria = raw.criteria && typeof raw.criteria === "object" ? raw.criteria : {};
  const criteria = {};
  const criterionDetails = {};
  for (const name of taskConfig.criteria) {
    const source = rawCriteria[name];
    const detail = normalizeCriterion(source, source, essay);
    criteria[name] = detail.band;
    criterionDetails[name] = detail;
  }
  const score = averageBand(criteria);
  const evidenceCount = Object.values(criterionDetails).reduce((sum, item) => sum + item.essayEvidence.length, 0);
  const feedbackComplete = Object.values(criterionDetails).every((item) => item.feedbackComplete);
  const rawContrast = raw.criterionContrastAudit && typeof raw.criterionContrastAudit === "object"
    ? raw.criterionContrastAudit
    : {};
  const criterionContrastAudit = {
    strongest: text(rawContrast.strongest),
    weakest: text(rawContrast.weakest),
    comparison: text(rawContrast.comparison),
    uniformProfileJustification: text(rawContrast.uniformProfileJustification)
  };
  const uniformCriteria = new Set(Object.values(criteria).map(Number)).size === 1;
  const upperBandCriteria = taskConfig.criteria.filter((name) => Number(criteria[name]) >= 8);
  const ceilingAuditComplete = (name) => {
    const audit = criterionDetails[name]?.ceilingAudit || {};
    return audit.highestBandTested === 9 && Boolean(audit.reason)
      && (Number(criteria[name]) >= 9
        ? audit.passed === true && Boolean(audit.band9PositiveEvidence || audit.reason)
        : audit.passed === false && Boolean(audit.band9BlockingPattern || audit.reason));
  };
  const upperBandAuditComplete = upperBandCriteria.every(ceilingAuditComplete);
  const fullRangeCeilingAuditComplete = taskConfig.criteria.every(ceilingAuditComplete);
  const nonDescriptorUpperBandClaims = taskConfig.criteria.filter((name) => {
    const detail = criterionDetails[name] || {};
    const audit = detail.ceilingAudit || {};
    const claim = [detail.bandBoundary?.nextBandGap, audit.reason, audit.band9BlockingPattern].filter(Boolean).join(" ");
    if (/(?:require|need|lack|without|no evidence of)[^.!?]{0,90}(?:inversion|conditional|varied clause starter|advanced structure|sophisticated structure)/i.test(claim)) return true;
    if (/(?:require|need|lack|without)[^.!?]{0,90}(?:original|novel|surprising|innovative|more persuasive|more compelling)/i.test(claim)) return true;
    if (/(?:absolute perfection|absolutely perfect|flawless|entirely absent|complete absence of errors|zero errors)/i.test(claim)) return true;
    if (Number(criteria[name]) < 9 && /(?:is correct|fully accurate|grammatically acceptable|not an error|no true errors|no discernible errors)/i.test(claim)) return true;
    if (Number(criteria[name]) < 9 && /(?:single|extremely rare|very rare|very occasional)[^.!?]{0,80}(?:lapse|error|slip|imprecision)[^.!?]{0,80}(?:prevent|block|deny|below band 9)/i.test(claim)) return true;
    if (/coherence|cohesion/i.test(name)
      && (/(?:mechanical|formulaic|conventional|explicit)[^.!?]{0,80}(?:transition|discourse marker|signposting|connector)/i.test(claim)
        || /(?:transition|discourse marker|signposting|connector)[^.!?]{0,80}(?:mechanical|formulaic|conventional|explicit)/i.test(claim))
      && !/(?:disrupt|obscur|confus|break|substitut(?:e|ing) for logic|impede)/i.test(claim)) return true;
    if (name === taskConfig.firstCriterion && /every (?:main )?supporting idea[^.!?]{0,80}(?:fully|exhaust)/i.test(claim)) return true;
    const visualType = String(context.visualType || "").toLowerCase();
    if (name === taskConfig.firstCriterion && /process|diagram/.test(visualType)
      && /(?:lack|absence|missing|need|require)[^.!?]{0,90}compar/i.test(claim)) return true;
    return false;
  });
  const contrastComplete = Boolean(
    criterionContrastAudit.strongest &&
    criterionContrastAudit.weakest &&
    criterionContrastAudit.comparison &&
    (!uniformCriteria || criterionContrastAudit.uniformProfileJustification)
  );
  return {
    examinerId,
    rateable: raw.rateable !== false,
    rateabilityReason: text(raw.rateabilityReason),
    criteria,
    criterionDetails,
    ...score,
    overallAssessment: text(raw.overallAssessment),
    overallAssessmentZh: text(raw.overallAssessmentZh),
    revisionSequence: list(raw.revisionSequence, 5),
    revisionSequenceZh: list(raw.revisionSequenceZh, 5),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.5)),
    uncertaintyReasons: list(raw.uncertaintyReasons),
    needsHumanReview: raw.needsHumanReview === true,
    evidenceCount,
    evidenceComplete: evidenceCount >= taskConfig.criteria.length * 2,
    feedbackComplete,
    uniformCriteria,
    upperBandCriteria,
    upperBandAuditComplete,
    fullRangeCeilingAuditComplete,
    nonDescriptorUpperBandClaims,
    criterionContrastAudit,
    contrastComplete
  };
}

module.exports = { roundHalf, averageBand, normalizeExaminerReport };
