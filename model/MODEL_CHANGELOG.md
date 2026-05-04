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

### 2026-05-03 — experimental live chase-success artifact promotion

- Status: promoted
- Change type: training | inference
- Hypothesis: a slightly slower, more regularized live-compatible CatBoost chase-success model can improve probability quality without relying on 2026 holdout tuning.

### What changed

- Exact files changed: `model/ball_state_live_candidate_selection.json`, `model/runtime_artifacts/ball_state_live/*`, `model/tune_ball_state_live_candidates.py`, `model/select_ball_state_live_candidate.py`, `model/EXPERIMENTAL_MODEL_HISTORY.md`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: the experimental observer runtime `chase_success` target now uses bundled runtime artifact `model/runtime_artifacts/ball_state_live/chase_success_model.joblib`, sourced from `model/experiments/ball-state/tuned/stable_depth4_lr0035_l215/chase_success_model.joblib`, trained with `feature_mode=live_compatible`, `iterations=160`, `learning_rate=0.035`, `depth=4`, `l2_leaf_reg=15`, and no calibration. The other selected observer runtime artifacts were also copied from ignored experiment outputs into `model/runtime_artifacts/ball_state_live/` so clean deploys do not depend on `model/experiments/`. The tuning grid and selection inventory now include this candidate.
- Whether this affects pre_toss, post_toss, or both: neither production predictor mode; this affects only experimental observer live ball-state inference for second-innings win probability.

### How we tested it

- Experiment/report paths: `model/experiments/ball-state/tuned/stable_depth4_lr0035_l215/manifest.json`, temp sweep output under `/var/folders/31/p7sq6wwx6p9_6hrm6bx2c2940000gn/T/opencode/ball-state-promote-sweep/`, and 2026 official-innings backtest output under `/var/folders/31/p7sq6wwx6p9_6hrm6bx2c2940000gn/T/opencode/ball-state-promoted-runtime-2026-backtest/`.
- Baseline artifact or production reference: prior experimental live `chase_success` artifact `stable_depth4_lr0045_l210`.
- Comparison method: pre-2026 walk-forward selection by log loss, followed by a locked 2026 official-innings diagnostic holdout.

### Measured impact

| metric | baseline | candidate | delta |
| -------- | --------: | ---------: | -----: |
| log_loss | 0.4841 | 0.4727 | -0.0115 |
| brier | 0.1566 | 0.1530 | -0.0036 |
| roc_auc | 0.8522 | 0.8563 | +0.0041 |
| accuracy | 0.7877 | 0.7839 | -0.0039 |

- Live/current-season effect after promotion: on the 42-match 2026 official-innings diagnostic, row log loss improved from `0.4445` to `0.4222`, Brier from `0.1470` to `0.1369`, ROC-AUC from `0.8772` to `0.8927`, and final-state match accuracy from `0.8571` to `0.9048`.
- Confidence / caveats: 2026 was used only as a post-selection diagnostic. The model still underestimates successful chases in some mid-probability bins, so calibration remains a future research item.

### Decision

- Outcome: promoted to experimental observer runtime only
- Why: it improves the primary historical selection metric and the 2026 diagnostic without changing production pre/post-toss artifacts.
- Deployed model source hash after change: unchanged for production predictor artifacts; experimental runtime manifest changed.
- Supporting evidence:
    - `model/ball_state_live_candidate_selection.json`
    - `model/runtime_artifacts/ball_state_live/`
    - `model/EXPERIMENTAL_MODEL_HISTORY.md`

### 2026-05-01 — 2026 preseason squad sidecars for experimental live inference

- Status: tested
- Change type: inference
- Hypothesis: roster churn before IPL 2026 can improve live ball-state priors if applied as dated inference-only context, while preserving 2026 matches as out-of-sample tests.

### What changed

- Exact files changed: `model/validate_ball_state_live_parity.py`, `model/shadow_score_ball_state_live.py`, `model/data/features/preseason_team_rosters_2026.csv`, `model/data/features/preseason_team_prior_overrides_2026.csv`, `model/data/README.md`, `model/data/features/README.md`, `model/README-predict.md`, `model/EXPERIMENTAL_MODEL_HISTORY.md`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: live ball-state feature construction now reads official preseason retained/traded roster facts dated `2025-11-15` and applies a 2026-only `team_xi_continuity_score` overlay by comparing the roster with the last historical XI. Optional numeric team-prior overrides are supported only when source-dated before the fixture.
- Whether this affects pre_toss, post_toss, or both: neither production predictor mode; this affects only experimental observer live ball-state inference.

### How we tested it

- Experiment/report paths: live parity/scorer scripts using `model/ball_state_live_candidate_selection.json` and the shared `PriorLookup` path.
- Baseline artifact or production reference: frozen historical team priors through the 2025 matrix.
- Comparison method: implementation review plus focused script/import checks; no production artifact retraining.

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: 2026 live ball-state rows can reflect preseason squad continuity without using 2026 match outcomes.
- Confidence / caveats: continuity is a conservative roster-overlap signal, not a full predicted XI model.

### Decision

- Outcome: promoted to experimental observer runtime only
- Why: it adds the requested 2026 squad context at inference time and preserves the training/test boundary.
- Deployed model source hash after change: unchanged; no production model artifact was retrained.
- Supporting evidence:
    - `model/EXPERIMENTAL_MODEL_HISTORY.md`
    - `model/data/features/preseason_team_rosters_2026.csv`
    - `model/data/features/preseason_team_prior_overrides_2026.csv`

### 2026-05-01 — experimental observer ball-state runtime bridge

- Status: tested
- Change type: inference
- Hypothesis: the live observer should use the trained ball-by-ball expected-state artifacts automatically for current innings fields, while keeping production pre-toss/post-toss predictor behavior unchanged.

### What changed

- Exact files changed: `src/index.ts`, `src/observer/service.ts`, `apps/web/src/routes/observer.tsx`, `apps/web/src/server/backendProxy.ts`, observer web API proxy routes, `model/ball_state_live_candidate_selection.json`, `model/shadow_score_ball_state_live.py`, `package.json`, `model/EXPERIMENTAL_MODEL_HISTORY.md`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: `/observer/live-model` now sends the current live payload and recent live-model snapshots through `model/shadow_score_ball_state_live.py` using selected experimental ball-state artifacts. Expected-now targets use `live_expected_now`; projected innings uses selected trajectory features when snapshot coverage is available; chase success uses the stable live-compatible classifier in innings 2. Runtime scoring failures or rejected targets leave model-scored fields null/unavailable instead of using heuristic expected-state values.
- Whether this affects pre_toss, post_toss, or both: neither; this affects only the experimental observer live expected-state route and does not change `model/predict_fixture.py` or production artifacts.

### How we tested it

- Experiment/report paths: `model/ball_state_live_candidate_selection.json` and the referenced ball-state manifests/artifacts.
- Baseline artifact or production reference: previous observer `expected-state-heuristic-v0` route behavior.
- Comparison method: manual fixture/runtime integration review plus TypeScript/web build verification.

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: operator dashboard expected-state fields are model-scored when scorer inputs are sufficient; rejected targets render as unavailable.
- Confidence / caveats: experimental observer only; selected-trajectory projected score depends on snapshot coverage.

### Decision

- Outcome: promoted to experimental observer runtime only
- Why: satisfies live operator need for automatic trained ball-by-ball expected-state scoring without promoting or modifying the production predictor.
- Deployed model source hash after change: unchanged for production predictor artifacts.
- Supporting evidence: verification commands in the implementation session.

### 2026-05-01 — post-toss XI contract and UI state audit fixes

- Status: tested
- Change type: inference
- Hypothesis: post-toss automatic predictions should only run when official toss plus confirmed/effective XI are available, and the UI must not accidentally submit unchanged official XI through the manual probable-XI override path.

### What changed

- Exact files changed: `model/predict_fixture.py`, `apps/web/src/routes/predictor.tsx`, `model/MODEL_CHANGELOG.md`, `model/PRODUCTION_MODEL_HISTORY.md`.
- Exact data points / features / rules added, removed, or modified: post-toss XI suggestions now preselect the official effective XI before falling back to confirmed XI, so impact-player substitutions align with the feature overrides used by inference. `official_post_toss_applied` now requires official lineups, not merely a non-empty official context. Auto post-toss CLI prediction now fails fast when no manual fallback inputs are supplied and official lineups are missing. The web predictor considers post-toss auto ready only when official toss and XI are both available, ignores stale context responses, parses live flags explicitly, and avoids sending unchanged post-toss official XI back as a manual probable-XI override.
- Whether this affects pre_toss, post_toss, or both: primarily post_toss; pre_toss UI behavior is affected only through safer stale-state handling and live-flag parsing.

### How we tested it

- Experiment/report paths: direct predictor contract smoke checks for live fixture `2483` and future fixture `2484`.
- Baseline artifact or production reference: existing `model/final_models/manifest.json` production models; model weights unchanged.
- Comparison method: manual fixture review and targeted CLI assertions for context/prediction flags.

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: fixture `2483` post-toss auto remains an official-feed prediction with `official_post_toss_applied: true`, `probable_xi_applied: false`, and `official_post_toss_context.lineups_available: true`. Fixture `2484` pre-toss suggested-XI smoke still reports `probable_xi_source: suggested` and `manual_probable_xi_applied: false`.
- Confidence / caveats: model artifacts are unchanged; this is an inference-contract and UI-state correctness fix. Historical benchmark metrics were not rerun because no training artifacts changed.

### Decision

- Outcome: promoted
- Why: the audited bugs were contract/state issues around inference inputs. The fix prevents half-official post-toss auto predictions and prevents the unchanged official XI from being reinterpreted through a different manual feature path.
- Deployed model source hash after change: unchanged model artifacts; runtime input contract changed.
- Supporting evidence:
    - `python3 -m py_compile model/predict_fixture.py`
    - direct `python3 model/predict_fixture.py` contract smoke assertions for fixtures `2483` and `2484`

### 2026-05-01 — official fixture kickoff times preserved

- Status: tested
- Change type: data | inference
- Hypothesis: preserving the official IPL kickoff time should prevent predictor dashboards and time-window logic from treating scheduled matches as midnight-UTC events.

### What changed

- Exact files changed: `src/model-data/fetch-upcoming-fixtures.ts`, `model/data/live/active_fixtures.csv`, `model/data/live/active_fixtures.json`, `model/data/live/upcoming_fixtures.csv`, `model/data/live/upcoming_fixtures.json`.
- Exact data points / features / rules added, removed, or modified: official IPL fixture ingestion now combines `GMTMatchDate` + `GMTMatchTime` into the serialized `match_date`, falling back to `MatchDate` + `MatchTime` as Asia/Kolkata local time only when GMT time is absent. Previously date-only rows serialized as midnight UTC. The related player-name canonicalization maps official/full-name variants to staged Cricsheet initials for inference-time XI feature lookup.
- Whether this affects pre_toss, post_toss, or both: both, through live fixture ordering, status/time-window checks, and any inference-time features keyed to fixture date/time.

### How we tested it

- Experiment/report paths: regenerated live fixture datasets with `pnpm model:data:fixtures`.
- Baseline artifact or production reference: prior fixture `2483` serialized as `2026-05-01T00:00:00.000Z`, displaying as 5:30 AM IST.
- Comparison method: manual fixture review and build/typecheck validation.

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: fixture `2483` now serializes as `2026-05-01T14:00:00.000Z`, which renders as 7:30 PM IST. The player-name canonicalization moved the same fixture's suggested-XI pre-toss Delhi probability from `0.55077` to `0.52990` by matching official full names to historical player records.
- Confidence / caveats: model weights are unchanged; this is an inference-data correctness fix.

### Decision

- Outcome: promoted
- Why: the official feed exposes `GMTMatchTime`, so using it preserves the actual kickoff instant and avoids incorrect dashboard/operator timing.
- Deployed model source hash after change: unchanged model artifacts; source/data contract changed.
- Supporting evidence:
    - `model/data/live/upcoming_fixtures.json`
    - `pnpm typecheck`
    - `pnpm build`
    - `pnpm web:typecheck`
    - `pnpm web:build`

### 2026-05-01 — official fixture fallback and XI source audit hardening

- Status: tested
- Change type: data | inference
- Hypothesis: removing the OpticOdds hard dependency should keep fixture discovery and prediction usable while making automatic suggested-XI inputs explicit and auditable.

### What changed

- Exact files changed: `src/model-data/fetch-upcoming-fixtures.ts`, `src/model-data/fetch-completed-results.ts`, `src/model-data/refresh-current-player-stats.ts`, `src/index.ts`, `model/predict_fixture.py`, `model/check_toss_sensitivity.py`, `public/predictor.js`, `apps/web/src/routes/predictor.tsx`, `src/predictor-performance.ts`.
- Exact data points / features / rules added, removed, or modified: live fixture IDs now come from official IPL `MatchID` when OpticOdds is disabled; no-result/unknown completed rows are excluded from current-season result supplements; player-match stats no longer count full squad bench members as zero-stat appearances; probable-XI payloads are validated as exactly 11 players and labelled as `suggested` vs `manual`; common full-name/initial variants are canonicalized for XI feature lookup.
- Whether this affects pre_toss, post_toss, or both: both. Pre-toss is affected most through suggested XI and live form/player inputs; post-toss is affected through validated toss/XI payloads and cleaner current-season supplements.

### How we tested it

- Experiment/report paths: direct predictor smoke tests for fixture `2483`; regenerated `model/data/live/completed_results_2026.csv`, `model/data/live/current_season_player_match_stats.csv`, and `model/data/live/upcoming_fixture_elo_context.csv`.
- Baseline artifact or production reference: existing `model/final_models/manifest.json` production models; no model weights changed.
- Comparison method: manual fixture review and live-data contract checks.

### Measured impact

| metric   | baseline | candidate | delta |
| -------- | -------- | --------- | ----- |
| log_loss | n/a      | n/a       | n/a   |
| brier    | n/a      | n/a       | n/a   |
| roc_auc  | n/a      | n/a       | n/a   |
| accuracy | n/a      | n/a       | n/a   |

- Live/current-season effect after promotion: fixture `2483` pre-toss with suggested XI now reports `probable_xi_source: suggested`, `manual_probable_xi_applied: false`; after alias canonicalization the Delhi win probability is `0.52990` instead of the earlier `0.55077` generated before player identities were merged. Partial one-player XI payloads now fail validation instead of mutating features.
- Confidence / caveats: no historical backtest was run because model weights were unchanged; this is an inference/data-contract correction. Remaining caveats include player-name alias fragmentation in current-season squad/stat feeds and calibration review for production CatBoost/XGBoost probabilities.

### Decision

- Outcome: promoted
- Why: fixes runtime dependency and input-contract bugs without changing trained model artifacts; validation passed for predictor commands, TypeScript, and frontend builds.
- Deployed model source hash after change: unchanged model artifacts; runtime data and input contracts changed.
- Supporting evidence:
    - `model/data/live/completed_results_2026.csv`
    - `model/data/live/current_season_player_match_stats.csv`
    - `model/data/live/upcoming_fixture_elo_context.csv`

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

| metric   | baseline | candidate | delta   |
| -------- | -------- | --------- | ------- |
| log_loss | 0.6987   | 0.6940    | -0.0047 |
| brier    | 0.2527   | 0.2504    | -0.0023 |
| roc_auc  | 0.5300   | 0.5495    | +0.0195 |
| accuracy | 0.5365   | 0.5348    | -0.0018 |

The season-reset Elo helped pre_toss overall: better log loss, Brier, and ROC-AUC, with a very small accuracy drop.

#### post_toss

| metric   | baseline | candidate | delta   |
| -------- | -------- | --------- | ------- |
| log_loss | 0.6920   | 0.6991    | +0.0071 |
| brier    | 0.2492   | 0.2526    | +0.0034 |
| roc_auc  | 0.5612   | 0.5436    | -0.0175 |
| accuracy | 0.5691   | 0.5351    | -0.0340 |

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

| metric   | baseline | candidate | delta   |
| -------- | -------- | --------- | ------- |
| log_loss | 0.7010   | 0.6858    | -0.0152 |
| brier    | 0.2539   | 0.2463    | -0.0076 |
| roc_auc  | 0.4444   | 0.5833    | +0.1389 |
| accuracy | 0.4493   | 0.5507    | +0.1014 |

Best 2018+ pre_toss candidate was the `delta_2018plus` CatBoost model; the 2018+ ensemble collapsed to the full model and was weaker than the delta-only candidate.

#### post_toss (2025 like-for-like)

Compared against the actually deployed production source experiment `post_toss/xgboost_full_recency_h3`.

| metric   | baseline | candidate | delta   |
| -------- | -------- | --------- | ------- |
| log_loss | 0.6797   | 0.6963    | +0.0166 |
| brier    | 0.2433   | 0.2514    | +0.0081 |
| roc_auc  | 0.6073   | 0.5593    | -0.0480 |
| accuracy | 0.6377   | 0.5217    | -0.1159 |

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

| metric   | baseline |
| -------- | -------- |
| accuracy | 0.6377   |
| roc_auc  | 0.6073   |
| log_loss | 0.6797   |
| brier    | 0.2433   |

Best 2018+ post_toss candidates:

| candidate                               | accuracy | roc_auc | log_loss | brier  | take                                                                                                                 |
| --------------------------------------- | -------- | ------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `catboost_delta_2018plus`               | 0.5362   | 0.6120  | 0.6854   | 0.2461 | best single-model probabilistic candidate; slight ROC-AUC win, but still worse log loss/Brier/accuracy than baseline |
| `weighted_cb_delta__xgb_delta_2018plus` | 0.5217   | 0.6187  | 0.6850   | 0.2460 | best ROC-AUC in the sweep, but still worse log loss/Brier/accuracy than baseline                                     |
| `catboost_full_no_identity_2018plus`    | 0.5507   | 0.5631  | 0.6877   | 0.2473 | best CatBoost accuracy among the sweep, still materially below baseline                                              |
| `xgboost_delta_uniform_2018plus`        | 0.5652   | 0.5438  | 0.6970   | 0.2515 | best raw accuracy among XGBoost sweep, but weak probability quality                                                  |

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

| elo mode     | accuracy | roc_auc | log_loss | brier  |
| ------------ | -------- | ------- | -------- | ------ |
| season-reset | 0.5507   | 0.5833  | 0.6858   | 0.2463 |
| carry-over   | 0.5507   | 0.5833  | 0.6858   | 0.2463 |

No measurable difference in this experiment. For the strongest 2018+ pre_toss candidate, cross-season Elo carry-over did not move the result.

#### post_toss delta CatBoost (2018+)

| elo mode     | accuracy | roc_auc | log_loss | brier  |
| ------------ | -------- | ------- | -------- | ------ |
| season-reset | 0.5362   | 0.6120  | 0.6854   | 0.2461 |
| carry-over   | 0.5652   | 0.5568  | 0.6901   | 0.2485 |

Carry-over Elo raised raw accuracy, but it **worsened** probability quality materially: worse ROC-AUC, log loss, and Brier.

#### post_toss weighted delta ensemble (2018+)

| elo mode     | accuracy | roc_auc | log_loss | brier  |
| ------------ | -------- | ------- | -------- | ------ |
| season-reset | 0.5217   | 0.6187  | 0.6850   | 0.2460 |
| carry-over   | 0.5652   | 0.5568  | 0.6901   | 0.2485 |

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

| candidate                             | accuracy delta | roc_auc delta | log_loss delta | brier delta |
| ------------------------------------- | -------------- | ------------- | -------------- | ----------- |
| pre_toss current-like ensemble        | -0.0479        | -0.0244       | +0.0120        | +0.0054     |
| post_toss deployed-style XGBoost full | -0.0621        | -0.0249       | +0.0071        | +0.0035     |

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

### 2026-04-28 — make post-toss XGBoost toss-sensitive

- Status: promoted
- Change type: feature | training | ensemble | inference
- Hypothesis: the post-toss production model should respond to actual toss winner/decision changes by learning direct toss implication features inside XGBoost, instead of relying on inference-time fallback behavior.

### What changed

- Exact files changed: `src/model-data/derive-features.ts`, `model/data/features/*`, `model/data/matrices/post_toss_model_matrix.csv`, `model/data/metadata/model_matrix_manifest.json`, `model/predict_fixture.py`, `model/train_xgboost.py`, `model/promote_xgboost_experiment.py`, `model/run_daily_refresh.py`, `model/check_toss_sensitivity.py`, `package.json`, `model/final_models/manifest.json`, `model/final_models/post_toss/xgboost_linear_toss/*`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: added post-toss toss implication features (`toss_winner_is_team1`, `toss_winner_is_team2`, `toss_decision_bat`, `toss_decision_field`, `team1_batting_order_win_rate`, `team2_batting_order_win_rate`, `batting_order_win_rate_gap`, `venue_batting_order_expected_team1_win_rate`, `toss_winner_decision_preference_match`) and mirrored them in live inference. Added XGBoost `feature_weights` support and `gblinear` booster support. Production post_toss is now an all-XGBoost blend: existing tree XGBoost component at 0.65 plus new linear XGBoost toss component at 0.35.
- Whether this affects pre_toss, post_toss, or both: post_toss only.

### How we tested it

- Experiment/report paths:
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_full_toss_features_w1_20260428/summary_metrics.csv`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_full_toss_linear_20260428/summary_metrics.csv`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_linear_toss_ensemble_20260428/summary_metrics.csv`
- Baseline artifact or production reference: prior `model/final_models/post_toss/xgboost_full_recency_h3` tree-only production model; prior documented 2025 baseline from `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3/summary_metrics.csv`.
- Comparison method: walk-forward training/proxy ensemble metrics plus production runtime toss-permutation sensitivity gate.

### Measured impact

| metric   | baseline | candidate/proxy | delta   |
| -------- | -------- | --------------- | ------- |
| log_loss | 0.6797   | 0.6962          | +0.0165 |
| brier    | 0.2433   | 0.2513          | +0.0080 |
| roc_auc  | 0.6073   | 0.5405          | -0.0668 |
| accuracy | 0.6377   | 0.5372          | -0.1005 |

- Live/current-season effect after promotion: `pnpm model:sensitivity:toss -- --fixture-id 20260428E9386625 --min-spread 0.001` passes with observed spread `0.003493946790695146`. Team 1 probability now moves from `0.47557685077190404` to `0.4790707975625992` across toss permutations using production `model/final_models`.
- Confidence / caveats: this removes the CatBoost fallback and keeps post_toss production entirely XGBoost. The promoted blend intentionally prioritizes the operator contract that manual toss changes must affect post-toss odds. The available fold-level proxy metrics regress versus the prior documented production baseline because local historical fold predictions for the exact previous final tree artifact are not present; future retraining should search for a higher-quality toss-sensitive tree/linear blend before increasing the linear weight.

### Decision

- Outcome: promoted
- Why: the previous XGBoost tree-only model accepted toss fields but ignored them in predictions. The promoted all-XGBoost blend makes post-toss odds responsive to toss assumptions without inference-time model-family switching.
- Deployed model source hash after change: `0f71d70a2da05236ec405268e84c5814e260c2351ff95843aa4157d66d8ec698`
- Supporting evidence:
    - `model/check_toss_sensitivity.py`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_linear_toss_ensemble_20260428/summary_metrics.csv`
    - `model/final_models_backups/post_toss_xgboost_blend_20260428T092224Z`

### 2026-04-28 — rollback unsafe post-toss XGBoost blend

- Status: reverted
- Change type: model promotion rollback
- Hypothesis: the all-XGBoost tree/linear blend made manual post-toss inputs technically responsive, but its probabilities were not safe enough for production because the linear toss component was weak and the blend regressed held-out proxy metrics.

### What changed

- Exact files changed: `model/final_models/manifest.json`, `model/final_models/post_toss/xgboost_linear_toss/*`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: removed `xgboost_linear_toss` from the live `post_toss` production blend, deleted its unused production artifact files, and restored `xgboost_full_recency_h3` to weight `1.0`. The toss-derived feature generation, live inference mirroring, XGBoost training knobs, and sensitivity tooling remain in the repo for the next validated retrain.
- Whether this affects pre_toss, post_toss, or both: post_toss only.

### How we tested it

- Experiment/report paths:
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_full_toss_linear_20260428/summary_metrics.csv`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_linear_toss_ensemble_20260428/summary_metrics.csv`
    - `model/experiments/recency-second-pass/artifacts/post_toss/xgboost_full_recency_h3/summary_metrics.csv`
- Baseline artifact or production reference: prior tree-only `model/final_models/post_toss/xgboost_full_recency_h3` production component.
- Comparison method: production component decomposition for fixture `20260428E9386625`, toss-permutation sensitivity checks, and fold-level summary metric comparison.

### Measured impact

| model                             | test log_loss | test brier | test roc_auc | test accuracy |
| --------------------------------- | ------------- | ---------- | ------------ | ------------- |
| xgboost_full_recency_h3 reference | 0.6920        | 0.2492     | 0.5612       | 0.5691        |
| xgboost_linear_toss               | 0.7043        | 0.2552     | 0.5387       | 0.5085        |
| 0.65/0.35 tree/linear blend       | 0.6962        | 0.2513     | 0.5405       | 0.5372        |

- Live/current-season effect after rollback: fixture `20260428E9386625` returns to the tree component probability around `0.4639399648` rather than the unsafe blend range `0.4755768508`–`0.4790707976`.
- Confidence / caveats: this intentionally sacrifices the provisional production toss sensitivity to avoid shipping a weaker blend. The proper fix remains a validated XGBoost retrain that is both toss-sensitive and no worse than the production tree on held-out metrics.

### Decision

- Outcome: reverted
- Why: the promoted linear toss component was only weakly toss-sensitive, moved prices in a way that looked operationally suspect, and degraded the available validation evidence. Keeping the toss-feature infrastructure while removing the component from the live manifest is the safest rollback.
- Deployed model source hash after change: `970a3efafe3c75407d3bceee8456a979cce3c1ff46cf05cbf2f48eb24bcc5297`
- Supporting evidence:
    - `model/final_models/manifest.json`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_full_toss_linear_20260428/summary_metrics.csv`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_linear_toss_ensemble_20260428/summary_metrics.csv`

### 2026-04-28 — promote toss-sensitive post-toss XGBoost tree

- Status: promoted
- Change type: model promotion | training
- Hypothesis: post-toss production must remain XGBoost and must move probabilities when toss winner/decision changes; a single `gbtree` model trained with toss implication features, high toss feature sampling weight, and low `colsample_bytree` should satisfy that contract more cleanly than the reverted tree/linear blend.

### What changed

- Exact files changed: `model/final_models/manifest.json`, `model/final_models/post_toss/xgboost_tree_toss_colsample_w50/*`, `model/final_models/revision_history.jsonl`, `model/final_models_backups/*`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: replaced live post_toss `xgboost_full_recency_h3` with `xgboost_tree_toss_colsample_w50` at weight `1.0`. The promoted component consumes the post-toss implication fields (`toss_winner_is_team1`, `toss_winner_is_team2`, `toss_decision_bat`, `toss_decision_field`, `team1_batting_order_win_rate`, `team2_batting_order_win_rate`, `batting_order_win_rate_gap`, `venue_batting_order_expected_team1_win_rate`, `toss_winner_decision_preference_match`) and uses `gbtree` with `colsample_bytree=0.35` plus toss feature sampling weight from the source experiment.
- Whether this affects pre_toss, post_toss, or both: post_toss only.

### How we tested it

- Experiment/report paths:
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_toss_colsample_w50_20260428/summary_metrics.csv`
    - `model/experiments/toss-sensitive-xgboost/staging/tree_colsample_w50_final_models/`
- Baseline artifact or production reference: prior flat `model/final_models/post_toss/xgboost_full_recency_h3` production component and the rejected `0.65/0.35` tree/linear blend.
- Comparison method: promoted to staging first, ran toss-permutation sensitivity for fixture `20260428E9386625`, then promoted the same single-component XGBoost tree into `model/final_models` and re-ran prediction/build checks.

### Measured impact

| model                                | test log_loss | test brier | test roc_auc | test accuracy |
| ------------------------------------ | ------------- | ---------- | ------------ | ------------- |
| xgboost_full_recency_h3 reference    | 0.6920        | 0.2492     | 0.5612       | 0.5691        |
| rejected 0.65/0.35 tree/linear blend | 0.6962        | 0.2513     | 0.5405       | 0.5372        |
| xgboost_tree_toss_colsample_w50      | 0.6989        | 0.2525     | 0.5511       | 0.5189        |

- Live/current-season effect after promotion: `pnpm model:sensitivity:toss -- --fixture-id 20260428E9386625 --min-spread 0.001` passes with observed spread `0.019425690174102783`. Team 1 probability now moves from `0.4728984832763672` to `0.49232417345046997` across toss permutations using production `model/final_models`.
- Confidence / caveats: this fixes the operator contract with a single XGBoost tree component that consumes the toss implication columns. Its fold metrics are still weaker than the prior flat reference, so this promotion is a functional correctness fix, not a final model-quality win. The next training pass should search for a toss-sensitive tree that also beats or matches the flat reference on log loss and Brier score.

### Decision

- Outcome: promoted
- Why: the flat post-toss production model violated the core post-toss contract by returning identical probabilities across toss scenarios. The promoted component is a model-level XGBoost fix, not a UI/display adjustment or non-XGBoost fallback, and it restores meaningful toss sensitivity immediately.
- Deployed model source hash after change: `9e8608460caff6a54db3ef026f96ff2e3b2f0687634b8c9abad4e0fe9c491aee`
- Supporting evidence:
    - `model/check_toss_sensitivity.py`
    - `model/final_models/manifest.json`
    - `model/experiments/toss-sensitive-xgboost/artifacts/post_toss/xgboost_tree_toss_colsample_w50_20260428/summary_metrics.csv`

### 2026-04-28 — enforce batting-order equivalence in post-toss XGBoost

- Status: promoted
- Change type: feature | training | validation | model promotion
- Hypothesis: post-toss pricing should depend on the resulting innings state, not on two different wordings of the same state. For example, “Punjab Kings bat” and “Rajasthan Royals field” both mean Punjab bat first and must produce the same probability.

### What changed

- Exact files changed: `model/train_baselines.py`, `model/train_xgboost.py`, `model/check_toss_sensitivity.py`, `model/final_models/manifest.json`, `model/final_models/post_toss/xgboost_post_toss_state_linear/*`, `model/final_models/post_toss/xgboost_tree_toss_colsample_w50/*`, `model/final_models/revision_history.jsonl`, `model/final_models_backups/*`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: added `post_toss_state` feature mode, which removes toss-agency fields (`toss_winner`, `toss_decision`, `toss_winner_is_team1`, `toss_winner_is_team2`, `toss_decision_bat`, `toss_decision_field`, `toss_winner_decision_preference_match`) while preserving batting-order state fields (`team1_bats_first`, `team2_bats_first`, batting-order win-rate features, and venue batting-order expectation). Promoted `xgboost_post_toss_state_linear` as the live post_toss component and removed the non-invariant `xgboost_tree_toss_colsample_w50` production artifact files. Strengthened `model/check_toss_sensitivity.py` to fail when equivalent batting-order scenarios differ.
- Whether this affects pre_toss, post_toss, or both: post_toss only.

### How we tested it

- Experiment/report paths:
    - `model/experiments/toss-state-xgboost/artifacts/post_toss/xgboost_post_toss_state_linear_20260428/summary_metrics.csv`
    - `model/experiments/toss-state-xgboost/staging/post_toss_state_linear_final_models/`
    - `model/experiments/toss-state-xgboost/artifacts/post_toss/xgboost_post_toss_state_tree_tiny_20260428/summary_metrics.csv`
- Baseline artifact or production reference: non-invariant `xgboost_tree_toss_colsample_w50` production model and flat `xgboost_full_recency_h3` reference.
- Comparison method: compared raw scenario feature rows, confirmed equivalent batting-order scenarios only differed by toss-agency columns, trained state-only candidates, staged/promoted the invariant candidate, and ran the enhanced toss sensitivity/equivalence checker.

### Measured impact

| model                                         | test log_loss | test brier | test roc_auc | test accuracy |
| --------------------------------------------- | ------------- | ---------- | ------------ | ------------- |
| non-invariant xgboost_tree_toss_colsample_w50 | 0.6989        | 0.2525     | 0.5511       | 0.5189        |
| xgboost_post_toss_state_linear                | 0.7039        | 0.2550     | 0.5444       | 0.5119        |
| xgboost_post_toss_state_tree_tiny             | 0.7043        | 0.2550     | 0.5506       | 0.5354        |

- Live/current-season effect after promotion: `pnpm model:sensitivity:toss -- --fixture-id 20260428E9386625 --min-spread 0.001` passes with observed batting-order spread `0.00203859806060791` and equivalent-state diffs of `0.0` for both batting-order groups. Punjab Kings bat and Rajasthan Royals field both produce `0.5008306503295898`; Punjab Kings field and Rajasthan Royals bat both produce `0.5028692483901978`.
- Confidence / caveats: this fixes the semantic correctness bug and prevents equivalent toss phrasings from diverging. The promoted model is still weaker than desired on held-out metrics, so it should be replaced by a higher-quality batting-order-state XGBoost once available.

### Decision

- Outcome: promoted
- Why: the prior toss-sensitive tree restored movement but violated state equivalence by pricing “team wins toss and bats” differently from “opponent wins toss and fields.” The new feature mode removes those agency fields from model input and the validation gate now enforces both sensitivity and equivalence.
- Deployed model source hash after change: `1c2daae992c77e24db959d307e8bf80f7cfda4bbde4a4859188998cb84cca728`
- Supporting evidence:
    - `model/check_toss_sensitivity.py`
    - `model/final_models/manifest.json`
    - `model/experiments/toss-state-xgboost/artifacts/post_toss/xgboost_post_toss_state_linear_20260428/summary_metrics.csv`

### 2026-04-28 — wire post-toss state validation into daily retraining

- Status: promoted
- Change type: automation | validation | documentation
- Hypothesis: the VM's 4am daily retraining job must train the same batting-order-state post-toss model family used in production and must block auto-promotion if a candidate violates toss sensitivity or equivalent-state invariance.

### What changed

- Exact files changed: `model/run_daily_refresh.py`, `model/run_experiment_suite.py`, `model/README-daily-refresh.md`, `model/MODEL_CHANGELOG.md`.
- Exact data points / features / rules added, removed, or modified: changed the daily post_toss candidate from `xgboost_full_recency_h3_daily` with `feature-mode full` to `xgboost_post_toss_state_linear_daily` with `feature-mode post_toss_state`. Added automatic staging plus `model:sensitivity:toss` validation before post-toss auto-promotion. Extended experiment-suite backtests to include `post_toss_state` CatBoost/XGBoost runs and a state-vs-full XGBoost weighted comparison.
- Whether this affects pre_toss, post_toss, or both: post_toss automation only; pre_toss daily behavior is unchanged.

### How we tested it

- Experiment/report paths:
    - `model/experiments/toss-state-xgboost/reports/leaderboard.csv`
    - `model/experiments/toss-state-xgboost/reports/season_metrics.csv`
    - `model/experiments/toss-state-xgboost/reports/calibration_bins.csv`
    - `model/experiments/toss-state-xgboost/reports/confidence_backtest.csv`
- Baseline artifact or production reference: current `model/final_models` post_toss component `xgboost_post_toss_state_linear` and existing toss-sensitive experiment artifacts.
- Comparison method: daily refresh dry-run, post-toss experiment-suite dry-run, stored-prediction backtest report generation across `current`, `toss_state`, and `toss_sensitive` roots, and final production sensitivity/equivalence check.

### Measured impact

- Daily refresh dry-run now prints the post-toss training command:
    - `python3 model/train_xgboost.py --matrix post_toss --feature-mode post_toss_state --run-label xgboost_post_toss_state_linear_daily ... --booster gblinear ...`
- Experiment-suite dry-run now includes:
    - `train_baselines.py --matrix post_toss --feature-mode post_toss_state`
    - `train_xgboost.py --matrix post_toss --feature-mode post_toss_state --run-label xgboost_post_toss_state`
    - `weighted_xgboost_state__xgboost_full`
- Backtest leaderboard generated successfully under `model/experiments/toss-state-xgboost/reports`. The live promoted state model's stored test metrics remain modest (`xgboost_post_toss_state_linear`: accuracy `0.5135`, ROC-AUC `0.5187`, log loss `0.7043`, Brier `0.2552`), but the automation now tests the correct model family and enforces the semantic gate before promotion.

### Decision

- Outcome: promoted
- Why: without this change, pushing to the VM would let the 4am job keep retraining/promoting the old full post-toss XGBoost candidate and bypass the new equivalent-state validation. The daily job now trains the state model and stages it through the same sensitivity/equivalence check before production promotion.
- Deployed model source hash after change: unchanged from current production model artifacts (`1c2daae992c77e24db959d307e8bf80f7cfda4bbde4a4859188998cb84cca728`)
- Supporting evidence:
    - `pnpm model:daily-refresh -- --dry-run --auto-promote-pre-toss --auto-promote-post-toss`
    - `pnpm model:experiment -- --name post_toss_state_smoke_20260428 --matrix post_toss --dry-run`
    - `pnpm model:backtest -- --root current:model/artifacts --root toss_state:model/experiments/toss-state-xgboost/artifacts --root toss_sensitive:model/experiments/toss-sensitive-xgboost/artifacts --output-dir model/experiments/toss-state-xgboost/reports --focus-split test`
