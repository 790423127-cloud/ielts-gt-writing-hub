# Production Router v2 Highband Trigger Test

This diagnostic tool verifies whether Production Router v2 actually reaches the high-band route.

Router endpoint:

```text
/api/grade-ielts-production-router
```

Direct highband endpoint:

```text
/api/grade-ielts-highband
```

## Run

```bat
run-diagnostic-only.bat
run-router-v2-highband-trigger-test-NO-WSH.bat
```

## What to check

The key output is:

```text
routerTriggeredHighband: X/8
directHighband85Plus: X/8
directHighbandExact9: X/8
```

## How to interpret

If `routerTriggeredHighband` is greater than 0:

- Production Router v2 highband route is working.
- Then you can proceed to frontend switch.

If `directHighband85Plus` is high but `routerTriggeredHighband` is 0:

- The highband endpoint itself works.
- The router trigger threshold depends on main score.
- Next action is to adjust router trigger logic, for example:
  - `mainScore >= 7.0` + strong highband-style response check, or
  - call highband for `mainScore >= 7.0` as shadow confirmation.

If both are low:

- Do not modify router yet.
- Re-check highband endpoint calibration or sample strength.
