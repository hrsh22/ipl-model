from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from hashlib import sha256
from itertools import product
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RANDOM_STATE = 42


@dataclass(frozen=True)
class FoldDefinition:
    fold_name: str
    train_seasons: list[int]
    validation_season: int
    test_season: int


@dataclass(frozen=True)
class FeatureView:
    frame: pd.DataFrame
    feature_columns: list[str]
    categorical_columns: list[str]
    numeric_columns: list[str]


def compute_sha256(file_path: Path) -> str:
    return sha256(file_path.read_bytes()).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train walk-forward IPL baseline models"
    )
    parser.add_argument(
        "--matrix",
        choices=["pre_toss", "post_toss"],
        default="pre_toss",
        help="Which frozen model matrix to train on",
    )
    parser.add_argument(
        "--min-train-seasons",
        type=int,
        default=4,
        help="Minimum number of kept seasons in the first training fold",
    )
    parser.add_argument(
        "--artifacts-dir",
        default="model/artifacts",
        help="Base directory for training artifacts",
    )
    parser.add_argument(
        "--feature-mode",
        choices=["full", "full_no_identity", "delta", "delta_plus_mean"],
        default="full",
        help="Feature view used for modeling",
    )
    parser.add_argument(
        "--feature-allowlist",
        default=None,
        help="Optional text file containing one allowed feature column per line",
    )
    return parser.parse_args()


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    return json.loads(manifest_path.read_text())


def load_feature_allowlist(file_path: str | None) -> list[str] | None:
    if not file_path:
        return None

    path = Path(file_path)
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def normalize_boolean_string(series: pd.Series) -> pd.Series:
    lowered = series.astype(str).str.lower()
    return lowered.map({"true": 1, "false": 0})


def prepare_dataframe(
    frame: pd.DataFrame,
    categorical_columns: list[str],
    target_column: str,
    metadata_columns: list[str],
) -> pd.DataFrame:
    prepared = frame.copy()

    for column in prepared.columns:
        if column in metadata_columns:
            continue

        if column == target_column:
            prepared[column] = (
                normalize_boolean_string(prepared[column])
                .fillna(prepared[column])
                .astype(int)
            )
            continue

        if column in categorical_columns:
            prepared[column] = prepared[column].fillna("__MISSING__").astype(str)
            continue

        boolean_like = normalize_boolean_string(prepared[column])
        if boolean_like.notna().all():
            prepared[column] = boolean_like.astype(int)
        else:
            prepared[column] = pd.to_numeric(prepared[column], errors="coerce")

    return prepared


def build_folds(
    available_seasons: list[int], min_train_seasons: int
) -> list[FoldDefinition]:
    if len(available_seasons) < min_train_seasons + 2:
        raise ValueError(
            "Not enough kept seasons for train/validation/test walk-forward splits"
        )

    folds: list[FoldDefinition] = []
    for validation_index in range(min_train_seasons, len(available_seasons) - 1):
        folds.append(
            FoldDefinition(
                fold_name=f"train_to_{available_seasons[validation_index - 1]}__val_{available_seasons[validation_index]}__test_{available_seasons[validation_index + 1]}",
                train_seasons=available_seasons[:validation_index],
                validation_season=available_seasons[validation_index],
                test_season=available_seasons[validation_index + 1],
            )
        )

    return folds


def build_logistic_pipeline(
    numeric_columns: list[str], categorical_columns: list[str]
) -> Pipeline:
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipeline = Pipeline(
        steps=[
            (
                "imputer",
                SimpleImputer(strategy="constant", fill_value="__MISSING__"),
            ),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, numeric_columns),
            ("categorical", categorical_pipeline, categorical_columns),
        ]
    )

    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "classifier",
                LogisticRegression(
                    max_iter=5000,
                    solver="saga",
                    random_state=RANDOM_STATE,
                ),
            ),
        ]
    )


def build_catboost_model(
    depth: int = 6, learning_rate: float = 0.05, l2_leaf_reg: float = 3.0
) -> CatBoostClassifier:
    return CatBoostClassifier(
        loss_function="Logloss",
        eval_metric="Logloss",
        depth=depth,
        learning_rate=learning_rate,
        iterations=1000,
        l2_leaf_reg=l2_leaf_reg,
        nan_mode="Min",
        has_time=True,
        random_seed=RANDOM_STATE,
        verbose=False,
        allow_writing_files=False,
    )


def evaluate_predictions(y_true: pd.Series, y_prob: np.ndarray) -> dict[str, float]:
    y_prob = np.clip(y_prob, 1e-6, 1 - 1e-6)
    y_pred = (y_prob >= 0.5).astype(int)
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "roc_auc": float(roc_auc_score(y_true, y_prob)),
        "log_loss": float(log_loss(y_true, y_prob)),
        "brier": float(brier_score_loss(y_true, y_prob)),
        "positive_rate": float(np.mean(y_true)),
    }


def build_artifact_dirs(
    base_dir: Path, matrix_name: str, feature_mode: str
) -> tuple[Path, Path]:
    matrix_dir = base_dir / matrix_name / feature_mode
    models_dir = matrix_dir / "models"
    matrix_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    return matrix_dir, models_dir


def build_feature_view(
    dataframe: pd.DataFrame,
    feature_columns: list[str],
    categorical_columns: list[str],
    mode: str,
    feature_allowlist: list[str] | None,
) -> FeatureView:
    if feature_allowlist is not None:
        allowed = set(feature_allowlist)
        feature_columns = [column for column in feature_columns if column in allowed]
        categorical_columns = [
            column for column in categorical_columns if column in allowed
        ]

    if mode == "full":
        numeric_columns = [
            column for column in feature_columns if column not in categorical_columns
        ]
        return FeatureView(
            frame=dataframe[feature_columns].copy(),
            feature_columns=feature_columns,
            categorical_columns=categorical_columns,
            numeric_columns=numeric_columns,
        )

    if mode == "full_no_identity":
        identity_drop_columns = {"team1", "team2", "home_team"}
        reduced_feature_columns = [
            column for column in feature_columns if column not in identity_drop_columns
        ]
        reduced_categorical_columns = [
            column
            for column in categorical_columns
            if column in reduced_feature_columns
        ]
        reduced_numeric_columns = [
            column
            for column in reduced_feature_columns
            if column not in reduced_categorical_columns
        ]
        return FeatureView(
            frame=dataframe[reduced_feature_columns].copy(),
            feature_columns=reduced_feature_columns,
            categorical_columns=reduced_categorical_columns,
            numeric_columns=reduced_numeric_columns,
        )

    team1_prefixed = [
        column for column in feature_columns if column.startswith("team1_")
    ]
    non_pair_columns = [
        column
        for column in feature_columns
        if not column.startswith("team1_") and not column.startswith("team2_")
    ]

    derived = dataframe[non_pair_columns].copy()
    derived_feature_columns = list(non_pair_columns)

    for team1_column in team1_prefixed:
        suffix = team1_column.removeprefix("team1_")
        team2_column = f"team2_{suffix}"
        if team2_column not in dataframe.columns:
            continue

        delta_column = f"delta_{suffix}"
        derived[delta_column] = dataframe[team1_column] - dataframe[team2_column]
        derived_feature_columns.append(delta_column)

        if mode == "delta_plus_mean":
            mean_column = f"mean_{suffix}"
            derived[mean_column] = (
                dataframe[team1_column] + dataframe[team2_column]
            ) / 2.0
            derived_feature_columns.append(mean_column)

    numeric_columns = [
        column
        for column in derived_feature_columns
        if column not in categorical_columns
    ]

    return FeatureView(
        frame=derived,
        feature_columns=derived_feature_columns,
        categorical_columns=[
            column
            for column in categorical_columns
            if column in derived_feature_columns
        ],
        numeric_columns=numeric_columns,
    )


def fit_platt_calibrator(
    probabilities: np.ndarray, targets: pd.Series
) -> LogisticRegression | None:
    if len(np.unique(targets)) < 2:
        return None

    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    calibrator = LogisticRegression(max_iter=2000, solver="lbfgs")
    calibrator.fit(logits, targets)
    return calibrator


def apply_platt_calibrator(
    calibrator: LogisticRegression | None, probabilities: np.ndarray
) -> np.ndarray:
    if calibrator is None:
        return probabilities

    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    return calibrator.predict_proba(logits)[:, 1]


def tune_catboost(
    x_train: pd.DataFrame,
    y_train: pd.Series,
    x_calibration: pd.DataFrame,
    y_calibration: pd.Series,
    categorical_columns: list[str],
) -> tuple[CatBoostClassifier, dict[str, Any], list[dict[str, Any]]]:
    candidates = [
        {"depth": depth, "learning_rate": learning_rate, "l2_leaf_reg": l2_leaf_reg}
        for depth, learning_rate, l2_leaf_reg in product(
            [4, 6], [0.03, 0.05], [3.0, 8.0]
        )
    ]

    tuning_rows: list[dict[str, Any]] = []
    best_model: CatBoostClassifier | None = None
    best_params: dict[str, Any] | None = None
    best_score = float("inf")

    for params in candidates:
        model = build_catboost_model(**params)
        model.fit(
            x_train,
            y_train,
            cat_features=categorical_columns,
            eval_set=(x_calibration, y_calibration),
            use_best_model=True,
            early_stopping_rounds=100,
        )
        calibration_prob = model.predict_proba(x_calibration)[:, 1]
        calibration_metrics = evaluate_predictions(y_calibration, calibration_prob)
        row = {
            **params,
            **calibration_metrics,
            "best_iteration": int(model.get_best_iteration()),
        }
        tuning_rows.append(row)

        if calibration_metrics["log_loss"] < best_score:
            best_score = calibration_metrics["log_loss"]
            best_model = model
            best_params = {**params, "best_iteration": int(model.get_best_iteration())}

    assert best_model is not None
    assert best_params is not None
    return best_model, best_params, tuning_rows


def train() -> None:
    args = parse_args()
    root_dir = Path.cwd()
    metadata_dir = root_dir / "model" / "data" / "metadata"
    manifest_path = metadata_dir / "model_matrix_manifest.json"
    manifest = load_manifest(manifest_path)
    manifest_key = "preToss" if args.matrix == "pre_toss" else "postToss"
    matrix_manifest = manifest[manifest_key]
    matrix_path = Path(matrix_manifest["matrixPath"])

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
        root_dir / args.artifacts_dir, args.matrix, args.feature_mode
    )
    metrics_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    tuning_rows: list[dict[str, Any]] = []

    for fold_index, fold in enumerate(folds, start=1):
        train_seasons_for_model = fold.train_seasons[:-1]
        calibration_season = fold.train_seasons[-1]

        train_frame = dataframe[
            dataframe["season"].isin(train_seasons_for_model)
        ].copy()
        calibration_frame = dataframe[dataframe["season"] == calibration_season].copy()
        validation_frame = dataframe[
            dataframe["season"] == fold.validation_season
        ].copy()
        test_frame = dataframe[dataframe["season"] == fold.test_season].copy()

        x_train = train_frame[feature_columns]
        y_train = train_frame[target_column]
        x_calibration = calibration_frame[feature_columns]
        y_calibration = calibration_frame[target_column]
        x_validation = validation_frame[feature_columns]
        y_validation = validation_frame[target_column]
        x_test = test_frame[feature_columns]
        y_test = test_frame[target_column]

        logistic_pipeline = build_logistic_pipeline(
            numeric_columns, categorical_columns
        )
        logistic_pipeline.fit(x_train, y_train)

        logistic_validation_prob = logistic_pipeline.predict_proba(x_validation)[:, 1]
        logistic_test_prob = logistic_pipeline.predict_proba(x_test)[:, 1]

        joblib.dump(
            logistic_pipeline, models_dir / f"{fold.fold_name}__logistic.joblib"
        )

        for model_name, validation_prob, test_prob in [
            ("logistic_regression", logistic_validation_prob, logistic_test_prob),
        ]:
            for split_name, split_frame, y_true, probabilities in [
                ("validation", validation_frame, y_validation, validation_prob),
                ("test", test_frame, y_test, test_prob),
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

        catboost_model, best_params, fold_tuning_rows = tune_catboost(
            x_train,
            y_train,
            x_calibration,
            y_calibration,
            categorical_columns,
        )
        catboost_calibration_prob = catboost_model.predict_proba(x_calibration)[:, 1]
        catboost_validation_prob = catboost_model.predict_proba(x_validation)[:, 1]
        catboost_test_prob = catboost_model.predict_proba(x_test)[:, 1]
        platt_calibrator = fit_platt_calibrator(
            catboost_calibration_prob, y_calibration
        )
        catboost_validation_prob_calibrated = apply_platt_calibrator(
            platt_calibrator, catboost_validation_prob
        )
        catboost_test_prob_calibrated = apply_platt_calibrator(
            platt_calibrator, catboost_test_prob
        )

        catboost_model.save_model(models_dir / f"{fold.fold_name}__catboost_tuned.cbm")
        joblib.dump(
            platt_calibrator,
            models_dir / f"{fold.fold_name}__catboost_platt.joblib",
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

        calibration_metrics = evaluate_predictions(
            y_calibration, catboost_calibration_prob
        )
        metrics_rows.append(
            {
                "fold_name": fold.fold_name,
                "fold_index": fold_index,
                "model": "catboost_tuned",
                "split": "calibration",
                "train_seasons": ",".join(map(str, train_seasons_for_model)),
                "calibration_season": calibration_season,
                "validation_season": fold.validation_season,
                "test_season": fold.test_season,
                "rows": len(calibration_frame),
                **calibration_metrics,
            }
        )

        for model_name, validation_prob, test_prob in [
            ("catboost_tuned", catboost_validation_prob, catboost_test_prob),
            (
                "catboost_tuned_platt",
                catboost_validation_prob_calibrated,
                catboost_test_prob_calibrated,
            ),
        ]:
            for split_name, split_frame, y_true, probabilities in [
                ("validation", validation_frame, y_validation, validation_prob),
                ("test", test_frame, y_test, test_prob),
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
    tuning_frame.to_csv(artifacts_dir / "catboost_tuning.csv", index=False)

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
        "featureAllowlist": feature_allowlist,
        "matrixPath": str(matrix_path),
        "matrixSha256": compute_sha256(matrix_path),
        "modelMatrixManifestSha256": compute_sha256(manifest_path),
        "minTrainSeasons": args.min_train_seasons,
        "availableSeasons": available_seasons,
        "folds": [
            {
                "fold_name": fold.fold_name,
                "train_seasons": fold.train_seasons[:-1],
                "calibration_season": fold.train_seasons[-1],
                "validation_season": fold.validation_season,
                "test_season": fold.test_season,
            }
            for fold in folds
        ],
        "categoricalColumns": categorical_columns,
        "numericColumns": numeric_columns,
        "featureColumns": feature_columns,
    }
    (artifacts_dir / "training_manifest.json").write_text(
        json.dumps(manifest_output, indent=2) + "\n"
    )

    print(f"Training pipeline complete for {args.matrix} matrix")
    print(summary_frame.to_string(index=False))


if __name__ == "__main__":
    train()
