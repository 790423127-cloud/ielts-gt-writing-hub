const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      url.hostname.includes("ielts-gt-writing-hub") &&
      url.hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DISCLAIMER = "This is an AI-generated estimated score and revision, not an official IELTS score.";

const AI_SINGLE_REQUEST_TIMEOUT_MS = Math.max(
  60000,
  Math.min(Number(process.env.AI_SINGLE_REQUEST_TIMEOUT_MS || process.env.AI_REQUEST_TIMEOUT_MS) || 150000, 240000)
);
const AI_TOTAL_REQUEST_TIMEOUT_MS = Math.max(
  120000,
  Math.min(Number(process.env.AI_TOTAL_REQUEST_TIMEOUT_MS) || 260000, 290000)
);
const AI_CACHE_TTL_MS = Math.max(0, Math.min(Number(process.env.AI_CACHE_TTL_MS) || 30 * 60 * 1000, 6 * 60 * 60 * 1000));
const AI_RESPONSE_CACHE = globalThis.__IELTS_AI_RESPONSE_CACHE__ || new Map();
globalThis.__IELTS_AI_RESPONSE_CACHE__ = AI_RESPONSE_CACHE;

function remainingAiTime(deadline) {
  if (!deadline) return AI_SINGLE_REQUEST_TIMEOUT_MS;
  return Math.max(0, deadline - Date.now() - 1000);
}

function resolveAiTimeout(deadline, requestedTimeout) {
  const base = requestedTimeout
    ? Math.min(requestedTimeout, AI_SINGLE_REQUEST_TIMEOUT_MS)
    : AI_SINGLE_REQUEST_TIMEOUT_MS;
  return Math.max(1000, Math.min(base, remainingAiTime(deadline)));
}



function normalizeLocale(value) {
  const raw = String(value || "en").toLowerCase();
  return raw.startsWith("zh") || raw.includes("chinese") ? "zh-CN" : "en";
}

function isChineseLocale(locale) {
  return normalizeLocale(locale) === "zh-CN";
}

function emptyForLocaleZh(value, locale) {
  return value;
}

function localizeResultForOutput(result, locale) {
  return result;
}

function lowWordCountReason(body) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  return `${task} has ${words} words, below the recommended minimum of ${threshold} words. DeepSeek must still assess it on the full IELTS 1-9 scale, using Band 1 as the minimum visible band even when the response is extremely weak, and apply strict word-count caps without inventing a minimum score.`;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowedOrigin = isAllowedOrigin(origin)
    ? origin
    : "https://790423127-cloud.github.io";

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
  const raw = String(mode || "").toLowerCase();
  if (["revision", "grading_revision", "detailed_revision", "with_model", "with-model", "model", "model_answer"].includes(raw)) return "revision";
  return "full";
}

function isVeryShortEssay(body) {
  const words = Number(body.wordCount) || 0;
  return body.task === "Task 1" ? words < 80 : words < 150;
}

function maxTokensForMode(mode, veryShort) {
  // Two user-facing modes are now supported:
  // full = detailed grading without model answer; revision = detailed grading + model/revision.
  // The user now prefers maximum AI feedback quality over token savings.
  // Keep very short essays smaller, but allow full essays enough room for rich evidence.
  if (mode === "revision") return veryShort ? 5200 : 11000;
  return veryShort ? 4200 : 8500;
}


function countWordsServer(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function roundHalf(value) {
  return Math.max(0, Math.min(9, Math.round(Number(value || 0) * 2) / 2));
}

function formatBand(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function clampAiBand(value, fallback = 1) {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(1, Math.min(9, Math.round(base * 2) / 2));
}

function normalizeAiBandsOnly(result, body) {
  // AI-only scoring guard: keep the model's judgement, but enforce the app's 1-9 visible range.
  // This does not create a local score and does not apply local caps.
  const fallbackBand = 1;
  result.overallBand = clampAiBand(result.overallBand, fallbackBand);
  result.estimatedLevel = `Band ${formatBand(result.overallBand)}`;

  ensureCriteria(result, body?.task);
  Object.values(result.criteria || {}).forEach((criterion) => {
    criterion.band = clampAiBand(criterion.band, result.overallBand);
  });

  result.scoreCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object"
    ? result.scoreCalibration
    : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };
  result.scoreCalibration.strictness = result.scoreCalibration.strictness || "strict";
}

function firstCriterionName(task) {
  return task === "Task 1" ? "Task Achievement" : "Task Response";
}

function mostlyNonEnglish(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const latin = (trimmed.match(/[A-Za-z]/g) || []).length;
  const cjk = (trimmed.match(/[\u3400-\u9fff]/g) || []).length;
  const letters = latin + cjk;
  return letters > 0 && (latin / letters < 0.25 || (cjk >= 8 && latin < 12));
}

function tokenSet(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) || []);
}

function mostlyCopiedFromPrompt(essay, prompt) {
  const essayTokens = [...tokenSet(essay)].filter((token) => token.length > 2);
  const promptTokens = tokenSet(prompt);
  if (essayTokens.length < 8 || promptTokens.size < 8) return false;
  const overlap = essayTokens.filter((token) => promptTokens.has(token)).length;
  return overlap / essayTokens.length >= 0.72;
}

function buildLowBandDiagnostics(body) {
  const essay = String(body.essay || "");
  const trimmed = essay.trim();
  const words = Number(body.wordCount) || countWordsServer(essay);
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const isBlank = !trimmed;
  const nonEnglish = mostlyNonEnglish(essay);
  const copied = mostlyCopiedFromPrompt(essay, body.questionPrompt);
  const wordCount20OrFewer = words > 0 && words <= 20;
  const severeTask1 = task === "Task 1" && words < 50;
  const severeTask2 = task === "Task 2" && words < 80;

  let recommendedLowBandRange = "";
  let reason = "No low-band trigger detected.";
  if (isBlank) {
    recommendedLowBandRange = "0";
    reason = "The response is blank or has no rateable attempt.";
  } else if (nonEnglish) {
    recommendedLowBandRange = "0";
    reason = "The response is mostly not written in English.";
  } else if (copied) {
    recommendedLowBandRange = "0-1.0";
    reason = "The response appears mostly copied from the question prompt.";
  } else if (wordCount20OrFewer) {
    recommendedLowBandRange = "1.0";
    reason = "The response has 20 words or fewer and provides very little rateable language.";
  } else if (severeTask1 || severeTask2) {
    recommendedLowBandRange = "2.0-3.5";
    reason = "The response is extremely short and misses most task requirements.";
  } else if (task === "Task 1" && words < 150) {
    recommendedLowBandRange = words < 80 ? "3.0-4.0" : (words < 120 ? "4.0-5.0" : "Underlength warning");
    reason = `Task 1 has ${words} words, below the recommended 150-word minimum. Task Achievement and development are limited.`;
  } else if (task === "Task 2" && words < 250) {
    recommendedLowBandRange = words < 150 ? "3.0-4.0" : (words < 200 ? "4.0-5.0" : "Underlength warning");
    reason = `Task 2 has ${words} words, below the recommended 250-word minimum. Task Response and idea development are limited.`;
  }

  return {
    isBlank,
    wordCount20OrFewer,
    mostlyNonEnglish: nonEnglish,
    mostlyCopiedFromPrompt: copied,
    mostlyMemorised: false,
    whollyUnrelated: false,
    barelyRelated: false,
    littleRelevantMessage: isBlank || nonEnglish || copied || wordCount20OrFewer || severeTask1 || severeTask2,
    noClearPositionTask2: false,
    noBulletPointCoverageTask1: false,
    meaningMostlyBlocked: isBlank || nonEnglish || wordCount20OrFewer,
    recommendedLowBandRange,
    reason
  };
}

function capFromDiagnostics(body, diagnostics) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const firstCriterion = firstCriterionName(task);

  if (diagnostics.isBlank || diagnostics.mostlyNonEnglish) {
    return { cap: 0, firstCap: 0, reason: diagnostics.reason || "No rateable English response." };
  }
  if (diagnostics.mostlyCopiedFromPrompt) {
    return { cap: 1, firstCap: 1, reason: "The response is mostly copied from the prompt and has little original rateable writing." };
  }
  if (words <= 5) {
    return { cap: 1, firstCap: 1, reason: "The response has 5 words or fewer; assess from Band 0-1 depending on whether any rateable original English is present." };
  }
  if (words <= 20) {
    return { cap: 2, firstCap: 2, reason: "The response has 20 words or fewer; assess from Band 0-2 depending on rateable content, relevance, and clarity." };
  }
  if (task === "Task 1") {
    if (words < 50) return { cap: 3, firstCap: 3, reason: "Task 1 is under 50 words; assess strictly from Band 0-3 depending on rateable content, relevance, and task coverage." };
    if (words < 80) return { cap: 4, firstCap: 4, reason: "Task 1 is 50-79 words; Task Achievement is normally capped at Band 4." };
    if (words < 120) return { cap: 5, firstCap: 5, reason: "Task 1 is 80-119 words; task coverage and development are limited." };
  } else {
    if (words < 80) return { cap: 3, firstCap: 3, reason: "Task 2 is under 80 words; assess strictly from Band 0-3 depending on rateable content, relevance, and task response." };
    if (words < 150) return { cap: 4, firstCap: 4, reason: "Task 2 is 80-149 words; Task Response is normally capped at Band 4." };
    if (words < 200) return { cap: 5, firstCap: 5, reason: "Task 2 is 150-199 words; argument development is too limited for higher Task Response." };
  }

  if (diagnostics.noClearPositionTask2) {
    return { cap: 4, firstCap: 4, reason: `${firstCriterion} is capped because no clear Task 2 position is evident.` };
  }
  if (diagnostics.noBulletPointCoverageTask1) {
    return { cap: 4, firstCap: 4, reason: `${firstCriterion} is capped because Task 1 bullet point coverage is not sufficiently evident.` };
  }
  return { cap: null, firstCap: null, reason: "" };
}

function buildSystemPrompt(veryShort = false, locale = "en") {
  const outputLanguageInstruction = isChineseLocale(locale)
    ? "Output language request: English feedback may include brief Chinese helper notes only in fields ending with Zh. Do not translate whole essays."
    : "Output language request: main feedback must be English. Also include brief hidden Chinese helper notes only in fields ending with Zh so the front end can reveal them on demand. Do not put Chinese inside normal English feedback fields.";
  const rules = [
    outputLanguageInstruction,
    "You are a strict IELTS Writing examiner and writing coach.",
    "The score is only an AI estimated score, not an official IELTS score.",
    "Your score must be evidence-based, conservative, and aligned with IELTS Writing public band descriptor logic.",
    "Do not give encouragement-based scores.",
    "Do not over-score weak writing.",
    "If uncertain between two bands, choose the lower band.",
    "Penalise missing task requirements strictly.",
    "Penalise very short responses strictly.",
    "Penalise unclear meaning strictly.",
    "Penalise frequent grammar errors strictly.",
    "Penalise limited vocabulary and word-choice errors.",
    "Penalise poor paragraphing and poor progression.",
    "Penalise memorised/template-like language.",
    "Penalise copying from the question prompt.",
    "Band 5.5+ is not a minimum score. Award Band 5.5 or above only when the writing has enough content, mostly understandable meaning, some organisation, and sufficient task coverage. Weak or very incomplete responses may score 0-5.",
    "Assess the essay using the four IELTS Writing criteria.",
    "For Task 1, use Task Achievement as the first criterion.",
    "For Task 2, use Task Response as the first criterion.",
    "Do not mix Task 1 and Task 2 first criteria.",
    "Task 1 word logic: the recommended minimum is 150 words. Do not apply Task 2 250-word thresholds. A Task 1 letter with 150+ words is not underlength. There is no maximum word count cap for Task 1. A 270-word or longer Task 1 letter may be long, but length alone is not a low-band trigger. Do not set revisionLimited=true for a 150+ word Task 1 unless it is blank, mostly non-English, mostly copied, wholly unrelated, or clearly Band 0-3. If a Task 1 letter fully covers all bullet points, uses appropriate tone, and has accurate language, allow Band 8-9; do not cap it at Band 7 without specific evidence.",
    "Task 2 word logic: the recommended minimum is 250 words. Do not apply Task 1 bullet point rules to Task 2. There is no maximum word count cap for Task 2; do not penalise length alone unless excessive length clearly harms relevance, coherence, task focus, or language control.",
    "Strict IELTS scoring does not mean artificially low scoring. A normal-length response that fully answers the task, is coherent, well developed, and accurate can receive Band 7, Band 8, or Band 9. Do not use Band 7 as a default ceiling. Band 8 does not require a perfect essay; occasional minor errors are acceptable when communication is strong. Band 9 does not require literary or native-level writing; it requires full task fulfilment, natural organisation, precise vocabulary, flexible grammar, and very rare minor errors. If the response is official-sample quality and answers the selected prompt, allow Band 8-9. Do not force strong relevant samples into Band 5 or Band 7.",
    "Low-band diagnostics should trigger only for clear evidence: blank/no attempt, 20 words or fewer, mostly non-English, mostly copied from prompt, wholly unrelated, little relevant message, no rateable English, or meaning mostly blocked. Do not trigger low-band diagnostics merely because language is simple, not advanced, not Band 9, or because a Task 1 answer is over 250 words.",
    "scoreCalibration.capApplied must be true only for a real cap: word count below the relevant threshold, Task 1 missing major bullet points, Task 2 no clear position when required, off-topic, mostly copied, mostly non-English, meaning mostly blocked, blank/no attempt, or task mismatch.",
    "Score from 1 to 9 and allow half bands. Low-word-count responses must also be assessed from Band 1 upward; never use Band 2, 3, 4, or 5.5 as a minimum score.",
    "There is no upper word-count limit in this app. Do not cap or penalise an answer simply because it is long; only penalise if length causes repetition, irrelevance, weak organisation, or loss of task focus.",
    "Band 9: fully addresses all parts, natural fluent organisation, wide precise vocabulary, flexible highly accurate grammar, very rare minor errors.",
    "High-band distinction: Band 7 covers the task well with clear progression, good vocabulary, some grammar flexibility, and noticeable errors that usually do not block meaning; it may feel somewhat mechanical or less natural.",
    "High-band distinction: Band 8 fully addresses the task with well-developed ideas, natural controlled cohesion, wide precise mostly natural vocabulary, flexible accurate grammar, occasional minor errors, and very well controlled Task 1 tone/purpose.",
    "High-band distinction: Band 9 fully satisfies all task requirements, communicates effortlessly and naturally, has fluent organisation, fully appropriate precise vocabulary, highly flexible grammar, very rare minor errors, and completely appropriate Task 1 tone/purpose/recipient relationship.",
    "If all high-band evidence is present—selected task answered, task minimum met, Task 1 all bullet points covered or Task 2 all parts answered, clear natural organisation, accurate flexible vocabulary, varied mostly accurate grammar, minor errors only, and suitable Task 1 tone—consider Band 8-9.",
    "If highBandDiagnostics recommends 8.0-9.0 but the final score is below 8.0, scoreCalibration must explain exact concrete reasons, not just strict scoring.",
    "Band 8: fully addresses the task with minor weaknesses, clear progression, wide mostly natural vocabulary, varied grammar with only occasional errors.",
    "Band 7: covers the task well, clear progression, good vocabulary range with some errors, complex structures with errors still present.",
    "Band 6: addresses the task but development may be uneven, organisation clear but sometimes mechanical, adequate vocabulary sometimes inaccurate, simple and complex grammar with noticeable errors, meaning generally clear.",
    "Band 5: partially addresses the task, ideas limited or underdeveloped, organisation basic, vocabulary limited with frequent errors, grammar errors frequent but meaning usually understandable.",
    "Band 4: responds only partly, ideas unclear/repetitive/poorly organised, basic often inaccurate vocabulary, frequent grammar errors sometimes reduce meaning.",
    "Band 3: very limited response, serious difficulty communicating ideas, very limited vocabulary, frequent grammar errors often block meaning.",
    "Band 2: barely communicates, very few relevant ideas, mostly fragments, memorised phrases, isolated words, or very limited recognisable strings.",
    "Band 1: almost no ability to communicate in writing, only isolated words or a response of 20 words or fewer.",
    "Band 1: no answer, completely unrelated answer, completely non-English answer, only copied/memorised text, or almost no rateable original writing. Do not return Band 0 in this app.",
    "Use IELTS public band descriptor logic for low bands. Do not give Band 4 or above if there is too little rateable language, mostly unrelated content, mostly copied language, mostly memorised text, or no relevant message.",
    "Band 1 is the minimum visible band in this app. For blank/no attempt, completely non-English, totally memorised, copied prompt text, or no meaningful attempt, return Band 1, scoreCalibration.capApplied true, and no revised essays. Do not return Band 0.",
    "Band 1 normally applies for 20 words or fewer, wholly unrelated content, no relevant message, isolated words, mostly copied prompt, or virtual non-writer. Do not award Band 2+ unless there is a clear relevant original English message.",
    "Band 2 normally applies when content barely relates to the task, there is little relevant message, ideas are undeveloped, organisation is absent, vocabulary is extremely limited, and there is little evidence of sentence forms.",
    "Band 3 normally applies when the task is not adequately addressed, the situation/prompt is misunderstood, ideas are irrelevant or difficult to connect, vocabulary is inadequate, and grammar errors prevent most meaning.",
    "Task 1 word count caps: blank/non-English/no rateable attempt = Band 1; isolated words or mostly copied prompt = Band 1; 20 words or fewer normally no higher than Band 2; under 50 words normally no higher than Band 3; 50-79 words normally no higher than Band 4; 80-119 words normally no higher than Band 5; 120-149 words may score normally but mention limited development if relevant.",
    "Task 2 word count caps: blank/non-English/no rateable attempt = Band 1; isolated words or mostly copied prompt = Band 1; 20 words or fewer normally no higher than Band 2; under 80 words normally no higher than Band 3; 80-149 words normally no higher than Band 4; 150-199 words normally no higher than Band 5; 200-249 words may score normally but mention limited development if relevant.",
    "Do not reject short essays. Grade them, but apply caps.",
    "Task 1 letter caps: if only one bullet point is addressed, Task Achievement normally no higher than 4.0; if two bullet points are addressed but one is missing, no higher than 5.0; wrong tone, missing letter format, inappropriate opening/closing, copied prompt, or unclear purpose reduce Task Achievement.",
    "Task 2 argument caps: no clear position means Task Response normally no higher than 4.0; listed but undeveloped ideas no higher than 5.0; only one side when both required no higher than 5.0; off-topic no higher than 3.0; no conclusion or no examples/details reduces Task Response and/or Coherence.",
    "Coherence caps: no paragraphing normally no higher than 4.0-5.0; ideas listed without progression no higher than 5.0; missing/unnatural linking or repeated and/so/because should not receive high CC; Band 6+ requires clear paragraphing and mostly logical progression.",
    "Lexical caps: extremely basic vocabulary normally no higher than 4.0; frequent word-choice errors affecting meaning normally no higher than 4.0-5.0; heavy repetition or inappropriate register reduces LR; Band 6+ requires enough topic vocabulary and mostly appropriate word choice.",
    "Grammar caps: if most sentences contain serious grammar errors or errors often reduce meaning, GRA normally no higher than 4.0; only simple sentence patterns normally no higher than 5.0; frequent tense/article/plural/word-order/sentence-structure errors should not receive Band 5.5+ unless meaning remains generally clear.",
    "First assign four criterion bands, then estimate overallBand from the criteria, round to nearest 0.5, then apply cap rules. Do not allow overallBand to contradict criterion scores.",
    "Do not give Band 5.5+ when Task Achievement/Task Response is capped at 4.0 or below. Do not give Band 6.0+ if two or more criteria are 5.0 or below. Extremely short essays should normally stay below Band 4.0.",
    "Band 5.5+ is not a minimum. Do not award Band 5.5+ if the essay has two or more serious weaknesses: far below word count, missing major task requirements, no clear paragraphing, frequent grammar errors, unclear meaning, very limited vocabulary, mostly copied prompt, only one or two simple sentences, no Task 2 argument, or fewer than three Task 1 bullet points.",
    "Also do not award Band 5.5+ if Task 1 has 80 words or fewer, Task 2 has 150 words or fewer, only one Task 1 bullet is addressed, Task 2 has no relevant position, response is mostly copied, meaning is blocked, vocabulary is mostly isolated/memorised, little relevant message, or no organisation.",
    "Focus on task fulfilment, bullet point coverage for Task 1, position clarity for Task 2, paragraphing, cohesion, vocabulary accuracy, grammar, sentence structure, spelling, punctuation, Chinese-influenced English, off-topic content, and underdeveloped ideas.",
    "Sentence corrections and grammar errors must be based only on sentences that appear in the user's essay.",
    "Do not invent user sentences.",
    "Always return lowBandDiagnostics and scoreCalibration. If low-band features are clear, scoreCalibration.capApplied must be true and capReason must explain the low-band cap.",
    "scoreCalibration.evidence must have at most 5 items. whyNotHigher and whyNotLower must be specific.",
    "If revision mode is used, generate three clearly different levels: revisedEssayBand5, revisedEssayBand6, revisedEssayBand7.",
    "Band 5 revision: basic but complete, simple clear language, mostly simple sentences, no advanced vocabulary stacking, suitable for Band 5/5.5 learners.",
    "Band 6 revision: complete, clear, natural, better organisation and vocabulary than Band 5, some sentence variety, suitable for Band 6/6.5 learners.",
    "Band 7 revision: mature, clear, logical, natural, flexible but not Band 8/9 style, suitable for Band 7 learners.",
    "Do not produce a Band 9 model answer unless explicitly asked. Do not make revised essays unrealistically advanced. Do not make all three versions sound the same. Keep IELTS General Training style.",
    "If the original is very short, Band 0-3, severely capped, or too limited, do not generate full Band 6 or Band 7 revised essays. revisedEssayBand6 and revisedEssayBand7 should be empty strings and revisedEssayMeta.revisionLimited true.",
    "If Task 1 misses bullet points, the revision must cover all three bullet points and revisionNotes should say what was added. If Task 2 has no position, the revision must add a clear position.",
    "modelAnswerOutline must be an outline only: structure, paragraph content, simple expressions, bullet point arrangement for Task 1, or position/examples for Task 2. Do not write a full essay in the outline.",
    "Error correction requirements: Always return errorAnalysis, spellingCorrections, grammarErrors, sentenceCorrections, detailedSentenceCorrections, task1LetterCorrections or task2EssayCorrections, and correctionPriority.",
    "For spellingCorrections, list all clear misspelled words from the user's essay, with the corrected spelling, the sentence where it appears, a short explanation, and a brief explanationZh.",
    "For detailedSentenceCorrections, use originalSentence from the user's essay only, correctedSentence for direct correction, and betterExpression for a natural IELTS-style improvement without making Band 5 learners imitate Band 9 language.",
    "Classify errors using categories such as Task response/achievement problem, Missing bullet point, Tone problem, Verb tense, Subject-verb agreement, Article error, Singular/plural error, Word form error, Word choice error, Collocation error, Sentence fragment, Run-on sentence, Unclear meaning, Repetition, Informal wording in formal writing, Weak linking, Paragraphing problem, and Spelling error.",
    "There is no Quick Check mode. Both modes must include detailed AI error diagnosis. Full mode gives detailed grading without model answer; Revision mode gives detailed grading plus model/revision output.",
    "Do not limit corrections to two examples. Check the whole essay and return all clear score-affecting spelling, grammar, vocabulary, sentence-structure, cohesion, and task-response errors. For repeated identical errors, group the pattern but still show representative original text and corrections.",
    "Do not invent errors. Do not rewrite the whole essay line by line unless the essay is short enough; prioritise all clear IELTS-relevant errors and repeated patterns.",
    "Return only one valid JSON object.",
    "Do not return markdown or code fences.",
    "Do not include explanatory preface or closing comments.",
    "All required keys must exist.",
    "If a section has no content, return an empty array [] or an empty string \"\".",
    "Use detailed but structured feedback. Do not be vague.",
    "Do not cap advice arrays at 5 items when the user essay contains more clear issues; return as many clear score-affecting items as the schema and limits allow.",
    "Each correction item must include a concrete fix, reason, and realistic next-step improvement.",
    "Provide brief Chinese helper notes in *Zh fields only. Chinese helper notes should explain feedback only; do not translate the full essay, original sentences, corrected sentences, model answers, or revised essays.",
    "For taskRequirementAnalysisZh, scoreCalibrationZh, lowBandDiagnosticsZh, highBandDiagnosticsZh, strengthsZh, and mainProblemsZh, write short Chinese explanations of the feedback only.",
    "For advice arrays and task-specific correction fields, provide matching short *Zh helper fields when possible, but never translate complete essay text or revised essay text.",
    "Keep Chinese helper notes short. Do not let Chinese helper notes replace the English feedback.",
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

function buildExpectedJsonShape(task, locale = "en") {
  const firstCriterion = firstCriterionName(task);
  return {
    actualWordCount: 0,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: task === "Task 1" ? 150 : 250,
    wordCountStatus: task === "Task 1" ? "meets_task1_minimum" : "meets_task2_minimum",
    taskRequirementAnalysis: task === "Task 1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
    taskRequirementAnalysisZh: { taskPurposeZh: emptyForLocaleZh("", locale), requiredToneZh: emptyForLocaleZh("", locale), letterTypeZh: emptyForLocaleZh("", locale), taskMatchSummaryZh: emptyForLocaleZh("", locale), bulletPointsZh: emptyForLocaleZh([], locale), requiredPartsZh: emptyForLocaleZh([], locale) },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "", warning: "" },
    highBandDiagnostics: {
      fullyAddressesTask: false,
      clearProgression: false,
      wellDevelopedIdeas: false,
      wideAccurateVocabulary: false,
      flexibleGrammar: false,
      fewErrors: false,
      appropriateToneTask1: task === "Task 1" ? false : null,
      recommendedHighBandRange: "",
      reason: ""
    },
    overallBand: 1,
    estimatedLevel: "Band 1.0",
    lowBandDiagnostics: {
      isBlank: false,
      wordCount20OrFewer: false,
      mostlyNonEnglish: false,
      mostlyCopiedFromPrompt: false,
      mostlyMemorised: false,
      whollyUnrelated: false,
      barelyRelated: false,
      littleRelevantMessage: false,
      noClearPositionTask2: false,
      noBulletPointCoverageTask1: false,
      meaningMostlyBlocked: false,
      recommendedLowBandRange: "",
      reason: ""
    },
    lowBandDiagnosticsZh: { reasonZh: emptyForLocaleZh("简短低分原因解释", locale) },
    highBandDiagnosticsZh: { reasonZh: emptyForLocaleZh("简短高分证据解释", locale) },
    scoreCalibration: {
      strictness: "strict",
      capApplied: false,
      capReason: "",
      whyNotHigher: "...",
      whyNotLower: "...",
      evidence: ["..."]
    },
    scoreCalibrationZh: { capReasonZh: emptyForLocaleZh("简短限分原因解释", locale), whyNotHigherZh: emptyForLocaleZh("简短说明为什么不能更高", locale), whyNotLowerZh: emptyForLocaleZh("简短说明为什么没有更低", locale), evidenceZh: emptyForLocaleZh(["简短证据解释"], locale) },
    criteria: {
      [firstCriterion]: {
        band: 1,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Coherence and Cohesion": {
        band: 1,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Lexical Resource": {
        band: 1,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Grammatical Range and Accuracy": {
        band: 1,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      }
    },
    strengths: ["..."],
    strengthsZh: emptyForLocaleZh(["简短优点解释"], locale),
    mainProblems: ["..."],
    mainProblemsZh: emptyForLocaleZh(["简短问题解释"], locale),
    grammarErrors: [
      {
        type: "tense / article / subject-verb agreement / word form / sentence structure / punctuation / other",
        original: "...",
        corrected: "...",
        explanation: "...",
        explanationZh: emptyForLocaleZh("Brief Chinese explanation", locale)
      }
    ],
    spellingCorrections: [
      {
        originalWord: "...",
        correctedWord: "...",
        sentence: "...",
        explanation: "...",
        explanationZh: emptyForLocaleZh("Brief Chinese explanation", locale)
      }
    ],
    sentenceCorrections: [
      {
        original: "...",
        corrected: "...",
        reason: "...",
        reasonZh: emptyForLocaleZh("Brief Chinese explanation", locale)
      }
    ],
    errorAnalysis: {
      summary: "...",
      summaryZh: emptyForLocaleZh("Brief Chinese summary", locale),
      errorPatterns: [
        {
          type: "Verb tense",
          typeZh: emptyForLocaleZh("动词时态", locale),
          frequency: "occasional / frequent",
          impactOnBand: "...",
          impactOnBandZh: emptyForLocaleZh("", locale),
          howToFix: "...",
          howToFixZh: emptyForLocaleZh("", locale)
        }
      ],
      priorityFixes: ["..."],
      priorityFixesZh: ["..."]
    },
    detailedSentenceCorrections: [
      {
        sentenceNumber: 1,
        originalSentence: "...",
        correctedSentence: "...",
        errorType: "Verb tense",
        errorTypeZh: emptyForLocaleZh("动词时态", locale),
        problem: "...",
        problemZh: emptyForLocaleZh("", locale),
        rule: "...",
        ruleZh: emptyForLocaleZh("", locale),
        betterExpression: "...",
        betterExpressionZh: emptyForLocaleZh("", locale),
        bandImpact: "...",
        bandImpactZh: emptyForLocaleZh("", locale)
      }
    ],
    task1LetterCorrections: task === "Task 1" ? {
      openingComment: "",
      closingComment: "",
      toneComment: "",
      purposeComment: "",
      bulletPointAdvice: []
    } : null,
    task2EssayCorrections: task === "Task 2" ? {
      positionComment: "",
      introductionComment: "",
      bodyParagraphComment: "",
      exampleComment: "",
      conclusionComment: "",
      developmentAdvice: []
    } : null,
    correctionPriority: {
      fixFirst: [],
      fixNext: [],
      polishLater: [],
      fixFirstZh: [],
      fixNextZh: [],
      polishLaterZh: []
    },
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
    revisedEssayMeta: {
      band5Target: "Basic but complete response; simple grammar; suitable for Band 5.",
      band6Target: "Clear and complete response with better organisation and vocabulary; suitable for Band 6.",
      band7Target: "Well-developed and natural response; suitable for Band 7, not Band 9.",
      revisionLimited: false,
      revisionLimitReason: ""
    },
    revisionNotes: ["..."],
    revisionNotesZh: emptyForLocaleZh(["Brief Chinese revision note"], locale),
    disclaimer: DISCLAIMER
  };
}

function buildUserPrompt(body, veryShort, locale = "en") {
  const mode = normalizeMode(body.mode);
  const effectiveMode = mode;
  const isRevisionMode = effectiveMode === "revision";
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const revisionInstruction = isRevisionMode
    ? "Detailed Grading + Model Answer mode: generate revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7. Band 5 should be safer and clearer; Band 6 should be more natural and logically complete; Band 7 should be mature and coherent but not template-like."
    : "Detailed Grading mode: do not generate revised essays or model answers. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings.";
  const underMinimumInstruction = body.isUnderMinimum
    ? `The essay is below the IELTS target word count (${body.wordCount}/${body.targetWordCount}). Still grade normally. If this is Task 1, mention the word count issue in Task Achievement and mainProblems. If this is Task 2, mention the word count issue in Task Response and mainProblems because idea development and argument depth may be affected.`
    : "The essay meets or exceeds the target word count.";

  return [
    "Return exactly one JSON object matching this shape and keep the same keys:",
    JSON.stringify(buildExpectedJsonShape(body.task, locale), null, 2),
    "",
    "Mode instructions:",
    "- full: detailed grading without model answer. Include full AI error diagnosis, spelling corrections, grammar corrections, sentence corrections, and task-specific advice. Do not generate revised essays.",
    "- revision: detailed grading plus model/revision output. Include the same full AI error diagnosis plus the three revised essays.",
    veryShort ? (isChineseLocale(locale) ? "Very short essay mode: ignore any revision request. Return only a compact diagnostic JSON. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings. Add this revision note: The essay is too short for a meaningful full revision. Please write a fuller response first. Add this Chinese note in revisionNotesZh: 作文太短，暂不适合生成完整修改版，请先补充内容。" : "Very short essay mode: ignore any revision request. Return only a compact diagnostic JSON. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings. Add this revision note: The essay is too short for a meaningful full revision. Please write a fuller response first. Keep revisionNotesZh empty.") : "",
    veryShort ? (isChineseLocale(locale) ? "Very short essay limits: strengths max 2, mainProblems max 3, grammarErrors max 3, sentenceCorrections max 3, each Chinese helper note max 25 Chinese characters, each English feedback max 25 English words." : "Very short essay limits: strengths max 2, mainProblems max 3, grammarErrors max 3, sentenceCorrections max 3, English feedback max 25 words, and all *Zh fields empty.") : "",
    revisionInstruction,
    underMinimumInstruction,
    body.isUnderMinimum ? "Important: even though the response is under the recommended word count, you must still grade it as an IELTS response using DeepSeek, start from Band 1 when there is no rateable content, return all sections, apply strict word-count caps, and do not return empty modules." : "",
    "No maximum word count rule: do not cap or penalise high word counts by length alone. Penalise only actual IELTS problems such as repetition, irrelevance, weak organisation, or unclear language.",
    "Use English for the main feedback. Use brief Chinese helper notes only in *Zh fields for local understanding. Do not translate the whole essay or revised essays.",
    "Local low-band diagnostics from the server are provided below. Use them as strong evidence, but still assess the actual writing.",
    JSON.stringify({ lowBandDiagnostics: diagnostics, capSuggestion: cap }, null, 2),
    "If capSuggestion.cap is not null, apply that as an upper cap unless the essay is clearly worse, and explain it in scoreCalibration.",
    "If lowBandDiagnostics.recommendedLowBandRange is not empty, reflect it in scoreCalibration and avoid inflated scores.",
    `Always set disclaimer to: ${DISCLAIMER}`,
    "",
    "Request data:",
    JSON.stringify({
      task: body.task,
      book: body.book,
      test: body.test,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      promptText: body.questionPrompt,
      taskType: body.task === "Task 1" ? "task1" : "task2",
      gradingMode: effectiveMode,
      outputLanguage: normalizeLocale(locale),
      actualWordCount: body.wordCount,
      wordCountThresholdUsed: body.task === "Task 1" ? 150 : 250,
      wordCountStatus: body.task === "Task 1"
        ? (body.wordCount >= 150 ? "meets_task1_minimum" : (body.wordCount < 80 ? "very_short_task1" : "under_task1_minimum"))
        : (body.wordCount >= 250 ? "meets_task2_minimum" : (body.wordCount < 150 ? "very_short_task2" : "under_task2_minimum")),
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


function buildCompactAiOnlySystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Brief Chinese helper notes may appear only in *Zh fields. Do not translate essays."
    : "Main feedback must be English. You may include brief hidden Chinese helper notes only in *Zh fields. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "DeepSeek is the only scorer. Do not copy or rely on any local fallback score.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Score only from Band 1 to Band 9. Do not return 0.",
    "Low-word-count responses must still receive AI scoring and AI feedback. Penalise underlength strictly, but do not reject the answer.",
    "There is no maximum word-count limit. Penalise long answers only for repetition, irrelevance, weak coherence, or loss of task focus.",
    "Keep every string short. Avoid quotation marks inside feedback strings where possible.",
    "Use arrays with at most 3 items unless the key is criteria.",
    chineseRule
  ].join(" ");
}

function buildCompactAiOnlyPrompt(body, locale = "en", previousIssue = "") {
  const taskType = body.task === "Task 1" ? "task1" : "task2";
  const firstCriterion = firstCriterionName(body.task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const isRevision = normalizeMode(body.mode) === "revision" && !body.isUnderMinimum && words >= (body.task === "Task 1" ? 150 : 250);
  const shape = {
    actualWordCount: words,
    taskTypeDetected: taskType,
    wordCountStatus: body.isUnderMinimum ? "under_minimum_ai_scored" : "meets_minimum_ai_scored",
    taskRequirementAnalysis: taskType === "task1"
      ? { taskType: "task1", taskPurpose: "", requiredTone: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, taskMatchSummary: "" },
    overallBand: 1,
    estimatedLevel: "Band 1.0",
    lowBandDiagnostics: { recommendedLowBandRange: "", reason: "" },
    highBandDiagnostics: { recommendedHighBandRange: "", reason: "" },
    scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
    criteria: {
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    mainProblems: [],
    grammarErrors: [],
    spellingCorrections: [],
    sentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    detailedSentenceCorrections: [],
    task1LetterCorrections: taskType === "task1" ? { toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: taskType === "task2" ? { positionComment: "", bodyParagraphComment: "", developmentAdvice: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: [],
    band5FixPlan: [],
    band6UpgradePlan: [],
    band7UpgradePlan: [],
    modelAnswerOutline: "",
    revisedEssayBand5: isRevision ? "" : "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: { revisionLimited: !isRevision, revisionLimitReason: isRevision ? "" : "Revision is limited in compact AI scoring mode." },
    revisionNotes: [],
    disclaimer: DISCLAIMER
  };

  return [
    "Return exactly one valid JSON object matching this compact shape. Keep the same keys.",
    previousIssue ? `Previous JSON issue to avoid: ${String(previousIssue).slice(0, 180)}` : "",
    JSON.stringify(shape),
    "Rules: DeepSeek must score this response. Use Band 1-9 only, allow half bands, do not output 0. Penalise low word count strictly but do not reject the answer. No maximum word-count cap. Keep strings concise but useful. Arrays may contain up to 8 items for correction fields. If the essay has any English content, strengths, mainProblems, taskAchievementAdvice, coherenceAdvice, lexicalAdvice, grammarAdvice, band plans, errorAnalysis.summary, correctionPriority.fixFirst, spellingCorrections, grammarErrors, sentenceCorrections, detailedSentenceCorrections, and task-specific advice must not be empty when visible errors exist. Never return blank correction objects. Main feedback English. *Zh fields may be brief Chinese helper notes only.",
    "Request:",
    JSON.stringify({
      task: body.task,
      taskType,
      mode: normalizeMode(body.mode),
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      actualWordCount: words,
      targetWordCount: body.targetWordCount,
      isUnderMinimum: Boolean(body.isUnderMinimum),
      essay: body.essay
    })
  ].filter(Boolean).join("\n");
}


function buildCompactAiOnlyRepairPrompt(rawText, body, locale = "en") {
  return [
    "Repair this malformed JSON into one valid JSON object only. No markdown. No trailing commas.",
    "If a string was cut off, close it with a short complete sentence.",
    "Use Band 1-9 only. Do not return 0.",
    "Keep keys from the malformed JSON where possible.",
    "Malformed JSON/text:",
    String(rawText || "").slice(0, 6000)
  ].join("\n");
}


async function parseOrRepairAiJson({ apiKey, model, rawText, body, locale, maxTokens, allowRepair = true, deadline }) {
  try {
    return parseJsonFromProvider(rawText);
  } catch (parseError) {
    // Prefer an AI repair call before showing a partial recovery.
    // Earlier versions returned partial data immediately, which caused user-visible
    // messages such as "AI partial output recovered this score" and removed Chinese buttons.
    if (allowRepair) {
      try {
        const repairedText = await callDeepSeek({
          apiKey,
          model,
          systemPrompt: "You repair malformed JSON. Return exactly one valid JSON object and nothing else.",
          userPrompt: buildCompactAiOnlyRepairPrompt(rawText, body, locale),
          maxTokens: Math.min(Math.max(maxTokens, 1000), 1700),
          temperature: 0.0,
          jsonMode: false,
          deadline,
          timeoutMs: Math.min(12000, AI_SINGLE_REQUEST_TIMEOUT_MS)
        });
        try {
          return parseJsonFromProvider(repairedText);
        } catch (repairParseError) {
          const repairedSalvage = buildAiPartialResultFromText(repairedText, body, repairParseError.message || "Malformed repaired JSON");
          if (repairedSalvage) return repairedSalvage;
        }
      } catch (repairCallError) {
        // Fall through to partial recovery below. This still keeps the score AI-derived.
      }
    }

    const salvaged = buildAiPartialResultFromText(rawText, body, parseError.message || "Malformed JSON");
    if (salvaged) return salvaged;

    parseError.message = `AI returned malformed JSON and no score could be recovered: ${parseError.message}`;
    throw parseError;
  }
}


function targetImprovementRangeFromBand(bandValue) {
  const band = clampAiBand(bandValue, 5);
  let lower;
  let upper;
  let maintenance = false;

  if (band <= 3.5) {
    lower = 5;
    upper = 5;
  } else if (band <= 4.5) {
    lower = 5;
    upper = 5.5;
  } else if (band === 5) {
    lower = 5.5;
    upper = 6;
  } else if (band === 5.5) {
    lower = 6;
    upper = 6.5;
  } else if (band === 6) {
    lower = 6.5;
    upper = 7;
  } else if (band === 6.5) {
    lower = 7;
    upper = 7.5;
  } else if (band === 7) {
    lower = 7.5;
    upper = 8;
  } else if (band === 7.5) {
    lower = 8;
    upper = 8.5;
  } else if (band === 8) {
    lower = 8.5;
    upper = 9;
  } else if (band === 8.5) {
    lower = 9;
    upper = 9;
  } else {
    lower = 9;
    upper = 9;
    maintenance = true;
  }

  return {
    lower,
    upper,
    maintenance,
    label: maintenance
      ? "Band 9.0 maintenance"
      : (lower === upper ? `Band ${formatBand(lower)}` : `Band ${formatBand(lower)}-${formatBand(upper)}`)
  };
}

function buildTargetImprovementInstruction(body) {
  const currentBand = Number(body?.currentOverallBand || body?.overallBand || body?.estimatedBand || 0);
  if (!Number.isFinite(currentBand) || currentBand <= 0) {
    return [
      "Targeted improvement rule: first infer the current IELTS band from the grading result, then give advice for a realistic next step.",
      "Use the full target ladder: Band 1.0-3.5 -> Band 5.0; Band 4.0-4.5 -> Band 5.0-5.5; Band 5.0 -> Band 5.5-6.0; Band 5.5 -> Band 6.0-6.5; Band 6.0 -> Band 6.5-7.0; Band 6.5 -> Band 7.0-7.5; Band 7.0 -> Band 7.5-8.0; Band 7.5 -> Band 8.0-8.5; Band 8.0 -> Band 8.5-9.0; Band 8.5 -> Band 9.0; Band 9.0 -> maintenance advice.",
      "Do not give advice that jumps too far beyond the current level. A Band 3 essay should not receive Band 6-9 style advice; a Band 5 essay should not receive Band 8-9 style advice."
    ].join("\n");
  }

  const roundedBand = clampAiBand(currentBand, 5);
  const range = targetImprovementRangeFromBand(roundedBand);
  return [
    `Current estimated band from the AI scoring pass: Band ${formatBand(roundedBand)}.`,
    `Target improvement range for advice: ${range.label}.`,
    "Use this target range when writing all correction advice, band plans, betterExpression, model answer outline, and task-specific coaching.",
    "Full target ladder: Band 1.0-3.5 -> Band 5.0; Band 4.0-4.5 -> Band 5.0-5.5; Band 5.0 -> Band 5.5-6.0; Band 5.5 -> Band 6.0-6.5; Band 6.0 -> Band 6.5-7.0; Band 6.5 -> Band 7.0-7.5; Band 7.0 -> Band 7.5-8.0; Band 7.5 -> Band 8.0-8.5; Band 8.0 -> Band 8.5-9.0; Band 8.5 -> Band 9.0; Band 9.0 -> maintenance advice.",
    "Important coaching rule: advice should normally target only +0.5 to +1.0 band above the current level, with a minimum practical target of Band 5.0 for very weak essays.",
    "If the current essay is below Band 5, give detailed Band 5 survival/pass advice first, not Band 6-9 advice.",
    "If the current essay is Band 5.0, give Band 5.5-6.0 advice.",
    "If the current essay is Band 5.5, give Band 6.0-6.5 advice.",
    "If the current essay is Band 6.0, give Band 6.5-7.0 advice.",
    "If the current essay is Band 6.5, give Band 7.0-7.5 advice.",
    "If the current essay is Band 7.0, give Band 7.5-8.0 advice.",
    "If the current essay is Band 7.5, give Band 8.0-8.5 advice.",
    "If the current essay is Band 8.0, give Band 8.5-9.0 advice.",
    "If the current essay is Band 8.5, give Band 9.0 advice.",
    "If the current essay is Band 9.0, give maintenance advice: preserve task fulfilment, naturalness, precision, flexibility, and avoid over-writing.",
    "Do not make the suggested sentence or betterExpression unrealistically advanced for the current level. Upgrade step by step."
  ].join("\n");
}

function correctionLimitForEssay(body, mode) {
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  if (words <= 20) return 8;
  if (words <= 80) return 16;
  if (words <= 180) return 28;
  if (words <= 320) return mode === "revision" ? 48 : 40;
  return mode === "revision" ? 70 : 60;
}

function buildAiCorrectionSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Write brief Chinese helper explanations only in fields ending with Zh. Do not translate the full essay."
    : "Main feedback must be English. Add brief Chinese helper explanations only in fields ending with Zh. Do not translate the full essay.";
  return [
    "You are an IELTS Writing error-correction examiner.",
    "Your task is not to rescore the essay. Your task is to scan the whole user essay and return detailed correction data.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Use only sentences and words that appear in the user's essay for originalSentence, original, sentence, and originalWord.",
    "Do not invent user sentences.",
    "Find all clear IELTS-relevant spelling, grammar, vocabulary, collocation, sentence-structure, punctuation, cohesion, paragraphing, tone, and task-response errors.",
    "Do not limit corrections to two examples.",
    "If repeated errors are identical, group the pattern but still provide representative original text and corrected text.",
    "If the essay is short, scan every sentence.",
    "If the essay is long, return all clear high-impact errors and repeated patterns within the requested limits.",
    "Do not return blank correction objects.",
    chineseRule
  ].join(" ");
}

function buildAiCorrectionPrompt(body, mode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const limit = correctionLimitForEssay(body, mode);
  const shape = {
    spellingCorrections: [
      { originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }
    ],
    grammarErrors: [
      { type: "", original: "", corrected: "", explanation: "", explanationZh: "" }
    ],
    sentenceCorrections: [
      { original: "", corrected: "", reason: "", reasonZh: "" }
    ],
    detailedSentenceCorrections: [
      {
        sentenceNumber: 1,
        originalSentence: "",
        correctedSentence: "",
        errorType: "",
        errorTypeZh: "",
        problem: "",
        problemZh: "",
        rule: "",
        ruleZh: "",
        betterExpression: "",
        betterExpressionZh: "",
        bandImpact: "",
        bandImpactZh: ""
      }
    ],
    errorAnalysis: {
      summary: "",
      summaryZh: "",
      errorPatterns: [
        { type: "", typeZh: "", frequency: "", impactOnBand: "", impactOnBandZh: "", howToFix: "", howToFixZh: "" }
      ],
      priorityFixes: [],
      priorityFixesZh: []
    },
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: [],
    band5FixPlan: [],
    band6UpgradePlan: [],
    band7UpgradePlan: [],
    revisionNotes: [],
    revisionNotesZh: []
  };

  return [
    "Return exactly one valid JSON object matching this shape:",
    JSON.stringify(shape),
    "",
    `Mode: ${mode === "revision" ? "detailed grading plus model/revision" : "detailed grading without model answer"}.`,
    `Correction limit: return up to ${limit} items in each correction array when errors exist. Do not stop at two errors. The user wants maximum detail; use the full limit when clear issues exist.`,
    "If there are no errors of a specific type, return an empty array for that type, but do not return all correction arrays empty when the essay has visible errors.",
    "If the essay has more than 30 words, quote and correct at least 8 clear original errors unless there are genuinely fewer visible errors. For essays above 150 words, aim for 12+ concrete corrections across spellingCorrections, grammarErrors, sentenceCorrections, and detailedSentenceCorrections when errors exist.",
    "For spellingCorrections, include obvious misspellings and typo-like errors. Do not include correct words.",
    "For grammarErrors, include tense, agreement, article, plural, word-form, punctuation, and sentence-structure errors.",
    "For detailedSentenceCorrections, include originalSentence, correctedSentence, betterExpression, problem, rule, and bandImpact.",
    "For Task 1, also check opening, closing, tone, purpose, and bullet point coverage.",
    "For Task 2, also check position, introduction, topic sentences, idea development, examples, conclusion, and relevance.",
    buildTargetImprovementInstruction(body),
    "Fill targetImprovementPlan with a realistic next-step plan based on that target range.",
    "Write every correction and betterExpression at the target level, not far above it.",
    "For band5FixPlan/band6UpgradePlan/band7UpgradePlan: do not give all plans equal priority. Put the most relevant plan for the target range first and make it the most detailed. If the target range is above Band 7, put the Band 7.5-9 coaching mainly in targetImprovementPlan, criterionUpgrades, practiceTasks, and band7UpgradePlan.",
    "For each correction item, explain exactly how the change helps the user reach the target range.",
    "Chinese helper notes must be short and appear only in *Zh fields.",
    "",
    "Question:",
    String(body.questionPrompt || ""),
    "",
    "Essay:",
    String(body.essay || "")
  ].join("\n");
}

function correctionObjectHasText(item, fields) {
  if (!item || typeof item !== "object") return false;
  return fields.some((field) => hasUsefulText(item[field]));
}

function pickFirstUsefulValue(item, fields) {
  for (const field of fields) {
    if (hasUsefulText(item?.[field])) return item[field];
  }
  return "";
}

function normalizeSpellingCorrectionItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    originalWord: pickFirstUsefulValue(item, ["originalWord", "misspelledWord", "incorrectWord", "word", "original", "wrongWord"]),
    correctedWord: pickFirstUsefulValue(item, ["correctedWord", "correctWord", "correction", "corrected", "correctSpelling", "rightWord"]),
    sentence: pickFirstUsefulValue(item, ["sentence", "context", "originalSentence", "sourceSentence", "where"]),
    explanation: pickFirstUsefulValue(item, ["explanation", "reason", "problem", "comment"]),
    explanationZh: pickFirstUsefulValue(item, ["explanationZh", "reasonZh", "problemZh", "commentZh"])
  };
}

function normalizeGrammarErrorItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    type: pickFirstUsefulValue(item, ["type", "errorType", "category", "ruleType"]) || "grammar",
    original: pickFirstUsefulValue(item, ["original", "originalSentence", "sentence", "sourceSentence", "wrong"]),
    corrected: pickFirstUsefulValue(item, ["corrected", "correctedSentence", "correction", "fixed", "right"]),
    explanation: pickFirstUsefulValue(item, ["explanation", "reason", "problem", "rule", "comment"]),
    explanationZh: pickFirstUsefulValue(item, ["explanationZh", "reasonZh", "problemZh", "ruleZh", "commentZh"])
  };
}

function normalizeSentenceCorrectionItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    original: pickFirstUsefulValue(item, ["original", "originalSentence", "sentence", "sourceSentence", "wrong"]),
    corrected: pickFirstUsefulValue(item, ["corrected", "correctedSentence", "correction", "fixed", "right"]),
    reason: pickFirstUsefulValue(item, ["reason", "explanation", "problem", "rule", "comment"]),
    reasonZh: pickFirstUsefulValue(item, ["reasonZh", "explanationZh", "problemZh", "ruleZh", "commentZh"])
  };
}

function normalizeDetailedSentenceCorrectionItem(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const originalSentence = pickFirstUsefulValue(item, ["originalSentence", "original", "sentence", "sourceSentence", "wrong"]);
  const correctedSentence = pickFirstUsefulValue(item, ["correctedSentence", "corrected", "correction", "fixed", "right"]);
  return {
    sentenceNumber: Number(item.sentenceNumber || item.number || item.index || index + 1) || index + 1,
    originalSentence,
    correctedSentence,
    errorType: pickFirstUsefulValue(item, ["errorType", "type", "category", "ruleType"]) || "sentence correction",
    errorTypeZh: pickFirstUsefulValue(item, ["errorTypeZh", "typeZh", "categoryZh"]),
    problem: pickFirstUsefulValue(item, ["problem", "explanation", "reason", "comment"]),
    problemZh: pickFirstUsefulValue(item, ["problemZh", "explanationZh", "reasonZh", "commentZh"]),
    rule: pickFirstUsefulValue(item, ["rule", "grammarRule", "howToFix"]),
    ruleZh: pickFirstUsefulValue(item, ["ruleZh", "grammarRuleZh", "howToFixZh"]),
    betterExpression: pickFirstUsefulValue(item, ["betterExpression", "improvedSentence", "naturalExpression", "upgrade", "better"]),
    betterExpressionZh: pickFirstUsefulValue(item, ["betterExpressionZh", "improvedSentenceZh", "naturalExpressionZh", "upgradeZh"]),
    bandImpact: pickFirstUsefulValue(item, ["bandImpact", "impactOnBand", "scoreImpact"]),
    bandImpactZh: pickFirstUsefulValue(item, ["bandImpactZh", "impactOnBandZh", "scoreImpactZh"])
  };
}

function hasConcreteAiCorrectionItems(correction) {
  const cleaned = sanitizeAiCorrectionPayload(correction);
  return Boolean(
    ensureArray(cleaned.spellingCorrections).length ||
    ensureArray(cleaned.grammarErrors).length ||
    ensureArray(cleaned.sentenceCorrections).length ||
    ensureArray(cleaned.detailedSentenceCorrections).length
  );
}

function sanitizeAiCorrectionPayload(correction) {
  if (!correction || typeof correction !== "object") return {};
  const cleaned = { ...correction };

  cleaned.spellingCorrections = ensureArray(cleaned.spellingCorrections)
    .map((item) => normalizeSpellingCorrectionItem(item))
    .filter((item) => correctionObjectHasText(item, ["originalWord", "correctedWord", "sentence", "explanation"]));

  cleaned.grammarErrors = ensureArray(cleaned.grammarErrors)
    .map((item) => normalizeGrammarErrorItem(item))
    .filter((item) => correctionObjectHasText(item, ["original", "corrected", "explanation"]));

  cleaned.sentenceCorrections = ensureArray(cleaned.sentenceCorrections)
    .map((item) => normalizeSentenceCorrectionItem(item))
    .filter((item) => correctionObjectHasText(item, ["original", "corrected", "reason"]));

  cleaned.detailedSentenceCorrections = ensureArray(cleaned.detailedSentenceCorrections)
    .map((item, index) => normalizeDetailedSentenceCorrectionItem(item, index))
    .filter((item) => correctionObjectHasText(item, ["originalSentence", "correctedSentence", "problem", "rule", "betterExpression"]));

  return cleaned;
}

function hasAiCorrectionContent(correction) {
  const cleaned = sanitizeAiCorrectionPayload(correction);
  return Boolean(
    ensureArray(cleaned.spellingCorrections).length ||
    ensureArray(cleaned.grammarErrors).length ||
    ensureArray(cleaned.sentenceCorrections).length ||
    ensureArray(cleaned.detailedSentenceCorrections).length ||
    hasUsefulText(cleaned.errorAnalysis?.summary) ||
    ensureArray(cleaned.errorAnalysis?.errorPatterns).some((item) => correctionObjectHasText(item, ["type", "impactOnBand", "howToFix"]))
  );
}

function mergeAiCorrectionDetails(result, correction, body, mode) {
  if (!correction || typeof correction !== "object") return result;
  correction = sanitizeAiCorrectionPayload(correction);
  const merged = result && typeof result === "object" ? result : {};
  const correctionLimit = correctionLimitForEssay(body, mode);

  const arrayFields = [
    "spellingCorrections",
    "grammarErrors",
    "sentenceCorrections",
    "detailedSentenceCorrections",
    "taskAchievementAdvice",
    "coherenceAdvice",
    "lexicalAdvice",
    "grammarAdvice",
    "band5FixPlan",
    "band6UpgradePlan",
    "band7UpgradePlan",
    "revisionNotes",
    "revisionNotesZh"
  ];

  arrayFields.forEach((field) => {
    const incoming = ensureArray(correction[field]);
    if (incoming.length) {
      const limit = ["spellingCorrections", "grammarErrors", "sentenceCorrections", "detailedSentenceCorrections"].includes(field)
        ? correctionLimit
        : 18;
      merged[field] = incoming.slice(0, limit);
    }
  });

  if (correction.errorAnalysis && typeof correction.errorAnalysis === "object") {
    merged.errorAnalysis = {
      ...(merged.errorAnalysis && typeof merged.errorAnalysis === "object" ? merged.errorAnalysis : {}),
      ...correction.errorAnalysis,
      errorPatterns: ensureArray(correction.errorAnalysis.errorPatterns).length
        ? ensureArray(correction.errorAnalysis.errorPatterns).slice(0, 24)
        : ensureArray(merged.errorAnalysis?.errorPatterns),
      priorityFixes: ensureArray(correction.errorAnalysis.priorityFixes).length
        ? ensureArray(correction.errorAnalysis.priorityFixes).slice(0, 16)
        : ensureArray(merged.errorAnalysis?.priorityFixes),
      priorityFixesZh: ensureArray(correction.errorAnalysis.priorityFixesZh).length
        ? ensureArray(correction.errorAnalysis.priorityFixesZh).slice(0, 16)
        : ensureArray(merged.errorAnalysis?.priorityFixesZh)
    };
  }

  if (correction.correctionPriority && typeof correction.correctionPriority === "object") {
    merged.correctionPriority = {
      ...(merged.correctionPriority && typeof merged.correctionPriority === "object" ? merged.correctionPriority : {}),
      ...correction.correctionPriority
    };
  }

  if (correction.targetImprovementPlan && typeof correction.targetImprovementPlan === "object") {
    merged.targetImprovementPlan = {
      ...(merged.targetImprovementPlan && typeof merged.targetImprovementPlan === "object" ? merged.targetImprovementPlan : {}),
      ...correction.targetImprovementPlan
    };
  }

  if (body?.task === "Task 1" && correction.task1LetterCorrections && typeof correction.task1LetterCorrections === "object") {
    merged.task1LetterCorrections = {
      ...(merged.task1LetterCorrections && typeof merged.task1LetterCorrections === "object" ? merged.task1LetterCorrections : {}),
      ...correction.task1LetterCorrections
    };
  }

  if (body?.task === "Task 2" && correction.task2EssayCorrections && typeof correction.task2EssayCorrections === "object") {
    merged.task2EssayCorrections = {
      ...(merged.task2EssayCorrections && typeof merged.task2EssayCorrections === "object" ? merged.task2EssayCorrections : {}),
      ...correction.task2EssayCorrections
    };
  }

  return merged;
}

async function parseCorrectionJson({ apiKey, model, rawText, body, locale, maxTokens, deadline }) {
  try {
    return parseJsonFromProvider(rawText);
  } catch (parseError) {
    try {
      const repairedText = await callDeepSeek({
        apiKey,
        model,
        systemPrompt: "You repair malformed correction JSON. Return exactly one valid JSON object and nothing else.",
        userPrompt: [
          "Repair this IELTS correction JSON. Keep only correction-related fields.",
          "Return valid JSON only. No markdown.",
          "If a string was cut off, close it with a short complete phrase.",
          "Malformed JSON/text:",
          String(rawText || "").slice(0, 10000)
        ].join("\n"),
        maxTokens: 1800,
        temperature: 0.0,
        jsonMode: false,
        deadline,
        timeoutMs: Math.min(12000, AI_SINGLE_REQUEST_TIMEOUT_MS)
      });
      return parseJsonFromProvider(repairedText);
    } catch {
      return {};
    }
  }
}

async function callAiCorrectionPass({ apiKey, model, body, effectiveMode, locale, deadline, maxTokensOverride, timeoutMs }) {
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  if (!String(body.essay || "").trim()) return {};
  const maxTokens = maxTokensOverride || Math.min(Math.max(correctionLimitForEssay(body, effectiveMode) * 260, words < 80 ? 3600 : 6200), effectiveMode === "revision" ? 14000 : 11000);
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildAiCorrectionSystemPrompt(locale),
    userPrompt: buildAiCorrectionPrompt({ ...body, mode: effectiveMode }, effectiveMode, locale),
    maxTokens,
    temperature: 0.1,
    jsonMode: false,
    deadline,
    timeoutMs
  });
  return await parseCorrectionJson({ apiKey, model, rawText, body, locale, maxTokens, deadline });
}


function buildFocusedAiCorrectionSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use brief Chinese helper notes only in *Zh fields. Do not translate the essay."
    : "Use English for main fields. Add brief Chinese helper notes only in *Zh fields. Do not translate the essay.";
  return [
    "You are an IELTS Writing correction examiner.",
    "Return exactly one valid JSON object. No markdown. No code fences.",
    "This is a focused retry because the detailed correction section was empty or incomplete.",
    "Scan the whole essay and quote real user text only.",
    "Return concrete corrections, not generic advice.",
    "Do not return only errorAnalysis, task advice, strengths, or mainProblems. The correction arrays must contain quoted user text when errors are visible.",
    "Do not return blank objects.",
    "If the essay has visible errors, at least one of spellingCorrections, grammarErrors, sentenceCorrections, or detailedSentenceCorrections must contain items.",
    chineseRule
  ].join(" ");
}

function buildFocusedAiCorrectionPrompt(body, mode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const itemTarget = words < 80 ? 6 : (words < 180 ? 12 : 20);
  const shape = {
    spellingCorrections: [
      { originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }
    ],
    grammarErrors: [
      { type: "", original: "", corrected: "", explanation: "", explanationZh: "" }
    ],
    sentenceCorrections: [
      { original: "", corrected: "", reason: "", reasonZh: "" }
    ],
    detailedSentenceCorrections: [
      {
        sentenceNumber: 1,
        originalSentence: "",
        correctedSentence: "",
        errorType: "",
        errorTypeZh: "",
        problem: "",
        problemZh: "",
        rule: "",
        ruleZh: "",
        betterExpression: "",
        betterExpressionZh: "",
        bandImpact: "",
        bandImpactZh: ""
      }
    ],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: []
  };

  return [
    "Return one JSON object with this shape:",
    JSON.stringify(shape),
    `Target: provide ${itemTarget} concrete corrections if the essay contains that many visible errors. Use the full target when the essay has many clear issues. Do not stop at two and do not return only generic advice.`,
    "Use exact text from the essay for original/originalSentence/sentence/originalWord.",
    "For each corrected sentence, include a correctedSentence and a betterExpression.",
    "Include spelling errors if any misspelled words appear.",
    "Include grammar and sentence-control problems if any are visible.",
    task === "Task 1"
      ? "Also mention tone, purpose, and bullet-point problems in advice arrays if relevant."
      : "Also mention position, idea development, examples, paragraphing, and conclusion problems in advice arrays if relevant.",
    buildTargetImprovementInstruction(body),
    "Fill targetImprovementPlan and make all fixes realistic for that target range.",
    "Question:",
    String(body.questionPrompt || ""),
    "Essay:",
    String(body.essay || "")
  ].join("\n");
}

async function callAiFocusedCorrectionPass({ apiKey, model, body, effectiveMode, locale, deadline }) {
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  if (!String(body.essay || "").trim()) return {};
  const maxTokens = Math.min(words < 80 ? 4200 : (words < 180 ? 7200 : 10000), 12000);
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildFocusedAiCorrectionSystemPrompt(locale),
    userPrompt: buildFocusedAiCorrectionPrompt({ ...body, mode: effectiveMode }, effectiveMode, locale),
    maxTokens,
    temperature: 0.0,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(28000, AI_SINGLE_REQUEST_TIMEOUT_MS)
  });
  const parsed = await parseCorrectionJson({ apiKey, model, rawText, body, locale, maxTokens, deadline });
  return sanitizeAiCorrectionPayload(parsed);
}

async function ensureAiCorrectionDetails({ result, apiKey, model, body, gradingMode, locale, deadline }) {
  let output = result && typeof result === "object" ? result : {};
  if (!String(body?.essay || "").trim()) return output;

  // Generic advice is not enough for the correction section. The user-facing
  // modules need concrete quoted errors: spellingCorrections, grammarErrors,
  // sentenceCorrections, or detailedSentenceCorrections. If the scoring pass
  // only returned errorAnalysis/advice text, force a focused AI correction pass.
  if (hasConcreteAiCorrectionItems(output)) return output;

  if (remainingAiTime(deadline) < 7000) {
    output.correctionWarning = "AI detailed correction did not complete before the server deadline. Please retry detailed grading.";
    output.correctionPassWarning = output.correctionWarning;
    return output;
  }

  const retryAttempts = remainingAiTime(deadline) > 17000 ? 2 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const focusedCorrection = await callAiFocusedCorrectionPass({
        apiKey,
        model,
        body: { ...body, mode: gradingMode, correctionRetryAttempt: attempt },
        effectiveMode: gradingMode,
        locale,
        deadline
      });

      if (hasConcreteAiCorrectionItems(focusedCorrection)) {
        output = mergeAiCorrectionDetails(output, focusedCorrection, body, gradingMode);
        output.correctionWarning = "";
        output.correctionPassWarning = "";
        return output;
      }

      if (hasAiCorrectionContent(focusedCorrection)) {
        output = mergeAiCorrectionDetails(output, focusedCorrection, body, gradingMode);
      }
    } catch (error) {
      lastError = error;
      if (remainingAiTime(deadline) < 7000) break;
    }
  }

  output.correctionWarning = lastError
    ? "AI detailed correction retry failed or timed out. The score was returned first. Please retry detailed grading."
    : "AI did not return concrete sentence-level corrections. Please retry detailed grading.";
  output.correctionPassWarning = output.correctionWarning;
  return output;
}

function buildFastAiGradingSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Write short Chinese helper notes only in fields ending with Zh. Do not translate essays."
    : "Main feedback must be English. Write short Chinese helper notes only in fields ending with Zh. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "Return exactly one valid JSON object only. No markdown. No code fences. No trailing commas.",
    "This pass is for scoring and task analysis only. A separate AI pass handles detailed sentence corrections.",
    "Use IELTS Writing public band descriptor logic. Score from Band 1 to Band 9 only and allow half bands.",
    "DeepSeek is the only scorer. Do not use or mention local fallback scoring.",
    "Penalise short responses strictly but still grade them. There is no maximum word-count cap.",
    "For Task 1 use Task Achievement. For Task 2 use Task Response.",
    "Band 8 or 9 is allowed for truly high-quality responses; strict scoring must not artificially cap strong answers.",
    "Keep all strings concise so the response completes quickly.",
    chineseRule
  ].join(" ");
}

function buildFastAiGradingPrompt(body, gradingMode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const taskType = task === "Task 1" ? "task1" : "task2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const shape = {
    actualWordCount: words,
    taskTypeDetected: taskType,
    wordCountThresholdUsed: threshold,
    wordCountStatus: words >= threshold ? "meets_minimum" : "under_minimum_ai_scored",
    taskRequirementAnalysis: taskType === "task1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
    taskRequirementAnalysisZh: { taskMatchSummaryZh: "", taskPurposeZh: "", requiredToneZh: "", requiredPartsZh: [], bulletPointsZh: [] },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "", warning: "" },
    highBandDiagnostics: {
      fullyAddressesTask: false,
      clearProgression: false,
      wellDevelopedIdeas: false,
      wideAccurateVocabulary: false,
      flexibleGrammar: false,
      fewErrors: false,
      appropriateToneTask1: task === "Task 1" ? false : null,
      recommendedHighBandRange: "",
      reason: ""
    },
    highBandDiagnosticsZh: { reasonZh: "" },
    lowBandDiagnostics: { ...diagnostics, reason: "" },
    lowBandDiagnosticsZh: { reasonZh: "" },
    scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
    scoreCalibrationZh: { capReasonZh: "", whyNotHigherZh: "", whyNotLowerZh: "", evidenceZh: [] },
    overallBand: 1,
    estimatedLevel: "Band 1.0",
    criteria: {
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    strengthsZh: [],
    mainProblems: [],
    mainProblemsZh: [],
    spellingCorrections: [],
    grammarErrors: [],
    sentenceCorrections: [],
    detailedSentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: [],
    band5FixPlan: [],
    band6UpgradePlan: [],
    band7UpgradePlan: [],
    modelAnswerOutline: "",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: { revisionLimited: gradingMode !== "revision", revisionLimitReason: "" },
    revisionNotes: [],
    revisionNotesZh: [],
    disclaimer: DISCLAIMER
  };

  return [
    "Return one JSON object matching this shape. Keep the same keys, but fill the scoring/task-analysis fields with real IELTS assessment.",
    JSON.stringify(shape),
    "Scoring requirements:",
    "- Assign four IELTS criterion bands and overallBand.",
    "- Explain why the score is not higher and not lower.",
    "- Analyse the selected prompt before scoring.",
    "- If under the recommended word count, reflect that in Task Achievement/Task Response, but still score normally from Band 1 upward.",
    "- Include 1-3 short backup spelling/grammar/sentence corrections if visible errors are obvious; the separate correction pass will add the full list.",
    "- Keep strings short. Arrays max 5 items.",
    "Server low-band context:",
    JSON.stringify({ lowBandDiagnostics: diagnostics, capSuggestion: cap }),
    "Request:",
    JSON.stringify({
      task,
      taskType,
      gradingMode,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      actualWordCount: words,
      targetWordCount: body.targetWordCount,
      isUnderMinimum: Boolean(body.isUnderMinimum),
      essay: body.essay
    })
  ].join("\n");
}

function buildFastRevisionSystemPrompt(locale = "en") {
  return [
    "You are an IELTS General Training writing coach.",
    "Return exactly one valid JSON object only. No markdown. No code fences. No trailing commas.",
    "This pass generates revised/model answer content only. Do not rescore the essay.",
    "Do not translate the essay into Chinese. Use English for revised essays."
  ].join(" ");
}

function buildFastRevisionPrompt(body, locale = "en") {
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const tooShort = body.task === "Task 1" ? words < 80 : words < 150;
  const shape = {
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    modelAnswerOutline: "",
    revisedEssayMeta: {
      band5Target: "Basic but complete response; simple grammar; suitable for Band 5.",
      band6Target: "Clear and complete response with better organisation and vocabulary; suitable for Band 6.",
      band7Target: "Well-developed and natural response; suitable for Band 7, not Band 9.",
      revisionLimited: tooShort,
      revisionLimitReason: tooShort ? "The original response is very short, so only a limited revision is suitable." : ""
    },
    revisionNotes: [],
    revisionNotesZh: []
  };
  return [
    "Return one JSON object matching this shape:",
    JSON.stringify(shape),
    tooShort
      ? "The original essay is very short. You may provide a Band 5 basic completion only; leave Band 6 and Band 7 empty if there is not enough content to upgrade."
      : "Generate three clearly different revised versions: Band 5, Band 6, and Band 7. Do not write a Band 9 essay.",
    "Keep each revised essay concise and appropriate for IELTS General Training.",
    "Question:",
    String(body.questionPrompt || ""),
    "Original essay:",
    String(body.essay || "")
  ].join("\n");
}

async function callAiCompactScoringRetry({ apiKey, model, body, gradingMode, locale, deadline }) {
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildCompactAiOnlySystemPrompt(locale),
    userPrompt: buildCompactAiOnlyPrompt({ ...body, mode: gradingMode }, locale, "Previous full scoring pass timed out; return a smaller complete scoring JSON."),
    maxTokens: 1800,
    temperature: 0.1,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(12000, AI_SINGLE_REQUEST_TIMEOUT_MS)
  });
  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 1800,
    allowRepair: true,
    deadline
  });
}


async function callAiGradingPass({ apiKey, model, body, gradingMode, maxTokens, locale, deadline, veryShort = false, timeoutMs }) {
  const isRevisionPass = normalizeMode(gradingMode) === "revision";
  const systemPrompt = isRevisionPass ? buildFastRevisionSystemPrompt(locale) : buildFastAiGradingSystemPrompt(locale);
  const userPrompt = isRevisionPass
    ? buildFastRevisionPrompt({ ...body, mode: gradingMode }, locale)
    : buildFastAiGradingPrompt({ ...body, mode: gradingMode }, gradingMode, locale);

  const cappedMaxTokens = isRevisionPass
    ? Math.min(maxTokens || 3600, 4200)
    : Math.min(maxTokens || 2600, veryShort ? 1800 : 2600);

  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    maxTokens: cappedMaxTokens,
    temperature: 0.1,
    jsonMode: false,
    deadline,
    timeoutMs
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: cappedMaxTokens,
    allowRepair: true,
    deadline
  });
}

function mergeRevisionPassIntoResult(result, revision) {
  if (!revision || typeof revision !== "object") return result;
  const merged = result && typeof result === "object" ? { ...result } : {};
  ["revisedEssayBand5", "revisedEssayBand6", "revisedEssayBand7", "modelAnswerOutline"].forEach((field) => {
    if (hasUsefulText(revision[field])) merged[field] = revision[field];
  });
  if (Array.isArray(revision.revisionNotes) && revision.revisionNotes.length) merged.revisionNotes = revision.revisionNotes;
  if (Array.isArray(revision.revisionNotesZh) && revision.revisionNotesZh.length) merged.revisionNotesZh = revision.revisionNotesZh;
  if (revision.revisedEssayMeta && typeof revision.revisedEssayMeta === "object") {
    merged.revisedEssayMeta = {
      ...(merged.revisedEssayMeta && typeof merged.revisedEssayMeta === "object" ? merged.revisedEssayMeta : {}),
      ...revision.revisedEssayMeta
    };
  }
  return merged;
}

function addRevisionTimeoutWarning(result) {
  const updated = result && typeof result === "object" ? { ...result } : {};
  const note = "Model answer generation timed out. The grading and correction feedback were returned first.";
  updated.revisionNotes = ensureArray(updated.revisionNotes);
  if (!updated.revisionNotes.includes(note)) updated.revisionNotes.push(note);
  updated.revisionNotesZh = ensureArray(updated.revisionNotesZh);
  if (!updated.revisionNotesZh.length) updated.revisionNotesZh.push("");
  updated.revisedEssayMeta = updated.revisedEssayMeta && typeof updated.revisedEssayMeta === "object" ? { ...updated.revisedEssayMeta } : defaultRevisedEssayMeta(false);
  updated.revisedEssayMeta.revisionLimitReason = note;
  return updated;
}

function isDeepSeekTimeoutError(error) {
  return error?.code === "DEEPSEEK_TIMEOUT" || error?.message === "DeepSeek request timed out.";
}

function isDeepSeekEmptyResponseError(error) {
  return error?.code === "DEEPSEEK_EMPTY_RESPONSE" || error?.message === "DeepSeek returned an empty response.";
}

function buildMinimalAiScoringSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use short Chinese helper notes only in *Zh fields."
    : "Main fields must be English. Use short Chinese helper notes only in *Zh fields.";
  return [
    "You are a strict IELTS Writing examiner.",
    "Return exactly one valid JSON object only.",
    "This is an emergency short scoring pass because the provider returned empty content.",
    "Use Band 1-9 only and allow half bands.",
    "Do not produce long feedback.",
    chineseRule
  ].join(" ");
}

function buildMinimalAiScoringPrompt(body, gradingMode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const shape = {
    actualWordCount: words,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: threshold,
    wordCountStatus: words >= threshold ? "meets_minimum" : "under_minimum_ai_scored",
    overallBand: 1,
    estimatedLevel: "Band 1.0",
    criteria: {
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    strengthsZh: [],
    mainProblems: [],
    mainProblemsZh: [],
    scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
    taskRequirementAnalysis: task === "Task 1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
    lowBandDiagnostics: { recommendedLowBandRange: "", reason: "" },
    highBandDiagnostics: { recommendedHighBandRange: "", reason: "" },
    spellingCorrections: [],
    grammarErrors: [],
    sentenceCorrections: [],
    detailedSentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    disclaimer: DISCLAIMER
  };

  return [
    "Return one valid JSON object matching this shape. Fill scoring fields with real IELTS judgement.",
    "Do not copy the template values. Replace overallBand, criteria bands, feedback, howToImprove, strengths, mainProblems, and scoreCalibration with real essay-specific content.",
    "If the essay has any English content, feedback fields must not be blank and overallBand must not default to 1 unless the essay truly deserves Band 1.",
    JSON.stringify(shape),
    "Keep feedback very short. Arrays max 3 items. Do not use markdown.",
    `Task: ${task}`,
    `Mode: ${gradingMode}`,
    `Word count: ${words}/${threshold}`,
    "Question:",
    String(body.questionPrompt || "").slice(0, 1500),
    "Essay:",
    String(body.essay || "").slice(0, 3500)
  ].join("\n");
}

async function callAiMinimalScoringPass({ apiKey, model, body, gradingMode, locale, deadline }) {
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildMinimalAiScoringSystemPrompt(locale),
    userPrompt: buildMinimalAiScoringPrompt({ ...body, mode: gradingMode }, gradingMode, locale),
    maxTokens: 1200,
    temperature: 0.0,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(10000, AI_SINGLE_REQUEST_TIMEOUT_MS)
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 1200,
    allowRepair: true,
    deadline
  });
}


function isScoringPlaceholderText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return true;
  if (["...", "-", "n/a", "na", "null", "undefined"].includes(text)) return true;
  if (text.includes("must_fill") || text.includes("replace_with") || text.includes("fill scoring")) return true;
  if (text.includes("no feedback is available")) return true;
  if (text === "brief chinese explanation" || text === "brief chinese suggestion") return true;
  return false;
}

function collectScoringText(result, body) {
  if (!result || typeof result !== "object") return [];
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  const names = [firstCriterion, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const values = [];
  names.forEach((name) => {
    const item = criteria[name];
    if (!item || typeof item !== "object") return;
    values.push(item.feedback, item.howToImprove, item.feedbackZh, item.howToImproveZh);
  });
  values.push(
    result.scoreCalibration?.whyNotHigher,
    result.scoreCalibration?.whyNotLower,
    result.scoreCalibration?.capReason,
    result.lowBandDiagnostics?.reason,
    result.highBandDiagnostics?.reason,
    result.taskRequirementAnalysis?.taskMatchSummary,
    result.errorAnalysis?.summary
  );
  ensureArray(result.strengths).forEach((item) => values.push(item));
  ensureArray(result.mainProblems).forEach((item) => values.push(item));
  ensureArray(result.taskAchievementAdvice).forEach((item) => values.push(item));
  ensureArray(result.coherenceAdvice).forEach((item) => values.push(item));
  ensureArray(result.lexicalAdvice).forEach((item) => values.push(item));
  ensureArray(result.grammarAdvice).forEach((item) => values.push(item));
  return values.map((value) => String(value ?? "").trim()).filter((value) => value);
}

function hasMeaningfulAiScoringResult(result, body) {
  if (!result || typeof result !== "object") return false;
  const overall = Number(result.overallBand ?? result.overallEstimatedBand);
  if (!Number.isFinite(overall) || overall < 1 || overall > 9) return false;

  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  const criterionNames = [firstCriterion, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const criteriaWithBands = criterionNames.filter((name) => Number.isFinite(Number(criteria[name]?.band))).length;
  if (criteriaWithBands < 3) return false;

  const usefulTexts = collectScoringText(result, body).filter((value) => !isScoringPlaceholderText(value));
  if (usefulTexts.length < 3) return false;

  const allCriterionFeedbackBlank = criterionNames.every((name) => {
    const item = criteria[name] || {};
    return isScoringPlaceholderText(item.feedback) && isScoringPlaceholderText(item.howToImprove);
  });

  const arraysBlank = !ensureArray(result.strengths).some((item) => !isScoringPlaceholderText(item)) &&
    !ensureArray(result.mainProblems).some((item) => !isScoringPlaceholderText(item));

  if (overall === 1 && allCriterionFeedbackBlank && arraysBlank) return false;
  return true;
}

function assertMeaningfulAiScoringResult(result, body, sourceLabel) {
  if (!hasMeaningfulAiScoringResult(result, body)) {
    const error = new Error(`${sourceLabel || "AI scoring"} returned placeholder or incomplete scoring JSON.`);
    error.name = "InvalidAiScoringResult";
    error.provider = "deepseek";
    throw error;
  }
  return result;
}

function buildNoTemplateAiScoringSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use short Chinese helper notes only in fields ending with Zh."
    : "Main fields must be English. Use short Chinese helper notes only in fields ending with Zh.";
  return [
    "You are a strict IELTS Writing examiner.",
    "Return exactly one valid JSON object only. No markdown. No code fences.",
    "Do not copy any template values. Do not leave feedback fields blank.",
    "Score from Band 1 to Band 9 only and allow half bands.",
    "If the response is not blank, do not default to Band 1. Use the actual essay evidence.",
    chineseRule
  ].join(" ");
}

function buildNoTemplateAiScoringPrompt(body, gradingMode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  return [
    "Grade the essay and return JSON with these exact top-level keys:",
    "actualWordCount, taskTypeDetected, wordCountThresholdUsed, wordCountStatus, taskRequirementAnalysis, taskMatchCheck, overallBand, estimatedLevel, criteria, strengths, mainProblems, lowBandDiagnostics, highBandDiagnostics, scoreCalibration, errorAnalysis, taskAchievementAdvice, coherenceAdvice, lexicalAdvice, grammarAdvice, disclaimer.",
    `criteria must contain exactly these four keys: ${firstCriterion}, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.`,
    "Each criterion object must contain: band, feedback, feedbackZh, howToImprove, howToImproveZh.",
    "Every English feedback/howToImprove field must be filled with a concrete sentence based on the essay.",
    "strengths and mainProblems must each contain at least 2 concrete items if the essay has English content.",
    "scoreCalibration must contain strictness, capApplied, capReason, whyNotHigher, whyNotLower, evidence.",
    "Do not output empty strings for scoring feedback. Do not return the schema only.",
    "Use underlength as a penalty only when relevant; it is not automatically Band 1.",
    `Task: ${task}`,
    `Mode: ${gradingMode}`,
    `Word count: ${words}/${threshold}`,
    "Question:",
    String(body.questionPrompt || "").slice(0, 1800),
    "Essay:",
    String(body.essay || "").slice(0, 4500)
  ].join("\n");
}

async function callAiNoTemplateScoringPass({ apiKey, model, body, gradingMode, locale, deadline }) {
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildNoTemplateAiScoringSystemPrompt(locale),
    userPrompt: buildNoTemplateAiScoringPrompt({ ...body, mode: gradingMode }, gradingMode, locale),
    maxTokens: 2200,
    temperature: 0.0,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(16000, AI_SINGLE_REQUEST_TIMEOUT_MS)
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 2200,
    allowRepair: true,
    deadline
  });
}


function buildLeanScoreSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use short Chinese helper notes only in fields ending with Zh. Do not translate essays."
    : "Main feedback must be English. Use short Chinese helper notes only in fields ending with Zh. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "This pass is ONLY for scoring and task analysis. Do not do detailed sentence correction here.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Use IELTS Writing public band descriptor logic.",
    "Score from Band 1 to Band 9 only and allow half bands.",
    "DeepSeek is the only scorer. Do not use or mention local fallback scoring.",
    "Penalise underlength strictly, but still grade from Band 1 upward.",
    "There is no maximum word-count cap; penalise long answers only for repetition, irrelevance, weak coherence, or loss of task focus.",
    "For Task 1 use Task Achievement. For Task 2 use Task Response.",
    "High-quality relevant answers may receive Band 8 or 9. Do not artificially cap strong writing at Band 7.",
    "Keep the JSON compact enough to finish reliably, but make every scoring reason essay-specific.",
    chineseRule
  ].join(" ");
}

function buildLeanScorePrompt(body, gradingMode, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const taskType = task === "Task 1" ? "task1" : "task2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const shape = {
    actualWordCount: words,
    taskTypeDetected: taskType,
    wordCountThresholdUsed: threshold,
    wordCountStatus: words >= threshold ? "meets_minimum" : "under_minimum_ai_scored",
    taskRequirementAnalysis: taskType === "task1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
    taskRequirementAnalysisZh: { taskMatchSummaryZh: "", taskPurposeZh: "", requiredToneZh: "", requiredPartsZh: [], bulletPointsZh: [] },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "", warning: "" },
    lowBandDiagnostics: { recommendedLowBandRange: "", reason: "" },
    lowBandDiagnosticsZh: { reasonZh: "" },
    highBandDiagnostics: {
      fullyAddressesTask: false,
      clearProgression: false,
      wellDevelopedIdeas: false,
      wideAccurateVocabulary: false,
      flexibleGrammar: false,
      fewErrors: false,
      appropriateToneTask1: task === "Task 1" ? false : null,
      recommendedHighBandRange: "",
      reason: ""
    },
    highBandDiagnosticsZh: { reasonZh: "" },
    scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
    scoreCalibrationZh: { capReasonZh: "", whyNotHigherZh: "", whyNotLowerZh: "", evidenceZh: [] },
    overallBand: 1,
    estimatedLevel: "Band 1.0",
    criteria: {
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    strengthsZh: [],
    mainProblems: [],
    mainProblemsZh: [],
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: [],
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
    spellingCorrections: [],
    grammarErrors: [],
    sentenceCorrections: [],
    detailedSentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    modelAnswerOutline: "",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: { revisionLimited: true, revisionLimitReason: "This scoring stage does not generate a model answer." },
    revisionNotes: [],
    revisionNotesZh: [],
    disclaimer: DISCLAIMER
  };

  return [
    "Return exactly one valid JSON object matching this shape. Fill scoring and task-analysis fields with real IELTS assessment.",
    JSON.stringify(shape),
    "Important scoring rules:",
    "- Do not copy template values. Replace Band 1 placeholders with real criterion bands.",
    "- Give specific evidence from the essay for each criterion.",
    "- If under the recommended word count, reflect it in the relevant criterion, but still grade the writing actually submitted.",
    "- Do not do detailed error lists here; later stages handle all spelling, grammar, and sentence corrections.",
    "- Keep strengths/mainProblems/advice arrays short but specific, usually 2-5 items.",
    buildTargetImprovementInstruction(body),
    "Server low-band context:",
    JSON.stringify({ lowBandDiagnostics: diagnostics, capSuggestion: cap }),
    "Request:",
    JSON.stringify({
      task,
      taskType,
      gradingMode,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      actualWordCount: words,
      targetWordCount: body.targetWordCount,
      isUnderMinimum: Boolean(body.isUnderMinimum),
      essay: body.essay
    })
  ].join("\n");
}

async function callAiLeanScoringPass({ apiKey, model, body, gradingMode, locale, deadline }) {
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildLeanScoreSystemPrompt(locale),
    userPrompt: buildLeanScorePrompt({ ...body, mode: gradingMode }, gradingMode, locale),
    maxTokens: 3000,
    temperature: 0.1,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(90000, Number(process.env.AI_SCORE_TIMEOUT_MS) || 150000))
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 3000,
    allowRepair: true,
    deadline
  });
}

function normalizeFocusedCorrectionStage(value) {
  const raw = String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
  if (["spell", "spelling", "spellingcorrection", "spellingcorrections", "correctionspelling"].includes(raw)) return "spelling";
  if (["grammar", "grammarerror", "grammarerrors", "correctiongrammar"].includes(raw)) return "grammar";
  if (["sentence", "sentences", "sentencecorrection", "sentencecorrections", "detailedsentence", "correctionsentence"].includes(raw)) return "sentence";
  if (["advice", "coaching", "plan", "priority", "taskadvice", "correctionadvice"].includes(raw)) return "advice";
  return "";
}

function buildFocusedSectionSystemPrompt(section, locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use brief Chinese helper notes only in fields ending with Zh. Do not translate the full essay."
    : "Main fields must be English. Use brief Chinese helper notes only in fields ending with Zh. Do not translate the full essay.";
  const sectionName = {
    spelling: "spelling and typo correction",
    grammar: "grammar and word-form correction",
    sentence: "sentence-level correction and better expressions",
    advice: "IELTS improvement coaching and task-specific advice"
  }[section] || "IELTS correction";
  return [
    `You are an IELTS Writing examiner. This pass is ONLY for ${sectionName}.`,
    "Do not rescore the essay.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Use only words and sentences that appear in the user's essay for original text fields.",
    "Do not invent user sentences.",
    "The user wants maximum useful detail. Do not stop at two examples when more clear issues exist.",
    chineseRule
  ].join(" ");
}

function buildFocusedSectionPrompt(body, mode, section, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const limit = correctionLimitForEssay(body, mode);
  const common = [
    `Task: ${task}`,
    `Current estimated band from score stage: ${body.currentOverallBand || body.overallBand || "unknown"}`,
    `Word count: ${words}`,
    buildTargetImprovementInstruction(body),
    "Question:",
    String(body.questionPrompt || ""),
    "Essay:",
    String(body.essay || "")
  ];

  if (section === "spelling") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        spellingCorrections: [
          { originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }
        ],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      `Find all clear spelling mistakes and typo-like errors. Return up to ${limit} items. If none exist, return an empty spellingCorrections array and say this briefly in errorAnalysis.summary.`,
      "Do not include correctly spelled words.",
      ...common
    ].join("\n");
  }

  if (section === "grammar") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        grammarErrors: [
          { type: "", original: "", corrected: "", explanation: "", explanationZh: "" }
        ],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      `Find all clear grammar, word-form, article, tense, plural, agreement, preposition, punctuation, and sentence-structure errors. Return up to ${limit} items.`,
      "Each item must include original text from the essay, corrected text, and a specific rule/explanation.",
      ...common
    ].join("\n");
  }

  if (section === "sentence") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        sentenceCorrections: [
          { original: "", corrected: "", reason: "", reasonZh: "" }
        ],
        detailedSentenceCorrections: [
          { sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "" }
        ]
      }),
      `Scan the whole essay sentence by sentence. Return up to ${limit} sentenceCorrections and up to ${limit} detailedSentenceCorrections.`,
      "For each useful issue, provide original sentence, corrected sentence, better expression at the realistic target band, problem, rule, and band impact.",
      "Do not make Band 3-5 learners imitate Band 8-9 language. Upgrade only to the next realistic target range.",
      ...common
    ].join("\n");
  }

  return [
    "Return JSON with this exact shape:",
    JSON.stringify({
      correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
      targetImprovementPlan: { currentBand: "", targetBandRange: "", targetReason: "", focus: [], focusZh: [], criterionUpgrades: [], practiceTasks: [], practiceTasksZh: [] },
      task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
      task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
      taskAchievementAdvice: [],
      coherenceAdvice: [],
      lexicalAdvice: [],
      grammarAdvice: [],
      band5FixPlan: [],
      band6UpgradePlan: [],
      band7UpgradePlan: [],
      errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
    }),
    "Give detailed IELTS coaching based on the current band and the next realistic target range.",
    "Focus on improving 0.5-1 band at a time, with Band 5 as the first floor for very weak writing.",
    "Give concrete actions, not generic advice. Include task-specific advice.",
    "For Task 1: opening, closing, tone, purpose, bullet coverage.",
    "For Task 2: position, introduction, body paragraph development, examples, conclusion, relevance.",
    ...common
  ].join("\n");
}

async function callAiFocusedSectionStageOnly({ apiKey, model, body, effectiveMode, section, locale, deadline }) {
  const maxTokensBySection = {
    spelling: 3200,
    grammar: 5200,
    sentence: 7600,
    advice: 5200
  };
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildFocusedSectionSystemPrompt(section, locale),
    userPrompt: buildFocusedSectionPrompt({ ...body, mode: effectiveMode }, effectiveMode, section, locale),
    maxTokens: maxTokensBySection[section] || 4200,
    temperature: 0.15,
    jsonMode: false,
    deadline,
    timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(90000, Number(process.env.AI_CORRECTION_STAGE_TIMEOUT_MS) || 150000))
  });

  const parsed = await parseCorrectionJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: effectiveMode },
    locale,
    maxTokens: maxTokensBySection[section] || 4200,
    deadline
  });

  const output = { disclaimer: DISCLAIMER };
  return mergeAiCorrectionDetails(output, parsed, body, effectiveMode);
}



function normalizeAiStage(value) {
  const raw = String(value || "all").toLowerCase().replace(/[_\s-]+/g, "");
  if (["score", "scoring", "grade", "grading"].includes(raw)) return "score";
  const focused = normalizeFocusedCorrectionStage(raw);
  if (focused) return `correction-${focused}`;
  if (["correction", "corrections", "error", "errors", "detailedcorrection", "detailedcorrections"].includes(raw)) return "correction";
  if (["revision", "model", "modelanswer", "revisedessay"].includes(raw)) return "revision";
  return "all";
}

async function callAiScoreOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  const gradingMode = effectiveMode === "revision" ? "full" : effectiveMode;
  const gradingMaxTokens = effectiveMode === "revision" ? maxTokensForMode("full", veryShort) : maxTokens;
  let result;

  try {
    result = await callAiLeanScoringPass({
      apiKey,
      model,
      body,
      gradingMode,
      locale,
      deadline
    });
    result = assertMeaningfulAiScoringResult(result, body, "Lean AI scoring");
  } catch (primaryError) {
    try {
      result = await callAiCompactScoringRetry({
        apiKey,
        model,
        body,
        gradingMode,
        locale,
        deadline
      });
      result = assertMeaningfulAiScoringResult(result, body, "Compact AI scoring retry");
      result.gradingWarning = isDeepSeekEmptyResponseError(primaryError)
        ? "Primary AI scoring returned empty content, so a compact AI scoring retry was used."
        : "Primary AI scoring failed, so a compact AI scoring retry was used.";
    } catch (retryError) {
      try {
        result = await callAiNoTemplateScoringPass({
          apiKey,
          model,
          body,
          gradingMode,
          locale,
          deadline
        });
        result = assertMeaningfulAiScoringResult(result, body, "No-template AI scoring retry");
        result.gradingWarning = "Primary AI scoring was incomplete, so a no-template AI scoring retry was used.";
      } catch (noTemplateError) {
        try {
          result = await callAiMinimalScoringPass({
            apiKey,
            model,
            body,
            gradingMode,
            locale,
            deadline
          });
          result = assertMeaningfulAiScoringResult(result, body, "Minimal AI scoring retry");
          result.gradingWarning = isDeepSeekEmptyResponseError(primaryError) || isDeepSeekEmptyResponseError(retryError) || isDeepSeekEmptyResponseError(noTemplateError)
            ? "Primary AI scoring returned empty content, so a minimal AI scoring retry was used."
            : "Primary AI scoring failed, so a minimal AI scoring retry was used.";
        } catch (minimalError) {
          throw minimalError || noTemplateError || retryError || primaryError;
        }
      }
    }
  }

  return result;
}

async function callAiCorrectionStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = { disclaimer: DISCLAIMER };
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  if (!String(body.essay || "").trim()) return output;

  try {
    const correction = await callAiCorrectionPass({
      apiKey,
      model,
      body: { ...body, mode: effectiveMode, currentOverallBand: body.currentOverallBand || body.overallBand },
      effectiveMode,
      locale,
      deadline,
      maxTokensOverride: Math.min(Math.max(correctionLimitForEssay(body, effectiveMode) * 320, words < 80 ? 5000 : 9000), effectiveMode === "revision" ? 18000 : 15000),
      timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(60000, Number(process.env.AI_CORRECTION_TIMEOUT_MS) || 90000))
    });
    output = mergeAiCorrectionDetails(output, correction, body, effectiveMode);
  } catch (firstError) {
    output.correctionWarning = isDeepSeekTimeoutError(firstError)
      ? "AI detailed correction pass timed out. A focused retry will be attempted when enough server time remains."
      : "AI detailed correction pass failed. A focused retry will be attempted when enough server time remains.";
  }

  output = await ensureAiCorrectionDetails({
    result: output,
    apiKey,
    model,
    body: { ...body, currentOverallBand: body.currentOverallBand || body.overallBand },
    gradingMode: effectiveMode,
    locale,
    deadline
  });

  output.aiStage = "correction";
  output.disclaimer = DISCLAIMER;
  return output;
}

async function callAiRevisionStageOnly({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  let output = { disclaimer: DISCLAIMER, aiStage: "revision" };
  if (effectiveMode !== "revision") return output;
  try {
    const revision = await callAiGradingPass({
      apiKey,
      model,
      body,
      gradingMode: "revision",
      maxTokens,
      locale,
      deadline,
      veryShort
    });
    output = mergeRevisionPassIntoResult(output, revision);
  } catch (error) {
    output = addRevisionTimeoutWarning(output);
    output.revisionWarning = isDeepSeekTimeoutError(error)
      ? "AI model-answer pass timed out. Grading and correction can still be used."
      : "AI model-answer pass did not complete. Grading and correction can still be used.";
  }
  return output;
}

async function callAiOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  const gradingMode = effectiveMode === "revision" ? "full" : effectiveMode;
  const gradingMaxTokens = effectiveMode === "revision" ? maxTokensForMode("full", veryShort) : maxTokens;

  let result;
  try {
    result = await callAiLeanScoringPass({
      apiKey,
      model,
      body,
      gradingMode,
      locale,
      deadline
    });
    result = assertMeaningfulAiScoringResult(result, body, "Lean AI scoring");
  } catch (primaryError) {
    try {
      result = await callAiCompactScoringRetry({
        apiKey,
        model,
        body,
        gradingMode,
        locale,
        deadline
      });
      result = assertMeaningfulAiScoringResult(result, body, "Compact AI scoring retry");
      result.gradingWarning = isDeepSeekEmptyResponseError(primaryError)
        ? "Primary AI scoring returned empty content, so a compact AI scoring retry was used."
        : "Primary AI scoring failed, so a compact AI scoring retry was used.";
    } catch (retryError) {
      try {
        result = await callAiNoTemplateScoringPass({
          apiKey,
          model,
          body,
          gradingMode,
          locale,
          deadline
        });
        result = assertMeaningfulAiScoringResult(result, body, "No-template AI scoring retry");
        result.gradingWarning = "Primary AI scoring was incomplete, so a no-template AI scoring retry was used.";
      } catch (noTemplateError) {
        try {
          result = await callAiMinimalScoringPass({
            apiKey,
            model,
            body,
            gradingMode,
            locale,
            deadline
          });
          result = assertMeaningfulAiScoringResult(result, body, "Minimal AI scoring retry");
          result.gradingWarning = isDeepSeekEmptyResponseError(primaryError) || isDeepSeekEmptyResponseError(retryError) || isDeepSeekEmptyResponseError(noTemplateError)
            ? "Primary AI scoring returned empty content, so a minimal AI scoring retry was used."
            : "Primary AI scoring failed, so a minimal AI scoring retry was used.";
        } catch (minimalError) {
          throw minimalError || noTemplateError || retryError || primaryError;
        }
      }
    }
  }

  if (remainingAiTime(deadline) > 9000) {
    try {
      const correction = await callAiCorrectionPass({
        apiKey,
        model,
        body: { ...body, mode: gradingMode, currentOverallBand: result?.overallBand },
        effectiveMode: gradingMode,
        locale,
        deadline
      });
      result = mergeAiCorrectionDetails(result, correction, body, gradingMode);
    } catch (correctionError) {
      try {
        const correctionRetry = await callAiCorrectionPass({
          apiKey,
          model,
          body: { ...body, mode: gradingMode, currentOverallBand: result?.overallBand },
          effectiveMode: gradingMode,
          locale,
          deadline,
          maxTokensOverride: 4200,
          timeoutMs: Math.min(10000, AI_SINGLE_REQUEST_TIMEOUT_MS)
        });
        result = mergeAiCorrectionDetails(result, correctionRetry, body, gradingMode);
      } catch {
        result.correctionWarning = isDeepSeekEmptyResponseError(correctionError)
          ? "AI correction pass returned empty content. The score was returned first. Please retry detailed corrections."
          : "AI correction pass timed out. The score was returned first. Please retry detailed corrections.";
        result.correctionPassWarning = result.correctionWarning;
      }
    }
  } else {
    result.correctionWarning = "Not enough server time remained for AI detailed correction. The score was returned first. Please retry detailed corrections.";
    result.correctionPassWarning = result.correctionWarning;
  }

  result = await ensureAiCorrectionDetails({
    result,
    apiKey,
    model,
    body: { ...body, currentOverallBand: result?.overallBand },
    gradingMode,
    locale,
    deadline
  });

  if (effectiveMode === "revision") {
    try {
      const revision = await callAiGradingPass({
        apiKey,
        model,
        body,
        gradingMode: "revision",
        maxTokens,
        locale,
        deadline,
        veryShort
      });
      result = mergeRevisionPassIntoResult(result, revision);
    } catch (error) {
      result = addRevisionTimeoutWarning(result);
      if (isDeepSeekTimeoutError(error) || isDeepSeekEmptyResponseError(error)) {
        result.correctionWarning = "AI model-answer pass did not complete. The grading and correction feedback were returned first.";
        result.correctionPassWarning = result.correctionWarning;
      }
    }
  }

  return result;
}

function defaultRevisedEssayMeta(limited = false, reason = "") {
  if (limited) {
    return {
      band5Target: "Basic completion version only.",
      band6Target: "",
      band7Target: "",
      revisionLimited: true,
      revisionLimitReason: reason || "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions."
    };
  }
  return {
    band5Target: "Basic but complete response; simple grammar; suitable for Band 5.",
    band6Target: "Clear and complete response with better organisation and vocabulary; suitable for Band 6.",
    band7Target: "Well-developed and natural response; suitable for Band 7, not Band 9.",
    revisionLimited: false,
    revisionLimitReason: ""
  };
}


function extractPromptBulletPoints(prompt) {
  const text = String(prompt || "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines
    .filter((line) => /^[-*•·]\s+/.test(line) || /^(\d+)[.)]\s+/.test(line))
    .map((line) => line.replace(/^[-*•·]\s+/, "").replace(/^(\d+)[.)]\s+/, "").trim())
    .filter(Boolean);
  if (bulletLines.length) return bulletLines.slice(0, 5);

  const afterInYourLetter = text.split(/In your letter/i)[1] || "";
  const candidates = afterInYourLetter
    .split(/\n|;/)
    .map((part) => part.replace(/^[-*•·]\s+/, "").trim())
    .filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|thank|invite|offer|request|remind)/i.test(part));
  return candidates.slice(0, 5);
}

function buildFallbackTaskRequirementAnalysis(body, fallbackReason, locale = "en") {
  const prompt = String(body.questionPrompt || "");
  if (body.task === "Task 1") {
    const bulletPoints = extractPromptBulletPoints(prompt).map((requirement) => ({
      requirement,
      covered: false,
      evidence: "Fallback mode was used, so bullet-point coverage could not be checked reliably."
    }));
    return {
      taskType: "task1",
      taskPurpose: "Write a General Training Task 1 letter that answers the selected prompt.",
      recipient: "Not extracted in local low-word-count/fallback mode.",
      relationship: "Not extracted in local low-word-count/fallback mode.",
      requiredTone: "Use the tone required by the selected prompt.",
      letterType: "General Training Task 1 letter.",
      bulletPoints,
      missingRequirements: bulletPoints.map((item) => item.requirement),
      taskMatchSummary: `Fallback mode: ${fallbackReason || "AI output was incomplete."}`
    };
  }

  return {
    taskType: "task2",
    questionType: "",
    topic: prompt.slice(0, 160),
    requiredPosition: "Check the selected Task 2 question and give a clear position if required.",
    requiredParts: ["Answer all parts of the selected Task 2 question."],
    positionPresent: false,
    mainIdeasRelevant: false,
    missingRequirements: [],
    taskMatchSummary: `Fallback mode: ${fallbackReason || "AI output was incomplete."}`
  };
}

function buildFallbackErrorAnalysis(body, words, locale = "en") {
  const taskLabel = body.task === "Task 1" ? "Task 1 letter" : "Task 2 essay";
  return {
    summary: `The AI provider did not return complete feedback. This fallback only confirms that the ${taskLabel} has ${words} words and needs a retry for detailed correction.`,
    summaryZh: emptyForLocaleZh(`AI 未返回完整批改；当前仅提供基础诊断，作文约 ${words} 词。`, locale),
    errorPatterns: [],
    priorityFixes: [
      "Retry the grading request once.",
      "If it fails again, use Full Grading instead of Revision.",
      body.task === "Task 1" ? "Check that all bullet points are covered." : "Check that the position and main ideas are clear."
    ],
    priorityFixesZh: emptyForLocaleZh([
      "先重新点击批改一次。",
      "如果仍失败，先用完整评分模式。",
      body.task === "Task 1" ? "检查三个书信要点是否完整。" : "检查立场和主要观点是否清楚。"
    ], locale)
  };
}

function buildFallbackFeedback(body, reason, locale = "en") {
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const firstCriterion = firstCriterionName(body.task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  let band = 3;
  let bandReason = "The response is very limited and cannot support a higher score.";
  const normalLength = (body.task === "Task 1" && words >= 150) || (body.task === "Task 2" && words >= 250);

  if (diagnostics.isBlank || diagnostics.mostlyNonEnglish) {
    band = 0;
    bandReason = diagnostics.reason || "There is no rateable English attempt.";
  } else if (diagnostics.mostlyCopiedFromPrompt) {
    band = 1;
    bandReason = "The response is mostly copied from the prompt and has little rateable original writing.";
  } else if (words <= 5) {
    band = 0.5;
    bandReason = "The response has 5 words or fewer and almost no rateable content.";
  } else if (words <= 20) {
    band = 1.5;
    bandReason = "The response has 20 words or fewer and provides very little rateable content.";
  } else if ((body.task === "Task 1" && words < 50) || (body.task === "Task 2" && words < 80)) {
    band = 2.5;
    bandReason = "The response is extremely short and should be assessed from Band 0-3 depending on rateable content.";
  } else if ((body.task === "Task 1" && words < 80) || (body.task === "Task 2" && words < 150)) {
    band = 3.5;
    bandReason = "The response is significantly underlength and only partly communicates a relevant message.";
  } else if (body.task === "Task 1" && words < 120) {
    band = 4.5;
    bandReason = "Task 1 is below 120 words, so task coverage and development are limited.";
  } else if (body.task === "Task 1" && words < 150) {
    band = 5;
    bandReason = "Task 1 is below the 150-word recommended minimum, so the response is underdeveloped.";
  } else if (body.task === "Task 2" && words < 200) {
    band = 4.5;
    bandReason = "Task 2 is below 200 words, so argument development is limited.";
  } else if (body.task === "Task 2" && words < 250) {
    band = 5;
    bandReason = "Task 2 is below the 250-word recommended minimum, so the response is underdeveloped.";
  } else if (cap.cap !== null) {
    band = Math.min(4, cap.cap);
    bandReason = cap.reason;
  } else if (normalLength) {
    band = 5.5;
    bandReason = "AI output was incomplete. This fallback band is a temporary estimate only; retry to get full IELTS feedback.";
  }

  const criterionBand = roundHalf(band);
  const noRateable = criterionBand === 0;
  const revisionLimited = criterionBand <= 3.5 || diagnostics.littleRelevantMessage;
  const firstFeedback = noRateable
    ? "There is no rateable English response to assess for this task."
    : "The response is too short or limited and does not fully answer the task.";
  const firstFeedbackZh = noRateable
    ? "没有可评分的英文作答。"
    : "作文太短或内容有限，没有充分完成题目要求。";

  return {
    actualWordCount: words,
    taskTypeDetected: body.task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: body.task === "Task 1" ? 150 : 250,
    wordCountStatus: body.task === "Task 1" ? (words >= 150 ? "meets_task1_minimum" : (words < 80 ? "very_short_task1" : "under_task1_minimum")) : (words >= 250 ? "meets_task2_minimum" : (words < 150 ? "very_short_task2" : "under_task2_minimum")),
    taskRequirementAnalysis: buildFallbackTaskRequirementAnalysis(body, reason, locale),
    taskRequirementAnalysisZh: { taskPurposeZh: emptyForLocaleZh("题目要求已传入，但 fallback 无法完整分析。", locale), requiredToneZh: emptyForLocaleZh(body.task === "Task 1" ? "语气需根据收信人判断。" : "", locale), letterTypeZh: emptyForLocaleZh(body.task === "Task 1" ? "信件类型需结合题目判断。" : "", locale), taskMatchSummaryZh: emptyForLocaleZh("当前是基础诊断，建议重试获取完整题目分析。", locale), bulletPointsZh: emptyForLocaleZh([], locale), requiredPartsZh: emptyForLocaleZh([], locale) },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "No mismatch was detected before fallback was used.", warning: "" },
    highBandDiagnostics: { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: body.task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: normalLength ? "Fallback mode cannot confirm high-band evidence. Retry for full high-band diagnostics." : "The response is too short or limited for high-band evidence." },
    overallBand: criterionBand,
    estimatedLevel: normalLength ? `Band ${formatBand(criterionBand)} fallback estimate` : `Band ${formatBand(criterionBand)}`,
    lowBandDiagnostics: diagnostics,
    lowBandDiagnosticsZh: { reasonZh: emptyForLocaleZh(diagnostics.reason || "没有明显低分触发项。", locale) },
    scoreCalibration: {
      strictness: "strict",
      capApplied: !normalLength || Boolean(diagnostics.recommendedLowBandRange),
      capReason: bandReason,
      whyNotHigher: noRateable
        ? "There is no rateable English response, so a higher band is not justified."
        : (normalLength ? "This is a fallback estimate because the AI provider returned incomplete output; retry for a reliable higher-band decision." : "The answer is too short, misses key task requirements, and provides too little evidence of organisation, vocabulary, and grammar control."),
      whyNotLower: noRateable
        ? "Band 0 is already the lowest score."
        : (normalLength ? "The response meets the task word-count threshold, so a zero or unavailable score is not appropriate in fallback mode." : "There is at least a small attempt to communicate something related to the task."),
      evidence: [
        `The response has ${words} words.`,
        bandReason,
        diagnostics.reason || "The response provides limited rateable evidence."
      ].filter(Boolean).slice(0, 5)
    },
    criteria: {
      [firstCriterion]: {
        band: criterionBand,
        feedback: firstFeedback,
        feedbackZh: emptyForLocaleZh(firstFeedbackZh, locale),
        howToImprove: "Write a fuller response and cover all bullet points or develop your main ideas.",
        howToImproveZh: emptyForLocaleZh("请补充内容，覆盖所有要点或展开主要观点。", locale)
      },
      "Coherence and Cohesion": {
        band: criterionBand,
        feedback: "There is not enough text to show clear organisation.",
        feedbackZh: emptyForLocaleZh("内容太少，无法体现清楚结构。", locale),
        howToImprove: "Use separate paragraphs and simple linking words.",
        howToImproveZh: emptyForLocaleZh("请分段，并使用简单连接词。", locale)
      },
      "Lexical Resource": {
        band: criterionBand,
        feedback: "Vocabulary range is very limited.",
        feedbackZh: emptyForLocaleZh("词汇范围非常有限。", locale),
        howToImprove: "Add more topic-related vocabulary.",
        howToImproveZh: emptyForLocaleZh("增加与题目相关的词汇。", locale)
      },
      "Grammatical Range and Accuracy": {
        band: criterionBand,
        feedback: "There is not enough language to assess grammar fully.",
        feedbackZh: emptyForLocaleZh("语言太少，难以完整评估语法。", locale),
        howToImprove: "Write complete sentences and check verb forms.",
        howToImproveZh: emptyForLocaleZh("写完整句子，并检查动词形式。", locale)
      }
    },
    strengths: noRateable ? [] : ["You attempted to respond to the task."],
    strengthsZh: emptyForLocaleZh(noRateable ? [] : ["你尝试回应题目。"], locale),
    mainProblems: normalLength
      ? ["AI feedback was incomplete, so this is only a temporary fallback estimate.", "Retry to receive detailed task, grammar, and revision feedback."]
      : ["The essay is far below the recommended word count.", "Several task points or ideas are missing."],
    grammarErrors: [],
    spellingCorrections: [],
    sentenceCorrections: [],
    taskAchievementAdvice: normalLength ? ["Retry for a reliable check of task coverage."] : ["Add enough detail to answer the task properly."],
    coherenceAdvice: normalLength ? ["Retry for detailed organisation feedback."] : ["Use clear paragraphs."],
    lexicalAdvice: normalLength ? ["Retry for detailed vocabulary feedback."] : ["Use more topic vocabulary."],
    grammarAdvice: normalLength ? ["Retry for detailed grammar feedback."] : ["Write complete sentences."],
    band5FixPlan: ["Write at least the recommended word count.", "Cover all bullet points or develop two clear ideas."],
    band6UpgradePlan: ["Add supporting details and examples."],
    band7UpgradePlan: ["Use more precise vocabulary and varied sentence structures."],
    modelAnswerOutline: "Write a fuller answer with an opening, clear body points, and a suitable closing.",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: defaultRevisedEssayMeta(revisionLimited, "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions."),
    revisionNotes: [normalLength ? "AI output was incomplete, so this is a temporary fallback estimate. Retry to get full feedback and revisions." : "The response was too short, so only a basic diagnostic score is provided."],
    revisionNotesZh: emptyForLocaleZh([normalLength ? "AI 返回内容不完整；当前只是临时估分，请重试获取完整批改。" : "作文太短，因此这里只提供基础诊断评分。"], locale),
    errorAnalysis: buildFallbackErrorAnalysis(body, words, locale),
    detailedSentenceCorrections: [],
    task1LetterCorrections: body.task === "Task 1" ? { openingComment: "The opening could not be fully checked in fallback mode.", closingComment: "The closing could not be fully checked in fallback mode.", toneComment: "Use a tone suitable for the recipient in the selected prompt.", purposeComment: normalLength ? "Retry for a full purpose and bullet-point check." : "The response is underlength, so the purpose and bullet points need fuller development.", bulletPointAdvice: extractPromptBulletPoints(body.questionPrompt).map((point) => ({ bulletPoint: point, covered: false, comment: "Coverage could not be fully checked in fallback mode.", suggestedSentence: "" })) } : null,
    task2EssayCorrections: body.task === "Task 2" ? { positionComment: "State a clear position if the question asks for your opinion.", introductionComment: "The introduction could not be fully checked in fallback mode.", bodyParagraphComment: "Develop each body paragraph with a clear main idea and support.", exampleComment: "Add specific examples where useful.", conclusionComment: "End with a clear summary or final opinion.", developmentAdvice: ["Expand the essay to meet the recommended word count."] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: emptyForLocaleZh([], locale), fixNextZh: emptyForLocaleZh([], locale), polishLaterZh: emptyForLocaleZh([], locale) },
    scoreUnavailable: false,
    scoringCalibration: {
      strictness: "strict",
      capApplied: !normalLength || Boolean(diagnostics.recommendedLowBandRange),
      capReason: bandReason,
      whyNotHigher: noRateable ? "There is no rateable English response, so a higher band is not justified." : (normalLength ? "This is a temporary fallback estimate because provider output was incomplete." : "The response is below the recommended word count and lacks enough development."),
      whyNotLower: noRateable ? "Band 0 is already the lowest score." : "There is some rateable relevant English content.",
      evidence: [`Word count: ${words}.`, bandReason, diagnostics.reason].filter(Boolean).slice(0, 5)
    },
    lowBandEvidence: diagnostics,
    highBandEvidence: { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: body.task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: normalLength ? "Fallback mode cannot confirm high-band evidence. Retry for full high-band diagnostics." : "The response is below the recommended word count, so high-band evidence is not available." },
    overallEstimatedBand: criterionBand,
    revisedEssay: "",
    feedback: normalLength ? "Temporary fallback feedback. Retry for a complete AI response." : "Low-word-count provider fallback. DeepSeek was attempted, but complete AI output was not available.",
    disclaimer: DISCLAIMER,
    fallback: !noRateable,
    diagnosticMode: body.isUnderMinimum ? "provider_fallback_low_word_count" : (noRateable ? "no_rateable_response" : "provider_fallback"),
    fallbackReason: reason || (body.isUnderMinimum ? `DeepSeek was attempted for this low-word-count response, but complete output was not available. ${lowWordCountReason(body)}` : "DeepSeek returned incomplete JSON.")
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

function buildRepairPrompt(rawText, task, locale = "en") {
  return [
    "Convert the following text into one valid JSON object matching the required IELTS feedback schema.",
    "Return JSON only. Do not add markdown, explanations, or code fences.",
    "If a field is missing, add it with an empty array [] or empty string \"\" as appropriate.",
    "Do not use trailing commas. Do not use comments inside JSON.",
    "",
    "Required JSON shape:",
    JSON.stringify(buildExpectedJsonShape(task, locale), null, 2),
    "",
    "Text to repair:",
    String(rawText || "").slice(0, 12000)
  ].join("\n");
}

function extractDeepSeekText(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = typeof message.content === "string" ? message.content : "";
  const reasoningContent = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  const legacyText = typeof choice.text === "string" ? choice.text : "";
  return (content || reasoningContent || legacyText || "").trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  return Math.min(800, 250 * attempt);
}

function isRetryableProviderStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens, temperature = 0.2, jsonMode = false, deadline, timeoutMs }) {
  const maxAttempts = Math.max(1, Math.min(Number(process.env.DEEPSEEK_RETRY_ATTEMPTS) || 2, 3));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const requestTimeoutMs = resolveAiTimeout(deadline, timeoutMs);
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    const requestBody = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature,
      stream: false,
      max_tokens: maxTokens
    };
    if (jsonMode) requestBody.response_format = { type: "json_object" };

    let response;
    let raw = "";
    try {
      response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      raw = await response.text();
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === "AbortError") {
        const timeoutError = new Error("DeepSeek request timed out.");
        timeoutError.code = "DEEPSEEK_TIMEOUT";
        timeoutError.provider = "deepseek";
        timeoutError.detail = "The AI provider did not respond before the server timeout.";
        lastError = timeoutError;
        throw lastError;
      } else {
        lastError = error;
      }
      if (attempt < maxAttempts && remainingAiTime(deadline) > 5000) {
        await wait(retryDelayMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = new Error("DeepSeek API request failed.");
      error.status = response.status;
      error.raw = raw;
      lastError = error;
      if (attempt < maxAttempts && isRetryableProviderStatus(response.status) && remainingAiTime(deadline) > 5000) {
        await wait(retryDelayMs(attempt));
        continue;
      }
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
    if (outputText) return outputText;

    const emptyError = new Error("DeepSeek returned an empty response.");
    emptyError.code = "DEEPSEEK_EMPTY_RESPONSE";
    emptyError.provider = "deepseek";
    emptyError.raw = raw;
    lastError = emptyError;

    if (attempt < maxAttempts && remainingAiTime(deadline) > 5000) {
      await wait(retryDelayMs(attempt));
      continue;
    }

    throw emptyError;
  }

  throw lastError || new Error("DeepSeek request failed.");
}

function sendProviderError(req, res, error) {
  if (error.code === "DEEPSEEK_TIMEOUT" || error.message === "DeepSeek request timed out.") {
    sendJson(req, res, 504, {
      error: "DeepSeek request timed out.",
      provider: "deepseek",
      detail: "The AI provider did not respond before the server timeout.",
      suggestion: "Please retry, or use the non-revision detailed mode first."
    });
    return true;
  }

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


function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function simpleHash(text) {
  let hash = 2166136261;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildAiCacheKey(body, mode, model, locale) {
  return simpleHash(stableStringify({
    model,
    locale,
    mode,
    task: body.task,
    questionPrompt: body.questionPrompt,
    essay: body.essay,
    wordCount: body.wordCount,
    targetWordCount: body.targetWordCount
  }));
}

function getCachedAiResult(cacheKey) {
  if (!AI_CACHE_TTL_MS || !cacheKey) return null;
  const cached = AI_RESPONSE_CACHE.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > AI_CACHE_TTL_MS) {
    AI_RESPONSE_CACHE.delete(cacheKey);
    return null;
  }
  return JSON.parse(JSON.stringify(cached.value));
}

function setCachedAiResult(cacheKey, value) {
  if (!AI_CACHE_TTL_MS || !cacheKey || !value) return;
  AI_RESPONSE_CACHE.set(cacheKey, {
    createdAt: Date.now(),
    value: JSON.parse(JSON.stringify(value))
  });
  if (AI_RESPONSE_CACHE.size > 100) {
    const oldestKey = AI_RESPONSE_CACHE.keys().next().value;
    if (oldestKey) AI_RESPONSE_CACHE.delete(oldestKey);
  }
}

function extractAiNumber(rawText, key) {
  const match = String(rawText || "").match(new RegExp(`"${key}"\\s*:\\s*([0-9]+(?:\\.[05])?)`, "i"));
  return match ? Number(match[1]) : null;
}

function extractAiString(rawText, key) {
  const source = String(rawText || "");
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, "i"));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function buildAiPartialResultFromText(rawText, body, issue = "") {
  const overall = extractAiNumber(rawText, "overallBand");
  if (!Number.isFinite(overall)) return null;

  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const underMinimum = words < threshold;

  const firstBand = extractAiNumber(rawText, "Task Achievement") || extractAiNumber(rawText, "Task Response") || overall;
  const ccBand = extractAiNumber(rawText, "Coherence and Cohesion") || overall;
  const lrBand = extractAiNumber(rawText, "Lexical Resource") || overall;
  const graBand = extractAiNumber(rawText, "Grammatical Range and Accuracy") || overall;

  const taskFeedback = extractAiString(rawText, "feedback") ||
    (task === "Task 1" ? "The letter responds to the task but needs fuller bullet-point coverage." : "The essay answers the topic but needs clearer development and support.");
  const taskImprove = extractAiString(rawText, "howToImprove") ||
    (task === "Task 1" ? "Cover every bullet point with one clear detail." : "State a clearer position and support each idea.");
  const whyNotHigher = extractAiString(rawText, "whyNotHigher") ||
    (underMinimum ? `The AI output indicates the response is below the ${threshold}-word recommendation and underdeveloped.` : "The AI output indicates the response needs stronger development, organisation, vocabulary, or grammar control.");
  const whyNotLower = extractAiString(rawText, "whyNotLower") ||
    "The visible band is recovered from AI scoring data, not from local scoring.";
  const lowReason = extractAiString(rawText, "reason") ||
    (underMinimum ? `The response has ${words} words, below the recommended ${threshold}-word minimum.` : "The AI did not confirm a hard low-band trigger.");

  const taskAdvice = task === "Task 1"
    ? ["Cover each bullet point directly.", "Make the purpose clear in the opening.", "Use a tone suitable for the recipient."]
    : ["State a clear position.", "Develop each main idea with explanation.", "Add specific examples or details."];
  const coherenceAdvice = ["Use clear paragraphing.", "Add logical linking between ideas.", "Avoid listing ideas without explanation."];
  const lexicalAdvice = ["Use more precise topic vocabulary.", "Avoid repeated basic words.", "Check spelling and word choice."];
  const grammarAdvice = ["Write complete sentences.", "Check verb forms and agreement.", "Use simple accurate grammar first."];

  const strengths = cleanStringArray([
    extractAiString(rawText, "strengths"),
    task === "Task 2" ? "The response attempts to give an opinion." : "The response attempts the selected letter task.",
    Number(overall) >= 4 ? "Some relevant ideas are present." : ""
  ]).slice(0, 2);

  const mainProblems = cleanStringArray([
    extractAiString(rawText, "mainProblems"),
    underMinimum ? `The response is below the recommended ${threshold}-word minimum.` : "",
    firstBand <= 5 ? "Ideas need fuller development." : "",
    ccBand <= 5 ? "Organisation and linking need improvement." : "",
    lrBand <= 5 ? "Vocabulary needs more precision." : "",
    graBand <= 5 ? "Grammar accuracy needs improvement." : ""
  ]).slice(0, 4);

  return {
    actualWordCount: words,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: threshold,
    wordCountStatus: underMinimum ? "under_minimum_ai_recovered" : "meets_minimum_ai_recovered",
    taskRequirementAnalysis: task === "Task 1"
      ? {
          taskType: "task1",
          taskPurpose: "Answer the selected General Training letter prompt.",
          recipient: "",
          relationship: "",
          requiredTone: "Use the tone required by the prompt.",
          letterType: "General Training Task 1 letter.",
          bulletPoints: extractPromptBulletPoints(body?.questionPrompt).map((requirement) => ({ requirement, covered: false, evidence: "AI output was repaired; retry for precise coverage evidence." })),
          missingRequirements: [],
          taskMatchSummary: "AI scoring was recovered from incomplete JSON; task analysis is limited but not empty."
        }
      : {
          taskType: "task2",
          questionType: "",
          topic: String(body?.questionTitle || body?.questionPrompt || "").slice(0, 120),
          requiredPosition: "Give a clear position if the question asks for your opinion.",
          requiredParts: ["Answer all parts of the selected Task 2 question."],
          positionPresent: false,
          mainIdeasRelevant: true,
          missingRequirements: [],
          taskMatchSummary: "AI scoring was recovered from incomplete JSON; task analysis is limited but not empty."
        },
    taskRequirementAnalysisZh: {
      taskPurposeZh: "需要回应当前题目要求。",
      requiredToneZh: task === "Task 1" ? "语气要符合收信人关系。" : "",
      letterTypeZh: task === "Task 1" ? "这是 G 类书信任务。" : "",
      taskMatchSummaryZh: "AI 输出已修复，但题目分析较简短。",
      bulletPointsZh: [],
      requiredPartsZh: task === "Task 2" ? ["回答题目的所有部分。"] : []
    },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "The recovered AI output did not show a task mismatch.", warning: issue ? `AI JSON was repaired after: ${String(issue).slice(0, 100)}` : "" },
    overallBand: clampAiBand(overall, 1),
    estimatedLevel: `Band ${formatBand(clampAiBand(overall, 1))}`,
    lowBandDiagnostics: { recommendedLowBandRange: underMinimum ? "Underlength warning" : "", reason: lowReason },
    lowBandDiagnosticsZh: { reasonZh: underMinimum ? "字数不足会影响任务完成和展开。" : "没有确认严重低分触发项。" },
    highBandDiagnostics: { recommendedHighBandRange: "", reason: underMinimum ? "High-band evidence is limited because the answer is underlength." : "High-band evidence was not fully confirmed in the recovered AI output." },
    highBandDiagnosticsZh: { reasonZh: underMinimum ? "字数不足，难以确认高分证据。" : "暂未确认高分证据。" },
    scoreCalibration: {
      strictness: "strict",
      capApplied: Boolean(underMinimum),
      capReason: underMinimum ? `The response is below the ${threshold}-word recommendation.` : "",
      whyNotHigher,
      whyNotLower,
      evidence: cleanStringArray([
        `AI output provided overallBand ${formatBand(clampAiBand(overall, 1))}.`,
        underMinimum ? `Word count: ${words}/${threshold}.` : "",
        mainProblems[0] || ""
      ]).slice(0, 3)
    },
    scoreCalibrationZh: {
      capReasonZh: underMinimum ? "字数不足会限制展开。" : "",
      whyNotHigherZh: "内容、结构、词汇或语法仍有明显提升空间。",
      whyNotLowerZh: "分数来自 AI 输出中恢复的评分信息。",
      evidenceZh: underMinimum ? [`字数：${words}/${threshold}`] : ["AI 输出中包含可恢复评分。"]
    },
    criteria: {
      [firstCriterion]: { band: clampAiBand(firstBand, overall), feedback: taskFeedback, feedbackZh: task === "Task 1" ? "任务回应还需要更完整。" : "观点和展开还不够充分。", howToImprove: taskImprove, howToImproveZh: task === "Task 1" ? "逐条覆盖题目要点。" : "明确立场并展开理由。" },
      "Coherence and Cohesion": { band: clampAiBand(ccBand, overall), feedback: "Organisation and linking need clearer control.", feedbackZh: "结构和衔接需要更清楚。", howToImprove: "Use clearer paragraphing and linking.", howToImproveZh: "分段并自然使用连接词。" },
      "Lexical Resource": { band: clampAiBand(lrBand, overall), feedback: "Vocabulary needs more precision and range.", feedbackZh: "词汇需要更准确更多样。", howToImprove: "Use more precise topic vocabulary.", howToImproveZh: "使用更准确的题目词汇。" },
      "Grammatical Range and Accuracy": { band: clampAiBand(graBand, overall), feedback: "Grammar accuracy and sentence control need improvement.", feedbackZh: "语法准确性和句子控制需提升。", howToImprove: "Use complete and accurate sentences.", howToImproveZh: "先写完整准确的句子。" }
    },
    strengths,
    strengthsZh: strengths.map((_, index) => index === 0 ? "有尝试回应题目。" : "有一些相关内容。").slice(0, strengths.length),
    mainProblems,
    mainProblemsZh: mainProblems.map((item) => item.includes("word") ? "字数不足。" : "内容和语言仍需加强。").slice(0, mainProblems.length),
    grammarErrors: [],
    sentenceCorrections: [],
    errorAnalysis: {
      summary: cleanStringArray(mainProblems).join(" ") || "The response needs clearer task development, organisation, vocabulary, and grammar control.",
      summaryZh: "主要问题是内容展开、结构、词汇和语法控制。",
      errorPatterns: [],
      priorityFixes: taskAdvice.slice(0, 2),
      priorityFixesZh: task === "Task 1" ? ["先补全题目要点。", "再改善语气和结构。"] : ["先明确立场。", "再展开理由和例子。"]
    },
    detailedSentenceCorrections: [],
    task1LetterCorrections: task === "Task 1" ? {
      openingComment: "Make the letter purpose clear at the start.",
      closingComment: "Use a suitable closing sentence.",
      toneComment: "Match the tone to the recipient.",
      purposeComment: "State why you are writing.",
      bulletPointAdvice: extractPromptBulletPoints(body?.questionPrompt).map((point) => ({ bulletPoint: point, covered: false, comment: "Address this requirement directly.", suggestedSentence: "Add one sentence that answers this bullet point." })).slice(0, 5)
    } : null,
    task2EssayCorrections: task === "Task 2" ? {
      positionComment: "State your opinion or position clearly.",
      introductionComment: "Answer the question directly in the introduction.",
      bodyParagraphComment: "Develop each body paragraph with one clear main idea.",
      exampleComment: "Add specific examples or explanations.",
      conclusionComment: "End with a clear final position.",
      developmentAdvice: ["Explain each main idea more fully.", "Add one specific example for each body paragraph."]
    } : null,
    correctionPriority: {
      fixFirst: task === "Task 1" ? ["Task coverage", "Tone", "Sentence accuracy"] : ["Clear position", "Idea development", "Sentence accuracy"],
      fixNext: ["Vocabulary precision", "Linking", "Examples"],
      polishLater: ["More natural expressions", "Flexible grammar"],
      fixFirstZh: task === "Task 1" ? ["先补全任务要点。", "调整语气。", "提高句子准确性。"] : ["先明确立场。", "展开观点。", "提高句子准确性。"],
      fixNextZh: ["提升词汇准确性。", "改善衔接。", "加入例子。"],
      polishLaterZh: ["最后优化自然表达。", "最后提升语法灵活性。"]
    },
    taskAchievementAdvice: taskAdvice,
    coherenceAdvice,
    lexicalAdvice,
    grammarAdvice,
    band5FixPlan: ["Reach the recommended word count with relevant content.", "Use clear paragraphs.", "Write accurate simple sentences."],
    band6UpgradePlan: ["Develop each idea with a reason.", "Use topic vocabulary accurately.", "Use some complex sentences carefully."],
    band7UpgradePlan: ["Make ideas more precise.", "Use more natural cohesion.", "Reduce grammar errors in complex sentences."],
    modelAnswerOutline: task === "Task 1"
      ? "Opening: state the purpose. Body: cover each bullet point. Closing: end politely."
      : "Introduction: answer the question. Body paragraphs: develop two ideas. Conclusion: restate the position.",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: { revisionLimited: true, revisionLimitReason: "AI JSON was recovered; use Revision mode for full revised essays." },
    revisionNotes: ["AI scoring was recovered from incomplete JSON. The advice sections were completed for study use."],
    revisionNotesZh: ["AI 输出不完整，但已补全学习建议。"],
    disclaimer: DISCLAIMER,
    diagnosticMode: "ai_recovered_with_completed_advice",
    aiOnly: true
  };
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function ensureCriteria(result, task) {
  const firstCriterion = firstCriterionName(task);
  result.criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  if (!result.criteria[firstCriterion]) {
    result.criteria[firstCriterion] = {
      band: result.overallBand ?? 0,
      feedback: "",
      feedbackZh: "",
      howToImprove: "",
      howToImproveZh: ""
    };
  }
  ["Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"].forEach((name) => {
    if (!result.criteria[name]) {
      result.criteria[name] = {
        band: result.overallBand ?? 0,
        feedback: "",
        feedbackZh: "",
        howToImprove: "",
        howToImproveZh: ""
      };
    }
  });
}

function hasUsefulText(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (["...", "-", "n/a", "na", "null", "undefined"].includes(text.toLowerCase())) return false;
  return true;
}

function cleanStringArray(value) {
  const seen = new Set();
  return ensureArray(value)
    .map((item) => String(item || "").trim())
    .filter(hasUsefulText)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cleanObjectArray(value, usefulKeys) {
  return ensureArray(value)
    .filter((item) => item && typeof item === "object")
    .filter((item) => usefulKeys.some((key) => hasUsefulText(item[key])))
    .map((item) => ({ ...item }));
}

function criterionItem(result, task, criterionName) {
  ensureCriteria(result, task);
  return result.criteria?.[criterionName] || {};
}

function criterionImprove(result, task, criterionName, fallback) {
  const item = criterionItem(result, task, criterionName);
  return hasUsefulText(item.howToImprove) ? item.howToImprove : fallback;
}

function criterionFeedback(result, task, criterionName, fallback) {
  const item = criterionItem(result, task, criterionName);
  return hasUsefulText(item.feedback) ? item.feedback : fallback;
}

function makeAdviceArray(primary, fallbackItems, limit = 5) {
  const items = cleanStringArray([primary, ...ensureArray(fallbackItems)]);
  return items.slice(0, limit);
}

function backfillDiagnosticAdvice(normalized, body, mode, veryShort) {
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const underMinimum = words < threshold;

  normalized.strengths = cleanStringArray(normalized.strengths).slice(0, 16);
  normalized.mainProblems = cleanStringArray(normalized.mainProblems).slice(0, 10);
  normalized.taskAchievementAdvice = cleanStringArray(normalized.taskAchievementAdvice).slice(0, 16);
  normalized.coherenceAdvice = cleanStringArray(normalized.coherenceAdvice).slice(0, 16);
  normalized.lexicalAdvice = cleanStringArray(normalized.lexicalAdvice).slice(0, 16);
  normalized.grammarAdvice = cleanStringArray(normalized.grammarAdvice).slice(0, 16);
  normalized.band5FixPlan = cleanStringArray(normalized.band5FixPlan).slice(0, 16);
  normalized.band6UpgradePlan = cleanStringArray(normalized.band6UpgradePlan).slice(0, 16);
  normalized.band7UpgradePlan = cleanStringArray(normalized.band7UpgradePlan).slice(0, 16);

  // Remove blank correction cards that the front end would otherwise render as empty boxes.
  const correctionLimit = correctionLimitForEssay(body, mode);
  normalized.spellingCorrections = cleanObjectArray(normalized.spellingCorrections, ["originalWord", "correctedWord", "sentence", "explanation"]).slice(0, correctionLimit);
  normalized.grammarErrors = cleanObjectArray(normalized.grammarErrors, ["original", "corrected", "explanation"]).slice(0, correctionLimit);
  normalized.sentenceCorrections = cleanObjectArray(normalized.sentenceCorrections, ["original", "corrected", "reason"]).slice(0, correctionLimit);
  normalized.detailedSentenceCorrections = cleanObjectArray(normalized.detailedSentenceCorrections, ["originalSentence", "correctedSentence", "problem", "rule", "bandImpact"]).slice(0, correctionLimit);

  const firstImprove = criterionImprove(normalized, task, firstCriterion, task === "Task 1" ? "Answer each bullet point directly with enough detail." : "State a clear position and support it with specific reasons.");
  const ccImprove = criterionImprove(normalized, task, "Coherence and Cohesion", "Use clear paragraphing and logical linking between ideas.");
  const lrImprove = criterionImprove(normalized, task, "Lexical Resource", "Use more precise topic vocabulary and avoid repetition.");
  const graImprove = criterionImprove(normalized, task, "Grammatical Range and Accuracy", "Write complete sentences and check verb forms, articles, and agreement.");

  if (!normalized.taskAchievementAdvice.length) {
    normalized.taskAchievementAdvice = makeAdviceArray(firstImprove, [
      underMinimum ? `Expand the response to at least ${threshold} words.` : "Add more specific support for the task.",
      task === "Task 1" ? "Make sure every bullet point is clearly covered." : "Develop each main idea with explanation or an example."
    ]);
  }
  if (!normalized.coherenceAdvice.length) normalized.coherenceAdvice = makeAdviceArray(ccImprove, ["Use separate paragraphs for separate ideas.", "Add simple linking words naturally."]);
  if (!normalized.lexicalAdvice.length) normalized.lexicalAdvice = makeAdviceArray(lrImprove, ["Replace repeated basic words with accurate topic words.", "Check spelling and word choice."]);
  if (!normalized.grammarAdvice.length) normalized.grammarAdvice = makeAdviceArray(graImprove, ["Use simple accurate sentences before adding complex structures.", "Check tense and subject-verb agreement."]);

  const firstFeedback = criterionFeedback(normalized, task, firstCriterion, "Task response needs more development.");
  const graFeedback = criterionFeedback(normalized, task, "Grammatical Range and Accuracy", "Grammar errors reduce clarity.");

  if (!normalized.mainProblems.length) {
    normalized.mainProblems = cleanStringArray([
      underMinimum ? `The response is under the recommended ${threshold}-word minimum.` : "Task development is limited.",
      firstFeedback,
      graFeedback
    ]).slice(0, 5);
  }
  if (!normalized.strengths.length && words > 0) {
    normalized.strengths = cleanStringArray([
      "The response attempts to answer the selected task.",
      Number(normalized.overallBand) >= 4 ? "Some relevant ideas are present." : "There is some rateable English content."
    ]).slice(0, 3);
  }

  if (!normalized.band5FixPlan.length) {
    normalized.band5FixPlan = cleanStringArray([
      underMinimum ? `First reach the ${threshold}-word minimum with relevant content.` : "Cover the task more completely.",
      "Use clear paragraphs.",
      "Write mostly accurate simple sentences.",
      "Use basic topic vocabulary correctly."
    ]).slice(0, 5);
  }
  if (!normalized.band6UpgradePlan.length) {
    normalized.band6UpgradePlan = cleanStringArray([
      "Develop each main idea with a reason and example.",
      "Use linking words naturally, not mechanically.",
      "Use a wider range of accurate topic vocabulary.",
      "Mix simple and some complex sentences accurately."
    ]).slice(0, 5);
  }
  if (!normalized.band7UpgradePlan.length) {
    normalized.band7UpgradePlan = cleanStringArray([
      "Make ideas more precise and fully developed.",
      "Use natural cohesion across paragraphs.",
      "Choose more exact collocations.",
      "Reduce grammar errors in complex sentences."
    ]).slice(0, 5);
  }

  normalized.errorAnalysis = normalized.errorAnalysis && typeof normalized.errorAnalysis === "object" ? normalized.errorAnalysis : {};
  if (!hasUsefulText(normalized.errorAnalysis.summary)) {
    normalized.errorAnalysis.summary = cleanStringArray([normalized.mainProblems[0], normalized.mainProblems[1], normalized.mainProblems[2]]).join(" ") || "The response needs more task development, clearer organisation, more precise vocabulary, and more accurate grammar.";
  }
  normalized.errorAnalysis.priorityFixes = cleanStringArray(normalized.errorAnalysis.priorityFixes);
  if (!normalized.errorAnalysis.priorityFixes.length) normalized.errorAnalysis.priorityFixes = cleanStringArray([normalized.taskAchievementAdvice[0], normalized.grammarAdvice[0], normalized.lexicalAdvice[0]]).slice(0, 5);

  normalized.correctionPriority = normalized.correctionPriority && typeof normalized.correctionPriority === "object" ? normalized.correctionPriority : {};
  normalized.correctionPriority.fixFirst = cleanStringArray(normalized.correctionPriority.fixFirst);
  normalized.correctionPriority.fixNext = cleanStringArray(normalized.correctionPriority.fixNext);
  normalized.correctionPriority.polishLater = cleanStringArray(normalized.correctionPriority.polishLater);
  if (!normalized.correctionPriority.fixFirst.length) normalized.correctionPriority.fixFirst = cleanStringArray([task === "Task 1" ? "Task coverage" : "Clear position and idea development", "Sentence accuracy", underMinimum ? "Word count" : "Paragraphing"]).slice(0, 5);
  if (!normalized.correctionPriority.fixNext.length) normalized.correctionPriority.fixNext = cleanStringArray(["Vocabulary precision", "Linking", "Examples and support"]).slice(0, 5);
  if (!normalized.correctionPriority.polishLater.length) normalized.correctionPriority.polishLater = cleanStringArray(["More natural expressions", "More flexible sentence patterns"]).slice(0, 5);

  if (!hasUsefulText(normalized.modelAnswerOutline)) {
    normalized.modelAnswerOutline = task === "Task 1"
      ? "Opening: state the purpose. Body: cover each bullet point in order. Closing: use a suitable final sentence."
      : "Introduction: answer the question. Body 1 and Body 2: develop clear main ideas with support. Conclusion: restate your position.";
  }

  if (task === "Task 1" && normalized.task1LetterCorrections) {
    const points = extractPromptBulletPoints(body?.questionPrompt);
    normalized.task1LetterCorrections.openingComment = hasUsefulText(normalized.task1LetterCorrections.openingComment) ? normalized.task1LetterCorrections.openingComment : "Use an opening that matches the recipient and clearly introduces the purpose.";
    normalized.task1LetterCorrections.closingComment = hasUsefulText(normalized.task1LetterCorrections.closingComment) ? normalized.task1LetterCorrections.closingComment : "Use a suitable closing for the relationship and tone.";
    normalized.task1LetterCorrections.toneComment = hasUsefulText(normalized.task1LetterCorrections.toneComment) ? normalized.task1LetterCorrections.toneComment : "Keep the tone suitable for the recipient.";
    normalized.task1LetterCorrections.purposeComment = hasUsefulText(normalized.task1LetterCorrections.purposeComment) ? normalized.task1LetterCorrections.purposeComment : "Make the purpose clear in the first paragraph.";
    normalized.task1LetterCorrections.bulletPointAdvice = cleanObjectArray(normalized.task1LetterCorrections.bulletPointAdvice, ["bulletPoint", "comment", "suggestedSentence"]);
    if (!normalized.task1LetterCorrections.bulletPointAdvice.length && points.length) {
      normalized.task1LetterCorrections.bulletPointAdvice = points.map((point) => ({ bulletPoint: point, covered: false, comment: "Address this bullet point directly with one clear detail.", suggestedSentence: "Add one sentence that answers this requirement." })).slice(0, 5);
    }
  }

  if (task === "Task 2" && normalized.task2EssayCorrections) {
    normalized.task2EssayCorrections.positionComment = hasUsefulText(normalized.task2EssayCorrections.positionComment) ? normalized.task2EssayCorrections.positionComment : "State a clear position that directly answers the question.";
    normalized.task2EssayCorrections.introductionComment = hasUsefulText(normalized.task2EssayCorrections.introductionComment) ? normalized.task2EssayCorrections.introductionComment : "Introduce the topic and answer the question directly.";
    normalized.task2EssayCorrections.bodyParagraphComment = hasUsefulText(normalized.task2EssayCorrections.bodyParagraphComment) ? normalized.task2EssayCorrections.bodyParagraphComment : "Use one clear main idea in each body paragraph and explain it.";
    normalized.task2EssayCorrections.exampleComment = hasUsefulText(normalized.task2EssayCorrections.exampleComment) ? normalized.task2EssayCorrections.exampleComment : "Add specific examples or explanations to support the main ideas.";
    normalized.task2EssayCorrections.conclusionComment = hasUsefulText(normalized.task2EssayCorrections.conclusionComment) ? normalized.task2EssayCorrections.conclusionComment : "End with a clear summary of your position.";
    normalized.task2EssayCorrections.developmentAdvice = cleanStringArray(normalized.task2EssayCorrections.developmentAdvice);
    if (!normalized.task2EssayCorrections.developmentAdvice.length) normalized.task2EssayCorrections.developmentAdvice = cleanStringArray([normalized.taskAchievementAdvice[0], "Explain why each idea matters.", "Use one example for each main idea."]).slice(0, 5);
  }

  if (!hasUsefulText(normalized.lowBandDiagnostics.reason) && underMinimum) {
    normalized.lowBandDiagnostics.reason = `${task} has ${words} words, below the recommended ${threshold}-word minimum, so task development is limited.`;
  }
  if (!hasUsefulText(normalized.highBandDiagnostics.reason)) {
    normalized.highBandDiagnostics.reason = underMinimum
      ? "High-band evidence is not confirmed because the response is underlength and underdeveloped."
      : "High-band evidence was not fully confirmed in this response.";
  }
}


function backfillChineseHelperNotes(normalized, body) {
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  ensureCriteria(normalized, task);

  const criterionZh = {
    [firstCriterion]: task === "Task 1" ? ["任务回应需要更完整。", "逐条覆盖题目要点。"] : ["观点和展开需要更清楚。", "明确立场并展开理由。"],
    "Coherence and Cohesion": ["结构和衔接需要更清楚。", "分段并自然使用连接词。"],
    "Lexical Resource": ["词汇需要更准确更多样。", "使用更准确的题目词汇。"],
    "Grammatical Range and Accuracy": ["语法准确性和句子控制需提升。", "先写完整准确的句子。"]
  };

  Object.entries(criterionZh).forEach(([name, zh]) => {
    const item = normalized.criteria?.[name];
    if (!item) return;
    if (!hasUsefulText(item.feedbackZh)) item.feedbackZh = zh[0];
    if (!hasUsefulText(item.howToImproveZh)) item.howToImproveZh = zh[1];
  });

  if (!Array.isArray(normalized.strengthsZh) || !normalized.strengthsZh.length) {
    normalized.strengthsZh = ensureArray(normalized.strengths).map((_, i) => i === 0 ? "有尝试回应题目。" : "有一些相关内容。").slice(0, 5);
  }
  if (!Array.isArray(normalized.mainProblemsZh) || !normalized.mainProblemsZh.length) {
    normalized.mainProblemsZh = ensureArray(normalized.mainProblems).map((item) => {
      const text = String(item || "").toLowerCase();
      if (text.includes("word")) return "字数不足会影响展开。";
      if (text.includes("grammar")) return "语法错误影响清晰度。";
      if (text.includes("vocabulary")) return "词汇准确性需要提升。";
      if (text.includes("organisation") || text.includes("link")) return "结构和衔接需要加强。";
      return "这个问题会影响写作分数。";
    }).slice(0, 5);
  }

  normalized.errorAnalysis = normalized.errorAnalysis && typeof normalized.errorAnalysis === "object" ? normalized.errorAnalysis : {};
  if (!hasUsefulText(normalized.errorAnalysis.summaryZh) && hasUsefulText(normalized.errorAnalysis.summary)) {
    normalized.errorAnalysis.summaryZh = "主要问题集中在任务回应、结构、词汇或语法。";
  }
  if (!Array.isArray(normalized.errorAnalysis.priorityFixesZh) || !normalized.errorAnalysis.priorityFixesZh.length) {
    normalized.errorAnalysis.priorityFixesZh = ensureArray(normalized.errorAnalysis.priorityFixes).map((_, i) => ["先修任务回应。", "再修句子准确性。", "最后提升词汇和衔接。"][i] || "按优先级逐步修改。").slice(0, 5);
  }

  normalized.scoreCalibrationZh = normalized.scoreCalibrationZh && typeof normalized.scoreCalibrationZh === "object" ? normalized.scoreCalibrationZh : {};
  if (!hasUsefulText(normalized.scoreCalibrationZh.capReasonZh) && hasUsefulText(normalized.scoreCalibration?.capReason)) normalized.scoreCalibrationZh.capReasonZh = "存在明确限分原因。";
  if (!hasUsefulText(normalized.scoreCalibrationZh.whyNotHigherZh) && hasUsefulText(normalized.scoreCalibration?.whyNotHigher)) normalized.scoreCalibrationZh.whyNotHigherZh = "还不能更高，主要因为内容、结构或语言控制不足。";
  if (!hasUsefulText(normalized.scoreCalibrationZh.whyNotLowerZh) && hasUsefulText(normalized.scoreCalibration?.whyNotLower)) normalized.scoreCalibrationZh.whyNotLowerZh = "没有更低，是因为仍有一定可评分内容。";
  if (!Array.isArray(normalized.scoreCalibrationZh.evidenceZh) || !normalized.scoreCalibrationZh.evidenceZh.length) {
    normalized.scoreCalibrationZh.evidenceZh = ensureArray(normalized.scoreCalibration?.evidence).map(() => "这是评分依据之一。").slice(0, 5);
  }

  normalized.lowBandDiagnosticsZh = normalized.lowBandDiagnosticsZh && typeof normalized.lowBandDiagnosticsZh === "object" ? normalized.lowBandDiagnosticsZh : {};
  if (!hasUsefulText(normalized.lowBandDiagnosticsZh.reasonZh) && hasUsefulText(normalized.lowBandDiagnostics?.reason)) normalized.lowBandDiagnosticsZh.reasonZh = "低分原因与字数、任务回应或语言清晰度有关。";

  normalized.highBandDiagnosticsZh = normalized.highBandDiagnosticsZh && typeof normalized.highBandDiagnosticsZh === "object" ? normalized.highBandDiagnosticsZh : {};
  if (!hasUsefulText(normalized.highBandDiagnosticsZh.reasonZh) && hasUsefulText(normalized.highBandDiagnostics?.reason)) normalized.highBandDiagnosticsZh.reasonZh = "高分证据尚不充分。";

  normalized.taskRequirementAnalysisZh = normalized.taskRequirementAnalysisZh && typeof normalized.taskRequirementAnalysisZh === "object" ? normalized.taskRequirementAnalysisZh : {};
  if (!hasUsefulText(normalized.taskRequirementAnalysisZh.taskMatchSummaryZh) && hasUsefulText(normalized.taskRequirementAnalysis?.taskMatchSummary)) normalized.taskRequirementAnalysisZh.taskMatchSummaryZh = "这里解释作文是否回应了题目。";
  if (!hasUsefulText(normalized.taskRequirementAnalysisZh.taskPurposeZh) && hasUsefulText(normalized.taskRequirementAnalysis?.taskPurpose)) normalized.taskRequirementAnalysisZh.taskPurposeZh = "这里说明题目的写作目的。";

  normalized.correctionPriority = normalized.correctionPriority && typeof normalized.correctionPriority === "object" ? normalized.correctionPriority : {};
  if (!Array.isArray(normalized.correctionPriority.fixFirstZh) || !normalized.correctionPriority.fixFirstZh.length) {
    normalized.correctionPriority.fixFirstZh = ensureArray(normalized.correctionPriority.fixFirst).map((_, i) => ["先改最影响分数的问题。", "先保证句子准确。", "先补充任务内容。"][i] || "先解决这个问题。").slice(0, 5);
  }
  if (!Array.isArray(normalized.correctionPriority.fixNextZh) || !normalized.correctionPriority.fixNextZh.length) {
    normalized.correctionPriority.fixNextZh = ensureArray(normalized.correctionPriority.fixNext).map(() => "下一步再提升这个方面。").slice(0, 5);
  }
  if (!Array.isArray(normalized.correctionPriority.polishLaterZh) || !normalized.correctionPriority.polishLaterZh.length) {
    normalized.correctionPriority.polishLaterZh = ensureArray(normalized.correctionPriority.polishLater).map(() => "最后再优化表达自然度。").slice(0, 5);
  }
}

function hasHardLowBandEvidence(diagnostics, words, task) {
  if (!diagnostics) return false;
  if (diagnostics.isBlank || diagnostics.wordCount20OrFewer || diagnostics.mostlyNonEnglish || diagnostics.mostlyCopiedFromPrompt) return true;
  if (diagnostics.whollyUnrelated || diagnostics.meaningMostlyBlocked) return true;
  if (task === "Task 1" && words < 80) return true;
  if (task === "Task 2" && words < 150) return true;
  return false;
}

function sanitizeLowBandDiagnosticsForTask(modelDiagnostics, localDiagnostics, body) {
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  const threshold = task === "Task 1" ? 150 : 250;
  const model = modelDiagnostics && typeof modelDiagnostics === "object" ? modelDiagnostics : {};
  const local = localDiagnostics && typeof localDiagnostics === "object" ? localDiagnostics : {};
  const normalLength = words >= threshold;
  const hardLocal = hasHardLowBandEvidence(local, words, task);
  const hardModel = Boolean(model.isBlank || model.wordCount20OrFewer || model.mostlyNonEnglish || model.mostlyCopiedFromPrompt || model.whollyUnrelated || model.meaningMostlyBlocked);
  const allowModelLow = hardLocal || hardModel || !normalLength;

  const sanitized = {
    isBlank: Boolean(local.isBlank || model.isBlank),
    wordCount20OrFewer: Boolean(local.wordCount20OrFewer || model.wordCount20OrFewer),
    mostlyNonEnglish: Boolean(local.mostlyNonEnglish || model.mostlyNonEnglish),
    mostlyCopiedFromPrompt: Boolean(local.mostlyCopiedFromPrompt || model.mostlyCopiedFromPrompt),
    mostlyMemorised: Boolean(allowModelLow && model.mostlyMemorised),
    whollyUnrelated: Boolean(allowModelLow && model.whollyUnrelated),
    barelyRelated: Boolean(allowModelLow && model.barelyRelated),
    littleRelevantMessage: Boolean((allowModelLow && model.littleRelevantMessage) || local.littleRelevantMessage),
    noClearPositionTask2: task === "Task 2" ? Boolean(model.noClearPositionTask2 || local.noClearPositionTask2) : false,
    noBulletPointCoverageTask1: task === "Task 1" ? Boolean(model.noBulletPointCoverageTask1 || local.noBulletPointCoverageTask1) : false,
    meaningMostlyBlocked: Boolean(local.meaningMostlyBlocked || (allowModelLow && model.meaningMostlyBlocked)),
    recommendedLowBandRange: allowModelLow ? (model.recommendedLowBandRange || local.recommendedLowBandRange || "") : "",
    reason: allowModelLow ? (model.reason || local.reason || "") : "No low-band trigger detected."
  };

  if (normalLength && !hasHardLowBandEvidence(sanitized, words, task) && !sanitized.whollyUnrelated && !sanitized.barelyRelated) {
    sanitized.littleRelevantMessage = false;
    sanitized.recommendedLowBandRange = "";
    sanitized.reason = "No low-band trigger detected.";
  }
  return sanitized;
}

function alignHighBandDiagnostics(result, body) {
  const high = result.highBandDiagnostics || {};
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  const meetsMinimum = task === "Task 1" ? words >= 150 : words >= 250;
  const noCap = !result.scoreCalibration?.capApplied;
  const taskMatch = result.taskMatchCheck?.appearsToAnswerSelectedPrompt !== false;
  const range = String(high.recommendedHighBandRange || "");
  const recommendsHigh = /8|9/.test(range);
  const highEvidence = Boolean(
    recommendsHigh &&
    high.fullyAddressesTask &&
    high.clearProgression &&
    high.wellDevelopedIdeas &&
    high.wideAccurateVocabulary &&
    high.flexibleGrammar &&
    high.fewErrors &&
    meetsMinimum &&
    noCap &&
    taskMatch
  );

  if (!highEvidence) return;
  if (Number(result.overallBand) < 8) {
    result.overallBand = 8;
    result.estimatedLevel = "Band 8.0";
    result.scoreCalibration = {
      ...(result.scoreCalibration || {}),
      capApplied: false,
      capReason: "",
      whyNotHigher: result.scoreCalibration?.whyNotHigher || "Band 9 is not awarded because the response may still have minor limitations in naturalness, precision, or control.",
      whyNotLower: "High-band diagnostics show the response fully addresses the task with clear progression, accurate flexible language, and only minor errors.",
      evidence: ensureArray(result.scoreCalibration?.evidence).concat(["High-band diagnostics support Band 8+."]).slice(0, 5)
    };
  }
}

function applyStrictCaps(result, body, diagnostics) {
  const cap = capFromDiagnostics(body, diagnostics);
  const firstCriterion = firstCriterionName(body.task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const initialOverall = roundHalf(result.overallBand ?? 0);
  let overall = initialOverall;
  let capApplied = false;
  let capReason = "";

  if (cap.cap !== null) {
    overall = Math.min(overall, cap.cap);
    capApplied = initialOverall > cap.cap || cap.firstCap !== null;
    capReason = cap.reason;
    if (result.criteria?.[firstCriterion]) {
      const firstBand = roundHalf(result.criteria[firstCriterion].band ?? overall);
      result.criteria[firstCriterion].band = Math.min(firstBand, cap.firstCap ?? cap.cap);
    }
  }

  const criterionBands = Object.values(result.criteria || {}).map((item) => roundHalf(item?.band ?? overall));
  const lowCriteria = criterionBands.filter((band) => band <= 5).length;
  if (lowCriteria >= 2 && overall >= 6) {
    overall = 5.5;
    capApplied = true;
    capReason = capReason || "Two or more criteria are 5.0 or below, so 6.0+ is not justified.";
  }
  if ((body.task === "Task 1" && words <= 80) || (body.task === "Task 2" && words <= 150)) {
    if (overall >= 5.5) {
      overall = body.task === "Task 1" ? 4 : 4;
      capApplied = true;
      capReason = capReason || "The response is far below the word count needed for Band 5.5+.";
    }
  }
  if (diagnostics.littleRelevantMessage && overall >= 5.5) {
    overall = 4;
    capApplied = true;
    capReason = capReason || "There is too little relevant message for Band 5.5+.";
  }
  if (diagnostics.meaningMostlyBlocked && overall >= 4) {
    overall = Math.min(overall, 3);
    capApplied = true;
    capReason = capReason || "Meaning is mostly blocked, so Band 4+ is not justified.";
  }

  overall = roundHalf(overall);
  result.overallBand = overall;
  result.estimatedLevel = `Band ${formatBand(overall)}`;

  const existingCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object" ? result.scoreCalibration : {};
  result.scoreCalibration = {
    strictness: "strict",
    capApplied: Boolean(capApplied || diagnostics.recommendedLowBandRange),
    capReason: capApplied || diagnostics.recommendedLowBandRange ? (capReason || diagnostics.reason || "") : "",
    whyNotHigher: existingCalibration.whyNotHigher || "The score is limited by task coverage, word count, organisation, vocabulary, or grammar evidence.",
    whyNotLower: existingCalibration.whyNotLower || "Some rateable response is present unless Band 0 has been applied.",
    evidence: ensureArray(existingCalibration.evidence).concat([
      `Word count: ${words}.`,
      diagnostics.reason,
      capReason
    ].filter(Boolean)).slice(0, 5)
  };

  if (overall === 0) {
    Object.values(result.criteria).forEach((item) => { item.band = 0; });
  }
}

function normalizeResultForMode(result, mode, veryShort, body, locale = "en") {
  const normalized = result && typeof result === "object" ? result : {};
  const words = Number(body?.wordCount) || countWordsServer(body?.essay);
  const taskTypeDetected = body?.task === "Task 1" ? "task1" : "task2";
  normalized.actualWordCount = words;
  normalized.taskTypeDetected = taskTypeDetected;
  normalized.wordCountThresholdUsed = taskTypeDetected === "task1" ? 150 : 250;
  normalized.wordCountStatus = taskTypeDetected === "task1"
    ? (words >= 150 ? "meets_task1_minimum" : (words < 80 ? "very_short_task1" : "under_task1_minimum"))
    : (words >= 250 ? "meets_task2_minimum" : (words < 150 ? "very_short_task2" : "under_task2_minimum"));
  const diagnostics = buildLowBandDiagnostics(body || {});
  const modelDiagnostics = normalized.lowBandDiagnostics && typeof normalized.lowBandDiagnostics === "object" ? normalized.lowBandDiagnostics : {};
  normalized.lowBandDiagnostics = sanitizeLowBandDiagnosticsForTask(modelDiagnostics, diagnostics, body || {});
  ensureCriteria(normalized, body?.task);
  normalized.disclaimer = normalized.disclaimer || DISCLAIMER;
  normalized.scoreCalibrationZh = normalized.scoreCalibrationZh && typeof normalized.scoreCalibrationZh === "object" ? normalized.scoreCalibrationZh : {};
  normalized.lowBandDiagnosticsZh = normalized.lowBandDiagnosticsZh && typeof normalized.lowBandDiagnosticsZh === "object" ? normalized.lowBandDiagnosticsZh : {};
  normalized.highBandDiagnosticsZh = normalized.highBandDiagnosticsZh && typeof normalized.highBandDiagnosticsZh === "object" ? normalized.highBandDiagnosticsZh : {};
  normalized.taskRequirementAnalysisZh = normalized.taskRequirementAnalysisZh && typeof normalized.taskRequirementAnalysisZh === "object" ? normalized.taskRequirementAnalysisZh : {};
  normalized.strengths = ensureArray(normalized.strengths).slice(0, 5);
  normalized.strengthsZh = ensureArray(normalized.strengthsZh).slice(0, 5);
  normalized.mainProblems = ensureArray(normalized.mainProblems).slice(0, 5);
  normalized.mainProblemsZh = ensureArray(normalized.mainProblemsZh).slice(0, 5);
  const correctionLimit = correctionLimitForEssay(body || {}, mode);
  const cleanedNormalizedCorrections = sanitizeAiCorrectionPayload(normalized);
  normalized.spellingCorrections = ensureArray(cleanedNormalizedCorrections.spellingCorrections).slice(0, correctionLimit);
  normalized.grammarErrors = ensureArray(cleanedNormalizedCorrections.grammarErrors).slice(0, correctionLimit);
  normalized.sentenceCorrections = ensureArray(cleanedNormalizedCorrections.sentenceCorrections).slice(0, correctionLimit);
  normalized.errorAnalysis = normalized.errorAnalysis && typeof normalized.errorAnalysis === "object" ? normalized.errorAnalysis : { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] };
  normalized.errorAnalysis.errorPatterns = ensureArray(normalized.errorAnalysis.errorPatterns).slice(0, 24);
  normalized.errorAnalysis.priorityFixes = ensureArray(normalized.errorAnalysis.priorityFixes).slice(0, 16);
  normalized.errorAnalysis.priorityFixesZh = ensureArray(normalized.errorAnalysis.priorityFixesZh).slice(0, 16);
  normalized.detailedSentenceCorrections = ensureArray(cleanedNormalizedCorrections.detailedSentenceCorrections).slice(0, correctionLimit);
  normalized.task1LetterCorrections = body?.task === "Task 1"
    ? (normalized.task1LetterCorrections && typeof normalized.task1LetterCorrections === "object" ? normalized.task1LetterCorrections : { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] })
    : null;
  normalized.task2EssayCorrections = body?.task === "Task 2"
    ? (normalized.task2EssayCorrections && typeof normalized.task2EssayCorrections === "object" ? normalized.task2EssayCorrections : { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] })
    : null;
  normalized.correctionPriority = normalized.correctionPriority && typeof normalized.correctionPriority === "object" ? normalized.correctionPriority : { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] };
  normalized.correctionPriority.fixFirst = ensureArray(normalized.correctionPriority.fixFirst).slice(0, 5);
  normalized.correctionPriority.fixNext = ensureArray(normalized.correctionPriority.fixNext).slice(0, 5);
  normalized.correctionPriority.polishLater = ensureArray(normalized.correctionPriority.polishLater).slice(0, 5);
  normalized.correctionPriority.fixFirstZh = ensureArray(normalized.correctionPriority.fixFirstZh).slice(0, 5);
  normalized.correctionPriority.fixNextZh = ensureArray(normalized.correctionPriority.fixNextZh).slice(0, 5);
  normalized.correctionPriority.polishLaterZh = ensureArray(normalized.correctionPriority.polishLaterZh).slice(0, 5);
  normalized.taskAchievementAdvice = ensureArray(normalized.taskAchievementAdvice).slice(0, 5);
  normalized.coherenceAdvice = ensureArray(normalized.coherenceAdvice).slice(0, 5);
  normalized.lexicalAdvice = ensureArray(normalized.lexicalAdvice).slice(0, 5);
  normalized.grammarAdvice = ensureArray(normalized.grammarAdvice).slice(0, 5);
  normalized.band5FixPlan = ensureArray(normalized.band5FixPlan).slice(0, 5);
  normalized.band6UpgradePlan = ensureArray(normalized.band6UpgradePlan).slice(0, 5);
  normalized.band7UpgradePlan = ensureArray(normalized.band7UpgradePlan).slice(0, 5);
  normalized.revisionNotes = ensureArray(normalized.revisionNotes).slice(0, 5);
  normalized.revisionNotesZh = normalized.revisionNotesZh || [];
  normalized.revisionNotesZh = ensureArray(normalized.revisionNotesZh).slice(0, 5);
  normalized.taskRequirementAnalysis = normalized.taskRequirementAnalysis && typeof normalized.taskRequirementAnalysis === "object"
    ? normalized.taskRequirementAnalysis
    : (body?.task === "Task 1"
      ? { taskType: "task1", taskPurpose: "Write a General Training Task 1 letter that answers the selected prompt.", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "The selected prompt was provided to the grader." }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "The selected prompt was provided to the grader." });
  normalized.taskMatchCheck = normalized.taskMatchCheck && typeof normalized.taskMatchCheck === "object"
    ? normalized.taskMatchCheck
    : { appearsToAnswerSelectedPrompt: true, reason: "No task mismatch was detected.", warning: "" };
  normalized.highBandDiagnostics = normalized.highBandDiagnostics && typeof normalized.highBandDiagnostics === "object"
    ? normalized.highBandDiagnostics
    : { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: body?.task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: "" };
  normalized.revisedEssayMeta = {
    ...defaultRevisedEssayMeta(false),
    ...(normalized.revisedEssayMeta && typeof normalized.revisedEssayMeta === "object" ? normalized.revisedEssayMeta : {})
  };

  normalizeAiBandsOnly(normalized, body || {});

  if (mode !== "revision") {
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

  const explicitLowBandTrigger = Boolean(
    normalized.lowBandDiagnostics.isBlank ||
    normalized.lowBandDiagnostics.wordCount20OrFewer ||
    normalized.lowBandDiagnostics.mostlyNonEnglish ||
    normalized.lowBandDiagnostics.mostlyCopiedFromPrompt ||
    normalized.lowBandDiagnostics.whollyUnrelated ||
    normalized.lowBandDiagnostics.barelyRelated ||
    normalized.lowBandDiagnostics.littleRelevantMessage ||
    normalized.lowBandDiagnostics.meaningMostlyBlocked
  );
  const taskMismatch = normalized.taskMatchCheck?.appearsToAnswerSelectedPrompt === false;
  const lowOrLimited = veryShort || explicitLowBandTrigger || taskMismatch;
  if (lowOrLimited && mode !== "revision") {
    normalized.revisedEssayBand6 = "";
    normalized.revisedEssayBand7 = "";
    normalized.revisedEssayMeta = defaultRevisedEssayMeta(true, "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions.");
    if (!normalized.revisionNotes.some((note) => /too short|too limited|Band 6/i.test(note))) {
      normalized.revisionNotes.unshift("The original response is too short or too limited for meaningful Band 6 or Band 7 revision. Add more content first.");
    }
    if (!normalized.revisionNotesZh.some((note) => note.includes("原文太短") || note.includes("内容太少"))) {
      normalized.revisionNotesZh.unshift("原文太短或内容太少，不适合直接生成 Band 6 / Band 7 修改版。");
    }
  }
  if (normalized.overallBand === 0) {
    normalized.revisedEssayBand5 = "";
    normalized.revisedEssayBand6 = "";
    normalized.revisedEssayBand7 = "";
  }


  backfillDiagnosticAdvice(normalized, body || {}, mode, veryShort);
  backfillChineseHelperNotes(normalized, body || {});

  normalized.scoringCalibration = normalized.scoreCalibration;
  normalized.lowBandEvidence = normalized.lowBandDiagnostics;
  normalized.highBandEvidence = normalized.highBandDiagnostics;
  normalized.overallEstimatedBand = normalized.overallBand;
  normalized.revisedEssay = normalized.revisedEssayBand7 || normalized.revisedEssayBand6 || normalized.revisedEssayBand5 || "";
  normalized.feedback = ensureArray(normalized.mainProblems).join(" ") || normalized.scoreCalibration?.whyNotHigher || "Feedback is available in the sections below.";

  return localizeResultForOutput(normalized, locale);
}

async function handleRequest(req, res) {
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

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, 400, { error: "Invalid JSON request body.", detail: error.message });
    return;
  }

  const locale = normalizeLocale(body.outputLanguage || body.locale || body.language);

  if (!body.questionPrompt || !String(body.questionPrompt).trim()) {
    sendJson(req, res, 400, { error: "questionPrompt is required." });
    return;
  }

  body.essay = String(body.essay || "");
  body.task = body.task === "Task 1" ? "Task 1" : "Task 2";
  body.wordCount = countWordsServer(body.essay);
  body.targetWordCount = body.task === "Task 1" ? 150 : 250;
  body.isUnderMinimum = body.wordCount < body.targetWordCount;

  const localDiagnostics = buildLowBandDiagnostics(body);
  // AI-only scoring: even blank, very short, under-minimum, copied, or mostly non-English submissions go to DeepSeek.
  // The server may pass factual context, but DeepSeek must be the only scorer.


  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(req, res, 500, {
      error: "Provider API key is not configured.",
      provider: "deepseek"
    });
    return;
  }

  const mode = normalizeMode(body.mode);
  const veryShort = isVeryShortEssay(body);
  const effectiveMode = mode;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const maxTokens = maxTokensForMode(effectiveMode, veryShort);
  const deadline = Date.now() + AI_TOTAL_REQUEST_TIMEOUT_MS;

  const aiStage = normalizeAiStage(body.aiStage || body.stage || body.gradingStage);
  const cacheKey = buildAiCacheKey(body, `${effectiveMode}:${aiStage}`, model, locale);
  const cachedResult = getCachedAiResult(cacheKey);
  if (cachedResult) {
    sendJson(req, res, 200, { ...cachedResult, cacheHit: true });
    return;
  }

  try {
    let result;
    if (aiStage === "score") {
      result = await callAiScoreOnlyGrader({
        apiKey,
        model,
        body,
        effectiveMode,
        veryShort,
        maxTokens: maxTokensForMode("full", veryShort),
        locale,
        deadline
      });
      result.aiStage = "score";
      result = normalizeResultForMode(result, "full", veryShort, body, locale);
    } else if (aiStage.startsWith("correction-")) {
      const section = aiStage.slice("correction-".length);
      result = await callAiFocusedSectionStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        section,
        locale,
        deadline
      });
      result.aiStage = aiStage;
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "correction") {
      result = await callAiCorrectionStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        locale,
        deadline
      });
      result.aiStage = "correction";
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "revision") {
      result = await callAiRevisionStageOnly({
        apiKey,
        model,
        body,
        effectiveMode,
        veryShort,
        maxTokens,
        locale,
        deadline
      });
      result.aiStage = "revision";
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else {
      result = await callAiOnlyGrader({
        apiKey,
        model,
        body,
        effectiveMode,
        veryShort,
        maxTokens,
        locale,
        deadline
      });
      result = normalizeResultForMode(result, effectiveMode, veryShort, body, locale);
    }

    setCachedAiResult(cacheKey, result);
    sendJson(req, res, 200, result);
  } catch (error) {
    if (sendProviderError(req, res, error)) return;

    sendJson(req, res, 502, {
      error: "AI grading failed. No local score was generated.",
      provider: "deepseek",
      detail: error.message || error.name || "DeepSeek did not return valid JSON after AI-only repair attempts."
    });
  }
}

module.exports = async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(req, res, 500, {
      error: "Server error while grading IELTS writing.",
      provider: "deepseek",
      detail: error?.message || String(error),
      suggestion: "Please retry later or check Vercel runtime logs."
    });
  }
};

module.exports.config = {
  maxDuration: 300
};
