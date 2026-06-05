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
    positiveEvidence: [],
    limitingEvidence: [],
    whyThisBand: "",
    whyNotHigher: "",
    whyNotLower: ""
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
      positiveEvidence: ensureArray(source.positiveEvidence).filter(Boolean).slice(0, 4),
      limitingEvidence: ensureArray(source.limitingEvidence).filter(Boolean).slice(0, 4),
      whyThisBand: source.whyThisBand || source.bandJustification || "",
      whyNotHigher: source.whyNotHigher || "",
      whyNotLower: source.whyNotLower || ""
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

function mechanicalSameBandSignals(result, task) {
  const text = JSON.stringify(result?.criteria || {}).toLowerCase();
  const taskSignals = task === "Task 1"
    ? /bullet|purpose|tone|recipient|letter|opening|closing|task achievement|underdeveloped|word count/.test(text)
    : /position|argument|idea|example|conclusion|task response|both views|advantages|disadvantages|problem|solution/.test(text);
  const ccSignals = /paragraph|progression|cohesive|linking|organisation|organization|sequence/.test(text);
  const lrSignals = /vocabulary|word choice|collocation|spelling|lexical|repetition|word form/.test(text);
  const graSignals = /grammar|verb|article|sentence|tense|punctuation|subject-verb|plural/.test(text);
  return [taskSignals, ccSignals, lrSignals, graSignals].filter(Boolean).length;
}

function shouldReauditMechanicalSameBands(result, task) {
  const bands = getCriterionBandsForTask(result, task);
  if (bands.length !== 4) return false;
  const allSame = new Set(bands.map((band) => formatBand(roundHalf(band)))).size === 1;
  if (!allSame) return false;
  return mechanicalSameBandSignals(result, task) >= 3;
}


function countRegexMatches(text, regex) {
  const source = String(text || "");
  if (!source) return 0;
  const matches = source.match(regex);
  return matches ? matches.length : 0;
}

function sentenceCountServer(text) {
  const sentences = String(text || "")
    .split(/[.!?]+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return sentences.length;
}

function paragraphCountServer(text) {
  return String(text || "")
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function averageCriterionBand(result, task) {
  const bands = getCriterionBandsForTask(result, task);
  if (!bands.length) return clampAiBand(result?.overallBand, 1);
  return bands.reduce((sum, band) => sum + band, 0) / bands.length;
}

function appendCalibrationEvidence(result, message) {
  if (!message) return;
  result.scoreCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object"
    ? result.scoreCalibration
    : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };
  const evidence = ensureArray(result.scoreCalibration.evidence).filter(Boolean);
  if (!evidence.includes(message)) evidence.push(message);
  result.scoreCalibration.evidence = evidence.slice(0, 7);
}

function appendCriterionLimitEvidence(criterion, message) {
  if (!criterion || typeof criterion !== "object" || !message) return;
  const limiting = ensureArray(criterion.limitingEvidence).filter(Boolean);
  if (!limiting.includes(message)) limiting.push(message);
  criterion.limitingEvidence = limiting.slice(0, 5);
  if (!criterion.whyNotHigher) criterion.whyNotHigher = message;
}

function capCriterionBand(result, criterionName, capBand, reason, source = "local_criterion_differentiation") {
  const criterion = result?.criteria?.[criterionName];
  if (!criterion || !Number.isFinite(Number(capBand))) return false;
  const current = normalizeCriterionBandValue(criterion.band, result.overallBand || 1);
  const cap = clampAiBand(capBand, current);
  if (current <= cap) return false;
  criterion.band = cap;
  criterion.localDifferentiationCap = { source, cap, reason };
  appendCriterionLimitEvidence(criterion, reason);
  appendCalibrationEvidence(result, `${criterionName} capped at Band ${formatBand(cap)}: ${reason}`);
  return true;
}

function task1BulletCoverageFromResult(result) {
  const bullets = result?.taskRequirementAnalysis?.bulletPoints;
  if (!Array.isArray(bullets) || !bullets.length) return { known: false, covered: 0, total: 0 };
  let known = 0;
  let covered = 0;
  bullets.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const value = item.covered;
    if (value === null || value === undefined || String(value).toLowerCase() === "unknown") return;
    known += 1;
    if (value === true || /^(yes|true|covered|partly covered|partially covered)$/i.test(String(value))) covered += 1;
  });
  return { known: known > 0, covered, total: known || bullets.length };
}

function extractEssaySignals(body = {}, result = {}) {
  const essay = String(body.essay || result.essay || "");
  const lower = essay.toLowerCase();
  const words = Number(body.wordCount || body.actualWordCount || result.actualWordCount) || countWordsServer(essay);
  const sentences = sentenceCountServer(essay);
  const paragraphs = paragraphCountServer(essay);
  const commonBasicWords = countRegexMatches(lower, /\b(good|nice|job|thing|things|people|work|help|do|make|go|get|know|learn|want)\b/g);
  const repeatedBasicWords = commonBasicWords >= Math.max(8, Math.ceil(words * 0.08));
  const weakCollocationHits = countRegexMatches(lower, /\b(want go|want leave|want try|learn talk|learn many thing|many thing\b|some customer\b|do some job|career need|need grow|people is|company is nice|company is good|other department\b|make better use|move department)\b/g);
  const seriousGrammarHits = countRegexMatches(lower, /\b(want\s+(?:go|leave|try|change|move)|learn\s+(?:talk|do|work)|need\s+(?:grow|go|improve)|people\s+is|company\s+are|many\s+thing\b|some\s+customer\b|two\s+year\b|I\s+write\s+this\s+letter)\b/g);
  const grammarErrorObjects = ensureArray(result.grammarErrors).length + ensureArray(result.detailedSentenceCorrections).filter((item) => {
    const text = JSON.stringify(item || {}).toLowerCase();
    return /grammar|verb|article|plural|subject|tense|sentence|word form|agreement/.test(text);
  }).length;
  const grammarPressure = seriousGrammarHits + grammarErrorObjects;
  const weakLinkingHits = countRegexMatches(lower, /\b(firstly|secondly|finally|therefore|however|moreover|furthermore|in addition|as a result|because|so|also)\b/g);
  const hasOnlyBasicLinking = weakLinkingHits <= 4 && words >= 70;
  const hasFormalSalutation = /^\s*dear\s+(mr\.?|ms\.?|mrs\.?|dr\.?|manager|sir|madam|[a-z]+\s*[a-z]*)/i.test(essay);
  const hasBareDear = /^\s*dear\s*\n/i.test(essay) || /^\s*dear\s*$/im.test(essay);
  const hasLetterClosing = /\b(yours sincerely|yours faithfully|kind regards|best regards|regards|thank you|thank you for your consideration)\b/i.test(essay);
  const task2PositionSignals = /\b(i believe|i agree|i disagree|in my opinion|my view|this essay will|i think|overall,? i|to conclude|in conclusion)\b/i.test(essay);
  const hasExamples = /\b(for example|for instance|such as|for example,|e\.g\.|for example\b)\b/i.test(essay);
  return {
    essay,
    lower,
    words,
    sentences,
    paragraphs,
    repeatedBasicWords,
    commonBasicWords,
    weakCollocationHits,
    seriousGrammarHits,
    grammarErrorObjects,
    grammarPressure,
    hasOnlyBasicLinking,
    weakLinkingHits,
    hasFormalSalutation,
    hasBareDear,
    hasLetterClosing,
    task2PositionSignals,
    hasExamples
  };
}

function shouldApplyHardDifferentiation(result, body, task, signals) {
  const bands = getCriterionBandsForTask(result, task);
  const allSame = bands.length === 4 && new Set(bands.map((band) => formatBand(roundHalf(band)))).size === 1;
  const avg = averageCriterionBand(result, task);
  const underMinimum = task === "Task 1" ? signals.words < 150 : signals.words < 250;
  const weakLanguage = signals.grammarPressure >= 3 || signals.weakCollocationHits >= 2 || signals.repeatedBasicWords;
  return Boolean(
    shouldReauditMechanicalSameBands(result, task) ||
    (allSame && (underMinimum || weakLanguage || avg <= 5)) ||
    (avg <= 5.5 && underMinimum && weakLanguage)
  );
}

function applyTask1CriterionDifferentiationCaps(result, body, signals) {
  const first = "Task Achievement";
  const bulletCoverage = task1BulletCoverageFromResult(result);
  let changed = false;

  if (signals.words < 50) {
    changed = capCriterionBand(result, first, 3, "Task 1 is far below 50 words, so task fulfilment and development are severely limited.") || changed;
  } else if (signals.words < 80) {
    changed = capCriterionBand(result, first, 4, "Task 1 is 50-79 words; the response cannot develop the letter functions enough for a higher Task Achievement score.") || changed;
  } else if (signals.words < 120) {
    changed = capCriterionBand(result, first, 4.5, "Task 1 is under 120 words and the bullet-point development is very limited.") || changed;
  } else if (signals.words < 150) {
    changed = capCriterionBand(result, first, 5, "Task 1 is below the recommended 150 words, so development may be limited.") || changed;
  }

  if (bulletCoverage.known && bulletCoverage.total >= 2) {
    if (bulletCoverage.covered <= 1) {
      changed = capCriterionBand(result, first, 4, "Only one Task 1 bullet point is clearly addressed.") || changed;
    } else if (bulletCoverage.covered === 2 && bulletCoverage.total >= 3) {
      changed = capCriterionBand(result, first, 5, "One major Task 1 bullet point appears missing or insufficiently covered.") || changed;
    }
  }

  if ((signals.hasBareDear || !signals.hasFormalSalutation || !signals.hasLetterClosing) && signals.words < 130) {
    changed = capCriterionBand(result, first, 4.5, "Letter format and register are incomplete: the salutation/closing or manager-facing tone is not fully controlled.") || changed;
  }

  if (signals.paragraphs >= 2 && signals.hasOnlyBasicLinking) {
    changed = capCriterionBand(result, "Coherence and Cohesion", 4, "Paragraphing is present, but progression is simple and cohesive devices are very limited.") || changed;
  } else if (signals.paragraphs <= 1 && signals.words >= 80) {
    changed = capCriterionBand(result, "Coherence and Cohesion", 4, "The letter lacks clear paragraphing for separate letter functions.") || changed;
  }

  if (signals.repeatedBasicWords || signals.weakCollocationHits >= 2) {
    changed = capCriterionBand(result, "Lexical Resource", 4, "Vocabulary is very basic and several collocations or word choices are inaccurate.") || changed;
  } else if (signals.commonBasicWords >= 8 && signals.words < 130) {
    changed = capCriterionBand(result, "Lexical Resource", 4.5, "Vocabulary range is narrow and relies heavily on basic words.") || changed;
  }

  if (signals.grammarPressure >= 5) {
    changed = capCriterionBand(result, "Grammatical Range and Accuracy", 3.5, "Frequent basic grammar errors in verb patterns, plurals, and agreement reduce sentence control.") || changed;
  } else if (signals.grammarPressure >= 3) {
    changed = capCriterionBand(result, "Grammatical Range and Accuracy", 4, "Several basic grammar errors are repeated across short sentences.") || changed;
  }

  return changed;
}

function applyTask2CriterionDifferentiationCaps(result, body, signals) {
  const first = "Task Response";
  let changed = false;
  const analysis = result?.taskRequirementAnalysis && typeof result.taskRequirementAnalysis === "object" ? result.taskRequirementAnalysis : {};
  const positionPresent = analysis.positionPresent === true || signals.task2PositionSignals;
  const requiredParts = ensureArray(analysis.requiredParts);
  const missingRequirements = ensureArray(analysis.missingRequirements);

  if (signals.words < 80) {
    changed = capCriterionBand(result, first, 3, "Task 2 is under 80 words, so there is too little argument development for a higher Task Response score.") || changed;
  } else if (signals.words < 150) {
    changed = capCriterionBand(result, first, 4, "Task 2 is 80-149 words; the response is too short for adequate argument development.") || changed;
  } else if (signals.words < 200) {
    changed = capCriterionBand(result, first, 5, "Task 2 is 150-199 words, so idea development is normally too limited for Band 6 Task Response.") || changed;
  }

  if (!positionPresent && /agree|disagree|opinion|extent|advantages|disadvantages|discuss|views|problem|solution/i.test(String(body.questionPrompt || ""))) {
    changed = capCriterionBand(result, first, 4, "A clear Task 2 position is not evident for a question type that requires one.") || changed;
  }

  if (missingRequirements.length || (requiredParts.length >= 2 && analysis.allPartsAnswered === false)) {
    changed = capCriterionBand(result, first, 5, "One or more required parts of the Task 2 question are missing or only partly answered.") || changed;
  }

  if (!signals.hasExamples && signals.words < 230) {
    changed = capCriterionBand(result, first, 5, "Ideas are not supported with a clear example or developed explanation.") || changed;
  }

  if (signals.paragraphs <= 1 && signals.words >= 120) {
    changed = capCriterionBand(result, "Coherence and Cohesion", 4, "The essay has little clear paragraphing, so argument organisation is weak.") || changed;
  } else if (signals.paragraphs < 4 && signals.words >= 180) {
    changed = capCriterionBand(result, "Coherence and Cohesion", 5, "Essay organisation is basic and does not show a fully controlled introduction, body paragraphs, and conclusion.") || changed;
  }

  if (signals.repeatedBasicWords || signals.weakCollocationHits >= 2) {
    changed = capCriterionBand(result, "Lexical Resource", 4.5, "Vocabulary is narrow or repetitive and does not provide enough topic-specific precision for a higher essay score.") || changed;
  }

  if (signals.grammarPressure >= 5) {
    changed = capCriterionBand(result, "Grammatical Range and Accuracy", 4, "Frequent grammar errors reduce control of argument sentences.") || changed;
  } else if (signals.grammarPressure >= 3) {
    changed = capCriterionBand(result, "Grammatical Range and Accuracy", 4.5, "Repeated grammar errors prevent a higher grammar band.") || changed;
  }

  return changed;
}


function detectTask2QuestionType(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (/discuss both views|both these views|both views|give your own opinion/.test(text)) return "discuss_both_views";
  if (/advantages?.*disadvantages?|disadvantages?.*advantages?|more advantages|more disadvantages|outweigh/.test(text)) return "advantages_disadvantages";
  if (/problem.*solution|problems.*solutions|cause.*solution|causes.*solutions|what problems|what measures|how can.*solved/.test(text)) return "problem_solution";
  if (/to what extent do you agree|agree or disagree|do you agree|do you disagree|extent do you agree/.test(text)) return "agree_disagree";
  const questionMarks = (text.match(/\?/g) || []).length;
  if (questionMarks >= 2 || /what.*\?.*what|why.*\?.*how|do you think.*\?.*what/i.test(text)) return "two_part_question";
  return "general_opinion";
}

function task2QuestionTypeCapReason(type) {
  if (type === "discuss_both_views") return "The essay must discuss both views and give the writer's own opinion; one required side or the personal opinion appears missing or underdeveloped.";
  if (type === "advantages_disadvantages") return "The essay must compare the advantages and disadvantages required by the prompt; one side appears missing or underdeveloped.";
  if (type === "problem_solution") return "The essay must address both the problem/cause and the solution/measure part of the prompt.";
  if (type === "two_part_question") return "The essay must answer both questions in the prompt; one question appears missing or underdeveloped.";
  if (type === "agree_disagree") return "The essay must present a clear and consistent position in response to the agree/disagree question.";
  return "The essay must fully respond to the specific Task 2 question type.";
}

function applyTask2QuestionTypeCaps(result, body = {}, signals = {}) {
  if (!result || typeof result !== "object") return false;
  const type = detectTask2QuestionType(body.questionPrompt);
  const analysis = result.taskRequirementAnalysis && typeof result.taskRequirementAnalysis === "object" ? result.taskRequirementAnalysis : {};
  const requiredParts = ensureArray(analysis.requiredParts);
  const missingRequirements = ensureArray(analysis.missingRequirements);
  const allPartsAnswered = analysis.allPartsAnswered;
  const positionPresent = analysis.positionPresent === true || signals.task2PositionSignals;
  const first = "Task Response";
  let changed = false;

  result.task2QuestionTypeDetected = result.task2QuestionTypeDetected || type;
  if (analysis && typeof analysis === "object") {
    analysis.questionType = analysis.questionType || type;
  }

  if (type === "agree_disagree" && !positionPresent) {
    changed = capCriterionBand(result, first, 4, task2QuestionTypeCapReason(type), "task2_question_type_cap") || changed;
  }

  if (["discuss_both_views", "advantages_disadvantages", "problem_solution", "two_part_question"].includes(type)) {
    if (missingRequirements.length || allPartsAnswered === false || (requiredParts.length >= 2 && allPartsAnswered !== true)) {
      changed = capCriterionBand(result, first, 5, task2QuestionTypeCapReason(type), "task2_question_type_cap") || changed;
    }
  }

  if (type === "advantages_disadvantages" && /more advantages|more disadvantages|outweigh/i.test(String(body.questionPrompt || ""))) {
    const hasComparativeJudgement = /\b(more advantages|more disadvantages|outweigh|overall|on balance|i believe.*advantage|i believe.*disadvantage)\b/i.test(String(body.essay || ""));
    if (!hasComparativeJudgement) {
      changed = capCriterionBand(result, first, 5.5, "The prompt asks whether advantages or disadvantages are stronger, but the essay does not make a clear comparative judgement.", "task2_question_type_cap") || changed;
    }
  }

  if (changed) {
    result.scoreCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object"
      ? result.scoreCalibration
      : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };
    result.scoreCalibration.task2QuestionType = type;
    appendCalibrationEvidence(result, `Task 2 question type checked: ${type}.`);
  }

  return changed;
}

function highBandBadAdvicePattern() {
  return /\b(more sophisticated vocabulary|sophisticated vocabulary|rare vocabulary|less common lexical|inversion|complex conditional|more complex conditional|flawless|perfect grammar|absolute accuracy|synergistic|synergise|synergize|holistic understanding|expedite|wider range of cohesive devices|furthermore|moreover|in addition|consequently)\b/i;
}

function setCriterionImprove(criterion, english, chinese) {
  if (!criterion || typeof criterion !== "object") return false;
  criterion.howToImprove = english;
  criterion.howToImproveZh = chinese;
  criterion.highBandAdviceRefined = true;
  return true;
}

function refineHighBandTask1Advice(result) {
  const criteria = result?.criteria || {};
  let changed = false;
  const task = criteria["Task Achievement"];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];

  if (normalizeCriterionBandValue(task?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      task,
      "To move closer to Band 9, make the company benefit slightly more concrete by naming the exact department outcome your experience would support, rather than adding more general detail.",
      "想接近 Band 9，要把公司受益写得更具体，例如说明你的经验会支持新部门的哪一个具体结果，而不是泛泛增加内容。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(cc?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      cc,
      "To move closer to Band 9, refine the transitions between the request, learned skills, company benefit, and reason for staying so the letter flows even more naturally without extra linking words.",
      "想接近 Band 9，重点是让请求、已学技能、公司受益和留任原因之间过渡更自然，而不是额外堆连接词。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(lr?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      lr,
      "To move closer to Band 9, keep the vocabulary precise but natural. Avoid business buzzwords and improve only the words that make the workplace benefit clearer.",
      "想接近 Band 9，词汇要准确自然，不要使用商业套话；只优化那些能让职场受益表达更清楚的词。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(gra?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      gra,
      "To move closer to Band 9, check minor punctuation consistency and vary sentence openings only where it makes the letter sound more natural and effortless.",
      "想接近 Band 9，检查细小标点一致性；只有在能让信件更自然流畅时才调整句子开头。"
    ) || changed;
  }

  return changed;
}

function refineHighBandTask2Advice(result) {
  const criteria = result?.criteria || {};
  let changed = false;
  const tr = criteria["Task Response"];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];

  if (normalizeCriterionBandValue(tr?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      tr,
      "To move closer to Band 9, make the argument more nuanced by developing the strongest idea with a sharper reason, example, or consequence instead of adding more separate ideas.",
      "想接近 Band 9，不是增加更多观点，而是把最强的观点用更精准的原因、例子或结果展开得更有层次。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(cc?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      cc,
      "To move closer to Band 9, refine paragraph progression so each topic sentence clearly advances the argument without relying on mechanical linking words.",
      "想接近 Band 9，要让每个主题句推动论证向前发展，而不是依赖机械连接词。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(lr?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      lr,
      "To move closer to Band 9, keep vocabulary precise and topic-specific. Avoid forcing rare words; choose terms that express the argument more exactly.",
      "想接近 Band 9，词汇要精准并贴合话题，不要强行使用生僻词；选择能更准确表达论点的词。"
    ) || changed;
  }
  if (normalizeCriterionBandValue(gra?.band, 0) >= 7.5) {
    changed = setCriterionImprove(
      gra,
      "To move closer to Band 9, polish sentence rhythm and clause control only where it makes the reasoning clearer and more natural.",
      "想接近 Band 9，只在能让论证更清楚、更自然的地方优化句子节奏和从句控制。"
    ) || changed;
  }

  return changed;
}

function replaceBadHighBandAdviceArray(items, replacements) {
  const list = ensureArray(items).filter(Boolean);
  if (!list.length) return list;
  const output = [];
  list.forEach((item) => {
    const text = String(item || "");
    if (highBandBadAdvicePattern().test(text)) {
      replacements.forEach((replacement) => {
        if (!output.includes(replacement)) output.push(replacement);
      });
    } else if (!output.includes(text)) {
      output.push(text);
    }
  });
  return output.slice(0, Math.max(3, list.length));
}

function refineHighBandAdviceArrays(result, task) {
  if (!result || typeof result !== "object") return false;
  const overall = normalizeCriterionBandValue(result.overallBand || result.overallEstimatedBand, 0);
  const bands = getCriterionBandsForTask(result, task);
  const highBand = overall >= 7.5 || bands.some((band) => band >= 7.5);
  if (!highBand) return false;

  let changed = false;
  if (task === "Task 1") {
    const taskAdvice = "Make the practical benefit to the target department more concrete, using one precise workplace outcome rather than extra general detail.";
    const cohesionAdvice = "Improve natural paragraph flow between the request, experience, company benefit, and loyalty reason without adding formulaic linking words.";
    const lexicalAdvice = "Keep wording precise and natural; avoid business buzzwords and only adjust vocabulary when it clarifies the workplace situation.";
    const grammarAdvice = "Polish minor punctuation and sentence rhythm only where it improves the letter's natural formal tone.";
    result.taskAchievementAdvice = replaceBadHighBandAdviceArray(result.taskAchievementAdvice, [taskAdvice]);
    result.coherenceAdvice = replaceBadHighBandAdviceArray(result.coherenceAdvice, [cohesionAdvice]);
    result.lexicalAdvice = replaceBadHighBandAdviceArray(result.lexicalAdvice, [lexicalAdvice]);
    result.grammarAdvice = replaceBadHighBandAdviceArray(result.grammarAdvice, [grammarAdvice]);
    changed = true;
  } else {
    const taskAdvice = "Deepen the strongest line of argument with a clearer reason, example, or consequence instead of adding extra claims.";
    const cohesionAdvice = "Make paragraph progression more argumentative so each topic sentence moves the essay forward naturally.";
    const lexicalAdvice = "Use precise topic vocabulary that serves the argument; do not force rare or inflated words.";
    const grammarAdvice = "Refine sentence rhythm and clause control only where it makes the reasoning clearer.";
    result.taskAchievementAdvice = replaceBadHighBandAdviceArray(result.taskAchievementAdvice, [taskAdvice]);
    result.coherenceAdvice = replaceBadHighBandAdviceArray(result.coherenceAdvice, [cohesionAdvice]);
    result.lexicalAdvice = replaceBadHighBandAdviceArray(result.lexicalAdvice, [lexicalAdvice]);
    result.grammarAdvice = replaceBadHighBandAdviceArray(result.grammarAdvice, [grammarAdvice]);
    changed = true;
  }

  return changed;
}

function refineHighBandTaskSpecificAdvice(result, body = {}) {
  if (!result || typeof result !== "object") return result;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const overall = normalizeCriterionBandValue(result.overallBand || result.overallEstimatedBand, 0);
  const bands = getCriterionBandsForTask(result, task);
  const highBand = overall >= 7.5 || bands.some((band) => band >= 7.5);
  if (!highBand) return result;

  const changed = task === "Task 1"
    ? refineHighBandTask1Advice(result)
    : refineHighBandTask2Advice(result);
  const arrayChanged = refineHighBandAdviceArrays(result, task);

  if (changed || arrayChanged) {
    result.highBandAdvicePolicy = {
      applied: true,
      task,
      principle: task === "Task 1"
        ? "High-band Task 1 advice focuses on naturalness, specificity, concise formal register, and letter-purpose precision."
        : "High-band Task 2 advice focuses on argument nuance, paragraph progression, precise topic vocabulary, and grammar serving reasoning."
    };
  }

  return result;
}

function applyCriterionDifferentiationCaps(result, body = {}) {
  if (!result || typeof result !== "object") return result;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  normalizeTaskSpecificCriteria(result, task);
  result.scoreCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object"
    ? result.scoreCalibration
    : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };

  const signals = extractEssaySignals(body, result);
  const questionTypeChanged = task === "Task 2" ? applyTask2QuestionTypeCaps(result, body, signals) : false;
  if (!shouldApplyHardDifferentiation(result, body, task, signals)) {
    if (questionTypeChanged) {
      result.scoreCalibration.criterionDifferentiationApplied = true;
      result.scoreCalibration.criteriaDifferentiationReason = "Task 2 question-type requirements were applied before final score calculation.";
    }
    return result;
  }

  const beforeBands = getCriterionBandsForTask(result, task);
  const changed = (task === "Task 1"
    ? applyTask1CriterionDifferentiationCaps(result, body, signals)
    : applyTask2CriterionDifferentiationCaps(result, body, signals)) || questionTypeChanged;

  const afterBands = getCriterionBandsForTask(result, task);
  const wasSame = beforeBands.length === 4 && new Set(beforeBands.map((band) => formatBand(roundHalf(band)))).size === 1;
  const isNowDifferent = afterBands.length === 4 && new Set(afterBands.map((band) => formatBand(roundHalf(band)))).size > 1;

  if (changed) {
    result.scoreCalibration.criterionDifferentiationApplied = true;
    result.scoreCalibration.criteriaDifferentiationReason = task === "Task 1"
      ? "Task 1 criterion bands were locally differentiated because the evidence showed different levels of task fulfilment, cohesion, vocabulary, and grammar control."
      : "Task 2 criterion bands were locally differentiated because the evidence showed different levels of response development, organisation, vocabulary, and grammar control.";
    appendCalibrationEvidence(result, result.scoreCalibration.criteriaDifferentiationReason);
    if (wasSame && isNowDifferent) {
      appendCalibrationEvidence(result, "Identical criterion bands were adjusted because the essay evidence did not support all four criteria being at the same level.");
    }
  }

  return result;
}

function finalizeTaskScoringEngine(result, body = {}) {
  if (!result || typeof result !== "object") return result;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  normalizeTaskSpecificCriteria(result, task);
  applyCriterionDifferentiationCaps(result, { ...body, task });

  const diagnostics = result.lowBandDiagnostics && typeof result.lowBandDiagnostics === "object"
    ? result.lowBandDiagnostics
    : buildLowBandDiagnostics({ ...body, task });
  const cap = capFromDiagnostics({ ...body, task }, diagnostics);
  const firstCriterion = firstCriterionName(task);

  if (cap.firstCap !== null && result.criteria?.[firstCriterion]) {
    result.criteria[firstCriterion].band = Math.min(
      normalizeCriterionBandValue(result.criteria[firstCriterion].band, result.overallBand || 1),
      cap.firstCap
    );
  }

  Object.values(result.criteria || {}).forEach((criterion) => {
    if (criterion && typeof criterion === "object") {
      criterion.band = normalizeCriterionBandValue(criterion.band, result.overallBand || 1);
    }
  });

  let finalBand = calculateTaskBandFromCriteria(result, task);
  const beforeCapBand = finalBand;
  let capApplied = false;
  let capReason = "";
  if (cap.cap !== null && Number.isFinite(Number(cap.cap)) && finalBand > cap.cap) {
    finalBand = roundHalf(cap.cap);
    capApplied = true;
    capReason = cap.reason || "A task-specific IELTS cap was applied.";
  }

  const bands = getCriterionBandsForTask(result, task);
  const lowCriteria = bands.filter((band) => band <= 5).length;
  if (lowCriteria >= 2 && finalBand >= 6) {
    finalBand = 5.5;
    capApplied = true;
    capReason = capReason || "Two or more criteria are 5.0 or below, so Band 6.0+ is not justified.";
  }

  result.overallBand = roundHalf(finalBand);
  result.estimatedLevel = `Band ${formatBand(result.overallBand)}`;
  refineHighBandTaskSpecificAdvice(result, { ...body, task });
  result.scoreCalculation = buildScoreCalculation(result, task, result.overallBand);
  result.scoringSystem = {
    type: task === "Task 1" ? "task1_practice_engine" : "task2_practice_engine",
    task,
    firstCriterion,
    criteriaAreTaskSpecific: true,
    overallBandSource: "calculated_from_four_criteria",
    previousAiOverallBand: Number.isFinite(Number(result.overallEstimatedBand || result.rawOverallBand)) ? Number(result.overallEstimatedBand || result.rawOverallBand) : undefined
  };

  result.scoreCalibration = result.scoreCalibration && typeof result.scoreCalibration === "object"
    ? result.scoreCalibration
    : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };
  result.scoreCalibration.strictness = result.scoreCalibration.strictness || "strict";
  result.scoreCalibration.capApplied = Boolean(result.scoreCalibration.capApplied || capApplied);
  if (capApplied) result.scoreCalibration.capReason = result.scoreCalibration.capReason || capReason;
  result.scoreCalibration.evidence = ensureArray(result.scoreCalibration.evidence).concat([
    `Scoring engine: ${task === "Task 1" ? "Task 1 GT letter" : "Task 2 essay"}.`,
    `Overall recalculated from four criteria: ${formatBand(result.overallBand)}.`,
    beforeCapBand !== result.overallBand ? `Pre-cap criteria average band: ${formatBand(beforeCapBand)}.` : ""
  ].filter(Boolean)).slice(0, 5);

  const allSame = bands.length === 4 && new Set(bands.map((band) => formatBand(roundHalf(band)))).size === 1;
  result.scoreCalibration.criteriaIdentical = allSame;
  result.scoreCalibration.criteriaIdenticalReviewNeeded = shouldReauditMechanicalSameBands(result, task);
  if (result.scoreCalibration.criteriaIdenticalReviewNeeded) {
    result.scoreCalibration.evidence = ensureArray(result.scoreCalibration.evidence).concat([
      "All four criterion bands are identical while the feedback mentions different criterion-specific evidence; score-audit should recheck whether the same bands are truly justified."
    ]).slice(0, 5);
  }

  result.overallEstimatedBand = result.overallBand;
  return result;
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
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(body.task),
    "Scoring order: first assign the four task-specific criterion bands independently from essay evidence; then estimate overallBand. The server will finally recalculate the displayed overallBand from the four criteria.",
    body.isUnderMinimum ? "Important: even though the response is under the recommended word count, you must still grade it as an IELTS response using DeepSeek, start from Band 1 when there is no rateable content, return all sections, apply strict word-count caps, and do not return empty modules." : "",
    "No maximum word count rule: do not cap or penalise high word counts by length alone. Penalise only actual IELTS problems such as repetition, irrelevance, weak organisation, or unclear language.",
    "Use English for the main feedback. Use accurate Chinese explanations only in *Zh fields. These Chinese explanations must follow the exact English meaning and must not be vague template translations. Do not translate the whole essay or revised essays.",
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
    ? "Accurate Chinese explanations may appear only in *Zh fields. They must match the English feedback and not be generic. Do not translate essays."
    : "Main feedback must be English. Include accurate Chinese explanations only in *Zh fields. They must match the English feedback and not be generic. Do not translate essays.";
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


async function parseOrRepairAiJson({ apiKey, model, rawText, body, locale, maxTokens, allowRepair = true, deadline }) {
  try {
    return parseJsonFromProvider(rawText);
  } catch (parseError) {
    // Prefer an AI repair call before showing a partial recovery.
    // Earlier versions returned partial data immediately, which caused user-visible
    // messages such as "AI partial output recovered this score" and removed Chinese buttons.
    if (allowRepair && hasEnoughAiTime(deadline, 12000)) {
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
    jsonMode: false,
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

  output.correctionWarning = lastError
    ? "AI detailed correction retry failed or timed out. The score was returned first. Please retry detailed grading."
    : "AI did not return concrete sentence-level corrections. Please retry detailed grading.";
  output.correctionPassWarning = output.correctionWarning;
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
    jsonMode: false,
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
    "DeepSeek is the only scorer. Do not use or mention local fallback scoring.",
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
    "- When possible, each criterion should also include evidence, whyThisBand, whyNotHigher, and whyNotLower to support examiner-like scoring.",
    "- Do not keep all four criterion bands identical unless the evidence for all four criteria is genuinely equivalent.",
    "- High-band calibration is mandatory: when the evidence shows full task fulfilment, natural organisation, precise vocabulary, flexible grammar, and rare minor errors, use Band 8-9. Do not force such writing into Band 7.",
    "- If you assign Band 7 or lower despite high-band evidence, scoreCalibration.whyNotHigher must name exact score-limiting features from the essay, not vague strictness.",
    "- For every English advice array returned in this score stage, return the matching *Zh array with the same item count. The Chinese explanation must specifically explain the corresponding English item.",
    buildTargetImprovementInstruction(body),
    "Server low-band context:",
    JSON.stringify({ lowBandDiagnostics: diagnostics, capSuggestion: cap }),
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
    jsonMode: false,
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
    "betterExpression must usually be present for every score-impacting correction below Band 9 when there is a safe next-band model. Keep it at the target range, not far above the learner level, and preserve all task-relevant meaning.",
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

function resultSuggestsHighBandForEmptySentenceStage(result) {
  if (!result || typeof result !== "object") return false;
  const overall = Math.max(
    highBandStageNumber(result.overallBand),
    highBandStageNumber(result.overallEstimatedBand),
    highBandStageNumber(result.rawOverallBand)
  );
  const grammarBand = highBandStageNumber(result.criteria?.["Grammatical Range and Accuracy"]?.band);
  const criteriaBands = Object.values(result.criteria || {})
    .map((item) => highBandStageNumber(item?.band))
    .filter((band) => band > 0);
  const allCriteriaHigh = criteriaBands.length >= 4 && criteriaBands.every((band) => band >= 7.5);
  const highBandRange = finalGateText(result.highBandDiagnostics?.recommendedHighBandRange || result.estimatedLevel || "");
  const highBandText = /(^|[^0-9])(?:7\.5|8|8\.0|8\.5|9|9\.0)([^0-9]|$)/.test(highBandRange);
  return overall >= 7.5 || grammarBand >= 7.5 || allCriteriaHigh || highBandText;
}

function shouldTreatEmptySentenceStageAsValid(body = {}, bestOutput = {}) {
  const reference = stageReferenceResult(body, bestOutput);
  return resultSuggestsHighBandForEmptySentenceStage(reference);
}

function removeNoUsableSentenceWarnings(items) {
  return ensureArray(items).filter((item) => {
    const text = String(item || "").toLowerCase();
    return !/sentence stage returned no usable detailed content|sentence stage did not return enough usable detail|ai sentence stage returned no usable detailed content/.test(text);
  });
}

function applyEmptySentenceStageHighBandFallback(bestOutput = {}, body = {}) {
  const output = bestOutput && typeof bestOutput === "object" ? bestOutput : {};
  output.sectionStage = "sentence";
  output.sectionWarning = "";
  output.stageWarnings = removeNoUsableSentenceWarnings(output.stageWarnings);
  output.sentenceCorrections = ensureArray(output.sentenceCorrections);
  output.detailedSentenceCorrections = ensureArray(output.detailedSentenceCorrections);
  output.sentenceCorrectionSummary = output.sentenceCorrectionSummary && typeof output.sentenceCorrectionSummary === "object"
    ? output.sentenceCorrectionSummary
    : {};
  output.sentenceCorrectionSummary.message = output.sentenceCorrectionSummary.message || "No major score-impacting sentence errors were found in this high-band response.";
  output.sentenceCorrectionSummary.messageZh = output.sentenceCorrectionSummary.messageZh || "这篇高分作文没有发现明显影响分数的逐句错误，重点是自然度和细节润色。";
  output.errorAnalysis = output.errorAnalysis && typeof output.errorAnalysis === "object" ? output.errorAnalysis : {};
  output.errorAnalysis.summary = output.errorAnalysis.summary || "No major score-impacting sentence errors were returned; at this band, sentence work should focus on naturalness, concision, and register precision rather than basic correction.";
  output.errorAnalysis.summaryZh = output.errorAnalysis.summaryZh || "未返回明显影响分数的逐句错误；这个分数段应重点润色自然度、简洁度和语气精准度，而不是基础纠错。";
  output.correctionPriority = output.correctionPriority && typeof output.correctionPriority === "object" ? output.correctionPriority : { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] };
  output.correctionPriority.polishLater = ensureArray(output.correctionPriority.polishLater);
  if (!output.correctionPriority.polishLater.some((item) => /naturalness|concision|register/i.test(String(item || "")))) {
    output.correctionPriority.polishLater.push("Polish naturalness, concision, and register precision; no major sentence-level error blocks the score.");
  }
  output.correctionPriority.polishLaterZh = ensureArray(output.correctionPriority.polishLaterZh);
  if (!output.correctionPriority.polishLaterZh.some((item) => String(item || "").includes("自然度"))) {
    output.correctionPriority.polishLaterZh.push("润色表达自然度、简洁度和语气精准度；没有明显逐句错误拉低分数。");
  }
  return output;
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
    task: 9000,
    language: 11000,
    vocabulary: 9000,
    spelling: 4200,
    grammar: 9000,
    sentence: 12000,
    advice: 11000
  };
  const sectionTimeout = safePassTimeout(
    deadline,
    Math.max(90000, Number(process.env.AI_CORRECTION_STAGE_TIMEOUT_MS) || 135000),
    90000
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
        jsonMode: false,
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

  if (section === "sentence" && shouldTreatEmptySentenceStageAsValid(body, bestOutput)) {
    return applyEmptySentenceStageHighBandFallback(bestOutput, body);
  }

  if (section === "grammar") {
    bestOutput.sectionStage = section;
    bestOutput.sectionWarning = "";
    bestOutput.stageWarnings = ensureArray(bestOutput.stageWarnings).filter((item) => !isNonBlockingGrammarWarningText(item));
    bestOutput.grammarErrors = ensureArray(bestOutput.grammarErrors);
    bestOutput.detailedSentenceCorrections = ensureArray(bestOutput.detailedSentenceCorrections);
    bestOutput.grammarAdvice = ensureArray(bestOutput.grammarAdvice);
    bestOutput.grammarAdviceZh = ensureArray(bestOutput.grammarAdviceZh);
    bestOutput.errorAnalysis = bestOutput.errorAnalysis && typeof bestOutput.errorAnalysis === "object" ? bestOutput.errorAnalysis : {};
    bestOutput.errorAnalysis.summary = bestOutput.errorAnalysis.summary || "No major grammar-specific issue was returned in this stage; rely on the overall language, sentence-level, and polishing feedback.";
    bestOutput.errorAnalysis.summaryZh = bestOutput.errorAnalysis.summaryZh || "本次语法专项没有返回明显语法问题；可参考总体语言、逐句修改和润色建议。";
    return bestOutput;
  }

  const warning = lastError?.message || `AI ${section} stage returned no usable detailed content.`;
  bestOutput.sectionStage = section;
  bestOutput.sectionWarning = warning;
  bestOutput.stageWarnings = ensureArray(bestOutput.stageWarnings).concat([
    `${section} stage did not return enough usable detail. Existing grading results were kept.`
  ]);
  if (section === "vocabulary") {
    bestOutput.spellingCorrections = ensureArray(bestOutput.spellingCorrections);
    bestOutput.detailedSentenceCorrections = ensureArray(bestOutput.detailedSentenceCorrections);
    bestOutput.lexicalAdvice = ensureArray(bestOutput.lexicalAdvice);
    bestOutput.errorAnalysis = bestOutput.errorAnalysis && typeof bestOutput.errorAnalysis === "object" ? bestOutput.errorAnalysis : {};
    bestOutput.errorAnalysis.summary = bestOutput.errorAnalysis.summary || "The vocabulary stage did not return enough usable detail; retry this stage for a fuller lexical check.";
    bestOutput.errorAnalysis.summaryZh = bestOutput.errorAnalysis.summaryZh || "词汇检查阶段返回内容不足；可重试获得更完整的词汇反馈。";
  }
  return bestOutput;
}


function scoreAuditLooksNecessary(currentResult) {
  if (!currentResult || typeof currentResult !== "object") return false;
  const criteria = currentResult.criteria && typeof currentResult.criteria === "object" ? currentResult.criteria : {};
  const combined = finalGateText([
    currentResult.overallBand,
    currentResult.estimatedLevel,
    currentResult.highBandDiagnostics?.recommendedHighBandRange,
    currentResult.highBandDiagnostics?.reason,
    currentResult.scoreCalibration?.whyNotHigher,
    currentResult.scoreCalibration?.whyNotLower,
    currentResult.strengths,
    currentResult.mainProblems,
    currentResult.taskAchievementAdvice,
    currentResult.coherenceAdvice,
    currentResult.lexicalAdvice,
    currentResult.grammarAdvice,
    ...Object.values(criteria || {}).map((item) => [item?.band, item?.feedback, item?.howToImprove])
  ], 40);
  const overall = Number(currentResult.overallBand);
  const inferredTask = criteria["Task Achievement"] ? "Task 1" : "Task 2";
  const bands = getWritingCriterionNames(inferredTask)
    .map((name) => Number(criteria?.[name]?.band))
    .filter(Number.isFinite);
  if (bands.length === 4 && Number.isFinite(overall)) {
    const avg = bands.reduce((sum, value) => sum + value, 0) / bands.length;
    const expectedOverall = roundHalf(avg);
    if (expectedOverall !== roundHalf(overall)) return true;
    const allSame = new Set(bands.map((value) => formatBand(roundHalf(value)))).size === 1;
    if (allSame) {
      const differentiationSignals = [
        "underlength", "all three bullet points", "minimally developed", "limited development",
        "basic structure", "cohesive devices", "progression", "vocabulary is basic", "repetitive",
        "word choice", "frequent grammatical errors", "grammar errors", "mostly simple", "subject-verb", "articles",
        "purpose", "tone", "recipient", "position", "argument", "example", "conclusion"
      ];
      if (differentiationSignals.some((signal) => combined.includes(signal))) return true;
    }
  }

  const highBandSignals = [
    "fully addresses", "fully satisfies", "satisfies all task requirements", "all three bullet points", "clear purpose",
    "appropriate tone", "appropriately formal", "well-developed", "well developed", "natural progression", "clear progression",
    "precise vocabulary", "high grammatical accuracy", "flexible grammar", "few errors", "rare minor errors", "band 8", "band 9"
  ];
  const lowBandSignals = [
    "needs clearer control", "needs improvement", "development is limited", "task development is limited", "limited development",
    "vocabulary is limited", "grammar accuracy and sentence control need improvement", "organisation is basic", "organization is basic"
  ];
  const hasHighBandSignal = highBandSignals.some((signal) => combined.includes(signal));
  const hasLowBandTemplate = lowBandSignals.some((signal) => combined.includes(signal));

  if (hasLowBandTemplate && Number.isFinite(overall) && overall >= 6.5) return true;
  if (hasHighBandSignal && Number.isFinite(overall) && overall <= 7) return true;
  if (combined.includes("recommendedhighbandrange") && /8|9/.test(combined) && Number.isFinite(overall) && overall < 8) return true;
  if (ensureArray(currentResult.mainProblems).some((item) => isStrengthLikeFeedbackFinal(item) && !isProblemLikeFeedbackFinal(item))) return true;
  return false;
}

function buildScoreAuditPrompt(body, locale = "en") {
  const current = body.currentResult || {};
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  return [
    "Re-audit this IELTS Writing score using the original prompt and essay. Return one valid JSON object only.",
    "This audit is allowed to correct the overallBand and criterion bands when the current score contradicts the essay evidence, including cases where all four criterion bands were mechanically copied from the overall band.",
    "Do not merely polish wording if the score is wrong. Re-read the original essay and recalibrate using IELTS band descriptor logic.",
    "Do not use Band 7 as a safe default. If the essay fully satisfies the prompt, is naturally organised, uses precise vocabulary, has flexible grammar, and only rare minor errors, correct the score to Band 8-9 as appropriate.",
    "Score each IELTS criterion independently. Do not keep four identical criterion bands unless the essay evidence genuinely supports equal performance in all four criteria. If the current score is kept, explain exactly why it is not higher with concrete evidence from the essay.",
    "Task-specific scoring engine:",
    buildTaskSpecificScoringRubric(task),
    "The server will recalculate the final displayed overallBand from the four returned criterion bands, so return the most accurate independent criterion bands.",
    "If Band 7.5+ is awarded, feedback and advice must sound like minor refinement, not basic control problems.",
    "mainProblems must contain only real problems, not strengths.",
    "Chinese *Zh fields must accurately match adjacent English fields and must not be generic templates.",
    "Return this shape. Include every key if you correct the score; otherwise return scoreAuditSkipped true with a short reason.",
    JSON.stringify({
      scoreAuditSkipped: false,
      overallBand: 1,
      estimatedLevel: "Band 1.0",
      criteria: {
        [firstCriterion]: { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
        "Coherence and Cohesion": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
        "Lexical Resource": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
        "Grammatical Range and Accuracy": { band: 1, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
      },
      highBandDiagnostics: { recommendedHighBandRange: "", reason: "" },
      highBandDiagnosticsZh: { reasonZh: "" },
      scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
      scoreCalibrationZh: { capReasonZh: "", whyNotHigherZh: "", whyNotLowerZh: "", evidenceZh: [] },
      strengths: [], strengthsZh: [], mainProblems: [], mainProblemsZh: [],
      taskAchievementAdvice: [], taskAchievementAdviceZh: [], coherenceAdvice: [], coherenceAdviceZh: [], lexicalAdvice: [], lexicalAdviceZh: [], grammarAdvice: [], grammarAdviceZh: [],
      stageWarnings: []
    }),
    "Current result:",
    JSON.stringify(current).slice(0, 6000),
    "Question:",
    String(body.questionPrompt || "").slice(0, 2500),
    "Essay:",
    String(body.essay || "").slice(0, 6500)
  ].join("\n");
}

async function callAiScoreAuditPass({ apiKey, model, body, locale, deadline }) {
  if (!scoreAuditLooksNecessary(body.currentResult)) {
    return {
      aiStage: "score-audit",
      scoreAuditSkipped: true,
      stageWarnings: ["Score audit skipped because no obvious score-feedback contradiction was detected."]
    };
  }
  try {
    const rawText = await callDeepSeek({
      apiKey,
      model,
      systemPrompt: "You are a strict IELTS senior examiner. Re-audit scoring when evidence contradicts the current band. Return one valid compact JSON object only.",
      userPrompt: buildScoreAuditPrompt(body, locale),
      maxTokens: 4200,
      temperature: 0.0,
      jsonMode: false,
      deadline,
      timeoutMs: Math.min(90000, AI_SINGLE_REQUEST_TIMEOUT_MS)
    });
    const parsed = await parseOrRepairAiJson({
      apiKey,
      model,
      rawText,
      body,
      locale,
      maxTokens: 4200,
      allowRepair: true,
      deadline
    });
    if (parsed && typeof parsed === "object" && !parsed.scoreAuditSkipped) {
      normalizeAiBandsOnly(parsed, body);
      finalizeTaskScoringEngine(parsed, body || {});
      finalQualityGate(parsed, body || {});
      finalizeTaskScoringEngine(parsed, body || {});
    }
    return {
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      aiStage: "score-audit",
      stageWarnings: ensureArray(parsed?.stageWarnings)
    };
  } catch (error) {
    return {
      aiStage: "score-audit",
      scoreAuditSkipped: true,
      stageWarnings: ["Score audit timed out or returned invalid JSON. The original AI score was kept."]
    };
  }
}

function normalizeAiStage(value) {
  const raw = String(value || "all").toLowerCase().replace(/[_\s-]+/g, "");
  if (["score", "scoring", "grade", "grading"].includes(raw)) return "score";
  if (["scoreaudit", "auditscore", "gradingaudit", "audit"].includes(raw)) return "score-audit";
  const focused = normalizeFocusedCorrectionStage(raw);
  if (focused) return `correction-${focused}`;
  if (["correction", "corrections", "error", "errors", "detailedcorrection", "detailedcorrections"].includes(raw)) return "correction";
  if (["revision", "model", "modelanswer", "revisedessay"].includes(raw)) return "revision";
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

function buildFallbackTaskRequirementAnalysis(body, fallbackReason, locale = "en") {
  const prompt = String(body.questionPrompt || "");
  if (body.task === "Task 1") {
    const bulletPoints = extractPromptBulletPoints(prompt).map((requirement) => ({
      requirement,
      covered: null,
      coverageUnknown: true,
      evidence: "Fallback mode was used, so bullet-point coverage could not be checked reliably.",
      problem: "Coverage is unknown rather than confirmed missing."
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
    modelAnswerOutlineZh: "",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: defaultRevisedEssayMeta(revisionLimited, "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions."),
    revisionNotes: [normalLength ? "AI output was incomplete, so this is a temporary fallback estimate. Retry to get full feedback and revisions." : "The response was too short, so only a basic diagnostic score is provided."],
    revisionNotesZh: emptyForLocaleZh([normalLength ? "AI 返回内容不完整；当前只是临时估分，请重试获取完整批改。" : "作文太短，因此这里只提供基础诊断评分。"], locale),
    errorAnalysis: buildFallbackErrorAnalysis(body, words, locale),
    detailedSentenceCorrections: [],
    task1LetterCorrections: body.task === "Task 1" ? { openingComment: "The opening could not be fully checked in fallback mode.", closingComment: "The closing could not be fully checked in fallback mode.", toneComment: "Use a tone suitable for the recipient in the selected prompt.", purposeComment: normalLength ? "Retry for a full purpose and bullet-point check." : "The response is underlength, so the purpose and bullet points need fuller development.", bulletPointAdvice: extractPromptBulletPoints(body.questionPrompt).map((point) => ({ bulletPoint: point, covered: null, coverageUnknown: true, comment: "Coverage could not be fully checked in fallback mode.", suggestedSentence: "" })) } : null,
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
    const requestTimeoutMs = resolveAiTimeout(deadline, timeoutMs);
    if (!hasEnoughAiTime(deadline, Math.min(requestTimeoutMs, 3000))) {
      const timeoutError = new Error("DeepSeek request was skipped because the protected server deadline was too close.");
      timeoutError.code = "DEEPSEEK_TIMEOUT";
      timeoutError.provider = "deepseek";
      timeoutError.detail = "The backend stopped before Vercel could generate a 504 timeout.";
      throw timeoutError;
    }
    const controller = new AbortController();
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
    sendJson(req, res, 503, {
      error: "DeepSeek request timed out before any AI score could be returned.",
      provider: "deepseek",
      detail: "The provider did not return the required scoring result within the protected backend time budget. The request was stopped before Vercel generated a 504.",
      suggestion: "Retry once. If this repeats, check DeepSeek latency or run the score stage first."
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

function rawTextLooksLikeSchemaOnly(rawText = "") {
  const text = String(rawText || "").toLowerCase();
  if (!text.trim()) return true;
  const schemaSignals = [
    '"overallband": 1', '"estimatedlevel": "band 1.0"', '"feedback": ""', '"howtoimprove": ""',
    'replace band 1 placeholders', 'do not copy template values', 'return exactly one valid json object matching this shape'
  ].filter((signal) => text.includes(signal)).length;
  const essaySpecificSignals = [
    'because', 'evidence', 'original', 'corrected', 'this response', 'the essay', 'the letter', 'the candidate', 'the writer'
  ].filter((signal) => text.includes(signal)).length;
  return schemaSignals >= 3 && essaySpecificSignals < 2;
}

function buildAiPartialResultFromText(rawText, body, issue = "") {
  if (rawTextLooksLikeSchemaOnly(rawText)) return null;
  const overall = extractAiNumber(rawText, "overallBand");
  if (!Number.isFinite(overall)) return null;
  if (Number(overall) === 1 && !/band\s*[2-9]|overall\s*band|criterion|scorecalibration|whyNotHigher|why not higher/i.test(String(rawText || ""))) return null;

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
          bulletPoints: extractPromptBulletPoints(body?.questionPrompt).map((requirement) => ({ requirement, covered: null, coverageUnknown: true, evidence: "AI output was repaired; retry for precise coverage evidence." })),
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
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "The recovered AI output did not show a task mismatch.", warning: "" },
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
      openingCommentZh: "开头要直接说明写信目的，让收信人马上明白你为什么写这封信。",
      closingComment: "Use a suitable closing sentence.",
      closingCommentZh: "结尾要符合书信对象和语气，并礼貌收束请求或说明。",
      toneComment: "Match the tone to the recipient.",
      toneCommentZh: "语气要符合你和收信人的关系，正式信不能过于随意。",
      purposeComment: "State why you are writing.",
      purposeCommentZh: "第一段应明确交代写信目的，避免让任务回应显得含糊。",
      bulletPointAdvice: extractPromptBulletPoints(body?.questionPrompt).map((point) => ({ bulletPoint: point, covered: null, coverageUnknown: true, comment: "Check this requirement directly with evidence before deciding coverage.", suggestedSentence: "Add one sentence that answers this bullet point if it is missing.", explanationZh: "需要先核验原文证据，再判断这一要点是否覆盖。" })).slice(0, 5)
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
    modelAnswerOutlineZh: "",
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
  normalized.detailedSentenceCorrections = cleanObjectArray(normalized.detailedSentenceCorrections, ["originalSentence", "correctedSentence", "problem", "rule", "bandImpact"])
    .filter((item, index) => isScoreImpactingDetailedCorrection(normalizeDetailedSentenceCorrectionItem(item, index)))
    .slice(0, correctionLimit);

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
  sanitizeStrengthProblemBuckets(normalized);

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
      normalized.task1LetterCorrections.bulletPointAdvice = points.map((point) => ({ bulletPoint: point, covered: null, coverageUnknown: true, evidenceFromEssay: "", problem: "AI did not return reliable coverage evidence for this bullet point.", comment: "Do not treat this as missing until the essay evidence is checked.", suggestedSentence: "If this requirement is not clearly answered, add one specific sentence with concrete detail.", explanationZh: "AI 没有返回可靠覆盖证据；不能直接判定为未覆盖。" })).slice(0, 5);
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
  sanitizeStrengthProblemBuckets(normalized);
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

  const alignZhArray = (englishItems, zhItems) => {
    const en = ensureArray(englishItems);
    const zh = ensureArray(zhItems).filter(hasUsefulText);
    // Do not invent generic Chinese translations here. If DeepSeek did not return
    // an accurate matching Chinese explanation, leave it blank so the UI does not
    // show misleading template text.
    return zh.slice(0, en.length);
  };

  normalized.taskAchievementAdviceZh = alignZhArray(normalized.taskAchievementAdvice, normalized.taskAchievementAdviceZh);
  normalized.coherenceAdviceZh = alignZhArray(normalized.coherenceAdvice, normalized.coherenceAdviceZh);
  normalized.lexicalAdviceZh = alignZhArray(normalized.lexicalAdvice, normalized.lexicalAdviceZh);
  normalized.grammarAdviceZh = alignZhArray(normalized.grammarAdvice, normalized.grammarAdviceZh);
  normalized.band5FixPlanZh = alignZhArray(normalized.band5FixPlan, normalized.band5FixPlanZh);
  normalized.band6UpgradePlanZh = alignZhArray(normalized.band6UpgradePlan, normalized.band6UpgradePlanZh);
  normalized.band7UpgradePlanZh = alignZhArray(normalized.band7UpgradePlan, normalized.band7UpgradePlanZh);

  if (normalized.task2EssayCorrections && typeof normalized.task2EssayCorrections === "object") {
    if (!Array.isArray(normalized.task2EssayCorrections.developmentAdviceZh) || !normalized.task2EssayCorrections.developmentAdviceZh.length) {
      normalized.task2EssayCorrections.developmentAdviceZh = ensureArray(normalized.task2EssayCorrections.developmentAdvice).map(() => "这个建议可以帮助观点展开更充分。").slice(0, 8);
    }
  }

  if (normalized.task1LetterCorrections && typeof normalized.task1LetterCorrections === "object") {
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

function looksLikeStrengthText(value) {
  const text = compactCorrectionText(value);
  return Boolean(text && (
    text.includes("fully addresses") ||
    text.includes("addresses all") ||
    text.includes("covers all") ||
    text.includes("clear purpose") ||
    text.includes("appropriate tone") ||
    text.includes("well-developed") ||
    text.includes("well developed") ||
    text.includes("clear progression") ||
    text.includes("coherent") ||
    text.includes("accurate language") ||
    text.includes("few errors") ||
    text.includes("strong control") ||
    text.includes("natural")
  ));
}

function looksLikeProblemText(value) {
  const text = compactCorrectionText(value);
  return Boolean(text && (
    text.includes("missing") ||
    text.includes("unclear") ||
    text.includes("limited") ||
    text.includes("underdeveloped") ||
    text.includes("inaccurate") ||
    text.includes("error") ||
    text.includes("weak") ||
    text.includes("needs") ||
    text.includes("lack") ||
    text.includes("not fully") ||
    text.includes("does not")
  ));
}

function dedupeStrings(items) {
  const seen = new Set();
  return cleanStringArray(items).filter((item) => {
    const key = compactCorrectionText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeStrengthProblemBuckets(result) {
  if (!result || typeof result !== "object") return;
  const strengths = dedupeStrings(result.strengths);
  const problems = dedupeStrings(result.mainProblems);
  const movedStrengths = problems.filter((item) => looksLikeStrengthText(item) && !looksLikeProblemText(item));
  result.mainProblems = problems.filter((item) => !(looksLikeStrengthText(item) && !looksLikeProblemText(item))).slice(0, 5);
  result.strengths = dedupeStrings(strengths.concat(movedStrengths)).filter((item) => !looksLikeProblemText(item) || looksLikeStrengthText(item)).slice(0, 5);
  if (Array.isArray(result.mainProblemsZh) && result.mainProblemsZh.length > result.mainProblems.length) {
    result.mainProblemsZh = result.mainProblemsZh.slice(0, result.mainProblems.length);
  }
}

function criterionHasLowBandTemplate(item) {
  const text = compactCorrectionText([item?.feedback, item?.howToImprove].filter(Boolean).join(" "));
  return Boolean(text && (
    text.includes("needs clearer control") ||
    text.includes("need clearer control") ||
    text.includes("needs more precision and range") ||
    text.includes("needs improvement") ||
    text.includes("need improvement") ||
    text.includes("task development is limited") ||
    text.includes("grammar errors reduce clarity") ||
    text.includes("vocabulary is limited") ||
    text.includes("organisation is basic")
  ));
}

function polishHighBandCriteria(result, body) {
  if (!result?.criteria || typeof result.criteria !== "object") return;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  Object.entries(result.criteria).forEach(([name, item]) => {
    const band = Number(item?.band);
    if (!item || Number.isNaN(band) || band < 7.5 || !criterionHasLowBandTemplate(item)) return;
    if (name === firstCriterion) {
      item.feedback = task === "Task 1"
        ? "The letter shows strong task fulfilment, clear purpose, and generally appropriate tone. Any remaining issue is minor refinement rather than basic task coverage."
        : "The essay gives a strong, relevant response with a clear position and well-developed ideas. Any remaining issue is minor refinement rather than basic task response.";
      item.howToImprove = task === "Task 1"
        ? "Polish the precision of details and make the tone consistently natural throughout the letter."
        : "Polish the depth of examples and make the final line of reasoning even more precise.";
    } else if (name === "Coherence and Cohesion") {
      item.feedback = "Organisation is clear and progression is effective. Any cohesion issue is a minor polishing point, not a basic control problem.";
      item.howToImprove = "Refine paragraph transitions and avoid any slightly mechanical linking.";
    } else if (name === "Lexical Resource") {
      item.feedback = "Vocabulary is accurate and flexible enough for a high band. Remaining lexical work is about precision and natural collocation.";
      item.howToImprove = "Replace any slightly general wording with more exact but still natural IELTS General Training phrasing.";
    } else if (name === "Grammatical Range and Accuracy") {
      item.feedback = "Grammar control is strong, with only minor accuracy or naturalness issues if any. This is not a major sentence-control weakness.";
      item.howToImprove = "Polish small slips in complex sentences and keep sentence variety natural.";
    }
  });
}

function finalGateText(value, limit = 12) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, limit)
      .map((item) => finalGateText(item, 4))
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  if (typeof value === "object") {
    return Object.values(value)
      .slice(0, limit)
      .map((item) => finalGateText(item, 4))
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function finalGateList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (item === null || item === undefined) return false;
    if (typeof item === "string") return item.trim();
    return finalGateText(item);
  });
}

function finalGateDedupe(items) {
  const seen = new Set();
  return finalGateList(items).filter((item) => {
    const key = finalGateText(item).replace(/[.,!?;:'"()，。！？；：“”‘’]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isStrengthLikeFeedbackFinal(value) {
  const text = finalGateText(value);
  if (!text) return false;

  const positiveSignals = [
    "fully addresses",
    "fully address",
    "fully satisfies",
    "satisfies all task requirements",
    "satisfies the task requirements",
    "fully answers",
    "fully fulfils",
    "fully fulfills",
    "addresses all",
    "covers all",
    "all bullet points are covered",
    "all task requirements",
    "clear purpose",
    "purpose is clear",
    "appropriate tone",
    "appropriately formal",
    "appropriately polite",
    "formal and polite",
    "clear and polite",
    "well-developed",
    "well developed",
    "specific content",
    "clear progression",
    "logical progression",
    "logically ordered",
    "coherent",
    "well organised",
    "well organized",
    "accurate language",
    "high grammatical accuracy",
    "grammatical accuracy is high",
    "precise and natural",
    "vocabulary is precise",
    "natural vocabulary",
    "strong control",
    "effective",
    "minor polishing",
    "minor refinement"
  ];

  const problemSignals = [
    "but",
    "however",
    "although",
    "needs",
    "need to",
    "need improvement",
    "needs improvement",
    "missing",
    "limited",
    "underdeveloped",
    "unclear",
    "inaccurate",
    "error",
    "errors",
    "weak",
    "lack",
    "lacks",
    "not fully",
    "does not",
    "fails to",
    "problem"
  ];

  return positiveSignals.some((signal) => text.includes(signal)) &&
    !problemSignals.some((signal) => text.includes(signal));
}

function isProblemLikeFeedbackFinal(value) {
  const text = finalGateText(value);
  if (!text) return false;

  return [
    "missing",
    "unclear",
    "limited",
    "underdeveloped",
    "inaccurate",
    "error",
    "errors",
    "weak",
    "needs",
    "need improvement",
    "needs improvement",
    "lack",
    "lacks",
    "not fully",
    "does not",
    "fails to",
    "inappropriate",
    "wrong tone",
    "off-topic",
    "copied",
    "repetitive",
    "mechanical",
    "fragment",
    "run-on"
  ].some((signal) => text.includes(signal));
}

function sanitizeStrengthProblemBucketsFinal(result) {
  if (!result || typeof result !== "object") return;

  const rawStrengths = finalGateDedupe(result.strengths);
  const rawStrengthsZh = Array.isArray(result.strengthsZh) ? result.strengthsZh : [];
  const rawProblems = finalGateDedupe(result.mainProblems);
  const rawProblemsZh = Array.isArray(result.mainProblemsZh) ? result.mainProblemsZh : [];

  const keptProblems = [];
  const keptProblemsZh = [];
  const movedStrengths = [];
  const movedStrengthsZh = [];

  rawProblems.forEach((item, index) => {
    if (isStrengthLikeFeedbackFinal(item) && !isProblemLikeFeedbackFinal(item)) {
      movedStrengths.push(item);
      if (rawProblemsZh[index]) movedStrengthsZh.push(rawProblemsZh[index]);
      return;
    }

    keptProblems.push(item);
    if (rawProblemsZh[index]) keptProblemsZh.push(rawProblemsZh[index]);
  });

  result.mainProblems = finalGateDedupe(keptProblems).slice(0, 6);
  result.mainProblemsZh = keptProblemsZh.slice(0, result.mainProblems.length);

  result.strengths = finalGateDedupe(rawStrengths.concat(movedStrengths))
    .filter((item) => isStrengthLikeFeedbackFinal(item) || !isProblemLikeFeedbackFinal(item))
    .slice(0, 6);

  result.strengthsZh = rawStrengthsZh.concat(movedStrengthsZh).slice(0, result.strengths.length);
}

function isGenericChineseNoteFinal(value) {
  const text = String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：“”‘’、,.!?;:'"]/g, "")
    .trim()
    .toLowerCase();

  if (!text) return false;

  const genericNotes = new Set([
    "更完整地回应题目",
    "任务回应需要更完整",
    "观点和展开需要更清楚",
    "明确立场并展开理由",
    "这里说明开头是否合适",
    "这里说明结尾是否合适",
    "逐条覆盖题目要点",
    "结构和衔接需要更清楚",
    "分段并自然使用连接词",
    "词汇需要更准确更多样",
    "使用更准确的题目词汇",
    "语法准确性和句子控制需提升",
    "先写完整准确的句子",
    "先保证句子语法准确",
    "替换模糊词使用题目相关词汇",
    "衔接更自然",
    "内容和语言仍需加强",
    "这个问题会影响写作分数",
    "这是评分依据之一",
    "高分证据尚不充分",
    "有尝试回应题目",
    "有一些相关内容",
    "字数不足会影响展开",
    "语法错误影响清晰度",
    "词汇准确性需要提升",
    "结构和衔接需要加强",
    "主要问题集中在任务回应结构词汇或语法",
    "先修改最影响分数的问题",
    "简短优点解释",
    "简短问题解释",
    "简短低分原因解释",
    "简短高分证据解释",
    "简短限分原因解释",
    "简短说明为什么不能更高",
    "简短说明为什么没有更低",
    "简短证据解释",
    "briefchineseexplanation",
    "briefchinesesuggestion",
    "briefchinesesummary"
  ]);

  return genericNotes.has(text);
}

function cleanChineseHelperValueFinal(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanChineseHelperValueFinal(item))
      .filter((item) => {
        if (Array.isArray(item)) return item.length > 0;
        if (item && typeof item === "object") return Object.keys(item).length > 0;
        return String(item || "").trim();
      });
  }

  if (value && typeof value === "object") {
    const cleaned = { ...value };
    Object.keys(cleaned).forEach((key) => {
      cleaned[key] = cleanChineseHelperValueFinal(cleaned[key]);
    });
    return cleaned;
  }

  if (typeof value === "string" && isGenericChineseNoteFinal(value)) return "";
  return value;
}

function cleanGenericChineseFieldsFinal(value) {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => cleanGenericChineseFieldsFinal(item));
  }

  Object.keys(value).forEach((key) => {
    const fieldValue = value[key];

    if (key.endsWith("Zh")) {
      value[key] = cleanChineseHelperValueFinal(fieldValue);
      return;
    }

    if (fieldValue && typeof fieldValue === "object") {
      value[key] = cleanGenericChineseFieldsFinal(fieldValue);
    }
  });

  return value;
}

function isHighBandResultFinal(result) {
  const overall = Number(result?.overallBand || 0);
  if (Number.isFinite(overall) && overall >= 7.5) return true;

  const criteriaBands = Object.values(result?.criteria || {})
    .map((item) => Number(item?.band))
    .filter((band) => Number.isFinite(band));

  if (criteriaBands.length >= 4 && criteriaBands.every((band) => band >= 7.5)) return true;

  const highBandRange = finalGateText(result?.highBandDiagnostics?.recommendedHighBandRange);
  return /(^|[^0-9])(?:8|8\.0|8\.5|9|9\.0)([^0-9]|$)/.test(highBandRange);
}

function isLowBandTemplateTextFinal(value) {
  const text = finalGateText(value);
  if (!text) return false;

  return [
    "task development is limited",
    "task response is limited",
    "task achievement is limited",
    "development is limited",
    "grammar accuracy and sentence control need improvement",
    "grammar accuracy and sentence control needs improvement",
    "grammar needs improvement",
    "grammar need improvement",
    "needs improvement",
    "need improvement",
    "needs clearer control",
    "need clearer control",
    "needs more precision and range",
    "vocabulary is limited",
    "lexical resource is limited",
    "organisation is basic",
    "organization is basic",
    "grammar errors reduce clarity",
    "limited task response",
    "limited task achievement",
    "ideas are underdeveloped",
    "paragraphing is weak",
    "meaning is unclear"
  ].some((signal) => text.includes(signal));
}


function isOverAdvancedHighBandAdviceFinal(value) {
  const text = finalGateText(value);
  if (!text) return false;
  return [
    "sophisticated lexical items",
    "more sophisticated lexical",
    "synergistic opportunities",
    "holistic understanding",
    "inversion",
    "more complex conditional forms",
    "complex conditional forms",
    "flawless grammatical accuracy",
    "punctuation is consistently perfect",
    "perfect punctuation",
    "aim for flawless",
    "less common lexical items",
    "use a wider range of linking phrases",
    "more complex grammatical structures"
  ].some((signal) => text.includes(signal));
}

function highBandAdviceOnlyReplacementFinal(name, task) {
  const firstCriterion = firstCriterionName(task);
  if (name === firstCriterion) {
    return task === "Task 1"
      ? {
          howToImprove: "At this band, improve by making each detail more specific, concise, and naturally useful for the manager-reader.",
          howToImproveZh: "这个分数段应把细节写得更具体、更简洁，并且更自然地服务于经理读者。"
        }
      : {
          howToImprove: "At this band, improve by sharpening the line of reasoning, making examples more precise, and keeping the argument natural.",
          howToImproveZh: "这个分数段应让论证线更清楚、例子更精准，并保持表达自然。"
        };
  }
  if (name === "Coherence and Cohesion") {
    return {
      howToImprove: "Polish paragraph transitions so the progression feels effortless, rather than adding more obvious linking phrases.",
      howToImproveZh: "润色段落过渡，让推进更自然，而不是堆更多明显连接词。"
    };
  }
  if (name === "Lexical Resource") {
    return {
      howToImprove: task === "Task 1"
        ? "Choose wording that is more specific to the workplace situation while keeping the letter natural and not over-formal."
        : "Choose more precise topic wording where it genuinely clarifies the argument, without forcing rare or showy vocabulary.",
      howToImproveZh: task === "Task 1"
        ? "选择更贴合职场情境的措辞，同时保持书信自然，不要过度正式。"
        : "只在能让论证更清楚时使用更精准的话题词，不要强行使用生僻或炫技词汇。"
    };
  }
  if (name === "Grammatical Range and Accuracy") {
    return {
      howToImprove: "Polish small accuracy, punctuation, and sentence-balance details; do not add complex structures just to look advanced.",
      howToImproveZh: "润色轻微准确性、标点和句子平衡问题，不要为了显得高级而硬加复杂结构。"
    };
  }
  return {
    howToImprove: "Focus on naturalness, precision, concision, and consistency rather than adding showy language.",
    howToImproveZh: "重点提升自然度、精准度、简洁度和一致性，而不是增加炫技表达。"
  };
}

function sanitizeHighBandOverAdvancedCriterionAdviceFinal(result, body = {}) {
  if (!result?.criteria || typeof result.criteria !== "object") return;
  if (!isHighBandResultFinal(result)) return;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  Object.entries(result.criteria).forEach(([name, item]) => {
    if (!item || typeof item !== "object") return;
    const band = Number(item.band);
    if (!Number.isFinite(band) || band < 7.5) return;
    if (!isOverAdvancedHighBandAdviceFinal([item.howToImprove, item.howToImproveZh, item.feedback].join(" "))) return;
    const replacement = highBandAdviceOnlyReplacementFinal(name, task);
    item.howToImprove = replacement.howToImprove;
    item.howToImproveZh = replacement.howToImproveZh;
  });
}

function sanitizeHighBandOverAdvancedAdviceArraysFinal(result, body = {}) {
  if (!result || typeof result !== "object" || !isHighBandResultFinal(result)) return;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const replacements = {
    taskAchievementAdvice: task === "Task 1"
      ? ["Make the workplace benefit and career-development details even more specific while keeping the letter natural and concise."]
      : ["Sharpen the central line of reasoning and make examples more precise rather than adding more complex language."],
    taskAchievementAdviceZh: task === "Task 1"
      ? ["把公司受益和职业发展细节写得更具体，同时保持书信自然简洁。"]
      : ["让核心论证线更清楚，例子更精准，而不是增加复杂语言。"],
    coherenceAdvice: ["Make transitions feel effortless by linking each paragraph’s purpose naturally to the next."],
    coherenceAdviceZh: ["让段落目的之间自然衔接，使过渡更顺，而不是机械增加连接词。"],
    lexicalAdvice: task === "Task 1"
      ? ["Use more situation-specific workplace wording only where it makes the letter clearer and more natural."]
      : ["Use more precise topic vocabulary only where it clarifies the argument; avoid rare vocabulary for its own sake."],
    lexicalAdviceZh: task === "Task 1"
      ? ["只在能让书信更清楚自然时，使用更贴合职场情境的词。"]
      : ["只在能让论证更清楚时使用更精准的话题词，避免为了高级而用生僻词。"],
    grammarAdvice: ["Polish minor accuracy, punctuation, and sentence rhythm; avoid adding complex structures just to appear advanced."],
    grammarAdviceZh: ["润色轻微准确性、标点和句子节奏，不要为了显得高级而硬加复杂结构。"]
  };

  [
    ["taskAchievementAdvice", "taskAchievementAdviceZh"],
    ["coherenceAdvice", "coherenceAdviceZh"],
    ["lexicalAdvice", "lexicalAdviceZh"],
    ["grammarAdvice", "grammarAdviceZh"]
  ].forEach(([enKey, zhKey]) => {
    const items = ensureArray(result[enKey]);
    if (!items.some(isOverAdvancedHighBandAdviceFinal)) return;
    result[enKey] = replacements[enKey];
    result[zhKey] = replacements[zhKey];
  });

  if (result.targetImprovementPlan?.criterionUpgrades && Array.isArray(result.targetImprovementPlan.criterionUpgrades)) {
    result.targetImprovementPlan.criterionUpgrades = result.targetImprovementPlan.criterionUpgrades.map((item) => {
      if (!item || typeof item !== "object") return item;
      const updated = { ...item };
      if (isOverAdvancedHighBandAdviceFinal([updated.action, updated.exampleUpgrade, updated.target].join(" "))) {
        updated.action = "Polish naturalness, specificity, concision, and consistency instead of adding showy complexity.";
        updated.actionZh = "润色自然度、具体性、简洁度和一致性，而不是增加炫技复杂度。";
        if (isOverAdvancedHighBandAdviceFinal(updated.exampleUpgrade)) {
          updated.exampleUpgrade = "Make the point more specific and natural while preserving the original meaning.";
          updated.exampleUpgradeZh = "在保留原意的基础上，把表达写得更具体、更自然。";
        }
      }
      return updated;
    });
  }
}

function highBandCriterionReplacementFinal(name, task) {
  const firstCriterion = firstCriterionName(task);

  if (name === firstCriterion) {
    return task === "Task 1"
      ? {
          feedback: "The letter shows strong task fulfilment, clear purpose, appropriate tone, and effective coverage of the required bullet points.",
          feedbackZh: "这封信任务完成度高，目的清楚，语气合适，并且有效覆盖了题目要点。",
          howToImprove: "At this band, improvement should focus on making details even more natural, concise, and consistently purposeful.",
          howToImproveZh: "这个分数段的提升重点是让细节更自然、更简洁，并始终服务于写信目的。"
        }
      : {
          feedback: "The essay addresses the task strongly, presents a clear position, and develops relevant ideas with good control.",
          feedbackZh: "这篇文章回应题目较充分，立场清楚，观点展开相关且控制较好。",
          howToImprove: "At this band, improvement should focus on sharper idea development, more precise examples, and more natural progression.",
          howToImproveZh: "这个分数段的提升重点是观点展开更深入、例子更精准、推进更自然。"
        };
  }

  if (name === "Coherence and Cohesion") {
    return {
      feedback: "Organisation is clear and progression is effective; any cohesion issue is a minor polishing point rather than a basic control problem.",
      feedbackZh: "文章结构清楚，推进有效；衔接方面即使有问题，也属于润色层面，不是基础结构问题。",
      howToImprove: "Refine paragraph transitions and avoid any slightly mechanical linking.",
      howToImproveZh: "可以进一步润色段落过渡，避免连接词显得机械。"
    };
  }

  if (name === "Lexical Resource") {
    return {
      feedback: "Vocabulary is generally precise, natural, and suitable for the task, with enough range for a high-band response.",
      feedbackZh: "词汇整体准确自然，适合题目语境，已经具备高分作文所需的词汇范围。",
      howToImprove: "Improve by choosing even more topic-specific collocations and avoiding any repeated safe wording.",
      howToImproveZh: "提升重点是使用更贴合话题的搭配，并减少重复的安全表达。"
    };
  }

  if (name === "Grammatical Range and Accuracy") {
    return {
      feedback: "Grammar control is strong, with varied sentence structures and only minor issues, if any.",
      feedbackZh: "语法控制较强，句式有变化，即使有问题也多为轻微问题。",
      howToImprove: "Polish sentence variety and punctuation consistency rather than fixing basic grammar control.",
      howToImproveZh: "提升重点是句式变化和标点一致性，而不是基础语法控制。"
    };
  }

  return {
    feedback: "This criterion is generally well controlled, with only minor refinement needed.",
    feedbackZh: "这一项整体控制较好，只需要做细节润色。",
    howToImprove: "Focus on precision, naturalness, and consistency.",
    howToImproveZh: "重点提升表达精准度、自然度和一致性。"
  };
}

function polishHighBandCriteriaFinal(result, body) {
  if (!result?.criteria || typeof result.criteria !== "object") return;

  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";

  Object.entries(result.criteria).forEach(([name, item]) => {
    if (!item || typeof item !== "object") return;

    const band = Number(item.band);
    if (!Number.isFinite(band) || band < 7.5) return;

    const combined = finalGateText([item.feedback, item.howToImprove, item.feedbackZh, item.howToImproveZh]);
    if (!isLowBandTemplateTextFinal(combined) && !isGenericChineseNoteFinal(item.feedbackZh) && !isGenericChineseNoteFinal(item.howToImproveZh)) return;

    const replacement = highBandCriterionReplacementFinal(name, task);
    item.feedback = replacement.feedback;
    item.feedbackZh = replacement.feedbackZh;
    item.howToImprove = replacement.howToImprove;
    item.howToImproveZh = replacement.howToImproveZh;
  });
}

function removeHighBandContradictionsFinal(result) {
  if (!result || typeof result !== "object" || !isHighBandResultFinal(result)) return;

  const cleanAdviceArray = (items, zhItems, { removeStrengths = false } = {}) => {
    const source = finalGateList(items);
    const zhSource = Array.isArray(zhItems) ? zhItems : [];
    const kept = [];
    const keptZh = [];

    source.forEach((item, index) => {
      if (isLowBandTemplateTextFinal(item)) return;
      if (removeStrengths && isStrengthLikeFeedbackFinal(item) && !isProblemLikeFeedbackFinal(item)) return;
      kept.push(item);
      if (zhSource[index] && !isGenericChineseNoteFinal(zhSource[index])) keptZh.push(zhSource[index]);
    });

    return { items: finalGateDedupe(kept), zh: keptZh.slice(0, kept.length) };
  };

  const mainProblems = cleanAdviceArray(result.mainProblems, result.mainProblemsZh, { removeStrengths: true });
  result.mainProblems = mainProblems.items;
  result.mainProblemsZh = mainProblems.zh;

  const taskAdvice = cleanAdviceArray(result.taskAchievementAdvice, result.taskAchievementAdviceZh);
  result.taskAchievementAdvice = taskAdvice.items;
  result.taskAchievementAdviceZh = taskAdvice.zh;

  const coherenceAdvice = cleanAdviceArray(result.coherenceAdvice, result.coherenceAdviceZh);
  result.coherenceAdvice = coherenceAdvice.items;
  result.coherenceAdviceZh = coherenceAdvice.zh;

  const lexicalAdvice = cleanAdviceArray(result.lexicalAdvice, result.lexicalAdviceZh);
  result.lexicalAdvice = lexicalAdvice.items;
  result.lexicalAdviceZh = lexicalAdvice.zh;

  const grammarAdvice = cleanAdviceArray(result.grammarAdvice, result.grammarAdviceZh);
  result.grammarAdvice = grammarAdvice.items;
  result.grammarAdviceZh = grammarAdvice.zh;

  if (!result.mainProblems.length) {
    result.mainProblems = [
      "No major score-limiting problem was identified at this band; focus on minor refinement, naturalness, and consistency."
    ];
    result.mainProblemsZh = [
      "这个分数段没有明显拉低分数的大问题，重点应放在细节润色、表达自然度和一致性上。"
    ];
  }

  if (result.targetImprovementPlan?.criterionUpgrades && Array.isArray(result.targetImprovementPlan.criterionUpgrades)) {
    result.targetImprovementPlan.criterionUpgrades = result.targetImprovementPlan.criterionUpgrades.map((item) => {
      if (!item || typeof item !== "object") return item;

      const updated = { ...item };

      if (isLowBandTemplateTextFinal(updated.currentWeakness)) {
        updated.currentWeakness = "Only minor refinement is still possible in this criterion.";
        updated.currentWeaknessZh = "这一项主要是细节润色空间，不是基础能力问题。";
      }

      if (isLowBandTemplateTextFinal(updated.action)) {
        updated.action = "Polish precision, naturalness, and consistency rather than fixing basic control problems.";
        updated.actionZh = "重点润色精准度、自然度和一致性，而不是修基础控制问题。";
      }

      if (isLowBandTemplateTextFinal(updated.exampleUpgrade)) {
        updated.exampleUpgrade = "";
        updated.exampleUpgradeZh = "";
      }

      return updated;
    });
  }
}

function removeContradictoryLowBandDiagnosticsFinal(result) {
  if (!result || typeof result !== "object" || !isHighBandResultFinal(result)) return;

  const diagnostics = result.lowBandDiagnostics;
  if (diagnostics && typeof diagnostics === "object") {
    const hasRealLowBandTrigger =
      diagnostics.isBlank ||
      diagnostics.wordCount20OrFewer ||
      diagnostics.mostlyNonEnglish ||
      diagnostics.mostlyCopiedFromPrompt ||
      diagnostics.mostlyMemorised ||
      diagnostics.whollyUnrelated ||
      diagnostics.barelyRelated ||
      diagnostics.littleRelevantMessage ||
      diagnostics.noClearPositionTask2 ||
      diagnostics.noBulletPointCoverageTask1 ||
      diagnostics.meaningMostlyBlocked;

    if (!hasRealLowBandTrigger) {
      diagnostics.recommendedLowBandRange = "";
      diagnostics.reason = "No low-band trigger was detected.";
      if (result.lowBandDiagnosticsZh && typeof result.lowBandDiagnosticsZh === "object") {
        result.lowBandDiagnosticsZh.reasonZh = "没有发现明显低分段触发原因。";
      }
    }
  }

  const calibration = result.scoreCalibration;
  if (calibration && typeof calibration === "object") {
    const capText = finalGateText(calibration.capReason);
    const falseCap =
      !capText ||
      capText.includes("no low-band trigger") ||
      capText.includes("task coverage, word count, organisation, vocabulary, or grammar evidence");

    if (calibration.capApplied && falseCap) {
      calibration.capApplied = false;
      calibration.capReason = "";
      if (result.scoreCalibrationZh && typeof result.scoreCalibrationZh === "object") {
        result.scoreCalibrationZh.capReasonZh = "";
      }
    }
  }
}

function ensureTaskCorrectionZhFieldsFinal(result) {
  if (!result || typeof result !== "object") return;

  if (result.task1LetterCorrections && typeof result.task1LetterCorrections === "object") {
    const c = result.task1LetterCorrections;
    c.openingCommentZh = c.openingCommentZh || "";
    c.closingCommentZh = c.closingCommentZh || "";
    c.toneCommentZh = c.toneCommentZh || "";
    c.purposeCommentZh = c.purposeCommentZh || "";
    if (!Array.isArray(c.bulletPointAdvice)) c.bulletPointAdvice = [];
  }

  if (result.task2EssayCorrections && typeof result.task2EssayCorrections === "object") {
    const c = result.task2EssayCorrections;
    c.positionCommentZh = c.positionCommentZh || "";
    c.introductionCommentZh = c.introductionCommentZh || "";
    c.bodyParagraphCommentZh = c.bodyParagraphCommentZh || "";
    c.exampleCommentZh = c.exampleCommentZh || "";
    c.conclusionCommentZh = c.conclusionCommentZh || "";
    if (!Array.isArray(c.developmentAdvice)) c.developmentAdvice = [];
    if (!Array.isArray(c.developmentAdviceZh)) c.developmentAdviceZh = [];
  }

  result.modelAnswerOutlineZh = result.modelAnswerOutlineZh || "";
}

function bulletRequirementText(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item === "object") return String(item.requirement || item.bulletPoint || item.point || item.taskRequirement || item.text || "");
  return String(item || "");
}

function isPlaceholderBulletRequirement(item) {
  const text = bulletRequirementText(item).trim();
  return !text || /^bullet\s*point\s*\d+$/i.test(text) || /^point\s*\d+$/i.test(text);
}

function promptBulletRequirements(body) {
  const fromPayload = ensureArray(body?.task1BulletPoints)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (fromPayload.length) return fromPayload.slice(0, 5);
  return extractPromptBulletPoints(body?.questionPrompt).slice(0, 5);
}

function repairTaskRequirementAnalysisFinal(result, body = {}) {
  if (!result || typeof result !== "object" || body?.task !== "Task 1") return;
  const points = promptBulletRequirements(body);

  const analysis = result.taskRequirementAnalysis && typeof result.taskRequirementAnalysis === "object"
    ? result.taskRequirementAnalysis
    : {};
  const bullets = ensureArray(analysis.bulletPoints);

  if (!points.length && bullets.some((item) => isPlaceholderBulletRequirement(item))) {
    analysis.taskType = "task1";
    analysis.bulletPoints = bullets.map(() => ({
      requirement: "AI did not reliably return this prompt bullet point",
      covered: null,
      coverageUnknown: true,
      evidence: "The AI output used a placeholder label instead of a real prompt requirement.",
      problem: "Coverage is unknown rather than confirmed missing.",
      suggestion: "Retry task analysis or check the original prompt manually."
    }));
    analysis.missingRequirements = [];
    analysis.taskMatchSummary = analysis.taskMatchSummary || "Reliable bullet-point coverage evidence was not returned.";
    result.taskRequirementAnalysis = analysis;
    result.taskRequirementAnalysisZh = result.taskRequirementAnalysisZh && typeof result.taskRequirementAnalysisZh === "object" ? result.taskRequirementAnalysisZh : {};
    result.taskRequirementAnalysisZh.bulletPointsZh = analysis.bulletPoints.map(() => "AI 只返回了占位要点，不能判定为未覆盖；需要重新核验题目要点和原文证据。");
    result.taskRequirementAnalysisZh.taskMatchSummaryZh = result.taskRequirementAnalysisZh.taskMatchSummaryZh || "要点覆盖情况需要更可靠的 AI 证据。";
    return;
  }
  if (!points.length) return;
  const hasPlaceholder = !bullets.length || bullets.some((item) => isPlaceholderBulletRequirement(item));
  const hasTooFewRealBullets = bullets.filter((item) => !isPlaceholderBulletRequirement(item)).length < Math.min(points.length, 3);

  if (hasPlaceholder || hasTooFewRealBullets) {
    analysis.taskType = "task1";
    analysis.bulletPoints = points.map((requirement) => ({
      requirement,
      covered: null,
      evidence: "AI did not return reliable bullet-point coverage evidence for this item.",
      problem: "Coverage is unknown rather than confirmed missing.",
      suggestion: "Retry or check the letter manually to confirm whether this bullet point is directly answered with concrete detail.",
      coverageUnknown: true
    }));
    analysis.missingRequirements = [];
    analysis.taskMatchSummary = analysis.taskMatchSummary || "The prompt bullet points were extracted, but reliable AI coverage evidence was not returned for every point.";
    result.taskRequirementAnalysis = analysis;

    result.taskRequirementAnalysisZh = result.taskRequirementAnalysisZh && typeof result.taskRequirementAnalysisZh === "object"
      ? result.taskRequirementAnalysisZh
      : {};
    if (!Array.isArray(result.taskRequirementAnalysisZh.bulletPointsZh) || !result.taskRequirementAnalysisZh.bulletPointsZh.length) {
      result.taskRequirementAnalysisZh.bulletPointsZh = points.map(() => "系统已提取该题目要点，但本次 AI 没有可靠返回覆盖证据；这里不能直接判定为未覆盖。");
    }
    result.taskRequirementAnalysisZh.taskMatchSummaryZh = result.taskRequirementAnalysisZh.taskMatchSummaryZh || "题目要点已提取，但覆盖情况需要更可靠的 AI 证据。";
  }
}


function isNonBlockingGrammarWarningText(value) {
  return /grammar stage returned no usable detailed content|grammar stage did not return enough usable detail|AI grammar stage returned no usable detailed content|AI JSON was repaired after|Unterminated string in JSON|malformed JSON/i.test(String(value || ""));
}

function ensureAlignedZhArrayFinal(items, zhItems, dictionary = {}) {
  const en = ensureArray(items).filter((item) => hasUsefulText(item));
  const zh = ensureArray(zhItems).filter((item) => hasUsefulText(item));
  return en.map((item, index) => {
    const existing = zh[index];
    if (existing && !isGenericChineseNoteFinal(existing)) return existing;
    const key = String(item || "").trim().toLowerCase();
    if (dictionary[key]) return dictionary[key];
    return `这条建议对应英文内容：“${String(item || "").slice(0, 70)}”。请按这一步具体修改，提升该项评分表现。`;
  });
}

function normalizeBandPlanVisibilityAndZhFinal(result) {
  if (!result || typeof result !== "object") return;
  const band = Number(result.overallBand || 0);
  if (Number.isFinite(band) && band > 7) {
    result.band5FixPlan = [];
    result.band5FixPlanZh = [];
    result.band6UpgradePlan = [];
    result.band6UpgradePlanZh = [];
    result.band7UpgradePlan = [];
    result.band7UpgradePlanZh = [];
    result.lowBandPlanHidden = true;
    result.lowBandPlanHiddenReason = "The estimated band is above 7.0, so Band 5/6/7 ladder advice is not shown. Use the target improvement plan and high-band polishing advice instead.";
    return;
  }

  const band5Dict = {
    "cover the task more completely.": "更完整地回应题目，确保每个要求都有直接回答。",
    "use clear paragraphs.": "使用清楚的段落，让读者容易看出每一段的作用。",
    "write mostly accurate simple sentences.": "先写准确的简单句，减少基础语法错误。",
    "use basic topic vocabulary correctly.": "先把基础话题词用准确，避免为了高级而误用词。"
  };
  const band6Dict = {
    "develop each main idea with a reason and example.": "每个主要观点都要配一个原因和例子，避免只列观点。",
    "use linking words naturally, not mechanically.": "连接词要自然服务于逻辑，不要机械堆砌。",
    "use a wider range of accurate topic vocabulary.": "扩大话题词汇范围，但要优先保证用词准确。",
    "mix simple and some complex sentences accurately.": "在准确简单句基础上加入部分准确复杂句。"
  };
  const band7Dict = {
    "make ideas more precise and fully developed.": "把观点写得更具体、更充分，减少笼统表达。",
    "use natural cohesion across paragraphs.": "段落之间要自然衔接，而不是只靠连接词。",
    "choose more exact collocations.": "选择更准确的搭配，提高词汇自然度。",
    "reduce grammar errors in complex sentences.": "减少复杂句中的语法错误，保持表达灵活且准确。"
  };

  if (ensureArray(result.band5FixPlan).length) result.band5FixPlanZh = ensureAlignedZhArrayFinal(result.band5FixPlan, result.band5FixPlanZh, band5Dict);
  if (ensureArray(result.band6UpgradePlan).length) result.band6UpgradePlanZh = ensureAlignedZhArrayFinal(result.band6UpgradePlan, result.band6UpgradePlanZh, band6Dict);
  if (ensureArray(result.band7UpgradePlan).length) result.band7UpgradePlanZh = ensureAlignedZhArrayFinal(result.band7UpgradePlan, result.band7UpgradePlanZh, band7Dict);
}


function betterExpressionTargetRangeLabel(bandValue) {
  return targetImprovementRangeFromBand(bandValue).label;
}

function buildFallbackBetterExpression(correctedSentence, bandValue, body = {}) {
  const band = clampAiBand(bandValue, 5);
  if (band >= 9) return "";
  const source = String(correctedSentence || "").trim();
  if (!source || tokenizeExpressionForComparison(source).length < 4) return "";
  let upgraded = source;

  const replacements = [
    [/\bI write this letter because I want to go to another department\b/i, "I am writing to request a transfer to another department because I would like to develop my skills"],
    [/\bI am writing this letter because I want to go to another department\b/i, "I am writing to request a transfer to another department because I would like to develop my skills"],
    [/\bI write this letter because I want to\b/i, "I am writing to request permission to"],
    [/\bI am writing this letter because I want to\b/i, "I am writing to request permission to"],
    [/\bI want to go to another department\b/i, "I would like to transfer to another department"],
    [/\bwant to go to another department\b/i, "would like to transfer to another department"],
    [/\bgo to another department\b/i, "transfer to another department"],
    [/\bI want to\b/i, "I would like to"],
    [/\bI need to\b/i, "I would like to"],
    [/\bdo some job\b/i, "carry out my work"],
    [/\bmake better use of\b/i, "make more effective use of"],
    [/\bgood for me\b/i, "helpful for my development"],
    [/\bvery good\b/i, "very useful"],
    [/\bnice\b/i, "helpful"],
    [/\bpeople is\b/i, "people are"],
    [/\bother department\b/i, "another department"]
  ];
  replacements.forEach(([pattern, replacement]) => {
    upgraded = upgraded.replace(pattern, replacement);
  });

  if (sameCorrectionText(upgraded, source)) {
    if (/^I am writing to request\b/i.test(source) && !/\b(because|as|so that|in order to)\b/i.test(source)) {
      upgraded = source.replace(/[.。!?]*$/, "") + " because I believe this change would support my professional development.";
    } else if (/^I am writing\b/i.test(source) && /\btransfer\b|\bdepartment\b/i.test(source) && !/\b(because|as)\b/i.test(source)) {
      upgraded = source.replace(/[.。!?]*$/, "") + ", as I hope to develop my skills in a new role.";
    }
  }

  if (!/[.!?]$/.test(upgraded)) upgraded += ".";
  if (!shouldShowBetterExpression(source, upgraded)) return "";
  return upgraded;
}

function suppressNonBlockingGrammarWarningsFinal(result) {
  if (!result || typeof result !== "object") return;
  result.stageWarnings = ensureArray(result.stageWarnings).filter((item) => !isNonBlockingGrammarWarningText(item));
  ["sectionWarning", "correctionWarning", "correctionPassWarning", "gradingWarning"].forEach((field) => {
    if (isNonBlockingGrammarWarningText(result[field])) result[field] = "";
  });
  if (!result.errorAnalysis || typeof result.errorAnalysis !== "object") result.errorAnalysis = {};
  if (!ensureArray(result.grammarErrors).length && !hasUsefulText(result.errorAnalysis.summary)) {
    result.errorAnalysis.summary = "No major grammar-specific issue was returned in the grammar stage; use the sentence-level and language advice for polishing.";
    result.errorAnalysis.summaryZh = "语法专项没有返回明显语法问题；可以参考逐句修改和语言建议进行润色。";
  }
}


function isWordCountWarningText(value) {
  const text = finalGateText(value).toLowerCase();
  return /\bword count\b|\bunderlength\b|below the recommended|under the recommended|recommended minimum|\b150 words\b|\b250 words\b|significantly under/.test(text);
}

function wordCountWarningZhFromText(value, body = {}) {
  const task = body?.task === "Task 2" ? "Task 2" : "Task 1";
  const threshold = task === "Task 1" ? 150 : 250;
  const text = finalGateText(value);
  if (!text) return "";
  return `${task} 建议至少写 ${threshold} 词。当前字数不足会限制内容展开和任务完成度，但这不是答错题。`;
}

function relocateWordCountWarningsFinal(result, body = {}) {
  if (!result || typeof result !== "object") return;
  const taskMatch = result.taskMatchCheck && typeof result.taskMatchCheck === "object"
    ? result.taskMatchCheck
    : { appearsToAnswerSelectedPrompt: true, reason: "No task mismatch was detected.", warning: "" };
  result.taskMatchCheck = taskMatch;

  const existingWordWarning = result.wordCountWarning && typeof result.wordCountWarning === "object" ? result.wordCountWarning : {};
  const collected = [];
  const collect = (value) => {
    const text = finalGateText(value);
    if (text && isWordCountWarningText(text) && !collected.includes(text)) collected.push(text);
  };

  collect(existingWordWarning.message);
  collect(existingWordWarning.note);
  collect(existingWordWarning.warning);
  collect(taskMatch.warning);

  if (isWordCountWarningText(taskMatch.warning)) {
    taskMatch.warning = "";
  }

  const low = result.lowBandDiagnostics && typeof result.lowBandDiagnostics === "object" ? result.lowBandDiagnostics : {};
  const calibration = result.scoreCalibration && typeof result.scoreCalibration === "object" ? result.scoreCalibration : {};
  collect(low.reason);
  collect(calibration.capReason);
  collect(calibration.whyNotHigher);

  const mainMessage = collected[0] || "";
  if (mainMessage) {
    result.wordCountWarning = {
      message: mainMessage,
      messageZh: existingWordWarning.messageZh || existingWordWarning.warningZh || wordCountWarningZhFromText(mainMessage, body),
      source: existingWordWarning.source || "word_count"
    };
  } else if (Object.keys(existingWordWarning).length) {
    result.wordCountWarning = existingWordWarning;
  }

  if (!hasUsefulText(taskMatch.reason) || isWordCountWarningText(taskMatch.reason)) {
    const summary = finalGateText(result.taskRequirementAnalysis?.taskMatchSummary);
    taskMatch.reason = summary && !isWordCountWarningText(summary)
      ? summary
      : "The response appears to answer the selected prompt. Word count issues are shown separately from task matching.";
  }

  result.taskMatchCheck = taskMatch;
}

function forcePlaceholderBulletsToUnknownFinal(result, body = {}) {
  if (!result || typeof result !== "object" || body?.task !== "Task 1") return;
  const analysis = result.taskRequirementAnalysis && typeof result.taskRequirementAnalysis === "object" ? result.taskRequirementAnalysis : {};
  const bullets = ensureArray(analysis.bulletPoints);
  if (!bullets.length) return;
  let changed = false;
  analysis.bulletPoints = bullets.map((item, index) => {
    const requirement = bulletRequirementText(item);
    if (isPlaceholderBulletRequirement(item)) {
      changed = true;
      return {
        requirement: "AI did not reliably return this prompt bullet point",
        covered: null,
        coverageUnknown: true,
        evidence: "The returned bullet-point label was only a placeholder, not a real prompt requirement.",
        problem: "Coverage is unknown rather than confirmed missing.",
        suggestion: "Retry task analysis or check the original prompt manually."
      };
    }
    if (item && typeof item === "object" && item.coverageUnknown) {
      return { ...item, covered: null };
    }
    return item;
  });
  if (changed) {
    result.taskRequirementAnalysis = analysis;
    result.taskRequirementAnalysisZh = result.taskRequirementAnalysisZh && typeof result.taskRequirementAnalysisZh === "object" ? result.taskRequirementAnalysisZh : {};
    result.taskRequirementAnalysisZh.bulletPointsZh = analysis.bulletPoints.map(() => "该项原本是占位要点，不能判定为未覆盖；需要重新核验题目要点和原文证据。");
  }
}

function finalQualityGate(result, body = {}) {
  if (!result || typeof result !== "object") return result;

  sanitizeStrengthProblemBucketsFinal(result);
  polishHighBandCriteriaFinal(result, body);
  sanitizeHighBandOverAdvancedCriterionAdviceFinal(result, body);
  sanitizeHighBandOverAdvancedAdviceArraysFinal(result, body);
  removeHighBandContradictionsFinal(result);
  removeContradictoryLowBandDiagnosticsFinal(result);
  ensureTaskCorrectionZhFieldsFinal(result);
  repairTaskRequirementAnalysisFinal(result, body);
  forcePlaceholderBulletsToUnknownFinal(result, body);
  suppressNonBlockingGrammarWarningsFinal(result);
  relocateWordCountWarningsFinal(result, body);
  normalizeBandPlanVisibilityAndZhFinal(result);
  cleanGenericChineseFieldsFinal(result);

  sanitizeStrengthProblemBucketsFinal(result);
  polishHighBandCriteriaFinal(result, body);
  sanitizeHighBandOverAdvancedCriterionAdviceFinal(result, body);
  sanitizeHighBandOverAdvancedAdviceArraysFinal(result, body);
  removeHighBandContradictionsFinal(result);
  removeContradictoryLowBandDiagnosticsFinal(result);
  ensureTaskCorrectionZhFieldsFinal(result);
  repairTaskRequirementAnalysisFinal(result, body);
  forcePlaceholderBulletsToUnknownFinal(result, body);
  suppressNonBlockingGrammarWarningsFinal(result);
  relocateWordCountWarningsFinal(result, body);
  normalizeBandPlanVisibilityAndZhFinal(result);
  cleanGenericChineseFieldsFinal(result);
  finalizeTaskScoringEngine(result, body || {});

  return result;
}



function ensureTargetImprovementPlan(result, body) {
  if (!result || typeof result !== "object") return;
  const task = body?.task === "Task 1" ? "Task 1" : "Task 2";
  const firstCriterion = firstCriterionName(task);
  const currentBand = formatBand(roundHalf(result.overallBand || 1));
  const targetRangeInfo = targetImprovementRangeFromBand(result.overallBand || 1);
  const targetRange = targetRangeInfo.label;
  const criteriaNames = [firstCriterion, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const existingPlan = result.targetImprovementPlan && typeof result.targetImprovementPlan === "object" ? result.targetImprovementPlan : {};
  const existingUpgrades = ensureArray(existingPlan.criterionUpgrades).filter((item) => item && typeof item === "object");
  const byCriterion = new Map(existingUpgrades.map((item) => [compactCorrectionText(item.criterion || item.criteria || item.name), item]));
  const criterionUpgrades = criteriaNames.map((criterion) => {
    const existing = byCriterion.get(compactCorrectionText(criterion)) || {};
    const criterionItem = result.criteria?.[criterion] || {};
    const weakness = existing.currentWeakness || existing.weakness || criterionItem.howToImprove || criterionItem.feedback || "No major weakness was specified; focus on controlled refinement.";
    const action = existing.action || existing.specificAction || existing.howToImprove || criterionItem.howToImprove || (
      criterion === firstCriterion
        ? (task === "Task 1" ? "Check that each bullet point is answered with one precise detail." : "Make each main idea answer the question directly and support it with a concrete reason.")
        : criterion === "Coherence and Cohesion"
          ? "Make paragraph progression explicit and keep linking natural."
          : criterion === "Lexical Resource"
            ? "Use more exact topic vocabulary and avoid repeated general words."
            : "Keep sentence forms varied while removing recurring grammar slips."
    );
    const exampleUpgrade = existing.exampleUpgrade || existing.example || existing.betterExample || existing.targetBandExpression || "";
    return {
      criterion,
      currentWeakness: weakness,
      currentWeaknessZh: existing.currentWeaknessZh || criterionItem.feedbackZh || "这项目前最需要根据英文反馈中的弱点进行针对性修正。",
      target: existing.target || existing.targetBand || targetRange,
      targetZh: existing.targetZh || `这一项的目标是达到 ${targetRange} 的可实现水平。`,
      action,
      exampleUpgrade: exampleUpgrade || "Apply the action to one paragraph, then repeat the same check across the essay.",
      exampleUpgradeZh: existing.exampleUpgradeZh || "示例升级应保留原意，同时让表达更清楚、更自然。",
      actionZh: existing.actionZh || existing.howToImproveZh || "按英文动作逐步修改，先解决最影响分数的问题。"
    };
  });
  result.targetImprovementPlan = {
    ...existingPlan,
    currentBand: existingPlan.currentBand || `Band ${currentBand}`,
    targetBandRange: targetRange,
    targetBandRangeZh: `目标范围按当前分数设置为 ${targetRange}，避免跳到过高表达。`,
    targetReason: existingPlan.targetReason || "The next target should improve the current score by about 0.5-1 band with realistic, criterion-specific changes.",
    targetReasonZh: existingPlan.targetReasonZh || "这个目标按当前分数上调约0.5到1分，重点放在最容易实际提高的任务回应、结构、词汇或语法问题上。",
    criterionUpgrades
  };

  const targetLabel = result.targetImprovementPlan.targetBandRange || targetRange;
  const overall = clampAiBand(result.overallBand || 1, 1);
  ensureArray(result.detailedSentenceCorrections).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const baseSentence = item.correctedSentence || item.originalSentence || "";
    if (overall >= 9) {
      item.betterExpression = "";
      item.targetBandExpression = "";
      item.betterExpressionZh = "";
      return;
    }
    const fallbackBetter = buildFallbackBetterExpression(baseSentence, overall, body);
    const candidates = [item.betterExpression, item.targetBandExpression, fallbackBetter]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const chosen = candidates.find((candidate) => shouldShowBetterExpression(baseSentence, candidate)) || "";
    if (chosen) {
      item.betterExpression = chosen;
      if (!item.targetBandExpression || !shouldShowBetterExpression(baseSentence, item.targetBandExpression)) item.targetBandExpression = chosen;
      if (!item.betterExpressionTargetBand) item.betterExpressionTargetBand = targetLabel;
      if (!item.betterExpressionZh) item.betterExpressionZh = `这个更好表达按 ${targetLabel} 设计：保留原意，但让句子更自然、更正式或更清楚。`;
    } else {
      item.betterExpression = "";
      item.betterExpressionZh = "";
    }
  });
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
  normalized.errorAnalysis.errorPatterns = ensureArray(normalized.errorAnalysis.errorPatterns)
    .filter((item) => item && typeof item === "object" && (hasUsefulText(item.type) || hasUsefulText(item.impactOnBand) || hasUsefulText(item.howToFix)))
    .slice(0, 24);
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
  const adviceLimit = 8;
  normalized.taskAchievementAdvice = ensureArray(normalized.taskAchievementAdvice).slice(0, adviceLimit);
  normalized.taskAchievementAdviceZh = ensureArray(normalized.taskAchievementAdviceZh).slice(0, adviceLimit);
  normalized.coherenceAdvice = ensureArray(normalized.coherenceAdvice).slice(0, adviceLimit);
  normalized.coherenceAdviceZh = ensureArray(normalized.coherenceAdviceZh).slice(0, adviceLimit);
  normalized.lexicalAdvice = ensureArray(normalized.lexicalAdvice).slice(0, adviceLimit);
  normalized.lexicalAdviceZh = ensureArray(normalized.lexicalAdviceZh).slice(0, adviceLimit);
  normalized.grammarAdvice = ensureArray(normalized.grammarAdvice).slice(0, adviceLimit);
  normalized.grammarAdviceZh = ensureArray(normalized.grammarAdviceZh).slice(0, adviceLimit);
  normalized.band5FixPlan = ensureArray(normalized.band5FixPlan).slice(0, adviceLimit);
  normalized.band5FixPlanZh = ensureArray(normalized.band5FixPlanZh).slice(0, adviceLimit);
  normalized.band6UpgradePlan = ensureArray(normalized.band6UpgradePlan).slice(0, adviceLimit);
  normalized.band6UpgradePlanZh = ensureArray(normalized.band6UpgradePlanZh).slice(0, adviceLimit);
  normalized.band7UpgradePlan = ensureArray(normalized.band7UpgradePlan).slice(0, adviceLimit);
  normalized.band7UpgradePlanZh = ensureArray(normalized.band7UpgradePlanZh).slice(0, adviceLimit);
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
  normalized.wordCountWarning = normalized.wordCountWarning && typeof normalized.wordCountWarning === "object"
    ? normalized.wordCountWarning
    : { message: "", messageZh: "" };
  normalized.highBandDiagnostics = normalized.highBandDiagnostics && typeof normalized.highBandDiagnostics === "object"
    ? normalized.highBandDiagnostics
    : { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: body?.task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: "" };
  normalized.revisedEssayMeta = {
    ...defaultRevisedEssayMeta(false),
    ...(normalized.revisedEssayMeta && typeof normalized.revisedEssayMeta === "object" ? normalized.revisedEssayMeta : {})
  };

  normalizeAiBandsOnly(normalized, body || {});
  finalizeTaskScoringEngine(normalized, body || {});

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
  sanitizeStrengthProblemBuckets(normalized);
  polishHighBandCriteria(normalized, body || {});
  finalizeTaskScoringEngine(normalized, body || {});
  ensureTargetImprovementPlan(normalized, body || {});
  backfillChineseHelperNotes(normalized, body || {});
  sanitizeStrengthProblemBuckets(normalized);
  finalQualityGate(normalized, body || {});
  finalizeTaskScoringEngine(normalized, body || {});

  normalized.scoringCalibration = normalized.scoreCalibration;
  normalized.lowBandEvidence = normalized.lowBandDiagnostics;
  normalized.highBandEvidence = normalized.highBandDiagnostics;
  normalized.overallEstimatedBand = normalized.overallBand;
  normalized.revisedEssay = normalized.revisedEssayBand7 || normalized.revisedEssayBand6 || normalized.revisedEssayBand5 || "";
  normalized.feedback = ensureArray(normalized.mainProblems).join(" ") || normalized.scoreCalibration?.whyNotHigher || "Feedback is available in the sections below.";

  return localizeResultForOutput(normalized, locale);
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
    } else if (aiStage === "score-audit") {
      result = await callAiScoreAuditPass({
        apiKey,
        model,
        body: { ...body, currentResult: body.currentResult || null },
        locale,
        deadline
      });
      result.aiStage = "score-audit";
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
