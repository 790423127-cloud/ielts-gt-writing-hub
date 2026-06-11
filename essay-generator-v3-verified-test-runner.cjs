const generatorEndpoint = "https://ielts-gt-writing-hub.vercel.app/api/essay-generator";
const scoringEndpoint = "https://ielts-gt-writing-hub.vercel.app/api/grade-ielts-production-router";

const sample = {
  task: "Task 1",
  generationTask: "Task 1",
  questionType: "semi-formal letter",
  title: "Request to reduce working hours for a part-time course",
  questionPrompt: "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. In your letter: explain why you are writing, describe the change you want to your working hours, and explain how this change could benefit the restaurant.",
  essay: `Dear Mark,\n\nI am writing to ask if I can reduce my working hours to study part time. I received an offer from a cooking school, and they told me to attend class at 6 PM.\n\nFirst, I hope you can change my night shift. The class is from 6 to 9 PM, so I need time to prepare my study things and go to campus by bus. After class, I also need to complete my homework. This will not affect my work in the morning because I can still work hard.\n\nSecond, when I finish the course, I can bring some benefit to our restaurant. For example, we can change the menu, not all of it, but add new dishes for customers. I think this will improve our performance. I hope you can consider my request and I look forward to your feedback.\n\nYours,\nKevin`,
  frozenScore: { overallBand: 4.5 },
  currentResult: { task: "Task 1", overallBand: 4.5 },
  verifyGeneratedScores: false
};

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function extractBand(result = {}) {
  const candidates = [
    result.finalBand,
    result.overallBand,
    result.estimatedBand,
    result.score,
    result.band,
    result.scoreCalculation && result.scoreCalculation.finalBand,
    result.scoreCalculation && result.scoreCalculation.overallBand,
    result.visibleScore && result.visibleScore.finalBand,
    result.visibleScore && result.visibleScore.overallBand
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
  }
  return null;
}

function statusFor(verifiedBand, targetBand) {
  const verified = Number(verifiedBand);
  const target = Number(targetBand);
  if (!Number.isFinite(verified) || !Number.isFinite(target)) return "verification_unavailable";
  if (verified >= target) return "target_met";
  if (verified + 0.5 >= target) return "near_target";
  return "below_target";
}

async function postJson(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error([`HTTP ${response.status}`, data.error, data.detail, data.raw].filter(Boolean).join(" | "));
  return data;
}

async function verifyPart(data, key, essay, targetBand) {
  if (!essay) return { verifiedBand: null, status: "empty_essay" };
  const payload = {
    ...sample,
    essay,
    wordCount: countWords(essay),
    mode: "score",
    aiStage: "generated-answer-client-production-verification",
    generationVerification: true,
    generatedAnswerLabel: key,
    generatedTargetBand: targetBand,
    currentResult: null,
    frozenScore: null
  };
  try {
    const score = await postJson(scoringEndpoint, payload);
    const verifiedBand = extractBand(score);
    return {
      verifiedBand,
      status: statusFor(verifiedBand, targetBand),
      finalSource: score.finalSource,
      criteria: score.finalCriteria || score.criteria || null
    };
  } catch (error) {
    return { verifiedBand: null, status: "verification_failed", error: String(error.message || error).slice(0, 500) };
  }
}

async function run() {
  console.log("Generator endpoint:", generatorEndpoint);
  console.log("Scoring endpoint:", scoringEndpoint);

  const data = await postJson(generatorEndpoint, sample);
  console.log("generatorVersion:", data.generatorVersion);
  console.log("currentBand:", data.currentBand);

  for (const key of ["modelAnswer", "revisionPlus05", "revisionPlus10"]) {
    const part = data[key] || {};
    const verification = await verifyPart(data, key, part.essay, part.targetBand);
    console.log(key, {
      targetBand: part.targetBand,
      verifiedBand: verification.verifiedBand,
      status: verification.status,
      finalSource: verification.finalSource,
      hasEssay: Boolean(part.essay),
      error: verification.error || ""
    });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
