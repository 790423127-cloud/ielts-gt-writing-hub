const BASE_URL = (process.env.SMOKE_BASE_URL || "https://ielts-gt-writing-hub.vercel.app").replace(/\/$/, "");
const TIMEOUT_MS = Math.max(15000, Math.min(Number(process.env.SMOKE_TIMEOUT_MS) || 90000, 180000));

const sample = {
  task: "Task 1",
  taskType: "Task 1",
  generationTask: "Task 1",
  questionType: "semi-formal letter",
  title: "Request to reduce working hours for a part-time course",
  questionPrompt: "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the restaurant.",
  prompt: "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the restaurant.",
  essay: `Dear Mark,

I am writing because I want to reduce my working hours. I have started a cooking course, and the classes are in the evening.

At the moment I work several evening shifts, so it is difficult for me to go to class on time. I would like to work mainly in the morning or early afternoon if possible.

This could also help the restaurant because I can learn new cooking skills and later help with some menu ideas. I hope you can consider my request.

Yours sincerely,
Kevin`,
  wordCount: 126,
  frozenScore: { overallBand: 4.5 },
  currentResult: { task: "Task 1", overallBand: 4.5 }
};

const feedbackModules = (process.env.SMOKE_FEEDBACK_MODULES || "overview,sentenceUpgrade,grammarWordFormSpelling,structureCohesionTask,expressionBank")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || []).length;
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function isNumberBand(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 9;
}

function extractBand(result = {}) {
  const candidates = [
    result.finalBand,
    result.overallBand,
    result.score,
    result.band,
    result.scoreCalculation && result.scoreCalculation.finalBand,
    result.visibleScore && result.visibleScore.finalBand
  ];
  for (const value of candidates) {
    if (isNumberBand(value)) return Math.round(Number(value) * 2) / 2;
  }
  return null;
}

async function postJson(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      throw new Error([`HTTP ${response.status}`, data.error, data.detail, data.raw && String(data.raw).slice(0, 300)].filter(Boolean).join(" | "));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function hasChinese(value) {
  if (!value) return false;
  if (typeof value === "string") return /[\u4e00-\u9fff]/.test(value);
  if (Array.isArray(value)) return value.some(hasChinese);
  if (typeof value === "object") return Object.entries(value).some(([key, nested]) => /zh|chinese/i.test(key) && hasChinese(nested)) || Object.values(value).some(hasChinese);
  return false;
}

function statusFor(verifiedBand, targetBand) {
  const verified = Number(verifiedBand);
  const target = Number(targetBand);
  if (!Number.isFinite(verified) || !Number.isFinite(target)) return "verification_unavailable";
  if (verified < target) return "below_target";
  if (verified > target) return "target_exceeded";
  return "target_met";
}

async function verifyGeneratedPart(key, part) {
  const targetBand = Number(part && part.targetBand);
  if (!part || !part.essay) return { key, skipped: true, reason: "missing generated essay" };
  const score = await postJson("/api/grade-ielts-production-router", {
    ...sample,
    essay: part.essay,
    wordCount: countWords(part.essay),
    mode: "score",
    generatedAnswerLabel: key,
    generatedTargetBand: Number.isFinite(targetBand) ? targetBand : null,
    currentResult: null,
    frozenScore: null
  });
  const verifiedBand = extractBand(score);
  const status = statusFor(verifiedBand, targetBand);
  assert(status !== "target_met" || verifiedBand === targetBand, `${key}: target_met must only appear when verifiedBand === targetBand`, { verifiedBand, targetBand, status });
  return { key, targetBand, verifiedBand, status, finalSource: score.finalSource };
}

async function run() {
  console.log(`Smoke base URL: ${BASE_URL}`);

  const score = await postJson("/api/grade-ielts-production-router", { ...sample, mode: "score" });
  assert(isNumberBand(score.finalBand || score.overallBand || score.scoreCalculation?.finalBand), "Production router did not return finalBand/overallBand.", score);
  assert(score.finalSource || score.scoreSource || score.system, "Production router did not return finalSource/source.", score);
  assert(score.boundaryMainReuseAudit, "boundaryMainReuseAudit is not visible in production router response.", {
    finalBand: score.finalBand,
    finalSource: score.finalSource,
    routeDecision: score.routeDecision,
    routeZone: score.routeZone
  });
  console.log("Router:", {
    finalBand: score.finalBand || score.overallBand || score.scoreCalculation?.finalBand,
    finalSource: score.finalSource || score.scoreSource,
    boundaryMainReuseAudit: score.boundaryMainReuseAudit
  });

  const generator = await postJson("/api/essay-generator", { ...sample, mode: "generation_only", verifyGeneratedScores: false });
  for (const key of ["modelAnswer", "revisionPlus05", "revisionPlus10"]) {
    assert(generator[key] && generator[key].essay, `Essay generator did not return ${key}.`, generator[key]);
  }
  const generatedChecks = [];
  for (const key of ["revisionPlus05", "revisionPlus10"]) {
    generatedChecks.push(await verifyGeneratedPart(key, generator[key]));
  }
  console.log("Generated verification:", generatedChecks);

  for (const moduleName of feedbackModules) {
    const feedback = await postJson("/api/writing-feedback", {
      ...sample,
      module: moduleName,
      moduleName,
      currentResult: score,
      frozenScore: { overallBand: score.finalBand || score.overallBand || score.scoreCalculation?.finalBand }
    });
    assert(feedback.ok !== false, `${moduleName}: feedback API returned not ok.`, feedback);
    assert(hasChinese(feedback.moduleResult || feedback.result), `${moduleName}: feedback result does not contain Chinese helper fields.`, feedback.moduleResult || feedback.result);
    const serialized = JSON.stringify(feedback);
    assert(!serialized.includes("中文解释暂缺"), `${moduleName}: response contains missing Chinese placeholder.`, feedback);
    console.log(`Feedback ${moduleName}: Chinese fields present`);
  }

  console.log("Smoke test passed.");
}

run().catch((error) => {
  console.error("Smoke test failed:", error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 2000));
  process.exit(1);
});
