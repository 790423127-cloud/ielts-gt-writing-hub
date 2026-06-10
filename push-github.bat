@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo  IELTS GT Writing Hub - One Click Push
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or not in PATH.
  echo Install Git first: https://git-scm.com/downloads
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo ERROR: This folder is not a Git repository.
  echo Please run this file from the project root folder.
  pause
  exit /b 1
)

echo Checking JavaScript syntax...
if exist "api\grade-ielts.js" node --check "api\grade-ielts.js"
if errorlevel 1 goto syntax_failed
if exist "api\writing-feedback.js" node --check "api\writing-feedback.js"
if errorlevel 1 goto syntax_failed
if exist "api\essay-generator.js" node --check "api\essay-generator.js"
if errorlevel 1 goto syntax_failed
if exist "script.js" node --check "script.js"
if errorlevel 1 goto syntax_failed

echo.
echo Git status:
git status --short
echo.

set /p COMMIT_MSG=Commit message [Update IELTS GT Writing Hub]: 
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Update IELTS GT Writing Hub

echo.
echo Adding safe project files...
git add .

echo.
echo Checking for sensitive files accidentally staged...
git diff --cached --name-only | findstr /R /C:"^\.env" /C:"\.env" /C:"secret" /C:"token" >nul
if not errorlevel 1 (
  echo ERROR: A possible secret/env file is staged. Unstaging sensitive files...
  git reset .env .env.* *.env 2>nul
  echo Please check git status manually before pushing.
  git status --short
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 goto has_changes
echo No changes to commit.
pause
exit /b 0

:has_changes
echo.
echo Creating commit...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo ERROR: Commit failed.
  pause
  exit /b 1
)

echo.
echo Pushing to GitHub...
git push
if errorlevel 1 (
  echo ERROR: Push failed. Check GitHub login, branch permissions, or remote settings.
  pause
  exit /b 1
)

echo.
echo SUCCESS: Code pushed to GitHub.
pause
exit /b 0

:syntax_failed
echo.
echo ERROR: JavaScript syntax check failed. Fix the file above before pushing.
pause
exit /b 1
