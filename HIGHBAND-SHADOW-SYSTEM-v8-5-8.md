# High-band Shadow System v8.5.8

This commit adds a separate high-band shadow scoring endpoint:

`/api/grade-ielts-highband`

It does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- the v4.4 sub-8 frozen baseline
- the low-band v1.2 baseline

## Purpose

The endpoint tests IELTS GT Writing high-band calibration for Band 7.5-9.0.

It is AI-only. The server validates the AI-returned four criterion bands and mechanically averages them. It does not locally cap, floor, lift or lower scores.

## Version

`score-core-v8-5-8-highband-shadow-system`

## Endpoint

`POST /api/grade-ielts-highband`

## Safety

This is a shadow endpoint. It returns:

- `shadowMode: true`
- `highBandShadow: true`
- `productionScoreChanged: false`

The production score is not changed by this endpoint.
