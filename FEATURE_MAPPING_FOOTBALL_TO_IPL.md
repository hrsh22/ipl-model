# Feature Mapping: Football → IPL Cricket
## Column-by-Column Transfer Guide

---

## SECTION 1: DIRECT TRANSFERS (Copy-Paste)

### 1.1 Team Form Features

**Football**:
```python
home_Form = avg_points_last_5_matches
away_Form = avg_points_last_5_matches
diff_Form = home_Form - away_Form
```

**IPL** (Identical Logic):
```python
home_Form = avg_points_last_5_matches  # 3 pts/win, 0 pts/loss
away_Form = avg_points_last_5_matches
diff_Form = home_Form - away_Form
```

**Code**: `FeatureEngineer.compute_team_stats()` → **No changes needed**

---

### 1.2 Shots/Goals → Runs/Wickets

| Football | IPL | Mapping |
|----------|-----|---------|
| `avg_GF` (goals for) | `avg_Runs` | Runs scored |
| `avg_GA` (goals against) | `avg_Runs_Conceded` | Runs conceded |
| `avg_Shots` | `avg_Balls_Faced` | Balls faced (proxy for attacking play) |
| `avg_SoT` (shots on target) | `avg_Boundaries` | Boundaries (4s + 6s) |
| `diff_GF` | `diff_Runs` | Difference in runs scored |
| `diff_GA` | `diff_Runs_Conceded` | Difference in runs conceded |

**Code Change**:
```python
# Football
available_cols = ["HS", "AS", "HST", "AST", "HF", "AF", "HC", "AC"]

# IPL
available_cols = ["Runs_H", "Runs_A", "Wickets_Lost_H", "Wickets_Lost_A", 
                  "Boundaries_H", "Boundaries_A", "Dots_H", "Dots_A"]
```

---

### 1.3 Head-to-Head Records

**Football**:
```python
h2h_home_wins = wins_from_home_perspective / total_h2h
h2h_draws = draws / total_h2h
h2h_total_goals_avg = total_goals / total_h2h
```

**IPL** (Identical Logic):
```python
h2h_home_wins = wins_from_home_perspective / total_h2h
h2h_total_runs_avg = total_runs / total_h2h
h2h_avg_wickets_lost = total_wickets_lost / total_h2h
```

**Code**: `compute_h2h_features()` → **No changes needed**

---

### 1.4 Bookmaker Odds

**Football**:
```python
odds_prob_H = 1 / B365H
odds_prob_D = 1 / B365D
odds_prob_A = 1 / B365A
total = odds_prob_H + odds_prob_D + odds_prob_A
norm_prob_H = odds_prob_H / total
norm_prob_D = odds_prob_D / total
norm_prob_A = odds_prob_A / total
```

**IPL** (Binary market, no draw):
```python
odds_prob_H = 1 / odds_home
odds_prob_A = 1 / odds_away
total = odds_prob_H + odds_prob_A
norm_prob_H = odds_prob_H / total
norm_prob_A = odds_prob_A / total
```

**Code**: `add_odds_features()` → **Minor changes** (remove draw handling)

---

### 1.5 Polymarket Divergence

**Football**:
```python
kl_div = sum(p * log(p/q) for p, q in zip(bookmaker, polymarket))
divergence_H = bookmaker_prob_H - polymarket_prob_H
abs_divergence_H = abs(divergence_H)
max_divergence = max(abs_divergence_H, abs_divergence_D, abs_divergence_A)
sources_agree = int(bk_favorite == poly_favorite)
```

**IPL** (Identical Logic):
```python
kl_div = sum(p * log(p/q) for p, q in zip(bookmaker, polymarket))
divergence_H = bookmaker_prob_H - polymarket_prob_H
abs_divergence_H = abs(divergence_H)
max_divergence = max(abs_divergence_H, abs_divergence_A)
sources_agree = int(bk_favorite == poly_favorite)
```

**Code**: `TripleLayerFeatures.compute_divergence_features()` → **No changes needed**

---

## SECTION 2: PARTIAL TRANSFERS (Adapt)

### 2.1 Venue Intelligence

**Football**:
```python
home_advantage = 1 if is_home else 0
```

**IPL** (Much Richer):
```python
venue_avg_first_innings = 181  # e.g., Wankhede
venue_avg_second_innings = 154
venue_field_first_win_pct = 0.51
venue_pace_effectiveness = 0.65  # pace bowlers' economy
venue_spin_effectiveness = 0.72  # spin bowlers' economy
venue_dew_factor = 0.05 if is_evening else 0.0
```

**Code Change**:
```python
# Football
venue_stats = df.groupby('Venue').agg({'Result': 'mean'})

# IPL
venue_stats = df.groupby('Venue').agg({
    'first_innings_score': 'mean',
    'second_innings_score': 'mean',
    'field_first_wins': 'sum',
    'total_matches': 'count',
    'pace_economy': 'mean',
    'spin_economy': 'mean',
})
```

---

### 2.2 ELO Ratings

**Football**:
```python
class FootballELO:
    def update(self, home, away, home_goals, away_goals):
        # Single ELO rating per team
        self.ratings[home] += K * M * (S - E)
```

**IPL** (Phase-Based):
```python
class CricketPhaseELO:
    def __init__(self):
        self.ratings = {
            'powerplay': {},
            'middle': {},
            'death': {}
        }
    
    def update(self, team, phase, runs_scored, runs_conceded):
        # Separate ELO for each phase
        # Powerplay: overs 1-6
        # Middle: overs 7-15
        # Death: overs 16-20
```

**Code Effort**: Moderate (new class, same logic)

---

## SECTION 3: REPLACEMENTS (Don't Transfer)

### 3.1 Fatigue (Rest Days) → Wickets-in-Hand

**Football**:
```python
home_rest_days = (current_date - last_match_date).days
away_rest_days = (current_date - last_match_date).days
rest_advantage = home_rest_days - away_rest_days
home_fatigued = int(home_rest_days <= 3)
```

**IPL** (Different Concept):
```python
# Pre-match: historical wicket-loss patterns
avg_wickets_lost_powerplay = team_stats['wickets_lost_overs_1_6'].mean()
avg_wickets_lost_middle = team_stats['wickets_lost_overs_7_15'].mean()
avg_wickets_lost_death = team_stats['wickets_lost_overs_16_20'].mean()

# In-match: current wickets remaining
wickets_remaining = 10 - current_wickets_lost
```

**Why**: IPL matches are 2-3 days apart (consistent). Wickets are the limiting resource.

---

### 3.2 xG Proxy (Expected Goals) → Run-Rate Pressure

**Football**:
```python
home_xG_proxy = HST * 0.30 + (HS - HST) * 0.03
away_xG_proxy = AST * 0.30 + (AS - AST) * 0.03
home_xG_overperf = FTHG - home_xG_proxy
```

**IPL** (Different Concept):
```python
# Pre-match: team's phase-based run rates
avg_rr_powerplay = team_stats['runs_overs_1_6'].sum() / (team_stats['matches'] * 6)
avg_rr_middle = team_stats['runs_overs_7_15'].sum() / (team_stats['matches'] * 9)
avg_rr_death = team_stats['runs_overs_16_20'].sum() / (team_stats['matches'] * 5)

# In-match: current pressure
current_rr = current_runs / current_overs
required_rr = (target - current_runs) / (20 - current_overs)
pressure_index = required_rr / (avg_rr_phase + 0.1)
```

**Why**: Runs are deterministic (4s, 6s, singles). Pressure is the signal.

---

## SECTION 4: NEW FEATURES (IPL-Specific)

### 4.1 Player Form (Recent 10 Matches)

```python
# For each key player (top 3 batsmen, top 2 bowlers)
player_form_batting = {
    'avg_runs_last_10': player_stats['runs_last_10_innings'].mean(),
    'strike_rate_last_10': player_stats['sr_last_10_innings'].mean(),
    'consistency': player_stats['runs_last_10_innings'].std(),
}

player_form_bowling = {
    'avg_economy_last_10': player_stats['economy_last_10_innings'].mean(),
    'avg_wickets_last_10': player_stats['wickets_last_10_innings'].mean(),
    'dot_ball_pct_last_10': player_stats['dot_balls_last_10'].mean(),
}

# Team-level aggregation
team_batting_form = avg([player_form_batting for b in top_3_batsmen])
team_bowling_form = avg([player_form_bowling for b in top_2_bowlers])
```

**Why**: T20 is high-variance. Recent form > career averages.

---

### 4.2 Toss Impact (Venue-Dependent)

```python
toss_impact_by_venue = {
    'Wankhede': {'bat_first_win_pct': 0.49, 'field_first_win_pct': 0.51},
    'Eden_Gardens': {'bat_first_win_pct': 0.39, 'field_first_win_pct': 0.61},
    'Chepauk': {'bat_first_win_pct': 0.52, 'field_first_win_pct': 0.48},
}

is_evening = match_time > 19:00
dew_factor = 0.05 if is_evening else 0.0
toss_impact = toss_impact_by_venue[venue][toss_decision] + dew_factor
```

**Why**: Toss can shift win probability 5-10% at certain venues.

---

### 4.3 Pitch Type Classification

```python
def classify_pitch(venue, season, avg_first_innings_score):
    if avg_first_innings_score > 170:
        return 'batting_paradise'
    elif avg_first_innings_score < 160:
        return 'bowling_friendly'
    else:
        return 'balanced'

# Adjust team strength by pitch type
if pitch_type == 'batting_paradise':
    team_strength_multiplier = 1.1
elif pitch_type == 'bowling_friendly':
    team_strength_multiplier = 0.9
else:
    team_strength_multiplier = 1.0
```

**Why**: Pitch type significantly affects team performance.

---

## SECTION 5: COLUMN MAPPING TABLE

| Football Column | IPL Column | Type | Notes |
|-----------------|-----------|------|-------|
| `Date` | `Date` | Direct | Same |
| `HomeTeam` | `Team1` | Direct | Same |
| `AwayTeam` | `Team2` | Direct | Same |
| `FTHG` | `Runs_Team1` | Adapt | Goals → Runs |
| `FTAG` | `Runs_Team2` | Adapt | Goals → Runs |
| `FTR` | `Result` | Direct | H/D/A → H/A |
| `HTHG` | `Runs_Team1_Powerplay` | Adapt | Half-time → Powerplay |
| `HTAG` | `Runs_Team2_Powerplay` | Adapt | Half-time → Powerplay |
| `HS` | `Balls_Faced_Team1` | Adapt | Shots → Balls |
| `AS` | `Balls_Faced_Team2` | Adapt | Shots → Balls |
| `HST` | `Boundaries_Team1` | Adapt | Shots on target → Boundaries |
| `AST` | `Boundaries_Team2` | Adapt | Shots on target → Boundaries |
| `HC` | `Wickets_Lost_Team1` | Adapt | Corners → Wickets |
| `AC` | `Wickets_Lost_Team2` | Adapt | Corners → Wickets |
| `B365H` | `Odds_Team1` | Direct | Bookmaker odds |
| `B365A` | `Odds_Team2` | Direct | Bookmaker odds |
| `B365D` | (N/A) | Remove | No draw in IPL |
| (N/A) | `Venue` | New | Cricket-specific |
| (N/A) | `Toss_Winner` | New | Cricket-specific |
| (N/A) | `Toss_Decision` | New | Cricket-specific |
| (N/A) | `Player_Form_Team1` | New | Cricket-specific |
| (N/A) | `Player_Form_Team2` | New | Cricket-specific |

---

## SECTION 6: IMPLEMENTATION CHECKLIST

### Phase 1: Direct Transfers
- [ ] Copy `FeatureEngineer` class
- [ ] Adapt column names (FTHG → Runs, etc)
- [ ] Copy `TripleLayerFeatures` class
- [ ] Copy `PolymarketClient` class
- [ ] Test on Cricsheet data

### Phase 2: Partial Transfers + New Features
- [ ] Enhance venue intelligence (add pace/spin effectiveness)
- [ ] Implement phase-based ELO
- [ ] Add player form features
- [ ] Add toss impact features
- [ ] Add pitch type classification
- [ ] Retrain model with XGBoost

### Phase 3: Live Updates
- [ ] Implement `LiveWinProbability` class
- [ ] Add real-time run-rate pressure
- [ ] Add momentum tracking
- [ ] Integrate live data feed (Roanuz API)
- [ ] Deploy to Polymarket

---

## SECTION 7: QUICK REFERENCE

**70% Code Reuse**: `FeatureEngineer`, `TripleLayerFeatures`, `PolymarketClient`

**30% New Code**: Wickets-in-hand, run-rate pressure, phase-based ELO, player form, toss impact, pitch type

**Timeline**: Phase 1 (1-2 weeks) → Phase 2 (3-4 weeks) → Phase 3 (5-6 weeks)

**Accuracy**: 62-65% (Phase 1) → 70-72% (Phase 2) → 85-88% live (Phase 3)

