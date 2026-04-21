import "dotenv/config"

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeCityName, normalizeTeamName, normalizeVenueName } from "./aliases.js"
import { inferHomeTeam, resolveTeamVenueContext } from "./venue-mapping.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

type OpticOddsFixture = {
  id: string
  game_id: string
  start_date: string
  status: string
  is_live: boolean
  home_team_display: string
  away_team_display: string
  venue_name?: string | null
  venue_location?: string | null
  league: { name: string }
}

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
  WinningTeamID?: string | number | null
}

const OPTICODDS_BASE_URL = "https://api.opticodds.com/api/v3"
const IPL_LEAGUE_NAME = "India - IPL"
const IPLT20_COMPETITION_URL = "https://scores.iplt20.com/ipl/mc/competition.js"
const IPLT20_SCHEDULE_URL_TEMPLATE = "https://scores.iplt20.com/ipl/feeds/{competition_id}-matchschedule.js"
const STATUS_REFRESH_GRACE_MS = 6 * 60 * 60 * 1000

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
  const payload = match[1]
  if (!payload) {
    throw new Error(`Empty JSONP payload for ${callbackName}`)
  }
  return JSON.parse(payload) as T
}

const officialMatchKey = (matchDate: string, venue: string, team1: string, team2: string) =>
  [matchDate, normalizeLookup(venue), [normalizeLookup(team1), normalizeLookup(team2)].sort().join("::")].join("::")

const officialMatchFallbackKey = (matchDate: string, team1: string, team2: string) =>
  [matchDate, [normalizeLookup(team1), normalizeLookup(team2)].sort().join("::")].join("::")

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

const buildOfficialScheduleIndex = async (seasonYear: number) => {
  const rows = await fetchOfficialSchedule(seasonYear)
  const byExactKey = new Map(
    rows.map((row) => {
      const matchDate = clean(row.MatchDate || row.GMTMatchDate)
      const venue = normalizeVenueName(clean(row.GroundName))
      const team1 = normalizeTeamName(clean(row.HomeTeamName))
      const team2 = normalizeTeamName(clean(row.AwayTeamName))
      return [officialMatchKey(matchDate, venue, team1, team2), row] as const
    }),
  )

  const byFallbackKey = new Map(
    rows.map((row) => {
      const matchDate = clean(row.MatchDate || row.GMTMatchDate)
      const team1 = normalizeTeamName(clean(row.HomeTeamName))
      const team2 = normalizeTeamName(clean(row.AwayTeamName))
      return [officialMatchFallbackKey(matchDate, team1, team2), row] as const
    }),
  )

  return {
    byExactKey,
    byFallbackKey,
  }
}

const deriveStatusFromOfficial = (officialRow: IplScheduleRow | undefined, fallbackStatus: string, fallbackIsLive: boolean, matchDate: Date, now: number) => {
  const officialStatus = normalizeLookup(clean(officialRow?.MatchStatus))

  if (officialStatus.includes("live")) {
    return {
      status: "live",
      isLive: true,
      isCompleted: false,
      statusSource: "ipl_official",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  if (officialStatus.includes("post") || officialStatus.includes("result") || clean(String(officialRow?.WinningTeamID ?? "")).length > 0) {
    return {
      status: "completed",
      isLive: false,
      isCompleted: true,
      statusSource: "ipl_official",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  if (officialStatus.includes("fixture") || officialStatus.includes("pre") || officialStatus.includes("upcoming")) {
    return {
      status: "scheduled",
      isLive: false,
      isCompleted: false,
      statusSource: "ipl_official",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  const fallbackStatusKey = normalizeLookup(fallbackStatus)
  if (fallbackIsLive) {
    return {
      status: "live",
      isLive: true,
      isCompleted: false,
      statusSource: "opticodds",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  if (["completed", "complete", "closed", "final", "ended", "finished", "result", "post"].includes(fallbackStatusKey)) {
    return {
      status: "completed",
      isLive: false,
      isCompleted: true,
      statusSource: "opticodds",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  if (matchDate.getTime() < now - STATUS_REFRESH_GRACE_MS) {
    return {
      status: "completed",
      isLive: false,
      isCompleted: true,
      statusSource: "time_fallback",
      officialMatchId: clean(String(officialRow?.MatchID ?? "")),
    }
  }

  return {
    status: "scheduled",
    isLive: false,
    isCompleted: false,
    statusSource: officialRow ? "ipl_official" : "opticodds",
    officialMatchId: clean(String(officialRow?.MatchID ?? "")),
  }
}

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

const deriveCity = (venueLocation: string) => {
  const firstSegment = clean(venueLocation).split(",")[0] ?? ""
  return normalizeCityName(firstSegment)
}

const main = async () => {
  const apiKey = process.env.OPTICODDS_API_KEY
  if (!apiKey) {
    throw new Error("OPTICODDS_API_KEY is required to fetch upcoming IPL fixtures")
  }

  mkdirSync(liveDir, { recursive: true })

  const url = new URL(`${OPTICODDS_BASE_URL}/fixtures/active`)
  url.searchParams.append("sport", "cricket")
  url.searchParams.append("league", IPL_LEAGUE_NAME)

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`OpticOdds fixtures request failed with ${response.status}`)
  }

  const payload = (await response.json()) as { data?: OpticOddsFixture[] }
  const now = Date.now()
  const officialScheduleByMatch = await buildOfficialScheduleIndex(new Date().getUTCFullYear())
  const fixtures = (payload.data ?? [])
    .filter((fixture) => fixture.league.name === IPL_LEAGUE_NAME)
    .map((fixture) => {
      const matchDate = new Date(fixture.start_date)
      const venue = normalizeVenueName(clean(fixture.venue_name))
      const city = deriveCity(clean(fixture.venue_location))
      const team1 = normalizeTeamName(clean(fixture.home_team_display))
      const team2 = normalizeTeamName(clean(fixture.away_team_display))
      const officialMatchDate = matchDate.toISOString().slice(0, 10)
      const officialRow =
        officialScheduleByMatch.byExactKey.get(
          officialMatchKey(officialMatchDate, venue, team1, team2),
        ) ??
        officialScheduleByMatch.byFallbackKey.get(
          officialMatchFallbackKey(officialMatchDate, team1, team2),
        )
      const statusState = deriveStatusFromOfficial(officialRow, fixture.status, fixture.is_live, matchDate, now)
      const inferredHomeTeam = inferHomeTeam([team1, team2], venue, matchDate.getUTCFullYear())
      const team1Context = resolveTeamVenueContext(team1, venue, matchDate.getUTCFullYear())
      const team2Context = resolveTeamVenueContext(team2, venue, matchDate.getUTCFullYear())

      return {
        fixture_id: fixture.id,
        opticodds_game_id: fixture.game_id,
        match_date: matchDate.toISOString(),
        status: statusState.status,
        is_live: statusState.isLive,
        is_completed: statusState.isCompleted,
        status_source: statusState.statusSource,
        official_match_id: statusState.officialMatchId,
        venue,
        venue_location: clean(fixture.venue_location),
        city,
        team1,
        team2,
        home_team_from_feed: team1,
        away_team_from_feed: team2,
        inferred_home_team: inferredHomeTeam ?? "",
        team1_home_context: team1Context,
        team2_home_context: team2Context,
        match_neutral_flag: team1Context === "neutral" || team2Context === "neutral",
      }
    })
    .sort((left, right) => new Date(left.match_date).getTime() - new Date(right.match_date).getTime())

  const upcomingFixtures = fixtures.filter((fixture) => !fixture.is_completed)

  writeCsv(
    join(liveDir, "active_fixtures.csv"),
    [
      "fixture_id",
      "opticodds_game_id",
      "match_date",
      "status",
      "is_live",
      "is_completed",
      "status_source",
      "official_match_id",
      "venue",
      "venue_location",
      "city",
      "team1",
      "team2",
      "home_team_from_feed",
      "away_team_from_feed",
      "inferred_home_team",
      "team1_home_context",
      "team2_home_context",
      "match_neutral_flag",
    ],
    fixtures,
  )

  writeCsv(
    join(liveDir, "upcoming_fixtures.csv"),
    [
      "fixture_id",
      "opticodds_game_id",
      "match_date",
      "status",
      "is_live",
      "is_completed",
      "status_source",
      "official_match_id",
      "venue",
      "venue_location",
      "city",
      "team1",
      "team2",
      "home_team_from_feed",
      "away_team_from_feed",
      "inferred_home_team",
      "team1_home_context",
      "team2_home_context",
      "match_neutral_flag",
    ],
    upcomingFixtures,
  )

  writeFileSync(join(liveDir, "active_fixtures.json"), `${JSON.stringify(fixtures, null, 2)}\n`, "utf-8")
  writeFileSync(join(liveDir, "upcoming_fixtures.json"), `${JSON.stringify(upcomingFixtures, null, 2)}\n`, "utf-8")

  console.log("Fetched IPL fixture datasets:")
  console.log(`- active fixtures: ${fixtures.length}`)
  console.log(`- upcoming fixtures: ${upcomingFixtures.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
