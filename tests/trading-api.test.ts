import { type Server } from 'node:http'

import express, { type NextFunction, type Request, type Response } from 'express'
import { afterEach, describe, expect, test } from 'vitest'

import {
  buildTradingStatusResponse,
  createTradingRouter,
  setTradingRuntimeReadinessFailureReasons,
  TRADING_RECONCILIATION_CHECKPOINT_KEY,
  TRADING_RUNTIME_LIVE_FLAG_KEY,
  type TradingApiConfig,
  type TradingApiStore,
} from '../src/trading/api.js'
import type {
  TradeIntentStatus,
  TradingExecutionEventRecord,
  TradingExposureLedgerRecord,
  TradingIntentRecord,
  TradingRecipeRecord,
  TradingReconciliationCheckpointRecord,
  TradingRuntimeFlagRecord,
  TradingRuntimeFlagUpsertInput,
} from '../src/trading/repository.js'

const FIXED_NOW = new Date('2026-05-11T10:00:00.000Z')
const AUTH_TOKEN = 'test-observer-token'

const tradingApiConfig: TradingApiConfig = {
  liveTradingEnabled: true,
  dailyBoundaryTimezone: 'Asia/Kolkata',
  polymarketCredentials: {
    privateKeyPresent: true,
    builderCodePresent: true,
    allPresent: true,
  },
}

const buildRecipe = (overrides: Partial<TradingRecipeRecord> = {}): TradingRecipeRecord => ({
  recipeKey: overrides.recipeKey ?? 'recipe:eleven-over:fixture-1',
  strategyKey: overrides.strategyKey ?? 'eleven-over',
  recipeVersion: overrides.recipeVersion ?? '2026-05-11-v1',
  windowKey: overrides.windowKey ?? '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
  fixtureId: overrides.fixtureId ?? 'fixture-1',
  marketId: overrides.marketId ?? 'market-1',
  conditionId: overrides.conditionId ?? 'condition-1',
  tokenId: overrides.tokenId ?? 'token-1',
  side: overrides.side ?? 'buy',
  orderStyle: overrides.orderStyle ?? 'limit',
  maxPrice: overrides.maxPrice ?? 0.42,
  size: overrides.size ?? 952.380952,
  expiryTime: overrides.expiryTime ?? new Date('2026-05-11T12:00:00.000Z'),
  context: overrides.context ?? null,
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const buildIntent = (overrides: Partial<TradingIntentRecord> = {}): TradingIntentRecord => ({
  id: overrides.id ?? 1,
  intentKey: overrides.intentKey ?? 'eleven-over:fixture-1:token-1:buy',
  recipeKey: overrides.recipeKey ?? 'recipe:eleven-over:fixture-1',
  strategyKey: overrides.strategyKey ?? 'eleven-over',
  recipeVersion: overrides.recipeVersion ?? '2026-05-11-v1',
  windowKey: overrides.windowKey ?? '2026-05-11-v1:fixture-1:innings-2:balls-66-72',
  fixtureId: overrides.fixtureId ?? 'fixture-1',
  marketId: overrides.marketId ?? 'market-1',
  conditionId: overrides.conditionId ?? 'condition-1',
  tokenId: overrides.tokenId ?? 'token-1',
  side: overrides.side ?? 'buy',
  status: overrides.status ?? 'pending',
  claimCount: overrides.claimCount ?? 0,
  claimedBy: overrides.claimedBy ?? null,
  claimedAt: overrides.claimedAt ?? null,
  claimExpiresAt: overrides.claimExpiresAt ?? null,
  lastErrorCode: overrides.lastErrorCode ?? null,
  lastErrorMessage: overrides.lastErrorMessage ?? null,
  context: overrides.context ?? null,
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const buildEvent = (overrides: Partial<TradingExecutionEventRecord> = {}): TradingExecutionEventRecord => ({
  id: overrides.id ?? 1,
  intentId: overrides.intentId ?? 1,
  eventType: overrides.eventType ?? 'submitted',
  eventTime: overrides.eventTime ?? FIXED_NOW,
  processedAt: overrides.processedAt ?? FIXED_NOW,
  executorId: overrides.executorId ?? 'worker-1',
  details: overrides.details ?? {},
  createdAt: overrides.createdAt ?? FIXED_NOW,
})

const buildExposureEntry = (overrides: Partial<TradingExposureLedgerRecord> = {}): TradingExposureLedgerRecord => ({
  id: overrides.id ?? 1,
  intentId: overrides.intentId ?? 1,
  fixtureId: overrides.fixtureId ?? 'fixture-1',
  marketId: overrides.marketId ?? 'market-1',
  tokenId: overrides.tokenId ?? 'token-1',
  side: overrides.side ?? 'buy',
  entryType: overrides.entryType ?? 'pending_order',
  quantity: overrides.quantity ?? 20,
  notionalUsd: overrides.notionalUsd ?? 8.4,
  eventTime: overrides.eventTime ?? FIXED_NOW,
  processedAt: overrides.processedAt ?? FIXED_NOW,
  details: overrides.details ?? {},
  createdAt: overrides.createdAt ?? FIXED_NOW,
})

class InMemoryTradingApiStore implements TradingApiStore {
  runtimeFlag: TradingRuntimeFlagRecord | null
  recipes: TradingRecipeRecord[]
  intents: TradingIntentRecord[]
  events: TradingExecutionEventRecord[]
  exposures: TradingExposureLedgerRecord[]
  reconciliationCheckpoint: TradingReconciliationCheckpointRecord | null
  upserts: TradingRuntimeFlagUpsertInput[] = []

  constructor(input: {
    runtimeFlag?: TradingRuntimeFlagRecord | null
    recipes?: TradingRecipeRecord[]
    intents?: TradingIntentRecord[]
    events?: TradingExecutionEventRecord[]
    exposures?: TradingExposureLedgerRecord[]
    reconciliationCheckpoint?: TradingReconciliationCheckpointRecord | null
  } = {}) {
    this.runtimeFlag = input.runtimeFlag ?? null
    this.recipes = input.recipes ?? [buildRecipe()]
    this.intents = input.intents ?? []
    this.events = input.events ?? []
    this.exposures = input.exposures ?? []
    this.reconciliationCheckpoint = input.reconciliationCheckpoint ?? null
  }

  async getRuntimeFlag(flagKey: string) {
    return this.runtimeFlag?.flagKey === flagKey ? this.runtimeFlag : null
  }

  async upsertRuntimeFlag(input: TradingRuntimeFlagUpsertInput) {
    this.upserts.push(input)
    const createdAt = this.runtimeFlag?.createdAt ?? FIXED_NOW
    this.runtimeFlag = {
      flagKey: input.flagKey,
      enabled: input.enabled,
      reason: input.reason ?? null,
      updatedBy: input.updatedBy ?? null,
      details: input.details ?? null,
      createdAt,
      updatedAt: FIXED_NOW,
    }
  }

  async listRecipes(limit = 20) {
    return this.recipes.slice(0, limit)
  }

  async listIntents(params: { limit?: number; status?: TradeIntentStatus } = {}) {
    const filtered = params.status
      ? this.intents.filter((intent) => intent.status === params.status)
      : this.intents

    return filtered.slice(0, params.limit ?? 50)
  }

  async getIntentById(intentId: number) {
    return this.intents.find((intent) => intent.id === intentId) ?? null
  }

  async listEvents(params: { intentId?: number; limit?: number } = {}) {
    const filtered = params.intentId
      ? this.events.filter((event) => event.intentId === params.intentId)
      : this.events

    return filtered.slice(0, params.limit ?? 50)
  }

  async listExposureEntries() {
    return this.exposures
  }

  async getReconciliationCheckpoint(checkpointKey: string) {
    return this.reconciliationCheckpoint?.checkpointKey === checkpointKey
      ? this.reconciliationCheckpoint
      : null
  }
}

const buildRuntimeFlag = (overrides: Partial<TradingRuntimeFlagRecord> = {}): TradingRuntimeFlagRecord => ({
  flagKey: overrides.flagKey ?? TRADING_RUNTIME_LIVE_FLAG_KEY,
  enabled: overrides.enabled ?? true,
  reason: overrides.reason ?? 'verified test flag',
  updatedBy: overrides.updatedBy ?? 'test',
  details: overrides.details ?? {},
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const buildCheckpoint = (overrides: Partial<TradingReconciliationCheckpointRecord> = {}): TradingReconciliationCheckpointRecord => ({
  checkpointKey: overrides.checkpointKey ?? TRADING_RECONCILIATION_CHECKPOINT_KEY,
  lastCursor: overrides.lastCursor ?? 'cursor-1',
  lastReconciledAt: overrides.lastReconciledAt ?? FIXED_NOW,
  details: overrides.details ?? {},
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
})

const createApp = (store: TradingApiStore, config: TradingApiConfig = tradingApiConfig) => {
  const app = express()
  app.use(express.json())
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.header('authorization') !== `Bearer ${AUTH_TOKEN}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    next()
  }

  app.use(createTradingRouter({ requireAuth, store, config }))
  return app
}

afterEach(() => {
  setTradingRuntimeReadinessFailureReasons([])
})

const listen = (app: express.Express) => new Promise<Server>((resolve, reject) => {
  const server = app.listen(0)
  server.once('listening', () => resolve(server))
  server.once('error', reject)
})

const requestJson = async (app: express.Express, path: string, init: RequestInit = {}) => {
  const server = await listen(app)
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Expected server to listen on a random TCP port')
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    const body = await response.json() as unknown
    return { response, body }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

describe('trading API routes', () => {
  test('protects trading JSON routes with observer-style bearer auth', async () => {
    const store = new InMemoryTradingApiStore()
    const { response, body } = await requestJson(createApp(store), '/trading/status')

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  test('returns string-only live eligibility blocker reasons when trading is blocked', async () => {
    const store = new InMemoryTradingApiStore({
      runtimeFlag: buildRuntimeFlag({ enabled: false }),
      recipes: [buildRecipe({ marketId: '' })],
    })

    const { response, body } = await requestJson(createApp(store), '/trading/status', {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    })
    const status = body as {
      liveReady: boolean
      liveEligibility: { blockerReasons: unknown[] }
    }

    expect(response.status).toBe(200)
    expect(status.liveReady).toBe(false)
    expect(status.liveEligibility.blockerReasons).toEqual([
      'DB_RUNTIME_LIVE_GATE_DISABLED',
      'RECIPE_INVALID',
    ])
    expect(status.liveEligibility.blockerReasons.every((reason) => typeof reason === 'string')).toBe(true)
    expect(status.liveEligibility.blockerReasons.some((reason) => typeof reason === 'object')).toBe(false)
  })

  test('reports dry-run when runtime live-client construction failed after config readiness passed', async () => {
    setTradingRuntimeReadinessFailureReasons(['POLYMARKET_PRIVATE_KEY_INVALID'])
    const store = new InMemoryTradingApiStore({ runtimeFlag: buildRuntimeFlag({ enabled: true }) })

    const { response, body } = await requestJson(createApp(store), '/trading/status', {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    })
    const status = body as {
      mode: string
      liveReady: boolean
      liveEligibility: { liveReady: boolean; blockerReasons: string[] }
    }

    expect(response.status).toBe(200)
    expect(status.mode).toBe('dry-run')
    expect(status.liveReady).toBe(false)
    expect(status.liveEligibility.liveReady).toBe(false)
    expect(status.liveEligibility.blockerReasons).toEqual(['POLYMARKET_CREDENTIALS_MISSING'])
  })

  test('summarizes daily exposure using the configured trading timezone boundary', async () => {
    const store = new InMemoryTradingApiStore({
      runtimeFlag: buildRuntimeFlag({ enabled: false }),
      exposures: [
        buildExposureEntry({
          entryType: 'submitted_notional',
          notionalUsd: 11,
          eventTime: new Date('2026-05-11T17:00:00.000Z'),
        }),
        buildExposureEntry({
          entryType: 'submitted_notional',
          notionalUsd: 7,
          eventTime: new Date('2026-05-11T19:00:00.000Z'),
        }),
      ],
    })

    const status = await buildTradingStatusResponse({
      store,
      config: tradingApiConfig,
      now: new Date('2026-05-11T20:00:00.000Z'),
    })

    expect(status.exposureSummary.dayWindow).toEqual({
      start: '2026-05-11T18:30:00.000Z',
      end: '2026-05-12T18:30:00.000Z',
    })
    expect(status.exposureSummary.daySubmittedNotionalUsd).toBe(7)
  })

  test('uses the configured trading timezone boundary on the exposure endpoint', async () => {
    const store = new InMemoryTradingApiStore({
      exposures: [
        buildExposureEntry({
          entryType: 'pending_order',
          notionalUsd: 13,
          eventTime: new Date('2026-05-11T19:00:00.000Z'),
        }),
      ],
    })

    const { response, body } = await requestJson(createApp(store), '/trading/exposure', {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    })
    const exposure = body as {
      exposureSummary: {
        dayWindow: { start: string; end: string }
        dayPendingOrdersUsd: number
      }
    }

    expect(response.status).toBe(200)
    expect(exposure.exposureSummary.dayWindow).toEqual({
      start: '2026-05-10T18:30:00.000Z',
      end: '2026-05-11T18:30:00.000Z',
    })
    expect(exposure.exposureSummary.dayPendingOrdersUsd).toBe(0)
  })

  test('redacts secrets and raw signed order material from status responses', async () => {
    const store = new InMemoryTradingApiStore({
      runtimeFlag: buildRuntimeFlag({
        details: {
          authorization: 'Bearer runtime-token-secret',
          note: 'runtime-token-secret must not reappear',
          rawOrderAuth: 'raw-order-auth-secret',
        },
      }),
      intents: [
        buildIntent({
          context: {
            privateKey: 'private-key-secret',
            note: 'private-key-secret should be removed here too',
          },
        }),
      ],
      events: [
        buildEvent({
          details: {
            signedPayload: 'signed-order-body-secret',
            signature: 'signature-secret',
            message: 'signed-order-body-secret and signature-secret are sensitive',
          },
        }),
      ],
      exposures: [buildExposureEntry({ details: { safe: true } })],
      reconciliationCheckpoint: buildCheckpoint({ details: { apiSecret: 'checkpoint-secret' } }),
    })

    const { response, body } = await requestJson(createApp(store), '/trading/status', {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    })
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('runtime-token-secret')
    expect(serialized).not.toContain('raw-order-auth-secret')
    expect(serialized).not.toContain('private-key-secret')
    expect(serialized).not.toContain('signed-order-body-secret')
    expect(serialized).not.toContain('signature-secret')
    expect(serialized).not.toContain('checkpoint-secret')
  })

  test('updates the persistent live flag only for authenticated requests and records audit metadata', async () => {
    const store = new InMemoryTradingApiStore({ runtimeFlag: buildRuntimeFlag({ enabled: false }) })
    const app = createApp(store)
    const unauthenticated = await requestJson(app, '/trading/controls/live', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, reason: 'enable for rehearsal' }),
    })

    expect(unauthenticated.response.status).toBe(401)
    expect(store.runtimeFlag?.enabled).toBe(false)

    const authenticated = await requestJson(app, '/trading/controls/live', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: true, reason: 'enable for rehearsal' }),
    })
    const body = authenticated.body as {
      runtimeFlag: { enabled: boolean; reason: string | null; updatedBy: string | null }
      liveEligibility: { runtimeDbFlagEnabled: boolean }
    }

    expect(authenticated.response.status).toBe(200)
    expect(body.runtimeFlag.enabled).toBe(true)
    expect(body.runtimeFlag.reason).toBe('enable for rehearsal')
    expect(body.runtimeFlag.updatedBy).toBe('trading-api')
    expect(body.liveEligibility.runtimeDbFlagEnabled).toBe(true)
    expect(store.upserts).toHaveLength(1)
    expect(store.upserts[0]).toMatchObject({
      flagKey: TRADING_RUNTIME_LIVE_FLAG_KEY,
      enabled: true,
      reason: 'enable for rehearsal',
      updatedBy: 'trading-api',
      details: {
        audit: {
          action: 'trading-live-flag-update',
          previousEnabled: false,
          nextEnabled: true,
          source: 'trading-api',
        },
      },
    })
  })
})
