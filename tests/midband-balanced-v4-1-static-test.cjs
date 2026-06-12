const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const grade = fs.readFileSync(path.join(root, 'api/grade-ielts.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'api/grade-ielts-production-router.js'), 'utf8');
const midband = fs.readFileSync(path.join(root, 'api/grade-ielts-midband.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(grade.includes('score-core-v8-5-11-midband-balanced-cleanup'), 'score version should identify v4.1 balanced cleanup');
assert(grade.includes('Balanced condition: do not apply the corrected Band 5 rule merely because spelling looks cleaner'), 'Task 1 corrected Band 5 anchor must include anti-inflation condition');
assert(grade.includes('Band 5 evidence rule'), 'Prompt must require positive evidence before Band 5 rescue');
assert(grade.includes('simple but unclear stays 4.5'), 'LR/GRA rule must distinguish simple-sufficient from simple-unclear');
assert(grade.includes('Do not overcorrect: Band 5.5 requires more stability than Band 5.0'), 'Task 1 should not over-lift to 5.5');
assert(grade.includes('Task 2 midband direction: distinguish basic completion from real development'), 'Task 2 4-6 direction must be explicit');
assert(grade.includes('Band 6 requires clear, relevant development'), 'Task 2 should not overreward paragraphing/grammar cleanup');
assert(grade.includes('may override local keyword audit in either direction'), 'Local task audit must be advisory only');
assert(grade.includes('taskAchievementCap = midbandPrimary ? null : advisoryTaskAchievementCap'), 'Task 1 hard cap must remain disabled in midband mode');
assert(!/Math\.max\s*\([^\n]*finalBand[^\n]*5/i.test(grade + router + midband), 'No local Band 5 floor should be added');
assert(!/Dear Mark/.test(grade + router + midband), 'No Dear Mark sample special case should exist');
assert(/skipMandatoryBoundaryReview\s*:\s*true/.test(midband), 'Midband wrapper must skip mandatory boundary review');
assert(/boundaryAdjudicatorRetiredFromProduction\s*:\s*true/.test(router), 'Boundary adjudicator should remain retired from production router');

console.log('PASS midband balanced v4.1 static test');
