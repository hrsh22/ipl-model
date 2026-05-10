import { normalizeTeamName, normalizeVenueName } from "./aliases.js"

export type TeamVenueContext = "home" | "secondary_home" | "neutral" | "away" | "unknown"

type VenueAssignment = {
  team: string
  venue: string
  startSeason: number
  endSeason?: number
  assignmentType: "primary" | "secondary"
  note?: string
}

type NeutralVenueOverride = {
  season: number
  venues?: string[]
  note: string
}

const PRIMARY_ASSIGNMENTS: VenueAssignment[] = [
  { team: "Chennai Super Kings", venue: "MA Chidambaram Stadium", startSeason: 2008, assignmentType: "primary" },
  { team: "Mumbai Indians", venue: "Wankhede Stadium", startSeason: 2008, assignmentType: "primary" },
  { team: "Royal Challengers Bengaluru", venue: "M Chinnaswamy Stadium", startSeason: 2008, assignmentType: "primary" },
  { team: "Kolkata Knight Riders", venue: "Eden Gardens", startSeason: 2008, assignmentType: "primary" },
  { team: "Rajasthan Royals", venue: "Sawai Mansingh Stadium", startSeason: 2008, assignmentType: "primary" },
  { team: "Delhi Capitals", venue: "Feroz Shah Kotla", startSeason: 2008, endSeason: 2018, assignmentType: "primary" },
  { team: "Delhi Capitals", venue: "Arun Jaitley Stadium", startSeason: 2018, assignmentType: "primary" },
  {
    team: "Punjab Kings",
    venue: "Punjab Cricket Association IS Bindra Stadium, Mohali",
    startSeason: 2008,
    endSeason: 2023,
    assignmentType: "primary",
  },
  {
    team: "Punjab Kings",
    venue: "Maharaja Yadavindra Singh International Cricket Stadium",
    startSeason: 2024,
    assignmentType: "primary",
  },
  { team: "Deccan Chargers", venue: "Rajiv Gandhi International Stadium, Uppal", startSeason: 2008, endSeason: 2012, assignmentType: "primary" },
  { team: "Sunrisers Hyderabad", venue: "Rajiv Gandhi International Stadium, Uppal", startSeason: 2013, assignmentType: "primary" },
  { team: "Pune Warriors India", venue: "Dr DY Patil Sports Academy", startSeason: 2011, endSeason: 2011, assignmentType: "primary" },
  { team: "Pune Warriors India", venue: "Maharashtra Cricket Association Stadium", startSeason: 2012, endSeason: 2013, assignmentType: "primary" },
  { team: "Pune Warriors India", venue: "Subrata Roy Sahara Stadium", startSeason: 2012, endSeason: 2013, assignmentType: "secondary" },
  { team: "Rising Pune Supergiants", venue: "Maharashtra Cricket Association Stadium", startSeason: 2016, endSeason: 2017, assignmentType: "primary" },
  { team: "Gujarat Lions", venue: "Saurashtra Cricket Association Stadium", startSeason: 2016, endSeason: 2017, assignmentType: "primary" },
  { team: "Kochi Tuskers Kerala", venue: "Nehru Stadium", startSeason: 2011, endSeason: 2011, assignmentType: "primary" },
  { team: "Lucknow Super Giants", venue: "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium", startSeason: 2023, assignmentType: "primary" },
  { team: "Gujarat Titans", venue: "Narendra Modi Stadium", startSeason: 2023, assignmentType: "primary" },
]

const SECONDARY_ASSIGNMENTS: VenueAssignment[] = [
  { team: "Chennai Super Kings", venue: "JSCA International Stadium Complex", startSeason: 2014, endSeason: 2014, assignmentType: "secondary" },
  { team: "Mumbai Indians", venue: "Dr DY Patil Sports Academy", startSeason: 2008, endSeason: 2008, assignmentType: "secondary" },
  { team: "Mumbai Indians", venue: "Dr DY Patil Sports Academy", startSeason: 2010, endSeason: 2010, assignmentType: "secondary" },
  { team: "Mumbai Indians", venue: "Brabourne Stadium", startSeason: 2010, endSeason: 2010, assignmentType: "secondary" },
  { team: "Deccan Chargers", venue: "Barabati Stadium", startSeason: 2010, endSeason: 2012, assignmentType: "secondary" },
  { team: "Deccan Chargers", venue: "Vidarbha Cricket Association Stadium, Jamtha", startSeason: 2010, endSeason: 2010, assignmentType: "secondary" },
  { team: "Deccan Chargers", venue: "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium", startSeason: 2012, endSeason: 2012, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Barabati Stadium", startSeason: 2014, endSeason: 2014, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Himachal Pradesh Cricket Association Stadium", startSeason: 2010, endSeason: 2013, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Punjab Cricket Association IS Bindra Stadium, Mohali", startSeason: 2024, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Himachal Pradesh Cricket Association Stadium", startSeason: 2023, assignmentType: "secondary" },
  { team: "Rajasthan Royals", venue: "Sardar Patel Stadium, Motera", startSeason: 2010, endSeason: 2010, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Holkar Cricket Stadium", startSeason: 2018, endSeason: 2018, assignmentType: "secondary" },
  { team: "Rajasthan Royals", venue: "Narendra Modi Stadium", startSeason: 2014, endSeason: 2014, assignmentType: "secondary" },
  { team: "Rajasthan Royals", venue: "Sardar Patel Stadium, Motera", startSeason: 2015, endSeason: 2015, assignmentType: "secondary" },
  { team: "Rising Pune Supergiants", venue: "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium", startSeason: 2016, endSeason: 2016, assignmentType: "secondary" },
  { team: "Gujarat Lions", venue: "Green Park", startSeason: 2016, endSeason: 2017, assignmentType: "secondary" },
  { team: "Punjab Kings", venue: "Holkar Cricket Stadium", startSeason: 2017, endSeason: 2017, assignmentType: "secondary" },
  { team: "Rajasthan Royals", venue: "Barsapara Cricket Stadium", startSeason: 2023, assignmentType: "secondary" },
  { team: "Delhi Capitals", venue: "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium", startSeason: 2024, assignmentType: "secondary" },
  { team: "Delhi Capitals", venue: "Shaheed Veer Narayan Singh International Stadium", startSeason: 2013, endSeason: 2016, assignmentType: "secondary" },
  { team: "Sunrisers Hyderabad", venue: "Dr Y.S. Rajasekhara Reddy ACA-VDCA Cricket Stadium", startSeason: 2015, endSeason: 2015, assignmentType: "secondary" },
  { team: "Kolkata Knight Riders", venue: "JSCA International Stadium Complex", startSeason: 2013, endSeason: 2013, assignmentType: "secondary" },
  { team: "Chennai Super Kings", venue: "Maharashtra Cricket Association Stadium", startSeason: 2018, endSeason: 2018, assignmentType: "secondary" },
]

const FULLY_NEUTRAL_SEASONS = new Map<number, string>([
  [2009, "Entire tournament in South Africa"],
  [2020, "Entire tournament in UAE"],
  [2021, "Centralized venues and UAE leg"],
  [2022, "Centralized league stage and neutral playoffs"],
])

const PARTIAL_NEUTRAL_OVERRIDES: NeutralVenueOverride[] = [
  {
    season: 2014,
    venues: ["Sheikh Zayed Stadium", "Dubai International Cricket Stadium", "Sharjah Cricket Stadium"],
    note: "Opening 2014 UAE leg",
  },
  {
    season: 2026,
    venues: ["Shaheed Veer Narayan Singh International Stadium"],
    note: "Raipur-hosted 2026 fixtures outside both participating teams' home bases",
  },
]

const ALL_ASSIGNMENTS = [...PRIMARY_ASSIGNMENTS, ...SECONDARY_ASSIGNMENTS].map((entry) => ({
  ...entry,
  team: normalizeTeamName(entry.team),
  venue: normalizeVenueName(entry.venue),
}))

const NEUTRAL_OVERRIDES = PARTIAL_NEUTRAL_OVERRIDES.map((entry) => ({
  ...entry,
  venues: entry.venues?.map((venue) => normalizeVenueName(venue)),
}))

const isSeasonMatch = (season: number, assignment: VenueAssignment) =>
  season >= assignment.startSeason && season <= (assignment.endSeason ?? Number.MAX_SAFE_INTEGER)

export const resolveTeamVenueContext = (team: string, venue: string, season: number): TeamVenueContext => {
  const normalizedTeam = normalizeTeamName(team)
  const normalizedVenue = normalizeVenueName(venue)

  if (FULLY_NEUTRAL_SEASONS.has(season)) {
    return "neutral"
  }

  const neutralOverride = NEUTRAL_OVERRIDES.find(
    (entry) => entry.season === season && entry.venues?.includes(normalizedVenue),
  )
  if (neutralOverride) {
    return "neutral"
  }

  const directAssignment = ALL_ASSIGNMENTS.find(
    (entry) => entry.team === normalizedTeam && entry.venue === normalizedVenue && isSeasonMatch(season, entry),
  )
  if (directAssignment) {
    return directAssignment.assignmentType === "primary" ? "home" : "secondary_home"
  }

  const otherAssignment = ALL_ASSIGNMENTS.some(
    (entry) => entry.venue === normalizedVenue && entry.team !== normalizedTeam && isSeasonMatch(season, entry),
  )
  if (otherAssignment) {
    return "away"
  }

  return "unknown"
}

export const inferHomeTeam = (teams: string[], venue: string, season: number): string | null => {
  const normalizedTeams = teams.map((team) => normalizeTeamName(team))
  const primaryHome = normalizedTeams.find((team) => resolveTeamVenueContext(team, venue, season) === "home")
  if (primaryHome) {
    return primaryHome
  }

  return normalizedTeams.find((team) => resolveTeamVenueContext(team, venue, season) === "secondary_home") ?? null
}

export const getVenueMappingMetadata = () => ({
  primaryAssignments: ALL_ASSIGNMENTS.filter((entry) => entry.assignmentType === "primary"),
  secondaryAssignments: ALL_ASSIGNMENTS.filter((entry) => entry.assignmentType === "secondary"),
  fullNeutralSeasons: Object.fromEntries(FULLY_NEUTRAL_SEASONS.entries()),
  partialNeutralOverrides: NEUTRAL_OVERRIDES,
})
