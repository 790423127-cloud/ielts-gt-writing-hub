"use strict";

const endpoint = process.env.SMOKE_FEEDBACK_URL || "http://127.0.0.1:4000/api/criterion-feedback";
const criteria = {
  "Task Achievement": 7,
  "Coherence and Cohesion": 7,
  "Lexical Resource": 6.5,
  "Grammatical Range and Accuracy": 7
};
const payload = {
  examModule: "general_training",
  task: "Task 1",
  taskNumber: 1,
  mode: "criterion_feedback_batch",
  questionPrompt: "You bought a damaged appliance. Describe the damage, explain the effect and request a solution.",
  essay: "Dear Sir or Madam,\n\nI am writing about a microwave I purchased from your High Street branch last Friday. When I opened the undamaged box at home, I found a deep crack across the glass door and the control panel would not switch on.\n\nThis has caused considerable inconvenience because my old microwave has already stopped working. I care for my elderly father and need to heat several prepared meals for him each day.\n\nPlease arrange collection of the damaged unit and send a tested replacement of the same model. If that model is unavailable, I would prefer a full refund.\n\nYours faithfully,\nAlex Chen",
  frozenScore: { criteria, finalCriteria: criteria }
};

async function main() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
  const generated = Object.keys(result.criterionCalibration || {});
  if (generated.length !== 4) throw new Error(`Expected four feedback criteria, received ${generated.length}.`);
  for (const [criterion, band] of Object.entries(criteria)) {
    if (Number(result.criterionCalibration?.[criterion]?.band) !== band) throw new Error(`${criterion} changed the frozen band.`);
  }
  if (result.costOptimization?.batchMode !== true) throw new Error("Feedback endpoint did not use batch mode.");
  const totalTokens = (result.modelAudit || []).reduce((sum, audit) => sum + Number(audit?.usage?.total_tokens || 0), 0);
  console.log(JSON.stringify({
    ok: true,
    endpoint,
    generatedCriteria: generated,
    frozenBandsPreserved: true,
    feedbackSystemVersion: result.feedbackSystemVersion,
    aiCalls: result.costOptimization?.aiCalls,
    fallbackUsed: result.costOptimization?.fallbackUsed,
    models: (result.modelAudit || []).map((audit) => audit.model),
    totalTokens
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
