# v8.5.9 Fixed High-band Band 9 Unlock — Clean Patch

This patch fixes the accidental prompt contamination in `/api/grade-ielts-highband.js`.

## Problem fixed

The previous v8.5.9 file had the correct endpoint name and version label, but the actual AI prompt was a low-band prompt. This caused high-band samples to be scored around Band 5.

## Correct behavior

This file now uses:

`highBandPrompt(...)`

and tests:

`Band 7.5-9.0`

It removes the low-band calibration text from the high-band endpoint.

## Version

`score-core-v8-5-9-fixed-highband-band9-unlock-clean`

## Safety

This still does not modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`

It remains a shadow endpoint:

- `shadowMode: true`
- `highBandShadow: true`
- `productionScoreChanged: false`
