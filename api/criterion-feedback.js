const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const SYSTEM_VERSION = "criterion-feedback-v8-4-5-exam-realistic-explanations";

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(req, res, status, payload) {
  setCors(req, res);
  res.status(status).json(payload);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeRequestedTask(body = {}) {
  const raw = String(body.task || body.taskType || body.scoringTask || body.requestedTask || body.selectedTask || body.feedbackTask || "").toLowerCase();
  if (/task\s*1|task1|letter|gt\s*letter/.test(raw)) return "Task 1";
  if (/task\s*2|task2|essay/.test(raw)) return "Task 2";
  return "Task 2";
}

function criteriaForTask(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function canonicalCriterion(name, task) {
  const raw = String(name || "").toLowerCase();
  const criteria = criteriaForTask(task);
  if (/task\s*achievement|^ta$/.test(raw)) return task === "Task 1" ? "Task Achievement" : "";
  if (/task\s*response|^tr$/.test(raw)) return task === "Task 2" ? "Task Response" : "";
  if (/coherence|cohesion|^cc$/.test(raw)) return "Coherence and Cohesion";
  if (/lexical|vocabulary|^lr$/.test(raw)) return "Lexical Resource";
  if (/grammar|grammatical|accuracy|^gra$/.test(raw)) return "Grammatical Range and Accuracy";
  return criteria.includes(name) ? name : "";
}

function jsonFromText(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  throw new Error("AI feedback did not return valid JSON.");
}

async function callDeepSeek(messages, maxTokens = 2500, temperature = 0.15) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" } }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content || payload?.content || "";
    return typeof content === "object" ? content : jsonFromText(content);
  } finally {
    clearTimeout(timeout);
  }
}

function bandFromBody(body, criterion) {
  const frozen = body.frozenScore || body.currentResult || body.scoreSnapshot || {};
  const criteria = frozen.finalCriteria || frozen.criteria || body.finalCriteria || body.criteria || {};
  return Number(criteria[criterion] ?? body.criterionBand ?? body.band ?? 0);
}

function isGeneric(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return true;
  const generic = [
    "clear position but lacks depth",
    "ideas are general",
    "needs more specific reasoning",
    "some grammatical errors",
    "adequate vocabulary",
    "coherence is generally clear",
    "task evidence shown in the response",
    "use the evidence box below"
  ];
  return generic.some((g) => t.includes(g)) && !/[“\"']/.test(text);
}

function arr(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

function normalizeItem(raw = {}, criterion, band) {
  const item = raw[criterion] && typeof raw[criterion] === "object" ? raw[criterion] : raw;
  const out = {
    band,
    selectedBand: band,
    candidateBandsConsidered: Array.isArray(item.candidateBandsConsidered) ? item.candidateBandsConsidered : [Math.max(0, band - 0.5), band, Math.min(9, band + 0.5)],
    summary: item.summary || item.whyThisBand || "",
    summaryZh: item.summaryZh || item.whyThisBandZh || "",
    whyThisBand: item.whyThisBand || item.whyExactBand || item.summary || "",
    whyThisBandZh: item.whyThisBandZh || item.whyExactBandZh || item.summaryZh || "",
    whyNotLower: item.whyNotLower || item.whyAboveLowerBand || "",
    whyNotLowerZh: item.whyNotLowerZh || item.whyAboveLowerBandZh || "",
    whyNotHigher: item.whyNotHigher || item.whyBelowUpperBand || "",
    whyNotHigherZh: item.whyNotHigherZh || item.whyBelowUpperBandZh || "",
    howToImprove: item.howToImprove || item.improvementFocus || "",
    howToImproveZh: item.howToImproveZh || item.improvementFocusZh || "",
    zhSummary: item.zhSummary || "",
    positiveEvidence: arr(item.positiveEvidence || item.supportingEvidence).slice(0, 3),
    positiveEvidenceZh: arr(item.positiveEvidenceZh || item.supportingEvidenceZh).slice(0, 3),
    limitingEvidence: arr(item.limitingEvidence || item.limitsHigherBand).slice(0, 3),
    limitingEvidenceZh: arr(item.limitingEvidenceZh || item.limitsHigherBandZh).slice(0, 3),
    essayEvidence: arr(item.essayEvidence || item.textEvidence || item.evidenceQuotes).slice(0, 4).map((entry) => {
      if (typeof entry === "string") return { quote: entry, meaning: entry, meaningZh: "原文证据用于支持该项评分判断。" };
      return {
        quote: entry.quote || entry.text || entry.original || "",
        meaning: entry.meaning || entry.explanation || entry.evidence || "",
        meaningZh: entry.meaningZh || entry.explanationZh || entry.evidenceZh || entry.translationZh || ""
      };
    }),
    halfBandDecision: {
      whyAboveLowerBand: item.halfBandDecision?.whyAboveLowerBand || item.whyNotLower || item.whyAboveLowerBand || "",
      whyAboveLowerBandZh: item.halfBandDecision?.whyAboveLowerBandZh || item.whyNotLowerZh || item.whyAboveLowerBandZh || "",
      whyBelowUpperBand: item.halfBandDecision?.whyBelowUpperBand || item.whyNotHigher || item.whyBelowUpperBand || "",
      whyBelowUpperBandZh: item.halfBandDecision?.whyBelowUpperBandZh || item.whyNotHigherZh || item.whyBelowUpperBandZh || "",
      whyExactBand: item.halfBandDecision?.whyExactBand || item.whyThisBand || item.summary || "",
      whyExactBandZh: item.halfBandDecision?.whyExactBandZh || item.whyThisBandZh || item.summaryZh || ""
    }
  };
  return out;
}

function validateItem(item, criterion) {
  const texts = [item.whyThisBand, item.whyNotLower, item.whyNotHigher, item.howToImprove, ...arr(item.positiveEvidence), ...arr(item.limitingEvidence)].join("\n");
  if (isGeneric(texts)) throw new Error(`${criterion} feedback is too generic.`);
  if (!item.essayEvidence?.some((e) => String(e.quote || "").trim())) throw new Error(`${criterion} feedback lacks direct essay evidence.`);
  if (!item.whyThisBand || !item.whyNotHigher || !item.howToImprove) throw new Error(`${criterion} feedback is incomplete.`);
}

function taskSpecificInstruction(task, criterion) {
  if (task === "Task 1" && criterion === "Task Achievement") {
    return "Task 1 focus: letter purpose, required bullet points, tone/register, reader needs, and whether the request/apology/complaint/invitation/explanation is complete. Do not discuss opinion/reasons as Task Response.";
  }
  if (task === "Task 2" && criterion === "Task Response") {
    return "Task 2 focus: position, answer to the question, idea development, reasons, examples, and conclusion. Do not discuss letter bullet points or letter purpose.";
  }
  if (criterion === "Coherence and Cohesion") return "Focus on paragraphing, progression, sentence-to-sentence logic, referencing, repetition, and linking accuracy.";
  if (criterion === "Lexical Resource") return "Focus on spelling, word choice, collocation, topic vocabulary, word form, repetition, and register.";
  if (criterion === "Grammatical Range and Accuracy") return "Focus on sentence control, verb forms, agreement, articles, plurals, clauses, punctuation, fragments, and run-ons.";
  return "Focus only on this IELTS criterion.";
}

function buildPrompt(body, criterion, band, attempt) {
  const task = normalizeRequestedTask(body);
  const frozen = body.frozenScore || body.currentResult || body.scoreSnapshot || {};
  const criteria = frozen.finalCriteria || frozen.criteria || body.finalCriteria || body.criteria || {};
  return [
    "You generate REQUIRED post-score IELTS General Training criterion feedback. Return JSON only.",
    "The score is already frozen. You must NOT change, estimate, lift, lower, or recalculate any band.",
    "Explain the frozen band using real IELTS GT standards. Do not exaggerate weaknesses to justify an overly low interpretation; if the band is high-mid, explain the positive evidence clearly.",
    `System version: ${SYSTEM_VERSION}`,
    `Task: ${task}`,
    `Criterion to explain: ${criterion}`,
    `Frozen band for this criterion: ${Number.isFinite(band) ? band.toFixed(1) : band}`,
    `Frozen criteria snapshot: ${JSON.stringify(criteria)}`,
    taskSpecificInstruction(task, criterion),
    "Evidence requirement: use at least TWO short exact quotes or very close phrases from the student's response. Explain what each quote proves.",
    "Non-generic rule: never write generic phrases alone such as 'ideas are general', 'some grammar errors', 'adequate vocabulary', or 'needs more examples'. Tie every point to the student's actual words.",
    "Bilingual rule: every English field must have a natural Simplified Chinese field that explains the exact same meaning.",
    attempt > 1 ? "This is a retry. The previous answer was too generic or incomplete. Be more specific and include direct quotes." : "",
    `Question prompt:\n${body.questionPrompt || body.promptText || body.prompt || ""}`,
    `Student response:\n${body.essay || ""}`,
    "Return exactly one JSON object with this shape:",
    `{"ok":true,"criterion":"${criterion}","band":${Number.isFinite(band) ? band : 0},"criterionFeedback":{"band":${Number.isFinite(band) ? band : 0},"selectedBand":${Number.isFinite(band) ? band : 0},"candidateBandsConsidered":[${Math.max(0, (band || 0)-0.5)},${band || 0},${Math.min(9, (band || 0)+0.5)}],"summary":"...","summaryZh":"...","whyThisBand":"...","whyThisBandZh":"...","whyNotLower":"...","whyNotLowerZh":"...","whyNotHigher":"...","whyNotHigherZh":"...","howToImprove":"...","howToImproveZh":"...","zhSummary":"...","positiveEvidence":["..."],"positiveEvidenceZh":["..."],"limitingEvidence":["..."],"limitingEvidenceZh":["..."],"essayEvidence":[{"quote":"short exact quote","meaning":"what this quote proves for ${criterion}","meaningZh":"中文解释"}],"halfBandDecision":{"whyAboveLowerBand":"...","whyAboveLowerBandZh":"...","whyBelowUpperBand":"...","whyBelowUpperBandZh":"...","whyExactBand":"...","whyExactBandZh":"..."}}}`
  ].filter(Boolean).join("\n\n");
}

async function generateCriterion(body, criterion) {
  const task = normalizeRequestedTask(body);
  const canonical = canonicalCriterion(criterion, task);
  if (!canonical) throw new Error(`Invalid criterion for ${task}: ${criterion}`);
  const band = bandFromBody(body, canonical);
  if (!Number.isFinite(band)) throw new Error(`Missing frozen band for ${canonical}.`);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const ai = await callDeepSeek([
        { role: "system", content: "You are an IELTS GT examiner feedback writer. Return only valid JSON. Do not change scores." },
        { role: "user", content: buildPrompt(body, canonical, band, attempt) }
      ], 3200, attempt === 1 ? 0.15 : 0.05);
      const item = normalizeItem(ai.criterionFeedback || ai.feedback || ai, canonical, band);
      validateItem(item, canonical);
      return item;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${canonical} feedback generation failed.`);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  try {
    const body = await readJsonBody(req);
    const task = normalizeRequestedTask(body);
    const requested = canonicalCriterion(body.criterion || body.criterionName, task);
    const criteria = requested ? [requested] : criteriaForTask(task);
    const criterionCalibration = {};
    const generated = [];
    for (const criterion of criteria) {
      criterionCalibration[criterion] = await generateCriterion(body, criterion);
      generated.push(criterion);
    }
    return sendJson(req, res, 200, {
      ok: true,
      aiStage: "required-criterion-feedback",
      feedbackSystemVersion: SYSTEM_VERSION,
      task,
      generatedCriteria: generated,
      criterionCalibration,
      feedbackStatus: {
        status: "generated_required_external",
        scoreChanged: false,
        note: "Required detailed criterion feedback generated by separate endpoint after score freeze. Frozen score was not changed."
      }
    });
  } catch (error) {
    return sendJson(req, res, 502, {
      ok: false,
      aiStage: "required-criterion-feedback",
      feedbackSystemVersion: SYSTEM_VERSION,
      error: "Required criterion feedback failed",
      detail: String(error.message || error)
    });
  }
}
