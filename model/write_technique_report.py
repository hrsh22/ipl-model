from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write a markdown report of historical and experimental model techniques"
    )
    parser.add_argument(
        "--root",
        action="append",
        required=True,
        help="Technique root in the form label:path or just path",
    )
    parser.add_argument("--output", required=True, help="Markdown output path")
    parser.add_argument(
        "--focus-split",
        default="test",
        help="Primary split to highlight in the leaderboard",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def parse_root(raw_value: str, cwd: Path) -> tuple[str, Path]:
    if ":" in raw_value and not raw_value.startswith("/"):
        label, _, path_text = raw_value.partition(":")
    else:
        path_text = raw_value
        label = Path(raw_value).name or "techniques"
    path = Path(path_text)
    resolved = path if path.is_absolute() else (cwd / path).resolve()
    return label or resolved.name, resolved


def extract_matrix(relative_path: str) -> str:
    if "pre_toss" in relative_path:
        return "pre_toss"
    if "post_toss" in relative_path:
        return "post_toss"
    return "unknown"


def read_summary_metrics(root_label: str, root_path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for summary_file in sorted(root_path.rglob("summary_metrics.csv")):
        frame = pd.read_csv(summary_file)
        relative_dir = summary_file.parent.relative_to(root_path).as_posix()
        matrix = extract_matrix(relative_dir)
        for record in frame.to_dict(orient="records"):
            rows.append(
                {
                    "root_label": root_label,
                    "matrix": matrix,
                    "source_dir": relative_dir,
                    "model": record.get("model", "unknown"),
                    "split": record.get("split", "unknown"),
                    "accuracy_mean": record.get("accuracy_mean"),
                    "roc_auc_mean": record.get("roc_auc_mean"),
                    "log_loss_mean": record.get("log_loss_mean"),
                    "brier_mean": record.get("brier_mean"),
                    "summary_path": str(summary_file),
                }
            )
    return rows


def read_summary_json(root_label: str, root_path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for summary_file in sorted(root_path.rglob("summary.json")):
        if (summary_file.parent / "summary_metrics.csv").exists():
            continue
        payload = json.loads(summary_file.read_text())
        relative_dir = summary_file.parent.relative_to(root_path).as_posix()
        matrix = extract_matrix(relative_dir)

        if "summary" in payload and isinstance(payload["summary"], list):
            for record in payload["summary"]:
                rows.append(
                    {
                        "root_label": root_label,
                        "matrix": matrix,
                        "source_dir": relative_dir,
                        "model": payload.get("model", "summary_json"),
                        "split": record.get("split", "unknown"),
                        "accuracy_mean": record.get("accuracy_mean"),
                        "roc_auc_mean": record.get("roc_auc_mean"),
                        "log_loss_mean": record.get("log_loss_mean"),
                        "brier_mean": record.get("brier_mean"),
                        "summary_path": str(summary_file),
                    }
                )
            continue

        if "test_metrics" in payload:
            for split_name in ["validation_metrics", "test_metrics"]:
                metrics = payload.get(split_name)
                if not isinstance(metrics, dict):
                    continue
                rows.append(
                    {
                        "root_label": root_label,
                        "matrix": matrix,
                        "source_dir": relative_dir,
                        "model": "ensemble_summary",
                        "split": split_name.removesuffix("_metrics"),
                        "accuracy_mean": metrics.get("accuracy"),
                        "roc_auc_mean": metrics.get("roc_auc"),
                        "log_loss_mean": metrics.get("log_loss"),
                        "brier_mean": metrics.get("brier"),
                        "summary_path": str(summary_file),
                    }
                )
    return rows


def format_number(value: object) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{float(value):.4f}"


def markdown_table(frame: pd.DataFrame) -> str:
    if frame.empty:
        return "_No rows found._"
    columns = list(frame.columns)
    header = "| " + " | ".join(columns) + " |"
    divider = "| " + " | ".join(["---"] * len(columns)) + " |"
    body = [
        "| " + " | ".join(str(row[column]) for column in columns) + " |"
        for _, row in frame.iterrows()
    ]
    return "\n".join([header, divider, *body])


def main() -> None:
    args = parse_args()
    cwd = Path.cwd()
    roots = [parse_root(raw_value, cwd) for raw_value in args.root]

    rows: list[dict[str, object]] = []
    for root_label, root_path in roots:
        rows.extend(read_summary_metrics(root_label, root_path))
        rows.extend(read_summary_json(root_label, root_path))

    if not rows:
        raise ValueError("No technique summaries found in the requested roots")

    frame = pd.DataFrame(rows).drop_duplicates(
        subset=["root_label", "matrix", "source_dir", "model", "split", "summary_path"]
    )
    focus = frame[frame["split"] == args.focus_split].copy()
    focus = focus.sort_values(
        ["matrix", "log_loss_mean", "brier_mean", "roc_auc_mean", "accuracy_mean"],
        ascending=[True, True, True, False, False],
    )

    matrix_sections: list[str] = []
    for matrix_name in sorted(frame["matrix"].dropna().unique()):
        matrix_frame = frame[(frame["matrix"] == matrix_name) & (frame["split"] == args.focus_split)].copy()
        if matrix_frame.empty:
            continue
        rendered = matrix_frame[[
            "root_label",
            "source_dir",
            "model",
            "accuracy_mean",
            "roc_auc_mean",
            "log_loss_mean",
            "brier_mean",
        ]].copy()
        for column in ["accuracy_mean", "roc_auc_mean", "log_loss_mean", "brier_mean"]:
            rendered[column] = rendered[column].map(format_number)
        matrix_sections.append(f"## {matrix_name}\n\n{markdown_table(rendered)}")

    top_focus = focus.head(20).copy()
    for column in ["accuracy_mean", "roc_auc_mean", "log_loss_mean", "brier_mean"]:
        top_focus[column] = top_focus[column].map(format_number)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n\n".join(
        [
            "# IPL model techniques and performance",
            "This report combines historical technique summaries already present in the repo with new experiment outputs. Metrics are walk-forward averages unless the source only stored a summary JSON.",
            "## Overall leaderboard (focus split)",
            markdown_table(top_focus[[
                "matrix",
                "root_label",
                "source_dir",
                "model",
                "accuracy_mean",
                "roc_auc_mean",
                "log_loss_mean",
                "brier_mean",
            ]]),
            *matrix_sections,
            "## Data sources",
            "\n".join(f"- `{label}` → `{path}`" for label, path in roots),
        ]
    )
    output_path.write_text(content + "\n")
    print(f"Wrote technique report to {output_path}")


if __name__ == "__main__":
    main()
