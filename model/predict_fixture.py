from __future__ import annotations

import argparse
import functools
import joblib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path, PurePath
from typing import Any

import pandas as pd
from catboost import CatBoostClassifier
try:
    from xgboost import Booster, DMatrix
except ImportError:  # pragma: no cover - optional until XGBoost promotion is used
    Booster = None
    DMatrix = None

from train_baselines import (
    apply_isotonic_calibrator,
    apply_platt_calibrator,
    build_feature_view,
    load_feature_allowlist,
    prepare_dataframe,
)


MODEL_DIR = Path(__file__).resolve().parent
ROOT = MODEL_DIR.parent
DATA_DIR = MODEL_DIR / "data"
LIVE_DIR = DATA_DIR / "live"
FEATURES_DIR = DATA_DIR / "features"
FINAL_MODELS_DIR = MODEL_DIR / "final_models"
MODEL_MATRIX_MANIFEST_PATH = DATA_DIR / "metadata" / "model_matrix_manifest.json"
FIXTURE_OVERRIDES_PATH = LIVE_DIR / "fixture_overrides.json"
RAW_MATCH_INFO_PATH = DATA_DIR / "raw" / "cricsheet_match_info.csv"
COMPLETED_RESULTS_2026_PATH = LIVE_DIR / "completed_results_2026.csv"

OPTICODDS_BASE_URL = "https://api.opticodds.com/api/v3"
OPTICODDS_SPORTSBOOKS = [
    "betfair_exchange",
    "1xbet",
    "parimatch_india_",
    "opticodds_ai",
]

IPLT20_COMPETITION_URL = "https://scores.iplt20.com/ipl/mc/competition.js"
IPLT20_SCHEDULE_URL_TEMPLATE = (
    "https://scores.iplt20.com/ipl/feeds/{competition_id}-matchschedule.js"
)
IPLT20_SQUAD_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-squad.js"


def load_local_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def resolve_repo_path(
    path_value: str | Path, *, final_models_dir: Path = FINAL_MODELS_DIR
) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate

    if not candidate.is_absolute():
        for base in (ROOT, MODEL_DIR, final_models_dir, DATA_DIR):
            rebased = (base / candidate).resolve()
            if rebased.exists():
                return rebased
        return (ROOT / candidate).resolve()

    parts = PurePath(candidate).parts
    if "model" in parts:
        model_index = parts.index("model")
        rebased = (ROOT / Path(*parts[model_index:])).resolve()
        if rebased.exists():
            return rebased

    if "final_models" in parts:
        final_models_index = parts.index("final_models")
        rebased = (final_models_dir / Path(*parts[final_models_index + 1 :])).resolve()
        if rebased.exists():
            return rebased

    if "data" in parts:
        data_index = parts.index("data")
        rebased = (DATA_DIR / Path(*parts[data_index + 1 :])).resolve()
        if rebased.exists():
            return rebased

    return candidate


TEAM_ALIASES = {
    "Royal Challengers Bengaluru": [
        "Royal Challengers Bengaluru",
        "Royal Challengers Bangalore",
        "RCB",
    ],
    "Delhi Capitals": ["Delhi Capitals", "Delhi", "DC"],
    "Sunrisers Hyderabad": ["Sunrisers Hyderabad", "SRH"],
    "Chennai Super Kings": ["Chennai Super Kings", "CSK"],
    "Kolkata Knight Riders": ["Kolkata Knight Riders", "KKR"],
    "Rajasthan Royals": ["Rajasthan Royals", "RR"],
    "Punjab Kings": ["Punjab Kings", "Kings XI Punjab", "PBKS", "KXIP"],
    "Lucknow Super Giants": ["Lucknow Super Giants", "LSG"],
    "Gujarat Titans": ["Gujarat Titans", "GT"],
    "Mumbai Indians": ["Mumbai Indians", "MI"],
}

POLYMARKET_TEAM_SLUG_TOKENS = {
    "Royal Challengers Bengaluru": "roy",
    "Delhi Capitals": "del",
    "Sunrisers Hyderabad": "sun",
    "Chennai Super Kings": "che",
    "Kolkata Knight Riders": "kol",
    "Rajasthan Royals": "raj",
    "Punjab Kings": "pun",
    "Lucknow Super Giants": "luc",
    "Gujarat Titans": "guj",
    "Mumbai Indians": "mum",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Predict IPL fixture win probabilities"
    )
    parser.add_argument("--fixture-id", help="Fixture id from upcoming_fixtures.csv")
    parser.add_argument(
        "--fixture-row-json",
        default=None,
        help="Optional JSON object describing a historical fixture row for backfill use",
    )
    parser.add_argument("--mode", choices=["pre_toss", "post_toss"], default="pre_toss")
    parser.add_argument("--list-fixtures", action="store_true")
    parser.add_argument("--describe-context", action="store_true")
    parser.add_argument("--toss-winner", default=None)
    parser.add_argument("--toss-decision", default=None)
    parser.add_argument(
        "--feature-overrides-json",
        default=None,
        help="Optional JSON object of direct feature overrides",
    )
    parser.add_argument(
        "--team1-probable-xi-json",
        default=None,
        help="Optional JSON array of selected probable XI player names for team1",
    )
    parser.add_argument(
        "--team2-probable-xi-json",
        default=None,
        help="Optional JSON array of selected probable XI player names for team2",
    )
    parser.add_argument(
        "--final-models-dir",
        default=None,
        help="Optional alternate final_models directory for staged promotion validation",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


def load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path)


def safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        if pd.isna(value):
            return 0.0
    except Exception:
        pass
    try:
        return float(value)
    except Exception:
        return 0.0


def safe_mean(values: pd.Series) -> float:
    if values.empty:
        return 0.0
    return float(pd.to_numeric(values, errors="coerce").dropna().mean())


def normalize_timestamp(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert(None)
    return timestamp


def list_fixtures() -> None:
    fixtures = load_csv(LIVE_DIR / "upcoming_fixtures.csv")
    print(
        fixtures[["fixture_id", "match_date", "team1", "team2", "venue"]].to_string(
            index=False
        )
    )


def load_fixture_row_from_args(args: argparse.Namespace) -> pd.Series:
    fixtures = load_csv(LIVE_DIR / "upcoming_fixtures.csv")
    fixture_row = fixtures[fixtures["fixture_id"] == args.fixture_id]
    if not fixture_row.empty:
        return fixture_row.iloc[0]

    if args.fixture_row_json:
        payload = json.loads(args.fixture_row_json)
        if not isinstance(payload, dict):
            raise ValueError("fixture-row-json must be a JSON object")
        return pd.Series(payload)

    raise ValueError(f"Unknown fixture id: {args.fixture_id}")


def build_historical_elo_row(fixture: pd.Series) -> pd.Series:
    matches = load_completed_match_context().copy()
    target_match_date = normalize_timestamp(fixture["match_date"])
    target_match_id = str(fixture.get("official_match_id") or fixture.get("fixture_id") or "")

    def is_before_target(row: pd.Series) -> bool:
        match_date = normalize_timestamp(row["match_date"])
        if match_date < target_match_date:
            return True
        if match_date > target_match_date:
            return False
        if target_match_id and str(row["match_id"]).isdigit() and target_match_id.isdigit():
            return int(str(row["match_id"])) < int(target_match_id)
        return str(row["match_id"]) < target_match_id

    prior_matches = matches[matches.apply(is_before_target, axis=1)].sort_values(
        ["match_date", "match_id"]
    )

    elo_ratings: dict[str, float] = {}
    for row in prior_matches.itertuples(index=False):
        team1 = str(row.team1)
        team2 = str(row.team2)
        winner = str(row.winner)
        team1_elo = elo_ratings.get(team1, 1500.0)
        team2_elo = elo_ratings.get(team2, 1500.0)
        expected_team1 = 1 / (1 + 10 ** ((team2_elo - team1_elo) / 400))
        score_team1 = 1.0 if winner == team1 else 0.0
        k_factor = 20.0
        elo_ratings[team1] = team1_elo + k_factor * (score_team1 - expected_team1)
        elo_ratings[team2] = team2_elo + k_factor * ((1.0 - score_team1) - (1.0 - expected_team1))

    team1 = str(fixture["team1"])
    team2 = str(fixture["team2"])
    team1_elo = elo_ratings.get(team1, 1500.0)
    team2_elo = elo_ratings.get(team2, 1500.0)
    expected_team1 = 1 / (1 + 10 ** ((team2_elo - team1_elo) / 400))
    return pd.Series(
        {
            "fixture_id": fixture["fixture_id"],
            "team1_elo": team1_elo,
            "team2_elo": team2_elo,
            "elo_gap": team1_elo - team2_elo,
            "elo_expected_team1_win": expected_team1,
            "elo_expected_team2_win": 1 - expected_team1,
        }
    )


def normalize_text(value: str) -> str:
    return "".join(
        character.lower()
        for character in value
        if character.isalnum() or character.isspace()
    ).strip()


def normalize_player_name_key(value: str) -> str:
    return normalize_text(value)


def strip_player_suffixes(value: str) -> str:
    return re.sub(r"\s*\((?:c|wk|vc|ip|rp)\)\s*", " ", value, flags=re.I).strip()


def normalize_probability(value: float | int | str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed / 100.0 if parsed > 1 else parsed


def alias_tokens(team: str) -> list[str]:
    return [normalize_text(alias) for alias in TEAM_ALIASES.get(team, [team])]


def build_polymarket_slug_candidates(
    team1: str, team2: str, match_date: str | None
) -> list[str]:
    if not match_date:
        return []

    date_token = str(match_date)[:10]
    team1_token = POLYMARKET_TEAM_SLUG_TOKENS.get(team1)
    team2_token = POLYMARKET_TEAM_SLUG_TOKENS.get(team2)
    if not team1_token or not team2_token:
        return []

    candidates = [
        f"cricipl-{team1_token}-{team2_token}-{date_token}",
        f"cricipl-{team2_token}-{team1_token}-{date_token}",
    ]
    return list(dict.fromkeys(candidates))


def extract_market_probabilities(
    market: dict[str, Any], team1: str, team2: str
) -> dict[str, Any] | None:
    question = str(market.get("question", ""))
    raw_outcomes = market.get("outcomes", [])
    raw_prices = market.get("outcomePrices", [])
    outcomes = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes
    prices = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
    if not isinstance(outcomes, list) or not isinstance(prices, list):
        return None

    team1_aliases = alias_tokens(team1)
    team2_aliases = alias_tokens(team2)
    team1_price = None
    team2_price = None
    for outcome, price in zip(outcomes, prices, strict=False):
        normalized_outcome = normalize_text(str(outcome))
        if team1_price is None and any(
            alias in normalized_outcome for alias in team1_aliases
        ):
            team1_price = float(price)
        if team2_price is None and any(
            alias in normalized_outcome for alias in team2_aliases
        ):
            team2_price = float(price)

    if team1_price is None or team2_price is None:
        return None

    return {
        "source": "polymarket",
        "question": question,
        "slug": market.get("slug"),
        "market_id": market.get("id"),
        "team1_market_probability": team1_price,
        "team2_market_probability": team2_price,
        "volume": float(market.get("volume", 0) or 0),
        "liquidity": float(market.get("liquidity", 0) or 0),
        "best_bid": market.get("bestBid"),
        "best_ask": market.get("bestAsk"),
        "spread": market.get("spread"),
    }


def fetch_polymarket_market_by_slug(
    team1: str, team2: str, slug: str
) -> dict[str, Any] | None:
    url = f"https://gamma-api.polymarket.com/markets?slug={urllib.parse.quote(slug)}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except Exception:
        return None

    markets = payload if isinstance(payload, list) else payload.get("data", [])
    for market in markets:
        parsed = extract_market_probabilities(market, team1, team2)
        if parsed is not None:
            return parsed
    return None


def normalize_selection_key(value: str) -> str:
    return "_".join(value.strip().lower().replace("-", " ").replace("_", " ").split())


def infer_team1_bats_first(
    team1: str, team2: str, toss_winner: str, toss_decision: str
) -> float | None:
    if toss_winner not in {team1, team2}:
        return None
    if toss_decision == "bat":
        return 1.0 if toss_winner == team1 else 0.0
    if toss_decision == "field":
        return 0.0 if toss_winner == team1 else 1.0
    return None


def infer_team_bats_first(row: pd.Series, team: str) -> float | None:
    team1_bats_first = row.get("team1_bats_first")
    if team1_bats_first is None or pd.isna(team1_bats_first):
        return None
    if row["team1"] == team:
        return float(team1_bats_first)
    if row["team2"] == team:
        return float(1.0 - float(team1_bats_first))
    return None


@functools.lru_cache(maxsize=1)
def load_training_matchup_history() -> pd.DataFrame:
    frame = load_csv(FEATURES_DIR / "training_ready_matchup_features.csv").copy()
    frame["match_id"] = frame["match_id"].astype(str)
    frame["match_date"] = pd.to_datetime(frame["match_date"]).map(normalize_timestamp)
    frame["season"] = pd.to_numeric(frame["season"], errors="coerce").fillna(0).astype(int)
    frame["team1_won"] = frame["team1_won"].astype(str).str.lower() == "true"
    return frame


@functools.lru_cache(maxsize=1)
def load_raw_match_info() -> pd.DataFrame:
    frame = load_csv(RAW_MATCH_INFO_PATH).copy()
    frame["match_id"] = frame["match_id"].astype(str)
    frame["season"] = pd.to_numeric(frame["season"], errors="coerce").fillna(0).astype(int)
    frame["match_date"] = pd.to_datetime(frame["match_date"]).map(normalize_timestamp)
    for column in [
        "venue",
        "team1",
        "team2",
        "toss_winner",
        "toss_decision",
        "winner",
    ]:
        frame[column] = frame[column].fillna("").astype(str).str.strip()
    return frame


@functools.lru_cache(maxsize=1)
def load_completed_match_context() -> pd.DataFrame:
    historical = load_training_matchup_history()[
        ["match_id", "season", "match_date", "venue", "team1", "team2", "team1_won"]
    ].copy()
    raw_info = load_raw_match_info()[
        ["match_id", "toss_winner", "toss_decision", "winner"]
    ].copy()
    historical = historical.merge(raw_info, on="match_id", how="left")
    historical["winner"] = [
        row.team1 if bool(row.team1_won) else row.team2
        for row in historical.itertuples(index=False)
    ]
    historical["team1_bats_first"] = [
        infer_team1_bats_first(
            str(row.team1),
            str(row.team2),
            str(row.toss_winner),
            str(row.toss_decision),
        )
        for row in historical.itertuples(index=False)
    ]

    current_raw = load_raw_match_info().copy()
    current_raw = current_raw[
        (current_raw["season"] == 2026) & (current_raw["winner"] != "")
    ][["match_id", "season", "match_date", "venue", "team1", "team2", "winner", "toss_winner", "toss_decision"]]
    current_raw["team1_won"] = current_raw["winner"] == current_raw["team1"]
    current_raw["team1_bats_first"] = [
        infer_team1_bats_first(
            str(row.team1),
            str(row.team2),
            str(row.toss_winner),
            str(row.toss_decision),
        )
        for row in current_raw.itertuples(index=False)
    ]

    if COMPLETED_RESULTS_2026_PATH.exists():
        supplement = load_csv(COMPLETED_RESULTS_2026_PATH).copy()
        supplement["match_id"] = supplement["match_id"].astype(str)
        supplement["season"] = pd.to_numeric(supplement["season"], errors="coerce").fillna(0).astype(int)
        supplement["match_date"] = pd.to_datetime(supplement["match_date"]).map(normalize_timestamp)
        for column in ["venue", "team1", "team2", "winner"]:
            supplement[column] = supplement[column].fillna("").astype(str).str.strip()
        supplement["toss_winner"] = ""
        supplement["toss_decision"] = ""
        supplement["team1_won"] = supplement["winner"] == supplement["team1"]
        supplement["team1_bats_first"] = pd.NA
        supplement = supplement[
            [
                "match_id",
                "season",
                "match_date",
                "venue",
                "team1",
                "team2",
                "winner",
                "toss_winner",
                "toss_decision",
                "team1_won",
                "team1_bats_first",
            ]
        ]
    else:
        supplement = pd.DataFrame(
            columns=[
                "match_id",
                "season",
                "match_date",
                "venue",
                "team1",
                "team2",
                "winner",
                "toss_winner",
                "toss_decision",
                "team1_won",
                "team1_bats_first",
            ]
        )

    for frame in [historical, current_raw, supplement]:
        if "team1_bats_first" in frame.columns:
            frame["team1_bats_first"] = frame["team1_bats_first"].astype(object)
    frames = [frame for frame in [historical, current_raw, supplement] if not frame.empty]
    combined = pd.concat(frames, ignore_index=True)
    combined = combined.sort_values(["match_date", "match_id"]).drop_duplicates(
        subset=["match_id"], keep="last"
    )
    return combined.reset_index(drop=True)


def build_team_result_rows(matches: pd.DataFrame, team: str) -> pd.DataFrame:
    rows = matches[(matches["team1"] == team) | (matches["team2"] == team)].copy()
    if rows.empty:
        return rows
    rows["won_match"] = rows["winner"] == team
    rows["opponent"] = rows.apply(
        lambda row: row["team2"] if row["team1"] == team else row["team1"], axis=1
    )
    rows["batting_first"] = [
        infer_team_bats_first(row, team) for _, row in rows.iterrows()
    ]
    rows["toss_won"] = rows["toss_winner"] == team
    rows = rows.sort_values(["match_date", "match_id"]).reset_index(drop=True)
    return rows


def compute_team_metadata_overrides(
    matches: pd.DataFrame, team: str, venue: str, match_date: pd.Timestamp
) -> dict[str, float]:
    team_rows = build_team_result_rows(matches, team)
    if team_rows.empty:
        return {
            "overallWinRateBeforeMatch": 0.0,
            "recentWinRateLast5": 0.0,
            "recentWinRateLast10": 0.0,
            "last3YearWinRate": 0.0,
            "venueWinRate": 0.0,
            "chasingWinRate": 0.0,
            "battingFirstWinRate": 0.0,
            "tossWinRate": 0.0,
            "prefersFieldAfterToss": 0.0,
            "restDays": 0.0,
            "historicalMatchesUsed": 0.0,
        }

    recent5 = team_rows.tail(5)
    recent10 = team_rows.tail(10)
    last_three_years = team_rows[
        team_rows["match_date"] >= (match_date - pd.DateOffset(years=3))
    ]
    venue_rows = team_rows[team_rows["venue"] == venue]
    chasing_rows = team_rows[team_rows["batting_first"] == 0.0]
    batting_first_rows = team_rows[team_rows["batting_first"] == 1.0]
    toss_wins = team_rows[team_rows["toss_won"]]
    previous_match = team_rows.iloc[-1]
    rest_days = float((match_date - previous_match["match_date"]).days)

    return {
        "overallWinRateBeforeMatch": safe_mean(team_rows["won_match"]),
        "recentWinRateLast5": safe_mean(recent5["won_match"]),
        "recentWinRateLast10": safe_mean(recent10["won_match"]),
        "last3YearWinRate": safe_mean(last_three_years["won_match"]),
        "venueWinRate": safe_mean(venue_rows["won_match"]),
        "chasingWinRate": safe_mean(chasing_rows["won_match"]),
        "battingFirstWinRate": safe_mean(batting_first_rows["won_match"]),
        "tossWinRate": safe_mean(team_rows["toss_won"]),
        "prefersFieldAfterToss": safe_mean(
            toss_wins["toss_decision"].eq("field")
        ),
        "restDays": rest_days,
        "historicalMatchesUsed": float(len(team_rows)),
    }


def compute_pair_metadata_overrides(
    matches: pd.DataFrame, team1: str, team2: str, venue: str
) -> dict[str, float]:
    pair_rows = matches[
        ((matches["team1"] == team1) & (matches["team2"] == team2))
        | ((matches["team1"] == team2) & (matches["team2"] == team1))
    ].sort_values(["match_date", "match_id"])
    if pair_rows.empty:
        return {
            "team1_h2h_win_rate_vs_team2": 0.0,
            "team2_h2h_win_rate_vs_team1": 0.0,
            "last_5_h2h_team1_win_rate": 0.0,
            "venue_h2h_win_rate": 0.0,
        }

    team1_wins = pair_rows.apply(
        lambda row: bool(row["winner"] == team1), axis=1
    )
    venue_rows = pair_rows[pair_rows["venue"] == venue]
    venue_team1_wins = venue_rows.apply(
        lambda row: bool(row["winner"] == team1), axis=1
    )

    return {
        "team1_h2h_win_rate_vs_team2": safe_mean(team1_wins),
        "team2_h2h_win_rate_vs_team1": 1.0 - safe_mean(team1_wins),
        "last_5_h2h_team1_win_rate": safe_mean(team1_wins.tail(5)),
        "venue_h2h_win_rate": safe_mean(venue_team1_wins),
    }


def compute_venue_match_metadata_overrides(
    matches: pd.DataFrame, venue: str
) -> dict[str, float]:
    venue_rows = matches[matches["venue"] == venue].copy()
    if venue_rows.empty:
        return {
            "venue_chasing_win_rate": 0.0,
            "venue_batting_first_win_rate": 0.0,
            "venue_toss_winner_win_rate": 0.0,
            "venue_field_first_win_rate": 0.0,
            "venue_bat_first_win_rate": 0.0,
        }

    def winner_bats_first(row: pd.Series) -> float | None:
        team1_bats_first = row.get("team1_bats_first")
        if team1_bats_first is None or pd.isna(team1_bats_first):
            return None
        if row["winner"] == row["team1"]:
            return float(team1_bats_first)
        if row["winner"] == row["team2"]:
            return float(1.0 - float(team1_bats_first))
        return None

    venue_rows["winner_bats_first"] = [
        winner_bats_first(row) for _, row in venue_rows.iterrows()
    ]
    known_batting_order = venue_rows[venue_rows["winner_bats_first"].notna()].copy()
    field_first_rows = venue_rows[venue_rows["toss_decision"] == "field"].copy()
    field_first_rows["winner_bats_second"] = field_first_rows[
        "winner_bats_first"
    ].map(lambda value: None if pd.isna(value) else float(1.0 - float(value)))

    venue_batting_first_win_rate = safe_mean(known_batting_order["winner_bats_first"])

    return {
        "venue_chasing_win_rate": safe_mean(
            known_batting_order["winner_bats_first"].map(lambda value: 1.0 - float(value))
        ),
        "venue_batting_first_win_rate": venue_batting_first_win_rate,
        "venue_toss_winner_win_rate": safe_mean(
            venue_rows[venue_rows["toss_winner"] != ""].apply(
                lambda row: bool(row["toss_winner"] == row["winner"]), axis=1
            )
        ),
        "venue_field_first_win_rate": safe_mean(field_first_rows["winner_bats_second"]),
        "venue_bat_first_win_rate": venue_batting_first_win_rate,
    }


def build_live_feature_refresh(
    fixture: pd.Series, live_elo: pd.Series
) -> tuple[dict[str, Any], dict[str, Any]]:
    target_match_date = normalize_timestamp(fixture["match_date"])
    team1 = str(fixture["team1"])
    team2 = str(fixture["team2"])
    venue = str(fixture["venue"])
    matches = load_completed_match_context()
    matches = matches[matches["match_date"] < target_match_date].copy()

    team1_overrides = compute_team_metadata_overrides(matches, team1, venue, target_match_date)
    team2_overrides = compute_team_metadata_overrides(matches, team2, venue, target_match_date)
    pair_overrides = compute_pair_metadata_overrides(matches, team1, team2, venue)
    venue_overrides = compute_venue_match_metadata_overrides(matches, venue)

    feature_overrides: dict[str, Any] = {
        **pair_overrides,
        **venue_overrides,
        **{f"team1_{key}": value for key, value in team1_overrides.items()},
        **{f"team2_{key}": value for key, value in team2_overrides.items()},
    }
    feature_overrides["recent_win_rate_gap"] = (
        safe_float(feature_overrides.get("team1_recentWinRateLast10"))
        - safe_float(feature_overrides.get("team2_recentWinRateLast10"))
    )
    feature_overrides["chasing_strength_gap"] = (
        safe_float(feature_overrides.get("team1_chasingWinRate"))
        - safe_float(feature_overrides.get("team2_chasingWinRate"))
    )
    feature_overrides["batting_first_gap"] = (
        safe_float(feature_overrides.get("team1_battingFirstWinRate"))
        - safe_float(feature_overrides.get("team2_battingFirstWinRate"))
    )
    feature_overrides["elo_gap"] = safe_float(live_elo["elo_gap"])
    feature_overrides["elo_expected_team1_win"] = safe_float(
        live_elo["elo_expected_team1_win"]
    )

    summary = {
        "applied": True,
        "completed_matches_considered": int(matches.shape[0]),
        "current_season_matches_considered": int(
            matches[matches["season"] == 2026].shape[0]
        ),
        "updated_feature_groups": ["team_form", "h2h", "venue_toss"],
    }
    return feature_overrides, summary


def extract_jsonp_payload(text: str, callback_name: str) -> Any:
    pattern = rf"{callback_name}\((.*)\)\s*;?\s*$"
    match = re.search(pattern, text, re.S)
    if not match:
        raise ValueError(f"Unable to parse JSONP payload for {callback_name}")
    return json.loads(match.group(1))


@functools.lru_cache(maxsize=4)
def fetch_iplt20_competition_map() -> dict[int, dict[str, Any]]:
    request = urllib.request.Request(
        IPLT20_COMPETITION_URL,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = extract_jsonp_payload(response.read().decode("utf-8"), "oncomptetion")
    competitions = payload.get("competition", []) if isinstance(payload, dict) else []
    result: dict[int, dict[str, Any]] = {}
    for competition in competitions:
        if str(competition.get("DivisionName", "")).upper() != "IPL":
            continue
        season_name = competition.get("CompetitionName", "")
        season_match = re.search(r"(20\d{2})", season_name)
        if not season_match:
            continue
        result[int(season_match.group(1))] = competition
    return result


@functools.lru_cache(maxsize=8)
def fetch_iplt20_schedule(season_year: int) -> list[dict[str, Any]]:
    competition_map = fetch_iplt20_competition_map()
    competition = competition_map.get(season_year)
    if not competition:
        return []
    url = IPLT20_SCHEDULE_URL_TEMPLATE.format(
        competition_id=competition["CompetitionID"]
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = extract_jsonp_payload(
            response.read().decode("utf-8"), "MatchSchedule"
        )
    return payload.get("Matchsummary", []) if isinstance(payload, dict) else []


@functools.lru_cache(maxsize=32)
def fetch_iplt20_confirmed_squads(match_id: int) -> dict[str, list[dict[str, Any]]]:
    url = IPLT20_SQUAD_URL_TEMPLATE.format(match_id=match_id)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = extract_jsonp_payload(response.read().decode("utf-8"), "onsquad")
    if not isinstance(payload, dict):
        return {"squadA": [], "squadB": []}
    return {
        "squadA": payload.get("squadA", []) or [],
        "squadB": payload.get("squadB", []) or [],
    }


def resolve_iplt20_match(fixture: pd.Series) -> dict[str, Any] | None:
    season_year = pd.Timestamp(fixture["match_date"]).year
    schedule_rows = fetch_iplt20_schedule(season_year)
    fixture_date = str(fixture["match_date"])[:10]
    team_names = {
        normalize_text(str(fixture["team1"])),
        normalize_text(str(fixture["team2"])),
    }

    for row in schedule_rows:
        if str(row.get("MatchDate")) != fixture_date:
            continue
        row_names = {
            normalize_text(str(row.get("HomeTeamName", ""))),
            normalize_text(str(row.get("AwayTeamName", ""))),
        }
        if team_names == row_names:
            return row
    return None


def classify_bowling_family(value: str) -> str:
    normalized = normalize_text(value)
    if not normalized:
        return "unknown"
    if any(
        token in normalized
        for token in ["off", "leg", "spin", "orthodox", "chinaman", "wrist"]
    ):
        return "spin"
    if any(token in normalized for token in ["fast", "medium", "pace", "seam"]):
        return "pace"
    return "unknown"


def canonicalize_official_role(player_skill: str, is_wk: str) -> str:
    normalized = normalize_text(player_skill)
    if is_wk == "1":
        return "keeper_batter"
    if "all rounder" in normalized or "allrounder" in normalized:
        return "all_rounder"
    if "bowler" in normalized:
        return "bowler"
    if "batsman" in normalized or "batter" in normalized:
        return "batter"
    return "unknown"


@functools.lru_cache(maxsize=1)
def load_player_match_history() -> pd.DataFrame:
    frame = load_csv(DATA_DIR / "staged" / "player_match_stats.csv").copy()
    frame["player_name_key"] = frame["player_name"].map(normalize_player_name_key)
    frame["match_date"] = pd.to_datetime(frame["match_date"])
    numeric_columns = [
        "batting_position",
        "batting_runs",
        "batting_balls",
        "dismissed",
        "bowling_balls",
        "death_bowling_balls",
        "runs_conceded",
        "wickets",
        "dot_balls_bowled",
    ]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
    return frame


@functools.lru_cache(maxsize=1)
def load_player_style_history() -> pd.DataFrame:
    frame = load_csv(DATA_DIR / "staged" / "player_style_profiles.csv").copy()
    frame["player_name_key"] = frame["player_name_key"].map(normalize_player_name_key)
    return frame


@functools.lru_cache(maxsize=1)
def load_match_squads_history() -> pd.DataFrame:
    frame = load_csv(DATA_DIR / "staged" / "match_squads.csv").copy()
    frame["player_name_key"] = frame["player_name"].map(normalize_player_name_key)
    frame["match_date"] = pd.to_datetime(frame["match_date"])
    return frame


def build_team_player_aggregates(team: str) -> tuple[dict[str, Any], dict[str, Any]]:
    history = load_player_match_history()
    styles = load_player_style_history()
    team_history = history[history["team"] == team].copy()
    grouped = team_history.groupby("player_name_key", as_index=False).agg(
        player_name=("player_name", "last"),
        appearances=("match_id", "nunique"),
        batting_runs=("batting_runs", "sum"),
        batting_balls=("batting_balls", "sum"),
        batting_position_mean=(
            "batting_position",
            lambda s: s[s > 0].mean() if (s > 0).any() else 0,
        ),
        bowling_balls=("bowling_balls", "sum"),
        death_bowling_balls=("death_bowling_balls", "sum"),
        runs_conceded=("runs_conceded", "sum"),
        wickets=("wickets", "sum"),
        dot_balls_bowled=("dot_balls_bowled", "sum"),
    )
    grouped = grouped.merge(
        styles[["player_name_key", "bowling_style_family", "role_canonical"]],
        on="player_name_key",
        how="left",
    )
    grouped["bowling_style_family"] = grouped["bowling_style_family"].fillna("unknown")
    grouped["role_canonical"] = grouped["role_canonical"].fillna("unknown")

    profiles: dict[str, Any] = {}
    team_role_batting_values: dict[str, list[float]] = {}
    team_role_bowling_values: dict[str, list[float]] = {}

    for row in grouped.to_dict("records"):
        appearances = max(1, int(row["appearances"]))
        batting_runs = float(row["batting_runs"])
        batting_balls = float(row["batting_balls"])
        wickets = float(row["wickets"])
        bowling_balls = float(row["bowling_balls"])
        death_bowling_balls = float(row["death_bowling_balls"])
        runs_conceded = float(row["runs_conceded"])
        dot_balls = float(row["dot_balls_bowled"])
        batting_strength = batting_runs / appearances + (
            0.1 * (batting_runs * 100 / batting_balls) if batting_balls > 0 else 0
        )
        economy = (runs_conceded * 6 / bowling_balls) if bowling_balls > 0 else 10.0
        bowling_strength = (
            (wickets / appearances) * 20
            + max(0.0, 10.0 - economy)
            + ((dot_balls / bowling_balls) * 10 if bowling_balls > 0 else 0)
        )
        profile = {
            **row,
            "batting_strength": batting_strength,
            "bowling_strength": bowling_strength,
        }
        profiles[row["player_name_key"]] = profile
        role = row["role_canonical"]
        team_role_batting_values.setdefault(role, []).append(batting_strength)
        team_role_bowling_values.setdefault(role, []).append(bowling_strength)

    priors = {
        role: {
            "batting": sum(values) / len(values) if values else 0.0,
            "bowling": sum(team_role_bowling_values.get(role, []))
            / len(team_role_bowling_values.get(role, []))
            if team_role_bowling_values.get(role)
            else 0.0,
        }
        for role, values in team_role_batting_values.items()
    }
    priors.setdefault("batter", {"batting": 12.0, "bowling": 0.0})
    priors.setdefault("bowler", {"batting": 2.0, "bowling": 10.0})
    priors.setdefault("all_rounder", {"batting": 8.0, "bowling": 8.0})
    priors.setdefault("keeper_batter", {"batting": 10.0, "bowling": 0.0})
    priors.setdefault("unknown", {"batting": 6.0, "bowling": 4.0})
    return profiles, priors


def build_key_player_sets(team: str) -> dict[str, set[str]]:
    history = load_player_match_history()
    team_history = history[history["team"] == team].copy()
    if team_history.empty:
        return {
            "key_batters": set(),
            "key_bowlers": set(),
            "death_bowlers": set(),
            "openers": set(),
        }

    grouped = team_history.groupby("player_name_key", as_index=False).agg(
        appearances=("match_id", "nunique"),
        batting_top5=("batting_position", lambda s: int((s.between(1, 5)).sum())),
        opener_count=("batting_position", lambda s: int((s.between(1, 2)).sum())),
        bowling_balls=("bowling_balls", "sum"),
        death_bowling_balls=("death_bowling_balls", "sum"),
    )
    return {
        "key_batters": set(
            grouped.sort_values(["batting_top5", "appearances"], ascending=False).head(
                3
            )["player_name_key"]
        ),
        "key_bowlers": set(
            grouped.sort_values(["bowling_balls", "appearances"], ascending=False).head(
                3
            )["player_name_key"]
        ),
        "death_bowlers": set(
            grouped.sort_values(
                ["death_bowling_balls", "bowling_balls"], ascending=False
            ).head(2)["player_name_key"]
        ),
        "openers": set(
            grouped.sort_values(["opener_count", "appearances"], ascending=False).head(
                2
            )["player_name_key"]
        ),
    }


def role_to_player_skill(role: str) -> str:
    normalized = normalize_text(role)
    if "keeper" in normalized:
        return "Batter"
    if "bowling all rounder" in normalized:
        return "Bowling Allrounder"
    if "batting all rounder" in normalized:
        return "Batting Allrounder"
    if "all rounder" in normalized or "allrounder" in normalized:
        return "All Rounder"
    if normalized == "bowler":
        return "Bowler"
    return "Batter"


def estimate_playing_order(
    profile: dict[str, Any], fallback_index: int
) -> tuple[int, float]:
    batting_position = safe_float(profile.get("batting_position_mean"))
    if batting_position > 0:
        return max(1, int(round(batting_position))), batting_position

    role = str(profile.get("role_canonical") or "unknown")
    normalized_role = normalize_text(role)
    if "keeper" in normalized_role or normalized_role == "batter":
        return min(fallback_index, 6), 99.0
    if "all rounder" in normalized_role or "allrounder" in normalized_role:
        return min(max(fallback_index, 5), 8), 99.0
    return max(fallback_index, 8), 99.0


def parse_string_array(raw_value: str | None, field_name: str) -> list[str]:
    if not raw_value:
        return []
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as error:
        raise ValueError(f"{field_name} must be a valid JSON array") from error
    if not isinstance(payload, list):
        raise ValueError(f"{field_name} must be a JSON array")
    return [str(item).strip() for item in payload if str(item).strip()]


def build_manual_probable_xi_overrides(
    team: str, season: int, match_date: str, player_names: list[str]
) -> dict[str, Any]:
    profiles, _ = build_team_player_aggregates(team)
    normalized_players: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for raw_name in player_names:
        name = strip_player_suffixes(str(raw_name).strip())
        if not name:
            continue
        key = normalize_player_name_key(name)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        profile = profiles.get(key, {})
        fallback_index = len(normalized_players) + 1
        estimated_order, sort_order = estimate_playing_order(profile, fallback_index)
        role = str(profile.get("role_canonical") or "unknown")
        normalized_players.append(
            {
                "PlayerName": name,
                "PlayerSkill": role_to_player_skill(role),
                "IsWK": "1" if "keeper" in normalize_text(role) else "0",
                "BowlingProficiency": str(
                    profile.get("bowling_style_family") or "unknown"
                ),
                "_estimated_order": estimated_order,
                "_sort_order": sort_order,
            }
        )

    normalized_players.sort(
        key=lambda player: (
            int(player["_estimated_order"]),
            float(player["_sort_order"]),
            normalize_text(str(player["PlayerName"])),
        )
    )

    xi_players = []
    for index, player in enumerate(normalized_players, start=1):
        xi_players.append(
            {
                "PlayerName": player["PlayerName"],
                "PlayerSkill": player["PlayerSkill"],
                "IsWK": player["IsWK"],
                "BowlingProficiency": player["BowlingProficiency"],
                "PlayingOrder": index,
            }
        )

    if not xi_players:
        return {}
    return build_xi_overrides(team, season, match_date, xi_players)


def build_probable_xi_suggestions(
    team: str, season: int, match_date: str
) -> dict[str, Any]:
    squad_history = load_match_squads_history()
    target_match_date = pd.Timestamp(match_date)
    if target_match_date.tzinfo is not None:
        target_match_date = target_match_date.tz_convert(None)

    previous_squads = squad_history[
        (squad_history["team"] == team)
        & (squad_history["match_date"] < target_match_date)
        & (squad_history["match_date"].dt.year == season)
    ].copy()
    if previous_squads.empty:
        return {
            "available": False,
            "suggested_xi": [],
            "candidate_pool": [],
            "matches_considered": 0,
            "source": "same_season_recent_squads",
        }

    recent_match_index = (
        previous_squads[["match_id", "match_date"]]
        .drop_duplicates()
        .sort_values(["match_date", "match_id"])
    )
    recent_match_ids = list(recent_match_index.tail(8)["match_id"])
    candidate_squads = previous_squads[
        previous_squads["match_id"].isin(recent_match_ids)
    ].copy()
    latest_match_id = str(recent_match_index.iloc[-1]["match_id"])
    latest_squad = candidate_squads[candidate_squads["match_id"].astype(str) == latest_match_id]
    latest_keys = set(latest_squad["player_name_key"])

    profiles, _ = build_team_player_aggregates(team)
    key_sets = build_key_player_sets(team)
    grouped = (
        candidate_squads.groupby("player_name_key", as_index=False)
        .agg(
            player_name=("player_name", "last"),
            recent_appearances=("match_id", "nunique"),
            last_seen=("match_date", "max"),
        )
        .sort_values(["recent_appearances", "last_seen"], ascending=[False, False])
    )

    candidate_rows: list[dict[str, Any]] = []
    for row in grouped.to_dict("records"):
        key = str(row["player_name_key"])
        profile = profiles.get(key, {})
        estimated_order, display_order = estimate_playing_order(
            profile, len(candidate_rows) + 1
        )
        role = str(profile.get("role_canonical") or "unknown")
        candidate_rows.append(
            {
                "name": str(row["player_name"]),
                "key": key,
                "recent_appearances": int(row["recent_appearances"]),
                "last_seen": pd.Timestamp(row["last_seen"]).strftime("%Y-%m-%d"),
                "batting_order_estimate": int(estimated_order),
                "role": role,
                "style_family": str(profile.get("bowling_style_family") or "unknown"),
                "suggested": key in latest_keys,
                "is_key_batter": key in key_sets["key_batters"],
                "is_key_bowler": key in key_sets["key_bowlers"],
                "is_death_bowler": key in key_sets["death_bowlers"],
                "is_opener": key in key_sets["openers"],
                "_display_order": float(display_order),
                "_bowling_strength": safe_float(profile.get("bowling_strength")),
            }
        )

    candidate_rows.sort(
        key=lambda row: (
            0 if row["suggested"] else 1,
            -int(row["recent_appearances"]),
            int(row["batting_order_estimate"]),
            -float(row["_bowling_strength"]),
            normalize_text(str(row["name"])),
        )
    )

    suggested_rows = [row for row in candidate_rows if row["suggested"]]
    suggested_rows.sort(
        key=lambda row: (
            int(row["batting_order_estimate"]),
            float(row["_display_order"]),
            normalize_text(str(row["name"])),
        )
    )
    suggested_xi = [row["name"] for row in suggested_rows[:11]]
    if len(suggested_xi) < 11:
        existing = {normalize_player_name_key(name) for name in suggested_xi}
        for row in candidate_rows:
            key = normalize_player_name_key(str(row["name"]))
            if key in existing:
                continue
            suggested_xi.append(str(row["name"]))
            existing.add(key)
            if len(suggested_xi) == 11:
                break

    for row in candidate_rows:
        row.pop("_display_order", None)
        row.pop("_bowling_strength", None)

    return {
        "available": True,
        "suggested_xi": suggested_xi,
        "candidate_pool": candidate_rows,
        "matches_considered": int(recent_match_index.shape[0]),
        "source": "same_season_recent_squads",
    }


def build_named_xi_suggestions(
    team: str,
    candidate_names: list[str],
    suggested_names: list[str],
    source: str,
) -> dict[str, Any]:
    normalized_candidates: list[str] = []
    seen: set[str] = set()
    for raw_name in candidate_names:
        name = strip_player_suffixes(str(raw_name).strip())
        if not name:
            continue
        key = normalize_player_name_key(name)
        if key in seen:
            continue
        seen.add(key)
        normalized_candidates.append(name)

    if not normalized_candidates:
        return {
            "available": False,
            "suggested_xi": [],
            "candidate_pool": [],
            "matches_considered": 0,
            "source": source,
        }

    profiles, _ = build_team_player_aggregates(team)
    key_sets = build_key_player_sets(team)
    suggested_order = {
        normalize_player_name_key(name): index + 1
        for index, name in enumerate(suggested_names)
    }

    candidate_rows: list[dict[str, Any]] = []
    for fallback_index, name in enumerate(normalized_candidates, start=1):
        key = normalize_player_name_key(name)
        profile = profiles.get(key, {})
        role = str(profile.get("role_canonical") or "unknown")
        estimated_order, display_order = estimate_playing_order(profile, fallback_index)
        order_override = suggested_order.get(key)
        if order_override is not None:
            estimated_order = order_override
            display_order = float(order_override)
        candidate_rows.append(
            {
                "name": name,
                "key": key,
                "recent_appearances": int(profile.get("match_count") or 0),
                "last_seen": str(profile.get("last_match_date") or "official_feed"),
                "batting_order_estimate": int(estimated_order),
                "role": role,
                "style_family": str(profile.get("bowling_style_family") or "unknown"),
                "suggested": key in suggested_order,
                "is_key_batter": key in key_sets["key_batters"],
                "is_key_bowler": key in key_sets["key_bowlers"],
                "is_death_bowler": key in key_sets["death_bowlers"],
                "is_opener": key in key_sets["openers"],
                "_display_order": float(display_order),
                "_bowling_strength": safe_float(profile.get("bowling_strength")),
            }
        )

    candidate_rows.sort(
        key=lambda row: (
            0 if row["suggested"] else 1,
            int(row["batting_order_estimate"]),
            -int(row["recent_appearances"]),
            -float(row["_bowling_strength"]),
            normalize_text(str(row["name"])),
        )
    )

    suggested_rows = [row for row in candidate_rows if row["suggested"]]
    suggested_rows.sort(
        key=lambda row: (
            int(row["batting_order_estimate"]),
            float(row["_display_order"]),
            normalize_text(str(row["name"])),
        )
    )
    suggested_xi = [row["name"] for row in suggested_rows[:11]]
    if len(suggested_xi) < 11:
        existing = {normalize_player_name_key(name) for name in suggested_xi}
        for row in candidate_rows:
            key = normalize_player_name_key(str(row["name"]))
            if key in existing:
                continue
            suggested_xi.append(str(row["name"]))
            existing.add(key)
            if len(suggested_xi) == 11:
                break

    for row in candidate_rows:
        row.pop("_display_order", None)
        row.pop("_bowling_strength", None)

    return {
        "available": True,
        "suggested_xi": suggested_xi,
        "candidate_pool": candidate_rows,
        "matches_considered": 0,
        "source": source,
    }


def build_post_toss_xi_suggestions(
    fixture: pd.Series, official_post_toss: dict[str, Any]
) -> dict[str, Any] | None:
    season = pd.Timestamp(fixture["match_date"]).year

    def build_for_team(team_key: str) -> dict[str, Any]:
        team_name = str(fixture[team_key])
        confirmed = list(official_post_toss.get(f"{team_key}_confirmed_xi", []) or [])
        effective = list(official_post_toss.get(f"{team_key}_effective_xi", []) or [])
        substitutes = list(
            official_post_toss.get(f"{team_key}_declared_substitutes", []) or []
        )
        candidate_names = confirmed + substitutes
        suggested_names = effective or confirmed
        built = build_named_xi_suggestions(
            team_name,
            candidate_names,
            suggested_names,
            "official_matchday_squad",
        )
        if built.get("available"):
            built["season"] = season
        return built

    team1 = build_for_team("team1")
    team2 = build_for_team("team2")
    if not team1.get("available") and not team2.get("available"):
        return None
    return {"team1": team1, "team2": team2}


def build_xi_overrides(
    team: str, season: int, match_date: str, xi_players: list[dict[str, Any]]
) -> dict[str, Any]:
    profiles, priors = build_team_player_aggregates(team)
    key_sets = build_key_player_sets(team)
    squad_history = load_match_squads_history()
    target_match_date = pd.Timestamp(match_date)
    if target_match_date.tzinfo is not None:
        target_match_date = target_match_date.tz_convert(None)
    previous_squads = squad_history[
        (squad_history["team"] == team)
        & (squad_history["match_date"] < target_match_date)
        & (squad_history["match_date"].dt.year == season)
    ]
    previous_sets = [
        set(group["player_name_key"])
        for _, group in previous_squads.groupby(["match_id", "match_date"])
    ]
    recent_sets = previous_sets[-5:]

    player_rows: list[dict[str, Any]] = []
    for player in xi_players:
        name = strip_player_suffixes(str(player.get("PlayerName", "")).strip())
        key = normalize_player_name_key(name)
        profile = profiles.get(key, {})
        role = profile.get("role_canonical") or canonicalize_official_role(
            str(player.get("PlayerSkill", "")), str(player.get("IsWK", "0"))
        )
        family = profile.get("bowling_style_family") or classify_bowling_family(
            str(player.get("BowlingProficiency", ""))
        )
        prior = priors.get(role, priors["unknown"])
        batting_strength = float(profile.get("batting_strength", prior["batting"]))
        bowling_strength = float(profile.get("bowling_strength", prior["bowling"]))
        bowling_balls = float(profile.get("bowling_balls", 0))
        death_bowling_balls = float(profile.get("death_bowling_balls", 0))
        player_rows.append(
            {
                "name": name,
                "key": key,
                "playing_order": int(player.get("PlayingOrder") or 99),
                "role": role,
                "style_family": family,
                "batting_strength": batting_strength,
                "bowling_strength": bowling_strength,
                "overall_strength": batting_strength + bowling_strength,
                "bowling_balls": bowling_balls,
                "death_bowling_balls": death_bowling_balls,
            }
        )

    def avg(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    ordered = sorted(player_rows, key=lambda row: row["playing_order"])
    top3 = [row for row in ordered if row["playing_order"] <= 3]
    middle = [row for row in ordered if 4 <= row["playing_order"] <= 6]
    finishers = sorted(
        [row for row in ordered if row["playing_order"] >= 6],
        key=lambda row: row["playing_order"],
        reverse=True,
    )[:2]
    bowling_options = sorted(
        player_rows,
        key=lambda row: (row["bowling_balls"], row["bowling_strength"]),
        reverse=True,
    )
    death_options = sorted(
        player_rows,
        key=lambda row: (row["death_bowling_balls"], row["bowling_strength"]),
        reverse=True,
    )
    spin_options = [row for row in player_rows if row["style_family"] == "spin"]
    pace_options = [row for row in player_rows if row["style_family"] == "pace"]
    xi_keys = {row["key"] for row in player_rows}

    def continuity(selection: list[dict[str, Any]]) -> float:
        if not recent_sets or not selection:
            return 0.0
        return avg(
            [
                sum(1 for squad in recent_sets if row["key"] in squad)
                / len(recent_sets)
                for row in selection
            ]
        )

    top_order_continuity = continuity(
        [row for row in ordered if row["playing_order"] <= 4]
    )
    bowling_core_continuity = continuity(bowling_options[:5])
    death_bowler_continuity = continuity(death_options[:3])
    overall_xi_continuity = continuity(player_rows)

    return {
        "probableXiStrength": avg([row["overall_strength"] for row in player_rows]),
        "top3Strength": avg([row["batting_strength"] for row in top3]),
        "middleOrderStrength": avg([row["batting_strength"] for row in middle]),
        "finisherStrength": avg([row["batting_strength"] for row in finishers]),
        "powerplayBowlingStrength": avg(
            [row["bowling_strength"] for row in bowling_options[:3]]
        ),
        "deathBowlingStrength": avg(
            [row["bowling_strength"] for row in death_options[:3]]
        ),
        "teamSpinStrength": avg([row["bowling_strength"] for row in spin_options]),
        "teamPaceStrength": avg([row["bowling_strength"] for row in pace_options]),
        "topOrderContinuity": top_order_continuity,
        "bowlingCoreContinuity": bowling_core_continuity,
        "deathBowlerContinuity": death_bowler_continuity,
        "overallXiContinuity": overall_xi_continuity,
        "xiContinuityScore": 0.30 * top_order_continuity
        + 0.30 * bowling_core_continuity
        + 0.20 * death_bowler_continuity
        + 0.20 * overall_xi_continuity,
        "missingKeyBatterCount": sum(
            1 for key in key_sets["key_batters"] if key not in xi_keys
        ),
        "missingKeyBowlerCount": sum(
            1 for key in key_sets["key_bowlers"] if key not in xi_keys
        ),
        "missingDeathBowlerFlag": int(
            any(key not in xi_keys for key in key_sets["death_bowlers"])
        ),
        "missingOpenerFlag": int(
            any(key not in xi_keys for key in key_sets["openers"])
        ),
    }


def official_player_has_marker(player: dict[str, Any], marker: str) -> bool:
    player_name = str(player.get("PlayerName", ""))
    return bool(re.search(rf"\({marker}\)", player_name, re.I))


def official_player_name(player: dict[str, Any]) -> str:
    return strip_player_suffixes(str(player.get("PlayerName", "")).strip())


def official_playing_order(player: dict[str, Any]) -> int:
    try:
        return int(player.get("PlayingOrder") or 99)
    except Exception:
        return 99


def is_overseas_player(player: dict[str, Any]) -> bool:
    return str(player.get("IsNonDomestic") or "0") == "1"


def parse_official_matchday_squad(players: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(
        players,
        key=lambda player: (
            official_playing_order(player),
            official_player_name(player),
        ),
    )
    confirmed_xi = [
        player
        for player in ordered
        if official_playing_order(player) <= 11
        and not official_player_has_marker(player, "ip")
    ]
    active_impact_players = [
        player for player in ordered if official_player_has_marker(player, "ip")
    ]
    replaced_players = [
        player for player in ordered if official_player_has_marker(player, "rp")
    ]
    declared_substitutes = [
        player for player in ordered if player not in confirmed_xi
    ]

    replaced_keys = {
        normalize_player_name_key(official_player_name(player))
        for player in replaced_players
    }
    effective_xi = [
        player
        for player in confirmed_xi
        if normalize_player_name_key(official_player_name(player)) not in replaced_keys
    ]
    effective_xi.extend(active_impact_players)
    if not active_impact_players:
        effective_xi = confirmed_xi.copy()
    effective_xi = sorted(
        effective_xi,
        key=lambda player: (
            official_playing_order(player),
            official_player_name(player),
        ),
    )

    overseas_in_confirmed_xi = sum(
        1 for player in confirmed_xi if is_overseas_player(player)
    )
    overseas_in_effective_xi = sum(
        1 for player in effective_xi if is_overseas_player(player)
    )
    eligible_impact_substitutes = [
        official_player_name(player)
        for player in declared_substitutes
        if overseas_in_confirmed_xi < 4 or not is_overseas_player(player)
    ]

    return {
        "confirmed_xi_players": confirmed_xi,
        "effective_xi_players": effective_xi,
        "confirmed_xi_names": [official_player_name(player) for player in confirmed_xi],
        "effective_xi_names": [official_player_name(player) for player in effective_xi],
        "declared_substitutes": [
            official_player_name(player) for player in declared_substitutes
        ],
        "active_impact_players": [
            official_player_name(player) for player in active_impact_players
        ],
        "replaced_players": [official_player_name(player) for player in replaced_players],
        "eligible_impact_substitutes": eligible_impact_substitutes,
        "confirmed_xi_available": len(confirmed_xi) == 11,
        "effective_xi_available": len(effective_xi) == 11,
        "overseas_in_confirmed_xi": overseas_in_confirmed_xi,
        "overseas_in_effective_xi": overseas_in_effective_xi,
        "impact_rule_ok": overseas_in_effective_xi <= 4,
    }


def fetch_official_post_toss_context(fixture: pd.Series) -> dict[str, Any]:
    official_match = resolve_iplt20_match(fixture)
    if not official_match:
        return {}

    toss_team = str(official_match.get("TossTeam") or "").strip()
    toss_details = str(official_match.get("TossDetails") or "").strip()
    if not toss_team or not toss_details:
        return {}

    toss_decision = (
        "field"
        if any(token in toss_details.lower() for token in ["field", "bowl"])
        else "bat"
    )
    squads = fetch_iplt20_confirmed_squads(int(official_match["MatchID"]))
    squad_a = parse_official_matchday_squad(squads.get("squadA", []) or [])
    squad_b = parse_official_matchday_squad(squads.get("squadB", []) or [])
    if not squad_a["confirmed_xi_available"] or not squad_b["confirmed_xi_available"]:
        return {
            "toss_winner": toss_team,
            "toss_decision": toss_decision,
            "match_id": official_match.get("MatchID"),
            "official_lineups_available": False,
            "team1_confirmed_xi": squad_a["confirmed_xi_names"],
            "team2_confirmed_xi": squad_b["confirmed_xi_names"],
            "team1_effective_xi": squad_a["effective_xi_names"],
            "team2_effective_xi": squad_b["effective_xi_names"],
            "team1_declared_substitutes": squad_a["declared_substitutes"],
            "team2_declared_substitutes": squad_b["declared_substitutes"],
            "team1_active_impact_players": squad_a["active_impact_players"],
            "team2_active_impact_players": squad_b["active_impact_players"],
            "team1_replaced_players": squad_a["replaced_players"],
            "team2_replaced_players": squad_b["replaced_players"],
            "team1_eligible_impact_substitutes": squad_a[
                "eligible_impact_substitutes"
            ],
            "team2_eligible_impact_substitutes": squad_b[
                "eligible_impact_substitutes"
            ],
            "team1_overseas_in_confirmed_xi": squad_a["overseas_in_confirmed_xi"],
            "team2_overseas_in_confirmed_xi": squad_b["overseas_in_confirmed_xi"],
            "team1_overseas_in_effective_xi": squad_a["overseas_in_effective_xi"],
            "team2_overseas_in_effective_xi": squad_b["overseas_in_effective_xi"],
            "team1_impact_rule_ok": squad_a["impact_rule_ok"],
            "team2_impact_rule_ok": squad_b["impact_rule_ok"],
        }

    season = pd.Timestamp(fixture["match_date"]).year
    team1_overrides = build_xi_overrides(
        str(fixture["team1"]),
        season,
        str(fixture["match_date"]),
        squad_a["effective_xi_players"],
    )
    team2_overrides = build_xi_overrides(
        str(fixture["team2"]),
        season,
        str(fixture["match_date"]),
        squad_b["effective_xi_players"],
    )
    feature_overrides = {
        f"team1_{key}": value for key, value in team1_overrides.items()
    } | {f"team2_{key}": value for key, value in team2_overrides.items()}

    return {
        "toss_winner": toss_team,
        "toss_decision": toss_decision,
        "match_id": official_match.get("MatchID"),
        "official_lineups_available": True,
        "team1_confirmed_xi": squad_a["confirmed_xi_names"],
        "team2_confirmed_xi": squad_b["confirmed_xi_names"],
        "team1_effective_xi": squad_a["effective_xi_names"],
        "team2_effective_xi": squad_b["effective_xi_names"],
        "team1_declared_substitutes": squad_a["declared_substitutes"],
        "team2_declared_substitutes": squad_b["declared_substitutes"],
        "team1_active_impact_players": squad_a["active_impact_players"],
        "team2_active_impact_players": squad_b["active_impact_players"],
        "team1_replaced_players": squad_a["replaced_players"],
        "team2_replaced_players": squad_b["replaced_players"],
        "team1_eligible_impact_substitutes": squad_a["eligible_impact_substitutes"],
        "team2_eligible_impact_substitutes": squad_b["eligible_impact_substitutes"],
        "team1_overseas_in_confirmed_xi": squad_a["overseas_in_confirmed_xi"],
        "team2_overseas_in_confirmed_xi": squad_b["overseas_in_confirmed_xi"],
        "team1_overseas_in_effective_xi": squad_a["overseas_in_effective_xi"],
        "team2_overseas_in_effective_xi": squad_b["overseas_in_effective_xi"],
        "team1_impact_rule_ok": squad_a["impact_rule_ok"],
        "team2_impact_rule_ok": squad_b["impact_rule_ok"],
        "feature_overrides": feature_overrides,
    }


def fetch_polymarket_market(
    team1: str, team2: str, match_date: str | None = None
) -> dict[str, Any] | None:
    for slug in build_polymarket_slug_candidates(team1, team2, match_date):
        slug_market = fetch_polymarket_market_by_slug(team1, team2, slug)
        if slug_market is not None:
            return slug_market

    search = urllib.parse.quote("IPL 2026")
    url = f"https://gamma-api.polymarket.com/markets?search={search}&limit=200"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except Exception:
        return None

    markets = payload if isinstance(payload, list) else payload.get("data", [])
    for market in markets:
        question = str(market.get("question", ""))
        normalized_question = normalize_text(question)
        team1_aliases = alias_tokens(team1)
        team2_aliases = alias_tokens(team2)
        if not any(alias in normalized_question for alias in team1_aliases):
            continue
        if not any(alias in normalized_question for alias in team2_aliases):
            continue
        parsed = extract_market_probabilities(market, team1, team2)
        if parsed is not None:
            return parsed

    return None


def fetch_opticodds_sportsbook_overlay(
    fixture_id: str, team1: str, team2: str
) -> dict[str, Any] | None:
    api_key = os.environ.get("OPTICODDS_API_KEY")
    if not api_key:
        return None

    query_parts = [
        ("sport", "cricket"),
        ("fixture_id", fixture_id),
        ("market", "Moneyline"),
        ("odds_format", "PROBABILITY"),
        ("exclude_fees", "true"),
    ] + [("sportsbook", sportsbook) for sportsbook in OPTICODDS_SPORTSBOOKS]
    url = f"{OPTICODDS_BASE_URL}/fixtures/odds?{urllib.parse.urlencode(query_parts, doseq=True)}"
    request = urllib.request.Request(
        url,
        headers={
            "X-Api-Key": api_key,
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except Exception:
        return None

    fixture_rows = payload.get("data", []) if isinstance(payload, dict) else []
    fixture = next(
        (entry for entry in fixture_rows if str(entry.get("id")) == fixture_id), None
    )
    if not fixture:
        return None

    team1_keys = {
        normalize_selection_key(alias) for alias in TEAM_ALIASES.get(team1, [team1])
    }
    team2_keys = {
        normalize_selection_key(alias) for alias in TEAM_ALIASES.get(team2, [team2])
    }
    books: dict[str, dict[str, Any]] = {}

    for odd in fixture.get("odds", []) or []:
        book_id = str(odd.get("sportsbook_id") or odd.get("sportsbook") or "unknown")
        selection_key = normalize_selection_key(
            str(odd.get("normalized_selection") or odd.get("selection") or "")
        )
        if selection_key not in team1_keys and selection_key not in team2_keys:
            continue

        book = books.setdefault(
            book_id,
            {
                "sportsbook_id": book_id,
                "sportsbook": odd.get("sportsbook") or book_id,
                "updated_at_unix": int(odd.get("timestamp") or 0),
            },
        )
        probability = normalize_probability(odd.get("price"))
        if probability is None:
            continue
        order_book = odd.get("order_book") or []
        top_level = None
        if isinstance(order_book, list) and order_book:
            try:
                top_level = normalize_probability(order_book[0][0])
            except Exception:
                top_level = None

        limits = odd.get("limits") or {}
        max_stake = None
        if isinstance(limits, dict):
            raw_stake = limits.get("max") or limits.get("max_stake")
            if raw_stake is not None:
                try:
                    max_stake = float(raw_stake)
                except Exception:
                    max_stake = None

        if selection_key in team1_keys:
            book["team1_probability"] = probability
            book["team1_top_level"] = top_level
            book["team1_max_stake"] = max_stake
        elif selection_key in team2_keys:
            book["team2_probability"] = probability
            book["team2_top_level"] = top_level
            book["team2_max_stake"] = max_stake

    book_views = [
        book
        for book in books.values()
        if book.get("team1_probability") is not None
        and book.get("team2_probability") is not None
    ]
    if not book_views:
        return None

    consensus_team1 = sum(book["team1_probability"] for book in book_views) / len(
        book_views
    )
    consensus_team2 = sum(book["team2_probability"] for book in book_views) / len(
        book_views
    )

    return {
        "source": "opticodds",
        "fixture_id": fixture_id,
        "book_count": len(book_views),
        "consensus_team1_probability": consensus_team1,
        "consensus_team2_probability": consensus_team2,
        "books": sorted(book_views, key=lambda book: str(book["sportsbook_id"])),
    }


def load_fixture_override_entry(fixture_id: str) -> dict[str, Any]:
    if not FIXTURE_OVERRIDES_PATH.exists():
        return {}

    try:
        payload = json.loads(FIXTURE_OVERRIDES_PATH.read_text())
    except Exception:
        return {}

    fixtures = payload.get("fixtures", {}) if isinstance(payload, dict) else {}
    entry = fixtures.get(fixture_id, {}) if isinstance(fixtures, dict) else {}
    return entry if isinstance(entry, dict) else {}


def latest_team_snapshot(
    matchups: pd.DataFrame, team: str, prefix: str
) -> dict[str, Any]:
    team1_rows = matchups[matchups["team1"] == team].copy()
    team2_rows = matchups[matchups["team2"] == team].copy()
    snapshots: list[tuple[pd.Timestamp, dict[str, Any]]] = []

    if not team1_rows.empty:
        latest = team1_rows.sort_values("match_date").iloc[-1]
        snapshot = {
            column: latest[column]
            for column in matchups.columns
            if column.startswith("team1_")
        }
        snapshots.append((pd.Timestamp(latest["match_date"]), snapshot))

    if not team2_rows.empty:
        latest = team2_rows.sort_values("match_date").iloc[-1]
        snapshot = {
            f"team1_{column.removeprefix('team2_')}": latest[column]
            for column in matchups.columns
            if column.startswith("team2_")
        }
        snapshots.append((pd.Timestamp(latest["match_date"]), snapshot))

    if not snapshots:
        return {}

    chosen = sorted(snapshots, key=lambda item: item[0])[-1][1]
    return {
        column.replace("team1_", f"{prefix}_"): value
        for column, value in chosen.items()
    }


def compute_pair_features(
    matchups: pd.DataFrame, team1: str, team2: str, venue: str
) -> dict[str, Any]:
    pair_rows = matchups[
        ((matchups["team1"] == team1) & (matchups["team2"] == team2))
        | ((matchups["team1"] == team2) & (matchups["team2"] == team1))
    ].sort_values("match_date")

    if pair_rows.empty:
        return {
            "team1_h2h_win_rate_vs_team2": 0.0,
            "team2_h2h_win_rate_vs_team1": 0.0,
            "last_5_h2h_team1_win_rate": 0.0,
            "venue_h2h_win_rate": 0.0,
        }

    def team1_win(row: pd.Series) -> int:
        if row["team1"] == team1:
            return int(row["team1_won"])
        return int(not bool(row["team1_won"]))

    team1_wins = pair_rows.apply(team1_win, axis=1)
    venue_rows = pair_rows[pair_rows["venue"] == venue]
    venue_team1_wins = (
        venue_rows.apply(team1_win, axis=1)
        if not venue_rows.empty
        else pd.Series(dtype=int)
    )

    return {
        "team1_h2h_win_rate_vs_team2": float(team1_wins.mean()),
        "team2_h2h_win_rate_vs_team1": float(1 - team1_wins.mean()),
        "last_5_h2h_team1_win_rate": float(team1_wins.tail(5).mean()),
        "venue_h2h_win_rate": float(venue_team1_wins.mean())
        if not venue_team1_wins.empty
        else 0.0,
    }


def latest_venue_snapshot(matchups: pd.DataFrame, venue: str) -> dict[str, Any]:
    venue_rows = matchups[matchups["venue"] == venue].sort_values("match_date")
    if venue_rows.empty:
        return {}

    latest = venue_rows.iloc[-1]
    keys = [
        "venue_average_first_innings_score",
        "venue_average_second_innings_score",
        "venue_chasing_win_rate",
        "venue_batting_first_win_rate",
        "venue_avg_powerplay_runs",
        "venue_avg_powerplay_wickets",
        "venue_avg_death_overs_runs",
        "venue_boundary_rate",
        "venue_six_rate",
        "venue_dot_ball_rate",
        "venue_powerplay_wicket_rate",
        "venue_middle_overs_wicket_rate",
        "venue_death_overs_wicket_rate",
        "venue_spin_wicket_share",
        "venue_pace_wicket_share",
        "venue_toss_winner_win_rate",
        "venue_field_first_win_rate",
        "venue_bat_first_win_rate",
    ]
    return {key: latest.get(key) for key in keys}


def build_base_row(args: argparse.Namespace) -> dict[str, Any]:
    elo = load_csv(LIVE_DIR / "upcoming_fixture_elo_context.csv")
    matchup_path = FEATURES_DIR / "training_ready_matchup_features.csv"
    matchup_rows = load_csv(matchup_path)
    matchup_rows["match_date"] = pd.to_datetime(matchup_rows["match_date"]).map(
        normalize_timestamp
    )

    fixture = load_fixture_row_from_args(args)

    elo_row = elo[elo["fixture_id"] == args.fixture_id]
    live_elo = elo_row.iloc[0] if not elo_row.empty else build_historical_elo_row(fixture)

    team1 = fixture["team1"]
    team2 = fixture["team2"]
    venue = fixture["venue"]
    season = pd.Timestamp(fixture["match_date"]).year
    override_entry = load_fixture_override_entry(str(fixture["fixture_id"]))
    official_post_toss = fetch_official_post_toss_context(fixture)
    team1_probable_xi = parse_string_array(
        args.team1_probable_xi_json, "team1_probable_xi_json"
    )
    team2_probable_xi = parse_string_array(
        args.team2_probable_xi_json, "team2_probable_xi_json"
    )

    base = {
        "__file_overrides_applied": bool(override_entry),
        "__official_post_toss_applied": bool(official_post_toss),
        "__official_lineups_available": bool(
            official_post_toss.get("official_lineups_available")
        ),
        "__manual_probable_xi_applied": False,
        "__manual_probable_xi_summary": {},
        "__live_feature_refresh_applied": False,
        "__live_feature_refresh_summary": {},
        "__official_match_id": official_post_toss.get("match_id"),
        "__team1_confirmed_xi": official_post_toss.get("team1_confirmed_xi", []),
        "__team2_confirmed_xi": official_post_toss.get("team2_confirmed_xi", []),
        "__team1_effective_xi": official_post_toss.get("team1_effective_xi", []),
        "__team2_effective_xi": official_post_toss.get("team2_effective_xi", []),
        "__team1_declared_substitutes": official_post_toss.get(
            "team1_declared_substitutes", []
        ),
        "__team2_declared_substitutes": official_post_toss.get(
            "team2_declared_substitutes", []
        ),
        "__team1_active_impact_players": official_post_toss.get(
            "team1_active_impact_players", []
        ),
        "__team2_active_impact_players": official_post_toss.get(
            "team2_active_impact_players", []
        ),
        "__team1_replaced_players": official_post_toss.get("team1_replaced_players", []),
        "__team2_replaced_players": official_post_toss.get("team2_replaced_players", []),
        "__team1_eligible_impact_substitutes": official_post_toss.get(
            "team1_eligible_impact_substitutes", []
        ),
        "__team2_eligible_impact_substitutes": official_post_toss.get(
            "team2_eligible_impact_substitutes", []
        ),
        "__team1_overseas_in_confirmed_xi": official_post_toss.get(
            "team1_overseas_in_confirmed_xi"
        ),
        "__team2_overseas_in_confirmed_xi": official_post_toss.get(
            "team2_overseas_in_confirmed_xi"
        ),
        "__team1_overseas_in_effective_xi": official_post_toss.get(
            "team1_overseas_in_effective_xi"
        ),
        "__team2_overseas_in_effective_xi": official_post_toss.get(
            "team2_overseas_in_effective_xi"
        ),
        "__team1_impact_rule_ok": official_post_toss.get("team1_impact_rule_ok"),
        "__team2_impact_rule_ok": official_post_toss.get("team2_impact_rule_ok"),
        "fixture_id": fixture["fixture_id"],
        "opticodds_game_id": fixture["opticodds_game_id"],
        "fixture_status": fixture["status"],
        "fixture_is_live": bool(fixture["is_live"]),
        "match_date": fixture["match_date"],
        "venue": venue,
        "city": fixture["city"],
        "home_team": fixture["inferred_home_team"],
        "team1": team1,
        "team2": team2,
        "team1_home_flag": int(
            fixture["team1_home_context"] in ["home", "secondary_home"]
        ),
        "team2_home_flag": int(
            fixture["team2_home_context"] in ["home", "secondary_home"]
        ),
        "match_neutral_flag": int(bool(fixture["match_neutral_flag"])),
        "elo_gap": live_elo["elo_gap"],
        "elo_expected_team1_win": live_elo["elo_expected_team1_win"],
    }

    base.update(latest_venue_snapshot(matchup_rows, venue))
    base.update(compute_pair_features(matchup_rows, team1, team2, venue))
    base.update(latest_team_snapshot(matchup_rows, team1, "team1"))
    base.update(latest_team_snapshot(matchup_rows, team2, "team2"))

    live_feature_overrides, live_feature_summary = build_live_feature_refresh(
        fixture, live_elo
    )
    base.update(live_feature_overrides)
    base["__live_feature_refresh_applied"] = bool(live_feature_summary.get("applied"))
    base["__live_feature_refresh_summary"] = live_feature_summary

    for team_prefix, team_elo in [
        ("team1", live_elo["team1_elo"]),
        ("team2", live_elo["team2_elo"]),
    ]:
        base[f"{team_prefix}_teamEloBeforeMatch"] = team_elo
        base[f"{team_prefix}_eloExpectedWin"] = (
            live_elo["elo_expected_team1_win"]
            if team_prefix == "team1"
            else live_elo["elo_expected_team2_win"]
        )

    base["recent_win_rate_gap"] = base.get("team1_recentWinRateLast10", 0) - base.get(
        "team2_recentWinRateLast10", 0
    )
    base["chasing_strength_gap"] = base.get("team1_chasingWinRate", 0) - base.get(
        "team2_chasingWinRate", 0
    )
    base["batting_first_gap"] = base.get("team1_battingFirstWinRate", 0) - base.get(
        "team2_battingFirstWinRate", 0
    )

    common_overrides = (
        override_entry.get("common", {}) if isinstance(override_entry, dict) else {}
    )
    if isinstance(common_overrides, dict):
        feature_overrides = common_overrides.get("feature_overrides", {})
        if isinstance(feature_overrides, dict):
            base.update(feature_overrides)

    if args.mode == "post_toss":
        if official_post_toss.get("feature_overrides"):
            base.update(official_post_toss["feature_overrides"])
        mode_overrides = (
            override_entry.get("post_toss", {})
            if isinstance(override_entry, dict)
            else {}
        )
        override_toss_winner = (
            mode_overrides.get("toss_winner")
            if isinstance(mode_overrides, dict)
            else None
        )
        override_toss_decision = (
            mode_overrides.get("toss_decision")
            if isinstance(mode_overrides, dict)
            else None
        )
        toss_winner = (
            args.toss_winner
            or override_toss_winner
            or official_post_toss.get("toss_winner")
        )
        toss_decision = (
            args.toss_decision
            or override_toss_decision
            or official_post_toss.get("toss_decision")
        )

        if not toss_winner or not toss_decision:
            raise ValueError(
                "post_toss mode requires --toss-winner and --toss-decision"
            )
        base["toss_winner"] = toss_winner
        base["toss_decision"] = toss_decision
        team1_bats_first = int(
            (toss_winner == team1 and toss_decision == "bat")
            or (toss_winner == team2 and toss_decision == "field")
        )
        base["team1_bats_first"] = team1_bats_first
        base["team2_bats_first"] = 1 - team1_bats_first

        if isinstance(mode_overrides, dict):
            feature_overrides = mode_overrides.get("feature_overrides", {})
            if isinstance(feature_overrides, dict):
                base.update(feature_overrides)
    else:
        mode_overrides = (
            override_entry.get("pre_toss", {})
            if isinstance(override_entry, dict)
            else {}
        )
        manual_probable_xi_summary: dict[str, Any] = {}
        if team1_probable_xi:
            team1_manual_overrides = build_manual_probable_xi_overrides(
                str(team1), season, str(fixture["match_date"]), team1_probable_xi
            )
            base.update({f"team1_{key}": value for key, value in team1_manual_overrides.items()})
            manual_probable_xi_summary["team1"] = {
                "selected_count": len(team1_probable_xi),
                "selected_players": team1_probable_xi,
            }
        if team2_probable_xi:
            team2_manual_overrides = build_manual_probable_xi_overrides(
                str(team2), season, str(fixture["match_date"]), team2_probable_xi
            )
            base.update({f"team2_{key}": value for key, value in team2_manual_overrides.items()})
            manual_probable_xi_summary["team2"] = {
                "selected_count": len(team2_probable_xi),
                "selected_players": team2_probable_xi,
            }
        if manual_probable_xi_summary:
            base["__manual_probable_xi_applied"] = True
            base["__manual_probable_xi_summary"] = manual_probable_xi_summary
        if isinstance(mode_overrides, dict):
            feature_overrides = mode_overrides.get("feature_overrides", {})
            if isinstance(feature_overrides, dict):
                base.update(feature_overrides)

    if args.feature_overrides_json:
        base.update(json.loads(args.feature_overrides_json))

    return base


def describe_context(args: argparse.Namespace) -> dict[str, Any]:
    elo = load_csv(LIVE_DIR / "upcoming_fixture_elo_context.csv")
    fixture = load_fixture_row_from_args(args)
    elo_row = elo[elo["fixture_id"] == args.fixture_id]
    season = pd.Timestamp(fixture["match_date"]).year
    live_feature_summary = (
        build_live_feature_refresh(
            fixture, elo_row.iloc[0] if not elo_row.empty else build_historical_elo_row(fixture)
        )[1]
    )
    override_entry = load_fixture_override_entry(str(fixture["fixture_id"]))
    official_post_toss = fetch_official_post_toss_context(fixture)
    sportsbook_overlay = fetch_opticodds_sportsbook_overlay(
        str(fixture["fixture_id"]), str(fixture["team1"]), str(fixture["team2"])
    )
    market_overlay = fetch_polymarket_market(
        str(fixture["team1"]), str(fixture["team2"]), str(fixture["match_date"])
    )
    probable_xi_suggestions = {
        "team1": build_probable_xi_suggestions(
            str(fixture["team1"]), season, str(fixture["match_date"])
        ),
        "team2": build_probable_xi_suggestions(
            str(fixture["team2"]), season, str(fixture["match_date"])
        ),
    }
    post_toss_xi_suggestions = build_post_toss_xi_suggestions(
        fixture, official_post_toss
    )

    return {
        "fixture_id": str(fixture["fixture_id"]),
        "mode": args.mode,
        "team1": fixture["team1"],
        "team2": fixture["team2"],
        "match_date": fixture["match_date"],
        "automatic": {
            "fixture_shell": True,
            "current_elo": not elo_row.empty,
            "sportsbook_overlay": sportsbook_overlay is not None,
            "polymarket_overlay": market_overlay is not None,
            "official_toss": bool(official_post_toss.get("toss_winner")),
            "official_confirmed_xi": bool(
                official_post_toss.get("official_lineups_available")
            ),
            "file_override_present": bool(override_entry),
        },
        "automatic_details": {
            "fixture_shell": {
                "available": True,
                "message": "Fixture shell is loaded from the live fixture snapshot.",
            },
            "current_elo": {
                "available": not elo_row.empty,
                "message": "Current Elo is refreshed from historical results plus completed 2026 matches."
                if not elo_row.empty
                else "Current Elo context is missing for this fixture.",
            },
            "live_feature_refresh": {
                "available": bool(live_feature_summary.get("applied")),
                "message": "Current form, H2H, venue toss, and rest-day features are refreshed with completed 2026 results where derivable."
                if live_feature_summary.get("applied")
                else "Live metadata refresh is unavailable, so only the historical feature snapshot is being used.",
            },
            "sportsbook_overlay": {
                "available": sportsbook_overlay is not None,
                "message": "Sportsbook consensus is available from OpticOdds."
                if sportsbook_overlay is not None
                else "No sportsbook overlay is available right now.",
            },
            "polymarket_overlay": {
                "available": market_overlay is not None,
                "message": "A matching Polymarket market was found."
                if market_overlay is not None
                else "No matching liquid Polymarket market was found for this fixture.",
            },
            "official_toss": {
                "available": bool(official_post_toss.get("toss_winner")),
                "message": "Official toss result is available from the IPL match-centre feed."
                if args.mode == "post_toss" and official_post_toss.get("toss_winner")
                else "Official toss result is already available; switch to post_toss mode to use it automatically."
                if official_post_toss.get("toss_winner")
                else "Official toss result is not available yet.",
            },
            "official_confirmed_xi": {
                "available": bool(official_post_toss.get("official_lineups_available")),
                "message": "Confirmed XI is available from the IPL official squad feed."
                if args.mode == "post_toss"
                and official_post_toss.get("official_lineups_available")
                else "Confirmed XI is already available; switch to post_toss mode to apply it automatically."
                if official_post_toss.get("official_lineups_available")
                else "Confirmed XI is not available yet.",
            },
        },
        "manual_input_recommendation": {
            "recommended": not (
                official_post_toss.get("toss_winner")
                and official_post_toss.get("official_lineups_available")
            ),
            "message": "Automatic post-toss toss + XI data is available, so manual overrides are usually unnecessary."
            if args.mode == "post_toss"
            and official_post_toss.get("toss_winner")
            and official_post_toss.get("official_lineups_available")
            else "Official toss and confirmed XI are already available for this fixture. Switch to post_toss mode to use them automatically."
            if official_post_toss.get("toss_winner")
            and official_post_toss.get("official_lineups_available")
            else "Manual overrides are optional and only needed if you have better live cricket information than the automatic feed.",
        },
        "notes": {
            "pre_toss": [
                "Fixture shell and Elo are automatic.",
                "Derivable current-season form, H2H, venue toss, and rest-day features are refreshed from completed 2026 results.",
                "If official toss and XI are already available, switch to post_toss mode to let the predictor use them automatically.",
                "Suggested probable XIs are built from recent same-season squads, but you still choose whether to apply them before toss.",
                "Injuries and role notes are still manual overrides before toss.",
            ]
            if args.mode == "pre_toss"
            else [],
            "post_toss": [
                "Official toss and confirmed XI are auto-fetched when available.",
                "If official post-toss context is missing, fallback toss inputs or file overrides are needed.",
            ]
            if args.mode == "post_toss"
            else [],
        },
        "official_post_toss_context": {
            "match_id": official_post_toss.get("match_id"),
            "lineups_available": bool(
                official_post_toss.get("official_lineups_available")
            ),
            "team1_confirmed_xi_count": len(
                official_post_toss.get("team1_confirmed_xi", []) or []
            ),
            "team2_confirmed_xi_count": len(
                official_post_toss.get("team2_confirmed_xi", []) or []
            ),
            "team1_declared_substitutes_count": len(
                official_post_toss.get("team1_declared_substitutes", []) or []
            ),
            "team2_declared_substitutes_count": len(
                official_post_toss.get("team2_declared_substitutes", []) or []
            ),
            "team1_active_impact_players": official_post_toss.get(
                "team1_active_impact_players", []
            ),
            "team2_active_impact_players": official_post_toss.get(
                "team2_active_impact_players", []
            ),
        }
        if args.mode == "post_toss"
        else None,
        "live_feature_refresh": live_feature_summary,
        "probable_xi_suggestions": probable_xi_suggestions
        if args.mode == "pre_toss"
        else post_toss_xi_suggestions,
    }


def predict_component(
    component_manifest: dict[str, Any], base_row: dict[str, Any], final_models_dir: Path
) -> float:
    matrix_manifest = json.loads(MODEL_MATRIX_MANIFEST_PATH.read_text())[
        "preToss" if component_manifest["matrix"] == "pre_toss" else "postToss"
    ]
    frame = pd.DataFrame([base_row])
    feature_columns: list[str] = matrix_manifest["featureColumns"]
    categorical_columns: list[str] = matrix_manifest["categoricalFeatureColumns"]
    allowlist = component_manifest.get("featureAllowlist")
    frame = prepare_dataframe(frame, categorical_columns, "__unused_target__", [])
    feature_view = build_feature_view(
        frame,
        feature_columns,
        categorical_columns,
        component_manifest["featureMode"],
        allowlist,
    )
    x = feature_view.frame[component_manifest["featureColumns"]]
    model_type = str(component_manifest.get("modelType", "catboost")).lower()

    if model_type == "catboost":
        model = CatBoostClassifier()
        model.load_model(
            str(
                resolve_repo_path(
                    component_manifest["modelPath"], final_models_dir=final_models_dir
                )
            )
        )
        return float(model.predict_proba(x)[0, 1])

    if model_type == "xgboost":
        if Booster is None or DMatrix is None:
            raise ImportError(
                "xgboost runtime is required to load promoted XGBoost production models"
            )

        preprocessor_path = component_manifest.get("preprocessorPath")
        if not preprocessor_path:
            raise ValueError("XGBoost component manifest is missing preprocessorPath")

        preprocessor = joblib.load(
            resolve_repo_path(preprocessor_path, final_models_dir=final_models_dir)
        )
        transformed = preprocessor.transform(x)
        booster = Booster()
        booster.load_model(
            str(
                resolve_repo_path(
                    component_manifest["modelPath"], final_models_dir=final_models_dir
                )
            )
        )
        probabilities = booster.predict(DMatrix(transformed))
        probability = float(probabilities[0])

        calibration_method = component_manifest.get("calibrationMethod")
        calibrator_path = component_manifest.get("calibratorPath")
        if calibration_method and calibrator_path:
            calibrator = joblib.load(
                resolve_repo_path(calibrator_path, final_models_dir=final_models_dir)
            )
            if calibration_method == "platt":
                probability = float(
                    apply_platt_calibrator(calibrator, pd.Series([probability]).to_numpy())[0]
                )
            elif calibration_method == "isotonic":
                probability = float(
                    apply_isotonic_calibrator(
                        calibrator, pd.Series([probability]).to_numpy()
                    )[0]
                )
            else:
                raise ValueError(
                    f"Unsupported XGBoost calibration method: {calibration_method}"
                )

        return probability

    raise ValueError(f"Unsupported modelType in component manifest: {model_type}")


def main() -> None:
    load_local_env()
    args = parse_args()
    if args.list_fixtures:
        list_fixtures()
        return
    if not args.fixture_id:
        raise ValueError("Provide --fixture-id or use --list-fixtures")
    if args.describe_context:
        print(json.dumps(describe_context(args), indent=2))
        return

    final_models_dir = (
        resolve_repo_path(args.final_models_dir, final_models_dir=FINAL_MODELS_DIR)
        if args.final_models_dir
        else FINAL_MODELS_DIR
    )

    manifest = json.loads((final_models_dir / "manifest.json").read_text())
    model_config = manifest[args.mode]
    base_row = build_base_row(args)

    component_predictions = []
    for component in model_config["components"]:
        probability = predict_component(component, base_row, final_models_dir)
        component_predictions.append(
            {
                "component": component["component"],
                "weight": component["weight"],
                "probability": probability,
            }
        )

    blended = sum(
        item["weight"] * item["probability"] for item in component_predictions
    )
    fair_price_team1_cents = round(blended * 100, 2)
    fair_price_team2_cents = round((1 - blended) * 100, 2)
    market_overlay = fetch_polymarket_market(
        base_row["team1"], base_row["team2"], str(base_row["match_date"])
    )
    sportsbook_overlay = fetch_opticodds_sportsbook_overlay(
        str(base_row["fixture_id"]), base_row["team1"], base_row["team2"]
    )
    result = {
        "fixture_id": args.fixture_id,
        "opticodds_game_id": base_row["opticodds_game_id"],
        "mode": args.mode,
        "match_date": base_row["match_date"],
        "fixture_status": base_row["fixture_status"],
        "fixture_is_live": base_row["fixture_is_live"],
        "team1": base_row["team1"],
        "team2": base_row["team2"],
        "venue": base_row["venue"],
        "team1_win_probability": blended,
        "team2_win_probability": 1 - blended,
        "fair_price_team1_cents": fair_price_team1_cents,
        "fair_price_team2_cents": fair_price_team2_cents,
        "predicted_winner": base_row["team1"] if blended >= 0.5 else base_row["team2"],
        "components": component_predictions,
        "elo_context": {
            "elo_gap": base_row.get("elo_gap"),
            "elo_expected_team1_win": base_row.get("elo_expected_team1_win"),
            "team1_elo": base_row.get("team1_teamEloBeforeMatch"),
            "team2_elo": base_row.get("team2_teamEloBeforeMatch"),
        },
        "market_overlay": {
            **market_overlay,
            "team1_edge_vs_market": round(
                blended - market_overlay["team1_market_probability"], 6
            ),
            "team2_edge_vs_market": round(
                (1 - blended) - market_overlay["team2_market_probability"], 6
            ),
        }
        if market_overlay
        else None,
        "sportsbook_overlay": {
            **sportsbook_overlay,
            "team1_edge_vs_consensus": round(
                blended - sportsbook_overlay["consensus_team1_probability"], 6
            ),
            "team2_edge_vs_consensus": round(
                (1 - blended) - sportsbook_overlay["consensus_team2_probability"], 6
            ),
        }
        if sportsbook_overlay
        else None,
        "official_post_toss_context": {
            "match_id": base_row.get("__official_match_id"),
            "lineups_available": bool(base_row.get("__official_lineups_available")),
            "team1_confirmed_xi": base_row.get("__team1_confirmed_xi", []),
            "team2_confirmed_xi": base_row.get("__team2_confirmed_xi", []),
            "team1_effective_xi": base_row.get("__team1_effective_xi", []),
            "team2_effective_xi": base_row.get("__team2_effective_xi", []),
            "team1_declared_substitutes": base_row.get(
                "__team1_declared_substitutes", []
            ),
            "team2_declared_substitutes": base_row.get(
                "__team2_declared_substitutes", []
            ),
            "team1_active_impact_players": base_row.get(
                "__team1_active_impact_players", []
            ),
            "team2_active_impact_players": base_row.get(
                "__team2_active_impact_players", []
            ),
            "team1_replaced_players": base_row.get("__team1_replaced_players", []),
            "team2_replaced_players": base_row.get("__team2_replaced_players", []),
            "team1_eligible_impact_substitutes": base_row.get(
                "__team1_eligible_impact_substitutes", []
            ),
            "team2_eligible_impact_substitutes": base_row.get(
                "__team2_eligible_impact_substitutes", []
            ),
            "team1_overseas_in_confirmed_xi": base_row.get(
                "__team1_overseas_in_confirmed_xi"
            ),
            "team2_overseas_in_confirmed_xi": base_row.get(
                "__team2_overseas_in_confirmed_xi"
            ),
            "team1_overseas_in_effective_xi": base_row.get(
                "__team1_overseas_in_effective_xi"
            ),
            "team2_overseas_in_effective_xi": base_row.get(
                "__team2_overseas_in_effective_xi"
            ),
            "team1_impact_rule_ok": base_row.get("__team1_impact_rule_ok"),
            "team2_impact_rule_ok": base_row.get("__team2_impact_rule_ok"),
        }
        if args.mode == "post_toss"
        else None,
        "official_post_toss_applied": bool(
            base_row.get("__official_post_toss_applied")
        ),
        "manual_probable_xi_applied": bool(
            base_row.get("__manual_probable_xi_applied")
        ),
        "manual_probable_xi_summary": base_row.get("__manual_probable_xi_summary", {}),
        "live_feature_refresh": base_row.get("__live_feature_refresh_summary", {}),
        "file_overrides_applied": bool(base_row.get("__file_overrides_applied")),
        "feature_overrides_applied": bool(args.feature_overrides_json),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
