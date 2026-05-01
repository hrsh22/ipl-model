import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeCityName, normalizeTeamName, normalizeVenueName } from "./aliases.js"

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
  city?: string
  Comments?: string
  Commentss?: string
  FirstBattingTeamName?: string
  SecondBattingTeamName?: string
  FirstBattingSummary?: string
  SecondBattingSummary?: string
  TossTeam?: string
  TossDetails?: string
}

const IPLT20_COMPETITION_URL = "https://scores.iplt20.com/ipl/mc/competition.js"
const IPLT20_SCHEDULE_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{competition_id}-matchschedule.js"

const rootDir = process.cwd()
const liveDir = join(rootDir, "model", "data", "live")

const clean = (value: string | null | undefined) => value?.trim() ?? ""
const normalizeLookup = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

const extractJsonpPayload = <T>(text: string, callbackName: string) => {
  const pattern = new RegExp(`${callbackName}\\((.*)\\)\\s*;?$`, "s")
  const match = text.match(pattern)
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

const parseOversToBalls = (summary: string) => {
  const oversMatch = summary.match(/\((\d+)\.(\d)\s*Ov|\((\d+)\.(\d)\s*Overs/i)
  if (!oversMatch) return 0
  const overs = Number.parseInt((oversMatch[1] || oversMatch[3] || "0"), 10)
  const balls = Number.parseInt((oversMatch[2] || oversMatch[4] || "0"), 10)
  return overs * 6 + balls
}

const parseMargin = (comments: string) => {
  const runsMatch = comments.match(/won by\s+(\d+)\s+runs?/i)
  if (runsMatch) {
    return {
      resultType: "won",
      winnerRuns: Number.parseInt(runsMatch[1] ?? "0", 10),
      winnerWickets: 0,
    }
  }

  const wicketsMatch = comments.match(/won by\s+(\d+)\s+wickets?/i)
  if (wicketsMatch) {
    return {
      resultType: "won",
      winnerRuns: 0,
      winnerWickets: Number.parseInt(wicketsMatch[1] ?? "0", 10),
    }
  }

  if (/no result/i.test(comments)) {
    return { resultType: "no result", winnerRuns: 0, winnerWickets: 0 }
  }
  if (/tie/i.test(comments)) {
    return { resultType: "tie", winnerRuns: 0, winnerWickets: 0 }
  }
  return { resultType: "unknown", winnerRuns: 0, winnerWickets: 0 }
}

const parseWinner = (comments: string, team1: string, team2: string) => {
  const commentsKey = normalizeLookup(comments)
  const normalizedTeam1 = normalizeLookup(team1)
  const normalizedTeam2 = normalizeLookup(team2)
  if (commentsKey.includes(normalizedTeam1)) return team1
  if (commentsKey.includes(normalizedTeam2)) return team2
  return ""
}

const parseMethod = (comments: string, tossDetails: string) => {
  const combined = `${comments} ${tossDetails}`
  if (/dls|duckworth|lewis|stern/i.test(combined)) {
    return "DLS"
  }
  return ""
}

const deriveBallsRemaining = (winner: string, secondBattingTeam: string, secondBattingSummary: string, winnerWickets: number) => {
  if (!winner || !secondBattingSummary || winnerWickets <= 0) return 0
  if (normalizeLookup(winner) !== normalizeLookup(secondBattingTeam)) return 0
  return Math.max(0, 120 - parseOversToBalls(secondBattingSummary))
}

const main = async () => {
  const seasonYear = new Date().getUTCFullYear()
  mkdirSync(liveDir, { recursive: true })
  const rows = await fetchOfficialSchedule(seasonYear)

  const completedRows = rows
    .filter((row) => {
      const status = normalizeLookup(clean(row.MatchStatus))
      return status.includes("post") || status.includes("result")
    })
    .map((row) => {
      const team1 = normalizeTeamName(clean(row.HomeTeamName))
      const team2 = normalizeTeamName(clean(row.AwayTeamName))
      const comments = clean(row.Commentss || row.Comments)
      const winner = normalizeTeamName(parseWinner(comments, team1, team2))
      const { resultType, winnerRuns, winnerWickets } = parseMargin(comments)
      const secondBattingTeam = normalizeTeamName(clean(row.SecondBattingTeamName))
      const secondBattingSummary = clean(row.SecondBattingSummary)

      return {
        match_id: clean(String(row.MatchID ?? "")),
        season: seasonYear,
        match_date: clean(row.MatchDate || row.GMTMatchDate),
        venue: normalizeVenueName(clean(row.GroundName)),
        city: normalizeCityName(clean(row.city)),
        team1,
        team2,
        winner,
        result_type: resultType,
        method: parseMethod(comments, clean(row.TossDetails)),
        superover_winner: /super over/i.test(comments) ? winner : "",
        winner_runs: winnerRuns,
        winner_wickets: winnerWickets,
        balls_remaining_in_chase: deriveBallsRemaining(winner, secondBattingTeam, secondBattingSummary, winnerWickets),
        source: "ipl_official",
      }
    })
    .filter((row) => row.result_type === "won" && clean(row.winner).length > 0)
    .sort((left, right) => left.match_date.localeCompare(right.match_date) || left.match_id.localeCompare(right.match_id))

  writeCsv(
    join(liveDir, `completed_results_${seasonYear}.csv`),
    [
      "match_id",
      "season",
      "match_date",
      "venue",
      "city",
      "team1",
      "team2",
      "winner",
      "result_type",
      "method",
      "superover_winner",
      "winner_runs",
      "winner_wickets",
      "balls_remaining_in_chase",
      "source",
    ],
    completedRows,
  )

  console.log(`Refreshed completed IPL ${seasonYear} results: ${completedRows.length} matches`) 
}

void main()
