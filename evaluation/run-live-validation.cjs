"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runUnifiedScoring } = require("../api/_scoring/engine");
const { countWords } = require("../api/_scoring/input");
const corpus = require("./gold-writing-corpus-v1.cjs");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));
loadEnvFile(path.join(__dirname, "..", ".env.example"));

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, places = 3) {
  return Number(Number(value).toFixed(places));
}

function resultFeedbackAudit(sample, result) {
  const details = result.criteriaDetails || {};
  const criteria = Object.keys(sample.targetCriteria);
  const criterionAudit = Object.fromEntries(criteria.map((name) => {
    const detail = details[name] || {};
    const evidence = Array.isArray(detail.essayEvidence) ? detail.essayEvidence : [];
    const exactEvidence = evidence.filter((item) => (
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
    complete: Object.values(criterionAudit).every((item) => (
      item.diagnosis && item.naturalBoundary && item.exactEvidenceCount >= 2 && item.actionableRevision
    )),
    criteria: criterionAudit
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

function staticCorpusAudit(samples) {
  const seen = new Set();
  const expectedCoverage = new Set(corpus.acceptance.requiredTaskCoverage);
  const coverage = new Set();
  const failures = [];
  for (const sample of samples) {
    if (seen.has(sample.id)) failures.push(`${sample.id}: duplicate id`);
    seen.add(sample.id);
    coverage.add(`${sample.examModule}:${sample.taskNumber}`);
    const minimum = sample.taskNumber === 1 ? 150 : 250;
    const words = countWords(sample.essay);
    if (words < minimum) failures.push(`${sample.id}: ${words} words, expected at least ${minimum}`);
    if (Object.keys(sample.targetCriteria || {}).length !== 4) failures.push(`${sample.id}: expected four target criteria`);
  }
  for (const required of expectedCoverage) {
    if (!coverage.has(required)) failures.push(`missing task coverage: ${required}`);
  }
  return { ok: failures.length === 0, failures, sampleCount: samples.length, coverage: [...coverage].sort() };
}

async function main() {
  const runs = Math.max(1, Math.min(5, Number(argValue("runs", "1")) || 1));
  const concurrency = Math.max(1, Math.min(4, Number(argValue("concurrency", "2")) || 2));
  const idFilter = new Set(argValue("ids").split(",").map((item) => item.trim()).filter(Boolean));
  const samples = idFilter.size ? corpus.samples.filter((sample) => idFilter.has(sample.id)) : corpus.samples;
  const staticAudit = staticCorpusAudit(corpus.samples);
  if (!staticAudit.ok) throw new Error(`Corpus validation failed: ${staticAudit.failures.join("; ")}`);
  if (process.argv.includes("--static-only")) {
    console.log(JSON.stringify(staticAudit, null, 2));
    return;
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    const error = new Error("DEEPSEEK_API_KEY is required for live validation. Put it in .env.local or the process environment.");
    error.code = "MISSING_API_KEY";
    throw error;
  }

  const records = [];
  const runtimeErrors = [];
  const jobs = samples.flatMap((sample) => Array.from({ length: runs }, (_, index) => ({ sample, run: index + 1 })));
  let nextJobIndex = 0;
  let fatalProviderError = null;
  async function worker() {
    while (nextJobIndex < jobs.length && !fatalProviderError) {
      const job = jobs[nextJobIndex];
      nextJobIndex += 1;
      const { sample, run } = job;
      const startedAt = Date.now();
      let result;
      try {
        result = await runUnifiedScoring(buildRequest(sample));
      } catch (error) {
        const runtimeError = {
          sampleId: sample.id,
          taskKey: `${sample.examModule}:${sample.taskNumber}`,
          run,
          code: error.code || "SCORING_ERROR",
          message: error.message,
          durationMs: Date.now() - startedAt
        };
        runtimeErrors.push(runtimeError);
        console.error(`${sample.id} run ${run}/${runs}: ${runtimeError.code}: ${runtimeError.message}`);
        if (/HTTP\s+(401|402|403)\b/i.test(runtimeError.message)) fatalProviderError = runtimeError;
        continue;
      }
      const criterionErrors = Object.fromEntries(Object.entries(sample.targetCriteria).map(([name, target]) => [
        name,
        round(Math.abs(Number(result.criteria[name]) - target))
      ]));
      const overallError = round(Math.abs(result.overallBand - sample.targetOverall));
      const feedbackAudit = resultFeedbackAudit(sample, result);
      const record = {
        sampleId: sample.id,
        taskKey: `${sample.examModule}:${sample.taskNumber}`,
        run,
        targetOverall: sample.targetOverall,
        predictedOverall: result.overallBand,
        overallError,
        targetCriteria: sample.targetCriteria,
        predictedCriteria: result.criteria,
        criterionErrors,
        withinHalfBand: overallError <= 0.5,
        catastrophicError: overallError > 1,
        feedbackAudit,
        adjudicationTriggered: result.adjudication?.triggered === true,
        humanReview: result.needsHumanReview,
        humanReviewReasons: result.humanReviewReasons,
        confidence: result.confidenceScore,
        durationMs: Date.now() - startedAt,
        result
      };
      records.push(record);
      console.log(`${sample.id} run ${run}/${runs}: target ${sample.targetOverall}, predicted ${result.overallBand}, error ${overallError}, feedback ${feedbackAudit.complete ? "PASS" : "FAIL"}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  records.sort((a, b) => a.sampleId.localeCompare(b.sampleId) || a.run - b.run);

  const overallErrors = records.map((record) => record.overallError);
  const allCriterionErrors = records.flatMap((record) => Object.values(record.criterionErrors));
  const byTask = Object.fromEntries(corpus.acceptance.requiredTaskCoverage.map((taskKey) => {
    const taskRecords = records.filter((record) => record.taskKey === taskKey);
    return [taskKey, {
      records: taskRecords.length,
      overallMAE: round(mean(taskRecords.map((record) => record.overallError))),
      withinHalfBandRate: round(mean(taskRecords.map((record) => record.withinHalfBand ? 1 : 0)))
    }];
  }));
  const stabilityBySample = Object.fromEntries(samples.map((sample) => {
    const scores = records.filter((record) => record.sampleId === sample.id).map((record) => record.predictedOverall);
    return [sample.id, {
      scores,
      spread: scores.length ? round(Math.max(...scores) - Math.min(...scores)) : null
    }];
  }));
  const metrics = {
    records: records.length,
    overallMAE: round(mean(overallErrors)),
    criterionMAE: round(mean(allCriterionErrors)),
    withinHalfBandRate: round(mean(records.map((record) => record.withinHalfBand ? 1 : 0)), 4),
    catastrophicErrorRate: round(mean(records.map((record) => record.catastrophicError ? 1 : 0)), 4),
    feedbackCompletenessRate: round(mean(records.map((record) => record.feedbackAudit.complete ? 1 : 0)), 4),
    maxRepeatSpread: round(Math.max(0, ...Object.values(stabilityBySample).map((item) => item.spread || 0))),
    byTask,
    stabilityBySample
  };
  const gates = {
    overallMAE: metrics.overallMAE <= corpus.acceptance.overallMeanAbsoluteErrorMax,
    criterionMAE: metrics.criterionMAE <= corpus.acceptance.criterionMeanAbsoluteErrorMax,
    withinHalfBandRate: metrics.withinHalfBandRate >= corpus.acceptance.withinHalfBandRateMin,
    catastrophicErrorRate: metrics.catastrophicErrorRate <= corpus.acceptance.catastrophicErrorRateMax,
    feedbackCompleteness: metrics.feedbackCompletenessRate === 1,
    repeatStability: runs === 1 || metrics.maxRepeatSpread <= 0.5,
    taskCoverage: Object.values(byTask).every((task) => task.records > 0),
    expectedRecordCount: records.length === jobs.length,
    noRuntimeErrors: runtimeErrors.length === 0
  };
  const passed = Object.values(gates).every(Boolean);
  const report = {
    generatedAt: new Date().toISOString(),
    corpusVersion: corpus.version,
    rubricVersion: records[0]?.result?.rubricVersion || "",
    promptVersion: records[0]?.result?.promptVersion || "",
    scoreSystemVersion: records[0]?.result?.scoreSystemVersion || "",
    runsPerSample: runs,
    concurrency,
    expectedRecords: jobs.length,
    completedRecords: records.length,
    incomplete: records.length !== jobs.length || runtimeErrors.length > 0,
    staticAudit,
    acceptance: corpus.acceptance,
    metrics,
    gates,
    passed,
    runtimeErrors,
    records
  };
  const outputDir = path.join(__dirname, "reports");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `live-validation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed, metrics, gates, report: outputPath }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${error.code || "VALIDATION_ERROR"}: ${error.message}`);
  process.exitCode = error.code === "MISSING_API_KEY" ? 2 : 1;
});
