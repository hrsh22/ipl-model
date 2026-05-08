from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePath
from typing import Any

import pandas as pd

from final_model_revision_log import append_final_model_revision, capture_final_model_state


MODEL_DIR = Path(__file__).resolve().parent
ROOT = MODEL_DIR.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Promote one reviewed CatBoost experiment component into final_models"
    )
    parser.add_argument("--matrix", choices=["pre_toss", "post_toss"], required=True)
    parser.add_argument(
        "--artifact-dir",
        required=True,
        help="Experiment artifact directory containing training_manifest.json and models/",
    )
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--component-name", required=True)
    parser.add_argument("--source-model", required=True)
    parser.add_argument("--weight", type=float, default=1.0)
    parser.add_argument("--calibration-method", choices=["platt", "isotonic"], default=None)
    parser.add_argument("--base-final-models-root", default="model/final_models")
    parser.add_argument("--backup-root", default=None)
    parser.add_argument("--revision-note", default=None)
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
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


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


def require_holdout_isolation(training_manifest: dict[str, Any]) -> None:
    if training_manifest.get("finalHoldoutSeason") != 2026:
        raise ValueError("Expected finalHoldoutSeason to be 2026")

    for fold in training_manifest.get("folds", []):
        train_seasons = set(fold.get("train_seasons", []))
        calibration_season = fold.get("calibration_season")
        validation_season = fold.get("validation_season")
        if 2026 in train_seasons or calibration_season == 2026 or validation_season == 2026:
            raise ValueError("Final holdout season leaked into train/calibration/validation")


def model_stem_for_source(source_model: str) -> str:
    if source_model == "catboost_tuned":
        return "catboost_tuned.cbm"
    if source_model in {"catboost_tuned_platt", "catboost_tuned_isotonic"}:
        return "catboost_tuned.cbm"
    raise ValueError(f"Unsupported CatBoost source model: {source_model}")


def calibrator_suffix(calibration_method: str) -> str:
    if calibration_method == "platt":
        return "catboost_platt.joblib"
    if calibration_method == "isotonic":
        return "catboost_isotonic.joblib"
    raise ValueError(f"Unsupported calibration method: {calibration_method}")


def find_single_file(models_dir: Path, suffix: str) -> Path:
    matches = sorted(models_dir.glob(f"*__{suffix}"))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected exactly one models/*__{suffix} under {models_dir}; found {len(matches)}"
        )
    return matches[0]


def load_test_metrics(artifact_dir: Path, source_model: str) -> dict[str, Any]:
    metrics_path = artifact_dir / "summary_metrics.csv"
    if not metrics_path.exists():
        raise FileNotFoundError(f"Missing summary metrics: {metrics_path}")

    metrics = pd.read_csv(metrics_path)
    rows = metrics[(metrics["model"] == source_model) & (metrics["split"] == "test")]
    if len(rows) != 1:
        raise ValueError(
            f"Expected one test metrics row for {source_model} in {metrics_path}; found {len(rows)}"
        )
    row = rows.iloc[0]
    return {
        "accuracy": float(row["accuracy_mean"]),
        "roc_auc": float(row["roc_auc_mean"]),
        "log_loss": float(row["log_loss_mean"]),
        "brier": float(row["brier_mean"]),
    }


def load_selected_params(artifact_dir: Path) -> dict[str, Any] | None:
    tuning_path = artifact_dir / "catboost_tuning.csv"
    if not tuning_path.exists():
        return None

    tuning = pd.read_csv(tuning_path)
    if tuning.empty:
        return None
    selected = tuning.sort_values(
        ["log_loss", "brier", "roc_auc"], ascending=[True, True, False]
    ).iloc[0]
    return {
        "depth": int(selected["depth"]),
        "learning_rate": float(selected["learning_rate"]),
        "l2_leaf_reg": float(selected["l2_leaf_reg"]),
        "best_iteration": int(selected["best_iteration"]),
    }


def copy_optional_matrix(training_manifest: dict[str, Any], component_dir: Path) -> str:
    source_matrix = resolve_repo_path(training_manifest["matrixPath"])
    if not source_matrix.exists():
        raise FileNotFoundError(f"Missing training matrix: {source_matrix}")
    destination = component_dir / "training_matrix.csv"
    shutil.copy2(source_matrix, destination)
    return to_repo_relative(destination)


def main() -> None:
    args = parse_args()
    artifact_dir = resolve_repo_path(args.artifact_dir)
    output_root = resolve_repo_path(args.output_root)
    base_root = resolve_repo_path(args.base_final_models_root)
    backup_root = resolve_repo_path(args.backup_root) if args.backup_root else None
    previous_state = capture_final_model_state(output_root)

    training_manifest_path = artifact_dir / "training_manifest.json"
    if not training_manifest_path.exists():
        raise FileNotFoundError(f"Missing training manifest: {training_manifest_path}")
    training_manifest = json.loads(training_manifest_path.read_text())
    if training_manifest.get("matrix") != args.matrix:
        raise ValueError(
            f"Artifact matrix {training_manifest.get('matrix')} does not match requested {args.matrix}"
        )
    require_holdout_isolation(training_manifest)

    if args.source_model.endswith("_isotonic") and args.calibration_method != "isotonic":
        raise ValueError("catboost_tuned_isotonic requires --calibration-method isotonic")
    if args.source_model.endswith("_platt") and args.calibration_method != "platt":
        raise ValueError("catboost_tuned_platt requires --calibration-method platt")
    if args.source_model == "catboost_tuned" and args.calibration_method:
        raise ValueError("catboost_tuned should not specify a calibration method")

    maybe_backup_current_output(
        output_root=output_root,
        base_root=base_root,
        matrix=args.matrix,
        backup_root=backup_root,
    )

    component_dir = output_root / args.matrix / args.component_name
    component_dir.mkdir(parents=True, exist_ok=True)
    models_dir = artifact_dir / "models"
    model_source = find_single_file(models_dir, model_stem_for_source(args.source_model))
    model_path = component_dir / "catboost_model.cbm"
    shutil.copy2(model_source, model_path)

    component_manifest: dict[str, Any] = {
        "matrix": args.matrix,
        "component": args.component_name,
        "weight": args.weight,
        "modelType": "catboost",
        "matrixPath": copy_optional_matrix(training_manifest, component_dir),
        "featureMode": training_manifest["featureMode"],
        "featureAllowlist": training_manifest.get("featureAllowlist"),
        "featureColumns": training_manifest["featureColumns"],
        "categoricalColumns": training_manifest["categoricalColumns"],
        "numericColumns": training_manifest["numericColumns"],
        "seasonWeighting": training_manifest.get("seasonWeighting"),
        "params": load_selected_params(artifact_dir),
        "metrics": {"test": load_test_metrics(artifact_dir, args.source_model)},
        "finalHoldoutSeason": training_manifest["finalHoldoutSeason"],
        "folds": training_manifest["folds"],
        "modelPath": to_repo_relative(model_path),
        "sourceExperiment": to_repo_relative(artifact_dir),
        "sourceModel": args.source_model,
    }

    if args.calibration_method:
        calibrator_source = find_single_file(models_dir, calibrator_suffix(args.calibration_method))
        calibrator_path = component_dir / f"catboost_{args.calibration_method}.joblib"
        shutil.copy2(calibrator_source, calibrator_path)
        component_manifest["calibrationMethod"] = args.calibration_method
        component_manifest["calibratorPath"] = to_repo_relative(calibrator_path)

    packaged_training_manifest = dict(training_manifest)
    packaged_training_manifest["matrixPath"] = component_manifest["matrixPath"]
    (component_dir / "training_manifest.json").write_text(
        json.dumps(packaged_training_manifest, indent=2) + "\n"
    )
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
        "sourceExperiment": to_repo_relative(artifact_dir),
        "sourceModel": args.source_model,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(overall_manifest, indent=2) + "\n"
    )

    revision_entry = append_final_model_revision(
        final_models_root=output_root,
        operation="promote_catboost_single_component",
        previous_state=previous_state,
        context={
            "script": "model/promote_catboost_single_component.py",
            "matrix": args.matrix,
            "artifactDir": to_repo_relative(artifact_dir),
            "outputRoot": to_repo_relative(output_root),
            "componentName": args.component_name,
            "sourceModel": args.source_model,
            "calibrationMethod": args.calibration_method,
            "revisionNote": args.revision_note,
        },
    )
    print(
        json.dumps(
            {
                "matrix": args.matrix,
                "artifactDir": to_repo_relative(artifact_dir),
                "outputRoot": to_repo_relative(output_root),
                "component": component_manifest,
                "revisionLog": to_repo_relative(output_root / "revision_history.jsonl"),
                "currentModelSourceHash": revision_entry["currentModelSourceHash"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
