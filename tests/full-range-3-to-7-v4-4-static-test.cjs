const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const grade = read('api/grade-ielts.js');
const router = read('api/grade-ielts-production-router.js');
const corpus = JSON.parse(read('tests/fixtures/full-range-3-to-7-gold-corpus-v1.json'));
function assert(condition, message) { if (!condition) throw new Error(message); }

assert(grade.includes('score-core-v8-5-14-criterion-differentiation-3-to-7-v4-4'), 'v4.4 score version missing');
assert(router.includes('production-router-v3-5-criterion-differentiation-routing-v4-4'), 'v4.4 router version missing');
assert(grade.includes('v4.4 criterion-differentiation realism for Bands 3.0-7.0'), 'v4.4 criterion differentiation protocol missing');
assert(grade.includes('identical 4.0-7.0 profiles'), 'all-same 4.0-7.0 recheck rule missing');
assert(grade.includes('Overall Band 5 does not require four 5.0 criteria'), 'Band 5 criterion-spread warning missing');
assert(grade.includes('Task 1 differentiation: TA can be higher than LR/GRA'), 'Task 1 TA-vs-language differentiation missing');
assert(grade.includes('Task 2 differentiation: CC can be higher than TR'), 'Task 2 CC-vs-TR differentiation missing');
assert(grade.includes('A Task 1 response may have TA/CC at 5.0 while LR/GRA are 4.5'), 'score-kernel Task 1 criterion spread example missing');
assert(grade.includes('criteriaAllEqual'), 'criterion flattening audit missing');
assert(corpus.version === 'full-range-3-to-7-gold-corpus-v1', 'corpus version mismatch');
assert(corpus.items.length >= 18, 'corpus should contain at least 18 samples');
const tasks = new Set(corpus.items.map((x) => x.task));
assert(tasks.has('Task 1') && tasks.has('Task 2'), 'corpus must include both Task 1 and Task 2');
const targets = new Set(corpus.items.map((x) => x.targetOverall));
for (const b of [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]) assert(targets.has(b), `missing target band ${b}`);
const spreadCases = corpus.items.filter((x) => {
  const vals = Object.values(x.targetCriteria || {});
  return vals.length === 4 && !vals.every((v) => v === vals[0]);
});
assert(spreadCases.length >= 6, 'corpus needs enough non-flat criterion target profiles');
assert(!/Math\.max\s*\([^\n]*finalBand[^\n]*5/i.test(grade + router), 'no local Band 5 floor allowed');
assert(!/Dear Mark/.test(grade + router), 'no sample-specific Dear Mark special case allowed');
console.log('PASS full-range 3-to-7 v4.4 static calibration test.');
