#!/usr/bin/env python3
"""Run a bounded experimental tuning grid for live ball-state candidates.

The grid is intentionally small and writes all artifacts under
`model/experiments/ball-state/tuned/`. It does not copy, promote, or wire any
model into production paths.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = ROOT / "experiments" / "ball-state" / "tuned"
DEFAULT_REPORT = ROOT / "experiments" / "ball-state" / "live_tuning_report.json"

GRID = [
    {
        "label": "stable_depth4_lr003_l28_match_win",
        "feature_mode": "live_compatible",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 4,
        "l2_leaf_reg": 8,
        "target": "batting_team_match_win",
    },
    {
        "label": "stable_depth4_lr0035_l215_match_win",
        "feature_mode": "live_compatible",
        "iterations": 160,
        "learning_rate": 0.035,
        "depth": 4,
        "l2_leaf_reg": 15,
        "target": "batting_team_match_win",
    },
    {
        "label": "stable_depth4_lr003_l28",
        "feature_mode": "live_compatible",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 4,
        "l2_leaf_reg": 8,
        "target": "chase_success",
    },
    {
        "label": "stable_depth5_lr003_l28",
        "feature_mode": "live_compatible",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 5,
        "l2_leaf_reg": 8,
        "target": "chase_success",
    },
    {
        "label": "stable_depth4_lr0045_l210",
        "feature_mode": "live_compatible",
        "iterations": 120,
        "learning_rate": 0.045,
        "depth": 4,
        "l2_leaf_reg": 10,
        "target": "chase_success",
    },
    {
        "label": "stable_depth4_lr0035_l215",
        "feature_mode": "live_compatible",
        "iterations": 160,
        "learning_rate": 0.035,
        "depth": 4,
        "l2_leaf_reg": 15,
        "target": "chase_success",
    },
    {
        "label": "selected_depth4_lr003_l28_runs",
        "feature_mode": "live_compatible_selected_trajectory",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 4,
        "l2_leaf_reg": 8,
        "target": "final_innings_runs",
    },
    {
        "label": "stable_depth4_lr003_l28_remaining_runs",
        "feature_mode": "live_compatible",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 4,
        "l2_leaf_reg": 8,
        "target": "remaining_innings_runs",
    },
    {
        "label": "selected_depth4_lr003_l28_remaining_wickets",
        "feature_mode": "live_compatible_selected_trajectory",
        "iterations": 180,
        "learning_rate": 0.03,
        "depth": 4,
        "l2_leaf_reg": 8,
        "target": "remaining_innings_wickets",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    return parser.parse_args()


def run_candidate(candidate: dict[str, Any], output_root: Path) -> dict[str, Any]:
    output_dir = output_root / candidate["label"]
    command = [
        sys.executable,
        str(ROOT / "train_ball_state.py"),
        "--feature-mode",
        candidate["feature_mode"],
        "--target",
        candidate["target"],
        "--iterations",
        str(candidate["iterations"]),
        "--learning-rate",
        str(candidate["learning_rate"]),
        "--depth",
        str(candidate["depth"]),
        "--l2-leaf-reg",
        str(candidate["l2_leaf_reg"]),
        "--output-dir",
        str(output_dir),
    ]
    completed = subprocess.run(command, cwd=ROOT.parent, text=True, capture_output=True, check=False)
    result: dict[str, Any] = {
        "label": candidate["label"],
        "target": candidate["target"],
        "feature_mode": candidate["feature_mode"],
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "manifest": str(output_dir / "manifest.json"),
    }
    if completed.returncode != 0:
        return result

    manifest = json.loads((output_dir / "manifest.json").read_text())
    if candidate["target"] in manifest.get("targets", {}):
        entry = manifest["targets"][candidate["target"]]
        result["primary_metric"] = "mae"
        result["primary_value"] = entry["weighted_metrics"]["mae"]
        result["weighted_metrics"] = entry["weighted_metrics"]
    if candidate["target"] in manifest.get("classification_targets", {}):
        entry = manifest["classification_targets"][candidate["target"]]
        result["primary_metric"] = "log_loss"
        result["primary_value"] = entry["weighted_metrics"]["log_loss"]
        result["weighted_metrics"] = entry["weighted_metrics"]
    return result


def main() -> None:
    args = parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    results = [run_candidate(candidate, args.output_root) for candidate in GRID]
    report = {
        "status": "experimental",
        "name": "ball_state_live_tuning",
        "search_budget": len(GRID),
        "grid": GRID,
        "results": results,
        "notes": [
            "Bounded tuning only; all artifacts stay under model/experiments/ball-state/tuned.",
            "Each run targets one output so candidate selection can remain target-specific.",
            "This script does not touch model/final_models or model/predict_fixture.py.",
        ],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
