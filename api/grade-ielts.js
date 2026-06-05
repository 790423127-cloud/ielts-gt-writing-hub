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
  return `${task} has ${words} words, below the recommended minimum of ${threshold} words. DeepSeek must still assess it on the full IELTS 0-9 scale, starting from Band 0 when there is no rateable response, and apply strict word-count caps without inventing a minimum score.`;
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
  return ["quick", "full", "revision"].includes(mode) ? mode : "quick";
}

function isVeryShortEssay(body) {
  const words = Number(body.wordCount) || 0;
  return body.task === "Task 1" ? words < 80 : words < 150;
}

function maxTokensForMode(mode, veryShort) {
  if (veryShort) return 1200;
  if (mode === "quick") return 1800;
  if (mode === "full") return 3200;
  return 4800;
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
    "Score from 0 to 9 and allow half bands. Low-word-count responses must also be assessed from Band 0 upward; never use Band 2, 3, 4, or 5.5 as a minimum score.",
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
    "Band 0: no answer, completely unrelated answer, completely non-English answer, or only copied/memorised text with no rateable original writing.",
    "Use IELTS public band descriptor logic for low bands. Do not give Band 4 or above if there is too little rateable language, mostly unrelated content, mostly copied language, mostly memorised text, or no relevant message.",
    "Band 0 applies for blank/no attempt, completely non-English, totally memorised, only copied prompt text, or no meaningful attempt. If Band 0 applies, overallBand and all criteria must be 0, scoreCalibration.capApplied true, no revised essays.",
    "Band 1 normally applies for 20 words or fewer, wholly unrelated content, no relevant message, isolated words, mostly copied prompt, or virtual non-writer. Do not award Band 2+ unless there is a clear relevant original English message.",
    "Band 2 normally applies when content barely relates to the task, there is little relevant message, ideas are undeveloped, organisation is absent, vocabulary is extremely limited, and there is little evidence of sentence forms.",
    "Band 3 normally applies when the task is not adequately addressed, the situation/prompt is misunderstood, ideas are irrelevant or difficult to connect, vocabulary is inadequate, and grammar errors prevent most meaning.",
    "Task 1 word count caps: blank/non-English/no rateable attempt = Band 0; isolated words or mostly copied prompt = Band 0-1; 20 words or fewer normally no higher than Band 2; under 50 words normally no higher than Band 3; 50-79 words normally no higher than Band 4; 80-119 words normally no higher than Band 5; 120-149 words may score normally but mention limited development if relevant.",
    "Task 2 word count caps: blank/non-English/no rateable attempt = Band 0; isolated words or mostly copied prompt = Band 0-1; 20 words or fewer normally no higher than Band 2; under 80 words normally no higher than Band 3; 80-149 words normally no higher than Band 4; 150-199 words normally no higher than Band 5; 200-249 words may score normally but mention limited development if relevant.",
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
    "Error correction requirements: Always return errorAnalysis, detailedSentenceCorrections, task1LetterCorrections or task2EssayCorrections, and correctionPriority.",
    "For detailedSentenceCorrections, use originalSentence from the user's essay only, correctedSentence for direct correction, and betterExpression for a natural IELTS-style improvement without making Band 5 learners imitate Band 9 language.",
    "Classify errors using categories such as Task response/achievement problem, Missing bullet point, Tone problem, Verb tense, Subject-verb agreement, Article error, Singular/plural error, Word form error, Word choice error, Collocation error, Sentence fragment, Run-on sentence, Unclear meaning, Repetition, Informal wording in formal writing, Weak linking, and Paragraphing problem.",
    "Quick mode: detailedSentenceCorrections max 2, compact errorAnalysis only, no long special analysis. Full mode: detailedSentenceCorrections max 6 and include correctionPriority. Revision mode: detailedSentenceCorrections max 8 and include full correctionPriority plus task-specific corrections.",
    "Do not invent errors. Do not correct the whole essay line by line; choose representative high-impact errors.",
    "Return only one valid JSON object.",
    "Do not return markdown or code fences.",
    "Do not include explanatory preface or closing comments.",
    "All required keys must exist.",
    "If a section has no content, return an empty array [] or an empty string \"\".",
    "Use short, compact feedback.",
    "Do not write long paragraphs inside arrays.",
    "Every array must have at most 5 items.",
    "grammarErrors and sentenceCorrections must each have at most 5 items.",
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
    overallBand: 0,
    estimatedLevel: "",
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
        band: 0,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Coherence and Cohesion": {
        band: 0,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Lexical Resource": {
        band: 0,
        feedback: "...",
        feedbackZh: emptyForLocaleZh("Brief Chinese explanation", locale),
        howToImprove: "...",
        howToImproveZh: emptyForLocaleZh("Brief Chinese suggestion", locale)
      },
      "Grammatical Range and Accuracy": {
        band: 0,
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
  const effectiveMode = veryShort ? "quick" : mode;
  const isRevisionMode = effectiveMode === "revision";
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const revisionInstruction = isRevisionMode
    ? "Grade + Revision mode: generate revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7. Band 5 should be safer and clearer; Band 6 should be more natural and logically complete; Band 7 should be mature and coherent but not template-like."
    : "Quick Check and Full IELTS Grading modes: do not generate revised essays. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings.";
  const underMinimumInstruction = body.isUnderMinimum
    ? `The essay is below the IELTS target word count (${body.wordCount}/${body.targetWordCount}). Still grade normally. If this is Task 1, mention the word count issue in Task Achievement and mainProblems. If this is Task 2, mention the word count issue in Task Response and mainProblems because idea development and argument depth may be affected.`
    : "The essay meets or exceeds the target word count.";

  return [
    "Return exactly one JSON object matching this shape and keep the same keys:",
    JSON.stringify(buildExpectedJsonShape(body.task, locale), null, 2),
    "",
    "Mode instructions:",
    "- quick: shortest feedback, no revised essays, compact arrays only.",
    "- full: four criteria, grammar errors, sentence corrections, no revised essays.",
    "- revision: include all three revised essays, but keep all non-essay feedback compact.",
    veryShort ? (isChineseLocale(locale) ? "Very short essay mode: ignore any revision request. Return only a compact diagnostic JSON. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings. Add this revision note: The essay is too short for a meaningful full revision. Please write a fuller response first. Add this Chinese note in revisionNotesZh: 作文太短，暂不适合生成完整修改版，请先补充内容。" : "Very short essay mode: ignore any revision request. Return only a compact diagnostic JSON. revisedEssayBand5, revisedEssayBand6, and revisedEssayBand7 must be empty strings. Add this revision note: The essay is too short for a meaningful full revision. Please write a fuller response first. Keep revisionNotesZh empty.") : "",
    veryShort ? (isChineseLocale(locale) ? "Very short essay limits: strengths max 2, mainProblems max 3, grammarErrors max 3, sentenceCorrections max 3, each Chinese helper note max 25 Chinese characters, each English feedback max 25 English words." : "Very short essay limits: strengths max 2, mainProblems max 3, grammarErrors max 3, sentenceCorrections max 3, English feedback max 25 words, and all *Zh fields empty.") : "",
    revisionInstruction,
    underMinimumInstruction,
    body.isUnderMinimum ? "Important: even though the response is under the recommended word count, you must still grade it as an IELTS response using DeepSeek, start from Band 0 when there is no rateable content, return all sections, apply strict word-count caps, and do not return empty modules." : "",
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
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens, temperature = 0.2, jsonMode = false }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

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
  } finally {
    clearTimeout(timeout);
  }

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
  normalized.grammarErrors = ensureArray(normalized.grammarErrors).slice(0, 5);
  normalized.sentenceCorrections = ensureArray(normalized.sentenceCorrections).slice(0, 5);
  normalized.errorAnalysis = normalized.errorAnalysis && typeof normalized.errorAnalysis === "object" ? normalized.errorAnalysis : { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] };
  normalized.errorAnalysis.errorPatterns = ensureArray(normalized.errorAnalysis.errorPatterns).slice(0, mode === "quick" ? 2 : 5);
  normalized.errorAnalysis.priorityFixes = ensureArray(normalized.errorAnalysis.priorityFixes).slice(0, 5);
  normalized.errorAnalysis.priorityFixesZh = ensureArray(normalized.errorAnalysis.priorityFixesZh).slice(0, 5);
  const sentenceLimit = mode === "quick" ? 2 : (mode === "revision" ? 8 : 6);
  normalized.detailedSentenceCorrections = ensureArray(normalized.detailedSentenceCorrections).slice(0, sentenceLimit);
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

  applyStrictCaps(normalized, body || {}, normalized.lowBandDiagnostics);
  alignHighBandDiagnostics(normalized, body || {});

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
  if (lowOrLimited) {
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


  normalized.scoringCalibration = normalized.scoreCalibration;
  normalized.lowBandEvidence = normalized.lowBandDiagnostics;
  normalized.highBandEvidence = normalized.highBandDiagnostics;
  normalized.overallEstimatedBand = normalized.overallBand;
  normalized.revisedEssay = normalized.revisedEssayBand7 || normalized.revisedEssayBand6 || normalized.revisedEssayBand5 || "";
  normalized.feedback = ensureArray(normalized.mainProblems).join(" ") || normalized.scoreCalibration?.whyNotHigher || "Feedback is available in the sections below.";

  return localizeResultForOutput(normalized, locale);
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
  if (localDiagnostics.isBlank || localDiagnostics.mostlyNonEnglish) {
    sendJson(req, res, 200, localizeResultForOutput(buildFallbackFeedback(body, localDiagnostics.reason || "No rateable English attempt.", locale), locale));
    return;
  }

  // Under-minimum responses still go through DeepSeek.
  // The model must grade them with strict word-count caps and complete feedback.

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
  const effectiveMode = veryShort ? "quick" : mode;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const maxTokens = maxTokensForMode(effectiveMode, veryShort);

  try {
    const outputText = await callDeepSeek({
      apiKey,
      model,
      systemPrompt: buildSystemPrompt(veryShort, locale),
      userPrompt: buildUserPrompt({ ...body, mode: effectiveMode }, veryShort, locale),
      maxTokens,
      temperature: 0.1
    });

    let result;
    try {
      result = parseJsonFromProvider(outputText);
    } catch (firstParseError) {
      if (effectiveMode === "quick") {
        sendJson(req, res, 200, localizeResultForOutput(buildFallbackFeedback(body, "DeepSeek returned incomplete JSON in Quick Check.", locale), locale));
        return;
      }

      try {
        const repairedText = await callDeepSeek({
          apiKey,
          model,
          systemPrompt: "You repair malformed JSON. Return exactly one valid JSON object and nothing else.",
          userPrompt: buildRepairPrompt(outputText, body.task, locale),
          maxTokens: Math.min(maxTokens, 1800),
          temperature: 0.1
        });
        result = parseJsonFromProvider(repairedText);
      } catch (repairError) {
        if (sendProviderError(req, res, repairError)) return;
        sendJson(req, res, 200, localizeResultForOutput(buildFallbackFeedback(body, "DeepSeek returned incomplete JSON.", locale), locale));
        return;
      }
    }

    sendJson(req, res, 200, normalizeResultForMode(result, effectiveMode, veryShort, body, locale));
  } catch (error) {
    if (sendProviderError(req, res, error)) return;

    const errorText = `${error.message || ""} ${error.name || ""}`;
    if (/empty response|invalid JSON|Unexpected end|AbortError|aborted|timeout/i.test(errorText)) {
      sendJson(req, res, 200, localizeResultForOutput(buildFallbackFeedback(body, error.message || error.name || "AI request timed out.", locale), locale));
      return;
    }

    sendJson(req, res, 500, {
      error: "Server error while grading IELTS writing.",
      provider: "deepseek",
      detail: error.message
    });
  }
};
