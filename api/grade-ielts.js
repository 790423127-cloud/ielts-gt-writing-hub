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
  Math.min(Number(process.env.AI_SINGLE_REQUEST_TIMEOUT_MS || process.env.AI_REQUEST_TIMEOUT_MS) || 230000, 240000)
);
const AI_TOTAL_REQUEST_TIMEOUT_MS = Math.max(
  120000,
  Math.min(Number(process.env.AI_TOTAL_REQUEST_TIMEOUT_MS) || 285000, 290000)
);

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

const AI_RESPONSE_SAFETY_BUFFER_MS = Math.max(
  6000,
  Math.min(Number(process.env.AI_RESPONSE_SAFETY_BUFFER_MS) || 14000, 30000)
);

function hasEnoughAiTime(deadline, requiredMs) {
  return remainingAiTime(deadline) > Math.max(1000, Number(requiredMs) || 0) + AI_RESPONSE_SAFETY_BUFFER_MS;
}

function safePassTimeout(deadline, preferredMs, fallbackMs = 45000) {
  const preferred = Math.max(1000, Number(preferredMs) || fallbackMs);
  const remaining = remainingAiTime(deadline) - AI_RESPONSE_SAFETY_BUFFER_MS;
  return Math.max(1000, Math.min(preferred, AI_SINGLE_REQUEST_TIMEOUT_MS, remaining));
}

function markAiPassDeferred(output, message) {
  const target = output && typeof output === "object" ? output : {};
  target.correctionWarning = target.correctionWarning || message;
  target.correctionPassWarning = target.correctionPassWarning || message;
  target.stageWarnings = ensureArray(target.stageWarnings).concat([message]);
  return target;
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


function sendProviderError(req, res, error, fallbackStatusCode = 502) {
  if (res.headersSent) return true;

  const rawStatus = Number(error?.statusCode || error?.status || error?.response?.status || fallbackStatusCode);
  const statusCode = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : fallbackStatusCode;

  const detail = error?.message || error?.name || String(error || "Unknown DeepSeek provider error");
  const payload = {
    ok: false,
    error: "AI grading failed. No non-AI score was generated.",
    provider: DEFAULT_PROVIDER,
    suggestion: "Please retry later or check Vercel runtime logs.",
    detail: String(detail)
  };

  if (error?.code) payload.code = String(error.code);
  if (error?.aiStage) payload.aiStage = String(error.aiStage);

  sendJson(req, res, statusCode, payload);
  return true;
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
  // AI-only scoring guard: keep the model's criterion judgement, but enforce the app's 1-9 visible range.
  // The final displayed overallBand is recalculated later from the four task-specific criteria.
  const fallbackBand = 1;
  result.rawOverallBand = Number.isFinite(Number(result.overallBand)) ? clampAiBand(result.overallBand, fallbackBand) : undefined;
  result.overallBand = clampAiBand(result.overallBand, fallbackBand);
  result.estimatedLevel = `Band ${formatBand(result.overallBand)}`;

  ensureCriteria(result, body?.task);
  normalizeTaskSpecificCriteria(result, body?.task === "Task 1" ? "Task 1" : "Task 2");
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


// --- IELTS task-specific scoring engines ---
function getWritingCriterionNames(task) {
  const first = task === "Task 1" ? "Task Achievement" : "Task Response";
  return [first, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function getTaskScoringEngineName(task) {
  return task === "Task 1" ? "task1_gt_letter_practice_engine" : "task2_essay_practice_engine";
}

function buildTaskSpecificScoringRubric(task) {
  if (task === "Task 1") {
    return [
      "Task-specific scoring engine: IELTS General Training Writing Task 1 letter.",
      "Use Task Achievement as the first criterion, not Task Response.",
      "Task Achievement must assess: clear letter purpose, coverage of all prompt bullet points, development of each bullet point, recipient relationship, formal/semi-formal/informal tone, opening/closing, letter format, relevance, and word-count impact.",
      "For Task 1, differentiate criterion bands: a letter may mention all bullet points but still have weaker vocabulary or grammar. Do not let Task Achievement automatically raise Coherence, Lexical Resource, or Grammar.",
      "Do not assess Task 1 as an essay. Do not require thesis statement, argument, counterargument, essay conclusion, or a clear opinion position unless the prompt itself asks for an opinion in a letter context.",
      "Coherence and Cohesion for Task 1 must assess letter organisation, paragraphing by purpose/bullet point, logical ordering of request/explanation/thanks/apology/invitation details, natural linking, and referencing.",
      "Lexical Resource for Task 1 must assess letter-function vocabulary, register, precision, collocation, spelling, word formation, and whether the wording fits the recipient relationship.",
      "Grammatical Range and Accuracy for Task 1 must assess sentence control for requests, explanations, reasons, conditions, polite forms, tense, articles, plurals, punctuation, and whether errors reduce the reader's understanding."
    ].join("\n");
  }
  return [
    "Task-specific scoring engine: IELTS Writing Task 2 essay.",
    "Use Task Response as the first criterion, not Task Achievement.",
    "Task Response must assess: whether all parts of the question are answered, whether a clear position is present when required, relevance of main ideas, depth of development, reasoning, examples, conclusion, and whether the response matches the question type.",
    "Task Response must be capped conservatively when the essay is short, only lists ideas, lacks clear examples, fails to answer both sides/parts of the question, has no clear position where required, or has a conclusion that does not reflect the argument.",
    "For Task 2, differentiate criterion bands: a response may answer the task better than it controls grammar, or have basic organisation but weaker vocabulary. Do not assign all four bands the same value unless the evidence is genuinely equal across all four criteria.",
    "Do not assess Task 2 as a letter. Do not use recipient relationship, letter opening/closing, formal letter tone, or bullet-point coverage as Task Response evidence.",
    "Coherence and Cohesion for Task 2 must assess introduction/body/conclusion organisation, clear paragraph central ideas, progression of argument, logical sequencing, cohesive devices, referencing, and paragraph unity.",
    "Lexical Resource for Task 2 must assess topic vocabulary, abstract/general academic wording, precision, collocation, repetition, spelling, word formation, and whether vocabulary expresses argument clearly.",
    "Grammatical Range and Accuracy for Task 2 must assess sentence variety used for argument, clauses, concession, comparison, cause/effect, accuracy, punctuation, error density, and whether errors weaken the argument."
  ].join("\n");
}

function normalizeCriterionBandValue(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return clampAiBand(fallback, 1);
  return clampAiBand(numeric, fallback);
}

function defaultCriterionForName(name, fallbackBand = 1) {
  return {
    band: normalizeCriterionBandValue(fallbackBand, 1),
    feedback: "",
    feedbackZh: "",
    howToImprove: "",
    howToImproveZh: "",
    evidence: [],
    evidenceZh: [],
    positiveEvidence: [],
    positiveEvidenceZh: [],
    limitingEvidence: [],
    limitingEvidenceZh: [],
    whyThisBand: "",
    whyThisBandZh: "",
    whyNotHigher: "",
    whyNotHigherZh: "",
    whyNotLower: "",
    whyNotLowerZh: "",
    evidenceQuotes: [],
    evidenceQuotesZh: []
  };
}

function normalizeTaskSpecificCriteria(result, task) {
  if (!result || typeof result !== "object") return result;
  const normalizedTask = task === "Task 1" ? "Task 1" : "Task 2";
  const wanted = getWritingCriterionNames(normalizedTask);
  const wrongFirst = normalizedTask === "Task 1" ? "Task Response" : "Task Achievement";
  const criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  const fallbackBand = normalizeCriterionBandValue(result.overallBand, 1);
  const fixed = {};

  wanted.forEach((name) => {
    const source = criteria[name] || (name === wanted[0] ? criteria[wrongFirst] : null) || {};
    fixed[name] = {
      ...defaultCriterionForName(name, source.band ?? fallbackBand),
      ...(source && typeof source === "object" ? source : {}),
      band: normalizeCriterionBandValue(source.band, fallbackBand),
      evidence: ensureArray(source.evidence).filter(Boolean).slice(0, 6),
      evidenceZh: ensureArray(source.evidenceZh).filter(Boolean).slice(0, 6),
      positiveEvidence: ensureArray(source.positiveEvidence).filter(Boolean).slice(0, 4),
      positiveEvidenceZh: ensureArray(source.positiveEvidenceZh).filter(Boolean).slice(0, 4),
      limitingEvidence: ensureArray(source.limitingEvidence).filter(Boolean).slice(0, 4),
      limitingEvidenceZh: ensureArray(source.limitingEvidenceZh).filter(Boolean).slice(0, 4),
      whyThisBand: source.whyThisBand || source.bandJustification || "",
      whyThisBandZh: source.whyThisBandZh || source.bandJustificationZh || "",
      whyNotHigher: source.whyNotHigher || "",
      whyNotHigherZh: source.whyNotHigherZh || "",
      whyNotLower: source.whyNotLower || "",
      whyNotLowerZh: source.whyNotLowerZh || "",
      evidenceQuotes: ensureArray(source.evidenceQuotes).filter(Boolean).slice(0, 3),
      evidenceQuotesZh: ensureArray(source.evidenceQuotesZh).filter(Boolean).slice(0, 3)
    };
  });

  result.criteria = fixed;
  return result;
}

function getCriterionBandsForTask(result, task) {
  normalizeTaskSpecificCriteria(result, task);
  return getWritingCriterionNames(task)
    .map((name) => Number(result?.criteria?.[name]?.band))
    .filter(Number.isFinite)
    .map((band) => clampAiBand(band, 1));
}

function calculateTaskBandFromCriteria(result, task) {
  const bands = getCriterionBandsForTask(result, task);
  if (bands.length !== 4) return clampAiBand(result?.overallBand, 1);
  const avg = bands.reduce((sum, band) => sum + band, 0) / 4;
  return roundHalf(avg);
}

function calculateMockWritingBand(task1Band, task2Band) {
  const t1 = clampAiBand(task1Band, 1);
  const t2 = clampAiBand(task2Band, 1);
  return roundHalf((t1 + (t2 * 2)) / 3);
}

function buildScoreCalculation(result, task, finalBand) {
  const names = getWritingCriterionNames(task);
  const criteriaBands = names.map((name) => ({
    criterion: name,
    band: normalizeCriterionBandValue(result?.criteria?.[name]?.band, result?.overallBand || 1)
  }));
  const rawAverage = criteriaBands.reduce((sum, item) => sum + Number(item.band || 0), 0) / 4;
  return {
    mode: getTaskScoringEngineName(task),
    method: "task_specific_four_criteria_average",
    formula: "four IELTS criteria average rounded to nearest 0.5",
    criteriaBands,
    rawAverage: Number(rawAverage.toFixed(3)),
    finalBand,
    explanation: `${task} is scored with its own IELTS criteria first; the displayed band is calculated from the four criterion bands, not copied from an AI overall impression.`
  };
}


function buildMockWritingScore(task1Result, task2Result) {
  const task1Band = clampAiBand(task1Result?.overallBand ?? task1Result?.overallEstimatedBand, 1);
  const task2Band = clampAiBand(task2Result?.overallBand ?? task2Result?.overallEstimatedBand, 1);
  const finalBand = calculateMockWritingBand(task1Band, task2Band);
  return {
    mockWritingBand: finalBand,
    estimatedLevel: `Band ${formatBand(finalBand)}`,
    task1Band,
    task2Band,
    method: "ielts_mock_writing_weighted_combination",
    formula: "roundToHalf((Task 1 + Task 2 × 2) / 3)",
    rawWeightedAverage: Number(((task1Band + task2Band * 2) / 3).toFixed(3)),
    explanation: "Task 1 and Task 2 are scored separately with task-specific criteria, then combined with Task 2 carrying double weight for the mock Writing estimate."
  };
}


function buildSystemPrompt(veryShort = false, locale = "en") {
  const outputLanguageInstruction = isChineseLocale(locale)
    ? "Output language request: English feedback may include accurate Chinese explanations only in fields ending with Zh. These *Zh fields must closely match the English feedback, not generic templates. Do not translate whole essays."
    : "Output language request: main feedback must be English. Also include accurate Chinese explanations only in fields ending with Zh so the front end can reveal them on demand. The *Zh text must closely explain the adjacent English field, not a vague template. Do not put Chinese inside normal English feedback fields.";
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
    "First assign four criterion bands independently, then estimate overallBand from the criteria, round to nearest 0.5, then apply cap rules. Do not copy overallBand into all four criteria. Identical criterion bands are allowed only when the evidence for all four criteria is genuinely similar; if all four criteria are the same, scoreCalibration.evidence must explain why.",
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
    "For detailedSentenceCorrections, use originalSentence from the user's essay only. correctedSentence is for the direct error fix; betterExpression is for a realistic next-band expression that the learner can imitate.",
    "For every score-impacting detailedSentenceCorrections item below Band 9, betterExpression should be returned whenever a useful +0.5 to +1.0 band upgrade can be shown without losing meaning. For essays scored Band 0-4.5, betterExpression must target Band 5.0-5.5. For Band 5.0+, target the next 0.5-1.0 band range.",
    "Do not make betterExpression unrealistically advanced. A Band 4 essay should receive a clear Band 5.0-5.5 expression, not Band 7-9 language. For every score-impacting sentence below Band 9, return a betterExpression unless doing so would change or remove the meaning. Do not hide useful modest upgrades merely because the sentence structure is similar.",
    "Do not use betterExpression for a pure one-word synonym swap, a truncated sentence, or any rewrite that removes a reason, purpose, condition, contrast, result, or other task-relevant information. The betterExpression must show obvious improvement in structure, formality, clarity, cohesion, or IELTS-level phrasing, not just 1-2 changed words. If there is no useful safe upgrade, leave betterExpression and betterExpressionZh empty.",
    "detailedSentenceCorrections must contain only score-impacting issues. Do not return errorType None, No significant improvement needed, No impact on band score, unchanged original/corrected pairs, or correct salutation/closing items.",
    "If a criterion band is 7.5 or higher, its feedback must describe high-band quality and frame suggestions as minor polishing/refinement. Do not pair Band 8 with Band 5-6 template wording such as 'needs clearer control' or 'grammar needs improvement' unless the band is lowered.",
    "For Band 7.5+ writing, improvement advice must focus on naturalness, specificity, concision, register precision, and consistency. Do not advise forced inversion, artificially complex conditionals, rare vocabulary, 'synergistic opportunities', 'holistic understanding', or flawless/perfect grammar unless there is a concrete reason.",
    "For Band 7.5+ Task 1 letters, improvement advice must be about making the letter more natural, specific, concise, and recipient-appropriate. Do not suggest business buzzwords, rare vocabulary, more formal linking words, inversion, or extra complexity. Suggest concrete benefit, smoother paragraph flow, register precision, and minor punctuation consistency.",
    "For Band 7.5+ Task 2 essays, improvement advice must be about argument nuance, paragraph progression, example quality, topic-specific precision, and grammar that clarifies reasoning. Do not suggest rare words, inflated vocabulary, mechanical linking words, or complexity for its own sake.",
    "Task 2 question-type scoring: agree/disagree requires a clear and consistent position; discuss-both-views requires both views plus the writer's own opinion; advantages/disadvantages requires both sides and, when asked, a clear judgement about which side is stronger; problem/solution requires both problem/cause and solution/measure; two-part questions require both questions to be answered.",
    "Task 2 high-band advice should never focus on simply adding more ideas. It should focus on developing the strongest idea with clearer reasoning, a more precise example, a consequence, or a qualification.",

    "mainProblems must contain only actual problems. Move strengths such as fully addresses, appropriate tone, clear purpose, well-developed, coherent, accurate language, or few errors into strengths instead.",
    "targetImprovementPlan.criterionUpgrades must include currentWeakness, target, action, and exampleUpgrade for each IELTS criterion. Each action should help improve about 0.5-1 band from the current level.",
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
    "Provide accurate Chinese explanations in *Zh fields only. Each *Zh field must directly match the adjacent English feedback, correction reason, band impact, or advice. Do not use generic phrases such as “更完整地回应题目” unless that is exactly the issue. Do not translate the full essay, original sentences, corrected sentences, model answers, or revised essays.",
    "For taskRequirementAnalysisZh, scoreCalibrationZh, lowBandDiagnosticsZh, highBandDiagnosticsZh, strengthsZh, and mainProblemsZh, write short Chinese explanations of the feedback only.",
    "For advice arrays and task-specific correction fields, provide matching short *Zh helper fields when possible, but never translate complete essay text or revised essay text.",
    "Keep Chinese explanations concise but specific. They must be accurate enough for a Chinese learner to understand the exact IELTS problem and action. Do not let Chinese explanations replace the English feedback.",
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
    wordCountWarning: { message: "", messageZh: "" },
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
        bandImpactZh: emptyForLocaleZh("", locale),
        scoreImpacting: true,
        whyThisAffectsBand: "...",
        targetBandExpression: "..."
      }
    ],
    task1LetterCorrections: task === "Task 1" ? {
      openingComment: "",
      openingCommentZh: emptyForLocaleZh("", locale),
      closingComment: "",
      closingCommentZh: emptyForLocaleZh("", locale),
      toneComment: "",
      toneCommentZh: emptyForLocaleZh("", locale),
      purposeComment: "",
      purposeCommentZh: emptyForLocaleZh("", locale),
      bulletPointAdvice: []
    } : null,
    task2EssayCorrections: task === "Task 2" ? {
      positionComment: "",
      positionCommentZh: emptyForLocaleZh("", locale),
      introductionComment: "",
      introductionCommentZh: emptyForLocaleZh("", locale),
      bodyParagraphComment: "",
      bodyParagraphCommentZh: emptyForLocaleZh("", locale),
      exampleComment: "",
      exampleCommentZh: emptyForLocaleZh("", locale),
      conclusionComment: "",
      conclusionCommentZh: emptyForLocaleZh("", locale),
      developmentAdvice: [],
      developmentAdviceZh: []
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
    taskAchievementAdviceZh: emptyForLocaleZh(["任务回应建议中文解释"], locale),
    coherenceAdvice: ["..."],
    coherenceAdviceZh: emptyForLocaleZh(["结构衔接建议中文解释"], locale),
    lexicalAdvice: ["..."],
    lexicalAdviceZh: emptyForLocaleZh(["词汇建议中文解释"], locale),
    grammarAdvice: ["..."],
    grammarAdviceZh: emptyForLocaleZh(["语法建议中文解释"], locale),
    band5FixPlan: ["..."],
    band5FixPlanZh: emptyForLocaleZh(["Band 5 建议中文解释"], locale),
    band6UpgradePlan: ["..."],
    band6UpgradePlanZh: emptyForLocaleZh(["Band 6 建议中文解释"], locale),
    band7UpgradePlan: ["..."],
    band7UpgradePlanZh: emptyForLocaleZh(["Band 7 建议中文解释"], locale),
    modelAnswerOutline: "...",
    modelAnswerOutlineZh: "",
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
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(body.task),
    "Scoring order: first assign the four task-specific criterion bands independently from essay evidence; then estimate overallBand. The server will finally recalculate the displayed overallBand from the four criteria.",
    body.isUnderMinimum ? "Important: even though the response is under the recommended word count, you must still grade it as an IELTS response using DeepSeek, start from Band 1 when there is no rateable content, return all sections, apply strict word-count caps, and do not return empty modules." : "",
    "No maximum word count rule: do not cap or penalise high word counts by length alone. Penalise only actual IELTS problems such as repetition, irrelevance, weak organisation, or unclear language.",
    "Use English for the main feedback. Use accurate Chinese explanations only in *Zh fields. These Chinese explanations must follow the exact English meaning and must not be vague template translations. Do not translate the whole essay or revised essays.",
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
    ? "Accurate Chinese explanations may appear only in *Zh fields. They must match the English feedback and not be generic. Do not translate essays."
    : "Main feedback must be English. Include accurate Chinese explanations only in *Zh fields. They must match the English feedback and not be generic. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "DeepSeek is the only scorer. Do not rely on any non-AI score or fallback content.",
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
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" }
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
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
    taskAchievementAdvice: [],
    taskAchievementAdviceZh: [],
    coherenceAdvice: [],
    coherenceAdviceZh: [],
    lexicalAdvice: [],
    lexicalAdviceZh: [],
    grammarAdvice: [],
    grammarAdviceZh: [],
    band5FixPlan: [],
    band5FixPlanZh: [],
    band6UpgradePlan: [],
    band6UpgradePlanZh: [],
    band7UpgradePlan: [],
    band7UpgradePlanZh: [],
    modelAnswerOutline: "",
    modelAnswerOutlineZh: "",
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
    "Rules: DeepSeek must score this response. Use Band 1-9 only, allow half bands, do not output 0. Penalise low word count strictly but do not reject the answer. No maximum word-count cap. Score the four task-specific criteria independently; the server will recalculate the displayed overallBand from those four criteria. Keep strings concise but specific. Arrays may contain up to 12 items for correction fields when visible issues exist. If the essay has any English content, strengths, mainProblems, taskAchievementAdvice, coherenceAdvice, lexicalAdvice, grammarAdvice, band plans, errorAnalysis.summary, correctionPriority.fixFirst, spellingCorrections, grammarErrors, sentenceCorrections, detailedSentenceCorrections, and task-specific advice must not be empty when visible errors exist. Never return blank correction objects. Main feedback English. *Zh fields may be brief Chinese helper notes only.",
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(body.task),
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


function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function retryDelayMs(attempt) {
  return Math.min(1500, 350 * Math.max(1, Number(attempt) || 1));
}

function isRetryableProviderStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function extractDeepSeekText(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .join("")
      .trim();
  }
  if (typeof data?.output_text === "string") return data.output_text.trim();
  if (typeof data?.text === "string") return data.text.trim();
  return "";
}

function stripJsonCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const raw = stripJsonCodeFence(text);
  const start = raw.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;

    if (depth === 0) {
      return raw.slice(start, i + 1);
    }
  }

  return "";
}

function parseJsonFromProvider(text) {
  const cleaned = stripJsonCodeFence(text);
  if (!cleaned) {
    throw new Error("AI returned empty JSON text.");
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      throw new Error(`AI returned malformed JSON: ${firstError.message}`);
    }

    try {
      return JSON.parse(extracted);
    } catch (secondError) {
      throw new Error(`AI returned malformed JSON: ${secondError.message}`);
    }
  }
}


async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens, temperature = 0.2, jsonMode = false, deadline, timeoutMs }) {
  if (!apiKey) {
    const error = new Error("DeepSeek API key is missing.");
    error.status = 500;
    error.provider = DEFAULT_PROVIDER;
    throw error;
  }

  const maxAttempts = Math.max(1, Math.min(Number(process.env.DEEPSEEK_RETRY_ATTEMPTS) || 2, 3));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestTimeoutMs = resolveAiTimeout(deadline, timeoutMs);
    if (!hasEnoughAiTime(deadline, Math.min(requestTimeoutMs, 3000))) {
      const timeoutError = new Error("DeepSeek request was skipped because the protected server deadline was too close.");
      timeoutError.code = "DEEPSEEK_TIMEOUT";
      timeoutError.provider = DEFAULT_PROVIDER;
      timeoutError.detail = "The backend stopped before Vercel could generate a timeout.";
      throw timeoutError;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    const requestBody = {
      model: model || DEFAULT_DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: String(systemPrompt || "") },
        { role: "user", content: String(userPrompt || "") }
      ],
      temperature,
      stream: false,
      max_tokens: Math.max(256, Number(maxTokens) || 2000)
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
        timeoutError.provider = DEFAULT_PROVIDER;
        timeoutError.detail = "The AI provider did not respond before the server timeout.";
        lastError = timeoutError;
        throw lastError;
      }
      lastError = error;
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
      error.provider = DEFAULT_PROVIDER;
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
      error.message = `DeepSeek returned non-JSON provider response: ${error.message}`;
      error.raw = raw;
      error.provider = DEFAULT_PROVIDER;
      throw error;
    }

    const outputText = extractDeepSeekText(data);
    if (outputText) return outputText;

    const emptyError = new Error("DeepSeek returned an empty response.");
    emptyError.code = "DEEPSEEK_EMPTY_RESPONSE";
    emptyError.provider = DEFAULT_PROVIDER;
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

async function parseOrRepairAiJson({ apiKey, model, rawText, body, locale, maxTokens, allowRepair = true, deadline }) {
  try {
    return parseJsonFromProvider(rawText);
  } catch (parseError) {
    // Prefer an AI repair call before showing a partial recovery.
    // Earlier versions returned partial data immediately, which caused user-visible
    // messages such as "AI partial output recovered this score" and removed Chinese buttons.
    if (allowRepair && hasEnoughAiTime(deadline, Number(process.env.AI_JSON_REPAIR_MIN_TIME_MS) || 45000)) {
      try {
        const repairedText = await callDeepSeek({
          apiKey,
          model,
          systemPrompt: "You repair malformed JSON. Return exactly one valid JSON object and nothing else.",
          userPrompt: buildCompactAiOnlyRepairPrompt(rawText, body, locale),
          maxTokens: envInt("AI_JSON_REPAIR_MAX_TOKENS", Math.min(Math.max(maxTokens, 2500), 5000), 1500, 9000),
          temperature: 0.0,
          jsonMode: true,
          deadline,
          timeoutMs: Math.min(Number(process.env.AI_JSON_REPAIR_TIMEOUT_MS) || 45000, AI_SINGLE_REQUEST_TIMEOUT_MS)
        });
        return parseJsonFromProvider(repairedText);
      } catch (repairCallError) {
        parseError.message = `AI returned malformed JSON and AI repair failed: ${repairCallError.message || repairCallError.name || parseError.message}`;
        throw parseError;
      }
    }

    parseError.message = `AI returned malformed JSON. No non-AI partial score or feedback was generated: ${parseError.message}`;
    throw parseError;
  }
}


function targetImprovementRangeFromBand(bandValue) {
  const band = clampAiBand(bandValue, 5);
  let lower;
  let upper;
  let maintenance = false;

  if (band <= 4.5) {
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
      "Use the full target ladder: Band 0.0-4.5 -> Band 5.0-5.5; Band 5.0 -> Band 5.5-6.0; Band 5.5 -> Band 6.0-6.5; Band 6.0 -> Band 6.5-7.0; Band 6.5 -> Band 7.0-7.5; Band 7.0 -> Band 7.5-8.0; Band 7.5 -> Band 8.0-8.5; Band 8.0 -> Band 8.5-9.0; Band 8.5 -> Band 9.0; Band 9.0 -> maintenance advice.",
      "Do not give advice that jumps too far beyond the current level. A Band 3 essay should not receive Band 6-9 style advice; a Band 5 essay should not receive Band 8-9 style advice."
    ].join("\n");
  }

  const roundedBand = clampAiBand(currentBand, 5);
  const range = targetImprovementRangeFromBand(roundedBand);
  return [
    `Current estimated band from the AI scoring pass: Band ${formatBand(roundedBand)}.`,
    `Target improvement range for advice: ${range.label}.`,
    "Use this target range when writing all correction advice, band plans, betterExpression, model answer outline, and task-specific coaching.",
    "Full target ladder: Band 0.0-4.5 -> Band 5.0-5.5; Band 5.0 -> Band 5.5-6.0; Band 5.5 -> Band 6.0-6.5; Band 6.0 -> Band 6.5-7.0; Band 6.5 -> Band 7.0-7.5; Band 7.0 -> Band 7.5-8.0; Band 7.5 -> Band 8.0-8.5; Band 8.0 -> Band 8.5-9.0; Band 8.5 -> Band 9.0; Band 9.0 -> maintenance advice.",
    "Important coaching rule: advice should normally target only +0.5 to +1.0 band above the current level, with Band 5.0-5.5 as the minimum practical target for any essay scored Band 0-4.5.",
    "If the current essay is Band 0-4.5, give practical Band 5.0-5.5 survival/pass advice and Band 5.0-5.5-level betterExpression first, not Band 6-9 advice.",
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
    ? "Write accurate Chinese explanations only in fields ending with Zh. Each Chinese explanation must match the adjacent English feedback or correction, not a generic template. Do not translate the full essay."
    : "Main feedback must be English. Add accurate Chinese explanations only in fields ending with Zh. Each Chinese explanation must match the adjacent English feedback or correction, not a generic template. Do not translate the full essay.";
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
    "Every correction item must include: what is wrong, why it affects the band, the exact corrected wording, and a realistic stronger version when useful.",
    "Do not give only one-sentence comments for major IELTS criteria; use enough detail for the learner to know what to change next.",
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
        bandImpactZh: "",
        scoreImpacting: true,
        whyThisAffectsBand: "",
        targetBandExpression: ""
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
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
    taskAchievementAdvice: [],
    taskAchievementAdviceZh: [],
    coherenceAdvice: [],
    coherenceAdviceZh: [],
    lexicalAdvice: [],
    lexicalAdviceZh: [],
    grammarAdvice: [],
    grammarAdviceZh: [],
    band5FixPlan: [],
    band5FixPlanZh: [],
    band6UpgradePlan: [],
    band6UpgradePlanZh: [],
    band7UpgradePlan: [],
    band7UpgradePlanZh: [],
    revisionNotes: [],
    revisionNotesZh: []
  };

  return [
    "Return exactly one valid JSON object matching this shape:",
    JSON.stringify(shape),
    "",
    `Mode: ${mode === "revision" ? "detailed grading plus model/revision" : "detailed grading without model answer"}.`,
    `Correction limit: return up to ${limit} items in each correction array when errors exist. Do not stop at two errors. The user wants maximum detail; use the full limit when clear score-affecting issues exist.`,
    "Quality requirement: each visible feedback item should be detailed enough to be useful without another explanation. Avoid one-line template advice.",
    "For every advice item, include: the current weakness, the exact action, and a concrete example phrase/sentence when possible.",
    "If there are no errors of a specific type, return an empty array for that type, but do not return all correction arrays empty when the essay has visible errors.",
    "If the essay has more than 30 words, quote and correct at least 8 clear original errors unless there are genuinely fewer visible errors. For essays above 150 words, aim for 12+ concrete corrections across spellingCorrections, grammarErrors, sentenceCorrections, and detailedSentenceCorrections when errors exist.",
    "For high-band writing with few errors, do not invent errors; instead give precise polishing advice with evidence, but do not display harmless salutation/closing items as errors.",
    "For spellingCorrections, include obvious misspellings and typo-like errors. Do not include correct words.",
    "For grammarErrors, include tense, agreement, article, plural, word-form, punctuation, and sentence-structure errors.",
    "For detailedSentenceCorrections, include only score-impacting issues. Include originalSentence, correctedSentence, betterExpression, problem, rule, bandImpact, scoreImpacting=true, whyThisAffectsBand, targetBandExpression, and betterExpressionTargetBand when a useful next-band expression exists.",
    "betterExpression must be a realistic next-step expression: Band 0-4.5 -> Band 5.0; Band 5.0 -> Band 5.5-6.0; Band 5.5 -> Band 6.0-6.5; Band 6.0 -> Band 6.5-7.0; Band 6.5 -> Band 7.0-7.5; Band 7.0 -> Band 7.5-8.0; Band 7.5 -> Band 8.0-8.5; Band 8.0 -> Band 8.5-9.0; Band 8.5 -> Band 9.0.",
    "Do not omit betterExpression just because the upgrade is modest. Show it when it is complete, preserves meaning, and is more natural or clearer at the target band.",
    "Do not fill betterExpression if it is the same as correctedSentence, only swaps one word/phrase without improving clarity, or deletes important information. betterExpression should be a realistic next-step rewrite at the target band range; it may be a modest upgrade for low-band essays, but it must be complete, natural, and more useful than the direct correction.",
    "For Task 1, also check opening, closing, tone, purpose, and bullet point coverage.",
    "For Task 2, also check position, introduction, topic sentences, idea development, examples, conclusion, and relevance.",
    buildTargetImprovementInstruction(body),
    "Fill targetImprovementPlan with a realistic next-step plan based on that target range.",
    "targetImprovementPlan must include targetBandRangeZh and targetReasonZh. targetImprovementPlan.criterionUpgrades must contain four non-empty objects: Task Response/Task Achievement, Coherence and Cohesion, Lexical Resource, and Grammatical Range and Accuracy. Each object must use these keys: criterion, currentWeakness, currentWeaknessZh, target, targetZh, action, actionZh, exampleUpgrade, exampleUpgradeZh. The action field must be a concrete step, not blank.",
    "Write correctedSentence as a direct fix at the target level. Write betterExpression only when you can provide a visibly stronger rewrite at the target level, not far above it.",
    "For band5FixPlan/band6UpgradePlan/band7UpgradePlan: generate these ladder plans only when the current overallBand is 7.0 or below. If the current score is above Band 7.0, return band5FixPlan, band6UpgradePlan, band7UpgradePlan and their Zh arrays as empty arrays, and put high-band coaching only in targetImprovementPlan, criterionUpgrades, practiceTasks, and four-criterion advice.",
    "For every advice array, also return a matching Chinese explanation array with the same number of items: taskAchievementAdviceZh, coherenceAdviceZh, lexicalAdviceZh, grammarAdviceZh, band5FixPlanZh, band6UpgradePlanZh, band7UpgradePlanZh. Each Chinese item must accurately explain the corresponding English item, not a general template.",
    "Do not return blank objects in errorAnalysis.errorPatterns, targetImprovementPlan.criterionUpgrades, or developmentAdvice. Omit empty objects and return useful text instead.",
    "Do not return errorType None, No significant improvement needed, No impact on band score, unchanged original/corrected pairs, or salutation/closing-only items with no score impact.",
    "For each correction item, explain exactly how the change helps the user reach the target range.",
    "Chinese explanations must be concise, accurate, and appear only in *Zh fields. They must not be vague template text.",
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
  const targetBandExpressionCandidate = pickFirstUsefulValue(item, ["targetBandExpression", "targetExpression", "bandTargetExpression"]);
  const rawBetterExpression = pickFirstUsefulValue(item, ["betterExpression", "improvedSentence", "naturalExpression", "upgrade", "better"]) || targetBandExpressionCandidate;
  const keepBetterExpression = shouldShowBetterExpression(correctedSentence || originalSentence, rawBetterExpression);
  const scoreImpactingRaw = item.scoreImpacting ?? item.affectsBand ?? item.bandAffecting ?? item.isScoreImpacting;
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
    betterExpression: keepBetterExpression ? rawBetterExpression : "",
    betterExpressionZh: keepBetterExpression ? pickFirstUsefulValue(item, ["betterExpressionZh", "improvedSentenceZh", "naturalExpressionZh", "upgradeZh"]) : "",
    bandImpact: pickFirstUsefulValue(item, ["bandImpact", "impactOnBand", "scoreImpact"]),
    bandImpactZh: pickFirstUsefulValue(item, ["bandImpactZh", "impactOnBandZh", "scoreImpactZh"]),
    scoreImpacting: scoreImpactingRaw === undefined ? true : scoreImpactingRaw !== false && String(scoreImpactingRaw).toLowerCase() !== "false",
    whyThisAffectsBand: pickFirstUsefulValue(item, ["whyThisAffectsBand", "whyAffectsBand", "scoreReason"]),
    betterExpressionTargetBand: pickFirstUsefulValue(item, ["betterExpressionTargetBand", "targetBandRange", "targetRange", "targetBand"]),
    targetBandExpression: targetBandExpressionCandidate
  };
}

function compactCorrectionText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isNoImpactCorrectionText(value) {
  const text = compactCorrectionText(value);
  if (!text) return false;
  return (
    text === "none" ||
    text === "n/a" ||
    text === "no" ||
    text.includes("none /") ||
    text.includes("no error") ||
    text.includes("no mistake") ||
    text.includes("no significant") ||
    text.includes("no improvement needed") ||
    text.includes("no impact") ||
    text.includes("not affect the band") ||
    text.includes("does not affect the band") ||
    text.includes("without affecting the score") ||
    text.includes("无")
  );
}

function sameCorrectionText(a, b) {
  const left = compactCorrectionText(a).replace(/[.,!?;:'"()，。！？；：“”‘’]/g, "");
  const right = compactCorrectionText(b).replace(/[.,!?;:'"()，。！？；：“”‘’]/g, "");
  return Boolean(left && right && left === right);
}

function tokenizeExpressionForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function expressionSimilarity(a, b) {
  const aTokens = tokenizeExpressionForComparison(a);
  const bTokens = tokenizeExpressionForComparison(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  aSet.forEach((token) => { if (bSet.has(token)) overlap += 1; });
  return overlap / Math.max(aSet.size, bSet.size);
}

function expressionTokenEditDistance(a, b) {
  const left = tokenizeExpressionForComparison(a);
  const right = tokenizeExpressionForComparison(b);
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[left.length][right.length];
}

function importantMeaningSegments(text) {
  return String(text || "")
    .split(/\b(?:because|as|since|although|though|if|when|while|which|that|so that|in order to|therefore|as a result)\b/i)
    .map((segment) => segment.trim())
    .filter((segment) => tokenizeExpressionForComparison(segment).length >= 4);
}

function losesImportantMeaning(correctedSentence, betterExpression) {
  const correctedTokens = tokenizeExpressionForComparison(correctedSentence);
  const betterTokens = tokenizeExpressionForComparison(betterExpression);
  if (!correctedTokens.length || !betterTokens.length) return false;
  const correctedNorm = correctedTokens.join(" ");
  const betterNorm = betterTokens.join(" ");
  if (correctedNorm.startsWith(betterNorm) && betterTokens.length <= Math.ceil(correctedTokens.length * 0.78)) return true;
  if (betterTokens.length < Math.max(5, Math.floor(correctedTokens.length * 0.65))) return true;
  return importantMeaningSegments(correctedSentence).some((segment) => {
    const segTokens = tokenizeExpressionForComparison(segment);
    if (segTokens.length < 4) return false;
    const preserved = segTokens.filter((token) => betterTokens.includes(token)).length;
    return preserved / segTokens.length < 0.45;
  });
}

function hasBetterExpressionUpgradeSignal(correctedSentence, betterExpression) {
  const corrected = String(correctedSentence || "").toLowerCase();
  const better = String(betterExpression || "").toLowerCase();
  if (!better.trim()) return false;

  const correctedTokens = tokenizeExpressionForComparison(corrected);
  const betterTokens = tokenizeExpressionForComparison(better);
  if (!correctedTokens.length || !betterTokens.length) return false;

  const similarity = expressionSimilarity(corrected, better);
  const editDistance = expressionTokenEditDistance(corrected, better);
  const lengthGap = Math.abs(correctedTokens.length - betterTokens.length);

  // Hide only genuinely bad upgrades: identical wording, tiny mechanical swaps, or obvious truncation.
  // Modest next-band upgrades are valid, especially for Band 0-5 learners.
  if (similarity >= 0.97) return false;
  if (editDistance <= 1 && lengthGap <= 1) return false;
  if (editDistance <= 2 && lengthGap === 0 && similarity >= 0.9) return false;
  if (losesImportantMeaning(correctedSentence, betterExpression)) return false;

  return true;
}

function shouldShowBetterExpression(correctedSentence, betterExpression) {
  const corrected = String(correctedSentence || "").trim();
  const better = String(betterExpression || "").trim();
  if (!better) return false;
  if (!corrected) return true;
  if (sameCorrectionText(corrected, better)) return false;
  return hasBetterExpressionUpgradeSignal(corrected, better);
}


function isPlainSalutationOrClosing(text) {
  const value = compactCorrectionText(text).replace(/[.,!?;:'"()]/g, "");
  return (
    /^dear\s+/.test(value) ||
    /^(hi|hello)\s+/.test(value) ||
    /^(yours sincerely|yours faithfully|best regards|kind regards|regards|sincerely|faithfully)$/.test(value)
  );
}

function isScoreImpactingDetailedCorrection(item) {
  if (!item || typeof item !== "object") return false;
  if (item.scoreImpacting === false) return false;
  const original = item.originalSentence || "";
  const corrected = item.correctedSentence || "";
  const problem = item.problem || "";
  const rule = item.rule || "";
  const impact = item.bandImpact || "";
  const errorType = item.errorType || "";
  const better = item.betterExpression || "";
  if (isNoImpactCorrectionText(errorType) || isNoImpactCorrectionText(problem) || isNoImpactCorrectionText(rule) || isNoImpactCorrectionText(impact)) return false;
  if (sameCorrectionText(original, corrected) && (!better || sameCorrectionText(original, better))) return false;
  if (isPlainSalutationOrClosing(original) && !problem && !rule && !impact) return false;
  return correctionObjectHasText(item, ["originalSentence", "correctedSentence", "problem", "rule", "betterExpression", "bandImpact"]);
}

function isScoreImpactingSimpleCorrection(item, originalKey, correctedKey, reasonKeys = []) {
  if (!item || typeof item !== "object") return false;
  const original = item[originalKey] || "";
  const corrected = item[correctedKey] || "";
  if (sameCorrectionText(original, corrected)) return false;
  return !reasonKeys.some((key) => isNoImpactCorrectionText(item[key]));
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
    .filter((item) => correctionObjectHasText(item, ["original", "corrected", "explanation"]))
    .filter((item) => isScoreImpactingSimpleCorrection(item, "original", "corrected", ["type", "explanation"]));

  cleaned.sentenceCorrections = ensureArray(cleaned.sentenceCorrections)
    .map((item) => normalizeSentenceCorrectionItem(item))
    .filter((item) => correctionObjectHasText(item, ["original", "corrected", "reason"]))
    .filter((item) => isScoreImpactingSimpleCorrection(item, "original", "corrected", ["reason"]));

  cleaned.detailedSentenceCorrections = ensureArray(cleaned.detailedSentenceCorrections)
    .map((item, index) => normalizeDetailedSentenceCorrectionItem(item, index))
    .filter((item) => isScoreImpactingDetailedCorrection(item));

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
    "taskAchievementAdviceZh",
    "coherenceAdvice",
    "coherenceAdviceZh",
    "lexicalAdvice",
    "lexicalAdviceZh",
    "grammarAdvice",
    "grammarAdviceZh",

    "band5FixPlan",
    "band5FixPlanZh",
    "band6UpgradePlan",
    "band6UpgradePlanZh",
    "band7UpgradePlan",
    "band7UpgradePlanZh",

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
        jsonMode: true,
        deadline,
        timeoutMs: Math.min(Number(process.env.AI_JSON_REPAIR_TIMEOUT_MS) || 45000, AI_SINGLE_REQUEST_TIMEOUT_MS)
      });
      return parseJsonFromProvider(repairedText);
    } catch (repairError) {
      parseError.message = `AI correction JSON parse failed and AI repair failed: ${repairError.message || repairError.name || parseError.message}`;
      throw parseError;
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
    jsonMode: true,
    deadline,
    timeoutMs
  });
  return await parseCorrectionJson({ apiKey, model, rawText, body, locale, maxTokens, deadline });
}


function buildFocusedAiCorrectionSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use accurate Chinese explanations only in *Zh fields. They must match the adjacent English correction or advice, not a generic template. Do not translate the essay."
    : "Use English for main fields. Add accurate Chinese explanations only in *Zh fields. They must match the adjacent English correction or advice, not a generic template. Do not translate the essay.";
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
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
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
    "For each corrected sentence, include correctedSentence as the direct fix. Include betterExpression when it gives a useful next-step rewrite at the target band range. Do not include it for identical wording, meaningless synonym swaps, incomplete/truncated sentences, or rewrites that delete reasons, purpose, conditions, results, or task content.",
    "Include spelling errors if any misspelled words appear.",
    "Include grammar and sentence-control problems if any are visible.",
    task === "Task 1"
      ? "Also mention tone, purpose, and bullet-point problems in advice arrays if relevant."
      : "Also mention position, idea development, examples, paragraphing, and conclusion problems in advice arrays if relevant.",
    buildTargetImprovementInstruction(body),
    "Fill targetImprovementPlan and make all fixes realistic for that target range.",
    "targetImprovementPlan.criterionUpgrades must contain four non-empty objects using keys criterion, currentWeakness, target, action, exampleUpgrade, actionZh. Do not return blank criterionUpgrades objects.",
    "Question:",
    String(body.questionPrompt || ""),
    "Essay:",
    String(body.essay || "")
  ].join("\n");
}

async function callAiFocusedCorrectionPass({ apiKey, model, body, effectiveMode, locale, deadline, timeoutMs }) {
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
    jsonMode: true,
    deadline,
    timeoutMs: safePassTimeout(deadline, timeoutMs || Math.min(45000, AI_SINGLE_REQUEST_TIMEOUT_MS), 28000)
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

  const focusedCorrectionTimeout = safePassTimeout(
    deadline,
    Math.max(30000, Number(process.env.AI_FOCUSED_CORRECTION_TIMEOUT_MS) || 45000),
    30000
  );

  if (!hasEnoughAiTime(deadline, focusedCorrectionTimeout)) {
    return markAiPassDeferred(output, "AI detailed correction was deferred because the scoring result needed to be returned before the server deadline. Retry the correction stage for full sentence-level detail.");
  }

  const retryAttempts = Math.max(1, Math.min(Number(process.env.AI_FOCUSED_CORRECTION_RETRY_ATTEMPTS) || 1, 2));
  let lastError = null;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const focusedCorrection = await callAiFocusedCorrectionPass({
        apiKey,
        model,
        body: { ...body, mode: gradingMode, correctionRetryAttempt: attempt },
        effectiveMode: gradingMode,
        locale,
        deadline,
        timeoutMs: focusedCorrectionTimeout
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

  const warning = lastError
    ? "AI detailed correction retry failed or timed out. No non-AI correction was generated."
    : "AI did not return concrete sentence-level corrections. No non-AI correction was generated.";
  output.correctionWarning = warning;
  output.correctionPassWarning = warning;
  output.stageWarnings = ensureArray(output.stageWarnings).concat([warning]);
  return output;
}

function buildFastAiGradingSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Write accurate Chinese explanations only in fields ending with Zh. They must match the adjacent English feedback and avoid vague templates. Do not translate essays."
    : "Main feedback must be English. Write accurate Chinese explanations only in fields ending with Zh. They must match the adjacent English feedback and avoid vague templates. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "Return exactly one valid JSON object only. No markdown. No code fences. No trailing commas.",
    "This pass is for scoring and task analysis only. A separate AI pass handles detailed sentence corrections.",
    "Use IELTS Writing public band descriptor logic. Score from Band 1 to Band 9 only and allow half bands.",
    "DeepSeek is the only scorer. The server will not score, cap, or generate non-AI feedback.",
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
    wordCountWarning: { message: "", messageZh: "" },
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
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" }
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
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
    taskAchievementAdvice: [],
    taskAchievementAdviceZh: [],
    coherenceAdvice: [],
    coherenceAdviceZh: [],
    lexicalAdvice: [],
    lexicalAdviceZh: [],
    grammarAdvice: [],
    grammarAdviceZh: [],
    band5FixPlan: [],
    band5FixPlanZh: [],
    band6UpgradePlan: [],
    band6UpgradePlanZh: [],
    band7UpgradePlan: [],
    band7UpgradePlanZh: [],
    modelAnswerOutline: "",
    modelAnswerOutlineZh: "",
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
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(task),
    "- Assign four task-specific IELTS criterion bands independently; the server will recalculate the displayed overallBand from the four criteria.",
    "- Explain why the score is not higher and not lower.",
    "- Analyse the selected prompt before scoring.",
    "- If under the recommended word count, reflect that in Task Achievement/Task Response, but still score normally from Band 1 upward.",
    "- Include 1-3 short backup spelling/grammar/sentence corrections if visible errors are obvious; the separate correction pass will add the full list.",
    "- Keep strings short. Arrays max 5 items.",
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
    modelAnswerOutlineZh: "",
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
    jsonMode: true,
    deadline,
    timeoutMs: Math.min(Number(process.env.AI_JSON_REPAIR_TIMEOUT_MS) || 45000, AI_SINGLE_REQUEST_TIMEOUT_MS)
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
    jsonMode: true,
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
    ? "Use accurate Chinese explanations only in *Zh fields; match the adjacent English content and avoid generic templates."
    : "Main fields must be English. Use accurate Chinese explanations only in *Zh fields; match the adjacent English content and avoid generic templates.";
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
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" }
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
    jsonMode: true,
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
    ? "Use accurate Chinese explanations only in fields ending with Zh; match the adjacent English content and avoid generic templates."
    : "Main fields must be English. Use accurate Chinese explanations only in fields ending with Zh; match the adjacent English content and avoid generic templates.";
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
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(task),
    "Score each criterion independently from its own evidence. The server will recalculate the displayed overallBand from the four criterion bands.",
    "Each criterion object must contain: band, feedback, feedbackZh, howToImprove, howToImproveZh.",
    "Every English feedback/howToImprove field must be filled with a concrete sentence based on the essay.",
    "strengths and mainProblems must each contain at least 2 concrete items if the essay has English content.",
    "scoreCalibration must contain strictness, capApplied, capReason, whyNotHigher, whyNotLower, evidence.",
    "Do not output empty strings for scoring feedback. Do not return the schema only.",
    body.currentResult ? "This is a score-audit pass. Check that bands, feedback, strengths, mainProblems, highBandDiagnostics, lowBandDiagnostics, and scoreCalibration are internally consistent. If all four criterion bands are identical, keep them identical only when concrete evidence proves all four criteria are genuinely the same level; otherwise differentiate the bands. If Band 7.5+, feedback must sound high-band and suggestions must be minor polish/refinement. Remove strengths from mainProblems." : "",
    "Use underlength as a penalty only when relevant; it is not automatically Band 1.",
    `Task: ${task}`,
    `Mode: ${gradingMode}`,
    `Word count: ${words}/${threshold}`,
    body.currentResult ? "Current result to audit:" : "",
    body.currentResult ? JSON.stringify(body.currentResult).slice(0, 3500) : "",
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
    maxTokens: 3600,
    temperature: 0.0,
    jsonMode: true,
    deadline,
    timeoutMs: Math.min(60000, AI_SINGLE_REQUEST_TIMEOUT_MS)
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 3600,
    allowRepair: true,
    deadline
  });
}


function buildLeanScoreSystemPrompt(locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use accurate Chinese explanations only in fields ending with Zh; match the adjacent English content and avoid generic templates. Do not translate essays."
    : "Main feedback must be English. Use accurate Chinese explanations only in fields ending with Zh; match the adjacent English content and avoid generic templates. Do not translate essays.";
  return [
    "You are a strict IELTS Writing examiner.",
    "This pass is ONLY for scoring and task analysis. Do not do detailed sentence correction here.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Use IELTS Writing public band descriptor logic.",
    "Score from Band 1 to Band 9 only and allow half bands.",
    "DeepSeek is the only scorer. The server will not score, cap, or generate non-AI feedback.",
    "Penalise underlength strictly, but still grade from Band 1 upward.",
    "There is no maximum word-count cap; penalise long answers only for repetition, irrelevance, weak coherence, or loss of task focus.",
    "For Task 1 use Task Achievement. For Task 2 use Task Response.",
    "Use separate task-specific scoring engines: Task 1 is a General Training letter; Task 2 is an essay. Do not mix letter and essay criteria.",
    "Assign the four criterion bands independently first. OverallBand may be estimated, but the server will finally recalculate the displayed overallBand from the four criterion bands.",
    "High-quality relevant answers may receive Band 8 or 9. Do not artificially cap strong writing at Band 7.",
    "High-quality scoring is the core product: prioritise accurate bands, evidence-based criterion feedback, and concrete next-step advice over speed.",
    "Do not use Band 7 as a safe default. If the response fully satisfies the prompt, has natural progression, precise vocabulary, flexible grammar, and only rare minor issues, award Band 8-9 as appropriate.",
    "If a Task 1 answer fully covers all bullet points, has a clear purpose, appropriate recipient tone, and controlled language, do not lower it to Band 7 unless you identify concrete score-limiting evidence.",
    "For Band 7.5+ results, suggestions must be framed as minor refinement/polishing, not basic-control problems such as needs clearer control or needs improvement.",
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
      [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" },
      "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidence: [], evidenceZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], evidenceQuotes: [], evidenceQuotesZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" }
    },
    strengths: [],
    strengthsZh: [],
    mainProblems: [],
    mainProblemsZh: [],
    taskAchievementAdvice: [],
    taskAchievementAdviceZh: [],
    coherenceAdvice: [],
    coherenceAdviceZh: [],
    lexicalAdvice: [],
    lexicalAdviceZh: [],
    grammarAdvice: [],
    grammarAdviceZh: [],
    targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
    spellingCorrections: [],
    grammarErrors: [],
    sentenceCorrections: [],
    detailedSentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
    modelAnswerOutline: "",
    modelAnswerOutlineZh: "",
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
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(task),
    "- Do not copy template values. Replace Band 1 placeholders with real criterion bands.",
    "- Give specific evidence from the essay for each criterion.",
    body.currentResult ? "- This is a score-audit pass. Audit the current result for contradictions between bands, feedback, strengths, mainProblems, diagnostics, and scoreCalibration. If all four criterion bands are identical, keep them identical only when concrete evidence proves all four criteria are genuinely the same level; otherwise differentiate the bands. If Band 7.5+, feedback must sound high-band and suggestions must be minor polish/refinement. Remove strengths from mainProblems." : "",
    "- If under the recommended word count, reflect it in the relevant criterion, but still grade the writing actually submitted.",
    "- Do not do detailed error lists here; later stages handle all spelling, grammar, and sentence corrections.",
    "- Keep strengths/mainProblems/advice arrays specific and evidence-based, usually 3-6 items. Do not use generic template wording.",
    "- For each criterion, feedback should explain the exact evidence in the essay and howToImprove should give a concrete next action.",
    "- Each criterion must include concrete evidenceQuotes from the essay, positiveEvidence, limitingEvidence, whyThisBand, whyNotHigher, and whyNotLower to support examiner-like scoring.",
    "- For all criterion evidence fields, also return accurate matching Chinese fields: evidenceZh, evidenceQuotesZh, positiveEvidenceZh, limitingEvidenceZh, whyThisBandZh, whyNotHigherZh, and whyNotLowerZh. Do not use generic Chinese templates.",
    "- Do not keep all four criterion bands identical unless the evidence for all four criteria is genuinely equivalent.",
    "- High-band calibration is mandatory: when the evidence shows full task fulfilment, natural organisation, precise vocabulary, flexible grammar, and rare minor errors, use Band 8-9. Do not force such writing into Band 7.",
    "- If you assign Band 7 or lower despite high-band evidence, scoreCalibration.whyNotHigher must name exact score-limiting features from the essay, not vague strictness.",
    "- For every English advice array returned in this score stage, return the matching *Zh array with the same item count. The Chinese explanation must specifically explain the corresponding English item.",
    buildTargetImprovementInstruction(body),
    body.currentResult ? "Current result to audit:" : "",
    body.currentResult ? JSON.stringify(body.currentResult).slice(0, 3500) : "",
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
    maxTokens: 5200,
    temperature: 0.05,
    jsonMode: true,
    deadline,
    timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(120000, Number(process.env.AI_SCORE_TIMEOUT_MS) || 190000))
  });

  return await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: gradingMode },
    locale,
    maxTokens: 5200,
    allowRepair: true,
    deadline
  });
}

function normalizeFocusedCorrectionStage(value) {
  const raw = String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
  if (["task", "taskresponse", "taskachievement", "taskstructure", "correctiontask"].includes(raw)) return "task";
  if (["language", "languagemistakes", "grammarandsentence", "correctionlanguage"].includes(raw)) return "language";
  if (["vocabulary", "lexical", "lexicalresource", "wordchoice", "collocation", "correctionvocabulary"].includes(raw)) return "vocabulary";
  if (["spell", "spelling", "spellingcorrection", "spellingcorrections", "correctionspelling"].includes(raw)) return "spelling";
  if (["grammar", "grammarerror", "grammarerrors", "correctiongrammar"].includes(raw)) return "grammar";
  if (["sentence", "sentences", "sentencecorrection", "sentencecorrections", "detailedsentence", "correctionsentence"].includes(raw)) return "sentence";
  if (["advice", "coaching", "plan", "priority", "taskadvice", "correctionadvice", "improvement", "improvementplan"].includes(raw)) return "advice";
  return "";
}

function buildFocusedSectionSystemPrompt(section, locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use brief Chinese helper notes only in fields ending with Zh. Do not translate the full essay."
    : "Main fields must be English. Use accurate Chinese explanations only in fields ending with Zh. Match the adjacent English content and avoid generic templates. Do not translate the full essay.";
  const sectionName = {
    task: "task response, structure, tone, and prompt coverage",
    language: "grammar, sentence structure, and meaning-control correction",
    vocabulary: "lexical resource, word choice, spelling, collocation, and repetition correction",
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
    "For every returned issue, give a specific explanation, a concrete fix, and a realistic next-step upgrade tied to the current band target.",
    "Do not use vague coaching such as improve vocabulary, make it clearer, or use better grammar unless you also show exactly what to change and why it affects IELTS scoring.",
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

  if (section === "task") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [{ bulletPoint: "", covered: null, coverageUnknown: true, evidenceFromEssay: "", problem: "", comment: "", suggestedSentence: "", explanationZh: "" }] } : null,
        task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
        taskAchievementAdvice: [],
        taskAchievementAdviceZh: [],
        coherenceAdvice: [],
        coherenceAdviceZh: [],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Check only task response/achievement, prompt coverage, purpose, tone, opening/closing, paragraphing, relevance, position, development, examples, and conclusion.",
      "For Task 1 bulletPointAdvice, create one non-empty object for each bullet point in the question. State whether it is covered, quote evidenceFromEssay if covered, explain the exact problem if not fully covered, and give a suggestedSentence that directly fixes it.",
      "For Task 2 developmentAdvice, create detailed items that mention the exact idea/paragraph, what is missing, and one concrete sentence-level action.",
      "Return only issues that can affect Task Achievement/Task Response or Coherence and Cohesion.",
      ...common
    ].join("\n");
  }

  if (section === "vocabulary") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        spellingCorrections: [
          { originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }
        ],
        detailedSentenceCorrections: [
          { sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Word choice / collocation / repetition / spelling", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }
        ],
        lexicalAdvice: [],
        lexicalAdviceZh: [],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      `Find spelling, word choice, collocation, repetition, register, and lexical precision issues that affect Lexical Resource. Return up to ${limit} correction items.`,
      "For each lexical issue, quote the original wording, give a precise replacement, explain the collocation/register/precision problem, and state how it affects Lexical Resource.",
      "Do not include correct words or harmless style preferences. Every detailed item must be scoreImpacting=true.",
      ...common
    ].join("\n");
  }

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

  if (section === "grammar" || section === "language") {
    return [
      "Return JSON with this exact shape:",
      JSON.stringify({
        grammarErrors: [
          { type: "", original: "", corrected: "", explanation: "", explanationZh: "" }
        ],
        sentenceCorrections: [
          { original: "", corrected: "", reason: "", reasonZh: "" }
        ],
        detailedSentenceCorrections: [
          { sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }
        ],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      `Find all clear grammar, word-form, article, tense, plural, agreement, preposition, punctuation, and sentence-structure errors. Return up to ${limit} items.`,
      "Each item must include original text from the essay, corrected text, a specific rule/explanation, and why it affects Grammatical Range and Accuracy.",
      "For high-band essays, return only real accuracy or naturalness issues that could affect the score; do not mark correct sentences.",
      "Do not return errorType None, No significant improvement needed, No impact on band score, or unchanged corrections.",
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
          { sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }
        ]
      }),
      `Scan the whole essay sentence by sentence. Return up to ${limit} sentenceCorrections and up to ${limit} detailedSentenceCorrections.`,
      "Return only sentence issues that affect IELTS band. Do not include errorType None, No significant improvement needed, No impact on band score, unchanged corrections, or correct salutations/closings.",
      "For each useful issue, provide original sentence, corrected sentence, better expression at the realistic target band, betterExpressionTargetBand, problem, rule, band impact, scoreImpacting=true, whyThisAffectsBand, and targetBandExpression.",
    "betterExpression must be present for every score-impacting correction below Band 9. It must be ONE sentence only, not a paragraph. If the original text contains multiple sentences, choose the sentence being corrected and return a single upgraded sentence. If the corrected sentence is too similar to the betterExpression, rewrite it again so it shows a realistic 0.5-1 band upgrade while preserving all task-relevant meaning. Keep it at the target range, not far above the learner level.",
      "Do not make Band 3-5 learners imitate Band 8-9 language. Upgrade only to the next realistic target range.",
      ...common
    ].join("\n");
  }

  return [
    "Return JSON with this exact shape:",
    JSON.stringify({
      correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
      targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
      task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [] } : null,
      task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
      taskAchievementAdvice: [],
      taskAchievementAdviceZh: [],
      coherenceAdvice: [],
      coherenceAdviceZh: [],
      lexicalAdvice: [],
      lexicalAdviceZh: [],
      grammarAdvice: [],
      grammarAdviceZh: [],
      band5FixPlan: [],
      band5FixPlanZh: [],
      band6UpgradePlan: [],
      band6UpgradePlanZh: [],
      band7UpgradePlan: [],
      band7UpgradePlanZh: [],
      errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
    }),
    "Give detailed IELTS coaching based on the current band and the next realistic target range. Each advice item must be concrete and connected to the submitted essay, not generic IELTS advice.",
    "targetImprovementPlan.criterionUpgrades must contain four non-empty objects using keys criterion, currentWeakness, target, action, exampleUpgrade, actionZh: one for Task Response/Task Achievement, one for Coherence and Cohesion, one for Lexical Resource, and one for Grammatical Range and Accuracy.",
    "Focus on improving 0.5-1 band at a time, with Band 5 as the first floor for very weak writing.",
    "Give concrete actions, not generic advice. Include task-specific advice, sample upgraded wording, and the criterion it improves.",
    "For every English advice array, return a matching accurate Chinese explanation array with the same number of items: taskAchievementAdviceZh, coherenceAdviceZh, lexicalAdviceZh, grammarAdviceZh, band5FixPlanZh, band6UpgradePlanZh, and band7UpgradePlanZh. Each Chinese item must explain the corresponding English item specifically.",
    "Do not return blank errorPatterns or blank criterionUpgrades. If an object has no useful text, omit it instead of returning empty labels.",
    "For Task 1: opening, closing, tone, purpose, bullet coverage.",
    "For Task 2: position, introduction, body paragraph development, examples, conclusion, relevance.",
    ...common
  ].join("\n");
}


function usefulArrayItemsForZhCheck(value) {
  return ensureArray(value).filter((item) => hasUsefulText(item));
}

function hasMatchingZhArrayForAdvice(englishItems, zhItems) {
  const en = usefulArrayItemsForZhCheck(englishItems);
  if (!en.length) return true;
  const zh = usefulArrayItemsForZhCheck(zhItems);
  return zh.length >= en.length;
}

function adviceZhComplete(output) {
  return Boolean(output && typeof output === "object" &&
    hasMatchingZhArrayForAdvice(output.taskAchievementAdvice, output.taskAchievementAdviceZh) &&
    hasMatchingZhArrayForAdvice(output.coherenceAdvice, output.coherenceAdviceZh) &&
    hasMatchingZhArrayForAdvice(output.lexicalAdvice, output.lexicalAdviceZh) &&
    hasMatchingZhArrayForAdvice(output.grammarAdvice, output.grammarAdviceZh) &&
    hasMatchingZhArrayForAdvice(output.band5FixPlan, output.band5FixPlanZh) &&
    hasMatchingZhArrayForAdvice(output.band6UpgradePlan, output.band6UpgradePlanZh) &&
    hasMatchingZhArrayForAdvice(output.band7UpgradePlan, output.band7UpgradePlanZh));
}

function hasFocusedSectionUsableContent(section, output, body) {
  const cleaned = sanitizeAiCorrectionPayload(output);
  if (section === "task") {
    const hasTaskContent = Boolean(
      ensureArray(cleaned.taskAchievementAdvice).length ||
      ensureArray(cleaned.coherenceAdvice).length ||
      ensureArray(cleaned.task1LetterCorrections?.bulletPointAdvice).length ||
      ensureArray(cleaned.task2EssayCorrections?.developmentAdvice).length ||
      hasUsefulText(cleaned.task1LetterCorrections?.toneComment) ||
      hasUsefulText(cleaned.task2EssayCorrections?.bodyParagraphComment) ||
      hasUsefulText(cleaned.errorAnalysis?.summary)
    );
    return hasTaskContent &&
      hasMatchingZhArrayForAdvice(cleaned.taskAchievementAdvice, cleaned.taskAchievementAdviceZh) &&
      hasMatchingZhArrayForAdvice(cleaned.coherenceAdvice, cleaned.coherenceAdviceZh);
  }
  if (section === "language") {
    return ensureArray(cleaned.grammarErrors).length > 0 ||
      ensureArray(cleaned.sentenceCorrections).length > 0 ||
      ensureArray(cleaned.detailedSentenceCorrections).length > 0 ||
      hasUsefulText(cleaned.errorAnalysis?.summary);
  }
  if (section === "vocabulary") {
    return ensureArray(cleaned.spellingCorrections).length > 0 ||
      ensureArray(cleaned.detailedSentenceCorrections).length > 0 ||
      ensureArray(cleaned.lexicalAdvice).length > 0 ||
      hasUsefulText(cleaned.errorAnalysis?.summary);
  }
  if (section === "spelling") {
    // A spelling stage may legitimately return no spelling mistakes, but it must at least
    // return an AI-written summary so the UI can show that the stage completed.
    return ensureArray(cleaned.spellingCorrections).length > 0 || hasUsefulText(cleaned.errorAnalysis?.summary);
  }
  if (section === "grammar") {
    return ensureArray(cleaned.grammarErrors).length > 0 ||
      ensureArray(cleaned.detailedSentenceCorrections).length > 0 ||
      ensureArray(cleaned.grammarAdvice).length > 0 ||
      hasUsefulText(cleaned.errorAnalysis?.summary);
  }
  if (section === "sentence") {
    return ensureArray(cleaned.sentenceCorrections).length > 0 || ensureArray(cleaned.detailedSentenceCorrections).length > 0;
  }
  if (section === "advice") {
    const hasAdvice = Boolean(
      ensureArray(cleaned.taskAchievementAdvice).length ||
      ensureArray(cleaned.coherenceAdvice).length ||
      ensureArray(cleaned.lexicalAdvice).length ||
      ensureArray(cleaned.grammarAdvice).length ||
      ensureArray(cleaned.band5FixPlan).length ||
      ensureArray(cleaned.band6UpgradePlan).length ||
      ensureArray(cleaned.band7UpgradePlan).length ||
      hasUsefulText(cleaned.errorAnalysis?.summary) ||
      hasUsefulText(cleaned.targetImprovementPlan?.targetBandRange) ||
      ensureArray(cleaned.targetImprovementPlan?.focus).length ||
      ensureArray(cleaned.targetImprovementPlan?.practiceTasks).length ||
      ensureArray(cleaned.correctionPriority?.fixFirst).length ||
      ensureArray(cleaned.task1LetterCorrections?.bulletPointAdvice).length ||
      ensureArray(cleaned.task2EssayCorrections?.developmentAdvice).length ||
      hasUsefulText(cleaned.task1LetterCorrections?.toneComment) ||
      hasUsefulText(cleaned.task2EssayCorrections?.bodyParagraphComment)
    );
    return hasAdvice && adviceZhComplete(cleaned);
  }
  return hasAiCorrectionContent(cleaned);
}


function stageReferenceResult(body = {}, bestOutput = {}) {
  const candidates = [
    body.currentResult,
    body.result,
    body.previousResult,
    body.gradingResult,
    body.aiResult,
    bestOutput,
    body
  ];
  return candidates.find((item) => item && typeof item === "object") || {};
}

function highBandStageNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}


function buildFocusedSectionRetryPrompt(body, mode, section, locale = "en", previousIssue = "") {
  return [
    buildFocusedSectionPrompt(body, mode, section, locale),
    "",
    "IMPORTANT RETRY INSTRUCTION:",
    previousIssue ? `Previous issue: ${String(previousIssue).slice(0, 300)}` : "The previous stage returned too little useful detail.",
    "Return usable content for this exact section. Do not return an empty object.",
    section === "task" ? "Return task-specific correction content: Task 1 bullet/tone/purpose advice or Task 2 position/development/conclusion advice, plus taskAchievementAdvice and coherenceAdvice." : "",
    section === "language" ? "Return only score-impacting grammar, sentence structure, word-form, tense, article, punctuation, or meaning-control problems. Do not return None/No impact items." : "",
    section === "vocabulary" ? "Return only score-impacting spelling, word choice, collocation, repetition, register, or lexical precision problems. If no spelling errors exist, still return lexical advice or a short errorAnalysis.summary." : "",
    section === "grammar" ? "If the essay has any grammar, word-form, article, tense, plural, preposition, punctuation, or sentence-control problem, return concrete grammarErrors with original and corrected text. If the essay genuinely has no major grammar errors, return a specific errorAnalysis.summary and grammarAdvice instead of an empty object." : "",
    section === "sentence" ? "Return concrete sentenceCorrections and detailedSentenceCorrections. Quote original sentences from the essay and provide correctedSentence as the direct fix. Provide betterExpression when it gives a realistic next-step rewrite at the target band range. Do not include it for identical wording, meaningless one-word synonym changes, incomplete/truncated sentences, or rewrites that delete important meaning." : "",
    section === "advice" ? "Return non-empty targetImprovementPlan, correctionPriority, taskAchievementAdvice, coherenceAdvice, lexicalAdvice, grammarAdvice, and the relevant Task 1/Task 2 correction object. For every English advice array, return a matching Chinese array with the same number of items: taskAchievementAdviceZh, coherenceAdviceZh, lexicalAdviceZh, grammarAdviceZh, band5FixPlanZh, band6UpgradePlanZh, band7UpgradePlanZh. Each Chinese item must specifically explain its English item, not a generic template." : "",
    section === "spelling" ? "If there are no spelling mistakes, return spellingCorrections as [] and write a short errorAnalysis.summary confirming no obvious spelling mistakes were found." : ""
  ].filter(Boolean).join("\n");
}

async function callAiFocusedSectionStageOnly({ apiKey, model, body, effectiveMode, section, locale, deadline }) {
  const maxTokensBySection = {
    task: 7000,
    language: 8000,
    vocabulary: 7000,
    spelling: 3600,
    grammar: 7000,
    sentence: 8500,
    advice: 7500
  };
  const sectionTimeout = safePassTimeout(
    deadline,
    Math.max(60000, Number(process.env.AI_CORRECTION_STAGE_TIMEOUT_MS) || 90000),
    60000
  );
  const configuredAttempts = Math.max(1, Math.min(Number(process.env.AI_SECTION_RETRY_ATTEMPTS) || 1, 2));
  const maxAttempts = section === "advice" ? Math.max(2, configuredAttempts) : configuredAttempts;
  let lastError = null;
  let bestOutput = { disclaimer: DISCLAIMER };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!hasEnoughAiTime(deadline, sectionTimeout)) break;
    try {
      const userPrompt = attempt === 1
        ? buildFocusedSectionPrompt({ ...body, mode: effectiveMode }, effectiveMode, section, locale)
        : buildFocusedSectionRetryPrompt({ ...body, mode: effectiveMode }, effectiveMode, section, locale, lastError?.message || "empty section result");
      const rawText = await callDeepSeek({
        apiKey,
        model,
        systemPrompt: buildFocusedSectionSystemPrompt(section, locale),
        userPrompt,
        maxTokens: maxTokensBySection[section] || 5200,
        temperature: attempt === 1 ? 0.1 : 0.0,
        jsonMode: true,
        deadline,
        timeoutMs: sectionTimeout
      });

      const parsed = await parseCorrectionJson({
        apiKey,
        model,
        rawText,
        body: { ...body, mode: effectiveMode },
        locale,
        maxTokens: maxTokensBySection[section] || 5200,
        deadline
      });

      const output = mergeAiCorrectionDetails({ disclaimer: DISCLAIMER }, parsed, body, effectiveMode);
      if (hasFocusedSectionUsableContent(section, output, body)) {
        output.sectionStage = section;
        output.sectionWarning = "";
        return output;
      }

      bestOutput = mergeAiCorrectionDetails(bestOutput, output, body, effectiveMode);
      lastError = new Error(`AI ${section} stage returned no usable detailed content.`);
    } catch (error) {
      lastError = error;
      if (remainingAiTime(deadline) < 15000) break;
    }
  }

  if (hasFocusedSectionUsableContent(section, bestOutput, body)) {
    bestOutput.sectionStage = section;
    bestOutput.sectionWarning = "";
    return bestOutput;
  }

  const error = new Error(lastError?.message || `AI ${section} stage failed or returned no usable detailed content.`);
  error.provider = DEFAULT_PROVIDER;
  error.aiStage = `correction-${section}`;
  error.status = 502;
  throw error;
}



function normalizeAiStage(value) {
  const raw = String(value || "all").toLowerCase().replace(/[_\s-]+/g, "");
  if (["score", "scoring", "grade", "grading", "corescore", "corescoring", "stage1", "step1"].includes(raw)) return "score";
  if (["evidencemap", "evidencediagnostic", "diagnosticmap", "scoreevidence", "scoringevidence", "taskandevidence", "problemmapping", "evidence", "taskmap", "questionmap", "stage2", "step2"].includes(raw)) return "evidence-map";
  if (["languagediagnosis", "languagecorrection", "language", "languagestage", "correctionlanguage", "grammarvocabularysentence", "grammarandsentence", "stage3", "step3"].includes(raw)) return "language-correction";
  if (["sentencecorrection", "sentencecorrections", "sentencelevelcorrection", "sentencelevelcorrections", "sentence", "sentences", "detailedsentence", "betterexpression", "betterexpressions", "stage4", "step4"].includes(raw)) return "correction-sentence";
  if (["finalplan", "studyplan", "improvementplan", "plan", "adviceplan", "finalstudyplan", "stage5", "step5"].includes(raw)) return "final-plan";
  if (["revision", "model", "modelanswer", "revisedessay", "stage6", "step6"].includes(raw)) return "revision";
  if (["evidenceplan", "evidenceandplan", "planandevidence"].includes(raw)) return "evidence-plan";
  const focused = normalizeFocusedCorrectionStage(raw);
  if (focused) return `correction-${focused}`;
  if (["correction", "corrections", "error", "errors", "detailedcorrection", "detailedcorrections"].includes(raw)) return "correction";
  return "all";
}

async function callAiScoreOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  const gradingMode = effectiveMode === "revision" ? "full" : effectiveMode;
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
    result = assertMeaningfulAiScoringResult(result, body, "High-quality AI scoring");
  } catch (primaryError) {
    try {
      // Keep scoring quality above speed: use the evidence-based no-template retry before compact/minimal fallbacks.
      result = await callAiNoTemplateScoringPass({
        apiKey,
        model,
        body,
        gradingMode,
        locale,
        deadline
      });
      result = assertMeaningfulAiScoringResult(result, body, "High-quality no-template AI scoring retry");
      result.gradingWarning = "Primary high-quality AI scoring was incomplete, so an evidence-based no-template scoring retry was used.";
    } catch (noTemplateError) {
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
        result.gradingWarning = "High-quality scoring retries were incomplete, so a compact AI scoring retry was used. Score-audit will recalibrate if high-band evidence is inconsistent.";
      } catch (compactError) {
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
          result.gradingWarning = "Only a minimal AI scoring retry completed. Use score-audit and detailed stages before trusting this result.";
        } catch (minimalError) {
          throw minimalError || compactError || noTemplateError || primaryError;
        }
      }
    }
  }

  return result;
}

async function callAiCorrectionStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = { disclaimer: DISCLAIMER, aiStage: "language-correction" };
  if (!String(body.essay || "").trim()) {
    const error = new Error("AI language-correction stage cannot run because the essay is empty.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = "language-correction";
    error.status = 400;
    throw error;
  }

  const correction = await callAiCorrectionPass({
    apiKey,
    model,
    body: { ...body, mode: effectiveMode, currentOverallBand: body.currentOverallBand || body.overallBand },
    effectiveMode,
    locale,
    deadline,
    maxTokensOverride: Math.min(
      Math.max(correctionLimitForEssay(body, effectiveMode) * 280, (Number(body.wordCount) || countWordsServer(body.essay)) < 80 ? 4200 : 7600),
      effectiveMode === "revision" ? 12000 : 9500
    ),
    timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(60000, Number(process.env.AI_CORRECTION_TIMEOUT_MS) || 90000))
  });
  output = mergeAiCorrectionDetails(output, correction, body, effectiveMode);

  output = await ensureAiCorrectionDetails({
    result: output,
    apiKey,
    model,
    body: { ...body, currentOverallBand: body.currentOverallBand || body.overallBand },
    gradingMode: effectiveMode,
    locale,
    deadline
  });

  if (!hasAiCorrectionContent(output) && !hasUsefulText(output.errorAnalysis?.summary)) {
    const error = new Error("AI language-correction stage returned no usable correction content.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = "language-correction";
    error.status = 502;
    throw error;
  }

  output.overallBand = body.currentOverallBand || body.overallBand || body.currentResult?.overallBand;
  output.criteria = body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : output.criteria;
  output.aiStage = "language-correction";
  output.disclaimer = DISCLAIMER;
  return output;
}


function mergeStagePayloadForEvidencePlan(output, payload) {
  const target = output && typeof output === "object" ? output : {};
  const data = payload && typeof payload === "object" ? payload : {};
  const arrayFields = [
    "taskAchievementAdvice", "taskAchievementAdviceZh", "coherenceAdvice", "coherenceAdviceZh",
    "lexicalAdvice", "lexicalAdviceZh", "grammarAdvice", "grammarAdviceZh",
    "band5FixPlan", "band5FixPlanZh", "band6UpgradePlan", "band6UpgradePlanZh", "band7UpgradePlan", "band7UpgradePlanZh",
    "strengths", "strengthsZh", "mainProblems", "mainProblemsZh", "stageWarnings"
  ];
  const objectFields = [
    "taskRequirementAnalysis", "taskRequirementAnalysisZh", "task1LetterCorrections", "task2EssayCorrections",
    "correctionPriority", "targetImprovementPlan", "errorAnalysis", "scoreCalibration", "scoreCalibrationZh"
  ];
  arrayFields.forEach((field) => {
    const incoming = ensureArray(data[field]).filter(Boolean);
    if (incoming.length) target[field] = incoming;
  });
  objectFields.forEach((field) => {
    if (data[field] && typeof data[field] === "object") {
      target[field] = { ...(target[field] && typeof target[field] === "object" ? target[field] : {}), ...data[field] };
    }
  });
  if (data.criteria && typeof data.criteria === "object") {
    target.criteria = target.criteria && typeof target.criteria === "object" ? target.criteria : {};
    Object.entries(data.criteria).forEach(([name, incoming]) => {
      if (!incoming || typeof incoming !== "object") return;
      const existing = target.criteria[name] && typeof target.criteria[name] === "object" ? target.criteria[name] : {};
      target.criteria[name] = {
        ...existing,
        ...incoming,
        band: existing.band ?? incoming.band,
        feedback: existing.feedback || incoming.feedback || "",
        feedbackZh: existing.feedbackZh || incoming.feedbackZh || "",
        howToImprove: existing.howToImprove || incoming.howToImprove || "",
        howToImproveZh: existing.howToImproveZh || incoming.howToImproveZh || ""
      };
    });
  }
  return target;
}

async function callAiEvidencePlanStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  const output = await callAiEvidenceMapStageOnly({ apiKey, model, body, effectiveMode, locale, deadline });
  output.aiStage = "evidence-plan";
  return output;
}


async function callAiEvidenceMapStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = {
    disclaimer: DISCLAIMER,
    aiStage: "evidence-map",
    overallBand: body.currentOverallBand || body.overallBand || body.currentResult?.overallBand,
    criteria: body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : undefined
  };

  const taskPass = await callAiFocusedSectionStageOnly({
    apiKey,
    model,
    body,
    effectiveMode: effectiveMode === "revision" ? "revision" : "full",
    section: "task",
    locale,
    deadline
  });

  output = mergeStagePayloadForEvidencePlan(output, taskPass);
  output = mergeAiCorrectionDetails(output, taskPass, body, effectiveMode);
  output.aiStage = "evidence-map";
  output.disclaimer = DISCLAIMER;
  return output;
}

async function callAiFinalPlanStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = {
    disclaimer: DISCLAIMER,
    aiStage: "final-plan",
    overallBand: body.currentOverallBand || body.overallBand || body.currentResult?.overallBand,
    criteria: body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : undefined,
    taskRequirementAnalysis: body.currentResult?.taskRequirementAnalysis,
    taskMatchCheck: body.currentResult?.taskMatchCheck
  };

  const advicePass = await callAiFocusedSectionStageOnly({
    apiKey,
    model,
    body,
    effectiveMode: effectiveMode === "revision" ? "revision" : "full",
    section: "advice",
    locale,
    deadline
  });

  output = mergeStagePayloadForEvidencePlan(output, advicePass);
  output = mergeAiCorrectionDetails(output, advicePass, body, effectiveMode);
  output.aiStage = "final-plan";
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

  const correctionTimeout = safePassTimeout(
    deadline,
    Math.max(60000, Number(process.env.AI_CORRECTION_TIMEOUT_MS) || 90000),
    60000
  );

  if (hasEnoughAiTime(deadline, correctionTimeout)) {
    try {
      const correction = await callAiCorrectionPass({
        apiKey,
        model,
        body: { ...body, mode: gradingMode, currentOverallBand: result?.overallBand },
        effectiveMode: gradingMode,
        locale,
        deadline,
        timeoutMs: correctionTimeout
      });
      result = mergeAiCorrectionDetails(result, correction, body, gradingMode);
    } catch (correctionError) {
      const canRetryCorrection = !isDeepSeekTimeoutError(correctionError) &&
        hasEnoughAiTime(deadline, Math.max(12000, Number(process.env.AI_CORRECTION_RETRY_TIMEOUT_MS) || 18000));

      if (canRetryCorrection) {
        try {
          const correctionRetry = await callAiCorrectionPass({
            apiKey,
            model,
            body: { ...body, mode: gradingMode, currentOverallBand: result?.overallBand },
            effectiveMode: gradingMode,
            locale,
            deadline,
            maxTokensOverride: 4200,
            timeoutMs: safePassTimeout(deadline, Math.max(12000, Number(process.env.AI_CORRECTION_RETRY_TIMEOUT_MS) || 18000), 12000)
          });
          result = mergeAiCorrectionDetails(result, correctionRetry, body, gradingMode);
        } catch {
          result = markAiPassDeferred(result, "AI correction retry did not complete. The AI score was returned first; retry the correction stage for the remaining detail.");
        }
      } else {
        result = markAiPassDeferred(
          result,
          isDeepSeekEmptyResponseError(correctionError)
            ? "AI correction pass returned empty content. The AI score was returned first; retry the correction stage for full detail."
            : "AI correction pass timed out. The AI score was returned first; retry the correction stage for full detail."
        );
      }
    }
  } else {
    result = markAiPassDeferred(result, "Not enough protected server time remained for AI detailed correction. The AI score was returned first; retry the correction stage for full detail.");
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
  const clean = (value) => String(value || "")
    .replace(/^[-*•·]\s+/, "")
    .replace(/^(\d+)[.)]\s+/, "")
    .replace(/^and\s+/i, "")
    .replace(/[.;:,\s]+$/g, "")
    .trim();

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines
    .filter((line) => /^[-*•·]\s+/.test(line) || /^(\d+)[.)]\s+/.test(line))
    .map(clean)
    .filter(Boolean);
  if (bulletLines.length) return bulletLines.slice(0, 5);

  const afterInYourLetter = text.split(/In your letter[:,]?/i)[1] || text.split(/You should/i)[1] || "";
  const candidateSource = afterInYourLetter || text;
  let candidates = candidateSource
    .split(/\r?\n|;/)
    .map(clean)
    .filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|apologize|thank|invite|offer|request|remind|include|state|mention|why|what|how)/i.test(part));

  if (!candidates.length) {
    const matches = [];
    const pattern = /(?:^|[.;:\n])\s*(say|tell|explain|describe|suggest|ask|give|thank|apologise|apologize|invite|offer|request|state|mention)\b[^.\n;]+/gi;
    let match;
    while ((match = pattern.exec(candidateSource)) && matches.length < 5) {
      matches.push(clean(match[0]));
    }
    candidates = matches;
  }

  return candidates.filter(Boolean).slice(0, 5);
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

function isMockCombineRequest(body) {
  const raw = String(body?.mode || body?.aiStage || body?.stage || "").toLowerCase().replace(/[_\s-]+/g, "");
  return ["mock", "mockwriting", "mockcombine", "mockexam", "writingmock", "combinewriting"].includes(raw) && (body.task1Result || body.task2Result || body.task1Band || body.task2Band);
}

function normalizeMockTaskResult(taskResult, task) {
  if (!taskResult || typeof taskResult !== "object") return null;
  const copy = { ...taskResult, task };
  if (copy.criteria && typeof copy.criteria === "object" && Object.keys(copy.criteria).length) {
    normalizeTaskSpecificCriteria(copy, task);
    const hasEssayEvidence = String(taskResult.essay || "").trim() || Number(taskResult.actualWordCount || taskResult.wordCount) > 0;
    if (hasEssayEvidence) {
      finalizeTaskScoringEngine(copy, { task, essay: taskResult.essay || "", wordCount: Number(taskResult.actualWordCount || taskResult.wordCount) || 0 });
    } else {
      const finalBand = calculateTaskBandFromCriteria(copy, task);
      copy.overallBand = finalBand;
      copy.estimatedLevel = `Band ${formatBand(finalBand)}`;
      copy.scoreCalculation = buildScoreCalculation(copy, task, finalBand);
    }
  } else {
    copy.overallBand = clampAiBand(copy.overallBand || copy.overallEstimatedBand, 1);
    copy.estimatedLevel = `Band ${formatBand(copy.overallBand)}`;
  }
  return copy;
}

function handleMockCombineRequest(req, res, body) {
  const task1Result = normalizeMockTaskResult(body.task1Result || { overallBand: body.task1Band, criteria: body.task1Criteria || {} }, "Task 1");
  const task2Result = normalizeMockTaskResult(body.task2Result || { overallBand: body.task2Band, criteria: body.task2Criteria || {} }, "Task 2");
  const task1Band = clampAiBand(task1Result?.overallBand ?? body.task1Band, 1);
  const task2Band = clampAiBand(task2Result?.overallBand ?? body.task2Band, 1);
  const mockScore = buildMockWritingScore({ overallBand: task1Band }, { overallBand: task2Band });
  sendJson(req, res, 200, {
    aiStage: "mock-combine",
    scoringSystem: {
      type: "mock_writing_combined_system",
      task1Engine: "task1_gt_letter_practice_engine",
      task2Engine: "task2_essay_practice_engine",
      finalBandSource: "weighted_task1_task2_combination"
    },
    mockWritingScore: mockScore,
    overallBand: mockScore.mockWritingBand,
    estimatedLevel: mockScore.estimatedLevel,
    task1Result,
    task2Result,
    scoreCalculation: {
      method: "mock_writing_weighted_combination",
      formula: "roundToHalf((Task 1 Band + Task 2 Band × 2) / 3)",
      task1Band,
      task2Band,
      rawWeightedAverage: mockScore.rawWeightedAverage,
      finalBand: mockScore.mockWritingBand
    },
    disclaimer: DISCLAIMER
  });
}



/* --------------------------------------------------------------------------
 * AI-ONLY GRADING CONTRACT
 * --------------------------------------------------------------------------
 * The app is an AI grading system. Server-side code may:
 *   - count words / identify task type,
 *   - validate JSON shape,
 *   - merge AI stage payloads,
 *   - calculate the displayed overall band from AI-returned criterion bands.
 *
 * Server-side code must NOT:
 *   - score, cap, lift, or lower bands from essay-content heuristics,
 *   - create local feedback, evidence, sentence corrections, grammar errors,
 *     spelling lists, better expressions, or study plans,
 *   - replace missing AI content with non-AI fallback content.
 */

function aiOnlyCloneObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function aiOnlyArray(value, limit = 50) {
  return ensureArray(value).filter((item) => item !== null && item !== undefined && item !== "").slice(0, limit);
}

function aiOnlyCriterionFromSource(source = {}) {
  const item = aiOnlyCloneObject(source);
  const out = {};
  if (Number.isFinite(Number(item.band))) out.band = clampAiBand(item.band, 1);
  [
    "feedback", "feedbackZh", "howToImprove", "howToImproveZh",
    "whyThisBand", "whyThisBandZh", "whyNotHigher", "whyNotHigherZh",
    "whyNotLower", "whyNotLowerZh"
  ].forEach((key) => {
    if (typeof item[key] === "string" && item[key].trim()) out[key] = item[key];
  });
  [
    "evidence", "evidenceZh", "positiveEvidence", "positiveEvidenceZh",
    "limitingEvidence", "limitingEvidenceZh", "evidenceQuotes", "evidenceQuotesZh"
  ].forEach((key) => {
    const arr = aiOnlyArray(item[key], /quotes/i.test(key) ? 3 : 8);
    if (arr.length) out[key] = arr;
  });
  Object.entries(item).forEach(([key, value]) => {
    if (typeof out[key] !== "undefined") return;
    if (key === "band" || key.endsWith("Zh") || key.includes("Evidence") || key.includes("evidence")) return;
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  });
  return out;
}

function normalizeTaskSpecificCriteria(result, task) {
  if (!result || typeof result !== "object") return result;
  const normalizedTask = task === "Task 1" ? "Task 1" : "Task 2";
  const wanted = getWritingCriterionNames(normalizedTask);
  const wrongFirst = normalizedTask === "Task 1" ? "Task Response" : "Task Achievement";
  const criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  const fixed = {};
  wanted.forEach((name) => {
    const source = criteria[name] || (name === wanted[0] ? criteria[wrongFirst] : null);
    if (!source || typeof source !== "object") return;
    const normalized = aiOnlyCriterionFromSource(source);
    if (Object.keys(normalized).length) fixed[name] = normalized;
  });
  result.criteria = fixed;
  return result;
}

function getCriterionBandsForTask(result, task) {
  normalizeTaskSpecificCriteria(result, task);
  return getWritingCriterionNames(task)
    .map((name) => Number(result?.criteria?.[name]?.band))
    .filter(Number.isFinite)
    .map((band) => clampAiBand(band, 1));
}

function aiOnlyHasFourCriterionBands(result, task) {
  const criteria = result?.criteria && typeof result.criteria === "object" ? result.criteria : {};
  return getWritingCriterionNames(task).every((name) => Number.isFinite(Number(criteria?.[name]?.band)));
}

function calculateTaskBandFromCriteria(result, task) {
  const bands = getCriterionBandsForTask(result, task);
  if (bands.length !== 4) {
    const aiOverall = Number(result?.overallBand);
    return Number.isFinite(aiOverall) ? clampAiBand(aiOverall, 1) : undefined;
  }
  return roundHalf(bands.reduce((sum, band) => sum + band, 0) / 4);
}

function buildScoreCalculation(result, task, finalBand) {
  const names = getWritingCriterionNames(task);
  const criteriaBands = names
    .map((name) => {
      const band = Number(result?.criteria?.[name]?.band);
      return Number.isFinite(band) ? { criterion: name, band: clampAiBand(band, 1) } : null;
    })
    .filter(Boolean);
  const rawAverage = criteriaBands.length === 4
    ? criteriaBands.reduce((sum, item) => sum + Number(item.band || 0), 0) / 4
    : null;
  return {
    mode: getTaskScoringEngineName(task),
    method: "ai_criterion_average_only",
    formula: "AI-returned four IELTS criterion bands averaged and rounded to nearest 0.5",
    criteriaBands,
    rawAverage: rawAverage === null ? null : Number(rawAverage.toFixed(3)),
    finalBand: Number.isFinite(Number(finalBand)) ? finalBand : null,
    explanation: "The server does not grade the essay. It only averages the criterion bands returned by AI."
  };
}

function finalizeTaskScoringEngine(result, body = {}) {
  if (!result || typeof result !== "object") return result;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  normalizeTaskSpecificCriteria(result, task);

  const finalBand = calculateTaskBandFromCriteria(result, task);
  if (Number.isFinite(Number(finalBand))) {
    result.overallBand = roundHalf(finalBand);
    result.estimatedLevel = `Band ${formatBand(result.overallBand)}`;
    result.scoreCalculation = buildScoreCalculation(result, task, result.overallBand);
  }

  result.scoringSystem = {
    ...(result.scoringSystem && typeof result.scoringSystem === "object" ? result.scoringSystem : {}),
    type: getTaskScoringEngineName(task),
    scorer: "ai_only",
    serverScoringDisabled: true
  };
  result.actualWordCount = Number(body?.wordCount) || countWordsServer(body?.essay);
  result.wordCountThresholdUsed = task === "Task 1" ? 150 : 250;
  result.disclaimer = result.disclaimer || DISCLAIMER;
  return result;
}

function normalizeAiBandsOnly(result, body) {
  return finalizeTaskScoringEngine(result, body || {});
}

function normalizeResultForMode(result, mode, veryShort, body, locale = "en") {
  const normalized = result && typeof result === "object" ? { ...result } : {};
  normalized.disclaimer = normalized.disclaimer || DISCLAIMER;
  normalized.actualWordCount = Number(body?.wordCount) || countWordsServer(body?.essay);
  normalized.wordCountThresholdUsed = body?.task === "Task 1" ? 150 : 250;
  normalized.wordCountStatus = normalized.wordCountStatus || "";
  finalizeTaskScoringEngine(normalized, body || {});
  if (mode !== "revision") {
    normalized.revisedEssayBand5 = normalized.revisedEssayBand5 || "";
    normalized.revisedEssayBand6 = normalized.revisedEssayBand6 || "";
    normalized.revisedEssayBand7 = normalized.revisedEssayBand7 || "";
  }
  return normalized;
}

function finalQualityGate(result, body = {}) {
  return finalizeTaskScoringEngine(result, body || {});
}

function normalizeDetailedSentenceCorrectionItem(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const originalSentence = pickFirstUsefulValue(item, ["originalSentence", "original", "sentence", "sourceSentence", "wrong", "inputSentence", "before"]);
  const correctedSentence = pickFirstUsefulValue(item, ["correctedSentence", "corrected", "correction", "fixed", "right", "revisedSentence", "after"]);
  const betterExpression = pickFirstUsefulValue(item, [
    "betterExpression", "improvedSentence", "naturalExpression", "upgrade", "better",
    "targetBandExpression", "targetExpression", "bandTargetExpression", "modelExpression",
    "polishedSentence", "highBandExpression", "exampleUpgrade", "betterSentence"
  ]);
  const out = {
    ...item,
    sentenceNumber: Number(item.sentenceNumber || item.number || item.index || index + 1) || index + 1,
    originalSentence,
    correctedSentence,
    errorType: pickFirstUsefulValue(item, ["errorType", "type", "category", "ruleType"]) || "",
    errorTypeZh: pickFirstUsefulValue(item, ["errorTypeZh", "typeZh", "categoryZh"]) || "",
    problem: pickFirstUsefulValue(item, ["problem", "explanation", "reason", "comment"]) || "",
    problemZh: pickFirstUsefulValue(item, ["problemZh", "explanationZh", "reasonZh", "commentZh"]) || "",
    rule: pickFirstUsefulValue(item, ["rule", "grammarRule", "howToFix"]) || "",
    ruleZh: pickFirstUsefulValue(item, ["ruleZh", "grammarRuleZh", "howToFixZh"]) || "",
    betterExpression,
    betterExpressionZh: pickFirstUsefulValue(item, ["betterExpressionZh", "improvedSentenceZh", "naturalExpressionZh", "upgradeZh", "targetBandExpressionZh"]) || "",
    bandImpact: pickFirstUsefulValue(item, ["bandImpact", "impactOnBand", "scoreImpact"]) || "",
    bandImpactZh: pickFirstUsefulValue(item, ["bandImpactZh", "impactOnBandZh", "scoreImpactZh"]) || "",
    scoreImpacting: item.scoreImpacting === undefined ? true : item.scoreImpacting !== false && String(item.scoreImpacting).toLowerCase() !== "false",
    whyThisAffectsBand: pickFirstUsefulValue(item, ["whyThisAffectsBand", "whyAffectsBand", "scoreReason"]) || "",
    betterExpressionTargetBand: pickFirstUsefulValue(item, ["betterExpressionTargetBand", "targetBandRange", "targetRange", "targetBand"]) || ""
  };
  if (!hasUsefulText(out.originalSentence) && !hasUsefulText(out.correctedSentence) && !hasUsefulText(out.problem) && !hasUsefulText(out.rule) && !hasUsefulText(out.betterExpression)) return null;
  return out;
}

async function ensureAiCorrectionDetails({ result, apiKey, model, body, gradingMode, locale, deadline }) {
  let output = result && typeof result === "object" ? result : {};
  if (!String(body?.essay || "").trim()) return output;
  if (hasConcreteAiCorrectionItems(output)) return output;

  const focusedCorrectionTimeout = safePassTimeout(
    deadline,
    Math.max(30000, Number(process.env.AI_FOCUSED_CORRECTION_TIMEOUT_MS) || 45000),
    30000
  );

  if (!hasEnoughAiTime(deadline, focusedCorrectionTimeout)) {
    const warning = "AI detailed correction was not returned before the server deadline. No non-AI correction was generated.";
    output.correctionWarning = warning;
    output.correctionPassWarning = warning;
    output.stageWarnings = aiOnlyArray(output.stageWarnings).concat([warning]);
    return output;
  }

  try {
    const focusedCorrection = await callAiFocusedCorrectionPass({
      apiKey,
      model,
      body: { ...body, mode: gradingMode, correctionRetryAttempt: 1 },
      effectiveMode: gradingMode,
      locale,
      deadline,
      timeoutMs: focusedCorrectionTimeout
    });

    if (hasAiCorrectionContent(focusedCorrection)) {
      output = mergeAiCorrectionDetails(output, focusedCorrection, body, gradingMode);
      if (hasConcreteAiCorrectionItems(output)) {
        output.correctionWarning = "";
        output.correctionPassWarning = "";
        return output;
      }
    }
  } catch (error) {
    const warning = `AI detailed correction retry failed: ${error.message || error.name || "unknown error"}. No non-AI correction was generated.`;
    output.correctionWarning = warning;
    output.correctionPassWarning = warning;
    output.stageWarnings = aiOnlyArray(output.stageWarnings).concat([warning]);
    return output;
  }

  const warning = "AI did not return concrete sentence-level corrections. No non-AI correction was generated.";
  output.correctionWarning = warning;
  output.correctionPassWarning = warning;
  output.stageWarnings = aiOnlyArray(output.stageWarnings).concat([warning]);
  return output;
}

async function callAiScoreOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  const gradingMode = effectiveMode === "revision" ? "full" : effectiveMode;
  const attempts = [
    { label: "High-quality AI scoring", fn: callAiLeanScoringPass },
    { label: "No-template AI scoring retry", fn: callAiNoTemplateScoringPass },
    { label: "Compact AI scoring retry", fn: callAiCompactScoringRetry },
    { label: "Minimal AI scoring retry", fn: callAiMinimalScoringPass }
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      let result = await attempt.fn({ apiKey, model, body, gradingMode, locale, deadline });
      result = assertMeaningfulAiScoringResult(result, body, attempt.label);
      result = normalizeResultForMode(result, "full", veryShort, body, locale);
      if (!aiOnlyHasFourCriterionBands(result, body.task === "Task 1" ? "Task 1" : "Task 2")) {
        throw new Error(`${attempt.label} did not return all four AI criterion bands.`);
      }
      if (errors.length) {
        result.stageWarnings = aiOnlyArray(result.stageWarnings).concat([
          `AI-only scoring used ${attempt.label} after earlier AI attempts failed.`
        ]);
      }
      result.aiStage = "score";
      result.disclaimer = result.disclaimer || DISCLAIMER;
      return result;
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message || error.name || String(error)}`);
      if (remainingAiTime(deadline) < 9000) break;
    }
  }
  const finalError = new Error(`AI core scoring failed. No non-AI score was generated. ${errors.join(" | ")}`);
  finalError.name = "AiOnlyScoringFailed";
  finalError.provider = "deepseek";
  throw finalError;
}

async function callAiCorrectionStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = { disclaimer: DISCLAIMER, aiStage: "language-correction" };
  if (!String(body.essay || "").trim()) {
    const error = new Error("AI language-correction stage cannot run because the essay is empty.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = "language-correction";
    error.status = 400;
    throw error;
  }

  const correction = await callAiCorrectionPass({
    apiKey,
    model,
    body: { ...body, mode: effectiveMode, currentOverallBand: body.currentOverallBand || body.overallBand },
    effectiveMode,
    locale,
    deadline,
    maxTokensOverride: Math.min(
      Math.max(correctionLimitForEssay(body, effectiveMode) * 280, (Number(body.wordCount) || countWordsServer(body.essay)) < 80 ? 4200 : 7600),
      effectiveMode === "revision" ? 12000 : 9500
    ),
    timeoutMs: Math.min(AI_SINGLE_REQUEST_TIMEOUT_MS, Math.max(60000, Number(process.env.AI_CORRECTION_TIMEOUT_MS) || 90000))
  });
  output = mergeAiCorrectionDetails(output, correction, body, effectiveMode);

  output = await ensureAiCorrectionDetails({
    result: output,
    apiKey,
    model,
    body: { ...body, currentOverallBand: body.currentOverallBand || body.overallBand },
    gradingMode: effectiveMode,
    locale,
    deadline
  });

  if (!hasAiCorrectionContent(output) && !hasUsefulText(output.errorAnalysis?.summary)) {
    const error = new Error("AI language-correction stage returned no usable correction content.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = "language-correction";
    error.status = 502;
    throw error;
  }

  output.overallBand = body.currentOverallBand || body.overallBand || body.currentResult?.overallBand;
  output.criteria = body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : output.criteria;
  output.aiStage = "language-correction";
  output.disclaimer = DISCLAIMER;
  return output;
}

async function callAiEvidenceMapStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = {
    disclaimer: DISCLAIMER,
    aiStage: "evidence-map",
    overallBand: body.currentOverallBand || body.overallBand || body.currentResult?.overallBand,
    criteria: body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : undefined
  };

  const taskPass = await callAiFocusedSectionStageOnly({
    apiKey,
    model,
    body,
    effectiveMode: effectiveMode === "revision" ? "revision" : "full",
    section: "task",
    locale,
    deadline
  });

  output = mergeStagePayloadForEvidencePlan(output, taskPass);
  output = mergeAiCorrectionDetails(output, taskPass, body, effectiveMode);
  output.aiStage = "evidence-map";
  output.disclaimer = DISCLAIMER;
  return output;
}

async function callAiEvidencePlanStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  const output = await callAiEvidenceMapStageOnly({ apiKey, model, body, effectiveMode, locale, deadline });
  output.aiStage = "evidence-plan";
  return output;
}

async function callAiFinalPlanStageOnly({ apiKey, model, body, effectiveMode, locale, deadline }) {
  let output = {
    disclaimer: DISCLAIMER,
    aiStage: "final-plan",
    overallBand: body.currentOverallBand || body.overallBand || body.currentResult?.overallBand,
    criteria: body.currentResult?.criteria && typeof body.currentResult.criteria === "object" ? body.currentResult.criteria : undefined,
    taskRequirementAnalysis: body.currentResult?.taskRequirementAnalysis,
    taskMatchCheck: body.currentResult?.taskMatchCheck
  };

  const advicePass = await callAiFocusedSectionStageOnly({
    apiKey,
    model,
    body,
    effectiveMode: effectiveMode === "revision" ? "revision" : "full",
    section: "advice",
    locale,
    deadline
  });

  output = mergeStagePayloadForEvidencePlan(output, advicePass);
  output = mergeAiCorrectionDetails(output, advicePass, body, effectiveMode);
  output.aiStage = "final-plan";
  output.disclaimer = DISCLAIMER;
  return output;
}

async function callAiOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline }) {
  let result = await callAiScoreOnlyGrader({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline });
  if (effectiveMode === "revision") {
    const revision = await callAiRevisionStageOnly({ apiKey, model, body, effectiveMode, veryShort, maxTokens, locale, deadline });
    result = mergeRevisionPassIntoResult(result, revision);
  }
  return normalizeResultForMode(result, effectiveMode, veryShort, body, locale);
}




// --- AI-only 10-step grading stages (maximum-detail, no local scoring) ---
const TEN_STEP_AI_STAGES = new Set([
  "prompt-analysis",
  "half-band-summary",
  "criterion-boundary",
  "evidence-map",
  "task-diagnosis",
  "coherence-diagnosis",
  "spelling-wordform",
  "lexical-choice-collocation",
  "grammar-diagnosis",
  "sentence-corrections",
  "better-expressions",
  "final-plan",
  // Backward-compatible stage names still accepted.
  "score-boundary",
  "lexical-diagnosis",
  "better-expression-plan"
]);

function normalizeAiStage(value) {
  const raw = String(value || "all").toLowerCase().replace(/[_\s-]+/g, "");
  if (["promptanalysis", "requirementanalysis", "questionanalysis", "taskrequirementanalysis", "stage1", "step1"].includes(raw)) return "prompt-analysis";
  if (["score", "scoring", "grade", "grading", "corescore", "corescoring", "stage2", "step2"].includes(raw)) return "score";
  if (["halfbandsummary", "overallboundary", "overallscoreboundary", "scoreboundarysummary", "stage3", "step3"].includes(raw)) return "half-band-summary";
  if (["criterionboundary", "criterionboundaries", "scoreboundary", "halfbandboundary", "halfband", "bandboundary", "boundary", "scoreexplanation", "stage4", "step4"].includes(raw)) return "criterion-boundary";
  if (["evidencemap", "evidencediagnostic", "diagnosticmap", "scoreevidence", "scoringevidence", "evidence", "stage5", "step5"].includes(raw)) return "evidence-map";
  if (["taskdiagnosis", "taskresponse", "taskachievement", "taskstructure", "taskcoverage", "promptcoverage", "stage6", "step6"].includes(raw)) return "task-diagnosis";
  if (["coherencediagnosis", "coherence", "cohesion", "coherenceandcohesion", "ccdiagnosis", "stage7", "step7"].includes(raw)) return "coherence-diagnosis";
  if (["spellingwordform", "spellingandwordform", "spelling", "wordform", "wordformation", "stage8", "step8"].includes(raw)) return "spelling-wordform";
  if (["lexicalchoicecollocation", "lexicaldiagnosis", "lexical", "lexicalresource", "vocabulary", "wordchoice", "collocation", "repetition", "stage9", "step9"].includes(raw)) return "lexical-choice-collocation";
  if (["grammardiagnosis", "grammar", "gra", "grammaticalrangeandaccuracy", "grammaraccuracy", "stage10", "step10"].includes(raw)) return "grammar-diagnosis";
  if (["sentencecorrections", "sentencecorrection", "sentences", "sentence", "detailedsentence", "stage11", "step11"].includes(raw)) return "sentence-corrections";
  if (["betterexpressions", "betterexpression", "betterexpressionitems", "targetexpression", "stage12", "step12"].includes(raw)) return "better-expressions";
  if (["finalplan", "studyplan", "improvementplan", "plan", "adviceplan", "finalstudyplan", "betterexpressionplan", "stage13", "step13"].includes(raw)) return "final-plan";
  if (["revision", "model", "modelanswer", "revisedessay", "stage14", "step14"].includes(raw)) return "revision";
  if (["languagecorrection", "language", "languagestage", "correctionlanguage", "grammarvocabularysentence", "grammarandsentence"].includes(raw)) return "language-correction";
  if (["evidenceplan", "evidenceandplan", "planandevidence"].includes(raw)) return "evidence-plan";
  const focused = normalizeFocusedCorrectionStage(raw);
  if (focused) return `correction-${focused}`;
  if (["correction", "corrections", "error", "errors", "detailedcorrection", "detailedcorrections"].includes(raw)) return "correction";
  return "all";
}

function tenStepCriterionShape(task) {
  const first = firstCriterionName(task);
  return {
    [first]: { evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "", feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
    "Coherence and Cohesion": { evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "", feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
    "Lexical Resource": { evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "", feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
    "Grammatical Range and Accuracy": { evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "", feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
  };
}

function buildTenStepSystemPrompt(stage, locale = "en") {
  const chineseRule = isChineseLocale(locale)
    ? "Use English for normal feedback fields and concise Chinese helper notes only in fields ending with Zh. Do not translate the full essay."
    : "Main fields must be English. Put concise, accurate Chinese helper notes only in fields ending with Zh. Match the adjacent English field. Do not translate the full essay.";
  const stageNames = {
    "prompt-analysis": "question requirement analysis only",
    "half-band-summary": "overall half-band boundary summary only",
    "criterion-boundary": "one-criterion-at-a-time half-band boundary explanation only",
    "score-boundary": "IELTS half-band boundary explanation only",
    "evidence-map": "criterion evidence mapping only",
    "task-diagnosis": "Task Response/Task Achievement diagnosis only",
    "coherence-diagnosis": "Coherence and Cohesion diagnosis only",
    "spelling-wordform": "spelling and word-formation diagnosis only",
    "lexical-choice-collocation": "word choice, collocation, repetition, and lexical precision diagnosis only",
    "lexical-diagnosis": "Lexical Resource diagnosis only",
    "grammar-diagnosis": "Grammatical Range and Accuracy diagnosis only",
    "sentence-corrections": "sentence-level direct corrections only",
    "better-expressions": "single-sentence upgraded better expressions only",
    "final-plan": "correction priority and final study plan only",
    "better-expression-plan": "single-sentence better expressions and final study plan only"
  };
  return [
    `You are a strict IELTS Writing examiner. This AI pass is ONLY for ${stageNames[stage] || stage}.`,
    "Do not perform any local or rule-based scoring. All essay judgements must be AI examiner judgements.",
    "Return exactly one valid JSON object. No markdown. No code fences. No trailing commas.",
    "Keep this stage focused. Do not include other stages' work.",
    "Use only content from the user's essay for original text, evidence, and quotes. Do not invent user sentences.",
    "Give concrete, evidence-based feedback; avoid vague templates.",
    chineseRule
  ].join(" ");
}

function buildTenStepStagePrompt(body, mode, stage, locale = "en") {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const currentResultText = body.currentResult ? JSON.stringify(body.currentResult).slice(0, 5500) : "{}";
  const common = [
    `Task: ${task}`,
    `Mode: ${mode}`,
    `Actual word count: ${words}`,
    `Current AI score/result from earlier stages: ${currentResultText}`,
    buildTaskSpecificScoringRubric(task),
    buildTargetImprovementInstruction(body),
    "Question prompt:",
    String(body.questionPrompt || ""),
    "User essay:",
    String(body.essay || "")
  ];

  if (stage === "prompt-analysis") {
    return [
      "Stage 1/10. Analyse the prompt requirements only. Do not score and do not correct sentences.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        taskRequirementAnalysis: task === "Task 1"
          ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [{ requirement: "", required: true, coverageMustBeCheckedByAi: true }], missingRequirements: [], taskMatchSummary: "" }
          : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: null, mainIdeasRelevant: null, missingRequirements: [], taskMatchSummary: "" },
        taskRequirementAnalysisZh: { taskPurposeZh: "", requiredToneZh: "", letterTypeZh: "", taskMatchSummaryZh: "", bulletPointsZh: [], requiredPartsZh: [] },
        taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "", warning: "" },
        wordCountWarning: { message: "", messageZh: "" }
      }),
      "For Task 1, list each bullet point or required function. For Task 2, list each question part and whether an opinion/position is required.",
      ...common
    ].join("\n");
  }

  if (stage === "half-band-summary") {
    return [
      "Stage 3/13. Explain the overall score and half-band boundary summary only. Do not change any score and do not correct sentences.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
        scoreCalibrationZh: { capReasonZh: "", whyNotHigherZh: "", whyNotLowerZh: "", evidenceZh: [] },
        halfBandBoundary: { summary: "", summaryZh: "", overallAverage: "", finalBand: "", roundingExplanation: "", roundingExplanationZh: "" },
        strengthItems: [{ text: "", zh: "" }],
        mainProblemItems: [{ text: "", zh: "" }]
      }),
      "Explain the final band and the 0.5 boundary. Keep it concise but concrete. Every English item must include a Chinese helper field in the paired object or *Zh field.",
      ...common
    ].join("\n");
  }

  if (stage === "criterion-boundary") {
    return [
      "Stage 4/13. Explain detailed half-band boundaries criterion by criterion. This non-batched prompt is a fallback; prefer the internal criterion batches when available. Do not change criterion bands.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: tenStepCriterionShape(task),
        halfBandBoundary: { criterionBoundaries: [{ criterion: "", currentBand: "", lowerBoundary: "", upperBoundary: "", whyThisHalfBand: "", whyThisHalfBandZh: "" }] }
      }),
      "For every criterion, explain why this exact band is correct, why not 0.5 higher, and why not 0.5 lower. Do not write a generic band number that conflicts with the actual band.",
      ...common
    ].join("\n");
  }

  if (stage === "score-boundary") {
    return [
      "Stage 3/10. Explain the half-band boundaries for the AI score already returned. Do not change criterion bands.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: tenStepCriterionShape(task),
        scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
        scoreCalibrationZh: { capReasonZh: "", whyNotHigherZh: "", whyNotLowerZh: "", evidenceZh: [] },
        halfBandBoundary: { summary: "", summaryZh: "", criterionBoundaries: [{ criterion: "", currentBand: "", lowerBoundary: "", upperBoundary: "", whyThisHalfBand: "", whyThisHalfBandZh: "" }] }
      }),
      "For every criterion, explain why the current band is correct, why not 0.5 higher, and why not 0.5 lower. Use concrete essay evidence. Do not write 'typical of Band 5' if the current band is 5.5 or 4.0; match the exact band.",
      ...common
    ].join("\n");
  }

  if (stage === "evidence-map") {
    return [
      "Stage 4/10. Map essay evidence to the four IELTS criteria. Do not give new scores and do not correct sentences.",
      "Return JSON with this exact shape:",
      JSON.stringify({ criteria: tenStepCriterionShape(task), strengthItems: [{ text: "", zh: "" }], mainProblemItems: [{ text: "", zh: "" }], strengths: [], strengthsZh: [], mainProblems: [], mainProblemsZh: [] }),
      "For each criterion, provide 2-3 short evidenceQuotes from the essay, positiveEvidence, limitingEvidence, whyThisBand, whyNotHigher, and whyNotLower. Also return strengthItems and mainProblemItems as paired objects where every English text has a non-empty zh Chinese helper note. If you also use strengths/strengthsZh or mainProblems/mainProblemsZh, their item counts must match exactly.",
      ...common
    ].join("\n");
  }

  if (stage === "task-diagnosis") {
    return [
      "Stage 5/10. Diagnose Task Response/Task Achievement and task-specific structure only. Do not do grammar, vocabulary, or sentence correction.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        taskAchievementAdvice: [], taskAchievementAdviceZh: [],
        task1LetterCorrections: task === "Task 1" ? { openingComment: "", openingCommentZh: "", closingComment: "", closingCommentZh: "", toneComment: "", toneCommentZh: "", purposeComment: "", purposeCommentZh: "", bulletPointAdvice: [{ bulletPoint: "", covered: null, coverageUnknown: false, evidenceFromEssay: "", problem: "", comment: "", suggestedSentence: "", explanationZh: "" }] } : null,
        task2EssayCorrections: task === "Task 2" ? { positionComment: "", positionCommentZh: "", introductionComment: "", introductionCommentZh: "", bodyParagraphComment: "", bodyParagraphCommentZh: "", exampleComment: "", exampleCommentZh: "", conclusionComment: "", conclusionCommentZh: "", developmentAdvice: [], developmentAdviceZh: [] } : null,
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Task 2: focus on answering all question parts, position, idea development, examples, conclusion, and relevance. Task 1: focus on bullet coverage, purpose, tone, recipient relationship, opening/closing, and detail sufficiency.",
      ...common
    ].join("\n");
  }

  if (stage === "coherence-diagnosis") {
    return [
      "Stage 6/10. Diagnose Coherence and Cohesion only. Do not correct grammar or vocabulary.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: { "Coherence and Cohesion": { feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" } },
        coherenceAdvice: [], coherenceAdviceZh: [],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Analyse paragraphing, topic sentences, progression, linking, referencing, repetition, paragraph unity, and logical order. Use concrete paragraph/phrase evidence.",
      ...common
    ].join("\n");
  }

  if (stage === "spelling-wordform") {
    return [
      "Stage 8/13. Diagnose spelling and word-formation issues only. Do not assess collocation unless it is caused by word form. Do not do full sentence correction.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        spellingCorrections: [{ originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }],
        detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Spelling / word formation", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true }],
        lexicalAdvice: [], lexicalAdviceZh: [],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Return every visible spelling or word-formation issue in the supplied essay. Do not invent spelling errors. Every English explanation must have the matching Chinese field.",
      ...common
    ].join("\n");
  }

  if (stage === "lexical-choice-collocation") {
    return [
      "Stage 9/13. Diagnose word choice, collocation, repetition, register, and lexical precision only. Do not do grammar correction except where word choice is the main issue.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: { "Lexical Resource": { feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" } },
        lexicalAdvice: [], lexicalAdviceZh: [],
        detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Word choice / collocation / repetition", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", whyThisAffectsBandZh: "", targetBandExpression: "" }],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Return all clear score-affecting lexical choice/collocation/repetition issues. Every English explanation must have the matching Chinese field.",
      ...common
    ].join("\n");
  }

  if (stage === "lexical-diagnosis") {
    return [
      "Stage 7/10. Diagnose Lexical Resource only. Include spelling, word choice, collocation, word formation, register, and repetition. Do not correct grammar unless it is word formation.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: { "Lexical Resource": { feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" } },
        spellingCorrections: [{ originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }],
        lexicalAdvice: [], lexicalAdviceZh: [],
        detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Word choice / collocation / spelling / repetition", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Return all clear score-affecting lexical issues up to the practical limit. If there are no spelling errors, return spellingCorrections as []. Do not invent misspellings.",
      ...common
    ].join("\n");
  }

  if (stage === "grammar-diagnosis") {
    return [
      "Stage 8/10. Diagnose Grammatical Range and Accuracy only. Do not produce full sentence rewrites or betterExpression here.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        criteria: { "Grammatical Range and Accuracy": { feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "", evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "" } },
        grammarErrors: [{ type: "", original: "", corrected: "", explanation: "", explanationZh: "" }],
        grammarAdvice: [], grammarAdviceZh: [],
        errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] }
      }),
      "Focus on error patterns: tense, articles, plurals, subject-verb agreement, word order, clauses, sentence fragments, run-ons, punctuation, and complexity range. Keep items short to avoid JSON truncation.",
      ...common
    ].join("\n");
  }

  if (stage === "sentence-corrections") {
    return [
      "Stage 9/10. Produce direct sentence-level corrections only. Do not write the final study plan here.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        sentenceCorrections: [{ original: "", corrected: "", reason: "", reasonZh: "" }],
        detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }]
      }),
      "Return every score-impacting sentence-level issue in the supplied text. Do not stop at 8-15 items if more clear issues exist. correctedSentence is the direct error fix. Keep betterExpression empty here unless it is very short; the next stage handles upgraded expressions. Do not return paragraphs. Every item with an English explanation must include the matching Chinese fields.",
      ...common
    ].join("\n");
  }

  if (stage === "better-expressions") {
    return [
      "Stage 12/13. Produce upgraded single-sentence better expressions only. Do not rescore and do not write the final study plan.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Better expression", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", whyThisAffectsBandZh: "", targetBandExpression: "" }],
        betterExpressionItems: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", betterExpression: "", betterExpressionZh: "", whyBetter: "", whyBetterZh: "", targetBand: "" }]
      }),
      "For every score-impacting sentence below Band 9, include a betterExpression when a safe upgrade is possible. betterExpression must be ONE sentence only, not a paragraph. Every English explanation must have the matching Chinese field.",
      ...common
    ].join("\n");
  }

  if (stage === "final-plan") {
    return [
      "Stage 13/13. Produce only correction priority and final target improvement plan. Do not rescore and do not repeat all sentence corrections.",
      "Return JSON with this exact shape:",
      JSON.stringify({
        correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
        targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }], practiceTasks: [], practiceTasksZh: [] },
        band5FixPlan: [], band5FixPlanZh: [], band6UpgradePlan: [], band6UpgradePlanZh: [], band7UpgradePlan: [], band7UpgradePlanZh: []
      }),
      "The plan must be concrete and based on this essay. Every English array item must have a same-index Chinese item in the matching *Zh array.",
      ...common
    ].join("\n");
  }

  return [
    "Backward-compatible stage. Produce upgraded single-sentence better expressions and final study plan. Do not rescore.",
    "Return JSON with this exact shape:",
    JSON.stringify({
      detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Better expression", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", targetBandExpression: "" }],
      correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
      targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", target: "", action: "", exampleUpgrade: "", actionZh: "" }], practiceTasks: [], practiceTasksZh: [] },
      taskAchievementAdvice: [], taskAchievementAdviceZh: [], coherenceAdvice: [], coherenceAdviceZh: [], lexicalAdvice: [], lexicalAdviceZh: [], grammarAdvice: [], grammarAdviceZh: [], band5FixPlan: [], band5FixPlanZh: [], band6UpgradePlan: [], band6UpgradePlanZh: [], band7UpgradePlan: [], band7UpgradePlanZh: []
    }),
    "For every score-impacting sentence below Band 9, include a betterExpression when a safe upgrade is possible. betterExpression must be ONE sentence only, not a paragraph. It must preserve the original meaning and show a realistic 0.5-1 band upgrade, not a Band 9 rewrite for weak writing.",
    "The final study plan must be concrete, based on this essay, and aimed at the next 0.5-1 band improvement.",
    ...common
  ].join("\n");
}

function tenStepStageMaxTokens(stage) {
  return ({
    "prompt-analysis": envInt("AI_STAGE_PROMPT_ANALYSIS_TOKENS", 4500, 2500, 9000),
    "half-band-summary": envInt("AI_STAGE_HALF_BAND_SUMMARY_TOKENS", 5500, 3000, 11000),
    "criterion-boundary": envInt("AI_STAGE_CRITERION_BOUNDARY_TOKENS", 6500, 3500, 12000),
    "score-boundary": envInt("AI_STAGE_SCORE_BOUNDARY_TOKENS", 6500, 3500, 12000),
    "evidence-map": envInt("AI_STAGE_EVIDENCE_MAP_TOKENS", 6500, 3500, 12000),
    "task-diagnosis": envInt("AI_STAGE_TASK_DIAGNOSIS_TOKENS", 7000, 3500, 12000),
    "coherence-diagnosis": envInt("AI_STAGE_COHERENCE_DIAGNOSIS_TOKENS", 6500, 3500, 12000),
    "spelling-wordform": envInt("AI_STAGE_SPELLING_WORDFORM_TOKENS", 6000, 3000, 12000),
    "lexical-choice-collocation": envInt("AI_STAGE_LEXICAL_CHOICE_TOKENS", 7500, 3500, 13000),
    "lexical-diagnosis": envInt("AI_STAGE_LEXICAL_DIAGNOSIS_TOKENS", 7500, 3500, 13000),
    "grammar-diagnosis": envInt("AI_STAGE_GRAMMAR_DIAGNOSIS_TOKENS", 7000, 3500, 12000),
    "sentence-corrections": envInt("AI_STAGE_SENTENCE_CORRECTIONS_TOKENS", 8000, 3500, 14000),
    "better-expressions": envInt("AI_STAGE_BETTER_EXPRESSIONS_TOKENS", 8000, 3500, 14000),
    "better-expression-plan": envInt("AI_STAGE_BETTER_EXPRESSION_PLAN_TOKENS", 8000, 3500, 14000),
    "final-plan": envInt("AI_STAGE_FINAL_PLAN_TOKENS", 7000, 3500, 12000)
  })[stage] || envInt("AI_STAGE_DEFAULT_TOKENS", 6000, 3000, 12000);
}

function tenStepStageHasUsableContent(stage, output) {
  if (!output || typeof output !== "object") return false;
  if (stage === "prompt-analysis") return hasUsefulText(output.taskRequirementAnalysis) || hasUsefulText(output.taskMatchCheck);
  if (stage === "half-band-summary") return hasUsefulText(output.scoreCalibration) || hasUsefulText(output.halfBandBoundary) || ensureArray(output.strengthItems).length || ensureArray(output.mainProblemItems).length;
  if (stage === "criterion-boundary" || stage === "score-boundary") return hasUsefulText(output.halfBandBoundary) || Object.values(output.criteria || {}).some((item) => hasUsefulText(item?.whyThisBand) || hasUsefulText(item?.whyNotHigher) || hasUsefulText(item?.whyNotLower));
  if (stage === "evidence-map") return Object.values(output.criteria || {}).some((item) => ensureArray(item?.evidenceQuotes).length || ensureArray(item?.positiveEvidence).length || ensureArray(item?.limitingEvidence).length || hasUsefulText(item?.whyThisBand));
  if (stage === "task-diagnosis") return ensureArray(output.taskAchievementAdvice).length || hasUsefulText(output.task1LetterCorrections) || hasUsefulText(output.task2EssayCorrections) || hasUsefulText(output.errorAnalysis?.summary);
  if (stage === "coherence-diagnosis") return ensureArray(output.coherenceAdvice).length || hasUsefulText(output.criteria?.["Coherence and Cohesion"]) || hasUsefulText(output.errorAnalysis?.summary);
  if (stage === "spelling-wordform") return ensureArray(output.spellingCorrections).length || ensureArray(output.detailedSentenceCorrections).length || hasUsefulText(output.errorAnalysis?.summary);
  if (stage === "lexical-choice-collocation" || stage === "lexical-diagnosis") return ensureArray(output.lexicalAdvice).length || ensureArray(output.spellingCorrections).length || ensureArray(output.detailedSentenceCorrections).length || hasUsefulText(output.criteria?.["Lexical Resource"]) || hasUsefulText(output.errorAnalysis?.summary);
  if (stage === "grammar-diagnosis") return ensureArray(output.grammarErrors).length || ensureArray(output.grammarAdvice).length || hasUsefulText(output.criteria?.["Grammatical Range and Accuracy"]) || hasUsefulText(output.errorAnalysis?.summary);
  if (stage === "sentence-corrections") return ensureArray(output.sentenceCorrections).length || ensureArray(output.detailedSentenceCorrections).length || hasUsefulText(output.sentenceCorrectionSummary);
  if (stage === "better-expressions") return ensureArray(output.detailedSentenceCorrections).some((item) => hasUsefulText(item?.betterExpression)) || ensureArray(output.betterExpressionItems).length;
  if (stage === "final-plan") return hasUsefulText(output.targetImprovementPlan) || hasUsefulText(output.correctionPriority) || ensureArray(output.band5FixPlan).length || ensureArray(output.band6UpgradePlan).length || ensureArray(output.band7UpgradePlan).length;
  if (stage === "better-expression-plan") return ensureArray(output.detailedSentenceCorrections).some((item) => hasUsefulText(item?.betterExpression)) || ensureArray(output.betterExpressionItems).length || hasUsefulText(output.targetImprovementPlan) || hasUsefulText(output.correctionPriority);
  return hasUsefulText(output);
}


function envInt(name, fallback, min = 1, max = 100) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function splitEssayIntoSentenceUnits(essay) {
  const text = String(essay || "").replace(/\r/g, "").trim();
  if (!text) return [];
  const rough = [];
  text.split(/\n+/).forEach((paragraph) => {
    const cleaned = paragraph.trim();
    if (!cleaned) return;
    const matches = cleaned.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g);
    if (matches && matches.length) rough.push(...matches);
    else rough.push(cleaned);
  });
  return rough
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 2)
    .map((sentence, index) => ({ sentenceNumber: index + 1, text: sentence }));
}

function chunkItems(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function compactScoreSnapshot(body = {}) {
  const current = body.currentResult && typeof body.currentResult === "object" ? body.currentResult : {};
  const criteria = current.criteria && typeof current.criteria === "object" ? current.criteria : {};
  const criterionBands = {};
  Object.entries(criteria).forEach(([name, item]) => {
    if (item && typeof item === "object" && typeof item.band !== "undefined") criterionBands[name] = item.band;
  });
  return JSON.stringify({
    overallBand: current.overallBand || body.currentOverallBand || body.overallBand || "",
    estimatedLevel: current.estimatedLevel || "",
    criterionBands,
    scoreCalibration: current.scoreCalibration || null,
    mainProblems: ensureArray(current.mainProblems).slice(0, 5),
    strengths: ensureArray(current.strengths).slice(0, 5)
  }).slice(0, 2200);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || typeof value === "undefined") continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const found = value.find((item) => hasUsefulText(item));
      if (typeof found === "string") return found.trim();
      if (found) return found;
      continue;
    }
    if (value) return value;
  }
  return "";
}

function normalizeBatchWarning(stage, batchNumber, error) {
  return `${stage} batch ${batchNumber} failed: ${error?.message || error?.name || String(error)}`;
}

async function callTenStepBatchJson({ apiKey, model, stage, locale, userPrompt, maxTokens, deadline, timeoutMs }) {
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildTenStepSystemPrompt(stage, locale),
    userPrompt,
    maxTokens,
    temperature: 0.06,
    jsonMode: true,
    deadline,
    timeoutMs: safePassTimeout(deadline, timeoutMs || (Number(process.env.AI_TEN_STEP_BATCH_TIMEOUT_MS) || 150000), 70000)
  });
  return parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { aiStage: stage, batchMode: true },
    locale,
    maxTokens,
    allowRepair: true,
    deadline
  });
}

async function runBatchedAiJson({ items, batchSize, maxBatches, concurrency, runBatch }) {
  const batches = chunkItems(items, batchSize).slice(0, maxBatches);
  const results = new Array(batches.length);
  const warnings = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, batches.length)) }, async () => {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await runBatch(batches[index], index);
      } catch (error) {
        warnings.push(normalizeBatchWarning("AI", index + 1, error));
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return { results: results.filter(Boolean), warnings, batchCount: batches.length };
}

function dedupeCorrections(items = []) {
  const out = [];
  const seen = new Set();
  ensureArray(items).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const original = firstNonEmpty(item.originalSentence, item.original, item.sentence, item.sourceSentence);
    const corrected = firstNonEmpty(item.correctedSentence, item.corrected, item.correction, item.revisedSentence);
    const problem = firstNonEmpty(item.problem, item.reason, item.explanation, item.issue);
    const key = [original, corrected, problem].join("||").toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, sentenceNumber: item.sentenceNumber || index + 1, originalSentence: original, correctedSentence: corrected, problem });
  });
  return out;
}

function buildSentenceBatchPrompt({ body, effectiveMode, locale, batch, batchIndex, batchCount }) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const sentenceList = batch.map((item) => `${item.sentenceNumber}. ${item.text}`).join("\n");
  return [
    `Stage 11/13 internal batch ${batchIndex + 1}/${batchCount}. Produce direct sentence-level corrections for the listed sentences only.`,
    "This is still AI-only: identify and correct all clear score-impacting issues in this batch. Do not skip visible errors to keep the output short.",
    "If a sentence has several grammar/word-choice/punctuation errors, return one item with the fully corrected sentence and a concise combined problem description.",
    "If a listed sentence has no score-impacting problem, omit it. Do not invent errors.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      sentenceCorrectionSummary: "",
      sentenceCorrectionSummaryZh: "",
      sentenceCorrections: [{ original: "", corrected: "", reason: "", reasonZh: "" }],
      detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", whyThisAffectsBandZh: "", targetBandExpression: "" }]
    }),
    "Chinese requirement: every item with reason/problem/rule/bandImpact must include the corresponding reasonZh/problemZh/ruleZh/bandImpactZh. Do not leave Chinese helper fields empty when the English field is non-empty.",
    "Keep betterExpression empty here unless it is a short direct upgrade; Stage 10 handles upgraded expressions.",
    `Task: ${task}`,
    `Mode: ${effectiveMode}`,
    `Current score snapshot: ${compactScoreSnapshot(body)}`,
    "Question prompt:",
    String(body.questionPrompt || ""),
    "Sentences to correct:",
    sentenceList
  ].join("\n");
}

async function callAiBatchedSentenceCorrections({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const units = splitEssayIntoSentenceUnits(body.essay);
  if (!units.length) {
    const error = new Error("AI sentence-corrections stage cannot run because no essay sentences were found.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  const batchSize = envInt("AI_SENTENCE_BATCH_SIZE", 5, 2, 8);
  const maxBatches = envInt("AI_SENTENCE_MAX_BATCHES", 12, 1, 20);
  const concurrency = envInt("AI_SENTENCE_BATCH_CONCURRENCY", 2, 1, 4);
  const batchCount = Math.min(Math.ceil(units.length / batchSize), maxBatches);
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: units,
    batchSize,
    maxBatches,
    concurrency,
    runBatch: (batch, index) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildSentenceBatchPrompt({ body, effectiveMode, locale, batch, batchIndex: index, batchCount }),
      maxTokens: envInt("AI_SENTENCE_BATCH_MAX_TOKENS", 6200, 3000, 12000),
      deadline,
      timeoutMs: Number(process.env.AI_SENTENCE_BATCH_TIMEOUT_MS) || 120000
    })
  });
  if (!results.length) {
    const error = new Error(`AI sentence-corrections batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  const detailed = dedupeCorrections(results.flatMap((r) => ensureArray(r.detailedSentenceCorrections)));
  const simple = dedupeCorrections(results.flatMap((r) => ensureArray(r.sentenceCorrections)));
  return {
    aiStage: stage,
    disclaimer: DISCLAIMER,
    sentenceCorrectionSummary: `AI reviewed ${units.length} sentence unit(s) in ${attempted} batch(es).`,
    sentenceCorrectionSummaryZh: `AI已分${attempted}批检查${units.length}个句子单位。`,
    sentenceCorrections: simple,
    detailedSentenceCorrections: detailed,
    sentenceBatchMeta: { totalSentenceUnits: units.length, attemptedBatches: attempted, successfulBatches: results.length, batchSize, maxBatches, truncatedByBatchLimit: Math.ceil(units.length / batchSize) > maxBatches },
    stageWarnings: warnings
  };
}

function correctionSourcesForBetterExpression(body = {}) {
  const current = body.currentResult && typeof body.currentResult === "object" ? body.currentResult : {};
  const detailed = dedupeCorrections(ensureArray(current.detailedSentenceCorrections));
  if (detailed.length) return detailed.map((item, index) => ({
    sentenceNumber: item.sentenceNumber || index + 1,
    originalSentence: firstNonEmpty(item.originalSentence, item.original),
    correctedSentence: firstNonEmpty(item.correctedSentence, item.corrected, item.originalSentence, item.original),
    problem: firstNonEmpty(item.problem, item.reason, item.explanation),
    errorType: firstNonEmpty(item.errorType, item.type)
  }));
  return splitEssayIntoSentenceUnits(body.essay).map((item) => ({ sentenceNumber: item.sentenceNumber, originalSentence: item.text, correctedSentence: item.text, problem: "", errorType: "" }));
}

function buildBetterExpressionBatchPrompt({ body, effectiveMode, locale, batch, batchIndex, batchCount }) {
  const items = batch.map((item) => [
    `Sentence ${item.sentenceNumber}:`,
    `Original: ${item.originalSentence}`,
    `Corrected: ${item.correctedSentence || item.originalSentence}`,
    item.problem ? `Problem: ${item.problem}` : "",
    item.errorType ? `Error type: ${item.errorType}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
  return [
    `Stage 12/13 internal better-expression batch ${batchIndex + 1}/${batchCount}. Produce upgraded single-sentence better expressions for every listed item where a safe upgrade is possible.`,
    "Do not skip an item merely to keep output short. If an item is already natural, still provide a modest clearer Band +0.5 style sentence unless it would change the meaning.",
    "betterExpression must be ONE sentence only, not a paragraph. It must preserve the user's meaning and be realistic for the next 0.5-1 band improvement.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Better expression", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", whyThisAffectsBandZh: "", targetBandExpression: "" }],
      betterExpressionItems: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", betterExpression: "", whyBetter: "", whyBetterZh: "", targetBand: "" }]
    }),
    "Chinese requirement: every betterExpression item must include betterExpressionZh or whyBetterZh. Every problem/rule/bandImpact field must have its matching Chinese field.",
    `Current score snapshot: ${compactScoreSnapshot(body)}`,
    "Items:",
    items
  ].join("\n");
}

function buildFinalPlanPrompt({ body, effectiveMode, locale }) {
  return [
    "Stage 13/13 final plan pass. Produce only correctionPriority and targetImprovementPlan based on the essay and earlier AI results. Do not rescore and do not repeat all sentence corrections.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
      targetImprovementPlan: { currentBand: "", targetBandRange: "", targetBandRangeZh: "", targetReason: "", targetReasonZh: "", focus: [], focusZh: [], criterionUpgrades: [{ criterion: "Task Response / Task Achievement", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Coherence and Cohesion", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Lexical Resource", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }, { criterion: "Grammatical Range and Accuracy", currentWeakness: "", currentWeaknessZh: "", target: "", targetZh: "", action: "", actionZh: "", exampleUpgrade: "", exampleUpgradeZh: "" }], practiceTasks: [], practiceTasksZh: [] }
    }),
    "Chinese requirement: every English array item must have a same-index Chinese item in the matching *Zh array. Every criterionUpgrades object must include actionZh and exampleUpgradeZh.",
    `Mode: ${effectiveMode}`,
    `Current score snapshot and accumulated result: ${JSON.stringify(body.currentResult || {}).slice(0, 7000)}`,
    "Question prompt:",
    String(body.questionPrompt || ""),
    "User essay:",
    String(body.essay || "")
  ].join("\n");
}

async function callAiBatchedBetterExpressionPlan({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const sources = correctionSourcesForBetterExpression(body);
  if (!sources.length) {
    const error = new Error("AI better-expression stage cannot run because no source sentences were found.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  const batchSize = envInt("AI_BETTER_BATCH_SIZE", 5, 2, 8);
  const maxBatches = envInt("AI_BETTER_MAX_BATCHES", 12, 1, 20);
  const concurrency = envInt("AI_BETTER_BATCH_CONCURRENCY", 2, 1, 4);
  const batchCount = Math.min(Math.ceil(sources.length / batchSize), maxBatches);
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: sources,
    batchSize,
    maxBatches,
    concurrency,
    runBatch: (batch, index) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildBetterExpressionBatchPrompt({ body, effectiveMode, locale, batch, batchIndex: index, batchCount }),
      maxTokens: envInt("AI_BETTER_BATCH_MAX_TOKENS", 6200, 3000, 12000),
      deadline,
      timeoutMs: Number(process.env.AI_BETTER_BATCH_TIMEOUT_MS) || 120000
    })
  });
  let plan = {};
  try {
    plan = await callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildFinalPlanPrompt({ body, effectiveMode, locale }),
      maxTokens: envInt("AI_FINAL_PLAN_MAX_TOKENS", 7000, 3500, 12000),
      deadline,
      timeoutMs: Number(process.env.AI_FINAL_PLAN_TIMEOUT_MS) || 120000
    });
  } catch (error) {
    warnings.push(normalizeBatchWarning("better-expression final plan", attempted + 1, error));
  }
  if (!results.length && !hasUsefulText(plan)) {
    const error = new Error(`AI better-expression batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  const detailed = dedupeCorrections(results.flatMap((r) => ensureArray(r.detailedSentenceCorrections)));
  const betterExpressionItems = results.flatMap((r) => ensureArray(r.betterExpressionItems)).filter((item) => hasUsefulText(item));
  return {
    aiStage: stage,
    disclaimer: DISCLAIMER,
    detailedSentenceCorrections: detailed,
    betterExpressionItems,
    correctionPriority: plan.correctionPriority || {},
    targetImprovementPlan: plan.targetImprovementPlan || {},
    betterExpressionBatchMeta: { sourceItems: sources.length, attemptedBatches: attempted, successfulBatches: results.length, batchSize, maxBatches, truncatedByBatchLimit: Math.ceil(sources.length / batchSize) > maxBatches },
    stageWarnings: warnings
  };
}

function criterionNamesForTask(task) {
  return [firstCriterionName(task), "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function buildCriterionBoundaryBatchPrompt({ body, effectiveMode, locale, criterion, index, total }) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const current = body.currentResult && typeof body.currentResult === "object" ? body.currentResult : {};
  const criterionSnapshot = current.criteria && current.criteria[criterion] ? current.criteria[criterion] : {};
  return [
    `Stage 4/13 internal criterion-boundary batch ${index + 1}/${total}. Explain ONLY this criterion: ${criterion}.`,
    "Do not change the band. Explain why this exact band is right, why not 0.5 higher, and why not 0.5 lower.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      criteria: { [criterion]: { evidenceQuotes: [], evidenceQuotesZh: [], positiveEvidence: [], positiveEvidenceZh: [], limitingEvidence: [], limitingEvidenceZh: [], whyThisBand: "", whyThisBandZh: "", whyNotHigher: "", whyNotHigherZh: "", whyNotLower: "", whyNotLowerZh: "", feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" } },
      halfBandBoundary: { criterionBoundaries: [{ criterion, currentBand: "", lowerBoundary: "", upperBoundary: "", whyThisHalfBand: "", whyThisHalfBandZh: "" }] }
    }),
    "Use short evidence quotes from the essay. Every English explanation must include the matching Chinese field.",
    `Task: ${task}`,
    `Current criterion snapshot: ${JSON.stringify(criterionSnapshot).slice(0, 2500)}`,
    `Current score snapshot: ${compactScoreSnapshot(body)}`,
    "Question prompt:",
    String(body.questionPrompt || ""),
    "User essay:",
    String(body.essay || "")
  ].join("\n");
}

async function callAiBatchedCriterionBoundary({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const criteria = criterionNamesForTask(task).map((criterion, index) => ({ criterion, index }));
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: criteria,
    batchSize: 1,
    maxBatches: 4,
    concurrency: envInt("AI_CRITERION_BOUNDARY_CONCURRENCY", 2, 1, 4),
    runBatch: (batch, batchIndex) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildCriterionBoundaryBatchPrompt({ body, effectiveMode, locale, criterion: batch[0].criterion, index: batchIndex, total: criteria.length }),
      maxTokens: envInt("AI_CRITERION_BOUNDARY_BATCH_MAX_TOKENS", 5200, 3000, 10000),
      deadline,
      timeoutMs: Number(process.env.AI_CRITERION_BOUNDARY_BATCH_TIMEOUT_MS) || 135000
    })
  });
  if (!results.length) {
    const error = new Error(`AI criterion-boundary batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  const output = { aiStage: stage, disclaimer: DISCLAIMER, criteria: {}, halfBandBoundary: { criterionBoundaries: [] }, stageWarnings: warnings };
  results.forEach((result) => {
    if (result.criteria && typeof result.criteria === "object") output.criteria = { ...output.criteria, ...result.criteria };
    const boundaries = ensureArray(result.halfBandBoundary?.criterionBoundaries);
    if (boundaries.length) output.halfBandBoundary.criterionBoundaries.push(...boundaries);
  });
  output.criterionBoundaryBatchMeta = { attemptedBatches: attempted, successfulBatches: results.length };
  return output;
}

function buildSpellingWordformBatchPrompt({ body, effectiveMode, locale, batch, batchIndex, batchCount }) {
  const sentenceList = batch.map((item) => `${item.sentenceNumber}. ${item.text}`).join("\n");
  return [
    `Stage 8/13 internal spelling-wordform batch ${batchIndex + 1}/${batchCount}. Diagnose spelling and word-formation issues in these sentences only.`,
    "Return every visible spelling or word-formation issue. Do not invent errors. Do not handle collocation or grammar unless word form is the main issue.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      spellingCorrections: [{ originalWord: "", correctedWord: "", sentence: "", explanation: "", explanationZh: "" }],
      detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Spelling / word formation", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true }],
      lexicalAdvice: [], lexicalAdviceZh: []
    }),
    "Every English explanation must have the matching Chinese field.",
    `Current score snapshot: ${compactScoreSnapshot(body)}`,
    "Sentences:",
    sentenceList
  ].join("\n");
}

async function callAiBatchedSpellingWordform({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const units = splitEssayIntoSentenceUnits(body.essay);
  if (!units.length) {
    const error = new Error("AI spelling-wordform stage cannot run because no essay sentences were found.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  const batchSize = envInt("AI_SPELLING_BATCH_SIZE", 7, 3, 10);
  const maxBatches = envInt("AI_SPELLING_MAX_BATCHES", 10, 1, 20);
  const batchCount = Math.min(Math.ceil(units.length / batchSize), maxBatches);
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: units,
    batchSize,
    maxBatches,
    concurrency: envInt("AI_SPELLING_BATCH_CONCURRENCY", 2, 1, 4),
    runBatch: (batch, index) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildSpellingWordformBatchPrompt({ body, effectiveMode, locale, batch, batchIndex: index, batchCount }),
      maxTokens: envInt("AI_SPELLING_BATCH_MAX_TOKENS", 5200, 3000, 10000),
      deadline,
      timeoutMs: Number(process.env.AI_SPELLING_BATCH_TIMEOUT_MS) || 135000
    })
  });
  if (!results.length) {
    const error = new Error(`AI spelling-wordform batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  return {
    aiStage: stage,
    disclaimer: DISCLAIMER,
    spellingCorrections: results.flatMap((r) => ensureArray(r.spellingCorrections)).filter((item) => hasUsefulText(item)),
    detailedSentenceCorrections: dedupeCorrections(results.flatMap((r) => ensureArray(r.detailedSentenceCorrections))),
    lexicalAdvice: results.flatMap((r) => ensureArray(r.lexicalAdvice)).filter((item) => hasUsefulText(item)),
    lexicalAdviceZh: results.flatMap((r) => ensureArray(r.lexicalAdviceZh)).filter((item) => hasUsefulText(item)),
    spellingWordformBatchMeta: { totalSentenceUnits: units.length, attemptedBatches: attempted, successfulBatches: results.length, batchSize, maxBatches, truncatedByBatchLimit: Math.ceil(units.length / batchSize) > maxBatches },
    stageWarnings: warnings
  };
}

function buildLexicalChoiceBatchPrompt({ body, effectiveMode, locale, batch, batchIndex, batchCount }) {
  const sentenceList = batch.map((item) => `${item.sentenceNumber}. ${item.text}`).join("\n");
  return [
    `Stage 9/13 internal lexical-choice batch ${batchIndex + 1}/${batchCount}. Diagnose word choice, collocation, repetition, register, and lexical precision in these sentences only.`,
    "Return every clear score-impacting lexical issue. Do not reduce issue count for brevity. Do not invent issues.",
    "Return exactly one valid JSON object with this shape:",
    JSON.stringify({
      lexicalAdvice: [], lexicalAdviceZh: [],
      detailedSentenceCorrections: [{ sentenceNumber: 1, originalSentence: "", correctedSentence: "", errorType: "Word choice / collocation / repetition", errorTypeZh: "", problem: "", problemZh: "", rule: "", ruleZh: "", betterExpression: "", betterExpressionZh: "", bandImpact: "", bandImpactZh: "", scoreImpacting: true, whyThisAffectsBand: "", whyThisAffectsBandZh: "", targetBandExpression: "" }]
    }),
    "Every English explanation must have the matching Chinese field. correctedSentence should only fix the lexical issue, not rewrite the whole paragraph.",
    `Current score snapshot: ${compactScoreSnapshot(body)}`,
    "Sentences:",
    sentenceList
  ].join("\n");
}

async function callAiBatchedLexicalChoice({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const units = splitEssayIntoSentenceUnits(body.essay);
  if (!units.length) {
    const error = new Error("AI lexical-choice stage cannot run because no essay sentences were found.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  const batchSize = envInt("AI_LEXICAL_BATCH_SIZE", 5, 2, 8);
  const maxBatches = envInt("AI_LEXICAL_MAX_BATCHES", 12, 1, 20);
  const batchCount = Math.min(Math.ceil(units.length / batchSize), maxBatches);
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: units,
    batchSize,
    maxBatches,
    concurrency: envInt("AI_LEXICAL_BATCH_CONCURRENCY", 2, 1, 4),
    runBatch: (batch, index) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildLexicalChoiceBatchPrompt({ body, effectiveMode, locale, batch, batchIndex: index, batchCount }),
      maxTokens: envInt("AI_LEXICAL_BATCH_MAX_TOKENS", 6200, 3000, 12000),
      deadline,
      timeoutMs: Number(process.env.AI_LEXICAL_BATCH_TIMEOUT_MS) || 135000
    })
  });
  if (!results.length) {
    const error = new Error(`AI lexical-choice batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  return {
    aiStage: stage,
    disclaimer: DISCLAIMER,
    lexicalAdvice: results.flatMap((r) => ensureArray(r.lexicalAdvice)).filter((item) => hasUsefulText(item)),
    lexicalAdviceZh: results.flatMap((r) => ensureArray(r.lexicalAdviceZh)).filter((item) => hasUsefulText(item)),
    detailedSentenceCorrections: dedupeCorrections(results.flatMap((r) => ensureArray(r.detailedSentenceCorrections))),
    lexicalBatchMeta: { totalSentenceUnits: units.length, attemptedBatches: attempted, successfulBatches: results.length, batchSize, maxBatches, truncatedByBatchLimit: Math.ceil(units.length / batchSize) > maxBatches },
    stageWarnings: warnings
  };
}

async function callAiBatchedBetterExpressionsOnly({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const sources = correctionSourcesForBetterExpression(body);
  if (!sources.length) {
    const error = new Error("AI better-expressions stage cannot run because no source sentences were found.");
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  const batchSize = envInt("AI_BETTER_BATCH_SIZE", 5, 2, 8);
  const maxBatches = envInt("AI_BETTER_MAX_BATCHES", 12, 1, 20);
  const batchCount = Math.min(Math.ceil(sources.length / batchSize), maxBatches);
  const { results, warnings, batchCount: attempted } = await runBatchedAiJson({
    items: sources,
    batchSize,
    maxBatches,
    concurrency: envInt("AI_BETTER_BATCH_CONCURRENCY", 2, 1, 4),
    runBatch: (batch, index) => callTenStepBatchJson({
      apiKey,
      model,
      stage,
      locale,
      userPrompt: buildBetterExpressionBatchPrompt({ body, effectiveMode, locale, batch, batchIndex: index, batchCount }),
      maxTokens: envInt("AI_BETTER_BATCH_MAX_TOKENS", 6200, 3000, 12000),
      deadline,
      timeoutMs: Number(process.env.AI_BETTER_BATCH_TIMEOUT_MS) || 135000
    })
  });
  if (!results.length) {
    const error = new Error(`AI better-expressions batching failed. ${warnings.join(" | ")}`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  return {
    aiStage: stage,
    disclaimer: DISCLAIMER,
    detailedSentenceCorrections: dedupeCorrections(results.flatMap((r) => ensureArray(r.detailedSentenceCorrections))),
    betterExpressionItems: results.flatMap((r) => ensureArray(r.betterExpressionItems)).filter((item) => hasUsefulText(item)),
    betterExpressionBatchMeta: { sourceItems: sources.length, attemptedBatches: attempted, successfulBatches: results.length, batchSize, maxBatches, truncatedByBatchLimit: Math.ceil(sources.length / batchSize) > maxBatches },
    stageWarnings: warnings
  };
}

async function callAiFinalPlanOnly13({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  const plan = await callTenStepBatchJson({
    apiKey,
    model,
    stage,
    locale,
    userPrompt: buildFinalPlanPrompt({ body, effectiveMode, locale }),
    maxTokens: envInt("AI_FINAL_PLAN_MAX_TOKENS", 7000, 3500, 12000),
    deadline,
    timeoutMs: Number(process.env.AI_FINAL_PLAN_TIMEOUT_MS) || 135000
  });
  return { aiStage: stage, disclaimer: DISCLAIMER, ...plan };
}

async function callAiTenStepStageOnly({ apiKey, model, body, effectiveMode, stage, locale, deadline }) {
  if (!String(body.essay || "").trim() && stage !== "prompt-analysis") {
    const error = new Error(`AI ${stage} stage cannot run because the essay is empty.`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 400;
    throw error;
  }
  if (stage === "criterion-boundary" || stage === "score-boundary") {
    return callAiBatchedCriterionBoundary({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "spelling-wordform") {
    return callAiBatchedSpellingWordform({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "lexical-choice-collocation") {
    return callAiBatchedLexicalChoice({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "sentence-corrections") {
    return callAiBatchedSentenceCorrections({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "better-expressions") {
    return callAiBatchedBetterExpressionsOnly({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "final-plan") {
    return callAiFinalPlanOnly13({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }
  if (stage === "better-expression-plan") {
    return callAiBatchedBetterExpressionPlan({ apiKey, model, body, effectiveMode, stage, locale, deadline });
  }

  const maxTokens = tenStepStageMaxTokens(stage);
  const rawText = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildTenStepSystemPrompt(stage, locale),
    userPrompt: buildTenStepStagePrompt({ ...body, mode: effectiveMode }, effectiveMode, stage, locale),
    maxTokens,
    temperature: stage === "score-boundary" || stage === "evidence-map" ? 0.05 : 0.08,
    jsonMode: true,
    deadline,
    timeoutMs: safePassTimeout(deadline, Math.max(70000, Number(process.env.AI_TEN_STEP_STAGE_TIMEOUT_MS) || 135000), 70000)
  });

  let parsed = await parseOrRepairAiJson({
    apiKey,
    model,
    rawText,
    body: { ...body, mode: effectiveMode, aiStage: stage },
    locale,
    maxTokens,
    allowRepair: true,
    deadline
  });

  if (parsed && typeof parsed === "object") {
    parsed.aiStage = stage;
    parsed.disclaimer = parsed.disclaimer || DISCLAIMER;
    if (body.currentOverallBand || body.overallBand || body.currentResult?.overallBand) {
      parsed.overallBand = parsed.overallBand || body.currentOverallBand || body.overallBand || body.currentResult?.overallBand;
    }
    if (!parsed.criteria && body.currentResult?.criteria && (stage !== "prompt-analysis")) {
      parsed.criteria = body.currentResult.criteria;
    }
  }

  if (!tenStepStageHasUsableContent(stage, parsed)) {
    const error = new Error(`AI ${stage} stage returned no usable structured content.`);
    error.provider = DEFAULT_PROVIDER;
    error.aiStage = stage;
    error.status = 502;
    throw error;
  }
  return parsed;
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

  if (isMockCombineRequest(body)) {
    handleMockCombineRequest(req, res, body);
    return;
  }

  if (!body.questionPrompt || !String(body.questionPrompt).trim()) {
    sendJson(req, res, 400, { error: "questionPrompt is required." });
    return;
  }

  body.essay = String(body.essay || "");
  body.task = body.task === "Task 1" ? "Task 1" : "Task 2";
  body.wordCount = countWordsServer(body.essay);
  body.targetWordCount = body.task === "Task 1" ? 150 : 250;
  body.isUnderMinimum = body.wordCount < body.targetWordCount;

  // AI-only: local code only counts words and task type. No local essay diagnostics are used for scoring.


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
    } else if (TEN_STEP_AI_STAGES.has(aiStage)) {
      result = await callAiTenStepStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        stage: aiStage,
        locale,
        deadline
      });
      result.aiStage = aiStage;
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "language-correction") {
      result = await callAiCorrectionStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        locale,
        deadline
      });
      result.aiStage = "language-correction";
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "evidence-map") {
      result = await callAiEvidenceMapStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        locale,
        deadline
      });
      result.aiStage = "evidence-map";
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "evidence-plan") {
      result = await callAiEvidencePlanStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        locale,
        deadline
      });
      result.aiStage = "evidence-plan";
      result.disclaimer = result.disclaimer || DISCLAIMER;
    } else if (aiStage === "final-plan") {
      result = await callAiFinalPlanStageOnly({
        apiKey,
        model,
        body,
        effectiveMode: effectiveMode === "revision" ? "revision" : "full",
        locale,
        deadline
      });
      result.aiStage = "final-plan";
      result.disclaimer = result.disclaimer || DISCLAIMER;
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
      result.aiStage = "language-correction";
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
    sendJson(req, res, 200, result);
  } catch (error) {
    if (sendProviderError(req, res, error)) return;

    sendJson(req, res, 502, {
      error: "AI grading failed. No non-AI score was generated.",
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
