const endpoint = "https://ielts-gt-writing-hub.vercel.app/api/writing-feedback";

const base = {
  task: "Task 1",
  feedbackTask: "Task 1",
  questionType: "formal letter",
  questionPrompt: "You are working full-time and have recently started a part-time course. Write a letter to your manager. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the company.",
  task1BulletPoints: [
    "explain why you are writing",
    "describe the change you want to your working hours",
    "explain how this change could benefit the company"
  ],
  essay: "Dear Mr Thompson,\n\nI am writing to ask if I could reduce my working hours because I started a part time course in business managment. I have many assignment and I feel hard to finish my work and study together.\n\nI want to work from 9 to 3 from Monday to Friday. I will still check my email after work and finish important task before I leave.\n\nThis course can help the company because I can learn communication and project planning. I think it is good for my team.\n\nThank you for your understand.\n\nYours sincerely,\nDavid Lee",
  frozenScore: { overallBand: 5 }
};

const modules = [
  "overview",
  "sentenceUpgrade",
  "grammarWordFormSpelling",
  "structureCohesionTask",
  "expressionBank"
];

async function testModule(module) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, module })
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  console.log("\nMODULE:", module);
  console.log("Status:", response.status);
  console.log("ok:", data.ok);
  console.log("feedbackVersion:", data.feedbackVersion);
  console.log("fallbackUsed:", Boolean(data.fallbackUsed));
  if (!response.ok || !data.ok) {
    console.log(JSON.stringify(data, null, 2));
    process.exitCode = 1;
  }
}

(async () => {
  console.log("Endpoint:", endpoint);
  for (const module of modules) {
    await testModule(module);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
