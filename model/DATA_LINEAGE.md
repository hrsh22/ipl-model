# Model data lineage and attribution guide

This document is the path inventory for answering one question after a probability
or result changes:

> Did the change come from training data / model artifacts, or from inference-time
> inputs around the deployed artifacts?

Keep this file current when adding data sources, changing feature builders,
changing runtime overrides, changing live feeds, or moving model artifacts. Use
`model/MODEL_CHANGELOG.md` for the narrative of material model-affecting changes;
use this file for the concrete data boundary map.

## Quick attribution rules

- If `model/final_models/**`, `model/data/matrices/**`,
  `model/data/features/training_ready_*`, training scripts, or raw historical data
  changed, treat production pre/post-toss probability movement as a **training / artifact** change.
- If `model/data/live/**`, official IPL toss/XI feeds, fixture overrides, direct
  API overrides, or `model/predict_fixture.py` runtime-input logic changed, treat
  production predictor movement as an **inference-input** change.
- If observer odds, Betfair/Polymarket book state, official innings score feeds,
  `observer_*` persistence rows, or `model/runtime_artifacts/ball_state_live/**`
  changed, treat observer live-model movement as an **observer runtime** change.
- If `model/ball_state_live_candidate_selection.json` changes, the experimental
  ball-state overlay may change even when the bundled `.joblib` files are the same.
- 2026 preseason sidecars are inference-only. They must not be merged into
  historical staged tables or training matrices while 2026 remains an out-of-sample
  diagnostic season.

## Production predictor: training data flow

The production predictor is the pre-toss / post-toss match-level model served by
`model/predict_fixture.py` and deployed from `model/final_models/`.

### Stage 0: raw historical sources

| Source | Role | Affects training? | Notes |
| --- | --- | --- | --- |
| `model/data/IPL.csv` | Raw Kaggle ball-by-ball source | Yes | Ignored by git locally; canonical historical cricket event source for current pipelines. |
| `data/cricsheet/**` | Local Cricsheet archive | Yes | Used for match info, squads, registry, and historical XI/player context. |
| `model/data/metadata/aliases.json` | Generated normalization metadata | Yes | Helps audit canonical team, venue, city, and player mapping behavior. |

Changing these files can alter all downstream staged data, derived features,
matrices, and trained artifacts.

### Stage 1: staged historical tables

Command:

```bash
pnpm model:data:prepare
```

Entrypoint:

- `src/model-data/prepare-datasets.ts`

Primary outputs:

| Output | Meaning |
| --- | --- |
| `model/data/staged/matches.csv` | Canonical match-level rows from raw historical sources. |
| `model/data/staged/innings.csv` | Innings/team batting summaries with phase splits. |
| `model/data/staged/team_match_stats.csv` | One row per team per match with batting and bowling summary stats. |
| `model/data/staged/player_match_stats.csv` | Player batting/bowling match aggregates. |
| `model/data/staged/match_squads.csv` | Historical playing XIs from Cricsheet info files. |
| `model/data/staged/player_registry.csv` | Stable player identifier map. |
| `model/data/raw/cricsheet_match_info.csv` | Extracted Cricsheet match metadata. |
| `model/data/raw/cricsheet_squads.csv` | Extracted Cricsheet squad rows. |
| `model/data/metadata/dataset_summary.json` | Generated row counts and source summary. |
| `model/data/metadata/aliases.json` | Generated/explicit normalization rules. |

Attribution note: if a probability changes after this command without model code
changes, compare these staged CSVs first.

### Stage 2: historical feature tables

Command:

```bash
pnpm model:data:derive
```

Entrypoint:

- `src/model-data/derive-features.ts`

Primary outputs:

| Output | Meaning |
| --- | --- |
| `model/data/features/pre_match_team_features.csv` | One row per team per historical match using prior eligible data only. |
| `model/data/features/pre_match_player_features.csv` | One row per player per historical match using that player's prior eligible match history only. |
| `model/data/features/pre_match_matchup_features.csv` | One pre-toss row per match with venue, H2H, gap, Elo, toss-history, eligibility, and team features. |
| `model/data/features/post_toss_matchup_features.csv` | One post-toss row per match with base features plus toss-known and batting-order features. |
| `model/data/features/training_ready_team_features.csv` | `pre_match_team_features` filtered to `training_eligible=true`. |
| `model/data/features/training_ready_player_features.csv` | `pre_match_player_features` filtered to `training_eligible=true`. |
| `model/data/features/training_ready_matchup_features.csv` | Pre-toss matchup rows filtered to `training_eligible=true`. |
| `model/data/features/training_ready_post_toss_matchup_features.csv` | Post-toss matchup rows filtered to `training_eligible=true`. |
| `model/data/metadata/feature_summary.json` | Feature generation summary and counts. |

Important leakage controls in this stage:

- Team, venue, matchup, player, and Elo histories are updated after emitting the
  current match row, so same-match results are not visible as prior history.
- Player pre-match rows are emitted before updating that player's current-match
  performance.
- Cricsheet team order is preferred; alphabetical fallback is used when necessary
  to avoid innings-order leakage.
- `post_toss_matchup_features.csv` is separate from `pre_match_matchup_features.csv`
  so toss-known fields do not leak into pre-toss training.
- Current training exclusions remove no-result rows, ties, reduced-overs/DLS rows,
  super-over rows, neutral-venue rows, and unresolved home-context rows.

### Stage 3: frozen model matrices

Command:

```bash
pnpm model:data:matrix
```

Entrypoint:

- `src/model-data/build-model-matrices.ts`

Inputs:

- `model/data/features/training_ready_matchup_features.csv`
- `model/data/features/training_ready_post_toss_matchup_features.csv`

Outputs:

| Output | Meaning |
| --- | --- |
| `model/data/matrices/pre_toss_model_matrix.csv` | Frozen pre-toss training matrix. |
| `model/data/matrices/post_toss_model_matrix.csv` | Frozen post-toss training matrix. |
| `model/data/metadata/model_matrix_manifest.json` | Matrix paths, row counts, and feature metadata consumed by training scripts. |

Attribution note: when model metrics change after only `build-model-matrices.ts` or
matrix files change, blame feature allowlist/matrix freezing before blaming model
families.

### Stage 4: training scripts and artifact outputs

Commands:

```bash
pnpm model:train:pretoss
pnpm model:train:posttoss
pnpm model:ensemble:pretoss
pnpm model:ensemble:posttoss
pnpm model:fit:final
pnpm model:train:ball-state
```

Production predictor training entrypoints:

| Script | Role | Main input |
| --- | --- | --- |
| `model/train_baselines.py` | CatBoost / baseline model training for pre/post-toss matrices. | `model/data/metadata/model_matrix_manifest.json` |
| `model/train_xgboost.py` | XGBoost experiments and accepted post-toss family training. | `model/data/metadata/model_matrix_manifest.json` |
| `model/build_catboost_ensemble.py` | Ensemble construction/evaluation. | Trained CatBoost artifacts. |
| `model/fit_final_catboost_ensemble.py` | Fits/promotes final production CatBoost components. | Approved matrix/artifact inputs. |
| `model/promote_xgboost_experiment.py` | Promotion helper for XGBoost experiment outputs. | Experiment artifact directory. |

Typical experiment outputs include:

- `fold_metrics.csv`
- `fold_predictions.csv`
- `summary_metrics.csv`
- `training_manifest.json`
- fold model binaries/preprocessors under `models/`

Current production deployment boundary:

| Path | Meaning |
| --- | --- |
| `model/final_models/manifest.json` | Root production artifact manifest. |
| `model/final_models/pre_toss/top60_full/catboost_model.cbm` | Active pre-toss component. |
| `model/final_models/pre_toss/top60_full/manifest.json` | Active pre-toss component metadata. |
| `model/final_models/pre_toss/delta/catboost_model.cbm` | Active pre-toss delta component. |
| `model/final_models/pre_toss/delta/manifest.json` | Active pre-toss delta metadata. |
| `model/final_models/post_toss/xgboost_post_toss_state_linear/xgboost_model.json` | Active post-toss model binary. |
| `model/final_models/post_toss/xgboost_post_toss_state_linear/preprocessor.joblib` | Active post-toss preprocessor. |
| `model/final_models/post_toss/xgboost_post_toss_state_linear/manifest.json` | Active post-toss component metadata. |
| `model/final_models/revision_history.jsonl` | Promotion/revision audit trail. |

Production predictor probabilities should be attributed to `model/final_models/**`
only after confirming runtime inputs did not change.

## Production predictor: inference-time data flow

The production predictor is invoked by the Node server through
`model/predict_fixture.py`. It can change output probabilities without retraining
when runtime files, official feeds, or request overrides change.

### Server and script boundary

| Boundary | Path |
| --- | --- |
| Node server route wiring | `src/index.ts` |
| Predictor script | `model/predict_fixture.py` |
| Runtime config | `src/config.ts` |
| Deployed artifacts | `model/final_models/**` |

Relevant API surfaces include predictor context/predict routes in `src/index.ts`.
The server shells out to `python3 model/predict_fixture.py` for prediction work.

### Inference files that can move production predictor probabilities

| Path | Role | Training input? |
| --- | --- | --- |
| `model/final_models/**` | Loaded model binaries, preprocessors, manifests, and ensemble configuration. | Artifact output, not raw input. |
| `model/data/live/upcoming_fixtures.json` / `.csv` | Runtime fixture shell and official/current fixture context. | No. |
| `model/data/live/upcoming_fixture_elo_context.csv` | Current runtime Elo context for upcoming fixtures. | No. |
| `model/data/live/fixture_overrides.json` | Operator fixture-specific overrides. | No. |
| `model/data/live/completed_results_<season>.csv` | Current-season completed results used for live/current-season supplements and performance settlement. | No, unless intentionally promoted into historical training later. |
| `model/data/live/current_season_match_squads.csv` | Runtime current-season squad/XI context. | No. |
| `model/data/live/current_season_player_match_stats.csv` | Runtime current-season player stat sidecar. | No. |
| `model/data/features/training_ready_matchup_features.csv` | Historical feature base read at inference to construct comparable rows. | Yes, generated training table also reused at inference. |
| `model/data/raw/cricsheet_match_info.csv` | Historical metadata used for context lookup. | Yes. |
| `model/data/staged/player_match_stats.csv` | Historical player-performance source for XI/resource lookup. | Yes. |
| `model/data/staged/match_squads.csv` | Historical XI source. | Yes. |
| `model/data/features/preseason_team_rosters_2026.csv` | 2026 preseason roster-continuity context. | No. |
| `model/data/features/preseason_team_prior_overrides_2026.csv` | Optional 2026 preseason numeric team-prior overrides. | No. |

### Remote feeds that can move production predictor probabilities

| Feed | Role | Model input? |
| --- | --- | --- |
| IPL official competition/schedule feeds under `https://scores.iplt20.com/ipl/mc/` | Fixture and match schedule metadata. | Yes, through fixture context. |
| IPL official squad feed under `https://scores.iplt20.com/ipl/mc/{match_id}-squad.js` | Toss and confirmed/effective XI in post-toss mode. | Yes. |
| Polymarket Gamma API | Market overlay and comparison. | No; returned beside prediction. |

### Override precedence

For production predictor requests, runtime inputs are applied in this order:

1. Automatically loaded fixture/Elo/current-season context.
2. `model/data/live/fixture_overrides.json`.
3. Direct request or CLI overrides, including manual feature overrides, toss input,
   and manual probable XI.

If a probability changes and the model artifacts are unchanged, inspect this
override chain before retraining anything.

### Runtime freshness and audit files

Background maintenance refreshes runtime sidecars using commands such as:

- `pnpm model:data:fixtures`
- `pnpm model:data:results-current`
- `pnpm model:data:squads-current`
- `pnpm model:data:player-stats-current`
- `pnpm model:data:elo-current`

Audit / performance files:

- `model/data/live/predictor_performance_predictions.jsonl`
- `model/data/live/predictor_performance_summary.json`
- `model/data/live/predictor_finished_fixtures_<season>.csv`

These files are for attribution and performance tracking. They should not be
treated as training inputs unless explicitly promoted through the historical data
pipeline after audit.

## Experimental ball-state model: training data flow

The ball-state model is the experimental ball-by-ball observer overlay. It is not
the production pre/post-toss predictor.

### Raw and derived inputs

| Input | Role | Notes |
| --- | --- | --- |
| `model/data/IPL.csv` | Raw delivery-level historical source. | Used because match-level staging loses per-ball state granularity. |
| `model/data/features/pre_match_matchup_features.csv` | Historical pre-match venue/team/matchup priors. | Joined as prior-only context. |
| `model/data/features/pre_match_team_features.csv` | Historical team priors. | Joined as prior-only batting/bowling team context. |

Post-toss features are intentionally excluded from ball-state matrix generation.

### Matrix generation

Command:

```bash
pnpm model:data:ball-state
```

Entrypoint:

- `model/build_ball_state_matrix.py`

Outputs:

| Output | Meaning |
| --- | --- |
| `model/experiments/ball-state/ball_state_expected_matrix.csv` | One row per legal delivery state after each ball. |
| `model/experiments/ball-state/ball_state_matrix_manifest.json` | Feature/target metadata and matrix path. |

Targets in the ball-state matrix:

- `expected_runs_now`
- `expected_wickets_now`
- `final_innings_runs`
- `final_innings_wickets`
- `remaining_innings_runs`
- `remaining_innings_wickets`
- `batting_team_match_win` (trained and consumed for innings 1 only)
- `chase_success`

Leakage controls:

- Matrix rows are built after legal deliveries only.
- Pre-match priors come from prior-history feature tables.
- Post-toss features are excluded.
- Training uses walk-forward season folds or chronological match splits to avoid
  same-match row leakage.
- Calibration holdouts are drawn only from the training side.

### Ball-state training and selected runtime artifacts

Training commands:

```bash
pnpm model:train:ball-state
pnpm model:train:ball-state-live
pnpm model:train:ball-state-live-trajectory
pnpm model:train:ball-state-live-selected-trajectory
pnpm model:tune:ball-state-live
pnpm model:select:ball-state-live
```

Entrypoints:

- `model/train_ball_state.py`
- `model/tune_ball_state_live_candidates.py`
- `model/select_ball_state_live_candidate.py`

Experiment output roots:

- `model/experiments/ball-state/artifacts/`
- `model/experiments/ball-state/live-compatible-artifacts/`
- `model/experiments/ball-state/live-compatible-trajectory-artifacts/`
- `model/experiments/ball-state/live-compatible-selected-trajectory-artifacts/`
- `model/experiments/ball-state/tuned/**`

Runtime selection boundary:

| Path | Role |
| --- | --- |
| `model/ball_state_live_candidate_selection.json` | Selects which experimental targets/artifacts the observer runtime bridge uses. |
| `model/runtime_artifacts/ball_state_live/expected_runs_now_model.joblib` | Deployed experimental runtime artifact. |
| `model/runtime_artifacts/ball_state_live/expected_wickets_now_model.joblib` | Deployed experimental runtime artifact. |
| `model/runtime_artifacts/ball_state_live/final_innings_runs_model.joblib` | Deployed experimental runtime artifact. |
| `model/runtime_artifacts/ball_state_live/batting_team_match_win_model.joblib` | Deployed experimental first-innings batting-team match-win artifact. |
| `model/runtime_artifacts/ball_state_live/chase_success_model.joblib` | Deployed experimental runtime artifact. |
| `model/runtime_artifacts/ball_state_live/ball_state_matrix_manifest.json` | Deployed feature-column contract for the runtime scorer. |

The `source_artifact` fields in `model/ball_state_live_candidate_selection.json`
point back to ignored experiment outputs for provenance. Runtime deploys should
depend on `model/runtime_artifacts/ball_state_live/**`, not on ignored
`model/experiments/**` files. The runtime manifest intentionally omits the full
training matrix CSV; the scorer can run without it and will skip dtype hints when
the matrix CSV is absent.

Feature-mode leakage controls:

- `live_expected_now` removes observed score/wicket fields and trajectory windows
  so expected-now models cannot simply copy current score state.
- `live_compatible` removes toss and unavailable trajectory fields.
- `live_compatible_selected_trajectory` removes toss fields and keeps only the
  selected live trajectory subset.
- `chase_success` is innings-2 only; terminal chases are hard-coded to `1.0` when
  target is crossed and `0.0` when all-out or balls-exhausted below target.

## Observer live-model and ball-state overlay: inference-time data flow

The observer live model is served by `GET /observer/live-model` and displayed in
the dashboard through `apps/web/src/routes/observer.tsx`. The dashboard polls the
web proxy every five seconds.

### Runtime flow

1. Live result/odds feeds update observer state and Postgres tables.
2. The dashboard calls `/api/observer/live-model`, which proxies to backend
   `/observer/live-model`.
3. The backend builds a base observer live-model payload from current fixture,
   odds, official innings, and market state.
4. The backend writes temporary `live-model.json` and `live-model-snapshots.json`.
5. The backend invokes `model/shadow_score_ball_state_live.py` with
   `model/ball_state_live_candidate_selection.json`.
6. Python builds live feature rows, scores selected targets, and writes
   `shadow_scores.jsonl` plus summary files.
7. Node reads those scores, merges them into the live-model fixture as an overlay,
   persists runtime snapshots/signals, and returns the merged response to the UI.

### Observer runtime inputs that can move probabilities

| Input | Role | Training input? |
| --- | --- | --- |
| OpticOdds fixtures/odds/results streams | Fixture shell, live odds, result snapshots. | No. |
| Betfair exchange odds via observer odds state | Primary reference book for fair probability. | No. |
| 1xbet / Parimatch odds via observer odds state | Support/confidence/diagnostic books. | No. |
| Polymarket Gamma/CLOB/WS state | PM probability and edge overlay. | No. |
| IPL official innings feeds `https://scores.iplt20.com/ipl/feeds/{match_id}-Innings{innings}.js` | Current score, wickets, overs, innings completion, target. | No. |
| `model/data/live/upcoming_fixtures.json` | Local fixture fallback when OpticOdds is disabled. | No. |
| `observer_fixtures` table | Persisted fixture/result state. | No. |
| `observer_odds` table | Persisted odds/book state. | No. |
| `observer_live_model_snapshots` table | Snapshot history used for ball-state trajectory features and history UI. | No. |
| `observer_live_model_signals` table | Persisted signal journal. | No. |
| `observer_checkpoints` table | SSE resume/checkpoint state. | No. |
| `model/runtime_artifacts/ball_state_live/**` | Experimental runtime scorer artifacts. | Artifact output. |
| `model/ball_state_live_candidate_selection.json` | Runtime artifact/feature-mode selection. | Runtime config. |

### Optional live ball-event experiment boundary

These files/scripts are for experimental event capture only and should not feed
production training while a match is live:

| Path | Role |
| --- | --- |
| `model/capture_live_ball_events.py` | Append provider payloads into local journals. |
| `model/scrape_espncricinfo_ball_events.py` | Public ESPN commentary parser for local experiments. |
| `model/build_live_event_snapshots.py` | Converts normalized delivery events into live-model snapshots. |
| `model/build_live_payload_from_events.py` | Builds local live-model payloads from event journals. |
| `model/run_no_paid_ball_state_live.py` | One-command no-paid experimental validation path. |
| `model/experiments/ball-state/live-events/**` | Ignored local event journals and derived snapshots. |

These paths must not write into `model/final_models/`, `model/predict_fixture.py`,
or `model/data/live/` during live testing. After a match is complete and audited,
raw live delivery journals may become future historical training evidence only via
an explicit promotion/reconciliation step.

## Change checklist for future work

When probabilities or metrics move, check in this order:

1. Did `model/final_models/**` or `model/runtime_artifacts/ball_state_live/**`
   change?
2. Did a manifest change?
   - `model/final_models/manifest.json`
   - `model/ball_state_live_candidate_selection.json`
   - `model/data/metadata/model_matrix_manifest.json`
   - `model/experiments/ball-state/ball_state_matrix_manifest.json`
3. Did generated historical data change?
   - `model/data/staged/**`
   - `model/data/features/**`
   - `model/data/matrices/**`
4. Did runtime-local data change?
   - `model/data/live/**`
   - `observer_*` Postgres tables
5. Did live external state change?
   - official IPL fixture/squad/innings feeds
   - OpticOdds streams
   - Betfair/1xbet/Parimatch odds
   - Polymarket Gamma/CLOB/WS state
6. Did request/operator input change?
   - `model/data/live/fixture_overrides.json`
   - direct API overrides
   - manual probable XI / toss input
7. Did code change in a boundary file?
   - `src/model-data/prepare-datasets.ts`
   - `src/model-data/derive-features.ts`
   - `src/model-data/build-model-matrices.ts`
   - `model/predict_fixture.py`
   - `model/build_ball_state_matrix.py`
   - `model/train_ball_state.py`
   - `model/shadow_score_ball_state_live.py`
   - `model/validate_ball_state_live_parity.py`
   - `src/observer/service.ts`
   - `src/index.ts`

If the answer is yes to any of the above and model behavior changed, document the
change in `model/MODEL_CHANGELOG.md`. If the active production artifacts changed,
also update `model/PRODUCTION_MODEL_HISTORY.md`. If the change is experimental or
ball-state-only, update `model/EXPERIMENTAL_MODEL_HISTORY.md`.
