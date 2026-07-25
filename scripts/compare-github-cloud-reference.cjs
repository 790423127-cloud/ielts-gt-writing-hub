"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CORPUS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "full-range-3-to-7-gold-corpus-v1.json"), "utf8"));
const OLD_URL = process.env.GITHUB_REFERENCE_SCORE_URL || "http://localhost:4000/api/grade-ielts-production-router";
const NEW_URL = process.env.UNIFIED_SCORE_URL || "http://127.0.0.1:4000/api/grade-writing";
const DEFAULT_IDS = [
  "T1-B3-5-short-confused",
  "T1-B5-functional-simple",
  "T2-B6-clear-development",
  "T1-B7-natural-letter"
];
const NEW_ONLY = process.argv.includes("--new-only");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function bandOf(result = {}) {
  const value = result.overallBand ?? result.finalBand ?? result.scoreCalculation?.finalBand;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function criteriaOf(result = {}) {
  return result.finalCriteria || result.criteria || result.criterionScores || {};
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`${url} returned non-JSON: ${text.slice(0, 300)}`); }
    if (!response.ok || data.ok === false) throw new Error(`${url} failed: ${data.detail || data.error || `HTTP ${response.status}`}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function requestFor(item) {
  const taskNumber = item.task === "Task 1" ? 1 : 2;
  return {
    examModule: "general_training",
    taskNumber,
    task: item.task,
    taskKind: taskNumber === 1 ? "gt_letter" : "essay",
    mode: "score",
    questionPrompt: item.prompt,
    essay: item.response
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function main() {
  const requested = argValue("ids", DEFAULT_IDS.join(",")).split(",").map((value) => value.trim()).filter(Boolean);
  const items = requested.map((id) => CORPUS.items.find((item) => item.id === id));
  if (items.some((item) => !item)) throw new Error("One or more requested GitHub-reference corpus IDs do not exist.");
  const rows = [];
  for (const item of items) {
    const body = requestFor(item);
    const oldStarted = Date.now();
    const oldResult = NEW_ONLY ? null : await postJson(OLD_URL, body);
    const oldDurationMs = NEW_ONLY ? null : Date.now() - oldStarted;
    const newStarted = Date.now();
    const newResult = await postJson(NEW_URL, body);
    const newDurationMs = Date.now() - newStarted;
    const oldBand = oldResult ? bandOf(oldResult) : null;
    const newBand = bandOf(newResult);
    const row = {
      id: item.id,
      task: item.task,
      targetOverall: item.targetOverall,
      oldBand,
      newBand,
      oldError: oldBand === null ? null : Math.abs(oldBand - item.targetOverall),
      newError: Math.abs(newBand - item.targetOverall),
      oldCriteria: oldResult ? criteriaOf(oldResult) : null,
      newCriteria: criteriaOf(newResult),
      oldVersion: oldResult ? (oldResult.routerVersion || oldResult.scoreSystemVersion || oldResult.system) : null,
      newVersion: newResult.scoreSystemVersion,
      oldSource: oldResult ? (oldResult.finalSource || oldResult.routerAudit?.selectedSystem || oldResult.scoreCalculation?.source) : null,
      newSource: newResult.scoreCalculation?.source,
      newReviewReasons: newResult.examinerAgreement?.reasons || [],
      newCoreCalls: newResult.modelAudit?.costOptimization?.coreModelCalls,
      newCoreTokens: newResult.modelAudit?.costOptimization?.coreTotalTokens,
      oldDurationMs,
      newDurationMs
    };
    rows.push(row);
    console.log(`${row.id}: target ${row.targetOverall}, GitHub ${row.oldBand ?? "skipped"}, v6.3 ${row.newBand}, review=${row.newReviewReasons.join("|") || "none"}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: "Read-only comparison against the unchanged local checkout of origin/main's production router. No GitHub files, commits or branches were changed.",
    oldUrl: OLD_URL,
    newUrl: NEW_URL,
    records: rows.length,
    oldMAE: NEW_ONLY ? null : mean(rows.map((row) => row.oldError)),
    newMAE: mean(rows.map((row) => row.newError)),
    newAverageCoreCalls: mean(rows.map((row) => Number(row.newCoreCalls || 0))),
    newAverageCoreTokens: mean(rows.map((row) => Number(row.newCoreTokens || 0))),
    rows
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = path.join(ROOT, "evaluation", "reports", `github-cloud-reference-v63-${stamp}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ oldMAE: report.oldMAE, newMAE: report.newMAE, newAverageCoreCalls: report.newAverageCoreCalls, newAverageCoreTokens: report.newAverageCoreTokens, report: output }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
