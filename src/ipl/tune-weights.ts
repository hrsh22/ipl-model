/**
 * Simple Weight Tuning Script
 * Uses grid search to find better weights
 */

import { loadCricsheetData } from "./data-loader.js"
import { engineerFeatures } from "./feature-engineer.js"
import { sigmoid } from "./baseline-model.js"
import type { ModelWeights } from "./baseline-model.js"
import logger from "../logger.js"

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
    weights.klDivergence * features.klDivergence
  )
}

const calculateAccuracy = (
  allMatches: any[],
  testMatches: any[],
  weights: ModelWeights
): number => {
  let correct = 0
  let total = 0

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
    const predicted = prob > 0.5 ? 1 : 0

    if (predicted === actual) correct++
    total++
  }

  return total > 0 ? correct / total : 0
}

export const tuneWeights = (dataDir: string): ModelWeights => {
  logger.info("Loading data for weight tuning...")
  const allMatches = loadCricsheetData(dataDir)
  const testMatches = allMatches.filter((m) => m.season >= 2025)

  logger.info(`Testing on ${testMatches.length} recent matches`)

  // Try different weight combinations
  const bestWeights: ModelWeights = {
    intercept: 0,
    formEma: 0.4,
    h2hWinRate: 0.3,
    venueWinRate: 0.2,
    tossBias: 0.1,
    bookmakersImpliedProb: 0.6,
    polymarketImpliedProb: 0.3,
    klDivergence: -0.1,
  }

  let bestAccuracy = calculateAccuracy(allMatches, testMatches, bestWeights)
  logger.info(`Initial accuracy: ${(bestAccuracy * 100).toFixed(2)}%`)

  // Grid search over key weights
  const formEmaValues = [0.2, 0.4, 0.6, 0.8, 1.0]
  const h2hValues = [0.1, 0.2, 0.3, 0.4, 0.5]
  const venueValues = [0.1, 0.2, 0.3, 0.4]
  const bookmakersValues = [0.4, 0.5, 0.6, 0.7, 0.8]

  let iterations = 0
  const maxIterations = 100

  for (const formEma of formEmaValues) {
    for (const h2h of h2hValues) {
      for (const venue of venueValues) {
        for (const bookmakers of bookmakersValues) {
          if (iterations++ > maxIterations) break

          const weights: ModelWeights = {
            intercept: 0,
            formEma,
            h2hWinRate: h2h,
            venueWinRate: venue,
            tossBias: 0.1,
            bookmakersImpliedProb: bookmakers,
            polymarketImpliedProb: 0.3,
            klDivergence: -0.1,
          }

          const accuracy = calculateAccuracy(allMatches, testMatches, weights)

          if (accuracy > bestAccuracy) {
            bestAccuracy = accuracy
            Object.assign(bestWeights, weights)
            logger.info(`New best: ${(accuracy * 100).toFixed(2)}% with formEma=${formEma}, h2h=${h2h}, venue=${venue}, bookmakers=${bookmakers}`)
          }
        }
      }
    }
  }

  logger.info(`Best accuracy found: ${(bestAccuracy * 100).toFixed(2)}%`)
  logger.info(`Best weights:`, bestWeights)

  return bestWeights
}
