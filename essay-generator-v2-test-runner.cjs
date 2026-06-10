const endpoint = "https://ielts-gt-writing-hub.vercel.app/api/essay-generator";

const sample = {
  task: "Task 1",
  taskType: "Task 1",
  generationTask: "Task 1",
  selectedTask: "Task 1",
  questionType: "formal letter",
  title: "Request to reduce working hours",
  questionPrompt: "You are working full-time and have recently started a part-time course. Write a letter to your manager. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the company.",
  promptText: "You are working full-time and have recently started a part-time course. Write a letter to your manager. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the company.",
  essay: "Dear Mr Thompson,\n\nI am writing to ask if I could reduce my working hours for the next six months, as I have recently started a part-time diploma in business management.\n\nAt the moment, I find it hard to balance my full-time job with evening classes and assignments. Although I am still committed to my role, a lighter schedule would help me keep up my work quality while studying.\n\nI would like to work from 9 a.m. to 3 p.m., Monday to Friday. I will still be available by email for urgent matters after hours, and I will finish all important tasks before leaving each day.\n\nThis course covers leadership, project planning, and workplace communication. These skills are relevant to my job, and I hope to use them to improve team coordination and contribute more to future projects.\n\nThank you for considering my request. I would be happy to discuss this further at your convenience.\n\nYours sincerely,\nDavid Lee",
  currentResult: {
    task: "Task 1",
    overallBand: 5,
    finalCriteria: {
      "Task Achievement": 5,
      "Coherence and Cohesion": 5,
      "Lexical Resource": 5,
      "Grammatical Range and Accuracy": 5
    }
  },
  frozenScore: { overallBand: 5 },
  mode: "generation_only"
};

async function run() {
  console.log("Endpoint:", endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(sample)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  console.log("Status:", response.status);
  console.log("generatorVersion:", data.generatorVersion);
  console.log("currentBand:", data.currentBand);
  console.log("targetBandModel:", data.targetBandModel);
  console.log("targetBandPlus05:", data.targetBandPlus05);
  console.log("targetBandPlus10:", data.targetBandPlus10);
  console.log("modelAnswer essay:", Boolean(data.modelAnswer && data.modelAnswer.essay));
  console.log("revisionPlus05 essay:", Boolean(data.revisionPlus05 && data.revisionPlus05.essay));
  console.log("revisionPlus10 essay:", Boolean(data.revisionPlus10 && data.revisionPlus10.essay));
  console.log("learningGuide:", Boolean(data.learningGuide));

  if (!response.ok) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
