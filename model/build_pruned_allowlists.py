from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build CatBoost-derived pruned allowlists"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument("--feature-mode", default="full")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    manifest = json.loads(
        (
            root / "model" / "data" / "metadata" / "model_matrix_manifest.json"
        ).read_text()
    )
    matrix_manifest = manifest["preToss" if args.matrix == "pre_toss" else "postToss"]
    categorical = set(matrix_manifest["categoricalFeatureColumns"])
    feature_columns = matrix_manifest["featureColumns"]

    importance_path = (
        root
        / "model"
        / "artifacts"
        / args.matrix
        / args.feature_mode
        / "feature_importance"
        / "summary_feature_importance.csv"
    )
    summary = pd.read_csv(importance_path)

    always_keep = {
        "elo_gap",
        "elo_expected_team1_win",
        "venue_average_first_innings_score",
        "venue_chasing_win_rate",
        "venue_spin_wicket_share",
        "venue_pace_wicket_share",
        "recent_win_rate_gap",
        "chasing_strength_gap",
        "batting_first_gap",
        "team1_powerplayNetRunRate",
        "team1_middleOversNetRunRate",
        "team1_deathOversNetRunRate",
        "team2_powerplayNetRunRate",
        "team2_middleOversNetRunRate",
        "team2_deathOversNetRunRate",
        "team1_probableXiStrength",
        "team2_probableXiStrength",
        "team1_xiContinuityScore",
        "team2_xiContinuityScore",
    }

    candidate_numeric = summary[
        (~summary["feature_name"].isin(categorical))
        & (~summary["feature_name"].isin(always_keep))
        & (summary["nonzero_folds"] >= 4)
    ]

    pruned_dir = (
        root
        / "model"
        / "artifacts"
        / args.matrix
        / args.feature_mode
        / "pruned_allowlists"
    )
    pruned_dir.mkdir(parents=True, exist_ok=True)

    configs = {
        "top40": 40,
        "top60": 60,
        "top80": 80,
    }

    manifest_rows: list[dict[str, object]] = []
    for name, top_n in configs.items():
        selected_numeric = list(candidate_numeric.head(top_n)["feature_name"])
        allowlist = [
            feature
            for feature in feature_columns
            if feature in categorical
            or feature in always_keep
            or feature in selected_numeric
        ]
        allowlist_path = pruned_dir / f"{name}.txt"
        allowlist_path.write_text("\n".join(allowlist) + "\n")
        manifest_rows.append(
            {
                "name": name,
                "feature_count": len(allowlist),
                "allowlist_path": str(allowlist_path),
            }
        )

    (pruned_dir / "manifest.json").write_text(
        json.dumps(manifest_rows, indent=2) + "\n"
    )
    print(f"Built pruned allowlists for {args.matrix}/{args.feature_mode}")


if __name__ == "__main__":
    main()
