import logger from "../logger.js"
import { config } from "../config.js"
import {
  assessTradingLiveReadiness,
  validateTradingRecipe,
  type TradingOrderStyle,
  type TradingReadinessResult,
  type TradingSide,
} from "./config.js"
import { TradingExecutor, type TradingExecutorEvaluationContext, type TradingExecutorStore } from "./executor.js"
import {
  buildPolymarketTradingAdapter,
  createPolymarketClobV2LiveClient,
  type PolymarketTradingAdapter,
} from "./polymarket-adapter.js"
import { setTradingRuntimeReadinessFailureReasons } from "./api.js"
import {
  listTradingRecipes,
  type TradingIntentRecord,
  type TradingRecipeRecord,
} from "./repository.js"
import type { TradingExposureDayWindow } from "./policy.js"

export interface TradingRuntimeServiceOptions {
  enabled: boolean
  intervalMs: number
  leaseMs: number
  workerId: string
  maxMatchStateAgeMs: number
  maxBookAgeMs: number
  dailyBoundaryTimezone: string
  adapter?: PolymarketTradingAdapter
  store?: TradingExecutorStore
  buildEvaluationContext?: ConstructorParameters<typeof TradingExecutor>[0]["buildEvaluationContext"]
  now?: () => Date
}

export interface TradingRuntimeService {
  start(): void
  stop(): void
  processOnce(): Promise<void>
}

type JsonRecord = Record<string, unknown>

const asObject = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null

const parseIsoDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const recipeToValidationInput = (recipe: TradingRecipeRecord | null) => recipe
  ? {
      marketId: recipe.marketId,
      conditionId: recipe.conditionId,
      tokenId: recipe.tokenId,
      side: recipe.side as TradingSide,
      orderStyle: recipe.orderStyle as TradingOrderStyle,
      maxPrice: recipe.maxPrice,
      expiryEpochMs: recipe.expiryTime.getTime(),
    }
  : null

const getTimezoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return asUtc - date.getTime()
}

export const buildDailyExposureWindow = (now: Date, timeZone: string): TradingExposureDayWindow => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const localMidnightUtc = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
  const start = new Date(localMidnightUtc.getTime() - getTimezoneOffsetMs(localMidnightUtc, timeZone))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1_000) }
}

export const buildRuntimeEvaluationContext = async (input: {
  intent: TradingIntentRecord
  recipe: TradingRecipeRecord | null
  now: Date
  maxMatchStateAgeMs: number
  maxBookAgeMs: number
  dailyBoundaryTimezone: string
  balanceAvailableUsd: number | null
}): Promise<TradingExecutorEvaluationContext> => {
  const context = asObject(input.intent.context)
  const observedAt = parseIsoDate(context?.observedAt)
  const ageMs = observedAt ? Math.max(0, input.now.getTime() - observedAt.getTime()) : null
  const recipeValidation = validateTradingRecipe(recipeToValidationInput(input.recipe))
  const readiness = assessTradingLiveReadiness({
    liveTradingEnabled: config.trading.liveEnabled,
    credentialsPresent: config.trading.polymarketCredentials.allPresent,
    recipe: recipeValidation,
  })

  return {
    readiness,
    marketStatus: "open",
    currentTokenId: input.intent.tokenId,
    balanceAvailableUsd: input.balanceAvailableUsd,
    matchStateAgeMs: ageMs,
    maxMatchStateAgeMs: input.maxMatchStateAgeMs,
    bookAgeMs: ageMs,
    maxBookAgeMs: input.maxBookAgeMs,
    dayWindow: buildDailyExposureWindow(input.now, input.dailyBoundaryTimezone),
  }
}

const buildStartupReadiness = async () => {
  const recipes = await listTradingRecipes(1)
  const recipeValidation = validateTradingRecipe(recipeToValidationInput(recipes[0] ?? null))
  return {
    readiness: assessTradingLiveReadiness({
      liveTradingEnabled: config.trading.liveEnabled,
      credentialsPresent: config.trading.polymarketCredentials.allPresent,
      recipe: recipeValidation,
    }),
  }
}

const buildRuntimeAdapter = async (): Promise<PolymarketTradingAdapter> => {
  const startup = await buildStartupReadiness()
  const liveClient = startup.readiness.liveReady
    ? await createPolymarketClobV2LiveClient({
        host: config.trading.polymarketClob.host,
        chainId: config.trading.polymarketClob.chainId,
        privateKey: process.env.POLYMARKET_PRIVATE_KEY,
        builderCode: process.env.POLY_BUILDER_CODE,
      })
    : null

  const readiness: TradingReadinessResult = liveClient && !liveClient.ok
    ? {
        liveReady: false,
        mode: "dry-run" as const,
        reasons: [{ code: "POLYMARKET_CREDENTIALS_MISSING" as const, errors: liveClient.reasons }],
      }
    : startup.readiness

  if (liveClient && !liveClient.ok) {
    setTradingRuntimeReadinessFailureReasons(liveClient.reasons)
    logger.warn("Polymarket CLOB V2 live client was not created; trading executor remains dry-run", {
      reasons: liveClient.reasons,
    })
  } else {
    setTradingRuntimeReadinessFailureReasons([])
  }

  return buildPolymarketTradingAdapter({
    requestedMode: readiness.liveReady ? "live" : "dry-run",
    readiness,
    ...(liveClient?.ok ? { liveClient: liveClient.client } : {}),
  })
}

export const createTradingRuntimeService = async (
  options: TradingRuntimeServiceOptions,
): Promise<TradingRuntimeService> => {
  const now = options.now ?? (() => new Date())
  const adapter = options.adapter ?? await buildRuntimeAdapter()
  let timer: NodeJS.Timeout | null = null
  let running = false

  const processOnce = async () => {
    const executor = new TradingExecutor({
      workerId: options.workerId,
      leaseMs: options.leaseMs,
      adapter,
      now,
      buildEvaluationContext: options.buildEvaluationContext ?? (async ({ intent, recipe, now: evaluationNow }) => {
        const balanceAvailableUsd = await adapter.getSpendablePusdBalance()
        return buildRuntimeEvaluationContext({
          intent,
          recipe,
          now: evaluationNow,
          maxMatchStateAgeMs: options.maxMatchStateAgeMs,
          maxBookAgeMs: options.maxBookAgeMs,
          dailyBoundaryTimezone: options.dailyBoundaryTimezone,
          balanceAvailableUsd,
        })
      }),
      ...(options.store ? { store: options.store } : {}),
    })
    const outcome = await executor.processNextTradeIntent()
    if (outcome.kind !== "no-op") {
      logger.info("Trading executor processed intent", { outcomeKind: outcome.kind })
    }
  }

  const tick = () => {
    if (running) {
      return
    }
    running = true
    void processOnce()
      .catch((error) => {
        logger.warn("Trading executor loop iteration failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        running = false
      })
  }

  return {
    start() {
      if (!options.enabled || timer) {
        return
      }
      tick()
      timer = setInterval(tick, options.intervalMs)
      logger.info("Trading executor loop started", {
        intervalMs: options.intervalMs,
        workerId: options.workerId,
        adapterMode: adapter.mode,
      })
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    processOnce,
  }
}

export const createConfiguredTradingRuntimeService = () => createTradingRuntimeService({
  enabled: config.trading.executor.enabled,
  intervalMs: config.trading.executor.intervalMs,
  leaseMs: config.trading.executor.leaseMs,
  workerId: config.trading.executor.workerId,
  maxMatchStateAgeMs: config.trading.staleWindows.matchStateMaxAgeMs,
  maxBookAgeMs: config.trading.staleWindows.bookMaxAgeMs,
  dailyBoundaryTimezone: config.trading.dailyBoundaryTimezone,
})
