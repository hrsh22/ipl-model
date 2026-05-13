import express, { type NextFunction, type Request, type Response } from "express"

import {
  SCOREBOARD_SIDE_STRATEGY_KEY,
  getScoreboardSideStrategySettings,
  type ScoreboardSideStrategyMode,
} from "../ipl/scoreboard-side-strategy.js"
import {
  assessTradingLiveReadiness,
  validateTradingRecipe,
  type TradingOrderStyle,
  type TradingReadinessResult,
  type TradingRecipeInput,
  type TradingSide,
} from "./config.js"
import type {
  TradeIntentStatus,
  TradingExecutionEventRecord,
  TradingExposureLedgerRecord,
  TradingIntentRecord,
  TradingRecipeRecord,
  TradingReconciliationCheckpointRecord,
} from "./repository.js"

export const TRADING_RECONCILIATION_CHECKPOINT_KEY = "polymarket:user-updates"

const REDACTED = "[REDACTED]"
const SENSITIVE_KEY_PATTERN = /(authorization|auth[_-]?header|credential|api[_-]?key|secret|passphrase|private[_-]?key|signature|signed|signed[_-]?payload|raw[_-]?order|order[_-]?auth|funded[_-]?account|account[_-]?identifier)/i
const allowedIntentStatuses = new Set<TradeIntentStatus>([
  "pending",
  "claimed",
  "submitted",
  "completed",
  "failed",
])

export interface TradingApiConfig {
  liveTradingEnabled: boolean
  dailyBoundaryTimezone: string
  polymarketCredentials: {
    privateKeyPresent: boolean
    builderCodePresent: boolean
    signatureType: number
    funderAddressRequired: boolean
    funderAddressPresent: boolean
    allPresent: boolean
  }
  scoreboardSideStrategy?: {
    mode: ScoreboardSideStrategyMode
    priceCap: number
    allocationFraction: number
  }
}

export interface TradingApiStore {
  listRecipes(limit?: number): Promise<TradingRecipeRecord[]>
  listIntents(params?: { limit?: number; status?: TradeIntentStatus }): Promise<TradingIntentRecord[]>
  getIntentById(intentId: number): Promise<TradingIntentRecord | null>
  listEvents(params?: { intentId?: number; limit?: number }): Promise<TradingExecutionEventRecord[]>
  listExposureEntries(): Promise<TradingExposureLedgerRecord[]>
  getReconciliationCheckpoint(checkpointKey: string): Promise<TradingReconciliationCheckpointRecord | null>
}

export interface CreateTradingRouterInput {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void
  store: TradingApiStore
  config: TradingApiConfig
}

let runtimeReadinessFailureReasons: string[] = []

export const setTradingRuntimeReadinessFailureReasons = (reasons: readonly string[]) => {
  runtimeReadinessFailureReasons = [...reasons]
}

type JsonRecord = Record<string, unknown>

const parseLimitQuery = (value: unknown, fallback: number, max: number) => {
  const firstValue = Array.isArray(value) ? value[0] : value
  const parsed = Number(firstValue)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(parsed, max)
}

const parseOptionalIntentStatus = (value: unknown) => {
  const firstValue = Array.isArray(value) ? value[0] : value

  return typeof firstValue === "string" && allowedIntentStatuses.has(firstValue as TradeIntentStatus)
    ? firstValue as TradeIntentStatus
    : null
}

const parseOptionalPositiveInteger = (value: unknown) => {
  const firstValue = Array.isArray(value) ? value[0] : value
  const parsed = Number(firstValue)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const asObject = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as JsonRecord
}

const collectSensitiveValues = (value: unknown, target: Set<string>, keyHint?: string) => {
  if (typeof value === "string") {
    if (SENSITIVE_KEY_PATTERN.test(keyHint ?? "") || /^bearer\s+/i.test(value)) {
      target.add(value)
      if (/^bearer\s+/i.test(value)) {
        target.add(value.replace(/^bearer\s+/i, "").trim())
      }
    }
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSensitiveValues(entry, target)
    }
    return
  }

  const object = asObject(value)
  if (!object) {
    return
  }

  for (const [key, entry] of Object.entries(object)) {
    collectSensitiveValues(entry, target, key)
  }
}

const replaceSensitiveString = (value: string, sensitiveValues: readonly string[]) => {
  if (/^bearer\s+/i.test(value)) {
    return REDACTED
  }

  return sensitiveValues.reduce(
    (sanitized, sensitiveValue) => sensitiveValue ? sanitized.split(sensitiveValue).join(REDACTED) : sanitized,
    value,
  )
}

export const redactTradingApiPayload = (payload: unknown, sensitiveValues: readonly string[] = []): unknown => {
  const allSensitiveValues = new Set(sensitiveValues)
  collectSensitiveValues(payload, allSensitiveValues)

  const sanitize = (value: unknown, keyHint?: string): unknown => {
    if (typeof value === "string") {
      return SENSITIVE_KEY_PATTERN.test(keyHint ?? "")
        ? REDACTED
        : replaceSensitiveString(value, [...allSensitiveValues])
    }

    if (typeof value === "number" || typeof value === "boolean" || value == null) {
      return value
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    if (Array.isArray(value)) {
      return value.map((entry) => sanitize(entry))
    }

    const object = asObject(value)
    if (!object) {
      return value
    }

    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitize(entry, key),
      ]),
    )
  }

  return sanitize(payload)
}

const sanitizeDetails = (details: unknown) => redactTradingApiPayload(details) as JsonRecord | null

const toIso = (value: Date | null) => value?.toISOString() ?? null

const recipeToValidationInput = (recipe: TradingRecipeRecord | null): TradingRecipeInput | null => recipe
  ? {
      marketId: recipe.marketId,
      conditionId: recipe.conditionId,
      tokenId: recipe.tokenId,
      side: recipe.side as TradingSide,
      orderStyle: recipe.orderStyle === "limit" || recipe.orderStyle === "market"
        ? recipe.orderStyle as TradingOrderStyle
        : null,
      maxPrice: recipe.maxPrice,
      expiryEpochMs: recipe.expiryTime.getTime(),
    }
  : null

const summarizeRecipeValidation = (recipe: TradingRecipeRecord | null) => {
  if (!recipe) {
    return {
      status: "missing" as const,
      recipeKey: null,
      errors: ["recipe is required"],
    }
  }

  const validation = validateTradingRecipe(recipeToValidationInput(recipe))
  if (!validation.ok) {
    return {
      status: "invalid" as const,
      recipeKey: recipe.recipeKey,
      errors: validation.errors,
      updatedAt: toIso(recipe.updatedAt),
    }
  }

  return {
    status: "valid" as const,
    recipeKey: recipe.recipeKey,
    strategyKey: recipe.strategyKey,
    recipeVersion: recipe.recipeVersion,
    windowKey: recipe.windowKey,
    fixtureId: recipe.fixtureId,
    marketId: recipe.marketId,
    conditionId: recipe.conditionId,
    tokenId: recipe.tokenId,
    side: recipe.side,
    orderStyle: recipe.orderStyle,
    maxPrice: recipe.maxPrice,
    expiryTime: toIso(recipe.expiryTime),
    updatedAt: toIso(recipe.updatedAt),
  }
}

const validateLatestRecipe = (recipe: TradingRecipeRecord | null) => {
  if (!recipe) {
    return null
  }

  return validateTradingRecipe(recipeToValidationInput(recipe))
}

const summarizeEnvironmentLiveGate = (config: TradingApiConfig) => ({
  flagKey: "TRADING_LIVE_ENABLED",
  enabled: config.liveTradingEnabled,
  present: true,
  reason: "Live trading is controlled by the TRADING_LIVE_ENABLED deployment environment variable.",
  updatedBy: "environment",
  details: {
    controlMode: "environment-only",
    audit: {
      action: "trading-live-env-gate-read",
      source: "environment",
    },
  },
  createdAt: null,
  updatedAt: null,
})

const summarizeReadinessBlockerReason = (reason: unknown) => {
  if (typeof reason === "string") {
    return reason
  }

  if (reason && typeof reason === "object" && "code" in reason) {
    const code = (reason as { code?: unknown }).code
    if (typeof code === "string" && code.trim()) {
      return code
    }
  }

  return "READINESS_BLOCKED"
}

const summarizeReadiness = (readiness: TradingReadinessResult, config: TradingApiConfig) => ({
  mode: readiness.mode,
  liveReady: readiness.liveReady,
  liveEnvGateEnabled: config.liveTradingEnabled,
  runtimeEnvGateEnabled: config.liveTradingEnabled,
  runtimeControlMode: "environment-only",
  polymarketCredentialsPresent: {
    privateKey: config.polymarketCredentials.privateKeyPresent,
    builderCode: config.polymarketCredentials.builderCodePresent,
    signatureType: config.polymarketCredentials.signatureType,
    funderAddressRequired: config.polymarketCredentials.funderAddressRequired,
    funderAddress: config.polymarketCredentials.funderAddressPresent,
    allPresent: config.polymarketCredentials.allPresent,
  },
  blockerReasons: readiness.liveReady ? [] : readiness.reasons.map(summarizeReadinessBlockerReason),
})

const summarizeActiveStrategy = (readiness: TradingReadinessResult, config: TradingApiConfig) => {
  const strategy = config.scoreboardSideStrategy ?? getScoreboardSideStrategySettings("value90")

  return {
    strategyKey: SCOREBOARD_SIDE_STRATEGY_KEY,
    mode: strategy.mode,
    priceCap: strategy.priceCap,
    allocationFraction: strategy.allocationFraction,
    executionMode: readiness.mode,
    dryRun: readiness.mode === "dry-run",
    liveReady: readiness.liveReady,
    readinessBlockers: readiness.liveReady ? [] : readiness.reasons.map(summarizeReadinessBlockerReason),
  }
}

const summarizeIntent = (intent: TradingIntentRecord) => ({
  id: intent.id,
  intentKey: intent.intentKey,
  recipeKey: intent.recipeKey,
  strategyKey: intent.strategyKey,
  recipeVersion: intent.recipeVersion,
  windowKey: intent.windowKey,
  fixtureId: intent.fixtureId,
  marketId: intent.marketId,
  conditionId: intent.conditionId,
  tokenId: intent.tokenId,
  side: intent.side,
  status: intent.status,
  claimCount: intent.claimCount,
  claimedBy: intent.claimedBy,
  claimedAt: toIso(intent.claimedAt),
  claimExpiresAt: toIso(intent.claimExpiresAt),
  lastErrorCode: intent.lastErrorCode,
  lastErrorMessage: intent.lastErrorMessage,
  context: sanitizeDetails(intent.context),
  createdAt: toIso(intent.createdAt),
  updatedAt: toIso(intent.updatedAt),
})

const summarizeEvent = (event: TradingExecutionEventRecord) => ({
  id: event.id,
  intentId: event.intentId,
  eventType: event.eventType,
  eventTime: toIso(event.eventTime),
  processedAt: toIso(event.processedAt),
  executorId: event.executorId,
  details: sanitizeDetails(event.details),
  createdAt: toIso(event.createdAt),
})

const summarizeExposureEntry = (entry: TradingExposureLedgerRecord) => ({
  id: entry.id,
  intentId: entry.intentId,
  fixtureId: entry.fixtureId,
  marketId: entry.marketId,
  tokenId: entry.tokenId,
  side: entry.side,
  entryType: entry.entryType,
  quantity: entry.quantity,
  notionalUsd: entry.notionalUsd,
  eventTime: toIso(entry.eventTime),
  processedAt: toIso(entry.processedAt),
  details: sanitizeDetails(entry.details),
  createdAt: toIso(entry.createdAt),
})

const roundUsd = (value: number) => Math.round(value * 100) / 100

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

const buildTradingDayWindow = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const localMidnightUtc = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
  const start = new Date(localMidnightUtc.getTime() - getTimezoneOffsetMs(localMidnightUtc, timeZone))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  return { start, end }
}

const summarizeExposure = (entries: TradingExposureLedgerRecord[], timeZone: string, now = new Date()) => {
  const dayWindow = buildTradingDayWindow(now, timeZone)
  const byFixture = new Map<string, {
    fixtureId: string
    openExposureUsd: number
    filledExposureUsd: number
    pendingOrdersUsd: number
  }>()
  let daySubmittedNotionalUsd = 0
  let dayPendingOrdersUsd = 0
  let totalOpenExposureUsd = 0
  let totalFilledExposureUsd = 0

  for (const entry of entries) {
    const notionalUsd = Number.isFinite(entry.notionalUsd) ? entry.notionalUsd : 0
    const inDayWindow = entry.eventTime.getTime() >= dayWindow.start.getTime() && entry.eventTime.getTime() < dayWindow.end.getTime()
    const fixture = byFixture.get(entry.fixtureId) ?? {
      fixtureId: entry.fixtureId,
      openExposureUsd: 0,
      filledExposureUsd: 0,
      pendingOrdersUsd: 0,
    }

    switch (entry.entryType) {
      case "submitted_notional":
        if (inDayWindow) {
          daySubmittedNotionalUsd += notionalUsd
        }
        break
      case "pending_order":
        if (inDayWindow) {
          dayPendingOrdersUsd += notionalUsd
        }
        totalOpenExposureUsd += notionalUsd
        fixture.pendingOrdersUsd += notionalUsd
        break
      case "open_exposure":
        totalOpenExposureUsd += notionalUsd
        fixture.openExposureUsd += notionalUsd
        break
      case "filled_exposure":
        totalFilledExposureUsd += notionalUsd
        fixture.filledExposureUsd += notionalUsd
        break
      default:
        break
    }

    byFixture.set(entry.fixtureId, fixture)
  }

  return {
    asOf: now.toISOString(),
    dayWindow: {
      start: dayWindow.start.toISOString(),
      end: dayWindow.end.toISOString(),
    },
    ledgerEntryCount: entries.length,
    daySubmittedNotionalUsd: roundUsd(daySubmittedNotionalUsd),
    dayPendingOrdersUsd: roundUsd(dayPendingOrdersUsd),
    totalOpenExposureUsd: roundUsd(totalOpenExposureUsd),
    totalFilledExposureUsd: roundUsd(totalFilledExposureUsd),
    byFixture: [...byFixture.values()].map((fixture) => ({
      fixtureId: fixture.fixtureId,
      openExposureUsd: roundUsd(fixture.openExposureUsd),
      filledExposureUsd: roundUsd(fixture.filledExposureUsd),
      pendingOrdersUsd: roundUsd(fixture.pendingOrdersUsd),
    })),
  }
}

const summarizeReconciliation = (checkpoint: TradingReconciliationCheckpointRecord | null) => ({
  checkpointKey: TRADING_RECONCILIATION_CHECKPOINT_KEY,
  present: checkpoint !== null,
  lastCursorPresent: Boolean(checkpoint?.lastCursor),
  lastReconciledAt: checkpoint ? toIso(checkpoint.lastReconciledAt) : null,
  details: checkpoint ? sanitizeDetails(checkpoint.details) : null,
  updatedAt: checkpoint ? toIso(checkpoint.updatedAt) : null,
})

export const buildTradingStatusResponse = async (input: {
  store: TradingApiStore
  config: TradingApiConfig
  now?: Date
}) => {
  const [recipes, latestIntents, latestEvents, exposureEntries, reconciliationCheckpoint] = await Promise.all([
    input.store.listRecipes(1),
    input.store.listIntents({ limit: 10 }),
    input.store.listEvents({ limit: 20 }),
    input.store.listExposureEntries(),
    input.store.getReconciliationCheckpoint(TRADING_RECONCILIATION_CHECKPOINT_KEY),
  ])
  const latestRecipe = recipes[0] ?? null
  const recipeValidation = validateLatestRecipe(latestRecipe)
  const readiness = assessTradingLiveReadiness({
    liveTradingEnabled: input.config.liveTradingEnabled,
    credentialsPresent: input.config.polymarketCredentials.allPresent,
    recipe: recipeValidation,
  })
  const effectiveReadiness: TradingReadinessResult = readiness.liveReady && runtimeReadinessFailureReasons.length > 0
    ? {
        liveReady: false,
        mode: "dry-run",
        reasons: [{ code: "POLYMARKET_CREDENTIALS_MISSING", errors: runtimeReadinessFailureReasons }],
      }
    : readiness

  return {
    status: "ok" as const,
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: effectiveReadiness.mode,
    liveReady: effectiveReadiness.liveReady,
    activeStrategy: summarizeActiveStrategy(effectiveReadiness, input.config),
    liveEligibility: summarizeReadiness(effectiveReadiness, input.config),
    runtimeFlag: summarizeEnvironmentLiveGate(input.config),
    recipeValidation: summarizeRecipeValidation(latestRecipe),
    latestIntents: latestIntents.map(summarizeIntent),
    latestEvents: latestEvents.map(summarizeEvent),
    exposureSummary: summarizeExposure(exposureEntries, input.config.dailyBoundaryTimezone, input.now),
    reconciliationStatus: summarizeReconciliation(reconciliationCheckpoint),
  }
}

export const createDatabaseTradingApiStore = (): TradingApiStore => ({
  listRecipes: async (limit) => {
    const repository = await import("./repository.js")
    return repository.listTradingRecipes(limit)
  },
  listIntents: async (params) => {
    const repository = await import("./repository.js")
    return repository.listTradingIntents(params)
  },
  getIntentById: async (intentId) => {
    const repository = await import("./repository.js")
    return repository.getTradeIntentById(intentId)
  },
  listEvents: async (params) => {
    const repository = await import("./repository.js")
    return repository.listRecentTradingExecutionEvents(params)
  },
  listExposureEntries: async () => {
    const repository = await import("./repository.js")
    return repository.listTradingExposureLedgerEntries()
  },
  getReconciliationCheckpoint: async (checkpointKey) => {
    const repository = await import("./repository.js")
    return repository.getTradingReconciliationCheckpoint(checkpointKey)
  },
})

const sendTradingJson = (
  handler: (req: Request, res: Response) => Promise<unknown>,
) => async (req: Request, res: Response) => {
  try {
    const body = await handler(req, res)
    if (!res.headersSent) {
      res.json(body)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown trading API error"
    res.status(500).json({ error: redactTradingApiPayload(message) })
  }
}

export const createTradingRouter = ({ requireAuth, store, config }: CreateTradingRouterInput) => {
  const router = express.Router()

  router.use(requireAuth)

  router.get("/trading/status", sendTradingJson(async () => buildTradingStatusResponse({ store, config })))

  router.get("/trading/controls/live", sendTradingJson(async () => {
    const status = await buildTradingStatusResponse({ store, config })
    return {
      runtimeFlag: status.runtimeFlag,
      liveEligibility: status.liveEligibility,
      recipeValidation: status.recipeValidation,
    }
  }))

  router.put("/trading/controls/live", sendTradingJson(async (req, res) => {
    const body = asObject(req.body)
    const enabled = body?.enabled
    if (typeof enabled !== "boolean") {
      res.status(400)
      return { error: "enabled must be a boolean" }
    }

    const status = await buildTradingStatusResponse({ store, config })
    res.status(409)
    return {
      error: "Live trading is controlled by TRADING_LIVE_ENABLED; update the deployment environment and restart the service.",
      requestedEnabled: enabled,
      runtimeFlag: status.runtimeFlag,
      liveEligibility: status.liveEligibility,
      recipeValidation: status.recipeValidation,
    }
  }))

  router.get("/trading/intents", sendTradingJson(async (req) => {
    const status = parseOptionalIntentStatus(req.query.status)
    const intents = await store.listIntents({
      limit: parseLimitQuery(req.query.limit, 50, 200),
      ...(status ? { status } : {}),
    })

    return { intents: intents.map(summarizeIntent) }
  }))

  router.get("/trading/intents/:intentId", sendTradingJson(async (req, res) => {
    const intentId = parseOptionalPositiveInteger(req.params.intentId)
    if (intentId == null) {
      res.status(400)
      return { error: "intentId must be a positive integer" }
    }

    const [intent, events] = await Promise.all([
      store.getIntentById(intentId),
      store.listEvents({ intentId, limit: 100 }),
    ])
    if (!intent) {
      res.status(404)
      return { error: "Trading intent not found" }
    }

    return {
      intent: summarizeIntent(intent),
      events: events.map(summarizeEvent),
    }
  }))

  router.get("/trading/events", sendTradingJson(async (req) => {
    const intentId = parseOptionalPositiveInteger(req.query.intentId)
    const events = await store.listEvents({
      ...(intentId ? { intentId } : {}),
      limit: parseLimitQuery(req.query.limit, 50, 200),
    })

    return { events: events.map(summarizeEvent) }
  }))

  router.get("/trading/exposure", sendTradingJson(async () => {
    const entries = await store.listExposureEntries()
    return {
      exposureSummary: summarizeExposure(entries, config.dailyBoundaryTimezone),
      recentEntries: entries.slice(-50).reverse().map(summarizeExposureEntry),
    }
  }))

  router.get("/trading/reconciliation/status", sendTradingJson(async () => {
    const checkpoint = await store.getReconciliationCheckpoint(TRADING_RECONCILIATION_CHECKPOINT_KEY)
    return { reconciliationStatus: summarizeReconciliation(checkpoint) }
  }))

  return router
}
