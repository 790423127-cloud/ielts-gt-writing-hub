# Latest accepted validation

Accepted report: `live-validation-2026-07-16T08-27-47-701Z-feedback-repaired.json`

The parent v5 run completed all eight A/G Task 1/2 calibration essays. Its four score-quality gates already passed; one Academic Task 1 response had incomplete teaching feedback. A feedback-only retry then filled the missing bilingual fields while preserving the frozen criterion bands (`scoreFieldsChanged: false`).

| Gate | Result | Threshold |
|---|---:|---:|
| Overall MAE | 0.25 | ≤ 0.50 |
| Criterion MAE | 0.438 | ≤ 0.65 |
| Within half a band | 87.5% | ≥ 75% |
| Catastrophic errors (>1 band) | 0% | 0% |
| Feedback completeness | 100% | 100% |
| Completed records | 8 / 8 | 8 / 8 |
| Four-task coverage | pass | A1, A2, G1, G2 |
| Runtime errors | 0 | 0 |

This is a calibration result for the current synthetic benchmark corpus, not evidence that an AI estimate is an official IELTS score.
