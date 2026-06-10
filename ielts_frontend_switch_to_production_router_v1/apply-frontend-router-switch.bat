@echo off
cd /d "%~dp0"
cd ..
node ielts_frontend_switch_to_production_router_v1\apply-frontend-router-switch.cjs
pause
