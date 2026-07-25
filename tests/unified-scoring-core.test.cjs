"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { resolveTaskConfig } = require("../api/_scoring/tasks");
const { validateAndNormalizeInput } = require("../api/_scoring/input");
const { auditAgreement } = require("../api/_scoring/agreement");
const { runUnifiedScoring } = require("../api/_scoring/engine");
const { callDeepSeekJson } = require("../api/_scoring/provider");
const { roundHalf, averageBand, normalizeExaminerReport } = require("../api/_scoring/normalize");
const { buildExaminerMessages, buildAdjudicatorMessages, buildThreeZoneAdjudicatorMessages, buildFeedbackRepairMessages, PROMPT_VERSION } = require("../api/_scoring/rubric");
const criterionFeedbackHandler = require("../api/criterion-feedback");

test("provider timeout fails once without starting a second long request", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousTimeout = process.env.SCORE_REQUEST_TIMEOUT_MS;
  const previousFetch = global.fetch;
  let calls = 0;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.SCORE_REQUEST_TIMEOUT_MS = "120000";
  global.fetch = async () => {
    calls += 1;
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  };
  try {
    await assert.rejects(
      callDeepSeekJson({ role: "examiner", messages: [{ role: "user", content: "test" }] }),
      (error) => error?.code === "PROVIDER_TIMEOUT" && error?.httpStatus === 504
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousTimeout === undefined) delete process.env.SCORE_REQUEST_TIMEOUT_MS;
    else process.env.SCORE_REQUEST_TIMEOUT_MS = previousTimeout;
  }
});

test("caller cancellation aborts the provider request without retrying", async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  process.env.DEEPSEEK_API_KEY = "test-key";
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    calls += 1;
    options.signal.addEventListener("abort", () => {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  try {
    const pending = callDeepSeekJson({ role: "examiner", messages: [{ role: "user", content: "test" }], signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error?.code === "SCORING_CANCELLED");
    assert.equal(calls, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

const essay = "The main trend is clear. This sentence gives relevant evidence. Another paragraph develops the comparison with accurate language and a controlled complex sentence.";

function report(criteria, confidence = 0.8) {
  return {
    rateable: true, confidence, needsHumanReview: false, criteria: Object.fromEntries(Object.entries(criteria).map(([name, band]) => [name, {
      band,
      whyThisBand: "The evidence fits this band.", whyThisBandZh: "证据符合这一分数档。",
      whyNotLower: "The response is sufficiently controlled.", whyNotLowerZh: "文章具备足够的控制力。",
      whyNotHigher: "Development remains uneven.", whyNotHigherZh: "论述展开仍不均衡。",
      positiveEvidence: ["Relevant content is present."], limitingEvidence: ["More detail is needed."], howToImprove: "Develop the comparison.",
      nextRevision: { priority: "Develop the comparison.", action: "Add one precise comparison.", priorityZh: "补充比较。", actionZh: "加入一处精确比较。", revisedExample: "The gap widened from 11 to 38 percentage points.", whyItWorks: "It makes the relationship explicit.", whyItWorksZh: "这样能把数据关系说清楚。" },
      essayEvidence: [{ quote: "The main trend is clear.", explanation: "Direct evidence.", explanationZh: "这是直接原文证据。" }, { quote: "Another paragraph develops the comparison", explanation: "Direct evidence.", explanationZh: "这是直接原文证据。" }], confidence
    }]))
  };
}

function compactScoreReport(criteria, confidence = 0.8) {
  return {
    rateable: true,
    confidence,
    needsHumanReview: false,
    criterionContrastAudit: {
      strongest: Object.keys(criteria)[0] || "none",
      weakest: Object.keys(criteria).at(-1) || "none",
      comparison: "Each criterion was compared independently against its adjacent descriptors.",
      uniformProfileJustification: "When equal, four separate evidence chains support the same boundary."
    },
    criteria: Object.fromEntries(Object.entries(criteria).map(([name, band]) => [name, {
      band,
      diagnosis: "The dominant pattern fits this descriptor.",
      bandBoundary: { fit: "The evidence supports this band.", nextBandGap: "Control is not yet complete." },
      strengths: ["Relevant content is present."],
      constraints: ["Control is not fully flexible."],
      essayEvidence: [
        { quote: "The main trend is clear.", explanation: "Direct scoring evidence." },
        { quote: "Another paragraph develops the comparison", explanation: "A second scoring pattern." }
      ],
      ceilingAudit: {
        highestBandTested: 9,
        passed: Number(band) >= 9,
        reason: Number(band) >= 9 ? "Band 9 is the dominant descriptor fit." : "The selected lower descriptor remains the dominant fit.",
        band9PositiveEvidence: "The strongest available criterion evidence was tested against Band 9.",
        band9BlockingPattern: Number(band) >= 9 ? "" : "A recurring limitation remains visible across the response."
      },
      confidence
    }]))
  };
}

test("all 19 half-band values from 0 to 9 remain valid criterion and Overall outputs", () => {
  const taskConfig = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  for (let step = 0; step <= 18; step += 1) {
    const band = step / 2;
    const criteria = Object.fromEntries(taskConfig.criteria.map((name) => [name, band]));
    const normalized = normalizeExaminerReport(compactScoreReport(criteria), taskConfig, essay, `band-${band}`);
    assert.equal(normalized.overallBand, band);
    assert.deepEqual(Object.values(normalized.criteria), [band, band, band, band]);
    assert.equal(roundHalf(band), band);
  }
  assert.equal(averageBand({ a: 8.5, b: 9, c: 8.5, d: 9 }).overallBand, 9);
});

test("a genuine AI Band-9 profile survives high-zone review without a local ceiling", async () => {
  const names = ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const bandNine = Object.fromEntries(names.map((name) => [name, 9]));
  const calls = [];
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    return { data: compactScoreReport(bandNine, 0.9), audit: { role, model: "test-model" } };
  };
  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 2,
    mode: "score",
    questionPrompt: "Discuss both views and give your opinion.",
    essay
  }, { callModel, threeZoneEnabled: true, conditionalReviewEnabled: true });
  assert.deepEqual(calls.sort(), ["A", "B", "high_specialist"].sort());
  assert.equal(result.overallBand, 9);
  assert.deepEqual(Object.values(result.criteria), [9, 9, 9, 9]);
  assert.equal(result.scoreCalculation.source, "ai-pro-upper-boundary-specialist");
  assert.equal(result.modelAudit.costOptimization.coreModelCalls, 3);
  assert.equal(result.modelAudit.costOptimization.upperBandAuditComplete, true);
});

test("task registry resolves all A/G Task 1/2 combinations", () => {
  assert.equal(resolveTaskConfig({ examModule: "academic", taskNumber: 1 }).taskKind, "academic_visual_report");
  assert.equal(resolveTaskConfig({ examModule: "academic", taskNumber: 2 }).taskKind, "essay");
  assert.equal(resolveTaskConfig({ examModule: "general_training", taskNumber: 1 }).taskKind, "gt_letter");
  assert.equal(resolveTaskConfig({ examModule: "general_training", taskNumber: 2 }).taskKind, "essay");
});

test("server recomputes word count and ignores a spoofed client count", () => {
  const config = resolveTaskConfig({ examModule: "academic", taskNumber: 1 });
  const input = validateAndNormalizeInput({ questionPrompt: "Summarise the chart.", essay, wordCount: 999 }, config);
  assert.notEqual(input.signals.wordCount, 999);
  assert.equal(input.signals.clientWordCountIgnored, true);
});

test("empty responses reach the AI Band-0 audit without a local score assignment", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const zeroBands = Object.fromEntries(names.map((name) => [name, 0]));
  const callModel = async ({ role }) => ({ data: compactScoreReport(zeroBands), audit: { role, model: "test-model" } });
  const result = await runUnifiedScoring({
    examModule: "general_training",
    taskNumber: 1,
    mode: "score",
    questionPrompt: "Write a letter explaining a problem.",
    essay: ""
  }, { callModel });
  assert.equal(result.localSignals.emptyResponse, true);
  assert.equal(result.localSignals.wordCount, 0);
  assert.equal(result.overallBand, 0);
  assert.deepEqual(Object.values(result.criteria), [0, 0, 0, 0]);
});

test("local under-length signals never lower or rewrite AI criterion bands", async () => {
  const names = ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const aiBands = { [names[0]]: 7, [names[1]]: 7, [names[2]]: 6.5, [names[3]]: 7.5 };
  const callModel = async ({ role }) => ({ data: report(aiBands), audit: { role, model: "test-model" } });
  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 2,
    questionPrompt: "Discuss both views and give your opinion.",
    essay
  }, { callModel });

  assert.equal(result.localSignals.underMinimum, true);
  assert.deepEqual(Object.values(result.criteria), [7, 7, 6.5, 7.5]);
  assert.equal(result.overallBand, 7);
});

test("agreement audit triggers adjudication for a one-band criterion conflict", () => {
  const task = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  const a = { overallBand: 6, rateable: true, confidence: .8, evidenceComplete: true, needsHumanReview: false, criteria: { "Task Response": 6, "Coherence and Cohesion": 6, "Lexical Resource": 6, "Grammatical Range and Accuracy": 6 } };
  const b = { ...a, criteria: { ...a.criteria, "Task Response": 7 } };
  assert.equal(auditAgreement(a, b, task).adjudicationRequired, true);
});

test("matching uniform four-criterion profiles are observed without forcing two extra AI calls", () => {
  const task = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  const uniform = { overallBand: 6, rateable: true, confidence: .8, evidenceComplete: true, needsHumanReview: false, criteria: Object.fromEntries(task.criteria.map((name) => [name, 6])) };
  const audit = auditAgreement(uniform, { ...uniform }, task);
  assert.equal(audit.adjudicationRequired, false);
  assert.ok(audit.observations.includes("UNJUSTIFIED_UNIFORM_PROFILE"));
  assert.deepEqual(Object.values(uniform.criteria), [6, 6, 6, 6]);
});

test("separately justified uniform profiles do not force an extra AI review", () => {
  const task = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  const uniform = {
    overallBand: 6,
    rateable: true,
    confidence: .82,
    evidenceComplete: true,
    contrastComplete: true,
    needsHumanReview: false,
    criteria: Object.fromEntries(task.criteria.map((name) => [name, 6]))
  };
  const audit = auditAgreement(uniform, { ...uniform }, task);
  assert.equal(audit.adjudicationRequired, false);
  assert.ok(audit.observations.includes("BOTH_UNIFORM_CRITERIA"));
});

test("matching high-edge AI scores still trigger the specialist safeguard", () => {
  const task = resolveTaskConfig({ examModule: "general_training", taskNumber: 2 });
  const high = {
    overallBand: 7,
    rateable: true,
    confidence: .86,
    evidenceComplete: true,
    contrastComplete: true,
    needsHumanReview: false,
    criteria: Object.fromEntries(task.criteria.map((name) => [name, 7]))
  };
  const audit = auditAgreement(high, { ...high }, task);
  assert.equal(audit.adjudicationRequired, true);
  assert.ok(audit.reasons.includes("AI_PANEL_HIGH_EDGE_SAFEGUARD"));
});

test("matching low-edge AI scores trigger review but unanimous AI Band 0 does not", () => {
  const task = resolveTaskConfig({ examModule: "general_training", taskNumber: 1 });
  const low = {
    overallBand: 2,
    rateable: true,
    confidence: .8,
    evidenceComplete: true,
    contrastComplete: true,
    needsHumanReview: false,
    criteria: Object.fromEntries(task.criteria.map((name) => [name, 2]))
  };
  assert.ok(auditAgreement(low, { ...low }, task).reasons.includes("AI_PANEL_LOW_EDGE_SAFEGUARD"));
  const zero = { ...low, overallBand: 0, rateable: false, criteria: Object.fromEntries(task.criteria.map((name) => [name, 0])) };
  assert.equal(auditAgreement(zero, { ...zero }, task).adjudicationRequired, false);
});

test("unified engine runs independent examiners and an adjudicator", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const calls = [];
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    const bands = role === "adjudicator"
      ? { [names[0]]: 6, [names[1]]: 6, [names[2]]: 5.5, [names[3]]: 6.5 }
      : Object.fromEntries(names.map((name) => [name, examinerId === "A" ? 5.5 : 6.5]));
    return { data: report(bands), audit: { role, model: "test-model" } };
  };
  const result = await runUnifiedScoring({ examModule: "academic", taskNumber: 1, questionPrompt: "Summarise the chart.", essay, visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] } }, { callModel });
  assert.deepEqual(calls.sort(), ["A", "B", "adjudicator"].sort());
  assert.equal(result.adjudication.triggered, true);
  assert.equal(result.overallBand, 6);
  assert.equal(result.scoreFrozen, true);
});

test("three-zone mode uses an AI specialist and AI meta-adjudicator without local score adjustment", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const calls = [];
  const bands = (value) => Object.fromEntries(names.map((name) => [name, value]));
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    if (role === "low_specialist") return { data: compactScoreReport(bands(1)), audit: { role, model: "test-model" } };
    if (role === "meta_adjudicator") return { data: compactScoreReport(bands(1.5)), audit: { role, model: "test-model" } };
    return { data: compactScoreReport(bands(3)), audit: { role, model: "test-model" } };
  };

  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    mode: "score",
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel, threeZoneEnabled: true, conditionalReviewEnabled: false });

  assert.deepEqual(calls, ["A", "B", "low_specialist", "meta_adjudicator"]);
  assert.equal(result.threeZonePanel.enabled, true);
  assert.equal(result.threeZonePanel.routing.zone, "low");
  assert.equal(result.threeZonePanel.specialist.overallBand, 1);
  assert.equal(result.overallBand, 1.5);
  assert.equal(result.scoreCalculation.source, "three-zone-ai-meta-adjudicator");
  assert.equal(result.threeZonePanel.localScoreAdjustment, false);
  assert.deepEqual(Object.values(result.criteria), [1.5, 1.5, 1.5, 1.5]);
});

test("stable A/B agreement skips specialist and meta-adjudicator while preserving an AI score source", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const stableBands = {
    [names[0]]: 6,
    [names[1]]: 6.5,
    [names[2]]: 6,
    [names[3]]: 5.5
  };
  const calls = [];
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    return { data: compactScoreReport(stableBands), audit: { role, model: "test-model", usage: { total_tokens: 100 } } };
  };
  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    mode: "score",
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel, threeZoneEnabled: true, conditionalReviewEnabled: true });

  assert.deepEqual(calls.sort(), ["A", "B"].sort());
  assert.equal(result.threeZonePanel.reviewTriggered, false);
  assert.equal(result.threeZonePanel.localScoreAdjustment, false);
  assert.equal(result.scoreCalculation.source, "independent-examiner-A");
  assert.equal(result.modelAudit.costOptimization.coreModelCalls, 2);
  assert.equal(result.modelAudit.costOptimization.avoidedModelCalls, 2);
});

test("batch criterion feedback generates all four frozen explanations in one AI call", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const frozen = Object.fromEntries(names.map((name) => [name, 6]));
  let calls = 0;
  const item = {
    band: 6,
    summary: "The response shows an adequate recurring pattern.",
    summaryZh: "该项表现总体达到六分档。",
    whyThisBand: "The recurring evidence fits Band 6.",
    whyThisBandZh: "反复出现的证据符合六分档。",
    whyNotLower: "Meaning and organisation are generally clear.",
    whyNotLowerZh: "意思和组织总体清楚。",
    whyNotHigher: "Control is not consistently flexible.",
    whyNotHigherZh: "控制尚未持续灵活。",
    howToImprove: "Make the comparison more precise.",
    howToImproveZh: "让比较更加精确。",
    positiveEvidence: ["Relevant content is present."],
    positiveEvidenceZh: ["包含相关内容。"],
    limitingEvidence: ["Development remains uneven."],
    limitingEvidenceZh: ["展开仍不均衡。"],
    essayEvidence: [
      { quote: "The main trend is clear.", meaning: "Direct evidence.", meaningZh: "直接证据。" },
      { quote: "Another paragraph develops the comparison", meaning: "A second pattern.", meaningZh: "第二处模式。" }
    ],
    nextRevision: {
      priority: "Make the comparison more precise.",
      priorityZh: "让比较更加精确。",
      action: "Rewrite the comparison with both values in one sentence.",
      actionZh: "把两个数值放进同一句进行比较。",
      beforeQuote: "The main trend is clear.",
      revisedExample: "The gap widened from 11 to 38 percentage points.",
      whyItWorks: "The revision makes the relationship explicit.",
      whyItWorksZh: "修改后数据关系更加明确。"
    }
  };
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: "deepseek-v4-flash",
        usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ criterionCalibration: Object.fromEntries(names.map((name) => [name, item])) }) } }]
      })
    };
  };
  try {
    const result = await criterionFeedbackHandler._test.generateAllCriteria({
      task: "Task 1",
      examModule: "academic",
      questionPrompt: "Summarise the chart.",
      essay,
      frozenScore: { criteria: frozen, finalCriteria: frozen }
    }, names);
    assert.equal(calls, 1);
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(Object.values(result.criterionCalibration).map((entry) => entry.band), [6, 6, 6, 6]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("feedback repair enriches evidence without changing frozen criterion bands", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const frozenBands = { [names[0]]: 6, [names[1]]: 6, [names[2]]: 5.5, [names[3]]: 6.5 };
  const inflatedRepairBands = Object.fromEntries(names.map((name) => [name, 9]));
  const calls = [];
  const incompleteReport = () => {
    const value = report(frozenBands);
    for (const detail of Object.values(value.criteria)) {
      detail.essayEvidence = detail.essayEvidence.slice(0, 1);
      detail.nextRevision.revisedExample = "";
    }
    return value;
  };
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    if (role === "feedback_repair") {
      return { data: report(inflatedRepairBands), audit: { role, model: "test-model" } };
    }
    return { data: incompleteReport(), audit: { role, model: "test-model" } };
  };

  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel });

  assert.deepEqual(calls.sort(), ["A", "B", "feedback_repair"].sort());
  assert.equal(result.overallBand, 6);
  assert.deepEqual(Object.values(result.criteria), [6, 6, 5.5, 6.5]);
  assert.equal(result.feedbackStatus.repairAttempted, true);
  assert.equal(result.feedbackStatus.repairSucceeded, true);
  assert.equal(result.feedbackStatus.scoreChanged, false);
});

test("uniform matching examiners receive one AI criterion-profile review before frozen-band feedback", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const frozenBands = Object.fromEntries(names.map((name) => [name, 6]));
  const differentiatedBands = { [names[0]]: 6, [names[1]]: 6, [names[2]]: 5.5, [names[3]]: 6.5 };
  const inflatedFeedbackBands = Object.fromEntries(names.map((name) => [name, 9]));
  const calls = [];
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    return {
      data: role === "feedback_repair"
        ? report(inflatedFeedbackBands)
        : compactScoreReport(role === "criterion_profile_adjudicator" ? differentiatedBands : frozenBands),
      audit: { role, model: "test-model" }
    };
  };

  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel });

  assert.deepEqual(calls.sort(), ["A", "B", "criterion_profile_adjudicator", "feedback_repair"].sort());
  assert.equal(result.adjudication.triggered, false);
  assert.equal(result.adjudication.criterionProfileReview.triggered, true);
  assert.deepEqual(Object.values(result.criteria), [6, 6, 5.5, 6.5]);
  assert.equal(result.scoreCalculation.source, "ai-criterion-profile-adjudicator");
  assert.equal(result.feedbackStatus.repairSucceeded, true);
  assert.equal(result.feedbackStatus.scoreChanged, false);
});

test("interactive score mode returns frozen bands before detailed feedback generation", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const frozenBands = { [names[0]]: 6, [names[1]]: 6, [names[2]]: 5.5, [names[3]]: 6.5 };
  const calls = [];
  const stages = [];
  const callModel = async ({ role, examinerId }) => {
    calls.push(role === "examiner" ? examinerId : role);
    return { data: compactScoreReport(frozenBands), audit: { role, model: "test-model" } };
  };
  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    mode: "score",
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel, onStage: (stage) => stages.push(stage) });

  assert.deepEqual(calls.sort(), ["A", "B"].sort());
  assert.equal(result.scoreFrozen, true);
  assert.equal(result.feedbackStatus.status, "deferred_to_feedback_stage");
  assert.equal(result.scoreCoreMeta.feedbackRequiredExternal, true);
  assert.equal(result.needsHumanReview, false);
  assert.deepEqual(stages, ["examiners_started", "examiners_completed", "agreement_completed", "adjudication_skipped", "score_frozen"]);
});

test("an incomplete first feedback draft retries once without reopening frozen scoring", async () => {
  const names = ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const frozenBands = { [names[0]]: 6, [names[1]]: 6, [names[2]]: 5.5, [names[3]]: 6.5 };
  const inflatedBands = Object.fromEntries(names.map((name) => [name, 9]));
  let feedbackCalls = 0;
  const callModel = async ({ role }) => {
    if (role === "feedback_repair") {
      feedbackCalls += 1;
      return { data: feedbackCalls === 1 ? compactScoreReport(inflatedBands) : report(inflatedBands), audit: { role, model: "test-model" } };
    }
    return { data: compactScoreReport(frozenBands), audit: { role, model: "test-model" } };
  };

  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    questionPrompt: "Summarise the chart.",
    essay,
    visualFacts: { visualType: "line_chart", sourceVerified: true, keyFeatures: ["A rises"] }
  }, { callModel });

  assert.equal(feedbackCalls, 2);
  assert.deepEqual(Object.values(result.criteria), [6, 6, 5.5, 6.5]);
  assert.equal(result.overallBand, 6);
  assert.equal(result.feedbackStatus.repairSucceeded, true);
  assert.equal(result.modelAudit.feedbackRepairHistory.length, 2);
});

test("v6.5 retains task boundaries and removes the artificial Band-8 ceiling", () => {
  const taskConfig = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  const input = validateAndNormalizeInput({
    questionPrompt: "Discuss both views and give your opinion.",
    essay
  }, taskConfig);
  const [systemMessage] = buildExaminerMessages({ taskConfig, input, examinerId: "A" });
  const [feedbackMessage] = buildFeedbackRepairMessages({
    taskConfig,
    input,
    frozenReport: { criteria: Object.fromEntries(taskConfig.criteria.map((name) => [name, 7])) }
  });
  assert.match(PROMPT_VERSION, /v6-5-full-range-pro-upper-boundary/);
  assert.match(systemMessage.content, /Band 8 is not error-free writing/);
  assert.match(systemMessage.content, /Band 9 is exceptional but attainable/);
  assert.match(systemMessage.content, /"highestBandTested": 9\.0/);
  assert.doesNotMatch(systemMessage.content, /"highestBandTested": 8[,\s]/);
  assert.match(systemMessage.content, /Do not require originality, novelty, surprising insights/);
  assert.match(systemMessage.content, /every 0\.5 step as a real boundary decision/);
  assert.match(systemMessage.content, /criterionContrastAudit/);
  assert.match(systemMessage.content, /complete but weak essays/);
  assert.match(systemMessage.content, /Do not write Chinese/);
  assert.match(feedbackMessage.content, /自然、具体的中文教师诊断/);
});

test("process reports reject invented comparison and grammar-checklist ceilings", async () => {
  const taskConfig = resolveTaskConfig({ examModule: "academic", taskNumber: 1 });
  const processInput = validateAndNormalizeInput({
    questionPrompt: "Summarise the recycling process.",
    essay,
    visualFacts: { visualType: "process", sourceVerified: true, stages: ["collection", "sorting", "distribution"] }
  }, taskConfig);
  const [systemMessage] = buildExaminerMessages({ taskConfig, input: processInput, examinerId: "A" });
  assert.match(systemMessage.content, /does not require comparisons when the process contains no meaningful alternatives/);
  assert.match(systemMessage.content, /does not use conditionals\/inversion/);

  const seven = Object.fromEntries(taskConfig.criteria.map((name) => [name, 7]));
  const bad = compactScoreReport(seven);
  bad.criteria["Task Achievement"].ceilingAudit.band9BlockingPattern = "The response lacks comparisons.";
  bad.criteria["Grammatical Range and Accuracy"].ceilingAudit.band9BlockingPattern = "It lacks inversion and conditionals.";
  const normalized = normalizeExaminerReport(bad, taskConfig, essay, "bad-high", { visualType: "process" });
  assert.deepEqual(normalized.nonDescriptorUpperBandClaims.sort(), ["Grammatical Range and Accuracy", "Task Achievement"].sort());

  let highAttempts = 0;
  const nine = Object.fromEntries(taskConfig.criteria.map((name) => [name, 9]));
  const callModel = async ({ role }) => {
    if (role === "high_specialist") {
      highAttempts += 1;
      return { data: highAttempts === 1 ? bad : compactScoreReport(nine), audit: { role, model: "test-pro" } };
    }
    return { data: compactScoreReport(seven), audit: { role, model: "test-flash" } };
  };
  const result = await runUnifiedScoring({
    examModule: "academic",
    taskNumber: 1,
    mode: "score",
    questionPrompt: "Summarise the recycling process.",
    essay,
    visualFacts: { visualType: "process", sourceVerified: true, stages: ["collection", "sorting", "distribution"] }
  }, { callModel, threeZoneEnabled: true, conditionalReviewEnabled: true });
  assert.equal(highAttempts, 2);
  assert.equal(result.overallBand, 9);
  assert.equal(result.modelAudit.costOptimization.coreModelCalls, 4);
});

test("uniform score profiles give the AI adjudicator a criterion differentiation audit", () => {
  const taskConfig = resolveTaskConfig({ examModule: "academic", taskNumber: 2 });
  const input = validateAndNormalizeInput({ questionPrompt: "Discuss both views.", essay }, taskConfig);
  const uniform = { criteria: Object.fromEntries(taskConfig.criteria.map((name) => [name, 6])), overallBand: 6 };
  const [message] = buildAdjudicatorMessages({
    taskConfig,
    input,
    examinerA: uniform,
    examinerB: uniform,
    agreement: { reasons: ["BOTH_UNIFORM_CRITERIA_AUDIT"], adjudicationRequired: true }
  });
  assert.match(message.content, /UNIFORM-PROFILE DIFFERENTIATION AUDIT/);
  assert.match(message.content, /strongest and weakest criterion/);
});

test("imported Academic library contains 48 prompts per task and local Task 1 images", () => {
  const file = path.join(__dirname, "..", "academic-data.js");
  assert.equal(fs.existsSync(file), true);
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
  const prompts = context.window.IELTS_ACADEMIC_DATA.prompts;
  assert.equal(prompts.filter((item) => item.taskNumber === 1).length, 48);
  assert.equal(prompts.filter((item) => item.taskNumber === 2).length, 48);
  for (const prompt of prompts.filter((item) => item.taskNumber === 1)) {
    assert.ok(prompt.bigType);
    assert.equal(fs.existsSync(path.join(__dirname, "..", prompt.image)), true);
  }
});
