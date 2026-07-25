"use strict";

const { resolveTaskConfig } = require("./tasks");
const { validateAndNormalizeInput } = require("./input");
const { buildExaminerMessages, buildAdjudicatorMessages, buildZoneSpecialistMessages, buildThreeZoneAdjudicatorMessages, buildCriterionDifferentiationMessages, buildFeedbackRepairMessages, PROMPT_VERSION } = require("./rubric");
const { callDeepSeekJson } = require("./provider");
const { normalizeExaminerReport } = require("./normalize");
const { auditAgreement, selectWithoutAdjudication } = require("./agreement");

function confidenceLabel(value) {
  if (value >= 0.82) return "high";
  if (value >= 0.65) return "medium";
  return "low";
}

function usageTokens(audit) {
  if (Array.isArray(audit?.semanticAttemptHistory)) {
    return audit.semanticAttemptHistory.reduce((sum, item) => sum + Number(item?.usage?.total_tokens || item?.usage?.totalTokens || 0), 0);
  }
  return Number(audit?.usage?.total_tokens || audit?.usage?.totalTokens || 0);
}

function auditCallCount(audit) {
  if (!audit) return 0;
  return Array.isArray(audit.semanticAttemptHistory) ? audit.semanticAttemptHistory.length : 1;
}

function publicExaminerSummary(report) {
  return {
    examinerId: report.examinerId,
    rateable: report.rateable,
    criteria: report.criteria,
    overallBand: report.overallBand,
    confidence: report.confidence,
    evidenceCount: report.evidenceCount,
    evidenceComplete: report.evidenceComplete,
    feedbackComplete: report.feedbackComplete,
    uniformCriteria: report.uniformCriteria,
    criterionContrastAudit: report.criterionContrastAudit,
    contrastComplete: report.contrastComplete,
    upperBandCriteria: report.upperBandCriteria,
    upperBandAuditComplete: report.upperBandAuditComplete,
    fullRangeCeilingAuditComplete: report.fullRangeCeilingAuditComplete,
    nonDescriptorUpperBandClaims: report.nonDescriptorUpperBandClaims,
    needsHumanReview: report.needsHumanReview,
    uncertaintyReasons: report.uncertaintyReasons
  };
}

function selectAiSpecialistZone(examinerA, examinerB) {
  const lower = Math.min(examinerA.overallBand, examinerB.overallBand);
  const upper = Math.max(examinerA.overallBand, examinerB.overallBand);
  if (upper <= 5.5 && lower <= 5) return { zone: "low", reason: "AI_PANEL_AT_OR_BELOW_LOW_MID_BOUNDARY", lower, upper };
  if (lower >= 6.5 || upper >= 7) return { zone: "high", reason: "AI_PANEL_AT_OR_ABOVE_UPPER_MID_BOUNDARY", lower, upper };
  return { zone: "mid", reason: "AI_PANEL_IN_MIDDLE_BAND_RANGE", lower, upper };
}

async function runUnifiedScoring(body = {}, options = {}) {
  const taskConfig = resolveTaskConfig(body);
  const input = validateAndNormalizeInput(body, taskConfig);
  const callModel = options.callModel || callDeepSeekJson;
  const invokeModel = (request) => callModel({ ...request, signal: options.signal });
  const reportStage = (stage, detail = {}) => options.onStage?.(stage, detail);
  const startedAt = Date.now();
  const threeZoneEnabled = options.threeZoneEnabled ?? process.env.SCORE_THREE_ZONE_ENABLED === "true";
  const conditionalReviewEnabled = options.conditionalReviewEnabled ?? process.env.SCORE_CONDITIONAL_REVIEW_ENABLED !== "false";

  async function callAndNormalize({ role, examinerId = "", messages, normalizedId, requireUniformContrast = false, requireUpperBandAudit = false }) {
    let lastError = null;
    const semanticAttemptHistory = [];
    for (let semanticAttempt = 1; semanticAttempt <= 2; semanticAttempt += 1) {
      const retryRequirements = [
        "The previous JSON was structurally incomplete. Return every required criterion object and band, including four explicit Band-0 criterion objects for a non-rateable response.",
        requireUniformContrast ? "If all four bands remain equal, complete criterionContrastAudit with four criterion-specific evidence chains." : "",
        requireUpperBandAudit ? "For every criterion, set ceilingAudit.highestBandTested to 9.0 and give a text-specific Band-9 decision. Do not require originality, surprising ideas, inversion, conditionals, absolute perfection, exhaustive development of every secondary point, or the absence of conventional transitions. Verify every alleged error; never use a sentence as a blocker after admitting it is correct or acceptable. Extremely rare lapses remain compatible with Band 9." : ""
      ].filter(Boolean).join(" ");
      const retryMessages = semanticAttempt === 1 ? messages : messages.map((message, index) => (
        index === messages.length - 1
          ? { ...message, content: `${message.content}\n\nSEMANTIC RETRY: ${retryRequirements}` }
          : message
      ));
      const call = await invokeModel({ role, examinerId, messages: retryMessages });
      semanticAttemptHistory.push({ ...(call.audit || {}), semanticAttempt });
      try {
        const report = normalizeExaminerReport(call.data || call, taskConfig, input.essay, normalizedId, { visualType: input.visualFacts?.visualType || "" });
        if (requireUniformContrast && report.uniformCriteria && !report.contrastComplete) {
          throw new Error(`${normalizedId} kept a uniform profile without four criterion-specific contrast chains.`);
        }
        if (requireUpperBandAudit && (!report.fullRangeCeilingAuditComplete || report.nonDescriptorUpperBandClaims.length)) {
          throw new Error(`${normalizedId} returned an incomplete or non-descriptor Band-9 ceiling audit.`);
        }
        return { call: { ...call, audit: { ...(call.audit || {}), semanticAttempt, semanticAttemptHistory } }, report };
      } catch (error) {
        lastError = error;
        if (semanticAttempt === 2) throw error;
      }
    }
    throw lastError || new Error(`${normalizedId} returned an invalid report.`);
  }

  reportStage("examiners_started");
  const [examinerResultA, examinerResultB] = await Promise.all([
    callAndNormalize({
      role: "examiner",
      examinerId: "A",
      messages: buildExaminerMessages({ taskConfig, input, examinerId: "A" }),
      normalizedId: "A"
    }),
    callAndNormalize({
      role: "examiner",
      examinerId: "B",
      messages: buildExaminerMessages({ taskConfig, input, examinerId: "B" }),
      normalizedId: "B"
    })
  ]);
  reportStage("examiners_completed");
  const callA = examinerResultA.call;
  const callB = examinerResultB.call;
  const examinerA = examinerResultA.report;
  const examinerB = examinerResultB.report;
  const agreement = auditAgreement(examinerA, examinerB, taskConfig);
  reportStage("agreement_completed", { adjudicationRequired: agreement.adjudicationRequired, reasons: agreement.reasons });

  let finalReport;
  let adjudication = { triggered: false, reasons: agreement.reasons, decision: "not_required" };
  let adjudicatorAudit = null;
  let specialistReport = null;
  let specialistAudit = null;
  let specialistRouting = null;
  let feedbackRepairAudit = null;
  let criterionProfileReviewAudit = null;
  let criterionProfileReviewTriggered = false;
  let highBoundaryFinal = false;
  const feedbackRepairAuditHistory = [];
  let feedbackRepairAttempted = false;
  let feedbackRepairSucceeded = false;
  const threeZoneReviewRequired = threeZoneEnabled && (!conditionalReviewEnabled || agreement.adjudicationRequired);
  if (threeZoneReviewRequired) {
    specialistRouting = selectAiSpecialistZone(examinerA, examinerB);
    reportStage("specialist_started", specialistRouting);
    const specialistResult = await callAndNormalize({
      role: `${specialistRouting.zone}_specialist`,
      messages: buildZoneSpecialistMessages({ zone: specialistRouting.zone, taskConfig, input }),
      normalizedId: `${specialistRouting.zone}-specialist`,
      requireUniformContrast: specialistRouting.zone === "high",
      requireUpperBandAudit: specialistRouting.zone === "high"
    });
    specialistReport = specialistResult.report;
    specialistAudit = specialistResult.call.audit || null;
    reportStage("specialist_completed", { ...specialistRouting, overallBand: specialistReport.overallBand });
    if (specialistRouting.zone === "high") {
      highBoundaryFinal = true;
      finalReport = specialistReport;
      reportStage("adjudication_started", { architecture: "independent_pro_upper_boundary_final" });
      adjudication = {
        triggered: true,
        reasons: [...new Set([...agreement.reasons, "INDEPENDENT_PRO_UPPER_BOUNDARY_FINAL"])],
        decision: "independent_pro_upper_boundary_final",
        specialistZone: specialistRouting.zone,
        specialistCriteria: specialistReport.criteria,
        specialistOverallBand: specialistReport.overallBand,
        finalCriteria: finalReport.criteria,
        finalOverallBand: finalReport.overallBand,
        skippedRoles: ["meta_adjudicator", "criterion_profile_adjudicator"],
        localScoreAdjustment: false
      };
      reportStage("adjudication_completed", { architecture: "independent_pro_upper_boundary_final" });
    } else {
      reportStage("adjudication_started", { architecture: "three_zone_ai_panel" });
      const metaResult = await callAndNormalize({
        role: "meta_adjudicator",
        messages: buildThreeZoneAdjudicatorMessages({
          taskConfig,
          input,
          examinerA,
          examinerB,
          specialist: specialistReport,
          specialistZone: specialistRouting.zone,
          agreement
        }),
        normalizedId: "three-zone-meta-adjudicator",
        requireUniformContrast: true
      });
      finalReport = metaResult.report;
      adjudicatorAudit = metaResult.call.audit || null;
      adjudication = {
        triggered: true,
        reasons: [...new Set([...agreement.reasons, "THREE_ZONE_AI_PANEL"])],
        decision: "three_zone_independent_meta_reassessment",
        specialistZone: specialistRouting.zone,
        specialistCriteria: specialistReport.criteria,
        specialistOverallBand: specialistReport.overallBand,
        finalCriteria: finalReport.criteria,
        finalOverallBand: finalReport.overallBand
      };
      reportStage("adjudication_completed", { architecture: "three_zone_ai_panel" });
    }
  } else if (threeZoneEnabled) {
    const selection = selectWithoutAdjudication(examinerA, examinerB);
    finalReport = selection.selected;
    adjudication = {
      ...adjudication,
      decision: "stable_ai_examiner_selected",
      selectionReason: selection.selectionReason,
      avoidedRoles: ["zone_specialist", "meta_adjudicator"]
    };
    reportStage("adjudication_skipped", { architecture: "conditional_three_zone_ai_panel", reason: "AI_PANEL_STABLE" });
  } else if (agreement.adjudicationRequired) {
    reportStage("adjudication_started");
    const adjudicatorResult = await callAndNormalize({
      role: "adjudicator",
      messages: buildAdjudicatorMessages({ taskConfig, input, examinerA, examinerB, agreement }),
      normalizedId: "adjudicator",
      requireUniformContrast: true
    });
    finalReport = adjudicatorResult.report;
    adjudicatorAudit = adjudicatorResult.call.audit || null;
    adjudication = {
      triggered: true,
      reasons: agreement.reasons,
      decision: "independent_reassessment",
      finalCriteria: finalReport.criteria,
      finalOverallBand: finalReport.overallBand
    };
    reportStage("adjudication_completed");
  } else {
    const selection = selectWithoutAdjudication(examinerA, examinerB);
    finalReport = selection.selected;
    adjudication = { ...adjudication, decision: "examiner_selected", selectionReason: selection.selectionReason };
    reportStage("adjudication_skipped");
  }

  const uniformProfileInRiskRange = !highBoundaryFinal && finalReport.uniformCriteria && finalReport.overallBand >= 4 && finalReport.overallBand <= 7;
  if (uniformProfileInRiskRange) {
    criterionProfileReviewTriggered = true;
    reportStage("criterion_profile_review_started", { previousOverallBand: finalReport.overallBand });
    const profileResult = await callAndNormalize({
      role: "criterion_profile_adjudicator",
      messages: buildCriterionDifferentiationMessages({
        taskConfig,
        input,
        frozenCandidate: finalReport,
        examinerA,
        examinerB,
        specialist: specialistReport
      }),
      normalizedId: "criterion-profile-adjudicator",
      requireUniformContrast: true
    });
    finalReport = profileResult.report;
    criterionProfileReviewAudit = profileResult.call.audit || null;
    adjudication = {
      ...adjudication,
      criterionProfileReview: {
        triggered: true,
        decision: finalReport.uniformCriteria ? "uniform_profile_independently_justified" : "criterion_profile_differentiated_by_ai",
        finalCriteria: finalReport.criteria,
        finalOverallBand: finalReport.overallBand,
        localScoreAdjustment: false
      }
    };
    reportStage("criterion_profile_review_completed", { finalOverallBand: finalReport.overallBand, uniformCriteria: finalReport.uniformCriteria });
  }

  const feedbackDeferred = body.mode === "score" && finalReport.feedbackComplete === false;
  if (finalReport.feedbackComplete === false && !feedbackDeferred) {
    feedbackRepairAttempted = true;
    reportStage("feedback_repair_started");
    const frozenCriteria = { ...finalReport.criteria };
    let repairContext = finalReport;
    for (let feedbackAttempt = 1; feedbackAttempt <= 2 && !feedbackRepairSucceeded; feedbackAttempt += 1) {
      try {
        const call = await invokeModel({
          role: "feedback_repair",
          messages: buildFeedbackRepairMessages({ taskConfig, input, frozenReport: repairContext })
        });
        feedbackRepairAudit = { ...(call.audit || {}), feedbackAttempt };
        feedbackRepairAuditHistory.push(feedbackRepairAudit);
        const forcedRaw = JSON.parse(JSON.stringify(call.data || call));
        forcedRaw.criteria = forcedRaw.criteria && typeof forcedRaw.criteria === "object" ? forcedRaw.criteria : {};
        for (const name of taskConfig.criteria) {
          const criterion = forcedRaw.criteria[name] && typeof forcedRaw.criteria[name] === "object"
            ? forcedRaw.criteria[name]
            : {};
          forcedRaw.criteria[name] = { ...criterion, band: frozenCriteria[name] };
        }
        const repaired = normalizeExaminerReport(forcedRaw, taskConfig, input.essay, `feedback-repair-${feedbackAttempt}`);
        if (repaired.feedbackComplete) {
          finalReport = {
            ...finalReport,
            criteria: frozenCriteria,
            criterionDetails: repaired.criterionDetails,
            overallAssessment: repaired.overallAssessment || finalReport.overallAssessment,
            overallAssessmentZh: repaired.overallAssessmentZh || finalReport.overallAssessmentZh,
            revisionSequence: repaired.revisionSequence,
            revisionSequenceZh: repaired.revisionSequenceZh,
            evidenceCount: repaired.evidenceCount,
            evidenceComplete: repaired.evidenceComplete,
            feedbackComplete: true
          };
          feedbackRepairSucceeded = true;
        } else {
          repairContext = { ...finalReport, criteria: frozenCriteria, criterionDetails: repaired.criterionDetails };
        }
      } catch (error) {
        feedbackRepairAudit = { error: error?.code || error?.name || "FEEDBACK_REPAIR_FAILED", message: String(error?.message || error).slice(0, 500), feedbackAttempt };
        feedbackRepairAuditHistory.push(feedbackRepairAudit);
      }
    }
    reportStage("feedback_repair_completed");
  }

  const observedBands = [examinerA.overallBand, examinerB.overallBand, finalReport.overallBand, specialistReport?.overallBand].filter(Number.isFinite);
  const lowerObserved = Math.min(...observedBands);
  const upperObserved = Math.max(...observedBands);
  const confidence = Math.min(finalReport.confidence, agreement.adjudicationRequired ? 0.86 : 0.9);
  const factsNeedReview = taskConfig.taskKind === "academic_visual_report" && !input.signals.visualFactsSourceVerified;
  const feedbackNeedsReview = finalReport.feedbackComplete === false && !feedbackDeferred;
  const needsHumanReview = Boolean(
    factsNeedReview ||
    feedbackNeedsReview ||
    finalReport.needsHumanReview ||
    input.signals.possibleNonEnglishResponse ||
    input.signals.possiblePromptInjection ||
    confidence < 0.6
  );
  const feedbackStatus = feedbackDeferred ? "deferred_to_feedback_stage" : (feedbackNeedsReview ? "embedded_incomplete" : "embedded_complete");
  const elapsedMs = Date.now() - startedAt;
  reportStage("score_frozen", { overallBand: finalReport.overallBand });

  return {
    ok: true,
    examModule: taskConfig.examModule,
    module: taskConfig.moduleLabel,
    taskNumber: taskConfig.taskNumber,
    task: taskConfig.task,
    taskKind: taskConfig.taskKind,
    overallBand: finalReport.overallBand,
    rawAverage: finalReport.rawAverage,
    likelyRange: [Math.max(0, lowerObserved - 0.5), Math.min(9, upperObserved + 0.5)],
    confidence: confidenceLabel(confidence),
    confidenceScore: Number(confidence.toFixed(2)),
    needsHumanReview,
    humanReviewReasons: [
      ...(factsNeedReview ? ["ACADEMIC_VISUAL_FACTS_NOT_SOURCE_VERIFIED"] : []),
      ...(input.signals.possiblePromptInjection ? ["POSSIBLE_PROMPT_INJECTION"] : []),
      ...(input.signals.possibleNonEnglishResponse ? ["POSSIBLE_NON_ENGLISH_RESPONSE"] : []),
      ...(feedbackNeedsReview ? ["FINAL_FEEDBACK_INCOMPLETE"] : []),
      ...finalReport.uncertaintyReasons
    ],
    criteria: finalReport.criteria,
    finalCriteria: finalReport.criteria,
    criterionCalibration: finalReport.criterionDetails,
    criteriaDetails: finalReport.criterionDetails,
    overallAssessment: finalReport.overallAssessment,
    overallAssessmentZh: finalReport.overallAssessmentZh,
    revisionSequence: finalReport.revisionSequence,
    revisionSequenceZh: finalReport.revisionSequenceZh,
    examinerAgreement: {
      ...agreement,
      examinerA: publicExaminerSummary(examinerA),
      examinerB: publicExaminerSummary(examinerB)
    },
    threeZonePanel: threeZoneEnabled ? {
      enabled: true,
      conditionalReviewEnabled,
      reviewTriggered: threeZoneReviewRequired,
      routing: specialistRouting,
      specialist: specialistReport ? publicExaminerSummary(specialistReport) : null,
      finalDecisionSource: criterionProfileReviewTriggered
        ? "ai-criterion-profile-adjudicator"
        : highBoundaryFinal
        ? "ai-pro-upper-boundary-specialist"
        : (threeZoneReviewRequired ? "ai-meta-adjudicator" : `ai-examiner-${finalReport.examinerId}`),
      localScoreAdjustment: false
    } : { enabled: false },
    adjudication,
    localSignals: input.signals,
    visualFactsAudit: taskConfig.taskKind === "academic_visual_report" ? {
      available: input.signals.visualFactsAvailable,
      sourceVerified: input.signals.visualFactsSourceVerified,
      visualType: input.visualFacts?.visualType || "unknown",
      humanReviewRequiredForDataAccuracy: factsNeedReview
    } : null,
    scoreFrozen: true,
    scoreCalculation: {
      mode: criterionProfileReviewTriggered
        ? "ai_criterion_profile_review_after_uniform_candidate"
        : highBoundaryFinal
        ? "independent_pro_upper_boundary_final"
        : threeZoneEnabled
        ? (threeZoneReviewRequired ? "conditional_three_zone_ai_specialist_with_meta_adjudication" : "stable_double_ai_examiner_selection")
        : "independent_double_examiner_with_conditional_adjudication",
      formula: "The final AI-selected four criterion bands are averaged equally and rounded to the nearest half band. General examiner and specialist results are never averaged together.",
      rawAverage: finalReport.rawAverage,
      finalBand: finalReport.overallBand,
      source: criterionProfileReviewTriggered
        ? "ai-criterion-profile-adjudicator"
        : highBoundaryFinal
        ? "ai-pro-upper-boundary-specialist"
        : threeZoneReviewRequired
        ? "three-zone-ai-meta-adjudicator"
        : (adjudication.triggered ? "independent-adjudicator" : `independent-examiner-${finalReport.examinerId}`)
    },
    boundaryAudit: {
      reviewRequired: agreement.adjudicationRequired,
      reviewReasons: agreement.reasons,
      freezeBlocked: false,
      unresolvedCriticalReasons: [],
      boundaryReview: { triggered: adjudication.triggered, decision: adjudication.decision }
    },
    feedbackStatus: {
      status: feedbackStatus,
      scoreChanged: false,
      repairAttempted: feedbackRepairAttempted,
      repairSucceeded: feedbackRepairSucceeded,
      note: feedbackDeferred
        ? "Core criterion bands are frozen. Detailed criterion feedback is generated in the separate feedback stage."
        : feedbackNeedsReview
        ? "Criterion feedback did not satisfy the evidence-and-revision completeness gate."
        : "Text-specific criterion evidence and revision moves are embedded in the frozen scoring result."
    },
    scoreCoreMeta: {
      feedbackRequiredExternal: feedbackDeferred,
      feedbackGenerated: !feedbackDeferred,
      feedbackStatus
    },
    rubricVersion: taskConfig.rubricVersion,
    promptVersion: PROMPT_VERSION,
    scoreSystemVersion: threeZoneEnabled ? "unified-writing-core-v6.5-full-range-pro-upper-boundary" : "unified-writing-core-v5",
    modelAudit: {
      examinerA: callA.audit || null,
      examinerB: callB.audit || null,
      specialist: specialistAudit,
      adjudicator: adjudicatorAudit,
      criterionProfileReview: criterionProfileReviewAudit,
      feedbackRepair: feedbackRepairAudit,
      feedbackRepairHistory: feedbackRepairAuditHistory,
      elapsedMs,
      costOptimization: {
        conditionalReviewEnabled,
        reviewPolicyVersion: "material-disagreement-plus-full-range-ai-edge-safeguards-v3",
        accuracySafeguardTriggered: agreement.reasons.some((reason) => /EDGE_SAFEGUARD|UPPER_BOUNDARY/.test(reason)),
        specialistTriggered: Boolean(specialistAudit),
        metaAdjudicatorTriggered: Boolean(adjudicatorAudit),
        criterionProfileReviewTriggered,
        highBoundaryFinal,
        upperBandAuditComplete: finalReport.upperBandAuditComplete,
        fullRangeCeilingAuditComplete: finalReport.fullRangeCeilingAuditComplete,
        nonDescriptorUpperBandClaims: finalReport.nonDescriptorUpperBandClaims,
        coreModelCalls: auditCallCount(callA.audit) + auditCallCount(callB.audit) + auditCallCount(specialistAudit) + auditCallCount(adjudicatorAudit) + auditCallCount(criterionProfileReviewAudit),
        avoidedModelCalls: highBoundaryFinal ? 1 : (conditionalReviewEnabled && !threeZoneReviewRequired ? (criterionProfileReviewAudit ? 1 : 2) : 0),
        coreTotalTokens: usageTokens(callA.audit) + usageTokens(callB.audit) + usageTokens(specialistAudit) + usageTokens(adjudicatorAudit) + usageTokens(criterionProfileReviewAudit)
      }
    },
    disclaimer: "This is an AI-generated estimated score, not an official IELTS score.",
    disclaimerZh: "这是 AI 生成的雅思写作估分，不是官方 IELTS 成绩。"
  };
}

module.exports = { runUnifiedScoring };
