import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import { normalizeVenueName } from "../model-data/aliases.js"

type MatchRow = {
  match_id: string
  season: string
  venue: string
  winner: string
  result_type: string
  method: string
  superover_winner: string
}

type InningsRow = {
  match_id: string
  innings: string
  venue: string
  batting_team: string
  total_runs: string
}

export type VenueContextStats = {
  venue: string
  matchCount: number
  seasons: { first: number | null; last: number | null }
  avgFirstInningsScore: number | null
  avgSecondInningsScore: number | null
  avgFirstInningsWinningScore: number | null
  avgChaseWinningScore: number | null
  battingFirstWins: number
  chasingWins: number
  battingFirstWinPct: number | null
  chasingWinPct: number | null
}

let cachedStats: Map<string, VenueContextStats> | null = null

const MIN_VENUE_CONTEXT_SEASON = 2018

export const getVenueContextStats = (venueName: string | null) => {
  if (!venueName) {
    return null
  }

  const stats = loadVenueStatsSafe()
  return stats.get(normalizeVenueName(venueName)) ?? null
}

const loadVenueStatsSafe = () => {
  try {
    return loadVenueStats()
  } catch {
    cachedStats = new Map()
    return cachedStats
  }
}

const loadVenueStats = () => {
  if (cachedStats) {
    return cachedStats
  }

  const stagedDir = join(process.cwd(), "model", "data", "staged")
  const matches = readCsv<MatchRow>(join(stagedDir, "matches.csv"))
  const innings = readCsv<InningsRow>(join(stagedDir, "innings.csv"))
  const inningsByMatch = new Map<string, InningsRow[]>()

  for (const row of innings) {
    const rows = inningsByMatch.get(row.match_id) ?? []
    rows.push(row)
    inningsByMatch.set(row.match_id, rows)
  }

  const grouped = new Map<string, Array<{
    season: number
    firstRuns: number
    secondRuns: number
    firstTeam: string
    secondTeam: string
    winner: string
  }>>()

  for (const match of matches) {
    const matchInnings = (inningsByMatch.get(match.match_id) ?? [])
      .sort((left, right) => Number(left.innings) - Number(right.innings))

    if (!isEligibleVenueContextMatch(match, matchInnings)) {
      continue
    }

    const first = matchInnings[0]
    const second = matchInnings[1]

    if (!first || !second) {
      continue
    }

    const venue = normalizeVenueName(match.venue || first.venue)
    const rows = grouped.get(venue) ?? []
    rows.push({
      season: Number(match.season),
      firstRuns: parseInteger(first.total_runs),
      secondRuns: parseInteger(second.total_runs),
      firstTeam: first.batting_team,
      secondTeam: second.batting_team,
      winner: match.winner,
    })
    grouped.set(venue, rows)
  }

  cachedStats = new Map(
    Array.from(grouped.entries()).map(([venue, rows]) => [venue, summarizeVenue(venue, rows)]),
  )
  return cachedStats
}

const isEligibleVenueContextMatch = (match: MatchRow, innings: InningsRow[]) => {
  const season = Number(match.season)
  return (
    Number.isFinite(season) &&
    season >= MIN_VENUE_CONTEXT_SEASON &&
    match.result_type !== "tie" &&
    match.result_type !== "no result" &&
    match.winner !== "Unknown" &&
    isBlankCsvValue(match.method) &&
    isBlankCsvValue(match.superover_winner) &&
    innings.length === 2
  )
}

const isBlankCsvValue = (value: string | undefined) => {
  const cleaned = value?.trim().toLowerCase() ?? ""
  return cleaned === "" || cleaned === "na" || cleaned === "unknown"
}

const summarizeVenue = (
  venue: string,
  rows: Array<{
    season: number
    firstRuns: number
    secondRuns: number
    firstTeam: string
    secondTeam: string
    winner: string
  }>,
): VenueContextStats => {
  const firstWins = rows.filter((row) => row.winner === row.firstTeam)
  const chaseWins = rows.filter((row) => row.winner === row.secondTeam)
  const seasons = rows.map((row) => row.season).filter(Number.isFinite)

  return {
    venue,
    matchCount: rows.length,
    seasons: {
      first: seasons.length ? Math.min(...seasons) : null,
      last: seasons.length ? Math.max(...seasons) : null,
    },
    avgFirstInningsScore: average(rows.map((row) => row.firstRuns)),
    avgSecondInningsScore: average(rows.map((row) => row.secondRuns)),
    avgFirstInningsWinningScore: average(firstWins.map((row) => row.firstRuns)),
    avgChaseWinningScore: average(chaseWins.map((row) => row.secondRuns)),
    battingFirstWins: firstWins.length,
    chasingWins: chaseWins.length,
    battingFirstWinPct: rows.length ? firstWins.length / rows.length : null,
    chasingWinPct: rows.length ? chaseWins.length / rows.length : null,
  }
}

const readCsv = <T extends Record<string, string>>(filePath: string) =>
  parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as T[]

const parseInteger = (value: string) => Number.parseInt(value.trim(), 10) || 0

const average = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null
