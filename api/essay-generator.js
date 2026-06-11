const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const GENERATOR_VERSION = "essay-generator-v3-15-source-based-candidate-selection";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_GENERATOR_TIMEOUT_MS) || 150000, 240000));
const DISCLAIMER = "This is AI-generated practice writing, not an official IELTS answer.";

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

function normalizeRequestedTask(body = {}) {
  const raw = String(
    body.task ||
    body.taskType ||
    body.generationTask ||
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
  body.generationTask = lockedTask;
  body.requestedTask = lockedTask;
  body.selectedTask = lockedTask;
  body.essay = String(body.essay || "");
  body.prompt = String(body.prompt || body.questionPrompt || body.promptText || "");
  body.questionPrompt = String(body.questionPrompt || body.prompt || body.promptText || "");
  body.wordCount = Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : countWords(body.essay);
  return body;
}

function taskOfResult(result) {
  if (!result || typeof result !== "object") return "";
  const explicit = result.task || result.localSignals?.task || result.taskType || result.scoringTask || result.requestedTask || result.selectedTask || result.writingTask || "";
  if (!explicit) return "";
  return normalizeRequestedTask({ task: explicit });
}

function safeFrozenContext(body = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const current = body.currentResult && typeof body.currentResult === "object" ? body.currentResult : null;
  const frozen = body.frozenScore && typeof body.frozenScore === "object" ? body.frozenScore : null;
  const currentTask = current ? (current.task || current.localSignals?.task || taskOfResult(current)) : "";
  if (current && currentTask && currentTask !== lockedTask) {
    return {
      frozenScore: frozen,
      currentResult: null,
      currentResultUsed: false,
      currentResultRejectedReason: `Rejected currentResult because it belongs to ${currentTask}, while the locked generation task is ${lockedTask}.`
    };
  }
  return {
    frozenScore: frozen,
    currentResult: current,
    currentResultUsed: Boolean(current),
    currentResultRejectedReason: ""
  };
}

function extractFrozenBandFromContext(context = {}) {
  const frozen = context.frozenScore && typeof context.frozenScore === "object" ? context.frozenScore : {};
  const current = context.currentResult && typeof context.currentResult === "object" ? context.currentResult : {};
  const candidates = [
    frozen.finalBand,
    frozen.overallBand,
    frozen.score,
    frozen.band,
    frozen.scoreCalculation && frozen.scoreCalculation.finalBand,
    current.finalBand,
    current.overallBand,
    current.score,
    current.band,
    current.scoreCalculation && current.scoreCalculation.finalBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
  }
  return null;
}

function clampBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9, Math.round(n * 2) / 2));
}

function bandLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(1).replace(/\.0$/, ".0");
}

function textArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function objectOnly(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function generationTargetsForContext(context = {}) {
  const currentBand = extractFrozenBandFromContext(context);
  if (!Number.isFinite(currentBand)) {
    return {
      currentBand: null,
      targetBandModel: 5.5,
      targetBandPlus05: 5.0,
      targetBandPlus10: 5.5,
      minimumTargetRule: "No frozen band is available. Use strict minimum targets: +0.5 revision at least Band 5.0, +1.0 revision/model at least Band 5.5.",
      levelInstruction: "No frozen band is available. Generate at least Band 5.0 for the +0.5 revision and at least Band 5.5 for the +1.0/model answer, while keeping language learnable and practical."
    };
  }

  const targetBandPlus05 = currentBand < 5.0 ? 5.0 : clampBand(currentBand + 0.5);
  const targetBandPlus10 = currentBand < 5.0 ? 5.5 : clampBand(currentBand + 1.0);
  const targetBandModel = clampBand(Math.max(targetBandPlus10, 5.5));
  const minimumTargetRule = `Strict exact target rule: if current band is ${currentBand.toFixed(1)}, revisionPlus05 must target exactly Band ${targetBandPlus05.toFixed(1)}, and revisionPlus10 must target exactly Band ${targetBandPlus10.toFixed(1)}. verifiedBand below target is below_target; verifiedBand equal to target is target_met; verifiedBand above target is target_exceeded. Do not call an above-target version target_met.`;

  let levelInstruction = "";
  if (currentBand < 5) {
    levelInstruction = "The student is below Band 5, but generated practice answers must not stay at the same level. The +0.5 revision must be at least Band 5.0. Improve task coverage, paragraph clarity, basic grammar accuracy, and useful everyday vocabulary. Keep language learnable, but make the answer strong enough to pass production verification at the target band.";
  } else if (currentBand < 6.5) {
    levelInstruction = "The student is around Band 5 to 6. The generated answers must be at least 0.5 band higher than the current score. Use moderately improved but still learnable language. Focus on clearer task response, paragraph development, safer grammar, and more natural collocation.";
  } else if (currentBand < 7.5) {
    levelInstruction = "The student is around Band 6.5 to 7. Generate stronger but still practical IELTS language. Focus on precision, development, cohesion, and controlled complex sentences.";
  } else {
    levelInstruction = "The student is already high band. The model answer can be sophisticated, but learning notes must remain practical and explainable.";
  }

  return { currentBand, targetBandModel, targetBandPlus05, targetBandPlus10, minimumTargetRule, levelInstruction };
}


function sourceBasedRevisionRules(task) {
  const common = [
    "Source-based revision rules:",
    "1. revisionPlus05 and revisionPlus10 must be based on the student's original essay, not a new generic model answer.",
    "2. Preserve the student's real situation, facts, relationship, reason, request/position, and main ideas.",
    "3. You may reorganise paragraphs, clarify vague points, fix weak wording, and add only minimal details that are directly implied by the prompt or the student's text.",
    "4. Do not invent a different scenario, different examples, different job, different course, different people, different opinion, or new supporting ideas unrelated to the original.",
    "5. The revised answer should still feel like the student's essay improved to the target level.",
    "6. The modelAnswer may be question-based and independent; this source-based rule applies especially to revisionPlus05 and revisionPlus10.",
    "7. If an added detail is needed for task completion, keep it modest, realistic, and directly connected to the original essay.",
    "8. Band 5 rescue is a sub-rule of source-based revision, not an exception. Do not use the Band 5 checklist as permission to replace the student's scenario, relationship, request, position, reasons, examples, or main facts.",
    "9. First preserve the student's source content, then raise it to the target band. The result must read like the student's own answer has been improved, not like a separate model answer."
  ];
  if (task === "Task 1") {
    common.push(
      "For Task 1 letters: keep the same sender, recipient, purpose, request, schedule/course details, and benefit idea unless the original is unclear; clarify them rather than replacing them."
    );
  } else {
    common.push(
      "For Task 2 essays: keep the same basic position and main argument direction unless the original position is missing; clarify it rather than replacing it."
    );
  }
  return common.join("\\n");
}


function band5DownshiftLockRules(task) {
  if (task === "Task 1") {
    return [
      "Band 5 downshift lock for repeated Band 6.0 verification:",
      "The rescue version is repeatedly scoring Band 6.0, which is too polished for the Band 5.0 rescue slot.",
      "Now rewrite it as a minimal source-based Band 5 letter, not a strong model answer.",
      "Hard constraints:",
      "1. Keep the student's original scenario, request, course/work facts, and benefit idea.",
      "2. Use 130-155 words unless the prompt clearly requires more.",
      "3. Use mostly short simple sentences. Avoid polished compound/complex sentence chains.",
      "4. Use basic vocabulary: ask, change, work, study, course, help, improve, menu, customers.",
      "5. Remove advanced or business-like phrasing such as 'ensure', 'responsibilities', 'daily operations', 'refresh the menu', 'especially during busy periods'.",
      "6. Do not add extra developed benefits beyond the student's original idea. One simple benefit sentence is enough.",
      "7. Keep clear task coverage, but make the language learner-like and modest.",
      "8. Do not intentionally add spelling errors or grammar mistakes."
    ].join("\\n");
  }
  return [
    "Band 5 downshift lock for repeated Band 6.0 verification:",
    "The rescue version is repeatedly scoring Band 6.0, which is too polished for the Band 5.0 rescue slot.",
    "Now rewrite it as a minimal source-based Band 5 essay, not a strong model answer.",
    "Hard constraints:",
    "1. Keep the student's original position and main idea direction.",
    "2. Use mostly short simple sentences.",
    "3. Use basic vocabulary and basic linking only.",
    "4. Keep explanation clear but not highly developed.",
    "5. Do not add sophisticated examples or abstract arguments.",
    "6. Keep clear task coverage, but make the language learner-like and modest.",
    "7. Do not intentionally add spelling errors or grammar mistakes."
  ].join("\\n");
}


function band5RescueEscalationRules(task) {
  if (task === "Task 1") {
    return [
      "Escalation mode for repeated Band 4.5 verification:",
      "The previous source-based rescue attempts still scored Band 4.5. This usually means the answer is too close to the weak original structure.",
      "Now rebuild the letter from the student's original content source, while preserving the same scenario, request, reason, and benefit idea.",
      "Do NOT merely polish sentences. Re-plan the answer with clear Band 5 task achievement.",
      "Task 1 required output:",
      "1. 150-170 words unless the prompt clearly needs less.",
      "2. Paragraph 1: clear purpose of the letter.",
      "3. Paragraph 2: explain the course and why hours must change.",
      "4. Paragraph 3: state the exact requested working schedule/change.",
      "5. Paragraph 4: explain how the employer/restaurant benefits, using the student's benefit idea.",
      "6. Paragraph 5: polite closing.",
      "7. Keep language simple and learnable; do not use polished Band 6/7 wording.",
      "8. Minor learner-like simplicity is acceptable; serious errors that block meaning are not."
    ].join("\\n");
  }
  return [
    "Escalation mode for repeated Band 4.5 verification:",
    "The previous source-based rescue attempts still scored Band 4.5. This usually means the answer is too close to the weak original structure.",
    "Now rebuild the essay from the student's original ideas, while preserving the same position and main idea direction.",
    "Do NOT merely polish sentences. Re-plan the answer with clear Band 5 task response.",
    "Task 2 required output:",
    "1. Introduction: answer the question directly.",
    "2. Body 1: first main idea with simple explanation.",
    "3. Body 2: second main idea or simple example.",
    "4. Conclusion: short clear answer.",
    "5. Keep language simple and learnable; do not use polished Band 6/7 wording.",
    "6. Minor learner-like simplicity is acceptable; serious errors that block meaning are not."
  ].join("\\n");
}


function band5ChecklistForTask(task) {
  if (task === "Task 1") {
    return [
      "Band 5 rescue checklist for GT Task 1 letter:",
      "1. Opening must clearly state the real purpose of the letter in the first paragraph.",
      "2. All bullet points must be visibly covered. Do not leave any bullet point implied only.",
      "3. The request or main message must be specific: what change, when, how long, and why.",
      "4. The benefit/explanation bullet must be concrete, not vague. Use realistic details from the prompt.",
      "5. Use clear 4-paragraph organisation: purpose, reason/situation, requested change, benefit plus polite ending.",
      "6. Tone must match the relationship and prompt. For a manager, use polite semi-formal/formal language.",
      "7. Grammar should mainly use simple, understandable sentences. It does not need to be error-free; minor awkwardness is acceptable if meaning is clear.",
      "8. Keep vocabulary basic and natural. Avoid serious meaning-blocking low-band expressions, but do not over-polish into Band 6/7 language.",
      "9. This checklist only helps the student's source content reach Band 5. It must not override the source-based revision rule or create a new letter."
    ].join("\\n");
  }
  return [
    "Band 5 rescue checklist for GT Task 2 essay:",
    "1. The introduction must directly answer the question and show a clear position when required.",
    "2. Each body paragraph must have one clear main idea.",
    "3. Each main idea must include simple explanation, not only assertion.",
    "4. Add one simple, relevant example when it helps the argument.",
    "5. Use basic but clear linking: firstly, for example, therefore, however, in conclusion.",
    "6. Conclusion must summarise the answer, not add a new idea.",
    "7. Grammar should mainly use simple, understandable sentences. It does not need to be error-free; minor awkwardness is acceptable if meaning is clear.",
    "8. Vocabulary should be basic, clear, and topic-relevant. Avoid advanced or literary phrasing that would push the answer toward Band 6+.",
    "9. This checklist only helps the student's source content reach Band 5. It must not override the source-based revision rule or create a new essay."
  ].join("\\n");
}


function band5RescueContext(context = {}) {
  const currentBand = extractFrozenBandFromContext(context);
  const belowBand5 = Number.isFinite(currentBand) && currentBand < 5.0;
  return {
    currentBand,
    belowBand5,
    rescueRevisionTitle: belowBand5 ? "Band 5 rescue revision" : "Revised version: +0.5 band",
    plus10Title: belowBand5 ? "Band 5.5 stronger revision" : "Revised version: +1.0 band",
    rescueRule: belowBand5
      ? "Because the student's current level is below Band 5.0, the first revised version is NOT a light edit. It is a Band 5 rescue rewrite. It must be based on the student's ideas and source facts first, then improved to Band 5.0. It may reorganise paragraphs, clarify the request, add only necessary prompt-related details, improve task coverage, replace low-band expressions, and simplify grammar. It must not replace the student's scenario, relationship, request, reasons, examples, or main meaning with a new model answer."
      : "Use the normal strict upgrade rule: the +0.5 revision must verify at current band +0.5, and the +1.0 revision must verify at current band +1.0."
  };
}

function targetWindowForGeneratedPart(key, targetBand) {
  const target = clampBand(targetBand);
  if (target == null) return { targetBand: null, exactOnly: true };
  return { targetBand: target, exactOnly: true };
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

function normalizeLearningGuide(guideObj = {}) {
  const guide = objectOnly(guideObj);
  const startHere = objectOnly(guide.startHere);
  const keyDifferences = Array.isArray(guide.keyDifferences)
    ? guide.keyDifferences.map((item) => {
        const diff = objectOnly(item);
        return {
          title: String(diff.title || "").trim(),
          originalProblem: String(diff.originalProblem || "").trim(),
          originalEvidence: String(diff.originalEvidence || "").trim(),
          revisionEvidence: String(diff.revisionEvidence || "").trim(),
          whyCloserToTarget: String(diff.whyCloserToTarget || "").trim(),
          imitationAction: String(diff.imitationAction || "").trim()
        };
      }).filter((item) => Object.values(item).some(Boolean))
    : [];
  const threeStepStudyPlan = Array.isArray(guide.threeStepStudyPlan)
    ? guide.threeStepStudyPlan.map((item, index) => {
        const step = objectOnly(item);
        return {
          step: String(step.step || `Step ${index + 1}`).trim(),
          task: String(step.task || "").trim(),
          whatToMark: String(step.whatToMark || "").trim(),
          whatToLearn: String(step.whatToLearn || "").trim(),
          practice: String(step.practice || "").trim()
        };
      }).filter((item) => Object.values(item).some(Boolean))
    : [];
  const imitablePatterns = Array.isArray(guide.imitablePatterns)
    ? guide.imitablePatterns.map((item) => {
        const pattern = objectOnly(item);
        return {
          pattern: String(pattern.pattern || "").trim(),
          meaningZh: String(pattern.meaningZh || "").trim(),
          source: String(pattern.source || "").trim(),
          useCase: String(pattern.useCase || "").trim(),
          substitutionPractice: String(pattern.substitutionPractice || "").trim(),
          nextUse: String(pattern.nextUse || "").trim()
        };
      }).filter((item) => Object.values(item).some(Boolean))
    : [];

  return {
    startHere: {
      recommendedFirst: String(startHere.recommendedFirst || "").trim(),
      whyFirst: String(startHere.whyFirst || "").trim(),
      relationToCurrentLevel: String(startHere.relationToCurrentLevel || "").trim(),
      whatToStudy: String(startHere.whatToStudy || "").trim(),
      notPriorityYet: String(startHere.notPriorityYet || "").trim(),
      targetAccuracyNote: String(startHere.targetAccuracyNote || "").trim()
    },
    keyDifferences,
    threeStepStudyPlan,
    imitablePatterns,
    nextWritingReminders: textArray(guide.nextWritingReminders || guide.nextPracticeFocus),
    doNotDo: textArray(guide.doNotDo || guide.doNotCopyBlindly),
    mainWeaknesses: textArray(guide.mainWeaknesses),
    nextPracticeFocus: textArray(guide.nextPracticeFocus),
    doNotCopyBlindly: textArray(guide.doNotCopyBlindly)
  };
}

function normalizeGeneratedCandidate(value = {}, fallbackTargetBand = null, fallbackTitle = "") {
  const item = objectOnly(value);
  return {
    title: String(item.title || fallbackTitle || "").trim(),
    targetBand: clampBand(item.targetBand ?? fallbackTargetBand),
    essay: String(item.essay || item.text || "").trim(),
    strategy: String(item.strategy || item.rewriteStrategy || "source-based candidate").trim(),
    preservedContent: textArray(item.preservedContent),
    changedProblems: textArray(item.changedProblems),
    whyCloserToTarget: String(item.whyCloserToTarget || item.reason || "").trim(),
    imitableSentences: textArray(item.imitableSentences || item.usefulSentences),
    whySourceBasedRevision: String(item.whySourceBasedRevision || "").trim(),
    sourceBasedChanges: textArray(item.sourceBasedChanges)
  };
}

function normalizeGeneratedCandidates(value, fallbackTargetBand = null, fallbackTitle = "") {
  return asArray(value).map((item) => normalizeGeneratedCandidate(item, fallbackTargetBand, fallbackTitle)).filter((item) => item.essay).slice(0, 3);
}

function buildGenerationPrompt(body = {}) {
  const task = normalizeRequestedTask(body);
  const context = safeFrozenContext(body);
  const targets = generationTargetsForContext(context);
  const rescue = band5RescueContext(context);
  const band5Checklist = band5ChecklistForTask(task);
  const sourceRules = sourceBasedRevisionRules(task);
  const prompt = body.questionPrompt || body.prompt || body.promptText || "";
  const essay = String(body.essay || "").trim();

  const taskSpecific = task === "Task 1"
    ? [
        "Task 1 requirements:",
        "- Generate General Training Task 1 letter practice output.",
        "- The question-based model answer must clearly cover all bullet points.",
        "- Use a suitable tone/register: formal, semi-formal, or informal depending on the prompt.",
        "- Keep paragraphs short, functional, and easy to imitate."
      ].join("\n")
    : [
        "Task 2 requirements:",
        "- Generate General Training Task 2 essay practice output.",
        "- Identify the question type and answer all parts.",
        "- Keep the position clear when the task asks for opinion.",
        "- Use logical body paragraphs with reasons and examples."
      ].join("\n");

  const essayInstruction = essay
    ? "The student essay is provided. Generate TWO revised versions based on the student\'s essay. They must be source-based revisions, not new generic essays. Preserve the student\'s core meaning, topic, facts, examples, and main ideas while improving task completion, clarity, paragraphing, grammar control, and wording."
    : "No student essay was provided. Leave revisionPlus05.essay and revisionPlus10.essay empty, but still provide the question-based model answer and learning guide.";

  return [
    "You are an IELTS General Training Writing tutor.",
    "This endpoint is generation-only. You are NOT scoring the user essay and must NOT change any frozen user score.",
    "Use frozen score/current result only as a language-level reference for generating learnable writing.",
    "Generate exactly THREE learning outputs:",
    "1) modelAnswer: a question-based model answer. It can be unrelated to the student's essay and should be only about 0.5 to 1.0 band above the student's current frozen level.",
    "2) revisionPlus05: if the student is below Band 5.0, this must be a Band 5 rescue revision, not a conservative light edit. If the student is Band 5.0 or above, it is a strict +0.5 band revision.",
    "3) revisionPlus10: if the student is below Band 5.0, this must target Band 5.5. If the student is Band 5.0 or above, it is a strict +1.0 band revision.",
    "Also generate 2 additional source-based candidates for revisionPlus05 and 2 additional source-based candidates for revisionPlus10. The candidates must keep the same student source facts but vary strategy slightly: one safer/simple version, one fuller clearer version. They are candidates for production verification and must not be new model answers.",
    "Do not produce Band 8/9 style language for a Band 5 student. The outputs must be learnable and imitable, but they must still be strong enough to meet the strict target band in production scoring verification.",
    "Strict target rule: below-target verification is failure, not near success. If the current band is 4.5, the +0.5 revision must be at least Band 5.0 and the +1.0 revision must be at least Band 5.5. If the current band is 5.0, the +0.5 revision must be at least Band 5.5.",
    "Verification status must be exact: verifiedBand < targetBand means below_target; verifiedBand === targetBand means target_met; verifiedBand > targetBand means target_exceeded. Higher than target is not target_met because this module teaches a specific next-step band.",
    "For revisionPlus05 and revisionPlus10, generate source-based revisions. They must preserve the user's scenario, relationship, request or position, main reasons, examples, task facts, and basic order/meaning. They must not become a new model answer.",
    "For Band 5 rescue, the checklist is subordinate to source-based revision. Do not replace the user's content just to satisfy the checklist. Preserve the user's source content first, then make it clear enough for Band 5.",
    "When writing learningGuide, write like an IELTS teacher speaking to a Chinese learner. Be concrete: cite original evidence, compare with revision evidence, tell the student which answer to study first, how to study it in three steps, which sentence patterns to imitate, what to check next time, and what not to do. Do not re-score the essay.",
    "Explain WHY each version is higher and WHAT the student should learn from it.",
    "Do not tell the student to memorize entire essays. Focus on structure, task coverage, useful sentences, grammar control, and paragraph development.",
    taskSpecific,
    essayInstruction,
    targets.levelInstruction,
    "Return strict JSON only. No markdown, no code fences, no comments, no trailing prose.",
    "Return exactly this shape:",
    JSON.stringify({
      ok: true,
      aiStage: "essay-generator",
      task,
      generationOnly: true,
      scoreUnaffected: true,
      currentBand: targets.currentBand,
      targetBandModel: targets.targetBandModel,
      targetBandPlus05: targets.targetBandPlus05,
      targetBandPlus10: targets.targetBandPlus10,
      modelAnswer: {
        title: "Question-based model answer",
        targetBand: targets.targetBandModel,
        essay: "...",
        whyThisIsLearnable: "...",
        whyHigherThanUserEssay: "...",
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      revisionPlus05: {
        title: rescue.rescueRevisionTitle,
        targetBand: targets.targetBandPlus05,
        essay: essay ? "..." : "",
        whyItIsPlus05: rescue.belowBand5 ? "Explain how this version satisfies a realistic Band 5 checklist: clear purpose, bullet coverage, specific request, concrete benefit, clear paragraphing, suitable tone, simple understandable grammar, and not over-polished Band 6 language." : "Explain why this is about +0.5 band higher.",
        whatChanged: ["..."],
        preservedContent: ["List the user's original facts, ideas, request/position, reasons, examples, or bullet-point details preserved in this revision"],
        changedProblems: ["List the main problems fixed without changing the user's core content"],
        whyCloserToTarget: "...",
        imitableSentences: ["..."],
        whySourceBasedRevision: "Explain why this is a source-based revision, not a new model answer.",
        sourceBasedChanges: ["List which original ideas/sentences were preserved and improved"],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      revisionPlus10: {
        title: rescue.plus10Title,
        targetBand: targets.targetBandPlus10,
        essay: essay ? "..." : "",
        whyItIsPlus10: "...",
        whatChangedFromPlus05: ["..."],
        preservedContent: ["List the user's original facts, ideas, request/position, reasons, examples, or bullet-point details preserved in this revision"],
        changedProblems: ["List the main problems fixed without changing the user's core content"],
        whyCloserToTarget: "...",
        imitableSentences: ["..."],
        whySourceBasedRevision: "Explain why this is a source-based revision, not a new model answer.",
        sourceBasedChanges: ["List which original ideas/sentences were preserved and improved"],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      },
      revisionPlus05Candidates: [
        {
          title: "Alternative source-based candidate for revisionPlus05",
          targetBand: targets.targetBandPlus05,
          essay: essay ? "..." : "",
          strategy: "source-based rescue | candidate selected | floor raise | soft downshift",
          preservedContent: ["..."],
          changedProblems: ["..."],
          whyCloserToTarget: "...",
          imitableSentences: ["..."],
          whySourceBasedRevision: "Explain why this candidate edits the student's source content instead of replacing it."
        }
      ],
      revisionPlus10Candidates: [
        {
          title: "Alternative source-based candidate for revisionPlus10",
          targetBand: targets.targetBandPlus10,
          essay: essay ? "..." : "",
          strategy: "source-based stronger candidate",
          preservedContent: ["..."],
          changedProblems: ["..."],
          whyCloserToTarget: "...",
          imitableSentences: ["..."],
          whySourceBasedRevision: "Explain why this candidate edits the student's source content instead of replacing it."
        }
      ],
      learningGuide: {
        startHere: {
          recommendedFirst: "revisionPlus05 | revisionPlus10 | modelAnswer",
          whyFirst: "Chinese-first teacher explanation of why the student should study this one first.",
          relationToCurrentLevel: "Explain how this version relates to currentBand.",
          whatToStudy: "What exactly the student should learn from it.",
          notPriorityYet: "Which answer is not the first priority and why.",
          targetAccuracyNote: "If a generated version did not exactly meet target after verification, honestly say it is the closest available version."
        },
        keyDifferences: [
          {
            title: "Difference title",
            originalProblem: "Chinese explanation of the original problem.",
            originalEvidence: "A short quote or phrase from the student's original essay.",
            revisionEvidence: "A short quote or phrase from revisionPlus05 or revisionPlus10.",
            whyCloserToTarget: "Why this change is closer to the target band.",
            imitationAction: "How to imitate this change next time."
          }
        ],
        threeStepStudyPlan: [
          {
            step: "Step 1",
            task: "Detailed Chinese task for the student.",
            whatToMark: "What to mark when comparing original and revision.",
            whatToLearn: "What skill to learn.",
            practice: "Concrete practice action."
          }
        ],
        imitablePatterns: [
          {
            pattern: "I am writing to ask if it would be possible to...",
            meaningZh: "我写信是想询问是否可以……",
            source: "revisionPlus05",
            useCase: "Request letters / body paragraph explanation / conclusion, etc.",
            substitutionPractice: "I am writing to ask if it would be possible to change my working hours.",
            nextUse: "Tell the student when to use it next time."
          }
        ],
        nextWritingReminders: ["Specific Chinese reminders based on the original essay."],
        doNotDo: ["Specific Chinese warnings about what not to do at the current level."]
      },
      legacy: {
        modelAnswerOutline: "...",
        modelAnswer: "...",
        revisedEssay: essay ? "..." : ""
      }
    }, null, 2),
    "Context:",
    `Task: ${task}`,
    `Question type: ${body.questionType || body.type || ""}`,
    `Title: ${body.title || ""}`,
    `Prompt: ${clipText(prompt, 2400)}`,
    `Current frozen band used only as level reference: ${targets.currentBand == null ? "unknown" : bandLabel(targets.currentBand)}`,
    `Target model answer band: ${targets.targetBandModel == null ? "learner-realistic" : bandLabel(targets.targetBandModel)}`,
    `Minimum target rule: ${targets.minimumTargetRule || "Generated answers must verify at or above their target band."}`,
    `Target +0.5 revised band: ${targets.targetBandPlus05 == null ? "learner-realistic +0.5" : bandLabel(targets.targetBandPlus05)}`,
    `Target +1.0 revised band: ${targets.targetBandPlus10 == null ? "learner-realistic +1.0" : bandLabel(targets.targetBandPlus10)}`,
    `Band 5 rescue rule: ${rescue.rescueRule}`,
    `Band 5 checklist: ${band5Checklist}`,
    `Frozen score/current result for level reference only: ${JSON.stringify({
      frozenScore: context.frozenScore,
      currentResult: context.currentResult ? {
        task: context.currentResult.task,
        overallBand: context.currentResult.overallBand || context.currentResult.finalBand || context.currentResult.scoreCalculation?.finalBand,
        criteria: context.currentResult.finalCriteria || context.currentResult.criteria
      } : null
    })}`,
    `Essay word count: ${countWords(essay)}`,
    "Student essay:",
    clipText(essay, 7000)
  ].join("\n\n");
}


function normalizeGenerationResult(raw = {}, body = {}) {
  const task = normalizeRequestedTask(body);
  const context = safeFrozenContext(body);
  const targets = generationTargetsForContext(context);
  const result = raw && typeof raw === "object" ? raw : {};

  const legacy = objectOnly(result.legacy);
  const modelObj = objectOnly(result.modelAnswer);
  const plus05Obj = objectOnly(result.revisionPlus05);
  const plus10Obj = objectOnly(result.revisionPlus10);
  const guideObj = objectOnly(result.learningGuide);

  const legacyModelAnswer = typeof result.modelAnswer === "string"
    ? result.modelAnswer
    : String(legacy.modelAnswer || result.answer || result.sampleAnswer || modelObj.essay || "").trim();

  const modelAnswer = {
    title: String(modelObj.title || "Question-based model answer").trim(),
    targetBand: clampBand(modelObj.targetBand ?? result.targetBandModel ?? targets.targetBandModel),
    essay: String(modelObj.essay || legacyModelAnswer || "").trim(),
    whyThisIsLearnable: String(modelObj.whyThisIsLearnable || result.whyThisModelIsLearnable || "").trim(),
    whyHigherThanUserEssay: String(modelObj.whyHigherThanUserEssay || result.whyModelIsHigher || "").trim(),
    studyPoints: textArray(modelObj.studyPoints),
    usefulSentences: textArray(modelObj.usefulSentences)
  };

  const revisionPlus05 = {
    title: String(plus05Obj.title || "Revised version: +0.5 band").trim(),
    targetBand: clampBand(plus05Obj.targetBand ?? result.targetBandPlus05 ?? targets.targetBandPlus05),
    essay: String(plus05Obj.essay || result.revisedEssayPlus05 || result.revisedEssay || legacy.revisedEssay || result.revision || result.improvedEssay || "").trim(),
    whyItIsPlus05: String(plus05Obj.whyItIsPlus05 || result.whyPlus05 || "").trim(),
    whatChanged: textArray(plus05Obj.whatChanged),
    preservedContent: textArray(plus05Obj.preservedContent),
    changedProblems: textArray(plus05Obj.changedProblems),
    whyCloserToTarget: String(plus05Obj.whyCloserToTarget || "").trim(),
    imitableSentences: textArray(plus05Obj.imitableSentences),
    whySourceBasedRevision: String(plus05Obj.whySourceBasedRevision || "").trim(),
    sourceBasedChanges: textArray(plus05Obj.sourceBasedChanges),
    studyPoints: textArray(plus05Obj.studyPoints),
    usefulSentences: textArray(plus05Obj.usefulSentences)
  };

  const revisionPlus10 = {
    title: String(plus10Obj.title || "Revised version: +1.0 band").trim(),
    targetBand: clampBand(plus10Obj.targetBand ?? result.targetBandPlus10 ?? targets.targetBandPlus10),
    essay: String(plus10Obj.essay || result.revisedEssayPlus10 || "").trim(),
    whyItIsPlus10: String(plus10Obj.whyItIsPlus10 || result.whyPlus10 || "").trim(),
    whatChangedFromPlus05: textArray(plus10Obj.whatChangedFromPlus05 || plus10Obj.whatChanged),
    preservedContent: textArray(plus10Obj.preservedContent),
    changedProblems: textArray(plus10Obj.changedProblems),
    whyCloserToTarget: String(plus10Obj.whyCloserToTarget || "").trim(),
    imitableSentences: textArray(plus10Obj.imitableSentences),
    whySourceBasedRevision: String(plus10Obj.whySourceBasedRevision || "").trim(),
    sourceBasedChanges: textArray(plus10Obj.sourceBasedChanges),
    studyPoints: textArray(plus10Obj.studyPoints),
    usefulSentences: textArray(plus10Obj.usefulSentences)
  };

  const learningGuide = normalizeLearningGuide(guideObj);
  const revisionPlus05Candidates = normalizeGeneratedCandidates(result.revisionPlus05Candidates || result.plus05Candidates, revisionPlus05.targetBand, "Alternative source-based candidate for revisionPlus05");
  const revisionPlus10Candidates = normalizeGeneratedCandidates(result.revisionPlus10Candidates || result.plus10Candidates, revisionPlus10.targetBand, "Alternative source-based candidate for revisionPlus10");

  const modelAnswerOutline = String(
    result.modelAnswerOutline ||
    legacy.modelAnswerOutline ||
    [
      modelAnswer.studyPoints.length ? `Model answer: ${modelAnswer.studyPoints.join("; ")}` : "",
      revisionPlus05.whatChanged.length ? `+0.5 revision: ${revisionPlus05.whatChanged.join("; ")}` : "",
      revisionPlus10.whatChangedFromPlus05.length ? `+1.0 revision: ${revisionPlus10.whatChangedFromPlus05.join("; ")}` : ""
    ].filter(Boolean).join("\n")
  ).trim();

  return {
    ok: true,
    aiStage: "essay-generator",
    generatorVersion: GENERATOR_VERSION,
    disclaimer: DISCLAIMER,
    task,
    taskLocked: true,
    generationOnly: true,
    scoreUnaffected: true,
    scoreChanged: false,
    currentResultUsed: context.currentResultUsed,
    currentResultRejectedReason: context.currentResultRejectedReason,
    wordCount: countWords(body.essay),
    currentBand: targets.currentBand,
    targetBandModel: modelAnswer.targetBand,
    targetBandPlus05: revisionPlus05.targetBand,
    targetBandPlus10: revisionPlus10.targetBand,
    modelAnswer,
    revisionPlus05,
    revisionPlus10,
    revisionPlus05Candidates,
    revisionPlus10Candidates,
    learningGuide,
    modelAnswerOutline,
    revisedEssay: revisionPlus05.essay,
    systemFeedback: {
      system: "essay-generation",
      status: "generated_three_step_learning_outputs_with_optional_production_verification",
      scoreChanged: false,
      message: "作文生成完成；生成了题目范文、+0.5 修改版、+1.0 修改版和学习说明。生成文本可使用生产评分路由做目标分验证；用户原分数没有改变。"
    }
  };
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
        temperature: 0.35,
        max_tokens: 8000,
        messages: [
          { role: "system", content: "Return strict JSON only. Generate IELTS GT practice writing only. Never recalculate or change any score." },
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


function baseUrlFromRequest(req) {
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host;
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : String(forwardedHost || "").trim();
  if (!host) return "https://ielts-gt-writing-hub.vercel.app";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : String(forwardedProto || "").trim();
  const scheme = proto || (/localhost|127\.0\.0\.1/i.test(host) ? "http" : "https");
  return `${scheme}://${host}`;
}

function extractBandFromScoreResult(result = {}) {
  const candidates = [
    result.finalBand,
    result.overallBand,
    result.estimatedBand,
    result.score,
    result.band,
    result.scoreCalculation && result.scoreCalculation.finalBand,
    result.scoreCalculation && result.scoreCalculation.overallBand,
    result.visibleScore && result.visibleScore.finalBand,
    result.visibleScore && result.visibleScore.overallBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
  }
  return null;
}

function verificationLabel(verifiedBand, targetBand) {
  const verified = Number(verifiedBand);
  const target = Number(targetBand);
  if (!Number.isFinite(verified) || !Number.isFinite(target)) return "verification_unavailable";
  if (verified < target) return "below_target";
  if (verified > target) return "target_exceeded";
  return "target_met";
}

function generatedBandDistance(verifiedBand, targetBand) {
  const verified = Number(verifiedBand);
  const target = Number(targetBand);
  if (!Number.isFinite(verified) || !Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return Math.abs(verified - target);
}

function verificationMessage(status) {
  if (status === "target_met") return "生产评分验证在目标窗口内。";
  if (status === "target_exceeded") return "生产评分验证超过目标窗口，达标但偏难，需要降档重写。";
  if (status === "below_target") return "生产评分验证低于目标，需要提高重写。";
  return "生产评分验证暂不可用。";
}

async function scoreGeneratedEssay(req, body, essayText, label, targetBand) {
  const essay = String(essayText || "").trim();
  if (!essay) {
    return {
      enabled: true,
      ok: false,
      label,
      targetBand: clampBand(targetBand),
      verifiedBand: null,
      status: "empty_essay",
      message: "没有可验证的生成文本。"
    };
  }

  const endpoint = `${baseUrlFromRequest(req)}/api/grade-ielts-production-router`;
  const payload = {
    ...body,
    ...{
      essay,
      wordCount: countWords(essay),
      mode: "score",
      aiStage: "generated-answer-production-verification",
      generationVerification: true,
      generatedAnswerLabel: label,
      generatedTargetBand: clampBand(targetBand),
      currentResult: null,
      frozenScore: null
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error([`HTTP ${response.status}`, data.error, data.detail].filter(Boolean).join(" | "));
    const verifiedBand = extractBandFromScoreResult(data);
    const status = verificationLabel(verifiedBand, targetBand);
    return {
      enabled: true,
      ok: true,
      label,
      router: "grade-ielts-production-router",
      targetBand: clampBand(targetBand),
      verifiedBand,
      status,
      message: verificationMessage(status),
      criterionBands: data.finalCriteria || data.criteria || null,
      source: data.finalSource || data.scoreSource || data.system || "production-router"
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      label,
      router: "grade-ielts-production-router",
      targetBand: clampBand(targetBand),
      verifiedBand: null,
      status: "verification_failed",
      message: "生产评分验证失败；生成作文仍然可用，但目标分未验证。",
      error: String(error.message || error).slice(0, 500)
    };
  }
}

function shouldRewriteForTarget(verification = {}) {
  const target = Number(verification.targetBand);
  const verified = Number(verification.verifiedBand);
  if (!verification.ok) return false;
  if (!Number.isFinite(target) || !Number.isFinite(verified)) return false;
  return verified !== target;
}

function generatedPartSpec(key) {
  if (key === "modelAnswer") {
    return {
      label: "question-based model answer",
      objectName: "modelAnswer",
      jsonShape: {
        title: "Question-based model answer",
        targetBand: 0,
        essay: "...",
        whyThisIsLearnable: "...",
        whyHigherThanUserEssay: "...",
        studyPoints: ["..."],
        usefulSentences: ["..."]
      }
    };
  }
  if (key === "revisionPlus10") {
    return {
      label: "+1.0 revised version based on the student's essay",
      objectName: "revisionPlus10",
      jsonShape: {
        title: "Revised version: +1.0 band",
        targetBand: 0,
        essay: "...",
        whyItIsPlus10: "...",
        whatChangedFromPlus05: ["..."],
        preservedContent: ["..."],
        changedProblems: ["..."],
        whyCloserToTarget: "...",
        imitableSentences: ["..."],
        whySourceBasedRevision: "...",
        sourceBasedChanges: ["..."],
        studyPoints: ["..."],
        usefulSentences: ["..."]
      }
    };
  }
  return {
    label: "+0.5 revised version based on the student's essay",
    objectName: "revisionPlus05",
    jsonShape: {
      title: "Revised version: +0.5 band",
      targetBand: 0,
      essay: "...",
      whyItIsPlus05: "...",
      whatChanged: ["..."],
      preservedContent: ["..."],
      changedProblems: ["..."],
      whyCloserToTarget: "...",
      imitableSentences: ["..."],
      whySourceBasedRevision: "...",
      sourceBasedChanges: ["..."],
      studyPoints: ["..."],
      usefulSentences: ["..."]
    }
  };
}

function buildRewritePrompt(body, normalized, key, verification) {
  const task = normalizeRequestedTask(body);
  const part = objectOnly(normalized[key]);
  const spec = generatedPartSpec(key);
  const prompt = body.questionPrompt || body.prompt || body.promptText || "";
  const targetBand = clampBand(part.targetBand || verification.targetBand);
  const verifiedBand = clampBand(verification.verifiedBand);
  const criterionBands = verification.criterionBands || {};
  const verificationStatus = String(verification.status || verificationLabel(verifiedBand, targetBand));
  const rescue = band5RescueContext(safeFrozenContext(body));
  const isBand5Rescue = rescue.belowBand5 && key === "revisionPlus05";
  const band5Checklist = band5ChecklistForTask(task);
  const sourceRules = sourceBasedRevisionRules(task);
  const rewriteAttemptCount = Number(body.rewriteAttemptCount || body.attemptNumber || 0);
  const escalationMode = isBand5Rescue && verificationStatus === "below_target" && rewriteAttemptCount >= 3;
  const downshiftLockMode = isBand5Rescue && verificationStatus === "target_exceeded" && rewriteAttemptCount >= 2;
  const escalationRules = band5RescueEscalationRules(task);
  const downshiftLockRules = band5DownshiftLockRules(task);
  const targetMaxBand = targetBand == null ? null : clampBand(targetBand + 0.5);
  const rewriteDirection = verificationStatus === "target_exceeded"
    ? "SOFT DOWNSHIFT: The generated answer scored above this exact learning target. Keep all task content and source facts, but reduce polish, complexity, and development until it is closer to the exact target band."
    : "UPGRADE: The generated answer scored below target. Improve it enough to reach the target.";

  return [
    "You are revising one generated IELTS General Training practice answer after production-router verification.",
    "This is NOT scoring the user's original essay. Do not change any frozen user score.",
    "Your job is to rewrite ONLY the selected generated answer so that it better matches the stated target band while remaining learnable for the student.",
    "The rewritten answer must remain based on the student\'s original essay and the previous generated answer. Do not create a new generic model answer.",
    sourceRules,
    "Do not use over-advanced Band 8/9 language for a Band 5 target. Improve task coverage, specificity, paragraphing, cohesion, and safe grammar first.",
    "Return strict JSON only. No markdown, no code fences, no comments.",
    `Selected generated answer: ${spec.label}`,
    `Task: ${task}`,
    `Target band: ${targetBand == null ? "learner-realistic" : bandLabel(targetBand)}`,
    `Production-router verified band: ${verifiedBand == null ? "unavailable" : bandLabel(verifiedBand)}`,
    `Exact target: ${targetBand == null ? "unavailable" : bandLabel(targetBand)}`,
    `Production-router verification status: ${verificationStatus}`,
    `Rewrite attempt number: ${rewriteAttemptCount}`,
    `Escalation mode active: ${escalationMode ? "YES" : "NO"}`,
    `Band 5 downshift lock active: ${downshiftLockMode ? "YES" : "NO"}`,
    `Rewrite direction: ${rewriteDirection}`,
    `Production-router criterion bands: ${JSON.stringify(criterionBands)}`,
    "The learning slot has an exact target, not a minimum. If target is Band 5.0 and production verification is Band 5.5 or 6.0, status is target_exceeded and the answer must be softly downshifted. Do not call above-target versions successful.",
    isBand5Rescue ? "This is the Band 5 rescue revision. It must satisfy the checklist below. It must be a source-based rescue rewrite: stronger than the original, but still clearly derived from the student\'s original facts, request, reason, and benefit idea." : "",
    isBand5Rescue ? "Realistic Band 5 rule: the answer should be clear and complete but still simple. It can contain basic vocabulary, simple grammar, some repetition, and minor awkwardness. Do not intentionally add mistakes." : "",
    isBand5Rescue ? band5Checklist : "",
    escalationMode ? escalationRules : "",
    escalationMode ? "Because repeated attempts stayed below target, source-based now means content-source-based, not sentence-structure-based. Preserve the student\'s facts and ideas, but rebuild weak paragraphing and sentence choices enough to pass Band 5." : "",
    downshiftLockMode ? downshiftLockRules : "",
    downshiftLockMode ? "Because repeated attempts exceeded the target, do NOT keep the same polished essay. Produce a shorter, simpler, more modest source-based version while keeping all task requirements clear." : "",
    "If status is below_target, improve task coverage, specificity, paragraphing, cohesion, and basic grammar. For Task 1, make the request concrete and the benefit specific. For Task 2, make the position and body paragraph development clearer.",
    "If status is target_exceeded, keep the task fully covered and preserve the student's source content, but simplify vocabulary, shorten sentence structures, reduce sophisticated collocations, remove over-polished phrasing, and aim for the exact target band.",
    "Output JSON shape:",
    JSON.stringify({ [spec.objectName]: { ...spec.jsonShape, targetBand } }, null, 2),
    "Context prompt:",
    clipText(prompt, 2200),
    "Student original essay:",
    clipText(body.essay || "", 5000),
    "Generated answer that needs revision:",
    clipText(part.essay || "", 5000),
    "Rewrite quality requirement:",
    downshiftLockMode ? "Return a complete minimal source-based Band 5 rescue answer. It must preserve the student\'s content and scenario, but intentionally reduce polish, sentence complexity, word choice strength, and extra development." : (escalationMode ? "Return a complete rebuilt source-based Band 5 rescue answer. It must preserve the student\'s content and scenario, but it does NOT need to preserve weak original sentence structure." : (isBand5Rescue ? "Return a complete realistic Band 5 rescue revision, not a sentence-by-sentence micro-edit. It must be clearly stronger than the original, but still simple and not over-polished." : "Return a complete revised generated answer for the target window."))
  ].join("\n\n");
}

function mergeRewrittenPart(normalized, key, rawRewrite) {
  const spec = generatedPartSpec(key);
  const incoming = objectOnly(rawRewrite[spec.objectName] || rawRewrite[key] || rawRewrite);
  const current = objectOnly(normalized[key]);
  normalized[key] = { ...current, ...incoming, targetBand: clampBand(incoming.targetBand ?? current.targetBand) };
  return normalized;
}

async function maybeRewriteGeneratedPart(req, body, normalized, key, firstVerification) {
  if (!shouldRewriteForTarget(firstVerification)) {
    normalized[key].verification = firstVerification;
    normalized[key].rewriteAttempted = false;
    return normalized[key].verification;
  }

  try {
    const rewritePrompt = buildRewritePrompt(body, normalized, key, firstVerification);
    const rawRewrite = await callDeepSeek(rewritePrompt);
    mergeRewrittenPart(normalized, key, rawRewrite);
    const secondVerification = await scoreGeneratedEssay(req, body, normalized[key].essay, key, normalized[key].targetBand);
    normalized[key].verification = {
      ...secondVerification,
      firstVerifiedBand: firstVerification.verifiedBand,
      firstStatus: firstVerification.status,
      rewriteAttempted: true,
      rewriteStrategy: firstVerification.status === "target_exceeded" ? "soft downshift" : "floor raise",
      exactTargetMet: secondVerification.status === "target_met"
    };
    normalized[key].rewriteAttempted = true;
    return normalized[key].verification;
  } catch (error) {
    normalized[key].verification = {
      ...firstVerification,
      rewriteAttempted: true,
      rewriteStrategy: firstVerification.status === "target_exceeded" ? "soft downshift" : "floor raise",
      exactTargetMet: firstVerification.status === "target_met",
      rewriteFailed: true,
      rewriteError: String(error.message || error).slice(0, 500),
      message: `${firstVerification.message} 自动重写尝试失败；请手动查看目标分和验证分差距。`
    };
    normalized[key].rewriteAttempted = true;
    return normalized[key].verification;
  }
}

function generatedCandidateEntries(normalized = {}, key) {
  const base = objectOnly(normalized[key]);
  const extraKey = key === "revisionPlus05" ? "revisionPlus05Candidates" : (key === "revisionPlus10" ? "revisionPlus10Candidates" : "");
  const extras = extraKey ? asArray(normalized[extraKey]) : [];
  const entries = [{ part: base, index: 0, strategy: base.rewriteStrategy || "initial generated version" }];
  extras.forEach((candidate, index) => {
    const part = objectOnly(candidate);
    if (String(part.essay || "").trim()) entries.push({ part, index: index + 1, strategy: part.strategy || "source-based candidate selected" });
  });
  const seen = new Set();
  return entries.filter((entry) => {
    const essay = String(entry.part.essay || "").trim();
    if (!essay || seen.has(essay)) return false;
    seen.add(essay);
    return true;
  });
}

async function verifyGeneratedPartWithCandidates(req, body, normalized, key) {
  const candidates = generatedCandidateEntries(normalized, key);
  if (!candidates.length) {
    const first = await scoreGeneratedEssay(req, body, normalized[key]?.essay, key, normalized[key]?.targetBand);
    return maybeRewriteGeneratedPart(req, body, normalized, key, first);
  }

  let closest = null;
  for (const entry of candidates) {
    normalized[key] = {
      ...objectOnly(normalized[key]),
      ...entry.part,
      targetBand: clampBand(entry.part.targetBand ?? normalized[key]?.targetBand),
      candidateIndex: entry.index,
      candidateCount: candidates.length,
      rewriteStrategy: entry.strategy
    };
    const verification = await scoreGeneratedEssay(req, body, normalized[key].essay, key, normalized[key].targetBand);
    normalized[key].verification = {
      ...verification,
      rewriteAttempted: false,
      rewriteAttemptCount: 0,
      exactTargetMet: verification.status === "target_met",
      candidateIndex: entry.index,
      candidateCount: candidates.length,
      rewriteStrategy: entry.strategy
    };
    const distance = generatedBandDistance(verification.verifiedBand, normalized[key].targetBand);
    if (Number.isFinite(distance) && (!closest || distance < closest.distance)) {
      closest = { part: { ...normalized[key] }, verification: { ...normalized[key].verification }, distance };
    }
    if (verification.status === "target_met") return normalized[key].verification;
  }

  if (closest) {
    normalized[key] = {
      ...objectOnly(normalized[key]),
      ...closest.part,
      closestVerifiedBand: closest.verification.verifiedBand,
      distanceFromTarget: Math.round(closest.distance * 2) / 2,
      rewriteStrategy: closest.verification.status === "target_exceeded" ? "soft downshift" : "floor raise"
    };
    return maybeRewriteGeneratedPart(req, body, normalized, key, {
      ...closest.verification,
      message: "Selected closest initial candidate before targeted rewrite."
    });
  }

  return normalized[key].verification;
}

async function verifyAndMaybeRewriteGeneratedAnswers(req, body, normalized) {
  const enabled = body.verifyGeneratedScores !== false;
  if (!enabled) {
    normalized.verification = { enabled: false, summary: "生成作文验证已关闭。" };
    return normalized;
  }

  const keys = ["modelAnswer", "revisionPlus05", "revisionPlus10"];
  const results = {};
  for (const key of keys) {
    results[key] = await verifyGeneratedPartWithCandidates(req, body, normalized, key);
  }

  const counts = keys.reduce((acc, key) => {
    const status = results[key]?.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  normalized.verification = {
    enabled: true,
    router: "grade-ielts-production-router",
    targetMet: counts.target_met || 0,
    nearTarget: counts.near_target || 0,
    belowTarget: counts.below_target || 0,
    verificationFailed: counts.verification_failed || 0,
    summary: `严格生产评分验证完成：达到目标 ${counts.target_met || 0} 项，未达到目标 ${counts.below_target || 0} 项，验证失败 ${counts.verification_failed || 0} 项。`,
    items: results
  };

  normalized.systemFeedback = {
    ...normalized.systemFeedback,
    status: "generated_and_verified_with_production_router",
    message: "作文生成完成，并已使用生产评分路由验证目标分。用户原分数没有改变。"
  };

  return normalized;
}



async function generateClientSideRewritePart(body) {
  const key = String(body.rewriteGeneratedPart || body.generatedPartKey || body.partKey || "").trim();
  if (!["modelAnswer", "revisionPlus05", "revisionPlus10"].includes(key)) {
    throw new Error("Unsupported rewriteGeneratedPart. Use modelAnswer, revisionPlus05, or revisionPlus10.");
  }

  const targetBand = clampBand(body.targetBand ?? body.generatedTargetBand ?? body.failedTargetBand);
  const verifiedBand = clampBand(body.failedVerifiedBand ?? body.verifiedBand ?? (body.verification && body.verification.verifiedBand));
  const failedEssay = String(body.failedGeneratedEssay || body.generatedEssay || body.previousGeneratedEssay || "").trim();
  if (!failedEssay) throw new Error("failedGeneratedEssay is required for generated-part rewrite.");

  const normalized = {
    modelAnswer: { targetBand: key === "modelAnswer" ? targetBand : null, essay: "" },
    revisionPlus05: { targetBand: key === "revisionPlus05" ? targetBand : null, essay: "" },
    revisionPlus10: { targetBand: key === "revisionPlus10" ? targetBand : null, essay: "" }
  };
  normalized[key] = { targetBand, essay: failedEssay };

  const incomingVerification = body.verification && typeof body.verification === "object" ? body.verification : {};
  const verification = {
    targetBand,
    verifiedBand,
    status: String(incomingVerification.status || verificationLabel(verifiedBand, targetBand)),
    criterionBands: body.criterionBands || incomingVerification.criterionBands || {}
  };

  const rawRewrite = await callDeepSeek(buildRewritePrompt(body, normalized, key, verification));
  mergeRewrittenPart(normalized, key, rawRewrite);
  normalized[key].targetBand = targetBand;

  return {
    ok: true,
    aiStage: "essay-generator-rewrite-generated-part",
    generatorVersion: GENERATOR_VERSION,
    disclaimer: DISCLAIMER,
    task: normalizeRequestedTask(body),
    taskLocked: true,
    generationOnly: true,
    scoreUnaffected: true,
    scoreChanged: false,
    rewriteGeneratedPart: key,
    targetBand,
    previousVerifiedBand: verifiedBand,
    rewriteAttemptCount: Number(body.rewriteAttemptCount || body.attemptNumber || 0),
    escalationMode: Boolean(Number(body.rewriteAttemptCount || body.attemptNumber || 0) >= 3 && key === "revisionPlus05" && verification.status === "below_target"),
    downshiftLockMode: Boolean(Number(body.rewriteAttemptCount || body.attemptNumber || 0) >= 2 && key === "revisionPlus05" && verification.status === "target_exceeded"),
    rewrittenPart: normalized[key],
    [key]: normalized[key],
    systemFeedback: {
      system: "essay-generation",
      status: "rewritten_generated_part_for_strict_target",
      scoreChanged: false,
      message: "已针对低于目标或高于目标窗口的生成作文单独重写；用户原分数没有改变。"
    }
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
    if (!String(body.prompt || body.questionPrompt || "").trim()) {
      return sendJson(req, res, 400, { ok: false, error: "Prompt is required for essay generation" });
    }
    if (body.mode === "rewrite_generated_part" || body.generationMode === "rewrite_generated_part" || body.rewriteGeneratedPart) {
      const rewritten = await generateClientSideRewritePart(body);
      return sendJson(req, res, 200, rewritten);
    }
    const raw = await callDeepSeek(buildGenerationPrompt(body));
    const normalized = normalizeGenerationResult(raw, body);
    const verified = await verifyAndMaybeRewriteGeneratedAnswers(req, body, normalized);
    return sendJson(req, res, 200, verified);
  } catch (error) {
    return sendJson(req, res, 500, { ok: false, error: "Essay generation failed", detail: String(error.message || error), system: "essay-generation" });
  }
};

module.exports.config = { maxDuration: 300 };
