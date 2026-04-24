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

### 2026-04-23 — switch Elo to current-season-only IPL rankings

- Status: tested
- Change type: feature
- Hypothesis: resetting Elo to 1500 each IPL season and updating it only from same-season completed matches should make the ranking signal better reflect current squads instead of stale franchise carryover.

### What changed

- Exact files changed: `src/model-data/derive-features.ts`, `src/model-data/refresh-current-elo.ts`, `model/predict_fixture.py`, `model/README-predict.md`, `model/README-daily-refresh.md`
- Exact data points / features / rules added, removed, or modified: Elo no longer carries previous-season ratings forward; training and live inference now use season-reset Elo only. Added `currentSeasonEloMatches` / `team1_currentSeasonEloMatches` / `team2_currentSeasonEloMatches` so the model can tell how much current-season evidence sits behind each Elo value.
- Whether this affects `pre_toss`, `post_toss`, or both: both.

### How we tested it

- Experiment/report paths: `model/experiments/daily-refresh-runs/20260423-elo-reset-metrics/README.md`, `model/experiments/daily-refresh-runs/20260423-elo-reset-metrics/reports/leaderboard.csv`, candidate `summary_metrics.csv` files under the same run root.
- Baseline artifact or production reference:
  - pre_toss: `model/artifacts/pre_toss/ensemble_catboost__full__delta/summary.json`
  - post_toss: `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3/summary_metrics.csv`
- Comparison method: full `python3 model/run_daily_refresh.py --run-id 20260423-elo-reset-metrics` retrain/backtest with focus split `test`.

### Measured impact

#### pre_toss

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| log_loss | 0.6987 | 0.6940 | -0.0047 |
| brier | 0.2527 | 0.2504 | -0.0023 |
| roc_auc | 0.5300 | 0.5495 | +0.0195 |
| accuracy | 0.5365 | 0.5348 | -0.0018 |

The season-reset Elo helped pre_toss overall: better log loss, Brier, and ROC-AUC, with a very small accuracy drop.

#### post_toss

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| log_loss | 0.6920 | 0.6991 | +0.0071 |
| brier | 0.2492 | 0.2526 | +0.0034 |
| roc_auc | 0.5612 | 0.5436 | -0.0175 |
| accuracy | 0.5691 | 0.5351 | -0.0340 |

The same change hurt post_toss materially against the currently deployed production source experiment.

- Live/current-season effect after promotion: not promoted; code path remains in the branch only, but measured retrain results show the change is not safe to ship unchanged across both modes.
- Confidence / caveats: the concept appears directionally right for pre_toss, but post_toss is currently using historical Elo more effectively than the season-reset version. Early-season sparsity remains a likely cause even with the new Elo match-count features.

### Decision

- Outcome: not promoted
- Why: pre_toss improved, but post_toss regressed materially on all key metrics, so the global switch to current-season-only Elo should not be promoted as-is.
- Deployed model source hash after change: n/a until promoted.
- Supporting evidence:
    - `model/final_models/revision_history.jsonl`
    - `model/data/live/predictor_performance_predictions.jsonl`
    - `model/data/live/predictor_performance_summary.json`

### 2026-04-23 — test 2018+ training window on copied experiment data

- Status: tested
- Change type: training
- Hypothesis: restricting training/history generation to 2018 onward may remove stale early-era IPL signal and improve modern-season generalization.

### What changed

- Exact files changed: `src/model-data/derive-features.ts`, `src/model-data/build-model-matrices.ts`, `model/train_baselines.py`, `model/train_xgboost.py`
- Exact data points / features / rules added, removed, or modified: added experiment-only support for alternate data roots / manifest paths so we can build copied feature+matrix datasets and train against them without touching `model/data/`. Built a copied experiment dataset under `model/experiments/season-cutoff-2018/data` using `--min-season 2018`.
- Whether this affects `pre_toss`, `post_toss`, or both: both, experimentally only.

### How we tested it

- Experiment/report paths: `model/experiments/season-cutoff-2018/README.md`, `model/experiments/season-cutoff-2018/reports/leaderboard.csv`, `model/experiments/season-cutoff-2018/reports/season_metrics.csv`
- Baseline artifact or production reference:
  - pre_toss current-like ensemble comparison built from `model/artifacts_pruned/top60/pre_toss/full` + `model/artifacts/pre_toss/delta`
  - post_toss deployed source experiment `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3`
- Comparison method: copied-data experiment only; no writes to `model/data/`. Generated 2018+ features/matrices under the experiment root, then retrained with `--min-train-seasons 3` so the single walk-forward fold becomes train `2018-2019`, calibration `2023`, validation `2024`, test `2025`.

### Measured impact

#### pre_toss (2025 like-for-like)

Compared against a current-like 0.45/0.55 pre_toss ensemble rebuilt from the present production-style components.

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| log_loss | 0.7010 | 0.6858 | -0.0152 |
| brier | 0.2539 | 0.2463 | -0.0076 |
| roc_auc | 0.4444 | 0.5833 | +0.1389 |
| accuracy | 0.4493 | 0.5507 | +0.1014 |

Best 2018+ pre_toss candidate was the `delta_2018plus` CatBoost model; the 2018+ ensemble collapsed to the full model and was weaker than the delta-only candidate.

#### post_toss (2025 like-for-like)

Compared against the actually deployed production source experiment `post_toss/xgboost_full_recency_h3`.

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| log_loss | 0.6797 | 0.6963 | +0.0166 |
| brier | 0.2433 | 0.2514 | +0.0081 |
| roc_auc | 0.6073 | 0.5593 | -0.0480 |
| accuracy | 0.6377 | 0.5217 | -0.1159 |

The 2018+ cutoff hurt post_toss materially.

- Live/current-season effect after promotion: none; this stayed an experiment and used copied data roots only.
- Confidence / caveats: pre_toss result looks genuinely interesting, but it is based on only one surviving walk-forward test fold after the 2018 cutoff. That is useful signal, not enough evidence for automatic promotion.

### Decision

- Outcome: not promoted
- Why: 2018+ helps pre_toss on the 2025 slice but hurts post_toss materially. Keep this as an experiment only; if we continue, the next step should be a pre_toss-only cutoff experiment with more robustness checks, not a global training-window change.
- Deployed model source hash after change: n/a
- Supporting evidence:
    - `model/experiments/season-cutoff-2018/README.md`
    - `model/experiments/season-cutoff-2018/reports/leaderboard.csv`
    - `model/experiments/season-cutoff-2018/reports/season_metrics.csv`

### 2026-04-23 — sweep post-toss training methods on 2018+ copied data

- Status: tested
- Change type: training
- Hypothesis: even if the first 2018+ post-toss XGBoost run regressed, a different learner / feature mode / ensemble on the same copied 2018+ dataset might recover modern-squad signal and beat the deployed post-toss baseline.

### What changed

- Exact files changed: no additional production behavior changes; reused the copied 2018+ experiment dataset and trainer plumbing already added above.
- Exact data points / features / rules added, removed, or modified: trained multiple post-toss candidates against the copied `2018+` manifest only:
  - CatBoost: `full`, `delta`, `full_no_identity`
  - XGBoost: `full` (uniform), `delta` (uniform), `full_no_identity` (uniform)
  - Ensembles: weighted `catboost_delta + xgboost_delta`, weighted `catboost_delta + catboost_full_no_identity`, stacked `catboost_delta + catboost_full_no_identity + xgboost_delta`
- Whether this affects `pre_toss`, `post_toss`, or both: post_toss only, experimentally.

### How we tested it

- Experiment/report paths: artifacts under `model/experiments/season-cutoff-2018-post-toss-sweep/artifacts/post_toss/`
- Baseline artifact or production reference: deployed source experiment `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3`
- Comparison method: same copied `2018+` dataset, `--min-train-seasons 3`, compare all candidates on the 2025 test slice.

### Measured impact

Deployed post_toss baseline on 2025:

| metric | baseline |
| --- | --- |
| accuracy | 0.6377 |
| roc_auc | 0.6073 |
| log_loss | 0.6797 |
| brier | 0.2433 |

Best 2018+ post_toss candidates:

| candidate | accuracy | roc_auc | log_loss | brier | take |
| --- | --- | --- | --- | --- | --- |
| `catboost_delta_2018plus` | 0.5362 | 0.6120 | 0.6854 | 0.2461 | best single-model probabilistic candidate; slight ROC-AUC win, but still worse log loss/Brier/accuracy than baseline |
| `weighted_cb_delta__xgb_delta_2018plus` | 0.5217 | 0.6187 | 0.6850 | 0.2460 | best ROC-AUC in the sweep, but still worse log loss/Brier/accuracy than baseline |
| `catboost_full_no_identity_2018plus` | 0.5507 | 0.5631 | 0.6877 | 0.2473 | best CatBoost accuracy among the sweep, still materially below baseline |
| `xgboost_delta_uniform_2018plus` | 0.5652 | 0.5438 | 0.6970 | 0.2515 | best raw accuracy among XGBoost sweep, but weak probability quality |

Nothing in the sweep beat the deployed post_toss model on log loss, Brier, and accuracy together.

- Live/current-season effect after promotion: none; experiment only.
- Confidence / caveats: this was a much stronger search than the first single-model 2018+ post-toss attempt, and it still failed to clear the deployed baseline. That makes a simple 2018+ cutoff look unlikely to be the right post-toss direction on its own.

### Decision

- Outcome: rejected
- Why: despite trying multiple learners, feature modes, and lightweight ensembles on copied 2018+ data, none of the post_toss candidates beat the deployed production source experiment on the key probability/error metrics.
- Deployed model source hash after change: n/a
- Supporting evidence:
    - `model/experiments/season-cutoff-2018-post-toss-sweep/artifacts/post_toss/catboost_delta_2018plus/summary_metrics.csv`
    - `model/experiments/season-cutoff-2018-post-toss-sweep/artifacts/post_toss/weighted_cb_delta__xgb_delta_2018plus/summary_metrics.csv`
    - `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3/fold_predictions.csv`

### 2026-04-23 — compare 2018+ season-reset Elo vs carry-over Elo

- Status: tested
- Change type: feature
- Hypothesis: keeping Elo carry-over across included seasons inside a 2018+ dataset might recover useful continuity signal even if full historical training rows are excluded.

### What changed

- Exact files changed: `src/model-data/derive-features.ts`
- Exact data points / features / rules added, removed, or modified: added an experiment-only `--elo-mode season_reset|carry_over` option so copied datasets can compare season-reset Elo versus cross-season carry-over without changing the default production behavior.
- Whether this affects `pre_toss`, `post_toss`, or both: both, experimentally only.

### How we tested it

- Experiment/report paths:
  - season-reset: `model/experiments/season-cutoff-2018/`
  - carry-over: `model/experiments/season-cutoff-2018-elo-carry/`
- Baseline artifact or production reference: compare the same 2018+ candidate families against each other first, then keep the previously documented production post_toss baseline as context.
- Comparison method: same copied 2018+ rows, same train/calibration/validation/test split, same model configs; only Elo mode changes.

### Measured impact

#### pre_toss delta CatBoost (2018+)

| elo mode | accuracy | roc_auc | log_loss | brier |
| --- | --- | --- | --- | --- |
| season-reset | 0.5507 | 0.5833 | 0.6858 | 0.2463 |
| carry-over | 0.5507 | 0.5833 | 0.6858 | 0.2463 |

No measurable difference in this experiment. For the strongest 2018+ pre_toss candidate, cross-season Elo carry-over did not move the result.

#### post_toss delta CatBoost (2018+)

| elo mode | accuracy | roc_auc | log_loss | brier |
| --- | --- | --- | --- | --- |
| season-reset | 0.5362 | 0.6120 | 0.6854 | 0.2461 |
| carry-over | 0.5652 | 0.5568 | 0.6901 | 0.2485 |

Carry-over Elo raised raw accuracy, but it **worsened** probability quality materially: worse ROC-AUC, log loss, and Brier.

#### post_toss weighted delta ensemble (2018+)

| elo mode | accuracy | roc_auc | log_loss | brier |
| --- | --- | --- | --- | --- |
| season-reset | 0.5217 | 0.6187 | 0.6850 | 0.2460 |
| carry-over | 0.5652 | 0.5568 | 0.6901 | 0.2485 |

With carry-over Elo, the ensemble collapsed to pure CatBoost delta and lost the ROC-AUC/log-loss edge that the season-reset blend had.

- Live/current-season effect after promotion: none; experiment only.
- Confidence / caveats: this is a narrow A/B on the surviving 2018+ fold. It is still enough to say that carry-over Elo did **not** improve the best 2018+ post_toss setups we tested.

### Decision

- Outcome: rejected
- Why: on the 2018+ experiments, keeping historical Elo carry-over did not help pre_toss and made the best post_toss candidates worse on the more important probability/error metrics.
- Deployed model source hash after change: n/a
- Supporting evidence:
    - `model/experiments/season-cutoff-2018/artifacts/pre_toss/delta_2018plus/summary_metrics.csv`
    - `model/experiments/season-cutoff-2018-post-toss-sweep/artifacts/post_toss/catboost_delta_2018plus/summary_metrics.csv`
    - `model/experiments/season-cutoff-2018-post-toss-sweep/artifacts/post_toss/weighted_cb_delta__xgb_delta_2018plus/summary_metrics.csv`
    - `model/experiments/season-cutoff-2018-elo-carry/artifacts/post_toss/catboost_delta_2018plus_elo_carry/summary_metrics.csv`

### 2026-04-23 — add and then remove no-Elo all-data experiment plumbing

- Status: reverted
- Change type: feature
- Hypothesis: if stale Elo was the main problem, removing Elo-derived features while keeping the full historical training window might preserve most of the current model strength.

### What changed

- Exact files changed:
  - added temporarily: `src/model-data/build-model-matrices.ts`
  - kept as final record only: `model/MODEL_CHANGELOG.md`
- Exact data points / features / rules added, removed, or modified: added temporary experiment-only matrix-builder support to exclude Elo-derived feature columns from copied all-data matrices, then removed that plumbing after the experiment was complete.
- Whether this affects `pre_toss`, `post_toss`, or both: both, experimentally only.

### How we tested it

- Experiment/report paths: copied all-data no-Elo artifacts under `model/experiments/no-elo-all-data/artifacts/`
- Baseline artifact or production reference:
  - pre_toss current-like ensemble comparison: `model/experiments/season-cutoff-2018/artifacts/pre_toss/current_pre_toss_ensemble_compare/summary_metrics.csv`
  - post_toss deployed source experiment: `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3/summary_metrics.csv`
- Comparison method: full all-data walk-forward retrain using copied matrices only; training rows/folds stayed the same and only Elo-derived features were removed.

### Measured impact

| candidate | accuracy delta | roc_auc delta | log_loss delta | brier delta |
| --- | --- | --- | --- | --- |
| pre_toss current-like ensemble | -0.0479 | -0.0244 | +0.0120 | +0.0054 |
| post_toss deployed-style XGBoost full | -0.0621 | -0.0249 | +0.0071 | +0.0035 |

Removing Elo alone hurt both current-like all-data candidates.

- Live/current-season effect after promotion: none; experiment only.
- Confidence / caveats: this was a clean isolation test for “remove Elo entirely” because the all-data training window stayed intact.

### Decision

- Outcome: reverted
- Why: we added the no-Elo experiment plumbing to test the hypothesis safely on copied data, and removed it immediately after the experiment because the results regressed both pre_toss and post_toss.
- Deployed model source hash after change: n/a
- Supporting evidence:
    - `model/experiments/no-elo-all-data/artifacts/pre_toss/ensemble_top60_full__delta_no_elo_all_data/summary_metrics.csv`
    - `model/experiments/no-elo-all-data/artifacts/post_toss/xgboost_full_no_elo_all_data/summary_metrics.csv`
