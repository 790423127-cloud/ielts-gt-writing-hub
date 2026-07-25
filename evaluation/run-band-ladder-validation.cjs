"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runUnifiedScoring } = require("../api/_scoring/engine");
const { countWords } = require("../api/_scoring/input");

const ROOT = path.join(__dirname, "..");
const CORPUS_PATH = path.join(__dirname, "band-ladder-corpus-v1.json");
const REFERENCE_PATH = path.join(__dirname, "band-ladder-reference-labels-v1.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env.example"));

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function round(value, places = 3) {
  return Number(Number(value || 0).toFixed(places));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function roundHalf(value) {
  return Math.max(0, Math.min(9, Math.round(Number(value) * 2) / 2));
}

function taskKey(sample) {
  return `${sample.examModule}:${sample.taskNumber}`;
}

function bandKey(value) {
  return Number(value).toFixed(1);
}

function zoneForBand(value) {
  if (value <= 3.5) return "low_0_3_5";
  if (value <= 6.5) return "mid_4_6_5";
  return "high_7_9";
}

function buildRequest(sample) {
  return {
    examModule: sample.examModule,
    taskNumber: sample.taskNumber,
    taskKind: sample.taskKind,
    questionPrompt: sample.prompt,
    questionType: sample.questionType,
    letterStyle: sample.letterStyle,
    visualFacts: sample.visualFacts,
    essay: sample.essay,
    mode: "score"
  };
}

function staticCorpusAudit(corpus) {
  const failures = [];
  const ids = new Set();
  const coverage = new Set();
  const countsByBand = {};
  let calibration = 0;
  let holdout = 0;
  const wordCountsByBand = {};
  for (const sample of corpus.samples || []) {
    if (!sample.id || ids.has(sample.id)) failures.push(`${sample.id || "<missing>"}: duplicate or missing id`);
    ids.add(sample.id);
    coverage.add(taskKey(sample));
    const key = bandKey(sample.targetOverall);
    countsByBand[key] = (countsByBand[key] || 0) + 1;
    if (sample.split === "calibration") calibration += 1;
    else if (sample.split === "holdout") holdout += 1;
    else failures.push(`${sample.id}: invalid split ${sample.split}`);
    const criteria = Object.values(sample.targetCriteria || {}).map(Number);
    if (criteria.length !== 4 || criteria.some((value) => !Number.isFinite(value))) failures.push(`${sample.id}: invalid target criteria`);
    else if (roundHalf(mean(criteria)) !== Number(sample.targetOverall)) failures.push(`${sample.id}: target criteria do not average to target overall`);
    if (!sample.prompt) failures.push(`${sample.id}: missing prompt`);
    if (Number(sample.targetOverall) > 0 && !String(sample.essay || "").trim()) failures.push(`${sample.id}: non-zero target has empty response`);
    if (Number(sample.targetOverall) >= 6 && countWords(sample.essay) < (sample.taskNumber === 1 ? 150 : 250)) failures.push(`${sample.id}: Band 6+ design response is under the task minimum`);
    if (/target\s*band|criterion\s*profile|benchmark\s*response|deliberate\s*error/i.test(String(sample.essay || ""))) failures.push(`${sample.id}: possible target-label leakage in essay`);
    (wordCountsByBand[key] ||= []).push(countWords(sample.essay));
  }
  for (let index = 0; index <= 18; index += 1) {
    const key = (index / 2).toFixed(1);
    if (countsByBand[key] !== 5) failures.push(`Band ${key}: expected 5 samples, found ${countsByBand[key] || 0}`);
  }
  for (const required of ["academic:1", "academic:2", "general_training:1", "general_training:2"]) {
    if (!coverage.has(required)) failures.push(`missing task coverage: ${required}`);
  }
  if ((corpus.samples || []).length !== 95) failures.push(`expected 95 samples, found ${(corpus.samples || []).length}`);
  if (calibration !== 76 || holdout !== 19) failures.push(`expected split 76/19, found ${calibration}/${holdout}`);
  return {
    ok: failures.length === 0,
    failures,
    sampleCount: (corpus.samples || []).length,
    split: { calibration, holdout },
    coverage: [...coverage].sort(),
    countsByBand,
    wordCountsByBand: Object.fromEntries(Object.entries(wordCountsByBand).map(([key, values]) => [key, { min: Math.min(...values), max: Math.max(...values), mean: round(mean(values), 1) }]))
  };
}

function metricSet(records, options = {}) {
  const overallKey = options.overallKey || "overallError";
  const criteriaKey = options.criteriaKey || "criterionErrors";
  const overallErrors = records.map((record) => record[overallKey]);
  const criterionErrors = records.flatMap((record) => Object.values(record[criteriaKey] || {}));
  return {
    records: records.length,
    overallMAE: round(mean(overallErrors)),
    criterionMAE: round(mean(criterionErrors)),
    withinHalfBandRate: round(mean(records.map((record) => record[overallKey] <= 0.5 ? 1 : 0)), 4),
    exactRate: round(mean(records.map((record) => record[overallKey] === 0 ? 1 : 0)), 4),
    catastrophicErrorRate: round(mean(records.map((record) => record[overallKey] > 1 ? 1 : 0)), 4),
    meanDurationMs: round(mean(records.map((record) => record.durationMs))),
    adjudicationRate: round(mean(records.map((record) => record.adjudicationTriggered ? 1 : 0)), 4),
    uniformFinalCriteriaRate: round(mean(records.map((record) => record.uniformFinalCriteria ? 1 : 0)), 4)
  };
}

function groupedMetrics(records, keyFn) {
  const grouped = {};
  for (const record of records) (grouped[keyFn(record)] ||= []).push(record);
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([key, rows]) => {
    const metrics = metricSet(rows);
    return [key, {
      ...metrics,
      targetMean: round(mean(rows.map((row) => row.targetOverall))),
      predictedMean: round(mean(rows.map((row) => row.predictedOverall))),
      predictions: rows.map((row) => row.predictedOverall)
    }];
  }));
}

function adjacentBandAudit(byBand) {
  const rows = Object.entries(byBand).map(([band, metrics]) => ({ band: Number(band), predictedMean: metrics.predictedMean }));
  const violations = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (current.predictedMean < previous.predictedMean) violations.push({ previous, current, drop: round(previous.predictedMean - current.predictedMean) });
  }
  return { comparisons: Math.max(0, rows.length - 1), violations, violationRate: round(violations.length / Math.max(1, rows.length - 1), 4) };
}

function writeMarkdown(report, filePath) {
  const lines = [
    "# Band ladder validation",
    "",
    `Generated: ${report.generatedAt}`,
    `Corpus: ${report.corpusVersion}`,
    `Primary target: ${report.targetSource}`,
    `Records: ${report.metrics.all.records}`,
    "",
    "## Metrics",
    "",
    "| Split | Overall MAE | Criterion MAE | Within 0.5 | Exact | Catastrophic |",
    "|---|---:|---:|---:|---:|---:|",
    `| All | ${report.metrics.all.overallMAE} | ${report.metrics.all.criterionMAE} | ${report.metrics.all.withinHalfBandRate} | ${report.metrics.all.exactRate} | ${report.metrics.all.catastrophicErrorRate} |`,
    `| Calibration | ${report.metrics.calibration.overallMAE} | ${report.metrics.calibration.criterionMAE} | ${report.metrics.calibration.withinHalfBandRate} | ${report.metrics.calibration.exactRate} | ${report.metrics.calibration.catastrophicErrorRate} |`,
    `| Holdout | ${report.metrics.holdout.overallMAE} | ${report.metrics.holdout.criterionMAE} | ${report.metrics.holdout.withinHalfBandRate} | ${report.metrics.holdout.exactRate} | ${report.metrics.holdout.catastrophicErrorRate} |`,
    "",
    `Author-design comparison (diagnostic only): Overall MAE ${report.designMetrics.all.overallMAE}, within 0.5 ${report.designMetrics.all.withinHalfBandRate}.`,
    "",
    "## By target band",
    "",
    "| Target | Predicted mean | MAE | Within 0.5 | Predictions |",
    "|---:|---:|---:|---:|---|",
    ...Object.entries(report.byBand).map(([band, item]) => `| ${band} | ${item.predictedMean} | ${item.overallMAE} | ${item.withinHalfBandRate} | ${item.predictions.join(", ")} |`),
    "",
    `Adjacent monotonicity violations: ${report.monotonicity.violations.length}/${report.monotonicity.comparisons}`,
    "",
    "## Gates",
    "",
    ...Object.entries(report.gates).map(([key, value]) => `- ${value ? "PASS" : "FAIL"}: ${key}`),
    "",
    "## Runtime errors",
    "",
    ...(report.runtimeErrors.length ? report.runtimeErrors.map((item) => `- ${item.sampleId}: ${item.code} ${item.message}`) : ["None"])
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  if (!fs.existsSync(CORPUS_PATH)) throw new Error("Band ladder corpus is missing. Run build-band-ladder-corpus.cjs first.");
  if (!fs.existsSync(REFERENCE_PATH)) throw new Error("Blind reference labels are missing. Run build-reference-labels.cjs first.");
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
  const reference = JSON.parse(fs.readFileSync(REFERENCE_PATH, "utf8"));
  const staticAudit = staticCorpusAudit(corpus);
  const referenceFailures = [];
  for (const sample of corpus.samples || []) {
    const label = reference.labels?.[sample.id];
    const criteria = Object.values(label?.criteria || {}).map(Number);
    if (!label || criteria.length !== 4 || criteria.some((value) => !Number.isFinite(value))) referenceFailures.push(`${sample.id}: missing or invalid blind reference label`);
    else if (roundHalf(mean(criteria)) !== Number(label.overallBand)) referenceFailures.push(`${sample.id}: blind reference criteria do not average to its Overall`);
  }
  if (Object.keys(reference.labels || {}).length !== (corpus.samples || []).length) referenceFailures.push("blind reference label count does not match corpus count");
  const referenceAudit = { ok: referenceFailures.length === 0, failures: referenceFailures, version: reference.version, model: reference.model, labelCount: Object.keys(reference.labels || {}).length };
  if (process.argv.includes("--static-only")) {
    console.log(JSON.stringify({ corpus: staticAudit, reference: referenceAudit }, null, 2));
    if (!staticAudit.ok || !referenceAudit.ok) process.exitCode = 1;
    return;
  }
  if (!staticAudit.ok) throw new Error(`Corpus audit failed: ${staticAudit.failures.join("; ")}`);
  if (!referenceAudit.ok) throw new Error(`Reference audit failed: ${referenceAudit.failures.join("; ")}`);
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for live validation.");
  const splitFilter = argValue("split", "all");
  const bandFilter = new Set(argValue("bands").split(",").map((item) => item.trim()).filter(Boolean).map(Number).filter(Number.isFinite));
  const idFilter = new Set(argValue("ids").split(",").map((item) => item.trim()).filter(Boolean));
  const concurrency = Math.max(1, Math.min(6, Number(argValue("concurrency", "4")) || 4));
  const runs = Math.max(1, Math.min(3, Number(argValue("runs", "1")) || 1));
  const selected = corpus.samples.filter((sample) => (
    (splitFilter === "all" || sample.split === splitFilter) &&
    (!bandFilter.size || bandFilter.has(Number(sample.targetOverall))) &&
    (!idFilter.size || idFilter.has(sample.id))
  ));
  const jobs = selected.flatMap((sample) => Array.from({ length: runs }, (_, index) => ({ sample, run: index + 1 })));
  const records = [];
  const runtimeErrors = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { sample, run } = jobs[next++];
      const startedAt = Date.now();
      try {
        const result = await runUnifiedScoring(buildRequest(sample));
        const blindTarget = reference.labels[sample.id];
        const criterionErrors = Object.fromEntries(Object.entries(blindTarget.criteria).map(([name, target]) => [name, round(Math.abs(Number(result.criteria[name]) - Number(target)))]));
        const designCriterionErrors = Object.fromEntries(Object.entries(sample.targetCriteria).map(([name, target]) => [name, round(Math.abs(Number(result.criteria[name]) - Number(target)))]));
        const values = Object.values(result.criteria || {}).map(Number);
        const record = {
          sampleId: sample.id,
          split: sample.split,
          taskKey: taskKey(sample),
          targetSource: "blind-independent-pro-reference",
          targetOverall: Number(blindTarget.overallBand),
          designTargetOverall: Number(sample.targetOverall),
          predictedOverall: Number(result.overallBand),
          overallError: round(Math.abs(Number(result.overallBand) - Number(blindTarget.overallBand))),
          designOverallError: round(Math.abs(Number(result.overallBand) - Number(sample.targetOverall))),
          targetCriteria: blindTarget.criteria,
          designTargetCriteria: sample.targetCriteria,
          predictedCriteria: result.criteria,
          criterionErrors,
          designCriterionErrors,
          zone: zoneForBand(blindTarget.overallBand),
          wordCount: countWords(sample.essay),
          confidence: result.confidenceScore,
          adjudicationTriggered: result.adjudication?.triggered === true,
          adjudicationReasons: result.adjudication?.reasons || [],
          uniformFinalCriteria: new Set(values).size === 1,
          needsHumanReview: result.needsHumanReview,
          durationMs: Date.now() - startedAt,
          run,
          result
        };
        records.push(record);
        console.log(`${sample.id}: reference ${record.targetOverall}, design ${record.designTargetOverall}, predicted ${record.predictedOverall}, error ${record.overallError}, ${record.durationMs}ms`);
      } catch (error) {
        const failure = { sampleId: sample.id, split: sample.split, taskKey: taskKey(sample), targetOverall: sample.targetOverall, run, code: error.code || error.name || "ERROR", message: error.message || String(error), durationMs: Date.now() - startedAt };
        runtimeErrors.push(failure);
        console.error(`${sample.id}: ${failure.code}: ${failure.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, () => worker()));
  records.sort((a, b) => a.targetOverall - b.targetOverall || a.sampleId.localeCompare(b.sampleId) || a.run - b.run);
  const calibration = records.filter((record) => record.split === "calibration");
  const holdout = records.filter((record) => record.split === "holdout");
  const byBand = groupedMetrics(records, (record) => bandKey(record.targetOverall));
  const byDesignBand = groupedMetrics(records, (record) => bandKey(record.designTargetOverall));
  const byTask = groupedMetrics(records, (record) => record.taskKey);
  const byZone = groupedMetrics(records, (record) => record.zone);
  const metrics = { all: metricSet(records), calibration: metricSet(calibration), holdout: metricSet(holdout) };
  const designMetrics = {
    all: metricSet(records, { overallKey: "designOverallError", criteriaKey: "designCriterionErrors" }),
    calibration: metricSet(calibration, { overallKey: "designOverallError", criteriaKey: "designCriterionErrors" }),
    holdout: metricSet(holdout, { overallKey: "designOverallError", criteriaKey: "designCriterionErrors" })
  };
  const monotonicity = adjacentBandAudit(byBand);
  const zeroOneRecords = records.filter((record) => record.targetOverall <= 1);
  const zeroOneAccuracy = round(mean(zeroOneRecords.map((record) => record.overallError <= 0.5 ? 1 : 0)), 4);
  const expectedRecords = jobs.length;
  const gates = {
    corpusStaticAudit: staticAudit.ok,
    blindReferenceAudit: referenceAudit.ok,
    expectedRecordCount: records.length === expectedRecords,
    noRuntimeErrors: runtimeErrors.length === 0,
    overallMAE: metrics.all.overallMAE <= corpus.acceptance.overallMeanAbsoluteErrorMax,
    criterionMAE: metrics.all.criterionMAE <= corpus.acceptance.criterionMeanAbsoluteErrorMax,
    withinHalfBandRate: metrics.all.withinHalfBandRate >= corpus.acceptance.withinHalfBandRateMin,
    catastrophicErrorRate: metrics.all.catastrophicErrorRate <= corpus.acceptance.catastrophicErrorRateMax,
    lowBandZeroOneAccuracy: zeroOneAccuracy >= corpus.acceptance.lowBandZeroOneAccuracyMin,
    holdoutOverallMAE: metrics.holdout.records === 0 || metrics.holdout.overallMAE <= corpus.acceptance.holdoutOverallMeanAbsoluteErrorMax,
    adjacentMonotonicity: monotonicity.violationRate <= 0.1
  };
  const report = {
    generatedAt: new Date().toISOString(),
    corpusVersion: corpus.version,
    targetSource: "blind-independent-pro-reference",
    referenceMeta: { version: reference.version, model: reference.model, methodology: reference.methodology },
    filters: { split: splitFilter, bands: [...bandFilter], ids: [...idFilter], runs, concurrency },
    staticAudit,
    referenceAudit,
    acceptance: corpus.acceptance,
    metrics,
    designMetrics,
    zeroOneAccuracy,
    byBand,
    byDesignBand,
    byTask,
    byZone,
    monotonicity,
    gates,
    passed: Object.values(gates).every(Boolean),
    runtimeErrors,
    records
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `band-ladder-${stamp}.json`);
  const mdPath = path.join(reportsDir, `band-ladder-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeMarkdown(report, mdPath);
  console.log(JSON.stringify({ passed: report.passed, targetSource: report.targetSource, metrics, designMetrics, zeroOneAccuracy, monotonicity, gates, report: jsonPath, markdown: mdPath }, null, 2));
  if (runtimeErrors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
