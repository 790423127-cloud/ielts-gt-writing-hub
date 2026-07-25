"use strict";

const fs = require("node:fs");
const path = require("node:path");
const corpus = require("./gold-writing-corpus-v1.cjs");
const { resolveTaskConfig } = require("../api/_scoring/tasks");
const { validateAndNormalizeInput } = require("../api/_scoring/input");
const { buildFeedbackRepairMessages } = require("../api/_scoring/rubric");
const { callDeepSeekJson } = require("../api/_scoring/provider");
const { normalizeExaminerReport } = require("../api/_scoring/normalize");

function argValue(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : "";
}

function feedbackAudit(sample, result) {
  const criteria = Object.keys(sample.targetCriteria);
  const details = result.criteriaDetails || {};
  const perCriterion = Object.fromEntries(criteria.map((name) => {
    const detail = details[name] || {};
    const exactEvidence = (Array.isArray(detail.essayEvidence) ? detail.essayEvidence : []).filter((item) => (
      item?.quote && sample.essay.includes(item.quote) && item.explanation && item.explanationZh
    ));
    const revision = detail.nextRevision || {};
    return [name, {
      diagnosis: Boolean(detail.diagnosis && detail.diagnosisZh),
      naturalBoundary: Boolean(detail.bandBoundary?.fit && detail.bandBoundary?.nextBandGap && detail.bandBoundary?.nextBandGapZh),
      exactEvidenceCount: exactEvidence.length,
      actionableRevision: Boolean(
        (revision.priority || revision.action) &&
        (revision.priorityZh || revision.actionZh) &&
        revision.revisedExample &&
        revision.whyItWorks &&
        revision.whyItWorksZh
      )
    }];
  }));
  return {
    complete: Object.values(perCriterion).every((item) => (
      item.diagnosis && item.naturalBoundary && item.exactEvidenceCount >= 2 && item.actionableRevision
    )),
    criteria: perCriterion
  };
}

function buildRequest(sample) {
  return {
    examModule: sample.examModule,
    taskNumber: sample.taskNumber,
    taskKind: sample.taskKind,
    questionPrompt: sample.prompt,
    questionType: sample.questionType,
    letterStyle: sample.letterStyle,
    essay: sample.essay,
    visualFacts: sample.visualFacts
  };
}

async function repairRecord(record, sample) {
  const taskConfig = resolveTaskConfig(buildRequest(sample));
  const input = validateAndNormalizeInput(buildRequest(sample), taskConfig);
  const frozenCriteria = { ...record.result.criteria };
  let repairContext = {
    criteria: frozenCriteria,
    criterionDetails: record.result.criteriaDetails,
    overallAssessment: record.result.overallAssessment,
    overallAssessmentZh: record.result.overallAssessmentZh
  };
  const audits = [];
  let repaired = null;
  for (let feedbackAttempt = 1; feedbackAttempt <= 2; feedbackAttempt += 1) {
    const call = await callDeepSeekJson({
      role: "feedback_repair",
      messages: buildFeedbackRepairMessages({ taskConfig, input, frozenReport: repairContext })
    });
    audits.push({ ...(call.audit || {}), feedbackAttempt });
    const raw = JSON.parse(JSON.stringify(call.data || call));
    raw.criteria = raw.criteria && typeof raw.criteria === "object" ? raw.criteria : {};
    for (const name of taskConfig.criteria) {
      raw.criteria[name] = { ...(raw.criteria[name] || {}), band: frozenCriteria[name] };
    }
    repaired = normalizeExaminerReport(raw, taskConfig, input.essay, `feedback-repair-${feedbackAttempt}`);
    if (repaired.feedbackComplete) break;
    repairContext = { ...repairContext, criterionDetails: repaired.criterionDetails };
  }
  if (!repaired?.feedbackComplete) return { complete: false, audits };

  record.result.criteria = frozenCriteria;
  record.result.finalCriteria = frozenCriteria;
  record.result.criteriaDetails = repaired.criterionDetails;
  record.result.criterionCalibration = repaired.criterionDetails;
  record.result.overallAssessment = repaired.overallAssessment || record.result.overallAssessment;
  record.result.overallAssessmentZh = repaired.overallAssessmentZh || record.result.overallAssessmentZh;
  record.result.revisionSequence = repaired.revisionSequence;
  record.result.revisionSequenceZh = repaired.revisionSequenceZh;
  record.result.feedbackStatus = {
    status: "embedded_complete",
    scoreChanged: false,
    repairAttempted: true,
    repairSucceeded: true,
    note: "Feedback-only repair completed after score freeze."
  };
  record.result.scoreCoreMeta = { feedbackRequiredExternal: false, feedbackGenerated: true, feedbackStatus: "embedded_complete" };
  record.result.modelAudit = record.result.modelAudit || {};
  const prior = Array.isArray(record.result.modelAudit.feedbackRepairHistory)
    ? record.result.modelAudit.feedbackRepairHistory
    : (record.result.modelAudit.feedbackRepair ? [record.result.modelAudit.feedbackRepair] : []);
  record.result.modelAudit.feedbackRepairHistory = [...prior, ...audits];
  record.result.modelAudit.feedbackRepair = audits[audits.length - 1] || null;
  record.result.humanReviewReasons = (record.result.humanReviewReasons || []).filter((reason) => reason !== "FINAL_FEEDBACK_INCOMPLETE");
  record.result.needsHumanReview = record.result.humanReviewReasons.length > 0;
  record.feedbackAudit = feedbackAudit(sample, record.result);
  return { complete: record.feedbackAudit.complete, audits };
}

async function main() {
  const source = argValue("report");
  if (!source) throw new Error("Use --report=<validation-report.json>.");
  const sourcePath = path.resolve(source);
  const report = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const sampleMap = new Map(corpus.samples.map((sample) => [sample.id, sample]));
  const repairedSampleIds = [];
  const repairAudits = {};
  for (const record of report.records || []) {
    if (record.feedbackAudit?.complete) continue;
    const sample = sampleMap.get(record.sampleId);
    if (!sample) throw new Error(`Missing corpus sample ${record.sampleId}.`);
    const outcome = await repairRecord(record, sample);
    repairAudits[record.sampleId] = outcome.audits;
    if (outcome.complete) repairedSampleIds.push(record.sampleId);
  }

  const records = report.records || [];
  report.generatedAt = new Date().toISOString();
  report.feedbackRepairRun = {
    parentReport: sourcePath,
    scoreFieldsChanged: false,
    repairedSampleIds,
    repairAudits
  };
  report.metrics.feedbackCompletenessRate = records.length
    ? Number((records.filter((record) => record.feedbackAudit?.complete).length / records.length).toFixed(4))
    : 0;
  report.gates.feedbackCompleteness = report.metrics.feedbackCompletenessRate === 1;
  report.passed = Object.values(report.gates).every(Boolean);

  const outputPath = path.join(
    path.dirname(sourcePath),
    `live-validation-${new Date().toISOString().replace(/[:.]/g, "-")}-feedback-repaired.json`
  );
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    passed: report.passed,
    scoreFieldsChanged: false,
    repairedSampleIds,
    feedbackCompletenessRate: report.metrics.feedbackCompletenessRate,
    gates: report.gates,
    report: outputPath
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${error.code || "FEEDBACK_REPAIR_ERROR"}: ${error.message}`);
  process.exitCode = 1;
});
