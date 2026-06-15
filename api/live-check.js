const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const LIVE_TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.LIVE_CHECK_TIMEOUT_MS) || 8500, 12000));

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, statusCode, payload) {
  setCors(req, res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const raw = stripJsonFence(text);
  const start = raw.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return "";
}

function parseJsonFromAi(text) {
  const cleaned = stripJsonFence(text);
  try { return JSON.parse(cleaned); } catch {}
  const extracted = extractFirstJsonObject(cleaned);
  if (!extracted) throw new Error("AI did not return a JSON object.");
  return JSON.parse(extracted);
}

function extractAiText(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => typeof part === "string" ? part : (part?.text || part?.content || "")).join("").trim();
  }
  if (typeof data?.output_text === "string") return data.output_text.trim();
  if (typeof data?.text === "string") return data.text.trim();
  return "";
}

function typeSafe(value) {
  const raw = String(value || "").toLowerCase();
  if (["grammar", "vocabulary", "spelling", "clarity", "coherence", "task"].includes(raw)) return raw;
  if (/spell/.test(raw)) return "spelling";
  if (/word|lexical|collocation|vocab/.test(raw)) return "vocabulary";
  if (/cohesion|coherence|logic|link/.test(raw)) return "coherence";
  if (/task|tone|bullet|position/.test(raw)) return "task";
  return "grammar";
}

function normalizeSuggestion(item, text, offsetStart, index) {
  if (!item || typeof item !== "object") return null;
  const original = String(item.original || item.source || "").trim();
  const replacement = String(item.replacement || item.corrected || item.suggestion || "").trim();
  let start = Number(item.start);
  let end = Number(item.end);

  if ((!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > text.length) && original) {
    const found = text.indexOf(original);
    if (found >= 0) {
      start = found;
      end = found + original.length;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > text.length) return null;
  const actualOriginal = text.slice(start, end);
  const stableOriginal = original || actualOriginal;
  if (!stableOriginal.trim() || !replacement || stableOriginal.trim() === replacement.trim()) return null;

  return {
    id: String(item.id || `live-${Date.now()}-${index}`),
    start,
    end,
    globalStart: Number(offsetStart || 0) + start,
    globalEnd: Number(offsetStart || 0) + end,
    original: stableOriginal,
    replacement,
    type: typeSafe(item.type),
    message: String(item.message || item.reason || item.explanation || "This part can be improved.").trim(),
    messageZh: String(item.messageZh || item.explanationZh || "这里可以修改得更准确。").trim(),
    ieltsImpact: String(item.ieltsImpact || item.bandImpact || "This may affect IELTS Writing accuracy and clarity.").trim()
  };
}

function normalizeSuggestions(raw, text, offsetStart) {
  const seen = new Set();
  return (Array.isArray(raw?.suggestions) ? raw.suggestions : [])
    .map((item, index) => normalizeSuggestion(item, text, offsetStart, index))
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.globalStart}:${item.globalEnd}:${item.replacement.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

async function callDeepSeekLive({ apiKey, model, text, task, prompt, mode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  const userPrompt = [
    "You are a live IELTS General Training writing checker.",
    "Check ONLY the supplied text segment, not the whole essay.",
    "Return at most 5 high-value issues. Prefer obvious grammar, spelling, word choice, collocation, sentence clarity, Task 1 tone/bullet relevance, or Task 2 position/coherence problems.",
    "Do not score the essay. Do not rewrite the whole paragraph. Do not invent text that is not in the segment.",
    "Use 0-based character indexes relative to the supplied segment. The substring text.slice(start,end) must be the original text.",
    "Return exactly one JSON object with this shape:",
    JSON.stringify({
      suggestions: [{
        id: "s1",
        start: 0,
        end: 0,
        original: "",
        replacement: "",
        type: "grammar",
        message: "",
        messageZh: "",
        ieltsImpact: ""
      }]
    }),
    `Mode: ${mode || "help"}`,
    `Task: ${task || "Unknown"}`,
    `Question prompt: ${String(prompt || "").slice(0, 1200)}`,
    "Text segment:",
    text
  ].join("\n");

  let response;
  let raw = "";
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          { role: "system", content: "You are a precise IELTS live writing correction engine. Return valid JSON only." },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.05,
        stream: false,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    raw = await response.text();
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = new Error(`DeepSeek live check failed with HTTP ${response.status}`);
    error.status = response.status;
    error.raw = raw;
    throw error;
  }
  const data = JSON.parse(raw);
  const output = extractAiText(data);
  if (!output) throw new Error("DeepSeek returned an empty live-check response.");
  return parseJsonFromAi(output);
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
      sendJson(req, res, 500, { ok: false, suggestions: [], error: "DeepSeek API key is missing." });
      return;
    }

    const text = String(body.text || "").replace(/\r/g, "").slice(0, 1400);
    const offsetStart = Math.max(0, Number(body.offsetStart) || 0);
    if (text.trim().length < 8) {
      sendJson(req, res, 200, { ok: true, suggestions: [], skipped: "too_short" });
      return;
    }

    const ai = await callDeepSeekLive({
      apiKey,
      model: process.env.LIVE_CHECK_MODEL || DEFAULT_MODEL,
      text,
      task: body.task,
      prompt: body.prompt || body.questionPrompt,
      mode: body.mode
    });

    sendJson(req, res, 200, {
      ok: true,
      engine: "live-check-v1",
      offsetStart,
      suggestions: normalizeSuggestions(ai, text, offsetStart)
    });
  } catch (error) {
    sendJson(req, res, Number(error?.status) >= 400 ? Number(error.status) : 502, {
      ok: false,
      suggestions: [],
      error: String(error?.message || error || "Live check failed")
    });
  }
};

module.exports.config = { maxDuration: 30 };
