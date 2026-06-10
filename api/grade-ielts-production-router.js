const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const ROUTER_VERSION = "production-router-v1-boundary-v4-3-freeze";
const BOUNDARY_VERSION = "boundary-adjudicator-v4-3-task1-anchor-calibration";
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

function shouldUseBoundary(mainBand) {
  if (typeof mainBand !== "number" || !Number.isFinite(mainBand)) return true;
  return mainBand >= 4.0 && mainBand <= 5.5;
}

function routeReason(mainBand) {
  if (typeof mainBand !== "number" || !Number.isFinite(mainBand)) {
    return {
      useBoundary: true,
      routeDecision: "boundary_required_main_score_unreadable",
      routeZone: "unknown_score"
    };
  }
  if (mainBand >= 4.0 && mainBand <= 5.5) {
    return {
      useBoundary: true,
      routeDecision: "boundary_v4_3_for_4_0_to_5_5",
      routeZone: "boundary_4_0_5_5"
    };
  }
  if (mainBand < 4.0) {
    return {
      useBoundary: false,
      routeDecision: "main_direct_below_boundary_known_lowband_limitation",
      routeZone: "below_boundary"
    };
  }
  return {
    useBoundary: false,
    routeDecision: "main_direct_above_boundary",
    routeZone: "above_boundary"
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

      return {
        ok: true,
        data,
        attempts: attempt
      };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_COUNT) await sleep(700 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr || new Error(`${label} failed.`);
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
    const mainUrl = `${baseUrl}/api/grade-ielts`;
    const boundaryUrl = `${baseUrl}/api/grade-ielts-boundary-adjudicator`;

    const mainCall = await callJsonWithRetry(mainUrl, requestBody, "main scorer");
    const main = mainCall.data;
    const mainBand = extractBand(main);
    const route = routeReason(mainBand);

    if (!route.useBoundary) {
      const finalBand = mainBand;
      return sendJson(req, res, 200, {
        ...main,
        ok: main.ok !== false,
        productionRouter: true,
        scoreSystemVersion: ROUTER_VERSION,
        routerVersion: ROUTER_VERSION,
        boundaryAdjudicatorVersion: BOUNDARY_VERSION,
        routeDecision: route.routeDecision,
        routeZone: route.routeZone,
        finalSource: "main-score",
        finalBand,
        score: finalBand,
        criteria: extractCriteria(main),
        mainScore: mainBand,
        main,
        boundary: null,
        routingAudit: {
          mainAttempts: mainCall.attempts,
          boundaryAttempts: 0,
          elapsedMs: Date.now() - startedAt,
          endpoints: { main: mainUrl, boundary: boundaryUrl }
        },
        disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
      });
    }

    const boundaryCall = await callJsonWithRetry(boundaryUrl, requestBody, "boundary adjudicator");
    const boundary = boundaryCall.data;
    const boundaryBand = extractBand(boundary);
    const finalBand = boundaryBand == null ? mainBand : boundaryBand;

    return sendJson(req, res, 200, {
      ...boundary,
      ok: boundary.ok !== false,
      productionRouter: true,
      scoreSystemVersion: ROUTER_VERSION,
      routerVersion: ROUTER_VERSION,
      boundaryAdjudicatorVersion: BOUNDARY_VERSION,
      routeDecision: route.routeDecision,
      routeZone: route.routeZone,
      finalSource: "boundary-adjudicator-v4-3",
      finalBand,
      score: finalBand,
      criteria: extractCriteria(boundary),
      mainScore: mainBand,
      boundaryScore: boundaryBand,
      main,
      boundary,
      routingAudit: {
        mainAttempts: mainCall.attempts,
        boundaryAttempts: boundaryCall.attempts,
        elapsedMs: Date.now() - startedAt,
        endpoints: { main: mainUrl, boundary: boundaryUrl }
      },
      disclaimer: "This is an AI IELTS GT Writing score estimate, not an official IELTS score."
    });
  } catch (err) {
    return sendJson(req, res, 500, {
      ok: false,
      productionRouter: true,
      scoreSystemVersion: ROUTER_VERSION,
      boundaryAdjudicatorVersion: BOUNDARY_VERSION,
      error: err && err.message ? err.message : "Production router failed.",
      elapsedMs: Date.now() - startedAt
    });
  }
};
