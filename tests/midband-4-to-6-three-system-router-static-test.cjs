const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }

const router = read('api/grade-ielts-production-router.js');
const midbandCore = read('api/grade-ielts.js');
const midbandEndpoint = read('api/grade-ielts-midband.js');
const lowband = read('api/grade-ielts-lowband.js');
const boundary = read('api/grade-ielts-boundary-adjudicator.js');

[
  'production-router-v3-1-true-midband-default-hard-lowband-only',
  '/api/grade-ielts-midband',
  'hasHardLowbandEvidence',
  'LOWBAND_NOT_CALLED_FOR_ORDINARY_BAND5',
  'lowband-hard-evidence-guard',
  'boundaryAdjudicatorRetiredFromProduction',
  'localHeuristicAdjustedFinalBand: false',
  'localHeuristicAdjustedCriterionScores: false'
].forEach((phrase) => assert(router.includes(phrase), `Router missing phrase: ${phrase}`));

assert(!/boundaryCall\s*=\s*await\s+callJsonWithRetry/.test(router), 'Production router must not call boundary adjudicator as ordinary final scorer.');
assert(!/mainBand\s*<=\s*5\.0[\s\S]{0,220}useLowbandGuard:\s*true/.test(router), 'Router must not call lowband merely because midband/main score is <= 5.0.');
assert(!/finalBand\s*=\s*Math\.max/.test(router + midbandCore + midbandEndpoint + lowband + boundary), 'Forbidden local floor found.');
assert(!/overallBand\s*=\s*Math\.max/.test(router + midbandCore + midbandEndpoint + lowband + boundary), 'Forbidden local overall floor found.');

[
  'score-core-v8-5-8-midband-4-to-6-calibration',
  'MIDBAND_4_TO_6_CALIBRATION_RULES',
  'Band 5.0 Task 1',
  'Band 5 does not mean error-free',
  'Band 5 may still contain many non-blocking errors',
  'For sophisticated but partially off-task essays, do not flatten all criteria',
  'isMidbandPrimaryScoringRequest',
  'bypassBoundaryReviewForMidband',
  'mandatoryBoundaryReviewSkipped'
].forEach((phrase) => assert(midbandCore.includes(phrase), `Midband core missing phrase: ${phrase}`));

[
  'midbandPrimary: true',
  'skipMandatoryBoundaryReview: true',
  'requestedScoringSystem: "midband"'
].forEach((phrase) => assert(midbandEndpoint.includes(phrase), `Midband endpoint missing phrase: ${phrase}`));

[
  'score-core-v8-5-9-lowband-hard-evidence-guard',
  'LOWBAND GUARD',
  'not suppress ordinary Band 5 writing',
  'trueLowBand should be false'
].forEach((phrase) => assert(lowband.includes(phrase), `Lowband guard missing phrase: ${phrase}`));

[
  'boundary-adjudicator-v4-5-diagnostic-only-midband-retired',
  'diagnostic-only',
  'Production router v3 no longer uses this endpoint'
].forEach((phrase) => assert(boundary.includes(phrase), `Boundary diagnostic endpoint missing phrase: ${phrase}`));

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
    fetch,
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

const audit = loadAuditExports('api/grade-ielts-production-router.js', ['routeReason', 'shouldUseLowbandFinal', 'directMainPayload']);
assert(audit.routeReason(5.5, 'Task 1', { yes: false }).targetSystem === 'midband', '5.5 should be handled by midband directly.');
assert(audit.routeReason(6.5, 'Task 2', { yes: false }).targetSystem === 'midband', '6.5 should be handled by midband directly.');
assert(audit.routeReason(5.0, 'Task 1', { yes: false }).useLowbandGuard === false, '5.0 ordinary Task 1 should not use lowband guard.');
assert(audit.routeReason(5.0, 'Task 2', { yes: false }).useLowbandGuard === false, '5.0 ordinary Task 2 should not use lowband guard.');
assert(audit.routeReason(4.5, 'Task 1', { yes: true, reason: 'TASK1_UNDER_80_WORDS' }).useLowbandGuard === true, 'Hard lowband evidence should trigger lowband guard.');
assert(audit.routeReason(7.0, 'Task 2', { yes: false }).useHighbandShadow === true, '7.0 should trigger highband confirmation.');
assert(audit.routeReason(4.5, 'Task 1', { yes: false }).useBoundary === false, '4.5 ordinary script should not route to boundary in production router v3.1.');

const trueLow = { lowBandDecision: 'band_3_5', lowBandAudit: { trueLowBand: true, weakLanguage: true, thinDevelopment: true } };
const notLow = { lowBandDecision: '5_plus', lowBandAudit: { trueLowBand: false, weakLanguage: false, thinDevelopment: false } };
assert(audit.shouldUseLowbandFinal(5.0, 3.5, trueLow) === true, 'AI-confirmed hard lowband should be selectable as final.');
assert(audit.shouldUseLowbandFinal(5.0, 4.5, notLow) === false, 'Simple Band 5 writing should not be suppressed by lowband guard.');

console.log('PASS midband 4-6 three-system router static test v3.1');
