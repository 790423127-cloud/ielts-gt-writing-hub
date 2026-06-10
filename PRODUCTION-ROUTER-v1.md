# IELTS Production Router v1

Version:

`production-router-v1-boundary-v4-3-freeze`

## Purpose

This endpoint connects the frozen Boundary Adjudicator v4.3 into the production scoring flow without modifying the existing main scorer.

New endpoint:

```text
/api/grade-ielts-production-router
```

## Routing policy

1. Call main scorer first: `/api/grade-ielts`
2. Read main score.
3. If main score is 4.0–5.5, call frozen boundary adjudicator:
   - `/api/grade-ielts-boundary-adjudicator`
   - version expected: `boundary-adjudicator-v4-3-task1-anchor-calibration`
4. If main score is above 5.5, return main score directly.
5. If main score is below 4.0, return main score directly.

## Why 4.0–5.5

Boundary Adjudicator v4.3 was frozen on Boundary Corpus v2.3:

```text
18/20
90%
4.0: 4/4
4.5: 6/6
5.0: 5/5
5.5: 3/3
```

The 3.5 range is documented as a known limitation and is not routed through v4.3 by default.

## No destructive changes

This patch does not modify:

```text
api/grade-ielts.js
api/grade-ielts-lowband.js
api/grade-ielts-highband.js
api/grade-ielts-boundary-adjudicator.js
```

It only adds:

```text
api/grade-ielts-production-router.js
```

## Response metadata

The router response includes:

```text
productionRouter: true
routerVersion: production-router-v1-boundary-v4-3-freeze
routeDecision
routeZone
finalSource
main
boundary
routingAudit
```
