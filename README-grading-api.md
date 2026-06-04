# IELTS Writing Grading API

This repository includes a Vercel Serverless Function for IELTS General Training Writing feedback.

The grading backend now uses the Gemini API. The GitHub Pages frontend does not call Gemini directly and must not contain any API key.

## Files

- `api/grade-ielts.js`: POST API for IELTS grading and revision.
- `vercel.json`: Vercel function config.
- `package.json`: minimal Node project metadata.

## Environment Variables

Set this required variable in Vercel:

```text
GEMINI_API_KEY=your_gemini_api_key
```

Optional:

```text
GEMINI_MODEL=gemini-2.5-flash
```

If `GEMINI_MODEL` is not set, the API defaults to `gemini-2.5-flash`.

Do not put API keys in `index.html`, `script.js`, `style.css`, or any GitHub Pages public file.

## Deploy to Vercel

1. Open Vercel and import this GitHub repository.
2. Add `GEMINI_API_KEY` in Project Settings -> Environment Variables.
3. Deploy or redeploy the project.
4. After deployment, copy the API URL:

```text
https://your-vercel-project.vercel.app/api/grade-ielts
```

5. Open the GitHub Pages site.
6. Paste that URL into `Grading API Endpoint`.

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
- `disclaimer`

The score and revisions are AI-generated estimates, not official IELTS results.
