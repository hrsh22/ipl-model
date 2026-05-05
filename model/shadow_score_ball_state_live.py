#!/usr/bin/env python3
"""Shadow-score live observer states with experimental ball-state artifacts.

This is deliberately experiment-only. It reads captured or runtime-generated
`/observer/live-model` payloads, scores them with the selected experimental
ball-state candidates, and writes comparison journals under the requested
output directory. The observer may invoke this as a runtime bridge for the
experimental dashboard, but it does not touch production artifacts.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import joblib
import pandas as pd

from build_ball_state_matrix import EVENT_TRAJECTORY_COLUMNS
from train_ball_state import apply_calibrator, prepare_features
from validate_ball_state_live_parity import (
    CORE_LIVE_FEATURES,
    DEFAULT_MANIFEST,
    EVENT_TRAJECTORY_COLUMNS as PARITY_TRAJECTORY_COLUMNS,
    DEFAULT_MATCH_SQUADS,
    PriorLookup,
    build_snapshot_index,
    DEFAULT_PRESEASON_TEAM_PRIORS,
    DEFAULT_PRESEASON_TEAM_ROSTERS,
    feature_row_from_live_model,
    filter_feature_columns,
    load_feature_columns,
)


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DEFAULT_EXPERIMENT_DIR = ROOT / "experiments" / "ball-state"
DEFAULT_SELECTION_REPORT = DEFAULT_EXPERIMENT_DIR / "live_candidate_selection_report.json"
DEFAULT_RUNTIME_MATRIX_MANIFEST = ROOT / "runtime_artifacts" / "ball_state_live" / "ball_state_matrix_manifest.json"
DEFAULT_OUTPUT_ROOT = DEFAULT_EXPERIMENT_DIR / "runs"

REGRESSION_TARGETS = {
    "expected_runs_now",
    "expected_wickets_now",
    "final_innings_runs",
    "final_innings_wickets",
    "remaining_innings_runs",
    "remaining_innings_wickets",
}
CLASSIFICATION_TARGETS = {"batting_team_match_win", "chase_success"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", type=Path, default=DEFAULT_SELECTION_REPORT)
    parser.add_argument("--matrix-manifest", type=Path, default=DEFAULT_RUNTIME_MATRIX_MANIFEST)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--input-json", type=Path, help="Captured /observer/live-model JSON list or object")
    parser.add_argument("--input-jsonl", type=Path, help="Captured /observer/live-model JSONL entries")
    parser.add_argument("--url", help="Optional /observer/live-model URL to fetch once")
    parser.add_argument("--snapshots-json", type=Path, help="Captured /observer/live-model/snapshots JSON list")
    parser.add_argument("--snapshots-jsonl", type=Path, help="Captured /observer/live-model/snapshots JSONL rows")
    parser.add_argument("--snapshots-url", help="Optional /observer/live-model/snapshots URL to fetch once")
    return parser.parse_args()


def resolve_path(path: str | Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute() or candidate.exists():
        return candidate
    return REPO_ROOT / candidate


def read_json_source(path: Path | None, jsonl_path: Path | None, url: str | None) -> Any:
    supplied = [value is not None for value in [path, jsonl_path, url]].count(True)
    if supplied != 1:
        raise SystemExit("exactly one of --input-json, --input-jsonl, or --url is required")

    if path:
        return json.loads(path.read_text())

    if jsonl_path:
        rows = []
        for line in jsonl_path.read_text().splitlines():
            if line.strip():
                parsed = json.loads(line)
                if isinstance(parsed, list):
                    rows.extend(parsed)
                else:
                    rows.append(parsed)
        return rows

    if url:
        with urlopen(url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    raise SystemExit("unreachable input source branch")


def read_optional_json_source(path: Path | None, jsonl_path: Path | None, url: str | None) -> Any | None:
    supplied = [value is not None for value in [path, jsonl_path, url]].count(True)
    if supplied == 0:
        return None
    if supplied > 1:
        raise SystemExit("only one snapshot source may be supplied")

    if path:
        return json.loads(path.read_text())

    if jsonl_path:
        return [json.loads(line) for line in jsonl_path.read_text().splitlines() if line.strip()]

    if url:
        with urlopen(url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    return None


def as_entries(payload: Any) -> list[dict[str, Any]]:
    rows = payload if isinstance(payload, list) else [payload]
    return [row for row in rows if isinstance(row, dict)]


def load_selection_report(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"invalid candidate manifest: missing file {path}")
    report = json.loads(path.read_text())
    selected = report.get("selected")
    if not isinstance(selected, dict) or not selected:
        raise SystemExit("invalid candidate manifest: missing selected candidates")
    return report


def load_artifact(path: str | Path) -> Any:
    resolved = resolve_path(path)
    if not resolved.exists():
        raise SystemExit(f"invalid candidate manifest: missing artifact {resolved}")
    return joblib.load(resolved)


def matrix_path_from_manifest(path: Path) -> Path | None:
    if not path.exists():
        return None
    manifest = json.loads(path.read_text())
    output = manifest.get("output")
    return resolve_path(output) if output else None


def load_dtype_reference(matrix_manifest: Path, feature_columns: list[str]) -> dict[str, str]:
    matrix_path = matrix_path_from_manifest(matrix_manifest)
    if matrix_path is None or not matrix_path.exists():
        return {}
    sample = pd.read_csv(matrix_path, usecols=lambda column: column in feature_columns, nrows=200, low_memory=False)
    return {column: str(dtype) for column, dtype in sample.dtypes.items()}


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except TypeError:
        return False


def missing_required_features(row: dict[str, Any], feature_columns: list[str]) -> list[str]:
    required = {column for column in CORE_LIVE_FEATURES if column in feature_columns}
    required.update(column for column in PARITY_TRAJECTORY_COLUMNS if column in feature_columns)
    return sorted(column for column in required if is_missing(row.get(column)))


def feature_frame(row: dict[str, Any], feature_columns: list[str], dtype_reference: dict[str, str]) -> pd.DataFrame:
    frame = pd.DataFrame([{column: row.get(column) for column in feature_columns}])
    for column in feature_columns:
        reference_dtype = dtype_reference.get(column)
        if reference_dtype and reference_dtype != "object":
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def score_regression(artifact: Any, row: dict[str, Any], feature_columns: list[str], dtype_reference: dict[str, str]) -> float:
    frame = feature_frame(row, feature_columns, dtype_reference)
    return float(artifact.predict(prepare_features(frame, feature_columns))[0])


def score_classification(payload: dict[str, Any], row: dict[str, Any], feature_columns: list[str], dtype_reference: dict[str, str]) -> float:
    model = payload["model"]
    frame = feature_frame(row, feature_columns, dtype_reference)
    raw = pd.Series(
        model.predict_proba(prepare_features(frame, feature_columns))[:, 1],
        index=frame.index,
    )
    calibrated = apply_calibrator(raw, payload.get("calibrator"), payload.get("calibration_method", "none"))
    return float(calibrated.iloc[0])


def heuristic_value(entry: dict[str, Any], target: str) -> float | None:
    fixture = entry.get("fixture") or {}
    state = entry.get("expectedState") or {}

    if target == "expected_runs_now":
        return state.get("expectedRunsNow") or entry.get("expectedRunsNow")
    if target == "expected_wickets_now":
        return state.get("expectedWicketsNow") or entry.get("expectedWicketsNow")
    if target == "final_innings_runs":
        return state.get("projectedScore") or entry.get("projectedScore")
    if target == "final_innings_wickets":
        return state.get("expectedWicketsNow") or entry.get("expectedWicketsNow")
    if target == "remaining_innings_runs":
        return state.get("runsDelta") or entry.get("runsDelta")
    if target == "remaining_innings_wickets":
        return state.get("wicketsDelta") or entry.get("wicketsDelta")
    if target in {"batting_team_match_win", "chase_success"}:
        batting_team = state.get("battingTeam")
        if not batting_team:
            score = fixture.get("score")
            home_score = away_score = None
            if isinstance(score, str) and "-" in score:
                try:
                    home_score, away_score = [int(part) for part in score.split("-", 1)]
                except ValueError:
                    pass
            if state.get("scoreRuns") == home_score:
                batting_team = fixture.get("homeTeam")
            if state.get("scoreRuns") == away_score:
                batting_team = fixture.get("awayTeam")

        if batting_team == fixture.get("homeTeam"):
            return entry.get("homeModelProbability")
        if batting_team == fixture.get("awayTeam"):
            return entry.get("awayModelProbability")
    return None


def target_applicable(entry: dict[str, Any], target: str) -> tuple[bool, str | None]:
    state = entry.get("expectedState") or {}
    if target == "batting_team_match_win" and state.get("innings") != 1:
        return False, "batting_team_match_win requires innings 1"
    if target == "chase_success" and state.get("innings") != 2:
        return False, "chase_success requires innings 2"
    return True, None


def as_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def terminal_chase_success_probability(entry: dict[str, Any]) -> float | None:
    state = entry.get("expectedState") or {}
    if state.get("innings") != 2:
        return None

    score_runs = as_number(state.get("scoreRuns"))
    target_runs = as_number(state.get("targetRuns"))
    if score_runs is None or target_runs is None:
        return None

    if score_runs >= target_runs:
        return 1.0

    score_wickets = as_number(state.get("scoreWickets"))
    balls = as_number(state.get("balls"))
    if score_wickets is not None and score_wickets >= 10:
        return 0.0
    if balls is not None and balls >= 120:
        return 0.0

    return None


def output_directory(path: Path | None) -> Path:
    if path:
        return path
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return DEFAULT_OUTPUT_ROOT / f"shadow-{stamp}"


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    with path.open("a") as handle:
        handle.write(json.dumps(row, default=str) + "\n")


def markdown_summary(summary: dict[str, Any]) -> str:
    lines = [
        "# Ball-state live shadow scoring",
        "",
        f"- Status: `{summary['status']}`",
        f"- Input rows: `{summary['input_rows']}`",
        f"- Scored entries: `{summary['scored_entries']}`",
        f"- Target scores: `{summary['target_scores']}`",
        f"- Rejected target rows: `{summary['rejected_rows']}`",
        "",
        "## Targets scored",
    ]
    for target, count in summary["target_score_counts"].items():
        lines.append(f"- `{target}`: `{count}`")
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    selection_report = load_selection_report(args.candidate_manifest)
    payload = read_json_source(args.input_json, args.input_jsonl, args.url)
    snapshot_payload = read_optional_json_source(args.snapshots_json, args.snapshots_jsonl, args.snapshots_url)
    snapshot_index = build_snapshot_index(snapshot_payload)
    entries = as_entries(payload)

    full_feature_columns = load_feature_columns(args.matrix_manifest)
    prior_lookup = PriorLookup(
        ROOT / "data" / "features" / "pre_match_matchup_features.csv",
        ROOT / "data" / "features" / "pre_match_team_features.csv",
        DEFAULT_PRESEASON_TEAM_PRIORS,
        DEFAULT_PRESEASON_TEAM_ROSTERS,
        DEFAULT_MATCH_SQUADS,
    )
    out_dir = output_directory(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    score_path = out_dir / "shadow_scores.jsonl"
    comparison_path = out_dir / "live_comparison.jsonl"
    rejection_path = out_dir / "rejections.jsonl"
    for path in [score_path, comparison_path, rejection_path]:
        path.write_text("")

    artifacts = {
        target: load_artifact(selected["artifact"])
        for target, selected in selection_report["selected"].items()
    }
    feature_columns_by_mode = {
        selected["feature_mode"]: filter_feature_columns(full_feature_columns, selected["feature_mode"])
        for selected in selection_report["selected"].values()
    }
    dtype_reference = load_dtype_reference(
        args.matrix_manifest,
        sorted({column for columns in feature_columns_by_mode.values() for column in columns}),
    )

    scored_entries: set[str] = set()
    target_score_counts = {target: 0 for target in selection_report["selected"]}
    rejected_rows = 0

    for entry_index, entry in enumerate(entries):
        fixture = entry.get("fixture") or {}
        state = entry.get("expectedState") or {}
        fixture_id = fixture.get("id") or f"entry-{entry_index}"
        entry_scores: dict[str, Any] = {}

        for target, selected in selection_report["selected"].items():
            applicable, reason = target_applicable(entry, target)
            if not applicable:
                rejected_rows += 1
                append_jsonl(rejection_path, {
                    "fixture_id": fixture_id,
                    "target": target,
                    "reason": reason,
                })
                continue

            feature_mode = selected["feature_mode"]
            feature_columns = feature_columns_by_mode[feature_mode]
            terminal_probability = terminal_chase_success_probability(entry) if target in {"batting_team_match_win", "chase_success"} else None
            row: dict[str, Any] = {}
            if terminal_probability is not None:
                prediction = terminal_probability
            else:
                row = feature_row_from_live_model(entry, feature_columns, prior_lookup, snapshot_index)
                missing = missing_required_features(row, feature_columns)
                if missing:
                    rejected_rows += 1
                    append_jsonl(rejection_path, {
                        "fixture_id": fixture_id,
                        "target": target,
                        "feature_mode": feature_mode,
                        "reason": "missing required features",
                        "missing_features": missing,
                        "snapshot_diagnostics": row.get("__snapshot_diagnostics", {}),
                    })
                    continue

                artifact = artifacts[target]
                if target in REGRESSION_TARGETS:
                    prediction = score_regression(artifact, row, feature_columns, dtype_reference)
                elif target in CLASSIFICATION_TARGETS:
                    prediction = score_classification(artifact, row, feature_columns, dtype_reference)
                else:
                    rejected_rows += 1
                    append_jsonl(rejection_path, {
                        "fixture_id": fixture_id,
                        "target": target,
                        "reason": "unknown target type",
                    })
                    continue

            baseline = heuristic_value(entry, target)
            record = {
                "fixture_id": fixture_id,
                "entry_index": entry_index,
                "target": target,
                "candidate": selected.get("candidate"),
                "feature_mode": feature_mode,
                "innings": state.get("innings"),
                "batting_team": state.get("battingTeam"),
                "bowling_team": state.get("bowlingTeam"),
                "score_runs": state.get("scoreRuns"),
                "score_wickets": state.get("scoreWickets"),
                "target_runs": state.get("targetRuns"),
                "balls": state.get("balls"),
                "shadow_prediction": prediction,
                "terminal_probability_applied": terminal_probability is not None,
                "heuristic_value": baseline,
                "delta_vs_heuristic": prediction - baseline if isinstance(baseline, (int, float)) else None,
                "snapshot_diagnostics": row.get("__snapshot_diagnostics", {}),
            }
            append_jsonl(score_path, record)
            append_jsonl(comparison_path, record)
            entry_scores[target] = record
            target_score_counts[target] += 1

        if entry_scores:
            scored_entries.add(str(fixture_id))

    summary = {
        "status": "experimental",
        "candidate_manifest": str(args.candidate_manifest),
        "output_dir": str(out_dir),
        "input_rows": len(entries),
        "scored_entries": len(scored_entries),
        "target_scores": sum(target_score_counts.values()),
        "target_score_counts": target_score_counts,
        "rejected_rows": rejected_rows,
        "artifacts": {
            target: selection_report["selected"][target].get("artifact")
            for target in selection_report["selected"]
        },
        "notes": [
            "Offline shadow scoring only; no production runtime behavior changed.",
            "Rows with missing core or required trajectory features are rejected per target.",
        ],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (out_dir / "summary.md").write_text(markdown_summary(summary))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
