const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const GENERATOR_VERSION = "essay-generator-v2-three-step-learnable-upgrade";
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
      targetBandModel: null,
      targetBandPlus05: null,
      targetBandPlus10: null,
      levelInstruction: "No frozen band is available. Keep all generated answers learner-realistic, practical, and not unrealistically advanced."
    };
  }

  const targetBandPlus05 = clampBand(currentBand + 0.5);
  const targetBandPlus10 = clampBand(currentBand + 1.0);
  const targetBandModel = currentBand < 7.5 ? targetBandPlus10 : targetBandPlus05;

  let levelInstruction = "";
  if (currentBand < 5) {
    levelInstruction = "The student is below Band 5. Use clear, simple, learnable sentences. Improve task coverage, basic paragraphing, grammar accuracy, and useful everyday vocabulary. Do not use advanced academic language.";
  } else if (currentBand < 6.5) {
    levelInstruction = "The student is around Band 5 to 6. Use moderately improved but still learnable language. Avoid native-speaker-only phrasing. Focus on clearer task response, paragraph development, and safer sentence control.";
  } else if (currentBand < 7.5) {
    levelInstruction = "The student is around Band 6.5 to 7. Use stronger but still practical IELTS language. Focus on precision, development, cohesion, and controlled complex sentences.";
  } else {
    levelInstruction = "The student is already high band. The model answer can be sophisticated, but learning notes must remain practical and explainable.";
  }

  return { currentBand, targetBandModel, targetBandPlus05, targetBandPlus10, levelInstruction };
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
    "This endpoint is generation-only. You are NOT scoring the essay and must NOT change any frozen score.",
    "Use frozen score/current result only as a language-level reference for generating learnable writing.",
    "Generate exactly THREE learning outputs:",
    "1) modelAnswer: a question-based model answer. It can be unrelated to the student's essay and should be only about 0.5 to 1.0 band above the student's current frozen level.",
    "2) revisionPlus05: a revised version based on the student's essay, aiming for about +0.5 band improvement.",
    "3) revisionPlus10: a revised version based on the student's essay, aiming for about +1.0 band improvement.",
    "Do not produce Band 8/9 style language for a Band 5 student. The outputs must be learnable and imitable.",
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
      status: "generated_three_step_learning_outputs",
      scoreChanged: false,
      message: "作文生成完成；生成了题目范文、+0.5 修改版、+1.0 修改版和学习说明。分数没有改变。"
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
    const raw = await callDeepSeek(buildGenerationPrompt(body));
    return sendJson(req, res, 200, normalizeGenerationResult(raw, body));
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: "Essay generation failed", detail: String(error.message || error), system: "essay-generation" });
  }
};

module.exports.config = { maxDuration: 300 };
