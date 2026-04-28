#!/usr/bin/env python3
"""Build a live-model-like payload from experimental ball-event journals.

The parity and shadow-scoring scripts consume `/observer/live-model` shaped JSON.
This script creates that shape from the ignored experimental event/snapshot files
so no-paid scrape captures can be validated without touching the production
observer, `model/final_models/`, `model/predict_fixture.py`, or `model/data/live/`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from build_live_event_snapshots import build_snapshots, read_jsonl


ROOT = Path(__file__).resolve().parent
DEFAULT_EVENTS = ROOT / "experiments" / "ball-state" / "live-events" / "normalized_ball_events.jsonl"
DEFAULT_SNAPSHOTS = ROOT / "experiments" / "ball-state" / "live-events" / "live_model_snapshots_from_events.json"
DEFAULT_OUTPUT = ROOT / "experiments" / "ball-state" / "live-events" / "live_model_payload_from_events.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-jsonl", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--snapshots-json", type=Path, default=DEFAULT_SNAPSHOTS)
    parser.add_argument("--output-json", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--context-json", type=Path, help="Fixture context JSON with metadata defaults")
    parser.add_argument("--fixture-id", help="Fixture id to select; defaults to latest fixture in snapshots")
    parser.add_argument("--innings", type=int, help="Innings to select; defaults to latest innings for selected fixture")
    parser.add_argument("--start-time", help="ISO match start time, used for season/prior lookup")
    parser.add_argument("--venue-name")
    parser.add_argument("--venue-location", default="")
    parser.add_argument("--home-team")
    parser.add_argument("--away-team")
    parser.add_argument("--batting-team")
    parser.add_argument("--bowling-team")
    parser.add_argument("--target-runs", type=int)
    parser.add_argument("--avg-first-innings-score", type=float)
    parser.add_argument("--avg-second-innings-score", type=float)
    parser.add_argument("--chasing-win-pct", type=float)
    parser.add_argument("--batting-first-win-pct", type=float)
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Write payload even if batting/bowling team metadata is missing.",
    )
    return parser.parse_args()


def read_context(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    parsed = json.loads(path.read_text())
    if not isinstance(parsed, dict):
        raise SystemExit("fixture context JSON must be an object")
    return parsed


def context_value(context: dict[str, Any], *keys: str) -> Any | None:
    for key in keys:
        value = context.get(key)
        if value is not None and value != "":
            return value
    return None


def apply_context_defaults(args: argparse.Namespace, context: dict[str, Any]) -> None:
    defaults = {
        "fixture_id": context_value(context, "fixture_id", "fixtureId", "match_id", "matchId"),
        "innings": context_value(context, "innings"),
        "start_time": context_value(context, "start_time", "startTime"),
        "venue_name": context_value(context, "venue_name", "venueName"),
        "venue_location": context_value(context, "venue_location", "venueLocation"),
        "home_team": context_value(context, "home_team", "homeTeam"),
        "away_team": context_value(context, "away_team", "awayTeam"),
        "batting_team": context_value(context, "batting_team", "battingTeam"),
        "bowling_team": context_value(context, "bowling_team", "bowlingTeam"),
        "target_runs": context_value(context, "target_runs", "targetRuns"),
        "avg_first_innings_score": context_value(context, "avg_first_innings_score", "avgFirstInningsScore"),
        "avg_second_innings_score": context_value(context, "avg_second_innings_score", "avgSecondInningsScore"),
        "chasing_win_pct": context_value(context, "chasing_win_pct", "chasingWinPct"),
        "batting_first_win_pct": context_value(context, "batting_first_win_pct", "battingFirstWinPct"),
    }
    for field, value in defaults.items():
        if getattr(args, field) in {None, ""} and value is not None:
            setattr(args, field, value)

    for integer_field in ["innings", "target_runs"]:
        value = getattr(args, integer_field)
        if value is not None:
            setattr(args, integer_field, as_int(value))
    for float_field in ["avg_first_innings_score", "avg_second_innings_score", "chasing_win_pct", "batting_first_win_pct"]:
        value = getattr(args, float_field)
        if value is not None:
            setattr(args, float_field, float(value))


def validate_payload_metadata(args: argparse.Namespace) -> None:
    missing = []
    if not args.start_time:
        missing.append("start_time")
    if not args.venue_name:
        missing.append("venue_name")
    if missing:
        raise SystemExit("missing required fixture metadata: " + ", ".join(missing))


def read_snapshots(path: Path, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if path.exists():
        parsed = json.loads(path.read_text())
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
        if isinstance(parsed, dict):
            return [parsed]
        raise SystemExit(f"invalid snapshots JSON: {path}")
    return build_snapshots(events, include_baseline=True)


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def snapshot_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        str(row.get("fixtureId") or ""),
        as_int(row.get("innings")) or 0,
        as_int(row.get("balls")) or 0,
        str(row.get("createdAt") or ""),
        as_int(row.get("id")) or 0,
    )


def latest_snapshot(snapshots: list[dict[str, Any]], fixture_id: str | None, innings: int | None) -> dict[str, Any]:
    candidates = snapshots
    if fixture_id:
        candidates = [row for row in candidates if str(row.get("fixtureId")) == fixture_id]
    if innings is not None:
        candidates = [row for row in candidates if as_int(row.get("innings")) == innings]
    candidates = [row for row in candidates if as_int(row.get("balls")) is not None]
    if not candidates:
        raise SystemExit("no snapshot rows match requested fixture/innings")
    return sorted(candidates, key=snapshot_sort_key)[-1]


def latest_event_for(events: list[dict[str, Any]], fixture_id: str, innings: int) -> dict[str, Any] | None:
    matches = [
        row
        for row in events
        if str(row.get("fixture_id")) == fixture_id and as_int(row.get("innings")) == innings
    ]
    if not matches:
        return None
    return matches[-1]


def innings_final_score(snapshots: list[dict[str, Any]], fixture_id: str, innings: int) -> int | None:
    rows = [
        row
        for row in snapshots
        if str(row.get("fixtureId")) == fixture_id and as_int(row.get("innings")) == innings
    ]
    if not rows:
        return None
    final = sorted(rows, key=snapshot_sort_key)[-1]
    return as_int(final.get("scoreRuns"))


def require_metadata(args: argparse.Namespace, batting_team: str | None, bowling_team: str | None) -> None:
    missing = []
    if not batting_team:
        missing.append("--batting-team or event batting_team")
    if not bowling_team:
        missing.append("--bowling-team or event bowling_team")
    if missing and not args.allow_incomplete:
        raise SystemExit(
            "missing required live payload metadata: " + ", ".join(missing) + "; use --allow-incomplete only for shape debugging"
        )


def main() -> None:
    args = parse_args()
    apply_context_defaults(args, read_context(args.context_json))
    validate_payload_metadata(args)
    events = read_jsonl(args.input_jsonl)
    snapshots = read_snapshots(args.snapshots_json, events)
    current = latest_snapshot(snapshots, args.fixture_id, args.innings)
    fixture_id = str(current.get("fixtureId"))
    innings = as_int(current.get("innings"))
    if innings is None:
        raise SystemExit("latest snapshot is missing innings")

    latest_event = latest_event_for(events, fixture_id, innings) or {}
    batting_team = args.batting_team or latest_event.get("batting_team")
    bowling_team = args.bowling_team or latest_event.get("bowling_team")
    require_metadata(args, batting_team, bowling_team)

    score_runs = as_int(current.get("scoreRuns"))
    score_wickets = as_int(current.get("scoreWickets"))
    balls = as_int(current.get("balls"))
    target_runs = args.target_runs
    if target_runs is None and innings == 2:
        first_innings_score = innings_final_score(snapshots, fixture_id, 1)
        target_runs = first_innings_score + 1 if first_innings_score is not None else None

    payload = {
        "status": "experimental",
        "source": "normalized_ball_events",
        "fixture": {
            "id": fixture_id,
            "startTime": args.start_time,
            "venueName": args.venue_name,
            "venueLocation": args.venue_location or None,
            "homeTeam": args.home_team,
            "awayTeam": args.away_team,
            "score": None,
        },
        "expectedState": {
            "innings": innings,
            "battingTeam": batting_team,
            "bowlingTeam": bowling_team,
            "balls": balls,
            "scoreRuns": score_runs,
            "scoreWickets": score_wickets,
            "targetRuns": target_runs,
        },
        "venueContext": {
            "avgFirstInningsScore": args.avg_first_innings_score,
            "avgSecondInningsScore": args.avg_second_innings_score,
            "chasingWinPct": args.chasing_win_pct,
            "battingFirstWinPct": args.batting_first_win_pct,
        },
        "details": {
            "snapshotRowsAvailable": len(snapshots),
            "eventRowsAvailable": len(events),
            "currentSnapshotId": current.get("id"),
            "currentSnapshotCreatedAt": current.get("createdAt"),
        },
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(payload, indent=2, default=str) + "\n")
    print(json.dumps({
        "status": "experimental",
        "output_json": str(args.output_json),
        "fixture_id": fixture_id,
        "innings": innings,
        "balls": balls,
        "score_runs": score_runs,
        "score_wickets": score_wickets,
        "target_runs": target_runs,
        "notes": ["Payload is for offline parity/shadow scoring only; production runtime is unchanged."],
    }, indent=2))


if __name__ == "__main__":
    main()
