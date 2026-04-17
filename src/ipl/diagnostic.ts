/**
 * Diagnostic Script
 * Analyzes feature distributions and model behavior
 */

import { loadCricsheetData } from "./data-loader.js"
import { engineerFeatures } from "./feature-engineer.js"
import { predictWinProbability, getDefaultWeights } from "./baseline-model.js"
import logger from "../logger.js"

export const runDiagnostics = (dataDir: string): void => {
  logger.info("Running diagnostics...")

  const allMatches = loadCricsheetData(dataDir)
  const recentMatches = allMatches.filter((m) => m.season >= 2025)

  logger.info(`Total matches: ${allMatches.length}, Recent: ${recentMatches.length}`)

  // Analyze first 20 recent matches
  const sampleMatches = recentMatches.slice(0, 20)
  const weights = getDefaultWeights()

  let correctCount = 0
  let totalCount = 0

  for (const match of sampleMatches) {
    const priorMatches = allMatches.filter((m) => m.matchDate < match.matchDate)

    if (priorMatches.length < 10) {
      logger.debug(`Skipping ${match.matchId}: insufficient history`)
      continue
    }

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
      2.0
    )

    const team1Prob = predictWinProbability(team1Features, weights)
    const team2Prob = predictWinProbability(team2Features, weights)

    const team1Won = match.winner === match.team1
    const team1PredCorrect = (team1Prob > 0.5 && team1Won) || (team1Prob <= 0.5 && !team1Won)

    if (team1PredCorrect) correctCount++
    totalCount++

    logger.info(`Match: ${match.team1} vs ${match.team2}`, {
      team1Prob: team1Prob.toFixed(3),
      team2Prob: team2Prob.toFixed(3),
      team1Won,
      correct: team1PredCorrect,
      formEma1: team1Features.formEma.toFixed(3),
      h2h1: team1Features.h2hWinRate.toFixed(3),
      venue1: team1Features.venueWinRate.toFixed(3),
    })
  }

  const accuracy = totalCount > 0 ? correctCount / totalCount : 0
  logger.info(`Diagnostic Accuracy: ${(accuracy * 100).toFixed(2)}% (${correctCount}/${totalCount})`)
}
