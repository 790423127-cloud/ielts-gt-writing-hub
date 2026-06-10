# Boundary Adjudicator v3

This patch updates the separate preview endpoint:

`/api/grade-ielts-boundary-adjudicator`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- `/api/grade-ielts-highband`

## Why v3 exists

v2 fixed the target-4.0 problem, but it over-compressed some target-5.5 samples to 4.5.

v3 keeps the useful part of v2, but scopes it narrowly.

## Main change

The strict low-4/basic-5 separator applies only when:

- mainScore = 5.0
- lowbandScore <= 4.0

In that case, the adjudicator should be skeptical of `basic_5` and check whether the writing is really only `boundary_4_5`.

## Protection for 5.5+

When:

- mainScore >= 5.5
- lowbandScore is low

v3 does not apply the strict low-4/basic-5 separator.

Instead it uses balanced review:

- check whether main over-rewarded fluency/format
- check whether lowband over-penalised simple but adequate writing
- do not push below 5.0 unless the writing is genuinely low-band

## AI-only rule

No local averaging, capping, flooring, or numerical adjustment is used.

The final score is one of:

- main system AI score
- lowband shadow AI score
- boundary adjudicator AI score

## Version

`boundary-adjudicator-v3-scoped-low4-5plus-balance`
