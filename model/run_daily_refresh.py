from __future__ import annotations

import argparse
import csv
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "model"
LIVE_DIR = MODEL_DIR / "data" / "live"
EXPERIMENT_ROOT = MODEL_DIR / "experiments" / "daily-refresh-runs"
FINAL_MODELS_ROOT = MODEL_DIR / "final_models"


@dataclass(frozen=True)
class Candidate:
    key: str
    matrix: str
    run_label: str
    focus_model: str
    promotion_component_name: str | None
    command: list[str]


@dataclass(frozen=True)
class PromotionDecision:
    should_promote: bool
    reason: str
    candidate_metrics: dict[str, object] | None
    baseline_metrics: dict[str, object] | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh live IPL model data, retrain winner candidates, and archive daily reports"
    )
    parser.add_argument(
        "--run-id",
        default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        help="Output run id under model/experiments/daily-refresh-runs/",
    )
    parser.add_argument(
        "--focus-split",
        default="test",
        help="Primary split used in generated backtest/report outputs",
    )
    parser.add_argument(
        "--skip-refresh",
        action="store_true",
        help="Skip live data refresh/package scripts and only run training/reporting",
    )
    parser.add_argument(
        "--skip-train",
        action="store_true",
        help="Skip candidate retraining and only run reporting/history collection",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned commands without executing them",
    )
    parser.add_argument(
        "--auto-promote-post-toss",
        action="store_true",
        help="Automatically promote the daily post-toss candidate if it clears safety thresholds",
    )
    parser.add_argument(
        "--promotion-dry-run",
        action="store_true",
        help="Print the promotion command instead of applying it when auto-promotion is enabled",
    )
    parser.add_argument(
        "--post-toss-max-log-loss-regression",
        type=float,
        default=0.002,
        help="Maximum allowed log-loss regression for automatic post-toss promotion",
    )
    parser.add_argument(
        "--post-toss-max-brier-regression",
        type=float,
        default=0.001,
        help="Maximum allowed Brier regression for automatic post-toss promotion",
    )
    parser.add_argument(
        "--post-toss-max-roc-auc-drop",
        type=float,
        default=0.005,
        help="Maximum allowed ROC-AUC drop during automatic post-toss promotion",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def run_command(command: Sequence[str], *, dry_run: bool) -> None:
    rendered = " ".join(shlex.quote(part) for part in command)
    print(f"\n$ {rendered}")
    if dry_run:
        return
    subprocess.run(list(command), cwd=ROOT, check=True)


def build_refresh_commands() -> list[list[str]]:
    return [
        ["pnpm", "model:data:fixtures"],
        ["pnpm", "model:data:results-current"],
        ["pnpm", "model:data:squads-current"],
        ["pnpm", "model:data:player-stats-current"],
        ["pnpm", "model:data:elo-current"],
        ["pnpm", "model:data:derive"],
        ["pnpm", "model:data:matrix"],
    ]


def build_candidates(run_artifacts_dir: Path) -> list[Candidate]:
    relative_artifacts = run_artifacts_dir.relative_to(ROOT)
    return [
        Candidate(
            key="pre_toss_catboost_top60_full",
            matrix="pre_toss",
            run_label="top60_full_daily",
            focus_model="catboost_tuned",
            promotion_component_name=None,
            command=[
                "python3",
                "model/train_baselines.py",
                "--matrix",
                "pre_toss",
                "--feature-mode",
                "full",
                "--run-label",
                "top60_full_daily",
                "--artifacts-dir",
                str(relative_artifacts),
                "--feature-allowlist",
                "model/artifacts/pre_toss/full/pruned_allowlists/top60.txt",
                "--calibration-methods",
                "platt",
                "--depth-options",
                "4,6,8",
                "--learning-rate-options",
                "0.03,0.05,0.08",
                "--l2-options",
                "3,8,12",
                "--season-weight-mode",
                "uniform",
            ],
        ),
        Candidate(
            key="pre_toss_catboost_delta",
            matrix="pre_toss",
            run_label="delta_daily",
            focus_model="catboost_tuned",
            promotion_component_name=None,
            command=[
                "python3",
                "model/train_baselines.py",
                "--matrix",
                "pre_toss",
                "--feature-mode",
                "delta",
                "--run-label",
                "delta_daily",
                "--artifacts-dir",
                str(relative_artifacts),
                "--calibration-methods",
                "platt",
                "--depth-options",
                "4,6,8",
                "--learning-rate-options",
                "0.03,0.05,0.08",
                "--l2-options",
                "3,8,12",
                "--season-weight-mode",
                "uniform",
            ],
        ),
        Candidate(
            key="pre_toss_catboost_ensemble_top60_delta",
            matrix="pre_toss",
            run_label="ensemble_top60_full__delta_daily",
            focus_model="catboost_ensemble",
            promotion_component_name=None,
            command=[
                "python3",
                "model/build_catboost_ensemble.py",
                "--matrix",
                "pre_toss",
                "--artifacts-dir",
                str(relative_artifacts),
                "--mode-a",
                "top60_full_daily",
                "--mode-b",
                "delta_daily",
                "--output-name",
                "ensemble_top60_full__delta_daily",
            ],
        ),
        Candidate(
            key="post_toss_xgboost_full_recency_h3",
            matrix="post_toss",
            run_label="xgboost_full_recency_h3_daily",
            focus_model="xgboost_tuned",
            promotion_component_name="xgboost_full_recency_h3",
            command=[
                "python3",
                "model/train_xgboost.py",
                "--matrix",
                "post_toss",
                "--feature-mode",
                "full",
                "--run-label",
                "xgboost_full_recency_h3_daily",
                "--artifacts-dir",
                str(relative_artifacts),
                "--calibration-methods",
                "platt",
                "--depth-options",
                "4,6,8",
                "--learning-rate-options",
                "0.03,0.05,0.08",
                "--reg-lambda-options",
                "3,8,12",
                "--season-weight-mode",
                "exponential_half_life",
                "--season-half-life",
                "3.0",
            ],
        ),
    ]


def build_report_commands(run_artifacts_dir: Path, run_root: Path, focus_split: str) -> list[list[str]]:
    relative_artifacts = run_artifacts_dir.relative_to(ROOT)
    report_dir = run_root / "reports"
    readme_path = run_root / "README.md"
    return [
        [
            "python3",
            "model/backtest_predictions.py",
            "--root",
            "current:model/artifacts",
            "--root",
            "pruned:model/artifacts_pruned",
            "--root",
            f"daily:{relative_artifacts.as_posix()}",
            "--output-dir",
            str(report_dir.relative_to(ROOT)),
            "--focus-split",
            focus_split,
        ],
        [
            "python3",
            "model/write_technique_report.py",
            "--root",
            "current:model/artifacts",
            "--root",
            "pruned:model/artifacts_pruned",
            "--root",
            f"daily:{relative_artifacts.as_posix()}",
            "--output",
            str(readme_path.relative_to(ROOT)),
            "--focus-split",
            focus_split,
        ],
    ]


def load_summary_frame(run_root: Path, candidate: Candidate) -> pd.DataFrame | None:
    summary_path = run_root / "artifacts" / candidate.matrix / candidate.run_label / "summary_metrics.csv"
    if not summary_path.exists():
        return None
    return pd.read_csv(summary_path)


def extract_focus_metrics(frame: pd.DataFrame, *, focus_split: str, model_name: str) -> dict[str, object] | None:
    focus = frame[(frame["split"] == focus_split) & (frame["model"] == model_name)]
    if focus.empty:
        return None
    return focus.iloc[0].to_dict()


def load_production_component_manifest(matrix: str) -> dict[str, object] | None:
    final_manifest_path = FINAL_MODELS_ROOT / "manifest.json"
    if not final_manifest_path.exists():
        return None
    final_manifest = json.loads(final_manifest_path.read_text())
    matrix_config = final_manifest.get(matrix)
    if not isinstance(matrix_config, dict):
        return None
    components = matrix_config.get("components")
    if not isinstance(components, list) or len(components) != 1:
        return None
    component = components[0]
    if not isinstance(component, dict):
        return None
    component_name = component.get("component")
    if not component_name:
        return None
    component_manifest_path = FINAL_MODELS_ROOT / matrix / str(component_name) / "manifest.json"
    if not component_manifest_path.exists():
        return component
    return json.loads(component_manifest_path.read_text())


def load_baseline_focus_metrics(matrix: str, focus_split: str) -> dict[str, object] | None:
    component_manifest = load_production_component_manifest(matrix)
    if not component_manifest:
        return None
    source_experiment = component_manifest.get("sourceExperiment")
    source_model = component_manifest.get("sourceModel")
    if not isinstance(source_experiment, str) or not isinstance(source_model, str):
        return None
    summary_path = ROOT / source_experiment / "summary_metrics.csv"
    if not summary_path.exists():
        return None
    frame = pd.read_csv(summary_path)
    return extract_focus_metrics(frame, focus_split=focus_split, model_name=source_model)


def decide_post_toss_promotion(
    *,
    candidate_metrics: dict[str, object] | None,
    baseline_metrics: dict[str, object] | None,
    max_log_loss_regression: float,
    max_brier_regression: float,
    max_roc_auc_drop: float,
) -> PromotionDecision:
    if candidate_metrics is None:
        return PromotionDecision(False, "candidate metrics missing", None, baseline_metrics)
    if baseline_metrics is None:
        return PromotionDecision(True, "promote: baseline production metrics missing", candidate_metrics, None)

    candidate_log_loss = float(candidate_metrics["log_loss_mean"])
    baseline_log_loss = float(baseline_metrics["log_loss_mean"])
    candidate_brier = float(candidate_metrics["brier_mean"])
    baseline_brier = float(baseline_metrics["brier_mean"])
    candidate_roc_auc = float(candidate_metrics["roc_auc_mean"])
    baseline_roc_auc = float(baseline_metrics["roc_auc_mean"])

    log_loss_improvement = baseline_log_loss - candidate_log_loss
    brier_improvement = baseline_brier - candidate_brier
    roc_auc_delta = candidate_roc_auc - baseline_roc_auc

    if candidate_log_loss - baseline_log_loss > max_log_loss_regression:
        return PromotionDecision(False, f"log-loss regression {candidate_log_loss - baseline_log_loss:.6f} exceeds threshold {max_log_loss_regression:.6f}", candidate_metrics, baseline_metrics)
    if candidate_brier - baseline_brier > max_brier_regression:
        return PromotionDecision(False, f"brier regression {candidate_brier - baseline_brier:.6f} exceeds threshold {max_brier_regression:.6f}", candidate_metrics, baseline_metrics)
    if roc_auc_delta < -max_roc_auc_drop:
        return PromotionDecision(False, f"roc-auc delta {roc_auc_delta:.6f} worse than allowed drop {-max_roc_auc_drop:.6f}", candidate_metrics, baseline_metrics)

    return PromotionDecision(True, f"promote: log-loss delta {log_loss_improvement:.6f}, brier delta {brier_improvement:.6f}, roc-auc delta {roc_auc_delta:.6f}", candidate_metrics, baseline_metrics)


def append_promotion_history(run_id: str, payload: dict[str, object]) -> None:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    history_path = LIVE_DIR / "daily_promotion_history.jsonl"
    with history_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps({"runId": run_id, **payload}) + "\n")


def maybe_promote_post_toss_candidate(
    *,
    args: argparse.Namespace,
    run_root: Path,
    candidate: Candidate,
) -> None:
    frame = load_summary_frame(run_root, candidate)
    candidate_metrics = (
        extract_focus_metrics(frame, focus_split=args.focus_split, model_name=candidate.focus_model)
        if frame is not None
        else None
    )
    baseline_metrics = load_baseline_focus_metrics(candidate.matrix, args.focus_split)
    decision = decide_post_toss_promotion(
        candidate_metrics=candidate_metrics,
        baseline_metrics=baseline_metrics,
        max_log_loss_regression=args.post_toss_max_log_loss_regression,
        max_brier_regression=args.post_toss_max_brier_regression,
        max_roc_auc_drop=args.post_toss_max_roc_auc_drop,
    )

    payload: dict[str, object] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "candidateKey": candidate.key,
        "candidateRunLabel": candidate.run_label,
        "decision": decision.reason,
        "shouldPromote": decision.should_promote,
        "candidateMetrics": decision.candidate_metrics,
        "baselineMetrics": decision.baseline_metrics,
        "promotionDryRun": args.promotion_dry_run,
    }

    if not decision.should_promote:
        append_promotion_history(args.run_id, payload)
        print(f"\nPost-toss auto-promotion skipped: {decision.reason}")
        return

    artifact_dir = run_root / "artifacts" / candidate.matrix / candidate.run_label
    command = [
        "python3",
        "model/promote_xgboost_experiment.py",
        "--matrix",
        candidate.matrix,
        "--artifact-dir",
        str(artifact_dir.relative_to(ROOT)),
        "--output-root",
        "model/final_models",
        "--component-name",
        str(candidate.promotion_component_name or candidate.run_label),
        "--base-final-models-root",
        "model/final_models",
        "--backup-root",
        "model/final_models_backups",
    ]
    payload["promotionCommand"] = command
    payload["promotionApplied"] = not args.promotion_dry_run

    print(f"\nPost-toss auto-promotion decision: {decision.reason}")
    run_command(command, dry_run=args.promotion_dry_run)
    append_promotion_history(args.run_id, payload)


def append_history(run_id: str, run_root: Path, candidates: list[Candidate], focus_split: str) -> None:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    history_path = LIVE_DIR / "daily_retraining_history.csv"
    latest_summary_path = LIVE_DIR / "daily_retraining_latest.json"

    timestamp = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, object]] = []
    latest_summary: dict[str, object] = {
        "runId": run_id,
        "generatedAt": timestamp,
        "focusSplit": focus_split,
        "candidates": {},
        "reportDir": str((run_root / "reports").relative_to(ROOT)),
        "readmePath": str((run_root / "README.md").relative_to(ROOT)),
    }

    for candidate in candidates:
        summary_path = run_root / "artifacts" / candidate.matrix / candidate.run_label / "summary_metrics.csv"
        frame = load_summary_frame(run_root, candidate)
        if frame is None:
            continue
        for record in frame.to_dict(orient="records"):
            row = {
                "run_id": run_id,
                "generated_at": timestamp,
                "candidate_key": candidate.key,
                "matrix": candidate.matrix,
                "run_label": candidate.run_label,
                "model": record.get("model"),
                "split": record.get("split"),
                "folds": record.get("folds"),
                "accuracy_mean": record.get("accuracy_mean"),
                "accuracy_std": record.get("accuracy_std"),
                "roc_auc_mean": record.get("roc_auc_mean"),
                "roc_auc_std": record.get("roc_auc_std"),
                "log_loss_mean": record.get("log_loss_mean"),
                "log_loss_std": record.get("log_loss_std"),
                "brier_mean": record.get("brier_mean"),
                "brier_std": record.get("brier_std"),
                "summary_path": str(summary_path.relative_to(ROOT)),
            }
            rows.append(row)

        focus_rows = frame[(frame["split"] == focus_split) & (frame["model"] == candidate.focus_model)]
        if not focus_rows.empty:
            latest_summary["candidates"][candidate.key] = focus_rows.to_dict(orient="records")

    if not rows:
        raise ValueError("No candidate summary metrics found to append into history")

    fieldnames = list(rows[0].keys())
    existing_rows: list[dict[str, str]] = []
    if history_path.exists():
        with history_path.open("r", newline="") as file:
            existing_rows = list(csv.DictReader(file))

    deduped_existing = [
        row
        for row in existing_rows
        if not (
            row.get("run_id") == run_id
            and row.get("candidate_key") in {candidate.key for candidate in candidates}
        )
    ]

    with history_path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(deduped_existing)
        writer.writerows(rows)

    latest_summary_path.write_text(json.dumps(latest_summary, indent=2) + "\n")
    print(f"\nUpdated metrics history: {history_path.relative_to(ROOT)}")


def main() -> None:
    args = parse_args()
    run_root = EXPERIMENT_ROOT / args.run_id
    run_artifacts_dir = run_root / "artifacts"
    run_root.mkdir(parents=True, exist_ok=True)

    refresh_commands = [] if args.skip_refresh else build_refresh_commands()
    candidates = build_candidates(run_artifacts_dir)
    train_commands = [] if args.skip_train else [candidate.command for candidate in candidates]
    report_commands = build_report_commands(run_artifacts_dir, run_root, args.focus_split)

    print(f"Daily refresh run root: {run_root}")
    print(
        "Promotion policy: "
        + (
            "guarded post-toss auto-promotion enabled."
            if args.auto_promote_post_toss
            else "no automatic promotion; reports + history only."
        )
    )

    for command in [*refresh_commands, *train_commands, *report_commands]:
        run_command(command, dry_run=args.dry_run)

    if args.dry_run:
        print("\nDry run complete.")
        return

    append_history(args.run_id, run_root, candidates, args.focus_split)

    if args.auto_promote_post_toss:
        post_toss_candidate = next(
            candidate
            for candidate in candidates
            if candidate.key == "post_toss_xgboost_full_recency_h3"
        )
        maybe_promote_post_toss_candidate(
            args=args,
            run_root=run_root,
            candidate=post_toss_candidate,
        )

    print(f"\nDaily refresh complete. Review: {run_root / 'README.md'}")


if __name__ == "__main__":
    main()
