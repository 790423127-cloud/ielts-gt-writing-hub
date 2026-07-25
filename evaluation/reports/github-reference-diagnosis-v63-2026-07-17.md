# GitHub cloud reference diagnosis — v6.3

Date: 2026-07-17

## Scope

- Reference: read-only `origin/main` at commit `3ebe471`.
- Cloud reference route: `grade-ielts-production-router` with low/mid/high specialists and boundary adjudication.
- Local candidate route: `/api/grade-writing` in `api/_scoring/`.
- No GitHub commit, push, or cloud-standard modification was performed.

## Root cause

The cloud version is narrowly calibrated around General Training boundaries, especially the common Band 3–7 region. The first unified A/G core used more generic task instructions and skipped extra review whenever two examiners agreed. Two independent models can still share the same boundary bias, so agreement alone is not proof of accuracy. The newer report also produced more uniform four-criterion profiles, which made the sub-scores look mechanical even when the Overall estimate was plausible.

## Four-sample direct comparison before the final profile-prompt refinement

| Sample | Designed target | GitHub reference | New core | Absolute error: GitHub / new |
|---|---:|---:|---:|---:|
| GT Task 1 functional Band 5 sample | 5.0 | 5.5 | 6.0 | 0.5 / 1.0 |
| GT Task 1 low Band 3.5 sample | 3.5 | 3.0 | 4.0 | 0.5 / 0.5 |
| Task 2 Band 6 sample | 6.0 | 6.0 | 6.0 | 0.0 / 0.0 |
| GT Task 1 Band 7 sample | 7.0 | 7.5 | 7.0 | 0.5 / 0.0 |

On this small diagnostic set, both systems had Overall MAE 0.375. This does not establish that either system is globally more accurate. The concrete regression was criterion-profile realism: the GitHub reference returned no four-way uniform profile in these four cases, while the new core returned two.

## v6.3 correction

- Restored task-specific adjacent-band protocols derived from the read-only GitHub reference, with separate Academic Task 1, GT letter, and Task 2 lenses.
- Added AI-only low/high edge safeguards. Local code can request another AI read but cannot move a score.
- Added a dedicated AI criterion-profile reviewer for Band 4–7 uniform candidates. It receives the original response plus criterion-specific evidence and must independently justify all four bands.
- Uniform bands remain legal. The system does not fabricate differences merely to make a report look realistic.
- Preserved the conditional cost path: ordinary differentiated stable samples use two core calls; extra calls are limited to edge, disputed, or uniform-profile cases.

## Interpretation limits

The designed targets and AI reference labels are not official human examiner scores. A four-sample live comparison is a regression diagnostic, not certification. The 95-response ladder remains the broader repeatable test corpus; official reliability claims would require blinded human-examiner labels and repeated runs.
