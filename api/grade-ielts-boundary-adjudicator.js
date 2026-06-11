const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const SCORE_SYSTEM_VERSION = "boundary-adjudicator-v4-3-task1-anchor-calibration";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const VALID_BANDS = [0, ...Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(req, res, status, payload) {
  setCors(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_500_000) {
        const error = new Error("Request body too large");
        error.status = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch {
        const error = new Error("Invalid JSON body");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeTask(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("1") || s.includes("letter") || s === "task1") return "Task 1";
  if (s.includes("2") || s.includes("essay") || s === "task2") return "Task 2";
  return "Task 2";
}

function criterionNames(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function wordCount(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
}

function roundHalf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9, Math.round(n * 2) / 2));
}

function isValidBand(value) {
  const n = Number(value);
  return Number.isFinite(n) && VALID_BANDS.some((b) => Math.abs(b - n) < 0.001);
}

function averageBand(criteria, task) {
  const values = criterionNames(task).map((name) => Number(criteria?.[name]));
  if (values.some((v) => !Number.isFinite(v))) return null;
  return roundHalf(values.reduce((a, b) => a + b, 0) / values.length);
}

function validateCriteria(criteria, task) {
  const out = {};
  for (const name of criterionNames(task)) {
    const n = Number(criteria?.[name]);
    if (!isValidBand(n)) throw new Error(`Invalid or missing adjudicator criterion band: ${name}`);
    out[name] = n;
  }
  return out;
}

function extractJson(text) {
  const s = String(text || "").trim();
  try { return JSON.parse(s); } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  throw new Error("AI did not return valid JSON");
}

function getBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "ielts-gt-writing-hub.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ielts-boundary-adjudicator-v4-3" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, raw: text }; }
    if (!response.ok || data?.ok === false) {
      const detail = data?.error || data?.message || text.slice(0, 500);
      const error = new Error(`Endpoint ${url} failed ${response.status}: ${detail}`);
      error.status = 502;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeScoreResponse(data) {
  if (data && typeof data === "object") {
    if (data.result && typeof data.result === "object") return data.result;
    if (data.data && typeof data.data === "object") return data.data;
    if (data.score && typeof data.score === "object") return data.score;
  }
  return data;
}

function extractScore(data) {
  const d = normalizeScoreResponse(data);
  const score = roundHalf(d?.overallBand ?? d?.scoreCalculation?.finalBand ?? d?.finalBand ?? d?.band ?? d?.overall);
  return {
    raw: d || {},
    ok: d?.ok !== false && Number.isFinite(score),
    score,
    version: d?.scoreSystemVersion || d?.version || "",
    task: d?.task || d?.scoringTask || "",
    criteria: d?.finalCriteria || d?.criteria || d?.scoreCalculation?.criteria || {},
    decision: d?.routingDecision || d?.decision || d?.lowBandDecision || d?.highBandDecision || "",
    error: d?.error || d?.message || ""
  };
}

function frozenMainFromBody(body, task) {
  const raw = body.frozenMainResult || body.mainResult || body.mainScoreResult || null;
  if (!raw || typeof raw !== "object") return null;

  const main = extractScore(raw);
  const score = roundHalf(body.frozenMainScore ?? main.score);
  const criteria = body.frozenMainCriteria || main.criteria;
  const mainTask = normalizeTask(raw.task || raw.scoringTask || raw.requestedTask || raw.selectedTask || main.task || task);

  if (!main.ok || !Number.isFinite(score)) return null;
  if (mainTask !== task) return null;

  return {
    ...main,
    score,
    criteria,
    task: mainTask,
    reusedFromRouter: true,
    frozenMainSource: "production-router-main-first-pass"
  };
}

async function callMainAndLowband(req, body, task, promptText, essayText) {
  const base = getBaseUrl(req);
  const common = {
    mode: "score",
    aiStage: "score-core",
    task,
    taskType: task === "Task 1" ? "task1" : "task2",
    scoringTask: task,
    requestedTask: task,
    selectedTask: task,
    questionPrompt: promptText,
    promptText,
    prompt: promptText,
    essay: essayText,
    answer: essayText,
    response: essayText,
    text: essayText,
    wordCount: wordCount(essayText),
    boundaryAdjudicatorCaller: true
  };

  const mainUrl = process.env.MAIN_SCORE_ENDPOINT || `${base}/api/grade-ielts`;
  const lowUrl = process.env.LOWBAND_SCORE_ENDPOINT || `${base}/api/grade-ielts-lowband`;
  const frozenMain = frozenMainFromBody(body, task);

  const [mainRaw, lowRaw] = await Promise.all([
    frozenMain ? Promise.resolve(frozenMain.raw) : postJson(mainUrl, common),
    postJson(lowUrl, common)
  ]);

  const main = frozenMain || extractScore(mainRaw);
  const lowband = extractScore(lowRaw);

  if (!main.ok) throw new Error(main.error || "Main score endpoint did not return a valid score");
  if (!lowband.ok) throw new Error(lowband.error || "Lowband endpoint did not return a valid score");

  return {
    main,
    lowband,
    mainUrl,
    lowUrl,
    mainReusedFromRouter: Boolean(frozenMain),
    mainSource: frozenMain ? "frozen-main-from-production-router" : "fresh-main-called-by-boundary"
  };
}
function weakLanguageSignal(criteria, task) {
  const names = criterionNames(task);
  const values = names.map((name) => Number(criteria?.[name])).filter(Number.isFinite);
  if (!values.length) return false;
  const lr = Number(criteria?.["Lexical Resource"]);
  const gra = Number(criteria?.["Grammatical Range and Accuracy"]);
  return (Number.isFinite(lr) && lr <= 4.5) || (Number.isFinite(gra) && gra <= 4.5) || values.some((v) => v <= 4.0);
}

function routeDecision(task, wc, main, lowband) {
  const mainScore = Number(main.score);
  const lowScore = Number(lowband.score);
  const gap = Math.abs(mainScore - lowScore);

  const base = {
    mainScore,
    lowbandScore: lowScore,
    scoreGap: roundHalf(gap),
    zone: "",
    decision: "",
    confidence: "medium",
    conflict: false,
    adjudicate: false,
    reasonCodes: []
  };

  if (mainScore <= 4.0) {
    base.zone = "lowband_zone";
    if (lowScore <= 4.5) {
      base.decision = "lowband_confirms_low_score";
      base.confidence = "medium";
      base.conflict = false;
      base.adjudicate = false;
      base.reasonCodes.push("MAIN_LOW_LOWBAND_CONFIRMS");
      return base;
    }
    base.decision = "lowband_conflict_adjudicate";
    base.confidence = "unstable";
    base.conflict = true;
    base.adjudicate = true;
    base.reasonCodes.push("MAIN_LOW_LOWBAND_HIGH_CONFLICT");
    return base;
  }

  if (mainScore === 4.5) {
    base.zone = "boundary_4_5";
    if (lowScore <= 4.0) {
      base.decision = "boundary_4_5_lowband_anchor_adjudicate";
      base.confidence = "unstable";
      base.conflict = true;
      base.adjudicate = true;
      base.reasonCodes.push("V4_3_TASK1_LOW4_PROBE_IF_EVIDENCE_WEAK");
      base.reasonCodes.push("MAIN_4_5_LOWBAND_4_OR_BELOW");
      return base;
    }
    if (gap <= 0.5) {
      base.decision = "use_main_lowband_consistent";
      base.conflict = false;
      base.adjudicate = false;
      base.reasonCodes.push("BOUNDARY_4_5_CONSISTENT");
      return base;
    }
    base.decision = "boundary_4_5_gap_adjudicate";
    base.confidence = "unstable";
    base.conflict = true;
    base.adjudicate = true;
    base.reasonCodes.push("BOUNDARY_4_5_GAP_GE_1");
    return base;
  }

  if (mainScore === 5.0) {
    base.zone = "boundary_5_0";
    if (lowScore >= 4.5 && gap <= 0.5) {
      base.decision = "use_main";
      base.conflict = false;
      base.adjudicate = false;
      base.reasonCodes.push("BOUNDARY_5_0_LOWBAND_NEAR");
      return base;
    }
    base.decision = "boundary_5_0_low4_basic5_strict_adjudicate";
    base.confidence = "unstable";
    base.conflict = true;
    base.adjudicate = true;
    if (lowScore <= 4.0) base.reasonCodes.push("MAIN_5_LOWBAND_4_OR_BELOW");
    if (gap >= 1.0) base.reasonCodes.push("BOUNDARY_5_0_GAP_GE_1");
    base.reasonCodes.push("STRICT_LOW4_BASIC5_SEPARATOR_REQUIRED");
      if (task === "Task 1" && lowScore <= 4.0) base.reasonCodes.push("V4_3_TASK1_MAIN5_LOWBAND4_LOW4_PROBE");
    return base;
  }

  if (mainScore >= 5.5) {
    base.zone = "main_5_5_plus";
    const task1Suspicious = task === "Task 1" && mainScore >= 6.0 && lowScore <= 5.0;
    const veryLowLowband = lowScore <= 4.0;
    const shortTask1 = task === "Task 1" && wc < 180 && mainScore >= 6.0 && lowScore <= 5.0;
    const lowbandWeakLanguage = weakLanguageSignal(lowband.criteria, task);
    const mainHighLowbandWeak = mainScore >= 5.5 && lowScore <= 4.5 && lowbandWeakLanguage;

    if (task1Suspicious || veryLowLowband || shortTask1 || mainHighLowbandWeak || gap >= 1.5) {
      base.decision = "main_high_lowband_conflict_adjudicate";
      base.confidence = "unstable";
      base.conflict = true;
      base.adjudicate = true;
      base.reasonCodes.push("V4_3_HYBRID_ANTI_INFLATION_REVIEW");
      if (task1Suspicious) base.reasonCodes.push("TASK1_MAIN_HIGH_LOWBAND_LOW");
      if (task1Suspicious && mainScore >= 6.0 && lowScore <= 4.0) base.reasonCodes.push("V4_3_55_PROTECTION_REQUIRES_STRONG_EVIDENCE");
      if (task === "Task 1" && mainScore >= 7.0 && lowScore <= 5.0) base.reasonCodes.push("V4_3_TASK1_MAIN7_LOWBAND5_ANTI_INFLATION");
      if (veryLowLowband) base.reasonCodes.push("LOWBAND_VERY_LOW_AGAINST_MAIN");
      if (shortTask1) base.reasonCodes.push("SHORT_OR_BORDERLINE_TASK1_MAIN_HIGH");
      if (mainHighLowbandWeak) base.reasonCodes.push("LOWBAND_WEAK_LANGUAGE_SIGNAL");
      if (gap >= 1.5) base.reasonCodes.push("GAP_GE_1_5");
      return base;
    }

    base.decision = "use_main";
    base.conflict = false;
    base.adjudicate = false;
    base.confidence = "stable";
    base.reasonCodes.push("MAIN_SAFE_5_5_PLUS");
    return base;
  }

  base.zone = "other";
  base.decision = "use_main";
  base.conflict = gap >= 1.0;
  base.adjudicate = gap >= 1.0;
  if (base.conflict) {
    base.confidence = "unstable";
    base.reasonCodes.push("OTHER_GAP_CONFLICT");
  } else {
    base.reasonCodes.push("OTHER_MAIN_DEFAULT");
  }
  return base;
}

function adjudicatorPrompt(task, questionPrompt, essay, main, lowband, route) {
  const names = criterionNames(task);
  return [
    "You are the IELTS General Training Writing BOUNDARY ADJUDICATOR v4.3.",
    "You resolve conflicts between the main scorer and the low-band shadow scorer.",
    "You must not average the two scores. You must choose your own final criteria and final band from the writing evidence.",
    "Use IELTS bands in 0.5 increments.",
    `Locked task: ${task}. Criteria keys must be exactly: ${JSON.stringify(names)}.`,
    "",
    "Classification options:",
    "- low_4_band: around 3.5-4.0; weak control, thin task development, frequent errors, limited vocabulary, basic sequencing.",
    "- boundary_4_5: around 4.0-4.5; recognizable response, some organization, but language and development remain limited.",
    "- basic_5: around 5.0; generally understandable and task-relevant, but basic development and frequent language limitations.",
    "- safe_5_5_plus: around 5.5 or above; clearly above low-band weakness, enough specific detail/development, mostly controlled progression, and LR/GRA not merely basic.",
    "",
    "Core v4.3 rule:",
    "Use v4.2 hybrid as the base. Preserve the strong protection for 4.0 and 4.5 boundary samples.",
    "Do NOT reopen broad basic_5 inflation.",
    "v4.3 only tightens two Task 1 boundary cases:",
    "1) Task 1 main=5 / lowband=4 low-band probe;",
    "2) Task 1 main=7 / lowband=5 anti-inflation.",
    "",
    "Task 1 main=5 / lowband=4 low-band probe:",
    "When Task 1 has mainScore around 5.0 and lowbandScore around 4.0, check whether the letter is actually still low_4_band.",
    "If the letter has frequent basic grammar errors, very limited vocabulary, formulaic wording, and only simple bullet coverage, choose low_4_band or boundary_4_5 conservatively.",
    "Do not give basic_5 just because the letter covers the bullet points, has paragraphs, or is understandable.",
    "If LR/GRA are around 3.5-4.0 and development is thin, low_4_band is allowed.",
    "",
    "Task 1 main=7 / lowband=5 anti-inflation:",
    "When Task 1 mainScore is 7.0 or higher but lowbandScore is 5.0 or below, treat the main score as a possible over-reward for format, length, and surface fluency.",
    "A GT letter around 170-180 words should not receive final 6.0 unless it has clearly developed bullet points, accurate tone, flexible vocabulary, and grammar mostly above basic level.",
    "If it is complete and coherent but still simple or formulaic, choose basic_5 or at most a cautious 5.5.",
    "Do not choose final 6.0 unless LR and GRA are truly around 6.0 and task development is strong.",
    "",
    "Preserve 4.0 and 4.5 protection:",
    "If lowbandScore is 4.0, final LR/GRA around 4.0, and the writing is understandable but basic, boundary_4_5 is usually the safest outcome.",
    "Do not lift 4.0/4.5 samples to 5.0/5.5 because of full word count, paragraph count, clear opinion, or correct letter format.",
    "",
    "Task 2 relabel awareness:",
    "Some full-length Task 2 low-band-looking samples may be closer to 4.5 than 3.5. Do not force them down to 3.5 unless they are genuinely very weak.",
    "For Task 2, maintain v4.2 behavior: avoid broad basic_5 inflation but do not over-apply Task 1 low-4 probing.",
    "",
    "5.5 protection:",
    "Do not collapse a plausible 5.5 all the way to 4.5 without clear low-band evidence.",
    "However, do not let this protection lift weaker 4.0/4.5 samples.",
    "",
    "Conflict handling:",
    "When main is much higher than lowband, identify whether main over-rewarded format, length, or fluency.",
    "When lowband is much lower than main, identify whether lowband over-penalized simplicity despite adequate task fulfilment.",
    "If evidence is mixed, prefer the conservative adjacent band.",
    "",
    `Route decision before adjudication: ${JSON.stringify(route)}`,
    `Main system score: ${main.score}`,
    `Main criteria: ${JSON.stringify(main.criteria || {})}`,
    `Main version: ${main.version}`,
    `Lowband score: ${lowband.score}`,
    `Lowband criteria: ${JSON.stringify(lowband.criteria || {})}`,
    `Lowband version: ${lowband.version}`,
    "",
    `Question prompt:\n${questionPrompt || ""}`,
    "",
    `Student response:\n${essay || ""}`,
    "",
    "Return exactly this JSON shape:",
    "{\"ok\":true,\"aiStage\":\"boundary-adjudicator-v4-3\",\"classification\":\"low_4_band or boundary_4_5 or basic_5 or safe_5_5_plus\",\"finalCriteria\":{...four numeric criterion bands...},\"rationaleCodes\":[\"short_code\"],\"whyMainTooHigh\":[\"short_code\"],\"whyLowbandTooLow\":[\"short_code\"],\"confidence\":\"low or medium or high\"}"
  ].join("\n");
}

async function callDeepSeek(messages, temperature = 0.1) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("Missing DEEPSEEK_API_KEY environment variable for boundary adjudicator");
    error.status = 500;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature,
        response_format: { type: "json_object" },
        messages
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!response.ok) {
      const detail = data?.error?.message || text.slice(0, 800);
      const error = new Error(`DeepSeek API error ${response.status}: ${detail}`);
      error.status = 502;
      throw error;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek response missing message content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function adjudicate(task, questionPrompt, essay, main, lowband, route) {
  const prompt = adjudicatorPrompt(task, questionPrompt, essay, main, lowband, route);
  const content = await callDeepSeek([
    { role: "system", content: "You are a strict IELTS General Training Writing boundary adjudicator v4.3. Preserve v4.2 boundary protection and apply two narrow Task 1 anchor calibrations. Return JSON only." },
    { role: "user", content: prompt }
  ], 0.1);

  const parsed = extractJson(content);
  const finalCriteria = validateCriteria(parsed.finalCriteria || parsed.criteria, task);
  const finalBand = averageBand(finalCriteria, task);
  if (finalBand == null) throw new Error("Could not calculate boundary adjudicator final band");

  return {
    parsed,
    finalCriteria,
    finalBand,
    classification: parsed.classification || "",
    confidence: parsed.confidence || "medium"
  };
}

function selectWithoutAdjudication(route, main, lowband) {
  if (route.decision === "lowband_confirms_low_score") {
    return {
      finalBand: lowband.score,
      finalCriteria: lowband.criteria,
      finalSource: "lowband-confirmed-low-score",
      confidence: route.confidence
    };
  }

  return {
    finalBand: main.score,
    finalCriteria: main.criteria,
    finalSource: "main-score",
    confidence: route.confidence
  };
}

module.exports = async function handler(req, res) {
  try {
    setCors(req, res);
    if (req.method === "OPTIONS") return sendJson(req, res, 200, { ok: true });
    if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed. Use POST." });

    const body = await readJsonBody(req);
    const task = normalizeTask(body.task || body.scoringTask || body.taskType || body.selectedTask);
    const questionPrompt = body.questionPrompt || body.promptText || body.prompt || body.question || "";
    const essay = body.essay || body.answer || body.response || body.text || "";

    if (!String(essay).trim()) return sendJson(req, res, 400, { ok: false, error: "Missing essay text" });

    const wc = wordCount(essay);
    const { main, lowband, mainUrl, lowUrl, mainReusedFromRouter, mainSource } = await callMainAndLowband(req, body, task, questionPrompt, essay);
    const route = routeDecision(task, wc, main, lowband);

    let adjudicator = null;
    let selected;

    if (route.adjudicate) {
      adjudicator = await adjudicate(task, questionPrompt, essay, main, lowband, route);
      selected = {
        finalBand: adjudicator.finalBand,
        finalCriteria: adjudicator.finalCriteria,
        finalSource: "boundary-adjudicator-v4-3",
        confidence: adjudicator.confidence
      };
    } else {
      selected = selectWithoutAdjudication(route, main, lowband);
    }

    const payload = {
      ok: true,
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      boundaryAdjudicator: true,
      productionScoreChanged: false,
      task,
      scoringTask: task,
      wordCount: wc,
      finalBand: selected.finalBand,
      overallBand: selected.finalBand,
      band: selected.finalBand,
      finalCriteria: selected.finalCriteria,
      criteria: selected.finalCriteria,
      finalSource: selected.finalSource,
      confidence: selected.confidence,
      route,
      mainScore: main.score,
      lowbandScore: lowband.score,
      scoreGap: route.scoreGap,
      main,
      lowband,
      boundaryMainReuseAudit: {
        mainReusedFromRouter,
        mainSource,
        productionRouterMainFrozen: Boolean(body.productionRouterMainFrozen),
        note: mainReusedFromRouter
          ? "Boundary adjudicator reused the production router's first-pass main score and did not call the main scorer again."
          : "Boundary adjudicator used compatibility mode and called the main scorer itself."
      },
      adjudicator: adjudicator ? {
        finalBand: adjudicator.finalBand,
        finalCriteria: adjudicator.finalCriteria,
        classification: adjudicator.classification,
        confidence: adjudicator.confidence,
        audit: adjudicator.parsed
      } : null,
      endpoints: {
        main: mainReusedFromRouter ? null : mainUrl,
        lowband: lowUrl
      },
      disclaimer: "This is an AI boundary adjudication preview, not an official IELTS score."
    };

    return sendJson(req, res, 200, payload);
  } catch (err) {
    return sendJson(req, res, err.status || 500, {
      ok: false,
      boundaryAdjudicator: true,
      productionScoreChanged: false,
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      error: err.message || "Boundary adjudicator failed."
    });
  }
};
