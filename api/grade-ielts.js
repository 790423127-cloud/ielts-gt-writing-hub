const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = "gemini-2.5-flash";
const DISCLAIMER = "This is an AI-generated estimated score and revision, not an official IELTS score.";

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://790423127-cloud.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
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

function buildSystemPrompt() {
  return [
    "You are an IELTS General Training Writing examiner and writing coach.",
    "The score is only an AI estimated score, not an official IELTS score.",
    "Assess the essay using the four IELTS Writing criteria.",
    "For Task 1, use Task Achievement as the first criterion.",
    "For Task 2, use Task Response as the first criterion.",
    "Score from 0 to 9 and allow half bands.",
    "Focus on task fulfilment, bullet point coverage for Task 1, position clarity for Task 2, paragraphing, cohesion, vocabulary accuracy, grammar, sentence structure, spelling, punctuation, Chinese-influenced English, off-topic content, and underdeveloped ideas.",
    "Sentence corrections and grammar errors must be based only on sentences that appear in the user's essay.",
    "Do not invent user sentences.",
    "Return strict JSON only.",
    "Do not return markdown.",
    "Do not wrap the JSON in ```json or any code fence.",
    "Do not include explanatory preface or closing comments."
  ].join(" ");
}

function buildExpectedJsonShape(task) {
  const firstCriterion = task === "Task 1" ? "Task Achievement" : "Task Response";
  return {
    overallBand: 5.5,
    estimatedLevel: "Band 5.5",
    criteria: {
      [firstCriterion]: {
        band: 5.5,
        feedback: "...",
        howToImprove: "..."
      },
      "Coherence and Cohesion": {
        band: 5.5,
        feedback: "...",
        howToImprove: "..."
      },
      "Lexical Resource": {
        band: 5,
        feedback: "...",
        howToImprove: "..."
      },
      "Grammatical Range and Accuracy": {
        band: 5,
        feedback: "...",
        howToImprove: "..."
      }
    },
    strengths: ["..."],
    mainProblems: ["..."],
    grammarErrors: [
      {
        type: "tense / article / subject-verb agreement / word form / sentence structure / punctuation / other",
        original: "...",
        corrected: "...",
        explanation: "..."
      }
    ],
    sentenceCorrections: [
      {
        original: "...",
        corrected: "...",
        reason: "..."
      }
    ],
    taskAchievementAdvice: ["..."],
    coherenceAdvice: ["..."],
    lexicalAdvice: ["..."],
    grammarAdvice: ["..."],
    band5FixPlan: ["..."],
    band6UpgradePlan: ["..."],
    band7UpgradePlan: ["..."],
    modelAnswerOutline: "...",
    revisedEssayBand5: "...",
    revisedEssayBand6: "...",
    revisedEssayBand7: "...",
    revisionNotes: ["..."],
    disclaimer: DISCLAIMER
  };
}

function buildPrompt(body) {
  const mode = body.mode || "quick";
  const isRevisionMode = mode === "revision" || body.includeRevision;
  const revisionInstruction = isRevisionMode
    ? "Return revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7. Band 5 should be safer and clearer; Band 6 should be more natural and logically complete; Band 7 should be mature and coherent but not template-like."
    : "For revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7, return empty strings unless a very short revision sample is necessary. Still include all fields.";

  return [
    buildSystemPrompt(),
    "",
    "Return exactly one JSON object matching this shape. Keep the same keys:",
    JSON.stringify(buildExpectedJsonShape(body.task), null, 2),
    "",
    "Mode instructions:",
    "- quick: concise feedback, but still fill all JSON fields.",
    "- full: detailed scoring and improvement advice.",
    "- revision: include all three revised essays.",
    revisionInstruction,
    `Always set disclaimer to: ${DISCLAIMER}`,
    "",
    "Request data:",
    JSON.stringify({
      task: body.task,
      book: body.book,
      test: body.test,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      essay: body.essay,
      wordCount: body.wordCount,
      mode,
      includeRevision: Boolean(body.includeRevision),
      revisionTargets: body.revisionTargets || [],
      rubric: body.rubric
    }, null, 2)
  ].join("\n");
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => part.text || "").join("").trim();
}

function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonFromGemini(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Gemini returned non-JSON output.");
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
    sendJson(req, res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(req, res, 500, { error: "GEMINI_API_KEY is not configured on the server." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, 400, { error: "Invalid JSON request body.", detail: error.message });
    return;
  }

  if (!body.questionPrompt || !String(body.questionPrompt).trim()) {
    sendJson(req, res, 400, { error: "questionPrompt is required." });
    return;
  }

  if (!body.essay || !String(body.essay).trim()) {
    sendJson(req, res, 400, { error: "essay is required." });
    return;
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(body) }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          maxOutputTokens: (body.mode || "quick") === "quick" ? 2800 : 6500
        }
      })
    });

    const raw = await geminiResponse.text();
    if (!geminiResponse.ok) {
      sendJson(req, res, 502, {
        error: "Gemini API request failed.",
        status: geminiResponse.status,
        detail: raw
      });
      return;
    }

    let geminiData;
    try {
      geminiData = JSON.parse(raw);
    } catch (error) {
      sendJson(req, res, 502, { error: "Gemini returned an invalid API response.", detail: error.message });
      return;
    }

    const outputText = extractGeminiText(geminiData);
    if (!outputText) {
      sendJson(req, res, 502, { error: "Gemini returned an empty response." });
      return;
    }

    let result;
    try {
      result = parseJsonFromGemini(outputText);
    } catch (error) {
      sendJson(req, res, 502, {
        error: "Gemini returned non-JSON output.",
        detail: error.message
      });
      return;
    }

    result.disclaimer = result.disclaimer || DISCLAIMER;
    sendJson(req, res, 200, result);
  } catch (error) {
    sendJson(req, res, 500, { error: "Server error while grading IELTS writing.", detail: error.message });
  }
};
