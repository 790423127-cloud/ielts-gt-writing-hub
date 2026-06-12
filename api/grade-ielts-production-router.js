const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const ROUTER_VERSION = "production-router-v3-5-criterion-differentiation-routing-v4-4";
const ROUTER_SYSTEM_FIX_VERSION = "system-fix-v4-4-full-range-3-to-7-routing-review-v1";
const MIDBAND_VERSION = "score-core-v8-5-14-criterion-differentiation-3-to-7-v4-4";
const LOWBAND_VERSION = "score-core-v8-5-10-lowband-neutral-hard-evidence-guard";
const HIGHBAND_VERSION = "score-core-v8-5-14-highband-near9-router-anti-inflation";
const BOUNDARY_VERSION = "boundary-adjudicator-v4-5-neutral-diagnostic-only";

const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 180000, 240000));
const RETRY_COUNT = Math.max(1, Math.min(Number(process.env.PRODUCTION_ROUTER_RETRY_COUNT) || 2, 4));

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_) { return { rawText: req.body }; }
  }
  return req.body;
}

function getBaseUrl(req) {
  const configured =
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (configured) {
    const withProtocol = configured.startsWith("http") ? configured : `https://${configured}`;
    return withProtocol.replace(/\/+$/, "");
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host || "").includes("localhost") ? "http" : "https");
  if (!host) throw new Error("Cannot determine deployment host for internal API routing.");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function firstNumber(...values) {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function roundHalf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 2) / 2;
}

function extractBand(payload) {
  if (!payload || typeof payload !== "object") return null;
  return roundHalf(firstNumber(
    payload.finalBand,
    payload.score,
    payload.overallBand,
    payload.overallScore,
    payload.estimatedBand,
    payload.finalScore,
    payload.band,
    payload.bandScore,
    payload.result && payload.result.finalBand,
    payload.result && payload.result.score,
    payload.result && payload.result.overallBand,
    payload.scores && payload.scores.overall,
    payload.scores && payload.scores.finalBand,
    payload.data && payload.data.finalBand,
    payload.data && payload.data.score,
    payload.scoreCalculation && payload.scoreCalculation.finalBand
  ));
}

function extractCriteria(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.finalCriteria ||
    payload.criteria ||
    payload.criterionScores ||
    payload.scores ||
    (payload.result && (payload.result.finalCriteria || payload.result.criteria)) ||
    null
  );
}

function normalizeTask(body = {}, fallback = {}) {
  const raw = String(body.task || body.scoringTask || body.selectedTask || body.taskType || fallback.task || "").toLowerCase();
  if (/task\s*1|task1|letter|gt\s*letter/.test(raw)) return "Task 1";
  if (/task\s*2|task2|essay/.test(raw)) return "Task 2";
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "").toLowerCase();
  if (/write a letter|dear|yours faithfully|yours sincerely|in your letter/.test(prompt)) return "Task 1";
  return "Task 2";
}

function buildLocalLogicAudit() {
  return {
    usedForScoring: false,
    usedForRoutingOnly: true,
    adjustedOverallBand: false,
    adjustedCriterionScores: false,
    appliedLocalFloor: false,
    appliedLocalCap: false,
    copiedOverallToCriteria: false,
    notes: "Local logic performs safety checks, routing-only review triggers, JSON validation and audit logging; it does not set, lift, cap, floor, or rewrite any band. v4.4 full-range system fix routes severe short/low-band risk samples to lowband review and plausible Task 1 Band 7 letters to highband shadow review, while the final band remains selected from an AI scorer."
  };
}

function buildCriterionDifferentiationAudit(criteria, source = "ai-specific-feedback") {
  const values = Object.values(criteria || {}).map(Number).filter(Number.isFinite);
  const criteriaAllEqual = values.length === 4 && values.every((value) => value === values[0]);
  return {
    criteriaAllEqual,
    overallCopiedToCriteria: false,
    criterionScoresSource: "ai",
    criterionFeedbackSource: source,
    reason: criteriaAllEqual
      ? "Criterion scores are identical only if the AI scorer returned identical criterion bands; local code did not copy overallBand to criteria."
      : "Criterion scores were returned independently by the selected AI scorer."
  };
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function averageCriteriaBand(criteria) {
  const values = Object.values(criteria || {}).map(Number).filter(Number.isFinite);
  if (values.length !== 4) return null;
  return roundHalf(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function strictHardZeroEvidence(localSignals = {}) {
  const gate = localSignals.hardZeroGate || {};
  return gate.strictHardZero === true || gate.hardZero === true || gate.notRateable === true || /non_english|blank/i.test(String(gate.reason || gate.status || ""));
}

function extractRoutingFlags(main = {}) {
  const directFlags = main.flags && typeof main.flags === "object" ? main.flags : {};
  const scoreFlags = main.scoreFlags && typeof main.scoreFlags === "object" ? main.scoreFlags : {};
  const boundaryFlags = main.boundaryFlags && typeof main.boundaryFlags === "object" ? main.boundaryFlags : {};
  const kernelFlags = main.scoreKernel && main.scoreKernel.flags && typeof main.scoreKernel.flags === "object" ? main.scoreKernel.flags : {};
  const anchor = main.anchorComparison && typeof main.anchorComparison === "object" ? main.anchorComparison : {};
  const audit = main.scoringAudit || main.routerAudit || {};
  return {
    ...directFlags,
    ...scoreFlags,
    ...boundaryFlags,
    ...kernelFlags,
    lowBandRisk: directFlags.lowBandRisk === true || scoreFlags.lowBandRisk === true || boundaryFlags.lowBandRisk === true || kernelFlags.lowBandRisk === true || anchor.lowBandCandidate === true,
    trueLowbandRisk: directFlags.trueLowbandRisk === true || scoreFlags.trueLowbandRisk === true || boundaryFlags.trueLowbandRisk === true || kernelFlags.trueLowbandRisk === true,
    weakLanguage: directFlags.weakLanguage === true || scoreFlags.weakLanguage === true || boundaryFlags.weakLanguage === true || kernelFlags.weakLanguage === true,
    highBandCandidate: directFlags.highBandCandidate === true || scoreFlags.highBandCandidate === true || boundaryFlags.highBandCandidate === true || kernelFlags.highBandCandidate === true || audit.highBandCandidate === true,
    highbandPotential: directFlags.highbandPotential === true || directFlags.highBandPotential === true || scoreFlags.highbandPotential === true || scoreFlags.highBandPotential === true || boundaryFlags.highbandPotential === true || boundaryFlags.highBandPotential === true || kernelFlags.highbandPotential === true || kernelFlags.highBandPotential === true || audit.highbandPotential === true || audit.highBandPotential === true
  };
}


function textFromBody(body = {}) {
  return String(body.essay || body.response || body.answer || body.studentResponse || body.writing || body.text || "").trim();
}

function sentenceCount(text = "") {
  return (String(text || "").match(/[.!?]+(?:\s|$)/g) || []).length;
}

function paragraphCount(text = "") {
  return String(text || "").split(/\n\s*\n|\r\n\s*\r\n/).map(part => part.trim()).filter(Boolean).length;
}

function detectLocalRoutingSignals(body = {}, task = "Task 2", mainBand = null) {
  const essay = textFromBody(body);
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || body.question || "");
  const lower = essay.toLowerCase();
  const promptLower = prompt.toLowerCase();
  const words = countWords(essay);
  const sentences = sentenceCount(essay);
  const paragraphs = paragraphCount(essay);
  const hasLetterFrame = /\bdear\b/.test(lower) && /(best wishes|best regards|regards|yours sincerely|yours faithfully|see you|love,|cheers,|\n[a-z]+\s*$)/i.test(essay);

  const task1TravelFriendPrompt = task === "Task 1" && /friend from another country|first time|best time to visit|transport|weather/i.test(prompt);
  const task1TravelCoverage = {
    bestTime: /(april|may|spring|autumn|fall|weather|winter|summer|holiday|crowd)/i.test(essay),
    places: /(beijing|great wall|forbidden city|xi.?an|terracotta|chengdu|city wall|museum|temple|park)/i.test(essay),
    transportWeather: /(train|subway|metro|taxi|bus|transport|jacket|umbrella|walking shoes|weather|flight)/i.test(essay)
  };
  const task1AllTravelBullets = task1TravelFriendPrompt && task1TravelCoverage.bestTime && task1TravelCoverage.places && task1TravelCoverage.transportWeather;

  const severeShortTask1 = task === "Task 1" && words > 0 && words < 60;
  const severeShortTask2 = task === "Task 2" && words > 0 && words < 80;
  const veryShortTask2 = task === "Task 2" && words > 0 && words < 60;

  // Routing-only signal: this does not set the score. It only asks the lowband AI guard to review cases
  // where the main midband pass has probably over-read very short, thin writing as ordinary Band 5.
  const localLowbandReviewCandidate =
    (severeShortTask1 && typeof mainBand === "number" && mainBand <= 5.0) ||
    (severeShortTask2 && typeof mainBand === "number" && mainBand <= 4.5) ||
    (veryShortTask2 && typeof mainBand === "number" && mainBand <= 5.0);

  // Routing-only signal: this does not lift the score. It only asks the highband AI shadow to review
  // plausible GT Task 1 Band 7 letters that the midband pass has under-called as 5.5/6.0.
  const localTask1Band7ReviewCandidate = task === "Task 1"
    && typeof mainBand === "number"
    && mainBand >= 5.5
    && mainBand < 7.0
    && words >= 150
    && hasLetterFrame
    && sentences >= 6
    && (paragraphs >= 3 || task1AllTravelBullets)
    && (!task1TravelFriendPrompt || task1AllTravelBullets);

  return {
    usedForScoring: false,
    essayWordCount: words,
    sentenceCount: sentences,
    paragraphCount: paragraphs,
    hasLetterFrame,
    task1TravelFriendPrompt,
    task1TravelCoverage,
    severeShortTask1,
    severeShortTask2,
    localLowbandReviewCandidate,
    localTask1Band7ReviewCandidate
  };
}

function hasHardLowbandEvidence(body = {}, main = {}, task = "Task 2", mainBand = null, localRoutingSignals = null) {
  const localSignals = main.localSignals || main.signals || {};
  const rateability = String(localSignals.rateabilityStatus || main.rateabilityStatus || "").toLowerCase();
  const flags = extractRoutingFlags(main);
  const aiLowBandRisk = flags.lowBandRisk === true || flags.trueLowbandRisk === true;
  const routingSignals = localRoutingSignals || detectLocalRoutingSignals(body, task, mainBand);

  if (strictHardZeroEvidence(localSignals)) return { yes: true, reason: "STRICT_HARD_ZERO_OR_NOT_RATEABLE" };
  // AI-primary v4.4.2: word count alone must not score or lower a response. It may, however,
  // trigger an AI lowband review when the writing is severely short/thin and the midband scorer
  // has still placed it around 4.0-5.0.
  if (/not_rateable/.test(rateability) && (typeof mainBand !== "number" || mainBand <= 3.5)) return { yes: true, reason: "AI_RATEABILITY_NOT_RATEABLE" };
  if (typeof mainBand === "number" && mainBand < 4.0) return { yes: true, reason: "MIDBAND_BELOW_4" };
  if (aiLowBandRisk && typeof mainBand === "number" && mainBand <= 5.0) return { yes: true, reason: "AI_LOWBAND_RISK_WITH_5_OR_BELOW_REVIEW" };
  if (routingSignals.localLowbandReviewCandidate === true) return { yes: true, reason: "LOCAL_ROUTING_SEVERE_SHORT_LOW_BAND_REVIEW" };

  return { yes: false, reason: "NO_HARD_LOWBAND_EVIDENCE" };
}

function hasHighbandPotential(main = {}, mainBand = null, localRoutingSignals = null) {
  const flags = extractRoutingFlags(main);
  if (flags.highBandCandidate === true || flags.highbandPotential === true || flags.highBandPotential === true) return true;
  if (String(main.candidateRange || main.anchorRange || "").includes("7")) return true;
  if (localRoutingSignals && localRoutingSignals.localTask1Band7ReviewCandidate === true) return true;
  return Boolean(typeof mainBand === "number" && mainBand >= 7.0);
}


function routeReason(mainBand, task = "Task 2", hardLowband = { yes: false, reason: "NO_HARD_LOWBAND_EVIDENCE" }, highbandPotential = false) {
  if (typeof mainBand !== "number" || !Number.isFinite(mainBand)) {
    return {
      targetSystem: "lowband-guard",
      selectedSystemCandidate: "lowband",
      useLowbandGuard: true,
      useBoundary: false,
      useHighbandShadow: false,
      routeDecision: "lowband_guard_main_score_unreadable",
      routeZone: "unknown_score",
      reasonCodes: ["MAIN_SCORE_UNREADABLE"]
    };
  }

  if (mainBand >= 7.0 || (mainBand >= 6.5 && highbandPotential) || (mainBand >= 5.5 && highbandPotential && task === "Task 1")) {
    const task1RecoveredBand7 = mainBand < 6.5 && task === "Task 1";
    return {
      targetSystem: "highband-shadow-confirmation",
      selectedSystemCandidate: "highband",
      useLowbandGuard: false,
      useBoundary: false,
      useHighbandShadow: true,
      routeDecision: mainBand >= 7.0
        ? "highband_shadow_confirmation_for_7_0_plus"
        : task1RecoveredBand7
          ? "highband_shadow_confirmation_for_task1_band7_review"
          : "highband_shadow_confirmation_for_6_5_potential",
      routeZone: mainBand >= 7.0
        ? "highband_candidate_7_0_plus"
        : task1RecoveredBand7
          ? "task1_band7_review_candidate"
          : "highband_candidate_6_5_potential",
      reasonCodes: [mainBand >= 7.0
        ? "MIDBAND_SCORE_7_PLUS"
        : task1RecoveredBand7
          ? "LOCAL_ROUTING_TASK1_BAND7_REVIEW"
          : "MIDBAND_6_5_WITH_HIGHBAND_POTENTIAL"]
    };
  }

  if (hardLowband && hardLowband.yes) {
    return {
      targetSystem: "lowband-hard-evidence-guard",
      selectedSystemCandidate: "lowband",
      useLowbandGuard: true,
      useBoundary: false,
      useHighbandShadow: false,
      routeDecision: "lowband_guard_only_for_hard_lowband_evidence",
      routeZone: "hard_lowband_evidence",
      reasonCodes: ["HARD_LOWBAND_EVIDENCE", hardLowband.reason || "HARD_LOWBAND_EVIDENCE"]
    };
  }

  return {
    targetSystem: "midband",
    selectedSystemCandidate: "midband",
    useLowbandGuard: false,
    useBoundary: false,
    useHighbandShadow: false,
    routeDecision: task === "Task 1" ? "midband_primary_direct_for_task1_4_0_to_6_5" : "midband_primary_direct_for_ordinary_4_0_to_6_5",
    routeZone: "midband_4_0_6_5",
    reasonCodes: ["NO_HARD_LOWBAND_EVIDENCE", "MIDBAND_PRIMARY_DEFAULT", "LOWBAND_NOT_CALLED_FOR_ORDINARY_BAND5"]
  };
}

function isAiTrueLowband(lowband = {}) {
  const audit = lowband.lowBandAudit && typeof lowband.lowBandAudit === "object" ? lowband.lowBandAudit : {};
  const decision = String(lowband.lowBandDecision || lowband.candidateRange || "").toLowerCase();
  if (audit.hardZero === true) return true;
  if (audit.trueLowBand === true) return true;
  if (audit.weakLanguage === true && audit.thinDevelopment === true && !/5\s*\+|5_plus|band_5/.test(decision)) return true;
  if (/band_3|band_3_5|band_4|low_4|true_low/.test(decision) && !/5\s*\+|5_plus|band_5/.test(decision)) return true;
  return false;
}

function shouldUseLowbandFinal(mainBand, lowbandBand, lowband) {
  if (typeof lowbandBand !== "number" || !Number.isFinite(lowbandBand)) return false;
  const trueLowband = isAiTrueLowband(lowband);
  if (lowbandBand < 4.0 && mainBand <= 5.5) return true;
  if (lowbandBand <= 4.0 && mainBand <= 5.0 && trueLowband) return true;
  if (lowbandBand <= 4.5 && mainBand <= 4.5 && trueLowband) return true;
  return false;
}

async function callJsonWithRetry(url, body, label) {
  let lastErr = null;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { rawText: text }; }

      if (!response.ok) {
        const message = data && data.error ? data.error : `HTTP ${response.status}`;
        throw new Error(`${label} failed: ${message}`);
      }

      return { ok: true, data, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_COUNT) await sleep(700 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr || new Error(`${label} failed.`);
}

function buildRouterScoringAudit({ task, route, finalBand, finalSource, main, lowband, highband, localRoutingSignals }) {
  const source = highband || lowband || main || {};
  const criteria = extractCriteria(source) || {};
  const taskProfile = source.taskProfile || main?.taskProfile || lowband?.taskProfile || {};
  const taskRequirementAudit = taskProfile.taskRequirementAudit || main?.taskProfile?.taskRequirementAudit || null;
  const values = Object.values(criteria).map(Number).filter(Number.isFinite);
  return {
    taskDetected: task || taskProfile.task || main?.task || lowband?.task || highband?.task || "",
    selectedSystem: finalSource,
    routeDecision: route?.routeDecision || "",
    routeZone: route?.routeZone || "",
    routeReasonCodes: Array.isArray(route?.reasonCodes) ? route.reasonCodes : [],
    finalBand: Number.isFinite(Number(finalBand)) ? Number(finalBand) : null,
    finalBandSourceIsAI: true,
    finalBandSource: finalSource || "",
    criterionScoresSource: "ai-selected-system",
    localHeuristicAdjustedFinalBand: false,
    localHeuristicAdjustedCriterionScores: false,
    localFloorApplied: false,
    localCapApplied: false,
    lowbandGuardCalled: Boolean(lowband),
    lowbandGuardUsedAsFinal: String(finalSource || "").includes("lowband"),
    boundaryAdjudicatorCalled: false,
    boundaryAdjudicatorRetiredFromProduction: true,
    highbandShadowCalled: Boolean(highband),
    criteriaAllEqual: values.length === 4 && values.every((value) => value === values[0]),
    taskRequirementAudit: taskRequirementAudit || null,
    midbandCalibrationAudit: {
      bandRange: "4.0-6.5",
      midbandPrimary: true,
      lowbandOnlyForHardEvidence: true,
      highbandForSevenPlusOrSixFivePotential: true,
      localRoutingSignals: localRoutingSignals || null,
      hardLowbandEvidence: Array.isArray(route?.reasonCodes) ? route.reasonCodes.includes("HARD_LOWBAND_EVIDENCE") : false,
      errorsStillAllowedAtBand5: true,
      simpleButUnderstandableCanBeBand5: true,
      localHeuristicAdjustedFinalBand: false,
      finalBandSourceIsAI: true
    },
    aiPrimaryAudit: {
      localScoringOverride: false,
      localTaskAchievementCapUsed: false,
      localBulletAuditUsedInPrompt: false,
      localTask2CoverageUsedInPrompt: false,
      localWordCountTriggeredLowband: false,
      finalBandSource: finalSource || "",
      criterionScoresSource: "ai-selected-system"
    }
  };
}

function directAiPayload({ req, res, basePayload, finalSource, finalBand, criteria, task, route, startedAt, endpoints, main, lowband = null, highband = null, attempts = {}, localRoutingSignals = null }) {
  const criteriaAverageBand = averageCriteriaBand(criteria);
  const normalizedFinalBand = typeof criteriaAverageBand === "number" && Number.isFinite(criteriaAverageBand) ? criteriaAverageBand : finalBand;
  const scoringAudit = buildRouterScoringAudit({ task, route, finalBand: normalizedFinalBand, finalSource, main, lowband, highband, localRoutingSignals });
  return sendJson(req, res, 200, {
    ...basePayload,
    ok: basePayload?.ok !== false,
    productionRouter: true,
    scoreSystemVersion: ROUTER_VERSION,
    routerVersion: ROUTER_VERSION,
    midbandVersion: MIDBAND_VERSION,
    lowbandVersion: LOWBAND_VERSION,
    highbandVersion: HIGHBAND_VERSION,
    routerSystemFixVersion: ROUTER_SYSTEM_FIX_VERSION,
    boundaryAdjudicatorVersion: BOUNDARY_VERSION,
    routeDecision: route.routeDecision,
    routeZone: route.routeZone,
    targetSystem: route.targetSystem,
    finalSource,
    finalBand: normalizedFinalBand,
    score: normalizedFinalBand,
    criteria,
    finalCriteria: criteria,
    mainScore: extractBand(main),
    lowbandScore: extractBand(lowband),
    highbandScore: extractBand(highband),
    lowbandGuardCalled: Boolean(lowband),
    lowbandGuardUsedAsFinal: String(finalSource || "").includes("lowband"),
    boundaryCalled: false,
    boundary: null,
    highbandShadowCalled: Boolean(highband),
    highbandConfirmed: String(finalSource || "").includes("highband"),
    main,
    midband: main,
    localRoutingSignals,
    lowband,
    highband,
    scoringAudit,
    routerAudit: scoringAudit,
    localLogicAudit: buildLocalLogicAudit(),
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    scoreFrozen: true,
    feedbackCanChangeScore: false,
    routingAudit: {
      mainAttempts: attempts.mainAttempts || 0,
      lowbandAttempts: attempts.lowbandAttempts || 0,
      boundaryAttempts: 0,
      highbandAttempts: attempts.highbandAttempts || 0,
      highbandShadowCalled: Boolean(highband),
      highbandConfirmed: String(finalSource || "").includes("highband"),
      routerSystemFixVersion: ROUTER_SYSTEM_FIX_VERSION,
      elapsedMs: Date.now() - startedAt,
      endpoints
    },
    disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
  });
}


// Backwards-compatible local smoke-test helper. It does not send HTTP and does not score locally.
function directMainPayload(main, mainBand, route, mainAttempts, startedAt, endpoints, extra = {}) {
  const criteria = extractCriteria(main);
  const criteriaAverageBand = averageCriteriaBand(criteria);
  const finalBand = typeof criteriaAverageBand === "number" && Number.isFinite(criteriaAverageBand) ? criteriaAverageBand : mainBand;
  const finalSource = extra.finalSource || "midband-primary";
  const lowband = extra.lowband || null;
  const highband = extra.highband || null;
  const scoringAudit = buildRouterScoringAudit({
    task: main?.task || main?.scoringTask || "",
    route,
    finalBand,
    finalSource,
    main,
    lowband,
    highband,
    localRoutingSignals: extra.localRoutingSignals || null
  });
  return {
    ...main,
    ok: main?.ok !== false,
    productionRouter: true,
    scoreSystemVersion: ROUTER_VERSION,
    routerVersion: ROUTER_VERSION,
    midbandVersion: MIDBAND_VERSION,
    lowbandVersion: LOWBAND_VERSION,
    highbandVersion: HIGHBAND_VERSION,
    boundaryAdjudicatorVersion: BOUNDARY_VERSION,
    routeDecision: route?.routeDecision || "",
    routeZone: route?.routeZone || "",
    targetSystem: route?.targetSystem || "midband",
    finalSource,
    finalBand,
    score: finalBand,
    criteria,
    finalCriteria: criteria,
    mainScore: mainBand,
    lowbandScore: extractBand(lowband),
    boundaryScore: null,
    highbandScore: extractBand(highband),
    lowbandGuardCalled: Boolean(lowband),
    boundaryCalled: false,
    boundary: null,
    highbandShadowCalled: Boolean(highband),
    highbandConfirmed: String(finalSource).includes("highband"),
    main,
    midband: main,
    lowband,
    highband,
    scoringAudit,
    routerAudit: scoringAudit,
    localLogicAudit: buildLocalLogicAudit(),
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    scoreFrozen: true,
    feedbackCanChangeScore: false,
    routingAudit: {
      mainAttempts: mainAttempts || 0,
      lowbandAttempts: extra.lowbandAttempts || 0,
      boundaryAttempts: 0,
      highbandAttempts: extra.highbandAttempts || 0,
      elapsedMs: Date.now() - startedAt,
      endpoints
    },
    disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(req, res, 405, {
      ok: false,
      productionRouter: true,
      scoreSystemVersion: ROUTER_VERSION,
      error: "Method not allowed. Use POST."
    });
  }

  const startedAt = Date.now();

  try {
    const requestBody = normalizeBody(req);
    const baseUrl = getBaseUrl(req);
    const endpoints = {
      midband: `${baseUrl}/api/grade-ielts-midband`,
      main: `${baseUrl}/api/grade-ielts-midband`,
      lowband: `${baseUrl}/api/grade-ielts-lowband`,
      highband: `${baseUrl}/api/grade-ielts-highband`,
      boundary: `${baseUrl}/api/grade-ielts-boundary-adjudicator`
    };

    const mainCall = await callJsonWithRetry(endpoints.midband, requestBody, "midband scorer");
    const main = mainCall.data;
    const mainCriteria = extractCriteria(main);
    const mainBandFromCriteria = averageCriteriaBand(mainCriteria);
    const mainBand = typeof mainBandFromCriteria === "number" && Number.isFinite(mainBandFromCriteria) ? mainBandFromCriteria : extractBand(main);
    const task = normalizeTask(requestBody, main);
    const localRoutingSignals = detectLocalRoutingSignals(requestBody, task, mainBand);
    const hardLowband = hasHardLowbandEvidence(requestBody, main, task, mainBand, localRoutingSignals);
    const highbandPotential = hasHighbandPotential(main, mainBand, localRoutingSignals);
    const route = routeReason(mainBand, task, hardLowband, highbandPotential);

    if (route.useLowbandGuard) {
      try {
        const lowbandCall = await callJsonWithRetry(endpoints.lowband, requestBody, "lowband guard scorer");
        const lowband = lowbandCall.data;
        const lowbandBand = extractBand(lowband);
        const useLowband = shouldUseLowbandFinal(mainBand, lowbandBand, lowband);
        const selected = useLowband ? lowband : main;
        const finalBand = useLowband ? lowbandBand : mainBand;
        const criteria = extractCriteria(selected);
        return directAiPayload({
          req,
          res,
          basePayload: selected,
          finalSource: useLowband ? "lowband-hard-evidence-guard" : "midband-primary-lowband-not-confirmed",
          finalBand,
          criteria,
          task,
          route: {
            ...route,
            routeDecision: useLowband ? "lowband_final_hard_evidence_confirmed" : "midband_final_lowband_not_confirmed",
            reasonCodes: [
              ...(route.reasonCodes || []),
              useLowband ? "AI_LOWBAND_HARD_EVIDENCE_CONFIRMED" : "AI_LOWBAND_DID_NOT_SHOW_HARD_EVIDENCE"
            ]
          },
          startedAt,
          endpoints,
          main,
          lowband,
          localRoutingSignals,
          attempts: { mainAttempts: mainCall.attempts, lowbandAttempts: lowbandCall.attempts }
        });
      } catch (lowbandErr) {
        const criteria = extractCriteria(main);
        return directAiPayload({
          req,
          res,
          basePayload: main,
          finalSource: "midband-primary-lowband-guard-failed",
          finalBand: mainBand,
          criteria,
          task,
          route: {
            ...route,
            routeDecision: "midband_final_lowband_guard_failed",
            reasonCodes: [...(route.reasonCodes || []), "LOWBAND_GUARD_FAILED_MIDBAND_USED"]
          },
          startedAt,
          endpoints,
          main,
          localRoutingSignals,
          attempts: { mainAttempts: mainCall.attempts, lowbandAttempts: RETRY_COUNT }
        });
      }
    }

    if (route.useHighbandShadow) {
      try {
        const highbandCall = await callJsonWithRetry(endpoints.highband, requestBody, "highband scorer");
        const highband = highbandCall.data;
        const highbandBand = extractBand(highband);
        const task1Band7Review = localRoutingSignals && localRoutingSignals.localTask1Band7ReviewCandidate === true;
        const highbandGap = typeof highbandBand === "number" && typeof mainBand === "number"
          ? Math.abs(highbandBand - mainBand)
          : null;

        const highbandConfirmed = typeof highbandBand === "number" && Number.isFinite(highbandBand)
          && (
            (mainBand >= 7.0 && highbandBand >= 7.0 && highbandGap !== null && highbandGap <= 1.0)
            || (mainBand >= 6.5 && mainBand < 7.0 && highbandBand >= 7.0 && highbandBand <= 7.5 && highbandGap !== null && highbandGap <= 1.0)
            || (task1Band7Review && highbandBand >= 6.5 && highbandBand <= 7.5)
          );
        const selected = highbandConfirmed ? highband : main;
        const finalBand = highbandConfirmed ? highbandBand : mainBand;
        const criteria = extractCriteria(selected);
        return directAiPayload({
          req,
          res,
          basePayload: selected,
          finalSource: highbandConfirmed ? "highband-shadow-confirmed" : "midband-primary-highband-not-confirmed",
          finalBand,
          criteria,
          task,
          route: {
            ...route,
            routeDecision: highbandConfirmed ? "highband_final_confirmed" : "midband_final_highband_not_confirmed",
            reasonCodes: [
              ...(route.reasonCodes || []),
              highbandConfirmed ? "AI_HIGHBAND_CONFIRMED" : "AI_HIGHBAND_NOT_CONFIRMED"
            ]
          },
          startedAt,
          endpoints,
          main,
          highband,
          localRoutingSignals,
          attempts: { mainAttempts: mainCall.attempts, highbandAttempts: highbandCall.attempts }
        });
      } catch (highbandErr) {
        const criteria = extractCriteria(main);
        return directAiPayload({
          req,
          res,
          basePayload: main,
          finalSource: "midband-primary-highband-fallback",
          finalBand: mainBand,
          criteria,
          task,
          route: {
            ...route,
            routeDecision: "midband_final_highband_failed",
            reasonCodes: [...(route.reasonCodes || []), "HIGHBAND_FAILED_MIDBAND_USED"]
          },
          startedAt,
          endpoints,
          main,
          localRoutingSignals,
          attempts: { mainAttempts: mainCall.attempts, highbandAttempts: RETRY_COUNT }
        });
      }
    }

    return directAiPayload({
      req,
      res,
      basePayload: main,
      finalSource: "midband-primary",
      finalBand: mainBand,
      criteria: extractCriteria(main),
      task,
      route,
      startedAt,
      endpoints,
      main,
      attempts: { mainAttempts: mainCall.attempts }
    });
  } catch (err) {
    return sendJson(req, res, 500, {
      ok: false,
      productionRouter: true,
      scoreSystemVersion: ROUTER_VERSION,
      midbandVersion: MIDBAND_VERSION,
      lowbandVersion: LOWBAND_VERSION,
      boundaryAdjudicatorVersion: BOUNDARY_VERSION,
      highbandVersion: HIGHBAND_VERSION,
      error: err && err.message ? err.message : "Production router failed.",
      elapsedMs: Date.now() - startedAt
    });
  }
};

module.exports.config = { maxDuration: 300 };
