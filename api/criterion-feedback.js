const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = process.env.SCORE_FEEDBACK_MODEL || process.env.SCORE_EXAMINER_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const REPAIR_MODEL = process.env.SCORE_FEEDBACK_REPAIR_MODEL || process.env.SCORE_TEACHER_MODEL || "deepseek-v4-pro";
const TEACHER_THINKING = process.env.SCORE_TEACHER_THINKING || "disabled";
const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.SCORE_FEEDBACK_TIMEOUT_MS || process.env.AI_REQUEST_TIMEOUT_MS) || 90000, 180000));
const SYSTEM_VERSION = "criterion-feedback-v10-evidence-led-teacher-voice";

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

function normalizeExamModule(body = {}) {
  const raw = String(body.examModule || body.module || body.testModule || "").toLowerCase();
  return /academic|a\s*类/.test(raw) ? "Academic" : "General Training";
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

async function callDeepSeek(messages, maxTokens = 2500, temperature = 0.15, signal, model = DEFAULT_MODEL) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");
  const controller = new AbortController();
  let cancelledByCaller = false;
  const forwardAbort = () => { cancelledByCaller = true; controller.abort(); };
  if (signal?.aborted) throw Object.assign(new Error("Feedback request was cancelled."), { code: "SCORING_CANCELLED" });
  signal?.addEventListener?.("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" }, thinking: { type: TEACHER_THINKING } }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content || payload?.content || "";
    return {
      data: typeof content === "object" ? content : jsonFromText(content),
      audit: {
        model: payload.model || model,
        usage: payload.usage || null,
        finishReason: payload?.choices?.[0]?.finish_reason || ""
      }
    };
  } catch (error) {
    if (cancelledByCaller || signal?.aborted) throw Object.assign(new Error("Feedback request was cancelled."), { code: "SCORING_CANCELLED" });
    if (error?.name === "AbortError") throw Object.assign(new Error(`Feedback provider timed out after ${REQUEST_TIMEOUT_MS} ms.`), { code: "FEEDBACK_TIMEOUT" });
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", forwardAbort);
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
    "use the evidence box below",
    "more nuanced or original insights",
    "more persuasive argument",
    "lacks surprising insights",
    "not exceptionally innovative"
  ];
  return generic.some((g) => t.includes(g)) && !/[“\"']/.test(text);
}

function hasNonDescriptorBand9Demand(text) {
  const value = String(text || "");
  return /(?:band\s*9|reach\s*9|9\s*分|到\s*9\s*分)[\s\S]{0,180}(?:original|novel|surprising|innovative|more persuasive|more compelling|原创|新颖|令人意外|更有说服力)/i.test(value)
    || /(?:original perspective|surprising insight|historical precedent|cultural resistance|原创视角|令人意外的见解|历史先例|文化阻力)[\s\S]{0,120}(?:band\s*9|9\s*分)/i.test(value)
    || /(?:band\s*9|9\s*分)[\s\S]{0,160}(?:absolute perfection|flawless|no errors|entirely absent|绝对完美|完全没有错误)/i.test(value);
}

function arr(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

function normalizeItem(raw = {}, criterion, band) {
  const item = raw[criterion] && typeof raw[criterion] === "object" ? raw[criterion] : raw;
  const out = {
    feedbackSource: item.feedbackSource || "ai-specific-feedback",
    scoreFrozen: true,
    feedbackCanChangeScore: false,
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
    },
    nextRevision: {
      priority: item.nextRevision?.priority || item.howToImprove || item.improvementFocus || "",
      priorityZh: item.nextRevision?.priorityZh || item.howToImproveZh || item.improvementFocusZh || "",
      action: item.nextRevision?.action || item.howToImprove || item.improvementFocus || "",
      actionZh: item.nextRevision?.actionZh || item.howToImproveZh || item.improvementFocusZh || "",
      beforeQuote: item.nextRevision?.beforeQuote || item.nextRevision?.quote || "",
      revisedExample: item.nextRevision?.revisedExample || item.nextRevision?.after || "",
      whyItWorks: item.nextRevision?.whyItWorks || item.nextRevision?.explanation || "",
      whyItWorksZh: item.nextRevision?.whyItWorksZh || item.nextRevision?.explanationZh || ""
    }
  };
  return out;
}

function validateItem(item, criterion) {
  const texts = [item.whyThisBand, item.whyThisBandZh, item.whyNotLower, item.whyNotLowerZh, item.whyNotHigher, item.whyNotHigherZh, item.howToImprove, item.howToImproveZh, ...arr(item.positiveEvidence), ...arr(item.limitingEvidence)].join("\n");
  if (isGeneric(texts)) throw new Error(`${criterion} feedback is too generic.`);
  if (hasNonDescriptorBand9Demand(texts)) throw new Error(`${criterion} feedback invented a non-descriptor Band-9 requirement.`);
  if (!item.essayEvidence?.some((e) => String(e.quote || "").trim())) throw new Error(`${criterion} feedback lacks direct essay evidence.`);
  if (!item.whyThisBand || !item.whyNotHigher || !item.howToImprove) throw new Error(`${criterion} feedback is incomplete.`);
  if (!item.nextRevision?.action || !item.nextRevision?.revisedExample || !item.nextRevision?.whyItWorks) throw new Error(`${criterion} feedback lacks one concrete, meaning-preserving revision move.`);
}

function taskSpecificInstruction(task, criterion, body = {}) {
  if (task === "Task 1" && criterion === "Task Achievement") {
    if (normalizeExamModule(body) === "Academic") {
      return "Academic Task 1 focus: overview, selection of key features, accurate comparisons, data or process/map coverage, and factual precision against the provided visual-facts layer. Do not discuss letter purpose, tone or bullet points.";
    }
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
  const examModule = normalizeExamModule(body);
  const frozen = body.frozenScore || body.currentResult || body.scoreSnapshot || {};
  const criteria = frozen.finalCriteria || frozen.criteria || body.finalCriteria || body.criteria || {};
  return [
    `You generate REQUIRED post-score IELTS ${examModule} criterion feedback. Return JSON only.`,
    "The score is already frozen. You must NOT change, estimate, lift, lower, or recalculate any band.",
    "Set feedbackSource to \"ai-specific-feedback\". Set scoreFrozen to true and feedbackCanChangeScore to false.",
    `Explain the frozen band using the IELTS ${examModule} Writing 0-9 criterion standards and half-band logic. Do not change the score. Do not exaggerate weaknesses to justify an overly low interpretation; if the band is high-mid, explain the positive evidence clearly.`,
    `System version: ${SYSTEM_VERSION}`,
    `Task: ${task}`,
    `Criterion to explain: ${criterion}`,
    `Frozen band for this criterion: ${Number.isFinite(band) ? band.toFixed(1) : band}`,
    "Half-band explanation rule: explain why this band is stronger than the adjacent lower band and not yet stable at the adjacent higher band. Use exact student evidence.",
    "Full-range rule: every 0.5 step from 0 to 9 is a real descriptor boundary. At x.5, name what securely exceeds the lower whole band and the recurring or material feature that prevents the upper whole band from being dominant.",
    "Criterion differentiation rule: even if all four frozen bands are identical, explain this criterion independently. Do not copy the same reason across TA/TR, CC, LR and GRA.",
    `Frozen criteria snapshot: ${JSON.stringify(criteria)}`,
    taskSpecificInstruction(task, criterion, body),
    "Evidence requirement: use at least TWO short exact quotes or very close phrases from the student's response. Explain what each quote proves.",
    "Non-generic rule: never write generic phrases alone such as 'ideas are general', 'some grammar errors', 'adequate vocabulary', or 'needs more examples'. Tie every point to the student's actual words.",
    "Band-9 calibration rule: originality, novelty, surprising insights, a more persuasive opinion, cultural references, historical precedents and an extended counterargument are not Band-9 requirements by themselves. Never use them as the reason to deny Band 9.",
    "Band-9 accuracy rule: extremely rare lapses remain compatible with Band 9. Never demand absolute perfection, and never cite a sentence as an error after acknowledging that it is correct or acceptable. A conventional transition is not a ceiling unless it visibly disrupts progression.",
    "Teacher-voice rule: describe one observed pattern, its effect on the reader or task, and the exact adjacent-band decision. Do not repeat the same sentence frame across sections.",
    "Revision rule: anchor the next move to one exact quote, preserve the writer's intended meaning, provide one revised example, and explain why that edit improves this criterion. Do not invent a new argument unless missing task coverage is the actual scoring problem.",
    "Bilingual rule: every English field must have a natural Simplified Chinese field that explains the exact same meaning.",
    attempt > 1 ? "This is a retry. The previous answer was too generic or incomplete. Be more specific and include direct quotes." : "",
    `Question prompt:\n${body.questionPrompt || body.promptText || body.prompt || ""}`,
    `Student response:\n${body.essay || ""}`,
    "Return exactly one JSON object with this shape:",
    `{"ok":true,"criterion":"${criterion}","band":${Number.isFinite(band) ? band : 0},"criterionFeedback":{"band":${Number.isFinite(band) ? band : 0},"selectedBand":${Number.isFinite(band) ? band : 0},"candidateBandsConsidered":[${Math.max(0, (band || 0)-0.5)},${band || 0},${Math.min(9, (band || 0)+0.5)}],"summary":"observed pattern and effect","summaryZh":"自然中文判断","whyThisBand":"...","whyThisBandZh":"...","whyNotLower":"...","whyNotLowerZh":"...","whyNotHigher":"one recurring or material text-specific constraint","whyNotHigherZh":"...","howToImprove":"one priority move","howToImproveZh":"...","zhSummary":"...","positiveEvidence":["..."],"positiveEvidenceZh":["..."],"limitingEvidence":["..."],"limitingEvidenceZh":["..."],"essayEvidence":[{"quote":"short exact quote","meaning":"what this quote proves for ${criterion}","meaningZh":"中文解释"}],"halfBandDecision":{"whyAboveLowerBand":"...","whyAboveLowerBandZh":"...","whyBelowUpperBand":"...","whyBelowUpperBandZh":"...","whyExactBand":"...","whyExactBandZh":"..."},"nextRevision":{"priority":"...","priorityZh":"...","action":"one concrete edit","actionZh":"...","beforeQuote":"exact quote","revisedExample":"meaning-preserving revision","whyItWorks":"criterion-specific effect","whyItWorksZh":"..."}}}`
  ].filter(Boolean).join("\n\n");
}

function buildBatchPrompt(body, criteria, attempt) {
  const task = normalizeRequestedTask(body);
  const examModule = normalizeExamModule(body);
  const frozen = body.frozenScore || body.currentResult || body.scoreSnapshot || {};
  const frozenCriteria = frozen.finalCriteria || frozen.criteria || body.finalCriteria || body.criteria || {};
  const contract = Object.fromEntries(criteria.map((criterion) => {
    const band = Number(frozenCriteria[criterion] || 0);
    return [criterion, {
      band,
      selectedBand: band,
      candidateBandsConsidered: [Math.max(0, band - 0.5), band, Math.min(9, band + 0.5)],
      summary: "...",
      summaryZh: "...",
      whyThisBand: "...",
      whyThisBandZh: "...",
      whyNotLower: "...",
      whyNotLowerZh: "...",
      whyNotHigher: "...",
      whyNotHigherZh: "...",
      howToImprove: "...",
      howToImproveZh: "...",
      positiveEvidence: ["..."],
      positiveEvidenceZh: ["..."],
      limitingEvidence: ["..."],
      limitingEvidenceZh: ["..."],
      essayEvidence: [
        { quote: "exact short quote", meaning: "criterion-specific explanation", meaningZh: "对应的中文解释" },
        { quote: "second exact short quote", meaning: "criterion-specific explanation", meaningZh: "对应的中文解释" }
      ],
      nextRevision: {
        priority: "one criterion-specific priority",
        priorityZh: "一项优先修改",
        action: "one concrete edit anchored to the response",
        actionZh: "基于原文的一项具体修改",
        beforeQuote: "exact short quote",
        revisedExample: "meaning-preserving revised sentence",
        whyItWorks: "how this edit changes the criterion evidence",
        whyItWorksZh: "为什么这次修改能改善该项"
      }
    }];
  }));
  return [
    `You generate REQUIRED post-score IELTS ${examModule} feedback for all four criteria in one response. Return JSON only.`,
    "The four bands are already frozen. Never estimate, recalculate, lift, lower or replace any band.",
    "Write every criterion independently from its own evidence. Do not copy one explanation across criteria even when bands match.",
    "For every criterion provide a concise diagnosis, both adjacent-band comparisons, one priority improvement, and at least two short exact quotes from the candidate response.",
    "Treat every 0.5 step from 0 to 9 as a real boundary. For x.5, explain both the secure lower-band evidence and the recurring or material gap to the upper band.",
    "Do not require originality, novelty, surprising insights, a more persuasive opinion, cultural references, historical precedents or an extended counterargument for Band 9. If a criterion remains below 9, identify a recurring or material incompatibility visible in the response.",
    "Band 9 permits extremely rare lapses. Do not demand absolute perfection or treat a conventional transition as a ceiling without explaining its actual harmful effect.",
    "Write like an experienced teacher discussing this particular response: observed pattern, effect, boundary decision, then one concrete meaning-preserving edit. Vary sentence openings across criteria and do not paste mirrored boilerplate.",
    "Every English explanation must have a natural Simplified Chinese counterpart. Be specific and useful rather than long.",
    "Do not create a full rewritten essay.",
    `System version: ${SYSTEM_VERSION}`,
    `Task: ${task}`,
    `Frozen criteria: ${JSON.stringify(frozenCriteria)}`,
    `Criterion lenses: ${JSON.stringify(Object.fromEntries(criteria.map((criterion) => [criterion, taskSpecificInstruction(task, criterion, body)])))}`,
    attempt > 1 ? "QUALITY RETRY: The previous batch was incomplete or generic. Return all four exact criterion keys with direct response evidence." : "",
    `Question prompt:\n${body.questionPrompt || body.promptText || body.prompt || ""}`,
    `Candidate response:\n${body.essay || ""}`,
    `Return exactly one object shaped as: ${JSON.stringify({ ok: true, criterionCalibration: contract })}`
  ].filter(Boolean).join("\n\n");
}

async function generateCriterion(body, criterion, signal) {
  const task = normalizeRequestedTask(body);
  const canonical = canonicalCriterion(criterion, task);
  if (!canonical) throw new Error(`Invalid criterion for ${task}: ${criterion}`);
  const band = bandFromBody(body, canonical);
  if (!Number.isFinite(band)) throw new Error(`Missing frozen band for ${canonical}.`);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const call = await callDeepSeek([
        { role: "system", content: `You are an IELTS ${normalizeExamModule(body)} examiner feedback writer. Return only valid JSON. Do not change scores.` },
        { role: "user", content: buildPrompt(body, canonical, band, attempt) }
      ], 3200, attempt === 1 ? 0.15 : 0.05, signal, attempt === 1 ? DEFAULT_MODEL : REPAIR_MODEL);
      const ai = call.data;
      const item = normalizeItem(ai.criterionFeedback || ai.feedback || ai, canonical, band);
      validateItem(item, canonical);
      return { item, audit: { ...call.audit, attempt } };
    } catch (error) {
      if (error?.code === "SCORING_CANCELLED" || error?.code === "FEEDBACK_TIMEOUT") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`${canonical} feedback generation failed.`);
}

async function generateAllCriteria(body, criteria, signal) {
  let lastError = null;
  const auditHistory = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const model = attempt === 1 ? DEFAULT_MODEL : REPAIR_MODEL;
      const call = await callDeepSeek([
        { role: "system", content: `You are an IELTS ${normalizeExamModule(body)} feedback editor. Return one complete four-criterion JSON object. Frozen bands cannot change.` },
        { role: "user", content: buildBatchPrompt(body, criteria, attempt) }
      ], attempt === 1 ? 7600 : 9000, attempt === 1 ? 0.12 : 0.04, signal, model);
      auditHistory.push({ ...call.audit, attempt });
      const raw = call.data?.criterionCalibration || call.data?.criteria || call.data?.criterionFeedback || {};
      const criterionCalibration = {};
      for (const criterion of criteria) {
        const band = bandFromBody(body, criterion);
        if (!raw[criterion] || typeof raw[criterion] !== "object") throw new Error(`Batch feedback is missing ${criterion}.`);
        const item = normalizeItem(raw[criterion], criterion, band);
        validateItem(item, criterion);
        criterionCalibration[criterion] = item;
      }
      return { criterionCalibration, auditHistory, fallbackUsed: attempt > 1 };
    } catch (error) {
      if (error?.code === "SCORING_CANCELLED" || error?.code === "FEEDBACK_TIMEOUT") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("Four-criterion batch feedback generation failed.");
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  const requestController = new AbortController();
  const abortPendingWork = () => { if (!res.writableEnded) requestController.abort(); };
  req.once?.("aborted", abortPendingWork);
  res.once?.("close", abortPendingWork);
  try {
    const body = await readJsonBody(req);
    const task = normalizeRequestedTask(body);
    const requested = canonicalCriterion(body.criterion || body.criterionName, task);
    const criteria = requested ? [requested] : criteriaForTask(task);
    const criterionCalibration = {};
    const generated = [];
    const modelAudit = [];
    let fallbackUsed = false;
    if (requested) {
      const result = await generateCriterion(body, requested, requestController.signal);
      criterionCalibration[requested] = result.item;
      generated.push(requested);
      modelAudit.push(result.audit);
    } else {
      const result = await generateAllCriteria(body, criteria, requestController.signal);
      Object.assign(criterionCalibration, result.criterionCalibration);
      generated.push(...criteria);
      modelAudit.push(...result.auditHistory);
      fallbackUsed = result.fallbackUsed;
    }
    return sendJson(req, res, 200, {
      ok: true,
      aiStage: requested ? "required-criterion-feedback" : "required-criterion-feedback-batch",
      feedbackSystemVersion: SYSTEM_VERSION,
      task,
      generatedCriteria: generated,
      criterionCalibration,
      modelAudit,
      costOptimization: {
        batchMode: !requested,
        primaryModel: DEFAULT_MODEL,
        repairModel: REPAIR_MODEL,
        fallbackUsed,
        aiCalls: modelAudit.length
      },
      feedbackSource: "ai-specific-feedback",
      scoreFrozen: true,
      feedbackCanChangeScore: false,
      feedbackStatus: {
        status: "generated_required_external",
        scoreChanged: false,
        feedbackSource: "ai-specific-feedback",
        note: "Required detailed criterion feedback generated by separate endpoint after score freeze. Frozen score was not changed."
      }
    });
  } catch (error) {
    return sendJson(req, res, 502, {
      ok: false,
      aiStage: "required-criterion-feedback",
      feedbackSystemVersion: SYSTEM_VERSION,
      feedbackSource: "fallback-template",
      warning: "AI detailed feedback unavailable.",
      scoreFrozen: true,
      feedbackCanChangeScore: false,
      error: "Required criterion feedback failed",
      detail: String(error.message || error)
    });
  } finally {
    req.removeListener?.("aborted", abortPendingWork);
    res.removeListener?.("close", abortPendingWork);
  }
};

module.exports._test = {
  buildBatchPrompt,
  generateAllCriteria,
  normalizeItem,
  validateItem
};
