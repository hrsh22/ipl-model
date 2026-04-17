/**
 * Phase 2 Validation Script
 * Tests accuracy with player-level and wickets-in-hand features
 */

import { loadCricsheetData } from "./data-loader.js"
import { engineerFeatures } from "./feature-engineer.js"
import { predictWinProbability, getPhase2Weights } from "./baseline-model.js"
import { extractPlayerPerformances, type PlayerMatchPerformance } from "./player-extractor.js"
import { calculateWicketsMetrics } from "./wickets-model.js"
import logger from "../logger.js"
import { readFileSync } from "fs"
import { join } from "path"
import { parse } from "csv-parse/sync"

interface ValidationResult {
  matchId: string
  team1: string
  team2: string
  winner: string
  team1Prob: number
  team2Prob: number
  prediction: string
  correct: boolean
}

export const validatePhase2 = async (dataDir: string): Promise<void> => {
  logger.info("Loading historical data...")
  const allMatches = loadCricsheetData(dataDir)
  logger.info(`Loaded ${allMatches.length} matches`)

  // Get recent matches for testing
  const testMatches = allMatches.filter((m) => m.season >= 2025)
  logger.info(`Testing on ${testMatches.length} recent matches`)

  const weights = getPhase2Weights()
  const results: ValidationResult[] = []

  let processed = 0
  for (const match of testMatches) {
    processed++
    if (processed % 10 === 0) {
      logger.info(`Processing match ${processed}/${testMatches.length}...`)
    }

    // Get prior matches
    const priorMatches = allMatches.filter((m) => m.matchDate < match.matchDate)
    if (priorMatches.length < 10) continue

    try {
      // Extract player performances from ball-by-ball data
      let playerPerformances: PlayerMatchPerformance[] = []
      try {
        const ballDataPath = join(dataDir, `${match.matchId}.csv`)
        const content = readFileSync(ballDataPath, "utf-8")
        const records = parse(content, {
          columns: true,
          skip_empty_lines: true,
        }) as Array<Record<string, string>>

        const ballData = records.map((record) => ({
          match_id: match.matchId,
          season: parseInt(record.season || "0"),
          start_date: record.start_date || "",
          venue: record.venue || "",
          innings: parseInt(record.innings || "0"),
          ball: record.ball || "",
          batting_team: record.batting_team || "",
          bowling_team: record.bowling_team || "",
          striker: record.striker || "",
          non_striker: record.non_striker || "",
          bowler: record.bowler || "",
          runs_off_bat: parseInt(record.runs_off_bat || "0"),
          extras: parseInt(record.extras || "0"),
          wicket_type: record.wicket_type || undefined,
          player_dismissed: record.player_dismissed || undefined,
        }))

        playerPerformances = extractPlayerPerformances(ballData, match)
      } catch (e) {
        // If player extraction fails, continue with empty array
        playerPerformances = []
      }

      // Calculate wickets metrics
      const wicketsMetrics = calculateWicketsMetrics(match)

      // Engineer features
      const { team1Features, team2Features } = engineerFeatures(
        {
          matchId: match.matchId,
          season: match.season,
          matchDate: match.matchDate,
          venue: match.venue,
          team1: match.team1,
          team2: match.team2,
          tossWinner: match.tossWinner,
          tossDecision: match.tossDecision,
        },
        priorMatches,
        2.0,
        2.0,
        playerPerformances,
        wicketsMetrics
      )

      // Predict
      const team1Prob = predictWinProbability(team1Features, weights)
      const team2Prob = predictWinProbability(team2Features, weights)

      // Determine prediction
      const prediction = team1Prob > team2Prob ? match.team1 : match.team2
      const correct = prediction === match.winner

      results.push({
        matchId: match.matchId,
        team1: match.team1,
        team2: match.team2,
        winner: match.winner,
        team1Prob,
        team2Prob,
        prediction,
        correct,
      })
    } catch (error) {
      logger.error(`Error processing match ${match.matchId}:`, error)
    }
  }

  // Calculate accuracy
  const correct = results.filter((r) => r.correct).length
  const accuracy = correct / results.length

  logger.info(`\n=== Phase 2 Validation Results ===`)
  logger.info(`Total predictions: ${results.length}`)
  logger.info(`Correct: ${correct}`)
  logger.info(`Accuracy: ${(accuracy * 100).toFixed(2)}%`)
  logger.info(`Target: 70-72%`)
  logger.info(`Gap: ${((accuracy * 100) - 70).toFixed(2)}%`)

  // Show sample predictions
  logger.info(`\n=== Sample Predictions ===`)
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const result = results[i]
    if (!result) continue
    const status = result.correct ? "✓" : "✗"
    logger.info(
      `${status} ${result.team1} vs ${result.team2}: predicted ${result.prediction} (${(result.team1Prob * 100).toFixed(1)}% vs ${(result.team2Prob * 100).toFixed(1)}%), actual ${result.winner}`
    )
  }
}

// Run validation
validatePhase2("./data/cricsheet").catch((error) => {
  logger.error("Validation failed:", error)
  process.exit(1)
})
