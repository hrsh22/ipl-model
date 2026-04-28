import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import { normalizePlayerNameKey } from "./aliases.js"
import { getVenueMappingMetadata, inferHomeTeam, resolveTeamVenueContext, type TeamVenueContext } from "./venue-mapping.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

type MatchRow = {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  city: string
  tossWinner: string
  tossDecision: string
  winner: string
  resultType: string
  method: string
  superoverWinner: string
}

type RawInfoRow = {
  team1: string
  team2: string
  winnerRuns: number
  winnerWickets: number
}

type TeamMatchRow = {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  city: string
  team: string
  opponent: string
  innings: number
  battingFirst: boolean
  tossWinner: string
  tossDecision: string
  winner: string
  wonMatch: boolean
  totalRuns: number
  wicketsLost: number
  validBalls: number
  boundaryRuns: number
  fours: number
  sixes: number
  dotBalls: number
  extras: number
  wideRuns: number
  noBallRuns: number
  powerplayRuns: number
  powerplayWickets: number
  powerplayValidBalls: number
  powerplayDotBalls: number
  powerplayBoundaryRuns: number
  powerplaySixes: number
  middleRuns: number
  middleWickets: number
  middleValidBalls: number
  middleDotBalls: number
  middleBoundaryRuns: number
  deathRuns: number
  deathWickets: number
  deathValidBalls: number
  deathDotBalls: number
  deathBoundaryRuns: number
  deathSixes: number
  runsConceded: number
  wicketsTaken: number
  ballsBowled: number
  powerplayRunsConceded: number
  powerplayBallsBowled: number
  powerplayWicketsTaken: number
  powerplayDotBallsForced: number
  powerplayBoundaryRunsConceded: number
  middleRunsConceded: number
  middleBallsBowled: number
  middleWicketsTaken: number
  middleDotBallsForced: number
  middleBoundaryRunsConceded: number
  deathRunsConceded: number
  deathBallsBowled: number
  deathWicketsTaken: number
  deathDotBallsForced: number
  deathBoundaryRunsConceded: number
}

type TeamHistoryEntry = TeamMatchRow & {
  homeContext: TeamVenueContext
  squadPlayers: Set<string>
}

type PlayerMatchProfile = {
  playerName: string
  playerNameKey: string
  battingPosition: number
  role: string
  battingRuns: number
  battingBalls: number
  dismissed: number
  bowlingBalls: number
  deathBowlingBalls: number
  runsConceded: number
  wickets: number
  dotBallsBowled: number
}

type PlayerStyleProfile = {
  playerName: string
  playerNameKey: string
  personId: string
  bowlingStyleFamily: "spin" | "pace" | "unknown"
  roleCanonical: string
  isBowlingOption: boolean
  isSpinOption: boolean
  isPaceOption: boolean
}

type MatchRecord = {
  matchId: string
  season: number
  matchDate: Date
  venue: string
  city: string
  team1: string
  team2: string
  winner: string
  tossWinner: string
  tossDecision: string
  firstInningsTeam: string
  secondInningsTeam: string
  firstInningsRuns: number
  secondInningsRuns: number
  winnerRuns: number
  winnerWickets: number
  ballsRemainingInChase: number
}

type PlayerAggregate = {
  playerName: string
  appearances: number
  battingPositions: number[]
  battingRuns: number
  battingBalls: number
  dismissals: number
  bowlingBalls: number
  deathBowlingBalls: number
  runsConceded: number
  wickets: number
  dotBallsBowled: number
}

type TeamFeatureSet = {
  overallWinRateBeforeMatch: number
  recentWinRateLast5: number
  recentWinRateLast10: number
  last3YearWinRate: number
  venueWinRate: number
  chasingWinRate: number
  battingFirstWinRate: number
  boundaryPercentage: number
  dotBallPercentage: number
  runsPerWicket: number
  runsConcededPerWicketTaken: number
  avgWicketsLost: number
  powerplayRunRate: number
  powerplayWicketsLost: number
  powerplayEconomy: number
  powerplayWicketsTaken: number
  middleOversRunRate: number
  middleOversBoundaryRate: number
  middleOversDotBallRate: number
  middleOversEconomy: number
  middleOversDotBallRateForced: number
  deathOversRunRate: number
  deathOversSixRate: number
  deathOversWicketsLost: number
  deathOversEconomy: number
  deathOversWicketsTaken: number
  deathOversBoundaryRateConceded: number
  deathBowlingEconomy: number
  powerplayNetRunRate: number
  middleOversNetRunRate: number
  deathOversNetRunRate: number
  probableXiStrength: number
  top3Strength: number
  middleOrderStrength: number
  finisherStrength: number
  powerplayBowlingStrength: number
  deathBowlingStrength: number
  teamSpinStrength: number
  teamPaceStrength: number
  topOrderContinuity: number
  bowlingCoreContinuity: number
  deathBowlerContinuity: number
  overallXiContinuity: number
  xiContinuityScore: number
  missingKeyBatterCount: number
  missingKeyBowlerCount: number
  missingDeathBowlerFlag: number
  missingOpenerFlag: number
  tossWinRate: number
  prefersFieldAfterToss: number
  homeWinRate: number
  awayWinRate: number
  restDays: number
  battingResourceScore: number
  bowlingResourceScore: number
  netResourceScore: number
  teamEloBeforeMatch: number
  eloExpectedWin: number
  historicalMatchesUsed: number
  likelyXiMatchesUsed: number
}

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const stagedDir = join(modelDataDir, "staged")
const rawDir = join(modelDataDir, "raw")
const featuresDir = join(modelDataDir, "features")
const metadataDir = join(modelDataDir, "metadata")

const clean = (value: string | undefined) => value?.trim() ?? ""
const parseInteger = (value: string | undefined) => Number.parseInt(clean(value), 10) || 0
const parseBoolean = (value: string | undefined) => clean(value).toLowerCase() === "true"
const parseDate = (value: string | undefined) => new Date(`${clean(value)}T00:00:00.000Z`)
const safeRate = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0)
const safePerSixBalls = (runs: number, balls: number) => (balls > 0 ? (runs * 6) / balls : 0)
const average = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const sortKey = (date: Date, matchId: string) => `${date.toISOString()}::${matchId}`
const pairKey = (team1: string, team2: string) => [team1, team2].sort().join("::")
const dateOnly = (value: Date) => value.toISOString().slice(0, 10)

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

const teamFeatureKeys = [
  "overallWinRateBeforeMatch",
  "recentWinRateLast5",
  "recentWinRateLast10",
  "last3YearWinRate",
  "venueWinRate",
  "chasingWinRate",
  "battingFirstWinRate",
  "boundaryPercentage",
  "dotBallPercentage",
  "runsPerWicket",
  "runsConcededPerWicketTaken",
  "avgWicketsLost",
  "powerplayRunRate",
  "powerplayWicketsLost",
  "powerplayEconomy",
  "powerplayWicketsTaken",
  "middleOversRunRate",
  "middleOversBoundaryRate",
  "middleOversDotBallRate",
  "middleOversEconomy",
  "middleOversDotBallRateForced",
  "deathOversRunRate",
  "deathOversSixRate",
  "deathOversWicketsLost",
  "deathOversEconomy",
  "deathOversWicketsTaken",
  "deathOversBoundaryRateConceded",
  "deathBowlingEconomy",
  "powerplayNetRunRate",
  "middleOversNetRunRate",
  "deathOversNetRunRate",
  "probableXiStrength",
  "top3Strength",
  "middleOrderStrength",
  "finisherStrength",
  "powerplayBowlingStrength",
  "deathBowlingStrength",
  "teamSpinStrength",
  "teamPaceStrength",
  "topOrderContinuity",
  "bowlingCoreContinuity",
  "deathBowlerContinuity",
  "overallXiContinuity",
  "xiContinuityScore",
  "missingKeyBatterCount",
  "missingKeyBowlerCount",
  "missingDeathBowlerFlag",
  "missingOpenerFlag",
  "tossWinRate",
  "prefersFieldAfterToss",
  "homeWinRate",
  "awayWinRate",
  "restDays",
  "battingResourceScore",
  "bowlingResourceScore",
  "netResourceScore",
  "teamEloBeforeMatch",
  "eloExpectedWin",
  "historicalMatchesUsed",
  "likelyXiMatchesUsed",
] as const

const teamFeatureHeaders = [
  "match_id",
  "season",
  "match_date",
  "venue",
  "city",
  "team",
  "opponent",
  "team_home_context",
  "team_home_flag",
  "match_neutral_flag",
  "training_eligible",
  "training_exclusion_reasons",
  "won_match",
  "team_overall_win_rate_before_match",
  "team_recent_win_rate_last_5",
  "team_recent_win_rate_last_10",
  "team_last_3_year_win_rate",
  "team_venue_win_rate",
  "team_chasing_win_rate",
  "team_batting_first_win_rate",
  "team_boundary_percentage",
  "team_dot_ball_percentage",
  "team_runs_per_wicket",
  "team_runs_conceded_per_wicket_taken",
  "team_avg_wickets_lost",
  "team_powerplay_run_rate",
  "team_powerplay_wickets_lost",
  "team_powerplay_economy",
  "team_powerplay_wickets_taken",
  "team_middle_overs_run_rate",
  "team_middle_overs_boundary_rate",
  "team_middle_overs_dot_ball_rate",
  "team_middle_overs_economy",
  "team_middle_overs_dot_ball_rate_forced",
  "team_death_overs_run_rate",
  "team_death_overs_six_rate",
  "team_death_overs_wickets_lost",
  "team_death_overs_economy",
  "team_death_overs_wickets_taken",
  "team_death_overs_boundary_rate_conceded",
  "team_death_bowling_economy",
  "powerplay_net_run_rate",
  "middle_overs_net_run_rate",
  "death_overs_net_run_rate",
  "team_probable_xi_strength",
  "team_top3_strength",
  "team_middle_order_strength",
  "team_finisher_strength",
  "team_powerplay_bowling_strength",
  "team_death_bowling_strength",
  "team_spin_strength",
  "team_pace_strength",
  "top_order_continuity",
  "bowling_core_continuity",
  "death_bowler_continuity",
  "overall_xi_continuity",
  "team_xi_continuity_score",
  "missing_key_batter_count",
  "missing_key_bowler_count",
  "missing_death_bowler_flag",
  "missing_opener_flag",
  "team_toss_win_rate",
  "team_prefers_field_after_toss",
  "team_home_win_rate",
  "team_away_win_rate",
  "rest_days",
  "batting_resource_score",
  "bowling_resource_score",
  "net_resource_score",
  "team_elo_before_match",
  "elo_expected_win",
  "historical_matches_used",
  "likely_xi_matches_used",
] as const

const matchupHeaders = [
  "match_id",
  "season",
  "match_date",
  "venue",
  "city",
  "home_team",
  "team1",
  "team2",
  "team1_home_flag",
  "team2_home_flag",
  "match_neutral_flag",
  "training_eligible",
  "training_exclusion_reasons",
  "team1_won",
  "venue_average_first_innings_score",
  "venue_average_second_innings_score",
  "venue_chasing_win_rate",
  "venue_batting_first_win_rate",
  "venue_avg_powerplay_runs",
  "venue_avg_powerplay_wickets",
  "venue_avg_death_overs_runs",
  "venue_boundary_rate",
  "venue_six_rate",
  "venue_dot_ball_rate",
  "venue_powerplay_wicket_rate",
  "venue_middle_overs_wicket_rate",
  "venue_death_overs_wicket_rate",
  "venue_spin_wicket_share",
  "venue_pace_wicket_share",
  "team1_h2h_win_rate_vs_team2",
  "team2_h2h_win_rate_vs_team1",
  "last_5_h2h_team1_win_rate",
  "venue_h2h_win_rate",
  "recent_win_rate_gap",
  "chasing_strength_gap",
  "batting_first_gap",
  "elo_gap",
  "elo_expected_team1_win",
  "venue_toss_winner_win_rate",
  "venue_field_first_win_rate",
  "venue_bat_first_win_rate",
  ...teamFeatureKeys.map((key) => `team1_${key}`),
  ...teamFeatureKeys.map((key) => `team2_${key}`),
] as const

const postTossMatchupHeaders = [
  "match_id",
  "season",
  "match_date",
  "venue",
  "city",
  "home_team",
  "team1",
  "team2",
  "team1_home_flag",
  "team2_home_flag",
  "match_neutral_flag",
  "training_eligible",
  "training_exclusion_reasons",
  "toss_winner",
  "toss_decision",
  "team1_bats_first",
  "team2_bats_first",
  "toss_winner_is_team1",
  "toss_winner_is_team2",
  "toss_decision_bat",
  "toss_decision_field",
  "team1_batting_order_win_rate",
  "team2_batting_order_win_rate",
  "batting_order_win_rate_gap",
  "venue_batting_order_expected_team1_win_rate",
  "toss_winner_decision_preference_match",
  "team1_won",
  "venue_average_first_innings_score",
  "venue_average_second_innings_score",
  "venue_chasing_win_rate",
  "venue_batting_first_win_rate",
  "venue_avg_powerplay_runs",
  "venue_avg_powerplay_wickets",
  "venue_avg_death_overs_runs",
  "venue_boundary_rate",
  "venue_six_rate",
  "venue_dot_ball_rate",
  "venue_powerplay_wicket_rate",
  "venue_middle_overs_wicket_rate",
  "venue_death_overs_wicket_rate",
  "venue_spin_wicket_share",
  "venue_pace_wicket_share",
  "team1_h2h_win_rate_vs_team2",
  "team2_h2h_win_rate_vs_team1",
  "last_5_h2h_team1_win_rate",
  "venue_h2h_win_rate",
  "recent_win_rate_gap",
  "chasing_strength_gap",
  "batting_first_gap",
  "elo_gap",
  "elo_expected_team1_win",
  "venue_toss_winner_win_rate",
  "venue_field_first_win_rate",
  "venue_bat_first_win_rate",
  ...teamFeatureKeys.map((key) => `team1_${key}`),
  ...teamFeatureKeys.map((key) => `team2_${key}`),
] as const

const loadMatches = () =>
  readCsv(join(stagedDir, "matches.csv")).map<MatchRow>((row) => ({
    matchId: clean(row.match_id),
    season: parseInteger(row.season),
    matchDate: parseDate(row.match_date),
    venue: clean(row.venue),
    city: clean(row.city),
    tossWinner: clean(row.toss_winner),
    tossDecision: clean(row.toss_decision),
    winner: clean(row.winner),
    resultType: clean(row.result_type),
    method: clean(row.method),
    superoverWinner: clean(row.superover_winner),
  }))

const loadRawInfo = () =>
  new Map(
    readCsv(join(rawDir, "cricsheet_match_info.csv")).map((row) => [
      clean(row.match_id),
      {
        team1: clean(row.team1),
        team2: clean(row.team2),
        winnerRuns: parseInteger(row.winner_runs),
        winnerWickets: parseInteger(row.winner_wickets),
      } satisfies RawInfoRow,
    ]),
  )

const loadTeamMatchRows = () =>
  readCsv(join(stagedDir, "team_match_stats.csv")).map<TeamMatchRow>((row) => ({
    matchId: clean(row.match_id),
    season: parseInteger(row.season),
    matchDate: parseDate(row.match_date),
    venue: clean(row.venue),
    city: clean(row.city),
    team: clean(row.team),
    opponent: clean(row.opponent),
    innings: parseInteger(row.innings),
    battingFirst: parseBoolean(row.batting_first),
    tossWinner: clean(row.toss_winner),
    tossDecision: clean(row.toss_decision),
    winner: clean(row.winner),
    wonMatch: parseBoolean(row.won_match),
    totalRuns: parseInteger(row.total_runs),
    wicketsLost: parseInteger(row.wickets_lost),
    validBalls: parseInteger(row.valid_balls),
    boundaryRuns: parseInteger(row.boundary_runs),
    fours: parseInteger(row.fours),
    sixes: parseInteger(row.sixes),
    dotBalls: parseInteger(row.dot_balls),
    extras: parseInteger(row.extras),
    wideRuns: parseInteger(row.wide_runs),
    noBallRuns: parseInteger(row.no_ball_runs),
    powerplayRuns: parseInteger(row.powerplay_runs),
    powerplayWickets: parseInteger(row.powerplay_wickets),
    powerplayValidBalls: parseInteger(row.powerplay_valid_balls),
    powerplayDotBalls: parseInteger(row.powerplay_dot_balls),
    powerplayBoundaryRuns: parseInteger(row.powerplay_boundary_runs),
    powerplaySixes: parseInteger(row.powerplay_sixes),
    middleRuns: parseInteger(row.middle_runs),
    middleWickets: parseInteger(row.middle_wickets),
    middleValidBalls: parseInteger(row.middle_valid_balls),
    middleDotBalls: parseInteger(row.middle_dot_balls),
    middleBoundaryRuns: parseInteger(row.middle_boundary_runs),
    deathRuns: parseInteger(row.death_runs),
    deathWickets: parseInteger(row.death_wickets),
    deathValidBalls: parseInteger(row.death_valid_balls),
    deathDotBalls: parseInteger(row.death_dot_balls),
    deathBoundaryRuns: parseInteger(row.death_boundary_runs),
    deathSixes: parseInteger(row.death_sixes),
    runsConceded: parseInteger(row.runs_conceded),
    wicketsTaken: parseInteger(row.wickets_taken),
    ballsBowled: parseInteger(row.balls_bowled),
    powerplayRunsConceded: parseInteger(row.powerplay_runs_conceded),
    powerplayBallsBowled: parseInteger(row.powerplay_balls_bowled),
    powerplayWicketsTaken: parseInteger(row.powerplay_wickets_taken),
    powerplayDotBallsForced: parseInteger(row.powerplay_dot_balls_forced),
    powerplayBoundaryRunsConceded: parseInteger(row.powerplay_boundary_runs_conceded),
    middleRunsConceded: parseInteger(row.middle_runs_conceded),
    middleBallsBowled: parseInteger(row.middle_balls_bowled),
    middleWicketsTaken: parseInteger(row.middle_wickets_taken),
    middleDotBallsForced: parseInteger(row.middle_dot_balls_forced),
    middleBoundaryRunsConceded: parseInteger(row.middle_boundary_runs_conceded),
    deathRunsConceded: parseInteger(row.death_runs_conceded),
    deathBallsBowled: parseInteger(row.death_balls_bowled),
    deathWicketsTaken: parseInteger(row.death_wickets_taken),
    deathDotBallsForced: parseInteger(row.death_dot_balls_forced),
    deathBoundaryRunsConceded: parseInteger(row.death_boundary_runs_conceded),
  }))

const loadMatchSquads = () => {
  const result = new Map<string, Set<string>>()
  for (const row of readCsv(join(stagedDir, "match_squads.csv"))) {
    const key = `${clean(row.match_id)}::${clean(row.team)}`
    const squad = result.get(key) ?? new Set<string>()
    squad.add(clean(row.player_name))
    result.set(key, squad)
  }
  return result
}

const getSameSeasonHistory = (history: TeamHistoryEntry[], season: number) => history.filter((entry) => entry.season === season)

const getSameSeasonWindow = (history: TeamHistoryEntry[], season: number, limit: number) => getSameSeasonHistory(history, season).slice(-limit)

const buildProbableXiStats = (
  history: TeamHistoryEntry[],
  season: number,
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
) => {
  const sameSeasonHistory = getSameSeasonHistory(history, season)
  const probableEntry = sameSeasonHistory[sameSeasonHistory.length - 1]
  if (!probableEntry) {
    return {
      probableXi: new Set<string>(),
      sameSeasonHistory,
      stats: new Map<string, PlayerAggregate>(),
    }
  }

  const probableXi = probableEntry.squadPlayers
  const stats = new Map(
    Array.from(probableXi).map((player) => [
      player,
      {
        playerName: player,
        appearances: 0,
        battingPositions: [] as number[],
        battingRuns: 0,
        battingBalls: 0,
        dismissals: 0,
        bowlingBalls: 0,
        deathBowlingBalls: 0,
        runsConceded: 0,
        wickets: 0,
        dotBallsBowled: 0,
      } satisfies PlayerAggregate,
    ]),
  )

  for (const entry of sameSeasonHistory) {
    for (const player of probableXi) {
      const aggregate = stats.get(player)
      if (aggregate && entry.squadPlayers.has(player)) {
        aggregate.appearances += 1
      }
    }

    const profiles = playerProfilesByMatchTeam.get(`${entry.matchId}::${entry.team}`) ?? []
    for (const profile of profiles) {
      const aggregate = stats.get(profile.playerName)
      if (!aggregate) {
        continue
      }

      if (profile.battingPosition > 0) {
        aggregate.battingPositions.push(profile.battingPosition)
      }
      aggregate.battingRuns += profile.battingRuns
      aggregate.battingBalls += profile.battingBalls
      aggregate.dismissals += profile.dismissed
      aggregate.bowlingBalls += profile.bowlingBalls
      aggregate.deathBowlingBalls += profile.deathBowlingBalls
      aggregate.runsConceded += profile.runsConceded
      aggregate.wickets += profile.wickets
      aggregate.dotBallsBowled += profile.dotBallsBowled
    }
  }

  return { probableXi, sameSeasonHistory, stats }
}

const getAverageBattingPosition = (aggregate: PlayerAggregate) => average(aggregate.battingPositions)

const getBattingStrength = (aggregate: PlayerAggregate) => {
  const matches = Math.max(1, aggregate.appearances)
  const runsPerMatch = aggregate.battingRuns / matches
  const strikeRate = aggregate.battingBalls > 0 ? (aggregate.battingRuns * 100) / aggregate.battingBalls : 0
  return runsPerMatch + 0.1 * strikeRate
}

const getBowlingStrength = (aggregate: PlayerAggregate) => {
  if (aggregate.bowlingBalls === 0) {
    return 0
  }

  const matches = Math.max(1, aggregate.appearances)
  const wicketsPerMatch = aggregate.wickets / matches
  const economy = (aggregate.runsConceded * 6) / aggregate.bowlingBalls
  const dotRate = aggregate.dotBallsBowled / aggregate.bowlingBalls
  return wicketsPerMatch * 20 + Math.max(0, 10 - economy) + dotRate * 10
}

const getProbableXiStrengthComponents = (
  history: TeamHistoryEntry[],
  season: number,
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
  playerStyleProfiles: Map<string, PlayerStyleProfile>,
) => {
  const { probableXi, stats } = buildProbableXiStats(history, season, playerProfilesByMatchTeam)
  if (probableXi.size === 0) {
    return {
      probableXiStrength: 0,
      top3Strength: 0,
      middleOrderStrength: 0,
      finisherStrength: 0,
      powerplayBowlingStrength: 0,
      deathBowlingStrength: 0,
      teamSpinStrength: 0,
      teamPaceStrength: 0,
    }
  }

  const playerRows = Array.from(stats.values()).map((aggregate) => {
    const battingStrength = getBattingStrength(aggregate)
    const bowlingStrength = getBowlingStrength(aggregate)
    const averageBattingPosition = getAverageBattingPosition(aggregate)
    const nonDeathBowlingBalls = Math.max(0, aggregate.bowlingBalls - aggregate.deathBowlingBalls)
    const deathShare = aggregate.bowlingBalls > 0 ? aggregate.deathBowlingBalls / aggregate.bowlingBalls : 0
    const styleProfile = playerStyleProfiles.get(normalizePlayerNameKey(aggregate.playerName))

    return {
      aggregate,
      styleProfile,
      battingStrength,
      bowlingStrength,
      overallStrength: battingStrength + bowlingStrength,
      averageBattingPosition,
      nonDeathBowlingBalls,
      deathBowlingStrength: bowlingStrength * (deathShare > 0 ? 0.5 + deathShare : 0),
    }
  })

  const top3 = playerRows
    .filter((row) => row.averageBattingPosition > 0)
    .sort((left, right) => left.averageBattingPosition - right.averageBattingPosition)
    .slice(0, 3)
  const middleOrder = playerRows
    .filter((row) => row.averageBattingPosition >= 4 && row.averageBattingPosition <= 6)
  const finishers = playerRows
    .filter((row) => row.averageBattingPosition >= 6)
    .sort((left, right) => right.averageBattingPosition - left.averageBattingPosition)
    .slice(0, 2)
  const powerplayBowlers = playerRows
    .filter((row) => row.nonDeathBowlingBalls > 0)
    .sort((left, right) => right.nonDeathBowlingBalls - left.nonDeathBowlingBalls)
    .slice(0, 3)
  const deathBowlers = playerRows
    .filter((row) => row.aggregate.deathBowlingBalls > 0)
    .sort((left, right) => right.aggregate.deathBowlingBalls - left.aggregate.deathBowlingBalls)
    .slice(0, 3)

  return {
    probableXiStrength: average(playerRows.map((row) => row.overallStrength)),
    top3Strength: average(top3.map((row) => row.battingStrength)),
    middleOrderStrength: average(middleOrder.map((row) => row.battingStrength)),
    finisherStrength: average(finishers.map((row) => row.battingStrength)),
    powerplayBowlingStrength: average(powerplayBowlers.map((row) => row.bowlingStrength)),
    deathBowlingStrength: average(deathBowlers.map((row) => row.deathBowlingStrength)),
    teamSpinStrength: average(
      playerRows
        .filter((row) => row.styleProfile?.bowlingStyleFamily === "spin")
        .map((row) => row.bowlingStrength),
    ),
    teamPaceStrength: average(
      playerRows
        .filter((row) => row.styleProfile?.bowlingStyleFamily === "pace")
        .map((row) => row.bowlingStrength),
    ),
  }
}

const getVenueStyleWicketShares = (
  matches: MatchRecord[],
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
  playerStyleProfiles: Map<string, PlayerStyleProfile>,
) => {
  let spinWickets = 0
  let paceWickets = 0

  for (const match of matches) {
    for (const team of [match.team1, match.team2]) {
      const profiles = playerProfilesByMatchTeam.get(`${match.matchId}::${team}`) ?? []

      for (const profile of profiles) {
        const styleProfile = playerStyleProfiles.get(profile.playerNameKey)
        if (!styleProfile || profile.wickets <= 0) {
          continue
        }

        if (styleProfile.bowlingStyleFamily === "spin") {
          spinWickets += profile.wickets
        }

        if (styleProfile.bowlingStyleFamily === "pace") {
          paceWickets += profile.wickets
        }
      }
    }
  }

  const totalBowlerAttributedWickets = spinWickets + paceWickets

  return {
    venueSpinWicketShare: safeRate(spinWickets, totalBowlerAttributedWickets),
    venuePaceWicketShare: safeRate(paceWickets, totalBowlerAttributedWickets),
  }
}

const getMissingPlayerPenaltyComponents = (
  history: TeamHistoryEntry[],
  season: number,
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
) => {
  const sameSeasonHistory = getSameSeasonHistory(history, season)
  const probableEntry = sameSeasonHistory[sameSeasonHistory.length - 1]
  if (!probableEntry) {
    return {
      missingKeyBatterCount: 0,
      missingKeyBowlerCount: 0,
      missingDeathBowlerFlag: 0,
      missingOpenerFlag: 0,
    }
  }

  const probableXi = probableEntry.squadPlayers
  const comparisonWindow = sameSeasonHistory.slice(-6, -1)
  if (comparisonWindow.length === 0) {
    return {
      missingKeyBatterCount: 0,
      missingKeyBowlerCount: 0,
      missingDeathBowlerFlag: 0,
      missingOpenerFlag: 0,
    }
  }

  const playerStats = new Map<string, { openerCount: number; batterCount: number; bowlingBalls: number; deathBowlingBalls: number }>()

  for (const entry of comparisonWindow) {
    const profiles = playerProfilesByMatchTeam.get(`${entry.matchId}::${entry.team}`) ?? []
    for (const profile of profiles) {
      const stats = playerStats.get(profile.playerName) ?? { openerCount: 0, batterCount: 0, bowlingBalls: 0, deathBowlingBalls: 0 }
      if (profile.battingPosition > 0 && profile.battingPosition <= 2) {
        stats.openerCount += 1
      }
      if (profile.battingPosition > 0 && profile.battingPosition <= 5) {
        stats.batterCount += 1
      }
      stats.bowlingBalls += profile.bowlingBalls
      stats.deathBowlingBalls += profile.deathBowlingBalls
      playerStats.set(profile.playerName, stats)
    }
  }

  const topPlayers = <T>(entries: Array<[string, T]>, score: (value: T) => number, limit: number) =>
    entries
      .sort((left, right) => score(right[1]) - score(left[1]))
      .slice(0, limit)
      .map(([player]) => player)

  const keyBatters = topPlayers(Array.from(playerStats.entries()), (value) => value.batterCount, 3)
  const keyBowlers = topPlayers(Array.from(playerStats.entries()), (value) => value.bowlingBalls, 3)
  const keyDeathBowlers = topPlayers(Array.from(playerStats.entries()), (value) => value.deathBowlingBalls, 2)
  const keyOpeners = topPlayers(Array.from(playerStats.entries()), (value) => value.openerCount, 2)

  return {
    missingKeyBatterCount: keyBatters.filter((player) => !probableXi.has(player)).length,
    missingKeyBowlerCount: keyBowlers.filter((player) => !probableXi.has(player)).length,
    missingDeathBowlerFlag: keyDeathBowlers.some((player) => !probableXi.has(player)) ? 1 : 0,
    missingOpenerFlag: keyOpeners.some((player) => !probableXi.has(player)) ? 1 : 0,
  }
}

const loadPlayerProfiles = () => {
  const result = new Map<string, PlayerMatchProfile[]>()

  for (const row of readCsv(join(stagedDir, "player_match_stats.csv"))) {
    const key = `${clean(row.match_id)}::${clean(row.team)}`
    const profiles = result.get(key) ?? []
    profiles.push({
      playerName: clean(row.player_name),
      playerNameKey: normalizePlayerNameKey(clean(row.player_name)),
      battingPosition: parseInteger(row.batting_position),
      role: clean(row.role),
      battingRuns: parseInteger(row.batting_runs),
      battingBalls: parseInteger(row.batting_balls),
      dismissed: parseInteger(row.dismissed),
      bowlingBalls: parseInteger(row.bowling_balls),
      deathBowlingBalls: parseInteger(row.death_bowling_balls),
      runsConceded: parseInteger(row.runs_conceded),
      wickets: parseInteger(row.wickets),
      dotBallsBowled: parseInteger(row.dot_balls_bowled),
    })
    result.set(key, profiles)
  }

  return result
}

const loadPlayerStyleProfiles = () => {
  const filePath = join(stagedDir, "player_style_profiles.csv")

  try {
    const rows = readCsv(filePath)

    return new Map(
      rows.map((row) => [
        clean(row.player_name_key) || normalizePlayerNameKey(clean(row.player_name)),
        {
          playerName: clean(row.player_name),
          playerNameKey: clean(row.player_name_key) || normalizePlayerNameKey(clean(row.player_name)),
          personId: clean(row.cricsheet_person_id),
          bowlingStyleFamily: (clean(row.bowling_style_family) || "unknown") as PlayerStyleProfile["bowlingStyleFamily"],
          roleCanonical: clean(row.role_canonical),
          isBowlingOption: clean(row.is_bowling_option).toLowerCase() === "true",
          isSpinOption: clean(row.is_spin_option).toLowerCase() === "true",
          isPaceOption: clean(row.is_pace_option).toLowerCase() === "true",
        } satisfies PlayerStyleProfile,
      ]),
    )
  } catch {
    return new Map<string, PlayerStyleProfile>()
  }
}

const getWinRate = (entries: TeamHistoryEntry[]) => safeRate(entries.filter((entry) => entry.wonMatch).length, entries.length)

const getPhaseMetrics = (entries: TeamHistoryEntry[], phase: "powerplay" | "middle" | "death") => {
  const battingRuns = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayRuns : phase === "middle" ? entry.middleRuns : entry.deathRuns), 0)
  const battingBalls = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayValidBalls : phase === "middle" ? entry.middleValidBalls : entry.deathValidBalls), 0)
  const wicketsLost = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayWickets : phase === "middle" ? entry.middleWickets : entry.deathWickets), 0)
  const battingBoundaryRuns = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayBoundaryRuns : phase === "middle" ? entry.middleBoundaryRuns : entry.deathBoundaryRuns), 0)
  const battingDotBalls = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayDotBalls : phase === "middle" ? entry.middleDotBalls : entry.deathDotBalls), 0)
  const sixes = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplaySixes : phase === "middle" ? 0 : entry.deathSixes), 0)
  const bowlingRunsConceded = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayRunsConceded : phase === "middle" ? entry.middleRunsConceded : entry.deathRunsConceded), 0)
  const bowlingBalls = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayBallsBowled : phase === "middle" ? entry.middleBallsBowled : entry.deathBallsBowled), 0)
  const wicketsTaken = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayWicketsTaken : phase === "middle" ? entry.middleWicketsTaken : entry.deathWicketsTaken), 0)
  const dotBallsForced = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayDotBallsForced : phase === "middle" ? entry.middleDotBallsForced : entry.deathDotBallsForced), 0)
  const boundaryRunsConceded = entries.reduce((sum, entry) => sum + (phase === "powerplay" ? entry.powerplayBoundaryRunsConceded : phase === "middle" ? entry.middleBoundaryRunsConceded : entry.deathBoundaryRunsConceded), 0)

  return {
    runRate: safePerSixBalls(battingRuns, battingBalls),
    wicketsLost: safeRate(wicketsLost, entries.length),
    economy: safePerSixBalls(bowlingRunsConceded, bowlingBalls),
    wicketsTaken: safeRate(wicketsTaken, entries.length),
    boundaryRate: safeRate(battingBoundaryRuns, battingRuns),
    dotBallRate: safeRate(battingDotBalls, battingBalls),
    dotBallRateForced: safeRate(dotBallsForced, bowlingBalls),
    sixRate: safeRate(sixes, battingBalls),
    boundaryRateConceded: safeRate(boundaryRunsConceded, bowlingRunsConceded),
  }
}

const getLastThreeYearWinRate = (entries: TeamHistoryEntry[], matchDate: Date) => {
  const threshold = new Date(matchDate)
  threshold.setUTCFullYear(threshold.getUTCFullYear() - 3)
  return getWinRate(entries.filter((entry) => entry.matchDate >= threshold))
}

const getXiContinuityComponents = (
  history: TeamHistoryEntry[],
  season: number,
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
) => {
  const window = getSameSeasonWindow(history, season, 5)
  if (window.length === 0) {
    return {
      topOrderContinuity: 0,
      bowlingCoreContinuity: 0,
      deathBowlerContinuity: 0,
      overallXiContinuity: 0,
      score: 0,
      historyCount: 0,
    }
  }

  const probableEntry = window[window.length - 1]
  if (!probableEntry) {
    return {
      topOrderContinuity: 0,
      bowlingCoreContinuity: 0,
      deathBowlerContinuity: 0,
      overallXiContinuity: 0,
      score: 0,
      historyCount: 0,
    }
  }

  const probableXi = probableEntry.squadPlayers
  const playerStats = new Map(
    Array.from(probableXi).map((player) => [
      player,
      {
        appearances: 0,
        battingPositions: [] as number[],
        bowlingBalls: 0,
        deathBowlingBalls: 0,
      },
    ]),
  )

  for (const entry of window) {
    for (const player of probableXi) {
      const stats = playerStats.get(player)
      if (!stats) {
        continue
      }

      if (entry.squadPlayers.has(player)) {
        stats.appearances += 1
      }
    }

    const profiles = playerProfilesByMatchTeam.get(`${entry.matchId}::${entry.team}`) ?? []
    for (const profile of profiles) {
      const stats = playerStats.get(profile.playerName)
      if (!stats) {
        continue
      }

      if (profile.battingPosition > 0) {
        stats.battingPositions.push(profile.battingPosition)
      }
      stats.bowlingBalls += profile.bowlingBalls
      stats.deathBowlingBalls += profile.deathBowlingBalls
    }
  }

  const overallXiContinuity = average(
    Array.from(playerStats.values()).map((stats) => safeRate(stats.appearances, window.length)),
  )

  const continuityForSelection = (players: string[]) =>
    players.length > 0
      ? average(
          players.map((player) => safeRate(playerStats.get(player)?.appearances ?? 0, window.length)),
        )
      : overallXiContinuity

  const topOrderPlayers = Array.from(playerStats.entries())
    .map(([player, stats]) => ({
      player,
      averageBattingPosition: average(stats.battingPositions),
    }))
    .filter((entry) => entry.averageBattingPosition > 0)
    .sort((left, right) => left.averageBattingPosition - right.averageBattingPosition)
    .slice(0, 4)
    .map((entry) => entry.player)

  const bowlingCorePlayers = Array.from(playerStats.entries())
    .filter(([, stats]) => stats.bowlingBalls > 0)
    .sort((left, right) => right[1].bowlingBalls - left[1].bowlingBalls)
    .slice(0, 5)
    .map(([player]) => player)

  const deathBowlerPlayers = Array.from(playerStats.entries())
    .filter(([, stats]) => stats.deathBowlingBalls > 0)
    .sort((left, right) => right[1].deathBowlingBalls - left[1].deathBowlingBalls)
    .slice(0, 3)
    .map(([player]) => player)

  const topOrderContinuity = continuityForSelection(topOrderPlayers)
  const bowlingCoreContinuity = continuityForSelection(bowlingCorePlayers)
  const deathBowlerContinuity = continuityForSelection(deathBowlerPlayers)
  const score =
    0.3 * topOrderContinuity +
    0.3 * bowlingCoreContinuity +
    0.2 * deathBowlerContinuity +
    0.2 * overallXiContinuity

  return {
    topOrderContinuity,
    bowlingCoreContinuity,
    deathBowlerContinuity,
    overallXiContinuity,
    score,
    historyCount: window.length,
  }
}

const getVenueAggregates = (entries: TeamHistoryEntry[]) => {
  const battingFirst = entries.filter((entry) => entry.battingFirst)
  const chasing = entries.filter((entry) => !entry.battingFirst)
  return {
    averageFirstInningsScore: average(battingFirst.map((entry) => entry.totalRuns)),
    averageSecondInningsScore: average(chasing.map((entry) => entry.totalRuns)),
    chasingWinRate: getWinRate(chasing),
    battingFirstWinRate: getWinRate(battingFirst),
    avgPowerplayRuns: average(entries.map((entry) => entry.powerplayRuns)),
    avgPowerplayWickets: average(entries.map((entry) => entry.powerplayWickets)),
    avgDeathOversRuns: average(entries.map((entry) => entry.deathRuns)),
    boundaryRate: safeRate(entries.reduce((sum, entry) => sum + entry.boundaryRuns, 0), entries.reduce((sum, entry) => sum + entry.totalRuns, 0)),
    sixRate: safeRate(entries.reduce((sum, entry) => sum + entry.sixes, 0), entries.reduce((sum, entry) => sum + entry.validBalls, 0)),
    dotBallRate: safeRate(entries.reduce((sum, entry) => sum + entry.dotBalls, 0), entries.reduce((sum, entry) => sum + entry.validBalls, 0)),
    powerplayWicketRate: safeRate(entries.reduce((sum, entry) => sum + entry.powerplayWickets, 0), entries.reduce((sum, entry) => sum + entry.powerplayValidBalls, 0)),
    middleWicketRate: safeRate(entries.reduce((sum, entry) => sum + entry.middleWickets, 0), entries.reduce((sum, entry) => sum + entry.middleValidBalls, 0)),
    deathWicketRate: safeRate(entries.reduce((sum, entry) => sum + entry.deathWickets, 0), entries.reduce((sum, entry) => sum + entry.deathValidBalls, 0)),
  }
}

const getVenueMatchAggregates = (matches: MatchRecord[]) => ({
  tossWinnerWinRate: safeRate(matches.filter((match) => match.tossWinner === match.winner).length, matches.length),
  fieldFirstWinRate: safeRate(
    matches.filter((match) => match.tossDecision === "field" && match.winner === match.secondInningsTeam).length,
    matches.filter((match) => match.tossDecision === "field").length,
  ),
  batFirstWinRate: safeRate(matches.filter((match) => match.winner === match.firstInningsTeam).length, matches.length),
})

const hasMeaningfulValue = (value: string) => value.length > 0 && value !== "NA"

const getTrainingExclusionReasons = (match: MatchRow, team1Context: TeamVenueContext, team2Context: TeamVenueContext) => {
  const reasons: string[] = []

  if (match.resultType === "no result") {
    reasons.push("no_result")
  }
  if (match.resultType === "tie") {
    reasons.push("tie_result")
  }
  if (hasMeaningfulValue(match.method)) {
    reasons.push("reduced_overs_method")
  }
  if (hasMeaningfulValue(match.superoverWinner)) {
    reasons.push("super_over")
  }
  if (team1Context === "neutral" || team2Context === "neutral") {
    reasons.push("neutral_venue")
  }
  if (team1Context === "unknown" || team2Context === "unknown") {
    reasons.push("unresolved_home_context")
  }

  return reasons
}

const buildTeamFeatures = (
  history: TeamHistoryEntry[],
  venue: string,
  matchDate: Date,
  season: number,
  eloBeforeMatch: number,
  eloExpectedWin: number,
  playerProfilesByMatchTeam: Map<string, PlayerMatchProfile[]>,
  playerStyleProfiles: Map<string, PlayerStyleProfile>,
) => {
  const recent5 = history.slice(-5)
  const recent10 = history.slice(-10)
  const venueHistory = history.filter((entry) => entry.venue === venue)
  const chasingHistory = history.filter((entry) => !entry.battingFirst)
  const battingFirstHistory = history.filter((entry) => entry.battingFirst)
  const homeHistory = history.filter((entry) => entry.homeContext === "home" || entry.homeContext === "secondary_home")
  const awayHistory = history.filter((entry) => entry.homeContext === "away")
  const tossWins = history.filter((entry) => entry.tossWinner === entry.team)
  const powerplay = getPhaseMetrics(history, "powerplay")
  const middle = getPhaseMetrics(history, "middle")
  const death = getPhaseMetrics(history, "death")
  const xiContinuity = getXiContinuityComponents(history, season, playerProfilesByMatchTeam)
  const probableXiStrength = getProbableXiStrengthComponents(history, season, playerProfilesByMatchTeam, playerStyleProfiles)
  const missingPlayerPenalties = getMissingPlayerPenaltyComponents(history, season, playerProfilesByMatchTeam)
  const previousMatch = history[history.length - 1]
  const avgRuns = average(history.map((entry) => entry.totalRuns))
  const avgRunsConceded = average(history.map((entry) => entry.runsConceded))
  const avgWicketsLost = average(history.map((entry) => entry.wicketsLost))
  const avgWicketsRemaining = average(history.map((entry) => Math.max(0, 10 - entry.wicketsLost)))
  const avgWicketsTaken = average(history.map((entry) => entry.wicketsTaken))

  return {
    overallWinRateBeforeMatch: getWinRate(history),
    recentWinRateLast5: getWinRate(recent5),
    recentWinRateLast10: getWinRate(recent10),
    last3YearWinRate: getLastThreeYearWinRate(history, matchDate),
    venueWinRate: getWinRate(venueHistory),
    chasingWinRate: getWinRate(chasingHistory),
    battingFirstWinRate: getWinRate(battingFirstHistory),
    boundaryPercentage: safeRate(history.reduce((sum, entry) => sum + entry.boundaryRuns, 0), history.reduce((sum, entry) => sum + entry.totalRuns, 0)),
    dotBallPercentage: safeRate(history.reduce((sum, entry) => sum + entry.dotBalls, 0), history.reduce((sum, entry) => sum + entry.validBalls, 0)),
    runsPerWicket: safeRate(history.reduce((sum, entry) => sum + entry.totalRuns, 0), history.reduce((sum, entry) => sum + Math.max(1, entry.wicketsLost), 0)),
    runsConcededPerWicketTaken: safeRate(history.reduce((sum, entry) => sum + entry.runsConceded, 0), history.reduce((sum, entry) => sum + Math.max(1, entry.wicketsTaken), 0)),
    avgWicketsLost,
    powerplayRunRate: powerplay.runRate,
    powerplayWicketsLost: powerplay.wicketsLost,
    powerplayEconomy: powerplay.economy,
    powerplayWicketsTaken: powerplay.wicketsTaken,
    middleOversRunRate: middle.runRate,
    middleOversBoundaryRate: middle.boundaryRate,
    middleOversDotBallRate: middle.dotBallRate,
    middleOversEconomy: middle.economy,
    middleOversDotBallRateForced: middle.dotBallRateForced,
    deathOversRunRate: death.runRate,
    deathOversSixRate: death.sixRate,
    deathOversWicketsLost: death.wicketsLost,
    deathOversEconomy: death.economy,
    deathOversWicketsTaken: death.wicketsTaken,
    deathOversBoundaryRateConceded: death.boundaryRateConceded,
    deathBowlingEconomy: death.economy,
    powerplayNetRunRate: powerplay.runRate - powerplay.economy,
    middleOversNetRunRate: middle.runRate - middle.economy,
    deathOversNetRunRate: death.runRate - death.economy,
    probableXiStrength: probableXiStrength.probableXiStrength,
    top3Strength: probableXiStrength.top3Strength,
    middleOrderStrength: probableXiStrength.middleOrderStrength,
    finisherStrength: probableXiStrength.finisherStrength,
    powerplayBowlingStrength: probableXiStrength.powerplayBowlingStrength,
    deathBowlingStrength: probableXiStrength.deathBowlingStrength,
    teamSpinStrength: probableXiStrength.teamSpinStrength,
    teamPaceStrength: probableXiStrength.teamPaceStrength,
    topOrderContinuity: xiContinuity.topOrderContinuity,
    bowlingCoreContinuity: xiContinuity.bowlingCoreContinuity,
    deathBowlerContinuity: xiContinuity.deathBowlerContinuity,
    overallXiContinuity: xiContinuity.overallXiContinuity,
    xiContinuityScore: xiContinuity.score,
    missingKeyBatterCount: missingPlayerPenalties.missingKeyBatterCount,
    missingKeyBowlerCount: missingPlayerPenalties.missingKeyBowlerCount,
    missingDeathBowlerFlag: missingPlayerPenalties.missingDeathBowlerFlag,
    missingOpenerFlag: missingPlayerPenalties.missingOpenerFlag,
    tossWinRate: safeRate(tossWins.length, history.length),
    prefersFieldAfterToss: safeRate(tossWins.filter((entry) => entry.tossDecision === "field").length, tossWins.length),
    homeWinRate: getWinRate(homeHistory),
    awayWinRate: getWinRate(awayHistory),
    restDays: previousMatch ? Math.round((matchDate.getTime() - previousMatch.matchDate.getTime()) / (24 * 60 * 60 * 1000)) : 0,
    battingResourceScore: avgRuns + 8 * avgWicketsRemaining,
    bowlingResourceScore: avgWicketsTaken * 8 - avgRunsConceded,
    netResourceScore: avgRuns + 8 * avgWicketsRemaining + (avgWicketsTaken * 8 - avgRunsConceded),
    teamEloBeforeMatch: eloBeforeMatch,
    eloExpectedWin,
    historicalMatchesUsed: history.length,
    likelyXiMatchesUsed: xiContinuity.historyCount,
  } satisfies TeamFeatureSet
}

const main = () => {
  mkdirSync(featuresDir, { recursive: true })

  const matches = loadMatches().sort((left, right) => sortKey(left.matchDate, left.matchId).localeCompare(sortKey(right.matchDate, right.matchId)))
  const rawInfoByMatch = loadRawInfo()
  const matchSquads = loadMatchSquads()
  const playerProfilesByMatchTeam = loadPlayerProfiles()
  const playerStyleProfiles = loadPlayerStyleProfiles()
  const teamRowsByMatch = new Map<string, TeamMatchRow[]>()

  for (const row of loadTeamMatchRows()) {
    const existing = teamRowsByMatch.get(row.matchId) ?? []
    existing.push(row)
    teamRowsByMatch.set(row.matchId, existing)
  }

  const teamHistory = new Map<string, TeamHistoryEntry[]>()
  const venueHistory = new Map<string, TeamHistoryEntry[]>()
  const venueMatchHistory = new Map<string, MatchRecord[]>()
  const pairHistory = new Map<string, MatchRecord[]>()
  const eloRatings = new Map<string, number>()

  const teamFeatureRows: CsvRow[] = []
  const matchupRows: CsvRow[] = []
  const postTossMatchupRows: CsvRow[] = []

  for (const match of matches) {
    const rows = teamRowsByMatch.get(match.matchId) ?? []
    if (rows.length < 2) {
      continue
    }

    const rawInfo = rawInfoByMatch.get(match.matchId)
    const orderedTeams = rawInfo
      ? [rawInfo.team1, rawInfo.team2]
      : rows.map((row) => row.team).sort((left, right) => left.localeCompare(right))
    const team1Row = rows.find((row) => row.team === orderedTeams[0]) ?? rows[0]
    const team2Row = rows.find((row) => row.team === orderedTeams[1]) ?? rows[1]
    if (!team1Row || !team2Row) {
      continue
    }

    const team1 = team1Row.team
    const team2 = team2Row.team
    const team1Prior = teamHistory.get(team1) ?? []
    const team2Prior = teamHistory.get(team2) ?? []
    const priorVenueEntries = venueHistory.get(match.venue) ?? []
    const priorVenueMatches = venueMatchHistory.get(match.venue) ?? []
    const priorPairMatches = pairHistory.get(pairKey(team1, team2)) ?? []

    const team1Context = resolveTeamVenueContext(team1, match.venue, match.season)
    const team2Context = resolveTeamVenueContext(team2, match.venue, match.season)
    const matchNeutral = team1Context === "neutral" || team2Context === "neutral"
    const trainingExclusionReasons = getTrainingExclusionReasons(match, team1Context, team2Context)
    const trainingEligible = trainingExclusionReasons.length === 0
    const trainingExclusionReasonText = trainingExclusionReasons.join("|")

    const team1Elo = eloRatings.get(team1) ?? 1500
    const team2Elo = eloRatings.get(team2) ?? 1500
    const eloExpectedTeam1Win = 1 / (1 + 10 ** ((team2Elo - team1Elo) / 400))
    const eloExpectedTeam2Win = 1 - eloExpectedTeam1Win

    const team1Features = buildTeamFeatures(team1Prior, match.venue, match.matchDate, match.season, team1Elo, eloExpectedTeam1Win, playerProfilesByMatchTeam, playerStyleProfiles)
    const team2Features = buildTeamFeatures(team2Prior, match.venue, match.matchDate, match.season, team2Elo, eloExpectedTeam2Win, playerProfilesByMatchTeam, playerStyleProfiles)

    teamFeatureRows.push({
      match_id: match.matchId,
      season: match.season,
      match_date: dateOnly(match.matchDate),
      venue: match.venue,
      city: match.city,
      team: team1,
      opponent: team2,
      team_home_context: team1Context,
      team_home_flag: team1Context === "home" || team1Context === "secondary_home",
      match_neutral_flag: matchNeutral,
      training_eligible: trainingEligible,
      training_exclusion_reasons: trainingExclusionReasonText,
      won_match: team1Row.wonMatch,
      team_overall_win_rate_before_match: team1Features.overallWinRateBeforeMatch,
      team_recent_win_rate_last_5: team1Features.recentWinRateLast5,
      team_recent_win_rate_last_10: team1Features.recentWinRateLast10,
      team_last_3_year_win_rate: team1Features.last3YearWinRate,
      team_venue_win_rate: team1Features.venueWinRate,
      team_chasing_win_rate: team1Features.chasingWinRate,
      team_batting_first_win_rate: team1Features.battingFirstWinRate,
      team_boundary_percentage: team1Features.boundaryPercentage,
      team_dot_ball_percentage: team1Features.dotBallPercentage,
      team_runs_per_wicket: team1Features.runsPerWicket,
      team_runs_conceded_per_wicket_taken: team1Features.runsConcededPerWicketTaken,
      team_avg_wickets_lost: team1Features.avgWicketsLost,
      team_powerplay_run_rate: team1Features.powerplayRunRate,
      team_powerplay_wickets_lost: team1Features.powerplayWicketsLost,
      team_powerplay_economy: team1Features.powerplayEconomy,
      team_powerplay_wickets_taken: team1Features.powerplayWicketsTaken,
      team_middle_overs_run_rate: team1Features.middleOversRunRate,
      team_middle_overs_boundary_rate: team1Features.middleOversBoundaryRate,
      team_middle_overs_dot_ball_rate: team1Features.middleOversDotBallRate,
      team_middle_overs_economy: team1Features.middleOversEconomy,
      team_middle_overs_dot_ball_rate_forced: team1Features.middleOversDotBallRateForced,
      team_death_overs_run_rate: team1Features.deathOversRunRate,
      team_death_overs_six_rate: team1Features.deathOversSixRate,
      team_death_overs_wickets_lost: team1Features.deathOversWicketsLost,
      team_death_overs_economy: team1Features.deathOversEconomy,
      team_death_overs_wickets_taken: team1Features.deathOversWicketsTaken,
      team_death_overs_boundary_rate_conceded: team1Features.deathOversBoundaryRateConceded,
      team_death_bowling_economy: team1Features.deathBowlingEconomy,
      powerplay_net_run_rate: team1Features.powerplayNetRunRate,
      middle_overs_net_run_rate: team1Features.middleOversNetRunRate,
      death_overs_net_run_rate: team1Features.deathOversNetRunRate,
      team_probable_xi_strength: team1Features.probableXiStrength,
      team_top3_strength: team1Features.top3Strength,
      team_middle_order_strength: team1Features.middleOrderStrength,
      team_finisher_strength: team1Features.finisherStrength,
      team_powerplay_bowling_strength: team1Features.powerplayBowlingStrength,
      team_death_bowling_strength: team1Features.deathBowlingStrength,
      team_spin_strength: team1Features.teamSpinStrength,
      team_pace_strength: team1Features.teamPaceStrength,
      top_order_continuity: team1Features.topOrderContinuity,
      bowling_core_continuity: team1Features.bowlingCoreContinuity,
      death_bowler_continuity: team1Features.deathBowlerContinuity,
      overall_xi_continuity: team1Features.overallXiContinuity,
      team_xi_continuity_score: team1Features.xiContinuityScore,
      missing_key_batter_count: team1Features.missingKeyBatterCount,
      missing_key_bowler_count: team1Features.missingKeyBowlerCount,
      missing_death_bowler_flag: team1Features.missingDeathBowlerFlag,
      missing_opener_flag: team1Features.missingOpenerFlag,
      team_toss_win_rate: team1Features.tossWinRate,
      team_prefers_field_after_toss: team1Features.prefersFieldAfterToss,
      team_home_win_rate: team1Features.homeWinRate,
      team_away_win_rate: team1Features.awayWinRate,
      rest_days: team1Features.restDays,
      batting_resource_score: team1Features.battingResourceScore,
      bowling_resource_score: team1Features.bowlingResourceScore,
      net_resource_score: team1Features.netResourceScore,
      team_elo_before_match: team1Features.teamEloBeforeMatch,
      elo_expected_win: team1Features.eloExpectedWin,
      historical_matches_used: team1Features.historicalMatchesUsed,
      likely_xi_matches_used: team1Features.likelyXiMatchesUsed,
    })

    teamFeatureRows.push({
      match_id: match.matchId,
      season: match.season,
      match_date: dateOnly(match.matchDate),
      venue: match.venue,
      city: match.city,
      team: team2,
      opponent: team1,
      team_home_context: team2Context,
      team_home_flag: team2Context === "home" || team2Context === "secondary_home",
      match_neutral_flag: matchNeutral,
      training_eligible: trainingEligible,
      training_exclusion_reasons: trainingExclusionReasonText,
      won_match: team2Row.wonMatch,
      team_overall_win_rate_before_match: team2Features.overallWinRateBeforeMatch,
      team_recent_win_rate_last_5: team2Features.recentWinRateLast5,
      team_recent_win_rate_last_10: team2Features.recentWinRateLast10,
      team_last_3_year_win_rate: team2Features.last3YearWinRate,
      team_venue_win_rate: team2Features.venueWinRate,
      team_chasing_win_rate: team2Features.chasingWinRate,
      team_batting_first_win_rate: team2Features.battingFirstWinRate,
      team_boundary_percentage: team2Features.boundaryPercentage,
      team_dot_ball_percentage: team2Features.dotBallPercentage,
      team_runs_per_wicket: team2Features.runsPerWicket,
      team_runs_conceded_per_wicket_taken: team2Features.runsConcededPerWicketTaken,
      team_avg_wickets_lost: team2Features.avgWicketsLost,
      team_powerplay_run_rate: team2Features.powerplayRunRate,
      team_powerplay_wickets_lost: team2Features.powerplayWicketsLost,
      team_powerplay_economy: team2Features.powerplayEconomy,
      team_powerplay_wickets_taken: team2Features.powerplayWicketsTaken,
      team_middle_overs_run_rate: team2Features.middleOversRunRate,
      team_middle_overs_boundary_rate: team2Features.middleOversBoundaryRate,
      team_middle_overs_dot_ball_rate: team2Features.middleOversDotBallRate,
      team_middle_overs_economy: team2Features.middleOversEconomy,
      team_middle_overs_dot_ball_rate_forced: team2Features.middleOversDotBallRateForced,
      team_death_overs_run_rate: team2Features.deathOversRunRate,
      team_death_overs_six_rate: team2Features.deathOversSixRate,
      team_death_overs_wickets_lost: team2Features.deathOversWicketsLost,
      team_death_overs_economy: team2Features.deathOversEconomy,
      team_death_overs_wickets_taken: team2Features.deathOversWicketsTaken,
      team_death_overs_boundary_rate_conceded: team2Features.deathOversBoundaryRateConceded,
      team_death_bowling_economy: team2Features.deathBowlingEconomy,
      powerplay_net_run_rate: team2Features.powerplayNetRunRate,
      middle_overs_net_run_rate: team2Features.middleOversNetRunRate,
      death_overs_net_run_rate: team2Features.deathOversNetRunRate,
      team_probable_xi_strength: team2Features.probableXiStrength,
      team_top3_strength: team2Features.top3Strength,
      team_middle_order_strength: team2Features.middleOrderStrength,
      team_finisher_strength: team2Features.finisherStrength,
      team_powerplay_bowling_strength: team2Features.powerplayBowlingStrength,
      team_death_bowling_strength: team2Features.deathBowlingStrength,
      team_spin_strength: team2Features.teamSpinStrength,
      team_pace_strength: team2Features.teamPaceStrength,
      top_order_continuity: team2Features.topOrderContinuity,
      bowling_core_continuity: team2Features.bowlingCoreContinuity,
      death_bowler_continuity: team2Features.deathBowlerContinuity,
      overall_xi_continuity: team2Features.overallXiContinuity,
      team_xi_continuity_score: team2Features.xiContinuityScore,
      missing_key_batter_count: team2Features.missingKeyBatterCount,
      missing_key_bowler_count: team2Features.missingKeyBowlerCount,
      missing_death_bowler_flag: team2Features.missingDeathBowlerFlag,
      missing_opener_flag: team2Features.missingOpenerFlag,
      team_toss_win_rate: team2Features.tossWinRate,
      team_prefers_field_after_toss: team2Features.prefersFieldAfterToss,
      team_home_win_rate: team2Features.homeWinRate,
      team_away_win_rate: team2Features.awayWinRate,
      rest_days: team2Features.restDays,
      batting_resource_score: team2Features.battingResourceScore,
      bowling_resource_score: team2Features.bowlingResourceScore,
      net_resource_score: team2Features.netResourceScore,
      team_elo_before_match: team2Features.teamEloBeforeMatch,
      elo_expected_win: team2Features.eloExpectedWin,
      historical_matches_used: team2Features.historicalMatchesUsed,
      likely_xi_matches_used: team2Features.likelyXiMatchesUsed,
    })

    const venueAggregates = getVenueAggregates(priorVenueEntries)
    const venueMatchAggregates = getVenueMatchAggregates(priorVenueMatches)
    const venueStyleWicketShares = getVenueStyleWicketShares(priorVenueMatches, playerProfilesByMatchTeam, playerStyleProfiles)
    const team1Wins = priorPairMatches.filter((entry) => entry.winner === team1).length
    const team2Wins = priorPairMatches.filter((entry) => entry.winner === team2).length
    const last5H2H = priorPairMatches.slice(-5)
    const venueH2H = priorPairMatches.filter((entry) => entry.venue === match.venue)

    const matchupRow: CsvRow = {
      match_id: match.matchId,
      season: match.season,
      match_date: dateOnly(match.matchDate),
      venue: match.venue,
      city: match.city,
      home_team: inferHomeTeam([team1, team2], match.venue, match.season) ?? "",
      team1,
      team2,
      team1_home_flag: team1Context === "home" || team1Context === "secondary_home",
      team2_home_flag: team2Context === "home" || team2Context === "secondary_home",
      match_neutral_flag: matchNeutral,
      training_eligible: trainingEligible,
      training_exclusion_reasons: trainingExclusionReasonText,
      team1_won: team1Row.wonMatch,
      venue_average_first_innings_score: venueAggregates.averageFirstInningsScore,
      venue_average_second_innings_score: venueAggregates.averageSecondInningsScore,
      venue_chasing_win_rate: venueAggregates.chasingWinRate,
      venue_batting_first_win_rate: venueAggregates.battingFirstWinRate,
      venue_avg_powerplay_runs: venueAggregates.avgPowerplayRuns,
      venue_avg_powerplay_wickets: venueAggregates.avgPowerplayWickets,
      venue_avg_death_overs_runs: venueAggregates.avgDeathOversRuns,
      venue_boundary_rate: venueAggregates.boundaryRate,
      venue_six_rate: venueAggregates.sixRate,
      venue_dot_ball_rate: venueAggregates.dotBallRate,
      venue_powerplay_wicket_rate: venueAggregates.powerplayWicketRate,
      venue_middle_overs_wicket_rate: venueAggregates.middleWicketRate,
      venue_death_overs_wicket_rate: venueAggregates.deathWicketRate,
      venue_spin_wicket_share: venueStyleWicketShares.venueSpinWicketShare,
      venue_pace_wicket_share: venueStyleWicketShares.venuePaceWicketShare,
      team1_h2h_win_rate_vs_team2: safeRate(team1Wins, priorPairMatches.length),
      team2_h2h_win_rate_vs_team1: safeRate(team2Wins, priorPairMatches.length),
      last_5_h2h_team1_win_rate: safeRate(last5H2H.filter((entry) => entry.winner === team1).length, last5H2H.length),
      venue_h2h_win_rate: safeRate(venueH2H.filter((entry) => entry.winner === team1).length, venueH2H.length),
      recent_win_rate_gap: team1Features.recentWinRateLast10 - team2Features.recentWinRateLast10,
      chasing_strength_gap: team1Features.chasingWinRate - team2Features.chasingWinRate,
      batting_first_gap: team1Features.battingFirstWinRate - team2Features.battingFirstWinRate,
      elo_gap: team1Features.teamEloBeforeMatch - team2Features.teamEloBeforeMatch,
      elo_expected_team1_win: eloExpectedTeam1Win,
      venue_toss_winner_win_rate: venueMatchAggregates.tossWinnerWinRate,
      venue_field_first_win_rate: venueMatchAggregates.fieldFirstWinRate,
      venue_bat_first_win_rate: venueMatchAggregates.batFirstWinRate,
      ...Object.fromEntries(teamFeatureKeys.map((key) => [`team1_${key}`, team1Features[key]])),
      ...Object.fromEntries(teamFeatureKeys.map((key) => [`team2_${key}`, team2Features[key]])),
    }

    matchupRows.push(matchupRow)
    postTossMatchupRows.push({
      ...matchupRow,
      toss_winner: match.tossWinner,
      toss_decision: match.tossDecision,
      team1_bats_first: team1Row.battingFirst,
      team2_bats_first: team2Row.battingFirst,
      toss_winner_is_team1: match.tossWinner === team1,
      toss_winner_is_team2: match.tossWinner === team2,
      toss_decision_bat: match.tossDecision === "bat",
      toss_decision_field: match.tossDecision === "field",
      team1_batting_order_win_rate: team1Row.battingFirst ? team1Features.battingFirstWinRate : team1Features.chasingWinRate,
      team2_batting_order_win_rate: team2Row.battingFirst ? team2Features.battingFirstWinRate : team2Features.chasingWinRate,
      batting_order_win_rate_gap: (team1Row.battingFirst ? team1Features.battingFirstWinRate : team1Features.chasingWinRate) - (team2Row.battingFirst ? team2Features.battingFirstWinRate : team2Features.chasingWinRate),
      venue_batting_order_expected_team1_win_rate: team1Row.battingFirst ? venueAggregates.battingFirstWinRate : venueAggregates.chasingWinRate,
      toss_winner_decision_preference_match: match.tossWinner === team1
        ? (match.tossDecision === "field" ? team1Features.prefersFieldAfterToss : 1 - team1Features.prefersFieldAfterToss)
        : match.tossWinner === team2
          ? (match.tossDecision === "field" ? team2Features.prefersFieldAfterToss : 1 - team2Features.prefersFieldAfterToss)
          : 0,
    })

    const team1Squad = matchSquads.get(`${match.matchId}::${team1}`) ?? new Set<string>()
    const team2Squad = matchSquads.get(`${match.matchId}::${team2}`) ?? new Set<string>()
    const team1Entry: TeamHistoryEntry = { ...team1Row, homeContext: team1Context, squadPlayers: team1Squad }
    const team2Entry: TeamHistoryEntry = { ...team2Row, homeContext: team2Context, squadPlayers: team2Squad }

    if (trainingEligible) {
      teamHistory.set(team1, [...team1Prior, team1Entry])
      teamHistory.set(team2, [...team2Prior, team2Entry])
      venueHistory.set(match.venue, [...priorVenueEntries, team1Entry, team2Entry])
    }

    const firstInningsRow = rows.find((row) => row.battingFirst) ?? team1Row
    const secondInningsRow = rows.find((row) => !row.battingFirst) ?? team2Row
    const matchRecord: MatchRecord = {
      matchId: match.matchId,
      season: match.season,
      matchDate: match.matchDate,
      venue: match.venue,
      city: match.city,
      team1,
      team2,
      winner: match.winner,
      tossWinner: match.tossWinner,
      tossDecision: match.tossDecision,
      firstInningsTeam: firstInningsRow.team,
      secondInningsTeam: secondInningsRow.team,
      firstInningsRuns: firstInningsRow.totalRuns,
      secondInningsRuns: secondInningsRow.totalRuns,
      winnerRuns: rawInfo?.winnerRuns ?? 0,
      winnerWickets: rawInfo?.winnerWickets ?? 0,
      ballsRemainingInChase: rawInfo?.winnerWickets ? Math.max(0, 120 - secondInningsRow.validBalls) : 0,
    }

    if (trainingEligible) {
      venueMatchHistory.set(match.venue, [...priorVenueMatches, matchRecord])
      const currentPairHistory = pairHistory.get(pairKey(team1, team2)) ?? []
      pairHistory.set(pairKey(team1, team2), [...currentPairHistory, matchRecord])
    }

    const scoreTeam1 = match.winner === team1 ? 1 : 0
    const scoreTeam2 = match.winner === team2 ? 1 : 0
    const marginMultiplier = rawInfo?.winnerRuns
      ? Math.log1p(Math.max(1, rawInfo.winnerRuns))
      : Math.log1p(Math.max(1, (rawInfo?.winnerWickets ?? 0) + matchRecord.ballsRemainingInChase / 12))
    const kFactor = 20
    if (trainingEligible) {
      eloRatings.set(team1, team1Elo + kFactor * marginMultiplier * (scoreTeam1 - eloExpectedTeam1Win))
      eloRatings.set(team2, team2Elo + kFactor * marginMultiplier * (scoreTeam2 - eloExpectedTeam2Win))
    }
  }

  writeCsv(join(featuresDir, "pre_match_team_features.csv"), [...teamFeatureHeaders], teamFeatureRows)
  writeCsv(join(featuresDir, "pre_match_matchup_features.csv"), [...matchupHeaders], matchupRows)
  writeCsv(join(featuresDir, "post_toss_matchup_features.csv"), [...postTossMatchupHeaders], postTossMatchupRows)
  writeCsv(
    join(featuresDir, "training_ready_team_features.csv"),
    [...teamFeatureHeaders],
    teamFeatureRows.filter((row) => row.training_eligible === true),
  )
  writeCsv(
    join(featuresDir, "training_ready_matchup_features.csv"),
    [...matchupHeaders],
    matchupRows.filter((row) => row.training_eligible === true),
  )
  writeCsv(
    join(featuresDir, "training_ready_post_toss_matchup_features.csv"),
    [...postTossMatchupHeaders],
    postTossMatchupRows.filter((row) => row.training_eligible === true),
  )

  writeFileSync(
    join(featuresDir, "README.md"),
    `# model/data/features\n\nDerived historical feature tables.\n\n- \`pre_match_team_features.csv\`: one row per team per historical match using prior eligible data only\n- \`pre_match_matchup_features.csv\`: one row per match with venue, H2H, gap features, Elo, toss-history features, eligibility flags, and team-level pre-match features\n- \`post_toss_matchup_features.csv\`: one row per match with the same base features plus actual toss-known fields and toss implication features (\`toss_winner\`, \`toss_decision\`, \`team1_bats_first\`, \`team2_bats_first\`, batting-order win-rate gaps, and toss-decision preference alignment)\n- \`training_ready_team_features.csv\`: filtered team-level rows where \`training_eligible=true\`\n- \`training_ready_matchup_features.csv\`: filtered pre-match matchup rows where \`training_eligible=true\`\n- \`training_ready_post_toss_matchup_features.csv\`: filtered post-toss matchup rows where \`training_eligible=true\`\n\nNotes:\n- Team order comes from Cricsheet match info when available, otherwise alphabetical order is used to avoid innings-order leakage.\n- XI continuity and probable-XI strength use the last known XI from the same season before the match as the V1 probable-XI proxy.\n- Continuity weights follow the markdown source of truth: 0.30 top order, 0.30 bowling core, 0.20 death bowlers, 0.20 overall XI.\n- Home/neutral context comes from a static venue mapping with season overrides.\n- Training exclusions currently remove neutral-venue seasons/legs, no-result/tie matches, D/L matches, super-over matches, and unresolved home-context rows.\n- Post-toss datasets are kept separate so toss-known fields do not leak into the pre-toss model matrix.\n`,
    "utf-8",
  )

  const trainingReadyTeamRows = teamFeatureRows.filter((row) => row.training_eligible === true)
  const trainingReadyMatchupRows = matchupRows.filter((row) => row.training_eligible === true)
  const trainingReadyPostTossMatchupRows = postTossMatchupRows.filter((row) => row.training_eligible === true)
  const exclusionCounts = matchupRows.reduce<Record<string, number>>((accumulator, row) => {
    const rawReasons = String(row.training_exclusion_reasons ?? "")
    if (!rawReasons) {
      return accumulator
    }

    for (const reason of rawReasons.split("|")) {
      accumulator[reason] = (accumulator[reason] ?? 0) + 1
    }

    return accumulator
  }, {})

  writeFileSync(
    join(metadataDir, "feature_summary.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        preMatchTeamRows: teamFeatureRows.length,
        preMatchMatchupRows: matchupRows.length,
        postTossMatchupRows: postTossMatchupRows.length,
        trainingReadyTeamRows: trainingReadyTeamRows.length,
        trainingReadyMatchupRows: trainingReadyMatchupRows.length,
        trainingReadyPostTossMatchupRows: trainingReadyPostTossMatchupRows.length,
        exclusionCounts,
        venueMapping: getVenueMappingMetadata(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  console.log("Derived model/data features:")
  console.log(`- team rows: ${teamFeatureRows.length}`)
  console.log(`- matchup rows: ${matchupRows.length}`)
}

main()
