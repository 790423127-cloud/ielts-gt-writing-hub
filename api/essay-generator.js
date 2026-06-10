const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const GENERATOR_VERSION = "essay-generator-v1-0-independent-task-locked";
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
  const prompt = body.questionPrompt || body.prompt || body.promptText || "";
  const essay = String(body.essay || "").trim();
  const taskSpecific = task === "Task 1"
    ? "Generate GT Task 1 letter practice output: clear purpose, suitable opening/closing, correct tone/register, and full bullet coverage."
    : "Generate GT Task 2 essay practice output: clear position when needed, logical body paragraphs, developed reasons/examples, and a concise conclusion.";
  const revisedInstruction = essay
    ? "Also generate a revisedEssay that improves the student's original response while preserving meaning and staying learner-realistic."
    : "No student essay was provided, so revisedEssay should be an empty string and the modelAnswer should be the main useful output.";
  return [
    "You are an IELTS General Training Writing essay-generation tutor.",
    "This endpoint is generation-only. You are NOT scoring the essay.",
    "Do not change, estimate, mention, recommend, or recalculate any IELTS score or criterion band.",
    "The selected task is locked by the request. Do not reclassify Task 1 and Task 2. If the user's writing style resembles another task, still generate for the locked task.",
    taskSpecific,
    revisedInstruction,
    "Use practical IELTS learner language. Avoid over-advanced, literary, or native-speaker-only expressions unless the frozen score clearly suggests a high-band learner.",
    "If frozen score context exists, use it only to choose a realistic language level. Never modify or recalculate it.",
    "Return strict JSON only. No markdown, no code fences, no comments, no trailing prose.",
    "Return exactly this shape:",
    JSON.stringify({
      ok: true,
      aiStage: "essay-generator",
      task,
      generationOnly: true,
      scoreUnaffected: true,
      modelAnswerOutline: "...",
      modelAnswer: "...",
      revisedEssay: essay ? "..." : ""
    }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Title: ${body.title || ""}`,
    `Prompt: ${clipText(prompt, 2200)}`,
    `Frozen score/current result for level reference only: ${JSON.stringify({ frozenScore: context.frozenScore, currentResult: context.currentResult ? { task: context.currentResult.task, overallBand: context.currentResult.overallBand || context.currentResult.scoreCalculation?.finalBand, criteria: context.currentResult.finalCriteria || context.currentResult.criteria } : null })}`,
    `Essay word count: ${countWords(essay)}`,
    "Student essay:",
    clipText(essay, 6500)
  ].join("\n\n");
}

function normalizeGenerationResult(raw = {}, body = {}) {
  const task = normalizeRequestedTask(body);
  const context = safeFrozenContext(body);
  const result = raw && typeof raw === "object" ? raw : {};
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
    modelAnswerOutline: String(result.modelAnswerOutline || result.outline || "").trim(),
    modelAnswer: String(result.modelAnswer || result.answer || result.sampleAnswer || "").trim(),
    revisedEssay: String(result.revisedEssay || result.revision || result.improvedEssay || "").trim(),
    systemFeedback: {
      system: "essay-generation",
      status: "generated",
      scoreChanged: false,
      message: "作文生成完成；没有调用评分流程，也没有改变已冻结分数。"
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
        temperature: 0.25,
        max_tokens: 4500,
        messages: [
          { role: "system", content: "Return strict JSON only. Generate IELTS practice writing only. Never score or change any score." },
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
