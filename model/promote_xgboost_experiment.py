from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from xgboost import XGBClassifier

from train_baselines import (
    build_feature_view,
    compute_season_sample_weights,
    load_manifest,
    prepare_dataframe,
)
from train_xgboost import build_xgboost_preprocessor


MODEL_DIR = Path(__file__).resolve().parent
ROOT = MODEL_DIR.parent
DATA_MANIFEST_PATH = MODEL_DIR / "data" / "metadata" / "model_matrix_manifest.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Promote an experimental XGBoost run into a staged or production final_models root"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument(
        "--artifact-dir",
        required=True,
        help="Experiment artifact directory containing training_manifest.json and xgboost_tuning.csv",
    )
    parser.add_argument(
        "--output-root",
        required=True,
        help="Destination final_models root; use a staging path for safe validation",
    )
    parser.add_argument(
        "--component-name",
        required=True,
        help="Component name to use under final_models/<matrix>/",
    )
    parser.add_argument(
        "--weight",
        type=float,
        default=1.0,
        help="Weight for the promoted component inside the target matrix manifest",
    )
    parser.add_argument(
        "--base-final-models-root",
        default="model/final_models",
        help="Existing final_models root to preserve untouched matrices and optional top-level metadata",
    )
    parser.add_argument(
        "--backup-root",
        default=None,
        help="Optional backup directory; used automatically when writing over the same final_models root",
    )
    return parser.parse_args()


def resolve_repo_path(path_value: str | Path) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate.resolve()
    if candidate.is_absolute():
        return candidate
    return (ROOT / candidate).resolve()


def to_repo_relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def choose_xgboost_params(tuning_path: Path) -> dict[str, Any]:
    tuning = pd.read_csv(tuning_path)
    grouped = (
        tuning.groupby(["max_depth", "learning_rate", "reg_lambda"], as_index=False)
        .agg(
            log_loss_mean=("log_loss", "mean"),
            brier_mean=("brier", "mean"),
            roc_auc_mean=("roc_auc", "mean"),
            best_iteration_median=("best_iteration", "median"),
        )
        .sort_values(
            ["log_loss_mean", "brier_mean", "roc_auc_mean"],
            ascending=[True, True, False],
        )
        .reset_index(drop=True)
    )
    best = grouped.iloc[0]
    n_estimators = int(max(10, round(float(best["best_iteration_median"])) + 1))
    return {
        "max_depth": int(best["max_depth"]),
        "learning_rate": float(best["learning_rate"]),
        "reg_lambda": float(best["reg_lambda"]),
        "n_estimators": n_estimators,
    }


def build_final_xgboost_model(
    *,
    max_depth: int,
    learning_rate: float,
    reg_lambda: float,
    n_estimators: int,
    subsample: float,
    colsample_bytree: float,
) -> XGBClassifier:
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
        random_state=42,
        n_jobs=0,
    )


def maybe_backup_current_output(
    *, output_root: Path, base_root: Path, matrix: str, backup_root: Path | None
) -> None:
    if output_root.resolve() != base_root.resolve():
        return
    if not output_root.exists() or not (output_root / "manifest.json").exists():
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target_backup_root = backup_root or (ROOT / "model" / "final_models_backups")
    destination = target_backup_root / f"{matrix}_{timestamp}"
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output_root / "manifest.json", destination / "manifest.json")
    matrix_dir = output_root / matrix
    if matrix_dir.exists():
        shutil.copytree(matrix_dir, destination / matrix, dirs_exist_ok=True)


def main() -> None:
    args = parse_args()
    artifact_dir = resolve_repo_path(args.artifact_dir)
    output_root = resolve_repo_path(args.output_root)
    base_root = resolve_repo_path(args.base_final_models_root)
    backup_root = resolve_repo_path(args.backup_root) if args.backup_root else None

    training_manifest_path = artifact_dir / "training_manifest.json"
    tuning_path = artifact_dir / "xgboost_tuning.csv"
    if not training_manifest_path.exists():
        raise FileNotFoundError(f"Missing training manifest: {training_manifest_path}")
    if not tuning_path.exists():
        raise FileNotFoundError(f"Missing XGBoost tuning file: {tuning_path}")

    training_manifest = json.loads(training_manifest_path.read_text())
    data_manifest = load_manifest(DATA_MANIFEST_PATH)
    matrix_manifest = data_manifest["preToss" if args.matrix == "pre_toss" else "postToss"]
    matrix_path = resolve_repo_path(training_manifest["matrixPath"])

    dataframe = pd.read_csv(matrix_path)
    feature_columns: list[str] = list(matrix_manifest["featureColumns"])
    categorical_columns: list[str] = list(matrix_manifest["categoricalFeatureColumns"])

    dataframe = prepare_dataframe(
        dataframe, categorical_columns, "target_team1_won", []
    )
    feature_view = build_feature_view(
        dataframe,
        feature_columns,
        categorical_columns,
        training_manifest["featureMode"],
        training_manifest.get("featureAllowlist"),
    )

    x_train = feature_view.frame[feature_view.feature_columns]
    y_train = dataframe["target_team1_won"].astype(int)
    season_weighting = training_manifest.get("seasonWeighting") or {
        "mode": "uniform",
        "halfLife": 2.0,
    }
    train_sample_weight = compute_season_sample_weights(
        dataframe["season"],
        mode=str(season_weighting.get("mode", "uniform")),
        half_life=float(season_weighting.get("halfLife", 2.0)),
    )

    preprocessor = build_xgboost_preprocessor(
        feature_view.numeric_columns, feature_view.categorical_columns
    )
    x_train_encoded = preprocessor.fit_transform(x_train)

    selected_params = choose_xgboost_params(tuning_path)
    xgboost_search = training_manifest.get("xgboostSearch", {})
    model = build_final_xgboost_model(
        max_depth=selected_params["max_depth"],
        learning_rate=selected_params["learning_rate"],
        reg_lambda=selected_params["reg_lambda"],
        n_estimators=selected_params["n_estimators"],
        subsample=float(xgboost_search.get("subsample", 0.9)),
        colsample_bytree=float(xgboost_search.get("colsampleBytree", 0.9)),
    )
    model.fit(x_train_encoded, y_train, sample_weight=train_sample_weight)

    maybe_backup_current_output(
        output_root=output_root,
        base_root=base_root,
        matrix=args.matrix,
        backup_root=backup_root,
    )

    component_dir = output_root / args.matrix / args.component_name
    component_dir.mkdir(parents=True, exist_ok=True)
    model_path = component_dir / "xgboost_model.json"
    preprocessor_path = component_dir / "preprocessor.joblib"
    model.get_booster().save_model(model_path)
    joblib.dump(preprocessor, preprocessor_path)

    component_manifest = {
        "matrix": args.matrix,
        "component": args.component_name,
        "weight": args.weight,
        "modelType": "xgboost",
        "matrixPath": to_repo_relative(matrix_path),
        "featureMode": training_manifest["featureMode"],
        "featureAllowlist": training_manifest.get("featureAllowlist"),
        "featureColumns": feature_view.feature_columns,
        "categoricalColumns": feature_view.categorical_columns,
        "numericColumns": feature_view.numeric_columns,
        "seasonWeighting": season_weighting,
        "params": {
            **selected_params,
            "subsample": float(xgboost_search.get("subsample", 0.9)),
            "colsampleBytree": float(xgboost_search.get("colsampleBytree", 0.9)),
        },
        "modelPath": to_repo_relative(model_path),
        "preprocessorPath": to_repo_relative(preprocessor_path),
        "sourceExperiment": to_repo_relative(artifact_dir),
        "sourceModel": "xgboost_tuned",
    }
    (component_dir / "manifest.json").write_text(
        json.dumps(component_manifest, indent=2) + "\n"
    )

    overall_manifest_path = base_root / "manifest.json"
    overall_manifest: dict[str, Any] = {}
    if overall_manifest_path.exists():
        overall_manifest = json.loads(overall_manifest_path.read_text())

    overall_manifest[args.matrix] = {
        "components": [component_manifest],
        "weights": {args.component_name: args.weight},
    }

    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(overall_manifest, indent=2) + "\n"
    )

    print(
        json.dumps(
            {
                "matrix": args.matrix,
                "artifactDir": str(artifact_dir),
                "outputRoot": str(output_root),
                "component": component_manifest,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
