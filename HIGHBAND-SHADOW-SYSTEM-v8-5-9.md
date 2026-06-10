# High-band Shadow System v8.5.9 — Band 9 Unlock Calibration

This patch updates the separate high-band shadow endpoint:

`/api/grade-ielts-highband`

It does **not** modify:

- `/api/grade-ielts`
- `/api/grade-ielts-lowband`
- the v4.4 sub-8 frozen baseline
- the low-band v1.2 baseline

## Why this version exists

v8.5.8 passed 12/16 on the high-band v1 corpus. The four failures were all Band 9 samples being scored as Band 8.

v8.5.9 keeps the same endpoint but changes the AI-only high-band calibration prompt to remove the Band 9 ceiling.

## Version

`score-core-v8-5-9-highband-band9-unlock-calibration`

## Safety

This remains a shadow endpoint:

- `shadowMode: true`
- `highBandShadow: true`
- `productionScoreChanged: false`

The server still only validates AI-returned criterion bands and mechanically averages them. It does not locally cap, floor, raise or lower scores.

## Test

After deployment is Ready, run:

`highband-shadow-test\run-highband-shadow-v1-full-16-test-NO-WSH.bat`

Target result:

- 14/16 or better: promising
- 15/16 or 16/16: freeze candidate
- If Band 7.5 starts getting inflated to 8.5/9, the prompt is too loose
