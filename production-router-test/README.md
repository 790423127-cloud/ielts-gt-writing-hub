# Production Router v1 Smoke Test

Run after deployment:

```bat
run-production-router-smoke-test-NO-WSH.bat
```

The test calls:

```text
https://ielts-gt-writing-hub.vercel.app/api/grade-ielts-production-router
```

Expected:

- `productionRouter: true`
- `routerVersion: production-router-v1-boundary-v4-3-freeze`
- boundary-zone samples should route to `boundary_v4_3_for_4_0_to_5_5`
- no HTTP failures after retry
