const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const FEEDBACK_VERSION = "learning-feedback-v2-modular-tutor-panel";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_FEEDBACK_TIMEOUT_MS) || 150000, 240000));

const MODULES = {
  overview: {
    title: "全文问题总览 / Overall Learning Overview",
    maxTokens: 4200,
    maxItems: "topProblems 3-5, errorSummary 4-8, nextPracticeFocus 3-6",
    schema: {
      summary: { en: "", zh: "" },
      topProblems: [
        { problem: { en: "", zh: "" }, evidence: "", evidenceZh: "", whyMatters: { en: "", zh: "" }, nextAction: { en: "", zh: "" } }
      ],
      errorSummary: [
        { type: "grammar | word_form | spelling | cohesion | task_response | vocabulary", count: 0, note: { en: "", zh: "" } }
      ],
      nextPracticeFocus: [
        { focus: { en: "", zh: "" }, reason: { en: "", zh: "" }, action: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Give a concise overview based on the exact prompt and the student's essay.",
      "Do not list every error here. Summarise the most important learning priorities.",
      "Every problem must cite or paraphrase specific evidence from the student's essay or a requirement from the prompt.",
      "Do not use generic comments such as 'improve grammar' unless you say which grammar pattern and where it appears."
    ]
  },
  sentenceUpgrade: {
    title: "逐句修改与升级 / Sentence Correction and Upgrade",
    maxTokens: 6500,
    maxItems: "8-10 sentenceCards maximum",
    schema: {
      summary: { en: "", zh: "" },
      sentenceCards: [
        {
          index: 1,
          original: "",
          originalZh: "",
          hasClearError: true,
          issueTags: ["spelling | grammar | word_form | collocation | tone | cohesion | no_clear_error"],
          minimalCorrection: "",
          minimalCorrectionZh: "",
          upgradedVersion: "",
          upgradedVersionZh: "",
          whyBetter: { en: "", zh: "" },
          learnThis: { en: "", zh: "" },
          usefulPattern: { en: "", zh: "" }
        }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Use real sentences from the student's essay.",
      "For each selected sentence, provide the original, a minimal correction, and a next-step upgraded version that is only about 0.5 to 1.0 IELTS band above the student's frozen level.",
      "If the sentence has no clear error, do not invent one. Set hasClearError false and provide a more natural, more formal, or more specific upgraded version.",
      "For high-level essays with few basic errors, choose 4-6 sentences for high-band refinement rather than forcing corrections.",
      "Explain why the upgraded version is better with reference to grammar, tone, specificity, cohesion, task fit, or natural collocation.",
      "Keep sentenceCards concise. Do not rewrite the full essay."
    ]
  },
  grammarWordFormSpelling: {
    title: "语法、词形与拼写 / Grammar, Word Form and Spelling",
    maxTokens: 7000,
    maxItems: "all clear grammar errors if possible; concise items only",
    schema: {
      summary: { en: "", zh: "" },
      grammarErrors: [
        { index: 1, errorType: "article | plural | tense | verb_form | preposition | agreement | clause | sentence_structure | punctuation", original: "", originalZh: "", corrected: "", correctedZh: "", explanation: { en: "", zh: "" }, checkMethod: { en: "", zh: "" } }
      ],
      wordFormErrors: [
        { index: 1, errorType: "noun_form | adjective_form | adverb_form | verb_form | part_of_speech", original: "", originalZh: "", corrected: "", correctedZh: "", explanation: { en: "", zh: "" }, checkMethod: { en: "", zh: "" } }
      ],
      spellingQuickFix: [
        { wrong: "", correct: "", note: "" }
      ],
      learningFocus: [
        { point: "", example: "", exampleZh: "", rule: { en: "", zh: "" }, checkMethod: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "This module must identify all clear grammar errors in the essay as far as possible, not only the top few.",
      "If repeated errors show a pattern, group them under the same learningFocus rule, but still list each clear occurrence in grammarErrors or wordFormErrors.",
      "Separate spelling from grammar. SpellingQuickFix must be short: wrong word, correct word, brief note only.",
      "Do not give long spelling lessons. Detailed explanation should be reserved for grammarErrors, wordFormErrors, and sentenceUpgrade.",
      "Every error must come from the student's actual essay. Do not invent errors.",
      "If no clear grammar error exists, say so and focus on word-form/spelling or high-level accuracy checks."
    ]
  },
  structureCohesionTask: {
    title: "结构、衔接与任务回应 / Structure, Cohesion and Task Response",
    maxTokens: 5500,
    maxItems: "specific structure advice only",
    schema: {
      summary: { en: "", zh: "" },
      opening: { currentIssue: "", suggestedVersion: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
      paragraphOrganisation: { currentIssue: "", suggestedVersion: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
      cohesion: {
        issues: [
          { original: "", originalZh: "", improved: "", improvedZh: "", whyBetter: { en: "", zh: "" } }
        ]
      },
      development: {
        issues: [
          { original: "", originalZh: "", improved: "", improvedZh: "", whyBetter: { en: "", zh: "" } }
        ]
      },
      ending: { currentIssue: "", suggestedVersion: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
      taskResponse: {
        currentIssue: "",
        suggestedVersion: "",
        whyBetter: { en: "", zh: "" },
        coverage: [
          { requirement: "", status: "covered | partly_covered | missing", evidence: "", advice: { en: "", zh: "" } }
        ]
      },
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Teach how to open, organise paragraphs, link ideas, develop content, and end the answer.",
      "Every suggestion must explain why it is better.",
      "For Task 1, analyse the letter purpose, relationship/tone, bullet coverage, paragraph order, linking, and closing.",
      "For Task 2, analyse introduction, position, body paragraph logic, examples, linking, and conclusion.",
      "Do not repeat grammar/spelling lists here. Mention language errors only if they affect structure, cohesion, task response, or tone.",
      "Do not use generic templates. Use the exact prompt requirements and the student's original content."
    ]
  },
  expressionBank: {
    title: "表达积累 / Expression Bank",
    maxTokens: 4200,
    maxItems: "3-6 usefulExpressions, 0-4 avoidForNow",
    schema: {
      summary: { en: "", zh: "" },
      usefulExpressions: [
        { expression: "", meaningZh: "", situation: { en: "", zh: "" }, pattern: { en: "", zh: "" }, fromEssayOrPrompt: "", whyUseful: { en: "", zh: "" } }
      ],
      avoidForNow: [
        { expression: "", reason: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Give only expressions that are relevant to the current prompt and the student's essay.",
      "Do not provide random universal IELTS phrases.",
      "The expressions must be learnable for the student's frozen level and normally only 0.5-1.0 band above it.",
      "Prefer expressions the student could use in the next similar GT Writing task.",
      "Include Chinese meaning and usage situation."
    ]
  }
};

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.includes("ielts-gt-writing-hub") && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://790423127-cloud.github.io",
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

function normalizeRequestedTask(body = {}) {
  const raw = String(
    body.task ||
    body.taskType ||
    body.feedbackTask ||
    body.scoringTask ||
    body.requestedTask ||
    body.selectedTask ||
    body.writingTask ||
    ""
  ).toLowerCase();

  if (/task\s*1|task1|gt\s*task\s*1|letter|gt\s*letter|writing\s*1/.test(raw)) return "Task 1";
  if (/task\s*2|task2|gt\s*task\s*2|essay|gt\s*essay|writing\s*2/.test(raw)) return "Task 2";

  return "Task 2";
}

function normalizeIncomingBody(rawBody = {}) {
  const body = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};
  const lockedTask = normalizeRequestedTask(body);
  body.task = lockedTask;
  body.taskType = lockedTask === "Task 1" ? "task1" : "task2";
  body.feedbackTask = lockedTask;
  body.requestedTask = lockedTask;
  body.selectedTask = lockedTask;
  body.essay = String(body.essay || "");
  body.prompt = String(body.prompt || body.questionPrompt || body.promptText || "");
  body.questionPrompt = String(body.questionPrompt || body.prompt || body.promptText || "");
  body.wordCount = Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : countWords(body.essay);
  return body;
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function clipText(text, maxChars) {
  const value = String(text || "").trim();
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function stripBomAndUnsafeChars(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function removeCodeFence(text) {
  const raw = stripBomAndUnsafeChars(text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : raw).trim();
}

function extractBalancedJson(text) {
  const raw = removeCodeFence(text);
  const start = raw.indexOf("{");
  if (start < 0) return raw;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  const last = raw.lastIndexOf("}");
  if (last > start) return raw.slice(start, last + 1);
  return raw.slice(start);
}

function looseJsonClean(text) {
  return stripBomAndUnsafeChars(text)
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response");

  const candidates = [
    raw,
    removeCodeFence(raw),
    extractBalancedJson(raw),
    looseJsonClean(extractBalancedJson(raw))
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  const err = new Error(`AI did not return valid JSON: ${lastError ? lastError.message : "unknown parse error"}`);
  err.rawResponse = raw.slice(0, 12000);
  throw err;
}

function bilingualFallback(value, fallbackEn = "No specific issue was found.") {
  if (value && typeof value === "object") {
    return {
      en: String(value.en || value.english || value.text || fallbackEn).trim(),
      zh: String(value.zh || value.chinese || value.meaningZh || value.explanationZh || "中文解释暂缺：请重新生成该模块。").trim()
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { en: value.trim(), zh: "中文解释暂缺：请重新生成该模块。" };
  }
  return { en: fallbackEn, zh: "中文解释暂缺：请重新生成该模块。" };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeModuleResult(moduleName, value) {
  const result = value && typeof value === "object" ? { ...value } : {};
  result.summary = bilingualFallback(result.summary, "This module has completed its feedback.");
  result.priorityAdvice = bilingualFallback(result.priorityAdvice, "Focus on the most useful next step first.");

  if (moduleName === "overview") {
    result.topProblems = asArray(result.topProblems).slice(0, 6);
    result.errorSummary = asArray(result.errorSummary).slice(0, 10);
    result.nextPracticeFocus = asArray(result.nextPracticeFocus).slice(0, 8);
  }

  if (moduleName === "sentenceUpgrade") {
    result.sentenceCards = asArray(result.sentenceCards || result.sentences).slice(0, 12).map((item, index) => ({
      index: Number(item.index) || index + 1,
      original: String(item.original || "").trim(),
      originalZh: String(item.originalZh || item.originalTranslationZh || "").trim(),
      hasClearError: item.hasClearError === false ? false : true,
      issueTags: asArray(item.issueTags || item.errorTags || item.problemTags).slice(0, 8),
      minimalCorrection: String(item.minimalCorrection || item.corrected || "").trim(),
      minimalCorrectionZh: String(item.minimalCorrectionZh || item.correctedZh || "").trim(),
      upgradedVersion: String(item.upgradedVersion || item.improvedVersion || "").trim(),
      upgradedVersionZh: String(item.upgradedVersionZh || item.improvedVersionZh || "").trim(),
      whyBetter: bilingualFallback(item.whyBetter || item.explanation || item.reason, "This version is clearer and more suitable for the task."),
      learnThis: bilingualFallback(item.learnThis || item.studyPoint || item.usefulPattern, "Learn the sentence pattern and reuse it only when it matches your meaning."),
      usefulPattern: bilingualFallback(item.usefulPattern || item.pattern, "A useful pattern from this sentence.")
    })).filter((item) => item.original || item.minimalCorrection || item.upgradedVersion);
  }

  if (moduleName === "grammarWordFormSpelling") {
    result.grammarErrors = asArray(result.grammarErrors).map((item, index) => ({
      index: Number(item.index) || index + 1,
      errorType: String(item.errorType || item.type || "grammar").trim(),
      original: String(item.original || item.evidence || "").trim(),
      originalZh: String(item.originalZh || item.evidenceZh || "").trim(),
      corrected: String(item.corrected || item.correction || "").trim(),
      correctedZh: String(item.correctedZh || item.correctionZh || "").trim(),
      explanation: bilingualFallback(item.explanation || item.reason, "This is a grammar issue."),
      checkMethod: bilingualFallback(item.checkMethod || item.nextCheck, "Check this grammar pattern when you revise.")
    })).filter((item) => item.original || item.corrected);
    result.wordFormErrors = asArray(result.wordFormErrors || result.wordFormAndPartOfSpeechErrors).map((item, index) => ({
      index: Number(item.index) || index + 1,
      errorType: String(item.errorType || item.type || "word_form").trim(),
      original: String(item.original || item.wrong || "").trim(),
      originalZh: String(item.originalZh || "").trim(),
      corrected: String(item.corrected || item.correct || item.correction || "").trim(),
      correctedZh: String(item.correctedZh || item.correctZh || "").trim(),
      explanation: bilingualFallback(item.explanation || item.reason, "This is a word form or part-of-speech issue."),
      checkMethod: bilingualFallback(item.checkMethod || item.nextCheck, "Check whether the sentence needs a noun, verb, adjective, or adverb.")
    })).filter((item) => item.original || item.corrected);
    result.spellingQuickFix = asArray(result.spellingQuickFix || result.spellingErrors).map((item) => ({
      wrong: String(item.wrong || item.original || "").trim(),
      correct: String(item.correct || item.correction || "").trim(),
      note: String(item.note || item.reason || "spelling").trim()
    })).filter((item) => item.wrong || item.correct);
    result.learningFocus = asArray(result.learningFocus || result.grammarLearningFocus).slice(0, 8);
  }

  if (moduleName === "structureCohesionTask") {
    result.cohesion = result.cohesion && typeof result.cohesion === "object" ? result.cohesion : { issues: asArray(result.cohesionIssues) };
    result.development = result.development && typeof result.development === "object" ? result.development : { issues: asArray(result.developmentIssues) };
    result.taskResponse = result.taskResponse && typeof result.taskResponse === "object" ? result.taskResponse : {};
  }

  if (moduleName === "expressionBank") {
    result.usefulExpressions = asArray(result.usefulExpressions || result.expressions).slice(0, 8);
    result.avoidForNow = asArray(result.avoidForNow || result.avoid).slice(0, 5);
  }

  return result;
}

function extractFrozenOverallBand(body) {
  const frozenScore = body.frozenScore;
  const currentResult = body.currentResult;
  const candidates = [
    frozenScore && frozenScore.overall,
    frozenScore && frozenScore.overallBand,
    frozenScore && frozenScore.finalBand,
    frozenScore && frozenScore.score,
    frozenScore && frozenScore.band,
    currentResult && currentResult.overallBand,
    currentResult && currentResult.scoreCalculation && currentResult.scoreCalculation.finalBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n * 2) / 2;
  }
  return null;
}

function targetUpgradeGuidance(body) {
  const band = extractFrozenOverallBand(body);
  if (!Number.isFinite(band)) {
    return "No frozen score was provided. Use a modest learner-friendly next-step upgrade, not a high-band rewrite.";
  }
  const lower = Math.min(9, Math.round((band + 0.5) * 2) / 2).toFixed(1);
  const upper = Math.min(9, Math.round((band + 1.0) * 2) / 2).toFixed(1);
  let level = "moderate IELTS learner-friendly wording";
  if (band <= 5) level = "simple, clear, accurate wording that a Band 4-5 learner can realistically imitate";
  else if (band < 7) level = "clear Band 6-style wording with natural collocation but not difficult vocabulary";
  else level = "concise natural refinement without unnecessary complexity";
  return `Frozen overall band is about ${band.toFixed(1)}. Target feedback should help the learner move toward about Band ${lower}-${upper}, using ${level}. Do not provide expressions far above this level.`;
}

function buildPrompt(body, moduleName) {
  const moduleConfig = MODULES[moduleName];
  const task = normalizeRequestedTask(body);
  const frozenScore = JSON.stringify({ frozenScore: body.frozenScore || null, currentResult: body.currentResult ? { overallBand: body.currentResult.overallBand || body.currentResult.scoreCalculation?.finalBand, criteria: body.currentResult.finalCriteria || body.currentResult.criteria } : null }, null, 2);
  const taskSpecificContext = task === "Task 1"
    ? JSON.stringify({ task1BulletPoints: body.task1BulletPoints || [], letterStyle: body.letterStyle || "", requirement: "Evaluate purpose, tone, bullet coverage, paragraphing, cohesion, and ending based on this exact GT letter prompt." }, null, 2)
    : JSON.stringify({ task2QuestionProfile: body.task2QuestionProfile || null, requirement: "Evaluate whether all parts of the exact Task 2 prompt are answered, including position, development, examples, and conclusion." }, null, 2);

  return [
    "You are an IELTS General Training writing feedback tutor.",
    "The IELTS score has already been frozen by another system. You are NOT scoring the essay.",
    "The selected task is locked by the request. Do not reclassify Task 1 and Task 2.",
    "Highest priority rule: every piece of feedback must be based on the exact prompt and the student's exact essay. Do not use generic local-template-like advice.",
    "Do not change, estimate, mention, recommend, or recalculate any IELTS score or criterion band.",
    "Your only job is targeted learning feedback for the requested module.",
    "Return VALID JSON only. No markdown, no code fences, no comments, no trailing prose.",
    "Use only double quotes for JSON strings. Escape any internal double quote as \\\".",
    "Do not put unescaped newlines inside JSON strings.",
    "Do not leave dangling commas. Do not omit commas between array elements.",
    "Keep each string concise. Long explanations increase JSON failure risk.",
    "Every user-facing English explanation, label, advice, example explanation, rule, sentence, correction, improved expression, or quoted English text must include a Chinese explanation or Chinese meaning in the paired zh field or the matching *Zh field.",
    `Requested module: ${moduleName} - ${moduleConfig.title}`,
    `Item limit: ${moduleConfig.maxItems}`,
    `Module instructions: ${moduleConfig.instructions.join(" ")}`,
    "Output JSON must have this shape exactly:",
    JSON.stringify({ ok: true, feedbackVersion: FEEDBACK_VERSION, module: moduleName, moduleTitle: moduleConfig.title, moduleResult: moduleConfig.schema }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Title: ${body.title || ""}`,
    `Prompt: ${clipText(body.prompt || body.questionPrompt || body.promptText || "", 2200)}`,
    `Task-specific requirements extracted by local code, for context only: ${taskSpecificContext}`,
    `Frozen score for level reference only: ${frozenScore}`,
    `Target upgrade level for feedback: ${targetUpgradeGuidance(body)}`,
    `Essay word count: ${countWords(body.essay)}`,
    "Student essay:",
    clipText(body.essay || "", moduleName === "sentenceUpgrade" || moduleName === "grammarWordFormSpelling" ? 6200 : 7000)
  ].join("\n\n");
}

async function postDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.15,
        max_tokens: Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : 5000,
        messages
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message || text.slice(0, 300)}`);
    return payload.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

async function repairJsonWithDeepSeek(badText, errorMessage) {
  const repairPrompt = [
    "Repair the following malformed JSON into valid JSON.",
    "Return ONLY valid JSON. No markdown. No explanation.",
    "Preserve the original content as much as possible.",
    "If an array element is broken, either fix it or remove only that broken element.",
    `Original JSON parse error: ${errorMessage}`,
    "Malformed JSON:",
    clipText(badText, 12000)
  ].join("\n\n");

  const content = await postDeepSeek([
    { role: "system", content: "You repair malformed JSON. Return valid JSON only." },
    { role: "user", content: repairPrompt }
  ], { temperature: 0, maxTokens: 6000 });

  return extractJson(content);
}

async function callDeepSeek(prompt, moduleName) {
  const content = await postDeepSeek([
    { role: "system", content: "Return strict valid JSON only. Every item must be specific to the prompt and student's essay. Never assign or change IELTS scores." },
    { role: "user", content: prompt }
  ], { temperature: 0.15, maxTokens: MODULES[moduleName]?.maxTokens || 5000 });

  try {
    return extractJson(content);
  } catch (error) {
    try {
      return await repairJsonWithDeepSeek(content, error.message);
    } catch (repairError) {
      repairError.originalParseError = error.message;
      throw repairError;
    }
  }
}

function fallbackModuleResult(moduleName, error) {
  return {
    summary: {
      en: "This module could not be generated reliably because the AI response was not valid JSON.",
      zh: "这个模块暂时没有可靠生成，因为 AI 返回格式异常。请点击重新生成。"
    },
    priorityAdvice: {
      en: "Retry this module. The frozen score is unchanged.",
      zh: "请重新生成该模块。已经冻结的分数不会被修改。"
    },
    generationWarning: String(error && (error.message || error) || "unknown error").slice(0, 500)
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = normalizeIncomingBody(await readJsonBody(req));
    const moduleName = String(body.module || "").trim();
    const essay = String(body.essay || "").trim();

    if (!MODULES[moduleName]) {
      return sendJson(req, res, 400, { ok: false, error: "Unsupported feedback module", supportedModules: Object.keys(MODULES) });
    }

    if (!essay) return sendJson(req, res, 400, { ok: false, error: "Essay is required" });

    try {
      const raw = await callDeepSeek(buildPrompt(body, moduleName), moduleName);
      const moduleResult = normalizeModuleResult(moduleName, raw.moduleResult || raw.result || raw);
      return sendJson(req, res, 200, {
        ok: true,
        feedbackVersion: FEEDBACK_VERSION,
        module: moduleName,
        moduleTitle: MODULES[moduleName].title,
        task: normalizeRequestedTask(body),
        taskLocked: true,
        system: "learning-feedback-v2",
        wordCount: countWords(essay),
        scoreUnaffected: true,
        feedbackOnly: true,
        systemFeedback: { status: "generated", scoreChanged: false, message: "学习反馈已生成；没有调用评分流程，也没有改变已冻结分数。" },
        moduleResult
      });
    } catch (error) {
      return sendJson(req, res, 200, {
        ok: true,
        feedbackVersion: FEEDBACK_VERSION,
        module: moduleName,
        moduleTitle: MODULES[moduleName].title,
        task: normalizeRequestedTask(body),
        taskLocked: true,
        system: "learning-feedback-v2",
        wordCount: countWords(essay),
        scoreUnaffected: true,
        feedbackOnly: true,
        fallbackUsed: true,
        systemFeedback: { status: "fallback", scoreChanged: false, message: "该学习反馈模块返回格式异常，系统已保留重新生成入口。分数没有改变。" },
        moduleResult: fallbackModuleResult(moduleName, error)
      });
    }
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: "Feedback generation failed", detail: String(error.message || error) });
  }
};

module.exports.config = { maxDuration: 300 };
