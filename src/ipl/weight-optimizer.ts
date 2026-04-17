/**
 * Weight Optimizer for Phase 1 Model
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
  features: {
    formEma: number
    h2hWinRate: number
    venueWinRate: number
    tossBias: number
    bookmakersImpliedProb: number
    polymarketImpliedProb: number
    klDivergence: number
  },
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
    weights.klDivergence * features.klDivergence
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

  // Initialize weights
  let weights: ModelWeights = {
    intercept: 0,
    formEma: 0.5,
    h2hWinRate: 0.5,
    venueWinRate: 0.5,
    tossBias: 0.5,
    bookmakersImpliedProb: 0.5,
    polymarketImpliedProb: 0.5,
    klDivergence: 0,
  }

  // Training loop
  for (let iter = 0; iter < iterations; iter++) {
    // Generate predictions on training set
    const trainPredictions: Array<{ prob: number; actual: number }> = []

    for (const match of trainMatches) {
      const priorMatches = trainMatches.filter((m) => m.matchDate < match.matchDate)

      if (priorMatches.length < 5) continue

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
        2.0, // Mock odds
        2.0
      )

      const logit = calculateLogit(team1Features, weights)
      const prob = sigmoid(logit)
      const actual = match.winner === match.team1 ? 1 : 0

      trainPredictions.push({ prob, actual })
    }

    if (trainPredictions.length === 0) continue

    // Calculate gradients (simplified SGD)
    const gradients: Partial<ModelWeights> = {}

    for (const key of Object.keys(weights) as Array<keyof ModelWeights>) {
      let gradient = 0

      for (const match of trainMatches) {
        const priorMatches = trainMatches.filter((m) => m.matchDate < match.matchDate)
        if (priorMatches.length < 5) continue

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
        const error = prob - actual

        if (key === "intercept") {
          gradient += error
        } else {
          const featureValue = team1Features[key as keyof typeof team1Features] as number
          gradient += error * featureValue
        }
      }

      gradients[key] = gradient / trainMatches.length
    }

    // Update weights
    for (const key of Object.keys(weights) as Array<keyof ModelWeights>) {
      weights[key] -= learningRate * (gradients[key] || 0)
    }

    // Log progress
    if ((iter + 1) % 10 === 0) {
      const trainAccuracy = calculateAccuracy(trainPredictions)
      logger.info(`Iteration ${iter + 1}: Train Accuracy = ${(trainAccuracy * 100).toFixed(2)}%`)
    }
  }

  // Evaluate on test set
  const testPredictions: Array<{ prob: number; actual: number }> = []

  for (const match of testMatches) {
    const priorMatches = allMatches.filter((m) => m.matchDate < match.matchDate)

    if (priorMatches.length < 5) continue

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
  logger.info(`Final Test Accuracy: ${(testAccuracy * 100).toFixed(2)}%`)

  return weights
}
