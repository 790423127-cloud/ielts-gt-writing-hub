# IELTS Boundary Adjudicator v4.3 Freeze Baseline

## Freeze decision

**Decision:** freeze v4.3 as the Boundary Adjudicator baseline.

**Frozen version:**

```text
boundary-adjudicator-v4-3-task1-anchor-calibration
```

**Corpus used:**

```text
boundary-corpus-v2-3-relabel-cleaned
```

## Final result

```text
Total: 20
finalInRange: 18/20
finalPassRate: 90%
adjudicated: 20/20
conflicts: 20/20
```

## Segment result

| Target band | Pass | Avg final | Avg main | Avg lowband |
|---:|---:|---:|---:|---:|
| 4 | 4/4 | 4.5 | 5.5 | 4 |
| 5 | 5/5 | 4.9 | 5.8 | 4.2 |
| 3.5 | 0/2 | 4.5 | 4.5 | 3.75 |
| 4.5 | 6/6 | 4.5 | 5.42 | 4 |
| 5.5 | 3/3 | 5 | 6.33 | 4.33 |

## Known limitation

We intentionally do **not** continue tuning v4.3 for 3.5 in this freeze.

Reason:

- v4.3 reached 18/20 = 90%.
- 4.0, 4.5, 5.0, and 5.5 are all passing.
- Further 3.5 tuning may damage the already stable 4.0 / 4.5 boundary.
- 3.5 should be handled later with a separate true-low-band mini corpus, not by modifying this freeze baseline.

## Remaining failures

| ID | Task | Target | Final | Main | Lowband | Classification |
|---|---|---:|---:|---:|---:|---|
| BND_V2_T1_3_5_A | Task 1 | 3.5 | 4.5 | 4.5 | 3.5 | boundary_4_5 |
| BND_V2_T1_3_5_B | Task 1 | 3.5 | 4.5 | 4.5 | 4 | boundary_4_5 |

## Frozen files

```text
api/grade-ielts-boundary-adjudicator.js
BOUNDARY-ADJUDICATOR-v4.3.md
boundary-corpus-v2-3-test/*
test-evidence/*
```

## Do not modify as part of this freeze

```text
api/grade-ielts.js
api/grade-ielts-lowband.js
api/grade-ielts-highband.js
```

## Recommended Git commands

```bash
git add api/grade-ielts-boundary-adjudicator.js BOUNDARY-ADJUDICATOR-v4.3.md
git commit -m "Freeze boundary adjudicator v4.3 baseline"
git push origin main
```

Optional tag:

```bash
git tag boundary-adjudicator-v4.3-freeze
git push origin boundary-adjudicator-v4.3-freeze
```

## Verification command after deployment

Run the v2.3 adjudicator test and confirm:

```text
boundary-adjudicator-v4-3-task1-anchor-calibration
18/20
90%
```
