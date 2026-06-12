const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const grade = read('api/grade-ielts.js');
const router = read('api/grade-ielts-production-router.js');
const midband = read('api/grade-ielts-midband.js');

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(grade.includes('score-core-v8-5-13-neutral-ai-primary-midband'), 'grade-ielts.js should identify v4.3 neutral AI-primary cleanup');
assert(router.includes('production-router-v3-4-neutral-ai-primary-routing'), 'router should identify v4.3 neutral AI-primary routing');
assert(grade.includes('local taskRequirementAudit is debug-only'), 'task requirement audit must be debug-only in prompt');
assert(grade.includes('Do not use local keyword audit'), 'prompt must reject local keyword audit as scoring prior');
assert(grade.includes('Do not rely on local bullet extraction'), 'anchor prompt must reject local bullet extraction');
assert(grade.includes('Do not rely on local question-profile or marker audit'), 'anchor prompt must reject local task2 marker audit');
assert(grade.includes('taskAchievementCap = midbandPrimary ? null : advisoryTaskAchievementCap'), 'Task 1 cap must be null in midband');
assert(grade.includes('taskResponseCap = midbandPrimary ? null : advisoryTaskResponseCap'), 'Task 2 cap must be null in midband');
assert(!grade.includes('Task 1 prompt bullets extracted for orientation only'), 'local Task 1 bullet list should not be injected into normal prompt');
assert(!grade.includes('Task 2 question profile for orientation only'), 'local Task 2 profile JSON should not be injected into normal prompt');
assert(!/"explicit_no_answer_or_copied_prompt_marker"/.test(grade.match(/const STRICT_HARD_ZERO_REASONS[\s\S]*?\]\);/)?.[0] || ''), 'explicit no-answer must not be a strict local zero reason');
assert(!/words\s*<\s*50[\s\S]{0,160}not_rateable_or_severely_limited/.test(grade), 'Task 1 word count threshold must not directly mark not-rateable');
assert(!/words\s*<\s*80[\s\S]{0,160}not_rateable_or_severely_limited/.test(grade), 'Task 2 word count threshold must not directly mark not-rateable');
assert(!/TASK1_UNDER_80_WORDS|TASK2_UNDER_120_WORDS/.test(router), 'router must not use word-count-only lowband routing reasons');
assert(router.includes('hasHighbandPotential'), 'router should support 6.5 + highband potential shadow check');
assert(router.includes('MIDBAND_6_5_WITH_HIGHBAND_POTENTIAL'), 'router should document 6.5 highband potential route');
assert(router.includes('aiPrimaryAudit'), 'router should expose aiPrimaryAudit');
assert(router.includes('localBulletAuditUsedInPrompt: false'), 'router audit should state local bullet audit is not prompt input');
assert(router.includes('localTask2CoverageUsedInPrompt: false'), 'router audit should state local task2 coverage is not prompt input');
assert(/skipMandatoryBoundaryReview\s*:\s*true/.test(midband), 'midband wrapper must still bypass mandatory boundary review');
assert(!/Math\.max\s*\([^\n]*finalBand[^\n]*5/i.test(grade + router + midband), 'no local Band 5 floor allowed');
assert(!/Dear Mark/.test(grade + router + midband), 'no sample-specific Dear Mark special case allowed');

function loadAuditExports(relativeFile, exportNames) {
  const absolute = path.join(root, relativeFile);
  const source = fs.readFileSync(absolute, 'utf8');
  const assignments = exportNames.map((name) => `\nmodule.exports.__audit.${name} = typeof ${name} === "undefined" ? undefined : ${name};`).join('');
  const wrapped = `${source}\nmodule.exports.__audit = module.exports.__audit || {};${assignments}\n`;
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: createRequire(absolute), process, console, Buffer, setTimeout, clearTimeout, fetch, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, __dirname: path.dirname(absolute), __filename: absolute };
  vm.runInNewContext(wrapped, sandbox, { filename: absolute, displayErrors: true });
  return sandbox.module.exports.__audit || {};
}

const audit = loadAuditExports('api/grade-ielts-production-router.js', ['routeReason']);
assert(audit.routeReason(5.0, 'Task 1', { yes: false }, false).targetSystem === 'midband', 'ordinary 5.0 Task 1 should stay midband');
assert(audit.routeReason(6.5, 'Task 2', { yes: false }, false).targetSystem === 'midband', '6.5 without highband potential should stay midband');
assert(audit.routeReason(6.5, 'Task 2', { yes: false }, true).useHighbandShadow === true, '6.5 with highband potential should trigger highband shadow');
assert(audit.routeReason(3.5, 'Task 2', { yes: true, reason: 'MIDBAND_BELOW_4' }, false).useLowbandGuard === true, 'AI lowband evidence should trigger lowband');

console.log('PASS midband AI-primary v4.3 static test');
