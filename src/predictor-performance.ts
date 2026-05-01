import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { parse as parseCsv } from "csv-parse/sync"
import { normalizeCityName, normalizeTeamName, normalizeVenueName } from "./model-data/aliases.js"
import { inferHomeTeam, resolveTeamVenueContext } from "./model-data/venue-mapping.js"

type CsvScalar = string | number | boolean | null | undefined

type PredictorRequestProfile = "automatic" | "manual"
type PredictorMode = "pre_toss" | "post_toss"
type PredictorLineupSource = "none" | "suggested" | "manual"

type PredictorRequestSnapshot = {
  fixtureId: string
  mode: PredictorMode
  tossWinner: string | null
  tossDecision: string | null
  team1ProbableXi: string[]
  team2ProbableXi: string[]
  probableXiSource: PredictorLineupSource
  featureOverrides: Record<string, unknown> | null
}

type PredictorResponseSnapshot = {
  fixture_id: string
  opticodds_game_id?: string | null
  mode: PredictorMode
  match_date: string
  fixture_status: string
  fixture_is_live: boolean
  team1: string
  team2: string
  venue: string
  team1_win_probability: number
  team2_win_probability: number
  fair_price_team1_cents?: number | null
  fair_price_team2_cents?: number | null
  predicted_winner: string
  market_overlay?: {
    team1_market_probability?: number | null
    team2_market_probability?: number | null
    team1_edge_vs_market?: number | null
    team2_edge_vs_market?: number | null
  } | null
  sportsbook_overlay?: {
    consensus_team1_probability?: number | null
    consensus_team2_probability?: number | null
    team1_edge_vs_consensus?: number | null
    team2_edge_vs_consensus?: number | null
  } | null
}

type PredictionLedgerEntry = {
  snapshot_id: string
  created_at: string
  season: number
  prediction_date: string
  request_profile: PredictorRequestProfile
  model_source: string
  model_source_hash: string
  fixture_id: string
  opticodds_game_id: string | null
  mode: PredictorMode
  match_date: string
  match_date_key: string
  fixture_status: string
  fixture_is_live: boolean
  team1: string
  team2: string
  team_key: string
  venue: string
  venue_key: string
  predicted_winner: string
  predicted_team1_win_probability: number
  predicted_team2_win_probability: number
  fair_price_team1_cents: number | null
  fair_price_team2_cents: number | null
  market_team1_probability: number | null
  market_team2_probability: number | null
  team1_edge_vs_market: number | null
  team2_edge_vs_market: number | null
  consensus_team1_probability: number | null
  consensus_team2_probability: number | null
  team1_edge_vs_consensus: number | null
  team2_edge_vs_consensus: number | null
  has_manual_toss_override: boolean
  has_manual_lineup_override: boolean
  has_manual_feature_override: boolean
}

type SettledOutcome = {
  season: number
  match_date_key: string
  team_key: string
  winner: string
  winner_key: string
  resultType: string
  winnerRuns: number | null
  winnerWickets: number | null
  source: string
}

type SummarySlice = {
  snapshots: number
  latestPredictions: number
  settledPredictions: number
  pendingPredictions: number
  accuracy: number | null
  logLoss: number | null
  brier: number | null
  averageTeam1Probability: number | null
}

type FinishedFixtureRow = Record<string, CsvScalar>

type FinishedFixtureRecord = {
  season: number
  match_date: string
  fixture_id: string
  request_profile: PredictorRequestProfile
  team1: string
  team2: string
  venue: string
  actual_winner: string
  actual_result_type: string
  winner_runs: number | null
  winner_wickets: number | null
  settled_from: string
  pre_toss_available: boolean
  pre_toss_snapshot_created_at: string | null
  pre_toss_model_source: string | null
  pre_toss_model_source_hash: string | null
  pre_toss_predicted_winner: string | null
  pre_toss_team1_win_probability: number | null
  pre_toss_team2_win_probability: number | null
  pre_toss_correct: boolean | null
  pre_toss_log_loss: number | null
  pre_toss_brier: number | null
  post_toss_available: boolean
  post_toss_snapshot_created_at: string | null
  post_toss_model_source: string | null
  post_toss_model_source_hash: string | null
  post_toss_predicted_winner: string | null
  post_toss_team1_win_probability: number | null
  post_toss_team2_win_probability: number | null
  post_toss_correct: boolean | null
  post_toss_log_loss: number | null
  post_toss_brier: number | null
}

type PredictorPerformanceSummary = {
  generatedAt: string
  seasons: Record<string, {
    overall: SummarySlice
    byMode: Record<string, SummarySlice>
    byRequestProfile: Record<string, SummarySlice>
  }>
  latestSettled: Array<{
    fixtureId: string
    mode: PredictorMode
    requestProfile: PredictorRequestProfile
    matchDate: string
    team1: string
    team2: string
    predictedWinner: string
    actualWinner: string
    team1WinProbability: number
    wasCorrect: boolean
    settledFrom: string
    snapshotCreatedAt: string
  }>
}

const rootDir = process.cwd()
const modelDir = join(rootDir, "model")
const liveDir = join(modelDir, "data", "live")
const rawDir = join(modelDir, "data", "raw")
const finalModelsRoot = join(modelDir, "final_models")
const finalModelsManifestPath = join(finalModelsRoot, "manifest.json")
const predictionLedgerPath = join(liveDir, "predictor_performance_predictions.jsonl")
const performanceSummaryPath = join(liveDir, "predictor_performance_summary.json")
const finishedFixturesPrefix = join(liveDir, "predictor_finished_fixtures_")

const clean = (value: string | null | undefined) => value?.trim() ?? ""
const normalizeLookup = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const normalizeTeamKey = (team1: string, team2: string) => [normalizeLookup(team1), normalizeLookup(team2)].sort().join("::")
const normalizeVenueKey = (venue: string) => normalizeLookup(venue)
const toMatchDateKey = (value: string) => clean(value).slice(0, 10)
const parseInteger = (value: string | undefined) => Number.parseInt(clean(value), 10) || 0

const safeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

const csvEscape = (value: CsvScalar): string => {
  if (value === null || value === undefined) return ""
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

const writeCsv = async (filePath: string, headers: string[], rows: FinishedFixtureRow[]) => {
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","))
  }
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8")
}

const inferSeason = (matchDate: string) => {
  const year = Number.parseInt(toMatchDateKey(matchDate).slice(0, 4), 10)
  return Number.isFinite(year) ? year : new Date().getUTCFullYear()
}

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T
  } catch {
    return fallback
  }
}

const readJsonLines = async <T>(filePath: string): Promise<T[]> => {
  try {
    const raw = await readFile(filePath, "utf-8")
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  } catch {
    return []
  }
}

const readCsvRows = async (filePath: string) => {
  try {
    return parseCsv(await readFile(filePath, "utf-8"), {
      columns: true,
      skip_empty_lines: true,
    }) as Array<Record<string, string>>
  } catch {
    return []
  }
}

const buildSnapshotPresenceKey = (
  fixtureId: string,
  mode: PredictorMode,
  requestProfile: PredictorRequestProfile,
  modelSourceHash: string,
) => `${fixtureId}::${mode}::${requestProfile}::${modelSourceHash}`

const listTrackedFinalModelFiles = async (directoryPath: string): Promise<string[]> => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    const nestedPaths = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(directoryPath, entry.name)
        if (entry.isDirectory()) {
          return listTrackedFinalModelFiles(entryPath)
        }
        if (entry.isFile() && entry.name !== "revision_history.jsonl") {
          return [entryPath]
        }
        return []
      }),
    )

    return nestedPaths.flat().sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

const getModelSourceHash = async () => {
  const trackedFiles = await listTrackedFinalModelFiles(finalModelsRoot)
  if (!trackedFiles.length) {
    return "unknown"
  }

  const digest = createHash("sha256")
  for (const filePath of trackedFiles) {
    const relativePath = filePath.slice(finalModelsRoot.length + 1)
    const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex")
    digest.update(`${relativePath}:${fileHash}\n`)
  }

  return digest.digest("hex")
}

const resolveRequestProfile = (request: PredictorRequestSnapshot): PredictorRequestProfile => {
  const hasManualToss = Boolean(clean(request.tossWinner) || clean(request.tossDecision))
  const hasManualLineup = request.probableXiSource === "manual" && (request.team1ProbableXi.length > 0 || request.team2ProbableXi.length > 0)
  const hasManualFeatures = Boolean(request.featureOverrides && Object.keys(request.featureOverrides).length > 0)
  return hasManualToss || hasManualLineup || hasManualFeatures ? "manual" : "automatic"
}

const buildLedgerEntry = async (
  request: PredictorRequestSnapshot,
  response: PredictorResponseSnapshot,
): Promise<PredictionLedgerEntry> => {
  const requestProfile = resolveRequestProfile(request)
  const createdAt = new Date().toISOString()
  const manifest = await readJsonFile<Record<string, unknown>>(finalModelsManifestPath, {})

  return {
    snapshot_id: randomUUID(),
    created_at: createdAt,
    season: inferSeason(response.match_date),
    prediction_date: createdAt,
    request_profile: requestProfile,
    model_source: clean(String(manifest.productionLabel ?? "model/final_models/manifest.json")),
    model_source_hash: await getModelSourceHash(),
    fixture_id: response.fixture_id,
    opticodds_game_id: clean(response.opticodds_game_id ?? undefined) || null,
    mode: response.mode,
    match_date: response.match_date,
    match_date_key: toMatchDateKey(response.match_date),
    fixture_status: response.fixture_status,
    fixture_is_live: Boolean(response.fixture_is_live),
    team1: response.team1,
    team2: response.team2,
    team_key: normalizeTeamKey(response.team1, response.team2),
    venue: response.venue,
    venue_key: normalizeVenueKey(response.venue),
    predicted_winner: response.predicted_winner,
    predicted_team1_win_probability: response.team1_win_probability,
    predicted_team2_win_probability: response.team2_win_probability,
    fair_price_team1_cents: safeNumber(response.fair_price_team1_cents),
    fair_price_team2_cents: safeNumber(response.fair_price_team2_cents),
    market_team1_probability: safeNumber(response.market_overlay?.team1_market_probability),
    market_team2_probability: safeNumber(response.market_overlay?.team2_market_probability),
    team1_edge_vs_market: safeNumber(response.market_overlay?.team1_edge_vs_market),
    team2_edge_vs_market: safeNumber(response.market_overlay?.team2_edge_vs_market),
    consensus_team1_probability: safeNumber(response.sportsbook_overlay?.consensus_team1_probability),
    consensus_team2_probability: safeNumber(response.sportsbook_overlay?.consensus_team2_probability),
    team1_edge_vs_consensus: safeNumber(response.sportsbook_overlay?.team1_edge_vs_consensus),
    team2_edge_vs_consensus: safeNumber(response.sportsbook_overlay?.team2_edge_vs_consensus),
    has_manual_toss_override: Boolean(clean(request.tossWinner) || clean(request.tossDecision)),
    has_manual_lineup_override: request.probableXiSource === "manual" && (request.team1ProbableXi.length > 0 || request.team2ProbableXi.length > 0),
    has_manual_feature_override: Boolean(request.featureOverrides && Object.keys(request.featureOverrides).length > 0),
  }
}

const readCricsheetCurrentSeasonOutcomes = async (season: number): Promise<SettledOutcome[]> => {
  const rows = await readCsvRows(join(rawDir, "cricsheet_match_info.csv"))
  return rows
    .filter((row) => parseInteger(row.season) === season && clean(row.winner).length > 0)
    .map((row) => ({
      season,
      match_date_key: toMatchDateKey(clean(row.match_date)),
      team_key: normalizeTeamKey(clean(row.team1), clean(row.team2)),
      winner: clean(row.winner),
      winner_key: normalizeLookup(clean(row.winner)),
      resultType: "won",
      winnerRuns: parseInteger(row.winner_runs),
      winnerWickets: parseInteger(row.winner_wickets),
      source: "cricsheet_current_season",
    }))
}

const readCompletedSeasonOutcomes = async (season: number): Promise<SettledOutcome[]> => {
  const rows = await readCsvRows(join(liveDir, `completed_results_${season}.csv`))
  return rows
    .filter((row) => clean(row.winner).length > 0)
    .map((row) => ({
      season,
      match_date_key: toMatchDateKey(clean(row.match_date)),
      team_key: normalizeTeamKey(clean(row.team1), clean(row.team2)),
      winner: clean(row.winner),
      winner_key: normalizeLookup(clean(row.winner)),
      resultType: clean(row.result_type) || "won",
      winnerRuns: parseInteger(row.winner_runs),
      winnerWickets: parseInteger(row.winner_wickets),
      source: clean(row.source) || `completed_results_${season}`,
    }))
}

const loadOutcomeIndex = async (seasons: number[]) => {
  const uniqueSeasons = Array.from(new Set(seasons))
  const outcomes = (
    await Promise.all(
      uniqueSeasons.flatMap((season) => [
        readCricsheetCurrentSeasonOutcomes(season),
        readCompletedSeasonOutcomes(season),
      ]),
    )
  ).flat()

  return new Map(
    outcomes.map((outcome) => [`${outcome.season}::${outcome.match_date_key}::${outcome.team_key}`, outcome] as const),
  )
}

const evaluateSlice = (entries: PredictionLedgerEntry[], outcomeIndex: Map<string, SettledOutcome>): SummarySlice => {
  const latestByKey = new Map<string, PredictionLedgerEntry>()
  for (const entry of entries) {
    const key = `${entry.fixture_id}::${entry.mode}::${entry.request_profile}`
    const existing = latestByKey.get(key)
    if (!existing || existing.created_at < entry.created_at) {
      latestByKey.set(key, entry)
    }
  }

  const latestEntries = Array.from(latestByKey.values())
  const settled = latestEntries
    .map((entry) => ({
      entry,
      outcome: outcomeIndex.get(`${entry.season}::${entry.match_date_key}::${entry.team_key}`),
    }))
    .filter((item): item is { entry: PredictionLedgerEntry; outcome: SettledOutcome } => Boolean(item.outcome))

  const settledCount = settled.length
  const pendingCount = latestEntries.length - settledCount
  const accuracy = settledCount
    ? settled.filter(({ entry, outcome }) => normalizeLookup(entry.predicted_winner) === outcome.winner_key).length / settledCount
    : null

  const logLoss = settledCount
    ? settled.reduce((sum, { entry, outcome }) => {
        const actualTeam1Won = normalizeLookup(entry.team1) === outcome.winner_key ? 1 : 0
        const probability = Math.min(1 - 1e-6, Math.max(1e-6, entry.predicted_team1_win_probability))
        return sum - (actualTeam1Won * Math.log(probability) + (1 - actualTeam1Won) * Math.log(1 - probability))
      }, 0) / settledCount
    : null

  const brier = settledCount
    ? settled.reduce((sum, { entry, outcome }) => {
        const actualTeam1Won = normalizeLookup(entry.team1) === outcome.winner_key ? 1 : 0
        return sum + (entry.predicted_team1_win_probability - actualTeam1Won) ** 2
      }, 0) / settledCount
    : null

  const averageProbability = latestEntries.length
    ? latestEntries.reduce((sum, entry) => sum + entry.predicted_team1_win_probability, 0) / latestEntries.length
    : null

  return {
    snapshots: entries.length,
    latestPredictions: latestEntries.length,
    settledPredictions: settledCount,
    pendingPredictions: pendingCount,
    accuracy,
    logLoss,
    brier,
    averageTeam1Probability: averageProbability,
  }
}

const getLatestEntries = (entries: PredictionLedgerEntry[]) => {
  const latestByKey = new Map<string, PredictionLedgerEntry>()
  for (const entry of entries) {
    const key = `${entry.fixture_id}::${entry.mode}::${entry.request_profile}`
    const existing = latestByKey.get(key)
    if (!existing || existing.created_at < entry.created_at) {
      latestByKey.set(key, entry)
    }
  }
  return Array.from(latestByKey.values())
}

const finishedFixturesHeaders = [
  "season",
  "match_date",
  "fixture_id",
  "request_profile",
  "team1",
  "team2",
  "venue",
  "actual_winner",
  "actual_result_type",
  "winner_runs",
  "winner_wickets",
  "settled_from",
  "pre_toss_available",
  "pre_toss_snapshot_created_at",
  "pre_toss_model_source",
  "pre_toss_model_source_hash",
  "pre_toss_predicted_winner",
  "pre_toss_team1_win_probability",
  "pre_toss_team2_win_probability",
  "pre_toss_correct",
  "pre_toss_log_loss",
  "pre_toss_brier",
  "post_toss_available",
  "post_toss_snapshot_created_at",
  "post_toss_model_source",
  "post_toss_model_source_hash",
  "post_toss_predicted_winner",
  "post_toss_team1_win_probability",
  "post_toss_team2_win_probability",
  "post_toss_correct",
  "post_toss_log_loss",
  "post_toss_brier",
] as const

const computeEntryOutcomeMetrics = (entry: PredictionLedgerEntry, outcome: SettledOutcome) => {
  const actualTeam1Won = normalizeLookup(entry.team1) === outcome.winner_key ? 1 : 0
  const probability = Math.min(1 - 1e-6, Math.max(1e-6, entry.predicted_team1_win_probability))
  const logLoss = -(actualTeam1Won * Math.log(probability) + (1 - actualTeam1Won) * Math.log(1 - probability))
  const brier = (entry.predicted_team1_win_probability - actualTeam1Won) ** 2
  return {
    correct: normalizeLookup(entry.predicted_winner) === outcome.winner_key,
    logLoss,
    brier,
  }
}

const buildFinishedFixtureRows = (entries: PredictionLedgerEntry[], outcomeIndex: Map<string, SettledOutcome>) => {
  const latestEntries = getLatestEntries(entries)
  const grouped = new Map<string, { pre?: PredictionLedgerEntry; post?: PredictionLedgerEntry; outcome: SettledOutcome }>()

  for (const entry of latestEntries) {
    const outcome = outcomeIndex.get(`${entry.season}::${entry.match_date_key}::${entry.team_key}`)
    if (!outcome) continue

    const key = `${entry.season}::${entry.match_date_key}::${entry.team_key}::${entry.request_profile}`
    const existing = grouped.get(key) ?? { outcome }
    if (entry.mode === "pre_toss") existing.pre = entry
    if (entry.mode === "post_toss") existing.post = entry
    grouped.set(key, existing)
  }

  const rows: FinishedFixtureRecord[] = []

  for (const { pre, post, outcome } of grouped.values()) {
      const representative = pre ?? post
      if (!representative) continue
      const preMetrics = pre ? computeEntryOutcomeMetrics(pre, outcome) : null
      const postMetrics = post ? computeEntryOutcomeMetrics(post, outcome) : null

      rows.push({
        season: representative.season,
        match_date: representative.match_date,
        fixture_id: representative.fixture_id,
        request_profile: representative.request_profile,
        team1: representative.team1,
        team2: representative.team2,
        venue: representative.venue,
        actual_winner: outcome.winner,
        actual_result_type: outcome.resultType,
        winner_runs: outcome.winnerRuns,
        winner_wickets: outcome.winnerWickets,
        settled_from: outcome.source,
        pre_toss_available: Boolean(pre),
        pre_toss_snapshot_created_at: pre?.created_at ?? null,
        pre_toss_model_source: pre?.model_source ?? null,
        pre_toss_model_source_hash: pre?.model_source_hash ?? null,
        pre_toss_predicted_winner: pre?.predicted_winner ?? null,
        pre_toss_team1_win_probability: pre?.predicted_team1_win_probability ?? null,
        pre_toss_team2_win_probability: pre?.predicted_team2_win_probability ?? null,
        pre_toss_correct: preMetrics?.correct ?? null,
        pre_toss_log_loss: preMetrics ? Number(preMetrics.logLoss.toFixed(6)) : null,
        pre_toss_brier: preMetrics ? Number(preMetrics.brier.toFixed(6)) : null,
        post_toss_available: Boolean(post),
        post_toss_snapshot_created_at: post?.created_at ?? null,
        post_toss_model_source: post?.model_source ?? null,
        post_toss_model_source_hash: post?.model_source_hash ?? null,
        post_toss_predicted_winner: post?.predicted_winner ?? null,
        post_toss_team1_win_probability: post?.predicted_team1_win_probability ?? null,
        post_toss_team2_win_probability: post?.predicted_team2_win_probability ?? null,
        post_toss_correct: postMetrics?.correct ?? null,
        post_toss_log_loss: postMetrics ? Number(postMetrics.logLoss.toFixed(6)) : null,
        post_toss_brier: postMetrics ? Number(postMetrics.brier.toFixed(6)) : null,
      })
  }

  rows.sort(
    (left, right) =>
      String(right.match_date).localeCompare(String(left.match_date)) ||
      String(left.request_profile).localeCompare(String(right.request_profile)),
  )

  return rows satisfies FinishedFixtureRow[]
}

const writeFinishedFixtureFiles = async (entries: PredictionLedgerEntry[], outcomeIndex: Map<string, SettledOutcome>) => {
  const rows = buildFinishedFixtureRows(entries, outcomeIndex)
  const seasons = Array.from(new Set(entries.map((entry) => entry.season)))

  await Promise.all(
    seasons.map(async (season) => {
      const seasonRows = rows.filter((row) => Number(row.season) === season)
      await writeCsv(`${finishedFixturesPrefix}${season}.csv`, [...finishedFixturesHeaders], seasonRows)
    }),
  )
}

type CompletedResultRow = {
  match_id: string
  season: number
  match_date: string
  venue: string
  city: string
  team1: string
  team2: string
  winner: string
}

const loadCompletedSeasonRows = async (season: number): Promise<CompletedResultRow[]> => {
  const rows = await readCsvRows(join(liveDir, `completed_results_${season}.csv`))
  return rows
    .filter((row) => clean(row.winner).length > 0)
    .map((row) => ({
      match_id: clean(row.match_id),
      season,
      match_date: clean(row.match_date),
      venue: normalizeVenueName(clean(row.venue)),
      city: normalizeCityName(clean(row.city)),
      team1: normalizeTeamName(clean(row.team1)),
      team2: normalizeTeamName(clean(row.team2)),
      winner: normalizeTeamName(clean(row.winner)),
    }))
}

const runPredictFixtureWithHistoricalRow = async (
  fixtureId: string,
  fixtureRow: Record<string, unknown>,
) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    execFile(
      "python3",
      [
        join(rootDir, "model", "predict_fixture.py"),
        "--fixture-id",
        fixtureId,
        "--mode",
        "post_toss",
        "--fixture-row-json",
        JSON.stringify(fixtureRow),
      ],
      { cwd: rootDir },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>)
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)))
        }
      },
    )
  })

const buildHistoricalFixtureRow = (
  entry: PredictionLedgerEntry,
  completedRow: CompletedResultRow | undefined,
) => {
  const season = entry.season
  const team1 = completedRow?.team1 ?? entry.team1
  const team2 = completedRow?.team2 ?? entry.team2
  const venue = completedRow?.venue ?? entry.venue
  const city = completedRow?.city ?? ""
  const inferredHomeTeam = inferHomeTeam([team1, team2], venue, season) ?? ""
  const team1Context = resolveTeamVenueContext(team1, venue, season)
  const team2Context = resolveTeamVenueContext(team2, venue, season)

  return {
    fixture_id: entry.fixture_id,
    opticodds_game_id: entry.opticodds_game_id ?? "",
    match_date: entry.match_date,
    status: "completed",
    is_live: false,
    is_completed: true,
    status_source: completedRow ? "historical_backfill" : "historical_ledger_backfill",
    official_match_id: completedRow?.match_id ?? "",
    venue,
    venue_location: city ? `${city}, India` : "",
    city,
    team1,
    team2,
    home_team_from_feed: team1,
    away_team_from_feed: team2,
    inferred_home_team: inferredHomeTeam,
    team1_home_context: team1Context,
    team2_home_context: team2Context,
    match_neutral_flag: team1Context === "neutral" || team2Context === "neutral",
  }
}

export const backfillHistoricalPostTossSnapshots = async () => {
  const entries = await readJsonLines<PredictionLedgerEntry>(predictionLedgerPath)
  if (!entries.length) {
    return 0
  }

  const latestEntries = getLatestEntries(entries)
  const currentModelHash = await getModelSourceHash()
  const snapshotKeys = await listStoredPredictorSnapshotKeys()
  const completedRowsBySeason = new Map<number, CompletedResultRow[]>()
  let createdCount = 0

  const groups = new Map<string, { pre?: PredictionLedgerEntry; post?: PredictionLedgerEntry }>()
  for (const entry of latestEntries) {
    if (entry.request_profile !== "automatic") continue
    if (entry.model_source_hash !== currentModelHash) continue
    const key = `${entry.season}::${entry.match_date_key}::${entry.team_key}::${entry.request_profile}`
    const existing = groups.get(key) ?? {}
    if (entry.mode === "pre_toss") existing.pre = entry
    if (entry.mode === "post_toss") existing.post = entry
    groups.set(key, existing)
  }

  for (const { pre, post } of groups.values()) {
    if (!pre || post) continue

    const snapshotKey = buildSnapshotPresenceKey(
      pre.fixture_id,
      "post_toss",
      pre.request_profile,
      currentModelHash,
    )
    if (snapshotKeys.has(snapshotKey)) continue

    if (!completedRowsBySeason.has(pre.season)) {
      completedRowsBySeason.set(pre.season, await loadCompletedSeasonRows(pre.season))
    }
    const completedRow = completedRowsBySeason
      .get(pre.season)
      ?.find(
        (row) =>
          toMatchDateKey(row.match_date) === pre.match_date_key &&
          normalizeTeamKey(row.team1, row.team2) === pre.team_key,
      )

    const fixtureRow = buildHistoricalFixtureRow(pre, completedRow)
    const result = await runPredictFixtureWithHistoricalRow(pre.fixture_id, fixtureRow).catch(
      () => null,
    )
    if (!result || result.official_post_toss_applied !== true) {
      continue
    }

    await recordPredictorPerformanceSnapshot(
      {
        fixtureId: pre.fixture_id,
        mode: "post_toss",
        tossWinner: null,
        tossDecision: null,
        team1ProbableXi: [],
        team2ProbableXi: [],
        probableXiSource: "none",
        featureOverrides: null,
      },
      result as never,
    )
    snapshotKeys.add(snapshotKey)
    createdCount += 1
  }

  return createdCount
}

const buildSummary = async (entries: PredictionLedgerEntry[]): Promise<PredictorPerformanceSummary> => {
  const seasons = Array.from(new Set(entries.map((entry) => entry.season))).sort((a, b) => a - b)
  const outcomeIndex = await loadOutcomeIndex(seasons)
  const summaryBySeason: PredictorPerformanceSummary["seasons"] = {}

  for (const season of seasons) {
    const seasonEntries = entries.filter((entry) => entry.season === season)
    summaryBySeason[String(season)] = {
      overall: evaluateSlice(seasonEntries, outcomeIndex),
      byMode: {
        pre_toss: evaluateSlice(seasonEntries.filter((entry) => entry.mode === "pre_toss"), outcomeIndex),
        post_toss: evaluateSlice(seasonEntries.filter((entry) => entry.mode === "post_toss"), outcomeIndex),
      },
      byRequestProfile: {
        automatic: evaluateSlice(seasonEntries.filter((entry) => entry.request_profile === "automatic"), outcomeIndex),
        manual: evaluateSlice(seasonEntries.filter((entry) => entry.request_profile === "manual"), outcomeIndex),
      },
    }
  }

  const latestSettled = getLatestEntries(entries)
    .map((entry) => ({
      entry,
      outcome: outcomeIndex.get(`${entry.season}::${entry.match_date_key}::${entry.team_key}`),
    }))
    .filter((item): item is { entry: PredictionLedgerEntry; outcome: SettledOutcome } => Boolean(item.outcome))
    .sort((left, right) => right.entry.match_date.localeCompare(left.entry.match_date) || right.entry.created_at.localeCompare(left.entry.created_at))
    .slice(0, 20)
    .map(({ entry, outcome }) => ({
      fixtureId: entry.fixture_id,
      mode: entry.mode,
      requestProfile: entry.request_profile,
      matchDate: entry.match_date,
      team1: entry.team1,
      team2: entry.team2,
      predictedWinner: entry.predicted_winner,
      actualWinner: outcome.winner,
      team1WinProbability: entry.predicted_team1_win_probability,
      wasCorrect: normalizeLookup(entry.predicted_winner) === outcome.winner_key,
      settledFrom: outcome.source,
      snapshotCreatedAt: entry.created_at,
    }))

  return {
    generatedAt: new Date().toISOString(),
    seasons: summaryBySeason,
    latestSettled,
  }
}

export const recordPredictorPerformanceSnapshot = async (
  request: PredictorRequestSnapshot,
  response: PredictorResponseSnapshot,
) => {
  await mkdir(liveDir, { recursive: true })
  const entry = await buildLedgerEntry(request, response)
  await appendFile(predictionLedgerPath, `${JSON.stringify(entry)}\n`, "utf-8")
  const allEntries = await readJsonLines<PredictionLedgerEntry>(predictionLedgerPath)
  const outcomeIndex = await loadOutcomeIndex(Array.from(new Set(allEntries.map((item) => item.season))))
  await writeFinishedFixtureFiles(allEntries, outcomeIndex)
  const summary = await buildSummary(allEntries)
  await writeFile(performanceSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8")
  return summary
}

export const getPredictorPerformanceSummary = async () => {
  const entries = await readJsonLines<PredictionLedgerEntry>(predictionLedgerPath)
  if (!entries.length) {
    return {
      generatedAt: new Date().toISOString(),
      seasons: {},
      latestSettled: [],
    } satisfies PredictorPerformanceSummary
  }

  const cached = await readJsonFile<PredictorPerformanceSummary | null>(performanceSummaryPath, null)
  if (cached) {
    return cached
  }

  const summary = await buildSummary(entries)
  await writeFile(performanceSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8")
  return summary
}

export const refreshPredictorPerformanceSummary = async () => {
  const entries = await readJsonLines<PredictionLedgerEntry>(predictionLedgerPath)
  const outcomeIndex = await loadOutcomeIndex(Array.from(new Set(entries.map((entry) => entry.season))))
  await writeFinishedFixtureFiles(entries, outcomeIndex)
  const summary = entries.length
    ? await buildSummary(entries)
    : {
        generatedAt: new Date().toISOString(),
        seasons: {},
        latestSettled: [],
      }
  await mkdir(liveDir, { recursive: true })
  await writeFile(performanceSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8")
  return summary
}

export const getCurrentPredictorModelSourceHash = async () => getModelSourceHash()

export const listStoredPredictorSnapshotKeys = async () => {
  const entries = await readJsonLines<PredictionLedgerEntry>(predictionLedgerPath)
  return new Set(
    entries.map((entry) =>
      buildSnapshotPresenceKey(
        entry.fixture_id,
        entry.mode,
        entry.request_profile,
        entry.model_source_hash,
      ),
    ),
  )
}

export const buildPredictorSnapshotKey = (
  fixtureId: string,
  mode: PredictorMode,
  requestProfile: PredictorRequestProfile,
  modelSourceHash: string,
) => buildSnapshotPresenceKey(fixtureId, mode, requestProfile, modelSourceHash)
