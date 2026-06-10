# IELTS Boundary Corpus v2.3 Blind Rubric Test Tool

This package is based on v2.1 but fixes the testing protocol.

## Key correction

In v2.1 the corpus contained metadata such as title, bandCode, bandGroup and systemScope.  
In v2.3 these remain in the corpus and CSV output, but the runners use a blind API payload.

The API receives only:

- task
- taskType
- scoringTask
- selectedTask
- questionPrompt / promptText
- essay / answer
- wordCount
- corpusVersion

The API does NOT receive:

- targetBand
- expectedMin / expectedMax
- expectedCriteriaBreakdown
- title
- bandCode
- bandGroup
- systemScope
- rubricReference

## Added local rubric fields

Each sample now includes:

- rubricReference.overallDescriptor
- rubricReference.fourCriteria
- rubricReference.whyThisIsNotHigher
- rubricReference.whyThisIsNotLower
- rubricReference.labelRisk

## Corpus file

`boundary_4_0_5_5_corpus_v2_3_relabel_cleaned_20.json`

## Word counts

- BND_V2_T1_3_5_A: Task 1, 155 words
- BND_V2_T1_3_5_B: Task 1, 160 words
- BND_V2_T2_3_5_A: Task 2, 272 words
- BND_V2_T2_3_5_B: Task 2, 277 words
- BND_V2_T1_4_0_A: Task 1, 172 words
- BND_V2_T1_4_0_B: Task 1, 167 words
- BND_V2_T2_4_0_A: Task 2, 252 words
- BND_V2_T2_4_0_B: Task 2, 257 words
- BND_V2_T1_4_5_A: Task 1, 164 words
- BND_V2_T1_4_5_B: Task 1, 161 words
- BND_V2_T2_4_5_A: Task 2, 251 words
- BND_V2_T2_4_5_B: Task 2, 253 words
- BND_V2_T1_5_0_A: Task 1, 170 words
- BND_V2_T1_5_0_B: Task 1, 175 words
- BND_V2_T2_5_0_A: Task 2, 264 words
- BND_V2_T2_5_0_B: Task 2, 258 words
- BND_V2_T1_5_5_A: Task 1, 160 words
- BND_V2_T1_5_5_B: Task 1, 168 words
- BND_V2_T2_5_5_A: Task 2, 272 words
- BND_V2_T2_5_5_B: Task 2, 274 words

## Run order

1. `run-diagnostic-only.bat`
2. `run-boundary-corpus-v2-3-dual-system-test-NO-WSH.bat`
3. `run-boundary-corpus-v2-3-adjudicator-v3-test-NO-WSH.bat`

Direct Node commands:

```bat
node boundary-corpus-v2-3-dual-runner.cjs
node boundary-corpus-v2-3-adjudicator-v4-3-runner.cjs
```

## Output

`boundary-v2-3-results/`

Outputs include JSON, CSV, summary CSV, and TXT log. CSV includes expected, main, lowband and final four-criterion columns.
