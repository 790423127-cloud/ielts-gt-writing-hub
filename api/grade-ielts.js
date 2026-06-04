const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_MODEL = "gemini-2.5-flash";
const DISCLAIMER = "This is an AI-generated estimated score and revision, not an official IELTS score.";

const stringArraySchema = {
  type: "array",
  items: { type: "string" }
};

const criterionSchema = {
  type: "object",
  properties: {
    band: { type: "number", minimum: 0, maximum: 9 },
    feedback: { type: "string" },
    howToImprove: { type: "string" }
  },
  required: ["band", "feedback", "howToImprove"],
  propertyOrdering: ["band", "feedback", "howToImprove"]
};

const IELTS_FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    overallBand: { type: "number", minimum: 0, maximum: 9 },
    estimatedLevel: { type: "string" },
    criteria: {
      type: "object",
      properties: {
        "Task Achievement": criterionSchema,
        "Task Response": criterionSchema,
        "Coherence and Cohesion": criterionSchema,
        "Lexical Resource": criterionSchema,
        "Grammatical Range and Accuracy": criterionSchema
      },
      required: ["Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
      propertyOrdering: [
        "Task Achievement",
        "Task Response",
        "Coherence and Cohesion",
        "Lexical Resource",
        "Grammatical Range and Accuracy"
      ]
    },
    strengths: stringArraySchema,
    mainProblems: stringArraySchema,
    grammarErrors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          original: { type: "string" },
          corrected: { type: "string" },
          explanation: { type: "string" }
        },
        required: ["type", "original", "corrected", "explanation"],
        propertyOrdering: ["type", "original", "corrected", "explanation"]
      }
    },
    sentenceCorrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          reason: { type: "string" }
        },
        required: ["original", "corrected", "reason"],
        propertyOrdering: ["original", "corrected", "reason"]
      }
    },
    taskAchievementAdvice: stringArraySchema,
    coherenceAdvice: stringArraySchema,
    lexicalAdvice: stringArraySchema,
    grammarAdvice: stringArraySchema,
    band5FixPlan: stringArraySchema,
    band6UpgradePlan: stringArraySchema,
    band7UpgradePlan: stringArraySchema,
    modelAnswerOutline: { type: "string" },
    revisedEssayBand5: { type: "string" },
    revisedEssayBand6: { type: "string" },
    revisedEssayBand7: { type: "string" },
    revisionNotes: stringArraySchema,
    disclaimer: { type: "string" }
  },
  required: [
    "overallBand",
    "estimatedLevel",
    "criteria",
    "strengths",
    "mainProblems",
    "grammarErrors",
    "sentenceCorrections",
    "taskAchievementAdvice",
    "coherenceAdvice",
    "lexicalAdvice",
    "grammarAdvice",
    "band5FixPlan",
    "band6UpgradePlan",
    "band7UpgradePlan",
    "modelAnswerOutline",
    "revisedEssayBand5",
    "revisedEssayBand6",
    "revisedEssayBand7",
    "revisionNotes",
    "disclaimer"
  ],
  propertyOrdering: [
    "overallBand",
    "estimatedLevel",
    "criteria",
    "strengths",
    "mainProblems",
    "grammarErrors",
    "sentenceCorrections",
    "taskAchievementAdvice",
    "coherenceAdvice",
    "lexicalAdvice",
    "grammarAdvice",
    "band5FixPlan",
    "band6UpgradePlan",
    "band7UpgradePlan",
    "modelAnswerOutline",
    "revisedEssayBand5",
    "revisedEssayBand6",
    "revisedEssayBand7",
    "revisionNotes",
    "disclaimer"
  ]
};

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
    "Return only one valid JSON object.",
    "Return strict JSON only.",
    "Do not return markdown.",
    "Do not wrap the JSON in ```json or any code fence.",
    "Do not include explanatory preface or closing comments.",
    "All required keys must exist.",
    "If a section has no content, return an empty array [] or an empty string \"\".",
    "Do not use trailing commas.",
    "Do not use comments inside JSON."
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

function extractFirstJsonObject(text) {
  const cleaned = stripCodeFence(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return cleaned;
}

function parseJsonFromGemini(text) {
  const candidate = extractFirstJsonObject(text);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    error.rawCandidate = candidate;
    throw error;
  }
}

function buildRepairPrompt(rawText) {
  return [
    "Convert the following text into one valid JSON object matching the required IELTS feedback schema.",
    "Return JSON only. Do not add markdown or explanations.",
    "All required keys must exist.",
    "If a section has no content, return an empty array [] or empty string \"\".",
    "Do not use trailing commas. Do not use comments inside JSON.",
    "",
    "Required schema:",
    JSON.stringify(IELTS_FEEDBACK_SCHEMA, null, 2),
    "",
    "Text to repair:",
    String(rawText || "").slice(0, 12000)
  ].join("\n");
}

async function callGemini({ apiKey, model, prompt, maxOutputTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: IELTS_FEEDBACK_SCHEMA,
        maxOutputTokens
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error("Gemini API request failed.");
    error.status = response.status;
    error.raw = raw;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    error.raw = raw;
    throw error;
  }

  const outputText = extractGeminiText(data);
  if (!outputText) {
    const error = new Error("Gemini returned an empty response.");
    error.raw = raw;
    throw error;
  }

  return outputText;
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

  try {
    const maxOutputTokens = (body.mode || "quick") === "quick" ? 2800 : 6500;
    const outputText = await callGemini({
      apiKey,
      model,
      prompt: buildPrompt(body),
      maxOutputTokens
    });

    let result;
    try {
      result = parseJsonFromGemini(outputText);
    } catch (firstParseError) {
      try {
        const repairedText = await callGemini({
          apiKey,
          model,
          prompt: buildRepairPrompt(outputText),
          maxOutputTokens
        });
        result = parseJsonFromGemini(repairedText);
      } catch (repairError) {
        sendJson(req, res, 502, {
          error: "Gemini returned non-JSON output.",
          detail: repairError.message || firstParseError.message,
          rawPreview: String(outputText || "").slice(0, 1500)
        });
        return;
      }
    }

    result.disclaimer = result.disclaimer || DISCLAIMER;
    sendJson(req, res, 200, result);
  } catch (error) {
    if (error.message === "Gemini API request failed.") {
      sendJson(req, res, 502, {
        error: "Gemini API request failed.",
        status: error.status,
        detail: error.raw
      });
      return;
    }
    sendJson(req, res, 500, { error: "Server error while grading IELTS writing.", detail: error.message });
  }
};
