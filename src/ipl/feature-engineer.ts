/**
 * IPL Feature Engineering Module
 * Adapted from football-prediction-model.md for cricket
 * 
 * Phase 1 features:
 * - Team form (EMA)
 * - Head-to-head records
 * - Venue intelligence
 * - Bookmaker odds normalization
 * - Polymarket odds integration
 * - KL-divergence for divergence analysis
 * 
 * Phase 2 features:
 * - Player-level form (star batters and key bowlers)
 * - Wickets-in-hand model (resource availability)
 * - Batting depth and bowling strength
 */

import { Effect } from "effect"
import type { PlayerMatchPerformance } from "./player-extractor.js"
import type { WicketsMetrics } from "./wickets-model.js"

export interface MatchContext {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  team1: string
  team2: string
  tossWinner?: string | undefined
  tossDecision?: string | undefined
}

export interface TeamFeatures {
  team: string
  opponent: string
  
  // Team form (Phase 1)
  formEma: number // Exponential moving average
  winsLast5: number
  winsLast10: number
  
  // Head-to-head (Phase 1)
  h2hWins: number
  h2hLosses: number
  h2hWinRate: number
  
  // Venue (Phase 1)
  venueWins: number
  venueLosses: number
  venueWinRate: number
  
  // Toss (Phase 1)
  tossBias: number // P(win | toss win)
  
  // Odds (Phase 1)
  bookmakersOdds: number
  bookmakersImpliedProb: number
  polymarketOdds: number
  polymarketImpliedProb: number
  
  // Divergence (Phase 1)
  klDivergence: number
  
  // Player-level features (Phase 2)
  starPlayerForm: number // Average form of top 3 batters
  keyBowlerForm: number // Average form of top 3 bowlers
  
  // Wickets-in-hand features (Phase 2)
  wicketsRemaining: number // 0-10
  resourceIndex: number // 0-1, where 1 = all wickets available
  wicketPressure: number // 0-1, where 1 = high pressure
  battingDepth: number // 0-1, based on wicket loss patterns
  bowlingStrength: number // 0-1, based on wickets taken
}

export interface HistoricalMatch {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  team1: string
  team2: string
  tossWinner?: string | undefined
  tossDecision?: string | undefined
  winner: string
  team1Runs: number
  team1Wickets: number
  team2Runs: number
  team2Wickets: number
}

/**
 * Calculate exponential moving average of team wins
 * Recent matches weighted more heavily
 */
export const calculateFormEma = (
  matches: HistoricalMatch[],
  team: string,
  alpha: number = 0.3
): number => {
  if (matches.length === 0) return 0.5

  let ema = 0.5 // Start at 50%
  
  for (const match of matches) {
    const teamWon = match.winner === team ? 1 : 0
    ema = alpha * teamWon + (1 - alpha) * ema
  }
  
  return ema
}

/**
 * Calculate head-to-head win rate
 */
export const calculateH2H = (
  matches: HistoricalMatch[],
  team: string,
  opponent: string
): { wins: number; losses: number; winRate: number } => {
  const h2hMatches = matches.filter(
    (m) =>
      (m.team1 === team && m.team2 === opponent) ||
      (m.team1 === opponent && m.team2 === team)
  )

  const wins = h2hMatches.filter((m) => m.winner === team).length
  const losses = h2hMatches.length - wins

  return {
    wins,
    losses,
    winRate: h2hMatches.length > 0 ? wins / h2hMatches.length : 0.5,
  }
}

/**
 * Calculate venue win rate
 */
export const calculateVenueStats = (
  matches: HistoricalMatch[],
  team: string,
  venue: string
): { wins: number; losses: number; winRate: number } => {
  const venueMatches = matches.filter(
    (m) => m.venue === venue && (m.team1 === team || m.team2 === team)
  )

  const wins = venueMatches.filter((m) => m.winner === team).length
  const losses = venueMatches.length - wins

  return {
    wins,
    losses,
    winRate: venueMatches.length > 0 ? wins / venueMatches.length : 0.5,
  }
}

/**
 * Calculate toss bias: P(team wins | team wins toss)
 */
export const calculateTossBias = (
  matches: HistoricalMatch[],
  team: string
): number => {
  const tossBatMatches = matches.filter(
    (m) => m.tossWinner === team && m.tossDecision === "bat"
  )
  const tossFieldMatches = matches.filter(
    (m) => m.tossWinner === team && m.tossDecision === "field"
  )

  const tossBatWins = tossBatMatches.filter((m) => m.winner === team).length
  const tossFieldWins = tossFieldMatches.filter((m) => m.winner === team).length

  const totalTossWins = tossBatMatches.length + tossFieldMatches.length

  if (totalTossWins === 0) return 0.5

  return (tossBatWins + tossFieldWins) / totalTossWins
}

/**
 * Normalize bookmaker odds to probability
 * Accounts for overround (vigorish)
 */
export const normalizeOdds = (odds: number): number => {
  // Convert decimal odds to implied probability
  const impliedProb = 1 / odds

  // Assume 5% overround (typical for bookmakers)
  const overround = 0.05
  const normalizedProb = impliedProb / (1 + overround)

  return Math.min(Math.max(normalizedProb, 0), 1)
}

/**
 * Calculate KL divergence between two probability distributions
 * Used to measure divergence between bookmakers and Polymarket
 */
export const calculateKlDivergence = (
  p: number, // Bookmakers probability
  q: number  // Polymarket probability
): number => {
  const epsilon = 1e-10
  const pClipped = Math.max(Math.min(p, 1 - epsilon), epsilon)
  const qClipped = Math.max(Math.min(q, 1 - epsilon), epsilon)

  return (
    pClipped * Math.log(pClipped / qClipped) +
    (1 - pClipped) * Math.log((1 - pClipped) / (1 - qClipped))
  )
}

/**
 * Calculate player-level form features
 */
export const calculatePlayerFeatures = (
  performances: PlayerMatchPerformance[],
  team: string
): { starPlayerForm: number; keyBowlerForm: number } => {
  // Star player form: average of top 3 batters
  const starPlayers = performances
    .filter((p) => p.team === team && p.role === "batter")
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 3)

  const starPlayerForm = starPlayers.length > 0
    ? starPlayers.reduce((sum, p) => sum + p.runs, 0) / starPlayers.length / 50 // Normalize to 0-1
    : 0.5

  // Key bowler form: average wickets of top 3 bowlers
  const keyBowlers = performances
    .filter((p) => p.team === team && p.role === "bowler")
    .sort((a, b) => b.wickets - a.wickets)
    .slice(0, 3)

  const keyBowlerForm = keyBowlers.length > 0
    ? keyBowlers.reduce((sum, p) => sum + p.wickets, 0) / keyBowlers.length / 3 // Normalize to 0-1
    : 0.5

  return {
    starPlayerForm: Math.min(1, starPlayerForm),
    keyBowlerForm: Math.min(1, keyBowlerForm),
  }
}

/**
 * Calculate wickets-based features
 */
export const calculateWicketsFeatures = (
  matches: HistoricalMatch[],
  team: string,
  wicketsMetrics: WicketsMetrics,
  isTeam1: boolean
): {
  wicketsRemaining: number
  resourceIndex: number
  wicketPressure: number
  battingDepth: number
  bowlingStrength: number
} => {
  // Get team's recent matches
  const teamMatches = matches
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-10)

  // Wickets remaining and resource index
  const wicketsRemaining = isTeam1
    ? wicketsMetrics.team1WicketsRemaining
    : wicketsMetrics.team2WicketsRemaining
  const resourceIndex = isTeam1
    ? wicketsMetrics.team1ResourceIndex
    : wicketsMetrics.team2ResourceIndex
  const wicketPressure = isTeam1
    ? wicketsMetrics.team1WicketPressure
    : wicketsMetrics.team2WicketPressure

  // Batting depth: based on average wickets lost
  const avgWicketsLost = teamMatches.length > 0
    ? teamMatches.reduce((sum, m) => {
        return sum + (m.team1 === team ? m.team1Wickets : m.team2Wickets)
      }, 0) / teamMatches.length
    : 5

  const battingDepth = Math.max(0, 1 - avgWicketsLost / 10)

  // Bowling strength: based on average wickets taken
  const avgWicketsTaken = teamMatches.length > 0
    ? teamMatches.reduce((sum, m) => {
        return sum + (m.team1 === team ? m.team2Wickets : m.team1Wickets)
      }, 0) / teamMatches.length
    : 5

  const bowlingStrength = Math.min(1, avgWicketsTaken / 10)

  return {
    wicketsRemaining,
    resourceIndex,
    wicketPressure,
    battingDepth,
    bowlingStrength,
  }
}

/**
 * Engineer features for a match
 */
export const engineerFeatures = (
  context: MatchContext,
  historicalMatches: HistoricalMatch[],
  bookmakersOdds: number,
  polymarketOdds: number,
  playerPerformances?: PlayerMatchPerformance[] | undefined,
  wicketsMetrics?: WicketsMetrics | undefined
): { team1Features: TeamFeatures; team2Features: TeamFeatures } => {
  // Filter historical matches before this match
  const priorMatches = historicalMatches.filter(
    (m) => m.matchDate < context.matchDate
  )

  // Team 1 features
  const team1FormEma = calculateFormEma(
    priorMatches.filter((m) => m.team1 === context.team1 || m.team2 === context.team1),
    context.team1
  )
  const team1H2H = calculateH2H(priorMatches, context.team1, context.team2)
  const team1Venue = calculateVenueStats(priorMatches, context.team1, context.venue)
  const team1TossBias = calculateTossBias(priorMatches, context.team1)

  const bookmakersProb = normalizeOdds(bookmakersOdds)
  const polymarketProb = normalizeOdds(polymarketOdds)
  const klDiv = calculateKlDivergence(bookmakersProb, polymarketProb)

  // Player features (Phase 2)
  const team1PlayerFeatures = playerPerformances
    ? calculatePlayerFeatures(playerPerformances, context.team1)
    : { starPlayerForm: 0.5, keyBowlerForm: 0.5 }

  // Wickets features (Phase 2)
  const team1WicketsFeatures = wicketsMetrics
    ? calculateWicketsFeatures(priorMatches, context.team1, wicketsMetrics, true)
    : {
        wicketsRemaining: 10,
        resourceIndex: 1,
        wicketPressure: 0,
        battingDepth: 0.5,
        bowlingStrength: 0.5,
      }

  const team1Features: TeamFeatures = {
    team: context.team1,
    opponent: context.team2,
    formEma: team1FormEma,
    winsLast5: priorMatches
      .filter((m) => (m.team1 === context.team1 || m.team2 === context.team1) && m.matchDate > new Date(context.matchDate.getTime() - 5 * 24 * 60 * 60 * 1000))
      .filter((m) => m.winner === context.team1).length,
    winsLast10: priorMatches
      .filter((m) => (m.team1 === context.team1 || m.team2 === context.team1) && m.matchDate > new Date(context.matchDate.getTime() - 10 * 24 * 60 * 60 * 1000))
      .filter((m) => m.winner === context.team1).length,
    h2hWins: team1H2H.wins,
    h2hLosses: team1H2H.losses,
    h2hWinRate: team1H2H.winRate,
    venueWins: team1Venue.wins,
    venueLosses: team1Venue.losses,
    venueWinRate: team1Venue.winRate,
    tossBias: team1TossBias,
    bookmakersOdds,
    bookmakersImpliedProb: bookmakersProb,
    polymarketOdds,
    polymarketImpliedProb: polymarketProb,
    klDivergence: klDiv,
    starPlayerForm: team1PlayerFeatures.starPlayerForm,
    keyBowlerForm: team1PlayerFeatures.keyBowlerForm,
    wicketsRemaining: team1WicketsFeatures.wicketsRemaining,
    resourceIndex: team1WicketsFeatures.resourceIndex,
    wicketPressure: team1WicketsFeatures.wicketPressure,
    battingDepth: team1WicketsFeatures.battingDepth,
    bowlingStrength: team1WicketsFeatures.bowlingStrength,
  }

  // Team 2 features (inverse odds)
  const team2H2H = calculateH2H(priorMatches, context.team2, context.team1)
  const team2Venue = calculateVenueStats(priorMatches, context.team2, context.venue)
  
  // Player features (Phase 2)
  const team2PlayerFeatures = playerPerformances
    ? calculatePlayerFeatures(playerPerformances, context.team2)
    : { starPlayerForm: 0.5, keyBowlerForm: 0.5 }

  // Wickets features (Phase 2)
  const team2WicketsFeatures = wicketsMetrics
    ? calculateWicketsFeatures(priorMatches, context.team2, wicketsMetrics, false)
    : {
        wicketsRemaining: 10,
        resourceIndex: 1,
        wicketPressure: 0,
        battingDepth: 0.5,
        bowlingStrength: 0.5,
      }

  const team2Features: TeamFeatures = {
    team: context.team2,
    opponent: context.team1,
    formEma: calculateFormEma(
      priorMatches.filter((m) => m.team1 === context.team2 || m.team2 === context.team2),
      context.team2
    ),
    winsLast5: priorMatches
      .filter((m) => (m.team1 === context.team2 || m.team2 === context.team2) && m.matchDate > new Date(context.matchDate.getTime() - 5 * 24 * 60 * 60 * 1000))
      .filter((m) => m.winner === context.team2).length,
    winsLast10: priorMatches
      .filter((m) => (m.team1 === context.team2 || m.team2 === context.team2) && m.matchDate > new Date(context.matchDate.getTime() - 10 * 24 * 60 * 60 * 1000))
      .filter((m) => m.winner === context.team2).length,
    h2hWins: team2H2H.wins,
    h2hLosses: team2H2H.losses,
    h2hWinRate: team2H2H.winRate,
    venueWins: team2Venue.wins,
    venueLosses: team2Venue.losses,
    venueWinRate: team2Venue.winRate,
    tossBias: calculateTossBias(priorMatches, context.team2),
    bookmakersOdds: 1 / bookmakersOdds, // Inverse odds
    bookmakersImpliedProb: 1 - bookmakersProb,
    polymarketOdds: 1 / polymarketOdds,
    polymarketImpliedProb: 1 - polymarketProb,
    klDivergence: klDiv,
    starPlayerForm: team2PlayerFeatures.starPlayerForm,
    keyBowlerForm: team2PlayerFeatures.keyBowlerForm,
    wicketsRemaining: team2WicketsFeatures.wicketsRemaining,
    resourceIndex: team2WicketsFeatures.resourceIndex,
    wicketPressure: team2WicketsFeatures.wicketPressure,
    battingDepth: team2WicketsFeatures.battingDepth,
    bowlingStrength: team2WicketsFeatures.bowlingStrength,
  }

  return { team1Features, team2Features }
}

/**
 * Effect-based feature engineering
 */
export const engineerFeaturesEffect = (
  context: MatchContext,
  historicalMatches: HistoricalMatch[],
  bookmakersOdds: number,
  polymarketOdds: number,
  playerPerformances?: PlayerMatchPerformance[] | undefined,
  wicketsMetrics?: WicketsMetrics | undefined
): Effect.Effect<{ team1Features: TeamFeatures; team2Features: TeamFeatures }> =>
  Effect.sync(() =>
    engineerFeatures(context, historicalMatches, bookmakersOdds, polymarketOdds, playerPerformances, wicketsMetrics)
  )
