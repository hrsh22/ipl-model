/**
 * IPL Wickets-in-Hand Model
 * Cricket-specific feature: remaining wickets as resource availability
 */

import type { HistoricalMatch } from "./feature-engineer.js"

export interface WicketsMetrics {
  team1WicketsRemaining: number
  team2WicketsRemaining: number
  team1ResourceIndex: number // 0-1, where 1 = all wickets available
  team2ResourceIndex: number
  team1WicketPressure: number // 0-1, where 1 = high pressure (few wickets left)
  team2WicketPressure: number
  team1PowerplayWickets: number // Wickets lost in powerplay
  team2PowerplayWickets: number
}

/**
 * Calculate wickets-in-hand metrics for a match
 * Wickets in cricket: 10 total per team
 */
export const calculateWicketsMetrics = (match: HistoricalMatch): WicketsMetrics => {
  // Wickets remaining = 10 - wickets lost
  const team1WicketsRemaining = Math.max(0, 10 - match.team1Wickets)
  const team2WicketsRemaining = Math.max(0, 10 - match.team2Wickets)

  // Resource index: 0 = no wickets left, 1 = all wickets available
  const team1ResourceIndex = team1WicketsRemaining / 10
  const team2ResourceIndex = team2WicketsRemaining / 10

  // Wicket pressure: inverse of resource index
  // High pressure = few wickets left = high risk
  const team1WicketPressure = 1 - team1ResourceIndex
  const team2WicketPressure = 1 - team2ResourceIndex

  // Estimate powerplay wickets (first 6 overs = 36 balls)
  // This is approximate based on total wickets
  // In IPL, typically 1-2 wickets fall in powerplay
  const team1PowerplayWickets = Math.min(match.team1Wickets, 2)
  const team2PowerplayWickets = Math.min(match.team2Wickets, 2)

  return {
    team1WicketsRemaining,
    team2WicketsRemaining,
    team1ResourceIndex,
    team2ResourceIndex,
    team1WicketPressure,
    team2WicketPressure,
    team1PowerplayWickets,
    team2PowerplayWickets,
  }
}

/**
 * Calculate wicket loss rate (wickets per 6 overs)
 * Useful for predicting collapse risk
 */
export const calculateWicketLossRate = (
  matches: HistoricalMatch[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const teamMatches = matches
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-lookbackMatches)

  if (teamMatches.length === 0) return 0

  const totalWickets = teamMatches.reduce((sum, m) => {
    return sum + (m.team1 === team ? m.team1Wickets : m.team2Wickets)
  }, 0)

  return totalWickets / teamMatches.length
}

/**
 * Calculate collapse risk (probability of losing 3+ wickets in quick succession)
 * Based on recent wicket loss patterns
 */
export const calculateCollapseRisk = (
  matches: HistoricalMatch[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const teamMatches = matches
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-lookbackMatches)

  if (teamMatches.length === 0) return 0

  // Count matches where team lost 4+ wickets
  const collapseMatches = teamMatches.filter((m) => {
    const wickets = m.team1 === team ? m.team1Wickets : m.team2Wickets
    return wickets >= 4
  }).length

  return collapseMatches / teamMatches.length
}

/**
 * Calculate batting depth score
 * Based on how many wickets team typically loses
 * Lower wicket loss = deeper batting lineup
 */
export const calculateBattingDepth = (
  matches: HistoricalMatch[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const wicketLossRate = calculateWicketLossRate(matches, team, lookbackMatches)
  // Depth score: 1 - (wickets lost / 10)
  // If team loses 3 wickets on average, depth = 0.7
  return Math.max(0, 1 - wicketLossRate / 10)
}

/**
 * Calculate bowling strength based on wickets taken
 * More wickets taken = stronger bowling
 */
export const calculateBowlingStrength = (
  matches: HistoricalMatch[],
  team: string,
  lookbackMatches: number = 10
): number => {
  const teamMatches = matches
    .filter((m) => m.team1 === team || m.team2 === team)
    .slice(-lookbackMatches)

  if (teamMatches.length === 0) return 0

  const totalWicketsTaken = teamMatches.reduce((sum, m) => {
    // Wickets taken = opponent's wickets lost
    if (m.team1 === team) {
      return sum + m.team2Wickets
    } else {
      return sum + m.team1Wickets
    }
  }, 0)

  // Average wickets taken per match
  const avgWicketsTaken = totalWicketsTaken / teamMatches.length

  // Normalize to 0-1 scale (10 wickets = perfect bowling)
  return Math.min(1, avgWicketsTaken / 10)
}

/**
 * Calculate match phase-specific wicket impact
 * Different phases have different wicket dynamics
 */
export const calculatePhaseWicketImpact = (
  match: HistoricalMatch,
  phase: "powerplay" | "middle" | "death"
): number => {
  // Powerplay (0-6 overs): Typically 1-2 wickets
  // Middle (7-15 overs): Typically 2-3 wickets
  // Death (16-20 overs): Typically 2-3 wickets

  const totalWickets = match.team1Wickets + match.team2Wickets

  switch (phase) {
    case "powerplay":
      // Powerplay wickets are critical - early loss = momentum shift
      return Math.min(2, totalWickets) / 2
    case "middle":
      // Middle overs: steady wicket loss
      return Math.min(3, Math.max(0, totalWickets - 2)) / 3
    case "death":
      // Death overs: final wickets determine outcome
      return Math.min(3, Math.max(0, totalWickets - 5)) / 3
  }
}
