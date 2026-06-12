# IELTS Midband Neutral AI-Primary v4.3

This patch removes special-case “corrected Task 1” scoring language and replaces it with neutral current-text Band 5 anchors.

## Goals

- Keep the three-system architecture: lowband, midband, highband, production router.
- Make midband scoring more neutral: score the current response only.
- Keep Band 5 realistic: simple but functional can be 5.0, but surface polish alone is not enough.
- Keep local audits debug-only; do not use local bullet/coverage audit as scoring evidence.
- Keep hard zero restricted to blank or clearly non-English/no-assessable-English responses.
- Keep 6.5 + highbandPotential highband shadow route.

## Replaced language

Removed prompt concepts such as “corrected Task 1”, “corrected low-band letter”, and “previously weak letter”. The scorer now uses neutral current-text rules.

## Checks

```bash
node --check api/grade-ielts.js
node --check api/grade-ielts-production-router.js
node --check api/grade-ielts-midband.js
node --check api/grade-ielts-lowband.js
node --check api/grade-ielts-highband.js
node --check api/grade-ielts-boundary-adjudicator.js

node tests/midband-neutral-ai-primary-v4-3-static-test.cjs
node tests/midband-ai-primary-v4-2-static-test.cjs
node tests/midband-balanced-v4-1-static-test.cjs
node tests/midband-4-to-6-three-system-router-static-test.cjs
node tests/task1-corrected-friend-visit-band5-static-test.cjs
node tests/real-three-system-midband-routing-static-test.cjs
```
