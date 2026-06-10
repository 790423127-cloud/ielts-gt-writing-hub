const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const SCORE_SYSTEM_VERSION = "score-core-v8-5-14-highband-near9-router-anti-inflation";
const DISCLAIMER = "This is an AI-generated estimated IELTS high-band shadow score, not an official IELTS score.";
const VALID_BANDS = [0, ...Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(req, res, status, payload) {
  setCors(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_500_000) {
        const error = new Error("Request body too large");
        error.status = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch {
        const error = new Error("Invalid JSON body");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function wordCount(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
}

function normalizeTask(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("1") || s.includes("letter") || s === "task1") return "Task 1";
  if (s.includes("2") || s.includes("essay") || s === "task2") return "Task 2";
  return "Task 2";
}

function criterionNames(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function isValidBand(value) {
  const n = Number(value);
  return Number.isFinite(n) && VALID_BANDS.some((b) => Math.abs(b - n) < 0.001);
}

function roundHalf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9, Math.round(n * 2) / 2));
}

function averageBand(criteria, task) {
  const names = criterionNames(task);
  const values = names.map((name) => Number(criteria?.[name]));
  if (values.some((v) => !Number.isFinite(v))) return null;
  return roundHalf(values.reduce((a, b) => a + b, 0) / values.length);
}

function extractJson(text) {
  const s = String(text || "").trim();
  try { return JSON.parse(s); } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  throw new Error("AI did not return valid JSON");
}

function validateCriteria(criteria, task) {
  const out = {};
  for (const name of criterionNames(task)) {
    const n = Number(criteria?.[name]);
    if (!isValidBand(n)) throw new Error(`Invalid or missing criterion band: ${name}`);
    out[name] = n;
  }
  return out;
}

function asText(value) {
  try { return JSON.stringify(value || "").toLowerCase(); }
  catch { return String(value || "").toLowerCase(); }
}

function highBandPrompt(task, questionPrompt, essay) {
  const names = criterionNames(task);
  const wc = wordCount(essay);

  const taskNotes = task === "Task 1" ? [
    "Task 1 high-band calibration: judge whether the letter is fully effective communication, not merely complete format.",
    "Band 7.5: clear, complete and controlled, but there may still be mechanical phrasing, ordinary detail, or limited naturalness.",
    "Band 8: fully covers all bullet points with skilful relevant detail; tone/register are consistently appropriate; cohesion is smooth; errors are rare and minor.",
    "Band 8.5: highly natural, precise and purposeful; details are very well judged; language is fluent, varied and nearly effortless; errors are rare and unobtrusive.",
    "Band 9: fully effective natural communication. It does not require literary genius or superhuman complexity. It means the task is handled completely and naturally, with virtually no language limitation, no visible template feel, and only negligible slips if any.",
    "Task 1 warning: do not hold a concise, natural, fully effective letter at Band 8 merely because it is direct or practical. A concise GT letter can be 9 if it is fully fit for purpose."
  ] : [
    "Task 2 high-band calibration: judge depth, nuance, precision, progression, and how naturally the argument develops.",
    "Band 7.5: well-developed and coherent, but some ideas may be predictable, some progression mechanical, or some language choices not consistently sophisticated.",
    "Band 8: fully addresses the question with relevant, extended and well-supported ideas; progression is logical and fluent; vocabulary is precise; grammar is flexible with rare minor errors.",
    "Band 8.5: nuanced, mature argument with strong control of emphasis and qualification; cohesion is natural; lexical choices are precise and idiomatic; errors are rare and insignificant.",
    "Band 9: complete, sophisticated and fully effective. It does not require a published academic article or perfect literary style. It means seamless progression, precise reasoning, natural academic control, and virtually no language limitation."
  ];

  return [
    "You are the HIGH-BAND SHADOW IELTS General Training Writing examiner.",
    "This endpoint is separate from production scoring. It exists only to test Band 7.5-9.0 calibration. Return JSON only.",
    `Locked task: ${task}. Criteria keys must be exactly: ${JSON.stringify(names)}.`,
    "Use IELTS bands 0-9 in 0.5 increments. Focus on accurate separation of 7.5, 8.0, 8.5 and 9.0.",
    "AI-only rule: choose all bands yourself from the prompt and response. Do not apply a local cap, floor, lift, or penalty. The server will only validate and mechanically average your four criterion bands.",
    "Do not automatically cap excellent writing at Band 8. Band 9 is rare, but it is allowed when the criteria are met.",
    "Band 9 does not mean superhuman writing. It means fully effective, natural, precise, fluent, and virtually error-free IELTS writing for the task.",
    "If all four criteria are clearly at 8.5-9 descriptor level, award 8.5 or 9 instead of defaulting to 8.",
    "If a response is excellent but has only minor limitations, use 8.5. If it is fully effective with no meaningful language limitation, use 9.",
    "Do not inflate ordinary polished writing: length, formal tone, paragraphing, or advanced-looking vocabulary alone does not justify 8.5 or 9.",
    "If there is noticeable repetition, generic development, template phrasing, awkward collocation, or frequent minor errors, 7.0-7.5 is usually more appropriate than 8.5-9.",
    "High-band scoring anchors: 7.5 = strong but visibly limited; 8 = very strong with minor limitations; 8.5 = near-native task control with rare insignificant slips; 9 = fully effective and virtually limitation-free for IELTS purposes.",
    ...taskNotes,
    `Word count: ${wc}. Remember: word count alone does not justify a high band.`,
    `Question prompt:\n${questionPrompt || ""}`,
    `Student response:\n${essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"highband-main-score\",\"task\":\"Task 1 or Task 2\",\"highBandDecision\":\"band_7_or_7_5_or_8_or_8_5_or_9\",\"candidateRange\":\"x-y\",\"criteria\":{...four numeric criterion bands...},\"reasonCodes\":{\"Criterion Name\":[\"short_code\",\"short_code\"]},\"highBandAudit\":{\"wordCountRewarded\":false,\"templateInflated\":false,\"matureControl\":boolean,\"preciseLexis\":boolean,\"developmentDepth\":boolean,\"naturalCohesion\":boolean,\"band9Considered\":true,\"whyNotHigher\":[\"short_code\"],\"whyNotLower\":[\"short_code\"]}}"
  ].join("\n\n");
}

function exact9ReviewPrompt(task, questionPrompt, essay, firstResult, routeReason) {
  const names = criterionNames(task);
  const wc = wordCount(essay);
  const firstCriteria = firstResult.criteria || {};
  const firstAudit = firstResult.parsed?.highBandAudit || {};
  const firstBand = firstResult.finalBand;

  const taskSpecific = task === "Task 1" ? [
    "Task 1 near-9 review:",
    "A GT letter can be Band 9 without academic complexity or rare vocabulary if it is fully effective, naturally phrased, precisely detailed, appropriately toned, and virtually error-free.",
    "Do not demote a concise letter just because it is direct, practical, or not 'sophisticated'.",
    "If the first pass gave Band 8 but all strong high-band audit signals are present, re-evaluate independently rather than anchoring to 8.",
    "Promote to 9 only if the response is a finished, natural, fully appropriate real-world letter with no meaningful communicative or linguistic limitation.",
    "Keep at 8.5 if the letter is excellent but still shows slight stiffness, visible template feeling, generic detail, or noticeable lexical repetition."
  ] : [
    "Task 2 near-9 review:",
    "Task 2 Band 9 requires complete argument control, mature qualification, seamless progression, and virtually no language limitation.",
    "Do not promote to 9 if the essay is merely polished, balanced, and coherent but still somewhat predictable, generic, repetitive, or only conventionally developed.",
    "If the first pass gave Band 8 but all strong high-band audit signals are present, re-evaluate independently, but remain stricter than Task 1.",
    "A strong but not fully exceptional Task 2 answer should remain 8.5.",
    "Promote to 9 only when the reasoning is precise and mature across the whole essay, not merely generally strong."
  ];

  return [
    "You are the NEAR-9 / EXACT-9 REVIEW examiner for IELTS General Training Writing.",
    "This is a second-pass AI-only review. The first high-band pass has already provided criteria and audit signals.",
    "Your job is to decide whether the first-pass high result should remain below 9 or become genuine 9.",
    `Route reason: ${routeReason}.`,
    `Locked task: ${task}. Criteria keys must be exactly: ${JSON.stringify(names)}.`,
    `First-pass final band: ${firstBand}.`,
    `First-pass criteria: ${JSON.stringify(firstCriteria)}.`,
    `First-pass highBandAudit: ${JSON.stringify(firstAudit)}.`,
    "Band 9 does NOT mean superhuman, literary, or impossibly perfect writing.",
    "Band 9 DOES mean fully effective task fulfilment, natural and precise progression, highly flexible language, and virtually no meaningful limitation for IELTS purposes.",
    "If there are only negligible slips that do not affect naturalness or control, Band 9 may still be justified.",
    "If the response is excellent but has any visible limitation in detail, naturalness, precision, sophistication, or development, keep it at 8.5.",
    "Do NOT promote to 9 because of length, formality, paragraphing, or advanced-looking vocabulary.",
    "If this looks like a strong 8.5 rather than unmistakable 9, return keep_8_5 and 8.5-level criteria.",
    "v8.5.14 anti-inflation rule: if the first pass was exactly Band 8, do not jump to all-9 criteria unless the first pass is clearly and substantially too harsh.",
    "v8.5.14 anti-inflation rule: a response that is merely clear, complete, polite, fluent, or well organised must not be promoted from 8 directly to 9.",
    "v8.5.14 anti-inflation rule: for Task 1, a real Band 9 letter should be both fully effective and naturally precise; do not promote ordinary strong Band 8 letters because they are concise and correct.",
    "Do not use all-9 criteria unless the response is genuinely limitation-free for IELTS purposes.",
    "Before promote_to_9, identify why each of the four criteria deserves 9, not just why the writing is excellent.",
    "Do promote to 9 if all four criteria genuinely meet 9-level performance and the response is fully effective for the task.",
    ...taskSpecific,
    `Word count: ${wc}.`,
    `Question prompt:\n${questionPrompt || ""}`,
    `Student response:\n${essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"near9-exact9-review\",\"task\":\"Task 1 or Task 2\",\"exact9Decision\":\"promote_to_9 or keep_8_5\",\"criteria\":{...four numeric criterion bands...},\"exact9Audit\":{\"promoted\":boolean,\"fullyEffective\":boolean,\"virtuallyNoLimitation\":boolean,\"naturalPrecision\":boolean,\"seamlessProgression\":boolean,\"negligibleSlipsOnly\":boolean,\"whyPromote\":[\"short_code\"],\"whyKeepAt85\":[\"short_code\"],\"criterion9Justification\":{\"Criterion Name\":\"short_reason\"}}}"
  ].join("\n\n");
}

async function callDeepSeek(messages, temperature = 0.12) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("Missing DEEPSEEK_API_KEY environment variable");
    error.status = 500;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature,
        response_format: { type: "json_object" },
        messages
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!response.ok) {
      const detail = data?.error?.message || text.slice(0, 800);
      const error = new Error(`DeepSeek API error ${response.status}: ${detail}`);
      error.status = 502;
      throw error;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek response missing message content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function runMainHighBandPass(task, questionPrompt, essay) {
  const prompt = highBandPrompt(task, questionPrompt, essay);
  const content = await callDeepSeek([
    { role: "system", content: "You are a strict IELTS General Training Writing high-band and Band 9 calibration examiner. Return JSON only." },
    { role: "user", content: prompt }
  ], 0.12);

  const parsed = extractJson(content);
  const criteria = validateCriteria(parsed.criteria, task);
  const finalBand = averageBand(criteria, task);
  if (finalBand == null) throw new Error("Could not calculate final band from criteria");
  return { parsed, criteria, finalBand };
}

function highBandSignalCount(firstResult) {
  const audit = firstResult.parsed?.highBandAudit || {};
  return [
    audit.matureControl,
    audit.preciseLexis,
    audit.developmentDepth,
    audit.naturalCohesion,
    audit.band9Considered
  ].filter(Boolean).length;
}

function onlySoftMinorObjections(firstResult) {
  const audit = firstResult.parsed?.highBandAudit || {};
  const why = asText(audit.whyNotHigher || []);
  if (!why || why === '""' || why === "[]") return false;

  const softWords = ["minor", "slight", "negligible", "small", "limited", "could", "some"];
  const hardWords = ["generic", "repetition", "repetitive", "predictable", "template", "awkward", "error", "errors", "unclear", "incomplete", "underdeveloped", "weak", "mechanical"];

  const hasSoft = softWords.some((w) => why.includes(w));
  const hasHard = hardWords.some((w) => why.includes(w));
  return hasSoft && !hasHard;
}

function shouldTriggerExact9Review(task, firstResult) {
  if (!firstResult) return { triggered: false, reason: "no-first-pass" };

  const signals = highBandSignalCount(firstResult);

  // Standard v8.5.12/v8.5.10 route: 8.5+ with strong signals.
  if (firstResult.finalBand >= 8.5 && signals >= 4) {
    return { triggered: true, reason: "standard-8-5-plus-strong-signal" };
  }

  // v8.5.14 routing:
  // Near-9 samples may be held at 8 despite strong audit signals, but ordinary Band 8 must not be promoted.
  // This route only sends them to a second AI review; it does not change the score.
  if (firstResult.finalBand === 8 && signals >= 5 && onlySoftMinorObjections(firstResult)) {
    return { triggered: true, reason: "near9-8-band-soft-objection-review" };
  }

  return { triggered: false, reason: `insufficient-signal-${signals}` };
}

async function runExact9Review(task, questionPrompt, essay, firstResult, routeReason) {
  const prompt = exact9ReviewPrompt(task, questionPrompt, essay, firstResult, routeReason);
  const content = await callDeepSeek([
    { role: "system", content: "You are a strict IELTS GT Writing near-9 and exact Band 9 review examiner. Return JSON only." },
    { role: "user", content: prompt }
  ], 0.08);

  const parsed = extractJson(content);
  const criteria = validateCriteria(parsed.criteria, task);
  const finalBand = averageBand(criteria, task);
  if (finalBand == null) throw new Error("Could not calculate exact-9 final band from criteria");

  const promotedByAI = String(parsed.exact9Decision || "").toLowerCase().includes("promote")
    || parsed.exact9Audit?.promoted === true;

  return { parsed, criteria, finalBand, promotedByAI };
}

async function scoreHighBand(task, questionPrompt, essay) {
  const first = await runMainHighBandPass(task, questionPrompt, essay);
  const route = shouldTriggerExact9Review(task, first);

  let exact9 = null;
  let selected = first;
  let selectedSource = "main-highband-pass";

  if (route.triggered) {
    exact9 = await runExact9Review(task, questionPrompt, essay, first, route.reason);
    // AI-only selection: use exact-9 review criteria only if the second AI explicitly promotes
    // and returns criteria whose mechanical average is 8.5 or 9. No local score lifting occurs.
    if (exact9.promotedByAI && exact9.finalBand >= 8.5) {
      selected = exact9;
      selectedSource = "near9-exact9-review-pass";
    }
  }

  return {
    selected,
    selectedSource,
    first,
    exact9Triggered: route.triggered,
    exact9RouteReason: route.reason,
    exact9
  };
}

module.exports = async function handler(req, res) {
  try {
    setCors(req, res);
    if (req.method === "OPTIONS") return sendJson(req, res, 200, { ok: true });
    if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed. Use POST." });

    const body = await readJsonBody(req);
    const task = normalizeTask(body.task || body.scoringTask || body.taskType || body.selectedTask);
    const questionPrompt = body.questionPrompt || body.promptText || body.prompt || body.question || "";
    const essay = body.essay || body.answer || body.response || body.text || "";

    if (!String(essay).trim()) return sendJson(req, res, 400, { ok: false, error: "Missing essay text" });

    const result = await scoreHighBand(task, questionPrompt, essay);
    const selected = result.selected;
    const selectedParsed = selected.parsed || {};

    const payload = {
      ok: true,
      shadowMode: true,
      highBandShadow: true,
      productionScoreChanged: false,
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      aiStage: result.selectedSource,
      task,
      scoringTask: task,
      wordCount: wordCount(essay),
      overallBand: selected.finalBand,
      finalBand: selected.finalBand,
      band: selected.finalBand,
      finalCriteria: selected.criteria,
      criteria: selected.criteria,
      scoreCalculation: {
        method: "mechanical-average-of-ai-returned-criteria",
        criteria: selected.criteria,
        finalBand: selected.finalBand
      },
      highBandDecision: selectedParsed.highBandDecision || selectedParsed.exact9Decision || null,
      candidateRange: selectedParsed.candidateRange || null,
      reasonCodes: selectedParsed.reasonCodes || {},
      highBandAudit: selectedParsed.highBandAudit || {},
      exact9Review: {
        triggered: result.exact9Triggered,
        routeReason: result.exact9RouteReason,
        selectedSource: result.selectedSource,
        mainFinalBand: result.first.finalBand,
        mainCriteria: result.first.criteria,
        mainAudit: result.first.parsed?.highBandAudit || {},
        highBandSignalCount: highBandSignalCount(result.first),
        softMinorObjections: onlySoftMinorObjections(result.first),
        reviewFinalBand: result.exact9?.finalBand ?? null,
        reviewCriteria: result.exact9?.criteria || null,
        reviewDecision: result.exact9?.parsed?.exact9Decision || null,
        reviewAudit: result.exact9?.parsed?.exact9Audit || null,
        promotedByAI: result.exact9?.promotedByAI || false
      },
      disclaimer: DISCLAIMER
    };

    return sendJson(req, res, 200, payload);
  } catch (err) {
    return sendJson(req, res, err.status || 500, {
      ok: false,
      shadowMode: true,
      highBandShadow: true,
      productionScoreChanged: false,
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      error: err.message || "High-band shadow scoring failed. No production score was changed."
    });
  }
};
