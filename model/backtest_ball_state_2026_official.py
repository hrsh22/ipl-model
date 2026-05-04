#!/usr/bin/env python3
"""Backtest experimental ball-state chase success on completed IPL 2026 official innings feeds."""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import joblib
import pandas as pd

from shadow_score_ball_state_live import load_dtype_reference, missing_required_features, score_classification
from validate_ball_state_live_parity import (
    DEFAULT_MANIFEST,
    DEFAULT_MATCH_SQUADS,
    DEFAULT_PRESEASON_TEAM_PRIORS,
    DEFAULT_PRESEASON_TEAM_ROSTERS,
    PriorLookup,
    build_snapshot_index,
    feature_row_from_live_model,
    filter_feature_columns,
    load_feature_columns,
)


ROOT = Path(__file__).resolve().parent
DEFAULT_COMPLETED_RESULTS = ROOT / "data" / "live" / "completed_results_2026.csv"
DEFAULT_CANDIDATE_MANIFEST = ROOT.parent / "model" / "ball_state_live_candidate_selection.json"
DEFAULT_OUTPUT_DIR = ROOT / "experiments" / "ball-state" / "backtests" / "2026-official-innings"
INNINGS_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-Innings{innings}.js"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--completed-results", type=Path, default=DEFAULT_COMPLETED_RESULTS)
    parser.add_argument("--candidate-manifest", type=Path, default=DEFAULT_CANDIDATE_MANIFEST)
    parser.add_argument("--matrix-manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, help="Optional match limit for smoke runs")
    return parser.parse_args()


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(str(value).strip()))
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


def parse_jsonp(text: str) -> dict[str, Any]:
    match = re.match(r"\s*([A-Za-z0-9_]+)\((.*)\)\s*;?\s*$", text, re.S)
    if not match:
        raise ValueError("unable to parse official innings JSONP")
    parsed = json.loads(match.group(2))
    if not isinstance(parsed, dict):
        raise ValueError("official innings payload is not an object")
    return parsed


def fetch_innings(match_id: str, innings: int) -> dict[str, Any] | None:
    url = INNINGS_URL_TEMPLATE.format(match_id=match_id, innings=innings)
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=20) as response:
        text = response.read().decode("utf-8")
    payload = parse_jsonp(text)
    innings_payload = payload.get(f"Innings{innings}")
    return innings_payload if isinstance(innings_payload, dict) else None


def over_history(innings_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows = (innings_payload or {}).get("OverHistory") or []
    return [
        row
        for row in rows
        if isinstance(row, dict)
        and str(row.get("ActualBallNo") or "").strip()
        and str(row.get("TotalRuns") or "").strip()
    ]


def extras_summary(innings_payload: dict[str, Any] | None) -> dict[str, Any]:
    extras = (innings_payload or {}).get("Extras") or {}
    return extras if isinstance(extras, dict) else {}


def is_legal_delivery(row: dict[str, Any]) -> bool:
    return not (as_bool(row.get("IsWide")) or as_bool(row.get("IsNoBall")))


def cumulative_runs(row: dict[str, Any]) -> int:
    value = as_int(row.get("TotalRuns"))
    if value is not None:
        return value
    return as_int(row.get("Runs")) or 0


def cumulative_wickets(row: dict[str, Any]) -> int:
    value = as_int(row.get("TotalWickets"))
    if value is not None:
        return value
    return as_int(row.get("Wickets")) or 0


def final_runs(innings_payload: dict[str, Any] | None) -> int | None:
    rows = over_history(innings_payload)
    if rows:
        return cumulative_runs(rows[-1])
    total = str(extras_summary(innings_payload).get("Total") or "")
    match = re.match(r"\s*(\d+)", total)
    return int(match.group(1)) if match else None


def team_name(row: dict[str, Any], innings_payload: dict[str, Any] | None) -> str | None:
    value = row.get("TeamName") or extras_summary(innings_payload).get("BattingTeamName")
    return str(value).strip() if value else None


def bowling_team_name(innings_payload: dict[str, Any] | None) -> str | None:
    value = extras_summary(innings_payload).get("BowlingTeamName")
    return str(value).strip() if value else None


def opponent_for(batting_team: str | None, match: dict[str, Any]) -> str | None:
    if batting_team == match.get("team1"):
        return str(match.get("team2") or "").strip() or None
    if batting_team == match.get("team2"):
        return str(match.get("team1") or "").strip() or None
    return None


def build_snapshots(match_id: str, innings: int, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = [{
        "id": 1,
        "fixtureId": match_id,
        "innings": innings,
        "balls": 0,
        "scoreRuns": 0,
        "scoreWickets": 0,
        "createdAt": "2026-01-01T00:00:00+00:00",
        "source": "official_ipl_baseline",
    }]
    legal_balls = 0
    snapshot_id = 2
    for row in rows:
        if is_legal_delivery(row):
            legal_balls += 1
        snapshots.append({
            "id": snapshot_id,
            "fixtureId": match_id,
            "innings": innings,
            "balls": legal_balls,
            "scoreRuns": cumulative_runs(row),
            "scoreWickets": cumulative_wickets(row),
            "createdAt": f"2026-01-01T00:{snapshot_id:02d}:00+00:00",
            "source": "official_ipl_innings_feed",
            "isLegalDelivery": is_legal_delivery(row),
        })
        snapshot_id += 1
    return snapshots

def auc_score(labels: list[int], probabilities: list[float]) -> float | None:
    positives = sum(labels)
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        return None
    ordered = sorted(zip(probabilities, labels), key=lambda item: item[0])
    rank_sum = 0.0
    index = 1
    while index <= len(ordered):
        end = index
        while end < len(ordered) and ordered[end][0] == ordered[index - 1][0]:
            end += 1
        average_rank = (index + end) / 2
        rank_sum += sum(label for _, label in ordered[index - 1:end]) * average_rank
        index = end + 1
    return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def safe_probability(value: float) -> float:
    return min(1 - 1e-15, max(1e-15, value))


def probability_metrics(frame: pd.DataFrame) -> dict[str, float | int | None]:
    if frame.empty:
        return {
            "rows": 0,
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "roc_auc": None,
            "average_prediction": None,
            "actual_rate": None,
            "calibration_gap": None,
        }
    labels = [int(value) for value in frame["label_chase_success"]]
    probabilities = [float(value) for value in frame["prediction_chase_success"]]
    predicted = [int(value) for value in frame["predicted_label"]]
    log_loss_value = sum(
        -(label * math.log(safe_probability(prob)) + (1 - label) * math.log(1 - safe_probability(prob)))
        for label, prob in zip(labels, probabilities)
    ) / len(labels)
    brier = sum((prob - label) ** 2 for label, prob in zip(labels, probabilities)) / len(labels)
    accuracy = sum(1 for label, pred in zip(labels, predicted) if label == pred) / len(labels)
    average_prediction = sum(probabilities) / len(probabilities)
    actual_rate = sum(labels) / len(labels)
    return {
        "rows": len(labels),
        "accuracy": accuracy,
        "log_loss": log_loss_value,
        "brier": brier,
        "roc_auc": auc_score(labels, probabilities),
        "average_prediction": average_prediction,
        "actual_rate": actual_rate,
        "calibration_gap": average_prediction - actual_rate,
    }


def phase_metrics(predictions: pd.DataFrame) -> dict[str, dict[str, float | int | None]]:
    return {
        "powerplay": probability_metrics(predictions[predictions["balls"] <= 36]),
        "middle": probability_metrics(predictions[(predictions["balls"] > 36) & (predictions["balls"] <= 90)]),
        "death": probability_metrics(predictions[predictions["balls"] > 90]),
    }


def calibration_bins(predictions: pd.DataFrame) -> list[dict[str, float | int | str | None]]:
    output: list[dict[str, float | int | str | None]] = []
    for lower in range(10):
        low = lower / 10
        high = (lower + 1) / 10
        if lower == 9:
            rows = predictions[
                (predictions["prediction_chase_success"] >= low)
                & (predictions["prediction_chase_success"] <= high)
            ]
        else:
            rows = predictions[
                (predictions["prediction_chase_success"] >= low)
                & (predictions["prediction_chase_success"] < high)
            ]
        if rows.empty:
            continue
        output.append({
            "range": f"{low:.1f}-{high:.1f}",
            **probability_metrics(rows),
        })
    return output


def worst_match_slices(predictions: pd.DataFrame, limit: int = 10) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for (match_id, batting_team, bowling_team), group in predictions.groupby(
        ["match_id", "batting_team", "bowling_team"],
        sort=False,
    ):
        metrics = probability_metrics(group)
        latest = group.sort_values("balls").iloc[-1]
        rows.append({
            "match_id": str(match_id),
            "batting_team": str(batting_team),
            "bowling_team": str(bowling_team),
            "rows": metrics["rows"],
            "accuracy": metrics["accuracy"],
            "log_loss": metrics["log_loss"],
            "brier": metrics["brier"],
            "average_prediction": metrics["average_prediction"],
            "actual_rate": metrics["actual_rate"],
            "final_prediction": float(latest["prediction_chase_success"]),
            "actual": int(latest["label_chase_success"]),
        })
    return sorted(rows, key=lambda row: float(row["log_loss"] or 0), reverse=True)[:limit]


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    completed = pd.read_csv(args.completed_results, dtype=str).fillna("")
    if args.limit:
        completed = completed.head(args.limit)

    selection = json.loads(args.candidate_manifest.read_text())
    selected = selection["selected"]["chase_success"]
    artifact = joblib.load(Path(selected["artifact"]))
    full_feature_columns = load_feature_columns(args.matrix_manifest)
    feature_columns = filter_feature_columns(full_feature_columns, selected["feature_mode"])
    dtype_reference = load_dtype_reference(args.matrix_manifest, feature_columns)
    prior_lookup = PriorLookup(
        ROOT / "data" / "features" / "pre_match_matchup_features.csv",
        ROOT / "data" / "features" / "pre_match_team_features.csv",
        DEFAULT_PRESEASON_TEAM_PRIORS,
        DEFAULT_PRESEASON_TEAM_ROSTERS,
        DEFAULT_MATCH_SQUADS,
    )

    scored_rows: list[dict[str, Any]] = []
    rejected_rows: list[dict[str, Any]] = []

    for match in completed.to_dict("records"):
        match_id = str(match["match_id"])
        try:
            innings1 = fetch_innings(match_id, 1)
            innings2 = fetch_innings(match_id, 2)
        except Exception as error:
            rejected_rows.append({"match_id": match_id, "reason": f"fetch failed: {error}"})
            continue

        first_runs = final_runs(innings1)
        rows = over_history(innings2)
        if first_runs is None or not rows:
            rejected_rows.append({"match_id": match_id, "reason": "missing first innings total or second innings balls"})
            continue

        batting_team = team_name(rows[-1], innings2)
        bowling_team = bowling_team_name(innings2) or opponent_for(batting_team, match)
        if not batting_team or not bowling_team:
            rejected_rows.append({"match_id": match_id, "reason": "missing innings team metadata"})
            continue

        label = 1 if batting_team == match["winner"] else 0
        snapshots = build_snapshots(match_id, 2, rows)
        snapshot_index = build_snapshot_index(snapshots)
        legal_balls = 0

        for event_index, event in enumerate(rows, start=1):
            if not is_legal_delivery(event):
                continue
            legal_balls += 1
            entry = {
                "fixture": {
                    "id": match_id,
                    "startTime": f"{match['match_date']}T14:00:00+00:00",
                    "venueName": match["venue"],
                    "venueLocation": match["city"],
                    "homeTeam": match["team1"],
                    "awayTeam": match["team2"],
                    "score": None,
                },
                "expectedState": {
                    "innings": 2,
                    "battingTeam": batting_team,
                    "bowlingTeam": bowling_team,
                    "balls": legal_balls,
                    "scoreRuns": cumulative_runs(event),
                    "scoreWickets": cumulative_wickets(event),
                    "targetRuns": first_runs + 1,
                },
                "venueContext": {
                    "avgFirstInningsScore": None,
                    "avgSecondInningsScore": None,
                    "chasingWinPct": None,
                    "battingFirstWinPct": None,
                },
            }
            row = feature_row_from_live_model(entry, feature_columns, prior_lookup, snapshot_index)
            missing = missing_required_features(row, feature_columns)
            if missing:
                rejected_rows.append({"match_id": match_id, "event_index": event_index, "balls": legal_balls, "reason": "missing required features", "missing": missing})
                continue
            probability = score_classification(artifact, row, feature_columns, dtype_reference)
            scored_rows.append({
                "match_id": match_id,
                "match_date": match["match_date"],
                "venue": match["venue"],
                "batting_team": batting_team,
                "bowling_team": bowling_team,
                "winner": match["winner"],
                "label_chase_success": label,
                "balls": legal_balls,
                "score_runs": cumulative_runs(event),
                "score_wickets": cumulative_wickets(event),
                "target_runs": first_runs + 1,
                "prediction_chase_success": probability,
                "predicted_label": 1 if probability >= 0.5 else 0,
            })

    predictions = pd.DataFrame(scored_rows)
    rejections = pd.DataFrame(rejected_rows)
    predictions.to_csv(args.output_dir / "chase_success_predictions.csv", index=False)
    rejections.to_csv(args.output_dir / "rejections.csv", index=False)

    if predictions.empty:
        summary = {"status": "no_scores", "scored_rows": 0, "rejected_rows": len(rejected_rows)}
    else:
        match_latest = predictions.sort_values(["match_id", "balls"]).groupby("match_id").tail(1)
        match_labels = [int(value) for value in match_latest["label_chase_success"]]
        match_predicted = [int(value) for value in match_latest["predicted_label"]]
        row_metrics = probability_metrics(predictions)
        summary = {
            "status": "ok",
            "generated_at": datetime.now(UTC).isoformat(),
            "source": "official_ipl_innings_feeds",
            "matches_considered": int(completed.shape[0]),
            "matches_scored": int(predictions["match_id"].nunique()),
            "scored_ball_states": int(predictions.shape[0]),
            "rejected_rows": len(rejected_rows),
            "row_metrics": row_metrics,
            "phase_metrics": phase_metrics(predictions),
            "calibration_bins": calibration_bins(predictions),
            "worst_matches_by_log_loss": worst_match_slices(predictions),
            "final_state_match_accuracy": sum(1 for label, pred in zip(match_labels, match_predicted) if label == pred) / len(match_labels),
        }

    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
