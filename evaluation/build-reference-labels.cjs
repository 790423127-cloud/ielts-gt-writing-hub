"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveTaskConfig } = require("../api/_scoring/tasks");
const { BAND_ANCHORS } = require("../api/_scoring/rubric");

const ROOT = path.join(__dirname, "..");
const CORPUS_PATH = path.join(__dirname, "band-ladder-corpus-v1.json");
const OUTPUT_PATH = path.join(__dirname, "band-ladder-reference-labels-v1.json");

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
const MODEL = process.env.SCORE_REFERENCE_MODEL || "deepseek-v4-pro";
const CONCURRENCY = Math.max(1, Math.min(4, Number((process.argv.find((arg) => arg.startsWith("--concurrency=")) || "").split("=")[1] || 3)));
const BATCH_SIZE = Math.max(1, Math.min(5, Number((process.argv.find((arg) => arg.startsWith("--batch-size=")) || "").split("=")[1] || 5)));

function roundHalf(value) {
  return Math.max(0, Math.min(9, Math.round(Number(value) * 2) / 2));
}

function stableOrder(sample) {
  return crypto.createHash("sha256").update(`reference-v1:${sample.id}`).digest("hex");
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(fenced); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("Reference examiner returned invalid JSON.");
}

function isBand(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 9 && Math.abs(number * 2 - Math.round(number * 2)) < 1e-9;
}

function opaqueSamples(batch, offset) {
  return batch.map((sample, index) => {
    const taskConfig = resolveTaskConfig(sample);
    return {
      ref: `R${String(offset + index + 1).padStart(3, "0")}`,
      module: taskConfig.moduleLabel,
      task: taskConfig.task,
      taskKind: taskConfig.taskKind,
      criteria: taskConfig.criteria,
      question: sample.prompt,
      visualFacts: sample.visualFacts || null,
      candidateResponse: sample.essay
    };
  });
}

function referenceMessages(opaqueBatch) {
  const system = [
    "You are a senior independent IELTS Writing reference examiner creating blind benchmark labels.",
    "You cannot see author targets, production scores or filenames. Score each response independently; do not infer or enforce a distribution across the batch.",
    "Apply the public IELTS Writing descriptors using whole-response best fit. Keep the four criteria independent and use half bands only for genuine adjacent-descriptor mixtures.",
    "Band 0 is reserved for no attempt, wholly non-English or no rateable English. Band 1 has only isolated words or no rateable sentence-level language. An under-length response is not assigned an automatic score: judge the actual loss of task fulfilment and control.",
    "Band 8 permits occasional non-systematic lapses. Band 9 permits extremely rare lapses. Do not demand inversion, an unconventional structure, zero topic-word repetition, extra examples beyond sufficient development, or impossible perfection.",
    "For each criterion, identify the dominant recurring pattern. Do not reward isolated polished phrases and do not invent limitations to fill a next-band gap.",
    `WHOLE-BAND REFERENCE ANCHORS: ${JSON.stringify(BAND_ANCHORS)}`,
    "Return JSON only in this exact shape: {\"samples\":[{\"ref\":\"R001\",\"criteria\":{\"exact criterion name\":7.0},\"confidence\":0.8,\"rationale\":\"concise whole-response boundary reason\"}]}",
    "Return exactly one entry per supplied ref and exactly the four supplied criterion names. Every band must be 0, 0.5, 1.0 ... 9.0. Do not return an overall band."
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `Blindly score these submissions:\n${JSON.stringify(opaqueBatch)}` }
  ];
}

async function callReference(opaqueBatch) {
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
          messages: referenceMessages(opaqueBatch),
          response_format: { type: "json_object" },
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          temperature: 0,
          max_tokens: attempt === 1 ? 8000 : 10000
        }),
        signal: controller.signal
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
      if (!response.ok) throw new Error(`Reference HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 500)}`);
      const parsed = parseJsonContent(payload?.choices?.[0]?.message?.content);
      const returned = Array.isArray(parsed.samples) ? parsed.samples : [];
      const byRef = new Map(returned.map((item) => [String(item.ref), item]));
      for (const sample of opaqueBatch) {
        const item = byRef.get(sample.ref);
        if (!item) throw new Error(`Missing reference label for ${sample.ref}.`);
        const keys = Object.keys(item.criteria || {});
        if (keys.length !== 4 || sample.criteria.some((name) => !isBand(item.criteria[name]))) {
          throw new Error(`Invalid criterion labels for ${sample.ref}.`);
        }
      }
      return {
        byRef,
        audit: {
          model: payload.model || MODEL,
          usage: payload.usage || null,
          finishReason: payload?.choices?.[0]?.finish_reason || "",
          attempt
        }
      };
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
  if (!API_KEY) throw new Error("DEEPSEEK_API_KEY is required to build reference labels.");
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
  const shuffled = [...corpus.samples].sort((a, b) => stableOrder(a).localeCompare(stableOrder(b)));
  const batches = [];
  for (let index = 0; index < shuffled.length; index += BATCH_SIZE) batches.push({ index, samples: shuffled.slice(index, index + BATCH_SIZE) });
  const labels = {};
  const audits = [];
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const opaque = opaqueSamples(batch.samples, batch.index);
      const result = await callReference(opaque);
      opaque.forEach((entry, index) => {
        const returned = result.byRef.get(entry.ref);
        const criteria = Object.fromEntries(entry.criteria.map((name) => [name, Number(returned.criteria[name])]));
        labels[batch.samples[index].id] = {
          criteria,
          overallBand: roundHalf(Object.values(criteria).reduce((sum, value) => sum + value, 0) / 4),
          confidence: Math.max(0, Math.min(1, Number(returned.confidence || 0.7))),
          rationale: String(returned.rationale || "").slice(0, 1200)
        };
      });
      audits.push({ refs: opaque.map((entry) => entry.ref), ...result.audit });
      console.log(`reference batch ${audits.length}/${batches.length}: ${opaque.length} samples`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length || 1) }, () => worker()));
  const output = {
    version: "blind-independent-reference-v1",
    createdAt: new Date().toISOString(),
    corpusVersion: corpus.version,
    methodology: "Stable shuffled batches with opaque IDs; author design targets and production scores were hidden. Four criterion bands came from an independent Pro reference examiner and Overall was calculated from their equal average.",
    model: MODEL,
    labels,
    audits
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`wrote ${Object.keys(labels).length} blind reference labels to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
