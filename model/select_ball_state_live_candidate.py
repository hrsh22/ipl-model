#!/usr/bin/env python3
"""Select the best experimental live-compatible ball-state artifact per target.

This does not copy, promote, or wire model artifacts. It writes a report that
points to the strongest experimental candidate for each target by walk-forward
primary metric.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_EXPERIMENT_DIR = ROOT / "experiments" / "ball-state"
DEFAULT_OUTPUT = DEFAULT_EXPERIMENT_DIR / "live_candidate_selection_report.json"

DEFAULT_CANDIDATES = {
    "stable": DEFAULT_EXPERIMENT_DIR / "live-compatible-artifacts" / "manifest.json",
    "stable_platt": DEFAULT_EXPERIMENT_DIR / "live-compatible-platt-artifacts" / "manifest.json",
    "stable_isotonic": DEFAULT_EXPERIMENT_DIR / "live-compatible-isotonic-artifacts" / "manifest.json",
    "trajectory": DEFAULT_EXPERIMENT_DIR / "live-compatible-trajectory-artifacts" / "manifest.json",
    "selected_trajectory": DEFAULT_EXPERIMENT_DIR / "live-compatible-selected-trajectory-artifacts" / "manifest.json",
    "selected_trajectory_platt": DEFAULT_EXPERIMENT_DIR / "live-compatible-selected-trajectory-platt-artifacts" / "manifest.json",
    "tuned_stable_depth4_lr003_l28_chase": DEFAULT_EXPERIMENT_DIR / "tuned" / "stable_depth4_lr003_l28" / "manifest.json",
    "tuned_stable_depth5_lr003_l28_chase": DEFAULT_EXPERIMENT_DIR / "tuned" / "stable_depth5_lr003_l28" / "manifest.json",
    "tuned_stable_depth4_lr0045_l210_chase": DEFAULT_EXPERIMENT_DIR / "tuned" / "stable_depth4_lr0045_l210" / "manifest.json",
    "tuned_selected_depth4_lr003_l28_runs": DEFAULT_EXPERIMENT_DIR / "tuned" / "selected_depth4_lr003_l28_runs" / "manifest.json",
    "tuned_stable_depth4_lr003_l28_remaining_runs": DEFAULT_EXPERIMENT_DIR / "tuned" / "stable_depth4_lr003_l28_remaining_runs" / "manifest.json",
    "tuned_selected_depth4_lr003_l28_remaining_wickets": DEFAULT_EXPERIMENT_DIR / "tuned" / "selected_depth4_lr003_l28_remaining_wickets" / "manifest.json",
}

REGRESSION_PRIMARY_METRIC = "mae"
CLASSIFICATION_PRIMARY_METRIC = "log_loss"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help="Candidate as label=path. Defaults to all known experimental live candidates.",
    )
    return parser.parse_args()


def candidate_paths(entries: list[str]) -> dict[str, Path]:
    if not entries:
        return DEFAULT_CANDIDATES
    paths: dict[str, Path] = {}
    for entry in entries:
        if "=" not in entry:
            raise ValueError(f"Candidate must use label=path format: {entry}")
        label, path = entry.split("=", 1)
        paths[label] = Path(path)
    return paths


def load_candidates(paths: dict[str, Path]) -> dict[str, dict[str, Any]]:
    loaded = {}
    for label, path in paths.items():
        if path.exists():
            loaded[label] = json.loads(path.read_text())
    return loaded


def regression_candidates(candidates: dict[str, dict[str, Any]], target: str) -> list[dict[str, Any]]:
    rows = []
    for label, manifest in candidates.items():
        target_entry = manifest.get("targets", {}).get(target)
        if not target_entry:
            continue
        metric = target_entry["weighted_metrics"][REGRESSION_PRIMARY_METRIC]
        rows.append({
            "candidate": label,
            "feature_mode": manifest.get("feature_mode"),
            "artifact": target_entry.get("artifact"),
            "primary_metric": REGRESSION_PRIMARY_METRIC,
            "primary_value": metric,
            "weighted_metrics": target_entry.get("weighted_metrics"),
            "weighted_baseline_metrics": target_entry.get("weighted_baseline_metrics"),
        })
    return sorted(rows, key=lambda row: row["primary_value"])


def classification_candidates(candidates: dict[str, dict[str, Any]], target: str) -> list[dict[str, Any]]:
    rows = []
    for label, manifest in candidates.items():
        target_entry = manifest.get("classification_targets", {}).get(target)
        if not target_entry:
            continue
        metric = target_entry["weighted_metrics"][CLASSIFICATION_PRIMARY_METRIC]
        rows.append({
            "candidate": label,
            "feature_mode": manifest.get("feature_mode"),
            "calibration": manifest.get("classification_calibration"),
            "artifact": target_entry.get("artifact"),
            "primary_metric": CLASSIFICATION_PRIMARY_METRIC,
            "primary_value": metric,
            "weighted_metrics": target_entry.get("weighted_metrics"),
            "weighted_baseline_metrics": target_entry.get("weighted_baseline_metrics"),
        })
    return sorted(rows, key=lambda row: row["primary_value"])


def main() -> None:
    args = parse_args()
    candidates = load_candidates(candidate_paths(args.candidate))
    if not candidates:
        raise SystemExit("No candidate manifests found")

    regression_targets = sorted({
        target
        for manifest in candidates.values()
        for target in manifest.get("targets", {})
    })
    classification_targets = sorted({
        target
        for manifest in candidates.values()
        for target in manifest.get("classification_targets", {})
    })

    selected: dict[str, Any] = {}
    comparisons: dict[str, Any] = {}

    for target in regression_targets:
        rows = regression_candidates(candidates, target)
        if rows:
            selected[target] = rows[0]
            comparisons[target] = rows

    for target in classification_targets:
        rows = classification_candidates(candidates, target)
        if rows:
            selected[target] = rows[0]
            comparisons[target] = rows

    report = {
        "status": "experimental",
        "name": "ball_state_live_candidate_selection",
        "candidate_count": len(candidates),
        "selected": selected,
        "comparisons": comparisons,
        "notes": [
            "Selection is per target because each target is trained as a separate artifact.",
            "Regression targets are selected by lowest walk-forward MAE.",
            "Classification targets are selected by lowest walk-forward log_loss.",
            "This report does not promote, copy, or wire artifacts into production.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
