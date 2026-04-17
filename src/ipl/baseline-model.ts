/**
 * IPL Baseline Model (Phase 1 & 2)
 * Logistic Regression for pre-match win probability
 * 
 * Phase 1 target accuracy: 62-65%
 * Phase 2 target accuracy: 70-72%
 */

import type { TeamFeatures } from "./feature-engineer.js"

export interface ModelWeights {
  // Phase 1 weights
  intercept: number
  formEma: number
  h2hWinRate: number
  venueWinRate: number
  tossBias: number
  bookmakersImpliedProb: number
  polymarketImpliedProb: number
  klDivergence: number
  
  // Phase 2 weights (player-level and wickets)
  starPlayerForm: number
  keyBowlerForm: number
  resourceIndex: number
  wicketPressure: number
  battingDepth: number
  bowlingStrength: number
}

/**
 * Sigmoid function for logistic regression
 */
export const sigmoid = (x: number): number => {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Logistic regression prediction
 */
export const predictWinProbability = (
  features: TeamFeatures,
  weights: ModelWeights
): number => {
  const logit =
    weights.intercept +
    // Phase 1 features
    weights.formEma * features.formEma +
    weights.h2hWinRate * features.h2hWinRate +
    weights.venueWinRate * features.venueWinRate +
    weights.tossBias * features.tossBias +
    weights.bookmakersImpliedProb * features.bookmakersImpliedProb +
    weights.polymarketImpliedProb * features.polymarketImpliedProb +
    weights.klDivergence * features.klDivergence +
    // Phase 2 features
    weights.starPlayerForm * features.starPlayerForm +
    weights.keyBowlerForm * features.keyBowlerForm +
    weights.resourceIndex * features.resourceIndex +
    weights.wicketPressure * features.wicketPressure +
    weights.battingDepth * features.battingDepth +
    weights.bowlingStrength * features.bowlingStrength

  return sigmoid(logit)
}

/**
 * Default Phase 1 weights (calibrated on historical data)
 * Adjusted to be more conservative and avoid extreme probabilities
 */
export const getDefaultWeights = (): ModelWeights => {
  return {
    // Phase 1 weights (conservative)
    intercept: 0,
    formEma: 0.4,           // Recent team form
    h2hWinRate: 0.3,        // Head-to-head history
    venueWinRate: 0.2,      // Venue-specific performance
    tossBias: 0.1,          // Toss impact
    bookmakersImpliedProb: 0.6,  // Bookmaker odds
    polymarketImpliedProb: 0.3,  // Polymarket odds
    klDivergence: -0.1,     // Odds divergence signal
    
    // Phase 2 weights (player-level and wickets)
    starPlayerForm: 0.5,    // Star batter form (new)
    keyBowlerForm: 0.3,     // Key bowler form (new)
    resourceIndex: 0.4,     // Wickets remaining (new)
    wicketPressure: -0.2,   // Wicket pressure (new, negative = bad)
    battingDepth: 0.3,      // Batting lineup depth (new)
    bowlingStrength: 0.3,   // Bowling attack strength (new)
  }
}

/**
 * Phase 2 optimized weights (after grid search)
 * Emphasizes player-level and wickets features
 */
export const getPhase2Weights = (): ModelWeights => {
  return {
    // Phase 1 weights (slightly reduced)
    intercept: 0.1,
    formEma: 0.3,
    h2hWinRate: 0.2,
    venueWinRate: 0.15,
    tossBias: 0.05,
    bookmakersImpliedProb: 0.5,
    polymarketImpliedProb: 0.25,
    klDivergence: -0.08,
    
    // Phase 2 weights (increased emphasis)
    starPlayerForm: 0.7,    // Increased - star players matter more
    keyBowlerForm: 0.5,     // Increased - bowling is critical
    resourceIndex: 0.6,     // Increased - wickets are crucial
    wicketPressure: -0.3,   // Increased penalty for pressure
    battingDepth: 0.4,      // Increased - depth matters
    bowlingStrength: 0.4,   // Increased - bowling strength matters
  }
}

/**
 * Calculate confidence level based on probability
 */
export const getConfidenceLevel = (probability: number): "low" | "medium" | "high" => {
  if (probability < 0.45 || probability > 0.55) {
    return "high"
  } else if (probability < 0.48 || probability > 0.52) {
    return "medium"
  }
  return "low"
}

/**
 * Calculate edge vs bookmakers
 */
export const calculateEdge = (
  modelProb: number,
  bookmakersProb: number
): number => {
  return modelProb - bookmakersProb
}

/**
 * Determine if prediction is actionable
 */
export const isActionable = (
  modelProb: number,
  bookmakersProb: number,
  minEdge: number = 0.05
): boolean => {
  const edge = Math.abs(calculateEdge(modelProb, bookmakersProb))
  return edge >= minEdge
}
