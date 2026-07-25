"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(__dirname, "band-ladder-corpus-v1.json");
const CHECKPOINT = path.join(__dirname, "reports", "band-ladder-generation-checkpoint.json");

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

const API_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.BENCHMARK_WRITER_MODEL || process.env.SCORE_GENERATOR_MODEL || process.env.SCORE_TEACHER_MODEL || "deepseek-v4-pro";
const CONCURRENCY = Math.max(1, Math.min(3, Number((process.argv.find((arg) => arg.startsWith("--concurrency=")) || "").split("=")[1]) || 2));
const REGENERATE = new Set(((process.argv.find((arg) => arg.startsWith("--regenerate=")) || "").split("=")[1] || "").split(",").map(Number).filter(Number.isFinite));

const A1_PROMPT = "The table below shows the percentage of commuters in Harton who travelled to work by car, bus or bicycle in 2000 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.";
const A1_FACTS = {
  visualType: "table",
  title: "Commuting methods in Harton, 2000 and 2025",
  units: "percentage of commuters",
  dataPoints: [
    { year: 2000, car: 48, bus: 37, bicycle: 15 },
    { year: 2025, car: 62, bus: 24, bicycle: 14 }
  ],
  keyFeatures: [
    "Cars were highest in both years and rose from 48% to 62%.",
    "Bus use fell from 37% to 24%.",
    "Bicycle use was lowest and changed only from 15% to 14%."
  ],
  majorComparisons: ["The car-bus gap widened from 11 to 38 percentage points."],
  sourceVerified: true
};

const TASKS = [
  { key: "A1-table", examModule: "academic", taskNumber: 1, taskKind: "academic_visual_report", questionType: "table", prompt: A1_PROMPT, visualFacts: A1_FACTS },
  { key: "A2-discussion", examModule: "academic", taskNumber: 2, taskKind: "essay", questionType: "discussion_opinion", prompt: "Some people believe universities should mainly teach practical skills that help graduates find employment. Others think the main purpose of university is to provide academic knowledge. Discuss both views and give your own opinion." },
  { key: "G1-complaint", examModule: "general_training", taskNumber: 1, taskKind: "gt_letter", questionType: "formal_complaint", letterStyle: "formal", prompt: "You recently bought a household appliance from a local shop, but it was damaged when you opened the box. Write a letter to the shop manager. In your letter: describe the appliance and the damage; explain how this problem has affected you; say what you would like the manager to do." },
  { key: "G2-problem", examModule: "general_training", taskNumber: 2, taskKind: "essay", questionType: "problems_solutions", prompt: "Many towns and cities are producing increasing amounts of household waste. What problems does this cause, and what measures could individuals and local authorities take to reduce the amount of waste?" },
  { key: "A2-opinion", examModule: "academic", taskNumber: 2, taskKind: "essay", questionType: "agree_disagree", prompt: "Some people think that children should begin formal education at a very early age, while others believe they should not start school until the age of seven. Discuss both views and give your own opinion." },
  { key: "G1-request", examModule: "general_training", taskNumber: 1, taskKind: "gt_letter", questionType: "semi_formal_request", letterStyle: "semi-formal", prompt: "You are planning a community event and would like to use a room at a local college. Write a letter to the college administrator. In your letter: describe the event; explain why you need the room; ask about the facilities and cost." },
  { key: "A1-process", examModule: "academic", taskNumber: 1, taskKind: "academic_visual_report", questionType: "process", prompt: "The diagram shows how used glass bottles are recycled. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.", visualFacts: { visualType: "process", stages: ["collection", "sorting", "washing", "crushing", "melting", "moulding new bottles", "distribution"], keyFeatures: ["The process is cyclical.", "Used bottles pass through seven main stages from collection to redistribution."], sourceVerified: true } },
  { key: "G2-opinion", examModule: "general_training", taskNumber: 2, taskKind: "essay", questionType: "agree_disagree", prompt: "Some people believe that all employees should be allowed to work from home whenever they choose. To what extent do you agree or disagree?" }
];

const BANDS = Array.from({ length: 19 }, (_, index) => index / 2);

function roundHalf(value) {
  return Math.max(0, Math.min(9, Math.round(Number(value) * 2) / 2));
}

function criteriaNames(task) {
  return [task.taskNumber === 1 ? "Task Achievement" : "Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function criterionProfile(target, slot, task) {
  if (target === 0) return Object.fromEntries(criteriaNames(task).map((name) => [name, 0]));
  const patterns = [
    [0, 0, 0, 0],
    [0.5, 0, -0.5, 0],
    [0, 0.5, 0, -0.5],
    [-0.5, 0, 0.5, 0],
    [0, -0.5, 0, 0.5]
  ];
  const values = patterns[slot].map((delta) => roundHalf(target + delta));
  return Object.fromEntries(criteriaNames(task).map((name, index) => [name, values[index]]));
}

function taskFor(targetIndex, slot) {
  if (slot < 4) return TASKS[slot];
  return TASKS[4 + (targetIndex % (TASKS.length - 4))];
}

function targetWordGuidance(band, taskNumber) {
  const taskLabel = taskNumber === 1 ? "Task 1" : "Task 2";
  if (band <= 1) return `${taskLabel}: normally no more than 20 English words because only isolated words or non-rateable fragments are available; do not communicate the task in compressed note form.`;
  if (band <= 1.5) return `${taskLabel}: often about 10-30 words, with at most a fragile phrase or sentence; no connected task response.`;
  if (band <= 2) return `${taskLabel}: often about 20-55 words, barely related strings with virtually no control; do not cover the task requirements.`;
  if (band <= 2.5) return `${taskLabel}: often about 35-75 words; fragments may convey pockets of meaning but task contact, organisation and sentence control remain severely limited.`;
  if (band <= 3) return `${taskLabel}: often about 50-100 words; only fragments of the task are addressed, progression is absent and errors repeatedly impede meaning. Never list all visual facts or satisfy all bullets.`;
  if (band <= 3.5) return `${taskLabel}: often about 75-130 words; partial task contact and some connected meaning, but major requirements remain unmet and frequent errors impede substantial parts.`;
  if (band <= 4) return `${taskLabel}: about ${taskNumber === 1 ? "105-145" : "130-190"} words, an evident attempt but incomplete coverage and frequent errors.`;
  if (band <= 4.5) return `${taskLabel}: about ${taskNumber === 1 ? "125-165" : "170-230"} words, partly functional but uneven and limited.`;
  if (band <= 5) return `${taskLabel}: about ${taskNumber === 1 ? "145-180" : "210-270"} words, generally understandable and partly complete, with limited development and recurring errors.`;
  if (band <= 5.5) return `${taskLabel}: about ${taskNumber === 1 ? "155-195" : "240-290"} words, functional and mostly relevant but inconsistent across the four criteria.`;
  if (band <= 6.5) return `${taskLabel}: meet the normal minimum (${taskNumber === 1 ? "150+" : "250+"} words), with adequate coverage and control but clear recurring limitations.`;
  if (band <= 7.5) return `${taskLabel}: meet the normal minimum, fully address the task, and show clear control with a few genuine limitations preventing the next band.`;
  return `${taskLabel}: meet the normal minimum and demonstrate the precise, flexible, sustained control required at Band ${band.toFixed(1)}; do not add artificial mistakes.`;
}

const BAND_DESIGN_GUIDANCE = {
  1: "Only isolated words or no rateable sentence-level language. Recognisable topic words must not combine into a functional summary, letter or argument.",
  1.5: "Between Bands 1 and 2: a fragile pocket of related meaning may emerge, but there is no connected communicative response.",
  2: "Barely related content with virtually no control of organisation, vocabulary or sentence forms. Most task demands are not meaningfully addressed.",
  2.5: "Between Bands 2 and 3: several fragments relate to the topic, but the response remains severely distorted, fragmentary and hard to follow.",
  3: "Only fragments of the task are addressed. There is no clear progression; vocabulary and grammar are severely limited and errors repeatedly impede meaning.",
  3.5: "Between Bands 3 and 4: a recognisable attempt exists, but important task demands are still missing or confused and communication frequently breaks down.",
  4: "An evident but limited attempt: important requirements are missed or confused, overall progression is weak, vocabulary is basic and repetitive, and frequent errors impede parts of the message.",
  4.5: "Between Bands 4 and 5: partly functional and sometimes understandable, yet coverage, organisation and language control are consistently uneven.",
  5: "The task is addressed but incompletely or insufficiently developed. Organisation is visible but not always logical; vocabulary is minimally adequate and frequent grammar errors can cause some difficulty.",
  5.5: "Between Bands 5 and 6: generally understandable and relevant, with emerging progression and range, but important limitations recur across the response.",
  6: "Main requirements are addressed with clear overall progression. Language is adequate and meaning generally clear, though development, cohesion, range or accuracy remains uneven.",
  6.5: "Between Bands 6 and 7: a solid response with several Band-7 qualities, but one or more recurring limitations prevent full Band-7 control.",
  7: "All main requirements are addressed and developed; progression is clear and language shows range and frequent control, with non-dominant lapses.",
  7.5: "Between Bands 7 and 8: consistently strong and easy to follow, with some but not all criteria showing the skilful sufficiency, flexibility and accuracy of Band 8.",
  8: "Requirements are covered appropriately, relevantly and sufficiently; ideas or features are skilfully selected, the response is easy to follow, and wide flexible language is used with only occasional inaccuracies.",
  8.5: "Between Bands 8 and 9: sustained Band-8 control with several near-Band-9 qualities; any lapse is rare and local rather than a recurring pattern.",
  9: "Fully, precisely and naturally fulfils the task. Organisation is effortless and language control is wide, flexible and sustained; only extremely rare lapses are permissible."
};

function lowBoundarySamples() {
  const essaysByBand = {
    0: ["", "这不是英文回答。", "هذه ليست إجابة باللغة الإنجليزية.", "........", "回答は日本語だけです。"],
    0.5: ["car bus bicycle number", "University job knowledge because good.", "Dear manager damage sorry help", "city rubbish people bad problem", "work home good bad I think"]
  };
  return [0, 0.5].flatMap((band, bandIndex) => essaysByBand[band].map((essay, slot) => {
    const task = taskFor(bandIndex, slot);
    return {
      id: `ladder-b${String(band).replace(".", "_")}-${slot + 1}-${task.key.toLowerCase()}`,
      targetOverall: band,
      targetCriteria: criterionProfile(band, slot, task),
      split: slot === 4 ? "holdout" : "calibration",
      benchmarkClass: band === 0 ? "official-band-zero-condition" : "band-zero-to-one-boundary",
      ...task,
      essay
    };
  }));
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(fenced); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("Benchmark writer did not return valid JSON.");
}

function countWords(text) {
  return (String(text || "").match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
}

function generationPrompt(band, targetIndex) {
  const slots = Array.from({ length: 5 }, (_, slot) => {
    const task = taskFor(targetIndex, slot);
    return {
      slot: slot + 1,
      task,
      targetCriteria: criterionProfile(band, slot, task),
      lengthGuidance: targetWordGuidance(band, task.taskNumber)
    };
  });
  return [
    "You are creating blinded IELTS Writing benchmark responses, not grading them.",
    `Create exactly five distinct candidate responses designed around an overall Band ${band.toFixed(1)} boundary.`,
    "The target criteria are design controls. Never mention bands, criteria, testing, deliberate errors or these instructions inside a candidate response.",
    "Follow the current public IELTS descriptors. Half bands must genuinely sit between adjacent whole-band patterns, not merely contain a fixed number of mistakes.",
    `DOMINANT BAND DESIGN: ${BAND_DESIGN_GUIDANCE[band]}`,
    "Make each response natural for a real learner at that level. Vary ideas, sentence shapes, error types, organisation and vocabulary. Do not use the same scaffold five times.",
    "Task weaknesses and language weaknesses must be separable according to the supplied criterion profile. Do not make every criterion identical unless the profile says so.",
    "Length is only a realism cue, never the mechanism that creates the band. A short response can still communicate efficiently, so low-band responses must embody the stated descriptor failures rather than merely stop early.",
    "When the first-criterion target is below Band 5, omit, confuse or distort enough task requirements to fit that target. Do not accidentally cover every data point, bullet, view or question in concise form.",
    "For Academic Task 1, use only the supplied visual facts. A weak response may omit or inaccurately report some facts only when the Task Achievement target is low.",
    "For General Training Task 1, use a realistic salutation and closing when the level supports them, and respond to the supplied bullet points according to Task Achievement.",
    "For Task 2, answer the exact question and control development according to Task Response. Do not include meta-commentary.",
    `SLOTS: ${JSON.stringify(slots)}`,
    "Return JSON only: {\"samples\":[{\"slot\":1,\"essay\":\"...\"},...,{\"slot\":5,\"essay\":\"...\"}]}"
  ].join("\n\n");
}

async function callWriter(band, targetIndex) {
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
            { role: "system", content: "You write realistic IELTS benchmark responses across the full 0-9 scale. Return valid JSON only." },
            { role: "user", content: generationPrompt(band, targetIndex) }
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          temperature: attempt === 1 ? 0.75 : 0.45,
          max_tokens: 12000
        }),
        signal: controller.signal
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
      if (!response.ok) throw new Error(`Writer HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 500)}`);
      const parsed = parseJsonContent(payload?.choices?.[0]?.message?.content);
      if (!Array.isArray(parsed.samples) || parsed.samples.length !== 5) throw new Error("Writer must return exactly five samples.");
      const bySlot = new Map(parsed.samples.map((sample) => [Number(sample.slot), String(sample.essay || "").trim()]));
      if ([1, 2, 3, 4, 5].some((slot) => !bySlot.has(slot))) throw new Error("Writer response has missing slots.");
      if (band >= 6) {
        const shortSlots = [1, 2, 3, 4, 5].filter((slot) => {
          const task = taskFor(targetIndex, slot - 1);
          return countWords(bySlot.get(slot)) < (task.taskNumber === 1 ? 150 : 250);
        });
        if (shortSlots.length) throw new Error(`High-band writer responses under minimum length in slots: ${shortSlots.join(",")}`);
      }
      return { bySlot, audit: { model: payload.model || MODEL, usage: payload.usage || null, attempt } };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT)) return {};
  try { return JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")); } catch { return {}; }
}

function saveCheckpoint(checkpoint) {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function materializeBand(band, targetIndex, generated) {
  return Array.from({ length: 5 }, (_, slot) => {
    const task = taskFor(targetIndex, slot);
    return {
      id: `ladder-b${String(band).replace(".", "_")}-${slot + 1}-${task.key.toLowerCase()}`,
      targetOverall: band,
      targetCriteria: criterionProfile(band, slot, task),
      split: slot === 4 ? "holdout" : "calibration",
      benchmarkClass: band % 1 ? "half-band-boundary" : "whole-band-anchor",
      ...task,
      essay: generated.bySlot[String(slot + 1)] || generated.bySlot[slot + 1],
      generationAudit: generated.audit
    };
  });
}

async function main() {
  if (!API_KEY) throw new Error("DEEPSEEK_API_KEY is required to build the band ladder corpus.");
  const checkpoint = loadCheckpoint();
  const pending = BANDS.filter((band) => band >= 1 && (!checkpoint[String(band)] || REGENERATE.has(band)));
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const band = pending[next++];
      const targetIndex = BANDS.indexOf(band);
      const result = await callWriter(band, targetIndex);
      checkpoint[String(band)] = { bySlot: Object.fromEntries(result.bySlot), audit: result.audit };
      saveCheckpoint(checkpoint);
      console.log(`generated Band ${band.toFixed(1)}: 5/5 with ${result.audit.model}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, () => worker()));

  const samples = [
    ...lowBoundarySamples(),
    ...BANDS.filter((band) => band >= 1).flatMap((band) => materializeBand(band, BANDS.indexOf(band), checkpoint[String(band)]))
  ].sort((a, b) => a.targetOverall - b.targetOverall || a.id.localeCompare(b.id));
  const corpus = {
    version: "band-ladder-0-to-9-five-per-half-band-v1",
    createdAt: new Date().toISOString(),
    source: "Synthetic responses independently generated for blinded system validation. Target labels are design labels derived from official public descriptors and are never sent to the scorer.",
    officialDescriptorReference: "https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
    modelSeparation: { benchmarkWriter: MODEL, productionScorer: process.env.SCORE_EXAMINER_MODEL || "deepseek-v4-flash" },
    split: { calibration: 76, holdout: 19 },
    acceptance: {
      overallMeanAbsoluteErrorMax: 0.55,
      criterionMeanAbsoluteErrorMax: 0.7,
      withinHalfBandRateMin: 0.75,
      catastrophicErrorRateMax: 0.02,
      lowBandZeroOneAccuracyMin: 0.8,
      holdoutOverallMeanAbsoluteErrorMax: 0.65
    },
    samples
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  console.log(`wrote ${samples.length} samples to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
