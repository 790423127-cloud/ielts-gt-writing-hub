@echo off
cd /d "%~dp0"
echo Router endpoint:
type endpoint-production-router.txt
echo.
echo Direct highband endpoint:
type endpoint-highband.txt
echo.
echo Node version:
node -v
echo.
echo Sample count:
node -e "const s=require('./production-router-v2-highband-trigger-samples.json'); console.log(s.length)"
pause
