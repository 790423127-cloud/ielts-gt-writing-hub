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
const SCORE_SYSTEM_VERSION = "score-core-v6-independent-anchor-hard-freeze";

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

const DETAILED_SCORING_STEPS = [
  { stage: "score-precheck", title: "本地文本信号检查", description: "统计词数、段落、句子、英文比例、拼写/语法风险和可评分性；本地不打分。" },
  { stage: "score-task-router", title: "Task 1 / Task 2 分流", description: "确定使用 GT Task 1 书信规则还是 Task 2 作文规则，并生成任务画像。" },
  { stage: "score-anchor", title: "AI 独立 0–9 锚点判断", description: "AI 单独判断最接近的 0–9 分锚点；这个结果会传入四项评分，不能由最终分数反推。" },
  { stage: "score-criteria", title: "AI 四项初评与半分判断", description: "AI 返回四项分、half-band 理由、原文证据、anchor comparison 和任务专属 gate。" },
  { stage: "score-boundary-audit", title: "本地 hard boundary audit", description: "本地强制检查低分边界、高分天花板、四项同分、anchor 冲突和 Band 6 准入风险。" },
  { stage: "score-boundary-review", title: "AI 二次边界复核", description: "如果本地 audit 触发风险，AI 必须二次复核并重新确认或修正四项分；无风险则跳过。" },
  { stage: "score-finalize", title: "最终验证并冻结分数", description: "验证结构完整后，机械平均 AI 返回的四项最终分并冻结；本地不直接改分。" }
];

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

function countParagraphs(text) {
  return String(text || "").split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean).length;
}

function sentenceUnits(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return (cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
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

function countPattern(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function localSignals(body) {
  const essay = String(body.essay || "");
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(body.wordCount) || countWords(essay);
  const paragraphs = countParagraphs(essay);
  const sentences = sentenceUnits(essay);
  const totalTokens = (essay.match(/\S+/g) || []).length;
  const englishTokens = (essay.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const englishRatio = totalTokens ? englishTokens / totalTokens : 0;

  const spellingList = ["nowdays", "posiible", "improtant", "furture", "proformence", "deepends", "themslves", "caryfully", "recieve", "becuase", "wich", "enviroment", "goverment", "seperate", "definately", "untill", "frist", "seondly"];
  const spellingHits = spellingList.map((word) => ({ item: word, count: countPattern(essay, new RegExp(`\\b${word}\\b`, "gi")) })).filter((x) => x.count);
  const spellingIssueCount = spellingHits.reduce((sum, x) => sum + x.count, 0);

  const grammarPatterns = [
    { label: "verb form after subordinator", regex: /\b(when|if|because|although)\s+[a-z]+\s+(using|doing|having|going|looking|paying)\b/gi },
    { label: "incorrect infinitive pattern", regex: /\bneed\s+to\s+[a-z]+ing\b/gi },
    { label: "missing subject after clause", regex: /\bif\s+[^.!?]{0,80},\s*(may|can|will|should|would)\b/gi },
    { label: "comparative error", regex: /\bmuch\s+comfortable\b/gi },
    { label: "missing be / comparison control", regex: /\b\w+\s+never\s+(important|better|worse|good|bad)\s+than\b/gi },
    { label: "gerund/parallel pattern", regex: /\busing\s+[^.!?]{0,60}\s+or\s+pay\s+for\b/gi },
    { label: "article/plural/control phrase", regex: /\b(some of beauty products|using beauty product|facing customer|at working days|at now)\b/gi }
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

  let rateabilityStatus = "weak_but_rateable";
  if (!essay.trim() || (task === "Task 1" ? words < 50 : words < 80) || englishRatio < 0.35 || sentences.length === 0) rateabilityStatus = "not_rateable_or_severely_limited";
  else if (words >= (task === "Task 1" ? 120 : 180) && paragraphs >= 2 && sentences.length >= 5) rateabilityStatus = "clearly_rateable";

  return {
    task, wordCount: words, paragraphCount: paragraphs, sentenceCount: sentences.length, englishRatio: Number(englishRatio.toFixed(2)), rateabilityStatus,
    recommendedMinimum: task === "Task 1" ? 150 : 250,
    spellingIssueCount, spellingDensityPer100Words: spellingDensity, spellingErrorDensity, spellingExamples: spellingHits.slice(0, 10),
    grammarIssueSignalCount: grammarIssueCount, grammarDensityPer100Words: grammarDensity, grammarErrorDensity, grammarIssueSignals: grammarHits.slice(0, 10),
    weakPhraseCount, lexicalNaturalnessRisk, weakPhraseSignals: weakPhraseHits.slice(0, 10), sentenceControl, lexicalControl,
    task1BulletPoints: task === "Task 1" ? extractTask1Bullets(body.questionPrompt || body.promptText || "") : [],
    task2QuestionProfile: task === "Task 2" ? inferTask2Profile(body.questionPrompt || body.promptText || "") : null
  };
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

async function callDeepSeek(messages, maxTokens = 5000, temperature = 0) {
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
    return stableJsonParse(content);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("DeepSeek request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
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
    if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0-1", lower: 0, upper: 1, severity: "extreme", reason: "Task 1 is blank or has no countable words." };
    if (w < 50) return { triggered: true, category: "minimal_letter", suggestedRange: "Band 1.0-2.5", lower: 1, upper: 2.5, severity: "extreme", reason: `Task 1 has only ${w} words; there is not enough letter content to cover purpose, bullets and tone.` };
    if (w < 80) return { triggered: true, category: "very_short_letter", suggestedRange: "Band 2.5-3.5", lower: 2.5, upper: 3.5, severity: "severe", reason: `Task 1 has ${w} words; bullet coverage and letter completeness are likely severely limited.` };
    if (w < 120) return { triggered: true, category: "short_letter_limited_detail", suggestedRange: "Band 3.5-5.0", lower: 3.5, upper: 5, severity: "high", reason: `Task 1 has ${w} words; it may be rateable but details and bullet development must be audited.` };
    if (w < 150) return { triggered: true, category: "below_recommended_letter_length", suggestedRange: "Band 4.5-6.0 depending on bullet detail", lower: 4.5, upper: 6, severity: "moderate", reason: `Task 1 has ${w} words, below the recommended 150; check whether all bullets are still developed.` };
    return { triggered: false, category: "normal_letter_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 1 word count ${w} is in or above the normal range.` };
  }
  if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0-1", lower: 0, upper: 1, severity: "extreme", reason: "Task 2 is blank or has no countable words." };
  if (w < 50) return { triggered: true, category: "minimal_response", suggestedRange: "Band 1.0-2.5", lower: 1, upper: 2.5, severity: "extreme", reason: `Task 2 has only ${w} words; it cannot provide a developed essay response.` };
  if (w < 80) return { triggered: true, category: "very_short_rateable", suggestedRange: "Band 2.5-3.5", lower: 2.5, upper: 3.5, severity: "severe", reason: `Task 2 has ${w} words; it is very short and development evidence is severely limited.` };
  if (w < 120) return { triggered: true, category: "severe_underlength_but_rateable", suggestedRange: "Band 3.0-4.0", lower: 3, upper: 4, severity: "high", reason: `Task 2 has ${w} words; it may be rateable, but it is severely underlength and normally capped by lack of development evidence.` };
  if (w < 150) return { triggered: true, category: "underlength_limited_development", suggestedRange: "Band 3.5-4.5", lower: 3.5, upper: 4.5, severity: "high", reason: `Task 2 has ${w} words; task response and development are likely limited.` };
  if (w < 180) return { triggered: true, category: "short_response", suggestedRange: "Band 4.0-5.0", lower: 4, upper: 5, severity: "moderate", reason: `Task 2 has ${w} words; it is short, so 5.5+ needs unusually strong evidence.` };
  if (w < 230) return { triggered: true, category: "development_risk", suggestedRange: "Band 4.5-5.5 unless development is strong", lower: 4.5, upper: 5.5, severity: "watch", reason: `Task 2 has ${w} words; not automatically low, but development depth must be checked before 6.0+.` };
  return { triggered: false, category: "normal_essay_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 2 word count ${w} is in or near the normal IELTS range.` };
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
      highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5))
    };
  }
  return {
    taskResponseDepthGate: normalizeGate(source.taskResponseDepthGate || source.taskResponseDepth, "Task 2 response depth checked: all prompt parts, position, reasons, examples and explanations must be present.", false),
    band6AccessGate: normalizeGate(source.band6AccessGate || source.band6Access, "Band 6 access checked: real development is required; visible structure alone is not enough.", Boolean(words < 230 && Object.values(criteria).some((x) => Number(x) >= 6))),
    lowBandGuard: normalizeGate(source.lowBandGuard, `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.`, wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited"),
    midBandCheck: normalizeGate(source.midBandCheck || source.midBandGate, "Mid-band check applied: do not over-reward paragraphs, basic connectors, or a stated opinion without development.", false),
    highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5)),
    scoreProfileCheck: normalizeGate(source.scoreProfileCheck || source.scoreProfileGate, "Score-profile check applied to challenge all-equal bands and TR/CC versus LR/GRA gaps.", allCriteriaSame(criteria))
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
  return [
    "You are an IELTS GT Writing anchor-classification examiner. Return JSON only. Do not assign criterion bands in this stage.",
    `Score system: ${SCORE_SYSTEM_VERSION}. Task: ${task}.`,
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
    "Low-band boundary rule: severe underlength may be rateable but still belongs to a low-band boundary. Task 2 80-119 words is usually Band 3.0-4.0; Task 2 120-149 words is usually Band 3.5-4.5 unless exceptional evidence exists.",
    "Task 1 special rule: Task Achievement is mainly determined by purpose clarity, bullet coverage, detail, tone/register, and letter completeness. Missing bullets or wrong tone must constrain TA and can also constrain CC/LR.",
    "Task 2 special rule: Task Response is mainly determined by answering all prompt parts, position, development, examples/reasons, relevance, and conclusion. A position plus paragraphs is not enough for Band 6.",
    "Band 6 access rule: Band 6 requires real task fulfilment and development, not only paragraphing. If ideas are general, examples are brief, or frequent language errors reduce precision, stay at 5.0-5.5.",
    "High-band unlock rule: if the response has full task fulfilment, developed ideas, natural progression, precise/flexible lexis, and strong grammar control, actively consider 7.5/8.0/8.5/9.0 rather than defaulting to 7.0.",
    "LR/GRA gates: high spelling/word-form density must limit LR unless strong evidence overrides it. High grammar density or weak sentence control must limit GRA unless strong evidence overrides it.",
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
      whyNotLowerZh: String(item.whyNotLowerZh || half.whyAboveLowerBandZh || "").trim(),
      whyNotHigher: whyHigher,
      whyNotHigherZh: String(item.whyNotHigherZh || half.whyBelowUpperBandZh || "").trim(),
      howToImprove: String(item.howToImprove || item.improvementFocus || defaultImproveForCriterion(name)).trim(),
      howToImproveZh: String(item.howToImproveZh || item.improvementFocusZh || "").trim(),
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
  const anchorBand = Number(anchorComparison?.closestAnchorBand);
  const anchorMissing = Boolean(anchorComparison?.anchorMissing || anchorComparison?.anchorSource === "local_fallback_missing_ai_anchor");
  const anchorConflict = Number.isFinite(anchorBand) && Number.isFinite(finalBand) && Math.abs(anchorBand - finalBand) > 1;
  const values = scoreValues(criteria);
  const allSame = allCriteriaSame(criteria);
  const allFourSeven = values.length === 4 && values.every((x) => x === 7);
  const lowBandScoreTooHigh = Boolean(wordBoundary.triggered && Number.isFinite(finalBand) && Number.isFinite(wordBoundary.upper) && finalBand > wordBoundary.upper);
  const band6AccessConflict = Boolean(signals.task === "Task 2" && signals.wordCount < 230 && values.some((x) => x >= 6) && (signals.rateabilityStatus !== "clearly_rateable" || wordBoundary.triggered));
  const reviewReasons = [];
  if (anchorMissing) reviewReasons.push("AI did not provide an independent anchor comparison.");
  if (lowBandScoreTooHigh) reviewReasons.push(`Final Band ${finalBand.toFixed(1)} exceeds local word-count boundary ${wordBoundary.suggestedRange}.`);
  if (allFourSeven) reviewReasons.push("All four criterion bands are exactly Band 7.0; this must be reviewed for possible 7.5/8.0+ or justified as true Band 7.");
  if (highCandidate.triggered) reviewReasons.push(highCandidate.reason);
  if (anchorConflict) reviewReasons.push(`Anchor Band ${anchorBand} differs from final Band ${finalBand.toFixed(1)} by more than 1.0.`);
  if (allSame && finalBand >= 5) reviewReasons.push("All four criterion bands are identical; forced differentiation review is required.");
  if (band6AccessConflict) reviewReasons.push("Band 6+ access conflict: short or weakly rateable Task 2 needs real development evidence.");
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
      status: (warnings.length || allSame) ? "triggered" : "passed",
      allCriteriaSame: allSame,
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
  const values = scoreValues(criteria);
  const { finalBand } = averageBand(criteria);
  const review = audit.boundaryReview || reviewed.boundaryReview || {};
  const anchorBand = Number(audit.anchorAudit?.closestAnchorBand ?? reviewed.anchorComparison?.closestAnchorBand);
  const allFourSeven = values.length === 4 && values.every((x) => x === 7);
  const allSameHigh = allCriteriaSame(criteria) && Number.isFinite(finalBand) && finalBand >= 7;
  const strongKeepEvidence = hasStrongBoundaryKeepEvidence(reviewed, review, audit);
  const reasons = [];
  if (audit.lowBandBoundary?.scoreTooHigh) reasons.push("Low-band word-count boundary still exceeded after boundary review.");
  if (audit.anchorAudit?.anchorMissing) reasons.push("Independent anchor comparison is still missing after boundary review.");
  if (Number.isFinite(anchorBand) && Number.isFinite(finalBand) && anchorBand >= 8 && finalBand <= 7 && !strongKeepEvidence) reasons.push("Independent anchor is Band 8/9 but final score remains Band 7.0 or below without strong evidence.");
  if (allFourSeven && !strongKeepEvidence) reasons.push("All four criteria remain exactly Band 7.0 after review without strong all-four-7 resolution evidence.");
  if (allSameHigh && !strongKeepEvidence) reasons.push("All four high-band criteria remain identical after review without strong differentiation evidence.");
  return reasons;
}

function assertFinalCanFreeze(result = {}) {
  const audit = result.boundaryAudit || {};
  const unresolved = Array.isArray(audit.unresolvedCriticalReasons) ? audit.unresolvedCriticalReasons : [];
  if (audit.freezeBlocked || unresolved.length) {
    const error = new Error(`Final score freeze blocked by unresolved boundary audit: ${unresolved.join("; ") || audit.status || "boundary conflict"}`);
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
  if (audit.reviewRequired && audit.status !== "passed" && audit.status !== "reviewed_passed" && audit.status !== "reviewed_passed_with_strong_evidence") {
    const error = new Error(`Final score freeze blocked: boundary review is still required (${(audit.reviewReasons || []).join("; ") || "unknown reason"}).`);
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
}

function buildBoundaryReviewPrompt(body, firstResult, audit) {
  const signals = firstResult.localSignals || localSignals(body);
  const task = signals.task;
  const names = criterionNames(task);
  return [
    "You are the second-pass IELTS GT Writing boundary examiner. Return JSON only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. The server will not assign bands locally, but it will refuse to freeze unreviewed boundary conflicts.`,
    `Task: ${task}. Criteria: ${names.join(", ")}.`,
    "You must re-check only scoring boundaries: low-band underlength, Band 6 access, high-band unlock, all-four-same differentiation, and anchor/final-score conflicts.",
    "If the first result is too high or too low, revise the four criterion bands yourself. If you keep the same bands, provide concrete evidence that justifies keeping them.",
    "For all-four Band 7 cases, explicitly decide whether any criterion should be 7.5/8.0/8.5/9.0 or whether true Band 7 is justified. Do not default to 7.0 for safety.",
    "If the first result is all four Band 7.0, you must NOT return all four Band 7.0 again unless you provide at least two concrete textual limitations that prevent 7.5/8.0. Generic comments such as 'good but not excellent' are invalid.",
    "For each criterion in an all-four-7 case, choose one decision: raise_to_7.5_or_above OR keep_at_7_with_exact_evidence_against_7.5. If you cannot provide exact evidence against 7.5, raise the criterion.",
    "If the independent anchor is Band 8 or Band 9 and the final score remains Band 7.0 or below, give strong specific evidence against the high band; otherwise revise upward.",
    "For short responses, respect the local word-count boundary unless the text has exceptional evidence; explain any exception.",
    `Local signals: ${JSON.stringify(signals)}`,
    `Hard audit requiring review: ${JSON.stringify(audit)}`,
    `First score result: ${JSON.stringify({ criteria: firstResult.finalCriteria || firstResult.criteria, overallBand: firstResult.overallBand, anchorComparison: firstResult.anchorComparison, scoreProfile: firstResult.scoreProfile, taskSpecificGate: firstResult.taskSpecificGate, criterionCalibration: firstResult.criterionCalibration, examinerSummary: firstResult.examinerSummary })}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return the same scoring JSON shape as score-core, plus boundaryReview:{triggered:true,decision:'revised'|'kept_after_review',reviewReasons:[...],whyFinalCriteriaAreSafe:'...',whyFinalCriteriaAreSafeZh:'中文',firstCriteria:{...},finalCriteria:{...},allFourSevenResolution:{resolved:boolean,keptAllSeven:boolean,criteriaDecisions:{'Criterion Name':{decision:'raise_to_7.5_or_above'|'keep_at_7_with_exact_evidence_against_7.5',whyNot7_5Or8:'...',textEvidence:['...']}}}}."
  ].join("\n\n");
}

async function applyBoundaryReviewIfNeeded(body, firstResult) {
  const signals = firstResult.localSignals || localSignals(body);
  const initialAudit = firstResult.boundaryAudit || buildHardBoundaryAudit(firstResult.finalCriteria || firstResult.criteria, signals, firstResult.anchorComparison || {}, firstResult.criterionCalibration || {});
  if (!initialAudit.reviewRequired) {
    return { ...firstResult, boundaryAudit: { ...initialAudit, status: "passed", reviewRequired: false } };
  }
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS GT Writing boundary-review scoring engine. You score only; no editing advice." },
    { role: "user", content: buildBoundaryReviewPrompt(body, firstResult, initialAudit) }
  ], 6800, 0);
  const reviewed = normalizeScoreCoreResult(ai, body, signals, { fromBoundaryReview: true });
  const reviewedAuditRaw = buildHardBoundaryAudit(reviewed.finalCriteria || reviewed.criteria, signals, reviewed.anchorComparison || {}, reviewed.criterionCalibration || {}, {
    firstPass: {
      criteria: firstResult.finalCriteria || firstResult.criteria,
      overallBand: firstResult.overallBand,
      anchorComparison: firstResult.anchorComparison,
      audit: initialAudit
    },
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
  return {
    likelyOverallRange: profile.likelyOverallRange || (wordBoundary.triggered ? wordBoundary.suggestedRange : (signals.rateabilityStatus === "clearly_rateable" ? "rateable; band depends on criterion evidence" : "limited or weakly rateable")),
    lowBandGate: combineGate(localLow, profile.lowBandGate),
    midBandGate: combineGate(localMid, profile.midBandGate),
    highBandGate: combineGate(localHigh, profile.highBandGate),
    scoreProfileGate: combineGate(localProfile, profile.scoreProfileGate)
  };
}
function normalizeScoreCoreResult(ai, body, signals, options = {}) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI returned incomplete criterion bands.");
  const warnings = collectScoreWarnings(criteria, signals);
  const rawAnchor = ai.anchorComparison || ai.anchorCalibration || {};
  const anchorComparison = normalizeAnchorComparison(rawAnchor, task, criteria, signals);
  const criterionCalibration = normalizeCriterionCalibration(ai.criterionCalibration || {}, criteria, task);
  const scoreProfile = buildLocalGateReport(criteria, signals, ai.scoreProfile || {}, anchorComparison, criterionCalibration);
  const taskSpecificGate = normalizeTaskSpecificGate(ai.taskSpecificGate || {}, signals, criteria, anchorComparison, criterionCalibration);
  const boundaryAudit = buildHardBoundaryAudit(criteria, signals, anchorComparison, criterionCalibration, ai.boundaryAudit || {});
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
      mode: task === "Task 1" ? "task1_gt_letter_strict_anchor_engine_v6" : "task2_essay_strict_anchor_engine_v6",
      formula: "Task-aware independent 0-9 anchor calibration; local hard-gate audit; AI boundary review when triggered; final AI-returned criterion bands averaged and rounded to nearest 0.5. Local code audits and routes, but does not assign bands.",
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

async function scoreCore(body) {
  const signals = localSignals(body);
  const anchorAi = await callDeepSeek([
    { role: "system", content: "You are an IELTS GT Writing independent anchor classifier. You do not assign criterion bands." },
    { role: "user", content: buildIndependentAnchorPrompt(body, signals) }
  ], 2600, 0);
  const independentAnchor = normalizeAnchorComparison(anchorAi.anchorComparison || anchorAi.anchorCalibration || anchorAi, signals.task, {}, signals);
  const prompt = buildScoreCorePrompt(body, signals, independentAnchor);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS General Training Writing scoring engine. You only score; you do not provide editing advice." },
    { role: "user", content: prompt }
  ], 6200, 0);
  const firstRaw = normalizeScoreCoreResult(ai, body, signals);
  const criteria = firstRaw.finalCriteria || firstRaw.criteria;
  const calibration = normalizeCriterionCalibration(firstRaw.criterionCalibration || {}, criteria, signals.task);
  const first = {
    ...firstRaw,
    anchorComparison: independentAnchor,
    criterionCalibration: calibration,
    scoreProfile: buildLocalGateReport(criteria, signals, firstRaw.scoreProfile || {}, independentAnchor, calibration),
    taskSpecificGate: normalizeTaskSpecificGate(firstRaw.taskSpecificGate || {}, signals, criteria, independentAnchor, calibration),
    boundaryAudit: buildHardBoundaryAudit(criteria, signals, independentAnchor, calibration, firstRaw.boundaryAudit || {})
  };
  const reviewed = await applyBoundaryReviewIfNeeded(body, first);
  assertFinalCanFreeze(reviewed);
  return withDetailedProgress({ ...reviewed, aiStage: "score-core", scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), scoreFrozen: true, stage: "score-core" } }, "score-finalize");
}


function scorePrecheck(body) {
  const signals = localSignals(body);
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
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
  return withDetailedProgress({
    ...current,
    ok: true,
    aiStage: "score-task-router",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: current.taskProfile || buildTaskProfile(body, signals),
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), taskRouted: true, stage: "task-router" },
    note: "Task routed. No criterion band is assigned in this stage."
  }, "score-task-router");
}

async function scoreAnchorStage(body) {
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
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
    taskProfile: current.taskProfile || buildTaskProfile(body, signals),
    anchorComparison,
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), anchorPrepared: true, independentAiAnchorReturned: true, stage: "anchor" },
    note: "AI independent anchor classification completed and will be used to calibrate criterion scoring."
  }, "score-anchor");
}

async function scoreCriteriaStage(body) {
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
  const independentAnchor = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, {}, signals);
  const prompt = buildScoreCorePrompt(body, signals, independentAnchor);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS General Training Writing scoring engine. You only score and explain the criterion bands; you do not provide full feedback sections." },
    { role: "user", content: prompt }
  ], 6600, 0);
  const firstRaw = normalizeScoreCoreResult(ai, body, signals);
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
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
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
    taskProfile: current.taskProfile || buildTaskProfile(body, signals),
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
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  const calibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const boundaryAudit = current.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration);
  const staged = { ...current, localSignals: signals, finalCriteria: criteria, criteria, criterionCalibration: calibration, anchorComparison, boundaryAudit };
  const reviewed = await applyBoundaryReviewIfNeeded(body, staged);
  return withDetailedProgress({
    ...reviewed,
    aiStage: "score-boundary-review",
    scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), scoreFrozen: false, stage: "boundary-review" }
  }, "score-boundary-review");
}

function scoreFinalizeStage(body) {
  const current = body.currentResult || {};
  const signals = current.localSignals || localSignals(body);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
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
    taskProfile: current.taskProfile || buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration: calibration,
    scoreProfile,
    taskSpecificGate: normalizeTaskSpecificGate(current.taskSpecificGate || {}, signals, criteria, anchorComparison, calibration),
    boundaryAudit,
    stabilityWarnings: collectScoreWarnings(criteria, signals),
    scoreCalculation: {
      mode: signals.task === "Task 1" ? "task1_gt_letter_strict_anchor_engine_v6" : "task2_essay_strict_anchor_engine_v6",
      formula: "Task-aware independent 0-9 anchor calibration; local hard-gate audit; AI boundary review when triggered; final AI-returned criterion bands averaged and rounded to nearest 0.5. Local code audits and routes, but does not assign bands.",
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
    `Task: ${body.task || "Task 2"}`,
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
    revisionMeta: { ...(ai.revisionMeta || {}), scoreUnchanged: true },
    modelAnswerOutline: String(ai.modelAnswerOutline || "").trim(),
    modelAnswer: String(ai.modelAnswer || "").trim(),
    revisedEssay: String(ai.revisedEssay || "").trim()
  };
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  const body = await readJsonBody(req);
  const stage = String(body.aiStage || body.stage || "score-precheck").toLowerCase();
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
    sendJson(req, res, 502, {
      ok: false,
      error: "AI scoring failed. No non-AI score was generated.",
      provider: DEFAULT_PROVIDER,
      detail: error?.message || String(error),
      suggestion: "Retry once. If it repeats, check Vercel logs and the DeepSeek API key/runtime."
    });
  }
};

module.exports.config = { maxDuration: 300 };
