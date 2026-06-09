const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const FEEDBACK_VERSION = "feedback-v1-bilingual-learning-modules";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_FEEDBACK_TIMEOUT_MS) || 150000, 240000));

const MODULES = {
  structureCohesion: {
    title: "结构与衔接诊断 / Structure and Cohesion Diagnosis",
    maxItems: "4 paragraphMap entries and 5 cohesionProblems maximum",
    schema: {
      summary: { en: "", zh: "" },
      paragraphMap: [
        { paragraph: 1, function: { en: "", zh: "" }, diagnosis: { en: "", zh: "" }, suggestion: { en: "", zh: "" } }
      ],
      cohesionProblems: [
        { problem: { en: "", zh: "" }, example: { en: "", zh: "" }, fix: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Diagnose structure, paragraph function, logical progression, referencing, repetition, and linking. For Task 1, focus on letter purpose, bullet-point order, tone/register, and whether the message reads like a real letter. For Task 2, focus on introduction, topic sentences, development, examples, conclusion, and progression. Do not score the essay.`
  },
  spellingWordForm: {
    title: "拼写和词形诊断 / Spelling and Word Form Diagnosis",
    maxItems: "8 items maximum",
    schema: {
      summary: { en: "", zh: "" },
      items: [
        { original: "", correction: "", type: "spelling | word_form | plural | verb_form | capitalization", explanation: { en: "", zh: "" }, memoryTip: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Find spelling errors, wrong word forms, noun plural mistakes, verb form errors, adjective/adverb form errors, derived word errors, and capitalization problems. If there are no clear issues, return a bilingual summary and an empty items array. Do not invent errors.`
  },
  grammar: {
    title: "语法诊断 / Grammar Diagnosis",
    maxItems: "8 items maximum",
    schema: {
      summary: { en: "", zh: "" },
      items: [
        { originalSentence: "", correctedSentence: "", errorType: { en: "", zh: "" }, explanation: { en: "", zh: "" }, rule: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Identify grammar problems by type: subject-verb agreement, tense, articles, plurals, prepositions, sentence structure, clauses, verb forms, punctuation, fragments, and run-on sentences. Explain the rule in learner-friendly Chinese. Do not score the essay.`
  },
  vocabularyCollocation: {
    title: "词汇选择和搭配诊断 / Vocabulary Choice and Collocation Diagnosis",
    maxItems: "8 items maximum",
    schema: {
      summary: { en: "", zh: "" },
      items: [
        { original: "", better: "", problemType: { en: "", zh: "" }, explanation: { en: "", zh: "" }, bandEffect: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Find unnatural collocations, inaccurate word choice, Chinglish expressions, over-general vocabulary, repeated words, register problems, and misused advanced words. Give natural IELTS-appropriate alternatives. Do not score the essay.`
  },
  sentenceCorrections: {
    title: "逐句批改 / Sentence-by-Sentence Correction",
    maxItems: "12 sentences maximum; prioritise sentences with errors or improvement value",
    schema: {
      summary: { en: "", zh: "" },
      sentences: [
        { index: 1, original: "", minimalCorrection: "", improvedVersion: "", explanation: { en: "", zh: "" }, errorTags: [{ en: "", zh: "" }] }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Correct sentence by sentence. Minimal correction should preserve the student's meaning and structure while fixing clear errors. Improved version should sound more natural and IELTS-appropriate while still preserving meaning. Explain every change in Chinese. Do not produce a full model essay and do not score.`
  },
  betterExpressions: {
    title: "更好表达 / Better Expression",
    maxItems: "8 items maximum",
    schema: {
      summary: { en: "", zh: "" },
      items: [
        { original: "", problem: { en: "", zh: "" }, basicVersion: { en: "", zh: "" }, improvedVersion: { en: "", zh: "" }, highBandVersion: { en: "", zh: "" }, usageNote: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: `Upgrade weak expressions without changing meaning. Provide three levels: basic safe expression, improved Band 6 style expression, and high-band natural expression. Explain when and why to use each version in Chinese. Do not generate a full model essay and do not score.`
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

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function clipText(text, maxChars) {
  const value = String(text || "").trim();
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response");
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error("AI did not return valid JSON");
}

function bilingualFallback(value, fallbackEn = "No specific issue was found.") {
  if (value && typeof value === "object") {
    return {
      en: String(value.en || value.english || fallbackEn).trim(),
      zh: String(value.zh || value.chinese || "中文解释暂缺：请重新生成该模块。").trim()
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { en: value.trim(), zh: "中文解释暂缺：请重新生成该模块。" };
  }
  return { en: fallbackEn, zh: "中文解释暂缺：请重新生成该模块。" };
}

function normaliseResult(moduleName, value) {
  const result = value && typeof value === "object" ? value : {};
  result.summary = bilingualFallback(result.summary, "The module has completed its diagnosis.");
  result.priorityAdvice = bilingualFallback(result.priorityAdvice, "Focus on the highest-impact issues first.");
  if (moduleName === "structureCohesion") {
    result.paragraphMap = Array.isArray(result.paragraphMap) ? result.paragraphMap.slice(0, 6).map((item, index) => ({
      paragraph: Number(item.paragraph) || index + 1,
      function: bilingualFallback(item.function, "Paragraph function"),
      diagnosis: bilingualFallback(item.diagnosis, "This paragraph has been reviewed."),
      suggestion: bilingualFallback(item.suggestion, "Improve clarity and progression.")
    })) : [];
    result.cohesionProblems = Array.isArray(result.cohesionProblems) ? result.cohesionProblems.slice(0, 8).map((item) => ({
      problem: bilingualFallback(item.problem, "Cohesion issue"),
      example: bilingualFallback(item.example, "Example from the essay"),
      fix: bilingualFallback(item.fix, "Suggested fix")
    })) : [];
  }
  if (moduleName === "spellingWordForm") {
    result.items = Array.isArray(result.items) ? result.items.slice(0, 10).map((item) => ({
      original: String(item.original || "").trim(),
      correction: String(item.correction || "").trim(),
      type: String(item.type || "word_form").trim(),
      explanation: bilingualFallback(item.explanation, "This form should be corrected."),
      memoryTip: bilingualFallback(item.memoryTip, "Remember this form as a fixed spelling or word-family pattern.")
    })).filter((item) => item.original || item.correction) : [];
  }
  if (moduleName === "grammar") {
    result.items = Array.isArray(result.items) ? result.items.slice(0, 10).map((item) => ({
      originalSentence: String(item.originalSentence || item.original || "").trim(),
      correctedSentence: String(item.correctedSentence || item.corrected || "").trim(),
      errorType: bilingualFallback(item.errorType, "Grammar issue"),
      explanation: bilingualFallback(item.explanation, "This grammar point needs correction."),
      rule: bilingualFallback(item.rule, "Use the correct form according to the sentence grammar.")
    })).filter((item) => item.originalSentence || item.correctedSentence) : [];
  }
  if (moduleName === "vocabularyCollocation") {
    result.items = Array.isArray(result.items) ? result.items.slice(0, 10).map((item) => ({
      original: String(item.original || "").trim(),
      better: String(item.better || item.correction || "").trim(),
      problemType: bilingualFallback(item.problemType, "Vocabulary or collocation issue"),
      explanation: bilingualFallback(item.explanation, "This expression can be made more natural or precise."),
      bandEffect: bilingualFallback(item.bandEffect, "More accurate vocabulary can improve Lexical Resource.")
    })).filter((item) => item.original || item.better) : [];
  }
  if (moduleName === "sentenceCorrections") {
    result.sentences = Array.isArray(result.sentences) ? result.sentences.slice(0, 14).map((item, index) => ({
      index: Number(item.index) || index + 1,
      original: String(item.original || "").trim(),
      minimalCorrection: String(item.minimalCorrection || item.corrected || "").trim(),
      improvedVersion: String(item.improvedVersion || "").trim(),
      explanation: bilingualFallback(item.explanation, "This sentence has been corrected or improved."),
      errorTags: Array.isArray(item.errorTags) ? item.errorTags.slice(0, 5).map((tag) => bilingualFallback(tag, "Writing issue")) : []
    })).filter((item) => item.original || item.minimalCorrection || item.improvedVersion) : [];
  }
  if (moduleName === "betterExpressions") {
    result.items = Array.isArray(result.items) ? result.items.slice(0, 10).map((item) => ({
      original: String(item.original || "").trim(),
      problem: bilingualFallback(item.problem, "The original expression is weak or unnatural."),
      basicVersion: bilingualFallback(item.basicVersion, "A safer basic expression"),
      improvedVersion: bilingualFallback(item.improvedVersion, "A clearer improved expression"),
      highBandVersion: bilingualFallback(item.highBandVersion, "A more natural high-band expression"),
      usageNote: bilingualFallback(item.usageNote, "Use this version when it accurately matches your meaning.")
    })).filter((item) => item.original || item.basicVersion.en || item.improvedVersion.en) : [];
  }
  return result;
}

function buildPrompt(body, moduleName) {
  const moduleConfig = MODULES[moduleName];
  const schema = JSON.stringify(moduleConfig.schema, null, 2);
  const frozenScore = body.frozenScore ? JSON.stringify(body.frozenScore, null, 2) : "null";
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  return [
    "You are an IELTS General Training writing feedback tutor.",
    "The IELTS score has already been frozen by another system. You are NOT scoring the essay.",
    "Do not change, estimate, mention, recommend, or recalculate any IELTS score or criterion band.",
    "Your only job is bilingual learning feedback for the requested module.",
    "Every user-facing English explanation, label, advice, example explanation, or rule must include a Chinese explanation in the paired zh field.",
    "Return valid JSON only. No markdown, no code fences, no comments.",
    `Requested module: ${moduleName} - ${moduleConfig.title}`,
    `Item limit: ${moduleConfig.maxItems}`,
    `Module instructions: ${moduleConfig.instructions}`,
    "Use simple, practical Chinese explanations for IELTS learners.",
    "If there are no issues in a category, return an empty items array and a bilingual summary explaining that no major issue was found.",
    "Preserve the student's original meaning. Do not write a full model essay unless the module explicitly asks for sentence-level improved versions.",
    "Output JSON must have this shape exactly:",
    JSON.stringify({ ok: true, feedbackVersion: FEEDBACK_VERSION, module: moduleName, moduleTitle: moduleConfig.title, moduleResult: moduleConfig.schema }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Prompt: ${clipText(body.prompt || body.questionPrompt || body.promptText || "", 1800)}`,
    `Frozen score for reference only, do not change it: ${frozenScore}`,
    `Essay word count: ${countWords(body.essay)}`,
    "Student essay:",
    clipText(body.essay || "", 6500)
  ].join("\n\n");
}

async function callDeepSeek(prompt) {
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
        temperature: 0.2,
        max_tokens: 3000,
        messages: [
          { role: "system", content: "Return strict JSON only. Every English explanation must have a paired Chinese zh explanation. Never assign or change IELTS scores." },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message || text.slice(0, 300)}`);
    const content = payload.choices?.[0]?.message?.content || "";
    return extractJson(content);
  } finally {
    clearTimeout(timeout);
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
    return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const body = await readJsonBody(req);
    const moduleName = String(body.module || "").trim();
    const essay = String(body.essay || "").trim();
    if (!MODULES[moduleName]) {
      return sendJson(req, res, 400, { ok: false, error: "Unsupported feedback module", supportedModules: Object.keys(MODULES) });
    }
    if (!essay) return sendJson(req, res, 400, { ok: false, error: "Essay is required" });
    const raw = await callDeepSeek(buildPrompt(body, moduleName));
    const moduleResult = normaliseResult(moduleName, raw.moduleResult || raw.result || raw);
    return sendJson(req, res, 200, {
      ok: true,
      feedbackVersion: FEEDBACK_VERSION,
      module: moduleName,
      moduleTitle: MODULES[moduleName].title,
      task: body.task === "Task 1" ? "Task 1" : "Task 2",
      wordCount: countWords(essay),
      scoreUnaffected: true,
      moduleResult
    });
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: "Feedback generation failed", detail: String(error.message || error) });
  }
};
