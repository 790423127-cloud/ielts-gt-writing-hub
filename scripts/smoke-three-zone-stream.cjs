"use strict";

const endpoint = process.env.SMOKE_SCORE_URL || "http://127.0.0.1:4000/api/grade-writing";
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 210000);

const payload = {
  examModule: "general_training",
  taskNumber: 1,
  taskKind: "gt_letter",
  mode: "score",
  letterStyle: "formal",
  questionPrompt: "You recently bought a household appliance from a local shop, but it was damaged when you opened the box. Write a letter to the shop manager. In your letter: describe the appliance and the damage; explain how this problem has affected you; say what you would like the manager to do.",
  essay: "Dear Sir or Madam,\n\nI am writing about a microwave I purchased from your High Street branch last Friday. When I opened the undamaged box at home, I found a deep crack across the glass door and the control panel would not switch on.\n\nThis has caused considerable inconvenience because my old microwave has already stopped working. I care for my elderly father and need to heat several prepared meals for him each day, so I have had to travel to my sister's house instead.\n\nPlease arrange collection of the damaged unit and send a tested replacement of the same model. If that model is unavailable, I would prefer a full refund to my original payment method. I have kept the receipt, packaging and photographs of the damage.\n\nI look forward to your prompt reply.\n\nYours faithfully,\nAlex Chen"
};

async function main() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stages = [];
  let result = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "progress") stages.push(event.stage);
      if (event.type === "error") throw new Error(`${event.error}: ${event.detail}`);
      if (event.type === "result") result = event.data;
    }
    if (done) break;
  }
  const required = ["examiners_started", "examiners_completed", "agreement_completed", "score_frozen"];
  for (const stage of required) if (!stages.includes(stage)) throw new Error(`Missing stream stage: ${stage}`);
  if (!result?.threeZonePanel?.enabled) throw new Error("Three-zone panel was not enabled.");
  if (result.threeZonePanel.localScoreAdjustment !== false) throw new Error("Pure-AI local adjustment audit failed.");
  const escalated = stages.includes("specialist_started");
  if (escalated) {
    for (const stage of ["specialist_completed", "adjudication_started", "adjudication_completed"]) {
      if (!stages.includes(stage)) throw new Error(`Missing escalated stream stage: ${stage}`);
    }
    if (result.scoreCalculation?.source !== "three-zone-ai-meta-adjudicator") throw new Error("Escalated final score did not come from the AI meta-adjudicator.");
  } else {
    if (!stages.includes("adjudication_skipped")) throw new Error("Stable AI panel did not emit adjudication_skipped.");
    if (!/^independent-examiner-/.test(String(result.scoreCalculation?.source || ""))) throw new Error("Stable final score did not come directly from an AI examiner.");
  }
  console.log(JSON.stringify({
    ok: true,
    endpoint,
    stages,
    escalated,
    specialistZone: result.threeZonePanel.routing?.zone,
    specialistBand: result.threeZonePanel.specialist?.overallBand,
    finalBand: result.overallBand,
    criteria: result.criteria,
    scoreSource: result.scoreCalculation.source,
    localScoreAdjustment: result.threeZonePanel.localScoreAdjustment,
    costOptimization: result.modelAudit?.costOptimization,
    promptVersion: result.promptVersion,
    scoreSystemVersion: result.scoreSystemVersion
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(() => clearTimeout(timeout));
