# Daily model refresh and retraining

This repo now supports a cron-safe daily refresh flow that:

1. refreshes live/current-season IPL inputs
2. rebuilds derived features and matrices
3. retrains the current winner candidates
4. archives dated reports under `model/experiments/daily-refresh-runs/`
5. appends metrics into `model/data/live/daily_retraining_history.csv`

## Command

```bash
pnpm model:daily-refresh
```

Useful options:

```bash
pnpm model:daily-refresh -- --dry-run
pnpm model:daily-refresh -- --run-id 20260421-daily
pnpm model:daily-refresh -- --skip-refresh
pnpm model:daily-refresh -- --skip-train
pnpm model:daily-refresh -- --auto-promote-pre-toss --promotion-dry-run
pnpm model:daily-refresh -- --auto-promote-pre-toss --auto-promote-post-toss
```

## What it runs

### Live/current-season refresh

- `pnpm model:data:fixtures`
- `pnpm model:data:results-current`
- `pnpm model:data:squads-current`
- `pnpm model:data:player-stats-current`
- `pnpm model:data:elo-current`
- `pnpm model:data:derive`
- `pnpm model:data:matrix`

### Daily retraining candidates

- `pre_toss / top60_full_daily`
- `pre_toss / delta_daily`
- `pre_toss / ensemble_top60_full__delta_daily`
- `post_toss / xgboost_post_toss_state_linear_daily`

These are retrained into a dated run root under:

- `model/experiments/daily-refresh-runs/<run-id>/artifacts/`

### Reporting

The runner generates:

- `model/experiments/daily-refresh-runs/<run-id>/reports/leaderboard.csv`
- `model/experiments/daily-refresh-runs/<run-id>/README.md`

It also appends summary rows into:

- `model/data/live/daily_retraining_history.csv`
- `model/data/live/daily_retraining_latest.json`
- `model/data/live/daily_promotion_history.jsonl`

## Promotion policy

By default the daily runner does **not** auto-promote production models.

If you enable:

```bash
pnpm model:daily-refresh -- --auto-promote-pre-toss --auto-promote-post-toss
```

the runner will evaluate the daily pre-toss and post-toss production candidates against the currently promoted production baselines and **promote by default** unless they clearly regress.

It will block promotion only when:

- log loss regresses beyond the allowed threshold
- Brier regresses beyond the allowed threshold
- ROC-AUC drops beyond the allowed threshold
- candidate metrics are missing / invalid

For post-toss promotion, the runner also stages the candidate and runs:

```bash
pnpm model:sensitivity:toss -- --fixture-id <fixture-id> --final-models-dir <staging-root> --min-spread 0.001 --max-equivalent-state-diff 1e-9
```

This blocks promotion unless the candidate is both sensitive to the resulting batting-order state and invariant across equivalent toss phrasings. For example, “team 1 wins toss and bats” must match “team 2 wins toss and fields.”

Pre-toss promotion rebuilds the production CatBoost components from the daily `top60_full_daily` + `delta_daily` artifacts using the daily ensemble-selected weights and records the ensemble summary as the future production baseline.

The promotion still creates a rollback backup first via `model/promote_catboost_experiment.py` and `model/promote_xgboost_experiment.py`.

## Cron example (4am IST)

Run on a machine already configured with the repo, Python deps, and Node deps:

```cron
0 4 * * * cd /home/cric-predictor/apps/ipl-model && /usr/bin/flock -n /tmp/ipl-model-daily-refresh.lock pnpm model:daily-refresh -- --auto-promote-pre-toss --auto-promote-post-toss >> logs/daily_model_refresh.log 2>&1
```

If `flock` is unavailable, use a simpler cron entry first:

```cron
0 4 * * * cd /home/cric-predictor/apps/ipl-model && pnpm model:daily-refresh -- --auto-promote-pre-toss --auto-promote-post-toss >> logs/daily_model_refresh.log 2>&1
```

## PM2 ecosystem option

This repo now includes:

- `ecosystem.config.cjs`

It defines two PM2 apps:

- `ipl-model-api`
- `ipl-model-daily-refresh`

The daily refresh process is configured with:

- `pnpm model:daily-refresh -- --auto-promote-pre-toss --auto-promote-post-toss`
- `cron_restart: "0 4 * * *"`
- `autorestart: false`

Example usage:

```bash
pm2 start ecosystem.config.cjs --only ipl-model-api
pm2 start ecosystem.config.cjs --only ipl-model-daily-refresh
pm2 save
```

Important note:

- the first time you start `ipl-model-daily-refresh`, PM2 will run it immediately once and then keep it scheduled for future cron restarts.
- the ecosystem file prepends both `venv/bin` and `.venv/bin` to `PATH` so `python3` inside the daily runner resolves to the project virtualenv if present.

## Operational notes

- `model/data/live/` is already ignored by git, so daily metrics history remains runtime-local.
- `model/experiments/` is ignored by git, so dated daily run artifacts stay local to the server.
- If an official innings feed is missing for a completed match, the current player-stats refresh skips that match and continues.
