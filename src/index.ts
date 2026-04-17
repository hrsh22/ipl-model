import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Server } from "node:http"
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
            "/observer/fixtures",
            "/observer/fixtures/live",
            "/observer/fixtures/:fixtureId",
            "/observer/opportunities",
            "/observer/opportunities/diagnostics",
            "/observer/tape/live",
            "/observer/history/signals",
            "/observer/signals",
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
