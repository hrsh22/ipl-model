# Phase 3 Roadmap: Live Prediction Model (85-88% Accuracy)

**Status**: Ready for Implementation  
**Target Accuracy**: 85-88% (live predictions after powerplay)  
**Timeline**: 2-3 weeks  
**Effort**: ~60-80 hours

## Overview

Phase 3 extends Phase 2's pre-match model (79.17% accuracy) to **live predictions** that update during the match. The key insight is that **actual match data (runs, wickets, momentum) is far more predictive than pre-match features**.

### Phase 3 Accuracy Targets

| Stage | Accuracy | Timing | Features |
|-------|----------|--------|----------|
| Pre-match | 79.17% | Before toss | Team form, player form, odds |
| After Powerplay | 85-88% | After 6 overs | Actual runs, wickets, momentum |
| After 15 overs | 90-92% | After 15 overs | Run rate, wickets remaining |
| Final 5 overs | 95%+ | Last 5 overs | Actual outcome nearly determined |

## Phase 3 Implementation Plan

### Step 1: Live Match Data Integration (Week 1)

**Goal**: Ingest live match data and update predictions in real-time

**Files to Create**:
- `src/ipl/live-match-client.ts` - Fetch live match data from Cricinfo/ESPN API
- `src/ipl/live-features.ts` - Calculate live features (runs, wickets, RR)
- `src/ipl/live-prediction-service.ts` - Update predictions during match

**Implementation**:
```typescript
// Fetch live match data
const liveData = await fetchLiveMatch(matchId)
// {
//   currentOvers: 5.3,
//   team1Runs: 45,
//   team1Wickets: 1,
//   team2Runs: 0,
//   team2Wickets: 0,
//   currentBatter: "Virat Kohli",
//   currentBowler: "Jasprit Bumrah",
//   lastBallRuns: 4,
//   lastBallWicket: false
// }

// Calculate live features
const liveFeatures = calculateLiveFeatures(liveData, match)
// {
//   currentRunRate: 8.5,
//   requiredRunRate: 7.2,
//   runRatePressure: 1.3,
//   wicketsRemaining: 9,
//   oversRemaining: 14.3,
//   momentum: 0.65  // Last 3 overs trend
// }

// Update prediction
const livePrediction = predictLiveWinProbability(liveFeatures, weights)
```

**Expected Accuracy Gain**: +3-5%

### Step 2: Run-Rate Pressure Model (Week 1)

**Goal**: Model the impact of current vs required run rate

**Files to Create**:
- `src/ipl/runrate-model.ts` - Run-rate pressure calculations

**Implementation**:
```typescript
// Calculate run-rate pressure
const currentRR = team1Runs / oversPlayed
const requiredRR = (team2Runs + 1) / oversRemaining
const rrPressure = (requiredRR - currentRR) / currentRR

// Pressure impact on win probability
// High pressure (RR > 2x required) = lower win probability
// Low pressure (RR < required) = higher win probability
const pressureImpact = sigmoid(rrPressure * 2)
```

**Expected Accuracy Gain**: +2-3%

### Step 3: Momentum Indicators (Week 1)

**Goal**: Capture match momentum (recent overs trend)

**Files to Create**:
- `src/ipl/momentum-model.ts` - Momentum calculations

**Implementation**:
```typescript
// Calculate momentum from last 3 overs
const last3OversRuns = getLast3OversRuns(ballData)
const last3OversWickets = getLast3OversWickets(ballData)

// Momentum score: 0-1, where 1 = strong positive momentum
const momentumScore = (last3OversRuns / 18) * (1 - last3OversWickets / 3)

// Momentum impact on win probability
// Positive momentum = higher win probability
// Negative momentum = lower win probability
const momentumImpact = 0.5 + (momentumScore - 0.5) * 0.3
```

**Expected Accuracy Gain**: +1-2%

### Step 4: Powerplay Performance Model (Week 2)

**Goal**: Capture powerplay-specific dynamics

**Files to Create**:
- `src/ipl/powerplay-model.ts` - Powerplay analysis

**Implementation**:
```typescript
// Powerplay metrics (first 6 overs)
const powPlayRuns = team1Runs  // After 6 overs
const powPlayWickets = team1Wickets
const powPlayRR = powPlayRuns / 6

// Powerplay impact on final score
// Strong powerplay (>50 runs) = higher final score
// Weak powerplay (<30 runs) = lower final score
const powPlayImpact = (powPlayRuns - 40) / 20  // Normalize

// Adjust win probability based on powerplay
const adjustedProb = baseProb + (powPlayImpact * 0.1)
```

**Expected Accuracy Gain**: +2-3%

### Step 5: XGBoost Model (Week 2)

**Goal**: Replace Logistic Regression with gradient boosting for non-linear interactions

**Files to Create**:
- `src/ipl/xgboost-model.ts` - XGBoost implementation
- `src/ipl/model-trainer.ts` - Training pipeline

**Implementation**:
```typescript
// Install XGBoost
// npm install xgboost

import { XGBClassifier } from 'xgboost'

// Train on historical data
const model = new XGBClassifier({
  nEstimators: 200,
  maxDepth: 6,
  learningRate: 0.05,
  subsample: 0.8,
  colsampleBytree: 0.8,
  objective: 'binary:logistic'
})

// Features: all Phase 2 + Phase 3 live features
const features = [
  ...phase2Features,
  ...liveFeatures,
  ...momentumFeatures
]

model.fit(trainingFeatures, trainingLabels)

// Predict
const probability = model.predict(testFeatures)
```

**Expected Accuracy Gain**: +3-5%

### Step 6: Ensemble Model (Week 2)

**Goal**: Combine Logistic Regression and XGBoost for robustness

**Files to Create**:
- `src/ipl/ensemble-model.ts` - Ensemble prediction

**Implementation**:
```typescript
// Combine predictions
const logisticProb = predictWithLogisticRegression(features, weights)
const xgboostProb = predictWithXGBoost(features, model)

// Weighted average (can be optimized)
const ensembleProb = 0.4 * logisticProb + 0.6 * xgboostProb

// Or use stacking: train meta-model on both predictions
const stackedProb = metaModel.predict([logisticProb, xgboostProb])
```

**Expected Accuracy Gain**: +1-2%

### Step 7: Probability Calibration (Week 3)

**Goal**: Ensure predicted probabilities match actual win rates

**Files to Create**:
- `src/ipl/calibration-model.ts` - Probability calibration

**Implementation**:
```typescript
// Calibration: adjust predicted probabilities to match reality
// If model predicts 70% but team wins 75% of the time, adjust upward

// Isotonic regression calibration
const calibrator = new IsotonicRegression()
calibrator.fit(predictedProbs, actualOutcomes)

// Apply calibration
const calibratedProbs = calibrator.transform(predictedProbs)
```

**Expected Accuracy Gain**: +0.5-1%

### Step 8: API Integration (Week 3)

**Goal**: Wire live predictions into Express API

**Files to Update**:
- `src/index.ts` - Add `/predict/ipl/live` endpoint

**Implementation**:
```typescript
// POST /predict/ipl/live
// Body: { matchId, currentOvers, team1Runs, team1Wickets, ... }
// Response: { team1WinProb, team2WinProb, confidence, momentum, ... }

app.post('/predict/ipl/live', async (req, res) => {
  const { matchId, currentOvers, team1Runs, team1Wickets, ... } = req.body
  
  const liveData = { currentOvers, team1Runs, team1Wickets, ... }
  const prediction = await predictLiveWinProbability(matchId, liveData)
  
  res.json(prediction)
})
```

## Phase 3 Feature Summary

### Live Features (New)

| Feature | Type | Range | Impact |
|---------|------|-------|--------|
| Current Run Rate | Continuous | 0-15 | High |
| Required Run Rate | Continuous | 0-15 | High |
| Run Rate Pressure | Continuous | -2 to 2 | High |
| Momentum Score | Continuous | 0-1 | Medium |
| Powerplay Runs | Continuous | 0-60 | Medium |
| Powerplay Wickets | Discrete | 0-3 | Medium |
| Overs Remaining | Continuous | 0-20 | High |
| Wickets Remaining | Discrete | 0-10 | High |
| Current Batter Form | Continuous | 0-1 | Low |
| Current Bowler Form | Continuous | 0-1 | Low |

### Combined Feature Set

**Phase 1 Features** (8):
- Team form, H2H, Venue, Toss, Bookmaker odds, Polymarket odds, KL divergence

**Phase 2 Features** (6):
- Star player form, Key bowler form, Wickets remaining, Wicket pressure, Batting depth, Bowling strength

**Phase 3 Features** (10):
- Current RR, Required RR, RR pressure, Momentum, Powerplay runs, Powerplay wickets, Overs remaining, Wickets remaining, Current batter form, Current bowler form

**Total**: 24 features

## Validation Strategy

### Offline Validation (Historical Data)

```bash
# Simulate live predictions on historical matches
# For each match, simulate predictions at:
# - Before toss (pre-match)
# - After powerplay (6 overs)
# - After 15 overs
# - Final 5 overs

# Expected accuracy progression:
# Pre-match: 79.17%
# After powerplay: 85-88%
# After 15 overs: 90-92%
# Final 5 overs: 95%+
```

### Online Validation (Live Matches)

```bash
# Test on 2026 IPL season matches
# Compare predictions to actual outcomes
# Track accuracy by stage (powerplay, middle, death)
# Measure calibration (predicted vs actual win rates)
```

## Success Criteria for Phase 3

- ✅ Accuracy ≥ 85% after powerplay
- ✅ Accuracy ≥ 90% after 15 overs
- ✅ Accuracy ≥ 95% in final 5 overs
- ✅ All TypeScript compiles cleanly
- ✅ Live API endpoint working
- ✅ Probability calibration verified
- ✅ Ensemble model outperforms single model
- ✅ XGBoost model trained and validated

## Technical Stack

### Libraries

- **XGBoost**: `npm install xgboost` - Gradient boosting
- **Scikit-learn**: Python wrapper for calibration (optional)
- **TensorFlow**: Optional for LSTM momentum model

### Data Sources

- **Live Match Data**: Cricinfo API, ESPN API, or custom scraper
- **Historical Data**: Cricsheet (already loaded)
- **Real-time Odds**: Polymarket API (already integrated)

## Risk Mitigation

### Risks

1. **API Downtime**: Live data source unavailable
   - Mitigation: Cache last known state, use fallback to pre-match model

2. **Data Latency**: Live data delayed by 30+ seconds
   - Mitigation: Use timestamp validation, warn if data is stale

3. **Model Overfitting**: XGBoost overfits to training data
   - Mitigation: Cross-validation, regularization, ensemble with Logistic Regression

4. **Probability Miscalibration**: Predicted probs don't match reality
   - Mitigation: Isotonic regression calibration, continuous monitoring

## Timeline

| Week | Task | Deliverable |
|------|------|-------------|
| 1 | Live data integration + RR pressure + Momentum | Live API endpoint |
| 2 | Powerplay model + XGBoost + Ensemble | Trained models |
| 3 | Calibration + Validation + Documentation | Phase 3 complete |

## Next Agent Instructions

When continuing Phase 3:

1. **First**: Read this roadmap and PHASE2_STATUS.md
2. **Second**: Run Phase 2 validation to verify baseline (79.17%)
3. **Third**: Implement live data integration (Step 1)
4. **Fourth**: Add run-rate pressure model (Step 2)
5. **Fifth**: Add momentum indicators (Step 3)
6. **Sixth**: Train XGBoost model (Step 5)
7. **Seventh**: Validate accuracy ≥ 85% after powerplay
8. **Eighth**: Deploy live API endpoint

## Questions to Ask

- "What's the current accuracy?" → Run phase2-validation.ts
- "How do I add live features?" → See Step 1 implementation
- "How do I train XGBoost?" → See Step 5 implementation
- "How do I validate live predictions?" → See Validation Strategy

## Success Metrics

**Phase 3 will be successful if**:
- ✅ Accuracy ≥ 85% after powerplay (vs 79.17% pre-match)
- ✅ Accuracy ≥ 90% after 15 overs
- ✅ Accuracy ≥ 95% in final 5 overs
- ✅ All code compiles and tests pass
- ✅ Live API endpoint responds in < 100ms
- ✅ Probability calibration verified
- ✅ Ready for production deployment

---

**Status**: Phase 3 Roadmap Complete  
**Next Step**: Implement Phase 3 (live predictions)  
**Estimated Completion**: 2-3 weeks
