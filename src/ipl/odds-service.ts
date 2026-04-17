/**
 * Odds Service
 * Aggregates odds from multiple sources (bookmakers, Polymarket)
 */

import { Effect } from "effect"
import logger from "../logger.js"
import { polymarketClient, type PolymarketOdds } from "./polymarket-client.js"

export interface OddsSource {
  source: "bookmaker" | "polymarket"
  team1Odds: number
  team2Odds: number
  volume?: number
  liquidity?: number
  fetchedAt: Date
}

export interface AggregatedOdds {
  team1: string
  team2: string
  sources: OddsSource[]
  averageTeam1Odds: number
  averageTeam2Odds: number
  consensusTeam1Prob: number
  consensusTeam2Prob: number
}

/**
 * Get odds from Polymarket
 */
export const getPolymarketOdds = (
  team1: string,
  team2: string
): Effect.Effect<PolymarketOdds | null, Error> =>
  Effect.tryPromise({
    try: async () => {
      logger.debug("Fetching Polymarket odds", { team1, team2 })
      return await polymarketClient.getMatchOdds(team1, team2)
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

/**
 * Get bookmaker odds (mock for now)
 */
export const getBookmakerOdds = (
  _team1: string,
  _team2: string
): Effect.Effect<OddsSource | null, never> =>
  Effect.sync(() => {
    // In production, this would fetch from real bookmakers
    // For now, return null to indicate no bookmaker data
    logger.debug("Bookmaker odds not available (mock)")
    return null
  })

/**
 * Aggregate odds from multiple sources
 */
export const aggregateOdds = (
  team1: string,
  team2: string,
  sources: OddsSource[]
): AggregatedOdds => {
  const validSources = sources.filter((s) => s !== null)

  if (validSources.length === 0) {
    // Default to 50-50 if no sources available
    return {
      team1,
      team2,
      sources: [],
      averageTeam1Odds: 2.0,
      averageTeam2Odds: 2.0,
      consensusTeam1Prob: 0.5,
      consensusTeam2Prob: 0.5,
    }
  }

  const avgTeam1Odds =
    validSources.reduce((sum, s) => sum + s.team1Odds, 0) / validSources.length
  const avgTeam2Odds =
    validSources.reduce((sum, s) => sum + s.team2Odds, 0) / validSources.length

  const consensusTeam1Prob = 1 / avgTeam1Odds
  const consensusTeam2Prob = 1 / avgTeam2Odds

  return {
    team1,
    team2,
    sources: validSources,
    averageTeam1Odds: avgTeam1Odds,
    averageTeam2Odds: avgTeam2Odds,
    consensusTeam1Prob,
    consensusTeam2Prob,
  }
}

/**
 * Get aggregated odds for a match
 */
export const getAggregatedOdds = (
  team1: string,
  team2: string
): Effect.Effect<AggregatedOdds, Error> =>
  Effect.gen(function* () {
    logger.debug("Getting aggregated odds", { team1, team2 })

    const polymarketOdds = yield* getPolymarketOdds(team1, team2)
    const bookmakersOdds = yield* getBookmakerOdds(team1, team2)

    const sources: OddsSource[] = []

    if (polymarketOdds) {
      sources.push({
        source: "polymarket",
        team1Odds: polymarketOdds.team1Odds,
        team2Odds: polymarketOdds.team2Odds,
        volume: polymarketOdds.volume,
        liquidity: polymarketOdds.liquidity,
        fetchedAt: polymarketOdds.fetchedAt,
      })
    }

    if (bookmakersOdds) {
      sources.push(bookmakersOdds)
    }

    const aggregated = aggregateOdds(team1, team2, sources)

    logger.info("Aggregated odds retrieved", {
      team1,
      team2,
      sources: sources.length,
      team1Odds: aggregated.averageTeam1Odds.toFixed(3),
      team2Odds: aggregated.averageTeam2Odds.toFixed(3),
    })

    return aggregated
  })
