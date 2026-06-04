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

function isVeryShortEssay(body) {
  const words = Number(body.wordCount) || 0;
  return body.task === "Task 1" ? words < 80 : words < 150;
}

function maxTokensForMode(mode, veryShort) {
  if (veryShort) return 1200;
  if (mode === "quick") return 2200;
  if (mode === "full") return 3500;
  return 6500;
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
    "Band 5.5+ is not a minimum score. Award Band 5.5 or above only when the writing has enough content, mostly understandable meaning, some organisation, and sufficient task coverage. Weak, very incomplete, copied, off-topic, or very short responses may score 0-5.",
    "Assess the essay using the four IELTS Writing criteria.",
    "For Task 1, use Task Achievement as the first criterion.",
    "For Task 2, use Task Response as the first criterion.",
    "Do not mix Task 1 and Task 2 first criteria.",
    "Task 1 word logic: the recommended minimum is 150 words. Do not apply Task 2 250-word thresholds. A Task 1 letter with 150+ words is not underlength. A 270-word Task 1 letter may be long, but length alone is not a low-band trigger. Do not set revisionLimited=true for a 150+ word Task 1 unless it is blank, mostly non-English, mostly copied, wholly unrelated, or clearly Band 0-3. If a Task 1 letter fully covers all bullet points, uses appropriate tone, and has accurate language, allow Band 8-9; do not cap it at Band 7 without specific evidence.",
    "Task 2 word logic: the recommended minimum is 250 words. Do not apply Task 1 bullet point rules to Task 2.",
    "Strict IELTS scoring does not mean artificially low scoring. A normal-length response that fully answers the task, is coherent, well developed, and accurate can receive Band 7, Band 8, or Band 9. Do not use Band 7 as a default ceiling. Band 8 does not require a perfect essay; occasional minor errors are acceptable when communication is strong. Band 9 does not require literary or native-level writing; it requires full task fulfilment, natural organisation, precise vocabulary, flexible grammar, and very rare minor errors. If the response is official-sample quality and answers the selected prompt, allow Band 8-9. Do not force strong relevant samples into Band 5 or Band 7.",
    "Low-band diagnostics should trigger only for clear evidence: blank/no attempt, 20 words or fewer, mostly non-English, mostly copied from prompt, wholly unrelated, little relevant message, no rateable English, or meaning mostly blocked. Do not trigger low-band diagnostics merely because language is simple, not advanced, not Band 9, or because a Task 1 answer is over 250 words.",
    "scoreCalibration.capApplied must be true only for a real cap: word count below the relevant threshold, Task 1 missing major bullet points, Task 2 no clear position when required, off-topic, mostly copied, mostly non-English, meaning mostly blocked, blank/no attempt, or task mismatch.",
    "Score from 0 to 9 and allow half bands.",
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
    "Error correction requirements: Always return errorAnalysis, detailedSentenceCorrections, task1LetterCorrections or task2EssayCorrections, and correctionPriority.",
    "For detailedSentenceCorrections, use originalSentence from the user's essay only, correctedSentence for direct correction, and betterExpression for a natural IELTS-style improvement without making Band 5 learners imitate Band 9 language.",
    "Classify errors using categories such as Task response/achievement problem, Missing bullet point, Tone problem, Verb tense, Subject-verb agreement, Article error, Singular/plural error, Word form error, Word choice error, Collocation error, Sentence fragment, Run-on sentence, Unclear meaning, Repetition, Informal wording in formal writing, Weak linking, and Paragraphing problem.",
    "Quick mode: detailedSentenceCorrections max 2, compact errorAnalysis only, no long special analysis. Full mode: detailedSentenceCorrections max 6 and include correctionPriority. Revision mode: detailedSentenceCorrections max 8 and include full correctionPriority plus task-specific corrections.",
    "Do not invent errors. Do not correct the whole essay line by line; choose representative high-impact errors.",
    "Return only one valid JSON object.",
    "Do not return markdown or code fences.",
    "Do not include explanatory preface or closing comments.",
    "All required keys must exist.",
    "Numbers in the JSON schema example are placeholders only, not default scores. Score strictly from the actual essay evidence.",
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
    actualWordCount: 0,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: task === "Task 1" ? 150 : 250,
    wordCountStatus: task === "Task 1" ? "meets_task1_minimum" : "meets_task2_minimum",
    taskRequirementAnalysis: task === "Task 1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
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
        band: 0,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Coherence and Cohesion": {
        band: 0,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Lexical Resource": {
        band: 0,
        feedback: "...",
        feedbackZh: "简短中文解释",
        howToImprove: "...",
        howToImproveZh: "简短中文建议"
      },
      "Grammatical Range and Accuracy": {
        band: 0,
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
    errorAnalysis: {
      summary: "...",
      summaryZh: "简短中文总结",
      errorPatterns: [
        {
          type: "Verb tense",
          typeZh: "动词时态",
          frequency: "occasional / frequent",
          impactOnBand: "...",
          impactOnBandZh: "...",
          howToFix: "...",
          howToFixZh: "..."
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
        errorTypeZh: "动词时态",
        problem: "...",
        problemZh: "...",
        rule: "...",
        ruleZh: "...",
        betterExpression: "...",
        betterExpressionZh: "...",
        bandImpact: "...",
        bandImpactZh: "..."
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
    revisionNotesZh: ["简短中文说明"],
    disclaimer: DISCLAIMER
  };
}


function buildQuickExpectedJsonShape(task) {
  const firstCriterion = firstCriterionName(task);
  return {
    actualWordCount: 0,
    taskTypeDetected: task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: task === "Task 1" ? 150 : 250,
    wordCountStatus: task === "Task 1" ? "meets_task1_minimum" : "meets_task2_minimum",
    taskRequirementAnalysis: task === "Task 1"
      ? { taskType: "task1", taskPurpose: "", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "" }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "" },
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
    criteria: {
      [firstCriterion]: { band: 0, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Coherence and Cohesion": { band: 0, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Lexical Resource": { band: 0, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" },
      "Grammatical Range and Accuracy": { band: 0, feedback: "", feedbackZh: "", howToImprove: "", howToImproveZh: "" }
    },
    strengths: [],
    mainProblems: [],
    grammarErrors: [],
    sentenceCorrections: [],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    detailedSentenceCorrections: [],
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
      reason: "No low-band trigger detected."
    },
    scoreCalibration: {
      strictness: "strict",
      capApplied: false,
      capReason: "",
      whyNotHigher: "",
      whyNotLower: "",
      evidence: []
    },
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: {
      band5Target: "No revised essay in Quick Check.",
      band6Target: "",
      band7Target: "",
      revisionLimited: false,
      revisionLimitReason: ""
    },
    revisionNotes: [],
    revisionNotesZh: [],
    disclaimer: DISCLAIMER
  };
}

function buildQuickSystemPrompt() {
  return [
    "You are a strict but fair IELTS Writing examiner.",
    "Return valid json only. Do not use markdown. Do not use code fences. Do not add text outside json.",
    "Quick Check mode: give a compact estimated IELTS score and short diagnostic only.",
    "Do not generate revised essays.",
    "Use Task Achievement for Task 1 and Task Response for Task 2.",
    "Task 1 uses a 150-word minimum. Never apply the Task 2 250-word threshold to Task 1.",
    "Task 1 high scores depend on purpose, bullet point coverage, tone, organisation, vocabulary, and grammar.",
    "Task 2 high scores depend on task response, position, development, organisation, vocabulary, and grammar.",
    "Strict scoring does not mean artificially low scoring. Do not use Band 7 as a default ceiling.",
    "Band 8 does not require perfection; occasional minor errors are acceptable when communication is strong.",
    "Band 9 does not require literary or native-level writing.",
    "If a response fully answers the selected task, is well organised, uses accurate flexible language, and has only minor errors, allow Band 8-9.",
    "Low-band logic should trigger only for clear evidence such as blank, mostly non-English, mostly copied, very short, off-topic, little relevant message, or meaning mostly blocked.",
    "Keep arrays short: strengths max 2, mainProblems max 3, grammarErrors max 2, sentenceCorrections max 2, detailedSentenceCorrections max 2.",
    "Every returned object must be complete enough to parse as json."
  ].join(" ");
}

function buildQuickUserPrompt(body) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const diagnostics = buildLowBandDiagnostics(body);
  const shape = buildQuickExpectedJsonShape(task);
  return [
    "Return one valid json object matching this compact schema:",
    JSON.stringify(shape, null, 2),
    "",
    "Important:",
    "- revisedEssayBand5, revisedEssayBand6, revisedEssayBand7 must be empty strings.",
    "- If the response is normal length, do not mark it too short.",
    "- If Task 1 has 150+ words, wordCountStatus must be meets_task1_minimum.",
    "- If Task 1 is strong and covers all bullet points with suitable tone, allow Band 8-9.",
    "- If final score is below 8 while highBandDiagnostics recommends 8.0-9.0, scoreCalibration.whyNotHigher must explain the exact reason.",
    "",
    "Server diagnostics:",
    JSON.stringify({ lowBandDiagnostics: diagnostics, capSuggestion: capFromDiagnostics(body, diagnostics) }, null, 2),
    "",
    "Request data:",
    JSON.stringify({
      task,
      taskType: task === "Task 1" ? "task1" : "task2",
      book: body.book,
      test: body.test,
      questionTitle: body.questionTitle,
      questionPrompt: body.questionPrompt,
      promptText: body.questionPrompt,
      gradingMode: "quick",
      actualWordCount: body.wordCount,
      wordCountThresholdUsed: task === "Task 1" ? 150 : 250,
      wordCountStatus: task === "Task 1"
        ? (body.wordCount >= 150 ? "meets_task1_minimum" : (body.wordCount < 80 ? "very_short_task1" : "under_task1_minimum"))
        : (body.wordCount >= 250 ? "meets_task2_minimum" : (body.wordCount < 150 ? "very_short_task2" : "under_task2_minimum")),
      essay: body.essay
    }, null, 2)
  ].join("\\n");
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
      promptText: body.questionPrompt,
      taskType: body.task === "Task 1" ? "task1" : "task2",
      gradingMode: effectiveMode,
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

function buildFallbackFeedback(body, reason) {
  const diagnostics = buildLowBandDiagnostics(body);
  const cap = capFromDiagnostics(body, diagnostics);
  const firstCriterion = firstCriterionName(body.task);
  const words = Number(body.wordCount) || countWordsServer(body.essay);
  const normalLength = (body.task === "Task 1" && words >= 150) || (body.task === "Task 2" && words >= 250);
  let band = 3;
  let bandReason = "The response is very limited and cannot support a higher score.";
  let fallbackOnlyReason = "";

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
  } else if (normalLength) {
    band = 5.5;
    fallbackOnlyReason = "AI output was incomplete, so this is only a temporary fallback estimate. Retry Quick Check or use Full Grading for a real score.";
    bandReason = fallbackOnlyReason;
  } else {
    band = body.task === "Task 1" ? 4.5 : 4.5;
    bandReason = "The response is under the recommended word count, and AI output was incomplete.";
  }

  const criterionBand = roundHalf(band);
  const noRateable = criterionBand === 0;
  const fallbackNormalLength = Boolean(normalLength && !diagnostics.isBlank && !diagnostics.mostlyNonEnglish && !diagnostics.mostlyCopiedFromPrompt && cap.cap === null);
  const revisionLimited = !fallbackNormalLength && (criterionBand <= 3.5 || diagnostics.littleRelevantMessage);
  const firstFeedback = noRateable
    ? "There is no rateable English response to assess for this task."
    : (fallbackNormalLength
      ? "AI output was incomplete, so this is a basic fallback estimate rather than a full IELTS assessment."
      : "The response is too short or limited and does not fully answer the task.");
  const firstFeedbackZh = noRateable
    ? "没有可评分的英文作答。"
    : (fallbackNormalLength
      ? "AI返回不完整，这是临时基础估分，不是完整批改。"
      : "作文太短或内容有限，没有充分完成题目要求。");
  const ccFeedback = fallbackNormalLength
    ? "Detailed organisation feedback is unavailable because the AI response was incomplete."
    : "There is not enough text to show clear organisation.";
  const lrFeedback = fallbackNormalLength
    ? "Detailed vocabulary feedback is unavailable because the AI response was incomplete."
    : "Vocabulary range is very limited.";
  const graFeedback = fallbackNormalLength
    ? "Detailed grammar feedback is unavailable because the AI response was incomplete."
    : "There is not enough language to assess grammar fully.";

  return {
    actualWordCount: words,
    taskTypeDetected: body.task === "Task 1" ? "task1" : "task2",
    wordCountThresholdUsed: body.task === "Task 1" ? 150 : 250,
    wordCountStatus: body.task === "Task 1" ? (words >= 150 ? "meets_task1_minimum" : (words < 80 ? "very_short_task1" : "under_task1_minimum")) : (words >= 250 ? "meets_task2_minimum" : (words < 150 ? "very_short_task2" : "under_task2_minimum")),
    taskRequirementAnalysis: body.task === "Task 1"
      ? { taskType: "task1", taskPurpose: "Write a General Training Task 1 letter that answers the selected prompt.", recipient: "", relationship: "", requiredTone: "", letterType: "", bulletPoints: [], missingRequirements: [], taskMatchSummary: "AI output failed before detailed task analysis could be completed." }
      : { taskType: "task2", questionType: "", topic: "", requiredPosition: "", requiredParts: [], positionPresent: false, mainIdeasRelevant: false, missingRequirements: [], taskMatchSummary: "AI output failed before detailed task analysis could be completed." },
    taskMatchCheck: { appearsToAnswerSelectedPrompt: true, reason: "No mismatch was detected before fallback was used.", warning: "" },
    highBandDiagnostics: { fullyAddressesTask: false, clearProgression: false, wellDevelopedIdeas: false, wideAccurateVocabulary: false, flexibleGrammar: false, fewErrors: false, appropriateToneTask1: body.task === "Task 1" ? false : null, recommendedHighBandRange: "", reason: fallbackNormalLength ? "High-band diagnostics are unavailable because AI output was incomplete. Retry for full scoring." : "High-band diagnostics are unavailable." },
    overallBand: criterionBand,
    estimatedLevel: `Band ${formatBand(criterionBand)}${fallbackNormalLength ? " fallback estimate" : ""}`,
    lowBandDiagnostics: diagnostics,
    scoreCalibration: {
      strictness: "strict",
      capApplied: fallbackNormalLength ? false : true,
      capReason: fallbackNormalLength ? "" : bandReason,
      whyNotHigher: noRateable
        ? "There is no rateable English response, so a higher band is not justified."
        : (fallbackNormalLength
          ? "A higher score cannot be confirmed because the AI provider returned incomplete output. Retry for full scoring."
          : "The answer is too short, misses key task requirements, and provides too little evidence of organisation, vocabulary, and grammar control."),
      whyNotLower: noRateable
        ? "Band 0 is already the lowest score."
        : (fallbackNormalLength
          ? "The response meets the word-count threshold, so it should not be treated as too short in fallback mode."
          : "There is at least a small attempt to communicate something related to the task."),
      evidence: [
        `The response has ${words} words.`,
        fallbackNormalLength ? "Task word-count threshold is met." : bandReason,
        diagnostics.reason || "No low-band trigger detected.",
        reason ? `Provider issue: ${String(reason).slice(0, 120)}` : ""
      ].filter(Boolean).slice(0, 5)
    },
    criteria: {
      [firstCriterion]: {
        band: criterionBand,
        feedback: firstFeedback,
        feedbackZh: firstFeedbackZh,
        howToImprove: fallbackNormalLength ? "Retry for full task analysis; this fallback does not judge bullet coverage in detail." : "Write a fuller response and cover all bullet points or develop your main ideas.",
        howToImproveZh: fallbackNormalLength ? "请重新批改获取完整题目分析。" : "请补充内容，覆盖所有要点或展开主要观点。"
      },
      "Coherence and Cohesion": {
        band: criterionBand,
        feedback: ccFeedback,
        feedbackZh: fallbackNormalLength ? "AI返回不完整，暂无法详细判断结构。" : "内容太少，无法体现清楚结构。",
        howToImprove: fallbackNormalLength ? "Retry for full paragraph and cohesion feedback." : "Use separate paragraphs and simple linking words.",
        howToImproveZh: fallbackNormalLength ? "重新批改查看结构反馈。" : "请分段，并使用简单连接词。"
      },
      "Lexical Resource": {
        band: criterionBand,
        feedback: lrFeedback,
        feedbackZh: fallbackNormalLength ? "AI返回不完整，暂无法详细判断词汇。" : "词汇范围非常有限。",
        howToImprove: fallbackNormalLength ? "Retry for full vocabulary feedback." : "Add more topic-related vocabulary.",
        howToImproveZh: fallbackNormalLength ? "重新批改查看词汇反馈。" : "增加与题目相关的词汇。"
      },
      "Grammatical Range and Accuracy": {
        band: criterionBand,
        feedback: graFeedback,
        feedbackZh: fallbackNormalLength ? "AI返回不完整，暂无法详细判断语法。" : "语言太少，难以完整评估语法。",
        howToImprove: fallbackNormalLength ? "Retry for detailed sentence correction." : "Write complete sentences and check verb forms.",
        howToImproveZh: fallbackNormalLength ? "重新批改查看语法批改。" : "写完整句子，并检查动词形式。"
      }
    },
    strengths: fallbackNormalLength ? ["The response meets the word-count threshold."] : (noRateable ? [] : ["You attempted to respond to the task."]),
    mainProblems: fallbackNormalLength ? ["AI output was incomplete, so detailed scoring is unavailable. Please retry."] : ["The essay is far below the recommended word count.", "Several task points or ideas are missing."],
    grammarErrors: [],
    sentenceCorrections: [],
    taskAchievementAdvice: fallbackNormalLength ? ["Retry for full task requirement analysis."] : ["Add enough detail to answer the task properly."],
    coherenceAdvice: fallbackNormalLength ? ["Retry for full paragraphing analysis."] : ["Use clear paragraphs."],
    lexicalAdvice: fallbackNormalLength ? ["Retry for full vocabulary analysis."] : ["Use more topic vocabulary."],
    grammarAdvice: fallbackNormalLength ? ["Retry for full grammar analysis."] : ["Write complete sentences."],
    band5FixPlan: fallbackNormalLength ? ["Retry to receive a real Band 5/6/7 improvement plan."] : ["Write at least the recommended word count.", "Cover all bullet points or develop two clear ideas."],
    band6UpgradePlan: fallbackNormalLength ? [] : ["Add supporting details and examples."],
    band7UpgradePlan: fallbackNormalLength ? [] : ["Use more precise vocabulary and varied sentence structures."],
    modelAnswerOutline: fallbackNormalLength ? "AI output was incomplete, so no reliable model outline is available. Retry for full feedback." : "Write a fuller answer with an opening, clear body points, and a suitable closing.",
    revisedEssayBand5: "",
    revisedEssayBand6: "",
    revisedEssayBand7: "",
    revisedEssayMeta: defaultRevisedEssayMeta(revisionLimited, "The original response is too short or too limited for meaningful Band 6 or Band 7 revisions."),
    revisionNotes: [fallbackNormalLength ? "AI output was incomplete, so this is a fallback estimate only. Retry for full grading." : "The response was too short, so only a basic diagnostic score is provided."],
    revisionNotesZh: [fallbackNormalLength ? "AI 返回内容不完整，这是临时基础估分。请重新批改获取完整反馈。" : "作文太短，因此这里只提供基础诊断评分。"],
    errorAnalysis: { summary: "", summaryZh: "", errorPatterns: [], priorityFixes: [], priorityFixesZh: [] },
    detailedSentenceCorrections: [],
    task1LetterCorrections: body.task === "Task 1" ? { openingComment: "", closingComment: "", toneComment: "", purposeComment: "", bulletPointAdvice: [] } : null,
    task2EssayCorrections: body.task === "Task 2" ? { positionComment: "", introductionComment: "", bodyParagraphComment: "", exampleComment: "", conclusionComment: "", developmentAdvice: [] } : null,
    correctionPriority: { fixFirst: [], fixNext: [], polishLater: [], fixFirstZh: [], fixNextZh: [], polishLaterZh: [] },
    scoreUnavailable: false,
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

async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt, maxTokens, temperature = 0.2, jsonMode = true }) {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature,
    stream: false,
    max_tokens: maxTokens
  };

  // DeepSeek JSON mode can occasionally return empty content on long/strict prompts.
  // Keep JSON mode for the first attempt, but allow a non-JSON-mode retry with the same
  // "return JSON only" prompt. This is usually more stable than immediately falling back.
  if (jsonMode) payload.response_format = { type: "json_object" };

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
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

async function callCompactFallbackGrader({ apiKey, model, body }) {
  // Last chance before deterministic fallback: ask the model for the compact Quick schema
  // without provider JSON mode. This avoids many empty-response and truncated-JSON failures.
  const text = await callDeepSeek({
    apiKey,
    model,
    systemPrompt: buildQuickSystemPrompt(),
    userPrompt: buildQuickUserPrompt({ ...body, mode: "quick" }),
    maxTokens: 2200,
    temperature: 0.1,
    jsonMode: false
  });
  return parseJsonFromProvider(text);
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

function normalizeResultForMode(result, mode, veryShort, body) {
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
  normalized.strengths = ensureArray(normalized.strengths).slice(0, 5);
  normalized.mainProblems = ensureArray(normalized.mainProblems).slice(0, 5);
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
  body.task = body.task === "Task 1" ? "Task 1" : "Task 2";
  body.wordCount = countWordsServer(body.essay);
  body.targetWordCount = body.task === "Task 1" ? 150 : 250;
  body.isUnderMinimum = body.wordCount < body.targetWordCount;

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
    const isQuickMode = effectiveMode === "quick";
    let result;
    let outputText = "";

    try {
      outputText = await callDeepSeek({
        apiKey,
        model,
        systemPrompt: isQuickMode ? buildQuickSystemPrompt() : buildSystemPrompt(veryShort),
        userPrompt: isQuickMode ? buildQuickUserPrompt({ ...body, mode: effectiveMode }) : buildUserPrompt({ ...body, mode: effectiveMode }, veryShort),
        maxTokens,
        temperature: 0.1,
        jsonMode: true
      });
      result = parseJsonFromProvider(outputText);
    } catch (primaryError) {
      if (sendProviderError(req, res, primaryError)) return;

      // For Quick Check, do not jump straight to fallback. Retry once with a compact
      // prompt and JSON mode disabled. This fixes most "AI returned incomplete" cases.
      if (effectiveMode === "quick" || /empty response|Unexpected end|JSON|malformed/i.test(primaryError.message || "")) {
        try {
          result = await callCompactFallbackGrader({ apiKey, model, body });
        } catch (compactError) {
          if (sendProviderError(req, res, compactError)) return;

          // Full/Revision get one repair attempt from the original text if available.
          if (effectiveMode !== "quick" && outputText) {
            try {
              const repairedText = await callDeepSeek({
                apiKey,
                model,
                systemPrompt: "You repair malformed JSON. Return exactly one valid JSON object and nothing else.",
                userPrompt: buildRepairPrompt(outputText, body.task),
                maxTokens: Math.min(maxTokens, 3000),
                temperature: 0.1,
                jsonMode: false
              });
              result = parseJsonFromProvider(repairedText);
            } catch (repairError) {
              if (sendProviderError(req, res, repairError)) return;
              sendJson(req, res, 200, buildFallbackFeedback(body, `DeepSeek output incomplete after retry: ${compactError.message || repairError.message}`));
              return;
            }
          } else {
            sendJson(req, res, 200, buildFallbackFeedback(body, `DeepSeek output incomplete after compact retry: ${compactError.message || primaryError.message}`));
            return;
          }
        }
      } else {
        sendJson(req, res, 200, buildFallbackFeedback(body, primaryError.message || "DeepSeek returned incomplete output."));
        return;
      }
    }

    sendJson(req, res, 200, normalizeResultForMode(result, effectiveMode, veryShort, body));
  } catch (error) {
    if (sendProviderError(req, res, error)) return;
    if (/empty response|invalid JSON|Unexpected end/i.test(error.message || "")) {
      sendJson(req, res, 200, buildFallbackFeedback(body, error.message));
      return;
    }
    sendJson(req, res, 500, {
      error: "Server error while grading IELTS writing.",
      provider: "deepseek",
      detail: error.message
    });
  }
};
