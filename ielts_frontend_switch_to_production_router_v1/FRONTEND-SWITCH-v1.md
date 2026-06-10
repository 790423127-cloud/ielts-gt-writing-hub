# Frontend Switch v1 — Production Router v2.1

## Goal

Switch the browser UI from:

```text
/api/grade-ielts
```

to:

```text
/api/grade-ielts-production-router
```

## Files modified by the patcher

```text
script.js
index.html
```

## What changes

1. Adds a frontend default endpoint:

```js
const DEFAULT_GRADING_ENDPOINT = "/api/grade-ielts-production-router";
```

2. Migrates old saved localStorage value:

```text
/api/grade-ielts
```

to:

```text
/api/grade-ielts-production-router
```

3. Updates the endpoint input placeholder in `index.html`.

## Apply

From project root:

```bash
node ielts_frontend_switch_to_production_router_v1/apply-frontend-router-switch.cjs
```

Or double-click:

```text
ielts_frontend_switch_to_production_router_v1/apply-frontend-router-switch.bat
```

## Commit

```bash
git add script.js index.html ielts_frontend_switch_to_production_router_v1
git commit -m "Switch frontend grading to production router"
git push origin main
```

## After deployment

Open the site and verify the endpoint field shows:

```text
/api/grade-ielts-production-router
```

Then submit:
- one boundary sample
- one mid-band sample
- one high-band sample
