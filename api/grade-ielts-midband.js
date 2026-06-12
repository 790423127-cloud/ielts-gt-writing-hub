const baseHandler = require("./grade-ielts");

async function readBody(req) {
  if (req.body && typeof req.body === "object") return { ...req.body };
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; }
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; }
}

module.exports = async function midbandHandler(req, res) {
  const body = await readBody(req);
  req.body = {
    ...body,
    scoringSystem: "midband",
    requestedScoringSystem: "midband",
    targetSystem: "midband",
    midbandPrimary: true,
    midbandOnly: true,
    skipMandatoryBoundaryReview: true,
    disableMandatoryBoundaryReview: true
  };
  return baseHandler(req, res);
};

module.exports.config = { maxDuration: 300 };
