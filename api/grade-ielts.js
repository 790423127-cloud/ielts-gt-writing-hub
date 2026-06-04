const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
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

function countWordsServer(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function roundHalf(value) {
  return Math.max(0, Math.min(9, Math.round(Number(value || 0) * 2) / 2));
}

function formatBand(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value);
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
  return overlap / essayTokens.length >= 0.78;
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

function estimateFallbackBand(body, diagnostics) {
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  if (diagnostics.isBlank || diagnostics.mostlyNonEnglish) return 0;
  if (diagnostics.mostlyCopiedFromPrompt || words <= 20) return 1;
  if (task === "Task 1") {
    if (words < 50) return 2.5;
    if (words < 80) return 3.5;
    if (words < 120) return 4.5;
    if (words < 150) return 5.0;
    return 5.5;
  }
  if (words < 80) return 2.5;
  if (words < 150) return 3.5;
  if (words < 200) return 4.5;
  if (words < 250) return 5.0;
  return 5.5;
}

function wordStatus(task, words) {
  if (task === "Task 1") return words >= 150 ? "meets_task1_minimum" : (words < 80 ? "very_short_task1" : "under_task1_minimum");
  return words >= 250 ? "meets_task2_minimum" : (words < 150 ? "very_short_task2" : "under_task2_minimum");
}

function emptyTaskAnalysis(task, fallbackMsg = "") {
  if (task === "Task 1") {
    return {
      taskType: "task1",
      taskPurpose: "Write a General Training Task 1 letter that answers the selected prompt.",
      recipient: "",
      relationship: "",
      requiredTone: "",
      letterType: "",
      bulletPoints: [],
      missingRequirements: [],
      taskMatchSummary: fallbackMsg || "The selected prompt was provided to the grader."
    };
  }
  return {
    taskType: "task2",
    questionType: "",
    topic: "",
    requiredPosition: "",
    requiredParts: [],
    positionPresent: false,
    mainIdeasRelevant: false,
    missingRequirements: [],
    taskMatchSummary: fallbackMsg || "The selected prompt was provided to the grader."
  };
}

function buildBaseFeedback(body, options = {}) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const diagnostics = buildLowBandDiagnostics(body);
  const firstCriterion = firstCriterionName(task);
  const hardLow = diagnostics.isBlank || diagnostics.mostlyNonEnglish || diagnostics.mostlyCopiedFromPrompt || diagnostics.wordCount20OrFewer;
  const fallbackBand = roundHalf(options.band ?? estimateFallbackBand(body, diagnostics));
  const providerReason = options.reason || "";
  const isProviderFallback = Boolean(options.fallback);
  const isNormalLength = (task === "Task 1" && words >= 150) || (task === "Task 2" && words >= 250);
  const bandReason = hardLow
    ? diagnostics.reason
    : (isProviderFallback
      ? "AI provider output was incomplete, so this is a temporary fallback estimate. Retry for full feedback."
      : "Basic diagnostic estimate generated from available response evidence.");

  return {
    actualWordCount: words,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: task === "Task 1" ? 150 : 250,
    wordCountStatus: wordStatus(task, words),
    taskRequirementAnalysis: emptyTaskAnalysis(task, isProviderFallback ? "AI output failed before detailed task analysis could be completed." : "The selected prompt was provided to the grader."),
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "No task mismatch was detected before this result was generated.", warning: "" },
    highBandDiagnostics: {
      fullyAddressesTask: false,
      clearProgression: false,
      wellDevelopedIdeas: false,
      wideAccurateVocabulary: false,
      flexibleGrammar: false,
      fewErrors: false,
      appropriateToneTask1: task === "Task 1" ? false : null,
      recommendedHighBandRange: "",
      reason: isProviderFallback ? "High-band diagnostics are unavailable because AI output was incomplete. Retry for full scoring." : "High-band evidence was not confirmed."
    },
    overallBand: fallbackBand,
    estimatedLevel: `Band ${formatBand(fallbackBand)}${isProviderFallback ? " fallback estimate" : ""}`,
    lowBandDiagnostics: diagnostics,
    scoreCalibration: {
      strictness: "strict",
      capApplied: hardLow || (!isNormalLength && fallbackBand <= 5),
      capReason: hardLow ? diagnostics.reason : (!isNormalLength ? "The response is under the recommended word count." : ""),
      whyNotHigher: isProviderFallback ? "A higher score cannot be confirmed because the AI provider returned incomplete output." : "A higher score requires stronger task fulfilment, organisation, vocabulary, and grammar evidence.",
      whyNotLower: hardLow ? "The current low band reflects the strongest local low-band trigger." : "There is rateable English content and the response is not blank or mostly non-English.",
      evidence: [`Word count: ${words}.`, diagnostics.reason, providerReason ? `Provider issue: ${String(providerReason).slice(0, 120)}` : ""].filter(Boolean).slice(0, 5)
    },
    criteria: {
      [firstCriterion]: {
        band: fallbackBand,
        feedback: isProviderFallback ? "Full task feedback is unavailable because the AI provider returned incomplete output." : "Task response needs to be assessed against the selected prompt.",
        feedbackZh: isProviderFallback ? "AI返回不完整，暂无法完整分析任务回应。" : "需要结合题目要求判断任务完成度。",
        howToImprove: "Cover every required point clearly and add specific details.",
        howToImproveZh: "清楚覆盖所有题目要求，并补充具体细节。"
      },
      "Coherence and Cohesion": {
        band: fallbackBand,
        feedback: isProviderFallback ? "Detailed organisation feedback is unavailable in fallback mode." : "Use clear paragraphing and logical progression.",
        feedbackZh: isProviderFallback ? "fallback模式暂无法详细判断结构。" : "需要清楚分段并保持逻辑推进。",
        howToImprove: "Use separate paragraphs and natural linking.",
        howToImproveZh: "分段写，并使用自然连接。"
      },
      "Lexical Resource": {
        band: fallbackBand,
        feedback: isProviderFallback ? "Detailed vocabulary feedback is unavailable in fallback mode." : "Use accurate topic vocabulary.",
        feedbackZh: isProviderFallback ? "fallback模式暂无法详细判断词汇。" : "使用准确的题目相关词汇。",
        howToImprove: "Choose precise, natural words instead of memorised phrases.",
        howToImproveZh: "选择准确自然的词，不要堆模板。"
      },
      "Grammatical Range and Accuracy": {
        band: fallbackBand,
        feedback: isProviderFallback ? "Detailed grammar feedback is unavailable in fallback mode." : "Check sentence structure and verb forms.",
        feedbackZh: isProviderFallback ? "fallback模式暂无法详细判断语法。" : "检查句子结构和动词形式。",
        howToImprove: "Write complete sentences and check tense, articles, and plurals.",
        howToImproveZh: "写完整句子，检查时态、冠词和单复数。"
      }
    },
    strengths: hardLow ? [] : ["The response contains rateable English content."],
    mainProblems: isProviderFallback ? ["AI output was incomplete, so detailed scoring is unavailable. Please retry."] : ["More specific task analysis is needed for a full score."],
    grammarErrors: [],
    sentenceCorrections: [],
    errorAnalysis: { summary: isProviderFallback ? "Detailed error analysis is unavailable because the AI provider returned incomplete output." : "", summaryZh: isProviderFallback ? "AI返回不完整，暂无法提供详细错误分析。" : "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    detailedSentenceCorrections: [],
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    taskAchievementAdvice: ["Answer all required parts of the task."],
    coherenceAdvice: ["Use clear paragraphs."],
    lexicalAdvice: ["Use precise topic vocabulary."],
    grammarAdvice: ["Check sentence structure and verb forms."],
    band5FixPlan: ["Cover all task requirements in simple clear English."],
    band6UpgradePlan: ["Add better organisation and more specific details."],
    band7UpgradePlan: ["Make the writing more natural, precise, and flexible."],
    modelAnswerOutline: "Use an opening, clear body paragraphs that cover the task requirements, and a suitable closing or conclusion.",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: { band5Target: "Basic but complete response.", band6Target: "", band7Target: "", revisionLimited: Boolean(hardLow), revisionLimitReason: hardLow ? diagnostics.reason : "" },
    revisionNotes: isProviderFallback ? ["AI output was incomplete, so this is a fallback estimate only. Retry for full grading."] : [],
    revisionNotesZh: isProviderFallback ? ["AI返回内容不完整，这是临时基础估分。请重新批改获取完整反馈。"] : [],
    scoreUnavailable: false,
    disclaimer: DISCLAIMER,
    fallback: Boolean(options.fallback),
    fallbackReason: providerReason
  };
}

function stripCodeFence(text) {
  return String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractFirstJsonObject(text) {
  const cleaned = stripCodeFence(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") { if (depth === 0) start = i; depth += 1; }
    else if (char === "}") { depth -= 1; if (depth === 0 && start !== -1) return cleaned.slice(start, i + 1); }
  }
  return cleaned;
}

function parseJsonFromProvider(text) {
  return JSON.parse(extractFirstJsonObject(text));
}

function compactSchema(task, mode) {
  const firstCriterion = firstCriterionName(task);
  return {
    overallBand: 6,
    estimatedLevel: "Band 6.0",
    taskRequirementAnalysis: emptyTaskAnalysis(task),
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "", warning: "" },
    highBandDiagnostics: { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: "" },
    lowBandDiagnostics: buildLowBandDiagnostics({ task, essay: "", questionPrompt: "" }),
    scoreCalibration: { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] },
    criteria: {
      [firstCriterion]: { band: 6, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 6, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 6, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 6, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    mainProblems: [],
    grammarErrors: [],
    sentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    detailedSentenceCorrections: [],
    task1LetterCorrections: task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    taskAchievementAdvice: [],
    coherenceAdvice: [],
    lexicalAdvice: [],
    grammarAdvice: [],
    band5FixPlan: [],
    band6UpgradePlan: [],
    band7UpgradePlan: [],
    modelAnswerOutline: "",
    revisedEssayBand5: mode === "revision" ? "" : "",
    revisedEssayBand6: mode === "revision" ? "" : "",
    revisedEssayBand7: mode === "revision" ? "" : "",
    revisedEssayMeta: { band5Target: "", band6Target: "", band7Target: "", revisionLimited: false, revisionLimitReason: "" },
    revisionNotes: [],
    revisionNotesZh: [],
    disclaimer: DISCLAIMER
  };
}

function buildSystemPrompt() {
  return [
    "You are a strict but fair IELTS General Training Writing examiner.",
    "Return one valid JSON object only. No markdown. No code fences. No extra text.",
    "Use IELTS public band-descriptor logic. Scores may be 0-9 with half bands.",
    "Strict scoring does not mean artificially low scoring. Do not use Band 7 as a default ceiling.",
    "Band 8 does not require perfection. Band 9 does not require literary or native-level writing.",
    "Task 1 uses a 150-word minimum and is assessed by purpose, bullet coverage, tone, format, coherence, vocabulary, and grammar.",
    "Task 2 uses a 250-word minimum and is assessed by response, position, development, coherence, vocabulary, and grammar.",
    "Do not apply Task 2 rules such as clear position or 250 words to Task 1.",
    "Only give Band 0 for blank/no attempt, mostly non-English, or no rateable English. Do not give Band 0 to normal English writing.",
    "If all Task 1 bullet points are covered with suitable tone and accurate flexible language, allow Band 8-9.",
    "Keep every field short and compact. Do not translate the full essay into Chinese."
  ].join(" ");
}

function buildUserPrompt(body, mode) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const schema = compactSchema(task, mode);
  const limits = mode === "quick"
    ? "Quick mode: strengths max 2, mainProblems max 3, detailedSentenceCorrections max 2, no revised essays."
    : mode === "full"
      ? "Full mode: detailed feedback, detailedSentenceCorrections max 6, no revised essays."
      : "Revision mode: include revisedEssayBand5, revisedEssayBand6, revisedEssayBand7 unless the response is extremely short or no-rateable.";
  return [
    "Return JSON using this exact key structure. Values must be based on the essay, not the example numbers:",
    JSON.stringify(schema),
    "Instructions:",
    limits,
    `Task type: ${task}. Word count: ${words}. Word threshold: ${task === "Task 1" ? 150 : 250}.`,
    "If provider is unsure, still provide a score; do not set overallBand to null. Do not output 0 unless blank/mostly non-English/no rateable English.",
    "For Task 1, analyse recipient, relationship, required tone, letter type, and bullet points. For Task 2, analyse question type, topic, position, and required parts.",
    "Question:",
    String(body.questionPrompt || "").slice(0, 2500),
    "Essay:",
    String(body.essay || "").slice(0, 6000)
  ].join("\n");
}

function extractDeepSeekText(data) {
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      stream: false,
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
  const data = JSON.parse(raw);
  const outputText = extractDeepSeekText(data);
  if (!outputText) {
    const error = new Error("DeepSeek returned an empty response.");
    error.raw = raw;
    throw error;
  }
  return outputText;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function ensureCriteria(result, task) {
  const firstCriterion = firstCriterionName(task);
  result.criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  [firstCriterion, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"].forEach((name) => {
    if (!result.criteria[name] || typeof result.criteria[name] !== "object") {
      result.criteria[name] = { band: result.overallBand ?? 0, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" };
    }
  });
}

function normalizeResult(result, body, mode) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const localDiagnostics = buildLowBandDiagnostics(body);
  const normalized = result && typeof result === "object" ? result : {};
  normalized.actualWordCount = words;
  normalized.taskTypeDetected = task === "Task 1" ? "task1" : "task2";
  normalized.wordCountThresholdUsed = task === "Task 1" ? 150 : 250;
  normalized.wordCountStatus = wordStatus(task, words);
  normalized.disclaimer = normalized.disclaimer || DISCLAIMER;
  ensureCriteria(normalized, task);

  const hardLow = localDiagnostics.isBlank || localDiagnostics.mostlyNonEnglish || localDiagnostics.mostlyCopiedFromPrompt || localDiagnostics.wordCount20OrFewer;
  let overall = roundHalf(normalized.overallBand);
  if ((!Number.isFinite(overall) || overall === 0) && !hardLow) {
    overall = estimateFallbackBand(body, localDiagnostics);
  }
  if (hardLow) overall = Math.min(overall || 9, estimateFallbackBand(body, localDiagnostics));
  normalized.overallBand = roundHalf(overall);
  normalized.estimatedLevel = normalized.estimatedLevel && !/unavailable/i.test(String(normalized.estimatedLevel))
    ? normalized.estimatedLevel
    : `Band ${formatBand(normalized.overallBand)}`;

  normalized.lowBandDiagnostics = { ...localDiagnostics, ...(normalized.lowBandDiagnostics && typeof normalized.lowBandDiagnostics === "object" ? normalized.lowBandDiagnostics : {}) };
  if (!hardLow && words >= (task === "Task 1" ? 150 : 250)) {
    normalized.lowBandDiagnostics.recommendedLowBandRange = "";
    normalized.lowBandDiagnostics.reason = "No low-band trigger detected.";
    normalized.lowBandDiagnostics.littleRelevantMessage = false;
    normalized.lowBandDiagnostics.meaningMostlyBlocked = false;
  }

  normalized.scoreCalibration = normalized.scoreCalibration && typeof normalized.scoreCalibration === "object" ? normalized.scoreCalibration : { strictness: "strict", capApplied: false, capReason: "", whyNotHigher: "", whyNotLower: "", evidence: [] };
  if (!hardLow && normalized.overallBand === 0) {
    normalized.overallBand = estimateFallbackBand(body, localDiagnostics);
    normalized.estimatedLevel = `Band ${formatBand(normalized.overallBand)}`;
  }

  normalized.taskRequirementAnalysis = normalized.taskRequirementAnalysis && typeof normalized.taskRequirementAnalysis === "object" ? normalized.taskRequirementAnalysis : emptyTaskAnalysis(task);
  normalized.taskMatchCheck = normalized.taskMatchCheck && typeof normalized.taskMatchCheck === "object" ? normalized.taskMatchCheck : { appearsToAnswerSelectedPrompt: true, reason: "No task mismatch was detected.", warning: "" };
  normalized.highBandDiagnostics = normalized.highBandDiagnostics && typeof normalized.highBandDiagnostics === "object" ? normalized.highBandDiagnostics : compactSchema(task, mode).highBandDiagnostics;

  normalized.strengths = ensureArray(normalized.strengths).slice(0, mode === "quick" ? 2 : 5);
  normalized.mainProblems = ensureArray(normalized.mainProblems).slice(0, mode === "quick" ? 3 : 5);
  normalized.grammarErrors = ensureArray(normalized.grammarErrors).slice(0, mode === "quick" ? 2 : 5);
  normalized.sentenceCorrections = ensureArray(normalized.sentenceCorrections).slice(0, mode === "quick" ? 2 : 5);
  normalized.errorAnalysis = normalized.errorAnalysis && typeof normalized.errorAnalysis === "object" ? normalized.errorAnalysis : { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] };
  normalized.errorAnalysis.errorPatterns = ensureArray(normalized.errorAnalysis.errorPatterns).slice(0, mode === "quick" ? 2 : 5);
  normalized.errorAnalysis.priorityFixes = ensureArray(normalized.errorAnalysis.priorityFixes).slice(0, 5);
  normalized.errorAnalysis.priorityFixesZh = ensureArray(normalized.errorAnalysis.priorityFixesZh).slice(0, 5);
  normalized.detailedSentenceCorrections = ensureArray(normalized.detailedSentenceCorrections).slice(0, mode === "quick" ? 2 : (mode === "revision" ? 8 : 6));
  normalized.task1LetterCorrections = task === "Task 1" ? (normalized.task1LetterCorrections && typeof normalized.task1LetterCorrections === "object" ? normalized.task1LetterCorrections : { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] }) : null;
  normalized.task2EssayCorrections = task === "Task 2" ? (normalized.task2EssayCorrections && typeof normalized.task2EssayCorrections === "object" ? normalized.task2EssayCorrections : { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] }) : null;
  normalized.correctionPriority = normalized.correctionPriority && typeof normalized.correctionPriority === "object" ? normalized.correctionPriority : { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] };
  ["fixFirst", "fixNext", "polishLater", "fixFirstZh", "fixNextZh", "polishLaterZh"].forEach((key) => { normalized.correctionPriority[key] = ensureArray(normalized.correctionPriority[key]).slice(0, 5); });
  ["taskAchievementAdvice", "coherenceAdvice", "lexicalAdvice", "grammarAdvice", "band5FixPlan", "band6UpgradePlan", "band7UpgradePlan", "revisionNotes", "revisionNotesZh"].forEach((key) => { normalized[key] = ensureArray(normalized[key]).slice(0, 5); });
  normalized.modelAnswerOutline = normalized.modelAnswerOutline || "";
  if (mode !== "revision") {
    normalized.revisedEssayBand5 = "";
    normalized.revisedEssayBand6 = "";
    normalized.revisedEssayBand7 = "";
  } else {
    normalized.revisedEssayBand5 = normalized.revisedEssayBand5 || "";
    normalized.revisedEssayBand6 = normalized.revisedEssayBand6 || "";
    normalized.revisedEssayBand7 = normalized.revisedEssayBand7 || "";
  }
  normalized.revisedEssayMeta = normalized.revisedEssayMeta && typeof normalized.revisedEssayMeta === "object" ? normalized.revisedEssayMeta : { band5Target: "", band6Target: "", band7Target: "", revisionLimited: false, revisionLimitReason: "" };
  normalized.scoreUnavailable = false;
  normalized.fallback = false;
  return normalized;
}

function sendProviderError(req, res, error) {
  if (error.message !== "DeepSeek API request failed.") return false;
  if (error.status === 429) {
    sendJson(req, res, 429, { error: "AI provider quota exceeded.", provider: "deepseek", status: 429, suggestion: "Please wait, reduce usage, or check DeepSeek balance." });
    return true;
  }
  if (error.status === 401 || error.status === 403) {
    sendJson(req, res, error.status, { error: "AI provider API key is invalid or not authorised.", provider: "deepseek", status: error.status });
    return true;
  }
  if (error.status >= 500 && error.status <= 599) {
    sendJson(req, res, 502, { error: "AI provider temporarily unavailable.", provider: "deepseek", status: error.status, suggestion: "Please try again later." });
    return true;
  }
  return false;
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
    sendJson(req, res, 500, { error: "Provider API key is not configured.", provider: "deepseek" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(req, res, 400, { error: "Invalid JSON request body.", detail: error.message });
    return;
  }

  body.essay = String(body.essay || "");
  body.questionPrompt = String(body.questionPrompt || body.promptText || "");
  body.task = body.task === "Task 1" || body.taskType === "task1" ? "Task 1" : "Task 2";
  body.wordCount = countWordsServer(body.essay);
  body.targetWordCount = body.task === "Task 1" ? 150 : 250;
  body.isUnderMinimum = body.wordCount < body.targetWordCount;

  if (!body.questionPrompt.trim()) {
    sendJson(req, res, 400, { error: "questionPrompt is required." });
    return;
  }

  const localDiagnostics = buildLowBandDiagnostics(body);
  if (localDiagnostics.isBlank || localDiagnostics.mostlyNonEnglish) {
    sendJson(req, res, 200, buildBaseFeedback(body, { fallback: false, band: estimateFallbackBand(body, localDiagnostics), reason: localDiagnostics.reason }));
    return;
  }

  const mode = normalizeMode(body.mode);
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const maxTokens = maxTokensForMode(mode, body.wordCount < (body.task === "Task 1" ? 80 : 150));

  try {
    const outputText = await callDeepSeek({ apiKey, model, systemPrompt: buildSystemPrompt(), userPrompt: buildUserPrompt(body, mode), maxTokens });
    const parsed = parseJsonFromProvider(outputText);
    sendJson(req, res, 200, normalizeResult(parsed, body, mode));
  } catch (error) {
    if (sendProviderError(req, res, error)) return;
    // Provider output or JSON parsing failed. Return a usable score instead of 0/null.
    sendJson(req, res, 200, buildBaseFeedback(body, { fallback: true, reason: error.message || "AI output was incomplete." }));
  }
};
