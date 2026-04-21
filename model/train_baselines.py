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
from sklearn.isotonic import IsotonicRegression
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


def resolve_repo_path(path_value: str | Path, *, root_dir: Path) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate

    if not candidate.is_absolute():
        for base in (root_dir, root_dir / "model"):
            rebased = (base / candidate).resolve()
            if rebased.exists():
                return rebased
        return (root_dir / candidate).resolve()

    parts = candidate.parts
    if "model" in parts:
        model_index = parts.index("model")
        rebased = (root_dir / Path(*parts[model_index:])).resolve()
        if rebased.exists():
            return rebased

    if "data" in parts:
        data_index = parts.index("data")
        rebased = (root_dir / "model" / "data" / Path(*parts[data_index + 1 :])).resolve()
        if rebased.exists():
            return rebased

    return candidate


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
    parser.add_argument(
        "--run-label",
        default=None,
        help="Optional output directory label; defaults to feature mode",
    )
    parser.add_argument(
        "--calibration-methods",
        default="platt",
        help="Comma-separated CatBoost calibration methods to evaluate: platt,isotonic",
    )
    parser.add_argument(
        "--depth-options",
        default="4,6",
        help="Comma-separated CatBoost depth candidates",
    )
    parser.add_argument(
        "--learning-rate-options",
        default="0.03,0.05",
        help="Comma-separated CatBoost learning-rate candidates",
    )
    parser.add_argument(
        "--l2-options",
        default="3,8",
        help="Comma-separated CatBoost l2_leaf_reg candidates",
    )
    parser.add_argument(
        "--catboost-iterations",
        type=int,
        default=1000,
        help="Maximum CatBoost iterations before early stopping",
    )
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
    return parser.parse_args()


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    return json.loads(manifest_path.read_text())


def load_feature_allowlist(file_path: str | None) -> list[str] | None:
    if not file_path:
        return None

    path = Path(file_path)
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def parse_int_list(raw_value: str, *, label: str) -> list[int]:
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    if not values:
        raise ValueError(f"{label} must contain at least one value")
    return [int(item) for item in values]


def parse_float_list(raw_value: str, *, label: str) -> list[float]:
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    if not values:
        raise ValueError(f"{label} must contain at least one value")
    return [float(item) for item in values]


def parse_calibration_methods(raw_value: str) -> list[str]:
    allowed = {"platt", "isotonic"}
    methods = [item.strip().lower() for item in raw_value.split(",") if item.strip()]
    if not methods:
        return []
    invalid = [method for method in methods if method not in allowed]
    if invalid:
        raise ValueError(
            f"Unsupported calibration methods: {', '.join(invalid)}; allowed: {', '.join(sorted(allowed))}"
        )
    return list(dict.fromkeys(methods))


def compute_season_sample_weights(
    seasons: pd.Series,
    *,
    mode: str,
    half_life: float,
) -> np.ndarray:
    if mode == "uniform":
        return np.ones(len(seasons), dtype=float)
    if half_life <= 0:
        raise ValueError("season-half-life must be > 0")

    latest_season = float(seasons.max())
    season_gap = latest_season - seasons.astype(float)
    weights = np.power(0.5, season_gap / half_life)
    return weights.to_numpy(dtype=float)


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
    depth: int = 6,
    learning_rate: float = 0.05,
    l2_leaf_reg: float = 3.0,
    iterations: int = 1000,
) -> CatBoostClassifier:
    return CatBoostClassifier(
        loss_function="Logloss",
        eval_metric="Logloss",
        depth=depth,
        learning_rate=learning_rate,
        iterations=iterations,
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
    base_dir: Path, matrix_name: str, run_label: str
) -> tuple[Path, Path]:
    matrix_dir = base_dir / matrix_name / run_label
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


def fit_isotonic_calibrator(
    probabilities: np.ndarray, targets: pd.Series
) -> IsotonicRegression | None:
    if len(np.unique(targets)) < 2:
        return None

    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(clipped, targets)
    return calibrator


def apply_platt_calibrator(
    calibrator: LogisticRegression | None, probabilities: np.ndarray
) -> np.ndarray:
    if calibrator is None:
        return probabilities

    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    return calibrator.predict_proba(logits)[:, 1]


def apply_isotonic_calibrator(
    calibrator: IsotonicRegression | None, probabilities: np.ndarray
) -> np.ndarray:
    if calibrator is None:
        return probabilities

    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    return calibrator.predict(clipped)


def tune_catboost(
    x_train: pd.DataFrame,
    y_train: pd.Series,
    train_sample_weight: np.ndarray,
    x_calibration: pd.DataFrame,
    y_calibration: pd.Series,
    categorical_columns: list[str],
    depth_options: list[int],
    learning_rate_options: list[float],
    l2_options: list[float],
    iterations: int,
) -> tuple[CatBoostClassifier, dict[str, Any], list[dict[str, Any]]]:
    candidates = [
        {"depth": depth, "learning_rate": learning_rate, "l2_leaf_reg": l2_leaf_reg}
        for depth, learning_rate, l2_leaf_reg in product(
            depth_options, learning_rate_options, l2_options
        )
    ]

    tuning_rows: list[dict[str, Any]] = []
    best_model: CatBoostClassifier | None = None
    best_params: dict[str, Any] | None = None
    best_score = float("inf")

    for params in candidates:
        model = build_catboost_model(**params, iterations=iterations)
        model.fit(
            x_train,
            y_train,
            sample_weight=train_sample_weight,
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
    calibration_methods = parse_calibration_methods(args.calibration_methods)
    depth_options = parse_int_list(args.depth_options, label="depth options")
    learning_rate_options = parse_float_list(
        args.learning_rate_options, label="learning-rate options"
    )
    l2_options = parse_float_list(args.l2_options, label="l2 options")
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
        args.run_label or args.feature_mode,
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
            train_sample_weight,
            x_calibration,
            y_calibration,
            categorical_columns,
            depth_options,
            learning_rate_options,
            l2_options,
            args.catboost_iterations,
        )
        catboost_calibration_prob = catboost_model.predict_proba(x_calibration)[:, 1]
        catboost_validation_prob = catboost_model.predict_proba(x_validation)[:, 1]
        catboost_test_prob = catboost_model.predict_proba(x_test)[:, 1]
        calibrated_outputs: list[tuple[str, np.ndarray, np.ndarray]] = [
            ("catboost_tuned", catboost_validation_prob, catboost_test_prob)
        ]

        catboost_model.save_model(models_dir / f"{fold.fold_name}__catboost_tuned.cbm")

        if "platt" in calibration_methods:
            platt_calibrator = fit_platt_calibrator(
                catboost_calibration_prob, y_calibration
            )
            joblib.dump(
                platt_calibrator,
                models_dir / f"{fold.fold_name}__catboost_platt.joblib",
            )
            calibrated_outputs.append(
                (
                    "catboost_tuned_platt",
                    apply_platt_calibrator(platt_calibrator, catboost_validation_prob),
                    apply_platt_calibrator(platt_calibrator, catboost_test_prob),
                )
            )

        if "isotonic" in calibration_methods:
            isotonic_calibrator = fit_isotonic_calibrator(
                catboost_calibration_prob, y_calibration
            )
            joblib.dump(
                isotonic_calibrator,
                models_dir / f"{fold.fold_name}__catboost_isotonic.joblib",
            )
            calibrated_outputs.append(
                (
                    "catboost_tuned_isotonic",
                    apply_isotonic_calibrator(
                        isotonic_calibrator, catboost_validation_prob
                    ),
                    apply_isotonic_calibrator(
                        isotonic_calibrator, catboost_test_prob
                    ),
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

        for model_name, validation_prob, test_prob in calibrated_outputs:
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
        "runLabel": args.run_label or args.feature_mode,
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
        "catboostSearch": {
            "depthOptions": depth_options,
            "learningRateOptions": learning_rate_options,
            "l2LeafRegOptions": l2_options,
            "iterations": args.catboost_iterations,
        },
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
