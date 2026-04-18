```
               DATA LAYER                              │
Past Game Data from 2008- 2025 Kaggle / Cricksheet (Historic Ball by Ball)
Odds API -> Sportbook Odds from past seasons
Optic Odds -> Live Game Data + Odds for current season from Sportbooks + PolyMarket

│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │  🔗 Polymarket Gamma API (prediction market)     │        │
│  │  Crowd-sourced probabilities on the Polygon chain  │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   PROCESSING LAYER                           │
│  pandas │ numpy │ data cleaning │ feature engineering        │
│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │  Claude API: feature generation,                  │        │
│  │  context analysis, statistics interpretation       │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │  Merging 3 probability layers:                     │        │
│  │  Bookmaker odds + Polymarket prices + ML model    │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     MODEL LAYER                              │
│  Logistic Regression │ Random Forest │ XGBoost               │
│  Ensemble (Voting / Stacking)                                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 INTERPRETATION LAYER                          │
│  Claude API: natural language prediction explanation          │
│  + confidence assessment + divergence analysis                │
│    between bookmaker / Polymarket / ML                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    OUTPUT LAYER                               │
│  matplotlib visualizations │ JSON reports │ Telegram bot       │
└─────────────────────────────────────────────────────────────┘
```

https://www.kaggle.com/datasets/chaitu20/ipl-dataset2008-2025

https://www.iplt20.com/stats/2026/player-points

- [ ] Gather all The Data

    - [x] 2017 - 2025 Past Game Data (Historical Performance of Teams)
        - [ ] 2024 - 2025 larger weight to account for recent
    - [ ] Odds Api / 2023 to 2026 / Sportbook Odds to PreMatch
        - [ ] Pre Toss/ Post Toss/ Pre Match
        - [ ] First Innings (later)
    - [x] Optic Odds Live Game Data + Odds for current season from Sportbooks + PolyMarket

- [ ] Features We Want To Model
    - [ ] Player Stats
        - [ ]
        - [ ] New Players
            - [ ] Good = consider
            - [ ] Bad = Avg.

team1_recent_win_rate_last_10
team2_recent_win_rate_last_10

team1_last_3_year_win_rate
team2_last_3_year_win_rate

team1_venue_win_rate
team2_venue_win_rate

venue_chasing_win_rate
venue_average_first_innings_score

team1_chasing_win_rate
team2_chasing_win_rate

team1_batting_first_win_rate
team2_batting_first_win_rate

team1_powerplay_net_run_rate
team2_powerplay_net_run_rate

team1_middle_overs_net_run_rate
team2_middle_overs_net_run_rate

team1_death_overs_net_run_rate
team2_death_overs_net_run_rate

team1_boundary_percentage
team2_boundary_percentage

team1_dot_ball_percentage
team2_dot_ball_percentage

team1_death_bowling_economy
team2_death_bowling_economy

team1_xi_continuity_score
team2_xi_continuity_score

continuity_score =

- 0.35 \* top_order_continuity
- 0.25 \* bowling_core_continuity
- 0.20 \* death_bowler_continuity
- 0.20 \* overall_XI_continuity

Expectation →

Pre Game

Sportbook odds = 65% MI

Poly Odds = 70% MI

Model Odds = 80% MI

#### Train Model

Gives Pregame Probability

Compare To Sport Books

Compare to Polymarket

Trade when edge exists

Model Creation

**System Goal**

Build a pre-match IPL prediction system that outputs:

`team1 win probability
team2 win probability
model confidence
fair price in cents
market edge if Polymarket/book odds are available
explanation of why`

The core idea should be:

`Cricket fundamentals + market probabilities + model calibration = final fair value`

**Step 1: Data Layer**

Sub-step 1.1: Historical match data (Training)

Use your Kaggle IPL.csv as the base.

We need:

`match_id
season
date
venue
city
team1
team2
toss_winner
toss_decision
winner
innings
batting_team
bowling_team
over
ball
batter
bowler
runs
extras
wickets
player_out`

Sub-step 1.2: Fixture data (Live data)

For upcoming matches:

`match_date
venue
team1
team2
city
home_team if known`

Sub-step 1.3: Player and squad data

From IPL website or manual inputs: (Live data)

`probable XI - Last Game XI
confirmed XI
injuries
overseas availability
impact player options
captain
key role players`

Sub-step 1.4: Market data

From Polymarket + Sports Books + Optic Odds (Live)

`team1 market price
team2 market price
best bid
best ask
spread
liquidity
volume
price movement`

For pre-match accuracy, market data is very useful. For betting edge, we need to compare our fair value against market price.

**Step 2: Cleaning Layer**

Sub-step 2.1: Standardize teams

IPL teams have name changes, so normalize:

`Delhi Daredevils -> Delhi Capitals
Kings XI Punjab -> Punjab Kings
Rising Pune Supergiant variants
Deccan Chargers separate from SRH`

Sub-step 2.2: Standardize venues

Same stadiums can appear under different names.

Example:

`M Chinnaswamy Stadium
M.Chinnaswamy Stadium
Bengaluru`

Sub-step 2.3: Remove/flag weird matches

Handle:

`no result
DLS/reduced overs
super overs
abandoned matches
neutral venues
COVID/UAE seasons`

Sub-step 2.4: Prevent data leakage

Every feature for a match must use only data available before that match.

This is the most important rule.

Bad:

`Using team’s final season win rate to predict a match from that same season`

Good:

`Using team’s rolling win rate before that match date`

**Step 3: Match-Level Feature Engineering**

This is the base pre-match model.

Sub-step 3.1: Team strength features

`team1_overall_win_rate_before_match
team2_overall_win_rate_before_match
team1_recent_win_rate_last_5
team2_recent_win_rate_last_5
team1_recent_win_rate_last_10
team2_recent_win_rate_last_10
team1_last_3_year_win_rate
team2_last_3_year_win_rate
team1_chasing_win_rate
team2_chasing_win_rate
team1_batting_first_win_rate
team2_batting_first_win_rate`

Sub-step 3.2: Difference features

For every important team metric, create a gap:

`recent_win_rate_gap = team1_recent_win_rate - team2_recent_win_rate
chasing_strength_gap = team1_chasing_win_rate - team2_chasing_win_rate
batting_first_gap = team1_batting_first_win_rate - team2_batting_first_win_rate`

These are usually stronger than raw values.

Sub-step 3.3: Head-to-head features

`team1_h2h_win_rate_vs_team2
team2_h2h_win_rate_vs_team1
last_5_h2h_team1_win_rate
venue_h2h_win_rate`

But don’t overweight this. Head-to-head can be noisy because squads change.

**Step 4: Venue and Conditions Features**

This is crucial for IPL.

Sub-step 4.1: Venue scoring profile

`venue_avg_first_innings_score
venue_avg_second_innings_score
venue_chasing_win_rate
venue_batting_first_win_rate
venue_avg_powerplay_runs
venue_avg_powerplay_wickets
venue_avg_death_overs_runs
venue_boundary_rate
venue_six_rate
venue_dot_ball_rate`

Sub-step 4.2: Venue bowling profile

`venue_pace_wicket_share
venue_spin_wicket_share
venue_powerplay_wicket_rate
venue_middle_overs_wicket_rate
venue_death_overs_wicket_rate`

Sub-step 4.3: Home/away context

`team1_home_flag
team2_home_flag
team1_home_win_rate
team2_away_win_rate
team1_venue_win_rate
team2_venue_win_rate`

This matters, but less than people think if the venue is neutral or unfamiliar.

**Step 5: Phase-Based Cricket Features**

This is the cricket equivalent of football xG/shot quality.

Sub-step 5.1: Split innings into phases

`Powerplay: overs 1-6
Middle: overs 7-15
Death: overs 16-20`

Sub-step 5.2: Batting phase metrics

`team_powerplay_run_rate
team_powerplay_wickets_lost
team_middle_overs_run_rate
team_middle_overs_boundary_rate
team_middle_overs_dot_ball_rate
team_death_overs_run_rate
team_death_overs_six_rate
team_death_overs_wickets_lost`

Sub-step 5.3: Bowling phase metrics

`team_powerplay_economy
team_powerplay_wickets_taken
team_middle_overs_economy
team_middle_overs_dot_ball_rate_forced
team_death_overs_economy
team_death_overs_wickets_taken
team_death_overs_boundary_rate_conceded`

Sub-step 5.4: Net phase strength

`powerplay_net_run_rate = batting_powerplay_rr - bowling_powerplay_economy
middle_net_run_rate = batting_middle_rr - bowling_middle_economy
death_net_run_rate = batting_death_rr - bowling_death_economy`

These should be high-priority features.

**Step 6: Resource Features**

This is where cricket differs heavily from football.

Sub-step 6.1: Runs per wicket

`team_runs_per_wicket
team_runs_conceded_per_wicket_taken`

Sub-step 6.2: Wicket preservation

`team_avg_wickets_lost
team_powerplay_wickets_lost
team_death_wickets_lost`

Sub-step 6.3: Resource score

Simple version:

`batting_resource_score = avg_runs + 8 * avg_wickets_remaining
bowling_resource_score = avg_wickets_taken * 8 - avg_runs_conceded
net_resource_score = batting_resource_score + bowling_resource_score`

The exact wicket value can be tuned later.

**Step 7: Player / XI Layer**

This is the equivalent of football lineup strength.

Sub-step 7.1: Probable XI strength

`team_probable_xi_strength
team_top3_strength
team_middle_order_strength
team_finisher_strength
team_powerplay_bowling_strength
team_death_bowling_strength
team_spin_strength
team_pace_strength`

Sub-step 7.2: Continuity score

`continuity_score = probable XI players who appeared recently / 11`

Better version:

`continuity_score =
0.30 \* top_order_continuity

- 0.30 \* bowling_core_continuity
- 0.20 \* death_bowler_continuity
- 0.20 \* overall_xi_continuity`

Sub-step 7.3: Missing player penalty

`missing_key_batter_count
missing_key_bowler_count
missing_death_bowler_flag
missing_opener_flag`

This should be a manual or semi-automated layer from IPL news.

**Step 8: IPL ELO / Rating System**

The article’s ELO idea is useful. For IPL, use cricket-specific margin.

Sub-step 8.1: Base ELO

`each team starts at 1500
expected win probability from rating difference
update after each match`

Sub-step 8.2: Cricket margin multiplier

Instead of football goal difference, use:

`runs margin
wickets margin
balls remaining in chase`

Example:

`big chase win with 20 balls left = stronger rating update
1-run win = smaller update`

Sub-step 8.3: Save pre-match ELO features

`team1_elo_before_match
team2_elo_before_match
elo_gap
elo_expected_team1_win`

This should become one of our strongest features.

**Step 9: Toss Layer**

For pure pre-match, toss is unknown. So we use historical tendencies.

Sub-step 9.1: Pre-toss features

`team1_toss_win_rate
team2_toss_win_rate
team1_prefers_field_after_toss
team2_prefers_field_after_toss
venue_toss_winner_win_rate
venue_field_first_win_rate
venue_bat_first_win_rate`

Sub-step 9.2: Post-toss model

If toss is known, create a second model:

`toss_winner
toss_decision
team1_bats_first
team2_bats_first`

This should be separate from the pre-match model.

**Step 10: Market Layer**

This mirrors the article’s bookmaker + Polymarket layer.

Sub-step 10.1: Convert prices to probabilities

For Polymarket:

`price in cents = implied probability`

Example:

`MI at 0.62 = 62% implied probability`

For bookmaker odds:

`implied_probability = 1 / decimal_odds`

Normalize if there is overround.

Sub-step 10.2: Market features

`polymarket_team1_prob
polymarket_team2_prob
book_team1_prob
book_team2_prob
market_spread
market_liquidity
market_volume
price_move_1h
price_move_6h`

Sub-step 10.3: Divergence features

`model_vs_poly_team1 = model_team1_prob - poly_team1_prob
model_vs_book_team1 = model_team1_prob - book_team1_prob
poly_vs_book_team1 = poly_team1_prob - book_team1_prob
sources_agree_flag
max_probability_divergence`

Important: for pure pre-match prediction accuracy, market probabilities help. For betting edge, they should be used for comparison, not blindly as model inputs.

**Step 11: Model Layer**

Sub-step 11.1: Start simple

Use:

`Logistic Regression
Random Forest
XGBoost / Gradient Boosting
ExtraTrees`

Sub-step 11.2: Validate properly

Use time-based validation only.

Bad:

`random train/test split`

Good:

`train on 2008-2022
validate on 2023
test on 2024-2025`

Or walk-forward:

`train on all matches before date X
predict next batch
move forward
repeat`

Sub-step 11.3: Metrics

Track:

`accuracy
ROC-AUC
log loss
Brier score
calibration curve
profit if betting at market prices
closing line value`

For betting, log loss and calibration matter more than raw accuracy.

**Step 12: Probability Calibration**

A model saying 80% should win roughly 8 out of 10 times.

Sub-step 12.1: Calibration methods

`Platt scaling
isotonic regression
CalibratedClassifierCV`

Sub-step 12.2: Calibration buckets

Check:

`50-55% predictions
55-60%
60-65%
65-70%
70%+`

If our 70%+ picks only win 58%, the model is overconfident.

**Step 13: Ensemble Probability**

This is where the article’s triple-layer idea becomes useful.

Sub-step 13.1: Internal model blend

`ml_probability =
0.40 \* logistic

- 0.30 \* xgboost
- 0.20 \* random_forest
- 0.10 \* elo_probability`

Sub-step 13.2: External market blend

If we are predicting outcomes:

`final_probability =
0.60 \* ML model

- 0.25 \* Polymarket
- 0.15 \* bookmaker`

If we are finding betting edge:

`fair_probability = ML model probability
compare fair_probability vs market_probability`

Sub-step 13.3: Confidence classification

`Low confidence: 50-55%
Medium confidence: 55-60%
High confidence: 60-65%
Very high confidence: 65%+`

But only if calibration supports it.

**Step 14: Explanation Layer**

This is where an LLM is useful, but not as the core predictor.

The LLM should explain:

`why the model likes a side
which features are driving it
where market disagrees
what risks could break the prediction
whether this is a bet or no-bet`

It should not invent team news or silently override the model.

A good output:

`Prediction: DC 58%
Fair price: 58 cents
Market price: 52 cents
Edge: +6 cents
Confidence: medium
Main drivers:

- stronger recent powerplay net run rate
- better venue record
- GT missing death bowling strength
  Risks:
- toss/chasing bias at venue
- GT top-order matchup
  Decision:
- playable below 53 cents`

**Step 15: Output Layer**

Sub-step 15.1: Prediction CSV

`match_date
team1
team2
venue
model_team1_prob
model_team2_prob
fair_price_team1
fair_price_team2
predicted_winner
confidence
market_price_team1
market_price_team2
edge_team1
edge_team2
bet_flag`

Sub-step 15.2: Trade watchlist

`only show matches where edge >= 5 cents
liquidity acceptable
spread acceptable
confidence not low`

Sub-step 15.3: Telegram/manual alerts later

`BUY DC YES
Market: 52c
Fair: 58c
Edge: +6c
Stake: $10-$15
Reason: model + venue + form edge`

**Step 16: Backtesting**

Sub-step 16.1: Prediction backtest

`Would the model have predicted the winner correctly?
Was it calibrated?
Did high-confidence picks perform better?`

Sub-step 16.2: Betting backtest

If market prices are available:

`bet only when edge >= 5 cents
stake fixed $10
track ROI
track drawdown
track closing line value`

Sub-step 16.3: Strategy filters

Test:

`all bets
only edges >= 5c
only edges >= 8c
only high-liquidity markets
only post-toss markets
only teams with confirmed XI`

**Suggested IPL Architecture**

`DATA
Kaggle IPL ball-by-ball

- IPL fixture/squad/news data
- Polymarket/bookmaker prices

PROCESSING
clean teams/venues
build match-level rows
build rolling pre-match features
build phase features
build ELO features
build XI/player features

MODEL
logistic baseline
tree model
XGBoost/ExtraTrees
ELO model
calibrated ensemble

MARKET LAYER
Polymarket price
book odds
liquidity/spread
model-market edge

OUTPUT
prediction sheet
trade watchlist
natural-language explanation
Telegram alerts later`

**MVP Build Order**

1. Build clean match-level table from IPL.csv.
2. Add rolling team strength features.
3. Add venue features.
4. Add phase features: powerplay/middle/death.
5. Add cricket ELO.
6. Train logistic + tree models with time-series validation.
7. Calibrate probabilities.
8. Produce pre-match predictions.
9. Add Polymarket + Sport Book Odds prices as a comparison layer.
10. Generate edge/watchlist report.

**Most Important First Version Features**

If we want the first serious version, I’d prioritize:

`team_recent_win_rate_last_10
team_last_3_year_win_rate
team_elo
elo_gap
venue_win_rate
venue_chasing_win_rate
batting_first_win_rate
chasing_win_rate
powerplay_net_run_rate
middle_overs_net_run_rate
death_overs_net_run_rate
boundary_rate
dot_ball_rate
death_bowling_economy
runs_per_wicket
runs_conceded_per_wicket
head_to_head_win_rate
rest_days
home_or_neutral_flag
probable_xi_strength
continuity_score`

My recommendation: yes, let’s build a similar system, but for IPL I’d make the **cricket fundamentals model first**, then add the **Polymarket/bookmaker divergence layer second**. That keeps us from accidentally building a model that only mirrors the market instead of finding edge.
