const ALLOWED_ORIGIN = "https://790423127-cloud.github.io";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DISCLAIMER = "This is an AI-generated estimated score and revision, not an official IELTS score.";

const criterionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    band: { type: "number", minimum: 0, maximum: 9 },
    feedback: { type: "string" },
    howToImprove: { type: "string" }
  },
  required: ["band", "feedback", "howToImprove"]
};

const stringArray = {
  type: "array",
  items: { type: "string" }
};

const task1CriteriaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    "Task Achievement": criterionSchema,
    "Coherence and Cohesion": criterionSchema,
    "Lexical Resource": criterionSchema,
    "Grammatical Range and Accuracy": criterionSchema
  },
  required: [
    "Task Achievement",
    "Coherence and Cohesion",
    "Lexical Resource",
    "Grammatical Range and Accuracy"
  ]
};

const task2CriteriaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    "Task Response": criterionSchema,
    "Coherence and Cohesion": criterionSchema,
    "Lexical Resource": criterionSchema,
    "Grammatical Range and Accuracy": criterionSchema
  },
  required: [
    "Task Response",
    "Coherence and Cohesion",
    "Lexical Resource",
    "Grammatical Range and Accuracy"
  ]
};

const resultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallBand: { type: "number", minimum: 0, maximum: 9 },
    estimatedLevel: { type: "string" },
    criteria: { anyOf: [task1CriteriaSchema, task2CriteriaSchema] },
    strengths: stringArray,
    mainProblems: stringArray,
    grammarErrors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
              "tense",
              "article",
              "subject-verb agreement",
              "word form",
              "sentence structure",
              "punctuation",
              "other"
            ]
          },
          original: { type: "string" },
          corrected: { type: "string" },
          explanation: { type: "string" }
        },
        required: ["type", "original", "corrected", "explanation"]
      }
    },
    sentenceCorrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          reason: { type: "string" }
        },
        required: ["original", "corrected", "reason"]
      }
    },
    taskAchievementAdvice: stringArray,
    coherenceAdvice: stringArray,
    lexicalAdvice: stringArray,
    grammarAdvice: stringArray,
    band5FixPlan: stringArray,
    band6UpgradePlan: stringArray,
    band7UpgradePlan: stringArray,
    modelAnswerOutline: { type: "string" },
    revisedEssayBand5: { type: "string" },
    revisedEssayBand6: { type: "string" },
    revisedEssayBand7: { type: "string" },
    revisionNotes: stringArray,
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
  ]
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function sendJson(req, res, statusCode, payload) {
  const headers = corsHeaders(req);
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
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

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (!Array.isArray(data.output)) return "";

  return data.output
    .flatMap((item) => item.content || [])
    .map((content) => content.text || content.output_text || "")
    .join("");
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
    "Sentence corrections must be based only on sentences that appear in the user's essay.",
    "Do not invent user sentences.",
    "Return strict JSON only. Do not return markdown. Do not include any explanatory preface."
  ].join(" ");
}

function buildUserPrompt(body) {
  const isTask1 = body.task === "Task 1";
  const firstCriterion = isTask1 ? "Task Achievement" : "Task Response";
  const revisionInstruction = body.includeRevision
    ? "Return revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7. Band 5 should be safer and clearer; Band 6 should be more natural and logically complete; Band 7 should be mature and coherent but not template-like."
    : "For revision fields, return empty strings unless the essay urgently needs a short sample fix. Still return all required JSON fields.";

  return JSON.stringify({
    instructions: [
      `Use ${firstCriterion} as the first criterion.`,
      "If mode is quick, keep feedback concise but still fill all JSON fields.",
      "If mode is full, give detailed scoring and improvement advice.",
      "If mode is revision, include all three revised essays.",
      revisionInstruction,
      `Always set disclaimer to: ${DISCLAIMER}`
    ],
    request: {
      task: body.task,
      book: body.book,
      test: body.test,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      essay: body.essay,
      wordCount: body.wordCount,
      mode: body.mode || "quick",
      includeRevision: Boolean(body.includeRevision),
      revisionTargets: body.revisionTargets || [],
      rubric: body.rubric
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    const headers = corsHeaders(req);
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(req, res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(req, res, 500, { error: "OPENAI_API_KEY is not configured on the server." });
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

  try {
    const openaiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        input: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(body) }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ielts_writing_feedback",
            strict: true,
            schema: resultSchema
          }
        },
        temperature: 0.2,
        max_output_tokens: body.mode === "quick" ? 2800 : 6500
      })
    });

    const raw = await openaiResponse.text();
    if (!openaiResponse.ok) {
      sendJson(req, res, 502, {
        error: "OpenAI Responses API request failed.",
        status: openaiResponse.status,
        detail: raw
      });
      return;
    }

    const openaiData = JSON.parse(raw);
    const outputText = extractResponseText(openaiData);
    if (!outputText) {
      sendJson(req, res, 502, { error: "OpenAI returned an empty response." });
      return;
    }

    let result;
    try {
      result = JSON.parse(outputText);
    } catch (error) {
      sendJson(req, res, 502, {
        error: "OpenAI returned non-JSON output.",
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
