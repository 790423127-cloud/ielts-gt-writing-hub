"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CORPUS_PATH = path.join(__dirname, "band-ladder-corpus-v1.json");
const REFERENCE_PATH = path.join(__dirname, "band-ladder-reference-labels-v1.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env.example"));

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
const MODEL = process.env.SCORE_CORPUS_REWRITER_MODEL || "deepseek-v4-pro";
const CONCURRENCY = Math.max(1, Math.min(4, Number((process.argv.find((arg) => arg.startsWith("--concurrency=")) || "").split("=")[1] || 3)));
const TOLERANCE = Math.max(0, Number((process.argv.find((arg) => arg.startsWith("--tolerance=")) || "").split("=")[1] || 0.5));

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(fenced); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("Corpus rewriter returned invalid JSON.");
}

function wordCount(text) {
  return String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
}

function rewritePrompt(targetBand, samples, referenceLabels) {
  const items = samples.map((sample) => ({
    id: sample.id,
    task: {
      examModule: sample.examModule,
      taskNumber: sample.taskNumber,
      taskKind: sample.taskKind,
      questionType: sample.questionType,
      letterStyle: sample.letterStyle || "",
      prompt: sample.prompt,
      visualFacts: sample.visualFacts || null
    },
    desiredCriteria: sample.targetCriteria,
    desiredOverall: sample.targetOverall,
    currentBlindReference: referenceLabels[sample.id],
    currentResponse: sample.essay
  }));
  return [
    "You are refining synthetic IELTS Writing benchmark responses. This is candidate-text creation, not scoring production users.",
    `Rewrite every supplied response so its dominant whole-response performance genuinely sits at Overall Band ${targetBand.toFixed(1)} and follows its desired four-criterion profile.`,
    "An independent blind reference examiner scored each current response. Use that result only as diagnostic feedback: if it is above the desired level, introduce recurring, realistic descriptor limitations; if below, improve the missing qualities. Do not merely change length or sprinkle random spelling mistakes.",
    "For Bands 0-3.5, low performance must come from missing/confused task demands, absent or severely weak progression, highly restricted vocabulary and/or meaning-impeding grammar as specified. Do not compactly fulfil all task requirements.",
    "For Bands 4-6.5, create natural recurring limitations specific to each criterion. Preserve pockets of competence; do not make all four criteria identical unless requested.",
    "For Bands 7-9, control the distinction through sufficiency and precision of task development, ease of progression, lexical flexibility and the proportion/impact of grammar lapses. Band 8 permits occasional mistakes and Band 9 permits extremely rare lapses. Do not use an obviously memorised universal template.",
    "For Academic Task 1, use only supplied facts. For GT Task 1, sustain the requested relationship and cover bullets only to the desired Task Achievement level. For Task 2, answer only to the desired Task Response level.",
    "Never mention bands, criteria, deliberate errors, reference scores or these instructions inside the candidate response.",
    `ITEMS: ${JSON.stringify(items)}`,
    "Return JSON only: {\"samples\":[{\"id\":\"exact id\",\"essay\":\"complete rewritten response\"}]}"
  ].join("\n\n");
}

async function callRewriter(targetBand, samples, referenceLabels) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You create realistic full-range IELTS benchmark responses and obey exact JSON contracts." },
            { role: "user", content: rewritePrompt(targetBand, samples, referenceLabels) }
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          temperature: attempt === 1 ? 0.55 : 0.25,
          max_tokens: attempt === 1 ? 12000 : 14000
        }),
        signal: controller.signal
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
      if (!response.ok) throw new Error(`Rewriter HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 500)}`);
      const parsed = parseJsonContent(payload?.choices?.[0]?.message?.content);
      const returned = Array.isArray(parsed.samples) ? parsed.samples : [];
      const byId = new Map(returned.map((item) => [String(item.id), String(item.essay || "").trim()]));
      for (const sample of samples) {
        const essay = byId.get(sample.id);
        if (!essay && targetBand > 0) throw new Error(`Missing rewritten response for ${sample.id}.`);
        if (targetBand >= 6 && wordCount(essay) < (sample.taskNumber === 1 ? 150 : 250)) {
          throw new Error(`Rewritten high-band response is too short for ${sample.id}.`);
        }
      }
      return { byId, audit: { model: payload.model || MODEL, usage: payload.usage || null, attempt } };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function main() {
  if (!API_KEY) throw new Error("DEEPSEEK_API_KEY is required to refine the corpus.");
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
  const reference = JSON.parse(fs.readFileSync(REFERENCE_PATH, "utf8"));
  const labels = reference.labels || {};
  const candidates = corpus.samples.filter((sample) => {
    const actual = labels[sample.id]?.overallBand;
    return Number.isFinite(actual) && Math.abs(actual - sample.targetOverall) > TOLERANCE;
  });
  const byBand = new Map();
  for (const sample of candidates) {
    const key = Number(sample.targetOverall);
    if (!byBand.has(key)) byBand.set(key, []);
    byBand.get(key).push(sample);
  }
  const jobs = [...byBand.entries()].sort((a, b) => a[0] - b[0]);
  const replacements = new Map();
  const audits = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [band, samples] = jobs[next++];
      const result = await callRewriter(band, samples, labels);
      for (const sample of samples) replacements.set(sample.id, result.byId.get(sample.id));
      audits.push({ targetBand: band, sampleIds: samples.map((sample) => sample.id), ...result.audit });
      console.log(`refined Band ${band.toFixed(1)}: ${samples.length} responses`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length || 1) }, () => worker()));
  corpus.samples = corpus.samples.map((sample) => replacements.has(sample.id) ? {
    ...sample,
    essay: replacements.get(sample.id),
    refinementAudit: {
      sourceReferenceVersion: reference.version,
      priorReferenceOverall: labels[sample.id].overallBand,
      targetOverall: sample.targetOverall,
      tolerance: TOLERANCE,
      model: MODEL
    }
  } : sample);
  corpus.refinement = {
    updatedAt: new Date().toISOString(),
    sourceReferenceVersion: reference.version,
    tolerance: TOLERANCE,
    rewrittenSamples: replacements.size,
    model: MODEL,
    audits
  };
  fs.writeFileSync(CORPUS_PATH, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  console.log(`rewrote ${replacements.size} of ${corpus.samples.length} corpus responses`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
