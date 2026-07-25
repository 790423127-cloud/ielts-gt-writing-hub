"use strict";

const { RequestValidationError } = require("./tasks");

function wordTokens(text) {
  return String(text || "").match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || [];
}

function countWords(text) {
  return wordTokens(text).length;
}

function countSentences(text) {
  return String(text || "")
    .split(/[.!?]+(?:\s+|$)/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function countParagraphs(text) {
  return String(text || "")
    .trim()
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function englishLetterRatio(text) {
  const compact = String(text || "").replace(/\s/g, "");
  if (!compact) return 0;
  return Number(((compact.match(/[A-Za-z]/g) || []).length / compact.length).toFixed(3));
}

function copiedPromptRatio(prompt, essay) {
  const tokens = (value) => String(value || "").toLowerCase().match(/[a-z]{3,}/g) || [];
  const promptSet = new Set(tokens(prompt));
  const essayTokens = tokens(essay);
  if (!promptSet.size || !essayTokens.length) return 0;
  const matched = essayTokens.filter((token) => promptSet.has(token)).length;
  return Number((matched / essayTokens.length).toFixed(3));
}

function possiblePromptInjection(text) {
  return /ignore (all|any|the|previous)|system prompt|developer message|give (me|this) (a )?band|do not grade|you are chatgpt|output only band/i.test(String(text || ""));
}

function descriptiveTextSignals(essay, wordCount, sentenceCount) {
  const tokens = wordTokens(essay).map((token) => token.toLowerCase());
  const lexicalDiversity = tokens.length ? new Set(tokens).size / tokens.length : 0;
  const paragraphWordCounts = String(essay || "")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => countWords(paragraph))
    .filter(Boolean);
  return {
    averageSentenceWords: sentenceCount ? Number((wordCount / sentenceCount).toFixed(1)) : 0,
    lexicalDiversity: Number(lexicalDiversity.toFixed(3)),
    paragraphWordCounts: paragraphWordCounts.slice(0, 30)
  };
}

function normalizeVisualFacts(body, taskConfig) {
  if (taskConfig.taskKind !== "academic_visual_report") return null;
  const source = body.visualFacts && typeof body.visualFacts === "object" ? body.visualFacts : {};
  return {
    visualType: String(source.visualType || body.visualType || body.bigType || "unknown"),
    title: String(source.title || body.title || ""),
    units: source.units || "",
    timeRange: Array.isArray(source.timeRange) ? source.timeRange.slice(0, 10) : [],
    series: Array.isArray(source.series) ? source.series.slice(0, 30) : [],
    dataPoints: Array.isArray(source.dataPoints) ? source.dataPoints.slice(0, 300) : [],
    keyFeatures: Array.isArray(source.keyFeatures) ? source.keyFeatures.slice(0, 30) : [],
    majorComparisons: Array.isArray(source.majorComparisons) ? source.majorComparisons.slice(0, 30) : [],
    stages: Array.isArray(source.stages) ? source.stages.slice(0, 50) : [],
    mapChanges: source.mapChanges && typeof source.mapChanges === "object" ? source.mapChanges : {},
    referenceDescription: String(source.referenceDescription || body.referenceAnswer || "").slice(0, 12000),
    sourceVerified: source.sourceVerified === true,
    verificationNote: String(source.verificationNote || "")
  };
}

function validateAndNormalizeInput(body, taskConfig) {
  const essay = String(body.essay || body.response || "").trim();
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "").trim();
  if (!prompt) throw new RequestValidationError("questionPrompt is required.", "MISSING_PROMPT");
  if (prompt.length > 20000) throw new RequestValidationError("questionPrompt is too long.", "PROMPT_TOO_LONG");
  if (essay.length > 50000) throw new RequestValidationError("essay is too long.", "ESSAY_TOO_LONG");

  const wordCount = countWords(essay);
  const sentenceCount = countSentences(essay);
  const visualFacts = normalizeVisualFacts(body, taskConfig);
  const signals = {
    task: taskConfig.task,
    taskKind: taskConfig.taskKind,
    examModule: taskConfig.examModule,
    emptyResponse: essay.length === 0,
    wordCount,
    clientWordCount: Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : null,
    clientWordCountIgnored: Number.isFinite(Number(body.wordCount)) && Number(body.wordCount) !== wordCount,
    minimumWords: taskConfig.minimumWords,
    underMinimum: wordCount < taskConfig.minimumWords,
    severeLengthRisk: wordCount < Math.max(20, Math.floor(taskConfig.minimumWords * 0.45)),
    paragraphCount: countParagraphs(essay),
    sentenceCount,
    ...descriptiveTextSignals(essay, wordCount, sentenceCount),
    englishLetterRatio: englishLetterRatio(essay),
    possibleNonEnglishResponse: englishLetterRatio(essay) < 0.45,
    possiblePromptInjection: possiblePromptInjection(essay),
    copiedPromptRatio: copiedPromptRatio(prompt, essay),
    visualFactsAvailable: Boolean(
      visualFacts &&
      (visualFacts.referenceDescription || visualFacts.keyFeatures.length || visualFacts.dataPoints.length || visualFacts.stages.length)
    ),
    visualFactsSourceVerified: Boolean(visualFacts?.sourceVerified)
  };

  return {
    essay,
    prompt,
    title: String(body.title || body.questionTitle || "").slice(0, 500),
    promptId: String(body.promptId || "").slice(0, 200),
    letterStyle: String(body.letterStyle || "").slice(0, 100),
    questionType: String(body.questionType || body.bigType || "").slice(0, 200),
    questionSubtype: String(body.questionSubtype || body.subtype || "").slice(0, 200),
    visualFacts,
    signals
  };
}

module.exports = {
  wordTokens,
  countWords,
  countSentences,
  countParagraphs,
  englishLetterRatio,
  copiedPromptRatio,
  possiblePromptInjection,
  validateAndNormalizeInput
};
