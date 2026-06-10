# IELTS Production Router v2 — Three Systems

Version:

`production-router-v2-three-systems-boundary-v4-3-highband-v8-5-14`

## Purpose

Production Router v2 connects all three scoring systems:

```text
main scorer
boundary adjudicator v4.3
highband shadow v8.5.14
```

Endpoint:

```text
/api/grade-ielts-production-router
```

## Routing policy

```text
mainScore < 4.0
→ main-score
→ 3.5 is known limitation; do not route to boundary v4.3 by default.

mainScore 4.0–5.5
→ boundary-adjudicator-v4-3

mainScore 6.0–7.0
→ main-score

mainScore >= 7.5
→ highband-shadow-v8-5-14
```

## Fallback policy

If highband fails:

```text
finalSource = main-score-highband-fallback
finalBand = mainScore
```

This prevents production scoring from failing due to temporary highband 500/502 errors.

## Final source values

```text
main-score
boundary-adjudicator-v4-3
highband-shadow-v8-5-14
main-score-highband-fallback
```

## No destructive changes

This patch only replaces:

```text
api/grade-ielts-production-router.js
```

It does not modify:

```text
api/grade-ielts.js
api/grade-ielts-lowband.js
api/grade-ielts-highband.js
api/grade-ielts-boundary-adjudicator.js
```
