# Quick Start Guide - IPL Prediction Model

## Current Status

**Phase**: 2 (Complete)  
**Accuracy**: 79.17% (target: 70-72%) ✅ EXCEEDED  
**Improvement**: +35.42pp from Phase 1 (43.75%)

## Verify Everything Works

```bash
cd /Users/harsh/Developer/ipl-trader

# Build the project
pnpm build

# Run Phase 2 validation (should show 79.17% accuracy)
node dist/ipl/run-phase2-validation.js
```

## Key Files

### Source Code
- `src/ipl/player-extractor.ts` - Player performance extraction
- `src/ipl/wickets-model.ts` - Wickets-in-hand model
- `src/ipl/feature-engineer.ts` - Feature engineering pipeline
- `src/ipl/baseline-model.ts` - Logistic Regression model
- `src/ipl/prediction-service.ts` - Prediction orchestration

### Validation
- `src/ipl/phase2-validation.ts` - Phase 2 validation script
- `src/ipl/run-phase2-validation.ts` - Validation runner

### Documentation
- `PHASE2_STATUS.md` - Detailed Phase 2 report
- `PHASE3_ROADMAP.md` - Phase 3 implementation plan
- `SESSION_SUMMARY.md` - Session summary
- `QUICK_START.md` - This file

## API Endpoints

### Pre-Match Prediction
```bash
POST /predict/ipl
Content-Type: application/json

{
  "matchId": "1473438",
  "season": 2026,
  "matchDate": "2026-04-25T19:30:00Z",
  "venue": "Wankhede",
  "team1": "Mumbai Indians",
  "team2": "Chennai Super Kings",
  "tossWinner": "Mumbai Indians",
  "tossDecision": "bat"
}

Response:
{
  "matchId": "1473438",
  "team1": {
    "team": "Mumbai Indians",
    "modelProbability": 0.65,
    "confidence": "high",
    "edgeVsBookmakers": 0.05,
    "isActionable": true
  },
  "team2": {
    "team": "Chennai Super Kings",
    "modelProbability": 0.35,
    "confidence": "high",
    "edgeVsBookmakers": -0.05,
    "isActionable": true
  }
}
```

## Feature Set

### Phase 1 Features (8)
- Team form (EMA)
- Head-to-head records
- Venue statistics
- Toss bias
- Bookmaker odds
- Polymarket odds
- KL divergence

### Phase 2 Features (6) - NEW
- Star player form (top 3 batters)
- Key bowler form (top 3 bowlers)
- Wickets remaining (0-10)
- Resource index (0-1)
- Wicket pressure (0-1)
- Batting depth & bowling strength

**Total**: 14 features

## Model Weights (Phase 2)

```typescript
starPlayerForm: 0.5              // ⭐ Very High
resourceIndex: 0.4               // ⭐ Very High
bookmakersImpliedProb: 0.6       // ⭐ Very High
formEma: 0.3                     // High
keyBowlerForm: 0.3               // High
battingDepth: 0.3                // High
bowlingStrength: 0.3             // High
polymarketImpliedProb: 0.25      // Medium
h2hWinRate: 0.2                  // Medium
venueWinRate: 0.15               // Medium
tossBias: 0.05                   // Low
klDivergence: -0.08              // Low
```

## Validation Results

| Metric | Value |
|--------|-------|
| Total Predictions | 96 |
| Correct | 76 |
| Accuracy | 79.17% |
| Target | 70-72% |
| Gap | +7.17pp ✅ |

## Next Steps: Phase 3

Phase 3 will add **live predictions** that update during the match.

### Phase 3 Targets
- After powerplay (6 overs): 85-88%
- After 15 overs: 90-92%
- Final 5 overs: 95%+

### Phase 3 Timeline
- Week 1: Live data integration + RR pressure + Momentum
- Week 2: Powerplay model + XGBoost + Ensemble
- Week 3: Calibration + Validation + Deployment

See `PHASE3_ROADMAP.md` for detailed plan.

## Common Commands

```bash
# Build
pnpm build

# Type check
pnpm typecheck

# Run Phase 2 validation
node dist/ipl/run-phase2-validation.js

# Start dev server
pnpm dev

# View git history
git log --oneline -10
```

## Troubleshooting

### Validation shows lower accuracy
1. Check if data files are present: `ls data/cricsheet/ | wc -l` (should be ~2400)
2. Verify TypeScript compilation: `pnpm typecheck`
3. Rebuild: `pnpm build`
4. Run validation again: `node dist/ipl/run-phase2-validation.js`

### Build fails
1. Check TypeScript errors: `pnpm typecheck`
2. Verify all imports have `.js` extensions
3. Check optional property types (should include `| undefined`)

### API endpoint not responding
1. Start dev server: `pnpm dev`
2. Test endpoint: `curl http://localhost:3000/health`
3. Check logs for errors

## Key Insights

1. **Player-level features are critical**: Star player form is as important as bookmaker odds
2. **Wickets-in-hand matters**: Cricket-specific resource model captures pressure dynamics
3. **Feature engineering > Model architecture**: Logistic Regression is sufficient with good features
4. **Validation is essential**: Test on recent matches to catch feature gaps early

## Success Metrics

✅ Phase 2 Complete:
- Accuracy: 79.17% (target: 70-72%)
- Player features: Implemented
- Wickets model: Implemented
- Code quality: Clean TypeScript
- Documentation: Comprehensive

## Contact & Questions

For questions about:
- **Phase 2 implementation**: See `PHASE2_STATUS.md`
- **Phase 3 roadmap**: See `PHASE3_ROADMAP.md`
- **Session details**: See `SESSION_SUMMARY.md`
- **Feature engineering**: See `src/ipl/feature-engineer.ts`
- **Model weights**: See `src/ipl/baseline-model.ts`

---

**Status**: Phase 2 Complete ✅  
**Ready for**: Phase 3 Implementation  
**Last Updated**: April 17, 2026
