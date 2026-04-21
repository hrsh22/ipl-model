from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePath
from typing import Any

import pandas as pd

from fit_final_catboost_ensemble import choose_params
from train_baselines import (
    build_catboost_model,
    build_feature_view,
    load_manifest,
    prepare_dataframe,
)


MODEL_DIR = Path(__file__).resolve().parent
ROOT = MODEL_DIR.parent
DATA_MANIFEST_PATH = MODEL_DIR / "data" / "metadata" / "model_matrix_manifest.json"

COMPONENT_CONFIG = {
    "pre_toss": [
        {
            "production_component": "top60_full",
            "artifact_run_label": "top60_full_daily",
            "summary_model": "catboost_tuned",
        },
        {
            "production_component": "delta",
            "artifact_run_label": "delta_daily",
            "summary_model": "catboost_tuned",
        },
    ]
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Promote daily CatBoost experiment artifacts into production final_models"
    )
    parser.add_argument("--matrix", choices=["pre_toss"], required=True)
    parser.add_argument(
        "--artifacts-root",
        required=True,
        help="Directory containing the matrix-specific daily artifacts",
    )
    parser.add_argument(
        "--ensemble-artifact-dir",
        required=True,
        help="Daily ensemble artifact directory used for promotion weights and baseline tracking",
    )
    parser.add_argument(
        "--output-root",
        required=True,
        help="Destination final_models root; use a staging path for safe validation",
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
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def resolve_repo_path(path_value: str | Path) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate.resolve()

    if not candidate.is_absolute():
        rebased = (ROOT / candidate).resolve()
        if rebased.exists():
            return rebased
        return rebased

    parts = PurePath(candidate).parts
    if "model" in parts:
        model_index = parts.index("model")
        rebased = (ROOT / Path(*parts[model_index:])).resolve()
        if rebased.exists():
            return rebased

    return candidate


def to_repo_relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


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


def load_ensemble_weights(ensemble_artifact_dir: Path) -> dict[str, float]:
    summary_path = ensemble_artifact_dir / "summary.json"
    if not summary_path.exists():
        raise FileNotFoundError(f"Missing ensemble summary: {summary_path}")

    summary = json.loads(summary_path.read_text())
    weights: dict[str, float] = {}
    for config in COMPONENT_CONFIG["pre_toss"]:
        key = f"selected_weight_{config['artifact_run_label']}"
        weight = summary.get(key)
        if not isinstance(weight, (int, float)):
            raise ValueError(f"Missing ensemble weight '{key}' in {summary_path}")
        weights[config["production_component"]] = float(weight)
    return weights


def fit_component(
    *,
    matrix: str,
    artifacts_root: Path,
    output_root: Path,
    data_manifest: dict[str, Any],
    config: dict[str, str],
    weight: float,
) -> dict[str, Any]:
    artifact_dir = artifacts_root / config["artifact_run_label"]
    training_manifest_path = artifact_dir / "training_manifest.json"
    tuning_path = artifact_dir / "catboost_tuning.csv"
    if not training_manifest_path.exists():
        raise FileNotFoundError(f"Missing training manifest: {training_manifest_path}")
    if not tuning_path.exists():
        raise FileNotFoundError(f"Missing CatBoost tuning file: {tuning_path}")

    training_manifest = json.loads(training_manifest_path.read_text())
    matrix_manifest = data_manifest["preToss" if matrix == "pre_toss" else "postToss"]
    matrix_path = resolve_repo_path(training_manifest["matrixPath"])

    dataframe = pd.read_csv(matrix_path)
    feature_columns: list[str] = list(matrix_manifest["featureColumns"])
    categorical_columns: list[str] = list(matrix_manifest["categoricalFeatureColumns"])
    feature_allowlist = training_manifest.get("featureAllowlist")
    allowlist = feature_allowlist if isinstance(feature_allowlist, list) else None

    dataframe = prepare_dataframe(
        dataframe, categorical_columns, "target_team1_won", []
    )
    feature_view = build_feature_view(
        dataframe,
        feature_columns,
        categorical_columns,
        str(training_manifest["featureMode"]),
        allowlist,
    )
    x_train = feature_view.frame[feature_view.feature_columns]
    y_train = dataframe["target_team1_won"].astype(int)

    params = choose_params(tuning_path)
    model = build_catboost_model(
        depth=params["depth"],
        learning_rate=params["learning_rate"],
        l2_leaf_reg=params["l2_leaf_reg"],
    )
    model.set_params(iterations=params["iterations"])
    model.fit(x_train, y_train, cat_features=feature_view.categorical_columns)

    component_dir = output_root / matrix / config["production_component"]
    component_dir.mkdir(parents=True, exist_ok=True)
    model_path = component_dir / "catboost_model.cbm"
    model.save_model(model_path)

    component_manifest = {
        "matrix": matrix,
        "component": config["production_component"],
        "weight": weight,
        "modelType": "catboost",
        "matrixPath": to_repo_relative(matrix_path),
        "featureMode": training_manifest["featureMode"],
        "featureAllowlist": allowlist,
        "featureColumns": feature_view.feature_columns,
        "categoricalColumns": feature_view.categorical_columns,
        "numericColumns": feature_view.numeric_columns,
        "seasonWeighting": training_manifest.get("seasonWeighting"),
        "params": params,
        "modelPath": to_repo_relative(model_path),
        "sourceExperiment": to_repo_relative(artifact_dir),
        "sourceModel": config["summary_model"],
    }
    (component_dir / "manifest.json").write_text(
        json.dumps(component_manifest, indent=2) + "\n"
    )
    return component_manifest


def main() -> None:
    args = parse_args()
    artifacts_root = resolve_repo_path(args.artifacts_root)
    ensemble_artifact_dir = resolve_repo_path(args.ensemble_artifact_dir)
    output_root = resolve_repo_path(args.output_root)
    base_root = resolve_repo_path(args.base_final_models_root)
    backup_root = resolve_repo_path(args.backup_root) if args.backup_root else None

    maybe_backup_current_output(
        output_root=output_root,
        base_root=base_root,
        matrix=args.matrix,
        backup_root=backup_root,
    )

    weights = load_ensemble_weights(ensemble_artifact_dir)
    data_manifest = load_manifest(DATA_MANIFEST_PATH)
    components = [
        fit_component(
            matrix=args.matrix,
            artifacts_root=artifacts_root,
            output_root=output_root,
            data_manifest=data_manifest,
            config=config,
            weight=weights[config["production_component"]],
        )
        for config in COMPONENT_CONFIG[args.matrix]
    ]

    overall_manifest_path = base_root / "manifest.json"
    overall_manifest: dict[str, Any] = {}
    if overall_manifest_path.exists():
        overall_manifest = json.loads(overall_manifest_path.read_text())

    overall_manifest[args.matrix] = {
        "components": components,
        "weights": {
            component["component"]: component["weight"] for component in components
        },
        "sourceExperiment": to_repo_relative(ensemble_artifact_dir),
        "sourceModel": "catboost_ensemble",
    }

    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(overall_manifest, indent=2) + "\n"
    )

    print(
        json.dumps(
            {
                "matrix": args.matrix,
                "artifactsRoot": str(artifacts_root),
                "ensembleArtifactDir": str(ensemble_artifact_dir),
                "outputRoot": str(output_root),
                "components": components,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
