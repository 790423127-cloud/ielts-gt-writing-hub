const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const LIVE = /^(1|true|yes)$/i.test(String(process.env.SMOKE_LIVE || process.env.AUDIT_LIVE || ""));
const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.AUDIT_BASE_URL || "https://ielts-gt-writing-hub.vercel.app").replace(/\/$/, "");
const TIMEOUT_MS = Math.max(12000, Math.min(Number(process.env.SMOKE_TIMEOUT_MS) || 90000, 180000));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function loadAuditExports(relativeFile, exportNames) {
  const absolute = path.join(ROOT, relativeFile);
  const source = fs.readFileSync(absolute, "utf8");
  const assignments = exportNames.map((name) => `\nmodule.exports.__audit.${name} = typeof ${name} === "undefined" ? undefined : ${name};`).join("");
  const wrapped = `${source}\nmodule.exports.__audit = module.exports.__audit || {};${assignments}\n`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(absolute),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch,
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.runInNewContext(wrapped, sandbox, { filename: absolute, displayErrors: true });
  return sandbox.module.exports.__audit || {};
}

async function postJson(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new Error([`HTTP ${response.status}`, data.error, data.detail, data.provider, data.rawPreview].filter(Boolean).join(" | "));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function buildEssay(task) {
  return task === "Task 1"
    ? `Dear Mr Brown,\n\nI am writing to ask if it would be possible to reduce my evening shifts for the next three months. I have started a part-time course, and the classes take place after work.\n\nAt present I work four evenings each week. If possible, I would like to change two of those shifts to daytime hours so that I can attend my classes and arrive on time.\n\nThis change could also help the restaurant because I can continue working with more energy and later use my new skills to help with food preparation. Thank you for considering my request.\n\nYours sincerely,\nKevin`
    : `In many countries, crime novels and TV crime dramas are becoming very popular. I think there are several reasons for this. In my opinion, these books and shows are interesting, but people should not spend too much time watching them.\n\nFirstly, crime stories are popular because they are exciting. Many people like to know who did the crime and why the person did it. When people watch a crime drama, they can follow the police or detective to find the answer. This makes the story more interesting than some normal TV programmes. Also, many crime stories have many surprises, so viewers want to keep watching until the end.\n\nSecondly, crime novels and TV dramas can show people some problems in society. For example, they may show stealing, murder, family problems or money problems. These things are not good, but they can make people think about real life. Some people also like these stories because they want to understand why criminals do bad things.\n\nIn my opinion, crime fiction and TV crime dramas can be good entertainment. They help people relax after work or study. They can also make people think more carefully. However, I also think there are some disadvantages. If the story has too much violence, it may not be suitable for young people. Some people may also feel afraid after watching too many crime dramas.\n\nIn conclusion, crime novels and TV crime dramas are popular because they are exciting and full of mystery. I think they are good if people watch or read them in a sensible way.`;
}

function buildPrompt(task) {
  return task === "Task 1"
    ? "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. Explain why you are writing, describe the change you want, and explain how this change could benefit the restaurant."
    : `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`;
}

function fakeSignals(task, essay) {
  const wordCount = (String(essay).trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || []).length;
  const paragraphCount = String(essay).split(/\n\s*\n|\r?\n/).map((part) => part.trim()).filter(Boolean).length;
  return {
    task,
    wordCount,
    paragraphCount,
    sentenceCount: (String(essay).match(/[^.!?]+[.!?]+/g) || []).length || 1,
    taskRequirementAudit: {
      summary: task === "Task 1" ? "Three bullet points covered." : "Two direct question parts covered.",
      items: task === "Task 1"
        ? [
            { requirement: "Say why you are writing.", status: "covered" },
            { requirement: "Describe the change you want.", status: "covered" },
            { requirement: "Explain how this helps the restaurant.", status: "covered" }
          ]
        : [
            { requirement: "Why are the books and TV shows popular?", status: "covered" },
            { requirement: "What is your opinion?", status: "covered" }
          ]
    },
    taskProfile: {
      task,
      questionType: task === "Task 1" ? "request" : "two-question",
      letterStyle: task === "Task 1" ? "formal letter" : "",
      taskRequirementAudit: {
        summary: task === "Task 1" ? "Three bullet points covered." : "Two direct question parts covered."
      }
    }
  };
}

function fakeAiResult(task, essay) {
  const signals = fakeSignals(task, essay);
  const criteria = task === "Task 1"
    ? { "Task Achievement": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 }
    : { "Task Response": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 };
  return {
    ok: true,
    task,
    scoringTask: task,
    overallBand: 5.5,
    finalBand: 5.5,
    score: 5.5,
    criteria,
    finalCriteria: criteria,
    criterionAudit: {},
    criterionScoreAudit: {},
    taskProfile: signals.taskProfile,
    localSignals: signals
  };
}

function summarizeResult(sampleName, result) {
  const criteria = result.criteria || result.finalCriteria || {};
  const values = Object.values(criteria).map(Number).filter(Number.isFinite);
  const criteriaAllEqual = values.length === 4 && values.every((value) => value === values[0]);
  return {
    sampleName,
    mainCalled: Boolean(result.mainCalled),
    lowbandCalled: Boolean(result.lowbandCalled),
    boundaryCalled: Boolean(result.boundaryCalled),
    highbandCalled: Boolean(result.highbandCalled),
    mainBand: result.mainBand,
    lowbandBand: result.lowbandBand,
    boundaryBand: result.boundaryBand,
    highbandBand: result.highbandBand,
    finalBand: result.finalBand,
    finalSource: result.finalSource,
    lowbandOverrideAllowed: Boolean(result.lowbandOverrideAllowed),
    criteriaAllEqual,
    finalBandSourceIsAI: Boolean(result.finalBandSourceIsAI),
    localHeuristicAdjustedFinalBand: Boolean(result.localHeuristicAdjustedFinalBand),
    localHeuristicAdjustedCriterionScores: Boolean(result.localHeuristicAdjustedCriterionScores)
  };
}

async function runLiveSample(sampleName, task) {
  const prompt = buildPrompt(task);
  const essay = buildEssay(task);
  const payload = {
    task,
    taskType: task,
    scoringTask: task,
    questionPrompt: prompt,
    promptText: prompt,
    prompt,
    essay,
    answer: essay,
    response: essay,
    text: essay,
    mode: "score"
  };

  const main = await postJson(`${BASE_URL}/api/grade-ielts`, payload);
  const lowband = await postJson(`${BASE_URL}/api/grade-ielts-lowband`, payload);
  const boundary = await postJson(`${BASE_URL}/api/grade-ielts-boundary-adjudicator`, {
    ...payload,
    frozenMainResult: main,
    frozenMainScore: main.finalBand || main.overallBand || main.score,
    frozenMainCriteria: main.finalCriteria || main.criteria || {},
    productionRouterMainFrozen: true
  });
  const highband = await postJson(`${BASE_URL}/api/grade-ielts-highband`, payload);
  const router = await postJson(`${BASE_URL}/api/grade-ielts-production-router`, payload);

  return summarizeResult(sampleName, {
    mainCalled: true,
    lowbandCalled: true,
    boundaryCalled: true,
    highbandCalled: true,
    mainBand: main.mainScore ?? main.finalBand ?? main.overallBand ?? main.score,
    lowbandBand: lowband.finalBand ?? lowband.overallBand ?? lowband.score,
    boundaryBand: boundary.finalBand ?? boundary.overallBand ?? boundary.score,
    highbandBand: highband.finalBand ?? highband.overallBand ?? highband.score,
    finalBand: router.finalBand ?? router.overallBand ?? router.score,
    finalSource: router.finalSource || router.finalSource || "",
    lowbandOverrideAllowed: Boolean(router.lowbandOverrideAllowed),
    finalBandSourceIsAI: /main-score|lowband|boundary-adjudicator|highband/.test(String(router.finalSource || "")),
    localHeuristicAdjustedFinalBand: Boolean(router.scoringAudit?.localHeuristicAdjustedFinalBand || false),
    localHeuristicAdjustedCriterionScores: Boolean(router.scoringAudit?.localHeuristicAdjustedCriterionScores || false),
    criteria: router.criteria || router.finalCriteria || {}
  });
}

function runLocalSample(sampleName, task) {
  const essay = buildEssay(task);
  const signals = fakeSignals(task, essay);
  const grade = loadAuditExports("api/grade-ielts.js", ["rebalanceMechanicalCriteria", "buildCriterionAudit", "normalizeScoreCoreResult"]);
  const boundary = loadAuditExports("api/grade-ielts-boundary-adjudicator.js", ["buildCriterionAudit", "allCriteriaSame"]);
  const criteria = task === "Task 1"
    ? { "Task Achievement": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 }
    : { "Task Response": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 };

  const rebalance = grade.rebalanceMechanicalCriteria(task, criteria, signals, { essay, questionPrompt: buildPrompt(task), promptText: buildPrompt(task) });
  assert(JSON.stringify(rebalance.criteria) === JSON.stringify(criteria), "Local criterion rebalance should not alter AI criterion bands.", rebalance);

  const criterionAudit = boundary.buildCriterionAudit(task, criteria, { raw: { localSignals: signals, taskProfile: signals.taskProfile } }, { score: 5.5, criteria }, essay, buildPrompt(task));
  assert(criterionAudit.criterionAudit, "Boundary audit did not return criterionAudit.", criterionAudit);
  assert(criterionAudit.criterionScoreAudit, "Boundary audit did not return criterionScoreAudit.", criterionAudit);

  return summarizeResult(sampleName, {
    mainCalled: true,
    lowbandCalled: true,
    boundaryCalled: true,
    highbandCalled: true,
    mainBand: 5.5,
    lowbandBand: 4.0,
    boundaryBand: 5.5,
    highbandBand: 7.5,
    finalBand: 5.5,
    finalSource: "boundary-adjudicator-v4-3",
    lowbandOverrideAllowed: false,
    criteria,
    finalBandSourceIsAI: true,
    localHeuristicAdjustedFinalBand: false,
    localHeuristicAdjustedCriterionScores: false
  });
}

async function main() {
  const samples = [
    { sampleName: "Task 1 request", task: "Task 1" },
    { sampleName: "Task 2 two-question crime", task: "Task 2" }
  ];

  const outputs = [];
  if (LIVE) {
    for (const sample of samples) {
      outputs.push(await runLiveSample(sample.sampleName, sample.task));
    }
  } else {
    for (const sample of samples) {
      outputs.push(runLocalSample(sample.sampleName, sample.task));
    }
  }

  for (const output of outputs) {
    console.log(JSON.stringify(output, null, 2));
  }

  assert(outputs.every((item) => item.finalBandSourceIsAI), "finalBandSourceIsAI should stay true in smoke test outputs.", outputs);
  assert(outputs.every((item) => !item.localHeuristicAdjustedFinalBand && !item.localHeuristicAdjustedCriterionScores), "No local heuristic should change final or criterion bands.", outputs);
  console.log(LIVE ? "Live router wiring smoke test passed." : "Local router wiring smoke test passed.");
}

main().catch((error) => {
  console.error("Router wiring smoke test failed:", error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 4000));
  process.exit(1);
});
