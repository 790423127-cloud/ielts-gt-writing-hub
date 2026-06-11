# Boundary Adjudicator v4.2 Hybrid

Version:

`boundary-adjudicator-v4-2-hybrid-low4-task1-55-guard`

## Why v4.2 exists

v4 improved Boundary Corpus v2.2 from 7/20 to 14/20.

v4.1 tried to add low-4 probing and 5.5 protection, but it dropped to 12/20 because broad `basic_5` rescue reopened inflation in 4.0 and 4.5 samples.

v4.2 goes back to v4 as the base and adds only narrow corrections.

## Design

Base:

- v4 anti-inflation behavior.
- Preserve 4.0 and 4.5 protection.

Narrow additions:

1. Task 1 low-4 deep probe:
   - Only mainly affects weak Task 1 cases around main 4.5 / lowband 3.5-4.0.
   - Allows final 3.5-4.0 when language is genuinely weak.

2. Cautious 5.5 protection:
   - If main is 6+ and lowband is 4, do not automatically force 4.5.
   - Allow 5.0/5.5 only if task fulfillment, detail, progression, and LR/GRA justify it.

Removed:

- Broad v4.1 `basic_5` rescue.
- Any automatic lift based on full length, paragraph count, clear opinion, or letter format.

## No local hard score control

- No averaging.
- No post-AI cap/floor.
- Final criteria remain AI adjudicator output.
