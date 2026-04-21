from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from train_baselines import (
    RANDOM_STATE,
    apply_isotonic_calibrator,
    apply_platt_calibrator,
    build_artifact_dirs,
    build_feature_view,
    build_folds,
    compute_season_sample_weights,
    compute_sha256,
    evaluate_predictions,
    fit_isotonic_calibrator,
    fit_platt_calibrator,
    load_feature_allowlist,
    load_manifest,
    parse_calibration_methods,
    parse_float_list,
    parse_int_list,
    prepare_dataframe,
    resolve_repo_path,
)

try:
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover - runtime dependency check
    XGBClassifier = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train walk-forward XGBoost baselines on IPL model matrices"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument("--min-train-seasons", type=int, default=4)
    parser.add_argument("--artifacts-dir", default="model/artifacts")
    parser.add_argument(
        "--feature-mode",
        choices=["full", "full_no_identity", "delta", "delta_plus_mean"],
        default="full",
    )
    parser.add_argument("--feature-allowlist", default=None)
    parser.add_argument("--run-label", default=None)
    parser.add_argument("--calibration-methods", default="platt,isotonic")
    parser.add_argument("--depth-options", default="4,6")
    parser.add_argument("--learning-rate-options", default="0.03,0.05")
    parser.add_argument("--reg-lambda-options", default="3,8")
    parser.add_argument("--n-estimators", type=int, default=600)
    parser.add_argument("--subsample", type=float, default=0.9)
    parser.add_argument("--colsample-bytree", type=float, default=0.9)
    parser.add_argument(
        "--season-weight-mode",
        choices=["uniform", "exponential_half_life"],
        default="uniform",
        help="Optional training-only season recency weighting mode",
    )
    parser.add_argument(
        "--season-half-life",
        type=float,
        default=2.0,
        help="Half-life in seasons when season-weight-mode=exponential_half_life",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def build_xgboost_preprocessor(
    numeric_columns: list[str], categorical_columns: list[str]
) -> ColumnTransformer:
    numeric_pipeline = Pipeline(
        steps=[("imputer", SimpleImputer(strategy="median"))]
    )
    categorical_pipeline = Pipeline(
        steps=[
            (
                "imputer",
                SimpleImputer(strategy="constant", fill_value="__MISSING__"),
            ),
            (
                "encoder",
                OneHotEncoder(handle_unknown="ignore", sparse_output=True),
            ),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, numeric_columns),
            ("categorical", categorical_pipeline, categorical_columns),
        ]
    )


def build_xgboost_model(
    *,
    max_depth: int,
    learning_rate: float,
    reg_lambda: float,
    n_estimators: int,
    subsample: float,
    colsample_bytree: float,
) -> XGBClassifier:
    assert XGBClassifier is not None
    return XGBClassifier(
        objective="binary:logistic",
        eval_metric="logloss",
        max_depth=max_depth,
        learning_rate=learning_rate,
        reg_lambda=reg_lambda,
        n_estimators=n_estimators,
        subsample=subsample,
        colsample_bytree=colsample_bytree,
        tree_method="hist",
        random_state=RANDOM_STATE,
        n_jobs=0,
        early_stopping_rounds=50,
    )


def tune_xgboost(
    x_train_encoded: Any,
    y_train: pd.Series,
    train_sample_weight: np.ndarray,
    x_calibration_encoded: Any,
    y_calibration: pd.Series,
    depth_options: list[int],
    learning_rate_options: list[float],
    reg_lambda_options: list[float],
    n_estimators: int,
    subsample: float,
    colsample_bytree: float,
) -> tuple[XGBClassifier, dict[str, Any], list[dict[str, Any]]]:
    tuning_rows: list[dict[str, Any]] = []
    best_model: XGBClassifier | None = None
    best_params: dict[str, Any] | None = None
    best_score = float("inf")

    for max_depth in depth_options:
        for learning_rate in learning_rate_options:
            for reg_lambda in reg_lambda_options:
                model = build_xgboost_model(
                    max_depth=max_depth,
                    learning_rate=learning_rate,
                    reg_lambda=reg_lambda,
                    n_estimators=n_estimators,
                    subsample=subsample,
                    colsample_bytree=colsample_bytree,
                )
                model.fit(
                    x_train_encoded,
                    y_train,
                    sample_weight=train_sample_weight,
                    eval_set=[(x_calibration_encoded, y_calibration)],
                    verbose=False,
                )
                calibration_prob = model.predict_proba(x_calibration_encoded)[:, 1]
                calibration_metrics = evaluate_predictions(y_calibration, calibration_prob)
                row = {
                    "max_depth": max_depth,
                    "learning_rate": learning_rate,
                    "reg_lambda": reg_lambda,
                    **calibration_metrics,
                    "best_iteration": int(getattr(model, "best_iteration", model.n_estimators)),
                }
                tuning_rows.append(row)

                if calibration_metrics["log_loss"] < best_score:
                    best_score = calibration_metrics["log_loss"]
                    best_model = model
                    best_params = row.copy()

    assert best_model is not None
    assert best_params is not None
    return best_model, best_params, tuning_rows


def train() -> None:
    if XGBClassifier is None:
        raise ImportError(
            "xgboost is not installed. Install model/requirements-train.txt before running train_xgboost.py"
        )

    args = parse_args()
    calibration_methods = parse_calibration_methods(args.calibration_methods)
    depth_options = parse_int_list(args.depth_options, label="depth options")
    learning_rate_options = parse_float_list(
        args.learning_rate_options, label="learning-rate options"
    )
    reg_lambda_options = parse_float_list(
        args.reg_lambda_options, label="reg-lambda options"
    )

    root_dir = Path.cwd()
    metadata_dir = root_dir / "model" / "data" / "metadata"
    manifest_path = metadata_dir / "model_matrix_manifest.json"
    manifest = load_manifest(manifest_path)
    manifest_key = "preToss" if args.matrix == "pre_toss" else "postToss"
    matrix_manifest = manifest[manifest_key]
    matrix_path = resolve_repo_path(matrix_manifest["matrixPath"], root_dir=root_dir)

    dataframe = pd.read_csv(matrix_path)
    metadata_columns: list[str] = list(matrix_manifest["metadataColumns"])
    target_column: str = matrix_manifest["targetColumn"]
    feature_columns: list[str] = list(matrix_manifest["featureColumns"])
    categorical_columns: list[str] = list(matrix_manifest["categoricalFeatureColumns"])
    available_seasons: list[int] = list(matrix_manifest["availableSeasons"])
    feature_allowlist = load_feature_allowlist(args.feature_allowlist)

    dataframe = prepare_dataframe(
        dataframe, categorical_columns, target_column, metadata_columns
    )
    feature_view = build_feature_view(
        dataframe,
        feature_columns,
        categorical_columns,
        args.feature_mode,
        feature_allowlist,
    )
    dataframe = pd.concat(
        [dataframe[metadata_columns + [target_column]], feature_view.frame], axis=1
    )
    feature_columns = feature_view.feature_columns
    categorical_columns = feature_view.categorical_columns
    numeric_columns = feature_view.numeric_columns
    folds = build_folds(available_seasons, args.min_train_seasons)

    artifacts_dir, models_dir = build_artifact_dirs(
        root_dir / args.artifacts_dir,
        args.matrix,
        args.run_label or f"xgboost_{args.feature_mode}",
    )
    metrics_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    tuning_rows: list[dict[str, Any]] = []

    for fold_index, fold in enumerate(folds, start=1):
        train_seasons_for_model = fold.train_seasons[:-1]
        calibration_season = fold.train_seasons[-1]

        train_frame = dataframe[dataframe["season"].isin(train_seasons_for_model)].copy()
        calibration_frame = dataframe[dataframe["season"] == calibration_season].copy()
        validation_frame = dataframe[dataframe["season"] == fold.validation_season].copy()
        test_frame = dataframe[dataframe["season"] == fold.test_season].copy()

        x_train = train_frame[feature_columns]
        y_train = train_frame[target_column]
        train_sample_weight = compute_season_sample_weights(
            train_frame["season"],
            mode=args.season_weight_mode,
            half_life=args.season_half_life,
        )
        x_calibration = calibration_frame[feature_columns]
        y_calibration = calibration_frame[target_column]
        x_validation = validation_frame[feature_columns]
        y_validation = validation_frame[target_column]
        x_test = test_frame[feature_columns]
        y_test = test_frame[target_column]

        preprocessor = build_xgboost_preprocessor(numeric_columns, categorical_columns)
        x_train_encoded = preprocessor.fit_transform(x_train)
        x_calibration_encoded = preprocessor.transform(x_calibration)
        x_validation_encoded = preprocessor.transform(x_validation)
        x_test_encoded = preprocessor.transform(x_test)

        xgboost_model, best_params, fold_tuning_rows = tune_xgboost(
            x_train_encoded,
            y_train,
            train_sample_weight,
            x_calibration_encoded,
            y_calibration,
            depth_options,
            learning_rate_options,
            reg_lambda_options,
            args.n_estimators,
            args.subsample,
            args.colsample_bytree,
        )
        calibration_prob = xgboost_model.predict_proba(x_calibration_encoded)[:, 1]
        validation_prob = xgboost_model.predict_proba(x_validation_encoded)[:, 1]
        test_prob = xgboost_model.predict_proba(x_test_encoded)[:, 1]
        calibrated_outputs: list[tuple[str, np.ndarray, np.ndarray]] = [
            ("xgboost_tuned", validation_prob, test_prob)
        ]

        xgboost_model.get_booster().save_model(
            models_dir / f"{fold.fold_name}__xgboost_tuned.json"
        )
        joblib.dump(
            preprocessor,
            models_dir / f"{fold.fold_name}__xgboost_preprocessor.joblib",
        )

        if "platt" in calibration_methods:
            platt_calibrator = fit_platt_calibrator(calibration_prob, y_calibration)
            joblib.dump(
                platt_calibrator,
                models_dir / f"{fold.fold_name}__xgboost_platt.joblib",
            )
            calibrated_outputs.append(
                (
                    "xgboost_tuned_platt",
                    apply_platt_calibrator(platt_calibrator, validation_prob),
                    apply_platt_calibrator(platt_calibrator, test_prob),
                )
            )

        if "isotonic" in calibration_methods:
            isotonic_calibrator = fit_isotonic_calibrator(calibration_prob, y_calibration)
            joblib.dump(
                isotonic_calibrator,
                models_dir / f"{fold.fold_name}__xgboost_isotonic.joblib",
            )
            calibrated_outputs.append(
                (
                    "xgboost_tuned_isotonic",
                    apply_isotonic_calibrator(isotonic_calibrator, validation_prob),
                    apply_isotonic_calibrator(isotonic_calibrator, test_prob),
                )
            )

        for tuning_row in fold_tuning_rows:
            tuning_rows.append(
                {
                    "fold_name": fold.fold_name,
                    "fold_index": fold_index,
                    "train_seasons": ",".join(map(str, train_seasons_for_model)),
                    "calibration_season": calibration_season,
                    **tuning_row,
                }
            )

        calibration_metrics = evaluate_predictions(y_calibration, calibration_prob)
        metrics_rows.append(
            {
                "fold_name": fold.fold_name,
                "fold_index": fold_index,
                "model": "xgboost_tuned",
                "split": "calibration",
                "train_seasons": ",".join(map(str, train_seasons_for_model)),
                "calibration_season": calibration_season,
                "validation_season": fold.validation_season,
                "test_season": fold.test_season,
                "rows": len(calibration_frame),
                **calibration_metrics,
            }
        )

        for model_name, validation_probs, test_probs in calibrated_outputs:
            for split_name, split_frame, y_true, probabilities in [
                ("validation", validation_frame, y_validation, validation_probs),
                ("test", test_frame, y_test, test_probs),
            ]:
                metrics = evaluate_predictions(y_true, probabilities)
                metrics_rows.append(
                    {
                        "fold_name": fold.fold_name,
                        "fold_index": fold_index,
                        "model": model_name,
                        "split": split_name,
                        "train_seasons": ",".join(map(str, train_seasons_for_model)),
                        "calibration_season": calibration_season,
                        "validation_season": fold.validation_season,
                        "test_season": fold.test_season,
                        "rows": len(split_frame),
                        **metrics,
                    }
                )

                for row, probability in zip(
                    split_frame.itertuples(index=False), probabilities, strict=False
                ):
                    prediction_rows.append(
                        {
                            "fold_name": fold.fold_name,
                            "fold_index": fold_index,
                            "model": model_name,
                            "split": split_name,
                            "match_id": getattr(row, "match_id"),
                            "season": getattr(row, "season"),
                            "match_date": getattr(row, "match_date"),
                            "target_team1_won": getattr(row, target_column),
                            "predicted_probability": float(probability),
                        }
                    )

    metrics_frame = pd.DataFrame(metrics_rows)
    predictions_frame = pd.DataFrame(prediction_rows)
    tuning_frame = pd.DataFrame(tuning_rows)

    metrics_frame.to_csv(artifacts_dir / "fold_metrics.csv", index=False)
    predictions_frame.to_csv(artifacts_dir / "fold_predictions.csv", index=False)
    tuning_frame.to_csv(artifacts_dir / "xgboost_tuning.csv", index=False)

    summary_rows: list[dict[str, Any]] = []
    for (model_name, split_name), grouped in metrics_frame.groupby(["model", "split"]):
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
            }
        )

    summary_frame = pd.DataFrame(summary_rows)
    summary_frame.to_csv(artifacts_dir / "summary_metrics.csv", index=False)

    manifest_output = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "matrix": args.matrix,
        "featureMode": args.feature_mode,
        "runLabel": args.run_label or f"xgboost_{args.feature_mode}",
        "featureAllowlist": feature_allowlist,
        "matrixPath": str(matrix_path),
        "matrixSha256": compute_sha256(matrix_path),
        "modelMatrixManifestSha256": compute_sha256(manifest_path),
        "minTrainSeasons": args.min_train_seasons,
        "calibrationMethods": calibration_methods,
        "seasonWeighting": {
            "mode": args.season_weight_mode,
            "halfLife": args.season_half_life,
        },
        "xgboostSearch": {
            "depthOptions": depth_options,
            "learningRateOptions": learning_rate_options,
            "regLambdaOptions": reg_lambda_options,
            "nEstimators": args.n_estimators,
            "subsample": args.subsample,
            "colsampleBytree": args.colsample_bytree,
        },
        "availableSeasons": available_seasons,
        "categoricalColumns": categorical_columns,
        "numericColumns": numeric_columns,
        "featureColumns": feature_columns,
    }
    (artifacts_dir / "training_manifest.json").write_text(
        json.dumps(manifest_output, indent=2) + "\n"
    )

    print(f"XGBoost training pipeline complete for {args.matrix} matrix")
    print(summary_frame.to_string(index=False))


if __name__ == "__main__":
    train()
