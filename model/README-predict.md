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
- live OpticOdds sportsbook overlay (when `OPTICODDS_API_KEY` is available)
- live Polymarket market overlay (when a market can be matched)

Current-season metadata refresh currently updates only the features that are safely derivable from completed match metadata (for example recent win rates, H2H, venue win/toss tendencies, batting-first/chasing rates, and rest days). Ball-by-ball phase features and richer XI/player features still fall back to the latest historical trained snapshot until a richer live data layer is added.

The Polymarket overlay is **not** used as model input. It is returned alongside the prediction for:

- market implied probabilities
- liquidity
- volume
- fair price comparison
- model vs market edge

The OpticOdds sportsbook overlay is also **not** used as model input. It is returned as:

- per-book team win probabilities
- consensus sportsbook probabilities
- max stake / top level when available
- model vs sportsbook-consensus edge

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
- If no matching Polymarket market exists, `market_overlay` will be `null` while `sportsbook_overlay` can still be populated from OpticOdds.
- In `post_toss` mode, official toss + confirmed XI are applied before any file or CLI overrides; file overrides can still replace them if needed.

## Predictor-only server mode

If you want to expose only the predictor UI/API on a VM, you can start the Node server with:

```env
PREDICTOR_ONLY=true
```

In this mode:

- `DATABASE_URL` is not required
- observer startup is skipped
- observer JSON routes return `503`
- `/predictor` and `/predictor/api/*` still work
- `OPTICODDS_API_KEY` is still required for predictor live-data refresh
