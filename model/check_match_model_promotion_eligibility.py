from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent

BASELINE_METRICS: dict[str, dict[str, float]] = {
    "pre_toss": {
        "accuracy": 0.5365,
        "roc_auc": 0.5300,
        "log_loss": 0.6987,
        "brier": 0.2527,
    },
    "post_toss": {
        "accuracy": 0.5119,
        "roc_auc": 0.5444,
        "log_loss": 0.7039,
        "brier": 0.2550,
    },
}

DEFAULT_CANDIDATES: tuple[dict[str, str], ...] = (
    {
        "name": "pre_toss_cat_delta_plus_mean_uniform",
        "phase": "pre_toss",
        "path": "model/experiments/squad-info-2026-post-toss/artifacts_sweep/pre_toss/cat_delta_plus_mean_uniform",
        "model": "catboost_tuned",
    },
    {
        "name": "pre_toss_weighted_cat_dpm_xgb_delta",
        "phase": "pre_toss",
        "path": "model/experiments/squad-info-2026-post-toss/artifacts_sweep/pre_toss/weighted_cat_dpm__xgb_delta",
        "model": "weighted_ensemble__dpm__xgb_delta",
    },
    {
        "name": "post_toss_cat_state_dpm_uniform_isotonic",
        "phase": "post_toss",
        "path": "model/experiments/squad-info-2026-post-toss/artifacts_post_improve/post_toss/cat_state_dpm_uniform",
        "model": "catboost_tuned_isotonic",
    },
)


@dataclass(frozen=True)
class CandidateSpec:
    name: str
    phase: str
    path: Path
    model: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit experimental match-model artifacts for promotion eligibility without touching production artifacts."
    )
    parser.add_argument(
        "--candidate",
        action="append",
        help="Candidate spec as name,phase,path,model. Can be provided multiple times. Defaults to the current squad-info breakthrough candidates.",
    )
    parser.add_argument("--output-dir", default="model/experiments/promotion-readiness")
    parser.add_argument("--final-holdout-season", type=int, default=2026)
    parser.add_argument("--log-loss-regression-limit", type=float, default=0.002)
    parser.add_argument("--brier-regression-limit", type=float, default=0.001)
    parser.add_argument("--roc-auc-drop-limit", type=float, default=0.005)
    parser.add_argument(
        "--post-toss-sensitivity-report",
        help="Optional JSON output from model/check_toss_sensitivity.py for a staged final-model candidate.",
    )
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if any candidate is not eligible.")
    argv = __import__("sys").argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def parse_candidate(raw_value: str) -> CandidateSpec:
    parts = [part.strip() for part in raw_value.split(",", 3)]
    if len(parts) != 4 or not all(parts):
        raise ValueError("Candidate must use name,phase,path,model")
    name, phase, path_text, model = parts
    if phase not in BASELINE_METRICS:
        raise ValueError(f"Unsupported phase {phase!r}; expected one of {sorted(BASELINE_METRICS)}")
    path = Path(path_text)
    return CandidateSpec(name=name, phase=phase, path=path if path.is_absolute() else ROOT / path, model=model)


def default_candidates() -> list[CandidateSpec]:
    return [parse_candidate(",".join([item["name"], item["phase"], item["path"], item["model"]])) for item in DEFAULT_CANDIDATES]


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def metric_row_from_summary(candidate: CandidateSpec) -> dict[str, float] | None:
    for row in read_csv_rows(candidate.path / "summary_metrics.csv"):
        if row.get("split") == "test" and row.get("model") == candidate.model:
            return {
                "accuracy": float(row["accuracy_mean"]),
                "roc_auc": float(row["roc_auc_mean"]),
                "log_loss": float(row["log_loss_mean"]),
                "brier": float(row["brier_mean"]),
            }
    summary = read_json(candidate.path / "summary.json")
    if not summary:
        return None
    for row in summary.get("summary", []):
        if row.get("split") == "test" and row.get("model") == candidate.model:
            return {
                "accuracy": float(row["accuracy_mean"]),
                "roc_auc": float(row["roc_auc_mean"]),
                "log_loss": float(row["log_loss_mean"]),
                "brier": float(row["brier_mean"]),
            }
    return None


def metric_gates(
    phase: str,
    metrics: dict[str, float] | None,
    *,
    log_loss_regression_limit: float,
    brier_regression_limit: float,
    roc_auc_drop_limit: float,
) -> tuple[list[str], list[str]]:
    blockers: list[str] = []
    warnings: list[str] = []
    if metrics is None:
        return ["missing test metrics for requested model"], warnings

    baseline = BASELINE_METRICS[phase]
    if metrics["log_loss"] > baseline["log_loss"] + log_loss_regression_limit:
        blockers.append(
            f"log loss regresses beyond gate: candidate={metrics['log_loss']:.6f}, baseline={baseline['log_loss']:.6f}"
        )
    if metrics["brier"] > baseline["brier"] + brier_regression_limit:
        blockers.append(
            f"Brier regresses beyond gate: candidate={metrics['brier']:.6f}, baseline={baseline['brier']:.6f}"
        )
    if metrics["roc_auc"] < baseline["roc_auc"] - roc_auc_drop_limit:
        blockers.append(
            f"ROC-AUC drops beyond gate: candidate={metrics['roc_auc']:.6f}, baseline={baseline['roc_auc']:.6f}"
        )
    if metrics["accuracy"] < baseline["accuracy"]:
        warnings.append(
            f"accuracy is below deployed benchmark: candidate={metrics['accuracy']:.6f}, baseline={baseline['accuracy']:.6f}"
        )
    return blockers, warnings


def holdout_checks(manifest: dict[str, Any] | None, final_holdout_season: int) -> tuple[list[str], list[str]]:
    blockers: list[str] = []
    warnings: list[str] = []
    if manifest is None:
        return ["missing training_manifest.json"], warnings

    if manifest.get("finalHoldoutSeason") != final_holdout_season:
        blockers.append(f"finalHoldoutSeason is not {final_holdout_season}")

    folds = manifest.get("folds") or []
    if not folds:
        blockers.append("training manifest has no folds")
        return blockers, warnings

    for fold in folds:
        fold_name = fold.get("fold_name", "unknown")
        train_seasons = {int(season) for season in fold.get("train_seasons", [])}
        calibration_season = fold.get("calibration_season")
        validation_season = fold.get("validation_season")
        test_season = fold.get("test_season")
        if final_holdout_season in train_seasons:
            blockers.append(f"{fold_name}: final holdout appears in train_seasons")
        if calibration_season == final_holdout_season:
            blockers.append(f"{fold_name}: final holdout is calibration_season")
        if validation_season == final_holdout_season:
            blockers.append(f"{fold_name}: final holdout is validation_season")
        if test_season != final_holdout_season:
            warnings.append(f"{fold_name}: test_season is {test_season}, expected {final_holdout_season}")
    return blockers, warnings


def artifact_checks(candidate: CandidateSpec, manifest: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    blockers: list[str] = []
    warnings: list[str] = []
    if not candidate.path.exists():
        return [f"candidate path does not exist: {candidate.path}"], warnings
    if not (candidate.path / "fold_predictions.csv").exists():
        blockers.append("missing fold_predictions.csv")
    if not (candidate.path / "summary_metrics.csv").exists() and not (candidate.path / "summary.json").exists():
        blockers.append("missing summary_metrics.csv or summary.json")
    if manifest is None:
        warnings.append("candidate is not directly packageable because it has no training_manifest.json")
    else:
        model_files = list((candidate.path / "models").glob("*")) if (candidate.path / "models").exists() else []
        if not model_files:
            blockers.append("missing models/ artifact files")
        matrix_path = str(manifest.get("matrixPath", ""))
        if "model/experiments/" in matrix_path or "/model/experiments/" in matrix_path:
            warnings.append("manifest points at an experiment-local matrixPath; production packaging must rewrite this deliberately")
    return blockers, warnings


def sensitivity_check(candidate: CandidateSpec, sensitivity_report: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    if candidate.phase != "post_toss":
        return [], []
    if sensitivity_report is None:
        return ["post-toss candidate has not supplied a staged toss sensitivity/equivalence report"], []
    if not sensitivity_report.get("equivalent_states_match"):
        return ["post-toss equivalent batting-order states do not match"], []
    if not sensitivity_report.get("sensitive"):
        return ["post-toss sensitivity report did not pass the configured spread/equivalence gates"], []
    return [], []


def audit_candidate(
    candidate: CandidateSpec,
    args: argparse.Namespace,
    sensitivity_report: dict[str, Any] | None,
) -> dict[str, Any]:
    manifest = read_json(candidate.path / "training_manifest.json")
    metrics = metric_row_from_summary(candidate)

    blockers: list[str] = []
    warnings: list[str] = []
    for found_blockers, found_warnings in [
        artifact_checks(candidate, manifest),
        holdout_checks(manifest, args.final_holdout_season),
        metric_gates(
            candidate.phase,
            metrics,
            log_loss_regression_limit=args.log_loss_regression_limit,
            brier_regression_limit=args.brier_regression_limit,
            roc_auc_drop_limit=args.roc_auc_drop_limit,
        ),
        sensitivity_check(candidate, sensitivity_report),
    ]:
        blockers.extend(found_blockers)
        warnings.extend(found_warnings)

    return {
        "name": candidate.name,
        "phase": candidate.phase,
        "path": str(candidate.path),
        "model": candidate.model,
        "baseline": BASELINE_METRICS[candidate.phase],
        "metrics": metrics,
        "eligible": not blockers,
        "blockers": blockers,
        "warnings": warnings,
    }


def write_markdown(report: dict[str, Any], output_path: Path) -> None:
    lines = ["# Match model promotion eligibility report", ""]
    lines.append(f"Final holdout season: `{report['finalHoldoutSeason']}`")
    lines.append("")
    lines.append("| candidate | phase | eligible | accuracy | ROC-AUC | log loss | Brier | blockers |")
    lines.append("| --- | --- | --- | ---: | ---: | ---: | ---: | --- |")
    for candidate in report["candidates"]:
        metrics = candidate.get("metrics") or {}
        blocker_text = "; ".join(candidate["blockers"]) if candidate["blockers"] else "none"
        lines.append(
            "| {name} | {phase} | {eligible} | {accuracy} | {roc_auc} | {log_loss} | {brier} | {blockers} |".format(
                name=candidate["name"],
                phase=candidate["phase"],
                eligible="yes" if candidate["eligible"] else "no",
                accuracy=f"{metrics['accuracy']:.4f}" if metrics else "n/a",
                roc_auc=f"{metrics['roc_auc']:.4f}" if metrics else "n/a",
                log_loss=f"{metrics['log_loss']:.4f}" if metrics else "n/a",
                brier=f"{metrics['brier']:.4f}" if metrics else "n/a",
                blockers=blocker_text.replace("|", "\\|"),
            )
        )
    lines.append("")
    lines.append("## Warnings")
    lines.append("")
    for candidate in report["candidates"]:
        if not candidate["warnings"]:
            continue
        lines.append(f"### {candidate['name']}")
        for warning in candidate["warnings"]:
            lines.append(f"- {warning}")
        lines.append("")
    output_path.write_text("\n".join(lines).rstrip() + "\n")


def main() -> None:
    args = parse_args()
    candidate_specs = [parse_candidate(raw) for raw in args.candidate] if args.candidate else default_candidates()
    sensitivity_report = read_json(Path(args.post_toss_sensitivity_report)) if args.post_toss_sensitivity_report else None

    candidates = [audit_candidate(candidate, args, sensitivity_report) for candidate in candidate_specs]
    report = {
        "finalHoldoutSeason": args.final_holdout_season,
        "metricGates": {
            "logLossRegressionLimit": args.log_loss_regression_limit,
            "brierRegressionLimit": args.brier_regression_limit,
            "rocAucDropLimit": args.roc_auc_drop_limit,
        },
        "candidates": candidates,
    }

    output_dir = Path(args.output_dir)
    output_dir = output_dir if output_dir.is_absolute() else ROOT / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "promotion_eligibility_report.json").write_text(json.dumps(report, indent=2) + "\n")
    write_markdown(report, output_dir / "promotion_eligibility_report.md")

    for candidate in candidates:
        status = "eligible" if candidate["eligible"] else "blocked"
        print(f"{candidate['name']}: {status}")
        for blocker in candidate["blockers"]:
            print(f"  blocker: {blocker}")
        for warning in candidate["warnings"]:
            print(f"  warning: {warning}")
    print(f"\nWrote reports to {output_dir}")

    if args.strict and any(not candidate["eligible"] for candidate in candidates):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
