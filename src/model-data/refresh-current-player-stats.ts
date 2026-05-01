import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeTeamName } from "./aliases.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

type IplCompetitionPayload = {
  competition?: Array<{
    CompetitionID: number | string
    CompetitionName: string
    DivisionName?: string
  }>
}

type IplScheduleRow = {
  MatchID?: number | string
  MatchStatus?: string
  MatchDate?: string
  GMTMatchDate?: string
  HomeTeamName?: string
  AwayTeamName?: string
  GroundName?: string
  WinningTeamID?: string | number | null
}

type OfficialSquadPlayer = {
  TeamID?: string | number | null
  TeamName?: string
  PlayerName?: string
  PlayerSkill?: string
  IsWK?: string | number | null
}

type OfficialInningsBattingRow = {
  TeamID?: string | number | null
  PlayerName?: string
  PlayingOrder?: string | number | null
  Runs?: string | number | null
  Balls?: string | number | null
  Fours?: string | number | null
  Sixes?: string | number | null
  OutDesc?: string
}

type OfficialInningsBowlingRow = {
  TeamID?: string | number | null
  PlayerName?: string
  Overs?: string | number | null
  Runs?: string | number | null
  Wickets?: string | number | null
  DotBalls?: string | number | null
  TotalLegalBallsBowled?: string | number | null
}

type OfficialOverBall = {
  BowlerName?: string
  TeamName?: string
  OverNo?: string | number | null
  IsWide?: string | number | null
  IsNoBall?: string | number | null
}

type OfficialInningsPayload = {
  BattingCard?: OfficialInningsBattingRow[]
  BowlingCard?: OfficialInningsBowlingRow[]
  OverHistory?: OfficialOverBall[]
}

const IPLT20_COMPETITION_URL = "https://scores.iplt20.com/ipl/mc/competition.js"
const IPLT20_SCHEDULE_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{competition_id}-matchschedule.js"
const IPLT20_SQUAD_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-squad.js"
const IPLT20_MATCHSUMMARY_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-matchsummary.js"
const IPLT20_INNINGS_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-Innings{innings}.js"

const rootDir = process.cwd()
const liveDir = join(rootDir, "model", "data", "live")
const currentSeasonPlayerStatsPath = join(liveDir, "current_season_player_match_stats.csv")

const clean = (value: string | null | undefined) => value?.trim() ?? ""
const normalizeLookup = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const normalizePlayerName = (value: string) => clean(value).replace(/\s*\((?:c|wk|vc|ip|rp)\)\s*/gi, " ").trim()
const parseInteger = (value: string | number | null | undefined) => Number.parseInt(String(value ?? "0"), 10) || 0
const parseFloatValue = (value: string | number | null | undefined) => {
  const parsed = Number.parseFloat(String(value ?? "0"))
  return Number.isFinite(parsed) ? parsed : 0
}

const extractJsonpPayload = <T>(text: string, callbackName: string) => {
  const trimmed = text.trim()
  const prefix = `${callbackName}(`
  if (trimmed.startsWith(prefix) && trimmed.endsWith(")")) {
    return JSON.parse(trimmed.slice(prefix.length, -1)) as T
  }
  if (trimmed.startsWith(prefix) && trimmed.endsWith(");")) {
    return JSON.parse(trimmed.slice(prefix.length, -2)) as T
  }
  const pattern = new RegExp(`${callbackName}\\((.*)\\)\\s*;?$`, "s")
  const match = trimmed.match(pattern)
  if (!match) {
    throw new Error(`Unable to parse JSONP payload for ${callbackName}`)
  }
  return JSON.parse(match[1] ?? "{}") as T
}

const csvEscape = (value: CsvScalar): string => {
  if (value === null || value === undefined) return ""
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

const fetchOfficialCompetitionId = async (seasonYear: number) => {
  const response = await fetch(IPLT20_COMPETITION_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  if (!response.ok) {
    throw new Error(`IPL competition request failed with ${response.status}`)
  }

  const payload = extractJsonpPayload<IplCompetitionPayload>(await response.text(), "oncomptetion")
  const competition = (payload.competition ?? []).find((entry) =>
    clean(entry.DivisionName).toUpperCase() === "IPL" && clean(entry.CompetitionName).includes(String(seasonYear)),
  )

  if (!competition) {
    throw new Error(`Unable to find IPL competition for season ${seasonYear}`)
  }

  return String(competition.CompetitionID)
}

const fetchOfficialSchedule = async (seasonYear: number) => {
  const competitionId = await fetchOfficialCompetitionId(seasonYear)
  const url = IPLT20_SCHEDULE_URL_TEMPLATE.replace("{competition_id}", competitionId)
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  if (!response.ok) {
    throw new Error(`IPL schedule request failed with ${response.status}`)
  }

  const payload = extractJsonpPayload<{ Matchsummary?: IplScheduleRow[] }>(await response.text(), "MatchSchedule")
  return payload.Matchsummary ?? []
}

const fetchOfficialSquads = async (matchId: string) => {
  const url = IPLT20_SQUAD_URL_TEMPLATE.replace("{match_id}", matchId)
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  if (!response.ok) {
    throw new Error(`IPL squad request failed with ${response.status}`)
  }
  const payload = extractJsonpPayload<{ squadA?: OfficialSquadPlayer[]; squadB?: OfficialSquadPlayer[] }>(await response.text(), "onsquad")
  return { squadA: payload.squadA ?? [], squadB: payload.squadB ?? [] }
}

const fetchOfficialMatchSummary = async (matchId: string) => {
  const url = IPLT20_MATCHSUMMARY_URL_TEMPLATE.replace("{match_id}", matchId)
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  if (!response.ok) {
    throw new Error(`IPL match summary request failed with ${response.status}`)
  }
  return extractJsonpPayload<{ MatchSummary?: Array<Record<string, unknown>> }>(await response.text(), "onScoringMatchsummary")
}

const fetchOfficialInnings = async (matchId: string, innings: number) => {
  const url = IPLT20_INNINGS_URL_TEMPLATE.replace("{match_id}", matchId).replace("{innings}", String(innings))
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
  if (!response.ok) {
    throw new Error(`IPL innings request failed with ${response.status}`)
  }
  const payload = extractJsonpPayload<Record<string, OfficialInningsPayload>>(await response.text(), "onScoring")
  return payload[`Innings${innings}`] ?? null
}

const isCompletedOfficialRow = (row: IplScheduleRow) => {
  const status = normalizeLookup(clean(row.MatchStatus))
  return status.includes("post") || status.includes("result") || clean(String(row.WinningTeamID ?? "")).length > 0
}

const canonicalRoleFromSquad = (player: OfficialSquadPlayer) => {
  const playerSkill = normalizeLookup(String(player.PlayerSkill ?? ""))
  const isWk = String(player.IsWK ?? "0") === "1"
  if (isWk) return "keeper_batter"
  if (playerSkill.includes("all rounder") || playerSkill.includes("allrounder")) return "all_rounder"
  if (playerSkill.includes("bowler")) return "bowler"
  return "batter"
}

const buildSquadMaps = (squads: { squadA: OfficialSquadPlayer[]; squadB: OfficialSquadPlayer[] }) => {
  const teamById = new Map<string, { teamRaw: string; team: string }>()
  const playerByTeamKey = new Map<string, OfficialSquadPlayer>()

  for (const player of [...squads.squadA, ...squads.squadB]) {
    const teamId = clean(String(player.TeamID ?? ""))
    const teamRaw = clean(player.TeamName)
    const team = normalizeTeamName(teamRaw)
    const playerName = normalizePlayerName(String(player.PlayerName ?? ""))
    if (teamId) {
      teamById.set(teamId, { teamRaw, team })
    }
    if (team && playerName) {
      playerByTeamKey.set(`${team}::${normalizeLookup(playerName)}`, player)
    }
  }

  return { teamById, playerByTeamKey }
}

const createEmptyPlayerRow = (
  matchId: string,
  seasonYear: number,
  matchDate: string,
  teamRaw: string,
  team: string,
  playerName: string,
  role: string,
) => ({
  match_id: matchId,
  season: seasonYear,
  match_date: matchDate,
  team_raw: teamRaw,
  team,
  player_name: playerName,
  batting_position: 0,
  role,
  batting_runs: 0,
  batting_balls: 0,
  fours: 0,
  sixes: 0,
  dismissed: 0,
  bowling_balls: 0,
  death_bowling_balls: 0,
  overs_bowled: 0,
  runs_conceded: 0,
  wickets: 0,
  dot_balls_bowled: 0,
})

const main = async () => {
  const seasonYear = new Date().getUTCFullYear()
  mkdirSync(liveDir, { recursive: true })

  const scheduleRows = await fetchOfficialSchedule(seasonYear)
  const completedRows = scheduleRows.filter((row) => clean(String(row.MatchID ?? "")) && isCompletedOfficialRow(row))
  const outputRows: CsvRow[] = []

  for (const row of completedRows) {
    const matchId = clean(String(row.MatchID ?? ""))
    const matchDate = clean(row.MatchDate || row.GMTMatchDate)

    try {
      await fetchOfficialMatchSummary(matchId)
      const squads = await fetchOfficialSquads(matchId)
      const inningsPayloads = (
        await Promise.all([fetchOfficialInnings(matchId, 1), fetchOfficialInnings(matchId, 2)])
      ).filter(Boolean) as OfficialInningsPayload[]

      const { teamById, playerByTeamKey } = buildSquadMaps(squads)
      const playerRows = new Map<string, CsvRow>()

      for (const innings of inningsPayloads) {
        for (const batting of innings.BattingCard ?? []) {
          const teamMeta = teamById.get(clean(String(batting.TeamID ?? "")))
          const playerName = normalizePlayerName(String(batting.PlayerName ?? ""))
          if (!teamMeta || !playerName) continue
          const key = `${teamMeta.team}::${normalizeLookup(playerName)}`
          const squadPlayer = playerByTeamKey.get(key)
          const rowData = playerRows.get(key) ?? createEmptyPlayerRow(matchId, seasonYear, matchDate, teamMeta.teamRaw, teamMeta.team, playerName, canonicalRoleFromSquad(squadPlayer ?? {}))
          rowData.batting_position = parseInteger(batting.PlayingOrder)
          rowData.batting_runs = parseInteger(batting.Runs)
          rowData.batting_balls = parseInteger(batting.Balls)
          rowData.fours = parseInteger(batting.Fours)
          rowData.sixes = parseInteger(batting.Sixes)
          const outDesc = clean(batting.OutDesc)
          rowData.dismissed = outDesc && !normalizeLookup(outDesc).includes("not out") ? 1 : 0
          if (Number(rowData.batting_balls) > 0 && Number(rowData.bowling_balls) > 0) {
            rowData.role = "all_rounder"
          } else if (Number(rowData.batting_balls) > 0) {
            rowData.role = rowData.role === "bowler" ? "all_rounder" : rowData.role
          }
          playerRows.set(key, rowData)
        }

        const deathBallsByBowler = new Map<string, number>()
        for (const ball of innings.OverHistory ?? []) {
          const overNo = parseInteger(ball.OverNo)
          const bowlerName = normalizePlayerName(String(ball.BowlerName ?? ""))
          if (!bowlerName || overNo < 16) continue
          if (String(ball.IsWide ?? "0") === "1" || String(ball.IsNoBall ?? "0") === "1") continue
          const key = normalizeLookup(bowlerName)
          deathBallsByBowler.set(key, (deathBallsByBowler.get(key) ?? 0) + 1)
        }

        for (const bowling of innings.BowlingCard ?? []) {
          const teamMeta = teamById.get(clean(String(bowling.TeamID ?? "")))
          const playerName = normalizePlayerName(String(bowling.PlayerName ?? ""))
          if (!teamMeta || !playerName) continue
          const key = `${teamMeta.team}::${normalizeLookup(playerName)}`
          const squadPlayer = playerByTeamKey.get(key)
          const rowData = playerRows.get(key) ?? createEmptyPlayerRow(matchId, seasonYear, matchDate, teamMeta.teamRaw, teamMeta.team, playerName, canonicalRoleFromSquad(squadPlayer ?? {}))
          rowData.bowling_balls = parseInteger(bowling.TotalLegalBallsBowled)
          rowData.death_bowling_balls = deathBallsByBowler.get(normalizeLookup(playerName)) ?? 0
          rowData.overs_bowled = parseFloatValue(bowling.Overs)
          rowData.runs_conceded = parseInteger(bowling.Runs)
          rowData.wickets = parseInteger(bowling.Wickets)
          rowData.dot_balls_bowled = parseInteger(bowling.DotBalls)
          rowData.role = Number(rowData.batting_balls) > 0 ? "all_rounder" : "bowler"
          playerRows.set(key, rowData)
        }
      }

      outputRows.push(...Array.from(playerRows.values()))
    } catch (error) {
      console.warn(`Skipping player stat refresh for match ${matchId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  outputRows.sort((left, right) => {
    const dateCompare = String(left.match_date).localeCompare(String(right.match_date))
    if (dateCompare !== 0) return dateCompare
    const matchCompare = String(left.match_id).localeCompare(String(right.match_id))
    if (matchCompare !== 0) return matchCompare
    const teamCompare = String(left.team).localeCompare(String(right.team))
    if (teamCompare !== 0) return teamCompare
    return String(left.player_name).localeCompare(String(right.player_name))
  })

  writeCsv(
    currentSeasonPlayerStatsPath,
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
    outputRows,
  )

  console.log(`Refreshed current season player match stats: ${outputRows.length} rows across ${completedRows.length} completed matches`)
}

void main()
