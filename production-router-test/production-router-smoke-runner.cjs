const fs = require("fs");
const path = require("path");

const endpointFile = path.join(__dirname, "endpoint-production-router.txt");
const endpoint = fs.readFileSync(endpointFile, "utf8").trim();
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, "production-router-smoke-samples.json"), "utf8"));

const resultsDir = path.join(__dirname, "production-router-results");
fs.mkdirSync(resultsDir, { recursive: true });

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function postJson(url, body, retries = 2) {
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
        await new Promise(r => setTimeout(r, 800 * attempt));
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

  log.push(`Production Router v1 smoke test`);
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
      source: "production-router-smoke-test"
    };

    process.stdout.write(`[${i + 1}/${samples.length}] ${s.id} ... `);

    try {
      const { data, attempts } = await postJson(endpoint, payload, 3);
      const row = {
        id: s.id,
        task: s.task,
        expectedRoute: s.expectedRoute,
        ok: data.ok !== false,
        productionRouter: data.productionRouter,
        routerVersion: data.routerVersion || data.scoreSystemVersion,
        boundaryAdjudicatorVersion: data.boundaryAdjudicatorVersion,
        routeDecision: data.routeDecision,
        routeZone: data.routeZone,
        finalSource: data.finalSource,
        finalBand: scoreOf(data),
        mainScore: data.mainScore ?? "",
        boundaryScore: data.boundaryScore ?? "",
        attemptsMain: data.routingAudit && data.routingAudit.mainAttempts,
        attemptsBoundary: data.routingAudit && data.routingAudit.boundaryAttempts,
        elapsedMs: data.routingAudit && data.routingAudit.elapsedMs,
        error: ""
      };
      rows.push(row);
      console.log(`OK route=${row.routeDecision} final=${row.finalBand} source=${row.finalSource}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} OK route=${row.routeDecision} zone=${row.routeZone} final=${row.finalBand} main=${row.mainScore} boundary=${row.boundaryScore} source=${row.finalSource}`);
    } catch (err) {
      rows.push({
        id: s.id,
        task: s.task,
        expectedRoute: s.expectedRoute,
        ok: false,
        error: err.message
      });
      console.log(`FAIL ${err.message}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} FAIL ${err.message}`);
    }
  }

  const csvHeaders = Object.keys(rows.reduce((acc, r) => Object.assign(acc, r), {}));
  const csv = [
    csvHeaders.join(","),
    ...rows.map(r => csvHeaders.map(h => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");

  const jsonPath = path.join(resultsDir, `production-router-smoke-report-${stamp}.json`);
  const csvPath = path.join(resultsDir, `production-router-smoke-report-${stamp}.csv`);
  const logPath = path.join(resultsDir, `production-router-smoke-log-${stamp}.txt`);

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
