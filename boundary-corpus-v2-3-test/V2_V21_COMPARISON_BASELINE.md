# V2 vs V2.1 Comparison Baseline

## Dual-system

| Metric | V2 | V2.1 |
|---|---:|---:|
| mainInRange | 6/20 | 6/20 |
| lowbandInRange | 14/20 | 13/20 |
| bothInRange | 1/20 | 1/20 |
| conflicts | 19/20 | 19/20 |

## Boundary adjudicator v3

| Metric | V2 | V2.1 |
|---|---:|---:|
| finalInRange | 9/20 | 9/20 |
| pass rate | 45% | 45% |
| adjudicated | 20/20 | 19/20 |
| conflicts | 20/20 | 19/20 |

## Interpretation

V2.1 added metadata and expanded criterion columns, but it did not materially change score behavior.

The strongest pattern remains:

- main system is high on low and lower-boundary samples
- lowband is closer for 3.5-4.5 but becomes too strict around 5.0-5.5
- adjudicator v3 protects 5.5 but over-lifts 3.5-4.5 samples

## V2.3 changes

V2.3 is not a score-prompt change. It is a cleaner testing tool:

1. keep title / bandCode / bandGroup / target / rubric local only
2. do not send target metadata to API
3. add rubricReference, why-not-higher, why-not-lower, labelRisk
4. keep expanded four-criterion CSV columns
