# High-band Shadow System v8.5.13 — Near-9 Review Router

This patch updates only the separate shadow endpoint:

`/api/grade-ielts-highband`

It does not modify production scoring or the low-band endpoint.

## Why v8.5.13 exists

v8.5.12 gave a very strong 16-sample high-band result:

- 16/16 passed
- can still produce 9 in the ordinary high-band corpus

But the Extreme 9 diagnostic still produced:

- exact9OnTarget9 = 0/4
- band85SamplesExact9 = 0

So v8.5.13 keeps the v8.5.12 tightened exact-9 review, but adds a near-9 routing path for first-pass Band 8 responses with very strong high-band audit signals.

## Important

The new route does not raise a score. It only sends a high-signal response to a second AI review.

The final score changes only if the second AI explicitly returns `promote_to_9` and supplies criteria that mechanically average to 8.5 or 9.

## Changes from v8.5.12

- Keep no `upgrade_to_8_5`.
- Keep tightened exact-9 review.
- Add near-9 review route:
  - first pass = 8
  - strong audit signals
  - mostly soft/minor objections
- Add special Task 1 near-9 route, because concise Band 9 letters were repeatedly held at 8.

## Version

`score-core-v8-5-13-highband-near9-review-router`
