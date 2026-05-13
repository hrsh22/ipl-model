import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import {
  getAliasMetadata,
  normalizeCityName,
  normalizeTeamName,
  normalizeVenueName,
} from "./aliases.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

interface MatchAccumulator {
  matchId: string
  season: number
  matchDate: string
  matchType: string
  eventName: string
  venueRaw: string
  venue: string
  cityRaw: string
  city: string
  tossWinnerRaw: string
  tossWinner: string
  tossDecision: string
  winnerRaw: string
  winner: string
  resultMargin: string
  resultType: string
  method: string
  stage: string
  playerOfMatch: string
  superoverWinnerRaw: string
  superoverWinner: string
  firstInningsTeamRaw: string
  firstInningsTeam: string
  secondInningsTeamRaw: string
  secondInningsTeam: string
  firstInningsBowlingTeamRaw: string
  firstInningsBowlingTeam: string
}

interface InningsAccumulator {
  matchId: string
  season: number
  matchDate: string
  venueRaw: string
  venue: string
  cityRaw: string
  city: string
  innings: number
  battingTeamRaw: string
  battingTeam: string
  bowlingTeamRaw: string
  bowlingTeam: string
  totalRuns: number
  batterRuns: number
  extras: number
  wicketsLost: number
  validBalls: number
  boundaryRuns: number
  fours: number
  sixes: number
  dotBalls: number
  wides: number
  noBalls: number
  byes: number
  legByes: number
  powerplayRuns: number
  powerplayWickets: number
  powerplayValidBalls: number
  powerplayBoundaryRuns: number
  powerplayFours: number
  powerplaySixes: number
  powerplayDotBalls: number
  middleRuns: number
  middleWickets: number
  middleValidBalls: number
  middleBoundaryRuns: number
  middleFours: number
  middleSixes: number
  middleDotBalls: number
  deathRuns: number
  deathWickets: number
  deathValidBalls: number
  deathBoundaryRuns: number
  deathFours: number
  deathSixes: number
  deathDotBalls: number
}

interface PlayerMatchAccumulator {
  matchId: string
  season: number
  matchDate: string
  teamRaw: string
  team: string
  playerName: string
  battingPosition: number
  battingRuns: number
  battingBalls: number
  fours: number
  sixes: number
  dismissed: number
  bowlingBalls: number
  deathBowlingBalls: number
  runsConceded: number
  wickets: number
  dotBallsBowled: number
}

interface CricsheetMatchInfoRow {
  matchId: string
  season: number
  matchDate: string
  eventName: string
  matchNumber: string
  venueRaw: string
  venue: string
  cityRaw: string
  city: string
  team1Raw: string
  team1: string
  team2Raw: string
  team2: string
  tossWinnerRaw: string
  tossWinner: string
  tossDecision: string
  winnerRaw: string
  winner: string
  winnerRuns: number
  winnerWickets: number
  playerOfMatch: string
}

interface CricsheetSquadRow {
  matchId: string
  season: number
  matchDate: string
  teamRaw: string
  team: string
  playerName: string
}

interface CricsheetRegistryRow {
  personName: string
  personId: string
}

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const stagedDir = join(modelDataDir, "staged")
const rawDir = join(modelDataDir, "raw")
const metadataDir = join(modelDataDir, "metadata")

const kaggleCsvPath = join(modelDataDir, "IPL.csv")
const cricsheetSourceDir = join(rootDir, "data", "cricsheet")

const clean = (value: string | undefined) => value?.trim().replace(/\s+/g, " ") ?? ""

const parseInteger = (value: string | undefined): number => {
  const parsed = Number.parseInt(clean(value), 10)

  return Number.isFinite(parsed) ? parsed : 0
}

const parseBooleanish = (value: string | undefined): boolean => {
  const cleaned = clean(value).toLowerCase()

  return cleaned === "1" || cleaned === "true" || cleaned === "yes"
}

const normalizeSeason = (value: string | undefined): number => {
  const cleaned = clean(value)

  if (/^\d{4}$/.test(cleaned)) {
    return parseInteger(cleaned)
  }

  const splitSeason = cleaned.match(/^(\d{4})\/(\d{2}|\d{4})$/)
  if (splitSeason) {
    const startYear = parseInteger(splitSeason[1])
    const endPart = splitSeason[2] ?? ""

    if (endPart.length === 4) {
      return parseInteger(endPart)
    }

    const century = Math.floor(startYear / 100) * 100
    return century + parseInteger(endPart)
  }

  return parseInteger(cleaned)
}

const normalizeDate = (value: string | undefined): string => {
  const cleaned = clean(value)

  if (cleaned.length === 0) {
    return ""
  }

  return cleaned.replace(/\//g, "-")
}

const csvEscape = (value: CsvScalar): string => {
  if (value === null || value === undefined) {
    return ""
  }

  const stringValue = typeof value === "boolean" ? String(value) : String(value)
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

const getPhaseFromOver = (overValue: string | undefined): "powerplay" | "middle" | "death" => {
  const over = Number.parseFloat(clean(overValue))

  if (!Number.isFinite(over) || over < 6) {
    return "powerplay"
  }

  if (over < 15) {
    return "middle"
  }

  return "death"
}

const addPhaseMetrics = (innings: InningsAccumulator, phase: "powerplay" | "middle" | "death", runs: number, wicket: number, validBall: boolean) => {
  if (phase === "powerplay") {
    innings.powerplayRuns += runs
    innings.powerplayWickets += wicket
    if (validBall) {
      innings.powerplayValidBalls += 1
    }
    return
  }

  if (phase === "middle") {
    innings.middleRuns += runs
    innings.middleWickets += wicket
    if (validBall) {
      innings.middleValidBalls += 1
    }
    return
  }

  innings.deathRuns += runs
  innings.deathWickets += wicket
  if (validBall) {
    innings.deathValidBalls += 1
  }
}

const addPhaseTextureMetrics = (
  innings: InningsAccumulator,
  phase: "powerplay" | "middle" | "death",
  batterRuns: number,
  runsTotal: number,
  validBall: boolean,
) => {
  const boundaryRuns = batterRuns === 4 || batterRuns === 6 ? batterRuns : 0
  const fours = batterRuns === 4 ? 1 : 0
  const sixes = batterRuns === 6 ? 1 : 0
  const dotBall = validBall && runsTotal === 0 ? 1 : 0

  if (phase === "powerplay") {
    innings.powerplayBoundaryRuns += boundaryRuns
    innings.powerplayFours += fours
    innings.powerplaySixes += sixes
    innings.powerplayDotBalls += dotBall
    return
  }

  if (phase === "middle") {
    innings.middleBoundaryRuns += boundaryRuns
    innings.middleFours += fours
    innings.middleSixes += sixes
    innings.middleDotBalls += dotBall
    return
  }

  innings.deathBoundaryRuns += boundaryRuns
  innings.deathFours += fours
  innings.deathSixes += sixes
  innings.deathDotBalls += dotBall
}

const sortRows = <T extends Record<string, CsvScalar>>(rows: T[], primaryKey: keyof T, secondaryKey: keyof T) =>
  rows.sort((left, right) => {
    const primaryCompare = String(left[primaryKey] ?? "").localeCompare(String(right[primaryKey] ?? ""))
    if (primaryCompare !== 0) {
      return primaryCompare
    }

    return String(left[secondaryKey] ?? "").localeCompare(String(right[secondaryKey] ?? ""))
  })

const buildHistoricalTables = () => {
  const kaggleContent = readFileSync(kaggleCsvPath, "utf-8")
  const records = parse(kaggleContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>

  const matches = new Map<string, MatchAccumulator>()
  const inningsMap = new Map<string, InningsAccumulator>()
  const playerMatchMap = new Map<string, PlayerMatchAccumulator>()

  for (const record of records) {
    const matchId = clean(record.match_id)
    if (!matchId) {
      continue
    }

    const matchDate = normalizeDate(record.date)
    const season = normalizeSeason(record.season)
    const venueRaw = clean(record.venue)
    const cityRaw = clean(record.city)
    const venue = normalizeVenueName(venueRaw)
    const city = normalizeCityName(cityRaw)
    const tossWinnerRaw = clean(record.toss_winner)
    const winnerRaw = clean(record.match_won_by)
    const superoverWinnerRaw = clean(record.superover_winner)

    let match = matches.get(matchId)
    if (!match) {
      match = {
        matchId,
        season,
        matchDate,
        matchType: clean(record.match_type),
        eventName: clean(record.event_name),
        venueRaw,
        venue,
        cityRaw,
        city,
        tossWinnerRaw,
        tossWinner: normalizeTeamName(tossWinnerRaw),
        tossDecision: clean(record.toss_decision).toLowerCase(),
        winnerRaw,
        winner: normalizeTeamName(winnerRaw),
        resultMargin: clean(record.win_outcome),
        resultType: clean(record.result_type),
        method: clean(record.method),
        stage: clean(record.stage),
        playerOfMatch: clean(record.player_of_match),
        superoverWinnerRaw,
        superoverWinner: normalizeTeamName(superoverWinnerRaw),
        firstInningsTeamRaw: "",
        firstInningsTeam: "",
        secondInningsTeamRaw: "",
        secondInningsTeam: "",
        firstInningsBowlingTeamRaw: "",
        firstInningsBowlingTeam: "",
      }
      matches.set(matchId, match)
    }

    const inningsNumber = parseInteger(record.innings)
    const battingTeamRaw = clean(record.batting_team)
    const bowlingTeamRaw = clean(record.bowling_team)
    const battingTeam = normalizeTeamName(battingTeamRaw)
    const bowlingTeam = normalizeTeamName(bowlingTeamRaw)

    if (inningsNumber === 1 && !match.firstInningsTeamRaw) {
      match.firstInningsTeamRaw = battingTeamRaw
      match.firstInningsTeam = battingTeam
      match.firstInningsBowlingTeamRaw = bowlingTeamRaw
      match.firstInningsBowlingTeam = bowlingTeam
    }

    if (inningsNumber === 2 && !match.secondInningsTeamRaw) {
      match.secondInningsTeamRaw = battingTeamRaw
      match.secondInningsTeam = battingTeam
    }

    const inningsKey = `${matchId}:${inningsNumber}:${battingTeamRaw}`
    let innings = inningsMap.get(inningsKey)
    if (!innings) {
      innings = {
        matchId,
        season,
        matchDate,
        venueRaw,
        venue,
        cityRaw,
        city,
        innings: inningsNumber,
        battingTeamRaw,
        battingTeam,
        bowlingTeamRaw,
        bowlingTeam,
        totalRuns: 0,
        batterRuns: 0,
        extras: 0,
        wicketsLost: 0,
        validBalls: 0,
        boundaryRuns: 0,
        fours: 0,
        sixes: 0,
        dotBalls: 0,
        wides: 0,
        noBalls: 0,
        byes: 0,
        legByes: 0,
         powerplayRuns: 0,
         powerplayWickets: 0,
         powerplayValidBalls: 0,
         powerplayBoundaryRuns: 0,
         powerplayFours: 0,
         powerplaySixes: 0,
         powerplayDotBalls: 0,
         middleRuns: 0,
         middleWickets: 0,
         middleValidBalls: 0,
         middleBoundaryRuns: 0,
         middleFours: 0,
         middleSixes: 0,
         middleDotBalls: 0,
         deathRuns: 0,
         deathWickets: 0,
         deathValidBalls: 0,
         deathBoundaryRuns: 0,
         deathFours: 0,
         deathSixes: 0,
         deathDotBalls: 0,
       }
      inningsMap.set(inningsKey, innings)
    }

    const batterRuns = parseInteger(record.runs_batter)
    const runsTotal = parseInteger(record.runs_total)
    const extras = parseInteger(record.runs_extras)
    const validBall = parseBooleanish(record.valid_ball)
    const wicket = clean(record.player_out) ? 1 : 0
    const phase = getPhaseFromOver(record.over)

    innings.totalRuns += runsTotal
    innings.batterRuns += batterRuns
    innings.extras += extras
    innings.wicketsLost += wicket
    innings.boundaryRuns += batterRuns === 4 || batterRuns === 6 ? batterRuns : 0
    innings.fours += batterRuns === 4 ? 1 : 0
    innings.sixes += batterRuns === 6 ? 1 : 0
    innings.dotBalls += validBall && runsTotal === 0 ? 1 : 0
    innings.wides += clean(record.extra_type) === "wides" ? extras : 0
    innings.noBalls += clean(record.extra_type) === "noballs" ? extras : 0
    innings.byes += clean(record.extra_type) === "byes" ? extras : 0
    innings.legByes += clean(record.extra_type) === "legbyes" ? extras : 0
    if (validBall) {
      innings.validBalls += 1
    }

    addPhaseMetrics(innings, phase, runsTotal, wicket, validBall)
    addPhaseTextureMetrics(innings, phase, batterRuns, runsTotal, validBall)

    const batterName = clean(record.batter)
    if (batterName) {
      const batterKey = `${matchId}:${battingTeam}:${batterName}`
      let playerMatch = playerMatchMap.get(batterKey)
      if (!playerMatch) {
        playerMatch = {
          matchId,
          season,
          matchDate,
          teamRaw: battingTeamRaw,
          team: battingTeam,
          playerName: batterName,
          battingPosition: 0,
          battingRuns: 0,
          battingBalls: 0,
          fours: 0,
          sixes: 0,
          dismissed: 0,
          bowlingBalls: 0,
          deathBowlingBalls: 0,
          runsConceded: 0,
          wickets: 0,
          dotBallsBowled: 0,
        }
        playerMatchMap.set(batterKey, playerMatch)
      }

      playerMatch.battingRuns += batterRuns
      playerMatch.battingBalls += parseInteger(record.balls_faced)
      const battingPosition = parseInteger(record.bat_pos)
      if (battingPosition > 0 && (playerMatch.battingPosition === 0 || battingPosition < playerMatch.battingPosition)) {
        playerMatch.battingPosition = battingPosition
      }
      playerMatch.fours += batterRuns === 4 ? 1 : 0
      playerMatch.sixes += batterRuns === 6 ? 1 : 0
      playerMatch.dismissed += clean(record.player_out) === batterName ? 1 : 0
    }

    const bowlerName = clean(record.bowler)
    if (bowlerName) {
      const bowlerKey = `${matchId}:${bowlingTeam}:${bowlerName}`
      let playerMatch = playerMatchMap.get(bowlerKey)
      if (!playerMatch) {
        playerMatch = {
          matchId,
          season,
          matchDate,
          teamRaw: bowlingTeamRaw,
          team: bowlingTeam,
          playerName: bowlerName,
          battingPosition: 0,
          battingRuns: 0,
          battingBalls: 0,
          fours: 0,
          sixes: 0,
          dismissed: 0,
          bowlingBalls: 0,
          deathBowlingBalls: 0,
          runsConceded: 0,
          wickets: 0,
          dotBallsBowled: 0,
        }
        playerMatchMap.set(bowlerKey, playerMatch)
      }

      playerMatch.bowlingBalls += validBall ? 1 : 0
      playerMatch.deathBowlingBalls += validBall && phase === "death" ? 1 : 0
      playerMatch.runsConceded += parseInteger(record.runs_bowler)
      playerMatch.wickets += parseInteger(record.bowler_wicket)
      playerMatch.dotBallsBowled += validBall && runsTotal === 0 ? 1 : 0
    }
  }

  const matchRows = Array.from(matches.values()).map((match) => ({
    match_id: match.matchId,
    season: match.season,
    match_date: match.matchDate,
    match_type: match.matchType,
    event_name: match.eventName,
    stage: match.stage,
    venue_raw: match.venueRaw,
    venue: match.venue,
    city_raw: match.cityRaw,
    city: match.city,
    team1_raw: match.firstInningsTeamRaw,
    team1: match.firstInningsTeam,
    team2_raw: match.firstInningsBowlingTeamRaw || match.secondInningsTeamRaw,
    team2: match.firstInningsBowlingTeam || match.secondInningsTeam,
    toss_winner_raw: match.tossWinnerRaw,
    toss_winner: match.tossWinner,
    toss_decision: match.tossDecision,
    winner_raw: match.winnerRaw,
    winner: match.winner,
    result_margin: match.resultMargin,
    result_type: match.resultType,
    method: match.method,
    player_of_match: match.playerOfMatch,
    superover_winner_raw: match.superoverWinnerRaw,
    superover_winner: match.superoverWinner,
  }))

  const inningsRows = Array.from(inningsMap.values()).map((innings) => ({
    match_id: innings.matchId,
    season: innings.season,
    match_date: innings.matchDate,
    innings: innings.innings,
    venue_raw: innings.venueRaw,
    venue: innings.venue,
    city_raw: innings.cityRaw,
    city: innings.city,
    batting_team_raw: innings.battingTeamRaw,
    batting_team: innings.battingTeam,
    bowling_team_raw: innings.bowlingTeamRaw,
    bowling_team: innings.bowlingTeam,
    total_runs: innings.totalRuns,
    batter_runs: innings.batterRuns,
    extras: innings.extras,
    wickets_lost: innings.wicketsLost,
    valid_balls: innings.validBalls,
    overs_batted: Number((innings.validBalls / 6).toFixed(2)),
    boundary_runs: innings.boundaryRuns,
    fours: innings.fours,
    sixes: innings.sixes,
    dot_balls: innings.dotBalls,
    wide_runs: innings.wides,
    no_ball_runs: innings.noBalls,
    byes: innings.byes,
    leg_byes: innings.legByes,
    powerplay_runs: innings.powerplayRuns,
    powerplay_wickets: innings.powerplayWickets,
    powerplay_valid_balls: innings.powerplayValidBalls,
    powerplay_boundary_runs: innings.powerplayBoundaryRuns,
    powerplay_fours: innings.powerplayFours,
    powerplay_sixes: innings.powerplaySixes,
    powerplay_dot_balls: innings.powerplayDotBalls,
    middle_runs: innings.middleRuns,
    middle_wickets: innings.middleWickets,
    middle_valid_balls: innings.middleValidBalls,
    middle_boundary_runs: innings.middleBoundaryRuns,
    middle_fours: innings.middleFours,
    middle_sixes: innings.middleSixes,
    middle_dot_balls: innings.middleDotBalls,
    death_runs: innings.deathRuns,
    death_wickets: innings.deathWickets,
    death_valid_balls: innings.deathValidBalls,
    death_boundary_runs: innings.deathBoundaryRuns,
    death_fours: innings.deathFours,
    death_sixes: innings.deathSixes,
    death_dot_balls: innings.deathDotBalls,
  }))

  const inningsByMatch = new Map<string, typeof inningsRows>()
  for (const innings of inningsRows) {
    const existing = inningsByMatch.get(String(innings.match_id))
    if (existing) {
      existing.push(innings)
    } else {
      inningsByMatch.set(String(innings.match_id), [innings])
    }
  }

  const matchesById = new Map(matchRows.map((row) => [String(row.match_id), row]))
  const teamMatchRows: CsvRow[] = []

  for (const [matchId, inningsRowsForMatch] of inningsByMatch.entries()) {
    const match = matchesById.get(matchId)
    if (!match) {
      continue
    }

    const sortedInnings = [...inningsRowsForMatch].sort((left, right) => Number(left.innings) - Number(right.innings))

    for (const innings of sortedInnings) {
      const opponentInnings = sortedInnings.find((candidate) => candidate.innings !== innings.innings)
      const team = String(innings.batting_team)
      const opponent = opponentInnings ? String(opponentInnings.batting_team) : ""
      const winner = String(match.winner)

      teamMatchRows.push({
        match_id: matchId,
        season: match.season,
        match_date: match.match_date,
        venue: match.venue,
        city: match.city,
        team_raw: innings.batting_team_raw,
        team,
        opponent_raw: opponentInnings?.batting_team_raw ?? "",
        opponent,
        innings: innings.innings,
        batting_first: Number(innings.innings) === 1,
        toss_winner: match.toss_winner,
        toss_decision: match.toss_decision,
        winner,
        won_match: winner.length > 0 ? winner === team : "",
        total_runs: innings.total_runs,
        wickets_lost: innings.wickets_lost,
        valid_balls: innings.valid_balls,
        boundary_runs: innings.boundary_runs,
        fours: innings.fours,
        sixes: innings.sixes,
        dot_balls: innings.dot_balls,
        extras: innings.extras,
        wide_runs: innings.wide_runs,
        no_ball_runs: innings.no_ball_runs,
        powerplay_runs: innings.powerplay_runs,
        powerplay_wickets: innings.powerplay_wickets,
        powerplay_valid_balls: innings.powerplay_valid_balls,
        powerplay_dot_balls: innings.powerplay_dot_balls,
        powerplay_boundary_runs: innings.powerplay_boundary_runs,
        powerplay_fours: innings.powerplay_fours,
        powerplay_sixes: innings.powerplay_sixes,
        middle_runs: innings.middle_runs,
        middle_wickets: innings.middle_wickets,
        middle_valid_balls: innings.middle_valid_balls,
        middle_dot_balls: innings.middle_dot_balls,
        middle_boundary_runs: innings.middle_boundary_runs,
        middle_fours: innings.middle_fours,
        middle_sixes: innings.middle_sixes,
        death_runs: innings.death_runs,
        death_wickets: innings.death_wickets,
        death_valid_balls: innings.death_valid_balls,
        death_dot_balls: innings.death_dot_balls,
        death_boundary_runs: innings.death_boundary_runs,
        death_fours: innings.death_fours,
        death_sixes: innings.death_sixes,
        runs_conceded: opponentInnings?.total_runs ?? "",
        wickets_taken: opponentInnings?.wickets_lost ?? "",
        balls_bowled: opponentInnings?.valid_balls ?? "",
        powerplay_runs_conceded: opponentInnings?.powerplay_runs ?? "",
        powerplay_balls_bowled: opponentInnings?.powerplay_valid_balls ?? "",
        powerplay_wickets_taken: opponentInnings?.powerplay_wickets ?? "",
        powerplay_dot_balls_forced: opponentInnings?.powerplay_dot_balls ?? "",
        powerplay_boundary_runs_conceded: opponentInnings?.powerplay_boundary_runs ?? "",
        middle_runs_conceded: opponentInnings?.middle_runs ?? "",
        middle_balls_bowled: opponentInnings?.middle_valid_balls ?? "",
        middle_wickets_taken: opponentInnings?.middle_wickets ?? "",
        middle_dot_balls_forced: opponentInnings?.middle_dot_balls ?? "",
        middle_boundary_runs_conceded: opponentInnings?.middle_boundary_runs ?? "",
        death_runs_conceded: opponentInnings?.death_runs ?? "",
        death_balls_bowled: opponentInnings?.death_valid_balls ?? "",
        death_wickets_taken: opponentInnings?.death_wickets ?? "",
        death_dot_balls_forced: opponentInnings?.death_dot_balls ?? "",
        death_boundary_runs_conceded: opponentInnings?.death_boundary_runs ?? "",
      })
    }
  }

  const playerMatchRows = Array.from(playerMatchMap.values()).map((playerMatch) => ({
    match_id: playerMatch.matchId,
    season: playerMatch.season,
    match_date: playerMatch.matchDate,
    team_raw: playerMatch.teamRaw,
    team: playerMatch.team,
    player_name: playerMatch.playerName,
    batting_position: playerMatch.battingPosition,
    role: playerMatch.battingBalls > 0 && playerMatch.bowlingBalls > 0
      ? "all_rounder"
      : playerMatch.bowlingBalls > 0
        ? "bowler"
        : "batter",
    batting_runs: playerMatch.battingRuns,
    batting_balls: playerMatch.battingBalls,
    fours: playerMatch.fours,
    sixes: playerMatch.sixes,
    dismissed: playerMatch.dismissed,
    bowling_balls: playerMatch.bowlingBalls,
    death_bowling_balls: playerMatch.deathBowlingBalls,
    overs_bowled: Number((playerMatch.bowlingBalls / 6).toFixed(2)),
    runs_conceded: playerMatch.runsConceded,
    wickets: playerMatch.wickets,
    dot_balls_bowled: playerMatch.dotBallsBowled,
  }))

  return {
    recordCount: records.length,
    matchRows: sortRows(matchRows, "match_date", "match_id"),
    inningsRows: sortRows(inningsRows, "match_date", "match_id"),
    teamMatchRows: sortRows(teamMatchRows, "match_date", "match_id"),
    playerMatchRows: sortRows(playerMatchRows, "match_date", "match_id"),
  }
}

const buildCricsheetInfoTables = () => {
  const matchInfoRows: CricsheetMatchInfoRow[] = []
  const rawSquadRows: CricsheetSquadRow[] = []
  const registryMap = new Map<string, CricsheetRegistryRow>()

  const infoFiles = readdirSync(cricsheetSourceDir)
    .filter((fileName) => fileName.endsWith("_info.csv"))
    .sort()

  for (const infoFile of infoFiles) {
    const matchId = infoFile.replace(/_info\.csv$/, "")
    const content = readFileSync(join(cricsheetSourceDir, infoFile), "utf-8")
    const rows = parse(content, {
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][]

    const teams: string[] = []
    const players: Array<{ teamRaw: string; playerName: string }> = []

    let season = 0
    let matchDate = ""
    let eventName = ""
    let matchNumber = ""
    let venueRaw = ""
    let venue = ""
    let cityRaw = ""
    let city = ""
    let tossWinnerRaw = ""
    let tossWinner = ""
    let tossDecision = ""
    let winnerRaw = ""
    let winner = ""
    let winnerRuns = 0
    let winnerWickets = 0
    let playerOfMatch = ""

    for (const row of rows) {
      if (row[0] !== "info" || !row[1]) {
        continue
      }

      const key = clean(row[1])
      const values = row.slice(2).map((value) => clean(value))

      if (key === "team") {
        if (values[0]) {
          teams.push(values[0])
        }
        continue
      }

      if (key === "player") {
        const teamRaw = values[0] ?? ""
        const playerName = values[1] ?? ""
        if (teamRaw && playerName) {
          players.push({ teamRaw, playerName })
        }
        continue
      }

      if (key === "registry" && values[0] === "people") {
        const personName = values[1] ?? ""
        const personId = values[2] ?? ""
        if (personName && personId) {
          registryMap.set(`${personName}:${personId}`, { personName, personId })
        }
        continue
      }

      const value = values[0] ?? ""
      if (key === "season") season = normalizeSeason(value)
      if (key === "date") matchDate = normalizeDate(value)
      if (key === "event") eventName = value
      if (key === "match_number") matchNumber = value
      if (key === "venue") {
        venueRaw = value
        venue = normalizeVenueName(value)
      }
      if (key === "city") {
        cityRaw = value
        city = normalizeCityName(value)
      }
      if (key === "toss_winner") {
        tossWinnerRaw = value
        tossWinner = normalizeTeamName(value)
      }
      if (key === "toss_decision") tossDecision = value.toLowerCase()
      if (key === "winner") {
        winnerRaw = value
        winner = normalizeTeamName(value)
      }
      if (key === "winner_runs") winnerRuns = parseInteger(value)
      if (key === "winner_wickets") winnerWickets = parseInteger(value)
      if (key === "player_of_match") playerOfMatch = value
    }

    matchInfoRows.push({
      matchId,
      season,
      matchDate,
      eventName,
      matchNumber,
      venueRaw,
      venue,
      cityRaw,
      city,
      team1Raw: teams[0] ?? "",
      team1: normalizeTeamName(teams[0] ?? ""),
      team2Raw: teams[1] ?? "",
      team2: normalizeTeamName(teams[1] ?? ""),
      tossWinnerRaw,
      tossWinner,
      tossDecision,
      winnerRaw,
      winner,
      winnerRuns,
      winnerWickets,
      playerOfMatch,
    })

    for (const player of players) {
      rawSquadRows.push({
        matchId,
        season,
        matchDate,
        teamRaw: player.teamRaw,
        team: normalizeTeamName(player.teamRaw),
        playerName: player.playerName,
      })
    }
  }

  const matchInfoById = new Map(matchInfoRows.map((row) => [row.matchId, row]))

  const stagedSquadRows = rawSquadRows.map((row) => ({
    match_id: row.matchId,
    season: row.season,
    match_date: row.matchDate,
    team_raw: row.teamRaw,
    team: row.team,
    player_name: row.playerName,
    venue: matchInfoById.get(row.matchId)?.venue ?? "",
  }))

  const stagedRegistryRows = Array.from(registryMap.values())
    .map((row) => ({
      player_name: row.personName,
      person_id: row.personId,
    }))
    .sort((left, right) => left.player_name.localeCompare(right.player_name))

  return {
    infoFileCount: infoFiles.length,
    matchInfoRows: sortRows(
      matchInfoRows.map((row) => ({
        match_id: row.matchId,
        season: row.season,
        match_date: row.matchDate,
        event_name: row.eventName,
        match_number: row.matchNumber,
        venue_raw: row.venueRaw,
        venue: row.venue,
        city_raw: row.cityRaw,
        city: row.city,
        team1_raw: row.team1Raw,
        team1: row.team1,
        team2_raw: row.team2Raw,
        team2: row.team2,
        toss_winner_raw: row.tossWinnerRaw,
        toss_winner: row.tossWinner,
        toss_decision: row.tossDecision,
        winner_raw: row.winnerRaw,
        winner: row.winner,
        winner_runs: row.winnerRuns,
        winner_wickets: row.winnerWickets,
        player_of_match: row.playerOfMatch,
      })),
      "match_date",
      "match_id",
    ),
    rawSquadRows: sortRows(
      rawSquadRows.map((row) => ({
        match_id: row.matchId,
        season: row.season,
        match_date: row.matchDate,
        team_raw: row.teamRaw,
        team: row.team,
        player_name: row.playerName,
      })),
      "match_date",
      "match_id",
    ),
    stagedSquadRows: sortRows(stagedSquadRows, "match_date", "match_id"),
    stagedRegistryRows,
  }
}

const writeReadme = () => {
  const readme = `# model/data

This directory is the ML data boundary for the IPL prediction system.

## Sources

- \`IPL.csv\` - raw Kaggle ball-by-ball dataset already checked into the repo
- \`../data/cricsheet\` - local Cricsheet archive used to gather squad and registry data into this directory

## Generated structure

- \`staged/matches.csv\` - canonical match-level rows from \`IPL.csv\`
- \`staged/innings.csv\` - innings/team batting summaries with phase splits
- \`staged/team_match_stats.csv\` - one row per team per match with batting and bowling summary stats
- \`staged/player_match_stats.csv\` - player batting and bowling match aggregates
- \`staged/match_squads.csv\` - historical playing XIs from Cricsheet info files
- \`staged/player_registry.csv\` - stable player identifier map from Cricsheet registry lines
- \`raw/cricsheet_match_info.csv\` - raw-ish match metadata extracted from Cricsheet info files
- \`raw/cricsheet_squads.csv\` - raw-ish squad rows extracted from Cricsheet info files
- \`metadata/dataset_summary.json\` - generated row counts and source summary
- \`metadata/aliases.json\` - explicit team, venue, and city normalization rules

## Notes

- Historical market odds are intentionally excluded from this first data-gathering pass.
- Live market data should be treated as inference-time context, not training inputs.
- Post-toss fields should be prepared later on top of these staged historical datasets.
`

  writeFileSync(join(modelDataDir, "README.md"), readme, "utf-8")
}

const main = () => {
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(stagedDir, { recursive: true })
  mkdirSync(metadataDir, { recursive: true })

  const historicalTables = buildHistoricalTables()
  const cricsheetTables = buildCricsheetInfoTables()

  writeCsv(
    join(stagedDir, "matches.csv"),
    [
      "match_id",
      "season",
      "match_date",
      "match_type",
      "event_name",
      "stage",
      "venue_raw",
      "venue",
      "city_raw",
      "city",
      "team1_raw",
      "team1",
      "team2_raw",
      "team2",
      "toss_winner_raw",
      "toss_winner",
      "toss_decision",
      "winner_raw",
      "winner",
      "result_margin",
      "result_type",
      "method",
      "player_of_match",
      "superover_winner_raw",
      "superover_winner",
    ],
    historicalTables.matchRows,
  )

  writeCsv(
    join(stagedDir, "innings.csv"),
    [
      "match_id",
      "season",
      "match_date",
      "innings",
      "venue_raw",
      "venue",
      "city_raw",
      "city",
      "batting_team_raw",
      "batting_team",
      "bowling_team_raw",
      "bowling_team",
      "total_runs",
      "batter_runs",
      "extras",
      "wickets_lost",
      "valid_balls",
      "overs_batted",
      "boundary_runs",
      "fours",
      "sixes",
      "dot_balls",
      "wide_runs",
      "no_ball_runs",
      "byes",
      "leg_byes",
      "powerplay_runs",
      "powerplay_wickets",
      "powerplay_valid_balls",
      "powerplay_boundary_runs",
      "powerplay_fours",
      "powerplay_sixes",
      "powerplay_dot_balls",
      "middle_runs",
      "middle_wickets",
      "middle_valid_balls",
      "middle_boundary_runs",
      "middle_fours",
      "middle_sixes",
      "middle_dot_balls",
      "death_runs",
      "death_wickets",
      "death_valid_balls",
      "death_boundary_runs",
      "death_fours",
      "death_sixes",
      "death_dot_balls",
    ],
    historicalTables.inningsRows,
  )

  writeCsv(
    join(stagedDir, "team_match_stats.csv"),
    [
      "match_id",
      "season",
      "match_date",
      "venue",
      "city",
      "team_raw",
      "team",
      "opponent_raw",
      "opponent",
      "innings",
      "batting_first",
      "toss_winner",
      "toss_decision",
      "winner",
      "won_match",
      "total_runs",
      "wickets_lost",
      "valid_balls",
      "boundary_runs",
      "fours",
      "sixes",
      "dot_balls",
      "extras",
      "wide_runs",
      "no_ball_runs",
      "powerplay_runs",
      "powerplay_wickets",
      "powerplay_valid_balls",
      "powerplay_dot_balls",
      "powerplay_boundary_runs",
      "powerplay_fours",
      "powerplay_sixes",
      "middle_runs",
      "middle_wickets",
      "middle_valid_balls",
      "middle_dot_balls",
      "middle_boundary_runs",
      "middle_fours",
      "middle_sixes",
      "death_runs",
      "death_wickets",
      "death_valid_balls",
      "death_dot_balls",
      "death_boundary_runs",
      "death_fours",
      "death_sixes",
      "runs_conceded",
      "wickets_taken",
      "balls_bowled",
      "powerplay_runs_conceded",
      "powerplay_balls_bowled",
      "powerplay_wickets_taken",
      "powerplay_dot_balls_forced",
      "powerplay_boundary_runs_conceded",
      "middle_runs_conceded",
      "middle_balls_bowled",
      "middle_wickets_taken",
      "middle_dot_balls_forced",
      "middle_boundary_runs_conceded",
      "death_runs_conceded",
      "death_balls_bowled",
      "death_wickets_taken",
      "death_dot_balls_forced",
      "death_boundary_runs_conceded",
    ],
    historicalTables.teamMatchRows,
  )

  writeCsv(
    join(stagedDir, "player_match_stats.csv"),
    [
      "match_id",
      "season",
      "match_date",
      "team_raw",
      "team",
      "player_name",
      "batting_position",
      "role",
      "batting_runs",
      "batting_balls",
      "fours",
      "sixes",
      "dismissed",
      "bowling_balls",
      "death_bowling_balls",
      "overs_bowled",
      "runs_conceded",
      "wickets",
      "dot_balls_bowled",
    ],
    historicalTables.playerMatchRows,
  )

  writeCsv(
    join(rawDir, "cricsheet_match_info.csv"),
    [
      "match_id",
      "season",
      "match_date",
      "event_name",
      "match_number",
      "venue_raw",
      "venue",
      "city_raw",
      "city",
      "team1_raw",
      "team1",
      "team2_raw",
      "team2",
      "toss_winner_raw",
      "toss_winner",
      "toss_decision",
      "winner_raw",
      "winner",
      "winner_runs",
      "winner_wickets",
      "player_of_match",
    ],
    cricsheetTables.matchInfoRows,
  )

  writeCsv(
    join(rawDir, "cricsheet_squads.csv"),
    ["match_id", "season", "match_date", "team_raw", "team", "player_name"],
    cricsheetTables.rawSquadRows,
  )

  writeCsv(
    join(stagedDir, "match_squads.csv"),
    ["match_id", "season", "match_date", "team_raw", "team", "player_name", "venue"],
    cricsheetTables.stagedSquadRows,
  )

  writeCsv(
    join(stagedDir, "player_registry.csv"),
    ["player_name", "person_id"],
    cricsheetTables.stagedRegistryRows,
  )

  writeFileSync(
    join(metadataDir, "aliases.json"),
    `${JSON.stringify(getAliasMetadata(), null, 2)}\n`,
    "utf-8",
  )

  writeFileSync(
    join(metadataDir, "dataset_summary.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: {
          kaggleCsvPath,
          cricsheetSourceDir,
        },
        counts: {
          kaggleBallRows: historicalTables.recordCount,
          stagedMatches: historicalTables.matchRows.length,
          stagedInnings: historicalTables.inningsRows.length,
          stagedTeamMatchStats: historicalTables.teamMatchRows.length,
          stagedPlayerMatchStats: historicalTables.playerMatchRows.length,
          cricsheetInfoFiles: cricsheetTables.infoFileCount,
          cricsheetMatchInfoRows: cricsheetTables.matchInfoRows.length,
          cricsheetRawSquadRows: cricsheetTables.rawSquadRows.length,
          stagedMatchSquads: cricsheetTables.stagedSquadRows.length,
          stagedPlayerRegistry: cricsheetTables.stagedRegistryRows.length,
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  writeReadme()

  console.log("Prepared model/data datasets:")
  console.log(`- matches: ${historicalTables.matchRows.length}`)
  console.log(`- innings: ${historicalTables.inningsRows.length}`)
  console.log(`- team match stats: ${historicalTables.teamMatchRows.length}`)
  console.log(`- player match stats: ${historicalTables.playerMatchRows.length}`)
  console.log(`- match squads: ${cricsheetTables.stagedSquadRows.length}`)
  console.log(`- player registry rows: ${cricsheetTables.stagedRegistryRows.length}`)
}

main()
