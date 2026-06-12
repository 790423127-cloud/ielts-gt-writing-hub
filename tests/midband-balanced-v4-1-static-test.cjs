const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const grade = fs.readFileSync(path.join(root, 'api/grade-ielts.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'api/grade-ielts-production-router.js'), 'utf8');
const midband = fs.readFileSync(path.join(root, 'api/grade-ielts-midband.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(grade.includes('score-core-v8-5-12-midband-ai-primary-cleanup'), 'score version should identify v4.2 AI-primary cleanup');
assert(grade.includes('AI-primary source-of-truth rule'), 'Midband prompt must state AI-primary source of truth.');
assert(grade.includes('Band 5 evidence rule'), 'Prompt must require positive evidence before Band 5 rescue');
assert(grade.includes('simple but unclear stays 4.5'), 'LR/GRA rule must distinguish simple-sufficient from simple-unclear');
assert(grade.includes('Do not overcorrect: Band 5.5 requires more stability than Band 5.0'), 'Task 1 should not over-lift to 5.5');
assert(grade.includes('Task 2 midband direction: distinguish basic completion from real development'), 'Task 2 4-6 direction must be explicit');
assert(grade.includes('Band 6 requires clear, relevant development'), 'Task 2 should not overreward paragraphing/grammar cleanup');
assert(grade.includes('local taskRequirementAudit is debug-only'), 'Local task audit must be debug-only in scoring prompt.');
assert(grade.includes('taskAchievementCap = midbandPrimary ? null : advisoryTaskAchievementCap'), 'Task 1 hard cap must remain disabled in midband mode');
assert(grade.includes('taskResponseCap = midbandPrimary ? null : advisoryTaskResponseCap'), 'Task 2 hard cap must remain disabled in midband mode');
assert(!/Math\.max\s*\([^\n]*finalBand[^\n]*5/i.test(grade + router + midband), 'No local Band 5 floor should be added');
assert(!/Dear Mark/.test(grade + router + midband), 'No Dear Mark sample special case should exist');
assert(/skipMandatoryBoundaryReview\s*:\s*true/.test(midband), 'Midband wrapper must skip mandatory boundary review');
assert(/boundaryAdjudicatorRetiredFromProduction\s*:\s*true/.test(router), 'Boundary adjudicator should remain retired from production router');

console.log('PASS midband balanced v4.1 static test');
