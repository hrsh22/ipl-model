from __future__ import annotations

import argparse
import json
import sys
from hashlib import sha256
from pathlib import Path
from typing import Any

import pandas as pd

import predict_fixture as predictor


ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "model"
CANONICAL_MANIFEST_PATH = MODEL_DIR / "data" / "metadata" / "model_matrix_manifest.json"
COMPLETED_RESULTS_2026_PATH = MODEL_DIR / "data" / "live" / "completed_results_2026.csv"
PRESEASON_ROSTERS_2026_PATH = MODEL_DIR / "data" / "features" / "preseason_team_rosters_2026.csv"
PRESEASON_PRIORS_2026_PATH = MODEL_DIR / "data" / "features" / "preseason_team_prior_overrides_2026.csv"
MATCH_SQUADS_PATH = MODEL_DIR / "data" / "staged" / "match_squads.csv"

INACTIVE_ROSTER_STATUSES = {
    "injured",
    "injury-replacement-out",
    "released",
    "replaced-out",
    "unavailable",
    "withdrawn",
}

PRIOR_COLUMN_MAP = {
    "team_probable_xi_strength": "probableXiStrength",
    "team_top3_strength": "top3Strength",
    "team_middle_order_strength": "middleOrderStrength",
    "team_finisher_strength": "finisherStrength",
    "team_powerplay_bowling_strength": "powerplayBowlingStrength",
    "team_death_bowling_strength": "deathBowlingStrength",
    "team_spin_strength": "teamSpinStrength",
    "team_pace_strength": "teamPaceStrength",
    "team_xi_continuity_score": "xiContinuityScore",
    "batting_resource_score": "battingResourceScore",
    "bowling_resource_score": "bowlingResourceScore",
    "net_resource_score": "netResourceScore",
    "likely_xi_matches_used": "likelyXiMatchesUsed",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build experiment-only IPL matrices with 2026 preseason squad overlays"
    )
    parser.add_argument(
        "--name",
        default="squad-info-2026",
        help="Experiment name under model/experiments/",
    )
    parser.add_argument(
        "--completed-results",
        default=str(COMPLETED_RESULTS_2026_PATH.relative_to(ROOT)),
        help="Completed 2026 result rows used only as holdout labels",
    )
    parser.add_argument(
        "--preseason-rosters",
        default=str(PRESEASON_ROSTERS_2026_PATH.relative_to(ROOT)),
        help="Dated 2026 preseason roster sidecar",
    )
    parser.add_argument(
        "--preseason-priors",
        default=str(PRESEASON_PRIORS_2026_PATH.relative_to(ROOT)),
        help="Optional dated 2026 preseason numeric prior sidecar",
    )
    parser.add_argument(
        "--include-post-toss",
        action="store_true",
        help="Also append 2026 post-toss holdout rows when toss context is available",
    )
    parser.add_argument(
        "--no-remote-toss",
        action="store_true",
        help="Do not fetch official schedule rows for post-toss toss context",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def resolve_repo_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def normalize_player_key(name: str) -> str:
    return predictor.normalize_player_name_key(name)


def load_preseason_rosters(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    required = {"season", "team", "source_date", "player_name", "roster_status"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"preseason roster sidecar missing columns: {', '.join(sorted(missing))}")
    frame["source_date"] = pd.to_datetime(frame["source_date"], errors="coerce")
    frame["player_key"] = frame["player_name"].map(normalize_player_key)
    return frame[frame["source_date"].notna()].copy()


def load_preseason_priors(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    if frame.empty:
        return frame
    required = {"season", "team", "source_date"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"preseason prior sidecar missing columns: {', '.join(sorted(missing))}")
    frame["source_date"] = pd.to_datetime(frame["source_date"], errors="coerce")
    return frame[frame["source_date"].notna()].copy()


def load_match_squads() -> pd.DataFrame:
    frame = pd.read_csv(MATCH_SQUADS_PATH)
    required = {"team", "match_date", "player_name"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"historical match squads missing columns: {', '.join(sorted(missing))}")
    frame["match_date"] = pd.to_datetime(frame["match_date"], errors="coerce")
    frame["player_key"] = frame["player_name"].map(normalize_player_key)
    return frame[frame["match_date"].notna()].copy()


def latest_historical_home(venue: str, before: pd.Timestamp) -> str | None:
    matchup = pd.read_csv(MODEL_DIR / "data" / "features" / "training_ready_matchup_features.csv")
    matchup["match_date"] = pd.to_datetime(matchup["match_date"], errors="coerce")
    rows = matchup[(matchup["venue"] == venue) & (matchup["match_date"] < before)].copy()
    if rows.empty or "home_team" not in rows.columns:
        return None
    value = rows.sort_values("match_date").iloc[-1].get("home_team")
    return str(value) if pd.notna(value) else None


def team_context(team: str, home_team: str | None) -> str:
    if not home_team:
        return "unknown"
    return "home" if team == home_team else "away"


def build_fixture_payload(row: pd.Series) -> dict[str, Any]:
    match_date = pd.Timestamp(row["match_date"])
    home_team = latest_historical_home(str(row["venue"]), match_date)
    return {
        "fixture_id": str(row["match_id"]),
        "opticodds_game_id": "",
        "official_match_id": str(row["match_id"]),
        "match_date": match_date.strftime("%Y-%m-%dT00:00:00.000Z"),
        "status": "completed_holdout",
        "is_live": False,
        "is_completed": True,
        "venue": row["venue"],
        "venue_location": row.get("city", ""),
        "city": row.get("city", ""),
        "team1": row["team1"],
        "team2": row["team2"],
        "home_team_from_feed": home_team or "",
        "away_team_from_feed": "",
        "inferred_home_team": home_team or "",
        "team1_home_context": team_context(str(row["team1"]), home_team),
        "team2_home_context": team_context(str(row["team2"]), home_team),
        "match_neutral_flag": False,
    }


def build_predictor_args(
    *, fixture: dict[str, Any], mode: str, toss_winner: str | None = None, toss_decision: str | None = None
) -> argparse.Namespace:
    return argparse.Namespace(
        fixture_id=str(fixture["fixture_id"]),
        fixture_row_json=json.dumps(fixture),
        mode=mode,
        list_fixtures=False,
        describe_context=False,
        toss_winner=toss_winner,
        toss_decision=toss_decision,
        feature_overrides_json=None,
        team1_probable_xi_json=None,
        team2_probable_xi_json=None,
        probable_xi_source="manual",
        final_models_dir=None,
    )


def roster_overlay(
    *, team: str, prefix: str, season: int, before: pd.Timestamp, rosters: pd.DataFrame, squads: pd.DataFrame
) -> dict[str, Any]:
    roster_rows = active_roster_rows(team=team, season=season, before=before, rosters=rosters)
    if roster_rows.empty:
        return {}

    historical_rows = squads[(squads["team"] == team) & (squads["match_date"] < before)]
    if historical_rows.empty:
        return {}

    latest_date = historical_rows["match_date"].max()
    latest_keys = {key for key in historical_rows[historical_rows["match_date"] == latest_date]["player_key"] if key}
    roster_keys = {key for key in roster_rows["player_key"] if key}
    if not latest_keys:
        return {}

    continuity = len(latest_keys.intersection(roster_keys)) / len(latest_keys)
    roster_status = roster_rows["roster_status"].astype(str).str.strip().str.lower()
    retained_count = int((roster_status == "retained").sum())
    traded_in_count = int((roster_status == "traded-in").sum())
    return {
        f"{prefix}_xiContinuityScore": continuity,
        f"{prefix}_overallXiContinuity": continuity,
        f"__{prefix}_preseasonRosterSize": int(roster_rows.shape[0]),
        f"__{prefix}_preseasonRetainedCount": retained_count,
        f"__{prefix}_preseasonTradedInCount": traded_in_count,
    }


def active_roster_rows(*, team: str, season: int, before: pd.Timestamp, rosters: pd.DataFrame) -> pd.DataFrame:
    rows = rosters[
        (rosters["team"] == team)
        & (rosters["season"] == season)
        & (rosters["source_date"] <= before)
    ].copy()
    if rows.empty:
        return rows
    rows["__row_order"] = range(len(rows))
    rows = rows.sort_values(["player_key", "source_date", "__row_order"]).groupby("player_key", as_index=False).tail(1)
    status = rows["roster_status"].astype(str).str.strip().str.lower()
    return rows[~status.isin(INACTIVE_ROSTER_STATUSES)].drop(columns=["__row_order"]).copy()


def preseason_likely_xi_overlay(
    *, team: str, prefix: str, season: int, match_date: str, before: pd.Timestamp, rosters: pd.DataFrame
) -> tuple[dict[str, Any], dict[str, Any]]:
    roster_rows = active_roster_rows(team=team, season=season, before=before, rosters=rosters)
    roster_names = [str(name).strip() for name in roster_rows["player_name"] if str(name).strip()]
    if len(roster_names) < 11:
        return {}, {
            "available": False,
            "reason": "fewer_than_11_active_preseason_roster_players",
            "roster_size": len(roster_names),
        }

    suggestions = predictor.build_named_xi_suggestions(
        team,
        roster_names,
        [],
        "preseason_2026_roster",
    )
    selected_xi = list(suggestions.get("suggested_xi", []) or [])
    if len(selected_xi) != 11:
        return {}, {
            "available": False,
            "reason": "unable_to_select_11_from_preseason_roster",
            "roster_size": len(roster_names),
            "selected_count": len(selected_xi),
        }

    xi_overrides = predictor.build_manual_probable_xi_overrides(
        team,
        season,
        match_date,
        selected_xi,
    )
    return {f"{prefix}_{key}": value for key, value in xi_overrides.items()}, {
        "available": True,
        "roster_size": len(roster_names),
        "selected_xi": selected_xi,
    }


def prior_overlay(*, team: str, prefix: str, season: int, before: pd.Timestamp, priors: pd.DataFrame) -> dict[str, Any]:
    if priors.empty:
        return {}
    rows = priors[
        (priors["team"] == team)
        & (priors["season"] == season)
        & (priors["source_date"] <= before)
    ].copy()
    if rows.empty:
        return {}
    row = rows.sort_values("source_date").iloc[-1]
    overlay: dict[str, Any] = {}
    for source_column, feature_suffix in PRIOR_COLUMN_MAP.items():
        if source_column not in row.index:
            continue
        value = row.get(source_column)
        if pd.isna(value):
            continue
        overlay[f"{prefix}_{feature_suffix}"] = value
    return overlay


def apply_squad_overlays(
    base_row: dict[str, Any], completed_row: pd.Series, rosters: pd.DataFrame, priors: pd.DataFrame, squads: pd.DataFrame
) -> tuple[dict[str, Any], dict[str, Any]]:
    output = dict(base_row)
    before = pd.Timestamp(completed_row["match_date"])
    season = int(completed_row["season"])
    summary: dict[str, Any] = {}
    for prefix, team_key in [("team1", "team1"), ("team2", "team2")]:
        team = str(completed_row[team_key])
        likely_xi, likely_xi_summary = preseason_likely_xi_overlay(
            team=team,
            prefix=prefix,
            season=season,
            match_date=str(completed_row["match_date"]),
            before=before,
            rosters=rosters,
        )
        output.update(likely_xi)
        output.update(roster_overlay(team=team, prefix=prefix, season=season, before=before, rosters=rosters, squads=squads))
        output.update(prior_overlay(team=team, prefix=prefix, season=season, before=before, priors=priors))
        summary[prefix] = likely_xi_summary
    return output, summary


def select_matrix_row(base_row: dict[str, Any], matrix_columns: list[str], target: int) -> dict[str, Any]:
    row = {column: base_row.get(column) for column in matrix_columns}
    row["target_team1_won"] = target
    return row


def toss_context(fixture: dict[str, Any], no_remote_toss: bool) -> tuple[str, str] | None:
    if no_remote_toss:
        return None
    official = predictor.resolve_iplt20_match(pd.Series(fixture))
    if not official:
        return None
    toss_team = predictor.canonical_fixture_team_name(pd.Series(fixture), str(official.get("TossTeam") or "").strip())
    details = str(official.get("TossDetails") or "").lower()
    if not toss_team or not details:
        return None
    toss_decision = "field" if any(token in details for token in ["field", "bowl"]) else "bat"
    return toss_team, toss_decision


def build_holdout_rows(
    *,
    matrix: str,
    canonical_matrix: pd.DataFrame,
    completed: pd.DataFrame,
    rosters: pd.DataFrame,
    priors: pd.DataFrame,
    squads: pd.DataFrame,
    include_post_toss: bool,
    no_remote_toss: bool,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    matrix_columns = list(canonical_matrix.columns)
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    squad_overlay_summaries: list[dict[str, Any]] = []

    original_official_context = predictor.fetch_official_post_toss_context
    predictor.fetch_official_post_toss_context = lambda fixture: {}
    try:
        for _, completed_row in completed.iterrows():
            if str(completed_row.get("result_type")) != "won" or not str(completed_row.get("winner", "")).strip():
                continue
            fixture = build_fixture_payload(completed_row)
            target = 1 if completed_row["winner"] == completed_row["team1"] else 0
            mode = "post_toss" if matrix == "post_toss" else "pre_toss"
            toss = None
            if mode == "post_toss":
                if not include_post_toss:
                    skipped.append({"match_id": fixture["fixture_id"], "reason": "post_toss_disabled"})
                    continue
                toss = toss_context(fixture, no_remote_toss)
                if toss is None:
                    skipped.append({"match_id": fixture["fixture_id"], "reason": "toss_context_unavailable"})
                    continue
            args = build_predictor_args(
                fixture=fixture,
                mode=mode,
                toss_winner=toss[0] if toss else None,
                toss_decision=toss[1] if toss else None,
            )
            base_row = predictor.build_base_row(args)
            base_row["match_id"] = str(completed_row["match_id"])
            base_row["season"] = int(completed_row["season"])
            base_row["match_date"] = pd.Timestamp(completed_row["match_date"]).strftime("%Y-%m-%d")
            base_row, squad_overlay_summary = apply_squad_overlays(base_row, completed_row, rosters, priors, squads)
            squad_overlay_summaries.append({
                "match_id": str(completed_row["match_id"]),
                "team1": str(completed_row["team1"]),
                "team2": str(completed_row["team2"]),
                "team1_overlay": squad_overlay_summary.get("team1", {}),
                "team2_overlay": squad_overlay_summary.get("team2", {}),
            })
            rows.append(select_matrix_row(base_row, matrix_columns, target))
    finally:
        predictor.fetch_official_post_toss_context = original_official_context

    return pd.DataFrame(rows, columns=matrix_columns), skipped, squad_overlay_summaries


def update_manifest_section(section: dict[str, Any], matrix_path: Path, matrix_frame: pd.DataFrame) -> dict[str, Any]:
    output = dict(section)
    output["rows"] = int(matrix_frame.shape[0])
    output["columns"] = int(matrix_frame.shape[1])
    output["matrixPath"] = str(matrix_path)
    output["matrixSha256"] = file_sha256(matrix_path)
    output["availableSeasons"] = sorted(int(season) for season in matrix_frame["season"].dropna().unique())
    return output


def main() -> None:
    args = parse_args()
    experiment_root = (MODEL_DIR / "experiments" / args.name).resolve()
    final_models_root = (MODEL_DIR / "final_models").resolve()
    if final_models_root in experiment_root.parents or experiment_root == final_models_root:
        raise ValueError("Experiment output must not be inside model/final_models")

    data_dir = experiment_root / "data"
    matrices_dir = data_dir / "matrices"
    metadata_dir = data_dir / "metadata"
    reports_dir = experiment_root / "reports"
    for directory in (matrices_dir, metadata_dir, reports_dir):
        directory.mkdir(parents=True, exist_ok=True)

    completed_path = resolve_repo_path(args.completed_results)
    roster_path = resolve_repo_path(args.preseason_rosters)
    prior_path = resolve_repo_path(args.preseason_priors)
    canonical_manifest = json.loads(CANONICAL_MANIFEST_PATH.read_text())
    completed = pd.read_csv(completed_path)
    rosters = load_preseason_rosters(roster_path)
    priors = load_preseason_priors(prior_path)
    squads = load_match_squads()

    output_manifest = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "experiment": args.name,
        "note": "Experiment-only matrix manifest. Do not use for production final_models promotion without separate review.",
    }
    report: dict[str, Any] = {
        "experiment": args.name,
        "canonicalManifest": str(CANONICAL_MANIFEST_PATH),
        "completedResults": str(completed_path),
        "preseasonRosters": str(roster_path),
        "preseasonPriors": str(prior_path),
        "leakageControls": [
            "Canonical training rows are copied from the existing <=2025 matrices.",
            "2026 completed rows are appended only as the final holdout season.",
            "2026 preseason roster/prior rows are date-gated by source_date <= match_date.",
            "Official squad feeds are disabled while building experiment rows to avoid in-play impact-player leakage.",
            "Outputs are written under model/experiments and never under model/final_models.",
        ],
        "matrices": {},
    }

    for manifest_key, matrix_name, output_file in [
        ("preToss", "pre_toss", "pre_toss_squad_info_model_matrix.csv"),
        ("postToss", "post_toss", "post_toss_squad_info_model_matrix.csv"),
    ]:
        section = canonical_manifest[manifest_key]
        source_matrix_path = predictor.resolve_repo_path(section["matrixPath"])
        canonical_matrix = pd.read_csv(source_matrix_path)
        holdout, skipped, squad_overlay_summaries = build_holdout_rows(
            matrix=matrix_name,
            canonical_matrix=canonical_matrix,
            completed=completed,
            rosters=rosters,
            priors=priors,
            squads=squads,
            include_post_toss=args.include_post_toss,
            no_remote_toss=args.no_remote_toss,
        )
        experiment_matrix = pd.concat([canonical_matrix, holdout], ignore_index=True)
        matrix_path = matrices_dir / output_file
        experiment_matrix.to_csv(matrix_path, index=False)
        output_manifest[manifest_key] = update_manifest_section(section, matrix_path, experiment_matrix)
        holdout_path = matrices_dir / output_file.replace("_model_matrix.csv", "_holdout_2026.csv")
        holdout.to_csv(holdout_path, index=False)
        report["matrices"][matrix_name] = {
            "sourceRows": int(canonical_matrix.shape[0]),
            "holdoutRows2026": int(holdout.shape[0]),
            "totalRows": int(experiment_matrix.shape[0]),
            "availableSeasons": output_manifest[manifest_key]["availableSeasons"],
            "skippedHoldoutRows": skipped,
            "squadOverlaySummaries": squad_overlay_summaries,
            "matrixPath": str(matrix_path),
            "holdoutPath": str(holdout_path),
            "splitContract": {
                "trainAndCalibrationSeasons": "all seasons before 2026, with the trainer reserving the latest prior season for calibration",
                "testSeason": 2026,
                "testRowsAreNeverTrainingRows": True,
            },
        }

    manifest_path = metadata_dir / "squad_info_model_matrix_manifest.json"
    manifest_path.write_text(json.dumps(output_manifest, indent=2) + "\n")
    report["nextCommands"] = [
        f"python3 model/train_baselines.py --matrix pre_toss --manifest-path {manifest_path.relative_to(ROOT)} --artifacts-dir model/experiments/{args.name}/artifacts --run-label squad_info_full --final-holdout-season 2026",
        f"python3 model/train_xgboost.py --matrix pre_toss --manifest-path {manifest_path.relative_to(ROOT)} --artifacts-dir model/experiments/{args.name}/artifacts --run-label xgboost_squad_info_full --final-holdout-season 2026",
    ]
    if args.include_post_toss:
        report["nextCommands"].extend([
            f"python3 model/train_baselines.py --matrix post_toss --manifest-path {manifest_path.relative_to(ROOT)} --artifacts-dir model/experiments/{args.name}/artifacts --run-label squad_info_full --final-holdout-season 2026",
            f"python3 model/train_xgboost.py --matrix post_toss --manifest-path {manifest_path.relative_to(ROOT)} --artifacts-dir model/experiments/{args.name}/artifacts --run-label xgboost_squad_info_full --final-holdout-season 2026",
        ])
    report_path = reports_dir / "squad_info_matrix_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote squad-info experiment manifest: {manifest_path.relative_to(ROOT)}")
    print(f"Wrote squad-info experiment report: {report_path.relative_to(ROOT)}")
    print(json.dumps(report["matrices"], indent=2))


if __name__ == "__main__":
    main()
