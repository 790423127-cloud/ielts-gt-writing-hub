# High-band Shadow System v8.5.12 — Exact 9 Review Tightened

This patch updates only the separate shadow endpoint:

`/api/grade-ielts-highband`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- production scoring
- low-band shadow scoring
- sub-8 frozen baseline

## Why v8.5.12 exists

v8.5.11 over-corrected and locked exact Band 9 again.

v8.5.12 goes back to the v8.5.10 structure:

- main high-band pass
- exact-9 review pass only
- no `upgrade_to_8_5` middle action
- no Task 1 trigger from first-pass 8

Then it lightly tightens the exact-9 review to reduce ordinary 8.5 -> 9 inflation.

## AI-only rule

The server does not locally lift, cap, floor, or deduct scores.

It only routes high-signal 8.5+ answers to a second AI review. The final score uses the second AI's returned criteria only when the second AI explicitly selects `promote_to_9`.

The final score remains a mechanical average of the selected AI-returned criteria.

## Version

`score-core-v8-5-12-highband-exact9-review-tightened`
