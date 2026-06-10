# IELTS Production Router v2.1 — Highband Shadow Confirmation

Version:

```text
production-router-v2-1-highband-shadow-confirmation
```

## Purpose

Production Router v2.0 only sent responses to the high-band system when the main scorer produced 7.5 or above. The highband trigger test showed that several extreme high-band samples received only `mainScore = 7` even though direct highband scoring returned 8.5 or 9.

v2.1 fixes that by using highband as a shadow confirmation system for 7.0+ main scores.

## Routing policy

```text
mainScore < 4.0
→ main-score

mainScore 4.0–5.5
→ boundary-adjudicator-v4-3

mainScore 6.0–6.5
→ main-score

mainScore >= 7.0
→ call highband shadow confirmation
```

## Highband confirmation rule

```text
if highbandScore >= 7.5:
    finalSource = highband-shadow-v8-5-14
    finalBand = highbandScore

if highbandScore < 7.5:
    finalSource = main-score-highband-not-confirmed
    finalBand = mainScore

if highband API fails:
    finalSource = main-score-highband-fallback
    finalBand = mainScore
```

This avoids blind score inflation because highband must independently confirm 7.5+ before the router adopts the highband score.

## Final source values

```text
main-score
boundary-adjudicator-v4-3
highband-shadow-v8-5-14
main-score-highband-not-confirmed
main-score-highband-fallback
```

## No destructive changes

This patch only replaces:

```text
api/grade-ielts-production-router.js
```

It does not modify the frozen boundary adjudicator, lowband scorer, main scorer, or highband scorer.
