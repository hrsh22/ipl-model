import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Server } from "node:http"
import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
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

let predictorLiveDataRefreshPromise: Promise<void> | null = null

type PredictorFixtureRow = {
  fixture_id: string
  match_date: string
  status: string
  is_live: boolean
  is_completed: boolean
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
