# model/data/features

Derived historical feature tables.

- `pre_match_team_features.csv`: one row per team per historical match using prior eligible data only
- `pre_match_player_features.csv`: one row per player per historical match using only that player's prior eligible match history
- `pre_match_matchup_features.csv`: one row per match with venue, H2H, gap features, Elo, toss-history features, eligibility flags, and team-level pre-match features
- `post_toss_matchup_features.csv`: one row per match with the same base features plus actual toss-known fields and toss implication features (`toss_winner`, `toss_decision`, `team1_bats_first`, `team2_bats_first`, batting-order win-rate gaps, and toss-decision preference alignment)
- `training_ready_team_features.csv`: filtered team-level rows where `training_eligible=true`
- `training_ready_player_features.csv`: filtered player-level rows where `training_eligible=true`
- `training_ready_matchup_features.csv`: filtered pre-match matchup rows where `training_eligible=true`
- `training_ready_post_toss_matchup_features.csv`: filtered post-toss matchup rows where `training_eligible=true`
- `preseason_team_rosters_2026.csv`: dated official preseason retained/traded roster facts used by live inference and leakage-safe 2026 experiment holdout rows
- `preseason_team_prior_overrides_2026.csv`: optional dated numeric team-prior override sidecar for 2026 live inference/holdout experiments; keep empty unless a value is backed by preseason-only evidence

Notes:
- Team order comes from Cricsheet match info when available, otherwise alphabetical order is used to avoid innings-order leakage.
- Player pre-match rows are emitted before updating that player's history for the current match, so same-match player performance cannot leak into historical player features.
- XI continuity and probable-XI strength use the last known XI from the same season before the match as the V1 probable-XI proxy.
- Continuity weights follow the markdown source of truth: 0.30 top order, 0.30 bowling core, 0.20 death bowlers, 0.20 overall XI.
- Home/neutral context comes from a static venue mapping with season overrides.
- Training exclusions currently remove neutral-venue seasons/legs, no-result/tie matches, D/L matches, super-over matches, and unresolved home-context rows.
- Post-toss datasets are kept separate so toss-known fields do not leak into the pre-toss model matrix.
- The 2026 preseason sidecars are not model-training inputs. They are read by the live ball-state parity/scoring path and by experiment builders for 2026 holdout rows after historical priors are loaded, are date-gated by `source_date`, and must not contain 2026 match results, scorecards, playing-XI outcomes, or player performance.
