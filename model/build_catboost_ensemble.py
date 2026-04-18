from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build CatBoost ensemble from feature modes"
    )
    parser.add_argument(
        "--matrix",
        choices=["pre_toss", "post_toss"],
        required=True,
        help="Which matrix artifacts to ensemble",
    )
    parser.add_argument(
        "--mode-a",
        default="full",
        help="First feature mode directory to blend",
    )
    parser.add_argument(
        "--mode-b",
        default="delta",
        help="Second feature mode directory to blend",
    )
    return parser.parse_args()


def evaluate(y_true: pd.Series, probabilities: pd.Series) -> dict[str, float]:
    clipped = probabilities.clip(1e-6, 1 - 1e-6)
    predicted = (clipped >= 0.5).astype(int)
    return {
        "accuracy": float(accuracy_score(y_true, predicted)),
        "roc_auc": float(roc_auc_score(y_true, clipped)),
        "log_loss": float(log_loss(y_true, clipped)),
        "brier": float(brier_score_loss(y_true, clipped)),
    }


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    base_dir = root / "model" / "artifacts" / args.matrix

    def resolve_mode_path(mode: str) -> Path:
        if "/" in mode or mode.startswith("."):
            return (root / mode).resolve()
        return (base_dir / mode).resolve()

    def sanitize_label(mode: str) -> str:
        return Path(mode).name.replace("..", "__")

    mode_a_path = resolve_mode_path(args.mode_a)
    mode_b_path = resolve_mode_path(args.mode_b)
    mode_a_label = sanitize_label(args.mode_a)
    mode_b_label = sanitize_label(args.mode_b)

    output_dir = base_dir / f"ensemble_catboost__{mode_a_label}__{mode_b_label}"
    output_dir.mkdir(parents=True, exist_ok=True)

    mode_a_predictions = pd.read_csv(mode_a_path / "fold_predictions.csv")
    mode_b_predictions = pd.read_csv(mode_b_path / "fold_predictions.csv")

    mode_a_catboost = mode_a_predictions[
        mode_a_predictions["model"] == "catboost_tuned"
    ][
        ["fold_name", "split", "match_id", "target_team1_won", "predicted_probability"]
    ].rename(columns={"predicted_probability": "p_mode_a"})
    mode_b_catboost = mode_b_predictions[
        mode_b_predictions["model"] == "catboost_tuned"
    ][["fold_name", "split", "match_id", "predicted_probability"]].rename(
        columns={"predicted_probability": "p_mode_b"}
    )

    merged = mode_a_catboost.merge(
        mode_b_catboost, on=["fold_name", "split", "match_id"], how="inner"
    )

    validation_rows = merged[merged["split"] == "validation"].copy()
    test_rows = merged[merged["split"] == "test"].copy()

    candidate_rows: list[dict[str, Any]] = []
    best_weight = 0.0
    best_validation_logloss = float("inf")

    for weight_a in [i / 20 for i in range(21)]:
        validation_probability = (
            weight_a * validation_rows["p_mode_a"]
            + (1 - weight_a) * validation_rows["p_mode_b"]
        )
        metrics = evaluate(validation_rows["target_team1_won"], validation_probability)
        candidate = {
            f"weight_{mode_a_label}": weight_a,
            f"weight_{mode_b_label}": 1 - weight_a,
            **metrics,
        }
        candidate_rows.append(candidate)

        if metrics["log_loss"] < best_validation_logloss:
            best_validation_logloss = metrics["log_loss"]
            best_weight = weight_a

    selected_validation_probability = (
        best_weight * validation_rows["p_mode_a"]
        + (1 - best_weight) * validation_rows["p_mode_b"]
    )
    selected_test_probability = (
        best_weight * test_rows["p_mode_a"] + (1 - best_weight) * test_rows["p_mode_b"]
    )

    validation_metrics = evaluate(
        validation_rows["target_team1_won"], selected_validation_probability
    )
    test_metrics = evaluate(test_rows["target_team1_won"], selected_test_probability)

    pd.DataFrame(candidate_rows).to_csv(output_dir / "weight_search.csv", index=False)

    blended_predictions = pd.concat(
        [
            validation_rows.assign(
                model="catboost_ensemble",
                selected_weight_primary=best_weight,
                predicted_probability=selected_validation_probability,
            )[
                [
                    "fold_name",
                    "split",
                    "match_id",
                    "target_team1_won",
                    "model",
                    "selected_weight_primary",
                    "predicted_probability",
                ]
            ],
            test_rows.assign(
                model="catboost_ensemble",
                selected_weight_primary=best_weight,
                predicted_probability=selected_test_probability,
            )[
                [
                    "fold_name",
                    "split",
                    "match_id",
                    "target_team1_won",
                    "model",
                    "selected_weight_primary",
                    "predicted_probability",
                ]
            ],
        ],
        ignore_index=True,
    )
    blended_predictions.to_csv(output_dir / "blended_predictions.csv", index=False)

    summary = {
        "matrix": args.matrix,
        "mode_a": args.mode_a,
        "mode_b": args.mode_b,
        "mode_a_path": str(mode_a_path),
        "mode_b_path": str(mode_b_path),
        f"selected_weight_{mode_a_label}": best_weight,
        f"selected_weight_{mode_b_label}": 1 - best_weight,
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
