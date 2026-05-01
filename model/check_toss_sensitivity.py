from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
LIVE_DIR = ROOT / "model" / "data" / "live"
PREDICT_SCRIPT = ROOT / "model" / "predict_fixture.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate that post-toss XGBoost predictions move across toss permutations"
    )
    parser.add_argument("--fixture-id", required=True)
    parser.add_argument("--final-models-dir", default="model/final_models")
    parser.add_argument("--min-spread", type=float, default=0.001)
    parser.add_argument(
        "--max-equivalent-state-diff",
        type=float,
        default=1e-9,
        help="Maximum allowed probability difference for scenarios with the same batting order",
    )
    argv = __import__("sys").argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def load_fixture(fixture_id: str) -> pd.Series:
    json_path = LIVE_DIR / "upcoming_fixtures.json"
    if json_path.exists():
        fixtures = pd.DataFrame(json.loads(json_path.read_text()))
    else:
        fixtures = pd.read_csv(LIVE_DIR / "upcoming_fixtures.csv")
    fixtures["fixture_id"] = fixtures["fixture_id"].map(lambda value: "" if pd.isna(value) else str(value).strip())
    rows = fixtures[fixtures["fixture_id"] == str(fixture_id).strip()]
    if rows.empty:
        raise ValueError(f"Unknown fixture id: {fixture_id}")
    return rows.iloc[0]


def run_prediction(
    *, fixture_id: str, team: str, decision: str, final_models_dir: str
) -> dict[str, Any]:
    output = subprocess.check_output(
        [
            "python3",
            str(PREDICT_SCRIPT),
            "--fixture-id",
            fixture_id,
            "--mode",
            "post_toss",
            "--toss-winner",
            team,
            "--toss-decision",
            decision,
            "--final-models-dir",
            final_models_dir,
        ],
        cwd=ROOT,
        text=True,
    )
    return json.loads(output)


def main() -> None:
    args = parse_args()
    fixture = load_fixture(args.fixture_id)
    teams = [str(fixture["team1"]), str(fixture["team2"])]
    results = []

    for team in teams:
        for decision in ["bat", "field"]:
            payload = run_prediction(
                fixture_id=args.fixture_id,
                team=team,
                decision=decision,
                final_models_dir=args.final_models_dir,
            )
            results.append(
                {
                    "toss_winner": team,
                    "toss_decision": decision,
                    "team1_win_probability": float(payload["team1_win_probability"]),
                    "fair_price_team1_cents": payload["fair_price_team1_cents"],
                    "components": payload.get("components", []),
                }
            )

    probabilities = [entry["team1_win_probability"] for entry in results]
    spread = max(probabilities) - min(probabilities)
    team1_bats_first = [
        entry
        for entry in results
        if (entry["toss_winner"] == teams[0] and entry["toss_decision"] == "bat")
        or (entry["toss_winner"] == teams[1] and entry["toss_decision"] == "field")
    ]
    team2_bats_first = [
        entry
        for entry in results
        if (entry["toss_winner"] == teams[0] and entry["toss_decision"] == "field")
        or (entry["toss_winner"] == teams[1] and entry["toss_decision"] == "bat")
    ]
    equivalent_state_diffs = {
        "team1_bats_first": max(
            entry["team1_win_probability"] for entry in team1_bats_first
        )
        - min(entry["team1_win_probability"] for entry in team1_bats_first),
        "team2_bats_first": max(
            entry["team1_win_probability"] for entry in team2_bats_first
        )
        - min(entry["team1_win_probability"] for entry in team2_bats_first),
    }
    equivalent_states_match = all(
        diff <= args.max_equivalent_state_diff
        for diff in equivalent_state_diffs.values()
    )
    output = {
        "fixture_id": args.fixture_id,
        "final_models_dir": args.final_models_dir,
        "min_spread": args.min_spread,
        "max_equivalent_state_diff": args.max_equivalent_state_diff,
        "observed_spread": spread,
        "equivalent_state_diffs": equivalent_state_diffs,
        "equivalent_states_match": equivalent_states_match,
        "sensitive": spread >= args.min_spread and equivalent_states_match,
        "results": results,
    }
    print(json.dumps(output, indent=2))
    if not equivalent_states_match:
        raise SystemExit(
            "Equivalent batting-order states differ: "
            + json.dumps(equivalent_state_diffs, sort_keys=True)
        )
    if spread < args.min_spread:
        raise SystemExit(
            f"Toss sensitivity spread {spread:.6f} below threshold {args.min_spread:.6f}"
        )


if __name__ == "__main__":
    main()
