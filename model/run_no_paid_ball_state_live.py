#!/usr/bin/env python3
"""Run the no-paid experimental live ball-state pipeline end-to-end.

This command stays inside `model/experiments/ball-state/live-events/` by default:
scrape public ESPNcricinfo page data, convert events to snapshots, build a
live-model-like payload, validate feature parity, and optionally shadow-score the
selected experimental candidates.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = ROOT / "experiments" / "ball-state" / "live-events"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--espn-url", help="Public ESPNcricinfo commentary URL to fetch once")
    source.add_argument("--input-html", type=Path, help="Saved ESPNcricinfo page HTML")
    source.add_argument("--input-html-dir", type=Path, help="Directory of saved ESPNcricinfo HTML captures")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--context-json", type=Path, help="Fixture context JSON with metadata defaults")
    parser.add_argument("--fixture-id")
    parser.add_argument("--start-time")
    parser.add_argument("--venue-name")
    parser.add_argument("--venue-location", default="")
    parser.add_argument("--home-team")
    parser.add_argument("--away-team")
    parser.add_argument("--batting-team")
    parser.add_argument("--bowling-team")
    parser.add_argument("--innings", type=int)
    parser.add_argument("--target-runs", type=int)
    parser.add_argument("--feature-mode", default="live_compatible_selected_trajectory")
    parser.add_argument("--shadow", action="store_true", help="Also run experimental shadow scoring")
    parser.add_argument("--skip-scrape", action="store_true", help="Use existing normalized_ball_events.jsonl in output-dir")
    return parser.parse_args()


def read_context(path: Path | None) -> dict[str, object]:
    if path is None:
        return {}
    parsed = json.loads(path.read_text())
    if not isinstance(parsed, dict):
        raise SystemExit("fixture context JSON must be an object")
    return parsed


def context_value(context: dict[str, object], *keys: str) -> object | None:
    for key in keys:
        value = context.get(key)
        if value is not None and value != "":
            return value
    return None


def apply_context_defaults(args: argparse.Namespace, context: dict[str, object]) -> None:
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
    }
    for field, value in defaults.items():
        if getattr(args, field) in {None, ""} and value is not None:
            setattr(args, field, value)


def validate_required_context(args: argparse.Namespace) -> None:
    missing = [
        field
        for field in ["start_time", "venue_name", "batting_team", "bowling_team"]
        if not getattr(args, field)
    ]
    if missing:
        raise SystemExit("missing required context: " + ", ".join(missing))


def html_files(path: Path) -> list[Path]:
    return sorted(
        candidate
        for candidate in path.iterdir()
        if candidate.is_file() and candidate.suffix.lower() in {".html", ".htm"}
    )


def run_step(command: list[str]) -> None:
    print("$ " + " ".join(command))
    subprocess.run(command, check=True)


def add_optional(command: list[str], flag: str, value: object | None) -> None:
    if value is not None and value != "":
        command.extend([flag, str(value)])


def main() -> None:
    args = parse_args()
    apply_context_defaults(args, read_context(args.context_json))
    validate_required_context(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    events_jsonl = args.output_dir / "normalized_ball_events.jsonl"
    snapshots_json = args.output_dir / "live_model_snapshots_from_events.json"
    snapshots_jsonl = args.output_dir / "live_model_snapshots_from_events.jsonl"
    payload_json = args.output_dir / "live_model_payload_from_events.json"
    parity_report = args.output_dir / "live_feature_parity_report.json"

    if not args.skip_scrape:
        scrape_sources: list[tuple[str, str]] = []
        if args.espn_url:
            scrape_sources.append(("--url", args.espn_url))
        elif args.input_html:
            scrape_sources.append(("--input-html", str(args.input_html)))
        elif args.input_html_dir:
            scrape_sources.extend(("--input-html", str(path)) for path in html_files(args.input_html_dir))
        if not scrape_sources:
            raise SystemExit("provide --espn-url, --input-html, or --skip-scrape")
        for flag, value in scrape_sources:
            scrape = [sys.executable, str(ROOT / "scrape_espncricinfo_ball_events.py"), "--output-dir", str(args.output_dir), flag, value]
            add_optional(scrape, "--fixture-id", args.fixture_id)
            run_step(scrape)

    run_step([
        sys.executable,
        str(ROOT / "build_live_event_snapshots.py"),
        "--input-jsonl",
        str(events_jsonl),
        "--output-json",
        str(snapshots_json),
        "--output-jsonl",
        str(snapshots_jsonl),
    ])

    payload = [
        sys.executable,
        str(ROOT / "build_live_payload_from_events.py"),
        "--input-jsonl",
        str(events_jsonl),
        "--snapshots-json",
        str(snapshots_json),
        "--output-json",
        str(payload_json),
    ]
    for flag, value in [
        ("--context-json", args.context_json),
        ("--fixture-id", args.fixture_id),
        ("--innings", args.innings),
        ("--start-time", args.start_time),
        ("--venue-name", args.venue_name),
        ("--batting-team", args.batting_team),
        ("--bowling-team", args.bowling_team),
        ("--venue-location", args.venue_location),
        ("--home-team", args.home_team),
        ("--away-team", args.away_team),
        ("--target-runs", args.target_runs),
    ]:
        add_optional(payload, flag, value)
    run_step(payload)

    run_step([
        sys.executable,
        str(ROOT / "validate_ball_state_live_parity.py"),
        "--feature-mode",
        args.feature_mode,
        "--json",
        str(payload_json),
        "--snapshots-json",
        str(snapshots_json),
        "--output",
        str(parity_report),
    ])

    shadow_dir = None
    if args.shadow:
        shadow_dir = args.output_dir / "shadow-run"
        run_step([
            sys.executable,
            str(ROOT / "shadow_score_ball_state_live.py"),
            "--input-json",
            str(payload_json),
            "--snapshots-json",
            str(snapshots_json),
            "--output-dir",
            str(shadow_dir),
        ])

    summary = {
        "status": "experimental",
        "output_dir": str(args.output_dir),
        "events_jsonl": str(events_jsonl),
        "snapshots_json": str(snapshots_json),
        "payload_json": str(payload_json),
        "parity_report": str(parity_report),
        "shadow_dir": str(shadow_dir) if shadow_dir else None,
        "notes": [
            "No paid API, login, or access-control bypass is used.",
            "All outputs stay under the ignored experimental live-events directory.",
            "Production model artifacts and production data ledgers are unchanged.",
        ],
    }
    (args.output_dir / "no_paid_live_pipeline_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
