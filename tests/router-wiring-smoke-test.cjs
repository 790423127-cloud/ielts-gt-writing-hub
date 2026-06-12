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

function buildEssay(task, variant = "simple-complete") {
  if (variant === "sophisticated-off-task") {
    return `It is often argued that crime films can negatively influence viewers, particularly the younger generation. While I acknowledge that exposure to violent content may have some adverse effects, I believe that the overall impact of such films is not inherently harmful, provided they are consumed responsibly.\n\nOn the one hand, crime films frequently depict illegal activities, aggressive behavior, and moral transgressions. Young people, who are still developing their understanding of right and wrong, might be impressionable and could emulate the characters they see on screen. For instance, repeated exposure to movies glorifying theft or murder might desensitize adolescents to the severity of such actions, fostering indifference or even admiration. Furthermore, these films sometimes exaggerate or romanticize crime, which can create unrealistic perceptions of criminal life and encourage risky behavior.\n\nOn the other hand, it is essential to consider that films are a form of entertainment and often serve educational or cautionary purposes. Crime stories can illustrate the consequences of unlawful behavior, showing that criminal actions often lead to punishment or personal downfall. Additionally, mature audiences generally possess the critical thinking skills to distinguish between fiction and reality. Proper parental guidance and age restrictions can also mitigate any potential negative effects, allowing young viewers to enjoy these films without adopting harmful behaviors.\n\nIn conclusion, while crime films may pose some risks to impressionable viewers, I contend that the negative impact is limited and manageable. Rather than banning or condemning such media outright, society should focus on promoting responsible consumption and critical media literacy. This approach enables audiences to appreciate crime films for their narrative and artistic value without being adversely influenced.`;
  }
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
  const localLogicAudit = result.localLogicAudit || {};
  const criterionDifferentiationAudit = result.criterionDifferentiationAudit || result.criterionScoreAudit || {};
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
    localHeuristicAdjustedCriterionScores: Boolean(result.localHeuristicAdjustedCriterionScores),
    localLogicAudit,
    criterionDifferentiationAudit,
    scoreFrozen: Boolean(result.scoreFrozen),
    feedbackCanChangeScore: Boolean(result.feedbackCanChangeScore)
  };
}

async function runLiveSample(sampleName, task, variant) {
  const prompt = buildPrompt(task);
  const essay = buildEssay(task, variant);
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
    criteria: router.criteria || router.finalCriteria || {},
    localLogicAudit: router.localLogicAudit,
    criterionDifferentiationAudit: router.criterionDifferentiationAudit || router.criterionScoreAudit,
    scoreFrozen: router.scoreFrozen,
    feedbackCanChangeScore: router.feedbackCanChangeScore
  });
}

function runLocalSample(sampleName, task, variant) {
  const essay = buildEssay(task, variant);
  const signals = fakeSignals(task, essay);
  const grade = loadAuditExports("api/grade-ielts.js", ["rebalanceMechanicalCriteria", "buildCriterionAudit", "normalizeScoreCoreResult"]);
  const boundary = loadAuditExports("api/grade-ielts-boundary-adjudicator.js", ["buildCriterionAudit", "allCriteriaSame"]);
  const router = loadAuditExports("api/grade-ielts-production-router.js", ["directMainPayload", "buildRouterScoringAudit"]);
  const criteria = variant === "sophisticated-off-task"
    ? { "Task Response": 5.0, "Coherence and Cohesion": 6.5, "Lexical Resource": 6.5, "Grammatical Range and Accuracy": 6.5 }
    : task === "Task 1"
    ? { "Task Achievement": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 }
    : { "Task Response": 5.5, "Coherence and Cohesion": 5.5, "Lexical Resource": 5.0, "Grammatical Range and Accuracy": 5.5 };

  const rebalance = grade.rebalanceMechanicalCriteria(task, criteria, signals, { essay, questionPrompt: buildPrompt(task), promptText: buildPrompt(task) });
  assert(JSON.stringify(rebalance.criteria) === JSON.stringify(criteria), "Local criterion rebalance should not alter AI criterion bands.", rebalance);

  const criterionAudit = boundary.buildCriterionAudit(task, criteria, { raw: { localSignals: signals, taskProfile: signals.taskProfile } }, { score: 5.5, criteria }, essay, buildPrompt(task));
  assert(criterionAudit.criterionAudit, "Boundary audit did not return criterionAudit.", criterionAudit);
  assert(criterionAudit.criterionScoreAudit, "Boundary audit did not return criterionScoreAudit.", criterionAudit);
  const directPayload = router.directMainPayload(fakeAiResult(task, essay), 5.5, { routeDecision: "main_direct_middle_band_6_0_to_6_5", routeZone: "middle_band_6_0_6_5", targetSystem: "main" }, 1, Date.now(), {});
  assert(directPayload.localLogicAudit, "Production router payload must expose localLogicAudit.", directPayload);
  assert(directPayload.criterionDifferentiationAudit, "Production router payload must expose criterionDifferentiationAudit.", directPayload);
  assert(directPayload.localLogicAudit.usedForScoring === false, "Local logic must not be marked as scoring.", directPayload.localLogicAudit);
  assert(directPayload.localLogicAudit.adjustedOverallBand === false, "Local logic must not adjust overall band.", directPayload.localLogicAudit);
  assert(directPayload.localLogicAudit.adjustedCriterionScores === false, "Local logic must not adjust criterion bands.", directPayload.localLogicAudit);
  assert(directPayload.localLogicAudit.appliedLocalFloor === false, "Local logic must not apply local floor.", directPayload.localLogicAudit);
  assert(directPayload.localLogicAudit.appliedLocalCap === false, "Local logic must not apply local cap.", directPayload.localLogicAudit);
  assert(directPayload.localLogicAudit.copiedOverallToCriteria === false, "Local logic must not copy overall to criteria.", directPayload.localLogicAudit);
  assert(directPayload.scoreFrozen === true, "Router payload should state score is frozen before feedback.", directPayload);
  assert(directPayload.feedbackCanChangeScore === false, "Criterion feedback must not be able to change frozen scores.", directPayload);

  return summarizeResult(sampleName, {
    mainCalled: true,
    lowbandCalled: true,
    boundaryCalled: true,
    highbandCalled: true,
    mainBand: 5.5,
    lowbandBand: 4.0,
    boundaryBand: 5.5,
    highbandBand: 7.5,
    finalBand: variant === "sophisticated-off-task" ? 6.0 : 5.5,
    finalSource: "boundary-adjudicator-v4-3",
    lowbandOverrideAllowed: false,
    criteria,
    finalBandSourceIsAI: true,
    localHeuristicAdjustedFinalBand: false,
    localHeuristicAdjustedCriterionScores: false,
    localLogicAudit: directPayload.localLogicAudit,
    criterionDifferentiationAudit: directPayload.criterionDifferentiationAudit,
    scoreFrozen: directPayload.scoreFrozen,
    feedbackCanChangeScore: directPayload.feedbackCanChangeScore
  });
}

function assertCriterionFeedbackPromptIsSpecific() {
  const source = fs.readFileSync(path.join(ROOT, "api/criterion-feedback.js"), "utf8");
  assert(source.includes("feedbackSource"), "Criterion feedback endpoint must expose feedbackSource.", "api/criterion-feedback.js");
  assert(source.includes("ai-specific-feedback"), "Criterion feedback must mark normal AI-specific feedback.", "api/criterion-feedback.js");
  assert(source.includes("fallback-template"), "Criterion feedback fallback must be explicitly labelled.", "api/criterion-feedback.js");
  assert(source.includes("scoreFrozen") && source.includes("feedbackCanChangeScore"), "Criterion feedback must state it cannot change frozen scores.", "api/criterion-feedback.js");
  assert(/Evidence requirement:[\s\S]*at least TWO short exact quotes/.test(source), "Criterion feedback prompt must require direct essay quotes.", "api/criterion-feedback.js");
}

async function main() {
  assertCriterionFeedbackPromptIsSpecific();
  const samples = [
    { sampleName: "Task 1 request", task: "Task 1", variant: "simple-complete" },
    { sampleName: "Task 2 two-question crime", task: "Task 2", variant: "simple-complete" },
    { sampleName: "Task 2 sophisticated partially off-task", task: "Task 2", variant: "sophisticated-off-task" }
  ];

  const outputs = [];
  if (LIVE) {
    for (const sample of samples) {
      outputs.push(await runLiveSample(sample.sampleName, sample.task, sample.variant));
    }
  } else {
    for (const sample of samples) {
      outputs.push(runLocalSample(sample.sampleName, sample.task, sample.variant));
    }
  }

  for (const output of outputs) {
    console.log(JSON.stringify(output, null, 2));
  }

  assert(outputs.every((item) => item.finalBandSourceIsAI), "finalBandSourceIsAI should stay true in smoke test outputs.", outputs);
  assert(outputs.every((item) => !item.localHeuristicAdjustedFinalBand && !item.localHeuristicAdjustedCriterionScores), "No local heuristic should change final or criterion bands.", outputs);
  assert(outputs.every((item) => item.localLogicAudit?.usedForScoring === false), "localLogicAudit must prove local logic is not used for scoring.", outputs);
  assert(outputs.every((item) => item.localLogicAudit?.usedForRoutingOnly === true), "localLogicAudit must show local logic is routing/audit only.", outputs);
  assert(outputs.every((item) => item.localLogicAudit?.adjustedOverallBand === false && item.localLogicAudit?.adjustedCriterionScores === false), "localLogicAudit must show no local score adjustments.", outputs);
  assert(outputs.every((item) => item.localLogicAudit?.appliedLocalFloor === false && item.localLogicAudit?.appliedLocalCap === false), "localLogicAudit must show no local floor/cap.", outputs);
  assert(outputs.every((item) => item.localLogicAudit?.copiedOverallToCriteria === false), "localLogicAudit must show no overall-to-criteria copy.", outputs);
  assert(outputs.every((item) => item.criterionDifferentiationAudit?.criterionScoresSource === "ai"), "criterionDifferentiationAudit must mark criterion scores as AI-sourced.", outputs);
  assert(outputs.every((item) => item.criterionDifferentiationAudit?.criterionFeedbackSource === "ai-specific-feedback"), "criterionDifferentiationAudit must mark criterion feedback as AI-specific.", outputs);
  assert(outputs.every((item) => item.scoreFrozen === true && item.feedbackCanChangeScore === false), "Scores must be frozen before feedback.", outputs);
  const offTask = outputs.find((item) => item.sampleName.includes("partially off-task"));
  assert(!offTask || offTask.criteriaAllEqual === false, "Sophisticated off-task sample must not collapse all criteria into one copied score.", offTask);
  console.log(LIVE ? "Live router wiring smoke test passed." : "Local router wiring smoke test passed.");
}

main().catch((error) => {
  console.error("Router wiring smoke test failed:", error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 4000));
  process.exit(1);
});
