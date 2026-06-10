# v8.5.7 Low-band Shadow System

This patch adds a separate low-band experimental endpoint:

```text
/api/grade-ielts-lowband
```

It does **not** modify the production endpoint:

```text
/api/grade-ielts
```

## Purpose

The current v8.5.6 production scoring core is stable for the frozen sub-8 baseline, especially Band 4–7.5. Low-band tests showed that Band 3–4.5 scripts are often lifted to 4–6.5. This endpoint creates a safe shadow scoring path to calibrate low-band writing without risking the current production score.

## Safety rules

- Production scoring remains untouched.
- The new endpoint is separate.
- The new endpoint is AI-only.
- Local code only performs strict hard-zero detection, JSON validation, and mechanical averaging.
- No local cap, floor, lift, lowering, or regression calibration is applied.
- The response contains `shadowMode: true` and `productionScoreChanged: false`.

## Test flow

After deployment, run the lowband shadow test in:

```text
lowband-shadow-test/run-lowband-shadow-v1-1-full-16-test-NO-WSH.bat
```

This test calls:

```text
https://ielts-gt-writing-hub.vercel.app/api/grade-ielts-lowband
```

Do not replace the frozen v4.4 sub-8 baseline with this low-band system. This is a separate calibration lane.
