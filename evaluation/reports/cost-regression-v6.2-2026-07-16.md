# v6.2 cost regression

Date: 2026-07-16

## Implemented controls

- Two independent AI examiners always score the original response.
- The low/middle/high specialist and meta-adjudicator run only for material AI-panel disagreement.
- Matching four-criterion profiles do not, by themselves, trigger two extra calls.
- The meta-adjudicator receives compact evidence summaries.
- All four frozen-band feedback reports are generated in one Flash call; one Pro repair is allowed only if the batch is incomplete.
- Local code routes, validates and averages AI-returned bands. It does not set, lift, lower, floor, cap or rewrite any criterion band.

## Stable Band 6 live comparison

| Metric | Before | v6.2 | Change |
|---|---:|---:|---:|
| Overall | 6.0 | 6.0 | unchanged |
| Core AI calls | 4 | 2 | -50.0% |
| Core tokens | 30,550 | 11,600 | -62.0% |
| Elapsed time | 52,050 ms | 15,053 ms | -71.1% |

The v6.2 criterion profile was 6.0 / 6.0 / 5.5 / 6.0. The half-band criterion variation came from the selected AI examiner; local code did not create it.

## Six-response band-ladder comparison

The same six sample IDs were extracted from the earlier 76-response v6.1 report and compared with the v6.2 run.

| Metric | v6.1 | v6.2 | Change |
|---|---:|---:|---:|
| Blind-reference Overall MAE | 1.000 | 1.000 | no degradation |
| Average core AI calls | 4.00 | 3.33 | -16.7% |
| Average core tokens | 31,010.5 | 22,671.5 | -26.9% |
| Average elapsed time | 65,968.8 ms | 53,288.8 ms | -19.2% |

Four of six responses retained the full specialist/meta-adjudicator path. Two stable responses used only the independent examiners.

Source reports:

- `band-ladder-2026-07-16T13-04-41-685Z.json`
- `band-ladder-2026-07-16T15-02-09-962Z.json`

## Batch feedback live check

| Metric | Result |
|---|---:|
| Generated criteria | 4/4 |
| AI calls | 1 |
| Model | `deepseek-v4-flash` |
| Tokens | 4,514 |
| Pro fallback | not used |
| Frozen bands preserved | yes |

## Interpretation

This proves a measurable cost reduction, not perfect scoring accuracy. The 95-response static corpus is complete and the earlier 19-response blind-reference holdout remains available, but the strict accuracy gates were not all passed. Savings also vary with model disagreement: genuinely disputed boundary essays intentionally retain the full four-call score path.
