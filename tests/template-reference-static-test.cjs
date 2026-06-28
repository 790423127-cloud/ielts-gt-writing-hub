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
  assert.match(result.referenceEssay, /The first reason\/problem is that/);
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
  assert.strictEqual(result.scoreUnaffected, true);
}

console.log("PASS template-reference static test.");
