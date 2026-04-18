from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build leakage-safe stacked ensemble from fold predictions"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        help="Prediction source in the form path:model_name:alias",
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


def resolve_source(root: Path, source: str) -> tuple[Path, str, str]:
    path_text, model_name, alias = source.split(":", 2)
    path = (root / path_text).resolve()
    return path, model_name, alias


def main() -> None:
    args = parse_args()
    root = Path.cwd()
    base_dir = root / "model" / "artifacts" / args.matrix
    output_dir = base_dir / "stacked_ensemble"
    output_dir.mkdir(parents=True, exist_ok=True)

    merged: pd.DataFrame | None = None
    aliases: list[str] = []

    for source in args.source:
        path, model_name, alias = resolve_source(root, source)
        aliases.append(alias)
        frame = pd.read_csv(path / "fold_predictions.csv")
        frame = frame[frame["model"] == model_name][
            [
                "fold_name",
                "split",
                "match_id",
                "target_team1_won",
                "predicted_probability",
            ]
        ].rename(columns={"predicted_probability": alias})

        if merged is None:
            merged = frame
        else:
            merged = merged.merge(
                frame[["fold_name", "split", "match_id", alias]],
                on=["fold_name", "split", "match_id"],
                how="inner",
            )

    assert merged is not None

    fold_rows: list[dict[str, object]] = []
    prediction_rows: list[dict[str, object]] = []

    for fold_name, fold_frame in merged.groupby("fold_name"):
        validation_rows = fold_frame[fold_frame["split"] == "validation"].copy()
        test_rows = fold_frame[fold_frame["split"] == "test"].copy()
        if validation_rows.empty or test_rows.empty:
            continue

        x_validation = validation_rows[aliases]
        y_validation = validation_rows["target_team1_won"]
        x_test = test_rows[aliases]
        y_test = test_rows["target_team1_won"]

        meta_model = LogisticRegression(max_iter=2000, solver="lbfgs")
        meta_model.fit(x_validation, y_validation)

        validation_prob = meta_model.predict_proba(x_validation)[:, 1]
        test_prob = meta_model.predict_proba(x_test)[:, 1]

        for split_name, rows, y_true, probs in [
            ("validation", validation_rows, y_validation, validation_prob),
            ("test", test_rows, y_test, test_prob),
        ]:
            metrics = evaluate(y_true, pd.Series(probs))
            fold_rows.append(
                {
                    "fold_name": fold_name,
                    "split": split_name,
                    **metrics,
                }
            )

            for row, prob in zip(rows.itertuples(index=False), probs, strict=False):
                prediction_rows.append(
                    {
                        "fold_name": fold_name,
                        "split": split_name,
                        "match_id": getattr(row, "match_id"),
                        "target_team1_won": getattr(row, "target_team1_won"),
                        "predicted_probability": float(prob),
                    }
                )

    metrics_frame = pd.DataFrame(fold_rows)
    predictions_frame = pd.DataFrame(prediction_rows)
    metrics_frame.to_csv(output_dir / "fold_metrics.csv", index=False)
    predictions_frame.to_csv(output_dir / "fold_predictions.csv", index=False)

    summary_rows: list[dict[str, object]] = []
    for split_name, grouped in metrics_frame.groupby("split"):
        summary_rows.append(
            {
                "split": split_name,
                "folds": int(grouped.shape[0]),
                "accuracy_mean": float(grouped["accuracy"].mean()),
                "roc_auc_mean": float(grouped["roc_auc"].mean()),
                "log_loss_mean": float(grouped["log_loss"].mean()),
                "brier_mean": float(grouped["brier"].mean()),
            }
        )

    summary = {
        "matrix": args.matrix,
        "sources": args.source,
        "summary": summary_rows,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
