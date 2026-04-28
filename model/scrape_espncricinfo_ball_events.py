#!/usr/bin/env python3
"""Scrape ESPNcricinfo page-embedded commentary into experimental ball events.

This script fetches public ESPNcricinfo match/commentary pages and parses the
page's `script#__NEXT_DATA__` bootstrap JSON. It does not call paid APIs, does
not log in, and writes only to the ignored experimental ball-state event journal.

The embedded ESPN payload often contains a recent commentary window rather than
the full innings. Treat this as live/recent event capture, not authoritative
historical replay.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = ROOT / "experiments" / "ball-state" / "live-events"
NEXT_DATA_RE = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(?P<data>.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)
TAG_RE = re.compile(r"<[^>]+>")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="Public ESPNcricinfo match/commentary URL")
    source.add_argument("--input-html", type=Path, help="Saved ESPNcricinfo page HTML")
    parser.add_argument("--fixture-id", help="Override fixture id; defaults to ESPN object id when available")
    parser.add_argument("--source-name", default="espncricinfo")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--user-agent",
        default=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def event_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def fetch_html(url: str, user_agent: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise SystemExit("--url must be http(s)")
    request = Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        raise SystemExit(
            f"ESPNcricinfo returned HTTP {error.code}; use --input-html with a saved public page if direct script fetch is blocked"
        ) from error
    except URLError as error:
        raise SystemExit(f"failed to fetch ESPNcricinfo page: {error.reason}") from error


def extract_next_data(page_html: str) -> dict[str, Any]:
    match = NEXT_DATA_RE.search(page_html)
    if not match:
        raise SystemExit("could not find script#__NEXT_DATA__ in ESPNcricinfo page")
    payload = html.unescape(match.group("data"))
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise SystemExit("invalid __NEXT_DATA__ payload: expected object")
    return parsed


def nested_get(value: dict[str, Any], path: list[str]) -> Any | None:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = TAG_RE.sub("", str(value))
    text = html.unescape(text)
    return " ".join(text.split()) or None


def comments_from_next_data(next_data: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    app_data = nested_get(next_data, ["props", "appPageProps", "data"])
    if not isinstance(app_data, dict):
        raise SystemExit("unsupported ESPN page shape: missing props.appPageProps.data")
    content = app_data.get("content") if isinstance(app_data.get("content"), dict) else {}
    comments = content.get("comments") if isinstance(content, dict) else None
    if not isinstance(comments, list):
        comments = []
    return app_data, [comment for comment in comments if isinstance(comment, dict)]


def commentary_text(comment: dict[str, Any]) -> str | None:
    items = comment.get("commentTextItems")
    if isinstance(items, list):
        parts = []
        for item in items:
            if isinstance(item, dict):
                text = clean_text(item.get("html") or item.get("text"))
                if text:
                    parts.append(text)
        if parts:
            return " ".join(parts)
    return clean_text(comment.get("commentary") or comment.get("commentText") or comment.get("title"))


def normalize_comment(comment: dict[str, Any], app_data: dict[str, Any], args: argparse.Namespace, captured_at: str) -> dict[str, Any] | None:
    innings = as_int(comment.get("inningNumber"))
    over = as_int(comment.get("overNumber"))
    ball = as_int(comment.get("ballNumber"))
    if innings is None or over is None or ball is None:
        return None

    match = app_data.get("match") if isinstance(app_data.get("match"), dict) else {}
    fixture_id = args.fixture_id or str(match.get("objectId") or match.get("id") or match.get("scribeId") or "") or None
    total_runs = as_int(comment.get("totalRuns"))
    batsman_runs = as_int(comment.get("batsmanRuns"))
    extras = sum(as_int(comment.get(key)) or 0 for key in ["byes", "legbyes", "wides", "noballs", "penalties"])
    extra_type = None
    for key, label in [("wides", "wide"), ("noballs", "no_ball"), ("byes", "bye"), ("legbyes", "leg_bye")]:
        if (as_int(comment.get(key)) or 0) > 0:
            extra_type = label
            break

    timestamp = comment.get("timestamp") or comment.get("modified")
    delivery_key = comment.get("oversUnique") or comment.get("id") or f"{innings}:{over}.{ball}"

    return {
        "schema_version": "live-ball-event-v0",
        "captured_at": captured_at,
        "source_name": args.source_name,
        "provider": "espncricinfo_page",
        "source_event_hash": event_hash(comment),
        "fixture_id": fixture_id,
        "innings": innings,
        "over": over,
        "ball": ball,
        "over_ball": str(comment.get("oversActual") or f"{over}.{ball}"),
        "delivery_sequence_key": str(delivery_key),
        "event_timestamp": str(timestamp) if timestamp is not None else None,
        "batting_team": None,
        "bowling_team": None,
        "striker": str(comment.get("batsmanPlayerId")) if comment.get("batsmanPlayerId") is not None else None,
        "non_striker": str(comment.get("nonStrikerPlayerId")) if comment.get("nonStrikerPlayerId") is not None else None,
        "bowler": str(comment.get("bowlerPlayerId")) if comment.get("bowlerPlayerId") is not None else None,
        "runs_bat": batsman_runs,
        "extras": extras,
        "total_runs": total_runs if total_runs is not None else (batsman_runs or 0) + extras,
        "extra_type": extra_type,
        "is_legal_delivery": extra_type not in {"wide", "no_ball"},
        "is_wicket": bool(comment.get("isWicket")),
        "wicket_type": comment.get("dismissalType") or comment.get("wicketType"),
        "dismissed_player": str(comment.get("dismissedPlayerId")) if comment.get("dismissedPlayerId") is not None else None,
        "fielder": None,
        "score_after": as_int(comment.get("totalInningRuns")),
        "wickets_after": as_int(comment.get("totalInningWickets")),
        "commentary": commentary_text(comment),
        "raw_event_json": comment,
    }


def append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":"), default=str))
            handle.write("\n")


def existing_event_hashes(path: Path) -> set[str]:
    hashes: set[str] = set()
    if not path.exists():
        return hashes

    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get("source_event_hash"), str):
            hashes.add(parsed["source_event_hash"])
    return hashes


def main() -> None:
    args = parse_args()
    captured_at = utc_now()
    page_html = args.input_html.read_text() if args.input_html else fetch_html(args.url, args.user_agent)
    next_data = extract_next_data(page_html)
    app_data, comments = comments_from_next_data(next_data)
    normalized = [
        row
        for comment in comments
        if (row := normalize_comment(comment, app_data, args, captured_at)) is not None
    ]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    normalized_path = args.output_dir / "normalized_ball_events.jsonl"
    existing_hashes = existing_event_hashes(normalized_path)
    new_normalized = [
        row
        for row in normalized
        if isinstance(row.get("source_event_hash"), str) and row["source_event_hash"] not in existing_hashes
    ]
    raw_record = {
        "captured_at": captured_at,
        "source_name": args.source_name,
        "provider": "espncricinfo_page",
        "url": args.url,
        "source_event_hash": event_hash(next_data),
        "raw_event_json": next_data,
    }
    append_jsonl(args.output_dir / "raw_provider_payloads.jsonl", [raw_record])
    append_jsonl(normalized_path, new_normalized)

    manifest = {
        "status": "experimental",
        "source": "espncricinfo_page_next_data",
        "url": args.url,
        "input_html": str(args.input_html) if args.input_html else None,
        "captured_at": captured_at,
        "comments_seen": len(comments),
        "normalized_rows_seen": len(normalized),
        "normalized_rows_appended": len(new_normalized),
        "normalized_duplicate_rows_skipped": len(normalized) - len(new_normalized),
        "output_dir": str(args.output_dir),
        "caveats": [
            "ESPNcricinfo embedded comments may be a recent/live window, not a complete innings replay.",
            "Use politely and respect site terms/robots; this script does not bypass login, paywalls, or access controls.",
            "Offline experiment only; no production model or production data path changed.",
        ],
    }
    (args.output_dir / "latest_espncricinfo_capture_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
