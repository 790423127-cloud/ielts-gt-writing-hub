const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const ROUTER_VERSION = "production-router-v2-1-highband-shadow-confirmation";
const BOUNDARY_VERSION = "boundary-adjudicator-v4-3-task1-anchor-calibration";
const HIGHBAND_VERSION = "score-core-v8-5-14-highband-near9-router-anti-inflation";

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

function extractBand(payload) {
  if (!payload || typeof payload !== "object") return null;
  return firstNumber(
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
    payload.data && payload.data.score
  );
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

function buildLocalLogicAudit() {
  return {
    usedForScoring: false,
    usedForRoutingOnly: true,
    adjustedOverallBand: false,
    adjustedCriterionScores: false,
    appliedLocalFloor: false,
    appliedLocalCap: false,
    copiedOverallToCriteria: false,
    notes: "Local logic only handled routing, hard invalid detection, hard lowband gate, JSON validation and audit."
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
      ? "Criterion scores are identical only because the AI scorer returned identical criterion bands; local code did not copy overallBand to criteria."
      : "Criterion scores and comments were generated independently by AI."
  };
}

function routeReason(mainBand) {
  if (typeof mainBand !== "number" || !Number.isFinite(mainBand)) {
    return {
      targetSystem: "boundary",
      useBoundary: true,
      useHighbandShadow: false,
      routeDecision: "boundary_required_main_score_unreadable",
      routeZone: "unknown_score"
    };
  }

  if (mainBand >= 4.0 && mainBand <= 5.5) {
    return {
      targetSystem: "boundary",
      useBoundary: true,
      useHighbandShadow: false,
      routeDecision: "boundary_v4_3_for_4_0_to_5_5",
      routeZone: "boundary_4_0_5_5"
    };
  }

  if (mainBand >= 7.0) {
    return {
      targetSystem: "highband-shadow-confirmation",
      useBoundary: false,
      useHighbandShadow: true,
      routeDecision: "highband_shadow_confirmation_for_7_0_plus",
      routeZone: "highband_candidate_7_0_plus"
    };
  }

  if (mainBand < 4.0) {
    return {
      targetSystem: "main",
      useBoundary: false,
      useHighbandShadow: false,
      routeDecision: "main_direct_below_boundary_known_lowband_limitation",
      routeZone: "below_boundary"
    };
  }

  return {
    targetSystem: "main",
    useBoundary: false,
    useHighbandShadow: false,
    routeDecision: "main_direct_middle_band_6_0_to_6_5",
    routeZone: "middle_band_6_0_6_5"
  };
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

function directMainPayload(main, mainBand, route, mainAttempts, startedAt, endpoints, extra = {}) {
  const finalBand = mainBand;
  const criteria = extractCriteria(main);
  const scoringAudit = buildRouterScoringAudit({
    task: main?.task || main?.scoringTask || "",
    route,
    finalBand,
    finalSource: extra.finalSource || "main-score",
    main,
    boundary: null,
    highband: extra.highband || null,
    boundaryMainReuseAudit: null
  });
  return {
    ...main,
    ok: main.ok !== false,
    productionRouter: true,
    scoreSystemVersion: ROUTER_VERSION,
    routerVersion: ROUTER_VERSION,
    boundaryAdjudicatorVersion: BOUNDARY_VERSION,
    highbandVersion: HIGHBAND_VERSION,
    routeDecision: route.routeDecision,
    routeZone: route.routeZone,
    targetSystem: route.targetSystem,
    finalSource: extra.finalSource || "main-score",
    finalBand,
    score: finalBand,
    criteria,
    mainScore: mainBand,
    boundaryScore: null,
    highbandScore: extra.highbandScore ?? null,
    highbandShadowCalled: !!extra.highbandShadowCalled,
    highbandConfirmed: !!extra.highbandConfirmed,
    main,
    boundary: null,
    highband: extra.highband || null,
    scoringAudit,
    localLogicAudit: buildLocalLogicAudit(),
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    scoreFrozen: true,
    feedbackCanChangeScore: false,
    routingAudit: {
      mainAttempts,
      boundaryAttempts: 0,
      highbandAttempts: extra.highbandAttempts || 0,
      highbandShadowCalled: !!extra.highbandShadowCalled,
      highbandConfirmed: !!extra.highbandConfirmed,
      elapsedMs: Date.now() - startedAt,
      endpoints,
      ...extra.audit
    },
    disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
  };
}

function buildRouterScoringAudit({ task, route, finalBand, finalSource, main, boundary, highband, boundaryMainReuseAudit }) {
  const source = boundary || main || highband || {};
  const taskProfile = source.taskProfile || main?.taskProfile || boundary?.taskProfile || {};
  const taskRequirementAudit = taskProfile.taskRequirementAudit || main?.taskProfile?.taskRequirementAudit || boundary?.taskProfile?.taskRequirementAudit || null;
  const task2Profile = taskProfile || main?.taskProfile || boundary?.taskProfile || {};
  const task1Profile = taskProfile || main?.taskProfile || boundary?.taskProfile || {};
  const items = Array.isArray(taskRequirementAudit?.items) ? taskRequirementAudit.items : [];
  const coveredOrPartial = items.filter((item) => item.status === "covered" || item.status === "partly_covered");
  const questionPartsAnswered = coveredOrPartial.map((item) => item.requirement).filter(Boolean);
  const bulletPointsDetected = Number((Array.isArray(task1Profile.bulletPoints) ? task1Profile.bulletPoints.length : 0) || (taskRequirementAudit?.extractedRequirements || []).length || 0) || 0;
  const bulletPointsCovered = task === "Task 1"
    ? items.filter((item) => item.status === "covered" || item.status === "partly_covered").length
    : null;
  const directQuestions = Array.isArray(task2Profile.directQuestions) ? task2Profile.directQuestions : [];
  const questionPartsRequired = task === "Task 2" ? (directQuestions.length ? directQuestions : (Array.isArray(taskRequirementAudit?.requiredParts) ? taskRequirementAudit.requiredParts : [])) : null;
  const hardLowbandEvidence = [];
  if (taskRequirementAudit?.triggered && taskRequirementAudit?.summary) hardLowbandEvidence.push(taskRequirementAudit.summary);
  if (boundaryMainReuseAudit?.mainReusedFromRouter) hardLowbandEvidence.push("boundary reused frozen main result");

  return {
    taskDetected: task || taskProfile.task || main?.task || boundary?.task || highband?.task || "",
    taskTypeDetected: task === "Task 2"
      ? (task2Profile.questionType || taskProfile.questionType || "")
      : (task1Profile.letterStyle || task1Profile.scoringProfile || task1Profile.task || taskProfile.task || ""),
    wordCount: Number(taskProfile.wordCount || source.wordCount || source.localSignals?.wordCount || main?.localSignals?.wordCount || boundary?.localSignals?.wordCount || main?.wordCount || boundary?.wordCount || 0) || null,
    paragraphCount: Number(taskProfile.paragraphCount || source.paragraphCount || source.localSignals?.paragraphCount || main?.localSignals?.paragraphCount || boundary?.localSignals?.paragraphCount || main?.paragraphCount || boundary?.paragraphCount || 0) || null,
    hardLowbandEvidence,
    lowbandEligible: Boolean(route?.routeZone === "below_boundary" || route?.routeZone === "boundary_4_0_5_5" || String(finalSource).includes("lowband")),
    boundaryEligible: Boolean(route?.useBoundary || route?.routeZone === "boundary_4_0_5_5" || finalSource === "boundary-adjudicator-v4-3"),
    highbandEligible: Boolean(route?.useHighbandShadow || route?.routeZone === "highband_candidate_7_0_plus" || String(finalSource).includes("highband")),
    taskResponsePresent: task === "Task 2" ? questionPartsAnswered.length > 0 : Boolean(items.length || bulletPointsDetected),
    positionPresent: task === "Task 2" ? Boolean(task2Profile.positionRequired || taskRequirementAudit?.markers?.clearOpinion || taskRequirementAudit?.markers?.implicitJudgement || taskRequirementAudit?.markers?.positiveNegativeJudgement || taskRequirementAudit?.markers?.outweighJudgement) : null,
    bulletPointsDetected: task === "Task 1" ? bulletPointsDetected : null,
    bulletPointsCovered: task === "Task 1" ? bulletPointsCovered : null,
    questionPartsRequired: task === "Task 2" ? questionPartsRequired : null,
    questionPartsAnswered: task === "Task 2" ? questionPartsAnswered : null,
    routeDecision: route?.routeDecision || "",
    routeZone: route?.routeZone || "",
    routeReason: Array.isArray(route?.reasonCodes) ? route.reasonCodes.join(", ") : "",
    finalBand: Number.isFinite(Number(finalBand)) ? Number(finalBand) : null,
    finalSource: finalSource || "",
    boundaryMainReuseAudit: boundaryMainReuseAudit || null
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
      main: `${baseUrl}/api/grade-ielts`,
      boundary: `${baseUrl}/api/grade-ielts-boundary-adjudicator`,
      highband: `${baseUrl}/api/grade-ielts-highband`
    };

    const mainCall = await callJsonWithRetry(endpoints.main, requestBody, "main scorer");
    const main = mainCall.data;
    const mainBand = extractBand(main);
    const route = routeReason(mainBand);

    if (route.useBoundary) {
      const boundaryRequestBody = {
        ...requestBody,
        frozenMainResult: main,
        frozenMainScore: mainBand,
        frozenMainCriteria: extractCriteria(main),
        productionRouterMainFrozen: true
      };
      const boundaryCall = await callJsonWithRetry(endpoints.boundary, boundaryRequestBody, "boundary adjudicator");
      const boundary = boundaryCall.data;
      const boundaryBand = extractBand(boundary);
      const finalBand = boundaryBand == null ? mainBand : boundaryBand;
      const finalCriteria = extractCriteria(boundary);

      return sendJson(req, res, 200, {
        ...boundary,
        ok: boundary.ok !== false,
        productionRouter: true,
        scoreSystemVersion: ROUTER_VERSION,
        routerVersion: ROUTER_VERSION,
        boundaryAdjudicatorVersion: BOUNDARY_VERSION,
        highbandVersion: HIGHBAND_VERSION,
        routeDecision: route.routeDecision,
        routeZone: route.routeZone,
        targetSystem: route.targetSystem,
        finalSource: "boundary-adjudicator-v4-3",
        finalBand,
        score: finalBand,
        criteria: finalCriteria,
        mainScore: mainBand,
        boundaryScore: boundaryBand,
        highbandScore: null,
        highbandShadowCalled: false,
        highbandConfirmed: false,
        scoringAudit: buildRouterScoringAudit({
          task: requestBody.task || requestBody.scoringTask || requestBody.taskType || boundary?.task || "",
          route,
          finalBand,
          finalSource: "boundary-adjudicator-v4-3",
          main,
          boundary,
          highband: null,
          boundaryMainReuseAudit: boundary.boundaryMainReuseAudit || null
        }),
        localLogicAudit: buildLocalLogicAudit(),
        criterionDifferentiationAudit: buildCriterionDifferentiationAudit(finalCriteria),
        scoreFrozen: true,
        feedbackCanChangeScore: false,
        boundaryMainReuseAudit: boundary.boundaryMainReuseAudit || null,
        main,
        boundary,
        highband: null,
        routingAudit: {
          mainAttempts: mainCall.attempts,
          boundaryAttempts: boundaryCall.attempts,
          highbandAttempts: 0,
          highbandShadowCalled: false,
          highbandConfirmed: false,
          elapsedMs: Date.now() - startedAt,
          endpoints
        },
        disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
      });
    }

    if (route.useHighbandShadow) {
      try {
        const highbandCall = await callJsonWithRetry(endpoints.highband, requestBody, "highband scorer");
        const highband = highbandCall.data;
        const highbandBand = extractBand(highband);
        const highbandConfirmed = typeof highbandBand === "number" && Number.isFinite(highbandBand) && highbandBand >= 7.5;

        if (highbandConfirmed) {
          const finalCriteria = extractCriteria(highband);
          return sendJson(req, res, 200, {
            ...highband,
            ok: highband.ok !== false,
            productionRouter: true,
            scoreSystemVersion: ROUTER_VERSION,
            routerVersion: ROUTER_VERSION,
            boundaryAdjudicatorVersion: BOUNDARY_VERSION,
            highbandVersion: HIGHBAND_VERSION,
            routeDecision: route.routeDecision,
            routeZone: route.routeZone,
            targetSystem: route.targetSystem,
            finalSource: "highband-shadow-v8-5-14",
            finalBand: highbandBand,
            score: highbandBand,
            criteria: finalCriteria,
            mainScore: mainBand,
            boundaryScore: null,
          highbandScore: highbandBand,
          highbandShadowCalled: true,
          highbandConfirmed: true,
          scoringAudit: buildRouterScoringAudit({
            task: requestBody.task || requestBody.scoringTask || requestBody.taskType || main?.task || "",
            route,
            finalBand: highbandBand,
            finalSource: "highband-shadow-v8-5-14",
            main,
            boundary: null,
            highband,
            boundaryMainReuseAudit: null
          }),
          main,
          boundary: null,
            highband,
            localLogicAudit: buildLocalLogicAudit(),
            criterionDifferentiationAudit: buildCriterionDifferentiationAudit(finalCriteria),
            scoreFrozen: true,
            feedbackCanChangeScore: false,
            routingAudit: {
              mainAttempts: mainCall.attempts,
              boundaryAttempts: 0,
              highbandAttempts: highbandCall.attempts,
              highbandShadowCalled: true,
              highbandConfirmed: true,
              elapsedMs: Date.now() - startedAt,
              endpoints
            },
            disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
          });
        }

        return sendJson(req, res, 200, directMainPayload(main, mainBand, route, mainCall.attempts, startedAt, endpoints, {
          finalSource: "main-score-highband-not-confirmed",
          highband,
          highbandScore: highbandBand,
          highbandAttempts: highbandCall.attempts,
          highbandShadowCalled: true,
          highbandConfirmed: false,
          audit: {
            highbandReason: "highband_score_below_7_5"
          }
        }));
      } catch (highbandErr) {
        return sendJson(req, res, 200, directMainPayload(main, mainBand, route, mainCall.attempts, startedAt, endpoints, {
          finalSource: "main-score-highband-fallback",
          highbandAttempts: RETRY_COUNT,
          highbandShadowCalled: true,
          highbandConfirmed: false,
          audit: {
            highbandFallback: true,
            highbandError: highbandErr && highbandErr.message ? highbandErr.message : "Highband scorer failed."
          }
        }));
      }
    }

    return sendJson(req, res, 200, directMainPayload(main, mainBand, route, mainCall.attempts, startedAt, endpoints));
  } catch (err) {
    return sendJson(req, res, 500, {
      ok: false,
      productionRouter: true,
      scoreSystemVersion: ROUTER_VERSION,
      boundaryAdjudicatorVersion: BOUNDARY_VERSION,
      highbandVersion: HIGHBAND_VERSION,
      error: err && err.message ? err.message : "Production router failed.",
      elapsedMs: Date.now() - startedAt
    });
  }
};
