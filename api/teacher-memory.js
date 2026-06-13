const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const MEMORY_VERSION = "ielts-teacher-cloud-memory-v1";
const DEFAULT_USER_ID = process.env.TEACHER_MEMORY_USER_ID || "wenyao";
const MEMORY_KEY = process.env.TEACHER_MEMORY_KEY || `ielts:teacher-memory:${DEFAULT_USER_ID}:v1`;

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

function emptyMemory() {
  return {
    memoryVersion: MEMORY_VERSION,
    userId: DEFAULT_USER_ID,
    updatedAt: "",
    learnerPreference: {
      chineseFirst: true,
      slowLearnerMode: true,
      explanationStyle: "very_detailed",
      preferredTeachingStyle: "patient_teacher",
      avoid: ["too many advanced words", "long abstract explanations", "generic IELTS comments"],
      currentGoal: "IELTS GT Writing stable 5.0 first, then 5.5"
    },
    task1: {
      errorRecords: [],
      scoreHistory: [],
      promptWeakness: {},
      masteredPatterns: [],
      homeworkHistory: [],
      teacherSummaryHistory: []
    },
    task2: {
      errorRecords: [],
      scoreHistory: [],
      promptWeakness: {},
      masteredPatterns: [],
      homeworkHistory: [],
      teacherSummaryHistory: []
    },
    sharedLanguage: {
      errorRecords: [],
      spellingWatchlist: [],
      grammarWatchlist: [],
      masteredPatterns: [],
      homeworkHistory: []
    },
    generation: {
      revisionHistory: []
    }
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTask(task) {
  return String(task || "").toLowerCase().includes("1") ? "Task 1" : "Task 2";
}

function normalizeScope(scope, task = "Task 2") {
  const raw = String(scope || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (raw.includes("shared") || raw.includes("general") || raw.includes("language")) return "sharedLanguage";
  if (raw.includes("task1") || raw.includes("letter")) return "task1";
  if (raw.includes("task2") || raw.includes("essay")) return "task2";
  return normalizeTask(task) === "Task 1" ? "task1" : "task2";
}

function idFrom(...values) {
  return values
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

function ensureMemoryShape(raw) {
  const base = emptyMemory();
  const source = raw && typeof raw === "object" ? raw : {};
  const shaped = {
    ...base,
    ...source,
    learnerPreference: { ...base.learnerPreference, ...(source.learnerPreference || {}) },
    task1: { ...base.task1, ...(source.task1 || {}) },
    task2: { ...base.task2, ...(source.task2 || {}) },
    sharedLanguage: { ...base.sharedLanguage, ...(source.sharedLanguage || {}) },
    generation: { ...base.generation, ...(source.generation || {}) }
  };

  ["task1", "task2"].forEach((bucket) => {
    shaped[bucket].errorRecords = asArray(shaped[bucket].errorRecords).slice(-500);
    shaped[bucket].scoreHistory = asArray(shaped[bucket].scoreHistory).slice(-250);
    shaped[bucket].masteredPatterns = asArray(shaped[bucket].masteredPatterns).slice(-300);
    shaped[bucket].homeworkHistory = asArray(shaped[bucket].homeworkHistory).slice(-250);
    shaped[bucket].teacherSummaryHistory = asArray(shaped[bucket].teacherSummaryHistory).slice(-200);
    shaped[bucket].promptWeakness = shaped[bucket].promptWeakness && typeof shaped[bucket].promptWeakness === "object" ? shaped[bucket].promptWeakness : {};
  });
  shaped.sharedLanguage.errorRecords = asArray(shaped.sharedLanguage.errorRecords).slice(-700);
  shaped.sharedLanguage.spellingWatchlist = asArray(shaped.sharedLanguage.spellingWatchlist).slice(-300);
  shaped.sharedLanguage.grammarWatchlist = asArray(shaped.sharedLanguage.grammarWatchlist).slice(-300);
  shaped.sharedLanguage.masteredPatterns = asArray(shaped.sharedLanguage.masteredPatterns).slice(-300);
  shaped.sharedLanguage.homeworkHistory = asArray(shaped.sharedLanguage.homeworkHistory).slice(-250);
  shaped.generation.revisionHistory = asArray(shaped.generation.revisionHistory).slice(-250);
  shaped.memoryVersion = MEMORY_VERSION;
  shaped.userId = source.userId || DEFAULT_USER_ID;
  return shaped;
}

async function kvCommand(args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const error = new Error("Missing KV_REST_API_URL/KV_REST_API_TOKEN environment variables.");
    error.code = "MISSING_KV_ENV";
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok || payload.error) {
    throw new Error(`Upstash REST error ${response.status}: ${payload.error || payload.raw || text}`);
  }
  return payload.result;
}

async function loadMemory() {
  const raw = await kvCommand(["GET", MEMORY_KEY]);
  if (!raw) return emptyMemory();
  if (typeof raw === "object") return ensureMemoryShape(raw);
  try {
    return ensureMemoryShape(JSON.parse(raw));
  } catch {
    return emptyMemory();
  }
}

async function saveMemory(memory) {
  const shaped = ensureMemoryShape(memory);
  shaped.updatedAt = new Date().toISOString();
  await kvCommand(["SET", MEMORY_KEY, JSON.stringify(shaped)]);
  return shaped;
}

function upsertError(memory, rawItem = {}, kind = "new", task = "Task 2") {
  const scope = normalizeScope(rawItem.taskScope || rawItem.scope || rawItem.taskBucket, rawItem.task || task);
  const container = scope === "sharedLanguage" ? memory.sharedLanguage : memory[scope];
  if (!container || !Array.isArray(container.errorRecords)) return;
  const now = new Date().toISOString();
  const id = idFrom(rawItem.issueId || rawItem.id, rawItem.wrongPattern, rawItem.issueTitleZh, rawItem.originalExample || rawItem.currentExample);
  if (!id) return;
  let record = container.errorRecords.find((item) => item.id === id || item.issueId === rawItem.issueId);
  if (!record) {
    record = {
      id,
      issueId: rawItem.issueId || rawItem.id || id,
      taskBucket: scope,
      task: scope === "task1" ? "Task 1" : scope === "task2" ? "Task 2" : "Shared",
      issueFamilyZh: rawItem.issueFamilyZh || "",
      issueTitleZh: rawItem.issueTitleZh || "",
      wrongPattern: rawItem.wrongPattern || rawItem.wrongExpression || "",
      correctPattern: rawItem.correctPattern || rawItem.saferVersion || "",
      originalExample: rawItem.currentExample || rawItem.originalExample || rawItem.original || rawItem.previousExample || "",
      correctedExample: rawItem.correctedExample || rawItem.corrected || "",
      explanationZh: rawItem.explanationZh || rawItem.whyWrongZh || "",
      memoryHookZh: rawItem.memoryHookZh || rawItem.memoryTipZh || "",
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: kind === "improved" ? 0 : 1,
      repeatedCount: kind === "repeated" ? 1 : 0,
      status: kind === "improved" ? "improved" : kind === "repeated" ? "repeated" : "new",
      masteryStatus: kind === "improved" ? "improving" : "not_mastered",
      nextPracticeZh: rawItem.nextPracticeZh || rawItem.whatToPractiseAgainZh || rawItem.practiceAgainZh || ""
    };
    container.errorRecords.push(record);
    return;
  }

  record.lastSeenAt = now;
  record.issueFamilyZh = rawItem.issueFamilyZh || record.issueFamilyZh || "";
  record.issueTitleZh = rawItem.issueTitleZh || record.issueTitleZh || "";
  record.wrongPattern = rawItem.wrongPattern || record.wrongPattern || "";
  record.correctPattern = rawItem.correctPattern || record.correctPattern || "";
  record.originalExample = rawItem.currentExample || rawItem.originalExample || record.originalExample || "";
  record.correctedExample = rawItem.correctedExample || record.correctedExample || "";
  record.explanationZh = rawItem.explanationZh || rawItem.whyWrongZh || record.explanationZh || "";
  record.memoryHookZh = rawItem.memoryHookZh || rawItem.memoryTipZh || record.memoryHookZh || "";
  record.nextPracticeZh = rawItem.nextPracticeZh || rawItem.whatToPractiseAgainZh || record.nextPracticeZh || "";

  if (kind === "improved") {
    record.status = "improved";
    record.masteryStatus = "improving";
    record.improvedAt = now;
    record.currentImprovementZh = rawItem.currentImprovementZh || record.currentImprovementZh || "";
    record.teacherPraiseZh = rawItem.teacherPraiseZh || record.teacherPraiseZh || "";
  } else {
    record.occurrenceCount = Number(record.occurrenceCount || 0) + 1;
    if (kind === "repeated") record.repeatedCount = Number(record.repeatedCount || 0) + 1;
    record.status = kind === "repeated" ? "repeated" : "seen_again";
    record.masteryStatus = "still_not_mastered";
  }
}

function upsertPattern(memory, rawItem = {}, task = "Task 2") {
  const scope = normalizeScope(rawItem.taskScope || rawItem.scope || rawItem.taskBucket, task);
  const container = scope === "sharedLanguage" ? memory.sharedLanguage : memory[scope];
  if (!container || !Array.isArray(container.masteredPatterns)) return;
  const pattern = String(rawItem.pattern || "").trim();
  if (!pattern) return;
  const id = idFrom(rawItem.patternId || rawItem.id || pattern);
  let record = container.masteredPatterns.find((item) => item.patternId === id || item.pattern === pattern);
  if (!record) {
    record = {
      patternId: id,
      taskBucket: scope,
      pattern,
      status: rawItem.status || "practising",
      firstSeenAt: new Date().toISOString(),
      lastUsedCorrectlyAt: rawItem.lastUsedCorrectlyAt || "",
      example: rawItem.example || "",
      relatedIssueId: rawItem.relatedIssueId || ""
    };
    container.masteredPatterns.push(record);
    return;
  }
  record.status = rawItem.status || record.status || "practising";
  record.example = rawItem.example || record.example || "";
  record.relatedIssueId = rawItem.relatedIssueId || record.relatedIssueId || "";
  record.lastUsedCorrectlyAt = rawItem.lastUsedCorrectlyAt || record.lastUsedCorrectlyAt || "";
}

function appendHomework(memory, homework = {}, task = "Task 2") {
  const scope = normalizeScope(homework.taskScope || homework.scope || homework.taskBucket, task);
  const container = scope === "sharedLanguage" ? memory.sharedLanguage : memory[scope];
  if (!container || !Array.isArray(container.homeworkHistory)) return null;
  const id = homework.id || idFrom("hw", homework.relatedIssueId, homework.focus, Date.now());
  const record = {
    id,
    taskBucket: scope,
    focus: homework.focus || "",
    assignedAt: homework.assignedAt || new Date().toISOString(),
    homeworkZh: homework.homeworkZh || homework.instructionZh || "",
    status: homework.status || "assigned",
    learnerAnswer: homework.learnerAnswer || "",
    teacherCheckZh: homework.teacherCheckZh || "",
    relatedIssueId: homework.relatedIssueId || homework.issueId || ""
  };
  container.homeworkHistory.push(record);
  return record;
}

function appendTeacherSummary(memory, summary = {}, task = "Task 2") {
  if (!summary || typeof summary !== "object" || !summary.summaryZh) return;
  const bucket = normalizeTask(task) === "Task 1" ? "task1" : "task2";
  memory[bucket].teacherSummaryHistory.push({
    date: summary.date || new Date().toISOString(),
    task: normalizeTask(task),
    summaryZh: summary.summaryZh || "",
    topTakeaways: asArray(summary.topTakeaways).slice(0, 6),
    nextLessonFocusZh: summary.nextLessonFocusZh || ""
  });
}

function mergeFeedbackMemory(memory, task, memoryUpdate = {}) {
  asArray(memoryUpdate.newErrors).forEach((item) => upsertError(memory, item, "new", task));
  asArray(memoryUpdate.repeatedErrors).forEach((item) => upsertError(memory, item, "repeated", task));
  asArray(memoryUpdate.improvedErrors).forEach((item) => upsertError(memory, item, "improved", task));
  asArray(memoryUpdate.masteredPatterns).forEach((item) => upsertPattern(memory, item, task));
  asArray(memoryUpdate.homeworkToSave).forEach((item) => appendHomework(memory, item, task));
  appendTeacherSummary(memory, memoryUpdate.teacherSummaryToSave, task);
  return memory;
}

function appendScoreHistory(memory, task, scoreRecord = {}) {
  const bucket = normalizeTask(task) === "Task 1" ? "task1" : "task2";
  memory[bucket].scoreHistory.push({
    date: scoreRecord.date || new Date().toISOString(),
    task: normalizeTask(task),
    promptId: scoreRecord.promptId || "",
    promptTitle: scoreRecord.promptTitle || "",
    promptType: scoreRecord.promptType || "",
    overall: scoreRecord.overall ?? null,
    criteria: scoreRecord.criteria || {},
    mainReasonZh: scoreRecord.mainReasonZh || ""
  });
  return memory;
}

function markHomeworkCompleted(memory, homeworkId, learnerAnswer = "", teacherCheckZh = "") {
  for (const bucket of ["task1", "task2", "sharedLanguage"]) {
    const list = memory[bucket]?.homeworkHistory || [];
    const record = list.find((item) => item.id === homeworkId);
    if (record) {
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.learnerAnswer = learnerAnswer || record.learnerAnswer || "";
      record.teacherCheckZh = teacherCheckZh || record.teacherCheckZh || "";
      return record;
    }
  }
  return null;
}

function appendRevisionHistory(memory, revisionRecord = {}) {
  memory.generation.revisionHistory.push({
    date: revisionRecord.date || new Date().toISOString(),
    task: revisionRecord.task || "",
    promptId: revisionRecord.promptId || "",
    promptTitle: revisionRecord.promptTitle || "",
    frozenBand: revisionRecord.frozenBand ?? null,
    targetBandPlus05: revisionRecord.targetBandPlus05 ?? null,
    verifiedBandPlus05: revisionRecord.verifiedBandPlus05 ?? null,
    attemptsPlus05: revisionRecord.attemptsPlus05 ?? null,
    targetBandPlus10: revisionRecord.targetBandPlus10 ?? null,
    verifiedBandPlus10: revisionRecord.verifiedBandPlus10 ?? null,
    attemptsPlus10: revisionRecord.attemptsPlus10 ?? null,
    status: revisionRecord.status || ""
  });
  return memory;
}

function resetScope(memory, scope = "all") {
  if (scope === "task1" || scope === "all") memory.task1 = emptyMemory().task1;
  if (scope === "task2" || scope === "all") memory.task2 = emptyMemory().task2;
  if (scope === "sharedLanguage" || scope === "all") memory.sharedLanguage = emptyMemory().sharedLanguage;
  if (scope === "generation" || scope === "all") memory.generation = emptyMemory().generation;
  if (scope === "all") memory.learnerPreference = emptyMemory().learnerPreference;
  return memory;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 200, { ok: true });
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const body = await readJsonBody(req);
    const action = String(body.action || "load");
    let memory = await loadMemory();

    if (action === "load" || action === "export") {
      return sendJson(req, res, 200, { ok: true, action, key: MEMORY_KEY, memory });
    }

    if (action === "mergeFeedbackMemory") {
      memory = mergeFeedbackMemory(memory, body.task || "Task 2", body.memoryUpdate || {});
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, memory });
    }

    if (action === "appendScoreHistory") {
      memory = appendScoreHistory(memory, body.task || "Task 2", body.scoreRecord || {});
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, memory });
    }

    if (action === "appendHomework") {
      const homework = appendHomework(memory, body.homework || {}, body.task || body.homework?.task || "Task 2");
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, homework, memory });
    }

    if (action === "markHomeworkCompleted") {
      const homework = markHomeworkCompleted(memory, body.homeworkId, body.learnerAnswer || "", body.teacherCheckZh || "");
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, homework, memory });
    }

    if (action === "appendRevisionHistory") {
      memory = appendRevisionHistory(memory, body.revisionRecord || {});
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, memory });
    }

    if (action === "reset") {
      memory = resetScope(memory, body.scope || "all");
      memory = await saveMemory(memory);
      return sendJson(req, res, 200, { ok: true, action, scope: body.scope || "all", memory });
    }

    return sendJson(req, res, 400, { ok: false, error: `Unknown action: ${action}` });
  } catch (error) {
    return sendJson(req, res, 500, {
      ok: false,
      error: error.message || String(error),
      detail: error.code === "MISSING_KV_ENV"
        ? "Set KV_REST_API_URL and KV_REST_API_TOKEN in Vercel Project Settings > Environment Variables, then redeploy."
        : ""
    });
  }
};
