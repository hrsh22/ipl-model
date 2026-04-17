/**
 * Phase 1 Validation Script
 * Tests feature engineering and baseline model on historical data
 * Target: 62-65% accuracy on pre-match predictions
 */

import { loadCricsheetData, getUniqueTeams } from "./data-loader.js"
import { generatePredictions, type PredictionRequest } from "./prediction-service.js"
import logger from "../logger.js"

/**
 * Validate Phase 1 implementation
 */
export const validatePhase1 = async (dataDir: string): Promise<void> => {
  logger.info("Starting Phase 1 Validation...")

  try {
    // Load historical data
    logger.info("Loading Cricsheet data...")
    const matches = loadCricsheetData(dataDir)
    const teams = getUniqueTeams(matches)

    logger.info(`Loaded ${matches.length} matches with ${teams.length} teams`, {
      teams: teams.slice(0, 5),
    })

    // Validate on recent matches (2026 season if available, else 2025)
    const recentMatches = matches.filter((m) => m.season >= 2025)
    logger.info(`Found ${recentMatches.length} recent matches for validation`)

    if (recentMatches.length === 0) {
      logger.warn("No recent matches found for validation")
      return
    }

    // Test predictions on first 10 recent matches
    let correctPredictions = 0
    let totalPredictions = 0

    for (let i = 0; i < Math.min(10, recentMatches.length); i++) {
      const match = recentMatches[i]
      if (!match) continue

      const historicalMatches = matches.filter((m) => m.matchDate < match.matchDate)

      if (historicalMatches.length < 10) {
        logger.debug(`Skipping match ${match.matchId}: insufficient history`)
        continue
      }

      // Mock bookmaker and Polymarket odds (use 50-50 for testing)
      const request: PredictionRequest = {
        matchId: match.matchId,
        season: match.season,
        matchDate: match.matchDate,
        venue: match.venue,
        team1: match.team1,
        team2: match.team2,
        tossWinner: match.tossWinner || null,
        bookmakersOdds: 2.0, // 50% implied probability
        polymarketOdds: 2.0,
      }

      try {
        const { team1Prediction, team2Prediction } = generatePredictions(
          request,
          historicalMatches
        )

        // Check if prediction matches actual result
        const team1Won = match.winner === match.team1
        const team1PredCorrect =
          (team1Prediction.modelProbability > 0.5 && team1Won) ||
          (team1Prediction.modelProbability <= 0.5 && !team1Won)

        if (team1PredCorrect) {
          correctPredictions++
        }

        totalPredictions++

        logger.debug(`Match ${match.matchId}: ${match.team1} vs ${match.team2}`, {
          team1Pred: team1Prediction.modelProbability.toFixed(3),
          team1Won,
          correct: team1PredCorrect,
        })
      } catch (error) {
        logger.error(`Failed to predict match ${match.matchId}:`, { error })
      }
    }

    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0
    logger.info(`Phase 1 Validation Complete`, {
      correctPredictions,
      totalPredictions,
      accuracy: (accuracy * 100).toFixed(2) + "%",
      targetAccuracy: "62-65%",
    })

    if (accuracy >= 0.62) {
      logger.info("✓ Phase 1 accuracy target met!")
    } else {
      logger.warn("✗ Phase 1 accuracy below target. Consider retraining weights.")
    }
  } catch (error) {
    logger.error("Phase 1 validation failed:", { error })
    throw error
  }
}
