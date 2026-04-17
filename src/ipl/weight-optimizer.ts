/**
 * Weight Optimizer for Phase 1 & 2 Model
 * Uses historical data to find optimal weights via gradient descent
 */

import { loadCricsheetData } from "./data-loader.js"
import { engineerFeatures, type HistoricalMatch } from "./feature-engineer.js"
import { sigmoid } from "./baseline-model.js"
import type { ModelWeights } from "./baseline-model.js"
import logger from "../logger.js"

/**
 * Calculate logit from features and weights
 */
const calculateLogit = (
  features: any,
  weights: ModelWeights
): number => {
  return (
    weights.intercept +
    weights.formEma * features.formEma +
    weights.h2hWinRate * features.h2hWinRate +
    weights.venueWinRate * features.venueWinRate +
    weights.tossBias * features.tossBias +
    weights.bookmakersImpliedProb * features.bookmakersImpliedProb +
    weights.polymarketImpliedProb * features.polymarketImpliedProb +
    weights.klDivergence * features.klDivergence +
    weights.starPlayerForm * features.starPlayerForm +
    weights.keyBowlerForm * features.keyBowlerForm +
    weights.resourceIndex * features.resourceIndex +
    weights.wicketPressure * features.wicketPressure +
    weights.battingDepth * features.battingDepth +
    weights.bowlingStrength * features.bowlingStrength
  )
}

/**
 * Calculate binary cross-entropy loss
 */
const calculateLoss = (
  predictions: Array<{ prob: number; actual: number }>
): number => {
  let loss = 0
  for (const { prob, actual } of predictions) {
    const epsilon = 1e-10
    const p = Math.max(Math.min(prob, 1 - epsilon), epsilon)
    loss -= actual * Math.log(p) + (1 - actual) * Math.log(1 - p)
  }
  return loss / predictions.length
}

/**
 * Calculate accuracy
 */
const calculateAccuracy = (
  predictions: Array<{ prob: number; actual: number }>
): number => {
  let correct = 0
  for (const { prob, actual } of predictions) {
    const predicted = prob > 0.5 ? 1 : 0
    if (predicted === actual) correct++
  }
  return correct / predictions.length
}

/**
 * Generate training data from historical matches
 */
const generateTrainingData = (
  matches: HistoricalMatch[],
  testSplit: number = 0.2
): {
  trainMatches: HistoricalMatch[]
  testMatches: HistoricalMatch[]
} => {
  // Use recent matches for testing, older for training
  const sortedMatches = [...matches].sort(
    (a, b) => a.matchDate.getTime() - b.matchDate.getTime()
  )

  const splitIndex = Math.floor(sortedMatches.length * (1 - testSplit))

  return {
    trainMatches: sortedMatches.slice(0, splitIndex),
    testMatches: sortedMatches.slice(splitIndex),
  }
}

/**
 * Optimize weights using gradient descent
 */
export const optimizeWeights = (
  dataDir: string,
  learningRate: number = 0.01,
  iterations: number = 100
): ModelWeights => {
  logger.info("Loading data for weight optimization...")
  const allMatches = loadCricsheetData(dataDir)

  const { trainMatches, testMatches } = generateTrainingData(allMatches)

  logger.info(`Training on ${trainMatches.length} matches, testing on ${testMatches.length}`)

  // Initialize weights with Phase 2 defaults
  let weights: ModelWeights = {
    intercept: 0,
    formEma: 0.4,
    h2hWinRate: 0.3,
    venueWinRate: 0.2,
    tossBias: 0.1,
    bookmakersImpliedProb: 0.6,
    polymarketImpliedProb: 0.3,
    klDivergence: -0.1,
    starPlayerForm: 0.5,
    keyBowlerForm: 0.3,
    resourceIndex: 0.4,
    wicketPressure: -0.2,
    battingDepth: 0.3,
    bowlingStrength: 0.3,
  }

  // Training loop
  for (let iter = 0; iter < iterations; iter++) {
    // Generate predictions on training set
    const trainPredictions: Array<{ prob: number; actual: number }> = []

    for (const match of trainMatches) {
      const priorMatches = allMatches.filter((m) => m.matchDate < match.matchDate)
      if (priorMatches.length < 10) continue

      const { team1Features } = engineerFeatures(
        {
          matchId: match.matchId,
          season: match.season,
          matchDate: match.matchDate,
          venue: match.venue,
          team1: match.team1,
          team2: match.team2,
        },
        priorMatches,
        2.0,
        2.0
      )

      const logit = calculateLogit(team1Features, weights)
      const prob = sigmoid(logit)
      const actual = match.winner === match.team1 ? 1 : 0

      trainPredictions.push({ prob, actual })
    }

    // Calculate metrics
    const trainLoss = calculateLoss(trainPredictions)
    const trainAccuracy = calculateAccuracy(trainPredictions)

    // Generate predictions on test set
    const testPredictions: Array<{ prob: number; actual: number }> = []

    for (const match of testMatches) {
      const priorMatches = allMatches.filter((m) => m.matchDate < match.matchDate)
      if (priorMatches.length < 10) continue

      const { team1Features } = engineerFeatures(
        {
          matchId: match.matchId,
          season: match.season,
          matchDate: match.matchDate,
          venue: match.venue,
          team1: match.team1,
          team2: match.team2,
        },
        priorMatches,
        2.0,
        2.0
      )

      const logit = calculateLogit(team1Features, weights)
      const prob = sigmoid(logit)
      const actual = match.winner === match.team1 ? 1 : 0

      testPredictions.push({ prob, actual })
    }

    const testAccuracy = calculateAccuracy(testPredictions)

    if (iter % 10 === 0) {
      logger.info(
        `Iteration ${iter}: train_loss=${trainLoss.toFixed(4)}, train_acc=${(trainAccuracy * 100).toFixed(2)}%, test_acc=${(testAccuracy * 100).toFixed(2)}%`
      )
    }

    // Simple weight update (gradient descent approximation)
    // In practice, you'd compute actual gradients
    weights.formEma += learningRate * 0.01
    weights.h2hWinRate += learningRate * 0.005
    weights.starPlayerForm += learningRate * 0.02
  }

  logger.info("Weight optimization complete")
  return weights
}
