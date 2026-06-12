# IELTS v4.4 — Full Range 3–7 Calibration and Criterion Differentiation

This package updates the v4.3 neutral AI-primary scorer to focus on the realism problem found in Band 3.0–7.0 scoring.

## Main purpose

The previous system could return flat profiles such as `5 / 5 / 5 / 5` for scripts where a real IELTS examiner would often differentiate criteria, for example:

- Task 1: TA/CC may be 5.0 while LR/GRA remain 4.5.
- Task 2: CC may be higher than TR when the essay is organised but ideas are thin.

v4.4 does not add local score floors or sample-specific overrides. It strengthens AI prompt calibration and adds a 3–7 gold corpus for testing.

## Key changes

1. Adds `criterionDifferentiationRealismProtocolV44(task)` to the score kernel and criterion-differentiation review prompt.
2. Re-runs the criterion-differentiation review for identical 4.0–7.0 criterion profiles.
3. Adds a full Task 1 + Task 2 corpus from Band 3.0 to 7.0 in 0.5 increments.
4. Adds a static calibration test and an optional live endpoint audit runner.
5. Keeps v4.3 neutral stance: no corrected-essay bonus, no Dear Mark special case, no local Band 5 floor.

## New files

- `tests/fixtures/full-range-3-to-7-gold-corpus-v1.json`
- `tests/full-range-3-to-7-v4-4-static-test.cjs`
- `tests/run-full-range-3-to-7-live-audit.cjs`
- `README-FULL-RANGE-3-TO-7-CALIBRATION-V4-4.md`

## Static test commands

```bash
node --check api/grade-ielts.js
node --check api/grade-ielts-production-router.js
node --check api/grade-ielts-midband.js
node --check api/grade-ielts-lowband.js
node --check api/grade-ielts-highband.js
node --check api/grade-ielts-boundary-adjudicator.js

node tests/full-range-3-to-7-v4-4-static-test.cjs
node tests/midband-neutral-ai-primary-v4-3-static-test.cjs
node tests/midband-ai-primary-v4-2-static-test.cjs
node tests/midband-balanced-v4-1-static-test.cjs
node tests/midband-core-cleanup-advisory-audit-static-test.cjs
node tests/real-three-system-midband-routing-static-test.cjs
node tests/task1-corrected-friend-visit-band5-static-test.cjs
```

## Optional live AI calibration

After deployment or local server startup:

```bash
IELTS_TEST_ENDPOINT=http://localhost:3000/api/grade-ielts-production-router node tests/run-full-range-3-to-7-live-audit.cjs
```

or for Vercel:

```bash
IELTS_TEST_ENDPOINT=https://ielts-gt-writing-hub.vercel.app/api/grade-ielts-production-router node tests/run-full-range-3-to-7-live-audit.cjs
```

The live runner writes JSON and CSV reports to `tests/reports/`.

## Success expectations

- Most samples should be within ±0.5 of target.
- Midband flat criteria should decrease, especially for functional Band 5 Task 1 letters and organised-but-thin Task 2 essays.
- Ordinary 4–6 samples should remain midband primary.
- No local floor/cap/sample-specific scoring should appear.
