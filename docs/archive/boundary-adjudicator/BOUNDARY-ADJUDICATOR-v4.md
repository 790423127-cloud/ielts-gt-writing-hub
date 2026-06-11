# Boundary Adjudicator v4

Version:

`boundary-adjudicator-v4-lowband-anchored-anti-inflation`

## Purpose

v4 fixes the failure discovered by Boundary Corpus v2 / v2.1 / v2.2:

- main scorer over-rewards low and lower-boundary full-length samples;
- v3 adjudicator follows main too easily when main is high and lowband is low;
- 3.5-4.5 samples are lifted to 4.5-5.5 too often.

## What changed

1. Main score 4.5 + lowband <= 4.0 now adjudicates instead of using main automatically.
2. Main >= 5.5 + lowband <= 4.0 is no longer treated as safe 5.5+.
3. Lowband weak LR/GRA signals trigger anti-inflation review.
4. Prompt now requires safe_5_5_plus to be justified by evidence beyond format, length, or paragraphing.
5. If final LR/GRA would remain 4.0-4.5, safe_5_5_plus is treated as normally inconsistent.

## What did not change

- Main endpoint is untouched.
- Lowband endpoint is untouched.
- Highband endpoint is untouched.
- No averaging of main and lowband.
- No local hard cap/floor is applied after AI adjudication.

## Freeze criteria for v4

On Boundary Corpus v2.2:

- finalInRange should improve from 7/20 toward 14+/20 first.
- target 3.5 should no longer be 0/4.
- target 4.0 should no longer be 0/4.
- target 4.5 should no longer be 0/4.
- target 5.5 should remain mostly protected.
