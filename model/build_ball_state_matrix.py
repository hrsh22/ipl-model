#!/usr/bin/env python3
"""Build an experimental ball-by-ball expected-state training matrix.

This intentionally reads the raw ball table instead of the staged match-level
matrices, because the staged pre/post-toss pipeline aggregates delivery state
away. Rows represent the match state after each legal delivery.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "data" / "IPL.csv"
DEFAULT_MATCHUP_FEATURES = ROOT / "data" / "features" / "pre_match_matchup_features.csv"
DEFAULT_TEAM_FEATURES = ROOT / "data" / "features" / "pre_match_team_features.csv"
DEFAULT_EXPERIMENT_DIR = ROOT / "experiments" / "ball-state"
DEFAULT_OUTPUT = DEFAULT_EXPERIMENT_DIR / "ball_state_expected_matrix.csv"
DEFAULT_MANIFEST = DEFAULT_EXPERIMENT_DIR / "ball_state_matrix_manifest.json"

VENUE_PRIOR_COLUMNS = [
    "venue_average_first_innings_score",
    "venue_average_second_innings_score",
    "venue_chasing_win_rate",
    "venue_batting_first_win_rate",
    "venue_avg_powerplay_runs",
    "venue_avg_powerplay_wickets",
    "venue_avg_death_overs_runs",
    "venue_boundary_rate",
    "venue_dot_ball_rate",
    "venue_powerplay_wicket_rate",
    "venue_middle_overs_wicket_rate",
    "venue_death_overs_wicket_rate",
]

TEAM_PRIOR_COLUMNS = [
    "team_overall_win_rate_before_match",
    "team_recent_win_rate_last_5",
    "team_recent_win_rate_last_10",
    "team_venue_win_rate",
    "team_chasing_win_rate",
    "team_batting_first_win_rate",
    "team_boundary_percentage",
    "team_dot_ball_percentage",
    "team_runs_per_wicket",
    "team_runs_conceded_per_wicket_taken",
    "team_avg_wickets_lost",
    "team_powerplay_run_rate",
    "team_powerplay_wickets_lost",
    "team_powerplay_economy",
    "team_powerplay_wickets_taken",
    "team_middle_overs_run_rate",
    "team_middle_overs_economy",
    "team_death_overs_run_rate",
    "team_death_overs_wickets_lost",
    "team_death_overs_economy",
    "team_death_overs_wickets_taken",
    "team_probable_xi_strength",
    "team_top3_strength",
    "team_middle_order_strength",
    "team_finisher_strength",
    "team_powerplay_bowling_strength",
    "team_death_bowling_strength",
    "team_spin_strength",
    "team_pace_strength",
    "team_xi_continuity_score",
    "batting_resource_score",
    "bowling_resource_score",
    "net_resource_score",
    "team_elo_before_match",
    "elo_expected_win",
    "historical_matches_used",
    "likely_xi_matches_used",
]

EVENT_TRAJECTORY_COLUMNS = [
    "runs_last_ball",
    "wicket_last_ball",
    "runs_last_3_balls",
    "runs_last_6_balls",
    "runs_last_12_balls",
    "runs_last_24_balls",
    "wickets_last_3_balls",
    "wickets_last_6_balls",
    "wickets_last_12_balls",
    "wickets_last_24_balls",
    "dot_balls_last_6",
    "dot_balls_last_12",
    "dot_balls_last_24",
    "high_run_balls_last_6",
    "high_run_balls_last_12",
    "high_run_balls_last_24",
    "six_plus_balls_last_6",
    "six_plus_balls_last_12",
    "six_plus_balls_last_24",
    "recent_run_rate_last_6",
    "recent_run_rate_last_12",
    "recent_run_rate_last_24",
    "recent_run_rate_delta_last_6",
    "recent_run_rate_delta_last_12",
    "recent_run_rate_delta_last_24",
    "current_over_runs",
    "current_over_wickets",
    "current_over_dot_balls",
    "current_over_high_run_balls",
    "balls_since_last_wicket",
    "balls_since_last_high_run_ball",
    "consecutive_dot_balls",
]

SELECTED_TRAJECTORY_FEATURES = {
    "runs_last_ball",
    "wicket_last_ball",
    "runs_last_3_balls",
    "runs_last_6_balls",
    "wickets_last_3_balls",
    "wickets_last_6_balls",
    "dot_balls_last_6",
    "high_run_balls_last_6",
    "recent_run_rate_last_6",
    "recent_run_rate_delta_last_6",
    "current_over_runs",
    "current_over_wickets",
    "current_over_dot_balls",
    "balls_since_last_wicket",
    "consecutive_dot_balls",
}


FEATURE_COLUMNS = [
    "season",
    "innings",
    "batting_team",
    "bowling_team",
    "venue",
    "city",
    "toss_winner",
    "toss_decision",
    "batting_team_won_toss",
    "current_runs",
    "current_wickets",
    "legal_balls_bowled",
    "scheduled_balls",
    "overs_bowled",
    "innings_progress",
    "is_regulation_innings",
    "balls_remaining",
    "current_run_rate",
    "over_number",
    "balls_in_over",
    "innings_phase",
    "wickets_in_hand",
    "run_rate_required_delta",
    *EVENT_TRAJECTORY_COLUMNS,
    "required_run_rate",
    "target_runs",
    "runs_to_target",
    *VENUE_PRIOR_COLUMNS,
    *[f"batting_{column}" for column in TEAM_PRIOR_COLUMNS],
    *[f"bowling_{column}" for column in TEAM_PRIOR_COLUMNS],
]

TARGET_COLUMNS = [
    "final_innings_runs",
    "final_innings_wickets",
    "remaining_innings_runs",
    "remaining_innings_wickets",
    "chase_success",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--matchup-features", type=Path, default=DEFAULT_MATCHUP_FEATURES)
    parser.add_argument("--team-features", type=Path, default=DEFAULT_TEAM_FEATURES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    return parser.parse_args()


def read_raw_deliveries(path: Path) -> pd.DataFrame:
    data = pd.read_csv(path, low_memory=False)
    unnamed = [column for column in data.columns if column.startswith("Unnamed") or column == ""]
    if unnamed:
        data = data.drop(columns=unnamed)

    for column in [
        "innings",
        "valid_ball",
        "team_runs",
        "team_wicket",
        "runs_target",
        "team_balls",
        "runs_total",
        "overs",
        "balls_per_over",
    ]:
        data[column] = pd.to_numeric(data[column], errors="coerce")

    data["date"] = pd.to_datetime(data["date"], errors="coerce")
    return data


def normalise_season(value: object) -> int | None:
    if pd.isna(value):
        return None

    text = str(value)
    if "/" in text:
        text = text.split("/", 1)[0]

    try:
        return int(text)
    except ValueError:
        return None


def read_feature_table(path: Path, columns: list[str]) -> pd.DataFrame:
    data = pd.read_csv(path, low_memory=False)
    available = [column for column in columns if column in data.columns]
    return data[available].copy()


def add_pre_match_priors(matrix: pd.DataFrame, matchup_path: Path, team_path: Path) -> pd.DataFrame:
    matchup_columns = ["match_id", *VENUE_PRIOR_COLUMNS]
    matchup = read_feature_table(matchup_path, matchup_columns)
    matrix = matrix.merge(matchup, on="match_id", how="left")

    team_columns = ["match_id", "team", *TEAM_PRIOR_COLUMNS]
    team = read_feature_table(team_path, team_columns)
    batting_team = team.rename(
        columns={column: f"batting_{column}" for column in TEAM_PRIOR_COLUMNS},
    ).rename(columns={"team": "batting_team"})
    bowling_team = team.rename(
        columns={column: f"bowling_{column}" for column in TEAM_PRIOR_COLUMNS},
    ).rename(columns={"team": "bowling_team"})

    matrix = matrix.merge(batting_team, on=["match_id", "batting_team"], how="left")
    matrix = matrix.merge(bowling_team, on=["match_id", "bowling_team"], how="left")
    return matrix


def balls_since_event(flags: pd.Series) -> pd.Series:
    distance = 0
    values = []
    for flag in flags.fillna(False):
        if bool(flag):
            distance = 0
        else:
            distance += 1
        values.append(distance)
    return pd.Series(values, index=flags.index)


def consecutive_true(flags: pd.Series) -> pd.Series:
    streak = 0
    values = []
    for flag in flags.fillna(False):
        streak = streak + 1 if bool(flag) else 0
        values.append(streak)
    return pd.Series(values, index=flags.index)


def build_matrix(deliveries: pd.DataFrame, matchup_path: Path, team_path: Path) -> pd.DataFrame:
    legal = deliveries[deliveries["valid_ball"] == 1].copy()
    legal = legal.sort_values(["match_id", "innings", "team_balls", "ball_no"])
    innings_group = legal.groupby(["match_id", "innings"], sort=False)
    legal["runs_this_ball"] = legal["runs_total"].fillna(0)
    legal["wicket_this_ball"] = innings_group["team_wicket"].diff().fillna(legal["team_wicket"]).clip(lower=0)
    legal["dot_ball_this_ball"] = (legal["runs_this_ball"] == 0).astype(int)
    legal["high_run_ball_this_ball"] = (legal["runs_this_ball"] >= 4).astype(int)
    legal["six_plus_ball_this_ball"] = (legal["runs_this_ball"] >= 6).astype(int)
    legal["runs_last_ball"] = legal["runs_this_ball"]
    legal["wicket_last_ball"] = legal["wicket_this_ball"]
    legal["observed_balls_in_innings"] = innings_group.cumcount() + 1

    for window in [3, 6, 12, 24]:
        legal[f"runs_last_{window}_balls"] = innings_group["runs_this_ball"].transform(
            lambda values: values.rolling(window, min_periods=1).sum(),
        )
        observed_window = legal["observed_balls_in_innings"].clip(upper=window)
        legal[f"recent_run_rate_last_{window}"] = (legal[f"runs_last_{window}_balls"] / observed_window) * 6

    for window in [3, 6, 12, 24]:
        legal[f"wickets_last_{window}_balls"] = innings_group["wicket_this_ball"].transform(
            lambda values: values.rolling(window, min_periods=1).sum(),
        )

    for window in [6, 12, 24]:
        legal[f"dot_balls_last_{window}"] = innings_group["dot_ball_this_ball"].transform(
            lambda values: values.rolling(window, min_periods=1).sum(),
        )
        legal[f"high_run_balls_last_{window}"] = innings_group["high_run_ball_this_ball"].transform(
            lambda values: values.rolling(window, min_periods=1).sum(),
        )
        legal[f"six_plus_balls_last_{window}"] = innings_group["six_plus_ball_this_ball"].transform(
            lambda values: values.rolling(window, min_periods=1).sum(),
        )

    legal["current_over_runs"] = legal.groupby(["match_id", "innings", "over"], sort=False)["runs_this_ball"].cumsum()
    legal["current_over_wickets"] = legal.groupby(["match_id", "innings", "over"], sort=False)["wicket_this_ball"].cumsum()
    legal["current_over_dot_balls"] = legal.groupby(["match_id", "innings", "over"], sort=False)["dot_ball_this_ball"].cumsum()
    legal["current_over_high_run_balls"] = legal.groupby(["match_id", "innings", "over"], sort=False)["high_run_ball_this_ball"].cumsum()
    legal["balls_since_last_wicket"] = innings_group["wicket_this_ball"].transform(lambda values: balls_since_event(values > 0))
    legal["balls_since_last_high_run_ball"] = innings_group["high_run_ball_this_ball"].transform(lambda values: balls_since_event(values > 0))
    legal["consecutive_dot_balls"] = innings_group["dot_ball_this_ball"].transform(lambda values: consecutive_true(values > 0))

    grouped = legal.groupby(["match_id", "innings"], sort=False)
    terminal = grouped.agg(
        final_innings_runs=("team_runs", "max"),
        final_innings_wickets=("team_wicket", "max"),
        final_legal_balls=("team_balls", "max"),
    ).reset_index()

    matrix = legal.merge(terminal, on=["match_id", "innings"], how="left")
    matrix["season"] = matrix["season"].map(normalise_season)
    matrix["current_runs"] = matrix["team_runs"].fillna(0).astype(int)
    matrix["current_wickets"] = matrix["team_wicket"].fillna(0).clip(lower=0, upper=10).astype(int)
    matrix["legal_balls_bowled"] = matrix["team_balls"].fillna(0).astype(int)
    matrix["scheduled_balls"] = (matrix["overs"].fillna(20) * matrix["balls_per_over"].fillna(6)).astype(int)
    matrix["balls_remaining"] = (matrix["scheduled_balls"] - matrix["legal_balls_bowled"]).clip(lower=0)
    matrix["innings_progress"] = matrix["legal_balls_bowled"] / matrix["scheduled_balls"].where(
        matrix["scheduled_balls"] > 0,
    )
    matrix["is_regulation_innings"] = (matrix["scheduled_balls"] == 120).astype(int)
    matrix["wickets_in_hand"] = (10 - matrix["current_wickets"]).clip(lower=0)
    matrix["overs_bowled"] = matrix["legal_balls_bowled"] / 6
    matrix["over_number"] = ((matrix["legal_balls_bowled"] - 1).clip(lower=0) // 6).astype(int)
    matrix["balls_in_over"] = matrix["legal_balls_bowled"] % 6
    matrix["innings_phase"] = pd.cut(
        matrix["legal_balls_bowled"],
        bins=[0, 36, 90, 120],
        labels=["powerplay", "middle", "death"],
        include_lowest=True,
    ).astype(str)
    matrix["current_run_rate"] = matrix["current_runs"] / matrix["overs_bowled"].where(
        matrix["overs_bowled"] > 0,
    )
    for window in [6, 12, 24]:
        matrix[f"recent_run_rate_delta_last_{window}"] = matrix[f"recent_run_rate_last_{window}"] - matrix["current_run_rate"]
    first_innings_target = terminal[terminal["innings"] == 1][["match_id", "final_innings_runs"]].rename(
        columns={"final_innings_runs": "first_innings_final_runs"},
    )
    matrix = matrix.merge(first_innings_target, on="match_id", how="left")
    matrix["target_runs"] = (matrix["first_innings_final_runs"] + 1).where(matrix["innings"] == 2)
    matrix["runs_to_target"] = (matrix["target_runs"] - matrix["current_runs"]).where(
        matrix["target_runs"].notna(),
    )
    remaining_overs = matrix["balls_remaining"] / 6
    matrix["required_run_rate"] = (matrix["runs_to_target"] / remaining_overs).where(
        (matrix["target_runs"].notna()) & (remaining_overs > 0),
    )
    matrix["run_rate_required_delta"] = matrix["required_run_rate"] - matrix["current_run_rate"]
    matrix["batting_team_won_toss"] = (matrix["batting_team"] == matrix["toss_winner"]).astype(int)
    matrix["remaining_innings_runs"] = matrix["final_innings_runs"] - matrix["current_runs"]
    matrix["remaining_innings_wickets"] = matrix["final_innings_wickets"] - matrix["current_wickets"]
    matrix["chase_success"] = (matrix["match_won_by"] == matrix["batting_team"]).where(
        matrix["innings"] == 2,
    )
    matrix["chase_success"] = matrix["chase_success"].map({True: 1, False: 0})
    matrix = add_pre_match_priors(matrix, matchup_path, team_path)

    columns = [
        "match_id",
        "date",
        *FEATURE_COLUMNS,
        *TARGET_COLUMNS,
    ]
    return matrix[columns].dropna(subset=["season", "final_innings_runs", "final_innings_wickets"])


def write_manifest(path: Path, source: Path, output: Path, matrix: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": "ball_state_expected_matrix",
        "status": "experimental",
        "source": str(source),
        "output": str(output),
        "row_count": int(len(matrix)),
        "match_count": int(matrix["match_id"].nunique()),
        "feature_columns": FEATURE_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "joined_feature_sources": {
            "matchup": str(DEFAULT_MATCHUP_FEATURES),
            "team": str(DEFAULT_TEAM_FEATURES),
        },
        "notes": [
            "Rows represent state after each legal delivery.",
            "This matrix is not used by deployed pre/post-toss predictor artifacts.",
            "Pre-match priors are joined from prior-history feature tables only; post-toss features are excluded.",
        ],
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    args = parse_args()
    deliveries = read_raw_deliveries(args.source)
    matrix = build_matrix(deliveries, args.matchup_features, args.team_features)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    matrix.to_csv(args.output, index=False)
    write_manifest(args.manifest, args.source, args.output, matrix)
    print(f"Wrote {len(matrix):,} rows to {args.output}")
    print(f"Wrote manifest to {args.manifest}")


if __name__ == "__main__":
    main()
