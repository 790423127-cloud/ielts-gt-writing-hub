# High-band Shadow System v8.5.11 — Balanced Exact 9 Review

This patch updates only the separate shadow endpoint:

`/api/grade-ielts-highband`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- production scoring
- low-band shadow scoring
- sub-8 frozen baseline

## Why v8.5.11 exists

v8.5.10 proved that exact Band 9 can be produced, but the tests showed two calibration issues:

1. Extreme Task 1 Band 9 anchors were still being held at Band 8.
2. Some ordinary high-band 8.5 samples in the 16-sample corpus reached Band 9.

v8.5.11 makes the exact-9 review more balanced:

- Task 1 may trigger second-pass review from first-pass Band 8 when high-band signals are strong.
- Task 2 remains more conservative and normally requires first-pass 8.5+.
- The second pass can choose:
  - `keep_first`
  - `upgrade_to_8_5`
  - `promote_to_9`

## AI-only rule

The server does not locally lift, cap, floor, or deduct scores.

It only routes high-signal answers to a second AI review and then uses the second AI's returned criteria only when the second AI explicitly selects `upgrade_to_8_5` or `promote_to_9`.

The final score remains a mechanical average of the selected AI-returned criteria.

## Version

`score-core-v8-5-11-highband-balanced-exact9-review`
