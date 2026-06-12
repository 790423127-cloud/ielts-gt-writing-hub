const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const SCORE_SYSTEM_VERSION = "score-core-v8-5-9-lowband-hard-evidence-guard";
const DISCLAIMER = "This is an AI-generated estimated IELTS low-band shadow score, not an official IELTS score.";
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
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (error) { error.status = 400; reject(error); }
    });
    req.on("error", reject);
  });
}

function wordCount(text = "") {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
}

function normalizeTask(body = {}) {
  const raw = String(body.task || body.scoringTask || body.selectedTask || body.taskType || body.mode || "").toLowerCase();
  if (/task\s*1|task1|letter|gt\s*letter/.test(raw)) return "Task 1";
  if (/task\s*2|task2|essay/.test(raw)) return "Task 2";
  const prompt = String(body.questionPrompt || body.promptText || "").toLowerCase();
  if (/write a letter|dear|yours faithfully|yours sincerely|in your letter/.test(prompt)) return "Task 1";
  return "Task 2";
}

function criterionNames(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function nearestValidBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  let best = VALID_BANDS[0];
  let diff = Math.abs(n - best);
  for (const band of VALID_BANDS) {
    const d = Math.abs(n - band);
    if (d < diff) { best = band; diff = d; }
  }
  return best;
}

function normalizeCriteria(raw, task) {
  const names = criterionNames(task);
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const name of names) {
    const aliases = [name];
    if (name === "Task Achievement") aliases.push("TA", "taskAchievement", "Task achievement");
    if (name === "Task Response") aliases.push("TR", "taskResponse", "Task response");
    if (name === "Coherence and Cohesion") aliases.push("CC", "coherenceCohesion", "Coherence & Cohesion");
    if (name === "Lexical Resource") aliases.push("LR", "lexicalResource");
    if (name === "Grammatical Range and Accuracy") aliases.push("GRA", "grammar", "grammaticalRangeAccuracy");
    const found = aliases.map((k) => src[k]).find((v) => v !== undefined && v !== null);
    const band = nearestValidBand(found);
    if (!Number.isFinite(band)) throw new Error(`Low-band AI did not return a usable numeric band for ${name}.`);
    out[name] = band;
  }
  return out;
}

function averageBand(criteria) {
  const values = Object.values(criteria).map(Number).filter(Number.isFinite);
  if (values.length !== 4) throw new Error("Incomplete criterion bands.");
  const rawAverage = values.reduce((a, b) => a + b, 0) / values.length;
  const finalBand = nearestValidBand(rawAverage);
  return { rawAverage, finalBand };
}

function isMostlyEnglish(text = "") {
  const words = String(text || "").match(/[A-Za-z]+/g) || [];
  return words.length >= 8;
}

function detectStrictHardZero(body, task) {
  const essay = String(body.essay || body.response || body.answer || "").trim();
  const prompt = String(body.questionPrompt || body.promptText || "").trim();
  if (!essay) return { triggered: true, reason: "blank" };
  const words = wordCount(essay);
  if (words < 5) return { triggered: true, reason: "too_short_unassessable" };
  if (!isMostlyEnglish(essay)) return { triggered: true, reason: "non_english_or_unassessable" };
  const compactEssay = essay.toLowerCase().replace(/\s+/g, " ").trim();
  const compactPrompt = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (compactPrompt && compactEssay && compactPrompt.includes(compactEssay) && words > 10) return { triggered: true, reason: "copied_prompt_only" };
  return { triggered: false, reason: "rateable" };
}

function hardZeroScore(body, task, gate) {
  const names = criterionNames(task);
  const criteria = Object.fromEntries(names.map((name) => [name, 0]));
  return {
    ok: true,
    aiStage: "lowband-shadow-hard-zero",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    shadowMode: true,
    lowBandShadow: true,
    productionScoreChanged: false,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage: 0,
    overallBand: 0,
    lowBandAudit: { hardZero: true, reason: gate.reason },
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_lowband_shadow" : "task2_lowband_shadow",
      formula: "Strict hard-zero only for blank/non-English/unassessable/copied-only responses. No local cap/floor/lift/lowering is applied.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage: 0,
      finalBand: 0,
      localScoreChanged: false
    }
  };
}

function extractJsonObject(text = "") {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("AI response was not valid JSON.");
}

async function callDeepSeek(messages, maxTokens = 2500, temperature = 0) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("Missing DEEPSEEK_API_KEY environment variable.");
    err.status = 500;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" } }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${text.slice(0, 600)}`);
    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned empty content.");
    return extractJsonObject(content);
  } finally {
    clearTimeout(timer);
  }
}

function lowBandPrompt(task, prompt, essay) {
  const names = criterionNames(task);
  const wc = wordCount(essay);
  const taskSpecific = task === "Task 1" ? [
    "Task 1 low-band warning: greeting, closing, paragraphing, and mentioning the topic do NOT prove Band 5+.",
    "Band 3 Task 1: weak or unclear purpose; only minimal bullet coverage; many basic errors; the reader can only partly understand the message.",
    "Band 3.5 Task 1: recognisable letter attempt, but coverage is very thin/confused; control is poor; communication is limited.",
    "Band 4 Task 1: basically related but incomplete or very thin; tone/format unstable; frequent basic errors restrict clarity.",
    "Band 4.5 Task 1: more understandable than Band 4, but still simple, repetitive, thin, and error-prone. It should not become Band 6 merely because all bullets are mentioned.",
    "Band 5/5.5 Task 1: generally clear purpose and most or all bullets addressed with some usable detail; language remains limited but the reader can clearly act on the message.",
    "Corrected Task 1 Band 5 rule: if the letter has all bullets covered, an appropriate informal/formal tone, readable grammar/spelling, and no frequent meaning-straining errors, do not keep it at 4.0/4.5 just because vocabulary and sentences are simple."
  ] : [
    "Task 2 low-band warning: 250+ words, four paragraphs, and an introduction/conclusion do NOT prove Band 5+.",
    "If the Task 2 prompt contains two direct questions, a basic but complete response that answers both parts should not be pushed down to 3.0-4.5 merely because development is simple.",
    "Band 3 Task 2: very limited position/content; confused or repetitive organisation; frequent errors make meaning difficult.",
    "Band 3.5 Task 2: relevant attempt but weak answer; mostly simple repeated assertions; poor development; language control is weak.",
    "Band 4 Task 2: basically related but very limited; ideas are simple/repetitive/barely developed; organisation is weak or mechanical; frequent basic errors restrict control.",
    "Band 4.5 Task 2: understandable and related, but development remains thin and general; vocabulary/grammar still limited. Do not lift to Band 6 for length alone.",
    "Band 5/5.5 Task 2: clear position/basic structure with some explanation, but reasoning is shallow and language is still limited."
  ];
  return [
    "You are the LOW-BAND SHADOW IELTS General Training Writing examiner.",
    "This endpoint is a LOWBAND GUARD. It should identify true low-band evidence for Band 3.0-4.5, not suppress ordinary Band 5 writing. Return JSON only.",
    `Locked task: ${task}. Criteria keys must be exactly: ${JSON.stringify(names)}.` ,
    "Use IELTS bands 0-9 in 0.5 increments, but focus especially on 3.0, 3.5, 4.0, 4.5, 5.0 and 5.5.",
    "AI-only rule: choose all bands yourself from the prompt and response. Do not apply a local cap, floor, lift, or penalty. The server will only average your four criterion bands.",
    "Core decision: distinguish a truly low-band script from a merely simple but functional Band 5 script. Band 5 may still contain noticeable non-blocking errors.",
    "Do NOT reward word count, paragraph count, greeting/sign-off, or template structure as quality. These only make the writing rateable; they do not prove control, development, or coherence.",
    "Frequent basic grammar problems, unnatural phrasing, repetitive sentence patterns, limited vocabulary, thin development, or mechanical progression should keep LR/GRA and sometimes CC/TA/TR in the low band.",
    "If a response is relevant and complete-looking but the language is very basic, repetitive, awkward, or error-prone, consider Band 4.0-4.5 only when the errors or thinness make reading effortful. Do not punish simple but clear Band 5 writing.",
    "If a response is easy to understand, covers the task with usable detail, and errors do not often restrict communication, then Band 5.0+ may be justified. In that case lowBandAudit.trueLowBand should be false. Explain with short reason codes.",
    "For corrected low-band writing, separate the original error-dense version from the current corrected version. Score the current text only.",
    ...taskSpecific,
    `Word count: ${wc}. Remember: meeting the IELTS word count does not lift a weak response out of low band by itself.`,
    `Question prompt:\n${prompt || ""}`,
    `Student response:\n${essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"lowband-shadow-score\",\"task\":\"Task 1 or Task 2\",\"lowBandDecision\":\"band_3_or_3_5_or_4_or_4_5_or_5_plus\",\"candidateRange\":\"x-y\",\"criteria\":{...four numeric criterion bands...},\"reasonCodes\":{\"Criterion Name\":[\"short_code\",\"short_code\"]},\"lowBandAudit\":{\"wordCountRewarded\":false,\"formatRewarded\":false,\"weakLanguage\":boolean,\"thinDevelopment\":boolean,\"trueLowBand\":boolean,\"band5AllowedWithErrors\":true,\"whyNotHigher\":[\"short_code\"]}}"
  ].join("\n\n");
}

async function lowBandShadowScore(body) {
  const task = normalizeTask(body);
  const essay = String(body.essay || body.response || body.answer || "");
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  const gate = detectStrictHardZero({ ...body, essay, questionPrompt: prompt }, task);
  if (gate.triggered) return hardZeroScore(body, task, gate);

  const ai = await callDeepSeek([
    { role: "system", content: "You are a low-band IELTS GT Writing shadow scorer. Return JSON only. Do not provide feedback." },
    { role: "user", content: lowBandPrompt(task, prompt, essay) }
  ], 2600, 0);

  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  const { rawAverage, finalBand } = averageBand(criteria);
  return {
    ok: true,
    aiStage: "lowband-shadow-score",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    shadowMode: true,
    lowBandShadow: true,
    productionScoreChanged: false,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: {
      task,
      wordCount: wordCount(essay),
      shadowEndpoint: true,
      productionEndpointUntouched: true
    },
    lowBandDecision: ai.lowBandDecision || "",
    candidateRange: ai.candidateRange || "",
    reasonCodes: ai.reasonCodes || {},
    lowBandAudit: {
      ...(ai.lowBandAudit && typeof ai.lowBandAudit === "object" ? ai.lowBandAudit : {}),
      hardZero: false,
      aiOnly: true,
      localScoreChanged: false,
      productionScoreChanged: false
    },
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_lowband_shadow_v8_5_7" : "task2_lowband_shadow_v8_5_7",
      formula: "Low-band shadow endpoint: AI returns four criterion bands using a low-band calibration prompt; the server only validates bands and mechanically averages them. No local cap, floor, lift, lowering, or regression calibration is applied.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false
    }
  };
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  const body = await readJsonBody(req);
  return sendJson(req, res, 200, await lowBandShadowScore(body));
}

module.exports = async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendJson(req, res, Number(error?.status) || 502, {
      ok: false,
      error: "Low-band shadow scoring failed. No production score was changed.",
      detail: error?.message || String(error),
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      shadowMode: true,
      lowBandShadow: true,
      productionScoreChanged: false
    });
  }
};

module.exports.config = { maxDuration: 300 };
