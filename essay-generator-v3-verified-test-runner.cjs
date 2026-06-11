const endpoint = "https://ielts-gt-writing-hub.vercel.app/api/essay-generator";

const sample = {
  task: "Task 1",
  generationTask: "Task 1",
  questionType: "semi-formal letter",
  title: "Request to reduce working hours for a part-time course",
  questionPrompt: "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the restaurant.",
  essay: `Dear Mark,\n\nI am writing to ask if I can reduce my working hours to study part time. I received an offer from a cooking school, and they told me to attend class at 6 PM.\n\nFirst, I hope you can change my night shift. The class is from 6 to 9 PM, so I need time to prepare my study things and go to campus by bus. After class, I also need to complete my homework. This will not affect my work in the morning because I can still work hard.\n\nSecond, when I finish the course, I can bring some benefit to our restaurant. For example, we can change the menu, not all of it, but add new dishes for customers. I think this will improve our performance. I hope you can consider my request and I look forward to your feedback.\n\nYours,\nKevin`,
  frozenScore: { overallBand: 4.5 },
  currentResult: { task: "Task 1", overallBand: 4.5 },
  verifyGeneratedScores: true
};

async function run() {
  console.log("Endpoint:", endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  console.log("Status:", response.status);
  console.log("ok:", data.ok);
  console.log("generatorVersion:", data.generatorVersion);
  console.log("currentBand:", data.currentBand);
  console.log("verification summary:", data.verification && data.verification.summary);
  for (const key of ["modelAnswer", "revisionPlus05", "revisionPlus10"]) {
    const item = data[key] || {};
    console.log(key, {
      targetBand: item.targetBand,
      verifiedBand: item.verification && item.verification.verifiedBand,
      status: item.verification && item.verification.status,
      rewriteAttempted: Boolean(item.rewriteAttempted),
      hasEssay: Boolean(item.essay)
    });
  }

  if (!response.ok || !data.ok) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
