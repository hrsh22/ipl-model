/**
 * IPL Data Loader
 * Parses Cricsheet CSV files and loads into memory
 */

import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { parse } from "csv-parse/sync"
import type { HistoricalMatch } from "./feature-engineer.js"

export interface CricsheetMatch {
  match_id: string
  season: number
  start_date: string
  venue: string
  innings: number
  ball: string
  batting_team: string
  bowling_team: string
  striker: string
  non_striker: string
  bowler: string
  runs_off_bat: number
  extras: number
  wicket_type?: string | undefined
  player_dismissed?: string | undefined
}

export interface CricsheetInfo {
  match_id: string
  season: number
  date: string
  venue: string
  toss_winner?: string | undefined
  toss_decision?: string | undefined
  winner?: string | undefined
  winner_runs?: number | undefined
  winner_wickets?: number | undefined
}

/**
 * Parse Cricsheet info file
 */
const parseCricsheetInfo = (filePath: string, matchId: string): CricsheetInfo => {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")

  const info: Record<string, string | string[]> = {}

  for (const line of lines) {
    const parts = line.split(",")
    if (parts[0] === "info" && parts[1]) {
      const key = parts[1].trim()
      const value = parts.slice(2).join(",").trim().replace(/^"(.*)"$/, "$1")

      // Handle multiple teams
      if (key === "team") {
        if (!Array.isArray(info[key])) {
          info[key] = []
        }
        ;(info[key] as string[]).push(value)
      } else {
        info[key] = value
      }
    }
  }

  const teams = Array.isArray(info["team"]) ? (info["team"] as string[]) : []
  const date = (info["date"] as string) || ""
  const venue = (info["venue"] as string) || ""
  const tossWinner = (info["toss_winner"] as string) || undefined
  const tossDecision = (info["toss_decision"] as string) || undefined
  const winner = (info["winner"] as string) || undefined

  const result: CricsheetInfo = {
    match_id: matchId,
    season: parseInt((info["season"] as string) || "0"),
    date,
    venue,
  }

  if (tossWinner) result.toss_winner = tossWinner
  if (tossDecision) result.toss_decision = tossDecision
  if (winner) result.winner = winner
  if (info["winner_runs"]) result.winner_runs = parseInt(info["winner_runs"] as string)
  if (info["winner_wickets"]) result.winner_wickets = parseInt(info["winner_wickets"] as string)

  return result
}

/**
 * Parse Cricsheet match data file
 */
const parseCricsheetMatches = (filePath: string, matchId: string): CricsheetMatch[] => {
  const content = readFileSync(filePath, "utf-8")
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>

  return records.map((record) => {
    const match: CricsheetMatch = {
      match_id: matchId,
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
    }

    if (record.wicket_type) match.wicket_type = record.wicket_type
    if (record.player_dismissed) match.player_dismissed = record.player_dismissed

    return match
  })
}

/**
 * Aggregate match data from ball-by-ball records
 */
const aggregateMatchData = (
  matches: CricsheetMatch[],
  info: CricsheetInfo
): HistoricalMatch => {
  const innings1 = matches.filter((m) => m.innings === 1)
  const innings2 = matches.filter((m) => m.innings === 2)

  // Calculate runs and wickets for each innings
  const calculateInningsStats = (inningsMatches: CricsheetMatch[]) => {
    let runs = 0
    let wickets = 0

    for (const match of inningsMatches) {
      runs += match.runs_off_bat + match.extras
      if (match.wicket_type) wickets++
    }

    return { runs, wickets }
  }

  const team1 = innings1[0]?.batting_team || ""
  const team2 = innings2[0]?.batting_team || ""

  const team1Stats = calculateInningsStats(innings1)
  const team2Stats = calculateInningsStats(innings2)

  const result: HistoricalMatch = {
    matchId: info.match_id,
    season: info.season,
    matchDate: new Date(info.date),
    venue: info.venue,
    team1,
    team2,
    winner: info.winner || "",
    team1Runs: team1Stats.runs,
    team1Wickets: team1Stats.wickets,
    team2Runs: team2Stats.runs,
    team2Wickets: team2Stats.wickets,
  }

  if (info.toss_winner) result.tossWinner = info.toss_winner
  if (info.toss_decision) result.tossDecision = info.toss_decision

  return result
}

/**
 * Load all Cricsheet data from directory
 */
export const loadCricsheetData = (dataDir: string): HistoricalMatch[] => {
  const files = readdirSync(dataDir)
  const infoFiles = files.filter((f) => f.endsWith("_info.csv"))

  const matches: HistoricalMatch[] = []

  for (const infoFile of infoFiles) {
    const matchId = infoFile.replace("_info.csv", "")
    const dataFile = `${matchId}.csv`

    try {
      const infoPath = join(dataDir, infoFile)
      const dataPath = join(dataDir, dataFile)

      const info = parseCricsheetInfo(infoPath, matchId)
      const ballData = parseCricsheetMatches(dataPath, matchId)

      const aggregated = aggregateMatchData(ballData, info)
      matches.push(aggregated)
    } catch (error) {
      console.error(`Failed to load match ${matchId}:`, error)
    }
  }

  // Sort by date
  matches.sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())

  return matches
}

/**
 * Get unique teams from matches
 */
export const getUniqueTeams = (matches: HistoricalMatch[]): string[] => {
  const teams = new Set<string>()

  for (const match of matches) {
    teams.add(match.team1)
    teams.add(match.team2)
  }

  return Array.from(teams).sort()
}
