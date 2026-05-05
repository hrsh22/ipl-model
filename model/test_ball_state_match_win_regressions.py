#!/usr/bin/env python3
"""Focused regressions for first-innings ball-state win probability."""

from __future__ import annotations

import json
from pathlib import Path

from backtest_ball_state_2026_official import target_innings
from shadow_score_ball_state_live import target_applicable
from train_ball_state import CLASSIFICATION_TARGET_INNINGS


ROOT = Path(__file__).resolve().parents[1]
SELECTION_MANIFEST = ROOT / "model" / "ball_state_live_candidate_selection.json"
OBSERVER_SERVICE = ROOT / "src" / "observer" / "service.ts"


def assert_first_innings_training_contract() -> None:
    assert CLASSIFICATION_TARGET_INNINGS["batting_team_match_win"] == 1
    assert target_innings("batting_team_match_win") == 1
    assert target_innings("chase_success") == 2


def assert_shadow_scoring_contract() -> None:
    assert target_applicable({"expectedState": {"innings": 1}}, "batting_team_match_win") == (True, None)
    assert target_applicable({"expectedState": {"innings": 2}}, "batting_team_match_win") == (
        False,
        "batting_team_match_win requires innings 1",
    )
    assert target_applicable({"expectedState": {"innings": 2}}, "chase_success") == (True, None)
    assert target_applicable({"expectedState": {"innings": 1}}, "chase_success") == (
        False,
        "chase_success requires innings 2",
    )


def assert_runtime_manifest_contract() -> None:
    selection = json.loads(SELECTION_MANIFEST.read_text())
    match_win = selection["selected"]["batting_team_match_win"]

    assert match_win["target_innings"] == 1
    assert match_win["feature_mode"] == "live_compatible"
    assert match_win["source_artifact"].endswith(
        "stable_depth4_lr003_l28_match_win_innings1/batting_team_match_win_model.joblib",
    )

    backtest = match_win["official_2026_first_innings_backtest"]
    assert backtest["matches_scored"] == 44
    assert backtest["scored_ball_states"] == 5185
    assert backtest["log_loss"] < 0.6535480436303313
    assert backtest["brier"] < 0.23176767511030322
    assert backtest["roc_auc"] > 0.691107693670774
    assert backtest["final_state_match_accuracy"] >= 0.6590909090909091


def assert_observer_innings_gate() -> None:
    source = OBSERVER_SERVICE.read_text()
    assert "innings === 1 ? ballStateOverlay.predictions.battingTeamMatchWinProbability : null" in source
    assert "innings === 2 ? ballStateOverlay.predictions.chaseSuccessProbability : null" in source
    assert "chaseSuccessProbability: terminalProbability ?? (innings === 2" in source


def main() -> None:
    assert_first_innings_training_contract()
    assert_shadow_scoring_contract()
    assert_runtime_manifest_contract()
    assert_observer_innings_gate()
    print("ball-state match-win regressions passed")


if __name__ == "__main__":
    main()
