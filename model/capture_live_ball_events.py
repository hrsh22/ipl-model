#!/usr/bin/env python3
"""Capture experimental live cricket ball events into append-only JSONL journals.

This script is intentionally experiment-only. It does not read or write
`model/final_models/`, `model/predict_fixture.py`, or production refresh ledgers.
Outputs default to `model/experiments/ball-state/live-events/`, which is ignored by
git and can be safely used for provider payload trials.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = ROOT / "experiments" / "ball-state" / "live-events"

EVENT_COLLECTION_KEYS = {
    "balls",
    "ball_by_ball",
    "ballByBall",
    "deliveries",
    "events",
    "scoreboards",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input-json", type=Path, help="Provider payload JSON file")
    source.add_argument("--input-jsonl", type=Path, help="Provider payload JSONL file")
    source.add_argument("--url", help="Provider URL to fetch once")
    parser.add_argument(
        "--provider",
        choices=["canonical", "roanuz", "sportmonks", "opticodds_snapshot", "raw"],
        default="canonical",
        help="Payload flavor. Unknown fields are preserved in raw_event_json.",
    )
    parser.add_argument("--fixture-id", help="Stable fixture/match id if not present in payload")
    parser.add_argument("--source-name", default="manual", help="Human-readable source label")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--authorization", help="Optional Authorization header for --url")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def event_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def read_payload(args: argparse.Namespace) -> Any:
    if args.input_json:
        return json.loads(args.input_json.read_text())

    if args.input_jsonl:
        rows: list[Any] = []
        for line in args.input_jsonl.read_text().splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    if args.url:
        request = Request(args.url)
        if args.authorization:
            request.add_header("Authorization", args.authorization)
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    raise SystemExit("unreachable payload source branch")


def first_present(record: dict[str, Any], keys: list[str]) -> Any | None:
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    number = as_number(value)
    if number is None:
        return None
    return int(number)


def flatten_event_candidates(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        rows: list[dict[str, Any]] = []
        for item in value:
            rows.extend(flatten_event_candidates(item))
        return rows

    if not isinstance(value, dict):
        return []

    rows: list[dict[str, Any]] = []
    if looks_like_delivery(value):
        rows.append(value)

    for key, nested in value.items():
        if key in EVENT_COLLECTION_KEYS:
            rows.extend(flatten_event_candidates(nested))
        elif isinstance(nested, dict):
            rows.extend(flatten_event_candidates(nested))
        elif isinstance(nested, list) and key in EVENT_COLLECTION_KEYS:
            rows.extend(flatten_event_candidates(nested))

    return rows


def looks_like_delivery(record: dict[str, Any]) -> bool:
    keys = set(record)
    score_keys = {"runs", "runs_bat", "runsBat", "total_runs", "score", "team_score", "wickets"}
    ball_keys = {"ball", "over", "over_ball", "overs", "delivery", "delivery_number", "ball_number"}
    player_keys = {"batsman", "batter", "striker", "bowler", "non_striker", "nonStriker"}
    return bool(keys & ball_keys) and bool((keys & score_keys) or (keys & player_keys))


def normalize_event(raw: dict[str, Any], args: argparse.Namespace, captured_at: str) -> dict[str, Any]:
    fixture_id = first_present(
        raw,
        ["fixture_id", "fixtureId", "match_id", "matchId", "match_key", "matchKey", "key", "id"],
    )
    innings = first_present(raw, ["innings", "inning", "innings_number", "inningsNumber"])
    over = first_present(raw, ["over", "over_number", "overNumber"])
    ball = first_present(raw, ["ball", "ball_number", "ballNumber", "delivery", "delivery_number"])
    over_ball = first_present(raw, ["over_ball", "overBall", "overs"])

    score_after = first_present(raw, ["score_after", "scoreAfter", "team_score", "teamScore", "score"])
    wickets_after = first_present(raw, ["wickets_after", "wicketsAfter", "wickets", "team_wickets", "teamWickets"])

    runs_bat = first_present(raw, ["runs_bat", "runsBat", "batsman_runs", "batting_runs"])
    extras = first_present(raw, ["extras", "extra_runs", "extraRuns"])
    total_runs = first_present(raw, ["total_runs", "totalRuns", "runs"])

    normalized = {
        "schema_version": "live-ball-event-v0",
        "captured_at": captured_at,
        "source_name": args.source_name,
        "provider": args.provider,
        "source_event_hash": event_hash(raw),
        "fixture_id": args.fixture_id or str(fixture_id) if fixture_id is not None else args.fixture_id,
        "innings": as_int(innings),
        "over": as_int(over),
        "ball": as_int(ball),
        "over_ball": str(over_ball) if over_ball is not None else None,
        "delivery_sequence_key": first_present(
            raw,
            ["delivery_sequence_key", "deliverySequenceKey", "sequence", "sequence_number", "event_id", "eventId"],
        ),
        "event_timestamp": first_present(raw, ["timestamp", "event_timestamp", "eventTimestamp", "updated_at", "updatedAt"]),
        "batting_team": first_present(raw, ["batting_team", "battingTeam", "team", "batting"]),
        "bowling_team": first_present(raw, ["bowling_team", "bowlingTeam", "opposition"]),
        "striker": first_present(raw, ["striker", "batter", "batsman", "batsman_name"]),
        "non_striker": first_present(raw, ["non_striker", "nonStriker", "non_batter", "runner"]),
        "bowler": first_present(raw, ["bowler", "bowler_name"]),
        "runs_bat": as_int(runs_bat),
        "extras": as_int(extras),
        "total_runs": as_int(total_runs),
        "extra_type": first_present(raw, ["extra_type", "extraType", "ball_type", "ballType"]),
        "is_legal_delivery": first_present(raw, ["is_legal_delivery", "isLegalDelivery", "legal"]),
        "is_wicket": bool(first_present(raw, ["is_wicket", "isWicket", "wicket", "wicket_type", "wicketType"])),
        "wicket_type": first_present(raw, ["wicket_type", "wicketType", "dismissal", "dismissal_type"]),
        "dismissed_player": first_present(raw, ["dismissed_player", "dismissedPlayer", "player_out", "playerOut"]),
        "fielder": first_present(raw, ["fielder", "fielders", "fielder_name"]),
        "score_after": as_int(score_after),
        "wickets_after": as_int(wickets_after),
        "commentary": first_present(raw, ["commentary", "comment", "text", "description"]),
        "raw_event_json": raw,
    }

    if normalized["is_legal_delivery"] is None:
        extra_type = str(normalized["extra_type"] or "").lower()
        normalized["is_legal_delivery"] = extra_type not in {"wide", "wides", "no_ball", "noball", "no-ball"}

    return normalized


def snapshot_as_sparse_event(payload: dict[str, Any], args: argparse.Namespace, captured_at: str) -> dict[str, Any]:
    return {
        "schema_version": "live-ball-event-v0",
        "captured_at": captured_at,
        "source_name": args.source_name,
        "provider": args.provider,
        "source_event_hash": event_hash(payload),
        "fixture_id": args.fixture_id or first_present(payload, ["fixtureId", "fixture_id", "id"]),
        "event_kind": "score_snapshot",
        "innings": as_int(first_present(payload, ["innings"])),
        "batting_team": first_present(payload, ["battingTeam", "batting_team"]),
        "bowling_team": first_present(payload, ["bowlingTeam", "bowling_team"]),
        "score_after": as_int(first_present(payload, ["scoreRuns", "score_runs", "current_runs"])),
        "wickets_after": as_int(first_present(payload, ["scoreWickets", "score_wickets", "current_wickets"])),
        "over_ball": first_present(payload, ["overs"]),
        "raw_event_json": payload,
        "quality_note": "snapshot_only_not_authoritative_delivery",
    }


def normalize_payload(payload: Any, args: argparse.Namespace, captured_at: str) -> list[dict[str, Any]]:
    if args.provider == "raw":
        rows = payload if isinstance(payload, list) else [payload]
        return [
            {
                "schema_version": "live-ball-event-v0",
                "captured_at": captured_at,
                "source_name": args.source_name,
                "provider": args.provider,
                "fixture_id": args.fixture_id,
                "source_event_hash": event_hash(row),
                "raw_event_json": row,
                "quality_note": "raw_unmapped_payload",
            }
            for row in rows
        ]

    if args.provider == "opticodds_snapshot":
        rows = payload if isinstance(payload, list) else [payload]
        return [snapshot_as_sparse_event(row, args, captured_at) for row in rows if isinstance(row, dict)]

    candidates = flatten_event_candidates(payload)
    if isinstance(payload, list):
        candidates = candidates or [row for row in payload if isinstance(row, dict)]
    elif isinstance(payload, dict) and not candidates and looks_like_delivery(payload):
        candidates = [payload]

    return [normalize_event(candidate, args, captured_at) for candidate in candidates]


def append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":"), default=str))
            handle.write("\n")


def main() -> None:
    args = parse_args()
    captured_at = utc_now()
    payload = read_payload(args)
    normalized = normalize_payload(payload, args, captured_at)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    raw_rows = payload if isinstance(payload, list) else [payload]
    raw_journal_rows = [
        {
            "captured_at": captured_at,
            "source_name": args.source_name,
            "provider": args.provider,
            "fixture_id": args.fixture_id,
            "source_event_hash": event_hash(row),
            "raw_event_json": row,
        }
        for row in raw_rows
    ]

    append_jsonl(args.output_dir / "raw_provider_payloads.jsonl", raw_journal_rows)
    append_jsonl(args.output_dir / "normalized_ball_events.jsonl", normalized)

    manifest = {
        "generated_at": captured_at,
        "provider": args.provider,
        "source_name": args.source_name,
        "fixture_id": args.fixture_id,
        "raw_rows_appended": len(raw_journal_rows),
        "normalized_rows_appended": len(normalized),
        "output_dir": str(args.output_dir),
        "contract": "model/LIVE_BALL_EVENT_CONTRACT.md",
        "prod_isolation": {
            "touches_final_models": False,
            "touches_predict_fixture": False,
            "writes_prod_data_live": False,
        },
    }
    (args.output_dir / "latest_capture_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
