const assert = require("assert");
const templateReference = require("../api/template-reference.js");

const {
  normalizeBody,
  templateIdForBody,
  buildTemplateReferenceResult,
  TEMPLATE_SPECS
} = templateReference._internals;

function filledSlotsFor(templateId, topic = "this topic") {
  const spec = TEMPLATE_SPECS[templateId];
  return Object.fromEntries(spec.requiredSlots.map((key) => {
    if (key.toLowerCase().includes("topic")) return [key, topic];
    if (/recipient/i.test(key)) return [key, "Sir or Madam"];
    if (/friendName/i.test(key)) return [key, "Tom"];
    if (/purposeVerb/i.test(key)) return [key, "explain clearly about"];
    return [key, "one clear simple detail related to this question"];
  }));
}

{
  const body = normalizeBody({
    task: "Task 2",
    type: "problem/solution",
    questionTitle: "Buying Too Many Clothes",
    questionPrompt: "What are the reasons for this? How can people be persuaded to reduce the number of clothes they buy?",
    essay: "People buy too many clothes because of adverts. I think this is bad."
  });
  const templateId = templateIdForBody(body);
  assert.strictEqual(templateId, "task2-reasons-results-solutions");
  const result = buildTemplateReferenceResult(body, {
    filledSlots: filledSlotsFor(templateId, "buying too many clothes")
  });
  assert.strictEqual(result.templateStructureLocked, true);
  assert.strictEqual(result.aiOnlyFilledSlots, true);
  assert.match(result.referenceEssay, /^Nowadays, buying too many clothes is becoming common\./);
  assert.match(result.referenceEssay, /The first point is that/);
  assert.doesNotMatch(result.referenceEssay, /reason\/problem|better\/worse|positive\/negative|\[[^\]]+\]/i);
}

{
  const body = normalizeBody({
    task: "Task 1",
    letterStyle: "formal letter",
    questionTitle: "Noise from a Community Hall",
    questionPrompt: "Write a letter to the manager of a community hall about noise. Describe the problem, explain how it affects local people, and suggest action.",
    essay: "The music is loud and local people cannot sleep."
  });
  const templateId = templateIdForBody(body);
  assert.strictEqual(templateId, "task1-formal");
  const slots = filledSlotsFor(templateId, "the noise from the local hall");
  Object.assign(slots, {
    bullet2Impact: "cannot relax or sleep",
    bullet3Action: "install soundproofing materials",
    requestedAction: "ensure loud activities finish before 9 pm soon",
    affectedGroup: "residents"
  });
  const result = buildTemplateReferenceResult(body, { filledSlots: slots });
  assert.doesNotMatch(result.referenceEssay, /\bsoundproof|residents|ensure|as soon as convenient|I would like to install\b|local local people/i);
  assert.match(result.referenceEssay, /better noise control|make sure|local people/i);
  assert.match(result.referenceEssay, /The main result is that they cannot relax or sleep/i);
  assert.match(result.referenceEssay, /the best solution is for your team to/i);
}

{
  const body = normalizeBody({
    task: "Task 1",
    type: "thanks",
    letterStyle: "semi-formal letter",
    questionTitle: "Thanking a Helpful Neighbour",
    questionPrompt: "Write a letter to thank a neighbour who helped you.",
    essay: "My neighbour helped me."
  });
  const templateId = templateIdForBody(body);
  assert.strictEqual(templateId, "task1-semi-formal");
  const slots = filledSlotsFor(templateId, "helping me last week");
  Object.assign(slots, {
    purposeVerb: "complain about",
    bullet3Answer: "I hope we can choose a better time",
    nextStep: "come for dinner this Saturday"
  });
  const result = buildTemplateReferenceResult(body, { filledSlots: slots });
  assert.match(result.referenceEssay, /I am writing to thank you for helping me last week/i);
  assert.doesNotMatch(result.referenceEssay, /complain about helping|I would like to I hope|whether come/i);
}

{
  const body = normalizeBody({
    task: "Task 1",
    questionTitle: "Missing a Friend's Dinner",
    questionPrompt: "You need to write a letter to a close friend. In your letter: apologise for not coming, explain what happened, suggest a new time to meet.",
    essay: "I missed dinner because I was sick."
  });
  const templateId = templateIdForBody(body);
  assert.strictEqual(templateId, "task1-informal");
  const result = buildTemplateReferenceResult(body, {
    filledSlots: filledSlotsFor(templateId, "missing dinner")
  });
  assert.match(result.referenceEssay, /^Hi Tom,/);
  assert.match(result.referenceEssay, /Best wishes,/);
  assert.doesNotMatch(result.referenceEssay, /\[[^\]]+\]|It was \/ is \/ will be/i);
  assert.strictEqual(result.scoreUnaffected, true);
}

{
  const body = normalizeBody({
    task: "Task 2",
    type: "discussion",
    questionTitle: "Socialising with Work Colleagues",
    questionPrompt: "Some people think socialising with work colleagues is good, while others prefer to keep work and private life separate. Discuss both views and give your opinion.",
    essay: "Some people like socialising, but society also needs private time."
  });
  const templateId = templateIdForBody(body);
  assert.strictEqual(templateId, "task2-opinion-judgement");
  const slots = filledSlotsFor(templateId, "socialising with work colleagues");
  Object.assign(slots, {
    sideA: "some people think socialising with colleagues improves teamwork",
    sideB: "others believe people need private time after work",
    opinion: "I think socialising is useful if people keep balance",
    yourSide: "I believe socialising sometimes is helpful",
    situation: "when people spend all their free time with colleagues",
    result: "they may feel tired and lose family time",
    extraCondition: "if people do not set clear limits"
  });
  const result = buildTemplateReferenceResult(body, { filledSlots: slots });
  assert.match(result.referenceEssay, /socialising with work colleagues/);
  assert.doesNotMatch(result.referenceEssay, /\b(cialising|ciety|me people)\b/i);
  assert.doesNotMatch(result.referenceEssay, /If people when|they may they may|I believe I believe|In my opinion, I think/i);
}

{
  const body = normalizeBody({
    task: "Task 2",
    type: "discussion",
    questionTitle: "Trying New Things",
    questionPrompt: "Some people like to try new things. Others prefer familiar habits. Discuss both views and give your opinion.",
    essay: "Trying new things can be good."
  });
  const templateId = templateIdForBody(body);
  const slots = filledSlotsFor(templateId, "trying new things");
  Object.assign(slots, {
    sideA: "like to try new things such as new food",
    sideB: "prefer to keep doing familiar things",
    situation: "people always do the same things every day",
    result: "feel bored and miss new chances"
  });
  const result = buildTemplateReferenceResult(body, { filledSlots: slots });
  assert.doesNotMatch(result.referenceEssay, /Some people think like|others believe prefer|If people people/i);
  assert.match(result.referenceEssay, /One view is that people like/i);
  assert.match(result.referenceEssay, /Another view is that people prefer/i);
}

console.log("PASS template-reference static test.");
