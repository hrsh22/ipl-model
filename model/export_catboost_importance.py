from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from catboost import CatBoostClassifier


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export CatBoost feature importance from fold models"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument("--feature-mode", default="full")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_dir = Path.cwd() / "model" / "artifacts" / args.matrix / args.feature_mode
    models_dir = base_dir / "models"
    output_dir = base_dir / "feature_importance"
    output_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, object]] = []
    for model_path in sorted(models_dir.glob("*__catboost_tuned.cbm")):
        model = CatBoostClassifier()
        model.load_model(str(model_path))
        fold_name = model_path.name.removesuffix("__catboost_tuned.cbm")
        feature_names = model.feature_names_
        importances = model.get_feature_importance()
        for feature_name, importance in zip(feature_names, importances, strict=False):
            rows.append(
                {
                    "fold_name": fold_name,
                    "feature_name": feature_name,
                    "importance": float(importance),
                }
            )

    frame = pd.DataFrame(rows)
    frame.to_csv(output_dir / "fold_feature_importance.csv", index=False)
    summary = (
        frame.groupby("feature_name", as_index=False)
        .agg(
            mean_importance=("importance", "mean"),
            median_importance=("importance", "median"),
            std_importance=("importance", "std"),
            max_importance=("importance", "max"),
            nonzero_folds=("importance", lambda s: int((s > 0).sum())),
            folds=("importance", "count"),
        )
        .sort_values(["mean_importance", "median_importance"], ascending=False)
        .reset_index(drop=True)
    )
    summary.to_csv(output_dir / "summary_feature_importance.csv", index=False)

    (output_dir / "manifest.json").write_text(
        json.dumps(
            {
                "matrix": args.matrix,
                "featureMode": args.feature_mode,
                "foldModels": len(list(models_dir.glob("*__catboost_tuned.cbm"))),
            },
            indent=2,
        )
        + "\n"
    )

    print(f"Exported feature importance for {args.matrix}/{args.feature_mode}")


if __name__ == "__main__":
    main()
