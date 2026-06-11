const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const GENERATOR_VERSION = "essay-generator-v3-4-strict-minimum-target-regeneration";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_GENERATOR_TIMEOUT_MS) || 150000, 240000));
const DISCLAIMER = "This is AI-generated practice writing, not an official IELTS answer.";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.includes("ielts-gt-writing-hub") && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://790423127-cloud.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  };
}

function sendJson(req, res, statusCode, payload) {
  Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function clipText(text, maxChars) {
  const value = String(text || "").trim();
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function normalizeRequestedTask(body = {}) {
  const raw = String(
    body.task ||
    body.taskType ||
    body.generationTask ||
    body.scoringTask ||
    body.requestedTask ||
    body.selectedTask ||
    body.writingTask ||
    ""
  ).toLowerCase();

  if (/task\s*1|task1|gt\s*task\s*1|letter|gt\s*letter|writing\s*1/.test(raw)) return "Task 1";
  if (/task\s*2|task2|gt\s*task\s*2|essay|gt\s*essay|writing\s*2/.test(raw)) return "Task 2";

  return "Task 2";
}

function normalizeIncomingBody(rawBody = {}) {
  const body = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};
  const lockedTask = normalizeRequestedTask(body);
  body.task = lockedTask;
  body.taskType = lockedTask === "Task 1" ? "task1" : "task2";
  body.generationTask = lockedTask;
  body.requestedTask = lockedTask;
  body.selectedTask = lockedTask;
  body.essay = String(body.essay || "");
  body.prompt = String(body.prompt || body.questionPrompt || body.promptText || "");
  body.questionPrompt = String(body.questionPrompt || body.prompt || body.promptText || "");
  body.wordCount = Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : countWords(body.essay);
  return body;
}

function taskOfResult(result) {
  if (!result || typeof result !== "object") return "";
  const explicit = result.task || result.localSignals?.task || result.taskType || result.scoringTask || result.requestedTask || result.selectedTask || result.writingTask || "";
  if (!explicit) return "";
  return normalizeRequestedTask({ task: explicit });
}

function safeFrozenContext(body = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const current = body.currentResult && typeof body.currentResult === "object" ? body.currentResult : null;
  const frozen = body.frozenScore && typeof body.frozenScore === "object" ? body.frozenScore : null;
  const currentTask = current ? (current.task || current.localSignals?.task || taskOfResult(current)) : "";
  if (current && currentTask && currentTask !== lockedTask) {
    return {
      frozenScore: frozen,
      currentResult: null,
      currentResultUsed: false,
      currentResultRejectedReason: `Rejected currentResult because it belongs to ${currentTask}, while the locked generation task is ${lockedTask}.`
    };
  }
  return {
    frozenScore: frozen,
    currentResult: current,
    currentResultUsed: Boolean(current),
    currentResultRejectedReason: ""
  };
}

function extractFrozenBandFromContext(context = {}) {
  const frozen = context.frozenScore && typeof context.frozenScore === "object" ? context.frozenScore : {};
  const current = context.currentResult && typeof context.currentResult === "object" ? context.currentResult : {};
  const candidates = [
    frozen.finalBand,
    frozen.overallBand,
    frozen.score,
    frozen.band,
    frozen.scoreCalculation && frozen.scoreCalculation.finalBand,
    current.finalBand,
    current.overallBand,
    current.score,
    current.band,
    current.scoreCalculation && current.scoreCalculation.finalBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
  }
  return null;
}

function clampBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9, Math.round(n * 2) / 2));
}

function bandLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(1).replace(/\.0$/, ".0");
}

function textArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function objectOnly(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function generationTargetsForContext(context = {}) {
  const currentBand = extractFrozenBandFromContext(context);
  if (!Number.isFinite(currentBand)) {
    return {
      currentBand: null,
      targetBandModel: 5.5,
      targetBandPlus05: 5.0,
      targetBandPlus10: 5.5,
      minimumTargetRule: "No frozen band is available. Use strict minimum targets: +0.5 revision at least Band 5.0, +1.0 revision/model at least Band 5.5.",
      levelInstruction: "No frozen band is available. Generate at least Band 5.0 for the +0.5 revision and at least Band 5.5 for the +1.0/model answer, while keeping language learnable and practical."
    };
  }

  const targetBandPlus05 = clampBand(Math.max(5.0, currentBand + 0.5));
  const targetBandPlus10 = clampBand(Math.max(targetBandPlus05 + 0.5, currentBand + 1.0));
  const targetBandModel = clampBand(Math.max(targetBandPlus10, 5.5));
  const minimumTargetRule = `Strict target rule: if current band is ${currentBand.toFixed(1)}, the +0.5 revision must verify at no less than Band ${targetBandPlus05.toFixed(1)}, and the +1.0 revision/model answer must verify at no less than Band ${targetBandPlus10.toFixed(1)}. Anything below target is NOT acceptable.`;

  let levelInstruction = "";
  if (currentBand < 5) {
    levelInstruction = "The student is below Band 5, but generated practice answers must not stay at the same level. The +0.5 revision must be at least Band 5.0. Improve task coverage, paragraph clarity, basic grammar accuracy, and useful everyday vocabulary. Keep language learnable, but make the answer strong enough to pass production verification at the target band.";
  } else if (currentBand < 6.5) {
    levelInstruction = "The student is around Band 5 to 6. The generated answers must be at least 0.5 band higher than the current score. Use moderately improved but still learnable language. Focus on clearer task response, paragraph development, safer grammar, and more natural collocation.";
  } else if (currentBand < 7.5) {
    levelInstruction = "The student is around Band 6.5 to 7. Generate stronger but still practical IELTS language. Focus on precision, development, cohesion, and controlled complex sentences.";
  } else {
    levelInstruction = "The student is already high band. The model answer can be sophisticated, but learning notes must remain practical and explainable.";
  }

  return { currentBand, targetBandModel, targetBandPlus05, targetBandPlus10, minimumTargetRule, levelInstruction };
}


function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response");
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error("AI did not return valid JSON");
}

function buildGenerationPrompt(body = {}) {
  const task = normalizeRequestedTask(body);
  const context = safeFrozenContext(body);
  const targets = generationTargetsForContext(context);
  const prompt = body.questionPrompt || body.prompt || body.promptText || "";
  const essay = String(body.essay || "").trim();

  const taskSpecific = task === "Task 1"
    ? [
        "Task 1 requirements:",
        "- Generate General Training Task 1 letter practice output.",
        "- The question-based model answer must clearly cover all bullet points.",
        "- Use a suitable tone/register: formal, semi-formal, or informal depending on the prompt.",
        "- Keep paragraphs short, functional, and easy to imitate."
      ].join("\n")
    : [
        "Task 2 requirements:",
        "- Generate General Training Task 2 essay practice output.",
        "- Identify the question type and answer all parts.",
        "- Keep the position clear when the task asks for opinion.",
        "- Use logical body paragraphs with reasons and examples."
      ].join("\n");

  const essayInstruction = essay
    ? "The student essay is provided. Generate TWO revised versions based on the student's essay: one aimed at about +0.5 band, and one aimed at about +1.0 band. Preserve the student's core meaning, topic, and main ideas."
    : "No student essay was provided. Leave revisionPlus05.essay and revisionPlus10.essay empty, but still provide the question-based model answer and learning guide.";

  return [
    "You are an IELTS General Training Writing tutor.",
    "This endpoint is generation-only. You are NOT scoring the user essay and must NOT change any frozen user score.",
    "Use frozen score/current result only as a language-level reference for generating learnable writing.",
    "Generate exactly THREE learning outputs:",
    "1) modelAnswer: a question-based model answer. It can be unrelated to the student's essay and should be only about 0.5 to 1.0 band above the student's current frozen level.",
    "2) revisionPlus05: a revised version based on the student's essay, aiming for about +0.5 band improvement.",
    "3) revisionPlus10: a revised version based on the student's essay, aiming for about +1.0 band improvement.",
    "Do not produce Band 8/9 style language for a Band 5 student. The outputs must be learnable and imitable, but they must still be strong enough to meet the strict target band in production scoring verification.",
    "Strict target rule: below-target verification is failure, not near success. If the current band is 4.5, the +0.5 revision must be at least Band 5.0 and the +1.0 revision must be at least Band 5.5. If the current band is 5.0, the +0.5 revision must be at least Band 5.5.",
    "Explain WHY each version is higher and WHAT the student should learn from it.",
    "Do not tell the student to memorize entire essays. Focus on structure, task coverage, useful sentences, grammar control, and paragraph development.",
    taskSpecific,
    essayInstruction,
    targets.levelInstruction,
    "Return strict JSON only. No markdown, no code fences, no comments, no trailing prose.",
    "Return exactly this shape:",
    JSON.stringify({
      ok: true,
      aiStage: "essay-generator",
      task,
      generationOnly: true,
      scoreUnaffected: true,
      currentBand: targets.currentBand,
      targetBandModel: targets.targetBandModel,
      targetBandPlus05: targets.targetBandPlus05,
      targetBandPlus10: targets.targetBandPlus10,
      modelAnswer: {
        title: "Question-based model answer",
        targetBand: targets.targetBandModel,
        essay: "...",
        whyThisIsLearnable: "...",
        whyHigherThanUserEssay: "...",
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      revisionPlus05: {
        title: "Revised version: +0.5 band",
        targetBand: targets.targetBandPlus05,
        essay: essay ? "..." : "",
        whyItIsPlus05: "...",
        whatChanged: ["..."],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      revisionPlus10: {
        title: "Revised version: +1.0 band",
        targetBand: targets.targetBandPlus10,
        essay: essay ? "..." : "",
        whyItIsPlus10: "...",
        whatChangedFromPlus05: ["..."],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      learningGuide: {
        mainWeaknesses: ["..."],
        nextPracticeFocus: ["..."],
        doNotCopyBlindly: ["..."]
      },
      legacy: {
        modelAnswerOutline: "...",
        modelAnswer: "...",
        revisedEssay: essay ? "..." : ""
      }
    }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Title: ${body.title || ""}`,
    `Prompt: ${clipText(prompt, 2400)}`,
    `Current frozen band used only as level reference: ${targets.currentBand == null ? "unknown" : bandLabel(targets.currentBand)}`,
    `Target model answer band: ${targets.targetBandModel == null ? "learner-realistic" : bandLabel(targets.targetBandModel)}`,
    `Minimum target rule: ${targets.minimumTargetRule || "Generated answers must verify at or above their target band."}`,
    `Target +0.5 revised band: ${targets.targetBandPlus05 == null ? "learner-realistic +0.5" : bandLabel(targets.targetBandPlus05)}`,
    `Target +1.0 revised band: ${targets.targetBandPlus10 == null ? "learner-realistic +1.0" : bandLabel(targets.targetBandPlus10)}`,
    `Frozen score/current result for level reference only: ${JSON.stringify({
      frozenScore: context.frozenScore,
      currentResult: context.currentResult ? {
        task: context.currentResult.task,
        overallBand: context.currentResult.overallBand || context.currentResult.finalBand || context.currentResult.scoreCalculation?.finalBand,
        criteria: context.currentResult.finalCriteria || context.currentResult.criteria
      } : null
    })}`,
    `Essay word count: ${countWords(essay)}`,
    "Student essay:",
    clipText(essay, 7000)
  ].join("\n\n");
}


function normalizeGenerationResult(raw = {}, body = {}) {
  const task = normalizeRequestedTask(body);
  const context = safeFrozenContext(body);
  const targets = generationTargetsForContext(context);
  const result = raw && typeof raw === "object" ? raw : {};

  const legacy = objectOnly(result.legacy);
  const modelObj = objectOnly(result.modelAnswer);
  const plus05Obj = objectOnly(result.revisionPlus05);
  const plus10Obj = objectOnly(result.revisionPlus10);
  const guideObj = objectOnly(result.learningGuide);

  const legacyModelAnswer = typeof result.modelAnswer === "string"
    ? result.modelAnswer
    : String(legacy.modelAnswer || result.answer || result.sampleAnswer || modelObj.essay || "").trim();

  const modelAnswer = {
    title: String(modelObj.title || "Question-based model answer").trim(),
    targetBand: clampBand(modelObj.targetBand ?? result.targetBandModel ?? targets.targetBandModel),
    essay: String(modelObj.essay || legacyModelAnswer || "").trim(),
    whyThisIsLearnable: String(modelObj.whyThisIsLearnable || result.whyThisModelIsLearnable || "").trim(),
    whyHigherThanUserEssay: String(modelObj.whyHigherThanUserEssay || result.whyModelIsHigher || "").trim(),
    studyPoints: textArray(modelObj.studyPoints),
    usefulSentences: textArray(modelObj.usefulSentences)
  };

  const revisionPlus05 = {
    title: String(plus05Obj.title || "Revised version: +0.5 band").trim(),
    targetBand: clampBand(plus05Obj.targetBand ?? result.targetBandPlus05 ?? targets.targetBandPlus05),
    essay: String(plus05Obj.essay || result.revisedEssayPlus05 || result.revisedEssay || legacy.revisedEssay || result.revision || result.improvedEssay || "").trim(),
    whyItIsPlus05: String(plus05Obj.whyItIsPlus05 || result.whyPlus05 || "").trim(),
    whatChanged: textArray(plus05Obj.whatChanged),
    studyPoints: textArray(plus05Obj.studyPoints),
    usefulSentences: textArray(plus05Obj.usefulSentences)
  };

  const revisionPlus10 = {
    title: String(plus10Obj.title || "Revised version: +1.0 band").trim(),
    targetBand: clampBand(plus10Obj.targetBand ?? result.targetBandPlus10 ?? targets.targetBandPlus10),
    essay: String(plus10Obj.essay || result.revisedEssayPlus10 || "").trim(),
    whyItIsPlus10: String(plus10Obj.whyItIsPlus10 || result.whyPlus10 || "").trim(),
    whatChangedFromPlus05: textArray(plus10Obj.whatChangedFromPlus05 || plus10Obj.whatChanged),
    studyPoints: textArray(plus10Obj.studyPoints),
    usefulSentences: textArray(plus10Obj.usefulSentences)
  };

  const learningGuide = {
    mainWeaknesses: textArray(guideObj.mainWeaknesses),
    nextPracticeFocus: textArray(guideObj.nextPracticeFocus),
    doNotCopyBlindly: textArray(guideObj.doNotCopyBlindly)
  };

  const modelAnswerOutline = String(
    result.modelAnswerOutline ||
    legacy.modelAnswerOutline ||
    [
      modelAnswer.studyPoints.length ? `Model answer: ${modelAnswer.studyPoints.join("; ")}` : "",
      revisionPlus05.whatChanged.length ? `+0.5 revision: ${revisionPlus05.whatChanged.join("; ")}` : "",
      revisionPlus10.whatChangedFromPlus05.length ? `+1.0 revision: ${revisionPlus10.whatChangedFromPlus05.join("; ")}` : ""
    ].filter(Boolean).join("\n")
  ).trim();

  return {
    ok: true,
    aiStage: "essay-generator",
    generatorVersion: GENERATOR_VERSION,
    disclaimer: DISCLAIMER,
    task,
    taskLocked: true,
    generationOnly: true,
    scoreUnaffected: true,
    scoreChanged: false,
    currentResultUsed: context.currentResultUsed,
    currentResultRejectedReason: context.currentResultRejectedReason,
    wordCount: countWords(body.essay),
    currentBand: targets.currentBand,
    targetBandModel: modelAnswer.targetBand,
    targetBandPlus05: revisionPlus05.targetBand,
    targetBandPlus10: revisionPlus10.targetBand,
    modelAnswer,
    revisionPlus05,
    revisionPlus10,
    learningGuide,
    modelAnswerOutline,
    revisedEssay: revisionPlus05.essay,
    systemFeedback: {
      system: "essay-generation",
      status: "generated_three_step_learning_outputs_with_optional_production_verification",
      scoreChanged: false,
      message: "作文生成完成；生成了题目范文、+0.5 修改版、+1.0 修改版和学习说明。生成文本可使用生产评分路由做目标分验证；用户原分数没有改变。"
    }
  };
}


async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.35,
        max_tokens: 8000,
        messages: [
          { role: "system", content: "Return strict JSON only. Generate IELTS GT practice writing only. Never recalculate or change any score." },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message || text.slice(0, 300)}`);
    const content = payload.choices?.[0]?.message?.content || "";
    return extractJson(content);
  } finally {
    clearTimeout(timeout);
  }
}


function baseUrlFromRequest(req) {
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host;
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : String(forwardedHost || "").trim();
  if (!host) return "https://ielts-gt-writing-hub.vercel.app";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : String(forwardedProto || "").trim();
  const scheme = proto || (/localhost|127\.0\.0\.1/i.test(host) ? "http" : "https");
  return `${scheme}://${host}`;
}

function extractBandFromScoreResult(result = {}) {
  const candidates = [
    result.finalBand,
    result.overallBand,
    result.estimatedBand,
    result.score,
    result.band,
    result.scoreCalculation && result.scoreCalculation.finalBand,
    result.scoreCalculation && result.scoreCalculation.overallBand,
    result.visibleScore && result.visibleScore.finalBand,
    result.visibleScore && result.visibleScore.overallBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
  }
  return null;
}

function verificationLabel(verifiedBand, targetBand) {
  const verified = Number(verifiedBand);
  const target = Number(targetBand);
  if (!Number.isFinite(verified) || !Number.isFinite(target)) return "verification_unavailable";
  if (verified >= target) return "target_met";
  return "below_target";
}

function verificationMessage(status) {
  if (status === "target_met") return "生产评分验证已达到目标分。";
  if (status === "near_target") return "生产评分验证低于严格目标，不能算成功。";
  if (status === "below_target") return "生产评分验证低于严格目标，需要重新生成或重写。";
  return "生产评分验证暂不可用。";
}

async function scoreGeneratedEssay(req, body, essayText, label, targetBand) {
  const essay = String(essayText || "").trim();
  if (!essay) {
    return {
      enabled: true,
      ok: false,
      label,
      targetBand: clampBand(targetBand),
      verifiedBand: null,
      status: "empty_essay",
      message: "没有可验证的生成文本。"
    };
  }

  const endpoint = `${baseUrlFromRequest(req)}/api/grade-ielts-production-router`;
  const payload = {
    ...body,
    ...{
      essay,
      wordCount: countWords(essay),
      mode: "score",
      aiStage: "generated-answer-production-verification",
      generationVerification: true,
      generatedAnswerLabel: label,
      generatedTargetBand: clampBand(targetBand),
      currentResult: null,
      frozenScore: null
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error([`HTTP ${response.status}`, data.error, data.detail].filter(Boolean).join(" | "));
    const verifiedBand = extractBandFromScoreResult(data);
    const status = verificationLabel(verifiedBand, targetBand);
    return {
      enabled: true,
      ok: true,
      label,
      router: "grade-ielts-production-router",
      targetBand: clampBand(targetBand),
      verifiedBand,
      status,
      message: verificationMessage(status),
      criterionBands: data.finalCriteria || data.criteria || null,
      source: data.finalSource || data.scoreSource || data.system || "production-router"
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      label,
      router: "grade-ielts-production-router",
      targetBand: clampBand(targetBand),
      verifiedBand: null,
      status: "verification_failed",
      message: "生产评分验证失败；生成作文仍然可用，但目标分未验证。",
      error: String(error.message || error).slice(0, 500)
    };
  }
}

function shouldRewriteForTarget(verification = {}) {
  const target = Number(verification.targetBand);
  const verified = Number(verification.verifiedBand);
  if (!verification.ok) return false;
  if (!Number.isFinite(target) || !Number.isFinite(verified)) return false;
  return verified < target;
}

function generatedPartSpec(key) {
  if (key === "modelAnswer") {
    return {
      label: "question-based model answer",
      objectName: "modelAnswer",
      jsonShape: {
        title: "Question-based model answer",
        targetBand: 0,
        essay: "...",
        whyThisIsLearnable: "...",
        whyHigherThanUserEssay: "...",
        studyPoints: ["..."],
        usefulSentences: ["..."]
      }
    };
  }
  if (key === "revisionPlus10") {
    return {
      label: "+1.0 revised version based on the student's essay",
      objectName: "revisionPlus10",
      jsonShape: {
        title: "Revised version: +1.0 band",
        targetBand: 0,
        essay: "...",
        whyItIsPlus10: "...",
        whatChangedFromPlus05: ["..."],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      }
    };
  }
  return {
    label: "+0.5 revised version based on the student's essay",
    objectName: "revisionPlus05",
    jsonShape: {
      title: "Revised version: +0.5 band",
      targetBand: 0,
      essay: "...",
      whyItIsPlus05: "...",
      whatChanged: ["..."],
      studyPoints: ["..."],
      usefulSentences: ["..."]
    }
  };
}

function buildRewritePrompt(body, normalized, key, verification) {
  const task = normalizeRequestedTask(body);
  const part = objectOnly(normalized[key]);
  const spec = generatedPartSpec(key);
  const prompt = body.questionPrompt || body.prompt || body.promptText || "";
  const targetBand = clampBand(part.targetBand || verification.targetBand);
  const verifiedBand = clampBand(verification.verifiedBand);
  const criterionBands = verification.criterionBands || {};

  return [
    "You are revising one generated IELTS General Training practice answer after production-router verification.",
    "This is NOT scoring the user's original essay. Do not change any frozen user score.",
    "Your job is to rewrite ONLY the selected generated answer so that it better matches the stated target band while remaining learnable for the student.",
    "Do not use over-advanced Band 8/9 language for a Band 5 target. Improve task coverage, specificity, paragraphing, cohesion, and safe grammar first.",
    "Return strict JSON only. No markdown, no code fences, no comments.",
    `Selected generated answer: ${spec.label}`,
    `Task: ${task}`,
    `Target band: ${targetBand == null ? "learner-realistic" : bandLabel(targetBand)}`,
    `Production-router verified band: ${verifiedBand == null ? "unavailable" : bandLabel(verifiedBand)}`,
    `Production-router criterion bands: ${JSON.stringify(criterionBands)}`,
    "If the verified band is below target, this is a failure, not near success. Improve the generated answer enough to verify at or above the exact target band, but do not make it unrealistic for the student's level.",
    "Output JSON shape:",
    JSON.stringify({ [spec.objectName]: { ...spec.jsonShape, targetBand } }, null, 2),
    "Context prompt:",
    clipText(prompt, 2200),
    "Student original essay:",
    clipText(body.essay || "", 5000),
    "Generated answer that needs revision:",
    clipText(part.essay || "", 5000)
  ].join("\n\n");
}

function mergeRewrittenPart(normalized, key, rawRewrite) {
  const spec = generatedPartSpec(key);
  const incoming = objectOnly(rawRewrite[spec.objectName] || rawRewrite[key] || rawRewrite);
  const current = objectOnly(normalized[key]);
  normalized[key] = { ...current, ...incoming, targetBand: clampBand(incoming.targetBand ?? current.targetBand) };
  return normalized;
}

async function maybeRewriteGeneratedPart(req, body, normalized, key, firstVerification) {
  if (!shouldRewriteForTarget(firstVerification)) {
    normalized[key].verification = firstVerification;
    normalized[key].rewriteAttempted = false;
    return normalized[key].verification;
  }

  try {
    const rewritePrompt = buildRewritePrompt(body, normalized, key, firstVerification);
    const rawRewrite = await callDeepSeek(rewritePrompt);
    mergeRewrittenPart(normalized, key, rawRewrite);
    const secondVerification = await scoreGeneratedEssay(req, body, normalized[key].essay, key, normalized[key].targetBand);
    normalized[key].verification = {
      ...secondVerification,
      firstVerifiedBand: firstVerification.verifiedBand,
      firstStatus: firstVerification.status,
      rewriteAttempted: true
    };
    normalized[key].rewriteAttempted = true;
    return normalized[key].verification;
  } catch (error) {
    normalized[key].verification = {
      ...firstVerification,
      rewriteAttempted: true,
      rewriteFailed: true,
      rewriteError: String(error.message || error).slice(0, 500),
      message: `${firstVerification.message} 自动重写尝试失败；请手动查看目标分和验证分差距。`
    };
    normalized[key].rewriteAttempted = true;
    return normalized[key].verification;
  }
}

async function verifyAndMaybeRewriteGeneratedAnswers(req, body, normalized) {
  const enabled = body.verifyGeneratedScores !== false;
  if (!enabled) {
    normalized.verification = { enabled: false, summary: "生成作文验证已关闭。" };
    return normalized;
  }

  const keys = ["modelAnswer", "revisionPlus05", "revisionPlus10"];
  const results = {};
  for (const key of keys) {
    const part = objectOnly(normalized[key]);
    const first = await scoreGeneratedEssay(req, body, part.essay, key, part.targetBand);
    results[key] = await maybeRewriteGeneratedPart(req, body, normalized, key, first);
  }

  const counts = keys.reduce((acc, key) => {
    const status = results[key]?.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  normalized.verification = {
    enabled: true,
    router: "grade-ielts-production-router",
    targetMet: counts.target_met || 0,
    nearTarget: counts.near_target || 0,
    belowTarget: counts.below_target || 0,
    verificationFailed: counts.verification_failed || 0,
    summary: `严格生产评分验证完成：达到目标 ${counts.target_met || 0} 项，未达到目标 ${counts.below_target || 0} 项，验证失败 ${counts.verification_failed || 0} 项。`,
    items: results
  };

  normalized.systemFeedback = {
    ...normalized.systemFeedback,
    status: "generated_and_verified_with_production_router",
    message: "作文生成完成，并已使用生产评分路由验证目标分。用户原分数没有改变。"
  };

  return normalized;
}



async function generateClientSideRewritePart(body) {
  const key = String(body.rewriteGeneratedPart || body.generatedPartKey || body.partKey || "").trim();
  if (!["modelAnswer", "revisionPlus05", "revisionPlus10"].includes(key)) {
    throw new Error("Unsupported rewriteGeneratedPart. Use modelAnswer, revisionPlus05, or revisionPlus10.");
  }

  const targetBand = clampBand(body.targetBand ?? body.generatedTargetBand ?? body.failedTargetBand);
  const verifiedBand = clampBand(body.failedVerifiedBand ?? body.verifiedBand ?? (body.verification && body.verification.verifiedBand));
  const failedEssay = String(body.failedGeneratedEssay || body.generatedEssay || body.previousGeneratedEssay || "").trim();
  if (!failedEssay) throw new Error("failedGeneratedEssay is required for generated-part rewrite.");

  const normalized = {
    modelAnswer: { targetBand: key === "modelAnswer" ? targetBand : null, essay: "" },
    revisionPlus05: { targetBand: key === "revisionPlus05" ? targetBand : null, essay: "" },
    revisionPlus10: { targetBand: key === "revisionPlus10" ? targetBand : null, essay: "" }
  };
  normalized[key] = { targetBand, essay: failedEssay };

  const verification = {
    targetBand,
    verifiedBand,
    status: "below_target",
    criterionBands: body.criterionBands || (body.verification && body.verification.criterionBands) || {}
  };

  const rawRewrite = await callDeepSeek(buildRewritePrompt(body, normalized, key, verification));
  mergeRewrittenPart(normalized, key, rawRewrite);
  normalized[key].targetBand = targetBand;

  return {
    ok: true,
    aiStage: "essay-generator-rewrite-generated-part",
    generatorVersion: GENERATOR_VERSION,
    disclaimer: DISCLAIMER,
    task: normalizeRequestedTask(body),
    taskLocked: true,
    generationOnly: true,
    scoreUnaffected: true,
    scoreChanged: false,
    rewriteGeneratedPart: key,
    targetBand,
    previousVerifiedBand: verifiedBand,
    rewrittenPart: normalized[key],
    [key]: normalized[key],
    systemFeedback: {
      system: "essay-generation",
      status: "rewritten_generated_part_for_strict_target",
      scoreChanged: false,
      message: "已针对未达到目标分的生成作文单独重写；用户原分数没有改变。"
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const body = normalizeIncomingBody(await readJsonBody(req));
    if (!String(body.prompt || body.questionPrompt || "").trim()) {
      return sendJson(req, res, 400, { ok: false, error: "Prompt is required for essay generation" });
    }
    if (body.mode === "rewrite_generated_part" || body.generationMode === "rewrite_generated_part" || body.rewriteGeneratedPart) {
      const rewritten = await generateClientSideRewritePart(body);
      return sendJson(req, res, 200, rewritten);
    }
    const raw = await callDeepSeek(buildGenerationPrompt(body));
    const normalized = normalizeGenerationResult(raw, body);
    const verified = await verifyAndMaybeRewriteGeneratedAnswers(req, body, normalized);
    return sendJson(req, res, 200, verified);
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: "Essay generation failed", detail: String(error.message || error), system: "essay-generation" });
  }
};

module.exports.config = { maxDuration: 300 };
