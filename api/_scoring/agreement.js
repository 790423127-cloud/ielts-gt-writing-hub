"use strict";

function auditAgreement(examinerA, examinerB, taskConfig) {
  const criterionDeltas = {};
  let maxCriterionDelta = 0;
  let differingCriteria = 0;
  for (const criterion of taskConfig.criteria) {
    const delta = Math.abs(Number(examinerA.criteria[criterion]) - Number(examinerB.criteria[criterion]));
    criterionDeltas[criterion] = delta;
    maxCriterionDelta = Math.max(maxCriterionDelta, delta);
    if (delta > 0) differingCriteria += 1;
  }
  const overallDelta = Math.abs(examinerA.overallBand - examinerB.overallBand);
  const lowerOverall = Math.min(examinerA.overallBand, examinerB.overallBand);
  const upperOverall = Math.max(examinerA.overallBand, examinerB.overallBand);
  const panelMidpoint = (lowerOverall + upperOverall) / 2;
  const reasons = [];
  if (overallDelta > 0.5) reasons.push("OVERALL_DELTA_GT_0_5");
  if (maxCriterionDelta >= 1) reasons.push("CRITERION_DELTA_GTE_1");
  if (examinerA.rateable !== examinerB.rateable) reasons.push("RATEABILITY_CONFLICT");
  if (examinerA.needsHumanReview || examinerB.needsHumanReview) reasons.push("EXAMINER_REQUESTED_REVIEW");
  if (examinerA.confidence < 0.6 && examinerB.confidence < 0.6) reasons.push("BOTH_LOW_CONFIDENCE");
  if (differingCriteria >= 2) reasons.push("MULTIPLE_CRITERION_DISAGREEMENTS");
  const unanimousAiBandZero = examinerA.rateable === false && examinerB.rateable === false
    && lowerOverall === 0 && upperOverall === 0
    && taskConfig.criteria.every((name) => Number(examinerA.criteria[name]) === 0 && Number(examinerB.criteria[name]) === 0);
  if (!unanimousAiBandZero && upperOverall <= 2) reasons.push("AI_PANEL_LOW_EDGE_SAFEGUARD");
  if (lowerOverall >= 7) reasons.push("AI_PANEL_HIGH_EDGE_SAFEGUARD");
  if (lowerOverall >= 6.5 && differingCriteria >= 1) reasons.push("AI_PANEL_UPPER_BOUNDARY_PROFILE_DISAGREEMENT");
  const examinerAUniform = new Set(taskConfig.criteria.map((name) => Number(examinerA.criteria[name]))).size === 1;
  const examinerBUniform = new Set(taskConfig.criteria.map((name) => Number(examinerB.criteria[name]))).size === 1;
  const aTask = examinerA.criteria[taskConfig.firstCriterion];
  const bTask = examinerB.criteria[taskConfig.firstCriterion];
  const aLanguage = Math.max(...taskConfig.criteria.slice(1).map((name) => examinerA.criteria[name]));
  const bLanguage = Math.max(...taskConfig.criteria.slice(1).map((name) => examinerB.criteria[name]));
  if (aLanguage - aTask >= 2 || bLanguage - bTask >= 2) reasons.push("TASK_LANGUAGE_GAP_REVIEW");
  return {
    overallDelta,
    lowerOverall,
    upperOverall,
    panelMidpoint,
    criterionDeltas,
    maxCriterionDelta,
    differingCriteria,
    examinerAUniform,
    examinerBUniform,
    unanimousAiBandZero,
    observations: [
      ...(differingCriteria >= 1 ? ["ANY_CRITERION_DISAGREEMENT"] : []),
      ...(examinerAUniform && examinerBUniform ? ["BOTH_UNIFORM_CRITERIA"] : []),
      ...(examinerAUniform && examinerBUniform && (!examinerA.contrastComplete || !examinerB.contrastComplete) ? ["UNJUSTIFIED_UNIFORM_PROFILE"] : [])
    ],
    reasons: [...new Set(reasons)],
    adjudicationRequired: reasons.length > 0
  };
}

function selectWithoutAdjudication(examinerA, examinerB) {
  const score = (item) => item.confidence * 10 + item.evidenceCount;
  const selected = score(examinerB) > score(examinerA) ? examinerB : examinerA;
  return {
    selected,
    selectionReason: selected.examinerId === "B"
      ? "Examiner B supplied the stronger confidence-and-evidence record."
      : "Examiner A supplied an equal or stronger confidence-and-evidence record."
  };
}

module.exports = { auditAgreement, selectWithoutAdjudication };
