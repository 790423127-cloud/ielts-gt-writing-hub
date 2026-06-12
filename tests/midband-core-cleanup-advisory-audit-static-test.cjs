const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, 'api', 'grade-ielts.js');
const core = fs.readFileSync(corePath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(core.includes('task1-requirement-audit-v8-2-advisory-midband'), 'Task 1 requirement audit must be advisory-only in midband mode.');
assert(core.includes('midbandAdvisoryOnly'), 'Audit must expose midbandAdvisoryOnly.');
assert(core.includes('taskAchievementCap: signals.taskRequirementAudit.midbandAdvisoryOnly ? null'), 'Compact prompt signals must not expose a midband advisory cap as a real cap.');
assert(core.includes('Midband source-of-truth rule'), 'Prompt must tell AI that local audit is advisory only.');
assert(core.includes('Band 5 reality rule'), 'Prompt must explicitly state Band 5 can contain visible errors and simple language.');
assert(core.includes('simple but unclear stays 4.5'), 'Prompt must distinguish simple-sufficient from simple-unclear LR/GRA.');
assert(!/Task 1 requirement audit capped Task Achievement[\s\S]{0,500}midbandOnly/.test(core), 'Midband mode must not use local Task 1 cap language as a scoring ceiling.');
assert(!/finalBand\s*=\s*Math\.max\s*\(\s*finalBand\s*,\s*5/.test(core), 'No local Band 5 floor is allowed.');
assert(!/Dear\s+Mark/.test(core), 'No sample-text special case is allowed.');

function loadAuditExports(relativeFile, exportNames) {
  const absolute = path.join(root, relativeFile);
  const source = fs.readFileSync(absolute, 'utf8');
  const assignments = exportNames.map((name) => `\nmodule.exports.__audit.${name} = typeof ${name} === "undefined" ? undefined : ${name};`).join('');
  const wrapped = `${source}\nmodule.exports.__audit = module.exports.__audit || {};${assignments}\n`;
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
    fetch: async () => { throw new Error('fetch disabled in static test'); },
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.runInNewContext(wrapped, sandbox, { filename: absolute, displayErrors: true });
  return sandbox.module.exports.__audit || {};
}

const audit = loadAuditExports('api/grade-ielts.js', [
  'auditTask1Requirements',
  'localSignals',
  'buildCompactScorePrompt'
]);

assert(typeof audit.auditTask1Requirements === 'function', 'auditTask1Requirements export missing in static VM test');
assert(typeof audit.buildCompactScorePrompt === 'function', 'buildCompactScorePrompt export missing in static VM test');

const prompt = `You need to write a letter to a friend visiting your country.\n\nIn your letter:\n- suggest the best time to visit\n- recommend things to do\n- give transport or weather advice`;
const essay = `Dear Mark,\n\nIt has been a long time since we last met, and I still think of you every now and then. I really miss you, so I am writing this letter to invite you to visit my country. You know China is one of the biggest countries in the world, and we can do so many things.\n\nFirst, I want to tell you that the best time to visit China is September, because the weather is comfortable, not very hot and also not very cold. It is a better choice for travelling. Besides, in September, school has already started, so when we go outside, we won't see too many people.\n\nSecondly, I suggest we should go to our high school, because it is the place where we first met, and we have good memories there. Those were the good old days.\n\nFinally, I suggest you take a plane to China. It will be a long trip for you, so a plane will be faster. You know I can't wait to meet you again.\n\nI look forward to your reply. Thank you for your time.\n\nYours,\nKevin`;

const body = {
  task: 'Task 1',
  questionPrompt: prompt,
  promptText: prompt,
  prompt,
  essay,
  wordCount: 154,
  scoringSystem: 'midband',
  midbandPrimary: true,
  midbandOnly: true,
  skipMandatoryBoundaryReview: true
};

const signals = audit.localSignals(body);
assert(signals.taskRequirementAudit.midbandAdvisoryOnly === true, 'Midband request must mark Task 1 requirement audit as advisory only.');
assert(signals.taskRequirementAudit.taskAchievementCap == null, 'Midband request must not expose a real Task Achievement cap.');
assert(signals.taskRequirementAudit.triggered === false, 'Midband advisory audit must not trigger a local requirement gate.');

const compactPrompt = audit.buildCompactScorePrompt(body, signals);
assert(compactPrompt.includes('Midband source-of-truth rule'), 'Compact prompt must include midband source-of-truth rule.');
assert(compactPrompt.includes('Band 5 reality rule'), 'Compact prompt must include Band 5 reality rule.');

console.log('PASS midband core cleanup advisory audit static test');
