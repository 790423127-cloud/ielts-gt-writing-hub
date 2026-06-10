# High-band Shadow System v8.5.14 — Near-9 Router Anti-inflation

This patch updates only the separate shadow endpoint:

`/api/grade-ielts-highband`

It does not modify production scoring or the low-band endpoint.

## Why v8.5.14 exists

v8.5.13 improved the Extreme 9 test:

- exact9OnTarget9 reached 2/4
- Extreme 9 pass rate reached 7/8

But it over-promoted ordinary Task 1 Band 8 samples to exact 9 in the 16-sample high-band corpus.

v8.5.14 keeps the near-9 review route, but tightens the anti-inflation guard.

## Main changes from v8.5.13

- Removed the broad Task 1 route that sent all strong first-pass Band 8 letters to review.
- Kept the near-9 route only when first-pass Band 8 has strong high-band signals and mostly soft/minor objections.
- Added stricter review instructions:
  - do not jump from 8 to 9 unless the first pass is clearly too harsh
  - clear / complete / polite / fluent is not enough for 9
  - ordinary strong Band 8 Task 1 letters must not become 9

## AI-only rule

The server does not locally lift, cap, floor, or deduct scores.

It only routes high-signal responses to a second AI review. The final score uses the second AI's returned criteria only when the second AI explicitly selects `promote_to_9`.

The final score remains a mechanical average of the selected AI-returned criteria.

## Version

`score-core-v8-5-14-highband-near9-router-anti-inflation`
