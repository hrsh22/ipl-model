from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a leakage-safe weighted ensemble from two stored prediction sources"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument(
        "--source-a",
        required=True,
        help="Primary source in the form path:model_name:alias",
    )
    parser.add_argument(
        "--source-b",
        required=True,
        help="Secondary source in the form path:model_name:alias",
    )
    parser.add_argument(
        "--artifacts-dir",
        default="model/artifacts",
        help="Base directory containing matrix artifact folders",
    )
    parser.add_argument(
        "--output-name",
        default="weighted_ensemble",
        help="Output directory name under the chosen matrix artifact folder",
    )
    parser.add_argument(
        "--weight-step",
        type=float,
        default=0.05,
        help="Primary weight grid step from 0.0 to 1.0",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def evaluate(y_true: pd.Series, probabilities: pd.Series) -> dict[str, float]:
    clipped = probabilities.clip(1e-6, 1 - 1e-6)
    predicted = (clipped >= 0.5).astype(int)
    return {
        "accuracy": float(accuracy_score(y_true, predicted)),
        "roc_auc": float(roc_auc_score(y_true, clipped)),
        "log_loss": float(log_loss(y_true, clipped)),
        "brier": float(brier_score_loss(y_true, clipped)),
    }


def resolve_source(root: Path, source: str) -> tuple[Path, str, str]:
    path_text, model_name, alias = source.split(":", 2)
    path = (root / path_text).resolve()
    return path, model_name, alias


def load_prediction_frame(source_dir: Path) -> pd.DataFrame:
    for file_name in ["fold_predictions.csv", "blended_predictions.csv"]:
        file_path = source_dir / file_name
        if file_path.exists():
            return pd.read_csv(file_path)
    raise FileNotFoundError(
        f"No fold_predictions.csv or blended_predictions.csv found in {source_dir}"
    )


def build_weight_grid(step: float) -> list[float]:
    if step <= 0 or step > 1:
        raise ValueError("weight-step must be in the range (0, 1]")
    count = int(round(1.0 / step))
    return [round(index * step, 10) for index in range(count + 1)]


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    base_dir = root / args.artifacts_dir / args.matrix
    output_dir = base_dir / args.output_name
    output_dir.mkdir(parents=True, exist_ok=True)

    source_a_path, source_a_model, source_a_alias = resolve_source(root, args.source_a)
    source_b_path, source_b_model, source_b_alias = resolve_source(root, args.source_b)

    source_a_frame = load_prediction_frame(source_a_path)
    source_b_frame = load_prediction_frame(source_b_path)

    source_a_predictions = source_a_frame[source_a_frame["model"] == source_a_model][
        [
            "fold_name",
            "split",
            "match_id",
            "season",
            "match_date",
            "target_team1_won",
            "predicted_probability",
        ]
    ].rename(columns={"predicted_probability": source_a_alias})
    source_b_predictions = source_b_frame[source_b_frame["model"] == source_b_model][
        ["fold_name", "split", "match_id", "predicted_probability"]
    ].rename(columns={"predicted_probability": source_b_alias})

    merged = source_a_predictions.merge(
        source_b_predictions,
        on=["fold_name", "split", "match_id"],
        how="inner",
    )

    weight_grid = build_weight_grid(args.weight_step)
    weight_search_rows: list[dict[str, Any]] = []
    fold_metric_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []

    model_name = f"weighted_ensemble__{source_a_alias}__{source_b_alias}"

    for fold_name, fold_frame in merged.groupby("fold_name"):
        validation_rows = fold_frame[fold_frame["split"] == "validation"].copy()
        test_rows = fold_frame[fold_frame["split"] == "test"].copy()
        if validation_rows.empty or test_rows.empty:
            continue

        best_weight = 0.0
        best_log_loss = float("inf")

        for weight_a in weight_grid:
            validation_probability = (
                weight_a * validation_rows[source_a_alias]
                + (1 - weight_a) * validation_rows[source_b_alias]
            )
            metrics = evaluate(validation_rows["target_team1_won"], validation_probability)
            weight_search_rows.append(
                {
                    "fold_name": fold_name,
                    f"weight_{source_a_alias}": weight_a,
                    f"weight_{source_b_alias}": 1 - weight_a,
                    **metrics,
                }
            )
            if metrics["log_loss"] < best_log_loss:
                best_log_loss = metrics["log_loss"]
                best_weight = weight_a

        selected_rows.append(
            {
                "fold_name": fold_name,
                f"selected_weight_{source_a_alias}": best_weight,
                f"selected_weight_{source_b_alias}": 1 - best_weight,
            }
        )

        for split_name, rows in [("validation", validation_rows), ("test", test_rows)]:
            probabilities = (
                best_weight * rows[source_a_alias]
                + (1 - best_weight) * rows[source_b_alias]
            )
            metrics = evaluate(rows["target_team1_won"], probabilities)
            fold_metric_rows.append(
                {
                    "fold_name": fold_name,
                    "model": model_name,
                    "split": split_name,
                    "rows": int(rows.shape[0]),
                    f"selected_weight_{source_a_alias}": best_weight,
                    f"selected_weight_{source_b_alias}": 1 - best_weight,
                    **metrics,
                }
            )

            for row, probability in zip(rows.itertuples(index=False), probabilities, strict=False):
                prediction_rows.append(
                    {
                        "fold_name": fold_name,
                        "split": split_name,
                        "match_id": getattr(row, "match_id"),
                        "season": getattr(row, "season"),
                        "match_date": getattr(row, "match_date"),
                        "target_team1_won": getattr(row, "target_team1_won"),
                        "model": model_name,
                        f"selected_weight_{source_a_alias}": best_weight,
                        f"selected_weight_{source_b_alias}": 1 - best_weight,
                        "predicted_probability": float(probability),
                    }
                )

    weight_search_frame = pd.DataFrame(weight_search_rows)
    selected_frame = pd.DataFrame(selected_rows)
    fold_metrics = pd.DataFrame(fold_metric_rows)
    predictions_frame = pd.DataFrame(prediction_rows)

    weight_search_frame.to_csv(output_dir / "weight_search.csv", index=False)
    selected_frame.to_csv(output_dir / "selected_weights.csv", index=False)
    fold_metrics.to_csv(output_dir / "fold_metrics.csv", index=False)
    predictions_frame.to_csv(output_dir / "fold_predictions.csv", index=False)

    summary_rows: list[dict[str, Any]] = []
    for split_name, grouped in fold_metrics.groupby("split"):
        summary_rows.append(
            {
                "model": model_name,
                "split": split_name,
                "folds": int(grouped.shape[0]),
                "accuracy_mean": float(grouped["accuracy"].mean()),
                "accuracy_std": float(grouped["accuracy"].std(ddof=0)),
                "roc_auc_mean": float(grouped["roc_auc"].mean()),
                "roc_auc_std": float(grouped["roc_auc"].std(ddof=0)),
                "log_loss_mean": float(grouped["log_loss"].mean()),
                "log_loss_std": float(grouped["log_loss"].std(ddof=0)),
                "brier_mean": float(grouped["brier"].mean()),
                "brier_std": float(grouped["brier"].std(ddof=0)),
                f"mean_weight_{source_a_alias}": float(grouped[f"selected_weight_{source_a_alias}"].mean()),
                f"mean_weight_{source_b_alias}": float(grouped[f"selected_weight_{source_b_alias}"].mean()),
            }
        )

    summary_frame = pd.DataFrame(summary_rows)
    summary_frame.to_csv(output_dir / "summary_metrics.csv", index=False)

    summary = {
        "matrix": args.matrix,
        "sourceA": {
            "path": str(source_a_path),
            "model": source_a_model,
            "alias": source_a_alias,
        },
        "sourceB": {
            "path": str(source_b_path),
            "model": source_b_model,
            "alias": source_b_alias,
        },
        "weightStep": args.weight_step,
        "summary": summary_rows,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
