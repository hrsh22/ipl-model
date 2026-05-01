import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { type Server } from "node:http"
import { execFile } from "node:child_process"
import { readFile, readdir, stat } from "node:fs/promises"
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express"
import { Effect } from "effect"
import { config } from "./config.js"
import logger from "./logger.js"
import { loadCricsheetData } from "./ipl/data-loader.js"
import { generatePredictions, type PredictionRequest } from "./ipl/prediction-service.js"
import { getAggregatedOdds } from "./ipl/odds-service.js"
import {
  backfillHistoricalPostTossSnapshots,
  buildPredictorSnapshotKey,
  getCurrentPredictorModelSourceHash,
  getPredictorPerformanceSummary,
  listStoredPredictorSnapshotKeys,
  recordPredictorPerformanceSnapshot,
  refreshPredictorPerformanceSummary,
} from "./predictor-performance.js"

const sendJson = <A>(res: Response, program: Effect.Effect<A, unknown>) => {
  void Effect.runPromise(
    program.pipe(
      Effect.match({
        onFailure: (error) => {
          const message = formatError(error)

          logger.error(message)
          res.status(500).json({ error: message })
        },
        onSuccess: (body) => {
          res.json(body)
        },
      }),
    ),
  )
}

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error"

const observerDisabledError = (res: Response) => {
  res.status(503)
  return { error: "Observer routes are disabled in predictor-only mode" }
}

const loadDatabaseModule = () =>
  Effect.tryPromise<typeof import("./database.js"), Error>({
    try: () => import("./database.js"),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

const loadObserverService = () =>
  Effect.tryPromise<typeof import("./observer/service.js"), Error>({
    try: () => import("./observer/service.js"),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(Effect.map((module) => module.observerService))

const checkDatabaseConnectionIfEnabled = () =>
  config.predictorOnlyMode || !config.databaseUrl
    ? Effect.succeed("disabled" as const)
    : Effect.gen(function* () {
        const { checkDatabaseConnection } = yield* loadDatabaseModule()
        yield* checkDatabaseConnection
        return "reachable" as const
      })

const parseNumberQuery = (value: unknown, fallback: number) => {
  const firstValue = Array.isArray(value) ? value[0] : value
  const parsed = Number(firstValue)

  return Number.isFinite(parsed) ? parsed : fallback
}

const parseConfidenceQuery = (value: unknown) => {
  const firstValue = Array.isArray(value) ? value[0] : value

  return firstValue === "low" || firstValue === "medium" || firstValue === "high"
    ? firstValue
    : undefined
}

const requireObserverAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!config.observerApiToken) {
    next()
    return
  }

  const authorization = req.header("authorization")
  const expected = `Bearer ${config.observerApiToken}`

  if (authorization !== expected) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  next()
}

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const publicDirectory = join(currentDirectory, "..", "public")
const modelDirectory = join(currentDirectory, "..", "model")
const predictorScriptPath = join(modelDirectory, "predict_fixture.py")
const ballStateExperimentsDirectory = join(modelDirectory, "experiments", "ball-state")
const upcomingFixturesCsvPath = join(modelDirectory, "data", "live", "upcoming_fixtures.csv")
const upcomingFixturesJsonPath = join(modelDirectory, "data", "live", "upcoming_fixtures.json")
const upcomingFixtureEloPath = join(modelDirectory, "data", "live", "upcoming_fixture_elo_context.csv")
const currentSeasonSquadsPath = join(modelDirectory, "data", "live", "current_season_match_squads.csv")
const currentSeasonPlayerStatsPath = join(modelDirectory, "data", "live", "current_season_player_match_stats.csv")
const predictorLiveDataMaxAgeMs = config.predictorLiveDataMaxAgeMs
const predictorMaintenanceIntervalMs = config.predictorMaintenanceIntervalMs
const automaticPreTossLookaheadMs = 24 * 60 * 60 * 1000
const automaticPostTossWindowBeforeStartMs = 90 * 60 * 1000
const automaticPostTossWindowAfterStartMs = 6 * 60 * 60 * 1000
const ballStateShadowRefreshIntervalMs = 5_000
const ballStateShadowRefreshTimeoutMs = 120_000
const ballStateEventIngestionIntervalMs = 30_000
const ballStateEventIngestionTimeoutMs = 60_000
const ballStateShadowMaxAgeMs = 5 * 60 * 1000
const allowedBallStateRemoteHosts = new Set(["www.espncricinfo.com", "espncricinfo.com"])

let predictorLiveDataRefreshPromise: Promise<void> | null = null
let ballStateShadowRefreshPromise: Promise<void> | null = null
let ballStateShadowRefreshState: BallStateShadowRefresh = {
  status: "idle",
  ingestionStatus: "idle",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  ingestionLastAttemptAt: null,
  ingestionLastSuccessAt: null,
  ingestionLastError: null,
  ingestionSource: null,
  ingestionIntervalMs: ballStateEventIngestionIntervalMs,
  eventJournalUpdatedAt: null,
  shadowUpdatedAt: null,
  autoRefreshIntervalMs: ballStateShadowRefreshIntervalMs,
  autoRefreshEnabled: config.experimentalBallStateShadowRefreshEnabled,
  remoteFetchEnabled: config.experimentalBallStateRemoteFetchEnabled,
}

type PredictorFixtureRow = {
  fixture_id: string
  match_date: string
  status: string
  is_live: boolean
  is_completed: boolean
}

type JsonRecord = Record<string, unknown>

type BallStateShadowScore = {
  fixtureId: string | null
  entryIndex: number | null
  target: string
  candidate: string | null
  featureMode: string | null
  innings: number | null
  battingTeam: string | null
  bowlingTeam: string | null
  scoreRuns: number | null
  scoreWickets: number | null
  balls: number | null
  shadowPrediction: number | null
  heuristicValue: number | null
  deltaVsHeuristic: number | null
  snapshotDiagnostics: JsonRecord | null
}

type BallStateShadowResponse = {
  status: "experimental"
  source: "ball-state-shadow"
  available: boolean
  reason?: string
  outputDir: string | null
  updatedAt: string | null
  currentState: {
    fixtureId: string | null
    innings: number | null
    battingTeam: string | null
    bowlingTeam: string | null
    scoreRuns: number | null
    scoreWickets: number | null
    balls: number | null
  }
  predictions: {
    expectedRunsNow: number | null
    expectedWicketsNow: number | null
    runsDelta: number | null
    wicketsDelta: number | null
    finalInningsRuns: number | null
    finalInningsWickets: number | null
    remainingInningsRuns: number | null
    remainingInningsWickets: number | null
    chaseSuccessProbability: number | null
  }
  parity: {
    readyForInference: boolean | null
    featureMode: string | null
    missingCoreFeatures: unknown[]
    missingEventTrajectoryFeatures: unknown[]
    snapshotDiagnostics: JsonRecord | null
  }
  summary: {
    inputRows: number | null
    scoredEntries: number | null
    targetScores: number | null
    rejectedRows: number | null
    targetScoreCounts: JsonRecord | null
    notes: unknown[]
  }
  refresh: BallStateShadowRefresh
  scores: BallStateShadowScore[]
  notes: string[]
}

type BallStateShadowRefresh = {
  status: "idle" | "running" | "skipped" | "succeeded" | "failed"
  ingestionStatus: "idle" | "unconfigured" | "running" | "succeeded" | "failed"
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  ingestionLastAttemptAt: string | null
  ingestionLastSuccessAt: string | null
  ingestionLastError: string | null
  ingestionSource: string | null
  ingestionIntervalMs: number
  eventJournalUpdatedAt: string | null
  shadowUpdatedAt: string | null
  autoRefreshIntervalMs: number
  autoRefreshEnabled: boolean
  remoteFetchEnabled: boolean
}

type BallStateEventRun = {
  outputDir: string
  relativeOutputDir: string
  eventsPath: string
  contextPath: string
  scoresPath: string
  contextRecord: JsonRecord
  contextUpdatedAtMs: number | null
  sourceUrl: string | null
  inputHtmlPath: string | null
  inputHtmlDir: string | null
  fixtureId: string | null
  eventsUpdatedAtMs: number | null
  scoresUpdatedAtMs: number | null
}

type BallStateShadowRun = {
  outputDir: string
  relativeOutputDir: string
  scoresPath: string
  updatedAtMs: number
  contextRecord: JsonRecord
  fixtureId: string | null
}

type ActiveBallStateFixture = {
  id: string
  homeTeam: string
  awayTeam: string
}

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readStringField = (record: JsonRecord, key: string) => {
  const value = record[key]
  return typeof value === "string" ? value : null
}

const readNumberField = (record: JsonRecord, key: string) => {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const readRecordField = (record: JsonRecord, key: string) => {
  const value = record[key]
  return isJsonRecord(value) ? value : null
}

const readArrayField = (record: JsonRecord, key: string) => {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

const readJsonFileIfPresent = async (filePath: string) => {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as unknown
  } catch {
    return null
  }
}

const getFileMtimeMs = async (filePath: string) =>
  (await stat(filePath).catch(() => null))?.mtimeMs ?? null

const mtimeToIso = (mtimeMs: number | null) =>
  mtimeMs === null ? null : new Date(mtimeMs).toISOString()

const isPathInside = (parent: string, candidate: string) => {
  const relativePath = relative(parent, candidate)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const resolveBallStateExperimentPath = (value: string) => {
  const resolved = resolve(currentDirectory, "..", value)
  return isPathInside(ballStateExperimentsDirectory, resolved) ? resolved : null
}

const safeBallStateSourceUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && allowedBallStateRemoteHosts.has(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

const normalizeBallStateTeam = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim()

const isComparableTeamSet = (left: Array<string | null>, right: Array<string | null>) => {
  const leftTeams = left.map(normalizeBallStateTeam).filter(Boolean).sort()
  const rightTeams = right.map(normalizeBallStateTeam).filter(Boolean).sort()
  return leftTeams.length === 2 && rightTeams.length === 2 && leftTeams.every((team, index) => team === rightTeams[index])
}

const isBallStateScratchRunName = (name: string) =>
  /(?:sample|smoke|test)/i.test(name)

const ballStateRunMatchesFixture = (run: Pick<BallStateShadowRun, "contextRecord" | "fixtureId">, fixture: ActiveBallStateFixture) => {
  if (run.fixtureId && run.fixtureId === fixture.id) {
    return true
  }

  const contextTeams = [
    firstStringField(run.contextRecord, ["home_team", "homeTeam"]),
    firstStringField(run.contextRecord, ["away_team", "awayTeam"]),
  ]
  const inningsTeams = [
    firstStringField(run.contextRecord, ["batting_team", "battingTeam"]),
    firstStringField(run.contextRecord, ["bowling_team", "bowlingTeam"]),
  ]

  return isComparableTeamSet(contextTeams, [fixture.homeTeam, fixture.awayTeam]) ||
    isComparableTeamSet(inningsTeams, [fixture.homeTeam, fixture.awayTeam])
}

const firstStringField = (record: JsonRecord, keys: string[]) => {
  for (const key of keys) {
    const value = readStringField(record, key)
    if (value) {
      return value
    }
  }
  return null
}

const runPythonScript = (args: string[], timeout: number) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      "python3",
      args,
      {
        cwd: join(currentDirectory, ".."),
        timeout,
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        resolve()
      },
    )
  })

const readBallStateShadowScores = async (filePath: string) => {
  const text = await readFile(filePath, "utf-8")
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line): BallStateShadowScore[] => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch {
        return []
      }
      if (!isJsonRecord(parsed)) {
        return []
      }

      const target = readStringField(parsed, "target")
      if (!target) {
        return []
      }

      return [{
        fixtureId: readStringField(parsed, "fixture_id"),
        entryIndex: readNumberField(parsed, "entry_index"),
        target,
        candidate: readStringField(parsed, "candidate"),
        featureMode: readStringField(parsed, "feature_mode"),
        innings: readNumberField(parsed, "innings"),
        battingTeam: readStringField(parsed, "batting_team"),
        bowlingTeam: readStringField(parsed, "bowling_team"),
        scoreRuns: readNumberField(parsed, "score_runs"),
        scoreWickets: readNumberField(parsed, "score_wickets"),
        balls: readNumberField(parsed, "balls"),
        shadowPrediction: readNumberField(parsed, "shadow_prediction"),
        heuristicValue: readNumberField(parsed, "heuristic_value"),
        deltaVsHeuristic: readNumberField(parsed, "delta_vs_heuristic"),
        snapshotDiagnostics: readRecordField(parsed, "snapshot_diagnostics"),
      }]
    })
}

const unavailableBallStateShadow = (reason: string): BallStateShadowResponse => ({
  status: "experimental",
  source: "ball-state-shadow",
  available: false,
  reason,
  outputDir: null,
  updatedAt: null,
  currentState: {
    fixtureId: null,
    innings: null,
    battingTeam: null,
    bowlingTeam: null,
    scoreRuns: null,
    scoreWickets: null,
    balls: null,
  },
  predictions: {
    expectedRunsNow: null,
    expectedWicketsNow: null,
    runsDelta: null,
    wicketsDelta: null,
    finalInningsRuns: null,
    finalInningsWickets: null,
    remainingInningsRuns: null,
    remainingInningsWickets: null,
    chaseSuccessProbability: null,
  },
  parity: {
    readyForInference: null,
    featureMode: null,
    missingCoreFeatures: [],
    missingEventTrajectoryFeatures: [],
    snapshotDiagnostics: null,
  },
  summary: {
    inputRows: null,
    scoredEntries: null,
    targetScores: null,
    rejectedRows: null,
    targetScoreCounts: null,
    notes: [],
  },
  refresh: ballStateShadowRefreshState,
  scores: [],
  notes: [
    "No production artifacts were read or modified.",
    "This endpoint only exposes ignored experimental shadow-score outputs when present.",
    "Experimental refresh is opt-in and disabled by default.",
  ],
})

const findLatestBallStateEventRun = async (): Promise<BallStateEventRun | null> => {
  const entries = await readdir(ballStateExperimentsDirectory, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && (entry.name === "live-events" || entry.name.startsWith("live-events-")))
      .filter((entry) => !isBallStateScratchRunName(entry.name))
      .map(async (entry) => {
        const outputDir = join(ballStateExperimentsDirectory, entry.name)
        const contextPath = join(outputDir, "fixture-context.json")
        const contextUpdatedAtMs = await getFileMtimeMs(contextPath)
        const context = await readJsonFileIfPresent(contextPath)
        const contextRecord = isJsonRecord(context) ? context : {}
        const eventsPath = join(outputDir, "normalized_ball_events.jsonl")
        const eventsUpdatedAtMs = await getFileMtimeMs(eventsPath)
        if (contextUpdatedAtMs === null) {
          return null
        }

        const scoresPath = join(outputDir, "shadow-run", "shadow_scores.jsonl")
        const scoresUpdatedAtMs = await getFileMtimeMs(scoresPath)
        const sourceUrl = firstStringField(contextRecord, [
          "espn_url",
          "espnUrl",
          "source_url",
          "sourceUrl",
          "commentary_url",
          "commentaryUrl",
          "ball_by_ball_url",
          "ballByBallUrl",
        ])
        const inputHtmlDir = firstStringField(contextRecord, [
          "input_html_dir",
          "inputHtmlDir",
          "saved_html_dir",
          "savedHtmlDir",
          "html_dir",
          "htmlDir",
        ])
        const inputHtmlPath = firstStringField(contextRecord, [
          "input_html",
          "inputHtml",
          "saved_html",
          "savedHtml",
          "html_file",
          "htmlFile",
        ])

        return {
          outputDir,
          relativeOutputDir: join("model", "experiments", "ball-state", entry.name),
          eventsPath,
          contextPath,
          scoresPath,
          contextRecord,
          contextUpdatedAtMs,
          sourceUrl: sourceUrl ? safeBallStateSourceUrl(sourceUrl) : null,
          inputHtmlPath: inputHtmlPath ? resolveBallStateExperimentPath(inputHtmlPath) : null,
          inputHtmlDir: inputHtmlDir ? resolveBallStateExperimentPath(inputHtmlDir) : null,
          fixtureId: firstStringField(contextRecord, ["fixture_id", "fixtureId", "match_id", "matchId"]),
          eventsUpdatedAtMs,
          scoresUpdatedAtMs,
        }
      }),
  )

  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => Math.max(right.eventsUpdatedAtMs ?? 0, right.contextUpdatedAtMs ?? 0) - Math.max(left.eventsUpdatedAtMs ?? 0, left.contextUpdatedAtMs ?? 0))[0] ?? null
}

const findLatestBallStateShadowRun = async (activeFixtures: ActiveBallStateFixture[] = []): Promise<BallStateShadowRun | null> => {
  if (activeFixtures.length === 0) {
    return null
  }

  const entries = await readdir(ballStateExperimentsDirectory, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && (entry.name === "live-events" || entry.name.startsWith("live-events-")))
      .filter((entry) => !isBallStateScratchRunName(entry.name))
      .map(async (entry) => {
        const outputDir = join(ballStateExperimentsDirectory, entry.name)
        const contextPath = join(outputDir, "fixture-context.json")
        const context = await readJsonFileIfPresent(contextPath)
        if (!isJsonRecord(context)) {
          return null
        }

        const scoresPath = join(outputDir, "shadow-run", "shadow_scores.jsonl")
        const stats = await stat(scoresPath).catch(() => null)
        return stats
          ? {
              outputDir,
              relativeOutputDir: join("model", "experiments", "ball-state", entry.name),
              scoresPath,
              updatedAtMs: stats.mtimeMs,
              contextRecord: context,
              fixtureId: firstStringField(context, ["fixture_id", "fixtureId", "match_id", "matchId"]),
            }
          : null
      }),
  )

  const latestAllowedUpdatedAtMs = Date.now() - ballStateShadowMaxAgeMs
  const validCandidates = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .filter((candidate) => candidate.updatedAtMs >= latestAllowedUpdatedAtMs)
  const fixtureMatchedCandidates = validCandidates.filter((candidate) => activeFixtures.some((fixture) => ballStateRunMatchesFixture(candidate, fixture)))

  return fixtureMatchedCandidates
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0] ?? null
}

const setBallStateShadowRefreshState = (state: Partial<BallStateShadowRefresh>) => {
  ballStateShadowRefreshState = {
    ...ballStateShadowRefreshState,
    ...state,
  }
}

type BallStateIngestionSource = {
  label: string
  args: string[]
}

const buildBallStateIngestionSource = (run: BallStateEventRun): BallStateIngestionSource | null => {
  if (run.inputHtmlDir) {
    return {
      label: "saved-html-dir",
      args: [
        join(modelDirectory, "run_no_paid_ball_state_live.py"),
        "--input-html-dir",
        run.inputHtmlDir,
        "--output-dir",
        run.outputDir,
        "--context-json",
        run.contextPath,
      ],
    }
  }

  if (run.inputHtmlPath) {
    return {
      label: "saved-html",
      args: [
        join(modelDirectory, "run_no_paid_ball_state_live.py"),
        "--input-html",
        run.inputHtmlPath,
        "--output-dir",
        run.outputDir,
        "--context-json",
        run.contextPath,
      ],
    }
  }

  if (run.sourceUrl) {
    if (!config.experimentalBallStateRemoteFetchEnabled) {
      return null
    }

    return {
      label: new URL(run.sourceUrl).hostname,
      args: [
        join(modelDirectory, "scrape_espncricinfo_ball_events.py"),
        "--output-dir",
        run.outputDir,
        "--url",
        run.sourceUrl,
        ...(run.fixtureId ? ["--fixture-id", run.fixtureId] : []),
      ],
    }
  }

  return null
}

const shouldAttemptBallStateIngestion = (force: boolean) => {
  if (force) {
    return true
  }

  const lastAttemptAt = ballStateShadowRefreshState.ingestionLastAttemptAt
  if (!lastAttemptAt) {
    return true
  }

  const lastAttemptMs = Date.parse(lastAttemptAt)
  return !Number.isFinite(lastAttemptMs) || Date.now() - lastAttemptMs >= ballStateEventIngestionIntervalMs
}

const runBallStateEventIngestion = async (run: BallStateEventRun, force: boolean) => {
  const source = buildBallStateIngestionSource(run)
  if (!source) {
    setBallStateShadowRefreshState({
      ingestionStatus: "unconfigured",
      ingestionSource: null,
      ingestionLastError: null,
    })
    return
  }

  setBallStateShadowRefreshState({ ingestionSource: source.label })
  if (!shouldAttemptBallStateIngestion(force)) {
    return
  }

  setBallStateShadowRefreshState({
    ingestionStatus: "running",
    ingestionLastAttemptAt: new Date().toISOString(),
    ingestionLastError: null,
  })

  try {
    await runPythonScript(source.args, ballStateEventIngestionTimeoutMs)
    setBallStateShadowRefreshState({
      ingestionStatus: "succeeded",
      ingestionLastSuccessAt: new Date().toISOString(),
      ingestionLastError: null,
    })
    logger.info("Ingested experimental ball-state source events", {
      outputDir: run.relativeOutputDir,
      source: source.label,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setBallStateShadowRefreshState({
      ingestionStatus: "failed",
      ingestionLastError: "Experimental ball-state source ingestion failed; check server logs.",
    })
    logger.warn("Experimental ball-state source ingestion failed", {
      outputDir: run.relativeOutputDir,
      source: source.label,
      error: message,
    })
  }
}

const runBallStateShadowPipeline = (run: BallStateEventRun) =>
  runPythonScript([
    join(modelDirectory, "run_no_paid_ball_state_live.py"),
    "--skip-scrape",
    "--output-dir",
    run.outputDir,
    "--context-json",
    run.contextPath,
    "--shadow",
  ], ballStateShadowRefreshTimeoutMs)

const refreshLatestBallStateShadowIfNeeded = async (force = false) => {
  if (!config.experimentalBallStateShadowRefreshEnabled) {
    setBallStateShadowRefreshState({
      status: "skipped",
      lastAttemptAt: new Date().toISOString(),
      lastError: "Experimental ball-state shadow refresh is disabled.",
    })
    return
  }

  if (ballStateShadowRefreshPromise) {
    return ballStateShadowRefreshPromise
  }

  ballStateShadowRefreshPromise = (async () => {
    const run = await findLatestBallStateEventRun()
    if (!run) {
      setBallStateShadowRefreshState({
        status: "skipped",
        lastAttemptAt: new Date().toISOString(),
        lastError: "No experimental normalized_ball_events.jsonl journal found.",
        eventJournalUpdatedAt: null,
        shadowUpdatedAt: null,
      })
      return
    }

    const contextExists = await getFileMtimeMs(run.contextPath)

    if (contextExists === null) {
      setBallStateShadowRefreshState({
        status: "failed",
        lastAttemptAt: new Date().toISOString(),
        lastError: `Missing fixture-context.json for ${run.relativeOutputDir}`,
        eventJournalUpdatedAt: mtimeToIso(run.eventsUpdatedAtMs),
        shadowUpdatedAt: mtimeToIso(run.scoresUpdatedAtMs),
      })
      return
    }

    await runBallStateEventIngestion(run, force)

    const eventsUpdatedAtMs = await getFileMtimeMs(run.eventsPath)
    const scoresUpdatedAtMs = await getFileMtimeMs(run.scoresPath)
    const eventJournalUpdatedAt = mtimeToIso(eventsUpdatedAtMs)
    const shadowUpdatedAt = mtimeToIso(scoresUpdatedAtMs)

    if (eventsUpdatedAtMs === null) {
      setBallStateShadowRefreshState({
        status: "skipped",
        lastAttemptAt: new Date().toISOString(),
        lastError: "No experimental normalized_ball_events.jsonl journal found after ingestion attempt.",
        eventJournalUpdatedAt,
        shadowUpdatedAt,
      })
      return
    }

    if (!force && scoresUpdatedAtMs !== null && scoresUpdatedAtMs >= eventsUpdatedAtMs) {
      setBallStateShadowRefreshState({
        status: "skipped",
        lastAttemptAt: new Date().toISOString(),
        lastError: null,
        eventJournalUpdatedAt,
        shadowUpdatedAt,
      })
      return
    }

    const attemptAt = new Date().toISOString()
    setBallStateShadowRefreshState({
      status: "running",
      lastAttemptAt: attemptAt,
      lastError: null,
      eventJournalUpdatedAt,
      shadowUpdatedAt,
    })

    try {
      await runBallStateShadowPipeline(run)
      const refreshedEventUpdatedAtMs = await getFileMtimeMs(run.eventsPath)
      const refreshedShadowUpdatedAtMs = await getFileMtimeMs(run.scoresPath)
      setBallStateShadowRefreshState({
        status: "succeeded",
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        eventJournalUpdatedAt: mtimeToIso(refreshedEventUpdatedAtMs),
        shadowUpdatedAt: mtimeToIso(refreshedShadowUpdatedAtMs),
      })
      logger.info("Refreshed experimental ball-state shadow output", {
        outputDir: run.relativeOutputDir,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setBallStateShadowRefreshState({
        status: "failed",
        lastError: "Experimental ball-state shadow refresh failed; check server logs.",
        eventJournalUpdatedAt,
        shadowUpdatedAt,
      })
      logger.warn("Experimental ball-state shadow refresh failed", {
        outputDir: run.relativeOutputDir,
        error: message,
      })
    }
  })().finally(() => {
    ballStateShadowRefreshPromise = null
  })

  return ballStateShadowRefreshPromise
}

const startBallStateShadowRefreshLoop = () => {
  void refreshLatestBallStateShadowIfNeeded().catch((error) => {
    logger.warn("Experimental ball-state shadow initial refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })

  return setInterval(() => {
    void refreshLatestBallStateShadowIfNeeded().catch((error) => {
      logger.warn("Experimental ball-state shadow periodic refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, ballStateShadowRefreshIntervalMs)
}

const getLatestBallStateShadow = async (activeFixtures: ActiveBallStateFixture[] = []): Promise<BallStateShadowResponse> => {
  const latest = await findLatestBallStateShadowRun(activeFixtures)
  if (!latest) {
    return unavailableBallStateShadow("No live-events shadow run found under model/experiments/ball-state.")
  }

  const scores = await readBallStateShadowScores(latest.scoresPath)
  if (!scores.length) {
    return unavailableBallStateShadow("Latest shadow run has no scored targets.")
  }

  const scoreByTarget = new Map(scores.map((score) => [score.target, score.shadowPrediction]))
  const firstScore = scores[0]
  if (!firstScore) {
    return unavailableBallStateShadow("Latest shadow run has no scored targets.")
  }

  const summary = await readJsonFileIfPresent(join(latest.outputDir, "shadow-run", "summary.json"))
  const parity = await readJsonFileIfPresent(join(latest.outputDir, "live_feature_parity_report.json"))
  const summaryRecord = isJsonRecord(summary) ? summary : {}
  const parityRecord = isJsonRecord(parity) ? parity : {}
  const livePayloadRecord = readRecordField(parityRecord, "live_payload")
  const entries = livePayloadRecord ? readArrayField(livePayloadRecord, "entries") : []
  const parityEntry = entries.find(isJsonRecord) ?? null
  const expectedRunsNow = scoreByTarget.get("expected_runs_now") ?? null
  const expectedWicketsNow = scoreByTarget.get("expected_wickets_now") ?? null
  const runsDelta = expectedRunsNow === null || firstScore.scoreRuns === null
    ? null
    : firstScore.scoreRuns - expectedRunsNow
  const wicketsDelta = expectedWicketsNow === null || firstScore.scoreWickets === null
    ? null
    : firstScore.scoreWickets - expectedWicketsNow

  return {
    status: "experimental",
    source: "ball-state-shadow",
    available: true,
    outputDir: latest.relativeOutputDir,
    updatedAt: new Date(latest.updatedAtMs).toISOString(),
    currentState: {
      fixtureId: firstScore.fixtureId,
      innings: firstScore.innings,
      battingTeam: firstScore.battingTeam,
      bowlingTeam: firstScore.bowlingTeam,
      scoreRuns: firstScore.scoreRuns,
      scoreWickets: firstScore.scoreWickets,
      balls: firstScore.balls,
    },
    predictions: {
      expectedRunsNow,
      expectedWicketsNow,
      runsDelta,
      wicketsDelta,
      finalInningsRuns: scoreByTarget.get("final_innings_runs") ?? null,
      finalInningsWickets: scoreByTarget.get("final_innings_wickets") ?? null,
      remainingInningsRuns: scoreByTarget.get("remaining_innings_runs") ?? null,
      remainingInningsWickets: scoreByTarget.get("remaining_innings_wickets") ?? null,
      chaseSuccessProbability: scoreByTarget.get("chase_success") ?? null,
    },
    parity: {
      readyForInference: typeof livePayloadRecord?.ready_for_inference === "boolean"
        ? livePayloadRecord.ready_for_inference
        : null,
      featureMode: readStringField(parityRecord, "feature_mode"),
      missingCoreFeatures: parityEntry ? readArrayField(parityEntry, "missing_core_features") : [],
      missingEventTrajectoryFeatures: parityEntry ? readArrayField(parityEntry, "missing_event_trajectory_features") : [],
      snapshotDiagnostics: parityEntry ? readRecordField(parityEntry, "snapshot_diagnostics") : null,
    },
    summary: {
      inputRows: readNumberField(summaryRecord, "input_rows"),
      scoredEntries: readNumberField(summaryRecord, "scored_entries"),
      targetScores: readNumberField(summaryRecord, "target_scores"),
      rejectedRows: readNumberField(summaryRecord, "rejected_rows"),
      targetScoreCounts: readRecordField(summaryRecord, "target_score_counts"),
      notes: readArrayField(summaryRecord, "notes"),
    },
    refresh: ballStateShadowRefreshState,
    scores,
    notes: [
      "Experimental read-only bridge over model/experiments/ball-state live-events shadow outputs.",
      "Does not read or modify model/final_models, model/predict_fixture.py, or model/data/live.",
      "Refresh and remote source ingestion are opt-in runtime operations, not GET request side effects.",
    ],
  }
}

const runPredictFixture = (args: string[]) =>
  Effect.tryPromise<{ stdout: string; stderr: string }, Error>({
    try: () =>
      new Promise((resolve, reject) => {
        execFile("python3", [predictorScriptPath, ...args], { cwd: join(currentDirectory, "..") }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message))
            return
          }
          resolve({ stdout, stderr })
        })
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

const runPackageScript = (scriptName: string) =>
  new Promise<void>((resolve, reject) => {
    execFile("pnpm", [scriptName], { cwd: join(currentDirectory, "..") }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      resolve()
    })
  })

const getOldestPredictorLiveDataMtimeMs = async () => {
  const stats = await Promise.all([
    stat(upcomingFixturesJsonPath),
    stat(upcomingFixturesCsvPath),
    stat(upcomingFixtureEloPath),
    stat(currentSeasonSquadsPath),
    stat(currentSeasonPlayerStatsPath),
  ])
  return Math.min(...stats.map((entry) => entry.mtimeMs))
}

const refreshPredictorLiveData = async () => {
  await runPackageScript("model:data:fixtures")
  await runPackageScript("model:data:results-current")
  await runPackageScript("model:data:squads-current")
  await runPackageScript("model:data:player-stats-current")
  await runPackageScript("model:data:elo-current")
  await refreshPredictorPerformanceSummary()
}

const loadPredictorFixtures = async () =>
  JSON.parse(await readFile(upcomingFixturesJsonPath, "utf-8")) as PredictorFixtureRow[]

const shouldGenerateAutomaticPreTossSnapshot = (
  fixture: PredictorFixtureRow,
  now: number,
) => {
  const matchTime = Date.parse(fixture.match_date)
  if (!Number.isFinite(matchTime)) return false
  if (fixture.is_completed) return false
  return matchTime > now && matchTime - now <= automaticPreTossLookaheadMs
}

const shouldAttemptAutomaticPostTossSnapshot = (
  fixture: PredictorFixtureRow,
  now: number,
) => {
  const matchTime = Date.parse(fixture.match_date)
  if (!Number.isFinite(matchTime)) return false
  if (fixture.is_completed) return false
  return (
    fixture.is_live ||
    (matchTime - automaticPostTossWindowBeforeStartMs <= now &&
      now <= matchTime + automaticPostTossWindowAfterStartMs)
  )
}

const runAutomaticPredictorSnapshots = async () => {
  const fixtures = await loadPredictorFixtures().catch(() => [] as PredictorFixtureRow[])
  if (!fixtures.length) {
    return
  }

  const now = Date.now()
  const modelSourceHash = await getCurrentPredictorModelSourceHash()
  const snapshotKeys = await listStoredPredictorSnapshotKeys()

  const tryRecordSnapshot = async (fixtureId: string, mode: "pre_toss" | "post_toss") => {
    const requestProfile = "automatic"
    const snapshotKey = buildPredictorSnapshotKey(
      fixtureId,
      mode,
      requestProfile,
      modelSourceHash,
    )
    if (snapshotKeys.has(snapshotKey)) {
      return false
    }

    const { stdout } = await Effect.runPromise(
      runPredictFixture(["--fixture-id", fixtureId, "--mode", mode]),
    )
    const result = JSON.parse(stdout) as Record<string, unknown>

    if (
      mode === "post_toss" &&
      result.official_post_toss_applied !== true
    ) {
      return false
    }

    await recordPredictorPerformanceSnapshot(
      {
        fixtureId,
        mode,
        tossWinner: null,
        tossDecision: null,
        team1ProbableXi: [],
        team2ProbableXi: [],
        featureOverrides: null,
      },
      result as never,
    )
    snapshotKeys.add(snapshotKey)
    logger.info("Recorded automatic predictor snapshot", { fixtureId, mode })
    return true
  }

  for (const fixture of fixtures.sort((left, right) => left.match_date.localeCompare(right.match_date))) {
    if (shouldGenerateAutomaticPreTossSnapshot(fixture, now)) {
      try {
        await tryRecordSnapshot(fixture.fixture_id, "pre_toss")
      } catch (error) {
        logger.warn("Automatic pre-toss snapshot generation failed", {
          fixtureId: fixture.fixture_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (shouldAttemptAutomaticPostTossSnapshot(fixture, now)) {
      try {
        await tryRecordSnapshot(fixture.fixture_id, "post_toss")
      } catch (error) {
        logger.warn("Automatic post-toss snapshot generation failed", {
          fixtureId: fixture.fixture_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

const startPredictorMaintenanceLoop = () => {
  const runMaintenance = async () => {
    try {
      await refreshPredictorLiveData()
      await runAutomaticPredictorSnapshots()
      await backfillHistoricalPostTossSnapshots()
      await refreshPredictorPerformanceSummary()
      logger.debug("Refreshed predictor maintenance data in background")
    } catch (error) {
      logger.warn("Predictor maintenance refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const runMaintenanceWithLock = () => {
    if (predictorLiveDataRefreshPromise) {
      logger.debug("Skipped predictor maintenance refresh because one is already running")
      return predictorLiveDataRefreshPromise
    }

    predictorLiveDataRefreshPromise = runMaintenance().finally(() => {
      predictorLiveDataRefreshPromise = null
    })
    return predictorLiveDataRefreshPromise
  }

  void runMaintenanceWithLock()
  return setInterval(() => {
    void runMaintenanceWithLock()
  }, predictorMaintenanceIntervalMs)
}

const ensurePredictorLiveDataFresh = () =>
  Effect.tryPromise<void, Error>({
    try: async () => {
      const now = Date.now()
      const oldestMtime = await getOldestPredictorLiveDataMtimeMs().catch(() => 0)
      if (oldestMtime > 0 && now - oldestMtime < predictorLiveDataMaxAgeMs) {
        return
      }

      if (!predictorLiveDataRefreshPromise) {
        predictorLiveDataRefreshPromise = refreshPredictorLiveData().finally(() => {
          predictorLiveDataRefreshPromise = null
        })
      }

      await predictorLiveDataRefreshPromise
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

// Load historical data once at startup
let historicalMatches: Awaited<ReturnType<typeof loadCricsheetData>> | null = null

const createApp = Effect.sync((): Express => {
  const app = express()

  app.use(express.json())
  app.use("/observer/assets", express.static(publicDirectory))

  app.get("/", (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          logger.debug("Handled GET /")
        })

        const endpoints = [
          "/",
          "/health",
          "/predictor",
          "/predictor/api/fixtures",
          "/predictor/api/context",
          "/predictor/api/predict",
          "/predictor/api/performance",
          "/predict/ipl",
        ]

        if (!config.predictorOnlyMode) {
          endpoints.push(
            "/observer/status",
            "/observer/diagnostics",
            "/observer/metrics",
            "/observer/dashboard",
            "/observer/fixtures",
            "/observer/fixtures/live",
            "/observer/fixtures/:fixtureId",
            "/observer/opportunities",
            "/observer/opportunities/diagnostics",
            "/observer/live-model",
            "/observer/live-model/history",
            "/observer/live-model/history/:fixtureId",
            "/observer/live-model/snapshots",
            "/observer/live-model/signals",
            "/observer/ball-state-shadow",
            "/observer/tape/live",
            "/observer/history/signals",
            "/observer/signals",
          )
        }

        return {
          message: "IPL Trader API is running",
          mode: config.predictorOnlyMode ? "predictor_only" : "full_app",
          endpoints,
        }
      }),
    )
  })

  app.get("/health", (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          logger.debug("Handled GET /health")
        })

        const database = yield* checkDatabaseConnectionIfEnabled()
        const observer = config.predictorOnlyMode
          ? {
              enabled: false,
              mode: "predictor_only" as const,
            }
          : (yield* loadObserverService()).getStatus()

        return {
          status: "ok" as const,
          uptimeSeconds: Math.round(process.uptime()),
          mode: config.predictorOnlyMode ? "predictor_only" : "full_app",
          database,
          observer,
        }
      }),
    )
  })

  app.get("/ready", (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          logger.debug("Handled GET /ready")
        })

        if (config.predictorOnlyMode) {
          return {
            ready: true,
            mode: "predictor_only" as const,
            database: "disabled" as const,
            observer: "disabled" as const,
          }
        }

        yield* checkDatabaseConnectionIfEnabled()
        const readiness = (yield* loadObserverService()).getReadiness()

        if (!readiness.ready) {
          res.status(503)
        }

        return readiness
      }),
    )
  })

  app.get("/observer/dashboard", (_req, res) => {
    if (config.predictorOnlyMode) {
      res.status(503).send("Observer dashboard is disabled in predictor-only mode")
      return
    }

    res.sendFile(join(publicDirectory, "observer-dashboard.html"))
  })

  app.get("/predictor", (_req, res) => {
    res.sendFile(join(publicDirectory, "predictor.html"))
  })

  app.get("/predictor/api/fixtures", (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* ensurePredictorLiveDataFresh()
        return yield* Effect.tryPromise({
          try: async () => JSON.parse(await readFile(upcomingFixturesJsonPath, "utf-8")) as unknown,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }),
    )
  })

  app.post("/predictor/api/predict", (req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        const body = req.body as Record<string, unknown>
        const fixtureId = typeof body.fixtureId === "string" ? body.fixtureId : null
        const mode = body.mode === "post_toss" ? "post_toss" : "pre_toss"

        if (!fixtureId) {
          res.status(400)
          return { error: "fixtureId is required" }
        }

        const args = ["--fixture-id", fixtureId, "--mode", mode]

        if (typeof body.tossWinner === "string" && body.tossWinner.trim()) {
          args.push("--toss-winner", body.tossWinner)
        }
        if (typeof body.tossDecision === "string" && body.tossDecision.trim()) {
          args.push("--toss-decision", body.tossDecision)
        }
        if (Array.isArray(body.team1ProbableXi) && body.team1ProbableXi.every((item) => typeof item === "string")) {
          args.push("--team1-probable-xi-json", JSON.stringify(body.team1ProbableXi))
        }
        if (Array.isArray(body.team2ProbableXi) && body.team2ProbableXi.every((item) => typeof item === "string")) {
          args.push("--team2-probable-xi-json", JSON.stringify(body.team2ProbableXi))
        }
        if (body.featureOverrides && typeof body.featureOverrides === "object") {
          args.push("--feature-overrides-json", JSON.stringify(body.featureOverrides))
        }

        logger.debug("Handled POST /predictor/api/predict", {
          fixtureId,
          mode,
        })

        yield* ensurePredictorLiveDataFresh()
        const { stdout } = yield* runPredictFixture(args)
        const result = JSON.parse(stdout) as Record<string, unknown>

        yield* Effect.tryPromise({
          try: () =>
            recordPredictorPerformanceSnapshot(
              {
                fixtureId,
                mode,
                tossWinner:
                  typeof body.tossWinner === "string" ? body.tossWinner : null,
                tossDecision:
                  typeof body.tossDecision === "string" ? body.tossDecision : null,
                team1ProbableXi:
                  Array.isArray(body.team1ProbableXi) &&
                  body.team1ProbableXi.every((item) => typeof item === "string")
                    ? body.team1ProbableXi
                    : [],
                team2ProbableXi:
                  Array.isArray(body.team2ProbableXi) &&
                  body.team2ProbableXi.every((item) => typeof item === "string")
                    ? body.team2ProbableXi
                    : [],
                featureOverrides:
                  body.featureOverrides && typeof body.featureOverrides === "object"
                    ? (body.featureOverrides as Record<string, unknown>)
                    : null,
              },
              result as never,
            ),
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              logger.warn("Failed to record predictor performance snapshot", {
                fixtureId,
                mode,
                error: error.message,
              })
            }),
          ),
          Effect.ignore,
        )

        return result as unknown
      }),
    )
  })

  app.get("/predictor/api/performance", (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* ensurePredictorLiveDataFresh()
        return yield* Effect.tryPromise({
          try: () => getPredictorPerformanceSummary(),
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        })
      }),
    )
  })

  app.post("/predictor/api/context", (req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        const body = req.body as Record<string, unknown>
        const fixtureId = typeof body.fixtureId === "string" ? body.fixtureId : null
        const mode = body.mode === "post_toss" ? "post_toss" : "pre_toss"

        if (!fixtureId) {
          res.status(400)
          return { error: "fixtureId is required" }
        }

        logger.debug("Handled POST /predictor/api/context", {
          fixtureId,
          mode,
        })

        yield* ensurePredictorLiveDataFresh()
        const { stdout } = yield* runPredictFixture([
          "--fixture-id",
          fixtureId,
          "--mode",
          mode,
          "--describe-context",
        ])

        return JSON.parse(stdout) as unknown
      }),
    )
  })

  app.get("/observer/status", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/status")
        })

        return (yield* loadObserverService()).getStatus()
      }),
    )
  })

  app.get("/observer/diagnostics", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/diagnostics")
        })

        return (yield* loadObserverService()).getDiagnostics()
      }),
    )
  })

  app.get("/observer/metrics", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/metrics")
        })

        return (yield* loadObserverService()).getMetrics()
      }),
    )
  })

  app.get("/observer/fixtures", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          logger.debug("Handled GET /observer/fixtures")
          return (await Effect.runPromise(loadObserverService())).getRecentFixtures(20)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/fixtures/live", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/fixtures/live")
        })

        return (yield* loadObserverService()).getLiveFixtures()
      }),
    )
  })

  app.get("/observer/fixtures/:fixtureId", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const fixtureId = Array.isArray(req.params.fixtureId)
            ? req.params.fixtureId[0]
            : req.params.fixtureId

          if (!fixtureId) {
            res.status(400)
            return { error: "Fixture id is required" }
          }

          logger.debug("Handled GET /observer/fixtures/:fixtureId", {
            fixtureId,
          })

          const detail = await (await Effect.runPromise(loadObserverService())).getFixtureDetail(fixtureId)

          if (!detail) {
            res.status(404)
            return { error: "Fixture not found" }
          }

          return detail
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/opportunities", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const minEdgeBps = parseNumberQuery(req.query.minEdgeBps, 100)
          const minConfidence = parseConfidenceQuery(req.query.minConfidence) ?? "medium"

          logger.debug("Handled GET /observer/opportunities", {
            minEdgeBps,
            minConfidence,
          })

          return (await Effect.runPromise(loadObserverService())).getLiveOpportunities({
            minEdgeBps,
            minConfidence,
          })
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/opportunities/diagnostics", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const minEdgeBps = parseNumberQuery(req.query.minEdgeBps, 100)

          logger.debug("Handled GET /observer/opportunities/diagnostics", {
            minEdgeBps,
          })

          return (await Effect.runPromise(loadObserverService())).getOpportunityDiagnostics(minEdgeBps)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/tape/live", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/tape/live")
        })

        return (yield* loadObserverService()).getLiveTape()
      }),
    )
  })

  app.get("/observer/live-model", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        if (config.predictorOnlyMode) {
          return observerDisabledError(res)
        }

        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/live-model")
        })

        return (yield* loadObserverService()).getLiveModelFixtures()
      }),
    )
  })

  app.get("/observer/live-model/history", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const limit = parseNumberQuery(req.query.limit, 20)

          logger.debug("Handled GET /observer/live-model/history", { limit })
          return (await Effect.runPromise(loadObserverService())).getLiveModelHistory(limit)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/live-model/history/:fixtureId", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const fixtureId = Array.isArray(req.params.fixtureId)
            ? req.params.fixtureId[0]
            : req.params.fixtureId

          if (!fixtureId) {
            res.status(400)
            return { error: "Fixture id is required" }
          }

          logger.debug("Handled GET /observer/live-model/history/:fixtureId", { fixtureId })
          const detail = await (await Effect.runPromise(loadObserverService())).getFixtureDetail(fixtureId)

          if (!detail) {
            res.status(404)
            return { error: "Fixture not found" }
          }

          return detail
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/live-model/snapshots", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const limit = parseNumberQuery(req.query.limit, 50)

          logger.debug("Handled GET /observer/live-model/snapshots", { limit })
          return (await Effect.runPromise(loadObserverService())).getRecentLiveModelSnapshots(limit)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/live-model/signals", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          const limit = parseNumberQuery(req.query.limit, 50)

          logger.debug("Handled GET /observer/live-model/signals", { limit })
          return (await Effect.runPromise(loadObserverService())).getRecentLiveModelSignals(limit)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/ball-state-shadow", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          logger.debug("Handled GET /observer/ball-state-shadow")
          const activeFixtures = (await Effect.runPromise(loadObserverService())).getLiveFixtures()
            .map(({ fixture }) => ({
              id: fixture.id,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
            }))
          return getLatestBallStateShadow(activeFixtures)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/signals", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          logger.debug("Handled GET /observer/signals")
          return (await Effect.runPromise(loadObserverService())).getRecentSignals(50)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  app.get("/observer/history/signals", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          if (config.predictorOnlyMode) {
            return observerDisabledError(res)
          }

          logger.debug("Handled GET /observer/history/signals")
          return (await Effect.runPromise(loadObserverService())).getRecentSignals(50)
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })

  // IPL Prediction Endpoint
  app.post("/predict/ipl", (req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        const body = req.body as Record<string, unknown>

        logger.debug("Handled POST /predict/ipl", { body })

        // Validate request
        if (!body.matchId || !body.team1 || !body.team2 || !body.venue || !body.matchDate) {
          res.status(400)
          return {
            error: "Missing required fields: matchId, team1, team2, venue, matchDate",
          }
        }

        // Load historical data if not already loaded
        if (!historicalMatches) {
          historicalMatches = loadCricsheetData("./data/cricsheet")
        }

        // Get aggregated odds
        const aggregatedOdds = yield* getAggregatedOdds(
          body.team1 as string,
          body.team2 as string
        )

        // Create prediction request
        const predictionRequest: PredictionRequest = {
          matchId: body.matchId as string,
          season: (body.season as number) || 2026,
          matchDate: new Date(body.matchDate as string),
          venue: body.venue as string,
          team1: body.team1 as string,
          team2: body.team2 as string,
          tossWinner: (body.tossWinner as string | null) || null,
          tossDecision: (body.tossDecision as string | null) || null,
          bookmakersOdds: aggregatedOdds.averageTeam1Odds,
          polymarketOdds: aggregatedOdds.averageTeam1Odds,
        }

        // Generate predictions
        const { team1Prediction, team2Prediction } = generatePredictions(
          predictionRequest,
          historicalMatches
        )

        return {
          matchId: body.matchId,
          team1: team1Prediction,
          team2: team2Prediction,
          odds: aggregatedOdds,
          timestamp: new Date().toISOString(),
        }
      }),
    )
  })

  return app
})

const listen = (app: Express, port: number) =>
  Effect.tryPromise<Server, Error>({
    try: () =>
      new Promise((resolve, reject) => {
        const server = app.listen(port)

        const onListening = () => {
          server.off("error", onError)
          resolve(server)
        }

        const onError = (error: unknown) => {
          server.off("listening", onListening)
          reject(error instanceof Error ? error : new Error(String(error)))
        }

        server.once("listening", onListening)
        server.once("error", onError)
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

const program = Effect.gen(function* () {
  const app = yield* createApp

  if (config.predictorOnlyMode) {
    yield* Effect.sync(() => {
      logger.warn(
        "Starting in predictor-only mode; database checks and observer startup are disabled",
      )
    })
  } else {
    yield* checkDatabaseConnectionIfEnabled()

    yield* Effect.sync(() => {
      logger.debug("Database connection check succeeded")
    })
  }

  yield* listen(app, config.port)
  yield* Effect.sync(() => {
    logger.info(`Server listening on http://localhost:${config.port}`)
    startPredictorMaintenanceLoop()
    if (!config.predictorOnlyMode && config.experimentalBallStateShadowRefreshEnabled) {
      startBallStateShadowRefreshLoop()
    }
  })

  if (!config.predictorOnlyMode) {
    const observerService = yield* loadObserverService()
    yield* Effect.sync(() => {
      void observerService.start().catch((error) => {
        logger.error("Failed to start IPL observer", { error })
      })
    })
  }

  yield* Effect.never
})

void Effect.runPromise(program).catch((error) => {
  logger.error("Failed to start server", { error })
  process.exitCode = 1
})
