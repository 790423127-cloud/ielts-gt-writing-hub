# Unified IELTS Writing scoring architecture v6.5

The production entry point is `POST /api/grade-writing`. It supports Academic and General Training Task 1 and Task 2 through one score core.

| Module | Task | `taskKind` | First criterion |
|---|---:|---|---|
| General Training | 1 | `gt_letter` | Task Achievement |
| Academic | 1 | `academic_visual_report` | Task Achievement |
| General Training | 2 | `essay` | Task Response |
| Academic | 2 | `essay` | Task Response |

## Pure-AI score boundary

Local code validates task identity, recomputes word count, checks JSON/evidence structure, routes using AI outputs, selects a complete AI report, and calculates the equal average of its four AI criterion bands. It never sets, lifts, lowers, floors, caps or rewrites a criterion band. Under-length and other local signals are descriptive warnings only.

Stable, differentiated results come directly from one of the independent AI examiner reports. Low/middle disputed results come from the AI meta-adjudicator. High-edge results come from one independent Pro upper-boundary specialist, without feeding the two Flash scores back as target bands. A Band 4–7 uniform non-high candidate is re-read by a dedicated AI criterion-profile reviewer. Feedback is generated only after the final four bands are frozen and cannot change them.

## Conditional three-zone production flow

1. General Examiner A and Examiner B independently read the original question and response in parallel.
2. Local code inspects only their AI-produced reports for material disagreement:
   - Overall difference greater than 0.5;
   - any criterion difference of at least 1.0;
   - multiple criterion differences;
   - rateability conflict;
   - both examiners reporting low confidence;
   - an AI examiner explicitly requesting review;
   - a material gap between task-language judgements;
   - both AI reports sitting at the low (at most Band 2) or high (at least Band 7) edge;
   - upper-boundary criterion disagreement.
3. Matching four-band profiles are permitted. A Band 4–7 uniform final candidate triggers one dedicated AI criterion-profile review rather than the full specialist path by itself.
4. If the panel is stable, one complete AI examiner report is selected using AI confidence and evidence completeness. Its criterion bands are frozen without local modification.
5. If the panel is disputed, one independent low/middle/high AI specialist re-scores the original response without seeing A or B.
6. For low/middle disputes, the AI meta-adjudicator re-reads the original and reviews compact A/B/specialist evidence. It does not vote or average the reports.
7. For a high-edge route, the high specialist uses the Pro model and becomes the final AI score source after completing a Band-9 ceiling audit. This replaces the Flash specialist + Flash meta chain and avoids panel anchoring.
8. If a non-high Band 4–7 final profile is uniform, one AI criterion-profile reviewer re-reads the original response and returns the final four AI bands.
9. The final AI report's four bands are equally averaged and rounded to the nearest half band.
10. One separate batch feedback AI call produces all four bilingual teaching reports against the frozen bands. Flash is the primary model; Pro is used only if the batch fails its evidence/teacher-voice gate.

The routing thresholds use only AI scores. They are not essay heuristics and do not alter the final result.

## Criterion contrast audit

Every scorer identifies the strongest and weakest criterion before assigning numbers. A uniform four-band profile is allowed when the evidence supports it. For Band 4–7 candidates it receives one dedicated AI review using the original response and compact criterion evidence from the prior panel. Local code does not force artificial differences, choose which criterion should move, or rewrite any band.

## Descriptor calibration

The prompt uses whole-band anchors from 0–9 and task-specific lenses. Important guards include:

- Band 0 is reserved for official no-attempt/no-rateable-language conditions;
- no automatic word-count penalty;
- Band 8 allows occasional non-systematic lapses;
- Band 9 is exceptional but attainable and allows extremely rare lapses;
- conventional paragraph structure, explicit transitions, necessary topic-word repetition or absence of decorative inversion are not automatic high-band ceilings;
- upper-band limitations must be recurring or material and supported by the response;
- Academic Task 1 factual claims are checked only against the supplied fact layer.

## Cost controls and measured results

The v6.5 flow reduces repeated reading while spending a stronger model only on the upper boundary. Score authority remains entirely with AI:

- stable differentiated core: 2 examiner calls;
- stable Band 4–7 uniform candidate: 2 examiners + 1 criterion-profile reviewer;
- low/middle disputed core: 2 examiners + 1 zone specialist + 1 meta-adjudicator;
- high-edge core: 2 Flash examiners + 1 independent Pro upper-boundary specialist;
- a structurally incomplete or non-descriptor AI report may receive one semantic retry; audit call counts and tokens include that retry;
- detailed feedback: 1 four-criterion batch call, with at most 1 Pro repair call;
- the meta-adjudicator receives compact evidence summaries instead of duplicate full reports.

Measured on 2026-07-16:

- one stable Band 6 sample remained Overall 6.0 while core calls fell from 4 to 2, tokens from 30,550 to 11,600 (-62.0%), and elapsed time from about 52 seconds to 15 seconds (-71.1%);
- a six-band regression set kept blind-reference Overall MAE at 1.0 while average core tokens fell from 31,011 to 22,672 (-26.9%) and average elapsed time fell from 65.97 seconds to 53.29 seconds (-19.2%);
- a live four-criterion feedback batch completed in one Flash call with 4,514 tokens and preserved every frozen criterion band.

Savings vary with the proportion of genuinely disputed essays. The high-edge path now uses three core calls instead of the previous four-to-five-call Flash chain.

## Legacy three-band files

`api/grade-ielts-lowband.js`, `api/grade-ielts-midband.js`, `api/grade-ielts-highband.js`, the legacy boundary adjudicator and the legacy production router have not been deleted. They remain for compatibility and offline smoke tests. They are not the score source for `/api/grade-writing`; production uses the unified v6.5 conditional core in `api/_scoring/`. The GitHub `origin/main` versions were read only as a calibration reference; this work does not commit, push, or redefine that cloud standard.

## Model configuration

```text
SCORE_EXAMINER_MODEL=deepseek-v4-flash
SCORE_SPECIALIST_MODEL=deepseek-v4-flash
SCORE_HIGH_SPECIALIST_MODEL=deepseek-v4-pro
SCORE_ADJUDICATOR_MODEL=deepseek-v4-flash
SCORE_THREE_ZONE_ENABLED=true
SCORE_CONDITIONAL_REVIEW_ENABLED=true
SCORE_FEEDBACK_MODEL=deepseek-v4-flash
SCORE_FEEDBACK_REPAIR_MODEL=deepseek-v4-pro
```

The provider validates HTTP status, cancellation, timeout, empty output, JSON structure and `finish_reason=length`. A structurally incomplete score report receives at most one semantic AI retry. No partial result is accepted as a score.

## 95-response validation

`evaluation/band-ladder-corpus-v1.json` contains five designed responses for every 0.5 step from Band 0 through 9, covering all four A/G task combinations. Slots 1–4 form a 76-response calibration split; slot 5 forms a 19-response holdout split.

Because an AI writer cannot be treated as ground truth, `build-reference-labels.cjs` shuffles the corpus, replaces filenames with opaque IDs and obtains an independent Pro reference label without exposing author targets or production scores. The validation report preserves both comparisons:

- primary: production score vs blind independent reference;
- diagnostic: production score vs author design target.

The frozen v6.1 holdout run on 2026-07-16 completed 19/19 with no runtime failures. Against the blind reference it achieved Overall MAE 0.579 and criterion MAE 0.612; low Band 0/1 accuracy was 100%. It did not pass every strict gate: within-half-band rate was 57.9% and catastrophic error rate was 10.5%, driven mainly by high-band disagreement between the Pro reference and production panel. This remains an AI-estimate validation, not human-examiner certification.

Official references:

- https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf
- https://ielts.org/cdn/ielts-guides/ielts-writing-key-assessment-criteria.pdf
- https://ielts.org/take-a-test/preparation-resources/writing-test-resources
