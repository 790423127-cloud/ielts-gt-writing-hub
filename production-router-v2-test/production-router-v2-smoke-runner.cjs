const fs = require("fs");
const path = require("path");

const endpoint = fs.readFileSync(path.join(__dirname, "endpoint-production-router.txt"), "utf8").trim();
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "production-router-v2-smoke-samples.json"), "utf8"));
const resultsDir = path.join(__dirname, "production-router-v2-results");
fs.mkdirSync(resultsDir, { recursive: true });

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
        await new Promise(r => setTimeout(r, 900 * attempt));
      }
    }
  }
  throw lastErr;
}

function scoreOf(payload) {
  return payload.finalBand ?? payload.score ?? payload.overallBand ?? payload.overallScore ?? "";
}

(async () => {
  const stamp = nowStamp();
  const log = [];
  const rows = [];

  log.push("Production Router v2 three-system smoke test");
  log.push(`Endpoint: ${endpoint}`);
  log.push(`Samples: ${samples.length}`);
  log.push("");

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const payload = {
      task: s.task,
      taskType: s.task,
      scoringTask: s.task,
      selectedTask: s.task,
      questionPrompt: s.prompt,
      promptText: s.prompt,
      essay: s.essay,
      answer: s.essay,
      source: "production-router-v2-smoke-test"
    };

    process.stdout.write(`[${i + 1}/${samples.length}] ${s.id} expected=${s.expectedSystem} ... `);

    try {
      const { data, attempts } = await postJson(endpoint, payload, 3);
      const row = {
        id: s.id,
        task: s.task,
        expectedSystem: s.expectedSystem,
        ok: data.ok !== false,
        productionRouter: data.productionRouter,
        routerVersion: data.routerVersion || data.scoreSystemVersion,
        boundaryAdjudicatorVersion: data.boundaryAdjudicatorVersion,
        highbandVersion: data.highbandVersion,
        routeDecision: data.routeDecision,
        routeZone: data.routeZone,
        targetSystem: data.targetSystem,
        finalSource: data.finalSource,
        finalBand: scoreOf(data),
        mainScore: data.mainScore ?? "",
        boundaryScore: data.boundaryScore ?? "",
        highbandScore: data.highbandScore ?? "",
        attemptsMain: data.routingAudit && data.routingAudit.mainAttempts,
        attemptsBoundary: data.routingAudit && data.routingAudit.boundaryAttempts,
        attemptsHighband: data.routingAudit && data.routingAudit.highbandAttempts,
        highbandFallback: data.routingAudit && data.routingAudit.highbandFallback,
        elapsedMs: data.routingAudit && data.routingAudit.elapsedMs,
        error: ""
      };
      rows.push(row);
      console.log(`OK target=${row.targetSystem} route=${row.routeDecision} final=${row.finalBand} source=${row.finalSource}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} OK expected=${s.expectedSystem} target=${row.targetSystem} route=${row.routeDecision} zone=${row.routeZone} final=${row.finalBand} main=${row.mainScore} boundary=${row.boundaryScore} highband=${row.highbandScore} source=${row.finalSource}`);
    } catch (err) {
      rows.push({
        id: s.id,
        task: s.task,
        expectedSystem: s.expectedSystem,
        ok: false,
        error: err.message
      });
      console.log(`FAIL ${err.message}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} FAIL ${err.message}`);
    }
  }

  const allKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const csv = [
    allKeys.join(","),
    ...rows.map(r => allKeys.map(h => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");

  const jsonPath = path.join(resultsDir, `production-router-v2-smoke-report-${stamp}.json`);
  const csvPath = path.join(resultsDir, `production-router-v2-smoke-report-${stamp}.csv`);
  const logPath = path.join(resultsDir, `production-router-v2-smoke-log-${stamp}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify({ endpoint, generatedAt: new Date().toISOString(), rows }, null, 2));
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(logPath, log.join("\n"));

  console.log("");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Log: ${logPath}`);

  const failed = rows.filter(r => !r.ok);
  if (failed.length) process.exit(1);
})();
