# Boundary Adjudicator v1

This patch adds a separate preview endpoint:

`/api/grade-ielts-boundary-adjudicator`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- `/api/grade-ielts-highband`

## Purpose

The boundary test showed that the main system and low-band shadow system conflict frequently in the 4.0-5.5 zone.

Boundary Adjudicator v1 calls both:

- main system: `/api/grade-ielts`
- lowband shadow: `/api/grade-ielts-lowband`

Then it applies routing rules.

If there is no serious conflict, it selects a score source.

If there is a serious conflict, it calls a third AI boundary adjudicator.

## Key rules

- Do not average main and lowband.
- Use lowband as a confirmation signal in clear low-band cases.
- Use main in safe 5.5+ cases.
- Use the adjudicator when:
  - main = 4.5 and gap >= 1.0
  - main = 5.0 and lowband is low / gap is large
  - main >= 5.5 but lowband is very low
  - Task 1 main is high while lowband is much lower
  - gap >= 1.5

## AI-only rule

The final score is either:

- an AI score from the main system
- an AI score from the lowband shadow system
- an AI score from the boundary adjudicator

No local averaging, capping, flooring, or numerical adjustment is used.

## Version

`boundary-adjudicator-v1-main-lowband-conflict-router`
