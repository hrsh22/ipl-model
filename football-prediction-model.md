zostaff
@zostaff
Building a Football Match Prediction System with Claude AI
Complete Technical Guide: From Data Collection to a Working Model
This article provides a step-by-step walkthrough of the architecture and implementation of an analytical system for predicting football match outcomes. The system uses Claude API from Anthropic as its "brain" - for data interpretation, feature engineering, and generating final predictions. The key innovation is combining three probability layers: bookmaker odds (Bet365), Polymarket prediction market data (blockchain-based crowd intelligence), and a custom ML model. The entire pipeline is written in Python using pandas, scikit-learn, XGBoost, and matplotlib.
System Architecture
The system consists of several layers, each serving a specific role:
┌─────────────────────────────────────────────────────────────┐
│ DATA LAYER │
│ football-data.co.uk │ API-Football │ FBref │ Kaggle │
│ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 🔗 Polymarket Gamma API (prediction market) │ │
│ │ Crowd-sourced probabilities on the Polygon chain │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ PROCESSING LAYER │
│ pandas │ numpy │ data cleaning │ feature engineering │
│ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Claude API: feature generation, │ │
│ │ context analysis, statistics interpretation │ │
│ └──────────────────────────────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Merging 3 probability layers: │ │
│ │ Bookmaker odds + Polymarket prices + ML model │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ MODEL LAYER │
│ Logistic Regression │ Random Forest │ XGBoost │
│ Ensemble (Voting / Stacking) │
└──────────────────────────┬───────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ INTERPRETATION LAYER │
│ Claude API: natural language prediction explanation │
│ + confidence assessment + divergence analysis │
│ between bookmaker / Polymarket / ML │
└──────────────────────────┬───────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ OUTPUT LAYER │
│ matplotlib visualizations │ JSON reports │ Telegram bot │
└─────────────────────────────────────────────────────────────┘
Required Dependencies
python

# requirements.txt

anthropic>=0.40.0
pandas>=2.1.0
numpy>=1.24.0
scikit-learn>=1.3.0
xgboost>=2.0.0
matplotlib>=3.8.0
seaborn>=0.13.0
requests>=2.31.0
python-dotenv>=1.0.0
schedule>=1.2.0 # pipeline automation
Installation:
bash
pip install anthropic pandas numpy scikit-learn xgboost matplotlib seaborn requests python-dotenv schedule
The Polymarket Gamma API does not require a dedicated SDK - all requests are made via `requests` to public REST endpoints without authentication.
Data Collection and Preparation
The primary data source is football-data.co.uk, which provides CSV files with match results and statistics for all major European leagues. The data includes goals, shots, corners, fouls, cards, and bookmaker odds.
Data Loading
python
import pandas as pd
import numpy as np
from pathlib import Path

class FootballDataLoader:
"""
Historical football match data loader.
Source: football-data.co.uk
"""

    BASE_URL = "https://www.football-data.co.uk/mmz4281"

    LEAGUES = {
        "E0": "Premier League",
        "SP1": "La Liga",
        "D1": "Bundesliga",
        "I1": "Serie A",
        "F1": "Ligue 1",
    }

    COLUMNS_TO_KEEP = [
        "Date", "HomeTeam", "AwayTeam",
        "FTHG", "FTAG", "FTR",       # Final score and result
        "HTHG", "HTAG", "HTR",       # Half-time score
        "HS", "AS",                   # Shots
        "HST", "AST",                 # Shots on target
        "HF", "AF",                   # Fouls
        "HC", "AC",                   # Corners
        "HY", "AY",                   # Yellow cards
        "HR", "AR",                   # Red cards
        "B365H", "B365D", "B365A",   # Bet365 odds
    ]

    def __init__(self, seasons: list[str], leagues: list[str] = None):
        self.seasons = seasons  # format: ["2324", "2223", "2122"]
        self.leagues = leagues or list(self.LEAGUES.keys())

    def load_season(self, league: str, season: str) -> pd.DataFrame:
        """Load data for a single season and league."""
        url = f"{self.BASE_URL}/{season}/{league}.csv"
        try:
            df = pd.read_csv(url, encoding="utf-8", on_bad_lines="skip")
            available_cols = [c for c in self.COLUMNS_TO_KEEP if c in df.columns]
            df = df[available_cols].dropna(subset=["HomeTeam", "AwayTeam", "FTR"])
            df["League"] = self.LEAGUES.get(league, league)
            df["Season"] = season
            return df
        except Exception as e:
            print(f"Error loading {league}/{season}: {e}")
            return pd.DataFrame()

    def load_all(self) -> pd.DataFrame:
        """Load all data for specified leagues and seasons."""
        frames = []
        for league in self.leagues:
            for season in self.seasons:
                df = self.load_season(league, season)
                if not df.empty:
                    frames.append(df)
                    print(f"  ✓ {self.LEAGUES.get(league)}, season {season}: "
                          f"{len(df)} matches")
        result = pd.concat(frames, ignore_index=True)
        print(f"\nTotal loaded: {len(result)} matches")
        return result

# === Usage ===

loader = FootballDataLoader(
seasons=["2425", "2324", "2223", "2122", "2021"],
leagues=["E0", "SP1", "D1"] # EPL, La Liga, Bundesliga
)
raw_data = loader.load_all()
Cleaning and Transformation
python
class DataCleaner:
"""Data cleaning and standardization."""

    @staticmethod
    def clean(df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # Standardize date format
        df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
        df = df.dropna(subset=["Date"])
        df = df.sort_values("Date").reset_index(drop=True)

        # Numeric columns
        numeric_cols = [
            "FTHG", "FTAG", "HTHG", "HTAG",
            "HS", "AS", "HST", "AST",
            "HF", "AF", "HC", "AC",
            "HY", "AY", "HR", "AR",
            "B365H", "B365D", "B365A",
        ]
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # Encoding result: H=2, D=1, A=0
        result_map = {"H": 2, "D": 1, "A": 0}
        df["Result"] = df["FTR"].map(result_map)
        df = df.dropna(subset=["Result"])
        df["Result"] = df["Result"].astype(int)

        return df

clean_data = DataCleaner.clean(raw_data)
print(f"After cleaning: {len(clean_data)} matches")
print(f"Result distribution:\n{clean_data['FTR'].value_counts()}")
Feature Engineering with Claude
This is the key stage where we create features that enable the model to "understand" the match context. Here, Claude serves as an intelligent assistant - helping generate feature ideas and evaluate contextual factors.
Statistical Features (Rolling Averages)
python
class FeatureEngineer:
"""
Feature generation based on historical team statistics.
Key idea: for each match we use ONLY data
available BEFORE the match starts.
"""

    def __init__(self, window: int = 5):
        self.window = window

    def compute_team_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Compute rolling averages for each team
        over the last N matches.
        """
        df = df.sort_values("Date").copy()

        # Create separate records for home and away teams
        home_records = df[["Date", "HomeTeam", "FTHG", "FTAG",
                           "HS", "AS", "HST", "AST",
                           "HC", "AC", "HF", "AF"]].copy()
        home_records.columns = ["Date", "Team", "GF", "GA",
                                "Shots", "ShotsAgainst",
                                "SoT", "SoTAgainst",
                                "Corners", "CornersAgainst",
                                "Fouls", "FoulsAgainst"]
        home_records["IsHome"] = 1

        away_records = df[["Date", "AwayTeam", "FTAG", "FTHG",
                           "AS", "HS", "AST", "HST",
                           "AC", "HC", "AF", "HF"]].copy()
        away_records.columns = home_records.columns
        away_records["IsHome"] = 0

        all_records = pd.concat([home_records, away_records])
        all_records = all_records.sort_values("Date")

        # Calculate rolling averages per team
        stats_cols = ["GF", "GA", "Shots", "ShotsAgainst",
                      "SoT", "SoTAgainst", "Corners",
                      "CornersAgainst", "Fouls", "FoulsAgainst"]

        rolling_stats = {}
        for team in all_records["Team"].unique():
            team_data = all_records[all_records["Team"] == team].copy()
            for col in stats_cols:
                # shift(1) — to exclude the current match
                team_data[f"avg_{col}"] = (
                    team_data[col]
                    .shift(1)
                    .rolling(window=self.window, min_periods=3)
                    .mean()
                )
            # Form: average points over last N matches
            team_data["Points"] = team_data.apply(
                lambda r: 3 if r["GF"] > r["GA"]
                         else (1 if r["GF"] == r["GA"] else 0),
                axis=1,
            )
            team_data["Form"] = (
                team_data["Points"]
                .shift(1)
                .rolling(window=self.window, min_periods=3)
                .mean()
            )
            rolling_stats[team] = team_data

        return pd.concat(rolling_stats.values())

    def build_match_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Join home and away team statistics
        for each match.
        """
        team_stats = self.compute_team_stats(df)

        stat_features = [c for c in team_stats.columns if c.startswith("avg_")]
        stat_features.append("Form")

        features_list = []

        for idx, match in df.iterrows():
            home = match["HomeTeam"]
            away = match["AwayTeam"]
            date = match["Date"]

            home_stats = team_stats[
                (team_stats["Team"] == home) &
                (team_stats["Date"] == date) &
                (team_stats["IsHome"] == 1)
            ]
            away_stats = team_stats[
                (team_stats["Team"] == away) &
                (team_stats["Date"] == date) &
                (team_stats["IsHome"] == 0)
            ]

            if home_stats.empty or away_stats.empty:
                continue

            row = {"match_idx": idx}
            for feat in stat_features:
                h_val = home_stats[feat].values[0]
                a_val = away_stats[feat].values[0]
                row[f"home_{feat}"] = h_val
                row[f"away_{feat}"] = a_val
                # Difference — one of the strongest features
                row[f"diff_{feat}"] = h_val - a_val

            features_list.append(row)

        features_df = pd.DataFrame(features_list).set_index("match_idx")
        result = df.join(features_df, how="inner")
        return result.dropna(subset=[c for c in features_df.columns])

# === Usage ===

engineer = FeatureEngineer(window=5)
featured*data = engineer.build_match_features(clean_data)
print(f"Matches with features: {len(featured_data)}")
print(f"Number of features: {len([c for c in featured_data.columns if c.startswith(('home*', 'away*', 'diff*'))])}")
Claude for Contextual Feature Generation
This is where things get interesting: we use Claude to analyze context that is unavailable in numerical data.
python
import anthropic
import json
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic() # key from ANTHROPIC_API_KEY env variable

def claude_analyze_matchup(
home_team: str,
away_team: str,
home_form: dict,
away_form: dict,
league: str,
) -> dict:
"""
Ask Claude to evaluate contextual match factors
that are difficult to extract from numerical data.

    Returns JSON with scores on a 0-10 scale.
    """
    prompt = f"""You are an expert football match analyst. Analyze the upcoming match

and return ONLY JSON (no markdown, no comments) with the following scores
on a scale from 0.0 to 1.0:

Match: {home_team} (home) vs {away_team} (away)
League: {league}

{home_team} stats over last 5 matches:

- Avg goals scored: {home_form.get('avg_GF', 'N/A'):.2f}
- Avg goals conceded: {home_form.get('avg_GA', 'N/A'):.2f}
- Avg shots: {home_form.get('avg_Shots', 'N/A'):.2f}
- Avg shots on target: {home_form.get('avg_SoT', 'N/A'):.2f}
- Form (avg points): {home_form.get('Form', 'N/A'):.2f}

{away_team} stats over last 5 matches:

- Avg goals scored: {away_form.get('avg_GF', 'N/A'):.2f}
- Avg goals conceded: {away_form.get('avg_GA', 'N/A'):.2f}
- Avg shots: {away_form.get('avg_Shots', 'N/A'):.2f}
- Avg shots on target: {away_form.get('avg_SoT', 'N/A'):.2f}
- Form (avg points): {away_form.get('Form', 'N/A'):.2f}

Return JSON strictly in the format:
{{
    "home_attack_strength": <float>,
    "home_defense_strength": <float>,
    "away_attack_strength": <float>,
    "away_defense_strength": <float>,
    "home_momentum": <float>,
    "away_momentum": <float>,
    "match_intensity_prediction": <float>,
    "upset_probability": <float>,
    "home_win_confidence": <float>,
    "draw_likelihood": <float>,
    "reasoning": "<brief 1-2 sentence explanation>"
}}"""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Extract JSON from response
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        # Try to find JSON in the response
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end > start:
            return json.loads(response_text[start:end])
        return {}

# === Usage Example ===

home_form_example = {
"avg_GF": 1.8, "avg_GA": 0.6,
"avg_Shots": 14.2, "avg_SoT": 5.8,
"Form": 2.4,
}
away_form_example = {
"avg_GF": 1.2, "avg_GA": 1.4,
"avg_Shots": 10.6, "avg_SoT": 3.2,
"Form": 1.2,
}

analysis = claude_analyze_matchup(
home_team="Arsenal",
away_team="Brighton",
home_form=home_form_example,
away_form=away_form_example,
league="Premier League",
)
print(json.dumps(analysis, indent=2, ensure_ascii=False))
Adding Bookmaker Odds as Features
Bookmaker odds are one of the strongest predictors because they already contain aggregated market expertise.
python
def add_odds_features(df: pd.DataFrame) -> pd.DataFrame:
"""
Convert bookmaker odds to probabilities
and add as features.
"""
df = df.copy()

    if all(col in df.columns for col in ["B365H", "B365D", "B365A"]):
        # Raw implied probabilities
        df["odds_prob_H"] = 1 / df["B365H"]
        df["odds_prob_D"] = 1 / df["B365D"]
        df["odds_prob_A"] = 1 / df["B365A"]

        # Normalization (removing bookmaker margin)
        total = df["odds_prob_H"] + df["odds_prob_D"] + df["odds_prob_A"]
        df["norm_prob_H"] = df["odds_prob_H"] / total
        df["norm_prob_D"] = df["odds_prob_D"] / total
        df["norm_prob_A"] = df["odds_prob_A"] / total

        # Probability spread (favorite vs underdog)
        df["odds_spread"] = df["norm_prob_H"] - df["norm_prob_A"]

    return df

featured_data = add_odds_features(featured_data)
Advanced Feature Engineering: ELO, xG Proxy, and Fatigue
Rolling averages over 5 matches are just the starting point. The literature shows that pi-ratings, ELO ratings, and xG significantly improve accuracy. Razali et al. (2022) demonstrated this on 216k matches: CatBoost + pi-ratings = 55.82% accuracy, the best Soccer Prediction Challenge result.
ELO Ratings with Margin of Victory
ELO is a ranking system adopted by FIFA since 2018. Its key property: it accounts for opponent strength, not just W/D/L.
python
class FootballELO:
"""
ELO ratings for football teams.

    FIFA formula: R_new = R_old + K * M * (S - E)
    where:
      K — match significance coefficient
      M — goal difference multiplier
      S — actual result (1 / 0.5 / 0)
      E — expected result by ELO
    """

    def __init__(self, k: int = 32, home_advantage: int = 65):
        self.k = k
        self.home_advantage = home_advantage
        self.ratings: dict[str, float] = {}

    def get_rating(self, team: str) -> float:
        return self.ratings.setdefault(team, 1500.0)

    def expected_score(self, rating_a: float, rating_b: float) -> float:
        """Probability of A beating B using the ELO formula."""
        return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))

    def margin_multiplier(self, goal_diff: int) -> float:
        """
        Goal difference multiplier.
        A 5-0 win should have more impact than 1-0.
        Formula from FiveThirtyEight: log(|diff| + 1) * 2.2 / (elo_diff * 0.001 + 2.2)
        Simplified version below.
        """
        return np.log(abs(goal_diff) + 1) * (2.2 / 2.2)  # without elo_diff correction

    def update(self, home: str, away: str,
               home_goals: int, away_goals: int) -> tuple[float, float]:
        """
        Update ratings after a match.
        Returns (new_home_elo, new_away_elo).
        """
        r_home = self.get_rating(home) + self.home_advantage
        r_away = self.get_rating(away)

        e_home = self.expected_score(r_home, r_away)
        e_away = 1.0 - e_home

        # Actual result
        if home_goals > away_goals:
            s_home, s_away = 1.0, 0.0
        elif home_goals < away_goals:
            s_home, s_away = 0.0, 1.0
        else:
            s_home, s_away = 0.5, 0.5

        # Goal difference multiplier
        m = self.margin_multiplier(home_goals - away_goals)

        # Update (without home_advantage in stored rating)
        self.ratings[home] += self.k * m * (s_home - e_home)
        self.ratings[away] += self.k * m * (s_away - e_away)

        return self.ratings[home], self.ratings[away]

    def compute_elo_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Iterate through all matches chronologically,
        updating ELO after each. For each match we save
        ratings BEFORE it starts (to prevent leakage).
        """
        df = df.sort_values("Date").copy()
        elo_features = []

        for _, row in df.iterrows():
            home = row["HomeTeam"]
            away = row["AwayTeam"]

            r_home = self.get_rating(home)
            r_away = self.get_rating(away)

            e_home = self.expected_score(
                r_home + self.home_advantage, r_away
            )

            elo_features.append({
                "elo_home": r_home,
                "elo_away": r_away,
                "elo_diff": r_home - r_away,
                "elo_expected_home": e_home,
                "elo_expected_away": 1 - e_home,
            })

            # Update AFTER saving pre-match ratings
            if pd.notna(row.get("FTHG")) and pd.notna(row.get("FTAG")):
                self.update(home, away,
                            int(row["FTHG"]), int(row["FTAG"]))

        return pd.concat(
            [df.reset_index(drop=True),
             pd.DataFrame(elo_features)],
            axis=1,
        )

# === Usage ===

elo_system = FootballELO(k=32, home_advantage=65)
featured_data = elo_system.compute_elo_features(featured_data)
print(f"Top 5 teams by ELO:")
top_teams = sorted(elo_system.ratings.items(),
key=lambda x: -x[1])[:5]
for team, rating in top_teams:
print(f" {team:25s} {rating:.0f}")
xG Proxy from Basic Statistics
True xG requires StatsBomb/Opta data (paid access). But we can build an xG proxy - an approximation of expected goals from available statistics:
python
def compute_xg_proxy(df: pd.DataFrame) -> pd.DataFrame:
"""
xG proxy: expected goals approximation from basic statistics.

    Formula: xG ≈ SoT * conversion_rate + (Shots - SoT) * low_conversion
    where conversion_rate ~ 0.30 for shots on target,
          low_conversion ~ 0.03 for shots off target.

    This is a rough approximation, but it captures
    key information: attacking play quality.
    """
    df = df.copy()

    SOT_CONVERSION = 0.30   # ~30% shots on target = goal (EPL average)
    SHOT_CONVERSION = 0.03  # ~3% shots off target = goal

    if "HST" in df.columns and "HS" in df.columns:
        df["home_xG_proxy"] = (
            df["HST"] * SOT_CONVERSION
            + (df["HS"] - df["HST"]).clip(lower=0) * SHOT_CONVERSION
        )
        df["away_xG_proxy"] = (
            df["AST"] * SOT_CONVERSION
            + (df["AS"] - df["AST"]).clip(lower=0) * SHOT_CONVERSION
        )

        # xG overperformance: actual goals minus expected
        # Positive value = team scores more than it "should"
        # Usually regresses to mean → correction signal
        df["home_xG_overperf"] = df["FTHG"] - df["home_xG_proxy"]
        df["away_xG_overperf"] = df["FTAG"] - df["away_xG_proxy"]

    return df

featured_data = compute_xg_proxy(featured_data)
Fatigue Factor and Fixture Congestion
Draper et al. (2024) showed that fatigue affects results. A simple proxy: the number of rest days between matches.
python
class FootballELO:
"""
ELO ratings for football teams.

    FIFA formula: R_new = R_old + K * M * (S - E)
    where:
      K — match significance coefficient
      M — goal difference multiplier
      S — actual result (1 / 0.5 / 0)
      E — expected result by ELO
    """

    def __init__(self, k: int = 32, home_advantage: int = 65):
        self.k = k
        self.home_advantage = home_advantage
        self.ratings: dict[str, float] = {}

    def get_rating(self, team: str) -> float:
        return self.ratings.setdefault(team, 1500.0)

    def expected_score(self, rating_a: float, rating_b: float) -> float:
        """Probability of A beating B using the ELO formula."""
        return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))

    def margin_multiplier(self, goal_diff: int) -> float:
        """
        Goal difference multiplier.
        A 5-0 win should have more impact than 1-0.
        Formula from FiveThirtyEight: log(|diff| + 1) * 2.2 / (elo_diff * 0.001 + 2.2)
        Simplified version below.
        """
        return np.log(abs(goal_diff) + 1) * (2.2 / 2.2)  # without elo_diff correction

    def update(self, home: str, away: str,
               home_goals: int, away_goals: int) -> tuple[float, float]:
        """
        Update ratings after a match.
        Returns (new_home_elo, new_away_elo).
        """
        r_home = self.get_rating(home) + self.home_advantage
        r_away = self.get_rating(away)

        e_home = self.expected_score(r_home, r_away)
        e_away = 1.0 - e_home

        # Actual result
        if home_goals > away_goals:
            s_home, s_away = 1.0, 0.0
        elif home_goals < away_goals:
            s_home, s_away = 0.0, 1.0
        else:
            s_home, s_away = 0.5, 0.5

        # Goal difference multiplier
        m = self.margin_multiplier(home_goals - away_goals)

        # Update (without home_advantage in stored rating)
        self.ratings[home] += self.k * m * (s_home - e_home)
        self.ratings[away] += self.k * m * (s_away - e_away)

        return self.ratings[home], self.ratings[away]

    def compute_elo_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Iterate through all matches chronologically,
        updating ELO after each. For each match we save
        ratings BEFORE it starts (to prevent leakage).
        """
        df = df.sort_values("Date").copy()
        elo_features = []

        for _, row in df.iterrows():
            home = row["HomeTeam"]
            away = row["AwayTeam"]

            r_home = self.get_rating(home)
            r_away = self.get_rating(away)

            e_home = self.expected_score(
                r_home + self.home_advantage, r_away
            )

            elo_features.append({
                "elo_home": r_home,
                "elo_away": r_away,
                "elo_diff": r_home - r_away,
                "elo_expected_home": e_home,
                "elo_expected_away": 1 - e_home,
            })

            # Update AFTER saving pre-match ratings
            if pd.notna(row.get("FTHG")) and pd.notna(row.get("FTAG")):
                self.update(home, away,
                            int(row["FTHG"]), int(row["FTAG"]))

        return pd.concat(
            [df.reset_index(drop=True),
             pd.DataFrame(elo_features)],
            axis=1,
        )

# === Usage ===

elo_system = FootballELO(k=32, home_advantage=65)
featured_data = elo_system.compute_elo_features(featured_data)
print(f"Top 5 teams by ELO:")
top_teams = sorted(elo_system.ratings.items(),
key=lambda x: -x[1])[:5]
for team, rating in top_teams:
print(f" {team:25s} {rating:.0f}")
xG Proxy from Basic Statistics
True xG requires StatsBomb/Opta data (paid access). But we can build an xG proxy - an approximation of expected goals from available statistics:
python
def compute_xg_proxy(df: pd.DataFrame) -> pd.DataFrame:
"""
xG proxy: expected goals approximation from basic statistics.

    Formula: xG ≈ SoT * conversion_rate + (Shots - SoT) * low_conversion
    where conversion_rate ~ 0.30 for shots on target,
          low_conversion ~ 0.03 for shots off target.

    This is a rough approximation, but it captures
    key information: attacking play quality.
    """
    df = df.copy()

    SOT_CONVERSION = 0.30   # ~30% shots on target = goal (EPL average)
    SHOT_CONVERSION = 0.03  # ~3% shots off target = goal

    if "HST" in df.columns and "HS" in df.columns:
        df["home_xG_proxy"] = (
            df["HST"] * SOT_CONVERSION
            + (df["HS"] - df["HST"]).clip(lower=0) * SHOT_CONVERSION
        )
        df["away_xG_proxy"] = (
            df["AST"] * SOT_CONVERSION
            + (df["AS"] - df["AST"]).clip(lower=0) * SHOT_CONVERSION
        )

        # xG overperformance: actual goals minus expected
        # Positive value = team scores more than it "should"
        # Usually regresses to mean → correction signal
        df["home_xG_overperf"] = df["FTHG"] - df["home_xG_proxy"]
        df["away_xG_overperf"] = df["FTAG"] - df["away_xG_proxy"]

    return df

featured_data = compute_xg_proxy(featured_data)
Fatigue Factor and Fixture Congestion
Draper et al. (2024) showed that fatigue affects results. A simple proxy: the number of rest days between matches.
python
def compute_fatigue_features(df: pd.DataFrame) -> pd.DataFrame:
"""
Fatigue features: rest days between matches.

    Less than 3 rest days → significant performance decline.
    Midweek matches (Tue/Wed) after weekends → fatigue.
    """
    df = df.sort_values("Date").copy()

    rest_days_home = []
    rest_days_away = []
    last_match: dict[str, pd.Timestamp] = {}

    for _, row in df.iterrows():
        home = row["HomeTeam"]
        away = row["AwayTeam"]
        date = row["Date"]

        # Rest days for home team
        if home in last_match:
            delta = (date - last_match[home]).days
            rest_days_home.append(min(delta, 30))  # cap at 30
        else:
            rest_days_home.append(14)  # first match → default

        # Rest days for away team
        if away in last_match:
            delta = (date - last_match[away]).days
            rest_days_away.append(min(delta, 30))
        else:
            rest_days_away.append(14)

        last_match[home] = date
        last_match[away] = date

    df["home_rest_days"] = rest_days_home
    df["away_rest_days"] = rest_days_away
    df["rest_advantage"] = df["home_rest_days"] - df["away_rest_days"]

    # Binary flags
    df["home_fatigued"] = (df["home_rest_days"] <= 3).astype(int)
    df["away_fatigued"] = (df["away_rest_days"] <= 3).astype(int)

    # Day of week (Tuesday/Wednesday = midweek fixture)
    df["is_midweek"] = df["Date"].dt.dayofweek.isin([1, 2]).astype(int)

    return df

featured_data = compute_fatigue_features(featured_data)
Head-to-Head History
python
def compute_h2h_features(df: pd.DataFrame, n_last: int = 5) -> pd.DataFrame:
"""
Head-to-head statistics between teams.
Some pairs have persistent patterns
(e.g., one team historically dominates).
"""
df = df.sort_values("Date").copy()
h2h_features = []

    for idx, row in df.iterrows():
        home = row["HomeTeam"]
        away = row["AwayTeam"]
        date = row["Date"]

        # All previous meetings between these teams
        prev = df[
            (df["Date"] < date)
            & (
                ((df["HomeTeam"] == home) & (df["AwayTeam"] == away))
                | ((df["HomeTeam"] == away) & (df["AwayTeam"] == home))
            )
        ].tail(n_last)

        if len(prev) < 2:
            h2h_features.append({
                "h2h_home_wins": np.nan,
                "h2h_draws": np.nan,
                "h2h_total_goals_avg": np.nan,
            })
            continue

        # Count results from home team's perspective
        home_wins = 0
        draws = 0
        total_goals = 0

        for _, p in prev.iterrows():
            if p["HomeTeam"] == home:
                if p["FTR"] == "H": home_wins += 1
                elif p["FTR"] == "D": draws += 1
                total_goals += p["FTHG"] + p["FTAG"]
            else:  # home team played away
                if p["FTR"] == "A": home_wins += 1
                elif p["FTR"] == "D": draws += 1
                total_goals += p["FTHG"] + p["FTAG"]

        n = len(prev)
        h2h_features.append({
            "h2h_home_wins": home_wins / n,
            "h2h_draws": draws / n,
            "h2h_total_goals_avg": total_goals / n,
        })

    h2h_df = pd.DataFrame(h2h_features, index=df.index)
    return pd.concat([df, h2h_df], axis=1)

featured_data = compute_h2h_features(featured_data)
print(f"Total features: {len([c for c in featured_data.columns if c not in ['Date', 'HomeTeam', 'AwayTeam', 'FTR', 'Result', 'League', 'Season']])}")
Polymarket Integration: Prediction Market as a Signal Source
Why Polymarket Is Not Just Another Bookmaker
Polymarket is a decentralized prediction market on the Polygon blockchain, where contract prices are formed by real money from traders (USDC). Key differences from bookmaker odds:
| Parameter | Bookmaker (Bet365) | Polymarket |
|---|---|---|
| Pricing mechanism | Algorithm + bookmaker traders | Free market (CLOB) |
| Margin | 5-12% overround | ~1-2% (exchange spreads) |
| Participants | Mass audience | Crypto traders, quants, informed agents |
| News reaction speed | Minutes-hours | Seconds-minutes |
| Transparency | Closed model | Fully open order book |
| Signal | Aggregated expertise + margin | "Pure" crowd intelligence |
When Polymarket and the bookmaker diverge in their estimates - that's a potential edge. The divergence indicates that one source knows something the other doesn't (injuries, inside information, recent form).
Connecting to the Polymarket Gamma API
The Gamma API is fully open - no API key or authentication required. This allows free access to probabilities for any market.
python
import requests
import json
import time
from dataclasses import dataclass

GAMMA_API = "https://gamma-api.polymarket.com"

@dataclass
class PolymarketOdds:
"""Structure for storing Polymarket probabilities."""
home_win: float
draw: float | None # Some markets are binary (no draw)
away_win: float
liquidity: float
volume_24h: float
market_slug: str
last_updated: str

class PolymarketClient:
"""
Client for fetching sports markets from Polymarket.

    Polymarket Gamma API — public REST API requiring
    no authorization. Limits: ~50 results per request,
    recommended rate limit ~1 req/sec.
    """

    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36"
        )
    }

    # Keywords for filtering football markets
    FOOTBALL_KEYWORDS = [
        "soccer", "premier league", "la liga", "bundesliga",
        "serie a", "ligue 1", "champions league", "uefa",
        "manchester", "liverpool", "arsenal", "chelsea",
        "barcelona", "real madrid", "bayern", "psg",
        "epl", "football match",
    ]

    def search_football_markets(
        self, limit: int = 100
    ) -> list[dict]:
        """
        Find all active football markets on Polymarket.
        Filter by keywords in the market question.
        """
        all_markets = []
        offset = 0

        while offset < limit:
            try:
                resp = requests.get(
                    f"{GAMMA_API}/markets",
                    params={
                        "active": "true",
                        "closed": "false",
                        "limit": 50,
                        "offset": offset,
                    },
                    headers=self.HEADERS,
                    timeout=15,
                )
                resp.raise_for_status()
                markets = resp.json()

                if not markets:
                    break

                # Filter by football keywords
                for market in markets:
                    question = market.get("question", "").lower()
                    description = market.get("description", "").lower()
                    text = question + " " + description

                    if any(kw in text for kw in self.FOOTBALL_KEYWORDS):
                        all_markets.append(market)

                offset += 50
                time.sleep(0.5)  # Polite rate limiting

            except requests.RequestException as e:
                print(f"  ⚠ Request error: {e}")
                break

        print(f"  ✓ Found {len(all_markets)} football markets")
        return all_markets

    def get_event_markets(self, event_slug: str) -> list[dict]:
        """
        Get all markets for a specific event (e.g., a match).

        Polymarket organizes data hierarchically:
        Event → Markets → Outcomes
        """
        try:
            resp = requests.get(
                f"{GAMMA_API}/events",
                params={
                    "slug": event_slug,
                    "closed": "false",
                },
                headers=self.HEADERS,
                timeout=15,
            )
            resp.raise_for_status()
            events = resp.json()

            if events:
                return events[0].get("markets", [])
            return []

        except requests.RequestException as e:
            print(f"  ⚠ Error: {e}")
            return []

    def extract_match_odds(self, market: dict) -> PolymarketOdds | None:
        """
        Extract probabilities from market data.

        On Polymarket, contract price = implied probability.
        "Yes" price = $0.65 → 65% probability.
        """
        try:
            outcomes = market.get("outcomes", [])
            prices_raw = market.get("outcomePrices", "[]")

            if isinstance(prices_raw, str):
                prices = json.loads(prices_raw)
            else:
                prices = prices_raw

            if len(prices) < 2:
                return None

            prices = [float(p) for p in prices]
            outcomes_lower = [o.lower() for o in outcomes]

            # Determine market type
            # Option 1: binary market "Team A wins?"
            if len(prices) == 2:
                return PolymarketOdds(
                    home_win=prices[0],
                    draw=None,
                    away_win=prices[1],
                    liquidity=float(market.get("liquidity", 0) or 0),
                    volume_24h=float(market.get("volume24hr", 0) or 0),
                    market_slug=market.get("slug", ""),
                    last_updated=market.get("updatedAt", ""),
                )

            # Option 2: 3-way market (Home / Draw / Away)
            if len(prices) >= 3:
                home_idx = next(
                    (i for i, o in enumerate(outcomes_lower)
                     if "home" in o or "win" in o),
                    0,
                )
                draw_idx = next(
                    (i for i, o in enumerate(outcomes_lower)
                     if "draw" in o or "tie" in o),
                    1,
                )
                away_idx = next(
                    (i for i, o in enumerate(outcomes_lower)
                     if "away" in o or "lose" in o),
                    2,
                )

                return PolymarketOdds(
                    home_win=prices[home_idx],
                    draw=prices[draw_idx],
                    away_win=prices[away_idx],
                    liquidity=float(market.get("liquidity", 0) or 0),
                    volume_24h=float(market.get("volume24hr", 0) or 0),
                    market_slug=market.get("slug", ""),
                    last_updated=market.get("updatedAt", ""),
                )

        except (ValueError, IndexError, KeyError) as e:
            print(f"  ⚠ Failed to extract prices: {e}")

        return None

# === Usage ===

poly_client = PolymarketClient()
football_markets = poly_client.search_football_markets(limit=200)

for market in football_markets[:5]:
odds = poly_client.extract_match_odds(market)
if odds:
print(f"\n 📊 {market['question']}")
print(f" Home: {odds.home_win:.1%} | "
f"Draw: {odds.draw:.1%} | "
f"Away: {odds.away_win:.1%}" if odds.draw
else f" Yes: {odds.home_win:.1%} | "
f"No: {odds.away_win:.1%}")
print(f" Liquidity: ${odds.liquidity:,.0f} | "
f"24h Vol: ${odds.volume_24h:,.0f}")
Fetching Historical Prices (for Backtesting)
Training the model requires historical Polymarket probabilities - not just current prices.
python
class PolymarketHistorical:
"""
Fetching historical prices from Polymarket CLOB API
for use in backtesting.
"""

    CLOB_API = "https://clob.polymarket.com"

    def get_price_history(
        self, token_id: str, interval: str = "1d",
        fidelity: int = 60,
    ) -> pd.DataFrame:
        """
        Get price history for a specific outcome token.

        Args:
            token_id: Token ID from market data
            interval: time interval ('1d', '1w', '1m', 'all')
            fidelity: granularity in minutes
        """
        try:
            resp = requests.get(
                f"{self.CLOB_API}/prices-history",
                params={
                    "market": token_id,
                    "interval": interval,
                    "fidelity": fidelity,
                },
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()

            if not data or "history" not in data:
                return pd.DataFrame()

            df = pd.DataFrame(data["history"])
            df["timestamp"] = pd.to_datetime(df["t"], unit="s")
            df["price"] = df["p"].astype(float)
            df = df[["timestamp", "price"]].sort_values("timestamp")

            return df

        except requests.RequestException as e:
            print(f"  ⚠ Error fetching history: {e}")
            return pd.DataFrame()

    def get_orderbook_snapshot(self, token_id: str) -> dict:
        """
        Order book snapshot — shows liquidity depth.
        Thin order book = unreliable signal.
        Deep order book = strong market consensus.
        """
        try:
            resp = requests.get(
                f"{self.CLOB_API}/book",
                params={"token_id": token_id},
                timeout=15,
            )
            resp.raise_for_status()
            book = resp.json()

            bids = book.get("bids", [])
            asks = book.get("asks", [])

            total_bid_depth = sum(
                float(b.get("size", 0)) for b in bids
            )
            total_ask_depth = sum(
                float(a.get("size", 0)) for a in asks
            )

            best_bid = float(bids[0]["price"]) if bids else 0
            best_ask = float(asks[0]["price"]) if asks else 1
            spread = best_ask - best_bid
            midpoint = (best_bid + best_ask) / 2

            return {
                "midpoint": midpoint,
                "spread": spread,
                "spread_pct": spread / midpoint if midpoint > 0 else 0,
                "bid_depth_usd": total_bid_depth,
                "ask_depth_usd": total_ask_depth,
                "total_depth": total_bid_depth + total_ask_depth,
                "imbalance": (
                    (total_bid_depth - total_ask_depth)
                    / (total_bid_depth + total_ask_depth)
                    if (total_bid_depth + total_ask_depth) > 0
                    else 0
                ),
            }

        except (requests.RequestException, IndexError, ValueError):
            return {}

# === Example ===

# hist_client = PolymarketHistorical()

# price_history = hist_client.get_price_history(

# token_id="<token_id_from_market>",

# interval="1w",

# )

# print(price_history.tail())

Combining Three Probability Layers
This is the core of the system - merging three independent probability sources into a unified feature set.
python
class TripleLayerFeatures:
"""
Combining three probability layers: 1. Bookmaker (Bet365) — margined odds 2. Polymarket — blockchain crowd intelligence 3. ML model — our own estimate

    Divergences between layers are among the most valuable features.
    """

    @staticmethod
    def compute_divergence_features(
        bookmaker_probs: dict,
        polymarket_probs: dict,
        ml_probs: dict | None = None,
    ) -> dict:
        """
        Compute features based on divergences
        between probability sources.

        High divergence may indicate:
        - Insider information on one of the markets
        - One source lagging behind
        - Value bet opportunity
        """
        features = {}

        # === Raw probabilities from each source ===
        for prefix, probs in [("bk", bookmaker_probs),
                               ("poly", polymarket_probs)]:
            features[f"{prefix}_prob_H"] = probs.get("home", 0)
            features[f"{prefix}_prob_D"] = probs.get("draw", 0)
            features[f"{prefix}_prob_A"] = probs.get("away", 0)

        # === KL-divergence between bookmaker and Polymarket ===
        # Higher KL-divergence = stronger disagreement
        epsilon = 1e-6
        kl_div = 0
        for key in ["home", "draw", "away"]:
            p = bookmaker_probs.get(key, epsilon)
            q = polymarket_probs.get(key, epsilon)
            p = max(p, epsilon)
            q = max(q, epsilon)
            kl_div += p * np.log(p / q)
        features["kl_div_bk_poly"] = kl_div

        # === Absolute divergences ===
        for key, label in [("home", "H"), ("draw", "D"), ("away", "A")]:
            bk = bookmaker_probs.get(key, 0)
            poly = polymarket_probs.get(key, 0)
            features[f"divergence_{label}"] = bk - poly
            features[f"abs_divergence_{label}"] = abs(bk - poly)

        # === Maximum divergence (across any outcome) ===
        features["max_divergence"] = max(
            features["abs_divergence_H"],
            features["abs_divergence_D"],
            features["abs_divergence_A"],
        )

        # === Who is favorite by each source ===
        bk_favorite = max(bookmaker_probs, key=bookmaker_probs.get)
        poly_favorite = max(polymarket_probs, key=polymarket_probs.get)
        features["sources_agree"] = int(bk_favorite == poly_favorite)

        # === Weighted average probabilities ===
        # Polymarket with higher liquidity → higher weight
        for key, label in [("home", "H"), ("draw", "D"), ("away", "A")]:
            bk = bookmaker_probs.get(key, 0)
            poly = polymarket_probs.get(key, 0)
            # 50/50 by default, adjustable
            features[f"blended_prob_{label}"] = 0.5 * bk + 0.5 * poly

        # === If ML probabilities available — triple system ===
        if ml_probs:
            for key, label in [("home", "H"), ("draw", "D"),
                                ("away", "A")]:
                ml = ml_probs.get(key, 0)
                bk = bookmaker_probs.get(key, 0)
                poly = polymarket_probs.get(key, 0)

                features[f"ml_prob_{label}"] = ml
                features[f"ml_vs_bk_{label}"] = ml - bk
                features[f"ml_vs_poly_{label}"] = ml - poly

                # Triple blend: ML=40%, Polymarket=35%, Bookmaker=25%
                features[f"triple_blend_{label}"] = (
                    0.40 * ml + 0.35 * poly + 0.25 * bk
                )

            # All three sources agree?
            ml_favorite = max(ml_probs, key=ml_probs.get)
            features["all_three_agree"] = int(
                bk_favorite == poly_favorite == ml_favorite
            )

        return features

    @staticmethod
    def compute_liquidity_features(orderbook: dict) -> dict:
        """
        Features based on Polymarket liquidity.

        Liquidity depth is a market confidence indicator.
        Narrow spread + deep order book = strong consensus.
        """
        return {
            "poly_spread": orderbook.get("spread", 0),
            "poly_spread_pct": orderbook.get("spread_pct", 0),
            "poly_depth_total": orderbook.get("total_depth", 0),
            "poly_depth_log": np.log1p(
                orderbook.get("total_depth", 0)
            ),
            "poly_imbalance": orderbook.get("imbalance", 0),
            # Binary: liquidity above threshold?
            "poly_liquid_market": int(
                orderbook.get("total_depth", 0) > 5000
            ),
        }

# === Usage Example ===

bookmaker = {"home": 0.55, "draw": 0.25, "away": 0.20}
polymarket = {"home": 0.48, "draw": 0.22, "away": 0.30}
ml_model_probs = {"home": 0.52, "draw": 0.23, "away": 0.25}

triple_features = TripleLayerFeatures.compute_divergence_features(
bookmaker_probs=bookmaker,
polymarket_probs=polymarket,
ml_probs=ml_model_probs,
)

print("=== Triple Layer Features ===")
for k, v in triple_features.items():
print(f" {k:30s} = {v:.4f}")
Visualizing Divergences: Bookmaker vs Polymarket
python
def plot_probability_divergence(
matches: list[dict],
figsize: tuple = (14, 8),
):
"""
Scatter plot: bookmaker probabilities vs Polymarket.
Points far from the diagonal = divergences = potential edge.

    matches: [{"name": "...", "bk_home": 0.55, "poly_home": 0.48}, ...]
    """
    fig, axes = plt.subplots(1, 3, figsize=figsize)
    outcomes = [("home", "Home Win"), ("draw", "Draw"), ("away", "Away Win")]
    colors = ["#2ecc71", "#f1c40f", "#e74c3c"]

    for ax, (key, title), color in zip(axes, outcomes, colors):
        bk_probs = [m[f"bk_{key}"] for m in matches]
        poly_probs = [m[f"poly_{key}"] for m in matches]

        ax.scatter(bk_probs, poly_probs, alpha=0.6, color=color,
                   edgecolors="white", s=60)

        # Diagonal (full agreement)
        ax.plot([0, 1], [0, 1], "k--", alpha=0.3, linewidth=1)

        # Divergence zones
        ax.fill_between([0, 1], [0.05, 1.05], [0, 1],
                        alpha=0.05, color="blue",
                        label="Polymarket higher")
        ax.fill_between([0, 1], [0, 1], [-0.05, 0.95],
                        alpha=0.05, color="red",
                        label="Bookmaker higher")

        ax.set_xlabel("Bookmaker P", fontsize=11)
        ax.set_ylabel("Polymarket P", fontsize=11)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_aspect("equal")
        ax.legend(fontsize=8, loc="upper left")

    plt.suptitle(
        "Probability Divergence: Bookmaker vs Polymarket\n"
        "Points far from diagonal → potential value",
        fontsize=14, y=1.04,
    )
    plt.tight_layout()
    plt.savefig("divergence_scatter.png", bbox_inches="tight")
    plt.show()

def plot_triple_layer_radar(
match_name: str,
bookmaker: dict,
polymarket: dict,
ml_model: dict,
):
"""
Radar chart: comparing three probability sources
for a single match.
"""
categories = ["Home Win", "Draw", "Away Win"]
keys = ["home", "draw", "away"]

    fig, ax = plt.subplots(figsize=(8, 8),
                            subplot_kw=dict(polar=True))

    angles = np.linspace(0, 2 * np.pi, len(categories),
                          endpoint=False).tolist()
    angles += angles[:1]

    sources = [
        ("Bookmaker", bookmaker, "#3498db"),
        ("Polymarket", polymarket, "#e74c3c"),
        ("ML Model", ml_model, "#2ecc71"),
    ]

    for label, probs, color in sources:
        values = [probs[k] for k in keys]
        values += values[:1]
        ax.plot(angles, values, "o-", linewidth=2,
                label=label, color=color)
        ax.fill(angles, values, alpha=0.1, color=color)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=12)
    ax.set_ylim(0, 0.8)
    ax.set_title(f"Triple Layer: {match_name}",
                 fontsize=14, pad=20)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1))

    plt.tight_layout()
    plt.savefig("triple_radar.png", bbox_inches="tight")
    plt.show()

# === Example ===

# plot_triple_layer_radar(

# "Arsenal vs Manchester City",

# bookmaker={"home": 0.42, "draw": 0.28, "away": 0.30},

# polymarket={"home": 0.38, "draw": 0.24, "away": 0.38},

# ml_model={"home": 0.45, "draw": 0.26, "away": 0.29},

# )

Claude Analyzes Divergences
python
def claude_analyze_divergence(
match: str,
bookmaker: dict,
polymarket: dict,
ml_model: dict,
poly_liquidity: float,
poly_volume_24h: float,
) -> str:
"""
Claude analyzes divergences between three sources
and proposes an interpretation.
"""
prompt = f"""You are a senior sports analyst. You have three probability
sources for a football match. Analyze the divergences.

**Match:** {match}

| Source             | Home                     | Draw                     | Away                     |
| ------------------ | ------------------------ | ------------------------ | ------------------------ |
| Bookmaker (Bet365) | {bookmaker['home']:.1%}  | {bookmaker['draw']:.1%}  | {bookmaker['away']:.1%}  |
| Polymarket         | {polymarket['home']:.1%} | {polymarket['draw']:.1%} | {polymarket['away']:.1%} |
| ML Model           | {ml_model['home']:.1%}   | {ml_model['draw']:.1%}   | {ml_model['away']:.1%}   |

**Polymarket metadata:**

- Liquidity: ${poly_liquidity:,.0f}
- 24h volume: ${poly_volume_24h:,.0f}

**Task:**

1. Where are the main divergences and what might they mean?
2. Which source should be trusted more in this case and why?
3. Are there signs of insider activity on Polymarket?
   (unusual volume, sharp probability shift)
4. What final prediction would you give and with what confidence?

Be specific, no filler. 5-8 sentences."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )

    return message.content[0].text

# === Example ===

# analysis = claude_analyze_divergence(

# match="Arsenal vs Manchester City",

# bookmaker={"home": 0.42, "draw": 0.28, "away": 0.30},

# polymarket={"home": 0.38, "draw": 0.24, "away": 0.38},

# ml_model={"home": 0.45, "draw": 0.26, "away": 0.29},

# poly_liquidity=45000,

# poly_volume_24h=12000,

# )

# print(analysis)

Building the ML Model
Preparing Data for Training
python
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
accuracy_score, classification_report,
confusion_matrix, log_loss,
)

def prepare*model_data(df: pd.DataFrame) -> tuple:
"""
Prepare data: extract features and target variable.
We use ONLY features available before match start.
"""
feature_cols = [c for c in df.columns
if c.startswith(("home*", "away*", "diff*",
"norm*prob*", "odds_spread"))]

    X = df[feature_cols].copy()
    y = df["Result"].copy()

    # Fill missing values with median
    X = X.fillna(X.median())

    print(f"Features: {X.shape[1]}")
    print(f"Matches: {X.shape[0]}")
    print(f"Class balance: {y.value_counts().to_dict()}")

    return X, y, feature_cols

X, y, feature_names = prepare_model_data(featured_data)
Training Multiple Models
python
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import (
RandomForestClassifier, GradientBoostingClassifier,
VotingClassifier,
)
from xgboost import XGBClassifier

def train_and_evaluate(X, y):
"""
Train multiple models with time series validation
(no data leakage from the future).
""" # TimeSeriesSplit — correct validation for time series data
tscv = TimeSeriesSplit(n_splits=5)
scaler = StandardScaler()

    models = {
        "Logistic Regression": LogisticRegression(
            max_iter=1000, multi_class="multinomial", C=0.5,
        ),
        "Random Forest": RandomForestClassifier(
            n_estimators=200, max_depth=8,
            min_samples_leaf=10, random_state=42,
        ),
        "XGBoost": XGBClassifier(
            n_estimators=200, max_depth=5,
            learning_rate=0.05, subsample=0.8,
            colsample_bytree=0.8, random_state=42,
            eval_metric="mlogloss",
        ),
        "Gradient Boosting": GradientBoostingClassifier(
            n_estimators=150, max_depth=4,
            learning_rate=0.08, random_state=42,
        ),
    }

    results = {}

    for name, model in models.items():
        fold_accuracies = []
        fold_log_losses = []

        for train_idx, test_idx in tscv.split(X):
            X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
            y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)

            model.fit(X_train_scaled, y_train)

            preds = model.predict(X_test_scaled)
            proba = model.predict_proba(X_test_scaled)

            fold_accuracies.append(accuracy_score(y_test, preds))
            fold_log_losses.append(log_loss(y_test, proba))

        results[name] = {
            "accuracy_mean": np.mean(fold_accuracies),
            "accuracy_std": np.std(fold_accuracies),
            "log_loss_mean": np.mean(fold_log_losses),
            "log_loss_std": np.std(fold_log_losses),
        }

        print(f"\n{'='*50}")
        print(f"  {name}")
        print(f"  Accuracy:  {results[name]['accuracy_mean']:.4f} "
              f"± {results[name]['accuracy_std']:.4f}")
        print(f"  Log Loss:  {results[name]['log_loss_mean']:.4f} "
              f"± {results[name]['log_loss_std']:.4f}")

    return results, models

results, models = train_and_evaluate(X, y)
Ensemble: Combining Models
python
def build_ensemble(X, y):
"""
Build an ensemble model with soft voting.
Ensembles usually outperform individual models.
"""
scaler = StandardScaler()

    ensemble = VotingClassifier(
        estimators=[
            ("lr", LogisticRegression(
                max_iter=1000, multi_class="multinomial", C=0.5)),
            ("rf", RandomForestClassifier(
                n_estimators=200, max_depth=8, random_state=42)),
            ("xgb", XGBClassifier(
                n_estimators=200, max_depth=5, learning_rate=0.05,
                random_state=42, eval_metric="mlogloss")),
        ],
        voting="soft",  # use probabilities, not votes
        weights=[1, 1, 2],  # higher weight for XGBoost
    )

    # Final training on all data (for production)
    # In practice, keep a holdout set
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    ensemble.fit(X_train_scaled, y_train)

    preds = ensemble.predict(X_test_scaled)
    proba = ensemble.predict_proba(X_test_scaled)

    print(f"\n{'='*60}")
    print(f"  ENSEMBLE (Soft Voting)")
    print(f"  Accuracy:  {accuracy_score(y_test, preds):.4f}")
    print(f"  Log Loss:  {log_loss(y_test, proba):.4f}")
    print(f"\n{classification_report(y_test, preds, "
          f"target_names=['Away Win', 'Draw', 'Home Win'])}")

    return ensemble, scaler

ensemble_model, scaler = build_ensemble(X, y)
Claude API Integration for Interpretation
One of Claude's key strengths is the ability to transform dry numbers into clear analytical conclusions.
Generating Detailed Predictions
python
def generate_prediction_report(
home_team: str,
away_team: str,
model_proba: dict,
stats: dict,
league: str,
) -> str:
"""
Generate a detailed analytical report
using Claude based on model probabilities
and team statistics.
"""
prompt = f"""You are a professional football analyst. Based on the machine
learning model data and team statistics, write a concise but
insightful analytical report on the upcoming match.

## Model Data

Match: **{home_team}** vs **{away_team}** ({league})

Model probabilities (ML Ensemble):

- {home_team} win: {model_proba['home_win']:.1%}
- Draw: {model_proba['draw']:.1%}
- {away_team} win: {model_proba['away_win']:.1%}

{home_team} stats (last 5 matches):

- Goals scored (avg): {stats['home_avg_GF']:.2f}
- Goals conceded (avg): {stats['home_avg_GA']:.2f}
- Shots on target (avg): {stats['home_avg_SoT']:.1f}
- Form (avg points): {stats['home_Form']:.2f}

{away_team} stats (last 5 matches):

- Goals scored (avg): {stats['away_avg_GF']:.2f}
- Goals conceded (avg): {stats['away_avg_GA']:.2f}
- Shots on target (avg): {stats['away_avg_SoT']:.1f}
- Form (avg points): {stats['away_Form']:.2f}

## Task

Write an analytical report that includes:

1. Key factors affecting the prediction
2. Strengths and weaknesses of each team
3. Most likely outcome prediction
4. Confidence level (high / medium / low)
5. Potential risks and upset scenarios

Write concisely, professionally, no filler."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    return message.content[0].text

# === Example ===

report = generate_prediction_report(
home_team="Arsenal",
away_team="Brighton",
model_proba={"home_win": 0.58, "draw": 0.22, "away_win": 0.20},
stats={
"home_avg_GF": 1.8, "home_avg_GA": 0.6,
"home_avg_SoT": 5.8, "home_Form": 2.4,
"away_avg_GF": 1.2, "away_avg_GA": 1.4,
"away_avg_SoT": 3.2, "away_Form": 1.2,
},
league="Premier League",
)
print(report)
Batch Matchday Analysis
python
def analyze_matchday(matches: list[dict]) -> list[dict]:
"""
Analyze an entire matchday with a single Claude call.
More efficient than separate requests for each match.
"""
matches_text = ""
for i, m in enumerate(matches, 1):
matches_text += f"""
{i}. {m['home']} vs {m['away']}
ML prediction: H={m['prob_H']:.0%} | D={m['prob_D']:.0%} | A={m['prob_A']:.0%}
Home form: {m['home_form']:.2f} | Away form: {m['away_form']:.2f}
"""

    prompt = f"""Analyze the upcoming matchday. For each match, provide:

- Prediction (1X2)
- Confidence (⭐ low, ⭐⭐ medium, ⭐⭐⭐ high)
- Brief comment (1 sentence)

Matches:
{matches_text}

Return in table format. At the end, add the 1-2 best picks of the matchday (highest confidence)."""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    return message.content[0].text

Visualizing Results
Model Comparison
python
import matplotlib.pyplot as plt
import matplotlib
import seaborn as sns

# Style settings

matplotlib.rcParams["figure.dpi"] = 120
matplotlib.rcParams["font.size"] = 11
sns.set_style("whitegrid")

def plot_model_comparison(results: dict):
"""Visualization of model accuracy comparison."""
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    names = list(results.keys())
    accuracies = [results[n]["accuracy_mean"] for n in names]
    acc_stds = [results[n]["accuracy_std"] for n in names]
    log_losses = [results[n]["log_loss_mean"] for n in names]
    ll_stds = [results[n]["log_loss_std"] for n in names]

    colors = ["#2ecc71", "#3498db", "#e74c3c", "#f39c12"]

    # Accuracy
    bars = axes[0].barh(names, accuracies, xerr=acc_stds,
                         color=colors, edgecolor="white", linewidth=1.5)
    axes[0].set_xlabel("Accuracy")
    axes[0].set_title("Model Accuracy (TimeSeriesSplit CV)")
    axes[0].set_xlim(0.3, 0.65)
    for bar, val in zip(bars, accuracies):
        axes[0].text(val + 0.005, bar.get_y() + bar.get_height()/2,
                     f"{val:.3f}", va="center", fontweight="bold")

    # Log Loss
    bars = axes[1].barh(names, log_losses, xerr=ll_stds,
                         color=colors, edgecolor="white", linewidth=1.5)
    axes[1].set_xlabel("Log Loss")
    axes[1].set_title("Model Log Loss (lower = better)")
    for bar, val in zip(bars, log_losses):
        axes[1].text(val + 0.005, bar.get_y() + bar.get_height()/2,
                     f"{val:.3f}", va="center", fontweight="bold")

    plt.tight_layout()
    plt.savefig("model_comparison.png", bbox_inches="tight")
    plt.show()

# plot_model_comparison(results)

Confusion Matrix
python
def plot*feature_importance(model, feature_names, top_n=15):
"""
Feature importance visualization for XGBoost / Random Forest.
""" # For XGBoost or RF
if hasattr(model, "feature_importances*"):
importances = model.feature*importances*
else:
return

    indices = np.argsort(importances)[-top_n:]

    fig, ax = plt.subplots(figsize=(10, 8))

    colors = plt.cm.RdYlGn(np.linspace(0.2, 0.8, top_n))
    ax.barh(
        range(top_n),
        importances[indices],
        color=colors,
        edgecolor="white",
        linewidth=0.8,
    )
    ax.set_yticks(range(top_n))
    ax.set_yticklabels([feature_names[i] for i in indices])
    ax.set_xlabel("Feature Importance")
    ax.set_title(f"Top {top_n} Important Features", fontsize=14)

    plt.tight_layout()
    plt.savefig("feature_importance.png", bbox_inches="tight")
    plt.show()

Feature Importance
python
def plot_confusion_matrix(y_true, y_pred):
"""Confusion matrix visualization."""
cm = confusion_matrix(y_true, y_pred)
labels = ["Away Win", "Draw", "Home Win"]

    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues",
        xticklabels=labels, yticklabels=labels,
        ax=ax, linewidths=0.5, linecolor="white",
        annot_kws={"size": 14, "weight": "bold"},
    )
    ax.set_xlabel("Predicted Result", fontsize=12)
    ax.set_ylabel("Actual Result", fontsize=12)
    ax.set_title("Confusion Matrix — Ensemble Model", fontsize=14)

    # Add percentages
    cm_pct = cm / cm.sum(axis=1, keepdims=True)
    for i in range(3):
        for j in range(3):
            ax.text(j + 0.5, i + 0.75,
                    f"({cm_pct[i, j]:.0%})",
                    ha="center", va="center",
                    fontsize=9, color="gray")

    plt.tight_layout()
    plt.savefig("confusion_matrix.png", bbox_inches="tight")
    plt.show()

Predicted Probability Distributions
python
def plot_probability_distribution(proba, y_true):
"""
Visualization of predicted probability distributions
for each class.
"""
fig, axes = plt.subplots(1, 3, figsize=(16, 5))
labels = ["Away Win (0)", "Draw (1)", "Home Win (2)"]
colors = ["#e74c3c", "#f1c40f", "#2ecc71"]

    for i, (ax, label, color) in enumerate(zip(axes, labels, colors)):
        # Correct predictions
        correct_mask = y_true == i
        ax.hist(proba[correct_mask, i], bins=30, alpha=0.7,
                color=color, label="Correct", density=True)
        ax.hist(proba[~correct_mask, i], bins=30, alpha=0.3,
                color="gray", label="Incorrect", density=True)

        ax.set_xlabel(f"P({label})")
        ax.set_ylabel("Density")
        ax.set_title(label)
        ax.legend()

    plt.suptitle("Predicted Probability Distributions",
                 fontsize=14, y=1.02)
    plt.tight_layout()
    plt.savefig("probability_distribution.png", bbox_inches="tight")
    plt.show()

Backtesting and Model Evaluation
Walk-Forward Backtest
This is the only correct way to test a predictive model on sports data - simulating real-time trading over time.
python
class WalkForwardBacktest:
"""
Walk-forward backtesting: train model on past data,
predict the next round, shift the window.
"""

    def __init__(self, model, scaler, initial_train_size: int = 500,
                 step_size: int = 50):
        self.model = model
        self.scaler = scaler
        self.initial_train_size = initial_train_size
        self.step_size = step_size

    def run(self, X: pd.DataFrame, y: pd.Series) -> dict:
        """Run the backtest."""
        all_preds = []
        all_proba = []
        all_true = []
        all_dates = []

        for start in range(self.initial_train_size,
                           len(X) - self.step_size,
                           self.step_size):
            end = start + self.step_size

            X_train = X.iloc[:start]
            y_train = y.iloc[:start]
            X_test = X.iloc[start:end]
            y_test = y.iloc[start:end]

            X_train_s = self.scaler.fit_transform(X_train)
            X_test_s = self.scaler.transform(X_test)

            self.model.fit(X_train_s, y_train)

            preds = self.model.predict(X_test_s)
            proba = self.model.predict_proba(X_test_s)

            all_preds.extend(preds)
            all_proba.extend(proba)
            all_true.extend(y_test.values)

        all_preds = np.array(all_preds)
        all_proba = np.array(all_proba)
        all_true = np.array(all_true)

        accuracy = accuracy_score(all_true, all_preds)
        logloss = log_loss(all_true, all_proba)

        print(f"Walk-Forward Backtest Results:")
        print(f"  Total predictions: {len(all_preds)}")
        print(f"  Accuracy: {accuracy:.4f}")
        print(f"  Log Loss: {logloss:.4f}")
        print(f"\n{classification_report(all_true, all_preds, "
              f"target_names=['Away', 'Draw', 'Home'])}")

        return {
            "predictions": all_preds,
            "probabilities": all_proba,
            "actuals": all_true,
            "accuracy": accuracy,
            "log_loss": logloss,
        }

# === Run ===

# backtester = WalkForwardBacktest(

# model=XGBClassifier(n_estimators=200, max_depth=5,

# learning_rate=0.05, random_state=42),

# scaler=StandardScaler(),

# initial_train_size=500,

# step_size=38, # ~1 Premier League matchweek

# )

# backtest_results = backtester.run(X, y)

Probability Calibration
python
def plot_calibration_curve(y_true, y_proba, class_idx=2,
class_name="Home Win"):
"""
Calibration plot: shows how well
predicted probabilities match actual outcomes.
Ideal model — diagonal line.
"""
from sklearn.calibration import calibration_curve

    prob_true, prob_pred = calibration_curve(
        (y_true == class_idx).astype(int),
        y_proba[:, class_idx],
        n_bins=10,
        strategy="uniform",
    )

    fig, ax = plt.subplots(figsize=(8, 8))
    ax.plot([0, 1], [0, 1], "k--", label="Perfectly calibrated")
    ax.plot(prob_pred, prob_true, "s-", color="#e74c3c",
            label=f"Model ({class_name})", linewidth=2, markersize=8)

    ax.fill_between(prob_pred, prob_true,
                     [p for p in prob_pred],
                     alpha=0.1, color="#e74c3c")

    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Actual fraction of positives")
    ax.set_title("Calibration Curve")
    ax.legend(loc="lower right")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)

    plt.tight_layout()
    plt.savefig("calibration_curve.png", bbox_inches="tight")
    plt.show()

Advanced Architecture: Hybrid System
Hybrid: ML + Claude + Polymarket
The most powerful architecture is a triple hybrid: the ML model provides quantitative probabilities, Polymarket delivers crowd intelligence, and Claude synthesizes everything into a final conclusion accounting for divergences.
