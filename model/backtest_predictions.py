from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score


@dataclass(frozen=True)
class RootSpec:
    label: str
    path: Path


@dataclass(frozen=True)
class PredictionSource:
    root_label: str
    source_label: str
    file_path: Path
    model_name: str
    frame: pd.DataFrame


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backtest stored model predictions without touching production manifests"
    )
    parser.add_argument(
        "--root",
        action="append",
        required=True,
        help="Prediction root in the form label:path or just path",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where comparison reports should be written",
    )
    parser.add_argument(
        "--focus-split",
        default="test",
        help="Which split to use for leaderboard, season breakdowns, and confidence backtests",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def parse_root_spec(raw_value: str, cwd: Path) -> RootSpec:
    if ":" in raw_value and not raw_value.startswith("/"):
        label, _, path_text = raw_value.partition(":")
    else:
        path_text = raw_value
        label = Path(raw_value).name or "predictions"

    path = Path(path_text)
    resolved = path if path.is_absolute() else (cwd / path).resolve()
    return RootSpec(label=label or resolved.name, path=resolved)


def safe_roc_auc(y_true: pd.Series, y_prob: pd.Series) -> float:
    if y_true.nunique() < 2:
        return float("nan")
    return float(roc_auc_score(y_true, y_prob))


def evaluate_predictions(y_true: pd.Series, y_prob: pd.Series) -> dict[str, float]:
    clipped = y_prob.clip(1e-6, 1 - 1e-6)
    predicted = (clipped >= 0.5).astype(int)
    return {
        "rows": float(len(y_true)),
        "accuracy": float(accuracy_score(y_true, predicted)),
        "roc_auc": safe_roc_auc(y_true, clipped),
        "log_loss": float(log_loss(y_true, clipped)),
        "brier": float(brier_score_loss(y_true, clipped)),
        "positive_rate": float(y_true.mean()),
        "mean_probability": float(clipped.mean()),
    }


def discover_sources(root: RootSpec) -> list[PredictionSource]:
    sources: list[PredictionSource] = []
    for prediction_file in sorted(root.path.rglob("fold_predictions.csv")):
        frame = pd.read_csv(prediction_file)
        if frame.empty or "predicted_probability" not in frame.columns:
            continue

        if "model" not in frame.columns:
            frame = frame.copy()
            frame["model"] = "unknown"

        relative_dir = prediction_file.parent.relative_to(root.path)
        relative_text = "." if str(relative_dir) == "." else relative_dir.as_posix()

        for model_name in sorted(frame["model"].dropna().astype(str).unique()):
            subset = frame[frame["model"].astype(str) == model_name].copy()
            label = f"{root.label}/{relative_text}::{model_name}"
            sources.append(
                PredictionSource(
                    root_label=root.label,
                    source_label=label,
                    file_path=prediction_file,
                    model_name=model_name,
                    frame=subset,
                )
            )

    return sources


def build_confidence_backtest(
    source: PredictionSource, focus_split: str
) -> list[dict[str, object]]:
    frame = source.frame.copy()
    if "split" not in frame.columns:
        return []

    frame = frame[frame["split"] == focus_split].copy()
    if frame.empty:
        return []

    probabilities = frame["predicted_probability"].clip(1e-6, 1 - 1e-6)
    picks = (probabilities >= 0.5).astype(int)
    pick_confidence = probabilities.where(picks == 1, 1 - probabilities)
    frame["pick_confidence"] = pick_confidence
    frame["predicted_team1_won"] = picks
    frame["prediction_correct"] = (
        frame["predicted_team1_won"] == frame["target_team1_won"]
    ).astype(int)

    bins = np.arange(0.5, 1.0001, 0.05)
    frame["confidence_bucket"] = pd.cut(
        frame["pick_confidence"], bins=bins, include_lowest=True, right=False
    )

    rows: list[dict[str, object]] = []
    for bucket, grouped in frame.groupby("confidence_bucket", observed=False):
        if grouped.empty or pd.isna(bucket):
            continue

        rows.append(
            {
                "source_label": source.source_label,
                "split": focus_split,
                "confidence_bucket": str(bucket),
                "rows": int(grouped.shape[0]),
                "accuracy": float(grouped["prediction_correct"].mean()),
                "mean_pick_confidence": float(grouped["pick_confidence"].mean()),
                "team1_pick_rate": float(grouped["predicted_team1_won"].mean()),
            }
        )

    return rows


def build_calibration_bins(
    source: PredictionSource, focus_split: str
) -> list[dict[str, object]]:
    frame = source.frame.copy()
    if "split" not in frame.columns:
        return []

    frame = frame[frame["split"] == focus_split].copy()
    if frame.empty:
        return []

    frame["predicted_probability"] = frame["predicted_probability"].clip(1e-6, 1 - 1e-6)
    bins = np.arange(0.0, 1.0001, 0.1)
    frame["probability_bucket"] = pd.cut(
        frame["predicted_probability"], bins=bins, include_lowest=True, right=False
    )

    rows: list[dict[str, object]] = []
    for bucket, grouped in frame.groupby("probability_bucket", observed=False):
        if grouped.empty or pd.isna(bucket):
            continue

        mean_probability = float(grouped["predicted_probability"].mean())
        observed_rate = float(grouped["target_team1_won"].mean())
        rows.append(
            {
                "source_label": source.source_label,
                "split": focus_split,
                "probability_bucket": str(bucket),
                "rows": int(grouped.shape[0]),
                "mean_predicted_probability": mean_probability,
                "observed_team1_win_rate": observed_rate,
                "calibration_gap": mean_probability - observed_rate,
            }
        )

    return rows


def build_season_metrics(
    source: PredictionSource, focus_split: str
) -> list[dict[str, object]]:
    frame = source.frame.copy()
    if "split" not in frame.columns or "season" not in frame.columns:
        return []

    frame = frame[frame["split"] == focus_split].copy()
    if frame.empty:
        return []

    rows: list[dict[str, object]] = []
    for season, grouped in frame.groupby("season"):
        metrics = evaluate_predictions(
            grouped["target_team1_won"], grouped["predicted_probability"]
        )
        rows.append(
            {
                "source_label": source.source_label,
                "split": focus_split,
                "season": int(season),
                **metrics,
            }
        )
    return rows


def main() -> None:
    args = parse_args()
    cwd = Path.cwd()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    root_specs = [parse_root_spec(raw_value, cwd) for raw_value in args.root]
    discovered_sources: list[PredictionSource] = []
    for root in root_specs:
        discovered_sources.extend(discover_sources(root))

    if not discovered_sources:
        raise ValueError("No fold_predictions.csv sources were found under the requested roots")

    overall_rows: list[dict[str, object]] = []
    season_rows: list[dict[str, object]] = []
    confidence_rows: list[dict[str, object]] = []
    calibration_rows: list[dict[str, object]] = []

    for source in discovered_sources:
        frame = source.frame.copy()
        if "split" not in frame.columns:
            continue

        for split_name, grouped in frame.groupby("split"):
            metrics = evaluate_predictions(
                grouped["target_team1_won"], grouped["predicted_probability"]
            )
            overall_rows.append(
                {
                    "source_label": source.source_label,
                    "root_label": source.root_label,
                    "model": source.model_name,
                    "prediction_file": str(source.file_path),
                    "split": split_name,
                    **metrics,
                }
            )

        season_rows.extend(build_season_metrics(source, args.focus_split))
        confidence_rows.extend(build_confidence_backtest(source, args.focus_split))
        calibration_rows.extend(build_calibration_bins(source, args.focus_split))

    overall_frame = pd.DataFrame(overall_rows)
    season_frame = pd.DataFrame(season_rows)
    confidence_frame = pd.DataFrame(confidence_rows)
    calibration_frame = pd.DataFrame(calibration_rows)

    leaderboard = overall_frame[overall_frame["split"] == args.focus_split].copy()
    leaderboard["roc_auc_rank"] = leaderboard["roc_auc"].fillna(-1.0)
    leaderboard = leaderboard.sort_values(
        ["log_loss", "brier", "roc_auc_rank", "accuracy"],
        ascending=[True, True, False, False],
    ).drop(columns=["roc_auc_rank"])

    overall_frame.to_csv(output_dir / "overall_metrics.csv", index=False)
    season_frame.to_csv(output_dir / "season_metrics.csv", index=False)
    confidence_frame.to_csv(output_dir / "confidence_backtest.csv", index=False)
    calibration_frame.to_csv(output_dir / "calibration_bins.csv", index=False)
    leaderboard.to_csv(output_dir / "leaderboard.csv", index=False)

    metadata = {
        "focusSplit": args.focus_split,
        "roots": [
            {"label": root.label, "path": str(root.path)} for root in root_specs
        ],
        "sources": [source.source_label for source in discovered_sources],
    }
    (output_dir / "report_manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")

    print("Backtest leaderboard")
    print(leaderboard.head(20).to_string(index=False))
    print(f"\nWrote reports to {output_dir}")


if __name__ == "__main__":
    main()
