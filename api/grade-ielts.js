const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DISCLAIMER = "This is an AI-generated estimated score, not an official IELTS score.";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const VALID_BANDS = [0, ...Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)];
const SCORE_SYSTEM_VERSION = "score-core-v8-3-4-ai-zero-rescue";

const TASK1_BAND_ANCHORS_0_TO_9 = [
  { band: 0, profile: "No assessable GT letter: blank, fully copied, non-English, or wholly unrelated to the task.", zh: "没有可评分书信：空白、完全照抄、非英文或完全跑题。" },
  { band: 1, profile: "Only isolated words or memorised fragments; the purpose of the letter is almost impossible to identify.", zh: "只有零散单词或背诵片段，几乎看不出写信目的。" },
  { band: 2, profile: "Very little relevant message; not recognisably a complete letter; bullet points are largely missing.", zh: "相关信息极少，不像完整书信，题目要点基本缺失。" },
  { band: 3, profile: "Weak or unclear purpose; only minimal bullet coverage; very short or confused message; frequent errors block clarity.", zh: "目的很弱或不清楚，只覆盖极少要点，内容短或混乱，错误严重影响理解。" },
  { band: 4, profile: "Basically related but covers only part of the bullet points; details are thin; tone and format are unstable; errors are frequent.", zh: "基本相关但只覆盖部分要点，细节少，语气和格式不稳定，错误频繁。" },
  { band: 5, profile: "Purpose is generally clear and most bullet points are addressed, but development is simple, tone may be uneven, and language is limited or error-prone.", zh: "写信目的基本清楚，大部分要点有回应，但展开简单，语气不够稳定，语言有限且错误较多。" },
  { band: 6, profile: "Clear purpose; all bullet points are covered with basic detail; tone is generally appropriate; organisation is clear; errors do not seriously reduce understanding.", zh: "目的清楚，三个要点都有基本细节，语气大体合适，结构清楚，错误不严重影响理解。" },
  { band: 7, profile: "All bullet points are developed well; tone/register is natural; information is logically organised; vocabulary and grammar are flexible with only some errors.", zh: "所有要点展开较充分，语气自然，信息组织清楚，词汇和语法较灵活，错误较少。" },
  { band: 8, profile: "Task requirements are fulfilled fully and naturally; tone, format, and information selection are very appropriate; language is flexible and accurate with rare minor slips.", zh: "任务要求完成充分自然，语气、格式和信息选择很合适，语言灵活准确，只有少量小错。" },
  { band: 9, profile: "A fully natural, mature, precise GT letter; all bullet points are completely and appropriately developed; register is exact and errors are negligible.", zh: "完全自然成熟精准的书信，所有要点充分且得体，语气精准，错误极少。" }
];

const TASK2_BAND_ANCHORS_0_TO_9 = [
  { band: 0, profile: "No assessable essay: blank, fully copied, non-English, or wholly unrelated to the prompt.", zh: "没有可评分作文：空白、完全照抄、非英文或完全跑题。" },
  { band: 1, profile: "Only isolated words or memorised fragments; almost no position, development, or organisation.", zh: "只有零散词语或背诵片段，几乎没有立场、展开或结构。" },
  { band: 2, profile: "A few relevant sentences may appear, but the response does not form a coherent answer to the task.", zh: "可能有少量相关句子，但不能形成完整任务回应。" },
  { band: 3, profile: "Very limited position and content; weak or confused organisation; frequent errors make meaning difficult.", zh: "观点和内容极少，结构弱或混乱，错误频繁导致理解困难。" },
  { band: 4, profile: "Basically related but response is very limited; ideas are simple and barely developed; organisation is weak and errors are frequent.", zh: "基本相关但回应很有限，观点简单且几乎没有展开，结构弱，错误频繁。" },
  { band: 5, profile: "Clear position and basic structure, but ideas are general, examples are brief, reasoning is shallow, and language is simple or error-prone.", zh: "有明确立场和基本结构，但观点笼统、例子短、论证浅，语言简单或错误较多。" },
  { band: 6, profile: "Clear response with basic but real development; examples or explanations are relevant; progression is generally clear; errors do not seriously reduce clarity.", zh: "回应清楚，有基本但真实的展开，例子或解释相关，结构基本清楚，错误不严重影响理解。" },
  { band: 7, profile: "Well-organised essay with clear position, developed ideas, logical progression, flexible vocabulary, varied grammar, and relatively few errors.", zh: "结构清楚，立场明确，观点发展充分，逻辑推进明显，词汇灵活，语法有变化，错误较少。" },
  { band: 8, profile: "Fully developed response with mature reasoning, natural cohesion, precise flexible vocabulary, strong grammatical control, and rare minor errors.", zh: "回应充分，论证成熟，衔接自然，词汇精准灵活，语法控制强，错误很少。" },
  { band: 9, profile: "A fully responsive, sophisticated essay with natural, fluent argumentation, precise language, and negligible errors.", zh: "完全回应题目，论证自然深入，语言精准流畅，错误极少。" }
];

const TASK1_GATE_RULES = [
  "Bullet Coverage Gate: identify each bullet as covered, partly_covered, or missing. Missing two bullets normally keeps Task Achievement at Band 4.0 or below; missing one bullet normally keeps it at Band 5.0 or below; three mentioned but thinly developed is usually 5.0-5.5; clear development of all bullets unlocks 6.0+.",
  "Purpose Clarity Gate: unclear purpose limits TA; clear but simple purpose supports 5.0-6.0; clear natural purpose supports 6.0+.",
  "Tone/Register Gate: formal, semi-formal, or informal tone must match the recipient and task. A clearly wrong tone limits TA and LR.",
  "Letter Completeness Gate: check greeting/opening purpose/body/closing/request or thanks/sign-off. If it does not read like a letter, TA and CC cannot be high.",
  "Task 1 Word Count Guard: below 80 words is usually severely limited; 80-120 often falls around 3.5-5.0 if bullets are thin; 120-150 is rateable but must be checked for missing detail; 150-190 is normal; 220+ is not penalised automatically but check repetition or irrelevance.",
  "High-band Unlock Gate: if all bullets are fully and naturally developed, tone is precise, organisation is natural, and language is accurate/flexible, actively consider 7.5/8.0/8.5/9.0 rather than capping at 7.0."
];

const TASK2_GATE_RULES = [
  "Task Response Depth Gate: check all prompt parts, clear position when required, relevant reasons, examples, explanation, and avoidance of generic unsupported claims.",
  "Band 6 Access Rule: Band 6 needs real development, not just a position plus paragraphs. The essay needs clear response, basic explanation, some specific support, clear progression, and errors that do not often block clarity.",
  "Low-band Guard: short or weak essays must not be lifted because they have paragraph labels. Under 100 words is often 0-3.5; 100-150 with minimal development often 3.5-4.5; 150-220 can enter 4.5-5.5 depending on development and language.",
  "Mid-band Check: visible structure, Firstly/Secondly/In conclusion, or a stated opinion is not by itself enough for 5.5/6.0+.",
  "High-band Unlock Gate: if the essay is fully responsive, mature, logically developed, cohesive, lexically precise, and grammatically controlled, actively consider 7.5/8.0/8.5/9.0 instead of defaulting to 7.0.",
  "Score-profile Check: challenge all-equal criterion bands and large gaps between task/organisation and LR/GRA; explain why each criterion is where it is."
];


const TASK1_BAND_BOUNDARY_PROTOCOL = [
  "Task 1 low-band 0-3: no assessable letter, extremely short message, unclear purpose, 0-1 bullet addressed, or errors blocking communication. Do not reward letter-looking layout if communicative purpose is missing.",
  "Task 1 Band 4: basically related but bullet coverage is incomplete or details are very thin; tone/register or letter completeness may be unstable; frequent errors reduce clarity.",
  "Task 1 Band 5/5.5: purpose is generally clear and most bullets are addressed, but one bullet may be thin, tone may be uneven, and language remains limited or error-prone.",
  "Task 1 Band 6/6.5: all bullets are covered with useful detail; purpose and tone are generally appropriate; organisation is clear; language errors do not seriously reduce understanding.",
  "Task 1 high-band 7-9: all bullets are developed naturally and proportionately; register is precise; the letter reads like a real response to the reader; vocabulary and grammar are flexible, accurate, and mostly error-free. Consider 7.5/8/8.5/9 when this evidence is present.",
  "Task 1 hard checks: if a bullet is missing, Task Achievement normally cannot exceed 5.0; if two bullets are missing, TA normally cannot exceed 4.0; if tone/register is clearly wrong, TA and LR must be reviewed."
];

const TASK2_BAND_BOUNDARY_PROTOCOL = [
  "Task 2 low-band 0-3: blank/irrelevant/non-English/very short, or only a few relevant sentences with no developed answer. Do not lift because of paragraph labels.",
  "Task 2 Band 4: related but very limited response; ideas are simple and barely developed; organisation is weak; language errors are frequent.",
  "Task 2 Band 5/5.5: clear position and basic structure, but ideas are general, examples are brief, reasoning is shallow, and LR/GRA are limited or error-prone. This is the normal range for complete but weak essays.",
  "Task 2 Band 6/6.5: clear response with real development, relevant explanations/examples, generally clear progression, and errors that do not often block clarity. Paragraphing alone is not Band 6 evidence.",
  "Task 2 high-band 7-9: developed or mature reasoning, natural cohesion, precise/flexible vocabulary, varied grammar, and few/rare errors. If the essay is fully responsive and controlled, consider 7.5/8/8.5/9 and do not default to 7.0.",
  "Task 2 hard checks: 80-119 words usually 3.0-4.0; 120-149 usually 3.5-4.5; 150-179 usually 4.0-5.0; 180-229 needs strong development to justify 5.5/6.0+. High spelling/grammar density must constrain LR/GRA."
];

function bandBoundaryProtocolForTask(task) {
  return (task === "Task 1" ? TASK1_BAND_BOUNDARY_PROTOCOL : TASK2_BAND_BOUNDARY_PROTOCOL).map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

const DETAILED_SCORING_STEPS = [
  { stage: "score-precheck", title: "本地文本信号检查", description: "统计词数、段落、句子、英文比例、拼写/语法风险和可评分性；本地不打分。" },
  { stage: "score-task-router", title: "Task 1 / Task 2 分流", description: "确定使用 GT Task 1 书信规则还是 Task 2 作文规则，并生成任务画像。" },
  { stage: "score-anchor", title: "AI 独立 0–9 锚点判断", description: "AI 单独判断最接近的 0–9 分锚点；这个结果会传入四项评分，不能由最终分数反推。" },
  { stage: "score-criteria", title: "AI 四项初评与半分判断", description: "AI 返回四项分、half-band 理由、原文证据、anchor comparison 和任务专属 gate。" },
  { stage: "score-boundary-audit", title: "本地 hard boundary audit", description: "本地强制检查低分边界、高分天花板、四项同分、anchor 冲突和 Band 6 准入风险。" },
  { stage: "score-boundary-review", title: "AI 二次边界复核", description: "如果本地 audit 触发风险，AI 必须二次复核并重新确认或修正四项分；无风险则跳过。" },
  { stage: "score-finalize", title: "最终验证并冻结分数", description: "验证结构完整后，机械平均 AI 返回的四项最终分并冻结；本地不直接改分。" }
];
const VISIBLE_SCORING_STEPS = [
  { stage: "local-precheck", title: "本地预检与任务分流", description: "检查词数、任务类型、可评分性、语言风险和 Task 1 / Task 2 评分边界。" },
  { stage: "score-kernel", title: "AI 核心评分", description: "AI 只返回 anchor、四项分和 reason codes，不生成中文、长解释、原文引用或详细反馈。" },
  { stage: "boundary-audit", title: "本地边界审计", description: "检查低分抬高、高分卡 7、弱语言高分、四项同分和 anchor 冲突。" },
  { stage: "boundary-review", title: "AI 边界复核", description: "只有审计触发时才二次复核；否则跳过。" },
  { stage: "final-freeze-feedback", title: "冻结分数与后置反馈", description: "先冻结最终分数，再生成详细反馈；反馈失败不影响分数。" }
];

function visibleStepMessage(stage, result = {}) {
  const signals = result.localSignals || {};
  const anchor = result.anchorComparison || {};
  const audit = result.boundaryAudit || {};
  const meta = result.scoreCoreMeta || {};
  if (stage === "local-precheck") {
    return `本地预检完成：${signals.wordCount ?? "-"} words，任务 ${signals.task || result.task || "-"}，可评分性 ${signals.rateabilityStatus || "-"}。`;
  }
  if (stage === "score-kernel") {
    return `AI 核心评分完成：anchor Band ${anchor.closestAnchorBand ?? result.scoreKernel?.anchorBand ?? "-"}，四项分已返回为短 JSON。`;
  }
  if (stage === "boundary-audit") {
    const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
    return audit.reviewRequired
      ? `本地边界审计触发 ${reasons.length || 1} 项复核：${reasons.slice(0, 3).join("；")}${reasons.length > 3 ? "..." : ""}`
      : "本地边界审计通过：没有发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  }
  if (stage === "boundary-review") {
    if (audit.boundaryReview?.triggered || meta.boundaryReviewApplied) {
      return `AI 边界复核完成：${audit.boundaryReview?.decision || "reviewed"}。`;
    }
    return "AI 边界复核跳过：本地边界审计未触发强制复核。";
  }
  if (stage === "final-freeze-feedback") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    const feedback = result.feedbackStatus?.status || "not_requested";
    return `最终分数已冻结：Overall Band ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}；详细反馈状态：${feedback}。`;
  }
  return "阶段状态已更新。";
}

function buildVisibleProgress(result = {}, status = "done") {
  return {
    version: SCORE_SYSTEM_VERSION,
    totalSteps: VISIBLE_SCORING_STEPS.length,
    currentStep: status === "done" ? VISIBLE_SCORING_STEPS.length : 2,
    currentStage: status === "done" ? "score-final-output" : "score-ai-anchor-review",
    status,
    updatedAt: new Date().toISOString(),
    steps: VISIBLE_SCORING_STEPS.map((step, index) => ({
      ...step,
      index: index + 1,
      status: status === "done" ? "done" : (index === 1 ? "running" : index === 0 ? "done" : "waiting"),
      message: status === "done" ? visibleStepMessage(step.stage, result) : step.description,
      detail: step.stage === "score-ai-anchor-review" ? { anchorComparison: result.anchorComparison || null, boundaryAudit: result.boundaryAudit || null } : null
    }))
  };
}


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
    body.scoringTask ||
    body.requestedTask ||
    body.selectedTask ||
    body.writingTask ||
    body.moduleTask ||
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
  body.scoringTask = lockedTask;
  body.requestedTask = lockedTask;
  body.selectedTask = lockedTask;
  body.essay = String(body.essay || "");
  body.questionPrompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  body.promptText = String(body.promptText || body.questionPrompt || body.prompt || "");
  body.wordCount = Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : countWords(body.essay);
  return body;
}

function resolveScoringSignals(body = {}, current = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const existing = current && typeof current === "object" ? current.localSignals : null;
  if (existing && typeof existing === "object" && existing.task === lockedTask) {
    return existing;
  }
  return localSignals({
    ...body,
    task: lockedTask,
    taskType: lockedTask === "Task 1" ? "task1" : "task2",
    scoringTask: lockedTask,
    requestedTask: lockedTask,
    selectedTask: lockedTask
  });
}

function taskValueFromCurrent(current = {}) {
  if (!current || typeof current !== "object") return "";
  return current.localSignals?.task || current.task || current.scoringTask || current.requestedTask || current.selectedTask || "";
}

function safeCurrentForTask(body = {}, current = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const currentTask = taskValueFromCurrent(current);
  if (currentTask && currentTask !== lockedTask) {
    return {
      staleCurrentResultRejected: true,
      staleCurrentResultRejectedReason: `Ignored stale currentResult for ${currentTask}; locked request task is ${lockedTask}.`
    };
  }
  return current && typeof current === "object" ? current : {};
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function countParagraphs(text) {
  return String(text || "").split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean).length;
}

function sentenceUnits(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return (cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
}

function distinctWordRatio(text) {
  const words = String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

function copiedPromptOverlapRatio(essay, prompt) {
  const stop = new Set(["the","a","an","to","of","and","or","in","on","for","with","is","are","was","were","be","been","being","you","your","write","letter","essay","some","people","this","that","it","as","at","by","from"]);
  const ew = new Set((String(essay || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((w) => !stop.has(w) && w.length > 2));
  const pw = new Set((String(prompt || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((w) => !stop.has(w) && w.length > 2));
  if (!ew.size) return 0;
  let shared = 0;
  ew.forEach((w) => { if (pw.has(w)) shared += 1; });
  return shared / ew.size;
}

function detectHardZeroResponse(body = {}, signals = null) {
  const essay = String(body.essay || "").trim();
  const prompt = String(body.questionPrompt || body.promptText || "");
  const task = normalizeRequestedTask(body);
  const words = signals?.wordCount ?? countWords(essay);
  const sentences = sentenceUnits(essay);
  const totalTokens = (essay.match(/\S+/g) || []).length;
  const englishTokens = (essay.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const englishRatio = totalTokens ? englishTokens / totalTokens : 0;
  const lowered = essay.toLowerCase();
  const noAnswerPattern = /\b(no answer|no letter|cannot write|can't write|i cannot write|i can not write|copied prompt only)\b/i.test(essay);
  const nonEnglishShort = Boolean(essay && englishTokens === 0 && words === 0);
  const finiteClause = /\b(i|we|they|he|she|it|people|children|students|parents|government|governments|company|manager|friend|council|residents|customers|someone|somebody|this|that)\s+(am|is|are|was|were|have|has|had|can|could|will|would|should|may|might|must|think|believe|want|need|buy|use|live|spend|write|ask|suggest|apologise|apologize|explain|prefer|choose|help|make|give|take|work|study|play|close|arrive|damage|move|meet)\b/i.test(lowered);
  const task1MicroAttempt = task === "Task 1" && words >= 4 && words <= 12 && /\b(dear|hi|hello|sorry|please|thank|thanks|refund|money\s+back|meet|watch|lamp|park|house|advice|move|city|product|bad|broken|send)\b/i.test(lowered);
  const task2HasOpinionSignal = /\b(i\s+think|i\s+agree|i\s+disagree|because|should|must|can|could|is|are)\b/i.test(lowered);
  const task2MicroAttempt = task === "Task 2" && words >= 4 && words <= 12 && task2HasOpinionSignal && /\b(good|bad|people|school|online|shopping|transport|pollution|living|alone|ageing|society|government|children)\b/i.test(lowered);
  const rateableMicroAttempt = task1MicroAttempt || task2MicroAttempt || finiteClause;
  const onlyKeywords = words > 0 && words <= 10 && distinctWordRatio(essay) <= 0.9 && !rateableMicroAttempt;
  const repeatedKeywordFragment = words > 0 && words <= 10 && !finiteClause && /([a-z]+(?:\s+[a-z]+)?)[.!?]?\s+\1/i.test(lowered);
  const ultraShortNoSentence = words > 0 && words <= 2 && sentences.length <= 1;
  const copiedLike = words <= 14 && copiedPromptOverlapRatio(essay, prompt) >= 0.75;
  const meaninglessFragments = words <= 10 && /^(?:[a-z]+[.!?]?\s*){1,10}$/i.test(essay.replace(/\s+/g, " ").trim()) && !rateableMicroAttempt;
  if (!essay) return { triggered: true, reason: "blank_response", task, words };
  if (noAnswerPattern) return { triggered: true, reason: "explicit_no_answer_or_copied_prompt_marker", task, words };
  if (nonEnglishShort || englishRatio < 0.2) return { triggered: true, reason: "non_english_or_no_assessable_english", task, words, englishRatio: Number(englishRatio.toFixed(2)) };
  if (copiedLike && !rateableMicroAttempt) return { triggered: true, reason: "copied_prompt_or_prompt_keyword_recycling", task, words, overlapRatio: Number(copiedPromptOverlapRatio(essay, prompt).toFixed(2)) };
  if ((ultraShortNoSentence || onlyKeywords || repeatedKeywordFragment || meaninglessFragments) && !rateableMicroAttempt) return { triggered: true, reason: "keyword_fragments_without_assessable_response", task, words };
  return { triggered: false, reason: rateableMicroAttempt && words <= 12 ? "minimal_but_rateable_micro_attempt" : "assessable_or_rateable", task, words, rateableMicroAttempt };
}

const STRICT_HARD_ZERO_REASONS = new Set([
  "blank_response",
  "non_english_or_no_assessable_english",
  "explicit_no_answer_or_copied_prompt_marker"
]);

function isStrictHardZeroGate(gate = {}) {
  return Boolean(gate?.triggered && STRICT_HARD_ZERO_REASONS.has(String(gate.reason || "")));
}

function downgradeSoftHardZeroGate(gate = {}) {
  if (!gate?.triggered || isStrictHardZeroGate(gate)) return gate;
  return {
    ...gate,
    triggered: false,
    originalTriggered: true,
    originalReason: gate.reason,
    reason: "soft_hard_zero_blocked_for_ai_scoring",
    note: "Soft local hard-zero signal was not allowed to assign Band 0. The response must go to AI scoring unless it is blank, non-English, or an explicit no-answer."
  };
}

function zeroBandCriterionNames(criteria = {}) {
  return Object.entries(criteria || {})
    .filter(([, band]) => Number(band) === 0)
    .map(([criterion]) => criterion);
}

function assertNoImpossibleZeroBand(criteria = {}, signals = {}) {
  const zeroCriteria = zeroBandCriterionNames(criteria);
  if (!zeroCriteria.length) return;
  if (isStrictHardZeroGate(signals.hardZeroGate)) return;
  const error = new Error(`AI returned Band 0 for a rateable/non-hard-zero response: ${zeroCriteria.join(", ")}. Retry scoring instead of freezing a false zero.`);
  error.status = 502;
  error.aiStage = "score-kernel";
  error.code = "IMPOSSIBLE_ZERO_BAND";
  error.zeroCriteria = zeroCriteria;
  throw error;
}

function makeCriteriaWithBand(task, band) {
  const out = {};
  criterionNames(task).forEach((name) => { out[name] = band; });
  return out;
}

function buildHardZeroScore(body = {}, signals = null, gate = null) {
  const local = signals || localSignals(body);
  const hardZero = gate || detectHardZeroResponse(body, local);
  const criteria = makeCriteriaWithBand(local.task, 0);
  const anchorComparison = normalizeAnchorComparison({
    anchorSystem: `${taskRuleLabel(local.task)} local hard-zero gate`,
    closestAnchorBand: 0,
    lowerAnchorBand: 0,
    higherAnchorBand: 1,
    candidateRange: "0",
    closestAnchorProfile: local.task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9[0].profile : TASK2_BAND_ANCHORS_0_TO_9[0].profile,
    closestAnchorProfileZh: local.task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9[0].zh : TASK2_BAND_ANCHORS_0_TO_9[0].zh,
    whyCloserToThisBand: `Hard-zero gate: ${hardZero.reason}.`,
    whyNotLowerAnchor: "Band 0 is the lowest possible IELTS band.",
    whyNotHigherAnchor: "There is no assessable response beyond blank/copied/non-English/keyword fragments."
  }, local.task, criteria, local);
  const boundaryAudit = {
    version: "strict-boundary-audit-v7-4-hard-zero",
    localScoringApplied: true,
    localParticipation: "Hard-zero only: the server assigns Band 0 only for blank, non-English, copied-prompt, no-answer, or keyword-fragment responses before AI scoring.",
    status: "passed",
    reviewRequired: false,
    reviewReasons: [],
    wordCountBoundary: getWordCountBoundaryProfile(local.task, local.wordCount),
    lowBandBoundary: { status: "hard_zero", suggestedRange: "Band 0", scoreTooHigh: false, reason: hardZero.reason },
    highBandBoundary: { status: "not_applicable", allFourSeven: false, highCandidate: false, reason: "Hard-zero response." },
    anchorAudit: { status: "passed", anchorMissing: false, anchorConflict: false, closestAnchorBand: 0, finalBand: 0 },
    scoreProfileAudit: { status: "passed", allCriteriaSame: true, warnings: [] },
    hardZeroGate: hardZero,
    rawAverage: 0,
    finalBand: 0
  };
  const result = {
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: local.task,
    criteria,
    finalCriteria: criteria,
    rawAverage: 0,
    overallBand: 0,
    localSignals: { ...local, hardZeroGate: hardZero, rateabilityStatus: "not_rateable_or_severely_limited" },
    taskProfile: buildTaskProfile(body, local),
    anchorComparison,
    criterionCalibration: compactCriterionCalibration({ reasonCodes: {} }, criteria, local.task),
    scoreProfile: {},
    taskSpecificGate: normalizeTaskSpecificGate({}, local, criteria, anchorComparison, {}),
    boundaryAudit,
    stabilityWarnings: [],
    scoreCalculation: {
      mode: local.task === "Task 1" ? "task1_gt_letter_hard_zero_v7_4" : "task2_essay_hard_zero_v7_4",
      formula: "Hard-zero gate before AI scoring for blank, copied, non-English, no-answer or keyword-fragment responses.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage: 0,
      finalBand: 0,
      localScoreChanged: true,
      localScoreChangeExplanation: `Hard-zero gate triggered: ${hardZero.reason}.`
    },
    scoreCoreMeta: { scoreFirst: true, scoreFrozen: true, hardZeroGate: true, feedbackAfterFreeze: false, generatedAt: new Date().toISOString(), stage: "hard-zero" },
    feedbackStatus: { status: "skipped_hard_zero", scoreChanged: false, note: "No detailed AI feedback generated for a non-assessable hard-zero response." },
    localScoreChanged: true
  };
  return attachSinglePassProgress(result, "done");
}


function cleanRequirement(value) {
  return String(value || "")
    .replace(/^[-*•·]\s+/, "")
    .replace(/^(\d+)[.)]\s+/, "")
    .replace(/^and\s+/i, "")
    .replace(/[.;:,\s]+$/g, "")
    .trim();
}

function extractTask1Bullets(promptText) {
  const source = String(promptText || "");
  const lines = source.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const direct = lines.filter((line) => /^[-*•·]\s+/.test(line) || /^(\d+)[.)]\s+/.test(line)).map(cleanRequirement).filter(Boolean);
  if (direct.length) return direct.slice(0, 5);
  const after = source.split(/In your letter[:,]?/i)[1] || source.split(/You should/i)[1] || source;
  const candidates = after.split(/\r?\n|;/).map(cleanRequirement).filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|apologize|thank|invite|offer|request|remind|include|state|mention|why|what|how)/i.test(part));
  return candidates.slice(0, 5);
}

function inferTask2Profile(promptText) {
  const prompt = String(promptText || "");
  const requiredParts = [];
  const add = (item) => { if (item && !requiredParts.includes(item)) requiredParts.push(item); };
  const asksOpinion = /\b(your opinion|what is your opinion|give your opinion|to what extent do you agree|agree or disagree|do you agree|disagree)\b/i.test(prompt);
  const asksBothViews = /\b(discuss both views|discuss both these views|both views)\b/i.test(prompt);
  const asksAdvantage = /\b(advantage|advantages|benefit|benefits)\b/i.test(prompt);
  const asksDisadvantage = /\b(disadvantage|disadvantages|drawback|drawbacks)\b/i.test(prompt);
  const asksOutweigh = /\boutweigh\b/i.test(prompt);
  const asksCause = /\b(cause|causes|reason|reasons|why)\b/i.test(prompt);
  const asksProblem = /\b(problem|problems|issue|issues)\b/i.test(prompt);
  const asksSolution = /\b(solution|solutions|solve|measures|what can be done|how can this be)\b/i.test(prompt);
  const asksPositiveNegative = /\b(positive or negative|positive development|negative development|good thing or bad thing|is this a positive|is this a negative)\b/i.test(prompt);
  let questionType = "general_essay";
  if (asksBothViews) {
    questionType = "discuss_both_views_with_opinion";
    add("discuss view 1"); add("discuss view 2"); if (asksOpinion) add("give your own opinion");
  } else if (asksOutweigh || (asksAdvantage && asksDisadvantage)) {
    questionType = asksOutweigh ? "advantages_disadvantages_outweigh" : "advantages_and_disadvantages";
    if (asksAdvantage) add("advantages"); if (asksDisadvantage) add("disadvantages"); if (asksOutweigh) add("state whether advantages outweigh disadvantages");
  } else if (asksCause && asksSolution) {
    questionType = "causes_and_solutions"; add("causes or reasons"); add("solutions or measures");
  } else if (asksProblem && asksSolution) {
    questionType = "problems_and_solutions"; add("problems"); add("solutions");
  } else if (asksPositiveNegative) {
    questionType = "positive_negative_development"; add("state whether it is mainly positive or negative"); add("support the judgement with reasons");
  } else if (asksOpinion) {
    questionType = "opinion_agree_disagree"; add("clear position"); add("reasons supporting the position");
  }
  const questions = (prompt.match(/[^?]+\?/g) || []).map((x) => x.trim()).filter(Boolean);
  if (questions.length >= 2) questions.forEach((q, index) => add(`answer question ${index + 1}: ${q}`));
  if (!requiredParts.length) add("answer all parts of the prompt");
  return { questionType, requiredParts, positionRequired: asksOpinion || asksOutweigh || asksPositiveNegative, bothSidesRequired: asksBothViews, causeRequired: asksCause, problemRequired: asksProblem, solutionRequired: asksSolution, advantageRequired: asksAdvantage, disadvantageRequired: asksDisadvantage, outweighRequired: asksOutweigh, positiveNegativeRequired: asksPositiveNegative };
}

function compactLowerText(text = "") {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function firstMatchingSentence(text = "", regex = null) {
  const sentences = sentenceUnits(text);
  const found = sentences.find((sentence) => regex ? regex.test(sentence) : sentence.trim());
  if (!found) return "";
  return found.length > 180 ? `${found.slice(0, 177)}...` : found;
}

function contentWords(text = "") {
  const stop = new Set(["the","a","an","to","of","and","or","in","on","for","with","is","are","was","were","be","been","being","you","your","i","we","they","he","she","it","this","that","these","those","my","our","their","me","him","her","them","do","does","did","can","could","would","should","will","may","might","must","have","has","had","want","like","say","tell","write","letter"]);
  return (String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((word) => word.length > 2 && !stop.has(word));
}

function overlapCount(requirement = "", essay = "") {
  const words = new Set(contentWords(requirement));
  const essayWords = new Set(contentWords(essay));
  let count = 0;
  words.forEach((word) => { if (essayWords.has(word)) count += 1; });
  return count;
}

function hasDesiredWorkSchedule(text = "") {
  const source = compactLowerText(text);
  return /\b(i|we)\s+(would\s+like|want|hope|prefer|can|could|am\s+able|will\s+be\s+able)\s+[^.!?]{0,80}\b(work|working|shift|hours)\b[^.!?]{0,80}\b(morning|afternoon|evening|day\s+shift|weekends?|weekdays?|before\s+\d{1,2}|after\s+\d{1,2}|from\s+\d{1,2}|\d{1,2}\s*(?:am|pm))/i.test(source)
    || /\b(work|working)\s+(?:from\s+\d{1,2}\s*(?:am|pm)?\s+to\s+\d{1,2}\s*(?:am|pm)?|before\s+\d{1,2}\s*(?:am|pm)?|after\s+\d{1,2}\s*(?:am|pm)?|in\s+the\s+morning|during\s+the\s+day|on\s+weekends?|on\s+weekdays?)\b/i.test(source)
    || /\b(morning|afternoon|evening|day)\s+shift\b/i.test(source);
}

function hasPartialWorkSchedule(text = "") {
  const source = compactLowerText(text);
  return hasSpecificWorkHoursOrShift(source) || /\b(change|reduce|cut|avoid|stop)\s+[^.!?]{0,40}\b(night\s+shift|evening\s+shift|working\s+hours|hours)\b/i.test(source) || /\bclass\s+(?:at|from)\s+\d{1,2}\s*(?:am|pm)?\b/i.test(source);
}

function classifyTask1Requirement(requirement = "", essay = "") {
  const req = compactLowerText(requirement);
  const source = compactLowerText(essay);
  const overlap = overlapCount(req, source);
  const evidenceFrom = (regex) => firstMatchingSentence(essay, regex) || "No clear direct evidence found.";
  let status = "missing";
  let issue = "This bullet point is not clearly answered.";
  let evidence = "No clear direct evidence found.";

  if (/\b((which|what)\s+hours|which\s+hours|what\s+hours|say\s+which\s+hours|hours\s+you\s+would\s+like\s+to\s+work|work\s+schedule|preferred\s+hours|preferred\s+shift)\b/i.test(req)) {
    if (hasDesiredWorkSchedule(source)) {
      status = "covered";
      issue = "A preferred working time, shift, or schedule is stated clearly enough.";
      evidence = evidenceFrom(/\b(work|working|shift|hours|morning|afternoon|evening|weekend|weekday|before|after|from|to)\b/i);
    } else if (hasPartialWorkSchedule(source)) {
      status = "partly_covered";
      issue = "The answer mentions class time or a shift problem, but it does not clearly state the exact hours or schedule the candidate wants to work.";
      evidence = evidenceFrom(/\b(class|shift|hours|work|working|morning|night|evening|6\s*pm|9\s*pm)\b/i);
    }
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(why|reason|explain why|want to|would like to|reduce)\b/i.test(req)) {
    const hasReason = /\b(because|as|since|so that|in order to|due to|reason|study|course|class|campus|college|family|health|exam|part[- ]time)\b/i.test(source);
    if (hasReason && overlap >= 1) { status = "covered"; issue = "A relevant reason is given."; }
    else if (hasReason || overlap >= 2) { status = "partly_covered"; issue = "A reason is visible, but it is not developed or clearly connected to the bullet point."; }
    evidence = evidenceFrom(/\b(because|as|since|so that|in order to|study|course|class|campus|college|family|health|exam|part[- ]time)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(benefit|benefits|employer|company|boss|manager|workplace|restaurant|business|customer)\b/i.test(req)) {
    const hasBenefit = /\b(benefit|help|improve|increase|bring|useful|skill|skills|knowledge|menu|dish|dishes|customer|customers|restaurant|business|performance|profit|service|quality)\b/i.test(source);
    if (hasBenefit && overlap >= 1) { status = "covered"; issue = "A relevant benefit to the employer is stated."; }
    else if (hasBenefit) { status = "partly_covered"; issue = "The employer benefit is mentioned, but it is thin or not clearly explained."; }
    evidence = evidenceFrom(/\b(benefit|help|improve|bring|skill|menu|dish|customer|restaurant|business|performance|service)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(apologise|apologize|sorry|apology)\b/i.test(req)) {
    const ok = /\b(sorry|apologise|apologize|apology|regret)\b/i.test(source);
    status = ok ? "covered" : "missing";
    issue = ok ? "An apology is clearly included." : "The required apology is missing.";
    evidence = evidenceFrom(/\b(sorry|apologise|apologize|apology|regret)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: ok ? null : 5.0 };
  }

  if (/\b(complain|complaint|problem|issue|broken|damage|wrong|refund|replace|repair)\b/i.test(req)) {
    const ok = /\b(problem|issue|broken|damage|damaged|wrong|refund|replace|repair|complain|complaint|not\s+work|poor|late|delay)\b/i.test(source);
    status = ok ? "covered" : (overlap >= 2 ? "partly_covered" : "missing");
    issue = ok ? "The problem or complaint is described." : "The complaint/problem is not clearly described.";
    evidence = evidenceFrom(/\b(problem|issue|broken|damage|wrong|refund|replace|repair|complain|poor|late|delay)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(ask|request|could|would|please|arrange|suggest|recommend|invite|thank|describe|explain|tell|give|state|mention)\b/i.test(req)) {
    const actionWords = /\b(please|could|would|ask|request|hope|suggest|recommend|invite|thank|thanks|grateful|describe|explain|tell|give|state|mention|arrange|meet)\b/i.test(source);
    if (actionWords && overlap >= 2) { status = "covered"; issue = "The requested communicative function is present."; }
    else if (actionWords || overlap >= 2) { status = "partly_covered"; issue = "The required function is visible but not sufficiently clear or developed."; }
    evidence = evidenceFrom(/\b(please|could|would|ask|request|hope|suggest|recommend|invite|thank|describe|explain|tell|give|state|mention|arrange|meet)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (overlap >= 3) { status = "covered"; issue = "This bullet is answered with relevant content."; evidence = firstMatchingSentence(essay, null); }
  else if (overlap >= 1) { status = "partly_covered"; issue = "This bullet is only partly addressed; the link to the requirement is weak or thin."; evidence = firstMatchingSentence(essay, null); }
  return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
}

function auditTask1Requirements(body = {}, signals = {}) {
  const essay = String(body.essay || "");
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  const bullets = Array.isArray(signals.task1BulletPoints) && signals.task1BulletPoints.length ? signals.task1BulletPoints : extractTask1Bullets(prompt);
  const items = bullets.map((requirement, index) => ({ index: index + 1, ...classifyTask1Requirement(requirement, essay) }));
  const missingCount = items.filter((item) => item.status === "missing").length;
  const partlyCount = items.filter((item) => item.status === "partly_covered").length;
  let taskAchievementCap = null;
  if (missingCount >= 2) taskAchievementCap = 4.0;
  else if (missingCount === 1) taskAchievementCap = 5.0;
  else if (partlyCount >= 1) taskAchievementCap = 5.5;
  else if (items.length >= 3 && items.every((item) => item.status === "covered") && Number(signals.wordCount) < 120) taskAchievementCap = 6.0;
  return {
    version: "task1-requirement-audit-v8-1",
    task: "Task 1",
    extractedRequirements: bullets,
    items,
    missingCount,
    partlyCount,
    taskAchievementCap,
    triggered: Number.isFinite(taskAchievementCap),
    summary: Number.isFinite(taskAchievementCap)
      ? `Task 1 requirement audit capped Task Achievement at Band ${taskAchievementCap.toFixed(1)} because ${missingCount} bullet(s) are missing and ${partlyCount} bullet(s) are only partly covered.`
      : "All extracted Task 1 bullet requirements appear covered by local requirement audit."
  };
}

function detectTask2RequirementSignals(essay = "") {
  const source = compactLowerText(essay);
  return {
    clearOpinion: /\b(i\s+(strongly\s+)?(agree|disagree|believe|think)|in\s+my\s+opinion|from\s+my\s+perspective|my\s+view\s+is|i\s+would\s+argue|this\s+is\s+(?:a\s+)?(positive|negative)|i\s+support|i\s+oppose)\b/i.test(source),
    viewOne: /\b(some\s+people|one\s+view|on\s+the\s+one\s+hand|supporters|those\s+who\s+support|people\s+who\s+believe|one\s+argument)\b/i.test(source),
    viewTwo: /\b(other\s+people|others|another\s+view|on\s+the\s+other\s+hand|opponents|however|whereas|while\s+others|critics)\b/i.test(source),
    advantage: /\b(advantage|benefit|beneficial|positive|good\s+point|improve|save|helpful|useful|opportunity|convenient)\b/i.test(source),
    disadvantage: /\b(disadvantage|drawback|negative|problem|harmful|risk|cost|waste|damage|pressure|difficult|bad\s+point)\b/i.test(source),
    cause: /\b(cause|reason|because|due\s+to|as\s+a\s+result\s+of|result\s+from|lead\s+to|is\s+caused\s+by)\b/i.test(source),
    problem: /\b(problem|issue|challenge|difficulty|risk|concern|negative\s+effect|harmful\s+effect)\b/i.test(source),
    solution: /\b(solution|solve|measure|should|need\s+to|must|can\s+be\s+done|government\s+should|people\s+should|schools\s+should|companies\s+should)\b/i.test(source),
    positiveNegativeJudgement: /\b(positive|negative|beneficial|harmful|good\s+development|bad\s+development|overall\s+it\s+is|mainly\s+positive|mainly\s+negative)\b/i.test(source),
    outweighJudgement: /\b(outweigh|more\s+important\s+than|greater\s+than|more\s+benefits?|more\s+drawbacks?|advantages\s+are\s+greater|disadvantages\s+are\s+greater)\b/i.test(source),
    exampleSupport: /\b(for\s+example|for\s+instance|such\s+as|a\s+good\s+example|to\s+illustrate)\b/i.test(source),
    explanationMarkers: countPattern(source, /\b(because|therefore|as\s+a\s+result|this\s+means|this\s+can|this\s+will|so\s+that|which\s+means|for\s+this\s+reason)\b/gi)
  };
}

function auditTask2Requirements(body = {}, signals = {}) {
  const essay = String(body.essay || "");
  const profile = signals.task2QuestionProfile || inferTask2Profile(body.questionPrompt || body.promptText || body.prompt || "");
  const markers = detectTask2RequirementSignals(essay);
  const items = [];
  const addItem = (requirement, status, evidence, issue, capIfProblem = 5.5) => {
    items.push({ index: items.length + 1, requirement, status, evidence: evidence || "No clear direct evidence found.", issue, capIfProblem: status === "covered" ? null : capIfProblem });
  };
  const evidence = (regex) => firstMatchingSentence(essay, regex) || "No clear direct evidence found.";

  if (profile.bothSidesRequired) {
    addItem("discuss both views", markers.viewOne && markers.viewTwo ? "covered" : (markers.viewOne || markers.viewTwo ? "partly_covered" : "missing"), evidence(/\b(some people|other people|others|on the one hand|on the other hand|however|whereas|while)\b/i), "Discuss-both-views essays must clearly cover both sides, not only one side.", 5.0);
  }
  if (profile.positionRequired) {
    addItem("state a clear position or judgement", markers.clearOpinion || markers.outweighJudgement || markers.positiveNegativeJudgement ? "covered" : "missing", evidence(/\b(i agree|i disagree|i believe|i think|in my opinion|positive|negative|outweigh|overall)\b/i), "This question type requires a clear position or judgement.", 5.5);
  }
  if (profile.advantageRequired) {
    addItem("cover advantages/benefits", markers.advantage ? "covered" : "missing", evidence(/\b(advantage|benefit|positive|improve|save|helpful|opportunity|convenient)\b/i), "The advantages/benefits side is required by this prompt.", 5.0);
  }
  if (profile.disadvantageRequired) {
    addItem("cover disadvantages/drawbacks", markers.disadvantage ? "covered" : "missing", evidence(/\b(disadvantage|drawback|negative|problem|harmful|risk|cost|waste|damage)\b/i), "The disadvantages/drawbacks side is required by this prompt.", 5.0);
  }
  if (profile.outweighRequired) {
    addItem("state whether one side outweighs the other", markers.outweighJudgement ? "covered" : "missing", evidence(/\b(outweigh|more important|greater|more benefits|more drawbacks|advantages are greater|disadvantages are greater)\b/i), "Outweigh questions require a comparative judgement, not only a list of pros and cons.", 5.5);
  }
  if (profile.causeRequired) {
    addItem("explain causes/reasons", markers.cause ? "covered" : "missing", evidence(/\b(cause|reason|because|due to|result from|lead to)\b/i), "Cause/reason discussion is required by this prompt.", 5.0);
  }
  if (profile.problemRequired) {
    addItem("explain problems/issues", markers.problem ? "covered" : "missing", evidence(/\b(problem|issue|challenge|difficulty|risk|concern)\b/i), "Problem/issue discussion is required by this prompt.", 5.0);
  }
  if (profile.solutionRequired) {
    addItem("suggest solutions/measures", markers.solution ? "covered" : "missing", evidence(/\b(solution|solve|measure|should|need to|must|government should|people should|companies should)\b/i), "Solutions/measures are required by this prompt.", 5.0);
  }
  if (profile.positiveNegativeRequired) {
    addItem("judge whether the development is positive or negative", markers.positiveNegativeJudgement ? "covered" : "missing", evidence(/\b(positive|negative|beneficial|harmful|good development|bad development|mainly positive|mainly negative)\b/i), "Positive/negative development questions require a clear judgement.", 5.5);
  }

  const questions = (String(body.questionPrompt || body.promptText || body.prompt || "").match(/[^?]+\?/g) || []).map((x) => x.trim()).filter(Boolean);
  if (questions.length >= 2) {
    const paraCount = Number(signals.paragraphCount) || countParagraphs(essay);
    const enoughSeparateTreatment = paraCount >= Math.min(questions.length + 1, 4) || markers.explanationMarkers >= questions.length;
    addItem("answer all direct question parts", enoughSeparateTreatment ? "covered" : "partly_covered", evidence(/\b(because|therefore|for example|firstly|secondly|in conclusion)\b/i), "Two-part questions must answer each direct question, not just the general topic.", 5.5);
  }

  const words = Number(signals.wordCount) || countWords(essay);
  const sentenceCount = Number(signals.sentenceCount) || sentenceUnits(essay).length;
  const paragraphCount = Number(signals.paragraphCount) || countParagraphs(essay);
  const realDevelopment = words >= 230 && paragraphCount >= 3 && sentenceCount >= 8 && (markers.exampleSupport || markers.explanationMarkers >= 3);
  if (!realDevelopment) {
    addItem("develop ideas with explanation and support", sentenceCount >= 6 && markers.explanationMarkers >= 2 ? "partly_covered" : "missing", evidence(/\b(for example|such as|because|therefore|this means|as a result)\b/i), "Band 6+ Task Response needs real development, not only a position plus paragraph labels.", words < 180 ? 5.0 : 5.5);
  }

  const missingCount = items.filter((item) => item.status === "missing").length;
  const partlyCount = items.filter((item) => item.status === "partly_covered").length;
  const severeMissing = items.filter((item) => item.status === "missing" && item.capIfProblem <= 5.0).length;
  let taskResponseCap = null;
  if (severeMissing >= 1) taskResponseCap = 5.0;
  else if (missingCount >= 1 || partlyCount >= 2) taskResponseCap = 5.5;
  else if (partlyCount === 1) taskResponseCap = 6.0;
  return {
    version: "task2-question-type-audit-v8-1",
    task: "Task 2",
    questionType: profile.questionType,
    requiredParts: profile.requiredParts || [],
    markers,
    items,
    missingCount,
    partlyCount,
    taskResponseCap,
    triggered: Number.isFinite(taskResponseCap),
    summary: Number.isFinite(taskResponseCap)
      ? `Task 2 question-type audit capped Task Response at Band ${taskResponseCap.toFixed(1)} because ${missingCount} required part(s) are missing and ${partlyCount} are only partly covered.`
      : "All detected Task 2 question-type requirements appear covered by local audit."
  };
}

function buildTaskRequirementAudit(body = {}, signals = {}) {
  return signals.task === "Task 1" ? auditTask1Requirements(body, signals) : auditTask2Requirements(body, signals);
}

function countPattern(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function localSignals(body) {
  const essay = String(body.essay || "");
  const task = normalizeRequestedTask(body);
  const words = Number(body.wordCount) || countWords(essay);
  const paragraphs = countParagraphs(essay);
  const sentences = sentenceUnits(essay);
  const totalTokens = (essay.match(/\S+/g) || []).length;
  const englishTokens = (essay.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const englishRatio = totalTokens ? englishTokens / totalTokens : 0;

  const spellingList = ["nowdays", "nowdays", "posiible", "improtant", "furture", "proformence", "deepends", "themslves", "caryfully", "recieve", "recived", "becuase", "becasue", "wich", "enviroment", "goverment", "seperate", "definately", "untill", "frist", "seondly", "wirting", "perpare", "complet", "homewrok", "crouse", "resterants", "restraunts", "resturant", "meun", "performence", "perfomance", "costumer", "costumers", "oppertunity", "responsiblity", "convinient", "developement", "benifit", "benifits", "neccessary", "sucess", "sucessful"];
  const spellingHits = spellingList.map((word) => ({ item: word, count: countPattern(essay, new RegExp(`\\b${word}\\b`, "gi")) })).filter((x) => x.count);
  const spellingIssueCount = spellingHits.reduce((sum, x) => sum + x.count, 0);

  const grammarPatterns = [
    { label: "verb form after subordinator", regex: /\b(when|if|because|although)\s+[a-z]+\s+(using|doing|having|going|looking|paying)\b/gi },
    { label: "incorrect infinitive pattern", regex: /\bneed\s+to\s+[a-z]+ing\b/gi },
    { label: "missing subject after clause", regex: /\bif\s+[^.!?]{0,80},\s*(may|can|will|should|would)\b/gi },
    { label: "comparative error", regex: /\bmuch\s+comfortable\b/gi },
    { label: "missing be / comparison control", regex: /\b\w+\s+never\s+(important|better|worse|good|bad)\s+than\b/gi },
    { label: "gerund/parallel pattern", regex: /\busing\s+[^.!?]{0,60}\s+or\s+pay\s+for\b/gi },
    { label: "article/plural/control phrase", regex: /\b(some of beauty products|using beauty product|facing customer|at working days|at now)\b/gi },
    { label: "awkward request structure", regex: /\b(to want to ask you for if|ask you for if|wish you can|waiting for you feedback)\b/gi },
    { label: "missing infinitive after tell/ask", regex: /\b(told me attend|tell me attend|ask me attend|told me go|tell me go)\b/gi },
    { label: "incorrect preposition/control", regex: /\b(attend to class|at morning|at night shift|benefit for our|bring some benefit for|benefit for my employer)\b/gi },
    { label: "sentence boundary / run-on signal", regex: /\b(it can'?t affect my work at morning|after i finish[^.!?]{0,100}and also|after that,?\s+it[^.!?]{0,80}i can)\b/gi }
  ];
  const grammarHits = grammarPatterns.map((item) => ({ label: item.label, count: countPattern(essay, item.regex) })).filter((x) => x.count);
  const grammarIssueCount = grammarHits.reduce((sum, x) => sum + x.count, 0);
  const weakPhraseHits = [
    { label: "vague good/bad phrasing", regex: /\b(good thing|bad thing)\b/gi },
    { label: "awkward collocation", regex: /\b(pay treatments|using products or pay treatments|have they own judgement)\b/gi },
    { label: "unnatural time/place phrase", regex: /\b(at now|at working days|looking younger at future|look beautiful at now)\b/gi }
  ].map((item) => ({ label: item.label, count: countPattern(essay, item.regex) })).filter((x) => x.count);
  const weakPhraseCount = weakPhraseHits.reduce((sum, x) => sum + x.count, 0);
  const per100 = words ? 100 / words : 0;
  const spellingDensity = words ? Number((spellingIssueCount * per100).toFixed(2)) : 0;
  const grammarDensity = words ? Number((grammarIssueCount * per100).toFixed(2)) : 0;
  const spellingErrorDensity = spellingIssueCount >= 6 || spellingDensity >= 2.2 ? "high" : spellingIssueCount >= 3 ? "moderate" : spellingIssueCount > 0 ? "low" : "none";
  const grammarErrorDensity = grammarIssueCount >= 5 || grammarDensity >= 1.7 ? "high" : grammarIssueCount >= 2 ? "moderate" : grammarIssueCount > 0 ? "low" : "none";
  const lexicalNaturalnessRisk = weakPhraseCount >= 3 ? "high" : weakPhraseCount >= 1 ? "moderate" : "low";
  const sentenceControl = grammarErrorDensity === "high" ? "weak" : grammarErrorDensity === "moderate" ? "basic" : "adequate_or_better";
  const lexicalControl = spellingErrorDensity === "high" || lexicalNaturalnessRisk === "high" ? "weak" : spellingErrorDensity === "moderate" || lexicalNaturalnessRisk === "moderate" ? "basic" : "adequate_or_better";

  const rawHardZeroGate = detectHardZeroResponse(body, { task, wordCount: words });
  const hardZeroGate = downgradeSoftHardZeroGate(rawHardZeroGate);
  let rateabilityStatus = "weak_but_rateable";
  if (isStrictHardZeroGate(hardZeroGate) || !essay.trim() || (task === "Task 1" ? words < 50 : words < 80) || englishRatio < 0.35 || sentences.length === 0) rateabilityStatus = "not_rateable_or_severely_limited";
  else if (words >= (task === "Task 1" ? 120 : 180) && paragraphs >= 2 && sentences.length >= 5) rateabilityStatus = "clearly_rateable";

  const task1BulletPoints = task === "Task 1" ? extractTask1Bullets(body.questionPrompt || body.promptText || "") : [];
  const task2QuestionProfile = task === "Task 2" ? inferTask2Profile(body.questionPrompt || body.promptText || "") : null;
  const baseSignals = {
    task, wordCount: words, paragraphCount: paragraphs, sentenceCount: sentences.length, englishRatio: Number(englishRatio.toFixed(2)), rateabilityStatus, hardZeroGate,
    recommendedMinimum: task === "Task 1" ? 150 : 250,
    spellingIssueCount, spellingDensityPer100Words: spellingDensity, spellingErrorDensity, spellingExamples: spellingHits.slice(0, 10),
    grammarIssueSignalCount: grammarIssueCount, grammarDensityPer100Words: grammarDensity, grammarErrorDensity, grammarIssueSignals: grammarHits.slice(0, 10),
    weakPhraseCount, lexicalNaturalnessRisk, weakPhraseSignals: weakPhraseHits.slice(0, 10), sentenceControl, lexicalControl,
    task1BulletPoints,
    task2QuestionProfile
  };
  return { ...baseSignals, taskRequirementAudit: buildTaskRequirementAudit(body, baseSignals) };
}

function criterionNames(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function bandNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 2) / 2;
  if (rounded < 0 || rounded > 9) return null;
  return rounded;
}

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

function averageBand(criteria) {
  const values = Object.values(criteria || {}).map(bandNumber).filter((n) => Number.isFinite(n));
  if (values.length !== 4) return { rawAverage: null, finalBand: null };
  const rawAverage = values.reduce((a, b) => a + b, 0) / 4;
  return { rawAverage, finalBand: roundHalf(rawAverage) };
}

function capCriteriaBands(criteria = {}, cap = 9) {
  const capped = {};
  Object.entries(criteria || {}).forEach(([key, value]) => {
    const band = bandNumber(value);
    capped[key] = Number.isFinite(band) ? Math.min(band, cap) : value;
  });
  return capped;
}
function floorCriteriaBands(criteria = {}, floor = 0) {
  const raised = {};
  Object.entries(criteria || {}).forEach(([key, value]) => {
    const band = bandNumber(value);
    raised[key] = Number.isFinite(band) ? Math.max(band, floor) : value;
  });
  return raised;
}

function highBandFloorProfile(criteria = {}, signals = {}, anchorComparison = {}) {
  const task = signals.task;
  const words = Number(signals.wordCount) || 0;
  const { finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand) || finalBand < 7) return null;
  const enoughLength = task === "Task 1" ? words >= 150 : words >= 250;
  const enoughStructure = task === "Task 1" ? (Number(signals.sentenceCount) || 0) >= 4 : (Number(signals.paragraphCount) || 0) >= 4 && (Number(signals.sentenceCount) || 0) >= 9;
  const cleanLanguage = (Number(signals.spellingIssueCount) || 0) === 0 && (Number(signals.grammarIssueSignalCount) || 0) === 0 && signals.lexicalNaturalnessRisk !== "high" && signals.lexicalControl !== "weak" && signals.sentenceControl !== "weak";
  const closestAnchor = Number(anchorComparison.closestAnchorBand);
  const candidateRangeText = String(anchorComparison.candidateRange || "");
  const highFlag = Boolean(anchorComparison.highBandCandidate) || closestAnchor >= 8 || finalBand >= 7.5;
  const eliteFlag = closestAnchor >= 9 || /^\s*(8\.5|9)(?:\b|\s*-)/.test(candidateRangeText);
  const notWeakLanguage = signals.lexicalNaturalnessRisk !== "high" && signals.lexicalControl !== "weak" && signals.sentenceControl !== "weak";
  if (!enoughLength || !enoughStructure || !notWeakLanguage) return null;
  if (eliteFlag && finalBand >= 7.5 && finalBand < 8.5) {
    return { floor: 8.5, reason: `${task} has elite-anchor signals with full length and controlled language; avoid compressing a Band 9 candidate into 7.5.` };
  }
  if ((highFlag || finalBand >= 7) && finalBand < 7.5) {
    return { floor: 7.5, reason: `${task} is full-length and high-band eligible; avoid capping a controlled response at Band 7.0.` };
  }
  return null;
}


function task1ShortLetterCap(words) {
  const w = Number(words) || 0;
  if (w < 20) return null;
  if (w < 30) return { cap: 2.5, reason: `Task 1 has only ${w} words; a few short sentences cannot normally exceed Band 2.5.` };
  if (w < 60) return { cap: 3.5, reason: `Task 1 has only ${w} words; bullet coverage and letter development are severely limited.` };
  if (w < 80) return { cap: 4.5, reason: `Task 1 has ${w} words; most responses at this length remain limited even if the purpose is visible.` };
  if (w < 100) return { cap: 5.5, reason: `Task 1 has ${w} words; clear communication is possible, but fuller bullet development is unlikely.` };
  if (w < 120) return { cap: 6.0, reason: `Task 1 has ${w} words; it can be clear but should not be over-rewarded without strong bullet detail.` };
  if (w < 150) return { cap: 7.0, reason: `Task 1 is below the recommended length; high-band scores require exceptionally complete bullet coverage.` };
  return null;
}

function task2ShortEssayCap(words) {
  const w = Number(words) || 0;
  if (w < 20) return null;
  if (w < 50) return { cap: 2.5, reason: `Task 2 has only ${w} words; this is fragmentary essay development.` };
  if (w < 100) return { cap: 3.5, reason: `Task 2 has ${w} words; the response is too short for developed Band 4+ reasoning.` };
  if (w < 150) return { cap: 4.5, reason: `Task 2 has ${w} words; it can be relevant but usually remains underdeveloped.` };
  if (w < 180) return { cap: 5.5, reason: `Task 2 has ${w} words; clear but limited development can reach mid band, not high band.` };
  if (w < 230) return { cap: 6.5, reason: `Task 2 has ${w} words; Band 6 is possible, but higher scores need unusually strong development.` };
  return null;
}

function capSingleCriterion(criteria = {}, criterion, cap) {
  const out = { ...(criteria || {}) };
  const current = bandNumber(out[criterion]);
  if (Number.isFinite(current) && current > cap) out[criterion] = cap;
  return out;
}

function hasTask1WorkingHoursRequirement(body = {}) {
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  return /\b(which hours|what hours|hours you would like to work|working hours|reduce your working hours|work schedule|shift)\b/i.test(prompt);
}

function hasSpecificWorkHoursOrShift(text = "") {
  const source = String(text || "").toLowerCase();
  return /\b(\d{1,2}\s*(?:am|pm)|\d{1,2}\s*[-–]\s*\d{1,2}|from\s+\d{1,2}\s*(?:am|pm)?\s+to\s+\d{1,2}\s*(?:am|pm)?|before\s+\d{1,2}|after\s+\d{1,2}|morning shift|afternoon shift|evening shift|night shift|day shift|weekends?|weekdays?|three days a week|part[- ]time hours)\b/i.test(source);
}

function sub7RunOnSignal(text = "") {
  const sentences = sentenceUnits(text);
  const longSentences = sentences.filter((s) => countWords(s) >= 34).length;
  const boundaryBreaks = countPattern(text, /\b(After that|Because|So)\b[^.!?]{35,}\b(i|I|we|they|he|she|it|this|that)\b/gi);
  const gluedClauses = countPattern(text, /\b(at morning|after class|after that)[^.!?]{0,120}\b(i can|I can|it can|It can|we can)\b/gi);
  return { longSentences, boundaryBreaks, gluedClauses, total: longSentences + boundaryBreaks + gluedClauses };
}



function floorSingleCriterion(criteria = {}, criterion, floorValue) {
  const out = { ...(criteria || {}) };
  const current = bandNumber(out[criterion]);
  if (Number.isFinite(current) && current < floorValue) out[criterion] = floorValue;
  return out;
}

function rateableTask2TaskResponseFloor(signals = {}, body = {}) {
  const hardZero = signals.hardZeroGate || detectHardZeroResponse(body, signals);
  if (isStrictHardZeroGate(hardZero)) return null;
  const words = Number(signals.wordCount) || countWords(body.essay || "");
  const sentenceCount = Number(signals.sentenceCount) || sentenceUnits(body.essay || "").length;
  const paragraphCount = Number(signals.paragraphCount) || countParagraphs(body.essay || "");
  const markers = signals.taskRequirementAudit?.markers || detectTask2RequirementSignals(body.essay || "");
  const requirementCap = Number(signals.taskRequirementAudit?.taskResponseCap);
  const relevantPosition = Boolean(markers.clearOpinion || markers.positiveNegativeJudgement || markers.outweighJudgement);
  const relevantContent = Boolean(markers.advantage || markers.disadvantage || markers.problem || markers.cause || markers.solution || markers.exampleSupport || markers.explanationMarkers >= 1);
  if (!relevantContent && !relevantPosition) return null;

  let floor = null;
  if (words >= 240 && paragraphCount >= 3 && sentenceCount >= 8 && relevantPosition && (markers.explanationMarkers >= 2 || markers.exampleSupport) && (markers.advantage || markers.disadvantage || markers.problem || markers.solution || markers.positiveNegativeJudgement)) {
    floor = 5.0;
  } else if (words >= 180 && sentenceCount >= 6 && (relevantPosition || markers.explanationMarkers >= 2) && relevantContent) {
    floor = 4.5;
  } else if (words >= 120 && sentenceCount >= 4 && relevantContent) {
    floor = 4.0;
  }
  if (!Number.isFinite(floor)) return null;
  if (Number.isFinite(requirementCap)) floor = Math.min(floor, requirementCap);
  return { floor, reason: `Rateable Task 2 response floor: ${words} words with relevant position/content signals. Band 0/1/2 Task Response is reserved for no assessable or extremely limited responses, not a full relevant essay.` };
}

function rateableTask1TaskAchievementFloor(signals = {}, body = {}) {
  const hardZero = signals.hardZeroGate || detectHardZeroResponse(body, signals);
  if (isStrictHardZeroGate(hardZero)) return null;
  const essay = String(body.essay || "");
  const words = Number(signals.wordCount) || countWords(essay);
  const requirementCap = Number(signals.taskRequirementAudit?.taskAchievementCap);
  const hasLetterForm = /\b(dear|hello|hi)\b/i.test(essay) || /\b(yours|regards|sincerely|best wishes)\b/i.test(essay);
  const hasPurpose = /\b(i am writing|i'm writing|i would like|i want|could you|please|ask|request|apolog|complain|thank|invite|explain)\b/i.test(essay);
  const partlyOrCovered = (signals.taskRequirementAudit?.items || []).filter((item) => item.status === "covered" || item.status === "partly_covered").length;
  let floor = null;
  if (words >= 120 && hasLetterForm && hasPurpose && partlyOrCovered >= 2) floor = 4.5;
  else if (words >= 80 && (hasLetterForm || hasPurpose) && partlyOrCovered >= 1) floor = 4.0;
  if (!Number.isFinite(floor)) return null;
  if (Number.isFinite(requirementCap)) floor = Math.min(floor, requirementCap);
  return { floor, reason: `Rateable Task 1 letter floor: ${words} words with letter-form/purpose and relevant bullet signals. Band 0/1/2 TA is reserved for no assessable or extremely limited letters.` };
}

function applyRateableResponseFloorGuard(criteria = {}, signals = {}, body = {}) {
  let calibrated = { ...(criteria || {}) };
  const notes = [];
  const task = signals.task;
  const taskCriterion = criterionNames(task)[0];
  const before = bandNumber(calibrated[taskCriterion]);
  if (!Number.isFinite(before)) return { criteria: calibrated, changed: false, notes };
  const floorProfile = task === "Task 1" ? rateableTask1TaskAchievementFloor(signals, body) : rateableTask2TaskResponseFloor(signals, body);
  if (floorProfile && before < floorProfile.floor) {
    calibrated = floorSingleCriterion(calibrated, taskCriterion, floorProfile.floor);
    notes.push({ type: task === "Task 1" ? "task1_rateable_ta_floor_guard" : "task2_rateable_tr_floor_guard", criterion: taskCriterion, floor: floorProfile.floor, before, reason: floorProfile.reason });
  }
  return { criteria: calibrated, changed: notes.length > 0, notes };
}

function applySub7StrictCalibration(criteria = {}, signals = {}, body = {}) {
  let calibrated = { ...(criteria || {}) };
  const notes = [];
  const task = signals.task;
  const essay = String(body.essay || "");
  let profile = averageBand(calibrated);
  if (!Number.isFinite(profile.finalBand) || profile.finalBand >= 7) {
    return { criteria: calibrated, changed: false, notes };
  }
  const names = criterionNames(task);
  const taskCriterion = names[0];
  const cc = "Coherence and Cohesion";
  const lr = "Lexical Resource";
  const gra = "Grammatical Range and Accuracy";
  const spelling = Number(signals.spellingIssueCount) || 0;
  const spellingDensity = Number(signals.spellingDensityPer100Words) || 0;
  const grammar = Number(signals.grammarIssueSignalCount) || 0;
  const grammarDensity = Number(signals.grammarDensityPer100Words) || 0;
  const weakPhrases = Number(signals.weakPhraseCount) || 0;
  const runOn = sub7RunOnSignal(essay);
  const requirementAudit = signals.taskRequirementAudit || buildTaskRequirementAudit(body, signals);

  const cap = (criterion, capValue, type, reason) => {
    const before = bandNumber(calibrated[criterion]);
    if (Number.isFinite(before) && before > capValue) {
      calibrated = capSingleCriterion(calibrated, criterion, capValue);
      notes.push({ type, criterion, cap: capValue, before, reason });
    }
  };

  if (task === "Task 1") {
    const words = Number(signals.wordCount) || 0;
    if (requirementAudit && Number.isFinite(Number(requirementAudit.taskAchievementCap))) {
      cap(taskCriterion, Number(requirementAudit.taskAchievementCap), "task1_specific_requirement_audit_cap", requirementAudit.summary || "Task 1 bullet-specific requirement audit constrained Task Achievement.");
    }
    if (hasTask1WorkingHoursRequirement(body) && !hasDesiredWorkSchedule(essay)) {
      cap(taskCriterion, 5.5, "task1_specific_hours_gate", "Task 1 asks which hours the candidate would like to work, but the response does not clearly state the candidate's preferred working hours or schedule; Task Achievement should not enter Band 6.");
    }
    if (words < 150 && profile.finalBand >= 6.5 && signals.rateabilityStatus !== "clearly_rateable") {
      cap(taskCriterion, 6.0, "task1_underlength_detail_gate", `Task 1 has ${words} words and does not show clearly rateable full bullet development; keep Task Achievement below high Band 6.`);
    }
  } else {
    const words = Number(signals.wordCount) || 0;
    if (requirementAudit && Number.isFinite(Number(requirementAudit.taskResponseCap))) {
      cap(taskCriterion, Number(requirementAudit.taskResponseCap), "task2_question_type_requirement_audit_cap", requirementAudit.summary || "Task 2 question-type requirement audit constrained Task Response.");
    }
    if (words < 230 && profile.finalBand >= 6) {
      cap(taskCriterion, 5.5, "task2_development_length_gate", `Task 2 has ${words} words; unless development is unusually strong, Task Response should not exceed 5.5/6.0 territory.`);
    }
    if (signals.rateabilityStatus !== "clearly_rateable" && profile.finalBand >= 6) {
      cap(taskCriterion, 5.5, "task2_real_development_gate", "The response is rateable but does not show enough clear paragraph development to justify Band 6+ Task Response.");
    }
  }

  if (spelling >= 8 || spellingDensity >= 5) {
    cap(lr, 4.5, "sub7_spelling_density_lr_cap", `High spelling/word-form density (${spelling} issue signals; ${spellingDensity}/100 words) limits Lexical Resource to about Band 4.5.`);
  } else if (spelling >= 5 || spellingDensity >= 3) {
    cap(lr, 5.0, "sub7_spelling_density_lr_cap", `Frequent spelling/word-form errors (${spelling} issue signals; ${spellingDensity}/100 words) limit Lexical Resource to about Band 5.0.`);
  }
  if (signals.lexicalControl === "weak" || signals.lexicalNaturalnessRisk === "high" || weakPhrases >= 3) {
    cap(lr, 5.0, "sub7_lexical_naturalness_cap", "Basic, repetitive, or unnatural word choice/collocation limits Lexical Resource below Band 5.5/6.0.");
  }

  if (grammar >= 6 || grammarDensity >= 3.5 || signals.sentenceControl === "weak") {
    cap(gra, 4.5, "sub7_grammar_density_gra_cap", `Frequent grammar/sentence-control issue signals (${grammar}; ${grammarDensity}/100 words) limit GRA to about Band 4.5.`);
  } else if (grammar >= 3 || grammarDensity >= 2) {
    cap(gra, 5.0, "sub7_grammar_density_gra_cap", `Repeated grammar/sentence-control issue signals (${grammar}; ${grammarDensity}/100 words) limit GRA to about Band 5.0.`);
  }

  if (runOn.total >= 2 || signals.sentenceControl === "weak") {
    cap(cc, 5.0, "sub7_cohesion_sentence_flow_cap", "Sentence-boundary problems or weak sentence control reduce paragraph flow; Coherence and Cohesion should not be lifted by paragraphing alone.");
  } else if (runOn.total >= 1 && profile.finalBand >= 5.5) {
    cap(cc, 5.5, "sub7_cohesion_sentence_flow_cap", "Some sentence-boundary or flow problems are visible; Coherence and Cohesion should stay in the mid-band range.");
  }

  profile = averageBand(calibrated);
  const lrBand = bandNumber(calibrated[lr]);
  const graBand = bandNumber(calibrated[gra]);
  if (Number.isFinite(profile.finalBand) && profile.finalBand > 5.5 && Number.isFinite(lrBand) && Number.isFinite(graBand) && lrBand <= 5 && graBand <= 5) {
    const beforeCriteria = { ...calibrated };
    calibrated = capCriteriaBands(calibrated, 5.5);
    notes.push({ type: "sub7_dual_language_cap", cap: 5.5, beforeCriteria, reason: "When both LR and GRA are 5.0 or below, the overall profile should normally not exceed Band 5.5 in a sub-7 response." });
  }

  const rateableFloor = applyRateableResponseFloorGuard(calibrated, signals, body);
  if (rateableFloor.changed) {
    calibrated = rateableFloor.criteria;
    notes.push(...rateableFloor.notes);
  }

  return { criteria: calibrated, changed: notes.length > 0, notes };
}

function applyLocalRegressionCalibration(criteria = {}, signals = {}, anchorComparison = {}, body = {}) {
  let calibrated = { ...(criteria || {}) };
  const notes = [];
  const task = signals.task;
  const words = Number(signals.wordCount) || 0;
  const { finalBand } = averageBand(calibrated);
  const shortCap = task === "Task 1" ? task1ShortLetterCap(words) : task2ShortEssayCap(words);
  if (shortCap && Number.isFinite(finalBand) && finalBand > shortCap.cap) {
    calibrated = capCriteriaBands(calibrated, shortCap.cap);
    notes.push({ type: "short_response_cap", cap: shortCap.cap, reason: shortCap.reason });
  }
  const sub7Strict = applySub7StrictCalibration(calibrated, signals, body);
  if (sub7Strict.changed) {
    calibrated = sub7Strict.criteria;
    notes.push(...sub7Strict.notes);
  }
  const highFloor = highBandFloorProfile(calibrated, signals, anchorComparison);
  if (highFloor) {
    calibrated = floorCriteriaBands(calibrated, highFloor.floor);
    notes.push({ type: "high_band_floor", floor: highFloor.floor, reason: highFloor.reason });
  }
  return { criteria: calibrated, changed: notes.length > 0, notes };
}

function stableJsonParse(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("AI did not return valid JSON.");
}

async function callDeepSeekContent(messages, maxTokens = 5000, temperature = 0) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY environment variable.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, temperature, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned an empty response.");
    return content;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("DeepSeek request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildJsonRepairPrompt(rawContent, parseError) {
  return [
    "You are a JSON repair engine. Return JSON only.",
    "The previous IELTS scoring model returned malformed JSON. Repair the JSON syntax only.",
    "Do not change any scores, bands, explanations, evidence, anchor decisions, boundary decisions, or meanings.",
    "If a string contains quote marks from the essay, use single quotes inside the string or escape double quotes correctly.",
    "Remove trailing prose, markdown fences, comments, invalid control characters, and dangling commas.",
    `Parse error: ${String(parseError?.message || parseError || "unknown parse error")}`,
    `Malformed content:\n${String(rawContent || "").slice(0, 60000)}`
  ].join("\n\n");
}

async function callDeepSeek(messages, maxTokens = 5000, temperature = 0) {
  const content = await callDeepSeekContent(messages, maxTokens, temperature);
  try {
    return stableJsonParse(content);
  } catch (firstError) {
    try {
      const repairedContent = await callDeepSeekContent([
        { role: "system", content: "You repair malformed JSON. Return valid JSON only and never alter the scoring meaning." },
        { role: "user", content: buildJsonRepairPrompt(content, firstError) }
      ], Math.min(5000, Math.max(1800, Math.floor(maxTokens * 0.65))), 0);
      const repaired = stableJsonParse(repairedContent);
      repaired.__jsonRepairApplied = true;
      return repaired;
    } catch (repairError) {
      const error = new Error(`AI returned malformed JSON and repair failed. Original parse error: ${firstError.message}; repair error: ${repairError.message}`);
      error.name = "MalformedAiJsonError";
      throw error;
    }
  }
}


function anchorSetForTask(task) {
  return task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9 : TASK2_BAND_ANCHORS_0_TO_9;
}

function gateRulesForTask(task) {
  return task === "Task 1" ? TASK1_GATE_RULES : TASK2_GATE_RULES;
}

function taskRuleLabel(task) {
  return task === "Task 1" ? "GT Task 1 Letter anchor-calibrated rules" : "GT Task 2 Essay anchor-calibrated rules";
}

function independentFallbackAnchorBand(task, signals = {}) {
  const words = Number(signals.wordCount) || 0;
  if (signals.rateabilityStatus === "not_rateable_or_severely_limited") {
    if (words === 0) return 0;
    if (words < 50) return 2;
    if (words < 80) return 3;
  }
  if (task === "Task 1") {
    if (words < 50) return 2;
    if (words < 80) return 3;
    if (words < 120) return 4;
    if (words < 150) return 5;
    return 6;
  }
  if (words < 50) return 2;
  if (words < 80) return 3;
  if (words < 120) return 4;
  if (words < 150) return 4;
  if (words < 180) return 5;
  return 6;
}

function defaultAnchorComparison(task, criteria = {}, signals = {}) {
  const closest = independentFallbackAnchorBand(task, signals);
  const lower = Math.max(0, closest - 1);
  const higher = Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || anchorSetForTask(task)[0];
  return {
    task,
    anchorSystem: `${taskRuleLabel(task)} (local fallback only; AI independent anchor required)`,
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    closestAnchorProfile: anchor?.profile || "",
    closestAnchorProfileZh: anchor?.zh || "",
    anchorSource: "local_fallback_missing_ai_anchor",
    anchorMissing: true,
    whyCloserToThisBand: `AI did not return an independent anchor comparison. The server used only local task/length/rateability signals as a fallback and requires boundary review before freezing if this conflicts with criterion bands.`,
    whyCloserToThisBandZh: `AI 没有返回独立锚点对比。本地仅根据任务类型、字数和可评分性做兜底判断；如果与四项分数冲突，必须进入边界复核后才能冻结。`,
    whyNotLowerAnchor: `No lower-anchor decision was returned by AI; this must be supplied by the scoring/review model, not inferred from the final score.`,
    whyNotLowerAnchorZh: `AI 没有返回低一档解释；这一项应由评分/复核模型给出，不能由最终分数反推。`,
    whyNotHigherAnchor: `No higher-anchor decision was returned by AI; this must be supplied by the scoring/review model, not inferred from the final score.`,
    whyNotHigherAnchorZh: `AI 没有返回高一档解释；这一项应由评分/复核模型给出，不能由最终分数反推。`
  };
}

function hasUsableAnchorComparison(raw) {
  if (!raw || typeof raw !== "object") return false;
  const closest = Number(raw.closestAnchorBand ?? raw.closestAnchor);
  return Number.isFinite(closest) && String(raw.whyCloserToThisBand || raw.anchorComparison || raw.whyNotHigherAnchor || raw.whyNotLowerAnchor || "").trim().length > 0;
}

function normalizeAnchorComparison(raw, task, criteria, signals) {
  const fallback = defaultAnchorComparison(task, criteria, signals);
  const source = raw && typeof raw === "object" ? raw : {};
  const provided = hasUsableAnchorComparison(source);
  const sourceClosest = Number(source.closestAnchorBand ?? source.closestAnchor);
  const closest = provided && Number.isFinite(sourceClosest) ? Math.max(0, Math.min(9, Math.round(sourceClosest))) : fallback.closestAnchorBand;
  const lower = Number.isFinite(Number(source.lowerAnchorBand ?? source.lowerAnchor)) ? Math.max(0, Math.min(9, Math.round(Number(source.lowerAnchorBand ?? source.lowerAnchor)))) : Math.max(0, closest - 1);
  const higher = Number.isFinite(Number(source.higherAnchorBand ?? source.higherAnchor)) ? Math.max(0, Math.min(9, Math.round(Number(source.higherAnchorBand ?? source.higherAnchor)))) : Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || {};
  return {
    ...fallback,
    ...source,
    task,
    anchorSystem: source.anchorSystem || (provided ? taskRuleLabel(task) : fallback.anchorSystem),
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    anchorSource: provided ? "ai_independent_anchor" : "local_fallback_missing_ai_anchor",
    anchorMissing: !provided,
    closestAnchorProfile: String(source.closestAnchorProfile || anchor.profile || fallback.closestAnchorProfile || "").trim(),
    closestAnchorProfileZh: String(source.closestAnchorProfileZh || anchor.zh || fallback.closestAnchorProfileZh || "").trim(),
    whyCloserToThisBand: String(source.whyCloserToThisBand || source.anchorComparison || fallback.whyCloserToThisBand).trim(),
    whyCloserToThisBandZh: String(source.whyCloserToThisBandZh || fallback.whyCloserToThisBandZh || "").trim(),
    whyNotLowerAnchor: String(source.whyNotLowerAnchor || fallback.whyNotLowerAnchor).trim(),
    whyNotLowerAnchorZh: String(source.whyNotLowerAnchorZh || fallback.whyNotLowerAnchorZh || "").trim(),
    whyNotHigherAnchor: String(source.whyNotHigherAnchor || fallback.whyNotHigherAnchor).trim(),
    whyNotHigherAnchorZh: String(source.whyNotHigherAnchorZh || fallback.whyNotHigherAnchorZh || "").trim()
  };
}

function normalizeGate(raw, fallbackReason, triggered = false) {
  const source = raw && typeof raw === "object" ? raw : {};
  const localTriggered = Boolean(triggered);
  const aiStatus = source.status || source.result;
  return {
    status: localTriggered ? "triggered" : (aiStatus || "passed"),
    localTriggered,
    aiStatus: aiStatus || "",
    reason: String(source.reason || source.explanation || source.note || fallbackReason || "Gate checked.").trim(),
    reasonZh: String(source.reasonZh || source.explanationZh || source.noteZh || "").trim(),
    evidence: Array.isArray(source.evidence) ? source.evidence : []
  };
}


function getWordCountBoundaryProfile(task, words) {
  const w = Number(words) || 0;
  if (task === "Task 1") {
    if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0", lower: 0, upper: 0, severity: "extreme", reason: "Task 1 is blank or has no countable words." };
    if (w < 20) return { triggered: true, category: "minimal_letter", suggestedRange: "Band 0-2.0", lower: 0, upper: 2, severity: "extreme", reason: `Task 1 has only ${w} words; only isolated words/fragments can normally be assessed.` };
    if (w < 50) return { triggered: true, category: "very_short_letter", suggestedRange: "Band 1.5-3.5", lower: 1.5, upper: 3.5, severity: "severe", reason: `Task 1 has ${w} words; letter purpose and bullet coverage are likely severely limited.` };
    if (w < 80) return { triggered: true, category: "short_letter_limited_detail", suggestedRange: "Band 3.0-4.5, or 5.0 only if most bullets are clear", lower: 3, upper: 5, severity: "high", reason: `Task 1 has ${w} words; it is short, but a concise letter may still be rateable if bullets are clear.` };
    if (w < 120) return { triggered: true, category: "below_recommended_letter_length", suggestedRange: "Band 4.0-6.0 depending on bullet detail", lower: 4, upper: 6, severity: "moderate", reason: `Task 1 has ${w} words, below 150; check bullet development, not word count alone.` };
    if (w < 150) return { triggered: true, category: "slightly_below_recommended_letter_length", suggestedRange: "Band 5.0-7.0 depending on task fulfilment", lower: 5, upper: 7, severity: "watch", reason: `Task 1 has ${w} words; it can still score well if all bullets are naturally covered.` };
    return { triggered: false, category: "normal_letter_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 1 word count ${w} is in or above the normal range.` };
  }
  if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0", lower: 0, upper: 0, severity: "extreme", reason: "Task 2 is blank or has no countable words." };
  if (w < 20) return { triggered: true, category: "minimal_response", suggestedRange: "Band 0-2.0", lower: 0, upper: 2, severity: "extreme", reason: `Task 2 has only ${w} words; only fragments can normally be assessed.` };
  if (w < 50) return { triggered: true, category: "very_short_rateable", suggestedRange: "Band 1.5-3.0", lower: 1.5, upper: 3, severity: "severe", reason: `Task 2 has ${w} words; it is too short for developed essay response.` };
  if (w < 80) return { triggered: true, category: "severe_underlength_but_rateable", suggestedRange: "Band 2.5-3.5", lower: 2.5, upper: 3.5, severity: "high", reason: `Task 2 has ${w} words; development evidence is severely limited.` };
  if (w < 120) return { triggered: true, category: "underlength_limited_development", suggestedRange: "Band 3.0-4.0, or 4.5 only with unusually clear relevance", lower: 3, upper: 4.5, severity: "high", reason: `Task 2 has ${w} words; task response and development are likely limited.` };
  if (w < 150) return { triggered: true, category: "short_response", suggestedRange: "Band 3.5-5.0 depending on development", lower: 3.5, upper: 5, severity: "moderate", reason: `Task 2 has ${w} words; 5.0+ needs clear development evidence.` };
  if (w < 180) return { triggered: true, category: "below_recommended_essay_length", suggestedRange: "Band 4.0-5.5 depending on development", lower: 4, upper: 5.5, severity: "moderate", reason: `Task 2 has ${w} words; it is short, but a coherent answer can still be mid-band.` };
  if (w < 230) return { triggered: true, category: "development_risk", suggestedRange: "Band 4.5-6.5 depending on response depth", lower: 4.5, upper: 6.5, severity: "watch", reason: `Task 2 has ${w} words; check development depth before 6.0+, but do not cap by word count alone.` };
  return { triggered: false, category: "normal_essay_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 2 word count ${w} is in or near the normal IELTS range.` };
}


function getLocalBandBoundaryProfile(signals = {}) {
  const task = signals.task === "Task 1" ? "Task 1" : "Task 2";
  const wordBoundary = getWordCountBoundaryProfile(task, signals.wordCount);
  const languageWeak = signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak" || signals.sentenceControl === "weak";
  const languageModerate = signals.grammarErrorDensity === "moderate" || signals.spellingErrorDensity === "moderate" || signals.lexicalControl === "basic" || signals.sentenceControl === "basic";
  const highBandEligible = !wordBoundary.triggered && !languageWeak && signals.rateabilityStatus === "clearly_rateable";
  const lowBandRisk = wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited";
  const midBandRisk = !lowBandRisk && (languageWeak || languageModerate || signals.rateabilityStatus !== "clearly_rateable");
  const likelyZone = lowBandRisk
    ? (task === "Task 1" ? "Task 1 low-band or low-mid boundary; bullet/purpose/tone detail must justify any score above the suggested range." : "Task 2 low-band or low-mid boundary; development and language evidence must justify any score above the suggested range.")
    : highBandEligible
      ? (task === "Task 1" ? "Task 1 high-band can be considered if all bullets are fully developed and register is precise." : "Task 2 high-band can be considered if reasoning is mature, cohesive and language control is strong.")
      : "Mid-band boundary: complete but limited writing needs criterion-specific evidence before 5.5/6.0+.";
  return {
    task,
    wordBoundary,
    languageWeak,
    languageModerate,
    highBandEligible,
    lowBandRisk,
    midBandRisk,
    likelyZone,
    languageProfile: {
      spellingErrorDensity: signals.spellingErrorDensity,
      grammarErrorDensity: signals.grammarErrorDensity,
      lexicalControl: signals.lexicalControl,
      sentenceControl: signals.sentenceControl,
      weakPhraseCount: signals.weakPhraseCount
    }
  };
}

function scoreValues(criteria) {
  return Object.values(criteria || {}).map(Number).filter(Number.isFinite);
}

function allCriteriaSame(criteria) {
  const values = scoreValues(criteria);
  return values.length === 4 && values.every((x) => x === values[0]);
}

function noWeakLocalLanguage(signals = {}) {
  return signals.grammarErrorDensity !== "high" && signals.spellingErrorDensity !== "high" && signals.lexicalControl !== "weak" && signals.sentenceControl !== "weak";
}

function detectHighBandCandidate(criteria, signals = {}, anchor = {}, calibration = {}) {
  const values = scoreValues(criteria);
  const avg = averageBand(criteria).finalBand;
  const allSeven = values.length === 4 && values.every((x) => x === 7);
  const allAtLeastSeven = values.length === 4 && values.every((x) => x >= 7);
  const anchorBand = Number(anchor.closestAnchorBand);
  const calibrationText = JSON.stringify(calibration || {});
  const highSignalText = /fully|mature|natural|precise|flexible|rare errors|negligible errors|strong grammatical control|sophisticated|fluent/i.test(calibrationText);
  const normalLength = signals.task === "Task 1" ? Number(signals.wordCount) >= 150 : Number(signals.wordCount) >= 230;
  const triggered = Boolean((allSeven || (allAtLeastSeven && avg <= 7.5) || anchorBand >= 8 || highSignalText) && normalLength && noWeakLocalLanguage(signals));
  return {
    triggered,
    allSeven,
    allAtLeastSeven,
    anchorBand,
    highSignalText,
    normalLength,
    reason: triggered
      ? "High-band boundary review required: the score profile may be capped around Band 7 despite high-band signals or all-four-7 pattern."
      : "No forced high-band boundary review from local signals."
  };
}

function normalizeTaskSpecificGate(raw, signals, criteria = {}, anchor = {}, calibration = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const task = signals.task;
  const words = Number(signals.wordCount) || 0;
  const wordBoundary = getWordCountBoundaryProfile(task, words);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchor, calibration);
  if (task === "Task 1") {
    const bullets = Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints : [];
    const firstName = criterionNames(task)[0];
    const ta = Number(criteria[firstName]);
    return {
      bulletCoverageGate: normalizeGate(source.bulletCoverageGate || source.bulletCoverage, `Task 1 bullet coverage must be explicit. Extracted bullets: ${bullets.length ? bullets.join(" | ") : "no explicit bullets extracted"}. Missing one or more bullets must constrain Task Achievement.`, Boolean(bullets.length && ta >= 6 && words < 150)),
      purposeClarityGate: normalizeGate(source.purposeClarityGate || source.purposeClarity, "Task 1 purpose clarity checked; unclear purpose normally prevents a high Task Achievement score.", false),
      toneRegisterGate: normalizeGate(source.toneRegisterGate || source.toneRegister, "Task 1 tone/register checked against recipient relationship and letter purpose; wrong tone constrains TA and LR.", false),
      letterCompletenessGate: normalizeGate(source.letterCompletenessGate || source.letterCompleteness, "Letter completeness checked: greeting/opening purpose/body details/closing/request or thanks/sign-off.", false),
      wordCountGuard: normalizeGate(source.wordCountGuard, `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.`, wordBoundary.triggered),
      highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5)),
      taskRequirementAuditGate: normalizeGate(source.taskRequirementAuditGate, signals.taskRequirementAudit?.summary || "Task 1 bullet-specific requirement audit completed.", Boolean(signals.taskRequirementAudit?.triggered))
    };
  }
  return {
    taskResponseDepthGate: normalizeGate(source.taskResponseDepthGate || source.taskResponseDepth, "Task 2 response depth checked: all prompt parts, position, reasons, examples and explanations must be present.", false),
    band6AccessGate: normalizeGate(source.band6AccessGate || source.band6Access, "Band 6 access checked: real development is required; visible structure alone is not enough.", Boolean(words < 230 && Object.values(criteria).some((x) => Number(x) >= 6))),
    lowBandGuard: normalizeGate(source.lowBandGuard, `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.`, wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited"),
    midBandCheck: normalizeGate(source.midBandCheck || source.midBandGate, "Mid-band check applied: do not over-reward paragraphs, basic connectors, or a stated opinion without development.", false),
    highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5)),
    scoreProfileCheck: normalizeGate(source.scoreProfileCheck || source.scoreProfileGate, "Score-profile check applied to challenge all-equal bands and TR/CC versus LR/GRA gaps.", allCriteriaSame(criteria)),
    taskRequirementAuditGate: normalizeGate(source.taskRequirementAuditGate, signals.taskRequirementAudit?.summary || "Task 2 question-type requirement audit completed.", Boolean(signals.taskRequirementAudit?.triggered))
  };
}

function stringifyAnchorTable(task) {
  return anchorSetForTask(task).map((item) => `Band ${item.band}: ${item.profile}`).join("\n");
}

function buildIndependentAnchorPrompt(body, signals) {
  const task = signals.task;
  const anchorTable = stringifyAnchorTable(task);
  const taskSpecific = task === "Task 1"
    ? `GT Task 1 letter: judge purpose clarity, bullet coverage, tone/register, letter completeness and language control. Extracted bullets: ${JSON.stringify(signals.task1BulletPoints)}.`
    : `GT Task 2 essay: judge prompt coverage, position, development, examples/reasons, logical progression and language control. Question profile: ${JSON.stringify(signals.task2QuestionProfile)}.`;
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  return [
    "You are an IELTS GT Writing anchor-classification examiner. Return JSON only. Do not assign criterion bands in this stage.",
    `Score system: ${SCORE_SYSTEM_VERSION}. Task: ${task}.`,
    "The selected task is locked by the request. Do not switch Task 1 and Task 2 inside this stage.",
    taskSpecific,
    "Your only job is to classify the response against the 0-9 anchor benchmarks before criterion scoring.",
    "This anchor must be independent from final criterion bands; do not infer it from a score because no criterion score exists yet.",
    "High-band rule: if the response is mature, fully developed, naturally cohesive, precise and mostly error-free, you must consider Band 8 or Band 9 anchors. Do not default to Band 7 for safety.",
    "Low-band rule: if the response is severely underlength or barely developed, the closest anchor must reflect that even if the response has paragraphs.",
    `0-9 anchor benchmarks:\n${anchorTable}`,
    `Local non-scoring signals for calibration: ${JSON.stringify(signals)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly: {\"ok\":true,\"aiStage\":\"score-anchor\",\"anchorComparison\":{\"anchorSystem\":\"Task-aware independent 0-9 anchor classification\",\"closestAnchorBand\":number,\"lowerAnchorBand\":number,\"higherAnchorBand\":number,\"candidateRange\":\"e.g. 7.5-8.5\",\"closestAnchorProfile\":\".\",\"closestAnchorProfileZh\":\"中文\",\"whyCloserToThisBand\":\".\",\"whyCloserToThisBandZh\":\"中文\",\"whyNotLowerAnchor\":\".\",\"whyNotLowerAnchorZh\":\"中文\",\"whyNotHigherAnchor\":\".\",\"whyNotHigherAnchorZh\":\"中文\",\"highBandCandidate\":boolean,\"lowBandCandidate\":boolean,\"evidence\":[\"short essay quote or feature\"]}}"
  ].join("\n\n");
}

function buildScoreCorePrompt(body, signals, independentAnchor = null) {
  const task = signals.task;
  const names = criterionNames(task);
  const anchorTable = stringifyAnchorTable(task);
  const gateRules = gateRulesForTask(task).map((rule, index) => `${index + 1}. ${rule}`).join("\n");
  const bandBoundaryProtocol = bandBoundaryProtocolForTask(task);
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  const compactMode = localBoundaryProfile.lowBandRisk || localBoundaryProfile.languageWeak || signals.wordCount < (task === "Task 1" ? 150 : 230);
  const taskSpecific = task === "Task 1"
    ? `Task 1 GT letter checks: purpose clarity; all bullet points separately covered/partly/missing; functional detail; recipient relationship; tone/register; opening/closing/format. Extracted bullet points: ${JSON.stringify(signals.task1BulletPoints)}.`
    : `Task 2 essay checks: question type; all required parts; clear position when required; relevant development; reasons; examples; conclusion. Question profile: ${JSON.stringify(signals.task2QuestionProfile)}.`;
  const anchorInstruction = hasUsableAnchorComparison(independentAnchor)
    ? `Independent anchor from Step 3: ${JSON.stringify(independentAnchor)}. Your criterion bands must be calibrated against this anchor. If you disagree, explain explicitly in anchorComparison, but do not silently fall back to Band 7.`
    : "No valid independent anchor was passed from Step 3; you must return a full independent anchorComparison and the hard audit will force review if it is missing.";

  return [
    "You are a strict but fair IELTS General Training Writing examiner. Return JSON only.",
    `Use ${SCORE_SYSTEM_VERSION}. First route the script as ${task}. Do not use Task 2 essay logic for Task 1 letters or Task 1 letter logic for Task 2 essays.`,
    "Grade IELTS Writing from Band 0.0 to Band 9.0. Use 0 only for no assessable answer / wholly unrelated / non-English / fully copied. Otherwise use 1.0 to 9.0 in 0.5 increments.",
    "For every criterion, actively compare adjacent half bands. Use X.5 when performance clearly exceeds X.0 but does not consistently reach X+1.0. Do not prefer whole bands by default.",
    "Do not generate editing, language diagnostics, learning notes, revisions, or model answers in this scoring pass. This endpoint is for scoring only.",
    taskSpecific,
    `0-9 anchor benchmarks for this task:\n${anchorTable}`,
    `Task-specific gates for this task:\n${gateRules}`,
    "Anchor calibration requirement: before assigning final criterion bands, decide which 0-9 anchor the response is closest to. Explain why it is not the lower adjacent anchor and why it is not the higher adjacent anchor. This prevents low/mid writing being lifted by visible structure and prevents high-band writing being capped at 7.0.",
    "Independent anchor rule: anchorComparison must be decided before and independently from the final criterion average. Never infer closestAnchorBand from the final score.",
    anchorInstruction,
    "Hard local audit rule: the server will independently check underlength, all-four-same, all-four-7, anchor/final conflicts, Band 6 access, and high-band ceiling. If a conflict is found, your result may be sent to a second AI boundary review before freezing.",
    "Fail-closed rule: every criterion must include evidence and half-band boundary reasoning. If all four criteria are identical, justify equality with evidence or differentiate the bands by 0.5 where appropriate.",
    "High-band ceiling rule: Band 8/9 writing can have rare minor slips. Do not keep a mature, fully developed, precise and natural response at four Band 7s merely because it is not perfect.",
    "Criterion feedback evidence rule: criterionCalibration must be essay-specific, not templated. Every criterion must cite or paraphrase at least two concrete features or short quotes from the student's response in positiveEvidence, limitingEvidence, or essayEvidence.",
    "Invalid generic feedback rule: comments such as 'clear position but lacks depth', 'adequate vocabulary', 'some grammatical errors', 'coherence is generally clear', or any comment that could apply to any essay are invalid. Rewrite with exact evidence from this essay.",
    "Each criterion explanation must include: whyThisBand, whyNotLower, whyNotHigher, howToImprove, essayEvidence, and specific evidence for/against the next half band. Do not leave evidence arrays empty unless the answer is not assessable.",
    "JSON safety rule: do not use unescaped double quotes inside JSON string values. Use single quotes around student phrases. Return no markdown, no comments, no trailing prose.",
    "Low-band boundary rule: severe underlength may be rateable but still belongs to a low-band boundary. Task 2 80-119 words is usually Band 3.0-4.0; Task 2 120-149 words is usually Band 3.5-4.5 unless exceptional evidence exists.",
    "Task 1 special rule: Task Achievement is mainly determined by purpose clarity, bullet coverage, detail, tone/register, and letter completeness. Missing bullets or wrong tone must constrain TA and can also constrain CC/LR.",
    "Task 2 special rule: Task Response is mainly determined by answering all prompt parts, position, development, examples/reasons, relevance, and conclusion. A position plus paragraphs is not enough for Band 6.",
    "Band 6 access rule: Band 6 requires real task fulfilment and development, not only paragraphing. If ideas are general, examples are brief, or frequent language errors reduce precision, stay at 5.0-5.5.",
    "High-band unlock rule: if the response has full task fulfilment, developed ideas, natural progression, precise/flexible lexis, and strong grammar control, actively consider 7.5/8.0/8.5/9.0 rather than defaulting to 7.0.",
    "LR/GRA gates: high spelling/word-form density must limit LR unless strong evidence overrides it. High grammar density or weak sentence control must limit GRA unless strong evidence overrides it.",
    "Task-aware low-band AI action: if the response is complete but language is weak, lower LR/GRA rather than blindly lowering TR/TA or CC. If the response is short or missing task content, lower TR/TA and CC as well.",
    "Task-aware high-band AI action: if the response meets high-band task fulfilment and language-control evidence, break the Band 7 ceiling with 7.5/8/8.5/9 where justified. Band 8/9 writing does not need literary native-speaker style; it needs complete task fulfilment, natural control, precision, and very few errors. Use anchorBand 9 when the script is fully responsive, fluent, controlled, and has negligible limitation.",
    "Score-profile gate: challenge all-equal bands, TR/TA+CC much higher than LR/GRA, and overall 5.5+ when language-control signals are weak.",
    "The server will average the four criterion bands and round to the nearest 0.5. Do not invent a separate overall band that conflicts with the four criteria.",
    `Criterion names must be exactly: ${JSON.stringify(names)}.` ,
    `Local scoring signals for calibration only, not local scoring: ${JSON.stringify(signals)}.` ,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return this exact JSON shape: {\"ok\":true,\"aiStage\":\"score-core\",\"task\":\"Task 1 or Task 2\",\"anchorComparison\":{\"anchorSystem\":\"Task 1 Letter anchors or Task 2 Essay anchors\",\"closestAnchorBand\":number,\"lowerAnchorBand\":number,\"higherAnchorBand\":number,\"closestAnchorProfile\":\"...\",\"closestAnchorProfileZh\":\"中文\",\"whyCloserToThisBand\":\"...\",\"whyCloserToThisBandZh\":\"中文\",\"whyNotLowerAnchor\":\"...\",\"whyNotLowerAnchorZh\":\"中文\",\"whyNotHigherAnchor\":\"...\",\"whyNotHigherAnchorZh\":\"中文\"},\"criteria\":{...four criterion bands as numbers...},\"criterionCalibration\":{\"Criterion Name\":{\"band\":number,\"selectedBand\":number,\"candidateBandsConsidered\":[...],\"summary\":\"one-sentence reason for this band\",\"summaryZh\":\"中文一句话原因\",\"whyThisBand\":\"why this exact band was selected\",\"whyThisBandZh\":\"中文\",\"whyNotLower\":\"why not 0.5 lower\",\"whyNotLowerZh\":\"中文\",\"whyNotHigher\":\"why not 0.5 higher\",\"whyNotHigherZh\":\"中文\",\"howToImprove\":\"one specific way to move 0.5 higher\",\"howToImproveZh\":\"中文\",\"positiveEvidence\":[...],\"positiveEvidenceZh\":[...],\"limitingEvidence\":[...],\"limitingEvidenceZh\":[...],\"essayEvidence\":[{\"quote\":\"short quote from essay\",\"meaning\":\"what it proves\",\"meaningZh\":\"中文\"}],\"halfBandDecision\":{\"whyAboveLowerBand\":\"...\",\"whyAboveLowerBandZh\":\"中文\",\"whyBelowUpperBand\":\"...\",\"whyBelowUpperBandZh\":\"中文\",\"whyExactBand\":\"...\",\"whyExactBandZh\":\"中文\"}}},\"scoreProfile\":{\"likelyOverallRange\":\"...\",\"lowBandGate\":{\"status\":\"passed/triggered\",\"reason\":\"...\",\"reasonZh\":\"中文\"},\"midBandGate\":{\"status\":\"passed/triggered\",\"reason\":\"...\",\"reasonZh\":\"中文\"},\"highBandGate\":{\"status\":\"passed/triggered\",\"reason\":\"...\",\"reasonZh\":\"中文\"},\"scoreProfileGate\":{\"status\":\"passed/triggered\",\"reason\":\"...\",\"reasonZh\":\"中文\"}},\"taskSpecificGate\":{...Task 1 gates or Task 2 gates from the listed gate rules, each with status/reason/reasonZh/evidence...},\"diagnosticSignals\":{...},\"examinerSummary\":\"short scoring-only explanation\",\"examinerSummaryZh\":\"中文评分摘要\"}"
  ].join("\n\n");
}

function normalizeCriteria(rawCriteria, task) {
  const names = criterionNames(task);
  const source = rawCriteria && typeof rawCriteria === "object" ? rawCriteria : {};
  const out = {};
  names.forEach((name) => {
    const aliases = [name, name.replace("Task Achievement", "Task Response"), name.replace("Task Response", "Task Achievement"), name.replace(" and ", " & ")];
    const raw = aliases.map((key) => source[key]).find((v) => v !== undefined && v !== null);
    const band = bandNumber(raw);
    if (!Number.isFinite(band)) throw new Error(`AI did not return a valid half-band for ${name}.`);
    if (!VALID_BANDS.includes(band)) throw new Error(`Invalid IELTS band ${band} for ${name}.`);
    out[name] = band;
  });
  return out;
}

function collectScoreWarnings(criteria, signals) {
  const warnings = [];
  const names = criterionNames(signals.task);
  const first = criteria[names[0]];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];
  const { finalBand } = averageBand(criteria);
  const allSame = Object.values(criteria).every((x) => x === Object.values(criteria)[0]);
  if (allSame) warnings.push("All four criterion bands are identical; examiner evidence must justify this equality.");
  if (signals.task === "Task 1" && signals.task1BulletPoints?.length && first >= 6 && signals.wordCount < 120) warnings.push("Task 1 TA is 6.0+ with low word count; bullet detail and letter completeness must justify this.");
  if (signals.task === "Task 2" && first >= 6 && signals.wordCount < 220) warnings.push("Task 2 TR is 6.0+ with relatively low word count; real development must justify this.");
  if (Object.values(criteria).some((x) => x === 0) && signals.rateabilityStatus !== "not_rateable_or_severely_limited") warnings.push("Band 0 criterion returned for a rateable response; this requires extreme evidence.");
  if (signals.rateabilityStatus === "clearly_rateable" && Object.values(criteria).some((x) => x <= 2)) warnings.push("Clearly rateable response received a Band 1/2 criterion; this would require unusually strong evidence.");
  if (signals.grammarErrorDensity === "high" && gra >= 5) warnings.push("GRA is 5.0+ while grammar error density is high; the examiner must justify this carefully.");
  if ((signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak") && lr >= 5.5) warnings.push("LR is 5.5+ while lexical/spelling signals are weak; the examiner must justify this carefully.");
  if (finalBand >= 5.5 && (signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high") && (lr <= 5 || gra <= 5)) warnings.push("Overall 5.5+ with weak LR/GRA signals can be overgenerous; score-profile gate should be checked.");
  if (first >= 5.5 && cc >= 5.5 && lr <= 4.5 && gra <= 4.5) warnings.push("TR/TA and CC are 5.5 while LR/GRA are weak; confirm that task development and cohesion evidence justify this gap.");
  return warnings;
}


function defaultImproveForCriterion(criterion) {
  if (/Task Response|Task Achievement/i.test(criterion)) return "Develop each main point with a clearer reason and one specific example that directly answers the task.";
  if (/Coherence/i.test(criterion)) return "Improve paragraph-internal progression and make sentence links clearer, not just using basic linking words.";
  if (/Lexical/i.test(criterion)) return "Reduce spelling and word-form errors and use more accurate topic vocabulary and collocations.";
  if (/Grammatical/i.test(criterion)) return "Control basic verb forms, articles, plurals, punctuation, and sentence boundaries before adding more complex structures.";
  return "Strengthen the limiting evidence for this criterion to move 0.5 band higher.";
}


function evidenceItemCount(item = {}) {
  const arrays = [item.positiveEvidence, item.limitingEvidence, item.essayEvidence, item.textEvidence, item.evidenceQuotes].filter(Array.isArray);
  return arrays.reduce((sum, arr) => sum + arr.filter(Boolean).length, 0);
}

function isGenericCriterionFeedbackText(text) {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return true;
  const genericPatterns = [
    /clear position but lacks depth/,
    /adequate vocabulary/,
    /some grammatical errors/,
    /coherence is generally clear/,
    /ideas are underdeveloped/,
    /grammar is generally controlled/,
    /vocabulary is limited/,
    /some relevant vocabulary avoids band/,
    /some attempts at complex structures/,
    /avoid band 4/,
    /needs more examples/,
    /good but not excellent/
  ];
  return genericPatterns.some((pattern) => pattern.test(value));
}

function criterionFeedbackQualityIssues(calibration = {}) {
  return Object.entries(calibration || {}).flatMap(([criterion, item]) => {
    const text = [item.summary, item.whyThisBand, item.whyNotLower, item.whyNotHigher, item.howToImprove].filter(Boolean).join(" ");
    const issues = [];
    if (isGenericCriterionFeedbackText(text)) issues.push(`${criterion}: criterion feedback appears generic or under-specific.`);
    if (evidenceItemCount(item) < 2) issues.push(`${criterion}: fewer than two concrete evidence items were returned.`);
    return issues;
  });
}

function normalizeCriterionCalibration(rawCalibration, criteria, task) {
  const names = criterionNames(task);
  const source = rawCalibration && typeof rawCalibration === "object" ? rawCalibration : {};
  const out = {};
  names.forEach((name) => {
    const alt = name.replace("Task Achievement", "Task Response").replace("Task Response", "Task Achievement");
    const item = source[name] || source[alt] || {};
    const band = criteria[name];
    const lower = Math.max(1, band - 0.5);
    const higher = Math.min(9, band + 0.5);
    const half = item.halfBandDecision || {};
    const whyThis = String(item.whyThisBand || item.summary || half.whyExactBand || `Band ${band.toFixed(1)} was selected based on the criterion evidence.`).trim();
    const whyLower = String(item.whyNotLower || half.whyAboveLowerBand || `Not Band ${lower.toFixed(1)} because the response shows enough relevant control for Band ${band.toFixed(1)}.`).trim();
    const whyHigher = String(item.whyNotHigher || half.whyBelowUpperBand || `Not Band ${higher.toFixed(1)} because the limiting evidence prevents a stronger band.`).trim();
    out[name] = {
      ...item,
      band,
      selectedBand: band,
      candidateBandsConsidered: Array.isArray(item.candidateBandsConsidered) && item.candidateBandsConsidered.length ? item.candidateBandsConsidered : [lower, band, higher],
      summary: String(item.summary || whyThis).trim(),
      summaryZh: String(item.summaryZh || "").trim(),
      whyThisBand: whyThis,
      whyThisBandZh: String(item.whyThisBandZh || item.summaryZh || half.whyExactBandZh || "").trim(),
      whyNotLower: whyLower,
      whyAboveLowerBand: String(item.whyAboveLowerBand || item.whyNotLower || half.whyAboveLowerBand || whyLower).trim(),
      whyNotLowerZh: String(item.whyNotLowerZh || item.whyAboveLowerBandZh || half.whyAboveLowerBandZh || "").trim(),
      whyNotHigher: whyHigher,
      whyNotYetHigherBand: String(item.whyNotYetHigherBand || item.whyNotHigher || half.whyBelowUpperBand || whyHigher).trim(),
      whyNotHigherZh: String(item.whyNotHigherZh || item.whyNotYetHigherBandZh || half.whyBelowUpperBandZh || "").trim(),
      howToImprove: String(item.howToImprove || item.improvementFocus || defaultImproveForCriterion(name)).trim(),
      howToImproveZh: String(item.howToImproveZh || item.improvementFocusZh || "").trim(),
      zhSummary: String(item.zhSummary || item.cardZh || item.chineseSummary || "").trim(),
      positiveEvidence: Array.isArray(item.positiveEvidence) ? item.positiveEvidence : [],
      positiveEvidenceZh: Array.isArray(item.positiveEvidenceZh) ? item.positiveEvidenceZh : [],
      limitingEvidence: Array.isArray(item.limitingEvidence) ? item.limitingEvidence : [],
      limitingEvidenceZh: Array.isArray(item.limitingEvidenceZh) ? item.limitingEvidenceZh : [],
      essayEvidence: Array.isArray(item.essayEvidence) ? item.essayEvidence : (Array.isArray(item.evidenceQuotes) ? item.evidenceQuotes : []),
      halfBandDecision: {
        whyAboveLowerBand: String(half.whyAboveLowerBand || whyLower).trim(),
        whyAboveLowerBandZh: String(half.whyAboveLowerBandZh || item.whyNotLowerZh || "").trim(),
        whyBelowUpperBand: String(half.whyBelowUpperBand || whyHigher).trim(),
        whyBelowUpperBandZh: String(half.whyBelowUpperBandZh || item.whyNotHigherZh || "").trim(),
        whyExactBand: String(half.whyExactBand || whyThis).trim(),
        whyExactBandZh: String(half.whyExactBandZh || item.whyThisBandZh || item.summaryZh || "").trim()
      }
    };
  });
  return out;
}

function buildTaskProfile(body, signals) {
  return signals.task === "Task 1"
    ? {
        task: "Task 1",
        criterion: "Task Achievement",
        scoringProfile: taskRuleLabel("Task 1"),
        anchorBands: TASK1_BAND_ANCHORS_0_TO_9,
        gateRules: TASK1_GATE_RULES,
        bulletPoints: signals.task1BulletPoints,
        taskRequirementAudit: signals.taskRequirementAudit || null,
        letterStyle: body.letterStyle || "",
        purposeRequired: true,
        requiredMinimumWords: 150
      }
    : {
        task: "Task 2",
        criterion: "Task Response",
        scoringProfile: taskRuleLabel("Task 2"),
        anchorBands: TASK2_BAND_ANCHORS_0_TO_9,
        gateRules: TASK2_GATE_RULES,
        questionType: signals.task2QuestionProfile?.questionType || body.questionType || "general_essay",
        requiredParts: signals.task2QuestionProfile?.requiredParts || [],
        taskRequirementAudit: signals.taskRequirementAudit || null,
        positionRequired: Boolean(signals.task2QuestionProfile?.positionRequired),
        requiredMinimumWords: 250
      };
}


function combineGate(localGate, aiGate) {
  const localTriggered = Boolean(localGate?.status === "triggered" || localGate?.localTriggered);
  const ai = aiGate && typeof aiGate === "object" ? aiGate : {};
  const status = localTriggered ? "triggered" : (ai.status || localGate?.status || "passed");
  return {
    ...(ai || {}),
    ...(localGate || {}),
    status,
    reason: String(localGate?.reason || ai.reason || ai.explanation || ai.note || "Gate checked.").trim(),
    reasonZh: String(localGate?.reasonZh || ai.reasonZh || ai.explanationZh || ai.noteZh || "").trim(),
    evidence: Array.isArray(ai.evidence) ? ai.evidence : (Array.isArray(localGate?.evidence) ? localGate.evidence : [])
  };
}

function buildHardBoundaryAudit(criteria, signals, anchorComparison = {}, criterionCalibration = {}, existing = {}) {
  const { rawAverage, finalBand } = averageBand(criteria);
  const wordBoundary = getWordCountBoundaryProfile(signals.task, signals.wordCount);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchorComparison, criterionCalibration);
  const warnings = collectScoreWarnings(criteria, signals);
  const feedbackQualityIssues = existing?.skipFeedbackQualityAudit ? [] : criterionFeedbackQualityIssues(criterionCalibration);
  const anchorBand = Number(anchorComparison?.closestAnchorBand);
  const anchorMissing = Boolean(anchorComparison?.anchorMissing || anchorComparison?.anchorSource === "local_fallback_missing_ai_anchor");
  const anchorConflict = Number.isFinite(anchorBand) && Number.isFinite(finalBand) && Math.abs(anchorBand - finalBand) > 1;
  const values = scoreValues(criteria);
  const allSame = allCriteriaSame(criteria);
  const allFourSeven = values.length === 4 && values.every((x) => x === 7);
  const lowBandScoreTooHigh = Boolean(wordBoundary.triggered && Number.isFinite(finalBand) && Number.isFinite(wordBoundary.upper) && finalBand > wordBoundary.upper);
  const band6AccessConflict = Boolean(signals.task === "Task 2" && signals.wordCount < 230 && values.some((x) => x >= 6) && (signals.rateabilityStatus !== "clearly_rateable" || wordBoundary.triggered));
  const names = criterionNames(signals.task);
  const firstCriterionBand = Number(criteria[names[0]]);
  const lrBand = Number(criteria["Lexical Resource"]);
  const graBand = Number(criteria["Grammatical Range and Accuracy"]);
  const weakLanguageHighScoreConflict = Boolean((signals.lexicalControl === "weak" || signals.spellingErrorDensity === "high") && lrBand >= 5.5) || Boolean((signals.sentenceControl === "weak" || signals.grammarErrorDensity === "high") && graBand >= 5.5);
  const fullLengthWeakLanguageOverallConflict = Boolean(!wordBoundary.triggered && Number.isFinite(finalBand) && finalBand >= 6 && (signals.lexicalControl === "weak" || signals.sentenceControl === "weak" || signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high"));
  const task1BelowLengthHighTAConflict = Boolean(signals.task === "Task 1" && Number(signals.wordCount) < 150 && Number.isFinite(firstCriterionBand) && firstCriterionBand >= 6);
  const reviewReasons = [];
  if (anchorMissing) reviewReasons.push("AI did not provide an independent anchor comparison.");
  if (lowBandScoreTooHigh) reviewReasons.push(`Final Band ${finalBand.toFixed(1)} exceeds local word-count boundary ${wordBoundary.suggestedRange}.`);
  if (allFourSeven) reviewReasons.push("All four criterion bands are exactly Band 7.0; this must be reviewed for possible 7.5/8.0+ or justified as true Band 7.");
  if (highCandidate.triggered) reviewReasons.push(highCandidate.reason);
  if (anchorConflict) reviewReasons.push(`Anchor Band ${anchorBand} differs from final Band ${finalBand.toFixed(1)} by more than 1.0.`);
  if (allSame && finalBand >= 5) reviewReasons.push("All four criterion bands are identical; forced differentiation review is required.");
  if (band6AccessConflict) reviewReasons.push("Band 6+ access conflict: short or weakly rateable Task 2 needs real development evidence.");
  if (weakLanguageHighScoreConflict) reviewReasons.push("Language-control conflict: weak spelling/lexical or grammar/sentence-control signals require LR/GRA boundary review.");
  if (fullLengthWeakLanguageOverallConflict) reviewReasons.push("Full-length but weak-language conflict: overall 6.0+ requires strong evidence despite high local language-error signals.");
  if (task1BelowLengthHighTAConflict) reviewReasons.push("Task 1 below recommended length but Task Achievement is 6.0+; bullet detail and purpose/tone must be reviewed.");
  if (feedbackQualityIssues.length) reviewReasons.push(`Criterion feedback quality issue: ${feedbackQualityIssues.slice(0, 4).join(" | ")}`);
  return {
    version: "strict-boundary-audit-v6",
    localScoringApplied: false,
    localParticipation: "The server does not assign bands, but it performs hard local gate audit, boundary-trigger detection, structural validation, and AI re-review routing before score freeze.",
    status: reviewReasons.length ? "review_required" : "passed",
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    wordCountBoundary: wordBoundary,
    lowBandBoundary: {
      status: wordBoundary.triggered ? "triggered" : "passed",
      suggestedRange: wordBoundary.suggestedRange,
      scoreTooHigh: lowBandScoreTooHigh,
      reason: wordBoundary.reason
    },
    highBandBoundary: {
      status: highCandidate.triggered || allFourSeven ? "triggered" : "passed",
      allFourSeven,
      highCandidate: highCandidate.triggered,
      reason: highCandidate.reason
    },
    anchorAudit: {
      status: anchorMissing || anchorConflict ? "triggered" : "passed",
      anchorMissing,
      anchorConflict,
      closestAnchorBand: Number.isFinite(anchorBand) ? anchorBand : null,
      finalBand
    },
    scoreProfileAudit: {
      status: (warnings.length || allSame || weakLanguageHighScoreConflict || fullLengthWeakLanguageOverallConflict || task1BelowLengthHighTAConflict) ? "triggered" : "passed",
      allCriteriaSame: allSame,
      weakLanguageHighScoreConflict,
      fullLengthWeakLanguageOverallConflict,
      task1BelowLengthHighTAConflict,
      feedbackQualityIssues,
      warnings
    },
    firstPass: existing.firstPass || null,
    boundaryReview: existing.boundaryReview || null,
    rawAverage,
    finalBand
  };
}


function boundaryStepMessage(stage, result = {}) {
  const audit = result.boundaryAudit || {};
  const meta = result.scoreCoreMeta || {};
  const signals = result.localSignals || {};
  if (stage === "score-precheck") {
    return `本地文本检查完成：${signals.wordCount ?? "-"} words，${signals.paragraphCount ?? "-"} 段，${signals.sentenceCount ?? "-"} 句，可评分性：${signals.rateabilityStatus || "pending"}。`;
  }
  if (stage === "score-task-router") {
    return `任务分流完成：${result.task || signals.task || "unknown"}，已选择 ${result.task === "Task 1" || signals.task === "Task 1" ? "GT Task 1 Letter" : "GT Task 2 Essay"} 评分规则。`;
  }
  if (stage === "score-anchor") {
    const anchor = result.anchorComparison || {};
    return anchor.anchorMissing
      ? "AI 独立锚点判断未返回有效结果；后续必须触发边界复核，不能直接冻结。"
      : `AI 独立锚点完成：closest anchor Band ${anchor.closestAnchorBand ?? "-"}，候选区间 ${anchor.candidateRange || `${anchor.lowerAnchorBand ?? "-"}-${anchor.higherAnchorBand ?? "-"}`}。`;
  }
  if (stage === "score-criteria") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    return `AI 四项初评完成：初始 Overall Band ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}；半分理由、证据和 anchor 已返回。`;
  }
  if (stage === "score-boundary-audit") {
    const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
    return audit.reviewRequired
      ? `本地 hard audit 触发 ${reasons.length || 1} 项复核：${reasons.slice(0, 3).join("；")}${reasons.length > 3 ? "..." : ""}`
      : "本地 hard audit 通过：没有发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  }
  if (stage === "score-boundary-review") {
    if (audit.boundaryReview?.triggered || meta.boundaryReviewApplied) {
      return `AI 二次边界复核完成：${audit.boundaryReview?.decision || "reviewed"}。${audit.boundaryReview?.whyFinalCriteriaAreSafe || "AI 已重新确认最终四项分。"}`;
    }
    return "AI 二次边界复核跳过：本地 hard audit 未发现必须二次复核的风险。";
  }
  if (stage === "score-finalize") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    return `最终验证完成：四项最终分已冻结，机械平均后的 Overall Band 为 ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}。`;
  }
  return "阶段状态已更新。";
}

function buildDetailedScoringProgress(stageKey, result = {}, status = "done") {
  const idx = Math.max(0, DETAILED_SCORING_STEPS.findIndex((step) => step.stage === stageKey));
  const currentIndex = idx >= 0 ? idx : 0;
  const steps = DETAILED_SCORING_STEPS.map((step, index) => {
    const done = index <= currentIndex;
    return {
      ...step,
      index: index + 1,
      status: done ? "done" : "waiting",
      message: done ? boundaryStepMessage(step.stage, result) : step.description,
      detail: step.stage === "score-boundary-audit" ? result.boundaryAudit || null : step.stage === "score-boundary-review" ? result.boundaryAudit?.boundaryReview || null : null
    };
  });
  return {
    version: SCORE_SYSTEM_VERSION,
    totalSteps: DETAILED_SCORING_STEPS.length,
    currentStep: currentIndex + 1,
    currentStage: stageKey,
    status,
    updatedAt: new Date().toISOString(),
    steps
  };
}

function withDetailedProgress(result, stageKey, status = "done") {
  const progress = buildDetailedScoringProgress(stageKey, result, status);
  return { ...result, detailedScoringProgress: progress, scoringProgress: progress };
}

function attachSinglePassProgress(result, status = "done") {
  const internal = buildDetailedScoringProgress("score-finalize", result, status);
  const visible = buildVisibleProgress(result, status);
  return {
    ...result,
    visibleProgress: visible,
    scoringProgress: visible,
    detailedScoringProgress: internal,
    internalAuditTrail: internal.steps.map((step) => ({
      stage: step.stage,
      title: step.title,
      status: step.status,
      message: step.message,
      detail: step.detail || null
    }))
  };
}

function boundaryAuditSummaryZh(audit = {}) {
  const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
  if (!reasons.length) return "本地硬性校准通过：未发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  return `本地硬性校准触发二次复核：${reasons.join("；")}`;
}

function boundaryReviewEvidenceText(reviewed = {}, review = {}, audit = {}) {
  return [
    review?.whyFinalCriteriaAreSafe,
    review?.whyFinalCriteriaAreSafeZh,
    review?.allFourSevenResolution ? JSON.stringify(review.allFourSevenResolution) : "",
    reviewed?.examinerSummary,
    reviewed?.examinerSummaryZh,
    reviewed?.criterionCalibration ? JSON.stringify(reviewed.criterionCalibration) : "",
    audit?.reviewReasons ? audit.reviewReasons.join(" ") : ""
  ].filter(Boolean).join(" ");
}

function hasStrongBoundaryKeepEvidence(reviewed = {}, review = {}, audit = {}) {
  const text = boundaryReviewEvidenceText(reviewed, review, audit);
  const hasConcreteLimitation = /specific limitation|concrete limitation|not fully developed|not fully extended|minor imprecision|limited sophistication|some mechanical|not consistently|occasional error|rare error|lexical limitation|grammar limitation|cohesion limitation|prevents 7\.5|prevents 8|prevents 9|不能达到|限制|不足|不够|未能/i.test(text);
  const hasResolution = Boolean(review?.allFourSevenResolution?.resolved || review?.allFourSevenResolution?.criteriaDecisions || review?.whyFinalCriteriaAreSafe);
  return hasResolution && hasConcreteLimitation && String(text).length > 180;
}

function unresolvedCriticalBoundaryReasons(reviewed = {}, audit = {}) {
  const criteria = reviewed.finalCriteria || reviewed.criteria || {};
  const { finalBand } = averageBand(criteria);
  const reasons = [];
  // v7.4: boundary audit is diagnostic, not a user-visible crash trigger.
  // Low-word-count, all-four-7 and all-same-high profiles must trigger review/warnings,
  // but after review they should freeze with warnings instead of returning HTTP 502.
  if (audit.anchorAudit?.anchorMissing && !hasUsableAnchorComparison(reviewed.anchorComparison)) {
    reasons.push("Independent anchor comparison is still missing after boundary review.");
  }
  if (!Number.isFinite(finalBand)) reasons.push("Final band is not numeric.");
  return reasons;
}

function assertFinalCanFreeze(result = {}) {
  const criteria = result.finalCriteria || result.criteria || {};
  const { finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) {
    const error = new Error("Final score freeze blocked: final band is not numeric.");
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
  const audit = result.boundaryAudit || {};
  const unresolved = Array.isArray(audit.unresolvedCriticalReasons) ? audit.unresolvedCriticalReasons : [];
  const critical = unresolved.filter((item) => /not numeric|missing.*anchor/i.test(String(item)));
  if (critical.length) {
    const error = new Error(`Final score freeze blocked by critical scoring integrity issue: ${critical.join("; ")}`);
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
  // v7.4: Do not crash for score-profile review warnings such as low-word-count boundary,
  // all-four-7, or all-same-high. Those are preserved in boundaryAudit and stabilityWarnings.
}

function buildBoundaryReviewPrompt(body, firstResult, audit) {
  const signals = resolveScoringSignals(body, firstResult);
  const task = signals.task;
  const names = criterionNames(task);
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  return [
    "You are the second-pass IELTS GT Writing boundary examiner. Return compact valid JSON only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. The server does not assign bands locally; it only audits and freezes AI-returned criterion bands.`,
    `Task: ${task}. Criteria must be exactly: ${names.join(", ")}.`,
    `Task-specific high/low band boundary protocol:\n${bandBoundaryProtocolForTask(task)}`,
    `Local boundary profile: ${JSON.stringify(localBoundaryProfile)}`,
    "Only re-check scoring boundaries. Do not generate detailed feedback, corrections, translations, or model answers in this boundary review.",
    "If the first score violates a boundary, revise the criterion bands yourself. If you keep them, give compact concrete evidence.",
    "For all-four Band 7 cases, actively check whether any criterion should be 7.5/8/8.5/9. If you keep 7/7/7/7, give a concise limitation; do not force a server error.",
    "If the independent anchor or the essay quality suggests Band 8/9 and final score remains 7.0 or below, revise upward unless there are clear concrete limitations. If a polished full response is kept at 7/7.5, identify exact limitations in task fulfilment, cohesion, lexis and grammar. High-band same scores are allowed when justified.",
    "For weak full-length essays, lower LR/GRA specifically when spelling/grammar control is weak; do not over-penalise TR/TA or CC unless content/organisation is also weak.",
    "JSON safety: no markdown, no comments, no trailing prose, no unescaped double quotes inside strings. Use single quotes for student phrases.",
    `Local signals: ${JSON.stringify(signals)}`,
    `Hard audit requiring review: ${JSON.stringify(audit)}`,
    `First compact score: ${JSON.stringify({ criteria: firstResult.finalCriteria || firstResult.criteria, overallBand: firstResult.overallBand, anchorComparison: firstResult.anchorComparison, shortReasons: firstResult.shortReasons, examinerSummary: firstResult.examinerSummary })}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly this compact shape: {\"ok\":true,\"aiStage\":\"score-boundary-review\",\"task\":\"Task 1 or Task 2\",\"anchorComparison\":{\"closestAnchorBand\":number,\"lowerAnchorBand\":number,\"higherAnchorBand\":number,\"candidateRange\":\"x-y\",\"whyCloserToThisBand\":\"max 30 words\",\"whyNotLowerAnchor\":\"max 25 words\",\"whyNotHigherAnchor\":\"max 25 words\"},\"criteria\":{...four criterion bands as numbers...},\"shortReasons\":{\"Criterion Name\":\"max 18 words, concrete reason\"},\"boundaryReview\":{\"triggered\":true,\"decision\":\"revised\" or \"kept_after_review\",\"reviewReasons\":[\"short reason\"],\"whyFinalCriteriaAreSafe\":\"max 45 words\",\"whyFinalCriteriaAreSafeZh\":\"中文简短说明\",\"firstCriteria\":{...},\"finalCriteria\":{...},\"allFourSevenResolution\":{\"resolved\":boolean,\"keptAllSeven\":boolean,\"criteriaDecisions\":{}}},\"examinerSummary\":\"max 35 words\"}."
  ].join("\n\n");
}

async function applyBoundaryReviewIfNeeded(body, firstResult) {
  const signals = resolveScoringSignals(body, firstResult);
  const initialAudit = firstResult.boundaryAudit || buildHardBoundaryAudit(firstResult.finalCriteria || firstResult.criteria, signals, firstResult.anchorComparison || {}, firstResult.criterionCalibration || {}, { skipFeedbackQualityAudit: true });
  if (!initialAudit.reviewRequired) {
    return { ...firstResult, boundaryAudit: { ...initialAudit, status: "passed", reviewRequired: false } };
  }
  let ai;
  try {
    ai = await callDeepSeek([
      { role: "system", content: "You are an IELTS GT Writing boundary-review scoring engine. You score only; no editing advice." },
      { role: "user", content: buildBoundaryReviewPrompt(body, firstResult, initialAudit) }
    ], 3600, 0);
  } catch (error) {
    return {
      ...firstResult,
      boundaryAudit: {
        ...initialAudit,
        status: "review_skipped_ai_error_freeze_first_pass",
        reviewRequired: false,
        freezeBlocked: false,
        boundaryReview: {
          triggered: true,
          decision: "skipped_ai_error",
          reviewReasons: initialAudit.reviewReasons || [],
          error: String(error?.message || error),
          whyFinalCriteriaAreSafe: "Boundary review call failed; first-pass score will be frozen with local calibration and warnings rather than returning HTTP 500.",
          whyFinalCriteriaAreSafeZh: "边界复核调用失败；系统将冻结首轮分数并保留本地校准和警告，避免接口报错。"
        }
      },
      stabilityWarnings: [...new Set([...(firstResult.stabilityWarnings || []), `Boundary review AI call failed: ${String(error?.message || error)}`])],
      scoreCoreMeta: { ...(firstResult.scoreCoreMeta || {}), boundaryReviewed: false, boundaryReviewApplied: false, boundaryReviewErrorRecovered: true, scoreFrozen: false }
    };
  }
  const independentAnchor = hasUsableAnchorComparison(firstResult.anchorComparison) ? firstResult.anchorComparison : null;
  const reviewedBase = await normalizeScoreCoreResultWithZeroRescue(ai, body, signals, { fromBoundaryReview: true, independentAnchor, skipFeedbackQualityAudit: true });
  const reviewed = {
    ...reviewedBase,
    anchorComparison: (!reviewedBase.anchorComparison?.anchorMissing ? reviewedBase.anchorComparison : (independentAnchor || reviewedBase.anchorComparison))
  };
  const reviewedAuditRaw = buildHardBoundaryAudit(reviewed.finalCriteria || reviewed.criteria, signals, reviewed.anchorComparison || {}, reviewed.criterionCalibration || {}, {
    firstPass: {
      criteria: firstResult.finalCriteria || firstResult.criteria,
      overallBand: firstResult.overallBand,
      anchorComparison: firstResult.anchorComparison,
      audit: initialAudit
    },
    skipFeedbackQualityAudit: true,
    boundaryReview: {
      triggered: true,
      decision: ai.boundaryReview?.decision || "reviewed",
      reviewReasons: initialAudit.reviewReasons,
      whyFinalCriteriaAreSafe: ai.boundaryReview?.whyFinalCriteriaAreSafe || ai.boundaryReview?.explanation || "Boundary review completed by AI.",
      whyFinalCriteriaAreSafeZh: ai.boundaryReview?.whyFinalCriteriaAreSafeZh || "AI 已完成边界复核并返回最终四项分。"
    }
  });
  const boundaryReview = {
    ...reviewedAuditRaw.boundaryReview,
    allFourSevenResolution: ai.boundaryReview?.allFourSevenResolution || ai.allFourSevenResolution || null
  };
  const auditForResolution = { ...reviewedAuditRaw, boundaryReview };
  const unresolvedCriticalReasons = unresolvedCriticalBoundaryReasons(reviewed, auditForResolution);
  const freezeBlocked = unresolvedCriticalReasons.length > 0;
  const reviewedStatus = freezeBlocked
    ? "review_failed_unresolved"
    : reviewedAuditRaw.reviewRequired
      ? "reviewed_passed_with_strong_evidence"
      : "reviewed_passed";
  return {
    ...reviewed,
    boundaryAudit: {
      ...reviewedAuditRaw,
      status: reviewedStatus,
      reviewRequired: freezeBlocked,
      freezeBlocked,
      unresolvedCriticalReasons,
      reviewedRemainingWarnings: reviewedAuditRaw.reviewReasons,
      firstPass: reviewedAuditRaw.firstPass,
      boundaryReview
    },
    stabilityWarnings: [...new Set([...(reviewed.stabilityWarnings || []), ...(reviewedAuditRaw.reviewReasons || []).map((x) => `Boundary review note: ${x}`), ...unresolvedCriticalReasons.map((x) => `Boundary freeze block: ${x}`)])],
    scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), boundaryReviewed: true, boundaryReviewApplied: true, freezeBlocked, scoreFrozen: false }
  };
}

function gateStatus(reason, triggered = false) {
  return { status: triggered ? "triggered" : "passed", reason };
}

function buildLocalGateReport(criteria, signals, existing = {}, anchorComparison = {}, calibration = {}) {
  const warnings = collectScoreWarnings(criteria, signals);
  const profile = existing && typeof existing === "object" ? existing : {};
  const names = criterionNames(signals.task);
  const first = criteria[names[0]];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];
  const wordBoundary = getWordCountBoundaryProfile(signals.task, signals.wordCount);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchorComparison, calibration);
  const localLow = gateStatus(wordBoundary.triggered ? `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.` : "No hard low-band word-count boundary detected.", wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited");
  const localMid = gateStatus("Mid-band gate checked: visible structure alone must not over-reward TR/TA or CC, and LR/GRA are checked against language-control signals.", Boolean((first >= 5.5 || cc >= 5.5 || lr >= 5.5 || gra >= 5) && (signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak" || signals.sentenceControl === "weak")));
  const localHigh = gateStatus(highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => x >= 7.5));
  const localProfile = gateStatus(warnings.length ? warnings.join(" ") : "No major score-profile instability detected.", warnings.length > 0 || allCriteriaSame(criteria));
  const reqAudit = signals.taskRequirementAudit || null;
  const localRequirement = gateStatus(reqAudit?.summary || "Task-specific requirement audit not available.", Boolean(reqAudit?.triggered));
  return {
    likelyOverallRange: profile.likelyOverallRange || (wordBoundary.triggered ? wordBoundary.suggestedRange : (signals.rateabilityStatus === "clearly_rateable" ? "rateable; band depends on criterion evidence" : "limited or weakly rateable")),
    lowBandGate: combineGate(localLow, profile.lowBandGate),
    midBandGate: combineGate(localMid, profile.midBandGate),
    highBandGate: combineGate(localHigh, profile.highBandGate),
    taskRequirementGate: combineGate(localRequirement, profile.taskRequirementGate),
    scoreProfileGate: combineGate(localProfile, profile.scoreProfileGate)
  };
}
function normalizeScoreCoreResult(ai, body, signals, options = {}) {
  const task = signals.task === "Task 1" ? "Task 1" : "Task 2";
  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI returned incomplete criterion bands.");
  const warnings = collectScoreWarnings(criteria, signals);
  const rawAnchor = ai.anchorComparison || ai.anchorCalibration || options.independentAnchor || {};
  let anchorComparison = normalizeAnchorComparison(rawAnchor, task, criteria, signals);
  if (anchorComparison.anchorMissing && hasUsableAnchorComparison(options.independentAnchor)) {
    anchorComparison = normalizeAnchorComparison(options.independentAnchor, task, criteria, signals);
  }
  const criterionCalibration = normalizeCriterionCalibration(ai.criterionCalibration || {}, criteria, task);
  const scoreProfile = buildLocalGateReport(criteria, signals, ai.scoreProfile || {}, anchorComparison, criterionCalibration);
  const taskSpecificGate = normalizeTaskSpecificGate(ai.taskSpecificGate || {}, signals, criteria, anchorComparison, criterionCalibration);
  const boundaryAudit = buildHardBoundaryAudit(criteria, signals, anchorComparison, criterionCalibration, { ...(ai.boundaryAudit || {}), skipFeedbackQualityAudit: Boolean(options.skipFeedbackQualityAudit) });
  return {
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_gt_letter_single_pass_strict_anchor_v7" : "task2_essay_single_pass_strict_anchor_v7",
      formula: "Single-pass task-aware 0-9 anchor pipeline: AI independent anchor, AI criterion scoring, local hard audit, AI boundary review when triggered, final AI-returned criterion bands averaged and rounded to nearest 0.5. Local code audits and freezes, but does not assign bands.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment. The server performs hard validation/audit and may require AI boundary review, then mechanically averages AI-returned final criterion bands."
    },
    scoreCoreMeta: {
      scoreFirst: true,
      scoreFrozen: !boundaryAudit.reviewRequired,
      adviceSystemRemoved: true,
      anchorCalibrated: true,
      strictBoundaryAudited: true,
      taskAware: true,
      fromBoundaryReview: Boolean(options.fromBoundaryReview),
      generatedAt: new Date().toISOString()
    },
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration,
    scoreProfile,
    taskSpecificGate,
    boundaryAudit,
    diagnosticSignals: ai.diagnosticSignals || {},
    examinerSummary: String(ai.examinerSummary || "").trim(),
    examinerSummaryZh: String(ai.examinerSummaryZh || "").trim(),
    stabilityWarnings: warnings,
    localScoreChanged: false
  };
}


function buildCompactScorePrompt(body, signals, independentAnchor = null) {
  const task = signals.task;
  const names = criterionNames(task);
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  const compactSignals = {
    task: signals.task,
    wordCount: signals.wordCount,
    paragraphCount: signals.paragraphCount,
    sentenceCount: signals.sentenceCount,
    rateabilityStatus: signals.rateabilityStatus,
    recommendedMinimum: signals.recommendedMinimum,
    spellingIssueCount: signals.spellingIssueCount,
    spellingErrorDensity: signals.spellingErrorDensity,
    grammarIssueSignalCount: signals.grammarIssueSignalCount,
    grammarErrorDensity: signals.grammarErrorDensity,
    weakPhraseCount: signals.weakPhraseCount,
    lexicalControl: signals.lexicalControl,
    sentenceControl: signals.sentenceControl,
    lexicalNaturalnessRisk: signals.lexicalNaturalnessRisk,
    task1BulletCount: Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints.length : 0,
    task2QuestionType: signals.task2QuestionProfile?.questionType || "",
    taskRequirementAudit: signals.taskRequirementAudit ? {
      version: signals.taskRequirementAudit.version,
      triggered: signals.taskRequirementAudit.triggered,
      missingCount: signals.taskRequirementAudit.missingCount,
      partlyCount: signals.taskRequirementAudit.partlyCount,
      taskAchievementCap: signals.taskRequirementAudit.taskAchievementCap,
      taskResponseCap: signals.taskRequirementAudit.taskResponseCap,
      summary: signals.taskRequirementAudit.summary
    } : null
  };
  const anchorMini = anchorSetForTask(task).map((item) => `B${item.band}: ${item.profile}`).join(" | ");
  const taskMini = task === "Task 1"
    ? `Task 1 bullet points extracted: ${JSON.stringify(signals.task1BulletPoints || [])}. Judge each bullet as covered, partly_covered or missing. Local task-requirement audit: ${JSON.stringify(signals.taskRequirementAudit || {})}.`
    : `Task 2 question profile: ${JSON.stringify(signals.task2QuestionProfile || {})}. Judge the exact question type and each required part. Local task-requirement audit: ${JSON.stringify(signals.taskRequirementAudit || {})}.`;
  return [
    "You are an IELTS GT Writing SCORE KERNEL. Return one tiny valid JSON object only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. Task: ${task}. Criteria keys must be exactly ${JSON.stringify(names)}.`,
    "The selected scoring task is locked by the request. Do not reclassify this response as the other IELTS task. If the writing style resembles another task, treat that as a task-response/achievement issue within the locked task, not permission to change rubrics.",
    "This is Step 2: AI core scoring only. Forbidden in this step: Chinese, long explanations, original quotations, detailed feedback, evidence arrays, taskSpecificGate, scoreProfile, criterionCalibration, corrections, translations, revision/model answers, markdown, comments, trailing prose.",
    "Return only anchorBand, candidateRange, four criterion bands, reasonCodes, and flags. Keep all strings as short snake_case codes. Do not quote the student's text.",
    "Use bands 0-9 in 0.5 increments. The server will average four criteria and run local boundary audit. Do not output overallBand.",
    "Band 0 is forbidden for any response containing assessable English, a relevant opinion, a reason, an example, or any real attempt to answer the prompt. Band 0 is only for blank, wholly non-English, explicit no-answer, or completely unassessable submissions. Very weak but rateable writing must be scored from Band 1.0 upward, not Band 0.",
    "If you believe a criterion is near zero but the essay has any topical English content, use a low positive half-band and explain the concrete limitation; do not output 0.0.",
    "For a weak but on-topic Task 2 answer that states a position, Task Response must be a low positive band, not Band 0. Band 0 means no assessable response, not merely no examples.",
    "Half-band rule: use X.5 when performance is clearly above X.0 but not stable at X+1.0. Do not prefer whole bands by default.",
    "Low-band rule: do not lift short/weak writing because it has paragraph labels. Full-length but weak-language writing should usually have lower LR/GRA, while TR/TA and CC may be higher only if content and organisation justify it.",
    "Task-specific requirement rule: for Task 1, judge every extracted bullet separately and cap Task Achievement when any bullet is missing or only partly covered. For Task 2, judge the exact question type and cap Task Response when a required part is missing: both views, own opinion, advantages, disadvantages, outweigh judgement, causes, problems, solutions, or positive/negative judgement. A general answer to the topic is not enough.",
    "Sub-7 strict rule: below Band 7, be closer to real exam strictness. Do not award 5.5/6.0/6.5 just because the response is organised; require actual task completion, development, and language control.",
    "High-band rule: if task fulfilment, reasoning/cohesion, lexis and grammar are genuinely high-band, use 7.5/8/8.5/9 where justified; do not cap mature writing at four 7s. For polished, fully relevant, naturally organised answers with few errors, 8.0 is normal, not exceptional. Band 8.5/9 does not require literary native-speaker prose; it requires complete task fulfilment, natural control, precision and negligible errors. If the only limitation is that the text is not flamboyant, do not hold it at 7.5.", 
    "Score spread rule: avoid mechanical all-four-same bands. If criteria differ, use 0.5 spread. If all four are identical, reasonCodes must make the equality credible.",
    `Task boundary protocol: ${bandBoundaryProtocolForTask(task)}`,
    `0-9 anchor mini table: ${anchorMini}`,
    taskMini,
    `Compact local non-scoring signals: ${JSON.stringify(compactSignals)}`,
    `Local boundary profile: ${JSON.stringify({ wordBoundary: localBoundaryProfile.wordBoundary, languageWeak: localBoundaryProfile.languageWeak, languageModerate: localBoundaryProfile.languageModerate, highBandEligible: localBoundaryProfile.highBandEligible, lowBandRisk: localBoundaryProfile.lowBandRisk, midBandRisk: localBoundaryProfile.midBandRisk, likelyZone: localBoundaryProfile.likelyZone })}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"score-kernel\",\"task\":\"Task 1 or Task 2\",\"anchorBand\":number,\"candidateRange\":\"x-y\",\"criteria\":{...four criterion bands as numbers...},\"reasonCodes\":{\"Criterion Name\":[\"short_code\",\"short_code\"]},\"flags\":{\"lowBandRisk\":boolean,\"weakLanguage\":boolean,\"highBandCandidate\":boolean,\"allFourSeven\":boolean,\"boundaryReviewSuggested\":boolean}}"
  ].join("\n\n");
}

function compactCriterionCalibration(ai = {}, criteria = {}, task = "Task 2") {
  const names = criterionNames(task);
  const reasons = ai.shortReasons && typeof ai.shortReasons === "object" ? ai.shortReasons : (ai.reasonCodes && typeof ai.reasonCodes === "object" ? ai.reasonCodes : {});
  const out = {};
  names.forEach((name) => {
    const band = Number(criteria[name]);
    const rawReason = reasons[name] || reasons[name.replace("Task Achievement", "Task Response").replace("Task Response", "Task Achievement")];
    const reason = Array.isArray(rawReason) ? rawReason.join(", ") : String(rawReason || `Score kernel reason for Band ${Number.isFinite(band) ? band.toFixed(1) : "-"}.`).trim();
    out[name] = {
      band,
      selectedBand: band,
      summary: reason,
      whyThisBand: reason,
      whyNotLower: "Core score pass froze the band; detailed lower-bound evidence is generated after freeze.",
      whyNotHigher: "Core score pass froze the band; detailed higher-bound evidence is generated after freeze.",
      howToImprove: defaultImproveForCriterion(name),
      positiveEvidence: [],
      limitingEvidence: [],
      essayEvidence: [],
      compactOnly: true
    };
  });
  return out;
}
function buildCriterionFeedbackPrompt(body, frozenResult, signals) {
  const task = signals.task;
  const names = criterionNames(task);
  return [
    "You generate post-freeze IELTS criterion feedback. Return JSON only.",
    "The score is already frozen. Do not change any band, criterion score, anchor, boundary decision, or overall score.",
    "Write concise examiner-style feedback for the four criterion cards. Do not use generic IELTS stock wording.",
    "Each criterion card must feel written for this exact essay. Name the actual topic, position, paragraph behaviour, vocabulary pattern, grammar pattern, or missing support from the student's response.",
    "Bilingual requirement: every English feedback string must have a matching natural Simplified Chinese meaning field. Do not leave any Chinese field blank. Chinese must explain the exact English sentence, not only give a vague summary.",
    "For arrays, the Chinese array must have the same number of items and the same order as the English array, e.g. positiveEvidence[0] must match positiveEvidenceZh[0].",
    "Evidence requirement: for every criterion, include at least 1 essayEvidence object and preferably 2. Each quote must be a real short phrase or sentence fragment from the student's essay. Do not invent evidence.",
    "For essayEvidence, use objects only: {quote, meaning, meaningZh}. Do not return plain strings for essayEvidence.",
    "Card specificity rule: every whyThisBand, whyNotLower, whyNotHigher, and howToImprove must mention this essay's actual topic or claim. Do not write a generic examiner sentence that could fit another essay.",
    "Task Response card rule: refer to the student's exact claim(s), such as what benefit/risk/side they mentioned, and say exactly what explanation/example is missing. Do not only say vague opinions or no development.",
    "Coherence card rule: describe the actual paragraph flow or repeated sentence pattern in this essay. Do not only say basic structure or limited progression.",
    "Lexical and Grammar card rules: cite actual word choices, collocations, spelling/word-form problems, or sentence patterns when available; if none are quoted, explain the visible language feature concretely.",
    "For positiveEvidence and limitingEvidence, each item must identify a concrete feature, not a generic label. Good: 'clear position appears in the introduction'; bad: 'has some relevant ideas'.",
    "For halfBandDecision, include whyAboveLowerBandZh, whyBelowUpperBandZh, and whyExactBandZh. These are required.",
    "Every comment must refer to concrete features from the student's response. If a sentence could apply to any essay, rewrite it.",
    "Use natural boundary wording: whyThisBand = why this exact band fits; whyNotLower = what concrete performance prevents a lower adjacent half-band; whyNotHigher = what concrete limitation blocks the next adjacent half-band.",
    "Avoid these template phrases unless followed immediately by concrete essay-specific detail or a quote: 'related to the prompt', 'clear opinion', 'ideas are general', 'some errors', 'limited vocabulary', 'basic structure', 'no logical progression', 'no concrete examples'.",
    "Length limits per criterion: whyThisBand max 60 words; whyNotLower max 40 words; whyNotHigher max 45 words; howToImprove max 45 words; each Chinese translation should be concise but complete; zhSummary max 150 Chinese characters; max 2 positiveEvidence and max 2 limitingEvidence items; each evidence item max 18 words.",
    "Use single quotes around student phrases. Do not use unescaped double quotes inside JSON strings. No markdown and no trailing prose.",
    `Task: ${task}. Criteria: ${names.join(", ")}.`,
    `Frozen score: ${JSON.stringify({ criteria: frozenResult.finalCriteria || frozenResult.criteria, overallBand: frozenResult.overallBand, anchorComparison: frozenResult.anchorComparison, shortReasons: frozenResult.shortReasons })}`,
    `Local signals: ${JSON.stringify(signals)}`,
    `Task-specific boundary protocol:\n${bandBoundaryProtocolForTask(task)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly: {\"ok\":true,\"aiStage\":\"criterion-feedback-after-freeze\",\"feedbackStatus\":{\"status\":\"generated\",\"scoreChanged\":false},\"criterionCalibration\":{\"Criterion Name\":{\"band\":number,\"selectedBand\":number,\"candidateBandsConsidered\":[number,number,number],\"summary\":\"one sentence\",\"summaryZh\":\"对应 summary 的中文释义\",\"whyThisBand\":\"...\",\"whyThisBandZh\":\"对应 whyThisBand 的中文释义\",\"whyNotLower\":\"why above lower adjacent half-band\",\"whyNotLowerZh\":\"对应 whyNotLower 的中文释义\",\"whyNotHigher\":\"why not yet higher adjacent half-band\",\"whyNotHigherZh\":\"对应 whyNotHigher 的中文释义\",\"howToImprove\":\"...\",\"howToImproveZh\":\"对应 howToImprove 的中文释义\",\"zhSummary\":\"整张卡片的中文总结\",\"positiveEvidence\":[\"...\"],\"positiveEvidenceZh\":[\"逐条对应 positiveEvidence 的中文释义\"],\"limitingEvidence\":[\"...\"],\"limitingEvidenceZh\":[\"逐条对应 limitingEvidence 的中文释义\"],\"essayEvidence\":[{\"quote\":\"short quote from essay\",\"meaning\":\"what this quote proves\",\"meaningZh\":\"对应 meaning 的中文释义，并说明原文片段体现什么\"}],\"halfBandDecision\":{\"whyAboveLowerBand\":\"...\",\"whyAboveLowerBandZh\":\"对应中文\",\"whyBelowUpperBand\":\"...\",\"whyBelowUpperBandZh\":\"对应中文\",\"whyExactBand\":\"...\",\"whyExactBandZh\":\"对应中文\"}}}}."
  ].join("\n\n");
}


async function generateCriterionFeedbackAfterFreeze(body, frozenResult, signals) {
  try {
    const ai = await callDeepSeek([
      { role: "system", content: "You generate post-freeze IELTS criterion feedback. You must not change scores." },
      { role: "user", content: buildCriterionFeedbackPrompt(body, frozenResult, signals) }
    ], 3600, 0);
    const feedbackCalibration = normalizeCriterionCalibration(ai.criterionCalibration || {}, frozenResult.finalCriteria || frozenResult.criteria, signals.task);
    const qualityIssues = criterionFeedbackQualityIssues(feedbackCalibration);
    return {
      criterionCalibration: feedbackCalibration,
      feedbackStatus: {
        status: qualityIssues.length ? "generated_with_quality_warnings" : "generated",
        scoreChanged: false,
        qualityIssues,
        note: qualityIssues.length ? "Feedback generated, but some explanations may still be generic." : "Detailed criterion feedback generated after score freeze."
      }
    };
  } catch (error) {
    return {
      criterionCalibration: frozenResult.criterionCalibration,
      feedbackStatus: {
        status: "failed_after_score_freeze",
        scoreChanged: false,
        error: String(error?.message || error),
        note: "Core score was frozen successfully. Detailed criterion feedback failed and did not affect the score."
      }
    };
  }
}

function freezeReviewedScore(result = {}, body = {}, signals = {}) {
  const initialCriteria = normalizeCriteria(result.finalCriteria || result.criteria, signals.task);
  assertNoImpossibleZeroBand(initialCriteria, signals);
  const initialAverage = averageBand(initialCriteria);
  if (!Number.isFinite(initialAverage.finalBand)) throw new Error("AI returned incomplete criterion bands in compact score pass.");
  const initialAnchorComparison = normalizeAnchorComparison(result.anchorComparison || result.anchorCalibration || {}, signals.task, initialCriteria, signals);
  const localCalibration = applyLocalRegressionCalibration(initialCriteria, signals, initialAnchorComparison, body);
  const criteria = localCalibration.criteria;
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  const calibration = normalizeCriterionCalibration(result.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(result.anchorComparison || result.anchorCalibration || {}, signals.task, criteria, signals);
  const boundaryAuditBase = result.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration, { skipFeedbackQualityAudit: true });
  const boundaryAudit = localCalibration.changed ? { ...boundaryAuditBase, localCalibrationApplied: true, localCalibrationNotes: localCalibration.notes } : boundaryAuditBase;
  assertFinalCanFreeze({ ...result, criteria, finalCriteria: criteria, boundaryAudit, anchorComparison, criterionCalibration: calibration, localSignals: signals });
  return {
    ...result,
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: result.taskProfile || buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration: calibration,
    scoreProfile: buildLocalGateReport(criteria, signals, result.scoreProfile || {}, anchorComparison, calibration),
    taskSpecificGate: normalizeTaskSpecificGate(result.taskSpecificGate || {}, signals, criteria, anchorComparison, calibration),
    boundaryAudit: { ...boundaryAudit, reviewRequired: false, freezeBlocked: false },
    stabilityWarnings: collectScoreWarnings(criteria, signals),
    scoreCalculation: {
      mode: signals.task === "Task 1" ? "task1_gt_letter_v8_3_1_score_kernel_feedback_after_freeze" : "task2_essay_v8_3_1_score_kernel_feedback_after_freeze",
      formula: "v8.3.4 five-step pipeline: AI returns compact criterion bands; the request-locked task controls the rubric; strict hard-zero is limited to blank/non-English/explicit no-answer; AI Band 0 for rateable writing is rejected, retried, and routed to an AI no-zero rescue pass instead of being frozen. Feedback cannot change the score.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: localCalibration.changed,
      localScoreChangeExplanation: localCalibration.changed ? localCalibration.notes.map((n) => n.reason).join(" ") : "No local calibration changed the AI-returned criterion bands."
    },
    scoreCoreMeta: { ...(result.scoreCoreMeta || {}), scoreFirst: true, scoreFrozen: true, strictBoundaryAudited: true, sub7StrictCalibrated: true, localCalibrationApplied: localCalibration.changed, feedbackAfterFreeze: true, feedbackStagesMayNotChangeScore: true, compactScoreFirst: true, generatedAt: new Date().toISOString(), stage: "single-pass-score-core" },
    localScoreChanged: localCalibration.changed
  };
}

function anchorComparisonFromKernel(ai = {}, task = "Task 2", criteria = {}, signals = {}) {
  const rawBand = Number(ai.anchorBand ?? ai.closestAnchorBand ?? ai.anchorComparison?.closestAnchorBand);
  const fallback = defaultAnchorComparison(task, criteria, signals);
  const closest = Number.isFinite(rawBand) ? Math.max(0, Math.min(9, Math.round(rawBand))) : fallback.closestAnchorBand;
  const lower = Math.max(0, closest - 1);
  const higher = Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || {};
  const reasonCodes = ai.reasonCodes && typeof ai.reasonCodes === "object" ? JSON.stringify(ai.reasonCodes).slice(0, 500) : "score kernel reason codes";
  return normalizeAnchorComparison({
    anchorSystem: `${taskRuleLabel(task)} score-kernel anchor`,
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    candidateRange: String(ai.candidateRange || `${Math.max(0, closest - 0.5)}-${Math.min(9, closest + 0.5)}`),
    closestAnchorProfile: anchor.profile || "",
    closestAnchorProfileZh: anchor.zh || "",
    whyCloserToThisBand: `Score kernel selected Band ${closest} anchor using task fit, development and language-control reason codes: ${reasonCodes}`,
    whyNotLowerAnchor: `Reason codes show enough task response, organisation or language control to avoid the lower anchor.` ,
    whyNotHigherAnchor: `Reason codes show limitations preventing the next higher anchor.`,
    highBandCandidate: Boolean(ai.flags?.highBandCandidate),
    lowBandCandidate: Boolean(ai.flags?.lowBandRisk)
  }, task, criteria, signals);
}

function normalizeScoreKernelResult(ai, body, signals, boundaryProfile = null) {
  const task = signals.task || (body.task === "Task 1" ? "Task 1" : "Task 2");
  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI score kernel returned incomplete criterion bands.");
  const anchorComparison = anchorComparisonFromKernel(ai, task, criteria, signals);
  const criterionCalibration = compactCriterionCalibration(ai, criteria, task);
  const scoreProfile = buildLocalGateReport(criteria, signals, {}, anchorComparison, criterionCalibration);
  const taskSpecificGate = normalizeTaskSpecificGate({}, signals, criteria, anchorComparison, criterionCalibration);
  const boundaryAudit = buildHardBoundaryAudit(criteria, signals, anchorComparison, criterionCalibration, { skipFeedbackQualityAudit: true });
  const warnings = collectScoreWarnings(criteria, signals);
  return {
    ok: true,
    aiStage: "score-kernel",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration,
    scoreProfile,
    taskSpecificGate,
    boundaryAudit,
    shortReasons: ai.shortReasons || ai.reasonCodes || {},
    reasonCodes: ai.reasonCodes || {},
    boundaryFlags: ai.flags || ai.boundaryFlags || {},
    scoreKernel: {
      anchorBand: Number(ai.anchorBand ?? anchorComparison.closestAnchorBand),
      candidateRange: String(ai.candidateRange || anchorComparison.candidateRange || ""),
      flags: ai.flags || {},
      reasonCodes: ai.reasonCodes || {}
    },
    diagnosticSignals: { boundaryProfile: boundaryProfile || getLocalBandBoundaryProfile(signals) },
    examinerSummary: "Core score kernel completed. Detailed evidence is generated only after score freeze.",
    examinerSummaryZh: "核心评分内核已完成。详细证据只在分数冻结后生成。",
    stabilityWarnings: warnings,
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_gt_letter_v8_3_1_score_kernel" : "task2_essay_v8_3_1_score_kernel",
      formula: "v8.3.4 score-kernel pipeline: AI returns a tiny score kernel first; strict hard-zero is limited to blank/non-English/explicit no-answer; AI Band 0 for rateable writing is rejected, retried, and routed to an AI no-zero rescue pass; final AI-returned bands are frozen and averaged; detailed feedback cannot change the score.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment. The server audits, may require AI boundary review, freezes AI-returned bands, then optionally generates post-freeze feedback."
    },
    scoreCoreMeta: { scoreKernelFirst: true, scoreFrozen: false, feedbackAfterFreeze: true, compactScoreFirst: true, generatedAt: new Date().toISOString(), stage: "score-kernel" },
    localScoreChanged: false
  };
}

async function callScoreKernel(body, signals, boundaryProfile) {
  try {
    return await callDeepSeek([
      { role: "system", content: "You are an IELTS GT Writing score-kernel engine. Return one tiny valid JSON object only. No feedback, no Chinese, no quotes." },
      { role: "user", content: buildCompactScorePrompt(body, signals, null) }
    ], 1900, 0);
  } catch (error) {
    if (!/MalformedAiJsonError|malformed JSON|valid JSON|JSON/i.test(String(error?.name || "") + " " + String(error?.message || ""))) throw error;
    const names = criterionNames(signals.task);
    const compactSignals = {
      task: signals.task,
      wordCount: signals.wordCount,
      rateabilityStatus: signals.rateabilityStatus,
      spellingErrorDensity: signals.spellingErrorDensity,
      grammarErrorDensity: signals.grammarErrorDensity,
      lexicalControl: signals.lexicalControl,
      sentenceControl: signals.sentenceControl,
      boundaryProfile: boundaryProfile?.likelyZone || ""
    };
    const emergencyPrompt = [
      "Return one tiny valid JSON object only. No feedback. No Chinese. No evidence. No quotes from the essay.",
      `Task: ${signals.task}. Criteria keys: ${JSON.stringify(names)}.`,
      `Local signals: ${JSON.stringify(compactSignals)}`,
      `Prompt: ${body.questionPrompt || body.promptText || ""}`,
      `Essay: ${body.essay || ""}`,
      "JSON shape: {\"ok\":true,\"aiStage\":\"score-kernel\",\"task\":\"Task 1 or Task 2\",\"anchorBand\":number,\"candidateRange\":\"x-y\",\"criteria\":{...four numeric bands...},\"reasonCodes\":{\"Criterion Name\":[\"code\",\"code\"]},\"flags\":{\"lowBandRisk\":boolean,\"weakLanguage\":boolean,\"highBandCandidate\":boolean,\"allFourSeven\":boolean,\"boundaryReviewSuggested\":boolean}}"
    ].join("\n\n");
    return await callDeepSeek([
      { role: "system", content: "Emergency IELTS score-kernel JSON generator. Return JSON only." },
      { role: "user", content: emergencyPrompt }
    ], 1000, 0);
  }
}

async function retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, previousAi = {}) {
  const names = criterionNames(signals.task);
  const prompt = [
    "Return one tiny valid JSON object only. No feedback, no Chinese, no markdown.",
    `Task is locked as ${signals.task}. Criteria keys: ${JSON.stringify(names)}.`,
    "The previous score-kernel returned Band 0 for a response that is not strict hard-zero. That is invalid.",
    "Band 0 is only allowed for blank, wholly non-English, explicit no-answer, or completely unassessable submissions.",
    "This response must be scored as weak-but-rateable if it contains any relevant English attempt, opinion, reason, example, or answer to the prompt. Use Band 1.0-9.0 half-bands, not Band 0, unless it is truly blank/non-English/no-answer.",
    `Local signals: ${JSON.stringify({ task: signals.task, wordCount: signals.wordCount, paragraphCount: signals.paragraphCount, sentenceCount: signals.sentenceCount, rateabilityStatus: signals.rateabilityStatus, hardZeroGate: signals.hardZeroGate, boundaryProfile: boundaryProfile?.likelyZone || "" })}`,
    `Previous invalid compact result: ${JSON.stringify(previousAi).slice(0, 1200)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    `JSON shape: {"ok":true,"aiStage":"score-kernel","task":"Task 1 or Task 2","anchorBand":number,"candidateRange":"x-y","criteria":{...four numeric bands...},"reasonCodes":{"Criterion Name":["code","code"]},"flags":{"lowBandRisk":boolean,"weakLanguage":boolean,"highBandCandidate":boolean,"allFourSeven":boolean,"boundaryReviewSuggested":boolean}}`
  ].join("\n\n");
  return await callDeepSeek([
    { role: "system", content: "IELTS score-kernel zero-band retry. Return JSON only." },
    { role: "user", content: prompt }
  ], 1400, 0);
}


async function rescueScoreKernelWithoutZero(body, signals, boundaryProfile, previousAi = {}, previousError = null) {
  const names = criterionNames(signals.task);
  const prompt = [
    "Return one tiny valid JSON object only. No feedback, no Chinese, no markdown.",
    "This is an AI-only rescue scoring pass after repeated invalid Band 0 output.",
    `Task is locked as ${signals.task}. Criteria keys must be exactly ${JSON.stringify(names)}.`,
    "The server has confirmed this response is NOT strict hard-zero. It is not blank, not wholly non-English, and not an explicit no-answer.",
    "Therefore, Band 0 is not an available score for any criterion in this rescue pass.",
    "Score strictly from Band 1.0 to Band 9.0 in 0.5 increments. If performance is extremely weak, use Band 1.0 or 1.5, but never 0.0.",
    "Do not inflate the score. A weak list of opinions with no examples may still be very low, but it must be a positive IELTS band if it is assessable English.",
    "For Task Response/Task Achievement, distinguish: completely no answer = 0; topical attempt with an opinion but no development = low positive band, not 0.",
    "For Coherence, Lexical Resource, and Grammar, assign the lowest positive band that reflects the actual text if there is any assessable English.",
    `Local non-scoring signals: ${JSON.stringify({ task: signals.task, wordCount: signals.wordCount, paragraphCount: signals.paragraphCount, sentenceCount: signals.sentenceCount, rateabilityStatus: signals.rateabilityStatus, hardZeroGate: signals.hardZeroGate, boundaryProfile: boundaryProfile?.likelyZone || "" })}`,
    `Previous invalid result: ${JSON.stringify(previousAi).slice(0, 1500)}`,
    `Previous validation error: ${String(previousError?.message || previousError || "").slice(0, 500)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    `Return exactly: {"ok":true,"aiStage":"score-kernel","task":"${signals.task}","anchorBand":number,"candidateRange":"x-y","criteria":{...four numeric bands, all >= 1.0...},"reasonCodes":{"Criterion Name":["specific_code","specific_code"]},"flags":{"lowBandRisk":boolean,"weakLanguage":boolean,"highBandCandidate":boolean,"allFourSeven":boolean,"boundaryReviewSuggested":boolean}}`
  ].join("\n\n");
  return await callDeepSeek([
    { role: "system", content: "IELTS AI no-zero rescue scorer. Return JSON only. Never return Band 0 for non-hard-zero writing." },
    { role: "user", content: prompt }
  ], 1700, 0);
}

async function normalizeScoreKernelResultWithZeroRescue(ai, body, signals, boundaryProfile = null) {
  try {
    return normalizeScoreKernelResult(ai, body, signals, boundaryProfile);
  } catch (error) {
    if (error?.code !== "IMPOSSIBLE_ZERO_BAND") throw error;
    const retryAi = await retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, ai);
    try {
      const retried = normalizeScoreKernelResult(retryAi, body, signals, boundaryProfile);
      retried.scoreCoreMeta = { ...(retried.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRetryReason: String(error.message || error) };
      return retried;
    } catch (retryError) {
      if (retryError?.code !== "IMPOSSIBLE_ZERO_BAND") throw retryError;
      const rescueAi = await rescueScoreKernelWithoutZero(body, signals, boundaryProfile, retryAi, retryError);
      const rescued = normalizeScoreKernelResult(rescueAi, body, signals, boundaryProfile);
      rescued.scoreCoreMeta = { ...(rescued.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
      return rescued;
    }
  }
}

async function normalizeScoreCoreResultWithZeroRescue(ai, body, signals, options = {}) {
  try {
    return normalizeScoreCoreResult(ai, body, signals, options);
  } catch (error) {
    if (error?.code !== "IMPOSSIBLE_ZERO_BAND") throw error;
    const boundaryProfile = getLocalBandBoundaryProfile(signals);
    const retryAi = await retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, ai);
    try {
      const retried = normalizeScoreCoreResult(retryAi, body, signals, options);
      retried.scoreCoreMeta = { ...(retried.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRetryReason: String(error.message || error) };
      return retried;
    } catch (retryError) {
      if (retryError?.code !== "IMPOSSIBLE_ZERO_BAND") throw retryError;
      const rescueAi = await rescueScoreKernelWithoutZero(body, signals, boundaryProfile, retryAi, retryError);
      const rescued = normalizeScoreCoreResult(rescueAi, body, signals, options);
      rescued.scoreCoreMeta = { ...(rescued.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
      return rescued;
    }
  }
}

async function scoreCore(body) {
  const signals = resolveScoringSignals(body);
  const hardZeroGate = signals.hardZeroGate || detectHardZeroResponse(body, signals);
  if (isStrictHardZeroGate(hardZeroGate)) {
    return buildHardZeroScore(body, signals, hardZeroGate);
  }
  const boundaryProfile = getLocalBandBoundaryProfile(signals);

  // Step 2: one tiny AI score kernel call. No separate anchor call and no detailed feedback here.
  const kernelAi = await callScoreKernel(body, signals, boundaryProfile);
  const first = await normalizeScoreKernelResultWithZeroRescue(kernelAi, body, signals, boundaryProfile);

  // Step 3/4: local hard boundary audit first; AI boundary review only if the audit requires it.
  const reviewed = await applyBoundaryReviewIfNeeded(body, first);

  // Step 5A: freeze the AI-returned final criteria and mechanically average them.
  const frozen = freezeReviewedScore(reviewed, body, signals);

  // Step 5B: generate detailed criterion feedback after freeze. Failure does not change or remove the score.
  const feedback = await generateCriterionFeedbackAfterFreeze(body, frozen, signals);
  const withFeedback = {
    ...frozen,
    criterionCalibration: feedback.criterionCalibration || frozen.criterionCalibration,
    feedbackStatus: feedback.feedbackStatus,
    scoreCoreMeta: {
      ...(frozen.scoreCoreMeta || {}),
      fiveStepPipeline: true,
      scoreKernelFirst: true,
      scoreFrozenBeforeFeedback: true,
      feedbackGenerated: feedback.feedbackStatus?.status === "generated" || feedback.feedbackStatus?.status === "generated_with_quality_warnings",
      feedbackStatus: feedback.feedbackStatus?.status || "unknown"
    }
  };
  return attachSinglePassProgress(withFeedback, "done");
}

function scorePrecheck(body) {
  const signals = resolveScoringSignals(body);
  return withDetailedProgress({
    ok: true,
    aiStage: "score-precheck",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    note: "Precheck only. No criterion band is assigned in this stage."
  }, "score-precheck");
}

function scoreTaskRouterStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  return withDetailedProgress({
    ...current,
    ok: true,
    aiStage: "score-task-router",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), taskRouted: true, stage: "task-router" },
    note: "Task routed. No criterion band is assigned in this stage."
  }, "score-task-router");
}

async function scoreAnchorStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS GT Writing independent anchor classifier. Return JSON only. Do not assign criterion bands." },
    { role: "user", content: buildIndependentAnchorPrompt(body, signals) }
  ], 2800, 0);
  const anchorComparison = normalizeAnchorComparison(ai.anchorComparison || ai.anchorCalibration || ai, signals.task, {}, signals);
  if (anchorComparison.anchorMissing) throw new Error("Independent anchor classification did not return a usable anchorComparison.");
  return withDetailedProgress({
    ...current,
    ok: true,
    aiStage: "score-anchor",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), anchorPrepared: true, independentAiAnchorReturned: true, stage: "anchor" },
    note: "AI independent anchor classification completed and will be used to calibrate criterion scoring."
  }, "score-anchor");
}

async function scoreCriteriaStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const independentAnchor = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, {}, signals);
  const prompt = buildCompactScorePrompt(body, signals, independentAnchor);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS General Training Writing compact scoring engine. Return only short JSON scores; no detailed feedback." },
    { role: "user", content: prompt }
  ], 3000, 0);
  if (!ai.criterionCalibration && ai.shortReasons) {
    const compactCriteria = normalizeCriteria(ai.criteria || ai.finalCriteria, signals.task);
    ai.criterionCalibration = compactCriterionCalibration(ai, compactCriteria, signals.task);
  }
  const firstRaw = await normalizeScoreCoreResultWithZeroRescue(ai, body, signals, { independentAnchor, skipFeedbackQualityAudit: true });
  const criteria = firstRaw.finalCriteria || firstRaw.criteria;
  const anchorForResult = !independentAnchor.anchorMissing ? independentAnchor : firstRaw.anchorComparison;
  const calibration = normalizeCriterionCalibration(firstRaw.criterionCalibration || {}, criteria, signals.task);
  const first = {
    ...firstRaw,
    anchorComparison: anchorForResult,
    criterionCalibration: calibration,
    scoreProfile: buildLocalGateReport(criteria, signals, firstRaw.scoreProfile || {}, anchorForResult, calibration),
    taskSpecificGate: normalizeTaskSpecificGate(firstRaw.taskSpecificGate || {}, signals, criteria, anchorForResult, calibration),
    boundaryAudit: buildHardBoundaryAudit(criteria, signals, anchorForResult, calibration, firstRaw.boundaryAudit || {})
  };
  return withDetailedProgress({
    ...first,
    aiStage: "score-criteria",
    scoreCoreMeta: { ...first.scoreCoreMeta, scoreFrozen: false, stage: "criteria", boundaryAuditCompleted: false, boundaryReviewApplied: false, independentAnchorUsed: !anchorForResult.anchorMissing }
  }, "score-criteria");
}

function scoreGatesStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const normalizedCalibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparisonForGates = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const scoreProfile = buildLocalGateReport(criteria, signals, current.scoreProfile || {}, anchorComparisonForGates, normalizedCalibration);
  const warnings = collectScoreWarnings(criteria, signals);
  const result = {
    ...current,
    ok: true,
    aiStage: "score-boundary-audit",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison: anchorComparisonForGates,
    criterionCalibration: normalizedCalibration,
    scoreProfile,
    taskSpecificGate: normalizeTaskSpecificGate(current.taskSpecificGate || {}, signals, criteria, anchorComparisonForGates, normalizedCalibration),
    boundaryAudit: buildHardBoundaryAudit(criteria, signals, anchorComparisonForGates, normalizedCalibration, current.boundaryAudit || {}),
    stabilityWarnings: warnings,
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), scoreFrozen: false, gatesChecked: true, stage: "gates" }
  };
  return withDetailedProgress(result, "score-boundary-audit");
}

async function scoreBoundaryReviewStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const calibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const boundaryAudit = current.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration);
  const staged = { ...current, localSignals: signals, finalCriteria: criteria, criteria, criterionCalibration: calibration, anchorComparison, boundaryAudit };
  const reviewed = await applyBoundaryReviewIfNeeded(body, staged);
  assertNoImpossibleZeroBand(normalizeCriteria(reviewed.finalCriteria || reviewed.criteria, signals.task), signals);
  return withDetailedProgress({
    ...reviewed,
    aiStage: "score-boundary-review",
    scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), scoreFrozen: false, stage: "boundary-review" }
  }, "score-boundary-review");
}

function scoreFinalizeStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  const calibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const scoreProfile = buildLocalGateReport(criteria, signals, current.scoreProfile || {}, anchorComparison, calibration);
  const boundaryAudit = current.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration);
  assertFinalCanFreeze({ ...current, criteria, finalCriteria: criteria, boundaryAudit, anchorComparison, criterionCalibration: calibration, localSignals: signals });
  const result = {
    ...current,
    ok: true,
    aiStage: "score-finalize",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration: calibration,
    scoreProfile,
    taskSpecificGate: normalizeTaskSpecificGate(current.taskSpecificGate || {}, signals, criteria, anchorComparison, calibration),
    boundaryAudit,
    stabilityWarnings: collectScoreWarnings(criteria, signals),
    scoreCalculation: {
      mode: signals.task === "Task 1" ? "task1_gt_letter_single_pass_strict_anchor_v7" : "task2_essay_single_pass_strict_anchor_v7",
      formula: "Single-pass task-aware 0-9 anchor pipeline: AI independent anchor, AI criterion scoring, local hard audit, AI boundary review when triggered, final AI-returned criterion bands averaged and rounded to nearest 0.5. Local code audits and freezes, but does not assign bands.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment. The server performs hard validation/audit and may require AI boundary review, then mechanically averages AI-returned final criterion bands."
    },
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), scoreFirst: true, scoreFrozen: true, strictBoundaryAudited: true, feedbackStagesMayNotChangeScore: true, generatedAt: new Date().toISOString(), stage: "finalize" },
    localScoreChanged: false
  };
  return withDetailedProgress(result, "score-finalize");
}
function buildRevisionPrompt(body) {
  const frozen = body.currentResult || body.frozenScore || {};
  return [
    "You are generating IELTS learning models only. Do not change or comment on the score.",
    "Return JSON only. Generate optional model/revision content based on the already frozen score.",
    `Frozen score: ${JSON.stringify({ criteria: frozen.criteria || frozen.finalCriteria, overallBand: frozen.overallBand || frozen.scoreCalculation?.finalBand })}`,
    `Task: ${normalizeRequestedTask(body)}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return {\"ok\":true,\"aiStage\":\"revision-generator\",\"revisionMeta\":{\"scoreUnchanged\":true},\"modelAnswerOutline\":\"...\",\"modelAnswer\":\"...\",\"revisedEssay\":\"...\"}."
  ].join("\n\n");
}

async function revisionGenerator(body) {
  const ai = await callDeepSeek([
    { role: "system", content: "You generate IELTS model answers and revised essays. You never change the frozen score." },
    { role: "user", content: buildRevisionPrompt(body) }
  ], 6500, 0.2);
  return {
    ok: true,
    aiStage: "revision-generator",
    disclaimer: DISCLAIMER,
    scoreUnchanged: true,
    generationOnly: true,
    task: normalizeRequestedTask(body),
    taskLocked: true,
    revisionMeta: { ...(ai.revisionMeta || {}), scoreUnchanged: true },
    modelAnswerOutline: String(ai.modelAnswerOutline || "").trim(),
    modelAnswer: String(ai.modelAnswer || "").trim(),
    revisedEssay: String(ai.revisedEssay || "").trim()
  };
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  const body = normalizeIncomingBody(await readJsonBody(req));
  const requestedStage = body.aiStage || body.stage || (String(body.mode || "").toLowerCase() === "score" ? "score-core" : "score-core");
  const stage = String(requestedStage).toLowerCase();
  if (stage === "revision-generator" || stage === "revision") return sendJson(req, res, 200, await revisionGenerator(body));
  if (stage === "score-precheck") return sendJson(req, res, 200, scorePrecheck(body));
  if (stage === "score-task-router") return sendJson(req, res, 200, scoreTaskRouterStage(body));
  if (stage === "score-anchor") return sendJson(req, res, 200, await scoreAnchorStage(body));
  if (stage === "score-criteria") return sendJson(req, res, 200, await scoreCriteriaStage(body));
  if (stage === "score-boundary-audit" || stage === "score-gates") return sendJson(req, res, 200, scoreGatesStage(body));
  if (stage === "score-boundary-review") return sendJson(req, res, 200, await scoreBoundaryReviewStage(body));
  if (stage === "score-finalize") return sendJson(req, res, 200, scoreFinalizeStage(body));
  if (stage === "score-core") return sendJson(req, res, 200, await scoreCore(body));
  return sendJson(req, res, 400, { ok: false, error: `Unsupported clean scoring stage: ${stage}` });
}

module.exports = async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    const detail = error?.message || String(error);
    const freezeBlocked = /freeze blocked|boundary audit|boundary review/i.test(detail);
    sendJson(req, res, Number(error?.status) || (freezeBlocked ? 409 : 502), {
      ok: false,
      error: freezeBlocked ? "Score freeze blocked by unresolved boundary audit." : "AI scoring failed. No non-AI score was generated.",
      provider: DEFAULT_PROVIDER,
      detail,
      businessError: freezeBlocked ? "评分冻结失败：边界校准冲突未解决，系统已阻止展示不可信分数。" : "评分失败：AI 核心评分没有返回可冻结的短 JSON 评分结果。",
      suggestion: freezeBlocked ? "请重试一次；如果连续出现，请检查独立锚点、四项全7复核和 boundaryAudit 返回内容。" : "Retry once. If it repeats, check Vercel logs and the DeepSeek API key/runtime."
    });
  }
};

module.exports.config = { maxDuration: 300 };
