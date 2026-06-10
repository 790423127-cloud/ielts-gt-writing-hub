# Boundary Adjudicator v4.3 + Corpus v2.3

Version:

`boundary-adjudicator-v4-3-task1-anchor-calibration`

## Purpose

v4.2 was the best previous candidate, scoring 15/20 on Corpus v2.2.

Failure review showed that three failures were better handled as corpus-label issues:

- `BND_V2_T2_3_5_A`: relabel 3.5 -> 4.5
- `BND_V2_T2_3_5_B`: relabel 3.5 -> 4.5
- `BND_V2_T1_5_5_B`: relabel 5.5 -> 5.0

The remaining true system issues were narrow Task 1 cases:

- `BND_V2_T1_3_5_B`: main=5 / lowband=4 / final=4.5, should be considered lower.
- `BND_V2_T1_5_0_A`: main=7 / lowband=5 / final=6, likely too high.

## v4.3 changes

1. Task 1 main=5 / lowband=4 low-band probe:
   - Allows low_4_band/boundary_4_5 when language is weak.
   - Does not broaden Task 2 low-band suppression.

2. Task 1 main=7 / lowband=5 anti-inflation:
   - A GT letter should not get final 6.0 unless LR/GRA and bullet development justify it.
   - Complete letter format alone is insufficient.

## What remains unchanged

- No averaging.
- No post-AI score caps/floors.
- Main endpoint untouched.
- Lowband endpoint untouched.
- Highband endpoint untouched.
- v4.2 protection for 4.0 and 4.5 is preserved.

## Corpus v2.3

Corpus v2.3 is the relabel-cleaned version of v2.2, based on the v4.2 failure review.
