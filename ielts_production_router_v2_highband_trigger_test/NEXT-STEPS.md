# Next Steps After Highband Trigger Test

## Case A — highband route triggers

If the summary shows:

```text
routerTriggeredHighband: at least 1/8
```

Then Production Router v2 is functionally complete.

Next step:

```text
Frontend switch patch
```

Switch frontend scoring endpoint:

```text
/api/grade-ielts
```

to:

```text
/api/grade-ielts-production-router
```

## Case B — highband route does not trigger, but direct highband works

If:

```text
routerTriggeredHighband: 0/8
directHighband85Plus: strong result
```

Then the highband system works, but main scorer is not giving 7.5+ often enough to trigger it.

Next step:

```text
Production Router v2.1 highband trigger adjustment
```

Recommended conservative adjustment:

```text
mainScore >= 7.0
→ call highband as shadow confirmation
```

Then:

```text
if highbandScore >= 7.5
→ finalSource = highband-shadow-v8-5-14

if highbandScore < 7.5
→ finalSource = main-score
```

## Case C — direct highband also fails

If direct highband scores are low or API fails repeatedly, do not change the router. Re-test or inspect `/api/grade-ielts-highband`.
