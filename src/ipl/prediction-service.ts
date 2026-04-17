/**
 * IPL Prediction Service
 * Orchestrates feature engineering, model inference, and result storage
 */

import { Effect } from "effect"
import logger from "../logger.js"
import {
  engineerFeatures,
  type MatchContext,
  type TeamFeatures,
  type HistoricalMatch,
} from "./feature-engineer.js"
import {
  predictWinProbability,
  getDefaultWeights,
  getConfidenceLevel,
  calculateEdge,
  isActionable,
} from "./baseline-model.js"

export interface PredictionRequest {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  team1: string
  team2: string
  tossWinner?: string | null
  tossDecision?: string | null
  bookmakersOdds: number
  polymarketOdds: number
}

export interface PredictionResult {
  matchId: string
  team: string
  opponent: string
  modelProbability: number
  confidence: "low" | "medium" | "high"
  bookmakersProb: number
  polymarketProb: number
  edgeVsBookmakers: number
  edgeVsPolymarket: number
  isActionable: boolean
  features: TeamFeatures
}

/**
 * Generate predictions for a match
 */
export const generatePredictions = (
  request: PredictionRequest,
  historicalMatches: HistoricalMatch[]
): { team1Prediction: PredictionResult; team2Prediction: PredictionResult } => {
  const context: MatchContext = {
    matchId: request.matchId,
    season: request.season,
    matchDate: request.matchDate,
    venue: request.venue,
    team1: request.team1,
    team2: request.team2,
  }

  // Only assign optional properties if they have values
  if (request.tossWinner) {
    context.tossWinner = request.tossWinner
  }
  if (request.tossDecision) {
    context.tossDecision = request.tossDecision
  }

  // Engineer features
  const { team1Features, team2Features } = engineerFeatures(
    context,
    historicalMatches,
    request.bookmakersOdds,
    request.polymarketOdds
  )

  // Get model weights
  const weights = getDefaultWeights()

  // Generate predictions
  const team1Prob = predictWinProbability(team1Features, weights)
  const team2Prob = predictWinProbability(team2Features, weights)

  const bookmakersProb = 1 / request.bookmakersOdds
  const polymarketProb = 1 / request.polymarketOdds

  const team1Prediction: PredictionResult = {
    matchId: request.matchId,
    team: request.team1,
    opponent: request.team2,
    modelProbability: team1Prob,
    confidence: getConfidenceLevel(team1Prob),
    bookmakersProb,
    polymarketProb,
    edgeVsBookmakers: calculateEdge(team1Prob, bookmakersProb),
    edgeVsPolymarket: calculateEdge(team1Prob, polymarketProb),
    isActionable: isActionable(team1Prob, bookmakersProb),
    features: team1Features,
  }

  const team2Prediction: PredictionResult = {
    matchId: request.matchId,
    team: request.team2,
    opponent: request.team1,
    modelProbability: team2Prob,
    confidence: getConfidenceLevel(team2Prob),
    bookmakersProb: 1 - bookmakersProb,
    polymarketProb: 1 - polymarketProb,
    edgeVsBookmakers: calculateEdge(team2Prob, 1 - bookmakersProb),
    edgeVsPolymarket: calculateEdge(team2Prob, 1 - polymarketProb),
    isActionable: isActionable(team2Prob, 1 - bookmakersProb),
    features: team2Features,
  }

  return { team1Prediction, team2Prediction }
}

/**
 * Effect-based prediction generation
 */
export const generatePredictionsEffect = (
  request: PredictionRequest,
  historicalMatches: HistoricalMatch[]
): Effect.Effect<{
  team1Prediction: PredictionResult
  team2Prediction: PredictionResult
}> =>
  Effect.sync(() => generatePredictions(request, historicalMatches))

/**
 * Log prediction results
 */
export const logPredictionResults = (
  team1Pred: PredictionResult,
  team2Pred: PredictionResult
): Effect.Effect<void> =>
  Effect.sync(() => {
    logger.info(`IPL Match Prediction: ${team1Pred.team} vs ${team2Pred.team}`, {
      matchId: team1Pred.matchId,
      team1: {
        team: team1Pred.team,
        modelProb: team1Pred.modelProbability.toFixed(3),
        confidence: team1Pred.confidence,
        edgeVsBookmakers: team1Pred.edgeVsBookmakers.toFixed(3),
        actionable: team1Pred.isActionable,
      },
      team2: {
        team: team2Pred.team,
        modelProb: team2Pred.modelProbability.toFixed(3),
        confidence: team2Pred.confidence,
        edgeVsBookmakers: team2Pred.edgeVsBookmakers.toFixed(3),
        actionable: team2Pred.isActionable,
      },
    })
  })
