import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import { normalizeTeamName, normalizeVenueName } from "./aliases.js"
import { resolveTeamVenueContext } from "./venue-mapping.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

type MatchSeed = {
  matchId: string
  season: number
  matchDate: string
  venue: string
  city: string
  team1: string
  team2: string
  winner: string
  resultType: string
  method: string
  superoverWinner: string
  winnerRuns: number
  winnerWickets: number
  ballsRemainingInChase: number
}

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const stagedDir = join(modelDataDir, "staged")
const rawDir = join(modelDataDir, "raw")
const liveDir = join(modelDataDir, "live")

const completedResults2026Path = join(liveDir, "completed_results_2026.csv")
const currentEloPath = join(liveDir, "current_team_elo_ratings.csv")
const upcomingEloPath = join(liveDir, "upcoming_fixture_elo_context.csv")
const summaryPath = join(liveDir, "current_elo_summary.json")

const supplemental2026Results = `match_id,season,match_date,venue,city,team1,team2,winner,result_type,method,superover_winner,winner_runs,winner_wickets,balls_remaining_in_chase,source
1529266,2026,2026-04-15,M Chinnaswamy Stadium,Bengaluru,Royal Challengers Bengaluru,Lucknow Super Giants,Royal Challengers Bengaluru,won,,,0,5,29,espncricinfo
1529267,2026,2026-04-16,Wankhede Stadium,Mumbai,Punjab Kings,Mumbai Indians,Punjab Kings,won,,,0,7,21,espncricinfo
1529268,2026,2026-04-17,Narendra Modi Stadium,Ahmedabad,Gujarat Titans,Kolkata Knight Riders,Gujarat Titans,won,,,0,5,2,espncricinfo
`

const clean = (value: string | undefined) => value?.trim() ?? ""
const parseInteger = (value: string | undefined) => Number.parseInt(clean(value), 10) || 0
const hasMeaningfulValue = (value: string) => value.length > 0 && value !== "NA"

const readCsv = (filePath: string) =>
  parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>

const csvEscape = (value: CsvScalar): string => {
  if (value === null || value === undefined) {
    return ""
  }

  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

const writeCsv = (filePath: string, headers: string[], rows: CsvRow[]) => {
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","))
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8")
}

const ensureCompletedResultsSeed = () => {
  mkdirSync(liveDir, { recursive: true })
  if (!readFileSafe(completedResults2026Path)) {
    writeFileSync(completedResults2026Path, supplemental2026Results, "utf-8")
  }
}

const readFileSafe = (filePath: string) => {
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

const isEligibleForElo = (match: MatchSeed) => {
  const team1Context = resolveTeamVenueContext(match.team1, match.venue, match.season)
  const team2Context = resolveTeamVenueContext(match.team2, match.venue, match.season)

  if (match.resultType === "no result" || match.resultType === "tie") return false
  if (hasMeaningfulValue(clean(match.method))) return false
  if (hasMeaningfulValue(clean(match.superoverWinner))) return false
  if (team1Context === "neutral" || team2Context === "neutral") return false
  if (team1Context === "unknown" || team2Context === "unknown") return false

  return true
}

const loadHistoricalMatches = () => {
  const stagedMatches = readCsv(join(stagedDir, "matches.csv"))
  const rawInfoByMatch = new Map(
    readCsv(join(rawDir, "cricsheet_match_info.csv")).map((row) => [clean(row.match_id), row]),
  )

  return stagedMatches.map<MatchSeed>((row) => {
    const rawInfo = rawInfoByMatch.get(clean(row.match_id))
    return {
      matchId: clean(row.match_id),
      season: parseInteger(row.season),
      matchDate: clean(row.match_date),
      venue: normalizeVenueName(clean(row.venue)),
      city: clean(row.city),
      team1: normalizeTeamName(clean(row.team1)),
      team2: normalizeTeamName(clean(row.team2)),
      winner: normalizeTeamName(clean(row.winner)),
      resultType: clean(row.result_type),
      method: clean(row.method),
      superoverWinner: clean(row.superover_winner),
      winnerRuns: parseInteger(rawInfo?.winner_runs),
      winnerWickets: parseInteger(rawInfo?.winner_wickets),
      ballsRemainingInChase: 0,
    }
  })
}

const loadSupplemental2026Matches = () =>
  readCsv(completedResults2026Path).map<MatchSeed>((row) => ({
    matchId: clean(row.match_id),
    season: parseInteger(row.season),
    matchDate: clean(row.match_date),
    venue: normalizeVenueName(clean(row.venue)),
    city: clean(row.city),
    team1: normalizeTeamName(clean(row.team1)),
    team2: normalizeTeamName(clean(row.team2)),
    winner: normalizeTeamName(clean(row.winner)),
    resultType: clean(row.result_type),
    method: clean(row.method),
    superoverWinner: clean(row.superover_winner),
    winnerRuns: parseInteger(row.winner_runs),
    winnerWickets: parseInteger(row.winner_wickets),
    ballsRemainingInChase: parseInteger(row.balls_remaining_in_chase),
  }))

const loadCricsheetCurrentSeasonMatches = () =>
  readCsv(join(rawDir, "cricsheet_match_info.csv"))
    .filter((row) => parseInteger(row.season) === 2026)
    .map<MatchSeed>((row) => ({
      matchId: clean(row.match_id),
      season: parseInteger(row.season),
      matchDate: clean(row.match_date),
      venue: normalizeVenueName(clean(row.venue)),
      city: clean(row.city),
      team1: normalizeTeamName(clean(row.team1)),
      team2: normalizeTeamName(clean(row.team2)),
      winner: normalizeTeamName(clean(row.winner)),
      resultType: clean(row.winner) ? "won" : "no result",
      method: "",
      superoverWinner: "",
      winnerRuns: parseInteger(row.winner_runs),
      winnerWickets: parseInteger(row.winner_wickets),
      ballsRemainingInChase: 0,
    }))

const loadUpcomingFixtures = () =>
  readCsv(join(liveDir, "upcoming_fixtures.csv")).map((row) => ({
    fixtureId: clean(row.fixture_id),
    matchDate: clean(row.match_date),
    venue: normalizeVenueName(clean(row.venue)),
    city: clean(row.city),
    team1: normalizeTeamName(clean(row.team1)),
    team2: normalizeTeamName(clean(row.team2)),
  }))

const main = () => {
  ensureCompletedResultsSeed()

  const historicalMatches = loadHistoricalMatches().filter((match) => match.season <= 2025)
  const currentSeasonMatchesBase = loadCricsheetCurrentSeasonMatches()
  const currentSeasonOverrides = loadSupplemental2026Matches()
  const currentSeasonMatches = Array.from(
    new Map(
      [...currentSeasonMatchesBase, ...currentSeasonOverrides].map((match) => [match.matchId, match]),
    ).values(),
  )
  const allMatches = [...historicalMatches, ...currentSeasonMatches].sort((left, right) => {
    const dateCompare = left.matchDate.localeCompare(right.matchDate)
    if (dateCompare !== 0) return dateCompare
    return left.matchId.localeCompare(right.matchId)
  })

  const eloRatings = new Map<string, number>()
  let processedMatches = 0

  for (const match of allMatches) {
    if (!isEligibleForElo(match)) {
      continue
    }

    const team1Elo = eloRatings.get(match.team1) ?? 1500
    const team2Elo = eloRatings.get(match.team2) ?? 1500
    const eloExpectedTeam1Win = 1 / (1 + 10 ** ((team2Elo - team1Elo) / 400))
    const eloExpectedTeam2Win = 1 - eloExpectedTeam1Win
    const scoreTeam1 = match.winner === match.team1 ? 1 : 0
    const scoreTeam2 = match.winner === match.team2 ? 1 : 0
    const marginMultiplier = match.winnerRuns > 0
      ? Math.log1p(Math.max(1, match.winnerRuns))
      : Math.log1p(Math.max(1, match.winnerWickets + match.ballsRemainingInChase / 12))
    const kFactor = 20

    eloRatings.set(match.team1, team1Elo + kFactor * marginMultiplier * (scoreTeam1 - eloExpectedTeam1Win))
    eloRatings.set(match.team2, team2Elo + kFactor * marginMultiplier * (scoreTeam2 - eloExpectedTeam2Win))
    processedMatches += 1
  }

  const currentRows = Array.from(eloRatings.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([team, rating]) => ({
      team,
      elo_rating: Number(rating.toFixed(4)),
    }))

  const upcomingRows = loadUpcomingFixtures().map((fixture) => {
    const team1Elo = eloRatings.get(fixture.team1) ?? 1500
    const team2Elo = eloRatings.get(fixture.team2) ?? 1500
    const eloExpectedTeam1Win = 1 / (1 + 10 ** ((team2Elo - team1Elo) / 400))

    return {
      fixture_id: fixture.fixtureId,
      match_date: fixture.matchDate,
      venue: fixture.venue,
      city: fixture.city,
      team1: fixture.team1,
      team2: fixture.team2,
      team1_elo: Number(team1Elo.toFixed(4)),
      team2_elo: Number(team2Elo.toFixed(4)),
      elo_gap: Number((team1Elo - team2Elo).toFixed(4)),
      elo_expected_team1_win: Number(eloExpectedTeam1Win.toFixed(6)),
      elo_expected_team2_win: Number((1 - eloExpectedTeam1Win).toFixed(6)),
    }
  })

  writeCsv(currentEloPath, ["team", "elo_rating"], currentRows)
  writeCsv(
    upcomingEloPath,
    [
      "fixture_id",
      "match_date",
      "venue",
      "city",
      "team1",
      "team2",
      "team1_elo",
      "team2_elo",
      "elo_gap",
      "elo_expected_team1_win",
      "elo_expected_team2_win",
    ],
    upcomingRows,
  )

  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        historicalMatchesConsidered: historicalMatches.length,
        currentSeasonMatchesConsidered: currentSeasonMatches.length,
        processedEligibleMatches: processedMatches,
        latestMatchDate: allMatches[allMatches.length - 1]?.matchDate ?? null,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  console.log("Refreshed current Elo context:")
  console.log(`- eligible matches processed: ${processedMatches}`)
  console.log(`- team ratings: ${currentRows.length}`)
  console.log(`- upcoming fixtures enriched: ${upcomingRows.length}`)
}

main()
