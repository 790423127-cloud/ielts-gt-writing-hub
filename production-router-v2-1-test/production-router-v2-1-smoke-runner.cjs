const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const endpoint = fs.readFileSync(path.join(ROOT, "endpoint-production-router.txt"), "utf8").trim();
const samples = JSON.parse(fs.readFileSync(path.join(ROOT, "production-router-v2-1-smoke-samples.json"), "utf8"));
const resultsDir = path.join(ROOT, "production-router-v2-1-results");
fs.mkdirSync(resultsDir, { recursive: true });

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postJson(url, body, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { rawText: text }; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || text}`);
      return { data, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.log(`    attempt ${attempt} failed, retrying: ${err.message}`);
        await sleep(900 * attempt);
      }
    }
  }
  throw lastErr;
}

function bandNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function scoreOf(payload) {
  return bandNum(
    payload.finalBand ??
    payload.score ??
    payload.overallBand ??
    payload.overallScore ??
    payload.estimatedBand ??
    payload.finalScore ??
    (payload.result && (payload.result.finalBand ?? payload.result.score))
  );
}

function wordCount(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function payloadFor(s) {
  return {
    task: s.task,
    taskType: s.task,
    scoringTask: s.task,
    selectedTask: s.task,
    questionPrompt: s.prompt,
    promptText: s.prompt,
    essay: s.essay,
    answer: s.essay,
    source: "production-router-v2-1-smoke-test"
  };
}

(async () => {
  const stamp = nowStamp();
  const rows = [];
  const log = [];

  log.push("Production Router v2.1 highband shadow confirmation smoke test");
  log.push(`Endpoint: ${endpoint}`);
  log.push(`Samples: ${samples.length}`);
  log.push("");

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const payload = payloadFor(s);
    const wc = wordCount(s.essay);
    process.stdout.write(`[${i + 1}/${samples.length}] ${s.id} expected=${s.expectedSystem || ""} wc=${wc} ... `);

    const row = {
      id: s.id,
      task: s.task,
      targetBand: s.targetBand ?? "",
      expectedSystem: s.expectedSystem ?? "",
      wordCount: wc,
      ok: false,
      finalBand: "",
      mainScore: "",
      boundaryScore: "",
      highbandScore: "",
      highbandShadowCalled: false,
      highbandConfirmed: false,
      targetSystem: "",
      routeDecision: "",
      routeZone: "",
      finalSource: "",
      routerVersion: "",
      error: ""
    };

    try {
      const { data } = await postJson(endpoint, payload, 3);
      row.ok = data.ok !== false;
      row.finalBand = scoreOf(data);
      row.mainScore = data.mainScore ?? "";
      row.boundaryScore = data.boundaryScore ?? "";
      row.highbandScore = data.highbandScore ?? "";
      row.highbandShadowCalled = !!data.highbandShadowCalled || !!(data.routingAudit && data.routingAudit.highbandShadowCalled);
      row.highbandConfirmed = !!data.highbandConfirmed || !!(data.routingAudit && data.routingAudit.highbandConfirmed);
      row.targetSystem = data.targetSystem ?? "";
      row.routeDecision = data.routeDecision ?? "";
      row.routeZone = data.routeZone ?? "";
      row.finalSource = data.finalSource ?? "";
      row.routerVersion = data.routerVersion || data.scoreSystemVersion || "";

      rows.push(row);
      console.log(`OK route=${row.routeDecision} final=${row.finalBand} main=${row.mainScore} highband=${row.highbandScore} source=${row.finalSource} shadow=${row.highbandShadowCalled} confirmed=${row.highbandConfirmed}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} OK route=${row.routeDecision} final=${row.finalBand} main=${row.mainScore} boundary=${row.boundaryScore} highband=${row.highbandScore} source=${row.finalSource} shadow=${row.highbandShadowCalled} confirmed=${row.highbandConfirmed}`);
    } catch (err) {
      row.error = err.message;
      rows.push(row);
      console.log(`FAIL ${err.message}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} FAIL ${err.message}`);
    }
  }

  const summary = {
    total: rows.length,
    ok: rows.filter(r => r.ok).length,
    boundaryFinalSource: rows.filter(r => r.finalSource === "boundary-adjudicator-v4-3").length,
    mainFinalSource: rows.filter(r => r.finalSource === "main-score").length,
    highbandShadowCalled: rows.filter(r => r.highbandShadowCalled).length,
    highbandConfirmed: rows.filter(r => r.highbandConfirmed).length,
    highbandFinalSource: rows.filter(r => r.finalSource === "highband-shadow-v8-5-14").length,
    highbandNotConfirmed: rows.filter(r => r.finalSource === "main-score-highband-not-confirmed").length,
    highbandFallback: rows.filter(r => r.finalSource === "main-score-highband-fallback").length
  };

  log.push("");
  log.push("=== Summary ===");
  Object.entries(summary).forEach(([k, v]) => log.push(`${k}: ${v}`));

  const allKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const csv = [
    allKeys.join(","),
    ...rows.map(r => allKeys.map(h => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");

  const jsonPath = path.join(resultsDir, `production-router-v2-1-smoke-report-${stamp}.json`);
  const csvPath = path.join(resultsDir, `production-router-v2-1-smoke-report-${stamp}.csv`);
  const logPath = path.join(resultsDir, `production-router-v2-1-smoke-log-${stamp}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify({ endpoint, generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(logPath, log.join("\n"));

  console.log("");
  console.log("=== Summary ===");
  Object.entries(summary).forEach(([k, v]) => console.log(`${k}: ${v}`));
  console.log("");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Log: ${logPath}`);

  const failed = rows.filter(r => !r.ok);
  if (failed.length) process.exit(1);
})();
