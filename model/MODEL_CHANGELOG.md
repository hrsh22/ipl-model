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

### 2026-04-27 — harden experimental ball-state shadow refresh

- Status: tested
- Change type: inference
- Hypothesis: opt-in source refresh, read-only dashboard access, and confined source paths can keep the experimental ball-by-ball frontend useful without creating production runtime side effects.

### What changed

- Exact files changed: `src/config.ts`, `.env.example`, `src/index.ts`, `frontend/src/routes/index.tsx`, `public/observer-dashboard.js`, `model/scrape_espncricinfo_ball_events.py`, `model/build_live_event_snapshots.py`, `model/LIVE_BALL_EVENT_CONTRACT.md`, `model/README-predict.md`, `model/MODEL_CHANGELOG.md`
- Exact data points / features / rules added, removed, or modified: added opt-in runtime flags for experimental shadow refresh and remote ESPN fetches, made `GET /observer/ball-state-shadow` read-only, confined saved HTML paths to the ignored ball-state experiment directory, whitelisted ESPN HTTPS hosts for remote fetches, sanitized public refresh errors/source labels, tolerated partial JSONL reads, added event-hash dedupe in the ESPN scraper, and preserved illegal deliveries as score-only snapshots so legal-ball trajectory deltas do not absorb wide/no-ball runs.
- Whether this affects pre_toss, post_toss, or both: neither deployed predictor path; this only affects the isolated experimental `/observer/ball-state-shadow` surface and ignored `model/experiments/ball-state/` outputs.

### How we tested it

- Experiment/report paths: `model/experiments/ball-state/live-events-dc-rcb-1529282/`, `model/experiments/ball-state/live-events-ingestion-smoke/`
- Baseline artifact or production reference: production predictor artifacts in `model/final_models/` and `model/predict_fixture.py` remain unchanged.
- Comparison method: syntax/type/build validation plus protected-path diff check.

### Measured impact

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| backend typecheck errors | 0 | 0 | 0 |
| React frontend build failures | 0 | 0 | 0 |
| static dashboard JS syntax errors | 0 | 0 | 0 |
| protected production path diffs | 0 | 0 | 0 |
| saved-HTML smoke normalized rows appended | 0 | 3 | +3 |
| repeat saved-HTML duplicate rows skipped | 0 | 3 | +3 |

- Live/current-season effect after promotion: none; not promoted into production predictor/data paths.
- Confidence / caveats: runtime refresh and remote fetch are disabled by default. Direct ESPN fetch can still return 403 when explicitly enabled, so saved public HTML remains the robust fallback.

### Decision

- Outcome: not promoted
- Why: improves experimental live shadow safety/automation only; production pre/post-toss predictor behavior is intentionally unchanged.
- Deployed model source hash after change: unchanged; no `model/final_models/` artifact changed.
- Supporting evidence:
    - `pnpm typecheck`
    - `pnpm build`
    - `pnpm build:frontend`
    - `node --check public/observer-dashboard.js`
    - `python3 -m py_compile model/scrape_espncricinfo_ball_events.py`
    - `model/experiments/ball-state/live-events-ingestion-smoke/latest_espncricinfo_capture_manifest.json`

### 2026-04-27 — add no-paid experimental live ball-event workflow

- Status: tested
- Change type: data | feature | inference
- Hypothesis: public ESPNcricinfo page-embedded commentary can provide enough recent delivery state to test selected live trajectory features without paid APIs or production wiring.

### What changed

- Exact files changed: `model/scrape_espncricinfo_ball_events.py`, `model/capture_live_ball_events.py`, `model/build_live_event_snapshots.py`, `model/build_live_payload_from_events.py`, `model/run_no_paid_ball_state_live.py`, `model/shadow_score_ball_state_live.py`, `model/LIVE_BALL_EVENT_CONTRACT.md`, `model/espncricinfo_next_data_sample.html`, `model/no_paid_live_context_sample.json`, `package.json`, `model/MODEL_CHANGELOG.md`
- Exact data points / features / rules added, removed, or modified: added an experiment-only append-only `live-ball-event-v0` journal contract, ESPNcricinfo `__NEXT_DATA__` scraper, event-to-snapshot converter, event-to-live-payload builder, no-paid orchestration command, and shadow-scoring numeric dtype handling so optional numeric missing values remain numeric NaN instead of categorical sentinels. All generated outputs stay under ignored `model/experiments/ball-state/live-events/`.
- Whether this affects pre_toss, post_toss, or both: neither deployed predictor path; this is an experimental live ball-state inference workflow and is not wired into `model/final_models/`, `model/predict_fixture.py`, or `model/data/live/`.

### How we tested it

- Experiment/report paths: `model/experiments/ball-state/live-events-context-test/`, `model/experiments/ball-state/live-events-dir-test/`, `model/experiments/ball-state/live-events-sample-shadow-fixed/`
- Baseline artifact or production reference: selected experimental ball-state candidates from `model/experiments/ball-state/live_candidate_selection_report.json`; production predictor artifacts remain unchanged.
- Comparison method: offline fixture replay from `model/espncricinfo_next_data_sample.html` through scrape → normalized events → snapshots → live payload → feature parity → shadow scoring.

### Measured impact

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| no-paid normalized event rows from fixture | 0 | 3 | +3 |
| event-derived snapshot rows from fixture | 0 | 4 | +4 |
| selected-trajectory parity ready entries | 0 | 1 | +1 |
| first-innings shadow-scored targets | 0 | 4 | +4 |

- Live/current-season effect after promotion: none; no promotion or runtime integration.
- Confidence / caveats: the offline fixture proves the experimental plumbing and feature contract, not real ESPN live completeness. ESPN embedded comments may be a recent window, direct script fetch may be blocked, and real live-match readiness still requires polling saved public HTML during an actual match to measure gaps/revisions/latency.

### Decision

- Outcome: not promoted
- Why: the no-paid workflow is ready for experimental live shadow testing, but it has not yet been proven across a real live match and remains intentionally outside production inference.
- Deployed model source hash after change: unchanged; no `model/final_models/` artifact changed.
- Supporting evidence:
    - `model/experiments/ball-state/live-events-context-test/live_feature_parity_report.json`
    - `model/experiments/ball-state/live-events-context-test/shadow-run/summary.json`
    - `model/experiments/ball-state/live-events-dir-test/live_feature_parity_report.json`

### 2026-04-27 — add reusable leak-safe player history feature CSVs

- Status: tested
- Change type: data | feature
- Hypothesis: player-level prior batting/bowling form and role summaries can become useful inputs for future IPL models if generated as reusable, separate, pre-match-safe feature tables.

### What changed

- Exact files changed: `src/model-data/derive-features.ts`, `model/data/features/README.md`, `model/data/metadata/feature_summary.json`, `model/data/features/pre_match_player_features.csv`, `model/data/features/training_ready_player_features.csv`, `model/MODEL_CHANGELOG.md`
- Exact data points / features / rules added, removed, or modified: added player-wise pre-match rows from `model/data/staged/player_match_stats.csv` joined with `model/data/staged/player_registry.csv`; each row includes match/team/player identity, registry `person_id`, role and batting position, training eligibility flags, prior-only historical match counts, batting runs/balls/outs/average/strike-rate/boundary-rate/six-rate, bowling balls/runs/wickets/economy/dot-ball-rate, recent last-5 batting and bowling summaries, and an all-rounder score. Same-match `current_*` player outcome columns are intentionally excluded from the pre-match/training-ready outputs.
- Whether this affects pre_toss, post_toss, or both: neither deployed predictor path yet; these are reusable generated data/features for future model experiments and are not wired into `model/final_models/` or `model/predict_fixture.py`.

### How we tested it

- Experiment/report paths: `model/data/features/pre_match_player_features.csv`, `model/data/features/training_ready_player_features.csv`, `model/data/metadata/feature_summary.json`
- Baseline artifact or production reference: existing team and matchup feature generation in `src/model-data/derive-features.ts`; production artifacts in `model/final_models/` remain unchanged.
- Comparison method: data-generation validation plus TypeScript/build checks; no predictive model comparison yet because the new player table has not been joined into a training matrix.

### Measured impact

| metric | baseline | candidate | delta |
| --- | --- | --- | --- |
| pre-match player feature rows | 0 | 24,956 | +24,956 |
| training-ready player feature rows | 0 | 18,305 | +18,305 |
| player feature columns | 0 | 36 | +36 |
| duplicate match/team/player keys | n/a | 0 | n/a |

- Live/current-season effect after promotion: none; no promotion or runtime integration.
- Confidence / caveats: the row contract is leak-safe for historical features because player history is updated only after emitting the current match's pre-match player rows. These CSVs are intentionally separate so future models can opt in without changing current production inference.

### Decision

- Outcome: not promoted
- Why: generated and validated as a reusable feature input, but not yet evaluated inside pre_toss/post_toss matrices or deployed predictor artifacts.
- Deployed model source hash after change: unchanged; no `model/final_models/` artifact changed.
- Supporting evidence:
    - `model/data/metadata/feature_summary.json`
    - `model/data/features/pre_match_player_features.csv`
    - `model/data/features/training_ready_player_features.csv`

### 2026-04-26 — add experimental ball-state expected model scaffold

- Status: tested
- Change type: data | feature | training
- Hypothesis: a delivery-state model trained from historical ball-by-ball rows should provide a stronger live expected-runs/wickets baseline than venue-average run-rate heuristics.

### What changed

- Exact files changed: `model/build_ball_state_matrix.py`, `model/train_ball_state.py`, `package.json`, `model/MODEL_CHANGELOG.md`
- Exact data points / features / rules added, removed, or modified: added an experimental matrix from `model/data/IPL.csv` with one row per legal delivery, current score/wickets/balls, scheduled balls, innings phase, recent scoring/wicket momentum windows, pre-match venue/team priors, and labels for `final_innings_runs`, `final_innings_wickets`, `remaining_innings_runs`, `remaining_innings_wickets`, and `chase_success`; recomputed second-innings targets from first-innings terminal score instead of trusting polluted raw `runs_target`; added CatBoost walk-forward season validation, phase-sliced metrics, simple baselines, regressors for final/remaining runs and wickets, and a chase-success classifier. Generated outputs are under ignored `model/experiments/ball-state/`.
- Whether this affects pre_toss, post_toss, or both: neither deployed predictor path; this is an experimental live expected-state pipeline and is not wired into `model/final_models/` or `model/predict_fixture.py`.

### How we tested it

- Experiment/report paths: `model/experiments/ball-state/ball_state_matrix_manifest.json`, `model/experiments/ball-state/artifacts/manifest.json`, `model/experiments/ball-state/live-compatible-artifacts/manifest.json`, `model/experiments/ball-state/live-compatible-selected-trajectory-artifacts/manifest.json`, `model/experiments/ball-state/live-compatible-platt-artifacts/manifest.json`, `model/experiments/ball-state/live-compatible-isotonic-artifacts/manifest.json`, `model/experiments/ball-state/live_candidate_selection_report.json`, `model/experiments/ball-state/live_tuning_report.json`, `model/experiments/ball-state/tuned/stable_depth4_lr0045_l210/manifest.json`, `model/experiments/ball-state/runs/acceptance-smoke-tuned/summary.json`, `model/experiments/ball-state/runs/acceptance-missing-fields/summary.json`, `model/experiments/ball-state/live_compatible_feature_parity_report.json`, `model/experiments/ball-state/live_compatible_selected_trajectory_parity_report.json`
- Baseline artifact or production reference: current observer heuristic in `src/observer/service.ts` using venue run-rate constants.
- Comparison method: season walk-forward folds for 2023, 2024, and 2025 with match-level separation.

### Measured impact

| metric                       | baseline | candidate | delta  |
| ---------------------------- | -------- | --------- | ------ |
| final runs MAE               | 20.01    | 16.53     | -3.48  |
| final runs RMSE              | 26.65    | 22.96     | -3.69  |
| final wickets MAE            | 1.58     | 1.47      | -0.11  |
| remaining runs MAE           | 20.09    | 15.68     | -4.41  |
| remaining wickets MAE        | 1.59     | 1.43      | -0.16  |
| chase success log_loss       | 0.696    | 0.501     | -0.195 |
| chase success brier          | 0.252    | 0.162     | -0.090 |
| chase success roc_auc        | 0.500    | 0.836     | +0.336 |
| chase success ECE            | 0.049    | 0.060     | +0.012 |

- Live/current-season effect after promotion: none; no promotion or runtime integration yet.
- Live-compatible 109-feature contract: added an explicit `live_compatible` mode that excludes toss fields and event trajectory fields. It remains the best live-shaped candidate: final runs MAE `16.66`, final wickets MAE `1.46`, remaining runs MAE `15.65`, remaining wickets MAE `1.44`, chase log_loss `0.509`, chase Brier `0.164`, chase ROC AUC `0.835`, chase ECE `0.067`.
- Event trajectory upgrade: added causal replayed trajectory fields to the matrix contract, including last-ball/last-3/6/12/24 runs and wickets, dot/high-run/six-plus windows, current-over runs/wickets/dots, balls since wicket/high-run, and consecutive dots. Added `live_compatible_trajectory` mode plus snapshot-derived parity support that only fills event features from exact one-ball snapshot deltas and treats snapshot gaps as missing.
- Trajectory A/B result: the 141-feature live-compatible trajectory candidate did **not** beat the stable 109-feature live-compatible model on aggregate walk-forward metrics: final runs MAE `16.70`, remaining runs MAE `15.68`, chase log_loss `0.522`, chase Brier `0.168`, chase ROC AUC `0.828`, chase ECE `0.073`. The trajectory branch is therefore retained as experimental evidence, not promoted.
- Selected trajectory / calibration follow-up: added `live_compatible_selected_trajectory` and chronological chase calibration (`platt`, `isotonic`) support. Calibration did not improve the chase classifier (`stable_platt` log_loss `0.521`, ECE `0.071`; `stable_isotonic` log_loss `0.606`, ECE `0.084`), so raw stable chase probabilities remain the best candidate by log_loss. The selected trajectory subset improved only target-specific regressions: final runs MAE `16.59` and remaining wickets MAE `1.43`.
- Experimental target-level selector: added `model/experiments/ball-state/live_candidate_selection_report.json`, selecting per target by walk-forward primary metric. Current best live candidate mix: selected trajectory for `final_innings_runs` and `remaining_innings_wickets`; stable 109-feature contract for `final_innings_wickets`, `remaining_innings_runs`, and `chase_success`.
- Bounded CatBoost tuning: added tunable CatBoost params and a 6-run fixed search budget. The only accepted improvement was the chase head: `live_compatible`, depth `4`, learning rate `0.045`, `l2_leaf_reg=10`, `iterations=120`, improving chase log_loss from `0.509` to `0.484`, Brier from `0.164` to `0.157`, accuracy from `0.765` to `0.788`, and ROC AUC from `0.835` to `0.852`. The tuned regression candidates were worse and were not selected.
- Updated target-level selector: current best live candidate mix is selected trajectory for `final_innings_runs` and `remaining_innings_wickets`, stable 109-feature contract for `final_innings_wickets` and `remaining_innings_runs`, and tuned stable chase for `chase_success`.
- Offline shadow scoring: added an experiment-only CLI that reads captured `/observer/live-model` payloads, loads the selected experimental artifacts, scores targets out-of-band, and writes `shadow_scores.jsonl`, `live_comparison.jsonl`, `rejections.jsonl`, `summary.json`, and `summary.md` under `model/experiments/ball-state/runs/`. It does not modify the observer runtime, dashboard, trading logic, `model/final_models/`, or `model/predict_fixture.py`.
- Shadow scoring smoke checks: `acceptance-smoke-tuned` scored 3 stable/tuned targets and rejected 2 selected-trajectory targets because no exact snapshot event history was supplied; `acceptance-missing-fields` rejected all 5 target rows for missing core fields; invalid candidate manifest fails closed with `invalid candidate manifest: missing selected candidates`.
- Live-compatible parity: matrix-only parity validates for both the stable 109-feature contract and the trajectory 141-feature contract. Live endpoint validation could not be rerun in this pass because the local observer server was not reachable; prior live endpoint validation passed for the stable contract before trajectory features were split out.
- Confidence / caveats: stronger than the initial random split because matches are held out by season and match, and now better aligned with live payload realities. Still not promoted: calibration is not better than the constant-rate baseline on ECE, and snapshot-derived trajectory features need denser/authoritative ball-event coverage before they are useful. Next steps are calibration tuning, better prior coverage, and a true per-ball event feed or less noisy trajectory feature selection.

### Decision

- Outcome: not promoted
- Why: the experiment beats simple baselines across recent-season walk-forward folds, but it is not yet calibrated or wired enough to replace live observer heuristics.
- Deployed model source hash after change: unchanged; no `model/final_models/` artifact changed.
- Supporting evidence:
    - `model/experiments/ball-state/artifacts/manifest.json`
    - `model/experiments/ball-state/live-compatible-artifacts/manifest.json`
    - `model/experiments/ball-state/live-compatible-selected-trajectory-artifacts/manifest.json`
    - `model/experiments/ball-state/live-compatible-platt-artifacts/manifest.json`
    - `model/experiments/ball-state/live-compatible-isotonic-artifacts/manifest.json`
    - `model/experiments/ball-state/live-compatible-trajectory-artifacts/manifest.json`
    - `model/experiments/ball-state/live_candidate_selection_report.json`
    - `model/experiments/ball-state/live_tuning_report.json`
    - `model/experiments/ball-state/tuned/stable_depth4_lr0045_l210/manifest.json`
    - `model/experiments/ball-state/runs/acceptance-smoke-tuned/summary.json`
    - `model/experiments/ball-state/runs/acceptance-missing-fields/summary.json`
    - `model/experiments/ball-state/ball_state_matrix_manifest.json`
    - `model/experiments/ball-state/live_feature_parity_report.json`
    - `model/experiments/ball-state/live_compatible_feature_parity_report.json`
    - `model/experiments/ball-state/live_compatible_selected_trajectory_parity_report.json`
    - `model/experiments/ball-state/live_compatible_trajectory_parity_report.json`

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
