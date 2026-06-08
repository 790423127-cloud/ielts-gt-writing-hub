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
const VALID_BANDS = Array.from({ length: 17 }, (_, i) => 1 + i * 0.5);

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
  if (rounded < 1 || rounded > 9) return null;
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

function buildScoreCorePrompt(body, signals) {
  const task = signals.task;
  const names = criterionNames(task);
  const taskSpecific = task === "Task 1"
    ? `Task 1 GT letter checks: purpose clarity; all bullet points separately covered/partly/missing; functional detail; recipient relationship; tone/register; opening/closing/format. Extracted bullet points: ${JSON.stringify(signals.task1BulletPoints)}.`
    : `Task 2 essay checks: question type; all required parts; clear position when required; relevant development; reasons; examples; conclusion. Question profile: ${JSON.stringify(signals.task2QuestionProfile)}.`;

  return [
    "You are a strict but fair IELTS General Training Writing examiner. Return JSON only.",
    "Grade the submitted response on IELTS criterion bands from 1.0 to 9.0 in 0.5 increments. Do not prefer whole bands by default.",
    "For every criterion, actively compare adjacent half bands. Use X.5 when performance clearly exceeds X.0 but does not consistently reach X+1.0. Give 4.5/5.5/6.5/7.5/8.5 when the evidence is genuinely between whole-band descriptors.",
    "Do not generate editing, language diagnostics, learning notes, revisions, or model answers in this scoring pass. This endpoint is for scoring only.",
    taskSpecific,
    "Low-band gate: validate blank, extreme underlength, non-English/unreadable, no complete sentences, severe off-topic, Task 1 not a letter, or Task 2 not answering the task.",
    "Mid-band gate: for likely Band 4.0-6.0 writing, do not over-reward visible structure. A position plus paragraphs is not enough for TR/TA 5.5+; basic paragraphing with Firstly/Secondly/In conclusion is not enough for CC 5.5+; spelling/word-form density must limit LR; frequent basic grammar errors must limit GRA.",
    "High-band gate: any criterion 6.5+ requires strong, criterion-specific evidence: complete task fulfilment, natural progression, accurate flexible lexis, and accurate varied grammar. Do not award high bands for neat structure alone.",
    "LR/GRA gates: if local signals show high spelling/word-form or weak lexical control, LR 5.5+ needs strong evidence. If local signals show high grammar density or weak sentence control, GRA 5.0+ needs strong evidence.",
    "Score-profile gate: challenge all-equal bands, TR/TA+CC much higher than LR/GRA, and overall 5.5+ when language-control signals are weak.",
    "The server will average the four criterion bands and round to the nearest 0.5. Do not invent a separate overall band that conflicts with the four criteria.",
    `Criterion names must be exactly: ${JSON.stringify(names)}.` ,
    `Local scoring signals for calibration only, not local scoring: ${JSON.stringify(signals)}.` ,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return this exact JSON shape: {\"ok\":true,\"aiStage\":\"score-core\",\"task\":\"Task 1 or Task 2\",\"criteria\":{...four criterion bands as numbers...},\"criterionCalibration\":{\"Criterion Name\":{\"candidateBandsConsidered\":[...],\"selectedBand\":number,\"positiveEvidence\":[...],\"limitingEvidence\":[...],\"halfBandDecision\":{\"whyAboveLowerBand\":\"...\",\"whyBelowUpperBand\":\"...\",\"whyExactBand\":\"...\"}}},\"scoreProfile\":{\"likelyOverallRange\":\"...\",\"lowBandGate\":{...},\"midBandGate\":{...},\"highBandGate\":{...},\"scoreProfileGate\":{...}},\"taskSpecificGate\":{...},\"diagnosticSignals\":{...},\"examinerSummary\":\"short scoring-only explanation\",\"examinerSummaryZh\":\"中文评分摘要\"}"
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
  if (signals.rateabilityStatus === "clearly_rateable" && Object.values(criteria).some((x) => x <= 2)) warnings.push("Clearly rateable response received a Band 1/2 criterion; this would require unusually strong evidence.");
  if (signals.grammarErrorDensity === "high" && gra >= 5) warnings.push("GRA is 5.0+ while grammar error density is high; the examiner must justify this carefully.");
  if ((signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak") && lr >= 5.5) warnings.push("LR is 5.5+ while lexical/spelling signals are weak; the examiner must justify this carefully.");
  if (finalBand >= 5.5 && (signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high") && (lr <= 5 || gra <= 5)) warnings.push("Overall 5.5+ with weak LR/GRA signals can be overgenerous; score-profile gate should be checked.");
  if (first >= 5.5 && cc >= 5.5 && lr <= 4.5 && gra <= 4.5) warnings.push("TR/TA and CC are 5.5 while LR/GRA are weak; confirm that task development and cohesion evidence justify this gap.");
  return warnings;
}

function normalizeScoreCoreResult(ai, body, signals) {
  const task = body.task === "Task 1" ? "Task 1" : "Task 2";
  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI returned incomplete criterion bands.");
  const warnings = collectScoreWarnings(criteria, signals);
  return {
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: "clean-score-core-v1",
    disclaimer: DISCLAIMER,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_gt_letter_engine" : "task2_essay_practice_engine",
      formula: "AI-returned four IELTS criterion bands averaged and rounded to nearest 0.5; no local cap, lift, or lowering is applied.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No. The server validates structure and averages the four AI-returned criterion bands."
    },
    scoreCoreMeta: {
      scoreFirst: true,
      scoreFrozen: true,
      adviceSystemRemoved: true,
      generatedAt: new Date().toISOString()
    },
    localSignals: signals,
    criterionCalibration: ai.criterionCalibration || {},
    scoreProfile: ai.scoreProfile || {},
    taskSpecificGate: ai.taskSpecificGate || {},
    diagnosticSignals: ai.diagnosticSignals || {},
    examinerSummary: String(ai.examinerSummary || "").trim(),
    examinerSummaryZh: String(ai.examinerSummaryZh || "").trim(),
    stabilityWarnings: warnings,
    localScoreChanged: false
  };
}

async function scoreCore(body) {
  const signals = localSignals(body);
  const prompt = buildScoreCorePrompt(body, signals);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS General Training Writing scoring engine. You only score; you do not provide editing advice." },
    { role: "user", content: prompt }
  ], 5200, 0);
  return normalizeScoreCoreResult(ai, body, signals);
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
  const stage = String(body.aiStage || body.stage || "score-core").toLowerCase();
  if (stage === "revision-generator" || stage === "revision") return sendJson(req, res, 200, await revisionGenerator(body));
  return sendJson(req, res, 200, await scoreCore(body));
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
