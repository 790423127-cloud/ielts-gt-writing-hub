const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const grade = fs.readFileSync(path.join(root, 'api', 'grade-ielts.js'), 'utf8');
const lowband = fs.readFileSync(path.join(root, 'api', 'grade-ielts-lowband.js'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'api', 'grade-ielts-boundary-adjudicator.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'api', 'grade-ielts-production-router.js'), 'utf8');

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(grade.includes('score-core-v8-5-13-neutral-ai-primary-midband'), 'v4.3 score version missing');
assert(router.includes('production-router-v3-4-neutral-ai-primary-routing'), 'v4.3 router version missing');
assert(grade.includes('Neutral Task 1 Band 5 calibration'), 'neutral Task 1 Band 5 anchor missing');
assert(grade.includes('score the current response only'), 'current-text-only scoring rule missing');
assert(grade.includes('Do not use a surface-polish flag'), 'prompt must reject surface-polish/history flags as scoring evidence');
assert(grade.includes('Do not rely on local bullet extraction'), 'Task 1 local audit rejection missing');
assert(grade.includes('Do not rely on local question-profile or marker audit'), 'Task 2 local audit rejection missing');
assert(router.includes('MIDBAND_6_5_WITH_HIGHBAND_POTENTIAL'), '6.5 highband-potential route missing');

const apiText = [grade, lowband, boundary, router].join('\n');
for (const re of [/Corrected Task 1/i, /corrected low-band/i, /previously weak/i, /Dear Mark/]) {
  assert(!re.test(apiText), `forbidden special-case wording remains: ${re}`);
}
for (const re of [/finalBand\s*=\s*Math\.max\s*\([^\n]*5/i, /if\s*\([^\n]*allBulletPoints[^\n]*\)\s*[^\n]*5/i, /if\s*\([^\n]*includes\(['"]Dear Mark/i]) {
  assert(!re.test(apiText), `forbidden local uplift or sample special case remains: ${re}`);
}

console.log('PASS midband neutral AI-primary v4.3 static test.');
