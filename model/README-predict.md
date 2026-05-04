# Standalone model interaction

This repo now supports standalone local interaction with the trained IPL model without any Node/API integration.

## 1. Fit final ensemble components

```bash
pnpm model:fit:final
```

This writes final CatBoost component models under:

- `model/final_models/pre_toss/`
- `model/final_models/post_toss/`

## 2. List upcoming fixtures

```bash
pnpm model:predict -- --list-fixtures
```

## 3. Pre-toss prediction

```bash
pnpm model:predict -- --fixture-id 202604183C470398 --mode pre_toss
```

## 4. Post-toss prediction

```bash
pnpm model:predict -- --fixture-id 202604183C470398 --mode post_toss
```

If the IPL official match-centre feed already has toss + confirmed XI for that fixture, the predictor will auto-inject them.

Fallback only if the official feed is unavailable:

```bash
pnpm model:predict -- --fixture-id 202604183C470398 --mode post_toss --toss-winner "Royal Challengers Bengaluru" --toss-decision field
```

## 5. Optional direct feature overrides

You can override specific model features at request time:

```bash
pnpm model:predict -- --fixture-id 202604183C470398 --mode pre_toss --feature-overrides-json '{"team1_missingKeyBatterCount":1,"team1_probableXiStrength":12.5}'
```

This is useful for live XI/news adjustments until a richer live squad/news fetcher exists.

## 5b. Fixture override file (recommended before toss)

Instead of passing long JSON on the command line, you can put fixture-specific overrides in:

- `model/data/live/fixture_overrides.json`

Default file shipped in the repo is intentionally empty:

```json
{
  "fixtures": {}
}
```

Add entries only when you have real information to override.

Example structure:

```json
{
  "fixtures": {
    "202604183C470398": {
      "common": {
        "feature_overrides": {
          "team1_probableXiStrength": 12.5
        }
      },
      "pre_toss": {
        "feature_overrides": {
          "team1_xiContinuityScore": 0.72
        }
      },
      "post_toss": {
        "toss_winner": "Royal Challengers Bengaluru",
        "toss_decision": "field",
        "feature_overrides": {
          "team1_missingKeyBatterCount": 1
        }
      }
    }
  }
}
```

Priority order is:

1. auto-injected live fixture/Elo data
2. `fixture_overrides.json`
3. direct `--feature-overrides-json` CLI input (highest precedence)

Important:

- the predictor will trust this file if a fixture entry exists
- do **not** put guessed or placeholder cricket values here
- only add overrides based on real lineup/news/toss information

This is the recommended pre-toss path until a richer confirmed/probable XI ingestion flow exists.

## 6. Automatic live injection currently supported

The standalone predictor now auto-injects these live/current inputs:

- fixture shell from `model/data/live/upcoming_fixtures.csv`
- current Elo context from `model/data/live/upcoming_fixture_elo_context.csv`
- refreshed current-season form/H2H/venue-toss/rest-day metadata derived from completed 2026 results where available
- official IPL toss + confirmed XI in `post_toss` mode when available
- live Polymarket market overlay (when a market can be matched)

Current-season metadata refresh currently updates only the features that are safely derivable from completed match metadata (for example recent win rates, H2H, venue win/toss tendencies, batting-first/chasing rates, and rest days). Ball-by-ball phase features and richer XI/player features still fall back to the latest historical trained snapshot until a richer live data layer is added.

The Polymarket overlay is **not** used as model input. It is returned alongside the prediction for:

- market implied probabilities
- liquidity
- volume
- fair price comparison
- model vs market edge

## 7. Still manual / override-only for now

These are still not auto-fetched and should be injected through `--feature-overrides-json` when needed:

- live probable XI
- injuries
- overseas availability
- impact player availability
- captain / key role notes

Confirmed XI is now auto-fetched in `post_toss` mode from the IPL official match-centre feed when available.

## Notes

- Pre-toss uses the current best baseline ensemble:
  - 45% top60-pruned full CatBoost
  - 55% delta CatBoost
- Post-toss uses the current best post-toss ensemble configuration from `model/final_models/post_toss/`
- Market prices are auto-fetched only as an overlay/comparison layer outside the model probability.
- If no matching Polymarket market exists, `market_overlay` will be `null`; prediction can still run from official/local fixture data.
- In `post_toss` mode, official toss + confirmed XI are applied before any file or CLI overrides; file overrides can still replace them if needed.

## Experimental ball-state shadow flags

The ball-by-ball shadow scorer is experimental and isolated from the production
pre/post-toss predictor. `/observer/live-model` can invoke the scorer as a
runtime bridge for the current observer payload using
`model/ball_state_live_candidate_selection.json`; if runtime scoring fails, the
model-scored fields remain unavailable rather than using heuristic expected-state values. Runtime
refresh for saved shadow journals remains opt-in:

- `EXPERIMENTAL_BALL_STATE_SHADOW_REFRESH_ENABLED=false` by default. When false,
  `/observer/ball-state-shadow` is read-only and only reports existing ignored
  experiment artifacts.
- `EXPERIMENTAL_BALL_STATE_REMOTE_FETCH_ENABLED=false` by default. When false,
  runtime ingestion will not fetch ESPN URLs from context files; use saved public
  HTML under `model/experiments/ball-state/` for local experiments.

Keep these disabled in production unless you are intentionally running an
experimental live ball-state session.

## Experimental 2026 preseason squad context

The live ball-state scorer can read dated preseason squad sidecars without changing the trained artifacts:

- `model/data/features/preseason_team_rosters_2026.csv` stores official IPL retained/traded roster facts available before the 2026 season.
- `model/data/features/preseason_team_prior_overrides_2026.csv` is an optional numeric override file for preseason-only team-prior adjustments.

At inference time, `PriorLookup.team_priors()` first loads the frozen historical team priors, then overlays date-gated preseason context for 2026 fixtures. The roster sidecar adjusts `team_xi_continuity_score` by comparing the official preseason roster with the team’s last historical XI. This keeps 2026 match results out of training and out of live feature construction.

Do not put 2026 scorecards, completed-match playing XIs, or current-season player performance in these files if 2026 is being used as an out-of-sample test season.

## 9. Current-season prediction performance tracking

The predictor now keeps a lightweight season ledger for live model calls under `model/data/live/`.

Files:

- `predictor_performance_predictions.jsonl` - immutable prediction snapshots for each `/predictor/api/predict` call
- `predictor_performance_summary.json` - computed season summary using the latest snapshot per `fixture_id + mode + request_profile`
- `predictor_finished_fixtures_<season>.csv` - derived settled-fixture ledger with actual result plus latest pre-toss and post-toss predictions on the same row

Automatic background snapshots are also created while the server is running:

- one automatic `pre_toss` snapshot when a fixture enters the pre-match lookahead window
- one automatic `post_toss` snapshot once the match is near/live and official post-toss data is actually available

Automatic snapshots are deduped by:

- `fixture_id`
- `mode`
- `request_profile`
- current production model source hash

So the maintenance loop does not keep appending the same automatic prediction every 2 minutes.

The production model source hash now fingerprints the full deployed `model/final_models/` tree (component manifests plus model binaries/preprocessors), excluding `revision_history.jsonl`, so prediction snapshots stay tied to the actual shipped model state rather than only the top-level manifest file.

## 10. Model change tracking

The required **human-readable source of truth** now lives in:

- `model/MODEL_CHANGELOG.md`

Use that file for every material model-affecting change, especially when you:

- add or remove a data point / feature
- change feature engineering logic
- tune training/calibration/ensemble settings
- change inference-time inputs that alter probabilities

Each entry should explain:

- what changed
- why it changed
- how it was tested
- what happened to the key metrics
- whether the change was promoted, rejected, or reverted

Also keep the two model-history summaries current:

- `model/PRODUCTION_MODEL_HISTORY.md` for production pre-toss/post-toss model changes, promotions, reversions, and production-relevant results.
- `model/EXPERIMENTAL_MODEL_HISTORY.md` for experiments, rejected candidates, reverted ideas, and the experimental ball-by-ball/ball-state workstream.

Those files should explain model behavior, metric impact, decision, and reason. They should not become file/path inventories.

Automatic logs are still useful, but they are **supporting evidence**, not the readable narrative source of truth. The main supporting files are:

- `model/final_models/revision_history.jsonl`
- `model/data/live/predictor_performance_predictions.jsonl`
- `model/data/live/predictor_performance_summary.json`

The first one tells us exactly when deployed artifacts changed; the other two let us see how that model source hash performed over time.

If you promote manually, add an operator note so later reviews capture why the change was made:

```bash
python3 model/promote_xgboost_experiment.py ... --revision-note "improves post-toss calibration on recent-season walk-forward"
```

```bash
python3 model/promote_catboost_experiment.py ... --revision-note "daily pre-toss promotion after guarded log-loss check"
```

The finished-fixtures CSV is derived from the settled ledger rather than mutating `completed_results_<season>.csv`, so the raw completed-results file stays a clean source input.

The tracker currently settles predictions against:

- `model/data/live/completed_results_<season>.csv`
- current-season rows in `model/data/raw/cricsheet_match_info.csv` when present

The app now refreshes these inputs automatically in the background on a periodic maintenance loop, even if nobody hits the predictor UI:

- `pnpm model:data:fixtures`
- `pnpm model:data:results-current`
- `pnpm model:data:elo-current`
- predictor performance summary rebuild

So ongoing-season evaluation updates automatically as completed results become available in those files.

Available API endpoint:

- `GET /predictor/api/performance`

The summary reports, by season:

- snapshot counts
- pending vs settled predictions
- accuracy
- log loss
- Brier score
- separate slices for `pre_toss` / `post_toss`
- separate slices for `automatic` / `manual` prediction requests

Manual requests are tracked separately so repeated experiments or override-heavy calls do not silently pollute the default automatic model read.

## 11. Safe experiment workflow

The deployed predictor is only changed when you explicitly overwrite `model/final_models/`.

To try alternative training settings, calibration methods, and ensembles without touching the current deployed model:

```bash
pnpm model:experiment -- --name april-backtest-v1 --dry-run
```

Then run the real suite:

```bash
pnpm model:experiment -- --name april-backtest-v1
```

This writes all experimental artifacts under:

- `model/experiments/april-backtest-v1/artifacts/`
- `model/experiments/april-backtest-v1/reports/`

The experiment workflow currently:

- trains multiple feature views in an isolated artifact root
- evaluates both Platt and isotonic calibration when requested
- builds isolated ensemble and stacked variants
- backtests stored predictions against the current baseline artifacts without modifying `model/final_models/`

You can also compare any stored prediction roots directly:

```bash
pnpm model:backtest -- --root current:model/artifacts --root experiment:model/experiments/april-backtest-v1/artifacts --output-dir model/experiments/april-backtest-v1/reports/manual-compare
```

Use this path to decide whether an experiment is better before promoting anything into `model/final_models/`.

## Server runtime

The Node server runs the predictor and observer surfaces together. `DATABASE_URL` is required because observer persistence and readiness checks use Postgres. Fixture and predictor operation use official/local IPL data by default, and the observer API surface remains available without a paid odds feed.
