# Boundary Adjudicator v2

This patch updates the separate preview endpoint:

`/api/grade-ielts-boundary-adjudicator`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- `/api/grade-ielts-highband`

## Why v2 exists

Boundary Adjudicator v1 improved the raw main/lowband conflict result to 18/20, but two target-4.0 samples were still promoted to final 5.0.

The problem was specifically the separator between:

- low_4_band / boundary_4_5
- basic_5

v2 keeps the v1 router and adjudicator design, but tightens the 4.0 vs 5.0 boundary.

## Main change

When:

- mainScore = 5.0
- lowbandScore <= 4.0

the adjudicator is instructed to first treat the case as a possible 4.0-4.5 boundary sample.

It may choose `basic_5` only if the response has:

- enough task development
- mostly understandable progression
- errors that are frequent but not continuously disruptive

If the response is short, very simple, thinly developed, or persistently error-prone, it should choose `boundary_4_5` rather than `basic_5`.

## AI-only rule

No local averaging, capping, flooring, or numerical adjustment is used.

The final score is one of:

- main system AI score
- lowband shadow AI score
- boundary adjudicator AI score

## Version

`boundary-adjudicator-v2-strict-low4-basic5-separator`
