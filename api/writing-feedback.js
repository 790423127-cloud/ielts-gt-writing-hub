const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const FEEDBACK_VERSION = "learning-feedback-v4-teacher-clinic-cloud-memory";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_FEEDBACK_TIMEOUT_MS) || 150000, 240000));

const MODULES = {
  overview: {
    title: "全文问题总览 / Overall Learning Overview",
    maxTokens: 5200,
    maxItems: "topProblems 3-5, errorSummary 4-8, nextPracticeFocus 3-6",
    schema: {
      summary: { en: "", zh: "" },
      topProblems: [
        {
          problem: { en: "", zh: "" },
          evidence: "exact sentence, phrase, paragraph, or task requirement from the essay/prompt",
          evidenceZh: "",
          whyMatters: { en: "", zh: "" },
          nextPractice: { en: "", zh: "" },
          priority: "high | medium | low"
        }
      ],
      errorSummary: [
        { type: "grammar | word_form | spelling | cohesion | task_response | vocabulary | tone", count: 0, note: { en: "", zh: "" } }
      ],
      nextPracticeFocus: [
        { focus: { en: "", zh: "" }, reason: { en: "", zh: "" }, action: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Give the learner a Chinese-first overview with English support.",
      "Identify the 3-5 problems that most affect the frozen score. Do not add generic comments.",
      "Every topProblems item must include evidence copied or closely quoted from the student's essay, or a specific missing task requirement from the prompt.",
      "For every problem, explain why it affects IELTS Writing scores and what the learner should practise next.",
      "Use the frozen score and criterion feedback only as context. Do not change or recalculate any score."
    ]
  },
  sentenceUpgrade: {
    title: "逐句修改与升级 / Sentence-by-Sentence Correction and Upgrade",
    maxTokens: 9000,
    maxItems: "analyse the essay sentence by sentence when possible; concise cards",
    schema: {
      summary: { en: "", zh: "" },
      sentenceCards: [
        {
          index: 1,
          original: "exact original sentence from the student's essay",
          originalZh: "",
          hasClearError: true,
          issueTags: ["spelling | grammar | word_form | collocation | tone | cohesion | task_fit | expression_upgrade | no_clear_error"],
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
      "Analyse the student's essay sentence by sentence as far as practical. Use the original order.",
      "Each card must include: original sentence, issue labels, minimal correction, a 0.5-1.0 band higher upgraded version, why it is better, and a useful pattern the learner can imitate.",
      "If a sentence has no obvious error, set hasClearError false and provide an expression upgrade. Do not invent an error.",
      "The upgraded version must match the frozen score level plus only 0.5-1.0 band. Do not produce Band 8/9 style language for a low or mid-band learner.",
      "Do not rewrite the whole essay as one block. Keep each card concise and evidence-based."
    ]
  },
  grammarWordFormSpelling: {
    title: "语法、词形与拼写 / Grammar, Word Form and Spelling",
    maxTokens: 8500,
    maxItems: "list all clear grammar/word-form/spelling errors when possible",
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
      "Find all clear grammar, word-form, and spelling errors in the student's essay as far as possible.",
      "Every item must use text from the student's essay. Do not invent errors.",
      "For grammar and word-form errors, give the wrong original text, corrected text, short Chinese explanation, and a practical checking method.",
      "When the essay is weak, cover the main error families you can genuinely see, such as Verb form after be, spelling/verb form, prepositions, indirect question word order, subject-verb agreement, article/noun form, sentence boundary/punctuation, and formal letter grammar/tone.",
      "Keep spellingQuickFix brief: wrong -> correct + short reason. Do not repeat long sentence-upgrade explanations here.",
      "If the essay is strong and has few errors, say so and focus on accuracy checks rather than forcing fake errors."
    ]
  },
  structureCohesionTask: {
    title: "结构、衔接与任务回应 / Structure, Cohesion and Task Response",
    maxTokens: 6500,
    maxItems: "Task 1 or Task 2 specific task-response checks only",
    schema: {
      summary: { en: "", zh: "" },
      taskChecklist: [
        { requirement: "", requirementZh: "", status: "covered | partly_covered | missing", statusZh: "", evidence: "", evidenceZh: "", advice: { en: "", zh: "" } }
      ],
      opening: { currentIssue: "", currentIssueZh: "", suggestedVersion: "", suggestedVersionZh: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
      paragraphOrganisation: { currentIssue: "", currentIssueZh: "", suggestedVersion: "", suggestedVersionZh: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
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
      ending: { currentIssue: "", currentIssueZh: "", suggestedVersion: "", suggestedVersionZh: "", whyBetter: { en: "", zh: "" }, howToUse: { en: "", zh: "" } },
      taskResponse: {
        currentIssue: "",
        currentIssueZh: "",
        suggestedVersion: "",
        suggestedVersionZh: "",
        whyBetter: { en: "", zh: "" },
        coverage: [
          { requirement: "", requirementZh: "", status: "covered | partly_covered | missing", statusZh: "", evidence: "", evidenceZh: "", advice: { en: "", zh: "" } }
        ]
      },
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "First decide from the locked task only: Task 1 letter or Task 2 essay. Do not mix rules.",
      "For Task 1, check purpose, recipient relationship/tone, all bullet points, specificity of request/explanation/suggestion, paragraphing, closing, and natural letter format.",
      "For Task 2, check whether the essay directly answers the prompt, has a clear position when required, has topic sentences, enough explanation, relevant examples, and an effective conclusion.",
      "Every taskChecklist/coverage item must mention a prompt requirement and evidence from the essay or state what is missing.",
      "Every taskChecklist/coverage item must include requirementZh, statusZh, evidenceZh, and advice.zh. evidenceZh must explain in Chinese what the English evidence shows and why it affects Task Achievement/Task Response or Coherence.",
      "If evidence quotes an English phrase from the essay, keep evidence in English and explain it in evidenceZh. Do not leave evidenceZh blank.",
      "Do not rewrite the whole essay.",
      "Never place a full rewritten essay or a full rewritten letter inside suggestedVersion. Give only a short local fix, micro-example, or a one-sentence pattern.",
      "For each structure issue, teach one local improvement: what is wrong now, what short example to use instead, and what the learner should practise next.",
      "Do not repeat grammar/spelling lists unless the language problem affects task response, cohesion, tone, or clarity."
    ]
  },
  expressionBank: {
    title: "老师语言精讲课 / Teacher Language Clinic",
    maxTokens: 12000,
    maxItems: "teacherOpening, memoryReview, exactly 5-6 teachingIssues, mustRememberToday 3-6, doNotWriteLikeThis 3-6, memoryUpdate",
    schema: {
      summary: { en: "", zh: "" },
      teacherOpening: {
        diagnosisZh: "",
        whatYouDidWellZh: "",
        todayMainGoalZh: "",
        howToUseThisLessonZh: ""
      },
      memoryReview: {
        hasMemoryContext: true,
        currentTask: "Task 1 | Task 2",
        teacherMemorySummaryZh: "",
        repeatedMistakes: [
          {
            issueId: "",
            issueTitleZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            previousExample: "",
            currentExample: "",
            teacherWarningZh: "",
            whatToPractiseAgainZh: ""
          }
        ],
        improvedMistakes: [
          {
            issueId: "",
            issueTitleZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            previousProblemZh: "",
            currentImprovementZh: "",
            teacherPraiseZh: ""
          }
        ],
        newMistakes: [
          {
            issueId: "",
            issueTitleZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            teacherNoteZh: ""
          }
        ]
      },
      teachingIssues: [
        {
          index: 1,
          issueId: "",
          issueTitleZh: "",
          issueTitleEn: "",
          taskScope: "task1 | task2 | sharedLanguage",
          severity: "high | medium | low",
          whyTeacherPickedThisZh: "",
          scoreImpactZh: "",
          slowLearnerExplanationZh: "",
          examplesFromYourEssay: [
            {
              original: "",
              survivalCorrection: "",
              naturalUpgrade: "",
              whatIsWrongZh: "",
              whyWrongZh: "",
              chineseThinkingTrapZh: "",
              englishLogicZh: "",
              stepByStepFixZh: ["", "", ""],
              teacherMemoryHookZh: "",
              nextTimeCheckZh: ""
            }
          ],
          coreRule: {
            ruleZh: "",
            formula: "",
            correctExamples: ["", ""],
            wrongExamples: ["", ""],
            quickCheckZh: ""
          },
          miniPractice: [
            {
              question: "",
              answer: "",
              explanationZh: ""
            }
          ],
          teacherConclusionZh: ""
        }
      ],
      mustRememberToday: [
        {
          pointZh: "",
          formula: "",
          example: "",
          whenToUseZh: "",
          quickCheckZh: ""
        }
      ],
      doNotWriteLikeThis: [
        {
          wrongExpression: "",
          whyWrongZh: "",
          saferVersion: "",
          memoryTipZh: ""
        }
      ],
      teacherWrapUp: {
        todayMainLessonZh: "",
        threeThingsToRememberZh: ["", "", ""],
        nextWritingGoalZh: "",
        encouragementZh: ""
      },
      homeworkTemplate: {
        titleZh: "",
        timeNeededZh: "",
        tasks: [
          {
            taskType: "correction | imitation | sentence_building | paragraph_writing",
            instructionZh: "",
            examples: [],
            checkMethodZh: "",
            relatedIssueId: ""
          }
        ],
        selfCheckList: [],
        nextSubmissionInstructionZh: ""
      },
      memoryUpdate: {
        saveToLocalMemory: true,
        saveToCloudMemory: true,
        newErrors: [
          {
            issueId: "",
            issueTitleZh: "",
            issueFamilyZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            task: "Task 1 | Task 2",
            wrongPattern: "",
            correctPattern: "",
            originalExample: "",
            correctedExample: "",
            explanationZh: "",
            memoryHookZh: "",
            nextPracticeZh: ""
          }
        ],
        repeatedErrors: [
          {
            issueId: "",
            issueTitleZh: "",
            issueFamilyZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            task: "Task 1 | Task 2",
            previousExample: "",
            currentExample: "",
            correctedExample: "",
            wrongPattern: "",
            correctPattern: "",
            explanationZh: "",
            memoryHookZh: "",
            nextPracticeZh: ""
          }
        ],
        improvedErrors: [
          {
            issueId: "",
            issueTitleZh: "",
            taskScope: "task1 | task2 | sharedLanguage",
            task: "Task 1 | Task 2",
            previousProblemZh: "",
            currentImprovementZh: "",
            teacherPraiseZh: ""
          }
        ],
        masteredPatterns: [
          {
            patternId: "",
            taskScope: "task1 | task2 | sharedLanguage",
            pattern: "",
            status: "practising | usable | mastered",
            example: "",
            relatedIssueId: ""
          }
        ],
        homeworkToSave: [
          {
            taskScope: "task1 | task2 | sharedLanguage",
            focus: "",
            homeworkZh: "",
            status: "assigned",
            relatedIssueId: ""
          }
        ],
        teacherSummaryToSave: {
          task: "Task 1 | Task 2",
          summaryZh: "",
          topTakeaways: [],
          nextLessonFocusZh: ""
        },
        reviewedOldErrors: []
      },
      groups: [
        {
          categoryZh: "",
          categoryEn: "",
          items: [
            { phrase: "", usageZh: "", suitableFor: "", source: "", sourceZh: "" }
          ]
        }
      ],
      usefulExpressions: [
        { expression: "", meaningZh: "", situation: { en: "", zh: "" }, pattern: { en: "", zh: "" }, fromEssayOrPrompt: "", whyUseful: { en: "", zh: "" } }
      ],
      avoidForNow: [
        { expression: "", reason: { en: "", zh: "" } }
      ],
      priorityAdvice: { en: "", zh: "" }
    },
    instructions: [
      "Turn this module into a detailed teacher-style language clinic, not a vocabulary list.",
      "Select exactly 5-6 serious language problems that most affect the learner's IELTS writing clarity and score. If the essay is very short and has fewer than 5 genuine issue families, return only the genuine issues and explain why.",
      "Do not list every small error. Group repeated mistakes into teachable problem types.",
      "Teach like a patient, very responsible teacher for a very slow learner. Explain slowly and concretely.",
      "For each issue, explain: what is wrong, why it is wrong, why the learner probably made the mistake, how English works differently, how to fix it step by step, and how to check it next time.",
      "For every issue, include examples from the student's exact essay.",
      "For every example, give original sentence, survival correction, and a small natural upgrade.",
      "Survival correction means the safest grammatically correct version. It is more important than advanced expression.",
      "Use vivid memory hooks or simple analogies when helpful, such as 'to is like a door; after it, use the base verb'.",
      "Each issue must include 2-3 mini practice questions with answers.",
      "Classify every issue by taskScope: task1 for GT letter-only skills, task2 for essay-only skills, and sharedLanguage for grammar/spelling/collocation errors useful in both tasks.",
      "Use cloud/local error memory by task if errorMemoryContext is provided. If currentTask is Task 1, use only Task 1 memory and sharedLanguage memory. If currentTask is Task 2, use only Task 2 memory and sharedLanguage memory.",
      "Do not use Task 2 argument advice for Task 1 letters. Do not use Task 1 letter-format advice for Task 2 essays.",
      "If an old error appears again, clearly say in Chinese: 这个错误你之前也犯过，这次又出现了。",
      "If a previous frequent error does not appear in the current essay, mention it briefly as improvement.",
      "Return memoryUpdate with newErrors, repeatedErrors, improvedErrors, masteredPatterns, homeworkToSave, and teacherSummaryToSave so the client can save it locally and in cloud memory.",
      "For Band 4-5 learners, teach simple accurate patterns first. Do not push advanced vocabulary.",
      "For Band 5.5-6.5 learners, teach clearer collocations and sentence patterns, but keep them learnable.",
      "Chinese is the main teaching language. English is used for original sentences, corrections, formulas, and examples.",
      "Do not rewrite the whole essay.",
      "Do not change, estimate, or discuss a new IELTS score."
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
      zh: String(
        value.zh ||
        value.chinese ||
        value.meaningZh ||
        value.explanationZh ||
        value.reasonZh ||
        value.suggestionZh ||
        value.evidenceZh ||
        value.issueZh ||
        value.currentIssueZh ||
        value.requirementZh ||
        value.statusZh ||
        value.nextActionZh ||
        value.checkMethodZh ||
        value.actionZh ||
        value.advice?.zh ||
        value.whyBetter?.zh ||
        value.howToUse?.zh ||
        ""
      ).trim()
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { en: value.trim(), zh: "" };
  }
  return { en: fallbackEn, zh: "" };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return String(value || "").trim();
}

function firstString(...values) {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = firstString(value.zh, value.chinese, value.meaningZh, value.explanationZh, value.reasonZh, value.suggestionZh, value.text, value.en, value.english);
      if (nested) return nested;
    } else if (String(value || "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function flattenTextParts(value, bucket = []) {
  if (value == null) return bucket;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) bucket.push(text);
    return bucket;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenTextParts(item, bucket));
    return bucket;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => flattenTextParts(item, bucket));
  }
  return bucket;
}

function textFingerprint(value) {
  return flattenTextParts(value)
    .join(" | ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff| ]+/g, "")
    .trim();
}

function uniqueBy(items, makeKey) {
  const seen = new Set();
  const result = [];
  for (const item of asArray(items)) {
    const key = String(makeKey(item) || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function listFromValue(value, limit = 6) {
  return uniqueBy(flattenTextParts(value), (item) => textFingerprint(item)).slice(0, limit);
}

function normalizeLabelText(value, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || fallback;
  if (value && typeof value === "object") {
    return firstString(
      value.zh,
      value.chinese,
      value.label,
      value.titleZh,
      value.errorTypeZh,
      value.en,
      value.english,
      value.text,
      value.errorType,
      value.title
    ) || fallback;
  }
  return fallback;
}

function looksLikeWholeEssayRewrite(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const words = countWords(value);
  if (words >= 65) return true;
  if (/\n\s*\n/.test(value) && words >= 35) return true;
  if (/^dear\b/i.test(value) && /(yours|best regards|kind regards)/i.test(value)) return true;
  return false;
}

function toMicroExample(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  const firstLine = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)[0] || "";
  if (!firstLine) return "";
  const sentence = firstLine.match(/[^.!?]+[.!?]?/);
  const sample = sentence ? sentence[0].trim() : firstLine;
  return sample.length > 180 ? `${sample.slice(0, 177)}...` : sample;
}

function normalizeStructureCoverageItem(item = {}) {
  const value = item && typeof item === "object" ? item : {};
  const advice = bilingualFallback(value.advice || value.suggestion || value.nextAction || value.reason, "Give a specific next action for this task requirement.");
  return {
    requirement: stringValue(value.requirement || value.taskRequirement || value.promptRequirement || value.point),
    requirementZh: firstString(value.requirementZh, value.taskRequirementZh, value.promptRequirementZh, value.pointZh),
    status: stringValue(value.status || value.coverageStatus),
    statusZh: firstString(value.statusZh, value.coverageStatusZh),
    evidence: stringValue(value.evidence || value.original || value.fromEssay || value.example),
    evidenceZh: firstString(value.evidenceZh, value.originalZh, value.exampleZh, value.explanationZh, value.reasonZh, advice.zh),
    issue: stringValue(value.issue || value.problem || value.currentIssue),
    issueZh: firstString(value.issueZh, value.problemZh, value.currentIssueZh),
    suggestion: stringValue(value.suggestion || value.nextAction || value.improvement),
    suggestionZh: firstString(value.suggestionZh, value.nextActionZh, value.improvementZh, advice.zh),
    advice
  };
}

function normalizeStructureSection(value = {}) {
  const item = value && typeof value === "object" ? value : {};
  const suggestedVersion = stringValue(item.suggestedVersion || item.suggestion || item.improved);
  const microExample = stringValue(item.microExample || item.shortExample || item.example || toMicroExample(suggestedVersion));
  return {
    ...item,
    currentIssue: stringValue(item.currentIssue || item.issue || item.current),
    currentIssueZh: firstString(item.currentIssueZh, item.issueZh, item.currentZh, item.explanationZh),
    suggestedVersion: looksLikeWholeEssayRewrite(suggestedVersion) ? "" : suggestedVersion,
    suggestedVersionZh: looksLikeWholeEssayRewrite(suggestedVersion) ? "" : firstString(item.suggestedVersionZh, item.suggestionZh, item.improvedZh),
    microExample,
    microExampleZh: firstString(item.microExampleZh, item.shortExampleZh, item.exampleZh),
    practiceFocusZh: firstString(item.practiceFocusZh, item.whatToLearnZh, item.howToUseZh, item.nextStepZh),
    whyBetter: bilingualFallback(item.whyBetter || item.why || item.reason, "This change improves clarity or task response."),
    howToUse: bilingualFallback(item.howToUse || item.nextStep || item.advice, "Use this pattern when the same task need appears.")
  };
}

function normalizeStructureIssue(value = {}) {
  const item = value && typeof value === "object" ? value : {};
  const improved = stringValue(item.improved || item.better || item.suggestion);
  return {
    ...item,
    original: stringValue(item.original || item.current || item.evidence),
    originalZh: firstString(item.originalZh, item.currentZh, item.evidenceZh, item.explanationZh),
    improved: looksLikeWholeEssayRewrite(improved) ? toMicroExample(improved) : improved,
    improvedZh: looksLikeWholeEssayRewrite(improved) ? "" : firstString(item.improvedZh, item.betterZh, item.suggestionZh),
    practiceFocusZh: firstString(item.practiceFocusZh, item.whatToLearnZh, item.nextStepZh),
    whyBetter: bilingualFallback(item.whyBetter || item.reason || item.explanation, "This version is clearer for the task.")
  };
}

function normalizeModuleResult(moduleName, value) {
  const result = value && typeof value === "object" ? { ...value } : {};
  result.summary = bilingualFallback(result.summary, "This module has completed its feedback.");
  result.priorityAdvice = bilingualFallback(result.priorityAdvice, "Focus on the most useful next step first.");

  if (moduleName === "overview") {
    result.topProblems = uniqueBy(asArray(result.topProblems).map((item) => ({
      ...item,
      title: firstString(item.title, item.problem?.en, item.problem, item.issue, item.focus),
      titleZh: firstString(item.titleZh, item.problem?.zh, item.problemZh, item.issueZh, item.focusZh),
      problem: bilingualFallback(item.problem || item.issue || item.focus, "This is one of the main score-limiting issues."),
      evidence: listFromValue(item.evidence, 4),
      evidenceZh: firstString(item.evidenceZh, item.reasonZh, item.explanationZh),
      whyMatters: bilingualFallback(item.whyMatters || item.reason || item.explanation, "This issue affects the frozen score."),
      nextPractice: bilingualFallback(item.nextPractice || item.nextAction || item.advice, "Practise one concrete improvement for this issue.")
    })), (item) => textFingerprint([item.titleZh, item.title, item.evidence, item.nextPractice?.zh])).slice(0, 5);
    result.errorSummary = uniqueBy(asArray(result.errorSummary), (item) => textFingerprint(item)).slice(0, 8);
    result.nextPracticeFocus = uniqueBy(asArray(result.nextPracticeFocus), (item) => textFingerprint(item)).slice(0, 6);
  }

  if (moduleName === "sentenceUpgrade") {
    result.sentenceCards = uniqueBy(asArray(result.sentenceCards || result.sentences).map((item, index) => ({
      index: Number(item.index) || index + 1,
      original: String(item.original || "").trim(),
      originalZh: String(item.originalZh || item.originalTranslationZh || "").trim(),
      hasClearError: item.hasClearError === false ? false : true,
      issueTags: uniqueBy(asArray(item.issueTags || item.errorTags || item.problemTags), (tag) => textFingerprint(tag)).slice(0, 8),
      minimalCorrection: String(item.minimalCorrection || item.corrected || "").trim(),
      minimalCorrectionZh: String(item.minimalCorrectionZh || item.correctedZh || "").trim(),
      upgradedVersion: String(item.upgradedVersion || item.improvedVersion || "").trim(),
      upgradedVersionZh: String(item.upgradedVersionZh || item.improvedVersionZh || "").trim(),
      whyBetter: bilingualFallback(item.whyBetter || item.explanation || item.reason, "This version is clearer and more suitable for the task."),
      learnThis: bilingualFallback(item.learnThis || item.studyPoint || item.usefulPattern, "Learn the sentence pattern and reuse it only when it matches your meaning."),
      usefulPattern: bilingualFallback(item.usefulPattern || item.pattern, "A useful pattern from this sentence.")
    })).filter((item) => item.original || item.minimalCorrection || item.upgradedVersion), (item) => textFingerprint([item.original, item.minimalCorrection, item.upgradedVersion])).slice(0, 12);
  }

  if (moduleName === "grammarWordFormSpelling") {
    result.grammarErrors = uniqueBy(asArray(result.grammarErrors).map((item, index) => ({
      index: Number(item.index) || index + 1,
      errorType: normalizeLabelText(item.errorType || item.type, "grammar"),
      errorTypeZh: firstString(item.errorTypeZh, item.typeZh, item.errorType?.zh, item.type?.zh),
      original: String(item.original || item.evidence || "").trim(),
      originalZh: String(item.originalZh || item.evidenceZh || "").trim(),
      corrected: String(item.corrected || item.correction || "").trim(),
      correctedZh: String(item.correctedZh || item.correctionZh || "").trim(),
      explanation: bilingualFallback(item.explanation || item.reason, "This is a grammar issue."),
      checkMethod: bilingualFallback(item.checkMethod || item.nextCheck, "Check this grammar pattern when you revise.")
    })).filter((item) => item.original || item.corrected), (item) => textFingerprint([item.errorTypeZh, item.errorType, item.original, item.corrected]));
    result.wordFormErrors = uniqueBy(asArray(result.wordFormErrors || result.wordFormAndPartOfSpeechErrors).map((item, index) => ({
      index: Number(item.index) || index + 1,
      errorType: normalizeLabelText(item.errorType || item.type, "word_form"),
      errorTypeZh: firstString(item.errorTypeZh, item.typeZh, item.errorType?.zh, item.type?.zh),
      original: String(item.original || item.wrong || "").trim(),
      originalZh: String(item.originalZh || "").trim(),
      corrected: String(item.corrected || item.correct || item.correction || "").trim(),
      correctedZh: String(item.correctedZh || item.correctZh || "").trim(),
      explanation: bilingualFallback(item.explanation || item.reason, "This is a word form or part-of-speech issue."),
      checkMethod: bilingualFallback(item.checkMethod || item.nextCheck, "Check whether the sentence needs a noun, verb, adjective, or adverb.")
    })).filter((item) => item.original || item.corrected), (item) => textFingerprint([item.errorTypeZh, item.errorType, item.original, item.corrected]));
    result.spellingQuickFix = uniqueBy(asArray(result.spellingQuickFix || result.spellingErrors).map((item) => ({
      wrong: String(item.wrong || item.original || "").trim(),
      correct: String(item.correct || item.correction || "").trim(),
      note: String(item.note || item.reason || "spelling").trim()
    })).filter((item) => item.wrong || item.correct), (item) => textFingerprint([item.wrong, item.correct, item.note]));
    result.learningFocus = uniqueBy(asArray(result.learningFocus || result.grammarLearningFocus), (item) => textFingerprint(item)).slice(0, 8);
  }

  if (moduleName === "structureCohesionTask") {
    result.cohesion = result.cohesion && typeof result.cohesion === "object" ? result.cohesion : { issues: asArray(result.cohesionIssues) };
    result.development = result.development && typeof result.development === "object" ? result.development : { issues: asArray(result.developmentIssues) };
    result.taskResponse = result.taskResponse && typeof result.taskResponse === "object" ? result.taskResponse : {};
    result.taskChecklist = uniqueBy(asArray(result.taskChecklist || result.taskResponse.coverage || result.coverage).map(normalizeStructureCoverageItem), (item) => textFingerprint([item.requirementZh, item.requirement, item.evidence, item.advice?.zh])).slice(0, 10);
    result.opening = normalizeStructureSection(result.opening);
    result.paragraphOrganisation = normalizeStructureSection(result.paragraphOrganisation || result.paragraphOrganization);
    result.paragraphOrganization = result.paragraphOrganisation;
    result.ending = normalizeStructureSection(result.ending);
    result.taskResponse = {
      ...result.taskResponse,
      currentIssue: stringValue(result.taskResponse.currentIssue || result.taskResponse.issue || result.taskResponse.current),
      currentIssueZh: firstString(result.taskResponse.currentIssueZh, result.taskResponse.issueZh, result.taskResponse.currentZh, result.taskResponse.explanationZh),
      suggestedVersion: stringValue(result.taskResponse.suggestedVersion || result.taskResponse.suggestion || result.taskResponse.improved),
      suggestedVersionZh: firstString(result.taskResponse.suggestedVersionZh, result.taskResponse.suggestionZh, result.taskResponse.improvedZh),
      whyBetter: bilingualFallback(result.taskResponse.whyBetter || result.taskResponse.why || result.taskResponse.reason, "This improves task response or task achievement."),
      howToUse: bilingualFallback(result.taskResponse.howToUse || result.taskResponse.nextStep || result.taskResponse.advice, "Use this approach when answering the task requirement."),
      coverage: uniqueBy(asArray(result.taskResponse.coverage || result.taskChecklist).map(normalizeStructureCoverageItem), (item) => textFingerprint([item.requirementZh, item.requirement, item.evidence, item.advice?.zh])).slice(0, 10)
    };
    result.cohesion.issues = uniqueBy(asArray(result.cohesion.issues || result.cohesionIssues).map(normalizeStructureIssue), (item) => textFingerprint([item.original, item.improved, item.whyBetter?.zh])).slice(0, 8);
    result.development.issues = uniqueBy(asArray(result.development.issues || result.developmentIssues).map(normalizeStructureIssue), (item) => textFingerprint([item.original, item.improved, item.whyBetter?.zh])).slice(0, 8);
  }

  if (moduleName === "expressionBank") {
    const normalizeStringArray = (value, limit = 6) => uniqueBy(flattenTextParts(value), (item) => textFingerprint(item)).slice(0, limit);

    const normalizeMemoryItem = (item = {}) => {
      const value = item && typeof item === "object" ? item : {};
      return {
        issueId: stringValue(value.issueId || value.id || value.issueTitleEn || value.wrongPattern || value.issueTitleZh),
        issueTitleZh: firstString(value.issueTitleZh, value.titleZh, value.issueFamilyZh, value.familyNameZh),
        issueFamilyZh: firstString(value.issueFamilyZh, value.familyNameZh, value.problemTypeZh),
        taskScope: stringValue(value.taskScope || value.scope || value.memoryScope),
        task: stringValue(value.task),
        wrongPattern: stringValue(value.wrongPattern || value.wrongExpression),
        correctPattern: stringValue(value.correctPattern || value.saferVersion),
        originalExample: stringValue(value.originalExample || value.original || value.currentExample),
        correctedExample: stringValue(value.correctedExample || value.corrected || value.survivalCorrection),
        previousExample: stringValue(value.previousExample),
        currentExample: stringValue(value.currentExample || value.originalExample || value.original),
        explanationZh: firstString(value.explanationZh, value.whyWrongZh, value.teacherNoteZh, value.reasonZh),
        memoryHookZh: firstString(value.memoryHookZh, value.memoryTipZh, value.teacherMemoryHookZh),
        nextPracticeZh: firstString(value.nextPracticeZh, value.whatToPractiseAgainZh, value.practiceAgainZh, value.teacherNoteZh),
        previousProblemZh: firstString(value.previousProblemZh, value.previousIssueZh),
        currentImprovementZh: firstString(value.currentImprovementZh, value.improvementZh),
        teacherPraiseZh: firstString(value.teacherPraiseZh, value.praiseZh)
      };
    };

    result.teacherOpening = result.teacherOpening && typeof result.teacherOpening === "object" ? {
      diagnosisZh: firstString(result.teacherOpening.diagnosisZh, result.teacherOpening.diagnosis),
      whatYouDidWellZh: firstString(result.teacherOpening.whatYouDidWellZh, result.teacherOpening.strengthZh),
      todayMainGoalZh: firstString(result.teacherOpening.todayMainGoalZh, result.teacherOpening.todayLessonGoalZh),
      howToUseThisLessonZh: firstString(result.teacherOpening.howToUseThisLessonZh, result.teacherOpening.teacherToneZh, result.teacherOpening.teacherReminderZh)
    } : {};

    const memoryReview = result.memoryReview && typeof result.memoryReview === "object" ? result.memoryReview : {};
    result.memoryReview = {
      hasMemoryContext: memoryReview.hasMemoryContext !== false,
      currentTask: stringValue(memoryReview.currentTask),
      teacherMemorySummaryZh: firstString(memoryReview.teacherMemorySummaryZh, memoryReview.summaryZh),
      repeatedMistakes: uniqueBy(asArray(memoryReview.repeatedMistakes).map((item) => ({
        issueId: stringValue(item.issueId || item.id),
        issueTitleZh: firstString(item.issueTitleZh, item.titleZh),
        taskScope: stringValue(item.taskScope || item.scope),
        previousExample: stringValue(item.previousExample),
        currentExample: stringValue(item.currentExample),
        teacherWarningZh: firstString(item.teacherWarningZh, item.warningZh),
        whatToPractiseAgainZh: firstString(item.whatToPractiseAgainZh, item.practiceAgainZh)
      })), (item) => textFingerprint([item.issueId, item.previousExample, item.currentExample])).slice(0, 8),
      improvedMistakes: uniqueBy(asArray(memoryReview.improvedMistakes).map((item) => ({
        issueId: stringValue(item.issueId || item.id),
        issueTitleZh: firstString(item.issueTitleZh, item.titleZh),
        taskScope: stringValue(item.taskScope || item.scope),
        previousProblemZh: firstString(item.previousProblemZh, item.previousIssueZh),
        currentImprovementZh: firstString(item.currentImprovementZh, item.improvementZh),
        teacherPraiseZh: firstString(item.teacherPraiseZh, item.praiseZh)
      })), (item) => textFingerprint([item.issueId, item.previousProblemZh, item.currentImprovementZh])).slice(0, 8),
      newMistakes: uniqueBy(asArray(memoryReview.newMistakes).map((item) => ({
        issueId: stringValue(item.issueId || item.id),
        issueTitleZh: firstString(item.issueTitleZh, item.titleZh),
        taskScope: stringValue(item.taskScope || item.scope),
        teacherNoteZh: firstString(item.teacherNoteZh, item.noteZh)
      })), (item) => textFingerprint([item.issueId, item.issueTitleZh])).slice(0, 8)
    };

    result.teachingIssues = uniqueBy(asArray(result.teachingIssues || result.languageClinicIssues || result.errorFamilies).map((item, index) => {
      const value = item && typeof item === "object" ? item : {};
      const examples = uniqueBy(asArray(value.examplesFromYourEssay || value.examples || value.sentenceTeachingCards).map((example) => ({
        original: stringValue(example.original || example.evidence),
        survivalCorrection: stringValue(example.survivalCorrection || example.teacherCorrection || example.corrected),
        naturalUpgrade: stringValue(example.naturalUpgrade || example.smallUpgrade || example.betterButStillSimple || example.upgradedVersion),
        whatIsWrongZh: firstString(example.whatIsWrongZh, example.errorPointZh, example.problemTypeZh),
        whyWrongZh: firstString(example.whyWrongZh, example.explanationZh, example.reasonZh),
        chineseThinkingTrapZh: firstString(example.chineseThinkingTrapZh, example.whyYouMadeThisMistakeZh),
        englishLogicZh: firstString(example.englishLogicZh, example.ruleZh),
        stepByStepFixZh: normalizeStringArray(example.stepByStepFixZh || example.teacherFixStepsZh || example.steps, 5),
        teacherMemoryHookZh: firstString(example.teacherMemoryHookZh, example.memoryHookZh, example.teacherAnalogyZh),
        nextTimeCheckZh: firstString(example.nextTimeCheckZh, example.checkMethodZh)
      })).filter((example) => example.original || example.survivalCorrection || example.naturalUpgrade), (example) => textFingerprint([example.original, example.survivalCorrection])).slice(0, 3);

      const coreRule = value.coreRule && typeof value.coreRule === "object" ? value.coreRule : {};
      return {
        index: Number(value.index) || index + 1,
        issueId: stringValue(value.issueId || value.familyId || value.id || value.issueTitleEn || value.issueTitleZh),
        issueTitleZh: firstString(value.issueTitleZh, value.familyNameZh, value.titleZh),
        issueTitleEn: stringValue(value.issueTitleEn || value.familyNameEn || value.titleEn),
        taskScope: stringValue(value.taskScope || value.scope),
        severity: stringValue(value.severity || "high"),
        whyTeacherPickedThisZh: firstString(value.whyTeacherPickedThisZh, value.whyPickedZh, value.teacherDiagnosisZh),
        scoreImpactZh: firstString(value.scoreImpactZh, value.whyItHurtsScoreZh),
        slowLearnerExplanationZh: firstString(value.slowLearnerExplanationZh, value.whyThisHappensZh, value.teacherDiagnosisZh),
        examplesFromYourEssay: examples,
        coreRule: {
          ruleZh: firstString(coreRule.ruleZh, value.simpleRuleZh, value.ruleZh),
          formula: stringValue(coreRule.formula || value.rememberPattern || value.formula),
          correctExamples: normalizeStringArray(coreRule.correctExamples || value.correctExamples, 3),
          wrongExamples: normalizeStringArray(coreRule.wrongExamples || value.wrongExamples, 3),
          quickCheckZh: firstString(coreRule.quickCheckZh, value.nextTimeCheckZh, value.checkMethodZh)
        },
        miniPractice: uniqueBy(asArray(value.miniPractice || value.practice || value.miniDrill).map((practice) => ({
          question: stringValue(practice.question || practice.prompt || practice.learnerTaskZh),
          learnerTaskZh: firstString(practice.learnerTaskZh, practice.taskZh),
          answer: stringValue(practice.answer || practice.suggestedAnswer),
          explanationZh: firstString(practice.explanationZh, practice.reasonZh)
        })).filter((practice) => practice.question || practice.answer), (practice) => textFingerprint([practice.question, practice.answer])).slice(0, 3),
        teacherConclusionZh: firstString(value.teacherConclusionZh, value.conclusionZh)
      };
    }).filter((item) => item.issueTitleZh || item.examplesFromYourEssay.length || item.coreRule.ruleZh), (item) => textFingerprint([item.issueId, item.issueTitleZh])).slice(0, 6);

    result.mustRememberToday = uniqueBy(asArray(result.mustRememberToday || result.mustLearnPatterns).map((item) => ({
      pointZh: firstString(item.pointZh, item.meaningZh, item.usedForZh),
      formula: stringValue(item.formula || item.pattern),
      example: stringValue(item.example || item.correctExample),
      whenToUseZh: firstString(item.whenToUseZh, item.nextEssayUseZh, item.usedForZh),
      quickCheckZh: firstString(item.quickCheckZh, item.nextTimeCheckZh)
    })).filter((item) => item.pointZh || item.formula || item.example), (item) => textFingerprint([item.pointZh, item.formula, item.example])).slice(0, 8);

    result.doNotWriteLikeThis = uniqueBy(asArray(result.doNotWriteLikeThis || result.avoidForNow || result.avoid).map((item) => ({
      wrongExpression: stringValue(item.wrongExpression || item.expression || item.wrong),
      whyWrongZh: firstString(item.whyWrongZh, item.reasonZh, item.reason?.zh),
      saferVersion: stringValue(item.saferVersion || item.betterChoice || item.correct),
      memoryTipZh: firstString(item.memoryTipZh, item.noteZh)
    })).filter((item) => item.wrongExpression || item.saferVersion), (item) => textFingerprint([item.wrongExpression, item.saferVersion])).slice(0, 8);

    result.teacherWrapUp = result.teacherWrapUp && typeof result.teacherWrapUp === "object" ? {
      todayMainLessonZh: firstString(result.teacherWrapUp.todayMainLessonZh, result.teacherWrapUp.summaryZh),
      threeThingsToRememberZh: normalizeStringArray(result.teacherWrapUp.threeThingsToRememberZh || result.teacherWrapUp.todayMustRememberZh, 5),
      nextWritingGoalZh: firstString(result.teacherWrapUp.nextWritingGoalZh, result.teacherWrapUp.nextGoalZh),
      encouragementZh: firstString(result.teacherWrapUp.encouragementZh, result.teacherWrapUp.praiseZh)
    } : {};

    const rawHomework = result.homeworkTemplate && typeof result.homeworkTemplate === "object" ? result.homeworkTemplate : {};
    result.homeworkTemplate = {
      titleZh: firstString(rawHomework.titleZh, rawHomework.title),
      timeNeededZh: firstString(rawHomework.timeNeededZh, rawHomework.timeNeeded),
      tasks: uniqueBy(asArray(rawHomework.tasks || rawHomework.steps || rawHomework.homework).map((item) => ({
        taskType: stringValue(item.taskType || item.type || "practice"),
        instructionZh: firstString(item.instructionZh, item.taskZh, item.stepZh, item.homeworkZh),
        examples: normalizeStringArray(item.examples || item.example, 5),
        checkMethodZh: firstString(item.checkMethodZh, item.checkZh),
        relatedIssueId: stringValue(item.relatedIssueId || item.issueId)
      })).filter((item) => item.instructionZh || item.examples.length), (item) => textFingerprint([item.taskType, item.instructionZh, item.relatedIssueId])).slice(0, 8),
      selfCheckList: normalizeStringArray(rawHomework.selfCheckList || rawHomework.checklist, 8),
      nextSubmissionInstructionZh: firstString(rawHomework.nextSubmissionInstructionZh, rawHomework.nextStepZh)
    };

    const memoryUpdate = result.memoryUpdate && typeof result.memoryUpdate === "object" ? result.memoryUpdate : {};
    result.memoryUpdate = {
      saveToLocalMemory: memoryUpdate.saveToLocalMemory !== false,
      saveToCloudMemory: memoryUpdate.saveToCloudMemory !== false,
      newErrors: uniqueBy(asArray(memoryUpdate.newErrors).map(normalizeMemoryItem), (item) => textFingerprint([item.issueId, item.taskScope, item.originalExample])).slice(0, 10),
      repeatedErrors: uniqueBy(asArray(memoryUpdate.repeatedErrors).map(normalizeMemoryItem), (item) => textFingerprint([item.issueId, item.taskScope, item.currentExample])).slice(0, 10),
      improvedErrors: uniqueBy(asArray(memoryUpdate.improvedErrors).map(normalizeMemoryItem), (item) => textFingerprint([item.issueId, item.taskScope, item.currentImprovementZh])).slice(0, 10),
      masteredPatterns: uniqueBy(asArray(memoryUpdate.masteredPatterns).map((item) => ({
        patternId: stringValue(item.patternId || item.id || item.pattern),
        taskScope: stringValue(item.taskScope || item.scope),
        pattern: stringValue(item.pattern),
        status: stringValue(item.status || "practising"),
        example: stringValue(item.example),
        relatedIssueId: stringValue(item.relatedIssueId || item.issueId)
      })).filter((item) => item.pattern || item.patternId), (item) => textFingerprint([item.patternId, item.pattern, item.taskScope])).slice(0, 10),
      homeworkToSave: uniqueBy(asArray(memoryUpdate.homeworkToSave).map((item) => ({
        taskScope: stringValue(item.taskScope || item.scope),
        focus: stringValue(item.focus || item.relatedIssueId || item.issueTitleZh),
        homeworkZh: firstString(item.homeworkZh, item.instructionZh, item.taskZh),
        status: stringValue(item.status || "assigned"),
        relatedIssueId: stringValue(item.relatedIssueId || item.issueId)
      })).filter((item) => item.homeworkZh || item.focus), (item) => textFingerprint([item.taskScope, item.focus, item.homeworkZh])).slice(0, 8),
      teacherSummaryToSave: memoryUpdate.teacherSummaryToSave && typeof memoryUpdate.teacherSummaryToSave === "object" ? {
        task: stringValue(memoryUpdate.teacherSummaryToSave.task),
        summaryZh: firstString(memoryUpdate.teacherSummaryToSave.summaryZh, memoryUpdate.teacherSummaryToSave.summary),
        topTakeaways: normalizeStringArray(memoryUpdate.teacherSummaryToSave.topTakeaways || memoryUpdate.teacherSummaryToSave.threeThingsToRememberZh, 6),
        nextLessonFocusZh: firstString(memoryUpdate.teacherSummaryToSave.nextLessonFocusZh, memoryUpdate.teacherSummaryToSave.nextWritingGoalZh)
      } : null,
      reviewedOldErrors: asArray(memoryUpdate.reviewedOldErrors).slice(0, 20)
    };

    const rawGroups = asArray(result.groups).map((group) => {
      const items = uniqueBy(asArray(group.items).map((item) => ({
        phrase: stringValue(item.phrase || item.expression || item.targetVersion),
        usageZh: firstString(item.usageZh, item.meaningZh, item.zh, item.situation?.zh),
        suitableFor: stringValue(item.suitableFor || item.situation?.en || item.situation || item.categoryEn),
        source: stringValue(item.source || item.fromEssayOrPrompt || item.original),
        sourceZh: firstString(item.sourceZh, item.fromEssayOrPromptZh, item.originalZh),
        whyUseful: bilingualFallback(item.whyUseful || item.reason || item.pattern, "Use this only when the task meaning matches.")
      })), (item) => textFingerprint([item.phrase, item.usageZh, item.suitableFor])).slice(0, 6);
      return {
        categoryZh: firstString(group.categoryZh, group.titleZh, group.labelZh, group.categoryEn, group.title),
        categoryEn: stringValue(group.categoryEn || group.titleEn || group.labelEn || group.title),
        items
      };
    }).filter((group) => group.items.length);

    const fallbackUseful = uniqueBy([
      ...asArray(result.usefulExpressions || result.expressions).map((item) => ({
        phrase: stringValue(item.expression || item.targetVersion || item.phrase),
        usageZh: firstString(item.meaningZh, item.zh, item.situation?.zh),
        suitableFor: stringValue(item.situation?.en || item.situation || item.fromEssayOrPrompt),
        source: stringValue(item.fromEssayOrPrompt || item.source || item.original),
        sourceZh: firstString(item.sourceZh, item.fromEssayOrPromptZh, item.originalZh),
        whyUseful: bilingualFallback(item.whyUseful || item.reason || item.pattern, "Use this expression when the task need is the same.")
      })),
      ...result.mustRememberToday.map((item) => ({
        phrase: item.formula || item.example,
        usageZh: item.pointZh,
        suitableFor: item.whenToUseZh,
        source: item.example,
        sourceZh: "",
        whyUseful: bilingualFallback({ zh: item.quickCheckZh }, "Use this pattern when the task need is the same.")
      }))
    ], (item) => textFingerprint([item.phrase, item.usageZh, item.suitableFor])).filter((item) => item.phrase || item.usageZh).slice(0, 8);

    result.groups = rawGroups.length ? rawGroups : (fallbackUseful.length ? [{ categoryZh: "老师本课必记表达", categoryEn: "Teacher must-remember patterns", items: fallbackUseful }] : []);
    result.usefulExpressions = fallbackUseful;
    result.avoidForNow = result.doNotWriteLikeThis.map((item) => ({
      expression: item.wrongExpression,
      reason: { en: "", zh: item.whyWrongZh || item.memoryTipZh }
    }));
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

function normalizedMemoryContextForPrompt(rawContext = {}, task = "Task 2") {
  if (!rawContext || typeof rawContext !== "object") {
    return { enabled: false, currentTask: task, taskSpecificMemory: [], sharedLanguageMemory: [] };
  }
  const currentTask = task === "Task 1" ? "Task 1" : "Task 2";
  const pack = (value, limit = 12) => asArray(value).slice(0, limit).map((item) => ({
    id: stringValue(item.id || item.issueId),
    issueTitleZh: firstString(item.issueTitleZh, item.titleZh, item.issueFamilyZh),
    issueFamilyZh: firstString(item.issueFamilyZh, item.familyNameZh),
    taskScope: stringValue(item.taskScope || item.scope),
    wrongPattern: stringValue(item.wrongPattern),
    correctPattern: stringValue(item.correctPattern),
    originalExample: stringValue(item.originalExample || item.currentExample || item.previousExample),
    correctedExample: stringValue(item.correctedExample),
    explanationZh: firstString(item.explanationZh, item.teacherNoteZh),
    memoryHookZh: firstString(item.memoryHookZh, item.memoryTipZh),
    occurrenceCount: Number(item.occurrenceCount || 0),
    repeatedCount: Number(item.repeatedCount || 0),
    masteryStatus: stringValue(item.masteryStatus || item.status),
    lastSeenAt: stringValue(item.lastSeenAt),
    nextPracticeZh: firstString(item.nextPracticeZh, item.practiceAgainZh)
  })).filter((item) => item.id || item.issueTitleZh || item.wrongPattern || item.originalExample);

  return {
    enabled: rawContext.enabled !== false,
    source: stringValue(rawContext.source || "local"),
    memoryVersion: stringValue(rawContext.memoryVersion),
    currentTask,
    learnerPreference: rawContext.learnerPreference && typeof rawContext.learnerPreference === "object" ? rawContext.learnerPreference : {},
    taskSpecificMemory: pack(rawContext.taskSpecificMemory || rawContext.recentErrors, 16),
    sharedLanguageMemory: pack(rawContext.sharedLanguageMemory, 16),
    frequentErrors: pack(rawContext.frequentErrors, 10),
    repeatedPatterns: pack(rawContext.repeatedPatterns, 10),
    improvingPatterns: pack(rawContext.improvingPatterns, 10),
    scoreHistory: asArray(rawContext.scoreHistory).slice(0, 8).map((item) => ({
      date: stringValue(item.date || item.createdAt),
      task: stringValue(item.task),
      promptType: stringValue(item.promptType || item.questionType),
      overall: item.overall,
      criteria: item.criteria || {},
      mainReasonZh: firstString(item.mainReasonZh, item.summaryZh)
    })),
    homeworkHistory: asArray(rawContext.homeworkHistory).slice(0, 8).map((item) => ({
      id: stringValue(item.id),
      taskScope: stringValue(item.taskScope),
      focus: stringValue(item.focus),
      homeworkZh: firstString(item.homeworkZh, item.instructionZh),
      status: stringValue(item.status),
      relatedIssueId: stringValue(item.relatedIssueId)
    })),
    masteredPatterns: asArray(rawContext.masteredPatterns).slice(0, 10).map((item) => ({
      patternId: stringValue(item.patternId || item.id),
      taskScope: stringValue(item.taskScope),
      pattern: stringValue(item.pattern),
      status: stringValue(item.status),
      example: stringValue(item.example),
      relatedIssueId: stringValue(item.relatedIssueId)
    })),
    teacherSummaryHistory: asArray(rawContext.teacherSummaryHistory).slice(0, 6).map((item) => ({
      date: stringValue(item.date || item.createdAt),
      task: stringValue(item.task),
      summaryZh: firstString(item.summaryZh),
      topTakeaways: asArray(item.topTakeaways).slice(0, 5),
      nextLessonFocusZh: firstString(item.nextLessonFocusZh)
    })),
    instruction: currentTask === "Task 1"
      ? "Use only Task 1 memory plus sharedLanguage memory. Ignore Task 2-only essay memory."
      : "Use only Task 2 memory plus sharedLanguage memory. Ignore Task 1-only letter memory."
  };
}

function buildPrompt(body, moduleName) {
  const moduleConfig = MODULES[moduleName];
  const task = normalizeRequestedTask(body);
  const frozenScore = JSON.stringify({
    frozenScore: body.frozenScore || null,
    currentResult: body.currentResult ? {
      overallBand: body.currentResult.overallBand || body.currentResult.scoreCalculation?.finalBand,
      criteria: body.currentResult.finalCriteria || body.currentResult.criteria,
      criterionCalibration: body.currentResult.criterionCalibration || null,
      scoreCalibration: body.currentResult.scoreCalibration || null,
      taskRequirementAnalysis: body.currentResult.taskRequirementAnalysis || null
    } : null
  }, null, 2);
  const taskSpecificContext = task === "Task 1"
    ? JSON.stringify({ task1BulletPoints: body.task1BulletPoints || [], letterStyle: body.letterStyle || "", requirement: "Use Task 1 GT letter rules only: purpose, tone, recipient relationship, all bullet points, specificity, paragraphing, closing." }, null, 2)
    : JSON.stringify({ task2QuestionProfile: body.task2QuestionProfile || null, requirement: "Use Task 2 essay rules only: direct answer, position if required, topic sentences, development, examples, conclusion." }, null, 2);
  const memoryContext = moduleName === "expressionBank"
    ? JSON.stringify(normalizedMemoryContextForPrompt(body.errorMemoryContext || {}, task), null, 2)
    : "";

  return [
    "You are an IELTS General Training writing feedback tutor.",
    "The IELTS score has already been frozen by another system. You are NOT scoring the essay.",
    "Do not change, estimate, mention a new score, recommend a different score, or recalculate any IELTS score or criterion band.",
    "Use the frozen overall band, four criterion bands, criterion feedback, exact prompt, locked task type, and student essay only to explain and teach.",
    "The selected task is locked by the request. Do not reclassify Task 1 and Task 2.",
    "For Task 1, never apply Task 2 position/argument rules. For Task 2, never apply Task 1 bullet-point letter rules.",
    "Highest priority rule: every piece of feedback must cite or paraphrase a specific sentence, phrase, paragraph, or task requirement. No generic local-template-like advice.",
    "Feedback language: bilingual, with Chinese explanation as the main learning support and concise English examples/corrections.",
    "Do not translate the entire essay. Do not translate or rewrite the whole answer. Only explain targeted feedback items.",
    "Your only job is targeted learning feedback for the requested module.",
    "Return VALID JSON only. No markdown, no code fences, no comments, no trailing prose.",
    "Use only double quotes for JSON strings. Escape any internal double quote as \\\".",
    "Do not put unescaped newlines inside JSON strings.",
    "Do not leave dangling commas. Do not omit commas between array elements.",
    "Keep each string concise. Long explanations increase JSON failure risk.",
    "Every user-facing English explanation, evidence, advice, rule, correction, improved expression, issue, suggestion, requirement, or quoted English text must include a Chinese explanation or Chinese meaning in the paired zh field or matching *Zh field.",
    "Chinese is required, not optional. Do not leave zh, evidenceZh, issueZh, suggestionZh, reasonZh, explanationZh, whyBetter.zh, advice.zh, currentIssueZh, or requirementZh blank when the English field has content.",
    "For Structure, Cohesion & Task, every taskChecklist item must include requirementZh, statusZh, evidenceZh, issueZh, and suggestionZh whenever the matching English field has content.",
    "For Structure, Cohesion & Task, every opening, paragraphOrganisation, ending, taskResponse, cohesion issue, and development issue must include currentIssueZh/evidenceZh/suggestionZh/reasonZh where applicable.",
    "Chinese notes must be specific to the student's essay and prompt. Do not write generic text such as 'this sentence needs improvement'.",
    "For evidence fields: keep the evidence quote in English, then explain in evidenceZh what that quote shows and why it matters for the IELTS task.",
    "If you cannot find a relevant issue for a field, use an empty English field and an empty Chinese field instead of returning English-only content.",
    `Requested module: ${moduleName} - ${moduleConfig.title}`,
    `Item limit: ${moduleConfig.maxItems}`,
    `Module instructions: ${moduleConfig.instructions.join(" ")}`,
    "Output JSON must have this shape exactly:",
    JSON.stringify({ ok: true, feedbackVersion: FEEDBACK_VERSION, module: moduleName, moduleTitle: moduleConfig.title, moduleResult: moduleConfig.schema }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Title: ${body.title || ""}`,
    `Prompt: ${clipText(body.prompt || body.questionPrompt || body.promptText || "", 2600)}`,
    `Task-specific requirements extracted by local code, for context only: ${taskSpecificContext}`,
    `Frozen score and frozen criterion feedback for level reference only: ${frozenScore}`,
    `Target upgrade level for feedback: ${targetUpgradeGuidance(body)}`,
    moduleName === "expressionBank" ? `Cloud/local task-separated learner memory for teacher teaching only. Use for teaching, homework, repeated-error review, and summary only; never use it to change the frozen score: ${clipText(memoryContext, 14000)}` : "",
    `Essay word count: ${countWords(body.essay)}`,
    "Student essay:",
    clipText(body.essay || "", moduleName === "sentenceUpgrade" || moduleName === "grammarWordFormSpelling" || moduleName === "expressionBank" ? 9000 : 7600)
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
  const raw = String(error && (error.message || error) || "unknown error");
  const lower = raw.toLowerCase();
  const errorKind = /json|parse|valid|unexpected token|unterminated/.test(lower)
    ? "ai_json_format_error"
    : (/zh|chinese|evidencezh|explanationzh|suggestionzh/.test(lower) ? "missing_chinese_fields" : "feedback_generation_error");
  const retryAdvice = errorKind === "missing_chinese_fields"
    ? "Retry this module. The AI returned feedback without enough Chinese helper fields."
    : "Retry this module. The AI returned malformed JSON or an incomplete response.";

  return {
    summary: {
      en: errorKind === "missing_chinese_fields"
        ? "This module could not be shown as complete because the AI did not return enough Chinese helper fields."
        : "This module could not be generated reliably because the AI response was not valid JSON.",
      zh: errorKind === "missing_chinese_fields"
        ? "该模块缺少必要中文解释字段，请重新生成。本次不会改变已经冻结的分数。"
        : "该模块返回格式异常，请重新生成。本次不会改变已经冻结的分数。"
    },
    priorityAdvice: {
      en: retryAdvice,
      zh: "请重新生成该模块。系统不会用本地模板假装生成真实反馈，也不会改动分数。"
    },
    errorKind,
    generationWarning: raw.slice(0, 500)
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
