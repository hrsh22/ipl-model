from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run isolated IPL model experiments without modifying deployed final models"
    )
    parser.add_argument("--name", required=True, help="Experiment name under model/experiments/")
    parser.add_argument(
        "--matrix",
        choices=["pre_toss", "post_toss", "both"],
        default="both",
        help="Which model matrix family to experiment on",
    )
    parser.add_argument(
        "--min-train-seasons",
        type=int,
        default=4,
        help="Minimum seasons in the first walk-forward training fold",
    )
    parser.add_argument(
        "--calibration-methods",
        default="platt,isotonic",
        help="Comma-separated calibration methods to evaluate for CatBoost",
    )
    parser.add_argument(
        "--depth-options",
        default="4,6,8",
        help="Comma-separated CatBoost depth candidates",
    )
    parser.add_argument(
        "--learning-rate-options",
        default="0.03,0.05,0.08",
        help="Comma-separated CatBoost learning-rate candidates",
    )
    parser.add_argument(
        "--l2-options",
        default="3,8,12",
        help="Comma-separated CatBoost l2_leaf_reg candidates",
    )
    parser.add_argument(
        "--catboost-iterations",
        type=int,
        default=1000,
        help="Maximum CatBoost iterations before early stopping",
    )
    parser.add_argument(
        "--skip-current-baseline",
        action="store_true",
        help="Do not include the current model/artifacts root in the comparison backtest",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the experiment plan without executing commands",
    )
    parser.add_argument(
        "--season-weight-mode",
        choices=["uniform", "exponential_half_life"],
        default="uniform",
        help="Optional training-only season recency weighting mode for experiment trainers",
    )
    parser.add_argument(
        "--season-half-life",
        type=float,
        default=2.0,
        help="Half-life in seasons when using exponential recency weighting",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def build_train_command(
    *,
    root: Path,
    experiment_artifacts_dir: Path,
    matrix: str,
    feature_mode: str,
    run_label: str,
    allowlist_path: Path | None,
    args: argparse.Namespace,
) -> list[str]:
    command = [
        "python3",
        str(root / "model" / "train_baselines.py"),
        "--matrix",
        matrix,
        "--feature-mode",
        feature_mode,
        "--run-label",
        run_label,
        "--artifacts-dir",
        str(experiment_artifacts_dir.relative_to(root)),
        "--min-train-seasons",
        str(args.min_train_seasons),
        "--calibration-methods",
        args.calibration_methods,
        "--depth-options",
        args.depth_options,
        "--learning-rate-options",
        args.learning_rate_options,
        "--l2-options",
        args.l2_options,
        "--catboost-iterations",
        str(args.catboost_iterations),
        "--season-weight-mode",
        args.season_weight_mode,
        "--season-half-life",
        str(args.season_half_life),
    ]

    if allowlist_path is not None:
        command.extend(["--feature-allowlist", str(allowlist_path.relative_to(root))])

    return command


def build_commands(root: Path, args: argparse.Namespace) -> tuple[list[list[str]], Path, Path]:
    experiment_root = root / "model" / "experiments" / args.name
    experiment_artifacts_dir = experiment_root / "artifacts"
    experiment_reports_dir = experiment_root / "reports"
    top60_allowlist = (
        root / "model" / "artifacts" / "pre_toss" / "full" / "pruned_allowlists" / "top60.txt"
    )

    selected_matrices = [args.matrix] if args.matrix != "both" else ["pre_toss", "post_toss"]
    commands: list[list[str]] = []

    for matrix in selected_matrices:
        for feature_mode in ["full", "delta", "full_no_identity", "delta_plus_mean"]:
            commands.append(
                build_train_command(
                    root=root,
                    experiment_artifacts_dir=experiment_artifacts_dir,
                    matrix=matrix,
                    feature_mode=feature_mode,
                    run_label=feature_mode,
                    allowlist_path=None,
                    args=args,
                )
            )

        for feature_mode in ["full", "delta"]:
            commands.append(
                [
                    "python3",
                    str(root / "model" / "train_xgboost.py"),
                    "--matrix",
                    matrix,
                    "--feature-mode",
                    feature_mode,
                    "--run-label",
                    f"xgboost_{feature_mode}",
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--min-train-seasons",
                    str(args.min_train_seasons),
                    "--calibration-methods",
                    args.calibration_methods,
                    "--depth-options",
                    args.depth_options,
                    "--learning-rate-options",
                    args.learning_rate_options,
                    "--reg-lambda-options",
                    args.l2_options,
                    "--season-weight-mode",
                    args.season_weight_mode,
                    "--season-half-life",
                    str(args.season_half_life),
                ]
            )

        if matrix == "pre_toss" and top60_allowlist.exists():
            commands.append(
                build_train_command(
                    root=root,
                    experiment_artifacts_dir=experiment_artifacts_dir,
                    matrix=matrix,
                    feature_mode="full",
                    run_label="top60_full",
                    allowlist_path=top60_allowlist,
                    args=args,
                )
            )
            commands.append(
                [
                    "python3",
                    str(root / "model" / "train_xgboost.py"),
                    "--matrix",
                    matrix,
                    "--feature-mode",
                    "full",
                    "--run-label",
                    "xgboost_top60_full",
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--min-train-seasons",
                    str(args.min_train_seasons),
                    "--calibration-methods",
                    args.calibration_methods,
                    "--depth-options",
                    args.depth_options,
                    "--learning-rate-options",
                    args.learning_rate_options,
                    "--reg-lambda-options",
                    args.l2_options,
                    "--season-weight-mode",
                    args.season_weight_mode,
                    "--season-half-life",
                    str(args.season_half_life),
                    "--feature-allowlist",
                    str(top60_allowlist.relative_to(root)),
                ]
            )

        commands.append(
            [
                "python3",
                str(root / "model" / "build_catboost_ensemble.py"),
                "--matrix",
                matrix,
                "--artifacts-dir",
                str(experiment_artifacts_dir.relative_to(root)),
                "--mode-a",
                "full",
                "--mode-b",
                "delta",
                "--output-name",
                "ensemble_full__delta",
            ]
        )

        if matrix == "pre_toss" and top60_allowlist.exists():
            commands.append(
                [
                    "python3",
                    str(root / "model" / "build_catboost_ensemble.py"),
                    "--matrix",
                    matrix,
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--mode-a",
                    "top60_full",
                    "--mode-b",
                    "delta",
                    "--output-name",
                    "ensemble_top60_full__delta",
                ]
            )
            stacked_sources = [
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/full:catboost_tuned:full",
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/delta:catboost_tuned:delta",
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/top60_full:catboost_tuned:top60",
            ]
        else:
            stacked_sources = [
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/full:catboost_tuned:full",
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/delta:catboost_tuned:delta",
                f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/full_no_identity:catboost_tuned:no_identity",
            ]

        commands.append(
            [
                "python3",
                str(root / "model" / "build_stacked_ensemble.py"),
                "--matrix",
                matrix,
                "--artifacts-dir",
                str(experiment_artifacts_dir.relative_to(root)),
                "--output-name",
                "stacked_experiment",
                *sum([["--source", source] for source in stacked_sources], []),
            ]
        )

        if matrix == "pre_toss":
            commands.append(
                [
                    "python3",
                    str(root / "model" / "build_weighted_ensemble.py"),
                    "--matrix",
                    matrix,
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--output-name",
                    "weighted_xgboost_full__catboost_top60",
                    "--source-a",
                    f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/xgboost_full:xgboost_tuned:xgb_full",
                    "--source-b",
                    "model/artifacts_pruned/top60/pre_toss/full:catboost_tuned:cat_top60",
                ]
            )
            commands.append(
                [
                    "python3",
                    str(root / "model" / "build_stacked_ensemble.py"),
                    "--matrix",
                    matrix,
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--output-name",
                    "stacked_xgboost__catboost_best",
                    "--source",
                    f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/xgboost_full:xgboost_tuned:xgb_full",
                    "--source",
                    "model/artifacts_pruned/top60/pre_toss/full:catboost_tuned:cat_top60",
                    "--source",
                    "model/artifacts/pre_toss/ensemble_catboost__full__delta:catboost_ensemble:cat_ens",
                ]
            )
        else:
            commands.append(
                [
                    "python3",
                    str(root / "model" / "build_weighted_ensemble.py"),
                    "--matrix",
                    matrix,
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--output-name",
                    "weighted_xgboost_full__catboost_ensemble",
                    "--source-a",
                    f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/xgboost_full:xgboost_tuned:xgb_full",
                    "--source-b",
                    "model/artifacts/post_toss/ensemble_catboost:catboost_ensemble:cat_ens",
                ]
            )
            commands.append(
                [
                    "python3",
                    str(root / "model" / "build_stacked_ensemble.py"),
                    "--matrix",
                    matrix,
                    "--artifacts-dir",
                    str(experiment_artifacts_dir.relative_to(root)),
                    "--output-name",
                    "stacked_xgboost__catboost_best",
                    "--source",
                    f"{experiment_artifacts_dir.relative_to(root).as_posix()}/{matrix}/xgboost_full:xgboost_tuned:xgb_full",
                    "--source",
                    "model/artifacts/post_toss/ensemble_catboost:catboost_ensemble:cat_ens",
                    "--source",
                    "model/artifacts/post_toss/full:catboost_tuned:cat_full",
                ]
            )

    backtest_command = [
        "python3",
        str(root / "model" / "backtest_predictions.py"),
        "--root",
        f"experiment:{experiment_artifacts_dir.relative_to(root).as_posix()}",
        "--output-dir",
        str(experiment_reports_dir.relative_to(root)),
        "--focus-split",
        "test",
    ]

    if not args.skip_current_baseline:
        backtest_command.extend(["--root", "current:model/artifacts"])

    commands.append(backtest_command)
    commands.append(
        [
            "python3",
            str(root / "model" / "write_technique_report.py"),
            "--root",
            "current:model/artifacts",
            "--root",
            "pruned:model/artifacts_pruned",
            "--root",
            f"experiment:{experiment_artifacts_dir.relative_to(root).as_posix()}",
            "--output",
            str((experiment_root / "README.md").relative_to(root)),
            "--focus-split",
            "test",
        ]
    )
    return commands, experiment_root, experiment_reports_dir


def run_command(command: list[str], root: Path, dry_run: bool) -> None:
    rendered = " ".join(shlex.quote(part) for part in command)
    print(f"\n$ {rendered}")
    if dry_run:
        return
    subprocess.run(command, cwd=root, check=True)


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parent.parent
    commands, experiment_root, experiment_reports_dir = build_commands(root, args)

    print(f"Experiment root: {experiment_root}")
    print("Production safety: model/final_models is never modified by this workflow.")

    for command in commands:
        run_command(command, root, args.dry_run)

    if args.dry_run:
        print("\nDry run complete.")
        return

    print(f"\nExperiment complete. Reports available under {experiment_reports_dir}")


if __name__ == "__main__":
    main()
