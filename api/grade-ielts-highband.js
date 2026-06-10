const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const SCORE_SYSTEM_VERSION = "score-core-v8-5-8-highband-shadow-system";
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
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
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

function buildPrompt(task, questionPrompt, essay) {
  const names = criterionNames(task);
  const wc = wordCount(essay);
  const taskNotes = task === "Task 1" ? [
    "Task 1: judge whether the letter fully achieves the communicative purpose with precise detail, natural tone, and consistently controlled register.",
    "A polished greeting/sign-off is not enough for Band 8+. High band requires purposeful detail, natural phrasing, and no visible template feel.",
    "Band 7.5: clear, complete and well organised, but there may be slight mechanical phrasing or limited naturalness.",
    "Band 8: fully covers all bullet points with skilful relevant detail; tone/register are consistently appropriate; errors are rare.",
    "Band 8.5-9: highly natural, precise, fluent and fully effective communication; errors are rare to virtually absent."
  ] : [
    "Task 2: judge depth, nuance, precision, progression, and how naturally the argument develops.",
    "A clear four-paragraph essay is not enough for Band 8+. High band requires mature argument, relevant extension, and precise control.",
    "Band 7.5: well-developed and coherent, but some ideas may be predictable or links slightly mechanical.",
    "Band 8: fully addresses the question with relevant, extended ideas; vocabulary is precise; grammar is flexible with rare minor errors.",
    "Band 8.5-9: nuanced and mature; cohesion is seamless; lexical choices are precise and idiomatic; language limitation is minimal to virtually absent."
  ];

  return [
    "You are the HIGH-BAND SHADOW IELTS General Training Writing examiner.",
    "This endpoint is separate from production scoring. It exists only to test Band 7.5-9.0 calibration. Return JSON only.",
    `Locked task: ${task}. Criteria keys must be exactly: ${JSON.stringify(names)}.`,
    "Use IELTS bands 0-9 in 0.5 increments, but focus especially on 7.0, 7.5, 8.0, 8.5 and 9.0.",
    "AI-only rule: choose all bands yourself from the prompt and response. Do not apply a local cap, floor, lift, or penalty. The server will only validate and average your four criterion bands.",
    "Core decision: distinguish a strong Band 7/7.5 script from genuinely high-band Band 8/8.5/9 writing.",
    "Do NOT cap a script at 7 merely because IELTS writing is hard. If the response demonstrates mature, natural, precise, well-controlled writing, award 8+ when justified.",
    "Do NOT inflate a response to 8+ merely because it is long, formal, well paragraphed, or uses advanced-looking words. High band requires natural precision, depth and control.",
    "If there is noticeable repetition, generic development, template phrasing, awkward collocation, or frequent minor errors, 7.0-7.5 is usually more appropriate than 8.5-9.",
    "If the response is coherent, mature, precise, and almost entirely free of strain, consider 8.0-9.0 depending on sophistication and accuracy.",
    ...taskNotes,
    `Word count: ${wc}. Remember: word count alone does not justify a high band.`,
    `Question prompt:\n${questionPrompt || ""}`,
    `Student response:\n${essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"highband-shadow-score\",\"task\":\"Task 1 or Task 2\",\"highBandDecision\":\"band_7_or_7_5_or_8_or_8_5_or_9\",\"candidateRange\":\"x-y\",\"criteria\":{...four numeric criterion bands...},\"reasonCodes\":{\"Criterion Name\":[\"short_code\",\"short_code\"]},\"highBandAudit\":{\"wordCountRewarded\":false,\"templateInflated\":false,\"matureControl\":true,\"preciseLexis\":true,\"developmentDepth\":true,\"naturalCohesion\":true,\"whyNotHigher\":[\"short_code\"],\"whyNotLower\":[\"short_code\"]}}"
  ].join("\n\n");
}

async function callDeepSeek(messages) {
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
        temperature: 0.15,
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

async function scoreHighBand(task, questionPrompt, essay) {
  const prompt = buildPrompt(task, questionPrompt, essay);
  const content = await callDeepSeek([
    { role: "system", content: "You are a strict IELTS General Training Writing high-band calibration examiner. Return JSON only." },
    { role: "user", content: prompt }
  ]);
  const parsed = extractJson(content);
  const criteria = validateCriteria(parsed.criteria, task);
  const finalBand = averageBand(criteria, task);
  if (finalBand == null) throw new Error("Could not calculate final band from criteria");
  return { parsed, criteria, finalBand };
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
    const payload = {
      ok: true,
      shadowMode: true,
      highBandShadow: true,
      productionScoreChanged: false,
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      aiStage: "highband-shadow-score",
      task,
      scoringTask: task,
      wordCount: wordCount(essay),
      overallBand: result.finalBand,
      finalBand: result.finalBand,
      band: result.finalBand,
      finalCriteria: result.criteria,
      criteria: result.criteria,
      scoreCalculation: {
        method: "mechanical-average-of-ai-returned-criteria",
        criteria: result.criteria,
        finalBand: result.finalBand
      },
      highBandDecision: result.parsed.highBandDecision || null,
      candidateRange: result.parsed.candidateRange || null,
      reasonCodes: result.parsed.reasonCodes || {},
      highBandAudit: result.parsed.highBandAudit || {},
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
