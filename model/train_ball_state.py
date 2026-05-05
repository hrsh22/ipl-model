#!/usr/bin/env python3
"""Train experimental ball-state expected runs/wickets models.

Artifacts are written under model/artifacts/ball_state and are not promoted to
model/final_models. This is a first verification model for replacing the live
venue-rate heuristic with a learned expected-state baseline.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from catboost import CatBoostClassifier, CatBoostRegressor, Pool
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)

from build_ball_state_matrix import EVENT_TRAJECTORY_COLUMNS, SELECTED_TRAJECTORY_FEATURES


ROOT = Path(__file__).resolve().parent
DEFAULT_EXPERIMENT_DIR = ROOT / "experiments" / "ball-state"
DEFAULT_MATRIX = DEFAULT_EXPERIMENT_DIR / "ball_state_expected_matrix.csv"
DEFAULT_OUTPUT = DEFAULT_EXPERIMENT_DIR / "artifacts"

LIVE_UNAVAILABLE_FEATURES = {
    "toss_winner",
    "toss_decision",
    "batting_team_won_toss",
}


TARGETS = [
    "expected_runs_now",
    "expected_wickets_now",
    "final_innings_runs",
    "final_innings_wickets",
    "remaining_innings_runs",
    "remaining_innings_wickets",
]
CLASSIFICATION_TARGETS = ["batting_team_match_win", "chase_success"]
CLASSIFICATION_TARGET_INNINGS = {
    "batting_team_match_win": 1,
}
DROP_COLUMNS = {
    "match_id",
    "date",
    "expected_runs_now",
    "expected_wickets_now",
    "remaining_innings_runs",
    "remaining_innings_wickets",
    "batting_team_match_win",
    "chase_success",
    *TARGETS,
}

EXPECTED_NOW_UNAVAILABLE_FEATURES = {
    "current_runs",
    "current_wickets",
    "current_run_rate",
    "wickets_in_hand",
    "run_rate_required_delta",
    "required_run_rate",
    "runs_to_target",
    *EVENT_TRAJECTORY_COLUMNS,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument(
        "--split",
        choices=["walk_forward", "chronological", "random"],
        default="walk_forward",
        help="walk_forward reports season folds; chronological holds out latest matches once",
    )
    parser.add_argument("--iterations", type=int, default=120)
    parser.add_argument("--learning-rate", type=float, default=0.045)
    parser.add_argument("--depth", type=int, default=6)
    parser.add_argument("--l2-leaf-reg", type=float, default=5)
    parser.add_argument("--random-seed", type=int, default=42)
    parser.add_argument(
        "--target",
        action="append",
        choices=[*TARGETS, *CLASSIFICATION_TARGETS],
        default=[],
        help="Optional target to train/evaluate. Repeat to train multiple targets; default trains all.",
    )
    parser.add_argument("--fold-start-season", type=int, default=2023)
    parser.add_argument(
        "--feature-mode",
        choices=["full", "live_compatible", "live_compatible_trajectory", "live_compatible_selected_trajectory", "live_expected_now"],
        default="full",
        help="live_compatible excludes toss and event trajectory fields; live_expected_now also excludes observed score/wicket outcome fields",
    )
    parser.add_argument(
        "--calibration",
        choices=["none", "platt", "isotonic"],
        default="none",
        help="Optional chronological calibration layer for classification targets",
    )
    parser.add_argument("--calibration-size", type=float, default=0.2)
    return parser.parse_args()


def catboost_params(args: argparse.Namespace) -> dict[str, float | int]:
    return {
        "iterations": args.iterations,
        "learning_rate": args.learning_rate,
        "depth": args.depth,
        "l2_leaf_reg": args.l2_leaf_reg,
        "random_seed": args.random_seed,
    }


def feature_columns(data: pd.DataFrame, feature_mode: str) -> list[str]:
    excluded = set(DROP_COLUMNS)
    if feature_mode in {"live_compatible", "live_compatible_trajectory", "live_compatible_selected_trajectory"}:
        excluded.update(LIVE_UNAVAILABLE_FEATURES)
    if feature_mode == "live_expected_now":
        excluded.update(LIVE_UNAVAILABLE_FEATURES)
        excluded.update(EXPECTED_NOW_UNAVAILABLE_FEATURES)
    if feature_mode == "live_compatible":
        excluded.update(EVENT_TRAJECTORY_COLUMNS)
    if feature_mode == "live_compatible_selected_trajectory":
        excluded.update(set(EVENT_TRAJECTORY_COLUMNS).difference(SELECTED_TRAJECTORY_FEATURES))
    return [column for column in data.columns if column not in excluded]


def categorical_features(data: pd.DataFrame, features: list[str]) -> list[str]:
    return [column for column in features if data[column].dtype == "object"]


def prepare_features(data: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    prepared = data[features].copy()
    for column in features:
        if prepared[column].dtype == "object":
            prepared[column] = prepared[column].fillna("__missing__").astype(str)
    return prepared


def train_regressor(
    train: pd.DataFrame,
    features: list[str],
    target: str,
    params: dict[str, float | int],
) -> CatBoostRegressor:
    model = CatBoostRegressor(
        loss_function="RMSE",
        eval_metric="MAE",
        iterations=int(params["iterations"]),
        learning_rate=float(params["learning_rate"]),
        depth=int(params["depth"]),
        l2_leaf_reg=float(params["l2_leaf_reg"]),
        random_seed=int(params["random_seed"]),
        thread_count=-1,
        verbose=False,
        allow_writing_files=False,
    )
    model.fit(
        Pool(
            prepare_features(train, features),
            train[target],
            cat_features=categorical_features(train, features),
        ),
    )
    return model


def train_classifier(
    train: pd.DataFrame,
    features: list[str],
    target: str,
    params: dict[str, float | int],
) -> CatBoostClassifier:
    model = CatBoostClassifier(
        loss_function="Logloss",
        eval_metric="AUC",
        iterations=int(params["iterations"]),
        learning_rate=float(params["learning_rate"]),
        depth=int(params["depth"]),
        l2_leaf_reg=float(params["l2_leaf_reg"]),
        random_seed=int(params["random_seed"]),
        thread_count=-1,
        verbose=False,
        allow_writing_files=False,
    )
    model.fit(
        Pool(
            prepare_features(train, features),
            train[target].astype(int),
            cat_features=categorical_features(train, features),
        ),
    )
    return model


def regression_metrics(y_true: pd.Series, y_pred: pd.Series) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(mean_squared_error(y_true, y_pred) ** 0.5),
        "r2": float(r2_score(y_true, y_pred)),
    }


def calibration_bins(y_true: pd.Series, probabilities: pd.Series, bins: int = 10) -> list[dict[str, float | int]]:
    frame = pd.DataFrame({"actual": y_true.astype(int), "probability": probabilities.clip(0, 1)})
    frame["bin"] = pd.cut(
        frame["probability"],
        bins=[index / bins for index in range(bins + 1)],
        include_lowest=True,
        labels=False,
    )
    output = []

    for bin_index, group in frame.groupby("bin", observed=True):
        if group.empty:
            continue
        output.append({
            "bin": int(bin_index),
            "count": int(len(group)),
            "mean_probability": float(group["probability"].mean()),
            "actual_rate": float(group["actual"].mean()),
            "absolute_error": float(abs(group["probability"].mean() - group["actual"].mean())),
        })

    return output


def expected_calibration_error(bins: list[dict[str, float | int]]) -> float:
    total = sum(int(entry["count"]) for entry in bins)
    if total == 0:
        return 0.0
    return sum((int(entry["count"]) / total) * float(entry["absolute_error"]) for entry in bins)


def classification_metrics(y_true: pd.Series, probabilities: pd.Series) -> dict[str, float]:
    labels = (probabilities >= 0.5).astype(int)
    bins = calibration_bins(y_true, probabilities)
    metrics = {
        "log_loss": float(log_loss(y_true, probabilities, labels=[0, 1])),
        "brier": float(brier_score_loss(y_true, probabilities)),
        "accuracy": float(accuracy_score(y_true, labels)),
        "ece": expected_calibration_error(bins),
    }

    if y_true.nunique() == 2:
        metrics["roc_auc"] = float(roc_auc_score(y_true, probabilities))

    return metrics


def probability_logit(probabilities: pd.Series) -> np.ndarray:
    clipped = probabilities.clip(1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped)).to_numpy().reshape(-1, 1)


def chronological_match_split(data: pd.DataFrame, holdout_fraction: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    matches = data[["match_id", "date"]].drop_duplicates("match_id").copy()
    matches["date"] = pd.to_datetime(matches["date"], errors="coerce")
    matches = matches.sort_values(["date", "match_id"])
    cutoff = max(1, min(len(matches) - 1, int(len(matches) * (1 - holdout_fraction))))
    train_ids = set(matches.iloc[:cutoff]["match_id"])
    holdout_ids = set(matches.iloc[cutoff:]["match_id"])
    return data[data["match_id"].isin(train_ids)].copy(), data[data["match_id"].isin(holdout_ids)].copy()


def can_fit_calibrator(train: pd.DataFrame, calibration: pd.DataFrame, target: str) -> bool:
    return (
        train["match_id"].nunique() >= 5
        and calibration["match_id"].nunique() >= 2
        and train[target].nunique() == 2
        and calibration[target].nunique() == 2
    )


def fit_calibrator(probabilities: pd.Series, y_true: pd.Series, method: str) -> object | None:
    if method == "none":
        return None
    if method == "platt":
        calibrator = LogisticRegression(random_state=42, solver="lbfgs")
        calibrator.fit(probability_logit(probabilities), y_true.astype(int))
        return calibrator
    if method == "isotonic":
        calibrator = IsotonicRegression(out_of_bounds="clip")
        calibrator.fit(probabilities.clip(0, 1), y_true.astype(int))
        return calibrator
    raise ValueError(f"Unsupported calibration method: {method}")


def apply_calibrator(probabilities: pd.Series, calibrator: object | None, method: str) -> pd.Series:
    if calibrator is None or method == "none":
        return probabilities.clip(0, 1)
    if method == "platt":
        calibrated = calibrator.predict_proba(probability_logit(probabilities))[:, 1]
        return pd.Series(calibrated, index=probabilities.index).clip(0, 1)
    if method == "isotonic":
        calibrated = calibrator.predict(probabilities.clip(0, 1))
        return pd.Series(calibrated, index=probabilities.index).clip(0, 1)
    raise ValueError(f"Unsupported calibration method: {method}")


def split_data(data: pd.DataFrame, test_size: float, split: str) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    data = data.copy()
    data["date"] = pd.to_datetime(data["date"], errors="coerce")
    matches = data[["match_id", "date", "season"]].drop_duplicates("match_id").sort_values(
        ["date", "match_id"],
    )

    if split == "random":
        matches = matches.sample(frac=1, random_state=42)

    if split == "walk_forward":
        split = "chronological"

    cutoff = max(1, min(len(matches) - 1, int(len(matches) * (1 - test_size))))
    train_ids = set(matches.iloc[:cutoff]["match_id"])
    test_ids = set(matches.iloc[cutoff:]["match_id"])
    train = data[data["match_id"].isin(train_ids)].copy()
    test = data[data["match_id"].isin(test_ids)].copy()
    details = {
        "split": split,
        "test_size": test_size,
        "train_matches": int(len(train_ids)),
        "test_matches": int(len(test_ids)),
        "train_date_max": matches.iloc[:cutoff]["date"].max().date().isoformat(),
        "test_date_min": matches.iloc[cutoff:]["date"].min().date().isoformat(),
        "test_seasons": sorted(int(season) for season in test["season"].dropna().unique()),
    }
    return train, test, details


def walk_forward_folds(data: pd.DataFrame, min_train_season: int = 2022) -> list[tuple[int, pd.DataFrame, pd.DataFrame]]:
    seasons = sorted(int(season) for season in data["season"].dropna().unique())
    folds = []

    for season in seasons:
        if season < min_train_season:
            continue

        train = data[data["season"] < season].copy()
        test = data[data["season"] == season].copy()
        if train["match_id"].nunique() == 0 or test["match_id"].nunique() == 0:
            continue
        folds.append((season, train, test))

    return folds


def build_regression_baseline(train: pd.DataFrame, test: pd.DataFrame, target: str) -> pd.Series:
    if target in {"expected_runs_now", "expected_wickets_now"}:
        grouped = train.groupby(["innings", "legal_balls_bowled"])[target].mean()
        fallback = float(train[target].mean())
        return test.apply(
            lambda row: grouped.get((row["innings"], row["legal_balls_bowled"]), fallback),
            axis=1,
        )

    if target == "final_innings_runs":
        remaining = (train[target] - train["current_runs"]) / train["balls_remaining"].where(
            train["balls_remaining"] > 0,
        )
        rate = float(remaining.dropna().clip(lower=0).mean())
        return test["current_runs"] + test["balls_remaining"] * rate

    if target == "final_innings_wickets":
        remaining = (train[target] - train["current_wickets"]) / train["balls_remaining"].where(
            train["balls_remaining"] > 0,
        )
        rate = float(remaining.dropna().clip(lower=0).mean())
        return (test["current_wickets"] + test["balls_remaining"] * rate).clip(lower=0, upper=10)

    if target == "remaining_innings_runs":
        rate = float((train[target] / train["balls_remaining"].where(train["balls_remaining"] > 0)).dropna().clip(lower=0).mean())
        return test["balls_remaining"] * rate

    if target == "remaining_innings_wickets":
        rate = float((train[target] / train["balls_remaining"].where(train["balls_remaining"] > 0)).dropna().clip(lower=0).mean())
        return (test["balls_remaining"] * rate).clip(lower=0, upper=10)

    raise ValueError(f"No baseline configured for {target}")


def phase_metrics(test: pd.DataFrame, target: str, predictions: pd.Series) -> dict[str, dict[str, float]]:
    phases = {
        "powerplay": test["legal_balls_bowled"] <= 36,
        "middle": (test["legal_balls_bowled"] > 36) & (test["legal_balls_bowled"] <= 90),
        "death": test["legal_balls_bowled"] > 90,
    }
    output: dict[str, dict[str, float]] = {}

    for name, mask in phases.items():
        if int(mask.sum()) == 0:
            continue
        output[name] = regression_metrics(test.loc[mask, target], predictions[mask])

    return output


def weighted_average_metric(fold_metrics: list[dict[str, object]], metric_name: str) -> float | None:
    weighted_sum = 0.0
    total_rows = 0
    for fold in fold_metrics:
        rows = int(fold["test_rows"])
        metrics = fold["metrics"]
        if not isinstance(metrics, dict) or metric_name not in metrics:
            continue
        weighted_sum += float(metrics[metric_name]) * rows
        total_rows += rows

    return weighted_sum / total_rows if total_rows else None


def evaluate_regression_target(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    target: str,
    params: dict[str, float | int],
) -> tuple[CatBoostRegressor, pd.Series, dict[str, float], dict[str, float]]:
    model = train_regressor(train, features, target, params)
    predictions = pd.Series(model.predict(prepare_features(test, features)), index=test.index)
    target_metrics = regression_metrics(test[target], predictions)
    baseline = build_regression_baseline(train, test, target)
    baseline_metrics = regression_metrics(test[target], baseline)
    return model, predictions, target_metrics, baseline_metrics


def evaluate_classification_target(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    target: str,
    params: dict[str, float | int],
    calibration: str,
    calibration_size: float,
) -> tuple[CatBoostClassifier, object | None, pd.Series, dict[str, float], dict[str, float], list[dict[str, float | int]], dict[str, object]]:
    train_target = train.dropna(subset=[target]).copy()
    test_target = test.dropna(subset=[target]).copy()
    target_innings = CLASSIFICATION_TARGET_INNINGS.get(target)
    if target_innings is not None:
        train_target = train_target[train_target["innings"] == target_innings].copy()
        test_target = test_target[test_target["innings"] == target_innings].copy()
    train_target[target] = train_target[target].astype(int)
    test_target[target] = test_target[target].astype(int)

    classifier_train = train_target
    calibration_target = pd.DataFrame()
    calibrator = None
    calibration_details: dict[str, object] = {
        "method": calibration,
        "requested_holdout_fraction": calibration_size,
        "applied": False,
    }

    if calibration != "none":
        candidate_train, candidate_calibration = chronological_match_split(train_target, calibration_size)
        if can_fit_calibrator(candidate_train, candidate_calibration, target):
            classifier_train = candidate_train
            calibration_target = candidate_calibration
        else:
            calibration_details["skip_reason"] = "insufficient chronological calibration data or class diversity"

    model = train_classifier(classifier_train, features, target, params)
    raw_probabilities = pd.Series(
        model.predict_proba(prepare_features(test_target, features))[:, 1],
        index=test_target.index,
    )

    if calibration != "none" and not calibration_target.empty:
        calibration_probabilities = pd.Series(
            model.predict_proba(prepare_features(calibration_target, features))[:, 1],
            index=calibration_target.index,
        )
        calibrator = fit_calibrator(calibration_probabilities, calibration_target[target], calibration)
        calibration_details.update({
            "applied": calibrator is not None,
            "classifier_train_matches": int(classifier_train["match_id"].nunique()),
            "calibration_matches": int(calibration_target["match_id"].nunique()),
            "calibration_rows": int(len(calibration_target)),
        })

    probabilities = apply_calibrator(raw_probabilities, calibrator, calibration)
    target_metrics = classification_metrics(test_target[target], probabilities)
    target_bins = calibration_bins(test_target[target], probabilities)
    baseline_rate = float(train_target[target].mean())
    baseline_probabilities = pd.Series(baseline_rate, index=test_target.index)
    baseline_metrics = classification_metrics(test_target[target], baseline_probabilities)
    return model, calibrator, probabilities, target_metrics, baseline_metrics, target_bins, calibration_details


def train_final_classifier_payload(
    data: pd.DataFrame,
    features: list[str],
    target: str,
    params: dict[str, float | int],
    calibration: str,
    calibration_size: float,
) -> tuple[dict[str, object], dict[str, object]]:
    final_train = data.dropna(subset=[target]).copy()
    target_innings = CLASSIFICATION_TARGET_INNINGS.get(target)
    if target_innings is not None:
        final_train = final_train[final_train["innings"] == target_innings].copy()
    final_train[target] = final_train[target].astype(int)
    classifier_train = final_train
    calibration_target = pd.DataFrame()
    details: dict[str, object] = {
        "method": calibration,
        "requested_holdout_fraction": calibration_size,
        "applied": False,
    }

    if calibration != "none":
        candidate_train, candidate_calibration = chronological_match_split(final_train, calibration_size)
        if can_fit_calibrator(candidate_train, candidate_calibration, target):
            classifier_train = candidate_train
            calibration_target = candidate_calibration
        else:
            details["skip_reason"] = "insufficient chronological calibration data or class diversity"

    model = train_classifier(classifier_train, features, target, params)
    calibrator = None
    if calibration != "none" and not calibration_target.empty:
        calibration_probabilities = pd.Series(
            model.predict_proba(prepare_features(calibration_target, features))[:, 1],
            index=calibration_target.index,
        )
        calibrator = fit_calibrator(calibration_probabilities, calibration_target[target], calibration)
        details.update({
            "applied": calibrator is not None,
            "classifier_train_matches": int(classifier_train["match_id"].nunique()),
            "calibration_matches": int(calibration_target["match_id"].nunique()),
            "calibration_rows": int(len(calibration_target)),
        })

    payload = {
        "model": model,
        "calibrator": calibrator,
        "calibration_method": calibration,
        "features": features,
        "target": target,
    }
    return payload, details


def main() -> None:
    args = parse_args()
    data = pd.read_csv(args.matrix, low_memory=False)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    features = feature_columns(data, args.feature_mode)
    params = catboost_params(args)
    requested_targets = set(args.target) if args.target else {*TARGETS, *CLASSIFICATION_TARGETS}

    if args.split == "walk_forward":
        folds = walk_forward_folds(data, args.fold_start_season)
        split_details: dict[str, object] = {
            "split": "walk_forward",
            "fold_start_season": args.fold_start_season,
            "folds": [
                {
                    "season": season,
                    "train_matches": int(train["match_id"].nunique()),
                    "test_matches": int(test["match_id"].nunique()),
                    "train_rows": int(len(train)),
                    "test_rows": int(len(test)),
                }
                for season, train, test in folds
            ],
        }
    else:
        train, test, single_split_details = split_data(data, args.test_size, args.split)
        folds = [(int(single_split_details["test_seasons"][0]), train, test)]
        split_details = single_split_details

    manifest = {
        "name": "ball_state_expected_models",
        "status": "experimental",
        "matrix": str(args.matrix),
        "split": split_details,
        "row_count": int(len(data)),
        "catboost_params": params,
        "classification_calibration": {
            "method": args.calibration,
            "holdout_fraction": args.calibration_size,
            "split": "chronological_by_match_within_training_fold",
        },
        "feature_mode": args.feature_mode,
        "feature_count": len(features),
        "feature_columns": features,
        "excluded_features": sorted(set(data.columns).difference(features).difference(DROP_COLUMNS)),
        "model_family": "catboost",
        "targets": {},
        "classification_targets": {},
        "notes": [
            "Walk-forward season folds avoid same-match row leakage.",
            "Models are not wired into live observer inference yet.",
            "live_compatible mode removes toss and event trajectory fields for the stable score/prior contract.",
            "live_compatible_trajectory mode keeps snapshot-derivable event trajectory fields for explicit A/B evaluation.",
            "live_expected_now mode excludes observed score/wicket outcome fields so expected-now targets learn par state instead of copying the live score.",
            "Classification calibration, when enabled, uses only a chronological holdout from the training side of each fold.",
        ],
    }

    for target in TARGETS:
        if target not in requested_targets:
            continue
        fold_results = []
        for season, train, test in folds:
            _model, predictions, target_metrics, baseline_metrics = evaluate_regression_target(
                train,
                test,
                features,
                target,
                params,
            )
            fold_results.append({
                "season": int(season),
                "train_rows": int(len(train)),
                "test_rows": int(len(test)),
                "metrics": target_metrics,
                "baseline_metrics": baseline_metrics,
                "phase_metrics": phase_metrics(test, target, predictions),
            })

        final_model = train_regressor(data, features, target, params)
        artifact_path = args.output_dir / f"{target}_model.joblib"
        joblib.dump(final_model, artifact_path)
        manifest["targets"][target] = {
            "artifact": str(artifact_path),
            "folds": fold_results,
            "weighted_metrics": {
                metric: weighted_average_metric(fold_results, metric)
                for metric in ["mae", "rmse", "r2"]
            },
            "weighted_baseline_metrics": {
                metric: weighted_average_metric(
                    [{**fold, "metrics": fold["baseline_metrics"]} for fold in fold_results],
                    metric,
                )
                for metric in ["mae", "rmse", "r2"]
            },
        }
        print(f"{target}: {manifest['targets'][target]['weighted_metrics']} baseline={manifest['targets'][target]['weighted_baseline_metrics']}")

    for target in CLASSIFICATION_TARGETS:
        if target not in requested_targets:
            continue
        fold_results = []
        for season, train, test in folds:
            _model, _calibrator, _probabilities, target_metrics, baseline_metrics, target_bins, calibration_details = evaluate_classification_target(
                train,
                test,
                features,
                target,
                params,
                args.calibration,
                args.calibration_size,
            )
            test_target = test.dropna(subset=[target]).copy()
            fold_results.append({
                "season": int(season),
                "train_rows": int(len(train.dropna(subset=[target]))),
                "test_rows": int(len(test_target)),
                "metrics": target_metrics,
                "baseline_metrics": baseline_metrics,
                "calibration_bins": target_bins,
                "calibration": calibration_details,
                "positive_rate_test": float(test_target[target].mean()),
            })

        final_payload, final_calibration_details = train_final_classifier_payload(
            data,
            features,
            target,
            params,
            args.calibration,
            args.calibration_size,
        )
        artifact_path = args.output_dir / f"{target}_model.joblib"
        joblib.dump(final_payload, artifact_path)
        manifest["classification_targets"][target] = {
            "artifact": str(artifact_path),
            "artifact_contains": "model_calibrator_payload",
            "final_calibration": final_calibration_details,
            "folds": fold_results,
            "weighted_metrics": {
                metric: weighted_average_metric(fold_results, metric)
                for metric in ["log_loss", "brier", "accuracy", "roc_auc", "ece"]
            },
            "weighted_baseline_metrics": {
                metric: weighted_average_metric(
                    [{**fold, "metrics": fold["baseline_metrics"]} for fold in fold_results],
                    metric,
                )
                for metric in ["log_loss", "brier", "accuracy", "roc_auc", "ece"]
            },
        }
        print(f"{target}: {manifest['classification_targets'][target]['weighted_metrics']} baseline={manifest['classification_targets'][target]['weighted_baseline_metrics']}")

    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote manifest to {manifest_path}")


if __name__ == "__main__":
    main()
