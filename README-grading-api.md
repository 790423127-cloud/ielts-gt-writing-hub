# IELTS Writing Grading API

This repository includes a Vercel Serverless Function for IELTS General Training Writing feedback.

The recommended grading backend now uses the DeepSeek API. The GitHub Pages frontend does not call DeepSeek directly and must not contain any API key.

## Files

- `api/grade-ielts.js`: POST API for IELTS grading and revision.
- `vercel.json`: Vercel function config.
- `package.json`: minimal Node project metadata.

## Environment Variables

Set these variables in Vercel:

```text
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-flash
```

If `AI_PROVIDER` is not set, the API defaults to `deepseek`.

If `DEEPSEEK_MODEL` is not set, the API defaults to `deepseek-v4-flash`.

Gemini variables such as `GEMINI_API_KEY` and `GEMINI_MODEL` can be removed or left unused.

Do not put API keys in `index.html`, `script.js`, `style.css`, or any GitHub Pages public file.

## Deploy to Vercel

1. Open Vercel and select this project.
2. Go to Project Settings -> Environment Variables.
3. Add `AI_PROVIDER`, `DEEPSEEK_API_KEY`, and optionally `DEEPSEEK_MODEL`.
4. Save the variables.
5. Redeploy the project so Vercel loads the new environment variables.
6. After deployment, use this API URL in the website:

```text
https://your-vercel-project.vercel.app/api/grade-ielts
```

For your current setup, the frontend Grading API Endpoint can be:

```text
https://ielts-gt-writing-hub.vercel.app/api/grade-ielts
```

## Request Body

The frontend sends JSON like this:

```json
{
  "task": "Task 1",
  "book": "Cambridge IELTS 15",
  "test": "Test 1",
  "questionTitle": "Question title",
  "questionPrompt": "Full question prompt",
  "essay": "User essay",
  "wordCount": 180,
  "targetWordCount": 150,
  "isUnderMinimum": false,
  "mode": "revision",
  "includeRevision": true,
  "revisionTargets": ["band5", "band6", "band7"],
  "rubric": {
    "task1": ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
    "task2": ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
  }
}
```

## Response Body

The API returns strict JSON with:

- `overallBand`
- `estimatedLevel`
- `criteria`
- `strengths`
- `mainProblems`
- `grammarErrors`
- `sentenceCorrections`
- `taskAchievementAdvice`
- `coherenceAdvice`
- `lexicalAdvice`
- `grammarAdvice`
- `band5FixPlan`
- `band6UpgradePlan`
- `band7UpgradePlan`
- `modelAnswerOutline`
- `revisedEssayBand5`
- `revisedEssayBand6`
- `revisedEssayBand7`
- `revisionNotes`
- `revisionNotesZh`
- `disclaimer`

The score and revisions are AI-generated estimates, not official IELTS results.
