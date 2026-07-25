# Full-range v6.5 validation

Date: 2026-07-17

## What changed

- Removed the scoring-contract example that anchored `highestBandTested` at 8.
- Every Band-8+ criterion must explicitly test Band 9 and preserve its ceiling audit.
- Rejects non-descriptor upper-band demands such as originality, surprising insight, inversion, conditionals, absolute perfection, or conventional transitions without an actual harmful effect.
- Added visual-type calibration: a linear/cyclical process is judged by sequence and grouping and does not require comparisons when none are relevant.
- High-edge production path is now two Flash examiners plus one independent Pro upper-boundary specialist. It does not average their scores and does not feed the Flash bands to the Pro specialist.
- Detailed feedback is Chinese-first, evidence-led, and asks for one meaning-preserving revision instead of generic advice.

## Offline validation

- Core tests: 25/25 passed.
- All 19 legal values (`0, 0.5, ... 9`) survive criterion normalization and Overall calculation.
- 95-response corpus is complete: five responses per 0.5 band, with A/G Task 1/2 coverage.
- A four-criterion AI profile of `9/9/9/9` remains Overall 9 after the real high-zone route in mocked isolation; no local ceiling or promotion exists.

## Live upper-boundary diagnostics

| Sample | Blind reference | v6.5 result | Four criteria | Core calls | Core tokens |
|---|---:|---:|---|---:|---:|
| G Task 2 problem/solution | 9.0 | 8.5 | 8 / 8 / 9 / 8.5 | 3 | 22,858 |
| G Task 1 complaint, before semantic gate | 9.0 | 8.5 | 8 / 8.5 / 9 / 8.5 | 3 | 23,757 |
| G Task 1 complaint, after semantic gate | 9.0 | 9.0 | 9 / 9 / 9 / 8.5 | 3 | 22,111 |

The final run proves that production can return a real Overall 9 from AI criterion scores. The local code did not promote any band. The earlier 8.5 runs also remain valid evidence that the system does not automatically turn every polished response into 9.

## Limits

The 95-response corpus and blind Pro labels are AI-generated validation assets, not official human-examiner ground truth. A full v6.5 live rerun of all 95 responses was deliberately not performed in this pass because it would create substantial API spend. The existing full-range corpus/static tests, prior live ladder runs, and focused current upper-boundary tests provide regression evidence, not a guarantee that every future essay will be within 0.5 of a human examiner.
