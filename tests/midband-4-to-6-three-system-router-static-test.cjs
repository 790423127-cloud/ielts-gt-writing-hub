const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }

const router = read('api/grade-ielts-production-router.js');
const midband = read('api/grade-ielts.js');
const lowband = read('api/grade-ielts-lowband.js');
const boundary = read('api/grade-ielts-boundary-adjudicator.js');
const midbandAlias = read('api/grade-ielts-midband.js');

[
  'production-router-v3-0-three-system-midband-primary',
  'midband-with-lowband-guard',
  'midband-primary-lowband-not-confirmed',
  'lowband-hard-evidence-guard',
  'boundaryAdjudicatorRetiredFromProduction',
  'localHeuristicAdjustedFinalBand: false',
  'localHeuristicAdjustedCriterionScores: false'
].forEach((phrase) => assert(router.includes(phrase), `Router missing phrase: ${phrase}`));

assert(!/boundaryCall\s*=\s*await\s+callJsonWithRetry/.test(router), 'Production router must not call boundary adjudicator as ordinary final scorer.');
assert(!/finalBand\s*=\s*Math\.max/.test(router + midband + lowband + boundary), 'Forbidden local floor found.');
assert(!/overallBand\s*=\s*Math\.max/.test(router + midband + lowband + boundary), 'Forbidden local overall floor found.');

[
  'score-core-v8-5-8-midband-4-to-6-calibration',
  'MIDBAND_4_TO_6_CALIBRATION_RULES',
  'Band 5.0 Task 1',
  'Band 5 does not mean error-free',
  'Band 5 may still contain many non-blocking errors',
  'For sophisticated but partially off-task essays, do not flatten all criteria'
].forEach((phrase) => assert(midband.includes(phrase), `Midband scorer missing phrase: ${phrase}`));

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

assert(midbandAlias.includes('require("./grade-ielts")'), 'grade-ielts-midband.js should alias grade-ielts.js.');

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
assert(audit.routeReason(5.5).targetSystem === 'midband', '5.5 should be handled by midband directly.');
assert(audit.routeReason(6.5).targetSystem === 'midband', '6.5 should be handled by midband directly.');
assert(audit.routeReason(5.0).useLowbandGuard === true, '5.0 should use lowband guard check, not boundary adjudicator.');
assert(audit.routeReason(7.0).useHighbandShadow === true, '7.0 should trigger highband confirmation.');
assert(audit.routeReason(4.5).useBoundary === false, '4.5 should not route to boundary in production router v3.');

const trueLow = { lowBandDecision: 'band_3_5', lowBandAudit: { trueLowBand: true, weakLanguage: true, thinDevelopment: true } };
const notLow = { lowBandDecision: '5_plus', lowBandAudit: { trueLowBand: false, weakLanguage: false, thinDevelopment: false } };
assert(audit.shouldUseLowbandFinal(5.0, 3.5, trueLow) === true, 'AI-confirmed hard lowband should be selectable as final.');
assert(audit.shouldUseLowbandFinal(5.0, 4.5, notLow) === false, 'Simple Band 5 writing should not be suppressed by lowband guard.');

console.log('Midband 4-6 three-system router static test passed.');
