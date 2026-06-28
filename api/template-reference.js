const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const TEMPLATE_REFERENCE_VERSION = "template-reference-v1-fixed-structure-slots-only";
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
  if (/complain/.test(text) || /noise|problem|service|delivery|damage/.test(topicText)) return "complain about";
  if (/apolog/.test(text) || /sorry|missing/.test(topicText)) return "apologise for";
  if (/thank/.test(text)) return "thank you for";
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
  if (/^(nextStep|requestOrPlan|requestedAction|bullet3Action|bullet3Answer|offerHelp|sharedAction)$/i.test(key)) {
    text = stripLead(text, [
      /^(please\s+)/i,
      /^(could you please\s+)/i,
      /^(can you please\s+)/i,
      /^(i would like to\s+)/i,
      /^(i would be happy to\s+)/i,
      /^(i can\s+)/i,
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
  if (/^(feelingOrDetail)$/i.test(key)) {
    text = stripLead(text, [/^(it was|it is|it will be)\s+/i]);
  }
  if (/^(sideA|sideB)$/i.test(key)) {
    text = stripLead(text, [/^(some people think\s+)/i, /^(other people believe\s+)/i, /^(others believe\s+)/i]);
  }
  if (/^(opinion|yourSide)$/i.test(key)) {
    text = stripLead(text, [/^(i think\s+)/i, /^(i believe\s+)/i, /^(i agree that\s+)/i, /^(i prefer\s+)/i]);
  }
  if (/^(situation|extraCondition)$/i.test(key)) {
    text = stripLead(text, [/^(when\s+)/i, /^(if\s+)/i]);
  }
  if (/^(result|result1|result2)$/i.test(key)) {
    text = stripLead(text, [/^(they may\s+)/i, /^(people may\s+)/i, /^(this leads to\s+)/i, /^(this can lead to\s+)/i]);
  }
  if (/^(explanation1|explanation2)$/i.test(key)) {
    text = stripLead(text, [/^(this shows that\s+)/i]);
  }
  if (/^(overallJudgement)$/i.test(key)) {
    text = stripLead(text, [/^(i think\s+)/i, /^(i believe\s+)/i, /^(it is mostly\s+)/i]);
    if (!text || /^(this problem can be solved|this issue can be solved)$/i.test(text)) {
      text = "this issue can be reduced with careful action";
    }
  }
  if (!/^(recipientName|friendName)$/i.test(key) && /^[A-Z][a-z]/.test(text) && !/^I\b/.test(text)) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }
  return text;
}

const TEMPLATE_SPECS = {
  "task1-formal": {
    name: "Task 1 Formal fixed template",
    task: "Task 1",
    targetWords: "170-200",
    requiredSlots: [
      "recipientName", "purposeVerb", "topic", "background", "bullet1Answer", "timePlace",
      "bullet1Reason", "bullet1Extra", "bullet2Answer", "bullet2Example", "affectedGroup",
      "bullet2Impact", "bullet3Action", "requestedAction"
    ],
    compose(slots) {
      const recipient = slots.recipientName || "Sir or Madam";
      return [
        `Dear ${recipient},`,
        "",
        `I am writing to ${slots.purposeVerb} ${slots.topic}. I am doing this because ${slots.background}. I hope this letter explains the matter clearly and politely.`,
        "",
        `First of all, ${slots.bullet1Answer}. This usually happens around ${slots.timePlace}, and it has become important because ${slots.bullet1Reason}. In my opinion, this point needs attention because ${slots.bullet1Extra}.`,
        "",
        `In addition, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}. This has affected ${slots.affectedGroup} because ${slots.bullet2Impact}.`,
        "",
        `Finally, I would like to ${slots.bullet3Action}. If possible, please ${slots.requestedAction} as soon as convenient. I believe this would be a fair and helpful solution, and it would help me avoid the same difficulty in the future.`,
        "",
        recipient === "Sir or Madam" ? "Yours faithfully," : "Yours sincerely,",
        "John Smith"
      ].join("\n");
    }
  },
  "task1-semi-formal": {
    name: "Task 1 Semi-formal fixed template",
    task: "Task 1",
    targetWords: "170-200",
    requiredSlots: [
      "recipientName", "purposeVerb", "topic", "situation", "bullet1Answer", "bullet1Reason",
      "extraExplanation", "bullet2Answer", "bullet2Example", "benefitOrResult",
      "bullet3Answer", "nextStep", "offerHelp"
    ],
    compose(slots) {
      return [
        `Dear ${slots.recipientName || "[Name]"},`,
        "",
        `I hope you are well. I am writing to ${slots.purposeVerb} ${slots.topic}. I thought it would be best to explain the situation clearly, because this matter is important to me and I value your understanding.`,
        "",
        `First, ${slots.bullet1Answer}. This is because ${slots.bullet1Reason}. I know this may be a little inconvenient, but ${slots.extraExplanation}.`,
        "",
        `Also, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}. This would help because ${slots.benefitOrResult}.`,
        "",
        `Finally, ${slots.bullet3Answer}. Please let me know whether ${slots.nextStep}. I would be happy to ${slots.offerHelp} if needed, and I really appreciate your patience with this situation.`,
        "",
        "Kind regards,",
        "John Smith"
      ].join("\n");
    }
  },
  "task1-informal": {
    name: "Task 1 Informal fixed template",
    task: "Task 1",
    targetWords: "170-200",
    requiredSlots: [
      "friendName", "purposeVerb", "topic", "openingReason", "bullet1Answer", "feelingOrDetail",
      "personalReason", "bullet2Answer", "bullet2Example", "feelingWord", "bullet3Answer",
      "requestOrPlan", "sharedAction"
    ],
    compose(slots) {
      return [
        `Hi ${slots.friendName || "[Name]"},`,
        "",
        `I hope you are well. I am writing to ${slots.purposeVerb} ${slots.topic}. I have been meaning to write to you about this for a while because ${slots.openingReason}. I wanted to tell you clearly because I value our friendship.`,
        "",
        `First, ${slots.bullet1Answer}. ${slots.feelingOrDetail}. I think you would understand this because ${slots.personalReason}.`,
        "",
        `Also, ${slots.bullet2Answer}. For example, ${slots.bullet2Example}. That is why I feel ${slots.feelingWord} about it.`,
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
    targetWords: "260-290",
    requiredSlots: [
      "topic", "sideA", "sideB", "opinion", "reason1", "reason2", "example1",
      "explanation1", "yourSide", "situation", "result", "extraCondition",
      "finalComparison", "oppositeSide", "mainReason", "beneficiary"
    ],
    compose(slots) {
      return [
        `Many people have different opinions about ${slots.topic}. Some people think ${slots.sideA}, while others believe ${slots.sideB}. In my opinion, ${slots.opinion}. I hold this view because ${slots.reason1} and ${slots.reason2}. This question matters because it can influence normal choices in study, work, and family life.`,
        "",
        `On the one hand, ${slots.sideA} can be reasonable because ${slots.reason1}. For example, ${slots.example1}. This shows that ${slots.explanation1}. Therefore, it is easy to understand why some people support this idea.`,
        "",
        `On the other hand, I believe ${slots.yourSide} is more important because ${slots.reason2}. If people ${slots.situation}, they may ${slots.result}. This is especially true when ${slots.extraCondition}. Therefore, ${slots.finalComparison}.`,
        "",
        `In conclusion, although ${slots.oppositeSide} may have some value, I think ${slots.opinion} because ${slots.mainReason}. In the long term, this choice is more practical for ${slots.beneficiary}, especially when people want a balanced and realistic result.`
      ].join("\n");
    }
  },
  "task2-reasons-results-solutions": {
    name: "Task 2 Template 2: Reasons/results/solutions",
    task: "Task 2",
    targetWords: "260-290",
    requiredSlots: [
      "topic", "overallJudgement", "affectedArea", "point1", "explanation1", "example1",
      "result1", "point2", "result2", "explanation2", "solutionOrAction",
      "summaryPoint1", "summaryPoint2", "finalSolution"
    ],
    compose(slots) {
      return [
        `Nowadays, ${slots.topic} is becoming common. There are two main points to consider, and I think ${slots.overallJudgement}. This issue is important because it can affect ${slots.affectedArea}. It also shows how everyday habits can create bigger problems over time.`,
        "",
        `The first point is that ${slots.point1}. This means that ${slots.explanation1}. For example, ${slots.example1}. As a result, people may ${slots.result1}, which can make daily life more difficult.`,
        "",
        `Another point is that ${slots.point2}. As a result, ${slots.result2}. This can affect people because ${slots.explanation2}. A useful way to deal with this is to ${slots.solutionOrAction}.`,
        "",
        `In conclusion, ${slots.topic} happens mainly because ${slots.summaryPoint1} and ${slots.summaryPoint2}. I believe ${slots.overallJudgement}, and it can be improved if ${slots.finalSolution}. If people take this seriously, the situation will become easier to manage, and the result will be better for both individuals and society.`
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
  if (spec.requiredSlots.includes("purposeVerb")) slots.purposeVerb = normalizePurposeVerb(slots.purposeVerb, slots.topic, templateIdForBody(body));
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
    "Use simple, learnable Band 5.0-5.5 language. Do not use Band 8/9 vocabulary.",
    "Preserve the student's main position, scenario, relationship, request, reasons, and examples when the student essay provides them. If missing, infer modest prompt-related details.",
    body.task === "Task 1"
      ? "Each slot should normally contain 7-14 English words so the final fixed-template letter reaches about 170-200 words."
      : "Each slot should normally contain 10-18 English words so the final fixed-template essay reaches about 260-290 words.",
    "Each slot must be one phrase or one simple sentence fragment that fits inside the fixed line. No numbering, no markdown, no paragraph text inside a slot.",
    "Do not end slot values with a full stop, question mark, exclamation mark, colon, or semicolon because the server template adds punctuation.",
    "Do not repeat template lead-in words inside slots. Avoid: Dear, For example, As a result, This means that, Please let me know if, I would be happy to, I would like to, The first reason/problem is that.",
    "Do not use slash choices such as positive/negative, better/worse, reason/problem, happened/will happen, or is/will be. Choose one natural phrase.",
    "For recipientName or friendName, return only a simple name or 'Sir or Madam'. Do not return roles such as 'the manager', 'the owner', or 'the organiser'.",
    "For purposeVerb, return only a short verb phrase such as 'complain about', 'ask about', 'thank you for', 'apologise for', 'invite you to', or 'apply for'.",
    "For action slots after 'please', 'I would like to', 'I would be happy to', or 'we could', return an action phrase, not a full sentence.",
    "For situation slots after 'If people', do not start with 'when' or 'if'. For result slots after 'they may' or 'people may', do not start with 'they may', 'people may', or 'this leads to'.",
    "For sideA and sideB, do not start with 'some people think' or 'others believe'. For opinion and yourSide, do not start with 'I think', 'I believe', 'I agree', or 'I prefer'.",
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
  const aiPayload = await callDeepSeek(buildPrompt(body, spec, templateId), 0.25);
  return buildTemplateReferenceResult(body, aiPayload);
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
