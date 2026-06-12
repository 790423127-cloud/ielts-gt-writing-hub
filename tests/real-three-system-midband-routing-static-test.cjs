const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const router = fs.readFileSync(path.join(root, 'api', 'grade-ielts-production-router.js'), 'utf8');
const midband = fs.readFileSync(path.join(root, 'api', 'grade-ielts-midband.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'api', 'grade-ielts.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(router.includes('/api/grade-ielts-midband'), 'router must call grade-ielts-midband first');
assert(!/mainBand\s*<=\s*5\.0[\s\S]{0,220}useLowbandGuard:\s*true/.test(router), 'router must not call lowband for all mainBand <= 5.0');
assert(router.includes('hasHardLowbandEvidence'), 'router must have a hard lowband evidence gate');
assert(router.includes('LOWBAND_NOT_CALLED_FOR_ORDINARY_BAND5'), 'router must document that ordinary Band 5 does not call lowband');
assert(router.includes('averageCriteriaBand'), 'router must mechanically normalise finalBand from selected AI criteria');
assert(midband.includes('midbandPrimary: true'), 'midband endpoint must mark requests as midbandPrimary');
assert(midband.includes('skipMandatoryBoundaryReview: true'), 'midband endpoint must request boundary-review bypass');
assert(core.includes('isMidbandPrimaryScoringRequest'), 'core scorer must recognise midband primary requests');
assert(core.includes('bypassBoundaryReviewForMidband'), 'core scorer must implement midband boundary-review bypass');
assert(core.includes('mandatoryBoundaryReviewSkipped'), 'core scorer must audit skipped mandatory boundary review');
assert(!/Math\.max\s*\(\s*finalBand\s*,\s*5/.test(router + midband + core), 'no local Band 5 floor is allowed');
assert(!/Dear\s+Mark/.test(router + midband + core), 'no sample text special case is allowed');

console.log('PASS real three-system midband routing static test');
