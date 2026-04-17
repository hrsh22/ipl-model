/**
 * Extended Validation Script
 * Tests on all recent matches to get better accuracy estimate
 */

import { loadCricsheetData } from "./data-loader.js"
import { generatePredictions, type PredictionRequest } from "./prediction-service.js"
import logger from "../logger.js"

export const validateExtended = async (dataDir: string): Promise<void> => {
  logger.info("Starting Extended Validation...")

  try {
    const matches = loadCricsheetData(dataDir)
    const recentMatches = matches.filter((m) => m.season >= 2025)

    logger.info(`Testing on ${recentMatches.length} recent matches`)

    let correctPredictions = 0
    let totalPredictions = 0
    const predictions: Array<{
      match: string
      team1: string
      team2: string
      team1Prob: number
      team1Won: boolean
      correct: boolean
    }> = []

    for (const match of recentMatches) {
      const historicalMatches = matches.filter((m) => m.matchDate < match.matchDate)

      if (historicalMatches.length < 10) {
        continue
      }

      const request: PredictionRequest = {
        matchId: match.matchId,
        season: match.season,
        matchDate: match.matchDate,
        venue: match.venue,
        team1: match.team1,
        team2: match.team2,
        tossWinner: match.tossWinner || null,
        bookmakersOdds: 2.0,
        polymarketOdds: 2.0,
      }

      try {
        const { team1Prediction } = generatePredictions(request, historicalMatches)

        const team1Won = match.winner === match.team1
        const team1PredCorrect =
          (team1Prediction.modelProbability > 0.5 && team1Won) ||
          (team1Prediction.modelProbability <= 0.5 && !team1Won)

        if (team1PredCorrect) {
          correctPredictions++
        }

        totalPredictions++

        predictions.push({
          match: match.matchId,
          team1: match.team1,
          team2: match.team2,
          team1Prob: team1Prediction.modelProbability,
          team1Won,
          correct: team1PredCorrect,
        })
      } catch (error) {
        logger.error(`Failed to predict match ${match.matchId}:`, { error })
      }
    }

    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0

    logger.info(`Extended Validation Complete`, {
      correctPredictions,
      totalPredictions,
      accuracy: (accuracy * 100).toFixed(2) + "%",
      targetAccuracy: "62-65%",
    })

    // Log first 10 predictions for analysis
    logger.info("Sample predictions:", {
      predictions: predictions.slice(0, 10),
    })

    if (accuracy >= 0.62) {
      logger.info("✓ Phase 1 accuracy target met!")
    } else {
      logger.warn(`✗ Phase 1 accuracy ${(accuracy * 100).toFixed(2)}% below target 62-65%`)
    }
  } catch (error) {
    logger.error("Extended validation failed:", { error })
    throw error
  }
}
