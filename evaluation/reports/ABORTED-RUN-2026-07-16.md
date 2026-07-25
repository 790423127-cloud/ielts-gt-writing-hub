# Aborted live calibration run — 2026-07-16

Status: **not accepted**

The v3 live run completed four of eight samples before the provider returned HTTP 402 (`Insufficient Balance`). The runner exited before it could write its normal JSON report, so the completed stdout observations are preserved here.

| Historical sample | Gold band | v3 predicted | Absolute error | Feedback audit |
|---|---:|---:|---:|---|
| A1-B5.5-table-complete | 5.5 | 6.5 | 1.0 | pass |
| A1-B7-table-complete | 7.0 | 9.0 | 2.0 | fail |
| A2-B5.5-discussion-complete | 5.5 | 6.0 | 0.5 | pass |
| A2-B7-discussion-complete | 7.0 | 8.5 | 1.5 | pass |

The partial results show a high-band inflation problem and do not satisfy the acceptance gates. They must not be presented as a successful validation.

Follow-up changes:

- Added an explicit Band 8/9 ceiling audit to scoring prompt v4.
- Rewrote the four intended Band 7 benchmark responses so their language and development represent a defensible Band 7 rather than near-model-answer prose.
- Changed the live runner to preserve incomplete runs, runtime errors and expected/completed record counts in its JSON report.
- Kept criterion bands frozen during feedback repair and retained exact-quote completeness checks.

Because the benchmark essays changed after this diagnostic run, these historical scores are not directly comparable with the revised v4 corpus. A fresh eight-sample live run is required after the provider balance is restored.
