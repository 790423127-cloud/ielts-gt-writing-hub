# IELTS Frontend Switch to Production Router v1

Run from the project root after extracting this folder into the project.

```bash
node ielts_frontend_switch_to_production_router_v1/apply-frontend-router-switch.cjs
git diff -- script.js index.html
git add script.js index.html ielts_frontend_switch_to_production_router_v1
git commit -m "Switch frontend grading to production router"
git push origin main
```
