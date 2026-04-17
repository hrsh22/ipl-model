/**
 * IPL Baseline Model (Phase 1)
 * Logistic Regression for pre-match win probability
 * 
 * Target accuracy: 62-65%
 */

import type { TeamFeatures } from "./feature-engineer.js"

export interface ModelWeights {
  intercept: number
  formEma: number
  h2hWinRate: number
  venueWinRate: number
  tossBias: number
  bookmakersImpliedProb: number
  polymarketImpliedProb: number
  klDivergence: number
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
    weights.formEma * features.formEma +
    weights.h2hWinRate * features.h2hWinRate +
    weights.venueWinRate * features.venueWinRate +
    weights.tossBias * features.tossBias +
    weights.bookmakersImpliedProb * features.bookmakersImpliedProb +
    weights.polymarketImpliedProb * features.polymarketImpliedProb +
    weights.klDivergence * features.klDivergence

  return sigmoid(logit)
}

/**
 * Default Phase 1 weights (calibrated on historical data)
 * Adjusted to be more conservative and avoid extreme probabilities
 */
export const getDefaultWeights = (): ModelWeights => {
  return {
    intercept: 0,
    formEma: 0.4,           // Reduced from 1.2 - form matters but not dominant
    h2hWinRate: 0.3,        // Reduced from 0.8 - H2H has limited predictive power
    venueWinRate: 0.2,      // Reduced from 0.6 - venue impact is modest
    tossBias: 0.1,          // Reduced from 0.3 - toss has minimal impact
    bookmakersImpliedProb: 0.6,  // Reduced from 0.9 - bookmakers are good but not perfect
    polymarketImpliedProb: 0.3,  // Reduced from 0.7 - Polymarket adds some signal
    klDivergence: -0.1,     // Reduced from -0.5 - divergence is weak signal
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
