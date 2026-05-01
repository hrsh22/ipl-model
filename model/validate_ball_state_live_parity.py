#!/usr/bin/env python3
"""Validate experimental ball-state feature parity against live observer payloads.

This script does not score models or touch production artifacts. It only checks
whether a live observer payload can be represented with the same feature columns
used by the experimental ball-state matrix.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import pandas as pd

from build_ball_state_matrix import (
    DEFAULT_MATCHUP_FEATURES,
    DEFAULT_TEAM_FEATURES,
    EVENT_TRAJECTORY_COLUMNS,
    SELECTED_TRAJECTORY_FEATURES,
    TEAM_PRIOR_COLUMNS,
    VENUE_PRIOR_COLUMNS,
)


LIVE_UNAVAILABLE_FEATURES = {
    "toss_winner",
    "toss_decision",
    "batting_team_won_toss",
}

EXPECTED_NOW_UNAVAILABLE_FEATURES = {
    "current_runs",
    "current_wickets",
    "current_run_rate",
    "wickets_in_hand",
    "run_rate_required_delta",
    "required_run_rate",
    "runs_to_target",
    *EVENT_TRAJECTORY_COLUMNS,
}


ROOT = Path(__file__).resolve().parent
DEFAULT_EXPERIMENT_DIR = ROOT / "experiments" / "ball-state"
DEFAULT_MANIFEST = DEFAULT_EXPERIMENT_DIR / "ball_state_matrix_manifest.json"
DEFAULT_MATRIX = DEFAULT_EXPERIMENT_DIR / "ball_state_expected_matrix.csv"
DEFAULT_OUTPUT = DEFAULT_EXPERIMENT_DIR / "live_feature_parity_report.json"

CORE_LIVE_FEATURES = {
    "season",
    "innings",
    "batting_team",
    "bowling_team",
    "venue",
    "current_runs",
    "current_wickets",
    "legal_balls_bowled",
    "scheduled_balls",
    "overs_bowled",
    "innings_progress",
    "balls_remaining",
    "current_run_rate",
    "over_number",
    "balls_in_over",
    "innings_phase",
    "wickets_in_hand",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--matchup-features", type=Path, default=DEFAULT_MATCHUP_FEATURES)
    parser.add_argument("--team-features", type=Path, default=DEFAULT_TEAM_FEATURES)
    parser.add_argument(
        "--feature-mode",
        choices=["full", "live_compatible", "live_compatible_trajectory", "live_compatible_selected_trajectory", "live_expected_now"],
        default="full",
    )
    parser.add_argument("--url", help="Optional live-model endpoint URL to validate")
    parser.add_argument("--json", type=Path, help="Optional saved live-model JSON payload")
    parser.add_argument("--snapshots-url", help="Optional live-model snapshots endpoint for event trajectory features")
    parser.add_argument("--snapshots-json", type=Path, help="Optional saved live-model snapshots JSON payload")
    return parser.parse_args()


class PriorLookup:
    def __init__(self, matchup_path: Path, team_path: Path) -> None:
        self.matchup = pd.read_csv(matchup_path, low_memory=False)
        self.team = pd.read_csv(team_path, low_memory=False)
        self.matchup["match_date"] = pd.to_datetime(self.matchup["match_date"], errors="coerce")
        self.team["match_date"] = pd.to_datetime(self.team["match_date"], errors="coerce")

    def venue_priors(self, venue: str | None, before: datetime | None) -> dict[str, Any]:
        if not venue:
            return {}
        rows = self.matchup[self.matchup["venue"] == venue].copy()
        if before is not None:
            rows = rows[rows["match_date"] <= pd.Timestamp(before).tz_localize(None)]
        if rows.empty:
            return {}
        row = rows.sort_values("match_date").iloc[-1]
        return {column: row.get(column) for column in VENUE_PRIOR_COLUMNS}

    def team_priors(self, team: str | None, prefix: str, before: datetime | None) -> dict[str, Any]:
        if not team:
            return {}
        rows = self.team[self.team["team"] == team].copy()
        if before is not None:
            rows = rows[rows["match_date"] <= pd.Timestamp(before).tz_localize(None)]
        if rows.empty:
            return {}
        row = rows.sort_values("match_date").iloc[-1]
        return {f"{prefix}_{column}": row.get(column) for column in TEAM_PRIOR_COLUMNS}


def read_json_payload(args: argparse.Namespace) -> Any | None:
    if args.json:
        return json.loads(args.json.read_text())

    if args.url:
        with urlopen(args.url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    return None


def read_snapshot_payload(args: argparse.Namespace) -> Any | None:
    if args.snapshots_json:
        return json.loads(args.snapshots_json.read_text())

    if args.snapshots_url:
        with urlopen(args.snapshots_url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    return None


def load_feature_columns(path: Path) -> list[str]:
    manifest = json.loads(path.read_text())
    return list(manifest["feature_columns"])


def filter_feature_columns(feature_columns: list[str], feature_mode: str) -> list[str]:
    if feature_mode == "live_expected_now":
        excluded = LIVE_UNAVAILABLE_FEATURES.union(EXPECTED_NOW_UNAVAILABLE_FEATURES)
        return [column for column in feature_columns if column not in excluded]
    if feature_mode == "live_compatible":
        excluded = LIVE_UNAVAILABLE_FEATURES.union(EVENT_TRAJECTORY_COLUMNS)
        return [column for column in feature_columns if column not in excluded]
    if feature_mode == "live_compatible_trajectory":
        return [column for column in feature_columns if column not in LIVE_UNAVAILABLE_FEATURES]
    if feature_mode == "live_compatible_selected_trajectory":
        excluded = LIVE_UNAVAILABLE_FEATURES.union(set(EVENT_TRAJECTORY_COLUMNS).difference(SELECTED_TRAJECTORY_FEATURES))
        return [column for column in feature_columns if column not in excluded]
    return feature_columns


def innings_phase(balls: int | None) -> str | None:
    if balls is None:
        return None
    if balls <= 36:
        return "powerplay"
    if balls <= 90:
        return "middle"
    return "death"


def parse_season(value: str | None) -> int | None:
    if not value:
        return None
    start_time = parse_start_time(value)
    return start_time.year if start_time is not None else None


def parse_start_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def city_from_location(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(",", 1)[0].strip() or None


def parse_score_parts(value: str | None) -> tuple[int | None, int | None]:
    if not value or "-" not in value:
        return None, None
    left, right = value.split("-", 1)
    try:
        return int(left), int(right)
    except ValueError:
        return None, None


def resolve_batting_bowling_teams(fixture: dict[str, Any], state: dict[str, Any]) -> tuple[str | None, str | None]:
    batting_team = state.get("battingTeam")
    bowling_team = state.get("bowlingTeam")
    if batting_team and bowling_team:
        return batting_team, bowling_team

    home_team = fixture.get("homeTeam")
    away_team = fixture.get("awayTeam")
    home_score, away_score = parse_score_parts(fixture.get("score"))
    score_runs = state.get("scoreRuns")

    if score_runs is not None and home_score == score_runs and home_team and away_team:
        return home_team, away_team

    if score_runs is not None and away_score == score_runs and home_team and away_team:
        return away_team, home_team

    return batting_team, bowling_team


def snapshot_key(snapshot: dict[str, Any]) -> tuple[str | None, int | None]:
    return snapshot.get("fixtureId"), snapshot.get("innings")


def build_snapshot_index(payload: Any | None) -> dict[tuple[str | None, int | None], list[dict[str, Any]]]:
    if payload is None:
        return {}
    rows = payload if isinstance(payload, list) else [payload]
    index: dict[tuple[str | None, int | None], list[dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = snapshot_key(row)
        index.setdefault(key, []).append(row)
    return index


def sort_snapshots(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("createdAt") or ""),
            int(row.get("id") or 0),
        ),
    )


def exact_snapshot_events(rows: list[dict[str, Any]], current_balls: int | None) -> list[dict[str, int]]:
    if current_balls is None:
        return []

    latest_by_ball: dict[int, dict[str, Any]] = {}
    for row in sort_snapshots(rows):
        balls = row.get("balls")
        if isinstance(balls, int) and balls <= current_balls:
            latest_by_ball[balls] = row

    ordered = [latest_by_ball[ball] for ball in sorted(latest_by_ball)]
    events: list[dict[str, int]] = []
    previous: dict[str, Any] | None = None

    for row in ordered:
        balls = row.get("balls")
        runs = row.get("scoreRuns")
        wickets = row.get("scoreWickets")
        if not all(isinstance(value, int) for value in [balls, runs, wickets]):
            previous = row
            continue
        if previous is None:
            previous = row
            continue
        previous_balls = previous.get("balls")
        previous_runs = previous.get("scoreRuns")
        previous_wickets = previous.get("scoreWickets")
        if not all(isinstance(value, int) for value in [previous_balls, previous_runs, previous_wickets]):
            previous = row
            continue
        if balls - previous_balls == 1:
            events.append({
                "ball": balls,
                "runs": max(0, runs - previous_runs),
                "wickets": max(0, wickets - previous_wickets),
            })
        previous = row

    return events


def window_sum(events: list[dict[str, int]], current_balls: int, window: int, field: str) -> int | None:
    required = min(window, current_balls)
    selected = [event for event in events if current_balls - required < event["ball"] <= current_balls]
    if len(selected) < required:
        return None
    return sum(event[field] for event in selected)


def balls_since(events: list[dict[str, int]], current_balls: int, predicate: str) -> int | None:
    if current_balls <= 0:
        return None
    observed = {event["ball"]: event for event in events}
    distance = 0
    for ball in range(current_balls, 0, -1):
        event = observed.get(ball)
        if event is None:
            return None
        if predicate == "wicket" and event["wickets"] > 0:
            return distance
        if predicate == "high_run" and event["runs"] >= 4:
            return distance
        distance += 1
    return distance


def consecutive_dots(events: list[dict[str, int]], current_balls: int) -> int | None:
    observed = {event["ball"]: event for event in events}
    streak = 0
    for ball in range(current_balls, 0, -1):
        event = observed.get(ball)
        if event is None:
            return None
        if event["runs"] != 0:
            return streak
        streak += 1
    return streak


def trajectory_features_from_snapshots(
    rows: list[dict[str, Any]],
    current_balls: int | None,
    current_run_rate: float | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(current_balls, int) or current_balls <= 0:
        return {}, {"snapshot_events_observed": 0, "snapshot_exact_coverage_balls": 0}

    events = exact_snapshot_events(rows, current_balls)
    features: dict[str, Any] = {}
    latest = window_sum(events, current_balls, 1, "runs")
    latest_wicket = window_sum(events, current_balls, 1, "wickets")
    features["runs_last_ball"] = latest
    features["wicket_last_ball"] = latest_wicket

    for window in [3, 6, 12, 24]:
        runs = window_sum(events, current_balls, window, "runs")
        wickets = window_sum(events, current_balls, window, "wickets")
        features[f"runs_last_{window}_balls"] = runs
        features[f"wickets_last_{window}_balls"] = wickets
        if runs is not None:
            denominator = min(window, current_balls)
            recent_rate = (runs / denominator) * 6
            features[f"recent_run_rate_last_{window}"] = recent_rate
            if window in [6, 12, 24]:
                features[f"recent_run_rate_delta_last_{window}"] = recent_rate - current_run_rate if current_run_rate is not None else None

    for window in [6, 12, 24]:
        required = min(window, current_balls)
        selected = [event for event in events if current_balls - required < event["ball"] <= current_balls]
        if len(selected) >= required:
            features[f"dot_balls_last_{window}"] = sum(1 for event in selected if event["runs"] == 0)
            features[f"high_run_balls_last_{window}"] = sum(1 for event in selected if event["runs"] >= 4)
            features[f"six_plus_balls_last_{window}"] = sum(1 for event in selected if event["runs"] >= 6)

    over_start = ((current_balls - 1) // 6) * 6 + 1
    over_events = [event for event in events if over_start <= event["ball"] <= current_balls]
    if len(over_events) == current_balls - over_start + 1:
        features["current_over_runs"] = sum(event["runs"] for event in over_events)
        features["current_over_wickets"] = sum(event["wickets"] for event in over_events)
        features["current_over_dot_balls"] = sum(1 for event in over_events if event["runs"] == 0)
        features["current_over_high_run_balls"] = sum(1 for event in over_events if event["runs"] >= 4)

    features["balls_since_last_wicket"] = balls_since(events, current_balls, "wicket")
    features["balls_since_last_high_run_ball"] = balls_since(events, current_balls, "high_run")
    features["consecutive_dot_balls"] = consecutive_dots(events, current_balls)

    coverage = 0
    observed_balls = {event["ball"] for event in events}
    for ball in range(current_balls, 0, -1):
        if ball not in observed_balls:
            break
        coverage += 1

    diagnostics = {
        "snapshot_events_observed": len(events),
        "snapshot_exact_coverage_balls": coverage,
        "snapshot_trajectory_features_filled": sum(1 for column in EVENT_TRAJECTORY_COLUMNS if features.get(column) is not None),
    }
    return features, diagnostics


def feature_row_from_live_model(
    entry: dict[str, Any],
    feature_columns: list[str],
    prior_lookup: PriorLookup,
    snapshot_index: dict[tuple[str | None, int | None], list[dict[str, Any]]],
) -> dict[str, Any]:
    fixture = entry.get("fixture", {})
    state = entry.get("expectedState", {})
    venue_context = entry.get("venueContext") or {}
    start_time = parse_start_time(fixture.get("startTime"))
    batting_team, bowling_team = resolve_batting_bowling_teams(fixture, state)
    balls = state.get("balls")
    scheduled_balls = 120
    current_runs = state.get("scoreRuns")
    current_wickets = state.get("scoreWickets")
    target_runs = state.get("targetRuns")
    overs_bowled = balls / 6 if isinstance(balls, (int, float)) else None
    balls_remaining = max(0, scheduled_balls - balls) if isinstance(balls, (int, float)) else None
    current_run_rate = current_runs / overs_bowled if current_runs is not None and overs_bowled else None
    required_run_rate = None

    if target_runs is not None and current_runs is not None and balls_remaining:
        required_run_rate = ((target_runs - current_runs) / balls_remaining) * 6

    values: dict[str, Any] = {
        "season": parse_season(fixture.get("startTime")),
        "innings": state.get("innings"),
        "batting_team": batting_team,
        "bowling_team": bowling_team,
        "venue": fixture.get("venueName"),
        "city": city_from_location(fixture.get("venueLocation")),
        "toss_winner": None,
        "toss_decision": None,
        "batting_team_won_toss": None,
        "current_runs": current_runs,
        "current_wickets": current_wickets,
        "legal_balls_bowled": balls,
        "scheduled_balls": scheduled_balls,
        "overs_bowled": overs_bowled,
        "innings_progress": balls / scheduled_balls if isinstance(balls, (int, float)) else None,
        "is_regulation_innings": 1,
        "balls_remaining": balls_remaining,
        "current_run_rate": current_run_rate,
        "over_number": (balls - 1) // 6 if isinstance(balls, int) and balls > 0 else None,
        "balls_in_over": balls % 6 if isinstance(balls, int) else None,
        "innings_phase": innings_phase(balls),
        "wickets_in_hand": 10 - current_wickets if isinstance(current_wickets, (int, float)) else None,
        "run_rate_required_delta": required_run_rate - current_run_rate if required_run_rate is not None and current_run_rate is not None else None,
        "required_run_rate": required_run_rate,
        "target_runs": target_runs,
        "runs_to_target": target_runs - current_runs if target_runs is not None and current_runs is not None else None,
        "venue_average_first_innings_score": venue_context.get("avgFirstInningsScore"),
        "venue_average_second_innings_score": venue_context.get("avgSecondInningsScore"),
        "venue_chasing_win_rate": venue_context.get("chasingWinPct"),
        "venue_batting_first_win_rate": venue_context.get("battingFirstWinPct"),
    }
    values.update(prior_lookup.venue_priors(fixture.get("venueName"), start_time))
    values.update(prior_lookup.team_priors(batting_team, "batting", start_time))
    values.update(prior_lookup.team_priors(bowling_team, "bowling", start_time))
    snapshot_features, snapshot_diagnostics = trajectory_features_from_snapshots(
        snapshot_index.get((fixture.get("id"), state.get("innings")), []),
        balls if isinstance(balls, int) else None,
        current_run_rate,
    )
    values.update(snapshot_features)
    values["__snapshot_diagnostics"] = snapshot_diagnostics

    row = {column: values.get(column) for column in feature_columns}
    row["__snapshot_diagnostics"] = snapshot_diagnostics
    return row


def validate_matrix_contract(matrix_path: Path, feature_columns: list[str]) -> dict[str, Any]:
    sample = pd.read_csv(matrix_path, nrows=1)
    missing = [column for column in feature_columns if column not in sample.columns]
    return {
        "matrix": str(matrix_path),
        "feature_count": len(feature_columns),
        "missing_feature_columns": missing,
        "ok": len(missing) == 0,
    }


def validate_live_payload(
    payload: Any,
    feature_columns: list[str],
    prior_lookup: PriorLookup,
    snapshot_index: dict[tuple[str | None, int | None], list[dict[str, Any]]],
) -> dict[str, Any]:
    entries = payload if isinstance(payload, list) else [payload]
    entries = [entry for entry in entries if isinstance(entry, dict)]
    reports = []

    for entry in entries:
        row = feature_row_from_live_model(entry, feature_columns, prior_lookup, snapshot_index)
        non_null = [column for column, value in row.items() if value is not None]
        missing_core = [column for column in CORE_LIVE_FEATURES if row.get(column) is None]
        missing_trajectory = [column for column in EVENT_TRAJECTORY_COLUMNS if column in feature_columns and row.get(column) is None]
        missing_live_unavailable = [
            column for column in LIVE_UNAVAILABLE_FEATURES
            if column in feature_columns and row.get(column) is None
        ]
        reports.append({
            "fixture_id": (entry.get("fixture") or {}).get("id"),
            "feature_count": len(feature_columns),
            "non_null_feature_count": len(non_null),
            "missing_core_features": sorted(missing_core),
            "missing_live_unavailable_features": sorted(missing_live_unavailable),
            "missing_event_trajectory_features": sorted(missing_trajectory),
            "missing_experimental_prior_count": len(feature_columns) - len(non_null),
            "snapshot_diagnostics": row.get("__snapshot_diagnostics", {}),
            "ready_for_inference": len(missing_core) == 0 and len(missing_trajectory) == 0,
            "ok": len(missing_core) == 0,
        })

    return {
        "live_entry_count": len(reports),
        "entries": reports,
        "ok": all(report["ok"] for report in reports) if reports else False,
        "ready_for_inference": all(report["ready_for_inference"] for report in reports) if reports else False,
    }


def main() -> None:
    args = parse_args()
    full_feature_columns = load_feature_columns(args.manifest)
    feature_columns = filter_feature_columns(full_feature_columns, args.feature_mode)
    prior_lookup = PriorLookup(args.matchup_features, args.team_features)
    payload = read_json_payload(args)
    snapshot_index = build_snapshot_index(read_snapshot_payload(args))
    report = {
        "status": "experimental",
        "manifest": str(args.manifest),
        "feature_mode": args.feature_mode,
        "excluded_features": sorted(set(full_feature_columns).difference(feature_columns)),
        "matrix_contract": validate_matrix_contract(args.matrix, feature_columns),
        "live_payload": validate_live_payload(payload, feature_columns, prior_lookup, snapshot_index) if payload is not None else None,
        "notes": [
            "This validates feature shape only; it does not score or wire live predictions.",
            "Pre-match priors are looked up from latest historical pre-match feature rows by venue/team/date.",
            "Event trajectory features are derived from exact one-ball deltas in optional snapshot history.",
            "Snapshot gaps are treated as missing trajectory features rather than fabricated balls.",
            "live_compatible mode excludes toss and event trajectory fields for the stable score/prior contract.",
            "live_compatible_trajectory mode excludes toss fields but requires snapshot coverage for event trajectory fields.",
            "live_expected_now mode excludes observed score/wicket outcome fields so expected-now targets can be scored without copying actual state.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
