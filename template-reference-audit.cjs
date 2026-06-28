const fs = require("fs");
const vm = require("vm");

const endpoint = process.env.TEMPLATE_REFERENCE_ENDPOINT || "https://ielts-gt-writing-hub.vercel.app/api/template-reference";

const source = fs.readFileSync("data.js", "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const prompts = sandbox.window.IELTS_GT_DATA.prompts;

const sampleEssayTask1 = `Dear Sir or Madam,

I am writing about this situation because it has caused a problem for me. I want to explain what happened and ask for your help.

The main issue is clear. It affects my daily life and makes the situation difficult. I also think other people may have the same problem.

I hope you can consider my request and take some action soon. Thank you for your time.

Yours faithfully,
John Smith`;

const sampleEssayTask2 = `Many people have different opinions about this topic. I think it is important because it affects daily life.

One reason is that people want an easier life. For example, they may choose something that saves time or money. This can be useful, but it can also create problems.

Another reason is that society is changing quickly. People often follow new habits without thinking carefully. I think this development is mostly negative if people do not control it.

In conclusion, this issue has both good and bad sides, but people should make careful choices.`;

function chooseSamples() {
  const task1 = [
    "b15-t1-task1",
    "b15-t2-task1",
    "b15-t3-task1",
    "b16-t2-task1",
    "b16-t3-task1",
    "b18-t1-task1",
    "b18-t2-task1",
    "b19-t1-task1",
    "b19-t3-task1",
    "b20-t2-task1"
  ].map((id) => prompts.find((p) => p.id === id));

  const task2 = [
    "b15-t2-task2",
    "b15-t4-task2",
    "b16-t2-task2",
    "b17-t1-task2",
    "b17-t2-task2",
    "b17-t4-task2",
    "b18-t1-task2",
    "b19-t4-task2",
    "b20-t3-task2",
    "b20-t4-task2"
  ].map((id) => prompts.find((p) => p.id === id));

  return [...task1, ...task2].filter(Boolean);
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function localWarnings(text, task) {
  const warnings = [];
  const checks = [
    [/Dear the\b/i, "awkward greeting: Dear the ..."],
    [/\b\/\b|better\/worse|positive\/negative/i, "literal slash choice left in output"],
    [/\[[^\]]+\]/, "unfilled bracket placeholder"],
    [/\bundefined\b|\bnull\b/i, "undefined/null leaked"],
    [/\ba clear point related to the question\b/i, "fallback slot leaked"],
    [/\bthis topic\b/i, "generic topic wording"],
    [/\bthe situation better\/worse\b/i, "better/worse not resolved"],
    [/For example,\s*for example/i, "duplicated For example lead-in"],
    [/As a result,\s*as a result/i, "duplicated As a result lead-in"],
    [/This means that\s+(This|Without|Because|As|For)\b/i, "awkward This means that lead-in"],
    [/Please let me know whether\s*(please|if)\b/i, "duplicated request lead-in"],
    [/Please let me know if\s*please\b/i, "duplicated informal request lead-in"],
    [/I would be happy to\s*I\s+(can|will|would)\b/i, "duplicated offer lead-in"],
    [/I would like to\s*(there\s+(is|are)|I\s+(want|hope|need))\b/i, "action slot is a full sentence"],
    [/I am writing to\s+\w+\s+to\s+/i, "duplicated purpose verb"],
    [/\b(cialising|ciety|me people)\b/i, "word damaged by over-broad lead trimming"],
    [/If people\s+(when|if)\b/i, "duplicated condition lead-in"],
    [/\b(they|people) may\s+(they|people|this leads|this can lead)\b/i, "duplicated result lead-in"],
    [/we could\s+we could\b/i, "duplicated shared action lead-in"],
    [/\bI believe\s+I\s+(think|believe|prefer|agree)\b/i, "duplicated opinion lead-in"],
    [/\bIn my opinion,\s+I\s+(think|believe|prefer|agree)\b/i, "duplicated intro opinion lead-in"],
    [/\baround\s+(in|on|at|during|every)\b/i, "duplicated time preposition after around"],
    [/\bsoon\s+as soon as convenient\b/i, "duplicated soon phrase"],
    [/\bbecause\s+(cannot|can|need|needs|have|has|will|would|should|may|might)\b/i, "missing subject after because"]
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) warnings.push(label);
  }
  const words = countWords(text);
  if (task === "Task 1" && words < 150) warnings.push(`Task 1 below 150 words: ${words}`);
  if (task === "Task 2" && words < 250) warnings.push(`Task 2 below 250 words: ${words}`);
  return warnings;
}

async function generate(prompt) {
  const body = {
    task: prompt.task,
    type: prompt.type,
    letterStyle: prompt.letterStyle || "",
    questionTitle: prompt.title,
    questionPrompt: prompt.prompt,
    essay: prompt.task === "Task 1" ? sampleEssayTask1 : sampleEssayTask2,
    targetBand: 5.5
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data.ok === false) {
    throw new Error(`${prompt.id} HTTP ${response.status}: ${data.error || ""} ${data.detail || text.slice(0, 200)}`);
  }
  const essay = String(data.referenceEssay || "");
  return {
    id: prompt.id,
    task: prompt.task,
    type: prompt.type,
    style: prompt.letterStyle || "",
    title: prompt.title,
    templateId: data.templateId,
    templateUsed: data.templateUsed,
    wordCount: countWords(essay),
    warnings: localWarnings(essay, prompt.task),
    essay,
    filledSlots: data.filledSlots || {}
  };
}

(async () => {
  const selected = chooseSamples();
  const results = [];
  for (const prompt of selected) {
    console.error(`Generating ${prompt.id} ${prompt.task} ${prompt.title}`);
    results.push(await generate(prompt));
  }
  console.log(JSON.stringify({
    endpoint,
    generatedAt: new Date().toISOString(),
    summary: results.map((r) => ({
      id: r.id,
      task: r.task,
      type: r.type,
      style: r.style,
      title: r.title,
      templateId: r.templateId,
      wordCount: r.wordCount,
      warnings: r.warnings
    })),
    results
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
