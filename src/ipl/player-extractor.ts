/**
 * IPL Player Extractor
 * Extracts player names and statistics from Cricsheet ball-by-ball data
 */

import type { CricsheetMatch } from "./data-loader.js"
import type { HistoricalMatch } from "./feature-engineer.js"

export interface PlayerStats {
  name: string
  team: string
  matches: number
  runs: number
  wickets: number
  dismissals: number
  battingAverage: number
  bowlingAverage: number
  lastMatchDate: Date
}

export interface PlayerMatchPerformance {
  playerName: string
  team: string
  matchId: string
  matchDate: Date
  role: "batter" | "bowler" | "both"
  runs: number
  wickets: number
  dismissed: boolean
}

/**
 * Extract all player performances from ball-by-ball data
 */
export const extractPlayerPerformances = (
  ballData: CricsheetMatch[],
  match: HistoricalMatch
): PlayerMatchPerformance[] => {
  const performances = new Map<string, PlayerMatchPerformance>()

  for (const ball of ballData) {
    // Track batters
    if (ball.striker) {
      const key = `${ball.striker}-${ball.batting_team}`
      if (!performances.has(key)) {
        performances.set(key, {
          playerName: ball.striker,
          team: ball.batting_team,
          matchId: match.matchId,
          matchDate: match.matchDate,
          role: "batter",
          runs: 0,
          wickets: 0,
          dismissed: false,
        })
      }
      const perf = performances.get(key)
      if (perf) {
        perf.runs += ball.runs_off_bat + ball.extras
      }
    }

    // Track bowlers
    if (ball.bowler) {
      const key = `${ball.bowler}-${ball.bowling_team}`
      if (!performances.has(key)) {
        performances.set(key, {
          playerName: ball.bowler,
          team: ball.bowling_team,
          matchId: match.matchId,
          matchDate: match.matchDate,
          role: "bowler",
          runs: 0,
          wickets: 0,
          dismissed: false,
        })
      }
      const perf = performances.get(key)
      if (perf && ball.wicket_type) {
        perf.wickets++
      }
    }

    // Track dismissals
    if (ball.player_dismissed && ball.striker === ball.player_dismissed) {
      const key = `${ball.striker}-${ball.batting_team}`
      const perf = performances.get(key)
      if (perf) {
        perf.dismissed = true
      }
    }
  }

  return Array.from(performances.values())
}

/**
 * Get star players for a team (top 3 by recent form)
 */
export const getStarPlayers = (
  playerPerformances: PlayerMatchPerformance[],
  team: string,
  limit: number = 3
): PlayerMatchPerformance[] => {
  return playerPerformances
    .filter((p) => p.team === team && p.role === "batter")
    .sort((a, b) => b.runs - a.runs)
    .slice(0, limit)
}

/**
 * Calculate player form EMA (exponential moving average)
 * Based on last N matches
 */
export const calculatePlayerFormEma = (
  performances: PlayerMatchPerformance[],
  playerName: string,
  alpha: number = 0.3,
  lookbackMatches: number = 10
): number => {
  const playerMatches = performances
    .filter((p) => p.playerName === playerName)
    .sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())
    .slice(-lookbackMatches)

  if (playerMatches.length === 0) return 0

  let ema = 0
  for (let i = 0; i < playerMatches.length; i++) {
    const match = playerMatches[i]
    if (!match) continue
    const runs = match.runs
    if (i === 0) {
      ema = runs
    } else {
      ema = alpha * runs + (1 - alpha) * ema
    }
  }

  return ema
}

/**
 * Calculate player batting average
 */
export const calculatePlayerBattingAverage = (
  performances: PlayerMatchPerformance[],
  playerName: string,
  lookbackMatches: number = 10
): number => {
  const playerMatches = performances
    .filter((p) => p.playerName === playerName && p.role === "batter")
    .sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())
    .slice(-lookbackMatches)

  if (playerMatches.length === 0) return 0

  const totalRuns = playerMatches.reduce((sum, p) => sum + p.runs, 0)
  const dismissals = playerMatches.filter((p) => p.dismissed).length

  if (dismissals === 0) return totalRuns // Not out
  return totalRuns / dismissals
}

/**
 * Calculate player bowling average (runs per wicket)
 */
export const calculatePlayerBowlingAverage = (
  performances: PlayerMatchPerformance[],
  playerName: string,
  lookbackMatches: number = 10
): number => {
  const playerMatches = performances
    .filter((p) => p.playerName === playerName && p.role === "bowler")
    .sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())
    .slice(-lookbackMatches)

  if (playerMatches.length === 0) return 0

  const totalWickets = playerMatches.reduce((sum, p) => sum + p.wickets, 0)
  if (totalWickets === 0) return 0

  const totalRuns = playerMatches.reduce((sum, p) => sum + p.runs, 0)
  return totalRuns / totalWickets
}

/**
 * Get team's star player form (average of top 3 batters)
 */
export const getTeamStarPlayerForm = (
  performances: PlayerMatchPerformance[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const starPlayers = getStarPlayers(performances, team, 3)

  if (starPlayers.length === 0) return 0

  const forms = starPlayers.map((p) =>
    calculatePlayerFormEma(performances, p.playerName, 0.3, lookbackMatches)
  )

  return forms.reduce((sum, f) => sum + f, 0) / forms.length
}

/**
 * Get team's key bowler form (average of top 3 bowlers)
 */
export const getTeamKeyBowlerForm = (
  performances: PlayerMatchPerformance[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const keyBowlers = performances
    .filter((p) => p.team === team && p.role === "bowler")
    .sort((a, b) => b.wickets - a.wickets)
    .slice(0, 3)

  if (keyBowlers.length === 0) return 0

  const forms = keyBowlers.map((p) =>
    calculatePlayerFormEma(performances, p.playerName, 0.3, lookbackMatches)
  )

  return forms.reduce((sum, f) => sum + f, 0) / forms.length
}
