# Final model change log

This is the **human-readable source of truth** for changes that can affect deployed predictor behavior.

Update this file whenever a change touches any of the following:

- training data inputs or derived features
- feature engineering logic or feature allowlists
- model family, calibration, ensemble weighting, or hyperparameters
- inference-time inputs used by `model/predict_fixture.py`
- live overrides or data refresh logic that can change predicted probabilities

Do **not** treat automatic promotion logs as enough on their own. The machine logs are supporting evidence. This file is where we explain:

1. what changed
2. why we changed it
3. how we measured the impact
4. whether the change was promoted, rejected, or reverted

## Required entry format

Copy this block for every material model change:

```md
### YYYY-MM-DD — short change title

- Status: proposed | tested | promoted | rejected | reverted
- Change type: data | feature | training | calibration | ensemble | inference | other
- Hypothesis: one sentence on why this should help

### What changed

- Exact files changed:
- Exact data points / features / rules added, removed, or modified:
- Whether this affects pre_toss, post_toss, or both:

### How we tested it

- Experiment/report paths:
- Baseline artifact or production reference:
- Comparison method: walk-forward | backtest | current-season summary | manual fixture review

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss |          |           |       |
| brier    |          |           |       |
| roc_auc  |          |           |       |
| accuracy |          |           |       |

- Live/current-season effect after promotion:
- Confidence / caveats:

### Decision

- Outcome: promoted | not promoted | reverted
- Why:
- Deployed model source hash after change:
- Supporting evidence:
    - `model/final_models/revision_history.jsonl`
    - `model/data/live/predictor_performance_predictions.jsonl`
    - `model/data/live/predictor_performance_summary.json`
```

## Log

### 2026-04-23 — establish readable model change tracking

- Status: promoted
- Change type: other
- Hypothesis: a human-written changelog will make it easier to explain why the model changed and whether the change actually helped.

### What changed

- Exact files changed: `model/MODEL_CHANGELOG.md`, `model/README-predict.md`
- Exact data points / features / rules added, removed, or modified: no model feature or training behavior changed; this adds required documentation for future model changes.
- Whether this affects `pre_toss`, `post_toss`, or both: both, as process discipline.

### How we tested it

- Experiment/report paths: n/a
- Baseline artifact or production reference: current `model/final_models/`
- Comparison method: documentation/process review

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: none directly; this change is intended to improve future analysis quality.
- Confidence / caveats: this only helps if every future model-affecting change updates this file.

### Decision

- Outcome: promoted
- Why: this creates the readable narrative layer the automatic logs were missing.
- Deployed model source hash after change: document on the next model-affecting promotion or refit.
- Supporting evidence:
    - `model/final_models/revision_history.jsonl`
    - `model/data/live/predictor_performance_predictions.jsonl`
    - `model/data/live/predictor_performance_summary.json`
