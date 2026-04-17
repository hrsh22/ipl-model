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
 */

import { Effect } from "effect"

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
  
  // Team form
  formEma: number // Exponential moving average
  winsLast5: number
  winsLast10: number
  
  // Head-to-head
  h2hWins: number
  h2hLosses: number
  h2hWinRate: number
  
  // Venue
  venueWins: number
  venueLosses: number
  venueWinRate: number
  
  // Toss
  tossBias: number // P(win | toss win)
  
  // Odds
  bookmakersOdds: number
  bookmakersImpliedProb: number
  polymarketOdds: number
  polymarketImpliedProb: number
  
  // Divergence
  klDivergence: number
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
 * Engineer features for a match
 */
export const engineerFeatures = (
  context: MatchContext,
  historicalMatches: HistoricalMatch[],
  bookmakersOdds: number,
  polymarketOdds: number
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
  }

  // Team 2 features (inverse odds)
  const team2H2H = calculateH2H(priorMatches, context.team2, context.team1)
  const team2Venue = calculateVenueStats(priorMatches, context.team2, context.venue)
  
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
  polymarketOdds: number
): Effect.Effect<{ team1Features: TeamFeatures; team2Features: TeamFeatures }> =>
  Effect.sync(() =>
    engineerFeatures(context, historicalMatches, bookmakersOdds, polymarketOdds)
  )
