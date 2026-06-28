const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const TEMPLATE_REFERENCE_VERSION = "template-reference-v1-fixed-template-ai-slot-review-final-grammar-polish-simple-gra5-v7";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_TEMPLATE_REFERENCE_TIMEOUT_MS) || 120000, 240000));
const DISCLAIMER = "This is AI-generated practice writing, not an official IELTS answer.";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.includes("ielts-gt-writing-hub") && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://790423127-cloud.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  };
}

function sendJson(req, res, statusCode, payload) {
  Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function clipText(text, maxChars) {
  const value = String(text || "").trim();
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response");
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(raw.slice(first, last + 1));
  }
  throw new Error("AI did not return valid JSON");
}

function normalizeTask(body = {}) {
  const raw = String(body.task || body.taskType || body.selectedTask || body.writingTask || "").toLowerCase();
  if (/task\s*1|task1|letter|gt\s*letter/.test(raw)) return "Task 1";
  if (/task\s*2|task2|essay/.test(raw)) return "Task 2";
  return /letter|dear|yours faithfully|write a letter/i.test(String(body.questionPrompt || body.prompt || "")) ? "Task 1" : "Task 2";
}

function normalizeBody(rawBody = {}) {
  const body = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};
  body.task = normalizeTask(body);
  body.questionPrompt = String(body.questionPrompt || body.prompt || body.promptText || "");
  body.questionTitle = String(body.questionTitle || body.title || "");
  body.essay = String(body.essay || "");
  body.type = String(body.type || body.questionType || "");
  body.letterStyle = String(body.letterStyle || body.style || "");
  body.targetBand = Number.isFinite(Number(body.targetBand)) ? Number(body.targetBand) : 5.5;
  return body;
}

function inferTask1Template(body = {}) {
  const style = String(body.letterStyle || "").toLowerCase();
  const prompt = String(body.questionPrompt || "").toLowerCase();
  if (/semi/.test(style)) return "task1-semi-formal";
  if (/informal/.test(style)) return "task1-informal";
  if (/formal/.test(style)) return "task1-formal";
  if (/close friend|college friend|your friend|a friend\b|friend visiting/.test(prompt)) return "task1-informal";
  if (/colleague|neighbour|neighbor|landlord|organiser|organizer|friend's sister|course organiser/.test(prompt)) return "task1-semi-formal";
  return "task1-formal";
}

function inferTask2Template(body = {}) {
  const type = String(body.type || "").toLowerCase();
  const prompt = String(body.questionPrompt || "").toLowerCase();
  if (/problem|solution|two-part|two part|reason/.test(type)) return "task2-reasons-results-solutions";
  if (/why|reason|problem|solution|what can be done|positive or negative development/.test(prompt)) return "task2-reasons-results-solutions";
  return "task2-opinion-judgement";
}

function templateIdForBody(body = {}) {
  return body.task === "Task 1" ? inferTask1Template(body) : inferTask2Template(body);
}

function stripLead(text, patterns = []) {
  let value = String(text || "").trim();
  for (let guard = 0; guard < 3; guard += 1) {
    const before = value;
    for (const pattern of patterns) value = value.replace(pattern, "").trim();
    if (value === before) break;
  }
  return value;
}

function normalizeRecipientName(value, templateId) {
  let text = stripLead(value, [/^dear\s+/i]).replace(/\s+/g, " ").trim();
  text = text.replace(/^(the|a|an)\s+/i, "").trim();
  if (!text) return templateId === "task1-informal" ? "Tom" : "Sir or Madam";
  if (templateId === "task1-formal" && /^(manager|owner|director|customer service|admissions office|transport company|company|council|coordinator|office|department)\b/i.test(text)) {
    return "Sir or Madam";
  }
  if (templateId === "task1-semi-formal" && /^(your\s+)?(friend'?s sister|sister|neighbour|neighbor|landlord|organiser|organizer|colleague)\b/i.test(text)) {
    return "Alex";
  }
  return text.slice(0, 40);
}

function normalizePurposeVerb(value, topic, templateId) {
  const text = String(value || "").toLowerCase();
  const topicText = String(topic || "").toLowerCase();
  if (/thank|helpful neighbour|helpful neighbor|kindness/.test(text) || /thank|helpful neighbour|helpful neighbor|kindness/.test(topicText)) return "thank you for";
  if (/complain/.test(text) || /noise|problem|service|delivery|damage/.test(topicText)) return "complain about";
  if (/apolog/.test(text) || /sorry|missing/.test(topicText)) return "apologise for";
  if (/apply/.test(text) || /application|assistant|volunteer/.test(topicText)) return "apply for";
  if (/invite/.test(text) || /invitation|event|celebration/.test(topicText)) return templateId === "task1-informal" ? "invite you to" : "invite you to";
  if (/ask|request|information|advice|course|experience/.test(text) || /information|advice|course|experience|rental|hours/.test(topicText)) return templateId === "task1-informal" ? "ask you about" : "ask about";
  if (/tell|share/.test(text)) return "tell you about";
  return templateId === "task1-informal" ? "tell you about" : "explain";
}

function normalizeTopicForPurpose(topic, purposeVerb) {
  let text = String(topic || "").trim();
  const verb = String(purposeVerb || "").trim().toLowerCase();
  if (/\b(about|for)$/.test(verb)) text = text.replace(/^(about|regarding|concerning)\s+/i, "").trim();
  if (/\bto$/.test(verb)) text = text.replace(/^to\s+/i, "").trim();
  return text || topic;
}

function formatTimePlace(value) {
  const text = String(value || "").trim();
  if (!text) return "around the most relevant time";
  if (/^(in|on|at|during|every|last|next|this|that|after|before|from)\b/i.test(text)) return text;
  return `around ${text}`;
}

const BAND5_WORD_SWAPS = [
  [/\blocal residents\b/gi, "local people"],
  [/\bsoundproofing materials?\b/gi, "better noise control"],
  [/\bsoundproof materials?\b/gi, "better noise control"],
  [/\bsoundproof material\b/gi, "better noise control"],
  [/\bsoundproofing\b/gi, "noise control"],
  [/\bsoundproof\b/gi, "noise control"],
  [/\bdisturbing\b/gi, "bothering"],
  [/\bdisturb\b/gi, "bother"],
  [/\bconstant\b/gi, "continuous"],
  [/\bensure\b/gi, "make sure"],
  [/\binconvenient\b/gi, "a problem"],
  [/\bconvenient\b/gi, "easy"],
  [/\bappreciate\b/gi, "thank you for"],
  [/\bresidents\b/gi, "local people"],
  [/\bresident\b/gi, "local person"],
  [/\bapproximately\b/gi, "about"],
  [/\btherefore\b/gi, "so"],
  [/\bbeneficiary\b/gi, "people"],
  [/\bcommunities\b/gi, "local areas"],
  [/\brealistic\b/gi, "real"],
  [/\bpractical\b/gi, "useful"],
  [/\bflexibility\b/gi, "more choice"],
  [/\bfinancial\b/gi, "money"],
  [/\benvironmental\b/gi, "about the environment"],
  [/\bnegative development\b/gi, "bad change"],
  [/\bpositive development\b/gi, "good change"]
];

function applyBand5Vocabulary(value) {
  let text = String(value || "");
  for (const [pattern, replacement] of BAND5_WORD_SWAPS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

function startsWithFiniteVerb(text) {
  return /^(cannot|can|need|needs|have|has|will|would|should|may|might|want|wants|feel|feels|make|makes|cause|causes|create|creates|help|helps|bother|bothers)\b/i.test(String(text || "").trim());
}

function capitaliseSentence(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function makePeopleClause(value) {
  let text = String(value || "").trim();
  text = stripLead(text, [/^(some people\s+)/i, /^(other people\s+)/i, /^(others\s+)/i]);
  if (/^(like|prefer|want|choose|need|try|keep|use|buy|work|study|pay|think|believe)\b/i.test(text)) {
    text = `people ${text}`;
  }
  return text;
}

function makeWhetherClause(value) {
  const text = String(value || "").trim();
  if (/^(come|visit|meet|join|help|swap|change|send|reply|call|tell|let|give)\b/i.test(text)) return `you can ${text}`;
  return text;
}

function cleanSlotByKey(key, value) {
  const commonLead = [
    /^(for example,?\s*)/i,
    /^(as a result,?\s*)/i,
    /^(this means that\s*)/i,
    /^(this is because\s*)/i,
    /^because\b[,\s]*/i,
    /^and\b[,\s]*/i,
    /^so\b[,\s]*/i,
    /^(one\s+(main|major|important)\s+(reason|problem|point|reason\/problem)\s+is\s+that\s*)/i,
    /^(another\s+(reason|problem|point|reason\/problem)\s+is\s+that\s*)/i,
    /^(the\s+first\s+(reason|problem|point|reason\/problem)\s+is\s+that\s*)/i
  ];
  let text = stripLead(value, commonLead);
  text = text
    .replace(/\bpositive\/negative\s*\/?\s*/gi, "")
    .replace(/\bbetter\/worse\b/gi, "more difficult")
    .replace(/\breason\/problem\b/gi, "point")
    .replace(/\s+/g, " ")
    .trim();
  text = applyBand5Vocabulary(text);
  if (/^(nextStep|requestOrPlan|requestedAction|bullet3Action|bullet3Answer|offerHelp|sharedAction)$/i.test(key)) {
    text = stripLead(text, [
      /^(please\s+)/i,
      /^(could you please\s+)/i,
      /^(can you please\s+)/i,
      /^(i would like to\s+)/i,
      /^(i would be happy to\s+)/i,
      /^(i hope (we can|to)\s+)/i,
      /^(i can\s+)/i,
      /^(i will\s+)/i,
      /^(i would\s+)/i,
      /^(i'll\s+)/i,
      /^(we could\s+)/i,
      /^(let me know (if|whether)\s+)/i,
      /^(please let me know (if|whether)\s+)/i
    ]);
    if (/^(there\s+(is|are)|the\s+(problem|issue)|a\s+(problem|solution)|this\s+(problem|issue)|i\s+(want|hope|need)\s+)/i.test(text)) {
      const actionFallbacks = {
        nextStep: "you are available this week",
        requestOrPlan: "you are free this weekend",
        requestedAction: "look into this matter and reply to me",
        bullet3Action: "ask for your help with this matter",
        bullet3Answer: "I hope we can choose a better time",
        offerHelp: "send you more details",
        sharedAction: "meet and talk about it"
      };
      text = actionFallbacks[key] || "take a simple practical action";
    }
  }
  if (/^(requestedAction)$/i.test(key)) {
    text = text
      .replace(/\s+(as soon as possible|as soon as convenient|soon)$/i, "")
      .trim();
  }
  if (/^(feelingOrDetail)$/i.test(key)) {
    text = stripLead(text, [/^(it was|it is|it will be)\s+/i]);
  }
  if (/^(openingReason)$/i.test(key) && /\b(sorry|apolog)/i.test(text)) {
    text = "I wanted to explain what happened";
  }
  if (/^(sideA|sideB)$/i.test(key)) {
    text = stripLead(text, [/^(some people think\s+)/i, /^(other people believe\s+)/i, /^(others believe\s+)/i]);
    text = makePeopleClause(text);
  }
  if (/^(opinion|yourSide)$/i.test(key)) {
    text = stripLead(text, [/^(i think\s+)/i, /^(i believe\s+)/i, /^(i agree that\s+)/i, /^(i prefer\s+)/i]);
  }
  if (/^(situation|extraCondition)$/i.test(key)) {
    text = stripLead(text, [/^(when\s+)/i, /^(if\s+)/i]);
  }
  if (/^(situation)$/i.test(key)) {
    text = stripLead(text, [/^(people\s+)/i]);
  }
  if (/^(result|result1)$/i.test(key)) {
    text = stripLead(text, [/^(they may\s+)/i, /^(people may\s+)/i, /^(they\s+)/i, /^(people\s+)/i, /^(this leads to\s+)/i, /^(this can lead to\s+)/i]);
  }
  if (/^(explanation1|explanation2)$/i.test(key)) {
    text = stripLead(text, [/^(this shows that\s+)/i, /^(this\s+)/i]);
  }
  if (/^(summaryPoint1|summaryPoint2)$/i.test(key)) {
    text = stripLead(text, [/^(the main reasons? (is|are)\s+)/i, /^(the results? (is|are)\s+)/i]);
  }
  if (/^(solutionOrAction|finalSolution)$/i.test(key)) {
    text = stripLead(text, [/^(people should\s+)/i, /^(we should\s+)/i, /^(governments should\s+)/i]);
  }
  if (/^(bullet1Reason|bullet1Extra|bullet2Impact|benefitOrResult|explanation1|explanation2|mainReason|summaryPoint1|summaryPoint2)$/i.test(key) && startsWithFiniteVerb(text)) {
    text = `they ${text}`;
  }
  if (/^(summaryPoint1|summaryPoint2)$/i.test(key)) {
    text = text
      .replace(/^they\s+(makes|causes|creates|helps|affects)\b/i, "it $1")
      .replace(/^they\s+make\b/i, "it makes")
      .replace(/^they\s+cause\b/i, "it causes")
      .replace(/^they\s+create\b/i, "it creates")
      .replace(/^they\s+help\b/i, "it helps")
      .replace(/^they\s+affect\b/i, "it affects");
  }
  if (/^(requestedAction)$/i.test(key)) {
    text = text.replace(/^finish music\b/i, "finish the music");
  }
  if (/^(nextStep)$/i.test(key)) {
    text = makeWhetherClause(text);
  }
  if (/^(feelingOrDetail)$/i.test(key)) {
    text = capitaliseSentence(text);
  }
  if (/^(overallJudgement)$/i.test(key)) {
    text = stripLead(text, [/^(i think\s+)/i, /^(i believe\s+)/i, /^(it is mostly\s+)/i]);
    if (!text || /^(this problem can be solved|this issue can be solved)$/i.test(text)) {
      text = "this issue can be reduced with careful action";
    }
  }
  const sentenceStartSlots = /^(feelingOrDetail)$/i;
  if (!sentenceStartSlots.test(key) && !/^(recipientName|friendName)$/i.test(key) && /^[A-Z][a-z]/.test(text) && !/^I\b/.test(text)) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }
  return applyBand5Vocabulary(text);
}

const TEMPLATE_SPECS = {
  "task1-formal": {
    name: "Task 1 Formal fixed template",
    task: "Task 1",
    targetWords: "format-first; 150+ when possible",
    requiredSlots: [
      "recipientName", "purposeVerb", "topic", "background", "bullet1Answer", "timePlace",
      "bullet1Reason", "bullet1Extra", "bullet2Answer", "bullet2Example", "affectedGroup",
      "bullet2Impact", "bullet3Action", "requestedAction"
    ],
    compose(slots) {
      const recipient = slots.recipientName || "Sir or Madam";
      const timePlace = formatTimePlace(slots.timePlace);
      return [
        `Dear ${recipient},`,
        "",
        `I am writing to ${slots.purposeVerb} ${slots.topic}. The reason is that ${slots.background}. Although this may seem like a small matter, it affects my daily life.`,
        "",
        `First of all, ${slots.bullet1Answer}. This usually happens ${timePlace}, and this is a problem because ${slots.bullet1Reason}. In my opinion, this point needs attention because ${slots.bullet1Extra}.`,
        "",
        `In addition, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}. This has affected ${slots.affectedGroup}. The main result is that ${slots.bullet2Impact}, which is a real problem.`,
        "",
        `Finally, I think the best solution is for your team to ${slots.bullet3Action}. If possible, please ${slots.requestedAction} when you can. I believe this would be fair and helpful, and it would help me avoid the same problem in the future.`,
        "",
        recipient === "Sir or Madam" ? "Yours faithfully," : "Yours sincerely,",
        "John Smith"
      ].join("\n");
    }
  },
  "task1-semi-formal": {
    name: "Task 1 Semi-formal fixed template",
    task: "Task 1",
    targetWords: "format-first; 150+ when possible",
    requiredSlots: [
      "recipientName", "purposeVerb", "topic", "situation", "bullet1Answer", "bullet1Reason",
      "extraExplanation", "bullet2Answer", "bullet2Example", "benefitOrResult",
      "bullet3Answer", "nextStep", "offerHelp"
    ],
    compose(slots) {
      return [
        `Dear ${slots.recipientName || "[Name]"},`,
        "",
        `I hope you are well. I am writing to ${slots.purposeVerb} ${slots.topic}. Although this matter may seem small, it is important to me.`,
        "",
        `First, ${slots.bullet1Answer}. This is because ${slots.bullet1Reason}. I know this may be a small problem, but ${slots.extraExplanation}. This detail is important because it helps both of us understand the situation.`,
        "",
        `Also, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}. This would help because ${slots.benefitOrResult}, which means a lot to me.`,
        "",
        `Finally, I would like to ${slots.bullet3Answer}. Please let me know whether ${slots.nextStep}. I would be happy to ${slots.offerHelp} if needed, and thank you for understanding this situation.`,
        "",
        "Kind regards,",
        "John Smith"
      ].join("\n");
    }
  },
  "task1-informal": {
    name: "Task 1 Informal fixed template",
    task: "Task 1",
    targetWords: "format-first; 150+ when possible",
    requiredSlots: [
      "friendName", "purposeVerb", "topic", "openingReason", "bullet1Answer", "feelingOrDetail",
      "personalReason", "bullet2Answer", "bullet2Example", "feelingWord", "bullet3Answer",
      "requestOrPlan", "sharedAction"
    ],
    compose(slots) {
      return [
        `Hi ${slots.friendName || "[Name]"},`,
        "",
        `I hope you are well. I am writing to ${slots.purposeVerb} ${slots.topic}. I have been meaning to write to you about this for a while because ${slots.openingReason}. Although this is a simple message, I wanted to tell you clearly because I value our friendship.`,
        "",
        `First, ${slots.bullet1Answer}. ${slots.feelingOrDetail}. I think you would understand this because ${slots.personalReason}.`,
        "",
        `Also, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}, which is why I feel ${slots.feelingWord} about it.`,
        "",
        `Finally, ${slots.bullet3Answer}. Please let me know if ${slots.requestOrPlan}. It would be great if we could ${slots.sharedAction} soon, and I hope we can enjoy a relaxed time together.`,
        "",
        "Best wishes,",
        "John"
      ].join("\n");
    }
  },
  "task2-opinion-judgement": {
    name: "Task 2 Template 1: Opinion judgement",
    task: "Task 2",
    targetWords: "format-first; 250+ when possible",
    requiredSlots: [
      "topic", "sideA", "sideB", "opinion", "reason1", "reason2", "example1",
      "explanation1", "yourSide", "situation", "result", "extraCondition",
      "finalComparison", "oppositeSide", "mainReason", "beneficiary"
    ],
    compose(slots) {
      return [
        `Many people have different opinions about ${slots.topic}. One view is that ${slots.sideA}. Another view is that ${slots.sideB}. In my opinion, ${slots.opinion}. I hold this view mainly because ${slots.mainReason}. This question is important because it can affect normal choices in study, work, and family life.`,
        "",
        `On the one hand, the first view can be reasonable because ${slots.reason1}. For example, ${slots.example1}. This shows that ${slots.explanation1}. Therefore, it is easy to understand why some people support this idea.`,
        "",
        `On the other hand, the second view can also be reasonable because ${slots.reason2}. For example, this can help people when ${slots.extraCondition}. Therefore, this view is understandable for many people.`,
        "",
        `In conclusion, although the opposite view may have some value, I think ${slots.opinion} because ${slots.mainReason}. In the long term, this choice is more useful for ${slots.beneficiary}, especially when people make decisions in study, work, or family life. This is why people should think carefully before making a choice.`
      ].join("\n");
    }
  },
  "task2-reasons-results-solutions": {
    name: "Task 2 Template 2: Reasons/results/solutions",
    task: "Task 2",
    targetWords: "format-first; 250+ when possible",
    requiredSlots: [
      "topic", "overallJudgement", "affectedArea", "point1", "explanation1", "example1",
      "result1", "point2", "result2", "explanation2", "solutionOrAction",
      "summaryPoint1", "summaryPoint2", "finalSolution"
    ],
    compose(slots) {
      return [
        `Nowadays, ${slots.topic} is becoming common. There are two main points to consider, and I think ${slots.overallJudgement}. This issue is important because it can affect ${slots.affectedArea}. It also shows how daily habits can create bigger problems over time. For this reason, it is useful to look at the causes and possible answers.`,
        "",
        `The first point is that ${slots.point1}. This means that ${slots.explanation1}. For example, ${slots.example1}. As a result, people may ${slots.result1}, which can make daily life more difficult and create extra pressure for families or local areas.`,
        "",
        `Another point is that ${slots.point2}. As a result, ${slots.result2}. This can affect people because ${slots.explanation2}. A useful way to deal with this is to ${slots.solutionOrAction}. This simple habit can help people sleep more easily and feel better the next day.`,
        "",
        `In conclusion, ${slots.topic} can create problems because ${slots.summaryPoint1} and ${slots.summaryPoint2}. I believe ${slots.overallJudgement}, and it can be improved if people ${slots.finalSolution}. If people take this seriously, the situation will become easier to manage, and the result will be better for families and workplaces. Small changes in daily choices can make a clear difference.`
      ].join("\n");
    }
  }
};

function sanitizeSlotValue(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.replace(/[{}[\]<>]/g, "").replace(/[.!?;:，。！？；：]+$/g, "").slice(0, 220);
}

function normalizeSlots(rawSlots = {}, spec, body) {
  const topicFallback = body.questionTitle || "this topic";
  const slots = spec.requiredSlots.reduce((acc, key) => {
    let fallback = key.toLowerCase().includes("topic") ? topicFallback : "a clear point related to the question";
    if (/recipient/i.test(key)) fallback = "Sir or Madam";
    if (/friendName/i.test(key)) fallback = "Tom";
    if (/purposeVerb/i.test(key)) fallback = body.task === "Task 1" ? "explain" : "discuss";
    acc[key] = cleanSlotByKey(key, sanitizeSlotValue(rawSlots[key], fallback));
    return acc;
  }, {});
  if (spec.requiredSlots.includes("recipientName")) slots.recipientName = normalizeRecipientName(slots.recipientName, templateIdForBody(body));
  if (spec.requiredSlots.includes("friendName")) slots.friendName = normalizeRecipientName(slots.friendName, "task1-informal");
  if (spec.requiredSlots.includes("purposeVerb")) slots.purposeVerb = normalizePurposeVerb(slots.purposeVerb, `${slots.topic} ${body.questionTitle} ${body.type} ${body.questionPrompt}`, templateIdForBody(body));
  if (spec.requiredSlots.includes("topic")) slots.topic = normalizeTopicForPurpose(slots.topic, slots.purposeVerb);
  return slots;
}

function slotInstruction(spec) {
  return spec.requiredSlots.map((slot) => `"${slot}": "..."`).join(",\n");
}

function buildPrompt(body, spec, templateId) {
  return [
    "You are an IELTS General Training Writing tutor for a Chinese learner aiming for Band 5.0-5.5.",
    "CRITICAL: Do NOT write a full essay or letter. Do NOT change the template structure. Only fill the requested slots.",
    "The server will compose the final answer using a fixed template. Your job is only to provide short slot values that fit grammatically into the fixed lines.",
    "Use very simple, learnable Band 5.0-5.5 language. Prefer common words that a lower-intermediate learner can copy in an exam.",
    "Keep grammar safe: use short subject + verb phrases. Avoid long noun phrases and avoid complex clauses inside slots.",
    "Avoid difficult words when a simple word works. Prefer: local people, problem, help, make sure, buy, use, work, study, money, time, noise, health, family, school, company.",
    "Do not use difficult or formal words such as soundproofing, disturbance, inconvenient, significant, considerable, facilitate, implement, utilise, residents, constant, ensure, consequently, nevertheless.",
    "Preserve the student's main position, scenario, relationship, request, reasons, and examples when the student essay provides them. If missing, infer modest prompt-related details.",
    body.task === "Task 1"
      ? "Each slot should normally contain 4-10 English words. Do not force the letter longer just to reach 150 words."
      : "Each slot should normally contain 6-14 English words. Do not force the essay longer just to reach 250 words.",
    "Each slot must be one phrase or one simple sentence fragment that fits inside the fixed line. No numbering, no markdown, no paragraph text inside a slot.",
    "Do not end slot values with a full stop, question mark, exclamation mark, colon, or semicolon because the server template adds punctuation.",
    "Do not repeat template lead-in words inside slots. Avoid: Dear, For example, As a result, This means that, Please let me know if, I would be happy to, I would like to, The first reason/problem is that.",
    "Do not use slash choices such as positive/negative, better/worse, reason/problem, happened/will happen, or is/will be. Choose one natural phrase.",
    "For recipientName or friendName, return only a simple name or 'Sir or Madam'. Do not return roles such as 'the manager', 'the owner', or 'the organiser'.",
    "For purposeVerb, return only a short verb phrase such as 'complain about', 'ask about', 'thank you for', 'apologise for', 'invite you to', or 'apply for'.",
    "For action slots after 'please', 'the best solution is to', 'I would be happy to', or 'we could', return an action phrase, not a full sentence.",
    "For situation slots after 'If people', do not start with 'when' or 'if'. For result slots after 'they may' or 'people may', do not start with 'they may', 'people may', or 'this leads to'.",
    "For sideA and sideB, do not start with 'some people think' or 'others believe'. For opinion and yourSide, do not start with 'I think', 'I believe', 'I agree', or 'I prefer'.",
    "For Task 2 opinion templates, reason1 must support sideA, and reason2/situation/result/extraCondition/finalComparison must support sideB. The conclusion opinion and mainReason must support the student's final opinion.",
    "For Task 2 opinion templates, body paragraph 1 and body paragraph 2 must discuss different sides. Do not make both body paragraphs support the same side.",
    "For Task 2 problem/solution templates, summaryPoint1 and summaryPoint2 must fit after 'because'. Prefer simple clauses such as 'it makes people tired' or 'it can harm health'.",
    "For overallJudgement, make it fit after 'I think'. Do not start with 'I think' or include slash alternatives.",
    `Task: ${body.task}`,
    `Selected fixed template: ${templateId} - ${spec.name}`,
    `Target word range after server composition: ${spec.targetWords}`,
    `Question title: ${body.questionTitle || "(none)"}`,
    `Question prompt:\n${clipText(body.questionPrompt, 3000)}`,
    body.essay ? `Student essay for content reference:\n${clipText(body.essay, 5000)}` : "Student essay: (not provided)",
    "Return strict JSON only with exactly this shape:",
    JSON.stringify({
      ok: true,
      filledSlots: JSON.parse(`{${slotInstruction(spec)}}`),
      slotNotesZh: ["..."],
      memorisableSentences: ["..."]
    }, null, 2)
  ].join("\n\n");
}

function buildSlotReviewPrompt(body, spec, templateId, filledSlots, referenceEssay) {
  return [
    "You are checking IELTS Band 5.0-5.5 fixed-template writing for grammar safety.",
    "CRITICAL: Do not write a new essay. Do not change the template. Only improve slot values.",
    "The final essay below was composed by a fixed server template from the filled slots.",
    "Your job is to identify slot values that cause grammar errors, repeated words, awkward joins, or too-difficult vocabulary.",
    "Return the same filledSlots object with improved values. Keep every required slot key. Do not add new keys.",
    "Use simple Band 5 words and safe grammar. Prefer short subject + verb phrases.",
    "Fix these common problems if present: missing subject after because, repeated I/we/people, 'Some people think like', 'Please let me know whether come', 'I would be happy to I will', 'This shows that this', difficult vocabulary.",
    "For Task 2 opinion templates, check that body paragraph 1 discusses sideA and body paragraph 2 discusses sideB. Then check that the conclusion gives one clear final opinion.",
    "For Task 2 problem/solution templates, check that summaryPoint1 and summaryPoint2 are simple clauses that fit after 'because', such as 'it makes people tired' or 'it can harm health'.",
    "Do not use difficult or formal words such as soundproofing, disturbance, inconvenient, significant, considerable, facilitate, implement, utilise, residents, constant, ensure, consequently, nevertheless.",
    "Do not put template lead-in words inside slots. Do not return a full paragraph inside any slot.",
    `Task: ${body.task}`,
    `Selected fixed template: ${templateId} - ${spec.name}`,
    `Question title: ${body.questionTitle || "(none)"}`,
    `Question prompt:\n${clipText(body.questionPrompt, 3000)}`,
    `Current filled slots:\n${JSON.stringify(filledSlots, null, 2)}`,
    `Composed essay to audit:\n${clipText(referenceEssay, 6000)}`,
    "Return strict JSON only with exactly this shape:",
    JSON.stringify({
      ok: true,
      filledSlots: JSON.parse(`{${slotInstruction(spec)}}`),
      grammarRiskFixed: true,
      auditNotesZh: ["..."]
    }, null, 2)
  ].join("\n\n");
}

function buildFinalGrammarPolishPrompt(body, spec, templateId, referenceEssay) {
  return [
    "You are an IELTS General Training Band 5.0 template-format safety editor.",
    "You will receive a fixed-template practice answer. Keep the same task, same paragraph order, same letter/essay format, and simple Band 5 style.",
    "You may rewrite sentences inside the same paragraph when needed, but do not change the paragraph purpose or remove required task points.",
    "Delete repeated words, add missing subjects or small grammar words, fix verb tense, fix pronouns, and split or join short sentences if needed.",
    "Do not rewrite the answer into a high-band essay. Do not chase a score by adding unrelated content. Do not add filler just to reach 150 or 250 words.",
    "The goal is a stable memorisable template: clear format, complete basic meaning, Grammar 5.0 safety, and words a Band 5 learner can copy.",
    "Grammar 5.0 safety means: most basic sentences have clear subjects and verbs; verb tense is mostly correct; there are a few safe complex sentences, but no broken sentence parts.",
    "Before returning, silently audit the answer against IELTS criteria. Do not return an answer that would be described as simple_forms, frequent_errors, repetitive, noticeable_errors, mechanical_links, or limited_progression.",
    "If the grammar would be only 4.5 because it is too simple, revise it to Band 5.0 by adding controlled clauses with because, although, when, if, and which. Check articles, plurals, verb forms, and punctuation after revising.",
    "If the vocabulary would be only 4.5 because it is repetitive, replace repeated basic words with simple topic collocations. Keep the words common and exam-safe.",
    "Use common but not childish topic words. Prefer clear words like local people, sleep, health, money, work, study, noise, rules, manager, meeting, family, problem, solution, useful, important.",
    "Keep vocabulary simple, but make it precise. Use everyday collocations such as loud noise, sleep properly, concentrate at work, daily routine, feel under pressure, reduce the noise, solve the problem, keep in touch, make a plan, and learn from experience.",
    "Do not overuse vague words such as good, bad, important, problem, people, thing, and way. Replace some of them with simple precise words from the topic.",
    "Do not start many sentences with 'This'. Use simple noun phrases instead, such as this noise, this habit, this choice, the main problem, the second reason, or the best answer.",
    "Avoid visibly mechanical template phrases when a simple natural sentence works better, such as 'This question is important because', 'This is why people should think carefully', 'which is a real problem', and 'fair and helpful'.",
    "Do not use advanced words just to raise Lexical Resource.",
    "Keep sentences short and accurate, but do not leave the whole answer as only very short simple sentences.",
    "For Grammar 5.0, include at least three safe grammar patterns in the full answer: one because sentence, one if/when sentence, and one although/which sentence.",
    "Target Grammar 5.0, not 4.5: each body paragraph should include one controlled complex sentence, but the sentence must still be easy to copy.",
    body.task === "Task 1"
      ? "For Task 1, keep the answer around 150-170 words when natural. If it is under 145 words, add one short useful detail, not filler."
      : "For Task 2, keep the answer around 250-280 words when natural. If it is under 245 words, add one short useful explanation, not filler.",
    "These grammar patterns must use simple words. Example level: 'Although this is a small problem, it affects my daily life.' / 'This can help people, which is useful for families.'",
    "If grammar is too simple, combine two existing short ideas with because, when, if, although, or which. Do not add a new idea just to make the answer longer.",
    "Avoid sentence fragments like 'This is because I was tired.' when it follows another very short sentence; combine it into one clear sentence when possible.",
    "Avoid comma-splice patterns. Do not write: 'This is especially true when..., they may...' Instead write: 'When..., they may...' or 'This is especially true because...'.",
    "Avoid broken relative clauses. Do not write: 'for people who try new things often have more fun'. Instead write: 'for people who try new things often' or 'because people can have more fun'.",
    "If a sentence contains 'which', make sure it clearly refers to the idea before it and has a complete verb.",
    "Avoid repeating the same phrase many times, such as this problem, this issue, people, important, good, bad, or I think.",
    "Do not repeat the same action in two sentences in a row. If the solution sentence and request sentence are the same, make the first one general and the second one specific.",
    "Check logic as well as grammar: in a Task 2 discuss-both-views answer, paragraph 2 should discuss one side and paragraph 3 should discuss the other side. The conclusion should state the final opinion clearly.",
    "In the second body paragraph of a discuss-both-views essay, explain why the second view is reasonable. Do not attack the second view in that paragraph.",
    "For problem/solution essays, do not write that a problem 'happens because' of its result. Say it 'can create problems because' the result is harmful.",
    "If the essay is under the official IELTS word count, do not force it longer. Only add words when they are needed to repair grammar or complete a template sentence.",
    "Fix problems like: 'because cannot', 'whether you can let me know', 'for everyone can enjoy', repeated because, repeated people, wrong subject, missing capital letter.",
    "Fix unnatural simple sentences: change 'I am sorry because...' to 'I am sorry that...'; change 'Because of this, they did not die' to 'Because of this, they stayed healthy'; change singular 'it' to plural 'they' when the subject is plural.",
    "For Task 2, make sure the final paragraph does not introduce a new or opposite opinion. It should repeat the same opinion in simpler words.",
    "Keep Task 1 letters as letters with greeting and sign-off. Keep Task 2 as four paragraphs.",
    `Task: ${body.task}`,
    `Selected fixed template: ${templateId} - ${spec.name}`,
    `Question title: ${body.questionTitle || "(none)"}`,
    `Question prompt:\n${clipText(body.questionPrompt, 3000)}`,
    `Essay to polish:\n${clipText(referenceEssay, 7000)}`,
    "Return strict JSON only with exactly this shape:",
    JSON.stringify({
      ok: true,
      referenceEssay: "...",
      grammarPolishNotesZh: ["..."]
    }, null, 2)
  ].join("\n\n");
}

function safePolishedEssay(value, fallback, task) {
  let text = String(value || "").trim();
  if (!text) return fallback;
  text = text
    .replace(/This is especially true when ([^.!?]{5,90}),\s*they may\s+/gi, "When $1, they may ")
    .replace(/This is especially true when ([^.!?]{5,90}),\s*they\s+/gi, "When $1, they ")
    .replace(/\bI am sorry because\b/gi, "I am sorry that")
    .replace(/I have been meaning to write to you about this for a while because I am sorry [^.]*\./gi, "I wanted to write sooner because I did not want you to feel upset.")
    .replace(/\bBecause of this, they did not die\b/gi, "Because of this, they stayed healthy")
    .replace(/\b(baby|child|neighbour|neighbor|friend|student|teacher|manager|boss|colleague|person), which\b/gi, "$1, who")
    .replace(/\b(people|children|students|neighbours|neighbors|friends|workers), which\b/gi, "$1, who")
    .replace(/\bdifficulties getting enough sleep can create problems because it affects\b/gi, "difficulties getting enough sleep can create problems because they affect")
    .replace(/\bI would be happy to ([^.]{3,80})\. I would be happy to ([^.]{3,80})\./gi, "I would be happy to $1. I can also $2.")
    .replace(/the best solution is for your team to ([^.]{3,80})\. If possible, please \1\./gi, "the best solution is for your team to control the problem. If possible, please $1.")
    .replace(/\bPlease let me know if I can cook your favourite food\./gi, "Please let me know if you can come.")
    .replace(/\bThis can help one person and also other people\./gi, "This simple habit can help people sleep more easily and feel better the next day.")
    .replace(/for people who ([^,.!?]{3,80}) often have more fun/gi, "because people who $1 can often have more fun")
    .replace(/for everyone can enjoy life more/gi, "because everyone can enjoy life more")
    .split(/\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
  if (countWords(text) < Math.max(90, Math.floor(countWords(fallback) * 0.65))) return fallback;
  if (task === "Task 1" && countWords(text) < 145 && countWords(fallback) >= 145) return fallback;
  if (task === "Task 2" && countWords(text) < 245 && countWords(fallback) >= 245) return fallback;
  if (!/[.!?]\s*\n\n|Yours|Best wishes|Kind regards|In conclusion/i.test(text)) return fallback;
  return text;
}

async function callDeepSeek(prompt, temperature = 0.25) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only one complete valid JSON object. No markdown, no code fences, no commentary outside JSON." },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message || text.slice(0, 300)}`);
    return extractJson(payload.choices?.[0]?.message?.content || "");
  } finally {
    clearTimeout(timeout);
  }
}

function buildTemplateReferenceResult(body, aiPayload = {}) {
  const templateId = templateIdForBody(body);
  const spec = TEMPLATE_SPECS[templateId];
  const filledSlots = normalizeSlots(aiPayload.filledSlots || {}, spec, body);
  const referenceEssay = spec.compose(filledSlots);
  return {
    ok: true,
    aiStage: "template-reference",
    version: TEMPLATE_REFERENCE_VERSION,
    disclaimer: DISCLAIMER,
    scoreUnaffected: true,
    task: body.task,
    questionTitle: body.questionTitle,
    templateId,
    templateUsed: spec.name,
    templateStructureLocked: true,
    aiOnlyFilledSlots: true,
    targetBand: body.targetBand,
    targetWordRange: spec.targetWords,
    wordCount: countWords(referenceEssay),
    referenceEssay,
    filledSlots,
    slotNotesZh: Array.isArray(aiPayload.slotNotesZh) ? aiPayload.slotNotesZh.slice(0, 6).map(String) : [],
    memorisableSentences: Array.isArray(aiPayload.memorisableSentences) ? aiPayload.memorisableSentences.slice(0, 8).map(String) : [],
    usage: {
      endpoint: "/api/template-reference",
      note: "The final text is composed by server-side fixed templates. The AI response is used only for slot filling."
    }
  };
}

async function generateTemplateReference(body) {
  const templateId = templateIdForBody(body);
  const spec = TEMPLATE_SPECS[templateId];
  const aiPayload = await callDeepSeek(buildPrompt(body, spec, templateId), 0.15);
  const firstPass = buildTemplateReferenceResult(body, aiPayload);
  const reviewPayload = await callDeepSeek(
    buildSlotReviewPrompt(body, spec, templateId, firstPass.filledSlots, firstPass.referenceEssay),
    0.05
  );
  const reviewed = buildTemplateReferenceResult(body, {
    ...aiPayload,
    filledSlots: reviewPayload.filledSlots || firstPass.filledSlots,
    slotNotesZh: Array.isArray(reviewPayload.auditNotesZh) ? reviewPayload.auditNotesZh : aiPayload.slotNotesZh,
    memorisableSentences: aiPayload.memorisableSentences
  });
  const polishPayload = await callDeepSeek(
    buildFinalGrammarPolishPrompt(body, spec, templateId, reviewed.referenceEssay),
    0.05
  );
  const polishedEssay = safePolishedEssay(polishPayload.referenceEssay, reviewed.referenceEssay, body.task);
  return {
    ...reviewed,
    referenceEssay: polishedEssay,
    wordCount: countWords(polishedEssay),
    aiSelfReviewedSlots: true,
    aiFinalGrammarPolish: true,
    aiSelfReviewNotesZh: Array.isArray(reviewPayload.auditNotesZh) ? reviewPayload.auditNotesZh.slice(0, 6).map(String) : [],
    aiFinalGrammarPolishNotesZh: Array.isArray(polishPayload.grammarPolishNotesZh) ? polishPayload.grammarPolishNotesZh.slice(0, 6).map(String) : [],
    firstPassWordCount: firstPass.wordCount
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const body = normalizeBody(await readJsonBody(req));
    if (!body.questionPrompt.trim()) {
      return sendJson(req, res, 400, { ok: false, error: "questionPrompt is required" });
    }
    const result = await generateTemplateReference(body);
    return sendJson(req, res, 200, result);
  } catch (error) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "Template reference generation failed",
      detail: String(error.message || error),
      system: "template-reference"
    });
  }
};

module.exports.config = { maxDuration: 300 };
module.exports._internals = {
  normalizeBody,
  templateIdForBody,
  buildTemplateReferenceResult,
  TEMPLATE_SPECS
};
