# model/data

This directory is the ML data boundary for the IPL prediction system.

## Sources

- `IPL.csv` - raw Kaggle ball-by-ball dataset already checked into the repo
- `../data/cricsheet` - local Cricsheet archive used to gather squad and registry data into this directory

## Generated structure

- `staged/matches.csv` - canonical match-level rows from `IPL.csv`
- `staged/innings.csv` - innings/team batting summaries with phase splits
- `staged/team_match_stats.csv` - one row per team per match with batting and bowling summary stats
- `staged/player_match_stats.csv` - player batting and bowling match aggregates
- `staged/match_squads.csv` - historical playing XIs from Cricsheet info files
- `staged/player_registry.csv` - stable player identifier map from Cricsheet registry lines
- `raw/cricsheet_match_info.csv` - raw-ish match metadata extracted from Cricsheet info files
- `raw/cricsheet_squads.csv` - raw-ish squad rows extracted from Cricsheet info files
- `metadata/dataset_summary.json` - generated row counts and source summary
- `metadata/aliases.json` - explicit team, venue, and city normalization rules
- `features/preseason_team_rosters_2026.csv` - official preseason retained/traded roster facts for inference-only 2026 squad context
- `features/preseason_team_prior_overrides_2026.csv` - optional inference-only numeric prior overrides sourced from preseason facts

## Notes

- Historical market odds are intentionally excluded from this first data-gathering pass.
- Live OpticOdds and Polymarket data should be treated as inference-time context, not training inputs.
- Post-toss fields should be prepared later on top of these staged historical datasets.
- 2026 preseason roster sidecars are inference-time context. Do not merge them into historical staged data or regenerate training matrices with 2026 match outcomes when using 2026 as an out-of-sample test season.
