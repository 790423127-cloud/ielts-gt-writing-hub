const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
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

function normalizeMode(mode) {
  return ["quick", "full", "revision"].includes(mode) ? mode : "quick";
}

function isVeryShortEssay(body) {
  const words = Number(body.wordCount) || 0;
  return body.task === "Task 1" ? words < 80 : words < 150;
}

function maxTokensForMode(mode, veryShort) {
  if (veryShort) return 1800;
  if (mode === "quick") return 2500;
  if (mode === "full") return 4200;
  return 7000;
}

function buildSystemPrompt(veryShort = false) {
  const rules = [
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
    "Do not return markdown or code fences.",
    "Do not include explanatory preface or closing comments.",
    "All required keys must exist.",
    "If a section has no content, return an empty array [] or an empty string \"\".",
    "Use short, compact feedback.",
    "Do not write long paragraphs inside arrays.",
    "Every array must have at most 5 items.",
    "grammarErrors and sentenceCorrections must each have at most 5 items.",
    "Provide brief Chinese helper notes only in feedbackZh, howToImproveZh, explanationZh, reasonZh, and revisionNotesZh.",
    "Do not translate the user's full essay or any revised essay into Chinese.",
    "Do not use trailing commas.",
    "Do not use comments inside JSON."
  ];

  if (veryShort) {
    rules.push(
      "This is a very short essay. Use an ultra-compact diagnostic response.",
      "Do not generate revised essays.",
      "strengths must have at most 2 items.",
      "mainProblems must have at most 3 items.",
      "grammarErrors must have at most 3 items.",
      "sentenceCorrections must have at most 3 items.",
      "Each English feedback field must have at most 25 English words.",
      "Each Chinese helper note must have at most 25 Chinese characters.",
      "Do not output long paragraphs.",
      "Return complete JSON only."
    );
  }

  return rules.join(" ");
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
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Coherence and Cohesion": {
        band: 5.5,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Lexical Resource": {
        band: 5,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Grammatical Range and Accuracy": {
        band: 5,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      }
    },
    strengths: ["..."],
    mainProblems: ["..."],
    grammarErrors: [
      {
        type: "tense / article / subject-verb agreement / word form / sentence structure / punctuation / other",
        original: "...",
        corrected: "...",
        explanation: "...",
        explanationZh: "简短中文解释"
      }
    ],
    sentenceCorrections: [
      {
        original: "...",
        corrected: "...",
        reason: "...",
        reasonZh: "简短中文解释"
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
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisionNotes: ["..."],
    revisionNotesZh: ["简短中文说明"],
    disclaimer: DISCLAIMER
  };
}

function buildUserPrompt(body, veryShort) {
  const mode = normalizeMode(body.mode);
  const effectiveMode = veryShort ? "quick" : mode;
  const isRevisionMode = effectiveMode === "revision";
  const revisionInstruction = isRevisionMode
    ? "Grade + Revision mode: generate revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7. Band 5 should be safer and clearer; Band 6 should be more natural and logically complete; Band 7 should be mature and coherent but not template-like."
    : "Quick Check and Full IELTS Grading modes: do not generate revised essays. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings.";
  const underMinimumInstruction = body.isUnderMinimum
    ? `The essay is below the IELTS target word count (${body.wordCount}/${body.targetWordCount}). Still grade normally. If this is Task 1, mention the word count issue in Task Achievement and mainProblems. If this is Task 2, mention the word count issue in Task Response and mainProblems because idea development and argument depth may be affected.`
    : "The essay meets or exceeds the target word count.";

  return [
    "Return exactly one JSON object matching this shape and keep the same keys:",
    JSON.stringify(buildExpectedJsonShape(body.task), null, 2),
    "",
    "Mode instructions:",
    "- quick: shortest feedback, no revised essays, compact arrays only.",
    "- full: four criteria, grammar errors, sentence corrections, no revised essays.",
    "- revision: include all three revised essays, but keep all non-essay feedback compact.",
    veryShort ? "Very short essay mode: ignore any revision request. Return only a compact diagnostic JSON. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings. Add this revision note: The essay is too short for a meaningful full revision. Please write a fuller response first. Add this Chinese note: 作文太短，暂不适合生成完整修改版，请先补充内容。" : "",
    veryShort ? "Very short essay limits: strengths max 2, mainProblems max 3, grammarErrors max 3, sentenceCorrections max 3, each Chinese helper note max 25 Chinese characters, each English feedback max 25 English words." : "",
    revisionInstruction,
    underMinimumInstruction,
    "Use brief Chinese helper notes only for local understanding. Do not translate the whole essay or revised essays.",
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
      targetWordCount: body.targetWordCount,
      isUnderMinimum: Boolean(body.isUnderMinimum),
      mode: effectiveMode,
      includeRevision: isRevisionMode,
      revisionTargets: isRevisionMode ? body.revisionTargets || [] : [],
      rubric: body.rubric
    }, null, 2)
  ].join("\n");
}

function buildFallbackFeedback(body, reason) {
  const firstCriterion = body.task === "Task 1" ? "Task Achievement" : "Task Response";
  return {
    overallBand: 3,
    estimatedLevel: "Band 3.0",
    criteria: {
      [firstCriterion]: {
        band: 3,
        feedback: "The response is too short and does not fully answer the task.",
        feedbackZh: "作文太短，没有充分完成题目要求。",
        howToImprove: "Write a fuller response and cover all bullet points or develop your main ideas.",
        howToImproveZh: "请补充内容，覆盖所有要点或展开主要观点。"
      },
      "Coherence and Cohesion": {
        band: 3,
        feedback: "There is not enough text to show clear organisation.",
        feedbackZh: "内容太少，无法体现清楚结构。",
        howToImprove: "Use separate paragraphs and simple linking words.",
        howToImproveZh: "请分段，并使用简单连接词。"
      },
      "Lexical Resource": {
        band: 3,
        feedback: "Vocabulary range is very limited.",
        feedbackZh: "词汇范围非常有限。",
        howToImprove: "Add more topic-related vocabulary.",
        howToImproveZh: "增加与题目相关的词汇。"
      },
      "Grammatical Range and Accuracy": {
        band: 3,
        feedback: "There is not enough language to assess grammar fully.",
        feedbackZh: "语言太少，难以完整评估语法。",
        howToImprove: "Write complete sentences and check verb forms.",
        howToImproveZh: "写完整句子，并检查动词形式。"
      }
    },
    strengths: ["You attempted to respond to the task."],
    mainProblems: ["The essay is far below the recommended word count.", "Several task points or ideas are missing."],
    grammarErrors: [],
    sentenceCorrections: [],
    taskAchievementAdvice: ["Add enough detail to answer the task properly."],
    coherenceAdvice: ["Use clear paragraphs."],
    lexicalAdvice: ["Use more topic vocabulary."],
    grammarAdvice: ["Write complete sentences."],
    band5FixPlan: ["Write at least the recommended word count.", "Cover all bullet points or develop two clear ideas."],
    band6UpgradePlan: ["Add supporting details and examples."],
    band7UpgradePlan: ["Use more precise vocabulary and varied sentence structures."],
    modelAnswerOutline: "Write a fuller answer with an opening, clear body points, and a suitable closing.",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisionNotes: ["The response was too short, so only a basic diagnostic score is provided."],
    revisionNotesZh: ["作文太短，因此这里只提供基础诊断评分。"],
    disclaimer: DISCLAIMER,
    fallback: true,
    fallbackReason: reason || "DeepSeek returned incomplete JSON."
  };
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
      if (depth === 0 && start !== -1) return cleaned.slice(start, i + 1);
    }
  }

  return cleaned;
}

function parseJsonFromProvider(text) {
  const candidate = extractFirstJsonObject(text);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    error.rawCandidate = candidate;
    throw error;
  }
}

function buildRepairPrompt(rawText, task) {
  return [
    "Convert the following text into one valid JSON object matching the required IELTS feedback schema.",
    "Return JSON only. Do not add markdown, explanations, or code fences.",
    "If a field is missing, add it with an empty array [] or empty string \"\" as appropriate.",
    "Do not use trailing commas. Do not use comments inside JSON.",
    "",
    "Required JSON shape:",
    JSON.stringify(buildExpectedJsonShape(task), null, 2),
    "",
    "Text to repair:",
    String(rawText || "").slice(0, 12000)
  ].join("\n");
}

function extractDeepSeekText(data) {
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens, temperature = 0.2 }) {
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature,
      response_format: { type: "json_object" },
      max_tokens: maxTokens
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error("DeepSeek API request failed.");
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

  const outputText = extractDeepSeekText(data);
  if (!outputText) {
    const error = new Error("DeepSeek returned an empty response.");
    error.raw = raw;
    throw error;
  }

  return outputText;
}

function sendProviderError(req, res, error) {
  if (error.message !== "DeepSeek API request failed.") return false;

  if (error.status === 429) {
    sendJson(req, res, 429, {
      error: "AI provider quota exceeded.",
      provider: "deepseek",
      status: 429,
      suggestion: "Please wait, reduce usage, or check DeepSeek balance."
    });
    return true;
  }

  if (error.status >= 500 && error.status <= 599) {
    sendJson(req, res, 502, {
      error: "AI provider temporarily unavailable.",
      provider: "deepseek",
      status: error.status,
      suggestion: "Please try again later."
    });
    return true;
  }

  sendJson(req, res, 502, {
    error: "AI provider request failed.",
    provider: "deepseek",
    status: error.status,
    detail: String(error.raw || "").slice(0, 1500)
  });
  return true;
}

function normalizeResultForMode(result, mode, veryShort) {
  const normalized = result && typeof result === "object" ? result : {};
  normalized.disclaimer = normalized.disclaimer || DISCLAIMER;
  normalized.revisionNotesZh = normalized.revisionNotesZh || [];

  if (veryShort || mode !== "revision") {
    normalized.revisedEssayBand5 = "";
    normalized.revisedEssayBand6 = "";
    normalized.revisedEssayBand7 = "";
    if (veryShort) {
      normalized.revisionNotes = Array.isArray(normalized.revisionNotes) ? normalized.revisionNotes : [];
      normalized.revisionNotesZh = Array.isArray(normalized.revisionNotesZh) ? normalized.revisionNotesZh : [];
      if (!normalized.revisionNotes.some((note) => /too short/i.test(note))) {
        normalized.revisionNotes.unshift("The essay is too short for a meaningful full revision. Please write a fuller response first.");
      }
      if (!normalized.revisionNotesZh.some((note) => note.includes("作文太短"))) {
        normalized.revisionNotesZh.unshift("作文太短，暂不适合生成完整修改版，请先补充内容。");
      }
    }
  }

  return normalized;
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

  const provider = (process.env.AI_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  if (provider !== "deepseek") {
    sendJson(req, res, 400, { error: "Unsupported AI_PROVIDER. Set AI_PROVIDER=deepseek.", provider });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(req, res, 500, {
      error: "Provider API key is not configured.",
      provider: "deepseek"
    });
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

  const mode = normalizeMode(body.mode);
  const veryShort = isVeryShortEssay(body);
  const effectiveMode = veryShort ? "quick" : mode;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const maxTokens = maxTokensForMode(effectiveMode, veryShort);

  try {
    const outputText = await callDeepSeek({
      apiKey,
      model,
      systemPrompt: buildSystemPrompt(veryShort),
      userPrompt: buildUserPrompt({ ...body, mode: effectiveMode }, veryShort),
      maxTokens,
      temperature: 0.2
    });

    let result;
    try {
      result = parseJsonFromProvider(outputText);
    } catch (firstParseError) {
      try {
        const repairedText = await callDeepSeek({
          apiKey,
          model,
          systemPrompt: "You repair malformed JSON. Return exactly one valid JSON object and nothing else.",
          userPrompt: buildRepairPrompt(outputText, body.task),
          maxTokens,
          temperature: 0.1
        });
        result = parseJsonFromProvider(repairedText);
      } catch (repairError) {
        if (sendProviderError(req, res, repairError)) return;
        sendJson(req, res, 200, buildFallbackFeedback(body, "DeepSeek returned incomplete JSON."));
        return;
      }
    }

    sendJson(req, res, 200, normalizeResultForMode(result, effectiveMode, veryShort));
  } catch (error) {
    if (sendProviderError(req, res, error)) return;
    sendJson(req, res, 500, {
      error: "Server error while grading IELTS writing.",
      provider: "deepseek",
      detail: error.message
    });
  }
};
