#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "========================================"
echo " IELTS GT Writing Hub - One Click Push"
echo "========================================"
echo

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: Git is not installed or not in PATH."
  echo "Install Git first: https://git-scm.com/downloads"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: This folder is not a Git repository."
  echo "Please run this file from the project root folder."
  exit 1
fi

echo "Checking JavaScript syntax..."
if command -v node >/dev/null 2>&1; then
  [ -f "api/grade-ielts.js" ] && node --check "api/grade-ielts.js"
  [ -f "api/writing-feedback.js" ] && node --check "api/writing-feedback.js"
  [ -f "api/essay-generator.js" ] && node --check "api/essay-generator.js"
  [ -f "script.js" ] && node --check "script.js"
else
  echo "WARNING: Node.js is not installed, so JS syntax checks were skipped."
fi

echo
echo "Git status:"
git status --short
echo

read -r -p "Commit message [Update IELTS GT Writing Hub]: " COMMIT_MSG
COMMIT_MSG=${COMMIT_MSG:-Update IELTS GT Writing Hub}

echo
echo "Adding safe project files..."
git add .

echo
echo "Checking for sensitive files accidentally staged..."
if git diff --cached --name-only | grep -Ei '(^\.env|\.env|secret|token)' >/dev/null 2>&1; then
  echo "ERROR: A possible secret/env file is staged. Unstaging sensitive files..."
  git reset .env .env.* '*.env' 2>/dev/null || true
  echo "Please check git status manually before pushing."
  git status --short
  exit 1
fi

if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

echo
echo "Creating commit..."
git commit -m "$COMMIT_MSG"

echo
echo "Pushing to GitHub..."
git push

echo
echo "SUCCESS: Code pushed to GitHub."
