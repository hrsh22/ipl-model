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
import { checkDatabaseConnection } from "./database.js"
import logger from "./logger.js"
import { observerService } from "./observer/service.js"
import { loadCricsheetData } from "./ipl/data-loader.js"
import { generatePredictions, type PredictionRequest } from "./ipl/prediction-service.js"
import { getAggregatedOdds } from "./ipl/odds-service.js"

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
const predictorLiveDataMaxAgeMs = 2 * 60 * 1000

let predictorLiveDataRefreshPromise: Promise<void> | null = null

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
  ])
  return Math.min(...stats.map((entry) => entry.mtimeMs))
}

const refreshPredictorLiveData = async () => {
  await runPackageScript("model:data:fixtures")
  await runPackageScript("model:data:elo-current")
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

        return {
          message: "IPL Trader API is running",
          endpoints: [
            "/",
            "/health",
            "/observer/status",
            "/observer/diagnostics",
            "/observer/metrics",
            "/observer/dashboard",
            "/predictor",
            "/observer/fixtures",
            "/observer/fixtures/live",
            "/observer/fixtures/:fixtureId",
            "/observer/opportunities",
            "/observer/opportunities/diagnostics",
            "/observer/tape/live",
            "/observer/history/signals",
            "/observer/signals",
            "/predict/ipl",
          ],
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

        yield* checkDatabaseConnection

        return {
          status: "ok" as const,
          uptimeSeconds: Math.round(process.uptime()),
          database: "reachable" as const,
          observer: observerService.getStatus(),
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

        yield* checkDatabaseConnection
        const readiness = observerService.getReadiness()

        if (!readiness.ready) {
          res.status(503)
        }

        return readiness
      }),
    )
  })

  app.get("/observer/dashboard", (_req, res) => {
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
        return JSON.parse(stdout) as unknown
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
        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/status")
        })

        return observerService.getStatus()
      }),
    )
  })

  app.get("/observer/diagnostics", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/diagnostics")
        })

        return observerService.getDiagnostics()
      }),
    )
  })

  app.get("/observer/metrics", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/metrics")
        })

        return observerService.getMetrics()
      }),
    )
  })

  app.get("/observer/fixtures", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          logger.debug("Handled GET /observer/fixtures")
          return observerService.getRecentFixtures(20)
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
        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/fixtures/live")
        })

        return observerService.getLiveFixtures()
      }),
    )
  })

  app.get("/observer/fixtures/:fixtureId", requireObserverAuth, (req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
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

          const detail = await observerService.getFixtureDetail(fixtureId)

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
          const minEdgeBps = parseNumberQuery(req.query.minEdgeBps, 100)
          const minConfidence = parseConfidenceQuery(req.query.minConfidence) ?? "medium"

          logger.debug("Handled GET /observer/opportunities", {
            minEdgeBps,
            minConfidence,
          })

          return observerService.getLiveOpportunities({
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
          const minEdgeBps = parseNumberQuery(req.query.minEdgeBps, 100)

          logger.debug("Handled GET /observer/opportunities/diagnostics", {
            minEdgeBps,
          })

          return observerService.getOpportunityDiagnostics(minEdgeBps)
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
        yield* Effect.sync(() => {
          logger.debug("Handled GET /observer/tape/live")
        })

        return observerService.getLiveTape()
      }),
    )
  })

  app.get("/observer/signals", requireObserverAuth, (_req, res) => {
    sendJson(
      res,
      Effect.tryPromise({
        try: async () => {
          logger.debug("Handled GET /observer/signals")
          return observerService.getRecentSignals(50)
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
          logger.debug("Handled GET /observer/history/signals")
          return observerService.getRecentSignals(50)
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
  yield* checkDatabaseConnection

  yield* Effect.sync(() => {
    logger.debug("Database connection check succeeded")
  })
  yield* listen(app, config.port)
  yield* Effect.sync(() => {
    logger.info(`Server listening on http://localhost:${config.port}`)
  })
  yield* Effect.sync(() => {
    void observerService.start().catch((error) => {
      logger.error("Failed to start IPL observer", { error })
    })
  })
  yield* Effect.never
})

void Effect.runPromise(program).catch((error) => {
  logger.error("Failed to start server", { error })
  process.exitCode = 1
})
