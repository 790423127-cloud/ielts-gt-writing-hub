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

function countWordsServer(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []).length;
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
  const wordCount20OrFewer = words <= 20;
  const veryShortTask1 = task === "Task 1" && words < 80;
  const veryShortTask2 = task === "Task 2" && words < 150;
  const underSevereCap = (task === "Task 1" && words < 50) || (task === "Task 2" && words < 80);
  const noClearPositionTask2 = task === "Task 2" && words < 150;
  const noBulletPointCoverageTask1 = task === "Task 1" && words < 80;
  const littleRelevantMessage = isBlank || nonEnglish || copied || wordCount20OrFewer || underSevereCap;
  const meaningMostlyBlocked = isBlank || nonEnglish || wordCount20OrFewer;

  let recommendedLowBandRange = "";
  let reason = "";
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
  } else if (underSevereCap) {
    recommendedLowBandRange = "2.0-3.5";
    reason = "The response is extremely short and misses most task requirements.";
  } else if (veryShortTask1 || veryShortTask2) {
    recommendedLowBandRange = "3.0-4.0";
    reason = "The response is significantly underlength and cannot show enough task coverage.";
  }

  return {
    isBlank,
    wordCount20OrFewer,
    mostlyNonEnglish: nonEnglish,
    mostlyCopiedFromPrompt: copied,
    mostlyMemorised: false,
    whollyUnrelated: false,
    barelyRelated: littleRelevantMessage && !isBlank,
    littleRelevantMessage,
    noClearPositionTask2,
    noBulletPointCoverageTask1,
    meaningMostlyBlocked,
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
  if (words <= 20) {
    return { cap: 1, firstCap: 1, reason: "The response has 20 words or fewer, so Band 2+ is not normally justified." };
  }
  if (task === "Task 1") {
    if (words < 50) return { cap: 3, firstCap: 3, reason: "Task 1 is under 50 words; overall and Task Achievement are normally capped around Band 2-3." };
    if (words < 80) return { cap: 4, firstCap: 4, reason: "Task 1 is 50-79 words; Task Achievement is normally capped at Band 4." };
    if (words < 120) return { cap: 5, firstCap: 5, reason: "Task 1 is 80-119 words; task coverage and development are limited." };
  } else {
    if (words < 80) return { cap: 3, firstCap: 3, reason: "Task 2 is under 80 words; overall and Task Response are normally capped around Band 2-3." };
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

function buildSystemPrompt(veryShort = false) {
  const rules = [
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
    "Do not award Band 5.5 or above unless the writing has enough content, mostly understandable meaning, some organisation, and sufficient task coverage.",
    "Assess the essay using the four IELTS Writing criteria.",
    "For Task 1, use Task Achievement as the first criterion.",
    "For Task 2, use Task Response as the first criterion.",
    "Do not mix Task 1 and Task 2 first criteria.",
    "Score from 0 to 9 and allow half bands.",
    "Band 9: fully addresses all parts, natural fluent organisation, wide precise vocabulary, flexible highly accurate grammar, very rare minor errors.",
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
    "Task 1 word count caps: under 50 words overall normally 2.0-3.0 and Task Achievement no higher than 3.0; 50-79 words overall no higher than 4.0; 80-119 words overall no higher than 5.0; 120-149 words may score normally but mention limited development if relevant.",
    "Task 2 word count caps: under 80 words overall normally 2.0-3.0 and Task Response no higher than 3.0; 80-149 words overall no higher than 4.0; 150-199 words overall no higher than 5.0; 200-249 words may score normally but mention limited development if relevant.",
    "Do not reject short essays. Grade them, but apply caps.",
    "Task 1 letter caps: if only one bullet point is addressed, Task Achievement normally no higher than 4.0; if two bullet points are addressed but one is missing, no higher than 5.0; wrong tone, missing letter format, inappropriate opening/closing, copied prompt, or unclear purpose reduce Task Achievement.",
    "Task 2 argument caps: no clear position means Task Response normally no higher than 4.0; listed but undeveloped ideas no higher than 5.0; only one side when both required no higher than 5.0; off-topic no higher than 3.0; no conclusion or no examples/details reduces Task Response and/or Coherence.",
    "Coherence caps: no paragraphing normally no higher than 4.0-5.0; ideas listed without progression no higher than 5.0; missing/unnatural linking or repeated and/so/because should not receive high CC; Band 6+ requires clear paragraphing and mostly logical progression.",
    "Lexical caps: extremely basic vocabulary normally no higher than 4.0; frequent word-choice errors affecting meaning normally no higher than 4.0-5.0; heavy repetition or inappropriate register reduces LR; Band 6+ requires enough topic vocabulary and mostly appropriate word choice.",
    "Grammar caps: if most sentences contain serious grammar errors or errors often reduce meaning, GRA normally no higher than 4.0; only simple sentence patterns normally no higher than 5.0; frequent tense/article/plural/word-order/sentence-structure errors should not receive Band 5.5+ unless meaning remains generally clear.",
    "First assign four criterion bands, then estimate overallBand from the criteria, round to nearest 0.5, then apply cap rules. Do not allow overallBand to contradict criterion scores.",
    "Do not give 5.5+ when Task Achievement/Task Response is capped at 4.0 or below. Do not give 6.0+ if two or more criteria are 5.0 or below. Extremely short essays should normally stay below 4.0.",
    "Do not award Band 5.5+ if the essay has two or more serious weaknesses: far below word count, missing major task requirements, no clear paragraphing, frequent grammar errors, unclear meaning, very limited vocabulary, mostly copied prompt, only one or two simple sentences, no Task 2 argument, or fewer than three Task 1 bullet points.",
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
  const firstCriterion = firstCriterionName(task);
  return {
    overallBand: 5.5,
    estimatedLevel: "Band 5.5",
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
    scoreCalibration: {
      strictness: "strict",
      capApplied: false,
      capReason: "",
      whyNotHigher: "...",
      whyNotLower: "...",
      evidence: ["..."]
    },
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
    revisedEssayMeta: {
      band5Target: "Basic but complete response; simple grammar; suitable for Band 5.",
      band6Target: "Clear and complete response with better organisation and vocabulary; suitable for Band 6.",
      band7Target: "Well-developed and natural response; suitable for Band 7, not Band 9.",
      revisionLimited: false,
      revisionLimitReason: ""
    },
    revisionNotes: ["..."],
    revisionNotesZh: ["简短中文说明"],
    disclaimer: DISCLAIMER
  };
}

function buildUserPrompt(body, veryShort) {
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

function buildFallbackFeedback(body, reason) {
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const firstCriterion = firstCriterionName(body.task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  let band = 3;
  let bandReason = "The response is very limited and cannot support a higher score.";

  if (diagnostics.isBlank || diagnostics.mostlyNonEnglish) {
    band = 0;
    bandReason = diagnostics.reason || "There is no rateable English attempt.";
  } else if (diagnostics.mostlyCopiedFromPrompt || words <= 20) {
    band = 1;
    bandReason = "The response has almost no rateable original writing.";
  } else if ((body.task === "Task 1" && words < 50) || (body.task === "Task 2" && words < 80)) {
    band = 2.5;
    bandReason = "The response is extremely short and misses most task requirements.";
  } else if ((body.task === "Task 1" && words < 80) || (body.task === "Task 2" && words < 150)) {
    band = 3.5;
    bandReason = "The response is significantly underlength and only partly communicates a relevant message.";
  } else if (cap.cap !== null) {
    band = Math.min(4, cap.cap);
    bandReason = cap.reason;
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
    overallBand: criterionBand,
    estimatedLevel: `Band ${formatBand(criterionBand)}`,
    lowBandDiagnostics: diagnostics,
    scoreCalibration: {
      strictness: "strict",
      capApplied: true,
      capReason: bandReason,
      whyNotHigher: noRateable
        ? "There is no rateable English response, so a higher band is not justified."
        : "The answer is too short, misses key task requirements, and provides too little evidence of organisation, vocabulary, and grammar control.",
      whyNotLower: noRateable
        ? "Band 0 is already the lowest score."
        : "There is at least a small attempt to communicate something related to the task.",
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
        feedbackZh: firstFeedbackZh,
        howToImprove: "Write a fuller response and cover all bullet points or develop your main ideas.",
        howToImproveZh: "请补充内容，覆盖所有要点或展开主要观点。"
      },
      "Coherence and Cohesion": {
        band: criterionBand,
        feedback: "There is not enough text to show clear organisation.",
        feedbackZh: "内容太少，无法体现清楚结构。",
        howToImprove: "Use separate paragraphs and simple linking words.",
        howToImproveZh: "请分段，并使用简单连接词。"
      },
      "Lexical Resource": {
        band: criterionBand,
        feedback: "Vocabulary range is very limited.",
        feedbackZh: "词汇范围非常有限。",
        howToImprove: "Add more topic-related vocabulary.",
        howToImproveZh: "增加与题目相关的词汇。"
      },
      "Grammatical Range and Accuracy": {
        band: criterionBand,
        feedback: "There is not enough language to assess grammar fully.",
        feedbackZh: "语言太少，难以完整评估语法。",
        howToImprove: "Write complete sentences and check verb forms.",
        howToImproveZh: "写完整句子，并检查动词形式。"
      }
    },
    strengths: noRateable ? [] : ["You attempted to respond to the task."],
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
    revisedEssayMeta: defaultRevisedEssayMeta(revisionLimited, "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions."),
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
    capApplied: Boolean(existingCalibration.capApplied || capApplied || diagnostics.recommendedLowBandRange),
    capReason: existingCalibration.capReason || capReason || diagnostics.reason || "",
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

function normalizeResultForMode(result, mode, veryShort, body) {
  const normalized = result && typeof result === "object" ? result : {};
  const diagnostics = buildLowBandDiagnostics(body || {});
  const modelDiagnostics = normalized.lowBandDiagnostics && typeof normalized.lowBandDiagnostics === "object" ? normalized.lowBandDiagnostics : {};
  normalized.lowBandDiagnostics = {
    ...modelDiagnostics,
    isBlank: diagnostics.isBlank,
    wordCount20OrFewer: diagnostics.wordCount20OrFewer,
    mostlyNonEnglish: diagnostics.mostlyNonEnglish,
    mostlyCopiedFromPrompt: diagnostics.mostlyCopiedFromPrompt,
    barelyRelated: Boolean(modelDiagnostics.barelyRelated || diagnostics.barelyRelated),
    littleRelevantMessage: Boolean(modelDiagnostics.littleRelevantMessage || diagnostics.littleRelevantMessage),
    noClearPositionTask2: Boolean(modelDiagnostics.noClearPositionTask2 || diagnostics.noClearPositionTask2),
    noBulletPointCoverageTask1: Boolean(modelDiagnostics.noBulletPointCoverageTask1 || diagnostics.noBulletPointCoverageTask1),
    meaningMostlyBlocked: Boolean(modelDiagnostics.meaningMostlyBlocked || diagnostics.meaningMostlyBlocked),
    recommendedLowBandRange: modelDiagnostics.recommendedLowBandRange || diagnostics.recommendedLowBandRange,
    reason: modelDiagnostics.reason || diagnostics.reason
  };
  ensureCriteria(normalized, body?.task);
  normalized.disclaimer = normalized.disclaimer || DISCLAIMER;
  normalized.strengths = ensureArray(normalized.strengths).slice(0, 5);
  normalized.mainProblems = ensureArray(normalized.mainProblems).slice(0, 5);
  normalized.grammarErrors = ensureArray(normalized.grammarErrors).slice(0, 5);
  normalized.sentenceCorrections = ensureArray(normalized.sentenceCorrections).slice(0, 5);
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
  normalized.revisedEssayMeta = {
    ...defaultRevisedEssayMeta(false),
    ...(normalized.revisedEssayMeta && typeof normalized.revisedEssayMeta === "object" ? normalized.revisedEssayMeta : {})
  };

  applyStrictCaps(normalized, body || {}, normalized.lowBandDiagnostics);

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

  const firstCriterion = firstCriterionName(body?.task);
  const firstBand = roundHalf(normalized.criteria?.[firstCriterion]?.band ?? normalized.overallBand);
  const lowOrLimited = veryShort || normalized.overallBand <= 3.5 || firstBand <= 4 || normalized.scoreCalibration.capApplied && normalized.overallBand <= 4;
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

  body.essay = String(body.essay || "");
  body.wordCount = Number(body.wordCount) || countWordsServer(body.essay);
  body.task = body.task === "Task 1" ? "Task 1" : "Task 2";

  const localDiagnostics = buildLowBandDiagnostics(body);
  if (localDiagnostics.isBlank || localDiagnostics.mostlyNonEnglish) {
    sendJson(req, res, 200, buildFallbackFeedback(body, localDiagnostics.reason || "No rateable English attempt."));
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

    sendJson(req, res, 200, normalizeResultForMode(result, effectiveMode, veryShort, body));
  } catch (error) {
    if (sendProviderError(req, res, error)) return;
    sendJson(req, res, 500, {
      error: "Server error while grading IELTS writing.",
      provider: "deepseek",
      detail: error.message
    });
  }
};
