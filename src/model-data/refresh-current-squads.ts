import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeTeamName, normalizeVenueName } from "./aliases.js"

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
  PlayerName?: string
  PlayingOrder?: string | number | null
}

const IPLT20_COMPETITION_URL = "https://scores.iplt20.com/ipl/mc/competition.js"
const IPLT20_SCHEDULE_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{competition_id}-matchschedule.js"
const IPLT20_SQUAD_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{match_id}-squad.js"

const rootDir = process.cwd()
const liveDir = join(rootDir, "model", "data", "live")
const currentSeasonSquadsPath = join(liveDir, "current_season_match_squads.csv")

const clean = (value: string | null | undefined) => value?.trim() ?? ""
const normalizeLookup = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

const extractJsonpPayload = <T>(text: string, callbackName: string) => {
  const trimmed = text.trim()
  const prefix = `${callbackName}(`
  if (trimmed.startsWith(prefix) && trimmed.endsWith(")")) {
    return JSON.parse(trimmed.slice(prefix.length, -1)) as T
  }

  if (trimmed.startsWith(prefix) && trimmed.endsWith(");")) {
    return JSON.parse(trimmed.slice(prefix.length, -2)) as T
  }

  const pattern = new RegExp(`${callbackName}\((.*)\)\s*;?$`, "s")
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
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  if (!response.ok) {
    throw new Error(`IPL squad request failed with ${response.status}`)
  }

  const payload = extractJsonpPayload<{ squadA?: OfficialSquadPlayer[]; squadB?: OfficialSquadPlayer[] }>(
    await response.text(),
    "onsquad",
  )

  return {
    squadA: payload.squadA ?? [],
    squadB: payload.squadB ?? [],
  }
}

const officialPlayerHasMarker = (player: OfficialSquadPlayer, marker: string) =>
  Boolean(String(player.PlayerName ?? "").match(new RegExp(`\\(${marker}\\)`, "i")))

const officialPlayerName = (player: OfficialSquadPlayer) =>
  clean(String(player.PlayerName ?? "")).replace(/\s*\((?:c|wk|vc|ip|rp)\)\s*/gi, " ").trim()

const officialPlayingOrder = (player: OfficialSquadPlayer) => {
  const parsed = Number.parseInt(String(player.PlayingOrder ?? "99"), 10)
  return Number.isFinite(parsed) ? parsed : 99
}

const parseConfirmedXi = (players: OfficialSquadPlayer[]) =>
  players
    .slice()
    .sort((left, right) => officialPlayingOrder(left) - officialPlayingOrder(right))
    .filter((player) => officialPlayingOrder(player) <= 11 && !officialPlayerHasMarker(player, "ip"))
    .map((player) => officialPlayerName(player))
    .filter(Boolean)

const isCompletedOfficialRow = (row: IplScheduleRow) => {
  const status = normalizeLookup(clean(row.MatchStatus))
  return status.includes("post") || status.includes("result") || clean(String(row.WinningTeamID ?? "")).length > 0
}

const main = async () => {
  const seasonYear = new Date().getUTCFullYear()
  mkdirSync(liveDir, { recursive: true })

  const rows = await fetchOfficialSchedule(seasonYear)
  const completedRows = rows.filter((row) => clean(String(row.MatchID ?? "")) && isCompletedOfficialRow(row))
  const outputRows: CsvRow[] = []
  const dedupe = new Set<string>()

  for (const row of completedRows) {
    const matchId = clean(String(row.MatchID ?? ""))
    try {
      const squads = await fetchOfficialSquads(matchId)
      const teamRows = [
        {
          teamRaw: clean(row.HomeTeamName),
          team: normalizeTeamName(clean(row.HomeTeamName)),
          players: parseConfirmedXi(squads.squadA),
        },
        {
          teamRaw: clean(row.AwayTeamName),
          team: normalizeTeamName(clean(row.AwayTeamName)),
          players: parseConfirmedXi(squads.squadB),
        },
      ]

      for (const teamRow of teamRows) {
        for (const playerName of teamRow.players) {
          const key = [matchId, teamRow.team, playerName].join("::")
          if (dedupe.has(key)) continue
          dedupe.add(key)
          outputRows.push({
            match_id: matchId,
            season: seasonYear,
            match_date: clean(row.MatchDate || row.GMTMatchDate),
            team_raw: teamRow.teamRaw,
            team: teamRow.team,
            player_name: playerName,
            venue: normalizeVenueName(clean(row.GroundName)),
          })
        }
      }
    } catch (error) {
      console.warn(`Skipping squad refresh for match ${matchId}: ${error instanceof Error ? error.message : String(error)}`)
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
    currentSeasonSquadsPath,
    ["match_id", "season", "match_date", "team_raw", "team", "player_name", "venue"],
    outputRows,
  )

  console.log(`Refreshed current season squads: ${outputRows.length} rows across ${completedRows.length} completed matches`)
}

void main()
