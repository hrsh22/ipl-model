# Experimental squad-info match models

This workflow builds **experiment-only** pre-toss/post-toss match-level matrices that keep production artifacts untouched while testing whether 2026 preseason squad information helps the 2026 holdout.

## Boundary

- Outputs stay under `model/experiments/<name>/`.
- `model/final_models/**`, production scheduler wiring, and production API routes are not write targets.
- Canonical training rows are copied from the existing model matrices, whose available seasons currently end at 2025.
- Completed 2026 matches are written as a separate holdout CSV and also appended to the experiment matrix only so trainer folds can evaluate `test_season=2026`; they are never train/calibration rows when `--final-holdout-season 2026` is used.
- 2026 preseason sidecars are date-gated by `source_date <= match_date`.
- Official post-toss squad feeds are disabled while building experiment rows, so completed impact-player/substitution state is not backfilled into pre-match features.
- 2026 test rows use the preseason roster sidecar to choose a likely XI and compute the same XI-strength/resource features the historical model learns from previous seasons.

## Build the experiment matrices

```bash
pnpm model:experiment:squad-info -- --name squad-info-2026
```

This writes:

- `model/experiments/squad-info-2026/data/matrices/pre_toss_squad_info_model_matrix.csv`
- `model/experiments/squad-info-2026/data/matrices/pre_toss_squad_info_holdout_2026.csv`
- `model/experiments/squad-info-2026/data/matrices/post_toss_squad_info_model_matrix.csv`
- `model/experiments/squad-info-2026/data/matrices/post_toss_squad_info_holdout_2026.csv`
- `model/experiments/squad-info-2026/data/metadata/squad_info_model_matrix_manifest.json`
- `model/experiments/squad-info-2026/reports/squad_info_matrix_report.json`

By default, post-toss 2026 holdout rows are skipped because the safe post-toss context needs toss data but must not use completed squad/impact-player feeds. To attempt post-toss holdout rows from the official schedule toss fields only:

```bash
pnpm model:experiment:squad-info -- --name squad-info-2026 --include-post-toss
```

Use `--no-remote-toss` if you want to forbid remote schedule calls entirely.

## Train experimental models

Use the generated manifest explicitly and always pass `--final-holdout-season 2026`. The default trainer manifest remains production's canonical `model/data/metadata/model_matrix_manifest.json`.

```bash
python3 model/train_baselines.py \
  --matrix pre_toss \
  --manifest-path model/experiments/squad-info-2026/data/metadata/squad_info_model_matrix_manifest.json \
  --artifacts-dir model/experiments/squad-info-2026/artifacts \
  --run-label squad_info_full \
  --final-holdout-season 2026
```

Optional XGBoost pre-toss run:

```bash
python3 model/train_xgboost.py \
  --matrix pre_toss \
  --manifest-path model/experiments/squad-info-2026/data/metadata/squad_info_model_matrix_manifest.json \
  --artifacts-dir model/experiments/squad-info-2026/artifacts \
  --run-label xgboost_squad_info_full \
  --final-holdout-season 2026
```

If `--include-post-toss` produced 2026 post-toss holdout rows, run the same commands with `--matrix post_toss` and `--final-holdout-season 2026`.

## Check promotion eligibility

The squad-info outputs are experiment-only by default. Before considering any manual promotion, run the promotion-readiness audit:

```bash
pnpm model:eligibility:match
```

This writes:

- `model/experiments/promotion-readiness/promotion_eligibility_report.json`
- `model/experiments/promotion-readiness/promotion_eligibility_report.md`

The checker does not modify `model/final_models/`. It verifies that the breakthrough candidates have metrics, fold predictions, model artifacts, and `--final-holdout-season 2026` isolation. It also applies the production daily-refresh metric gates against the deployed benchmark metrics.

Post-toss candidates need one extra piece of evidence before they can be called promotion-eligible: a staged `model/check_toss_sensitivity.py` report proving batting-order equivalence and enough toss-state movement. Pass that JSON with `--post-toss-sensitivity-report <path>` once a candidate has been staged into a temporary final-models directory.

## What “uses 2026 squad info” means here

The experiment does **not** train on 2026 match results. It uses historical labeled rows through 2025 for model fitting/calibration, then scores the 44 completed 2026 rows as `test_season=2026`. The 2026 preseason squad sidecar is used only to build the 2026 test-time feature rows, because those squad facts were available before the IPL started.

For each 2026 team row, the builder:

1. filters the dated preseason roster to rows available before the match;
2. excludes inactive roster statuses such as `injured`, `withdrawn`, `unavailable`, `released`, and `replaced-out`;
3. selects a likely XI from the remaining roster using historical player profiles;
4. computes XI/resource features such as `probableXiStrength`, top/middle/finisher strength, bowling strength, missing-key-player flags, and continuity features;
5. records the selected XI in `reports/squad_info_matrix_report.json` for audit.

If a player is injured or replaced before the season, update `preseason_team_rosters_2026.csv` with an inactive status for the outgoing player and an active row for the replacement, then rebuild the experiment. That changes 2026 test-time squad features without putting 2026 match outcomes into training.

That keeps the comparison honest: 2026 outcomes are labels, not training rows, while 2026 squad facts are preseason inputs available before the matches.
