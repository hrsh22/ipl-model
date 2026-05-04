#!/usr/bin/env python3
"""Build live-model-compatible snapshot history from normalized ball events.

This is experiment-only glue between `capture_live_ball_events.py` and the
existing live parity/shadow-scoring scripts. It reads append-only normalized
delivery journals and writes resolved snapshot history under
`model/experiments/ball-state/live-events/` by default.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "experiments" / "ball-state" / "live-events" / "normalized_ball_events.jsonl"
DEFAULT_OUTPUT_JSON = ROOT / "experiments" / "ball-state" / "live-events" / "live_model_snapshots_from_events.json"
DEFAULT_OUTPUT_JSONL = ROOT / "experiments" / "ball-state" / "live-events" / "live_model_snapshots_from_events.jsonl"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-jsonl", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-json", type=Path, default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--output-jsonl", type=Path, default=DEFAULT_OUTPUT_JSONL)
    parser.add_argument(
        "--no-baseline",
        action="store_true",
        help="Do not emit balls=0 baseline rows. Not recommended for trajectory parity.",
    )
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        raise SystemExit(f"missing normalized event journal: {path}")
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        parsed = json.loads(line)
        if not isinstance(parsed, dict):
            raise SystemExit(f"invalid JSONL row {line_number}: expected object")
        rows.append(parsed)
    return rows


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def event_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    sequence = row.get("delivery_sequence_key")
    sequence_number = as_int(sequence)
    return (
        str(row.get("fixture_id") or ""),
        as_int(row.get("innings")) or 0,
        as_int(row.get("over")) if row.get("over") is not None else 10_000,
        as_int(row.get("ball")) if row.get("ball") is not None else 10_000,
        as_int(row.get("score_after")) if row.get("score_after") is not None else 10_000,
        0 if sequence_number is not None else 1,
        sequence_number if sequence_number is not None else 0,
        str(sequence or ""),
        str(row.get("event_timestamp") or ""),
        str(row.get("captured_at") or ""),
        str(row.get("source_event_hash") or ""),
    )


def correction_sort_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("captured_at") or ""),
        str(row.get("event_timestamp") or ""),
        str(row.get("source_event_hash") or ""),
    )


def created_at_for(row: dict[str, Any], fallback_index: int) -> str:
    value = row.get("event_timestamp") or row.get("captured_at")
    if value:
        return str(value)
    return datetime.fromtimestamp(fallback_index, UTC).isoformat()


def fixture_key(row: dict[str, Any]) -> tuple[str, int] | None:
    fixture_id = row.get("fixture_id")
    innings = as_int(row.get("innings"))
    if not fixture_id or innings is None:
        return None
    return str(fixture_id), innings


def delivery_runs(row: dict[str, Any]) -> int:
    total = as_int(row.get("total_runs"))
    if total is not None:
        return max(0, total)
    bat = as_int(row.get("runs_bat")) or 0
    extras = as_int(row.get("extras")) or 0
    return max(0, bat + extras)


def resolve_events(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_delivery: dict[tuple[str, int, str], dict[str, Any]] = {}
    passthrough_order = 0

    for row in sorted(rows, key=event_sort_key):
        key = fixture_key(row)
        if key is None:
            continue
        sequence = row.get("delivery_sequence_key")
        if sequence is None:
            over = as_int(row.get("over"))
            ball = as_int(row.get("ball"))
            if over is not None and ball is not None:
                sequence = f"{over}.{ball}"
            else:
                passthrough_order += 1
                sequence = f"journal-{passthrough_order}"

        delivery_key = (key[0], key[1], str(sequence))
        existing = latest_by_delivery.get(delivery_key)
        if existing is None or correction_sort_key(row) >= correction_sort_key(existing):
            latest_by_delivery[delivery_key] = row

    return sorted(latest_by_delivery.values(), key=event_sort_key)


def build_snapshots(rows: list[dict[str, Any]], include_baseline: bool) -> list[dict[str, Any]]:
    resolved = resolve_events(rows)
    snapshots: list[dict[str, Any]] = []
    state: dict[tuple[str, int], dict[str, int]] = {}
    emitted_baseline: set[tuple[str, int]] = set()
    snapshot_id = 1

    for row in resolved:
        key = fixture_key(row)
        if key is None:
            continue

        current = state.setdefault(key, {"balls": 0, "scoreRuns": 0, "scoreWickets": 0})
        if include_baseline and key not in emitted_baseline:
            snapshots.append({
                "id": snapshot_id,
                "fixtureId": key[0],
                "innings": key[1],
                "balls": 0,
                "scoreRuns": 0,
                "scoreWickets": 0,
                "createdAt": created_at_for(row, 0),
                "source": "normalized_ball_events_baseline",
            })
            snapshot_id += 1
            emitted_baseline.add(key)

        is_legal_delivery = as_bool(row.get("is_legal_delivery"))
        if is_legal_delivery:
            current["balls"] += 1
        score_after = as_int(row.get("score_after"))
        wickets_after = as_int(row.get("wickets_after"))
        current["scoreRuns"] = score_after if score_after is not None else current["scoreRuns"] + delivery_runs(row)
        current["scoreWickets"] = (
            wickets_after if wickets_after is not None else current["scoreWickets"] + (1 if as_bool(row.get("is_wicket")) else 0)
        )

        snapshots.append({
            "id": snapshot_id,
            "fixtureId": key[0],
            "innings": key[1],
            "balls": current["balls"],
            "scoreRuns": current["scoreRuns"],
            "scoreWickets": current["scoreWickets"],
            "createdAt": created_at_for(row, snapshot_id),
            "source": "normalized_ball_events",
            "sourceEventHash": row.get("source_event_hash"),
            "deliverySequenceKey": row.get("delivery_sequence_key"),
            "isLegalDelivery": is_legal_delivery,
        })
        snapshot_id += 1

    return snapshots


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":"), default=str))
            handle.write("\n")


def main() -> None:
    args = parse_args()
    events = read_jsonl(args.input_jsonl)
    snapshots = build_snapshots(events, include_baseline=not args.no_baseline)

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(snapshots, indent=2, default=str) + "\n")
    write_jsonl(args.output_jsonl, snapshots)

    summary = {
        "status": "experimental",
        "input_events": len(events),
        "snapshots_written": len(snapshots),
        "output_json": str(args.output_json),
        "output_jsonl": str(args.output_jsonl),
        "notes": [
            "Offline conversion only; no production runtime behavior changed.",
            "Output shape is compatible with --snapshots-json and --snapshots-jsonl in ball-state parity/shadow scripts.",
        ],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
