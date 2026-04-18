# Player Style Enrichment Plan

This plan completes the missing non-live Step 7 style-dependent features for the IPL pre-toss model using a **free** source path.

## Decision

- Primary source: `cricketdata::player_meta`
- Identity bridge: `Cricsheet Register`
- Fallbacks: `IPL official site`, `Wikidata`, and manual overrides

Reason:

- `cricketdata::player_meta` is the best free practical structured source for `batting_style`, `bowling_style`, and `playing_role`
- Cricsheet Register gives the strongest free ID bridge from our local Cricsheet person ids to Cricinfo-linked metadata
- this avoids subscriptions while still giving us enough metadata to derive the missing spin/pace features

## What this unlocks

After ingestion, we can derive the currently missing features:

- `team_spin_strength`
- `team_pace_strength`
- `venue_spin_wicket_share`
- `venue_pace_wicket_share`

## Current local join backbone

Already available locally:

- `model/data/staged/player_registry.csv`
  - local Cricsheet player name to local `person_id`
- `model/data/staged/match_squads.csv`
  - historical playing XIs
- `model/data/staged/player_match_stats.csv`
  - batting position, bowling balls, death bowling balls, wickets, runs conceded, dot balls
- `model/data/IPL.csv`
  - ball-by-ball source with bowler identity, wicket events, venue, innings, and phase context

Important limitation:

- the current local `player_registry.csv` only has `player_name,person_id`
- for the strongest free join path we need the **full Cricsheet Register people.csv** (and optionally `names.csv`)

## Free source path

### 1. Cricsheet Register

Use:

- `people.csv`
- `names.csv`

Key fields we care about:

- `identifier` / Cricsheet id
- `name`
- `unique_name`
- `key_cricinfo`

Purpose:

- bridge our local Cricsheet person ids to Cricinfo-linked metadata without relying on fuzzy player-name matching

### 2. cricketdata::player_meta

Use as the main free style dataset.

Important fields:

- `cricsheet_id`
- `cricinfo_id`
- `name`
- `unique_name`
- `full_name`
- `batting_style`
- `bowling_style`
- `playing_role`

Purpose:

- provide the structured batting/bowling style and role fields needed for player-style enrichment

### 3. Fallbacks

Use only when the primary free path is missing players or style fields:

- IPL official player pages for current squad role validation
- Wikidata for occasional role/bowling-style recovery
- manual overrides in our metadata tables

## Local datasets to create / maintain

### 1. Manual/import source table

- `model/data/metadata/player_styles.csv`

This remains the local import table that our pipeline reads.

Columns:

- `player_name`
- `cricsheet_person_id`
- `source_name`
- `source_player_id`
- `batting_style_raw`
- `bowling_style_raw`
- `identified_roles_raw`
- `playing_role_raw`
- `needs_manual_review`
- `notes`

Expected source names for the free path:

- `cricketdata::player_meta`
- `cricsheet_register`
- `ipl_official`
- `wikidata`
- `manual`

### 2. Manual override table

- `model/data/metadata/player_style_overrides.csv`

Columns:

- `player_name`
- `cricsheet_person_id`
- `override_bowling_style_canonical`
- `override_bowling_style_family`
- `override_role_canonical`
- `notes`

### 3. Canonical staged player style table

- `model/data/staged/player_style_profiles.csv`

Columns already supported by the repo:

- `player_name`
- `player_name_key`
- `cricsheet_person_id`
- `source_name`
- `source_player_id`
- `batting_style_raw`
- `bowling_style_raw`
- `identified_roles_raw`
- `playing_role_raw`
- `batting_hand`
- `bowling_style_canonical`
- `bowling_style_family`
- `role_canonical`
- `is_keeper`
- `is_bowling_option`
- `is_spin_option`
- `is_pace_option`
- `needs_manual_review`
- `notes`

## Join strategy

Preferred order:

1. `person_id` from local `player_registry.csv`
2. full Cricsheet Register `people.csv.identifier`
3. `key_cricinfo`
4. `cricketdata::player_meta.cricinfo_id` or `cricsheet_id`

Fallback order:

1. exact `player_name`
2. normalized `player_name_key`
3. season + team constrained joins using `match_squads.csv`
4. manual override rows

Important:

- do not rely on fuzzy matching alone
- use `names.csv` only as a fallback alias layer, not as the primary join key

## Bowling style normalization rules

Map raw bowling-style strings into canonical families.

### Spin family

Examples:

- `offbreak`
- `right-arm offbreak`
- `legbreak`
- `legbreak googly`
- `slow left-arm orthodox`
- `slow left-arm chinaman`
- `left-arm wrist spin`

### Pace family

Examples:

- `right-arm fast`
- `right-arm fast-medium`
- `right-arm medium-fast`
- `right-arm medium`
- `left-arm fast`
- `left-arm fast-medium`
- `left-arm medium`

### Other / unknown

- `none`
- `unknown`
- batting-only players with no bowling style

## Derivation rules

## Team spin / pace strength

Compute from the same-season probable-XI proxy, just like the current Step 7 logic.

For each player in the probable XI:

- get existing bowling strength proxy from local same-season stats
- join style from `player_style_profiles.csv`
- split bowlers by `bowling_style_family`

Then derive:

- `team_spin_strength` = average bowling-strength score of probable-XI bowling options where `bowling_style_family=spin`
- `team_pace_strength` = average bowling-strength score of probable-XI bowling options where `bowling_style_family=pace`

If no players exist in a family:

- use `0`

## Venue spin / pace wicket share

Use bowler-attributed wickets joined to bowler style.

Then compute:

- `venue_spin_wicket_share = spin_attributed_wickets_at_venue / all_spin_plus_pace_wickets_at_venue`
- `venue_pace_wicket_share = pace_attributed_wickets_at_venue / all_spin_plus_pace_wickets_at_venue`

## Where this plugs into the repo

### Source ingestion / normalization

- `src/model-data/prepare-player-styles.ts`
  - normalize raw imported player-style metadata into `player_style_profiles.csv`

### Feature derivation

`src/model-data/derive-features.ts` already supports:

- loading `player_style_profiles.csv`
- computing `team_spin_strength`
- computing `team_pace_strength`
- computing `venue_spin_wicket_share`
- computing `venue_pace_wicket_share`

These flow into:

- `pre_match_team_features.csv`
- `training_ready_team_features.csv`
- `pre_match_matchup_features.csv`
- `training_ready_matchup_features.csv`

## Training vs inference boundary

These remain inference-time only, not training requirements:

- live probable XI feed
- confirmed XI
- injuries
- overseas availability
- impact player options
- captain
- key role players
- live market prices / bid / ask / spread / liquidity / volume / movement

Why:

- if not archived historically, they cannot be supervised training features without leakage / sample mismatch
- they should be injected at prediction time for the specific requested match

## Completion criteria for V1 Steps 1 and 7

After the free style-ingestion work is populated with real player-style rows, the remaining non-live Step 7 gap is closed for V1.

At that point, the intentionally inference-only items are:

- live XI/news layer
- live market layer

Everything else in the Step 1 + Step 7 V1 scope should be considered complete enough for a training-ready pre-toss matrix.
