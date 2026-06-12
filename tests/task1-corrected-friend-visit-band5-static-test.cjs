const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'api', 'grade-ielts.js'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'api', 'grade-ielts-boundary-adjudicator.js'), 'utf8');
const lowband = fs.readFileSync(path.join(root, 'api', 'grade-ielts-lowband.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredMainAnchors = [
  'Primary 4.0-6.5 midband calibration',
  'Band 5 does not mean error-free',
  'Neutral Task 1 Band 5 calibration',
  'Task 1 functional Band 5 anchor',
  'score the current response only',
  'Do not keep Lexical Resource or Grammar at Band 4 solely because the vocabulary is ordinary or sentence structures are simple',
  'For informal letters to friends, a conversational greeting',
  'Priority rule for this midband scorer',
  'Functional Band 5 rule',
  'simple but unclear stays 4.5',
  'AI-primary source-of-truth rule',
  'Band 5 reality rule'
];

for (const phrase of requiredMainAnchors) {
  assert(main.includes(phrase), `grade-ielts.js missing neutral Task 1 Band 5 anchor phrase: ${phrase}`);
}

const requiredBoundaryAnchors = [
  'Task 1 functional Band 5 anchor',
  'simple but clear letters with a recognisable greeting/closing',
  'do not keep it in low_4_band merely because the vocabulary is ordinary or sentence patterns are simple',
  'For informal friend letters, conversational warmth and simple phrases are appropriate'
];

for (const phrase of requiredBoundaryAnchors) {
  assert(boundary.includes(phrase), `boundary adjudicator missing neutral Task 1 anchor phrase: ${phrase}`);
}

const requiredLowbandAnchors = [
  'LOWBAND GUARD',
  'Band 5 may still contain noticeable non-blocking errors',
  'Task 1 functional Band 5 rule',
  'Score the current text only',
  'do not keep it at 4.0/4.5 just because vocabulary and sentences are simple'
];

for (const phrase of requiredLowbandAnchors) {
  assert(lowband.includes(phrase), `lowband shadow missing neutral Task 1 anchor phrase: ${phrase}`);
}

const forbiddenSpecialCaseLanguage = [
  /Corrected Task 1/i,
  /corrected low-band/i,
  /previously weak/i,
  /correctedEssay/i,
  /Dear Mark/
];

for (const re of forbiddenSpecialCaseLanguage) {
  assert(!re.test(main), `forbidden special-case wording found in grade-ielts.js: ${re}`);
  assert(!re.test(boundary), `forbidden special-case wording found in boundary adjudicator: ${re}`);
  assert(!re.test(lowband), `forbidden special-case wording found in lowband scorer: ${re}`);
}

const forbiddenLocalScoreAdjustments = [
  /finalBand\s*=\s*Math\.max\s*\(\s*finalBand\s*,\s*5(?:\.0)?\s*\)/,
  /overallBand\s*=\s*Math\.max\s*\(/,
  /criteria\s*\[[^\]]+\]\s*=\s*finalBand/,
  /criteria\s*\.taskResponse\s*=\s*finalBand/,
  /criteria\s*\.coherenceCohesion\s*=\s*finalBand/,
  /criteria\s*\.lexicalResource\s*=\s*finalBand/,
  /criteria\s*\.grammarRangeAccuracy\s*=\s*finalBand/
];

for (const re of forbiddenLocalScoreAdjustments) {
  assert(!re.test(main), `forbidden local scoring adjustment found in grade-ielts.js: ${re}`);
  assert(!re.test(boundary), `forbidden local scoring adjustment found in boundary adjudicator: ${re}`);
  assert(!re.test(lowband), `forbidden local scoring adjustment found in lowband scorer: ${re}`);
}

console.log('PASS Task 1 neutral functional Band 5 calibration static test.');
