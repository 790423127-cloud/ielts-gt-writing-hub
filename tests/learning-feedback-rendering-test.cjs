const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countOccurrences(text, needle) {
  const match = String(text || "").match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
  return match ? match.length : 0;
}

function createElementStub(id = "") {
  return {
    id,
    value: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(node) { this.children.push(node); return node; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    scrollIntoView() {}
  };
}

function loadWritingFeedbackAudit() {
  const absolute = path.join(ROOT, "api", "writing-feedback.js");
  const source = fs.readFileSync(absolute, "utf8");
  const wrapped = `${source}\nmodule.exports.__audit = { normalizeModuleResult, buildPrompt, MODULES };`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(absolute),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch: async () => { throw new Error("fetch should not be called in rendering test"); },
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { filename: absolute });
  return sandbox.module.exports.__audit;
}

function loadScriptLearningFeedbackAudit() {
  const absolute = path.join(ROOT, "script.js");
  const source = fs.readFileSync(absolute, "utf8");
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
window.__LF_TEST__ = {
  renderOverviewModule,
  renderSentenceUpgradeModule,
  renderGrammarWordFormSpellingModule,
  renderStructureCohesionTaskModule,
  renderExpressionBankModule,
  renderLearningModuleBody,
  setLatestScoreResult(value) { latestScoreResult = value; },
  setLatestLearningFeedback(value) { latestLearningFeedback = value || {}; },
  setActiveLearningFeedbackModule(value) { activeLearningFeedbackModule = value; }
};
})();
`);

  const elementCache = new Map();
  const getElement = (id) => {
    if (!elementCache.has(id)) elementCache.set(id, createElementStub(id));
    return elementCache.get(id);
  };

  const localStorageStore = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    navigator: { clipboard: { writeText: async () => {} } },
    history: { replaceState() {} },
    location: { hash: "", origin: "https://example.test" },
    localStorage: {
      getItem(key) { return localStorageStore.has(key) ? localStorageStore.get(key) : null; },
      setItem(key, value) { localStorageStore.set(key, String(value)); },
      removeItem(key) { localStorageStore.delete(key); }
    },
    fetch: async () => { throw new Error("fetch should not be called in rendering test"); },
    document: {
      body: { contains() { return false; }, appendChild() {} },
      documentElement: { dataset: {} },
      getElementById: getElement,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: (tag) => createElementStub(tag)
    },
    window: {
      IELTS_GT_DATA: { prompts: [], meta: {}, phraseBanks: { task1: {}, task2: {} } },
      location: { hash: "", origin: "https://example.test" },
      addEventListener() {},
      removeEventListener() {}
    }
  };

  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.history = sandbox.history;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.fetch = sandbox.fetch;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: absolute });
  return sandbox.window.__LF_TEST__;
}

const feedbackAudit = loadWritingFeedbackAudit();
const scriptAudit = loadScriptLearningFeedbackAudit();

const frozenTask1Context = {
  task: "Task 1",
  prompt: `You need to write a letter to a college admissions office.

In your letter:
- say which course interests you
- ask about entry requirements
- ask about fees and start dates`,
  essay: `Dear SirorMadam
I am first day come to college, and I have some problem with my main course.I writting this letter to requesting about the College Information.
At first, I am really interest at It course, I liked paly computer since pramiry school and back to now ai is going to fast devolop,I do not want to left behind and if i can make my hobbie into study will help me a lot. when somebody like something they will foucs on it.
Secondly, I need to know what is the entry requirements,what i need to give to you,like id card,my hight school score or something else? Could you reply me more detail about entry requirements and also how much fees and start dates?
I am looking forward to you, thanks for you reply

Yours,
kevin`,
  currentResult: {
    overallBand: 4.5,
    criteria: {
      "Task Achievement": 4.5,
      "Coherence and Cohesion": 4.5,
      "Lexical Resource": 4.0,
      "Grammatical Range and Accuracy": 4.0
    }
  },
  frozenScore: {
    overallBand: 4.5,
    criteria: {
      "Task Achievement": 4.5,
      "Coherence and Cohesion": 4.5,
      "Lexical Resource": 4.0,
      "Grammatical Range and Accuracy": 4.0
    }
  }
};

const rawOverview = {
  summary: { en: "The response has several basic IELTS GT letter problems.", zh: "这篇信有几个基础但关键的问题。" },
  topProblems: [
    {
      problem: { en: "The formal opening and closing are incomplete.", zh: "正式书信的开头和结尾不完整。" },
      evidence: ["Dear SirorMadam", "Yours, kevin"],
      evidenceZh: "称呼和结尾都不符合正式信件格式。",
      whyMatters: { en: "Tone and format affect Task Achievement.", zh: "语气和格式会影响 Task Achievement。" },
      nextPractice: { en: "Practise 5 formal openings and closings.", zh: "先练 5 组正式信件开头和结尾。" }
    },
    {
      problem: { en: "The formal opening and closing are incomplete.", zh: "正式书信的开头和结尾不完整。" },
      evidence: ["Dear SirorMadam", "Yours, kevin"],
      evidenceZh: "称呼和结尾都不符合正式信件格式。",
      whyMatters: { en: "Tone and format affect Task Achievement.", zh: "语气和格式会影响 Task Achievement。" },
      nextPractice: { en: "Practise 5 formal openings and closings.", zh: "先练 5 组正式信件开头和结尾。" }
    }
  ],
  nextPracticeFocus: [
    { focus: { en: "Use a clear purpose sentence.", zh: "先把写信目的句写清楚。" } },
    { focus: { en: "Use a clear purpose sentence.", zh: "先把写信目的句写清楚。" } }
  ]
};

const rawSentenceUpgrade = {
  summary: { en: "Upgrade the most important sentences first.", zh: "先升级最影响分数的句子。" },
  sentenceCards: [
    {
      index: 1,
      original: "I writting this letter to requesting about the College Information.",
      issueTags: ["verb form", "word form", "formal tone"],
      minimalCorrection: "I am writing this letter to request information about the college.",
      upgradedVersion: "I am writing to ask for information about the IT course at your college.",
      whyBetter: { en: "The verb forms and purpose are clearer.", zh: "动词形式正确了，写信目的也更清楚。" },
      usefulPattern: { en: "I am writing to ask for information about...", zh: "I am writing to ask for information about... 这个句型适合正式询问信。" }
    },
    {
      index: 1,
      original: "I writting this letter to requesting about the College Information.",
      issueTags: ["verb form", "word form", "formal tone"],
      minimalCorrection: "I am writing this letter to request information about the college.",
      upgradedVersion: "I am writing to ask for information about the IT course at your college.",
      whyBetter: { en: "The verb forms and purpose are clearer.", zh: "动词形式正确了，写信目的也更清楚。" },
      usefulPattern: { en: "I am writing to ask for information about...", zh: "I am writing to ask for information about... 这个句型适合正式询问信。" }
    }
  ]
};

const rawGrammar = {
  summary: { en: "These are the main grammar patterns to fix.", zh: "这些是这篇作文最主要的语法问题。" },
  grammarErrors: [
    { errorType: { en: "Verb form after be", zh: "be 动词后动词形式错误" }, original: "I am first day come to college", corrected: "It is my first day at college", explanation: { en: "After be, you cannot use a bare verb here.", zh: "be 动词后面这里不能直接接原形动词。" }, checkMethod: { en: "Check am/is/are + noun/adjective/-ing.", zh: "先检查 am/is/are 后面是不是名词、形容词或 -ing。" } },
    { errorType: { en: "Spelling and verb form", zh: "动词拼写和形式错误" }, original: "I writting this letter", corrected: "I am writing this letter", explanation: { en: "Writing needs one t and an -ing structure.", zh: "writing 只有一个 t，而且这里要用 am writing 结构。" }, checkMethod: { en: "Check common writing verbs.", zh: "把 write / writing 这类高频动词单独检查。" } },
    { errorType: { en: "Preposition", zh: "介词搭配错误" }, original: "interest at It course", corrected: "interested in the IT course", explanation: { en: "Interested normally takes in.", zh: "interested 后面通常搭配 in。" }, checkMethod: { en: "Review adjective + preposition pairs.", zh: "复习形容词和介词的固定搭配。" } },
    { errorType: { en: "Indirect question word order", zh: "间接疑问句语序错误" }, original: "what is the entry requirements", corrected: "what the entry requirements are", explanation: { en: "Indirect questions use statement word order.", zh: "间接疑问句要用陈述句语序。" }, checkMethod: { en: "After tell me / know / ask, use statement order.", zh: "在 tell me / know / ask 后面改成陈述句语序。" } },
    { errorType: { en: "Subject-verb agreement", zh: "主谓一致错误" }, original: "the course start", corrected: "the course starts", explanation: { en: "A singular subject needs starts.", zh: "单数主语后面要用 starts。" }, checkMethod: { en: "Check he/she/it singular verbs.", zh: "检查第三人称单数动词形式。" } }
  ],
  wordFormErrors: [
    { errorType: { en: "Word form", zh: "词形错误" }, original: "devolop", corrected: "develop", explanation: { en: "This is the wrong spelling and form.", zh: "这里的拼写和词形都不对。" }, checkMethod: { en: "Keep a list of high-frequency academic verbs.", zh: "建立高频写作动词表反复检查。" } }
  ],
  spellingQuickFix: [
    { wrong: "pramiry", correct: "primary", note: "spelling" },
    { wrong: "perpear", correct: "prepare", note: "spelling" }
  ]
};

const rawStructure = {
  summary: { en: "The letter needs clearer task coverage and formal structure.", zh: "这封信需要更清楚的任务覆盖和正式信件结构。" },
  taskChecklist: [
    {
      requirement: "say which course interests you",
      requirementZh: "说明你对哪个课程感兴趣",
      status: "covered",
      statusZh: "已覆盖",
      evidence: "I am really interest at It course",
      evidenceZh: "学生已经提到自己对 IT 课程感兴趣，但表达不自然。",
      advice: { en: "Name the course clearly in one clean sentence.", zh: "把课程名称放进一个清楚完整的句子里。" }
    }
  ],
  opening: {
    currentIssue: "The opening is too weak for a formal letter.",
    currentIssueZh: "开头没有把正式信件目的说清楚。",
    suggestedVersion: `Dear Admissions Officer,\n\nI am writing to request information about the IT course at your college.\nI am especially interested in this course because I have enjoyed using computers since primary school.\nI would also like to know more about the entry requirements, fees, and start dates.\n\nYours faithfully,\nKevin`,
    suggestedVersionZh: "这里给成了整封重写信，这不应该出现在老师式反馈模块里。",
    whyBetter: { en: "This rewrite sounds more formal.", zh: "这段整封重写虽然更正式，但不适合放在这个模块里。" },
    howToUse: { en: "Use a full formal version.", zh: "不应该要求学生在这里直接背整封信。" }
  },
  cohesion: {
    issues: [
      {
        original: "At first, I am really interest at It course",
        improved: "I am interested in the IT course for two main reasons.",
        whyBetter: { en: "This creates a clearer paragraph focus.", zh: "这样能让这一段的中心更清楚。" }
      }
    ]
  }
};

const rawExpressionBank = {
  summary: { en: "Build expressions you can reuse in similar letters.", zh: "积累这些表达，下次写类似正式询问信时可以直接用。" },
  groups: [
    {
      categoryZh: "正式信件开头",
      items: [
        { phrase: "I am writing to ask for information about...", usageZh: "用于正式询问信的开头目的句。", suitableFor: "request letter" },
        { phrase: "I would like to know more about...", usageZh: "用于进一步询问课程、安排或要求。", suitableFor: "request letter" }
      ]
    },
    {
      categoryZh: "询问要求和费用",
      items: [
        { phrase: "Could you please tell me what the entry requirements are?", usageZh: "用于询问入学要求。", suitableFor: "request letter" }
      ]
    }
  ]
};

const overview = feedbackAudit.normalizeModuleResult("overview", rawOverview);
const sentenceUpgrade = feedbackAudit.normalizeModuleResult("sentenceUpgrade", rawSentenceUpgrade);
const grammar = feedbackAudit.normalizeModuleResult("grammarWordFormSpelling", rawGrammar);
const structure = feedbackAudit.normalizeModuleResult("structureCohesionTask", rawStructure);
const expressionBank = feedbackAudit.normalizeModuleResult("expressionBank", rawExpressionBank);

scriptAudit.setLatestScoreResult(frozenTask1Context.currentResult);
scriptAudit.setLatestLearningFeedback({
  overview: { status: "ready", moduleResult: overview },
  sentenceUpgrade: { status: "ready", moduleResult: sentenceUpgrade },
  grammarWordFormSpelling: { status: "ready", moduleResult: grammar },
  structureCohesionTask: { status: "ready", moduleResult: structure },
  expressionBank: { status: "ready", moduleResult: expressionBank }
});

const overviewHtml = scriptAudit.renderOverviewModule(overview);
const sentenceHtml = scriptAudit.renderSentenceUpgradeModule(sentenceUpgrade);
const grammarHtml = scriptAudit.renderGrammarWordFormSpellingModule(grammar);
const structureHtml = scriptAudit.renderStructureCohesionTaskModule(structure);
const expressionHtml = scriptAudit.renderExpressionBankModule(expressionBank);
const structurePanelHtml = scriptAudit.renderLearningModuleBody("structureCohesionTask", { status: "ready", moduleResult: structure });
const fullHtml = [overviewHtml, sentenceHtml, grammarHtml, structureHtml, expressionHtml, structurePanelHtml].join("\n");

assert(!fullHtml.includes("[object Object]"), "Rendered learning feedback must not include [object Object].");
assert(!/\?{3,}/.test(fullHtml), "Rendered learning feedback must not contain repeated ??? placeholders.");
assert(countOccurrences(sentenceHtml, "I am writing to ask for information about the IT course at your college.") === 1, "Sentence Upgrade should dedupe repeated upgrade cards.");
assert(countOccurrences(overviewHtml, "正式书信的开头和结尾不完整。") === 1, "Overview should dedupe repeated top problems.");
assert(grammar.grammarErrors.length >= 5, "Grammar module should preserve at least 5 major grammar error categories in the normalized result.");
assert(!/Dear Admissions Officer,[\s\S]*Yours faithfully,/i.test(structureHtml), "Structure module must not render a full rewritten letter inside a feedback card.");
assert(/正式信件开头/.test(expressionHtml), "Expression Bank should render grouped category labels.");
assert(/I am writing to ask for information about/.test(expressionHtml), "Expression Bank should render phrase text.");
assert(/用于正式询问信的开头目的句/.test(expressionHtml), "Expression Bank should render Chinese usage guidance.");

const prompt = feedbackAudit.buildPrompt(frozenTask1Context, "grammarWordFormSpelling");
assert(/be 动词后面/.test(prompt) || /Verb form after be/.test(prompt), "Grammar prompt should explicitly guide the AI to explain concrete grammar patterns.");
assert(/间接疑问句/.test(prompt) || /indirect question/.test(prompt), "Grammar prompt should explicitly mention indirect-question word order when relevant.");
assert(/不要返回.*整篇|Do not rewrite the whole essay/i.test(feedbackAudit.buildPrompt(frozenTask1Context, "structureCohesionTask")), "Structure prompt should forbid whole-essay rewrites.");

console.log("learning-feedback-rendering-test: PASS");
