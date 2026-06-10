# High-band Shadow System v8.5.10 — Exact 9 Review Pass

This patch updates the separate high-band shadow endpoint:

`/api/grade-ielts-highband`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- v4.4 sub-8 frozen baseline
- Low-band v1.2 baseline

## Why this version exists

v8.5.9 fixed removed low-band prompt contamination and moved target Band 9 samples from 8 to mostly 8.5. However, the system still produced no exact 9:

- exact9Count: 0
- exact9OnTarget9: 0/4
- target-9 >= 8.5: 3/4

v8.5.10 adds an AI-only second pass for exact Band 9 review.

## Mechanism

1. Main high-band pass scores the response.
2. If the main pass returns 8.5+ and high-band audit signals are strong, the endpoint triggers an Exact-9 Review AI pass.
3. The final criteria come from the Exact-9 Review only if the second AI explicitly says `promote_to_9` / `promoted: true`.
4. Final score remains a mechanical average of the AI-returned criteria.

No local cap, floor, lift, deduction, or manual score change is applied.

## Version

`score-core-v8-5-10-highband-exact9-review-pass`
