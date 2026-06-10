const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const routerEndpoint = fs.readFileSync(path.join(ROOT, "endpoint-production-router.txt"), "utf8").trim();
const highbandEndpoint = fs.readFileSync(path.join(ROOT, "endpoint-highband.txt"), "utf8").trim();
const samples = JSON.parse(fs.readFileSync(path.join(ROOT, "production-router-v2-highband-trigger-samples.json"), "utf8"));

const resultsDir = path.join(ROOT, "router-v2-highband-trigger-results");
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
    source: "router-v2-highband-trigger-test"
  };
}

(async () => {
  const stamp = nowStamp();
  const rows = [];
  const log = [];

  log.push("Production Router v2 Highband Trigger Test");
  log.push(`Router endpoint: ${routerEndpoint}`);
  log.push(`Direct highband endpoint: ${highbandEndpoint}`);
  log.push(`Samples: ${samples.length}`);
  log.push("");

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const payload = payloadFor(s);
    const wc = wordCount(s.essay);
    process.stdout.write(`[${i + 1}/${samples.length}] ${s.id} target=${s.targetBand} wc=${wc} ... `);

    const row = {
      id: s.id,
      originalId: s.originalId,
      task: s.task,
      targetBand: s.targetBand,
      expectedMin: s.expectedMin,
      expectedMax: s.expectedMax,
      strictExact9Expected: s.strictExact9Expected,
      wordCount: wc,
      routerOk: false,
      routerBand: "",
      routerMainScore: "",
      routerHighbandScore: "",
      routerTargetSystem: "",
      routerRouteDecision: "",
      routerRouteZone: "",
      routerFinalSource: "",
      routerVersion: "",
      highbandVersion: "",
      routerTriggeredHighband: false,
      directHighbandOk: false,
      directHighbandBand: "",
      directHighbandVersion: "",
      directHighband85Plus: false,
      directHighbandExact9: false,
      error: ""
    };

    try {
      const router = await postJson(routerEndpoint, payload, 3);
      const r = router.data;
      row.routerOk = r.ok !== false;
      row.routerBand = scoreOf(r);
      row.routerMainScore = r.mainScore ?? "";
      row.routerHighbandScore = r.highbandScore ?? "";
      row.routerTargetSystem = r.targetSystem ?? "";
      row.routerRouteDecision = r.routeDecision ?? "";
      row.routerRouteZone = r.routeZone ?? "";
      row.routerFinalSource = r.finalSource ?? "";
      row.routerVersion = r.routerVersion || r.scoreSystemVersion || "";
      row.highbandVersion = r.highbandVersion || "";
      row.routerTriggeredHighband =
        row.routerTargetSystem === "highband" ||
        row.routerRouteDecision === "highband_v8_5_14_for_7_5_to_9" ||
        row.routerFinalSource === "highband-shadow-v8-5-14";

      // Always call direct highband as diagnostic evidence.
      const hb = await postJson(highbandEndpoint, payload, 3);
      row.directHighbandOk = hb.data.ok !== false;
      row.directHighbandBand = scoreOf(hb.data);
      row.directHighbandVersion = hb.data.scoreSystemVersion || hb.data.version || "";
      row.directHighband85Plus = Number(row.directHighbandBand) >= 8.5;
      row.directHighbandExact9 = Number(row.directHighbandBand) === 9;

      rows.push(row);
      console.log(`OK routerRoute=${row.routerRouteDecision} routerFinal=${row.routerBand} main=${row.routerMainScore} source=${row.routerFinalSource} directHighband=${row.directHighbandBand}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} OK routerRoute=${row.routerRouteDecision} routerFinal=${row.routerBand} main=${row.routerMainScore} highbandScore=${row.routerHighbandScore} source=${row.routerFinalSource} directHighband=${row.directHighbandBand}`);
    } catch (err) {
      row.error = err.message;
      rows.push(row);
      console.log(`FAIL ${err.message}`);
      log.push(`[${i + 1}/${samples.length}] ${s.id} FAIL ${err.message}`);
    }
  }

  const summary = {
    total: rows.length,
    routerOk: rows.filter(r => r.routerOk).length,
    routerTriggeredHighband: rows.filter(r => r.routerTriggeredHighband).length,
    directHighbandOk: rows.filter(r => r.directHighbandOk).length,
    directHighband85Plus: rows.filter(r => r.directHighband85Plus).length,
    directHighbandExact9: rows.filter(r => r.directHighbandExact9).length,
    routerHighbandTriggeredIds: rows.filter(r => r.routerTriggeredHighband).map(r => r.id),
    notTriggeredIds: rows.filter(r => !r.routerTriggeredHighband).map(r => ({ id: r.id, mainScore: r.routerMainScore, route: r.routerRouteDecision, finalSource: r.routerFinalSource }))
  };

  log.push("");
  log.push("=== Summary ===");
  log.push(`routerTriggeredHighband: ${summary.routerTriggeredHighband}/${summary.total}`);
  log.push(`directHighband85Plus: ${summary.directHighband85Plus}/${summary.total}`);
  log.push(`directHighbandExact9: ${summary.directHighbandExact9}/${summary.total}`);

  const allKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const csv = [
    allKeys.join(","),
    ...rows.map(r => allKeys.map(h => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");

  const jsonPath = path.join(resultsDir, `router-v2-highband-trigger-report-${stamp}.json`);
  const csvPath = path.join(resultsDir, `router-v2-highband-trigger-report-${stamp}.csv`);
  const logPath = path.join(resultsDir, `router-v2-highband-trigger-log-${stamp}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify({ routerEndpoint, highbandEndpoint, generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(logPath, log.join("\n"));

  console.log("");
  console.log("=== Summary ===");
  console.log(`routerTriggeredHighband: ${summary.routerTriggeredHighband}/${summary.total}`);
  console.log(`directHighband85Plus: ${summary.directHighband85Plus}/${summary.total}`);
  console.log(`directHighbandExact9: ${summary.directHighbandExact9}/${summary.total}`);
  console.log("");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Log: ${logPath}`);

  // Do not fail the process if highband is not triggered; this is diagnostic.
  // The next action depends on the summary.
})();
