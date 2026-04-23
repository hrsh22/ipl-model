from __future__ import annotations

import json
from pathlib import Path, PurePath
from typing import Any

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier

from final_model_revision_log import append_final_model_revision, capture_final_model_state
from train_baselines import (
    build_catboost_model,
    build_feature_view,
    load_feature_allowlist,
    load_manifest,
    prepare_dataframe,
)


MODEL_DIR = Path(__file__).resolve().parent
ROOT = MODEL_DIR.parent
DATA_MANIFEST_PATH = MODEL_DIR / "data" / "metadata" / "model_matrix_manifest.json"
FINAL_MODELS_DIR = MODEL_DIR / "final_models"


COMPONENT_CONFIG = {
    "pre_toss": [
        {
            "name": "top60_full",
            "matrix_manifest_key": "preToss",
            "matrix_path_key": "pre_toss",
            "feature_mode": "full",
            "allowlist_path": ROOT
            / "model"
            / "artifacts"
            / "pre_toss"
            / "full"
            / "pruned_allowlists"
            / "top60.txt",
            "tuning_path": ROOT
            / "model"
            / "artifacts_pruned"
            / "top60"
            / "pre_toss"
            / "full"
            / "catboost_tuning.csv",
            "weight": 0.45,
        },
        {
            "name": "delta",
            "matrix_manifest_key": "preToss",
            "matrix_path_key": "pre_toss",
            "feature_mode": "delta",
            "allowlist_path": None,
            "tuning_path": ROOT
            / "model"
            / "artifacts"
            / "pre_toss"
            / "delta"
            / "catboost_tuning.csv",
            "weight": 0.55,
        },
    ],
    "post_toss": [
        {
            "name": "full",
            "matrix_manifest_key": "postToss",
            "matrix_path_key": "post_toss",
            "feature_mode": "full",
            "allowlist_path": None,
            "tuning_path": ROOT
            / "model"
            / "artifacts"
            / "post_toss"
            / "full"
            / "catboost_tuning.csv",
            "weight": 0.45,
        },
        {
            "name": "delta",
            "matrix_manifest_key": "postToss",
            "matrix_path_key": "post_toss",
            "feature_mode": "delta",
            "allowlist_path": None,
            "tuning_path": ROOT
            / "model"
            / "artifacts"
            / "post_toss"
            / "delta"
            / "catboost_tuning.csv",
            "weight": 0.55,
        },
    ],
}


def resolve_allowlist(config: dict[str, Any], matrix_name: str) -> list[str] | None:
    allowlist_path = config.get("allowlist_path")
    if allowlist_path:
        path = Path(allowlist_path)
        if path.exists():
            return load_feature_allowlist(str(path))

    if matrix_name == "pre_toss" and config.get("name") == "top60_full":
        production_manifest_path = (
            ROOT / "model" / "final_models" / "pre_toss" / "top60_full" / "manifest.json"
        )
        if production_manifest_path.exists():
            production_manifest = json.loads(production_manifest_path.read_text())
            feature_allowlist = production_manifest.get("featureAllowlist")
            if isinstance(feature_allowlist, list) and feature_allowlist:
                return [str(feature) for feature in feature_allowlist]

    if allowlist_path:
        raise FileNotFoundError(f"Missing allowlist file: {allowlist_path}")

    return None


def to_repo_relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def resolve_repo_path(path_value: str | Path) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate

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


def choose_params(tuning_path: Path) -> dict[str, Any]:
    tuning = pd.read_csv(tuning_path)
    grouped = (
        tuning.groupby(["depth", "learning_rate", "l2_leaf_reg"], as_index=False)
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
    iterations = int(max(100, round(float(best["best_iteration_median"])) + 1))
    return {
        "depth": int(best["depth"]),
        "learning_rate": float(best["learning_rate"]),
        "l2_leaf_reg": float(best["l2_leaf_reg"]),
        "iterations": iterations,
    }


def fit_component(
    config: dict[str, Any], data_manifest: dict[str, Any], matrix_name: str
) -> dict[str, Any]:
    matrix_manifest = data_manifest[config["matrix_manifest_key"]]
    matrix_path = resolve_repo_path(matrix_manifest["matrixPath"])
    dataframe = pd.read_csv(matrix_path)
    feature_columns: list[str] = list(matrix_manifest["featureColumns"])
    categorical_columns: list[str] = list(matrix_manifest["categoricalFeatureColumns"])
    allowlist = resolve_allowlist(config, matrix_name)

    dataframe = prepare_dataframe(
        dataframe, categorical_columns, "__unused_target__", []
    )
    feature_view = build_feature_view(
        dataframe,
        feature_columns,
        categorical_columns,
        config["feature_mode"],
        allowlist,
    )
    x_train = feature_view.frame[feature_view.feature_columns]
    y_train = pd.read_csv(matrix_path)["target_team1_won"].astype(int)

    params = choose_params(Path(config["tuning_path"]))
    model = build_catboost_model(
        depth=params["depth"],
        learning_rate=params["learning_rate"],
        l2_leaf_reg=params["l2_leaf_reg"],
    )
    model.set_params(iterations=params["iterations"])
    model.fit(x_train, y_train, cat_features=feature_view.categorical_columns)

    component_dir = FINAL_MODELS_DIR / matrix_name / config["name"]
    component_dir.mkdir(parents=True, exist_ok=True)
    model_path = component_dir / "catboost_model.cbm"
    model.save_model(model_path)

    manifest = {
        "matrix": matrix_name,
        "component": config["name"],
        "weight": config["weight"],
        "matrixPath": to_repo_relative(matrix_path),
        "featureMode": config["feature_mode"],
        "featureAllowlist": allowlist,
        "featureColumns": feature_view.feature_columns,
        "categoricalColumns": feature_view.categorical_columns,
        "numericColumns": feature_view.numeric_columns,
        "params": params,
        "modelPath": to_repo_relative(model_path),
    }
    (component_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    data_manifest = load_manifest(DATA_MANIFEST_PATH)
    overall_manifest: dict[str, Any] = {}
    previous_state = capture_final_model_state(FINAL_MODELS_DIR)

    for matrix_name, configs in COMPONENT_CONFIG.items():
        components = [
            fit_component(config, data_manifest, matrix_name) for config in configs
        ]
        overall_manifest[matrix_name] = {
            "components": components,
            "weights": {
                component["component"]: component["weight"] for component in components
            },
        }

    FINAL_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (FINAL_MODELS_DIR / "manifest.json").write_text(
        json.dumps(overall_manifest, indent=2) + "\n"
    )
    revision_entry = append_final_model_revision(
        final_models_root=FINAL_MODELS_DIR,
        operation="fit_final_catboost_ensemble",
        previous_state=previous_state,
        context={
            "script": "model/fit_final_catboost_ensemble.py",
            "notes": None,
        },
    )
    print(json.dumps(overall_manifest, indent=2))
    print(
        json.dumps(
            {
                "revisionLog": str((FINAL_MODELS_DIR / "revision_history.jsonl").relative_to(ROOT)),
                "currentModelSourceHash": revision_entry["currentModelSourceHash"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
